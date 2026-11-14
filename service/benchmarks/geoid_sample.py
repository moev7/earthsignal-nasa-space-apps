"""Opt-in acquisition and offline description of one frozen GEOID development crop.

No production dependency on rasterio. Run ``python -m service.benchmarks.geoid_sample
--help``. ``fetch`` is the only network operation; ``analyze`` is strictly offline.
The injectable transport has open(url, timeout) -> response with status, headers
(list of pairs), read(size, timeout), and close(). It must not retry or authenticate.
"""
import argparse
import ctypes
import hashlib
import http.client
import io
import json
import math
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile
import time
from urllib.parse import urljoin, urlsplit


VERSION = "geoid-development-sample-1"
PLAN_SHA256 = "364c2df188c5ef4623000eb7a68adbda4e92d72b0f6781c44193dfd10c45df61"
DATASET = "links-ads/geoid-flood"
REVISION = "868407460bf3db492f50730a57585916baa71dc6"
MAX_BYTES = 64 * 1024 * 1024
READ_TIMEOUT = 15.0
DEADLINE_SECONDS = 180.0
CHUNK = 64 * 1024
ROLES = ("before", "after", "label", "validity")
NAMES = {role: role + ".tif" for role in ROLES}
HEADER = (
    "Small retrospective provider-labeled development sample (n=1), not current risk. "
    "This fixed training-split crop describes recorded radar power within provider classes; "
    "one static provider label groups both dates and does not establish either date's ground conditions. "
    "The labels are not field truth. Orbit and incidence compatibility are unknown. "
    "The 30-pixel display gate is an engineering rule, not an independence or sample-size guarantee."
)


class SampleError(ValueError):
    """Stable messages intentionally contain no local paths or redirect URLs."""


def _read_private(path, limit):
    """Bounded regular-file read; never follow the final path component."""
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise SampleError("Regular input file required")
        raw = source.read(limit + 1)
    if len(raw) > limit:
        raise SampleError("Input byte limit exceeded")
    return raw


def load_plan(path):
    raw = _read_private(path, 32768)
    if hashlib.sha256(raw).hexdigest() != PLAN_SHA256:
        raise SampleError("Frozen plan identity mismatch")
    plan = json.loads(raw)
    # The byte pin freezes every field, including source paths and all identities.
    assets = plan["assets"]
    if (plan["dataset"] != DATASET or plan["revision"] != REVISION
            or len(assets) != 4 or {a["role"] for a in assets} != set(ROLES)
            or plan["limitBytes"] != MAX_BYTES
            or any(type(a["bytes"]) is not int or a["bytes"] <= 0 for a in assets)
            or sum(a["bytes"] for a in assets) > MAX_BYTES):
        raise SampleError("Unsupported frozen plan")
    return plan


def _provider_hash(raw, algorithm):
    if algorithm == "sha256":
        return hashlib.sha256(raw).hexdigest()
    if algorithm == "git-blob-sha1":
        return hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()
    raise SampleError("Unsupported provider identity")


def _verify(raw, asset):
    if len(raw) != asset["bytes"] or _provider_hash(raw, asset["identity"]["algorithm"]) != asset["identity"]["value"]:
        raise SampleError("Asset length or provider identity mismatch")
    return {"role": asset["role"], "sourcePath": asset["path"], "bytes": len(raw),
            "providerIdentity": dict(asset["identity"]), "sha256": hashlib.sha256(raw).hexdigest()}


def _allowed_url(url):
    try:
        parsed = urlsplit(url)
        host = parsed.hostname or ""
        safe = (parsed.scheme == "https" and parsed.username is None and parsed.password is None
                and parsed.port in (None, 443) and not parsed.fragment
                and all(ord(c) >= 33 and ord(c) < 127 for c in url)
                and any(host == base or host.endswith("." + base) for base in ("huggingface.co", "hf.co")))
    except ValueError:
        safe = False
    if not safe:
        raise SampleError("Unsafe redirect destination")


class _DeadlineReader(io.RawIOBase):
    """Bound a complete header read, including a peer sending one byte at a time."""
    def __init__(self, raw, deadline):
        self.raw, self.deadline, self._sock = raw, deadline, raw._sock

    def readable(self):
        return True

    def readinto(self, buffer):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Transport read deadline")
        self._sock.settimeout(remaining)
        return self.raw.readinto(buffer)

    def close(self):
        self.raw.close()
        super().close()


class _HeaderSocket:
    def __init__(self, sock, deadline):
        self.sock, self.deadline = sock, deadline

    def makefile(self, mode):
        # Unbuffered header lines prevent prefetching an uncounted response body
        # before its status/length/encoding have been accepted. TLS may buffer
        # records internally; these are not application body reads.
        return _DeadlineReader(self.sock.makefile(mode, buffering=0), self.deadline)


class _HTTPSResponse:
    def __init__(self, connection, response):
        self.connection, self.response = connection, response
        if isinstance(response.fp, _DeadlineReader):
            response.fp = io.BufferedReader(response.fp)
        self.status, self.headers = response.status, response.getheaders()

    def read(self, size, timeout):
        # HTTPResponse may own the socket after a Connection: close response.
        if self.response.fp is None:
            return b""
        if isinstance(self.response.fp.raw, _DeadlineReader):
            self.response.fp.raw.deadline = time.monotonic() + timeout
        self.response.fp.raw._sock.settimeout(timeout)
        # At most one underlying receive; a drip-fed body cannot reset the
        # overall deadline repeatedly inside a large buffered read.
        return self.response.read1(size)

    def close(self):
        self.response.close()
        self.connection.close()


class HTTPSTransport:
    """Direct TLS: no environment proxy, netrc, cookies, auth, or auto redirects."""
    def open(self, url, timeout):
        _allowed_url(url)
        parsed = urlsplit(url)
        deadline = time.monotonic() + timeout
        connection = http.client.HTTPSConnection(parsed.hostname, timeout=timeout)
        connection.response_class = lambda sock, **kwargs: http.client.HTTPResponse(
            _HeaderSocket(sock, deadline), **kwargs)
        target = parsed.path + ("?" + parsed.query if parsed.query else "")
        try:
            connection.connect()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Transport setup deadline")
            connection.sock.settimeout(remaining)
            connection.request("GET", target, headers={"Accept-Encoding": "identity", "Connection": "close"})
            return _HTTPSResponse(connection, connection.getresponse())
        except Exception:
            connection.close()
            raise


class _Budget:
    def __init__(self, clock):
        self.clock, self.end = clock, clock() + DEADLINE_SECONDS
        self.bytes, self.redirects = 0, 0

    def timeout(self):
        remaining = self.end - self.clock()
        if remaining <= 0:
            raise SampleError("Acquisition deadline exceeded")
        return min(READ_TIMEOUT, remaining)

    def count(self, raw):
        self.bytes += len(raw)
        if self.bytes > MAX_BYTES:
            raise SampleError("Cumulative asset byte limit exceeded")


def _headers(response, name):
    return [value for key, value in response.headers if key.lower() == name]


def _download(asset, transport, budget):
    url = f"https://huggingface.co/datasets/{DATASET}/resolve/{REVISION}/{asset['path']}"
    redirects = 0
    while True:
        _allowed_url(url)
        response = transport.open(url, budget.timeout())
        try:
            budget.timeout()
            if response.status in (301, 302, 303, 307, 308):
                locations = _headers(response, "location")
                redirects += 1
                budget.redirects += 1
                if len(locations) != 1 or redirects > 5 or budget.redirects > 20:
                    raise SampleError("Redirect limit or structure rejected")
                if not locations[0] or any(ord(c) < 33 or ord(c) >= 127 for c in locations[0]):
                    raise SampleError("Unsafe redirect destination")
                url = urljoin(url, locations[0])
                _allowed_url(url)
                continue  # finally closes immediately; never read a redirect body.
            lengths = _headers(response, "content-length")
            encoding = _headers(response, "content-encoding")
            if (response.status != 200 or lengths != [str(asset["bytes"])]
                    or encoding not in ([], ["identity"])
                    or _headers(response, "transfer-encoding")
                    or _headers(response, "content-range")):
                raise SampleError("Full identity-encoded response with exact length required")
            chunks, length = [], 0
            while True:
                try:
                    chunk = response.read(min(CHUNK, asset["bytes"] - length + 1), budget.timeout())
                except http.client.IncompleteRead as exc:
                    budget.count(exc.partial)
                    raise SampleError("Incomplete asset body") from None
                budget.count(chunk)
                budget.timeout()
                length += len(chunk)
                if length > asset["bytes"]:
                    raise SampleError("Asset body exceeds declared length")
                if not chunk:
                    break
                chunks.append(chunk)
            raw = b"".join(chunks)
            _verify(raw, asset)
            return raw
        finally:
            response.close()


def _publish_directory(stage, destination):
    """Atomic, no-replace publication; fail closed on unsupported platforms."""
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == "darwin":
        rename = libc.renamex_np
        args = (os.fsencode(stage), os.fsencode(destination), 4)  # RENAME_EXCL
        rename.argtypes = (ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint)
    elif sys.platform.startswith("linux") and hasattr(libc, "renameat2"):
        rename = libc.renameat2
        args = (-100, os.fsencode(stage), -100, os.fsencode(destination), 1)  # RENAME_NOREPLACE
        rename.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
    else:
        raise SampleError("Exclusive atomic directory publication unavailable")
    rename.restype = ctypes.c_int
    if rename(*args):
        raise OSError(ctypes.get_errno(), "Exclusive publication refused")


def _write_bytes(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as target:
        target.write(raw)
        target.flush()
        os.fsync(target.fileno())


def _json_bytes(value):
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")


def fetch(plan, destination, *, transport=None, clock=time.monotonic):
    """Explicit opt-in network call. Publish all four verified files and receipt once.

    Errors expose only stable messages and total consumed body bytes. A failure is
    terminal; neither this function nor the default transport retries.
    """
    value = load_plan(plan)  # Must precede transport or creation of any output.
    destination = Path(destination).absolute()
    if os.path.lexists(destination) or not destination.parent.is_dir():
        raise SampleError("New destination with existing parent required")
    stage = Path(tempfile.mkdtemp(prefix=".geoid-owned-", dir=destination.parent))
    os.chmod(stage, 0o700)
    budget = _Budget(clock)
    try:
        records = []
        for asset in value["assets"]:
            raw = _download(asset, transport if transport is not None else HTTPSTransport(), budget)
            records.append(_verify(raw, asset))
            _write_bytes(stage / NAMES[asset["role"]], raw)
        receipt = {"schemaVersion": VERSION, "planSha256": PLAN_SHA256,
                   "assetBodyBytes": budget.bytes, "assets": records}
        _write_bytes(stage / "receipt.json", _json_bytes(receipt))
        budget.timeout()
        _publish_directory(stage, destination)
        return receipt
    except Exception:
        # Never include exception text: it can contain signed redirect tokens.
        raise SampleError(f"Acquisition failed; consumed asset body bytes={budget.bytes}") from None
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def summarize_arrays(before, after, label, validity, native_masks):
    """Pure crop summary. Inputs are native arrays, with no filling or resampling.

    Native masks use GDAL's 0/255 convention. Independent exclusion counts overlap;
    only the union is subtracted from the common population. Every displayed date,
    band, and class uses that one population (or its class subset).
    """
    import numpy as np

    if set(native_masks) != set(ROLES):
        raise SampleError("Four native masks required")
    arrays = {"before": before, "after": after, "label": label, "validity": validity}
    for role, array in arrays.items():
        shape = (2, 256, 256) if role in ("before", "after") else (256, 256)
        dtype = np.dtype("float32" if role in ("before", "after") else "uint8")
        mask = native_masks[role]
        if (array.shape != shape or array.dtype != dtype or mask.shape != shape
                or mask.dtype != np.uint8 or not np.isin(mask, [0, 255]).all()):
            raise SampleError("Unsupported array or native mask structure")
    if not np.isin(label, [0, 1, 2, 255]).all() or not np.isin(validity, [0, 1]).all():
        raise SampleError("Unsupported label or validity value")
    count = lambda a: int(np.count_nonzero(a))
    labeled, mapped = label != 255, validity == 1
    native = np.ones((256, 256), dtype=bool)
    per_date, power, invalid_power = {}, {}, {}
    for role in ROLES:
        mask = native_masks[role] == 255
        native &= mask.all(axis=0) if mask.ndim == 3 else mask
    for role in ("before", "after"):
        array = arrays[role]
        valid = np.isfinite(array) & (array > 0) & (array <= 1000)
        power[role] = valid.all(axis=0)
        per_date[role] = power[role] & (native_masks[role] == 255).all(axis=0)
        invalid_power[role] = {
            band: {"nonfinite": count(~np.isfinite(array[i])), "zero": count(array[i] == 0),
                   "negative": count(np.isfinite(array[i]) & (array[i] < 0)),
                   "above1000": count(np.isfinite(array[i]) & (array[i] > 1000))}
            for i, band in enumerate(("VV", "VH"))}
    common = labeled & mapped & native & power["before"] & power["after"]

    def describe(population):
        n = count(population)
        result = {"commonPixels": n, "areaM2": n * 100,
                  "status": "displayed" if n >= 30 else "withheld-absent-class" if n == 0 else "withheld-below-display-gate",
                  "perDate": None}
        if n >= 30:
            result["perDate"] = {
                date: {band: {"pixels": n, "percentilesDb": dict(zip(
                    ("p05", "p25", "p50", "p75", "p95"),
                    np.percentile(10 * np.log10(arrays[date][i][population].astype(np.float64)),
                                  [5, 25, 50, 75, 95], method="linear").tolist()))}
                       for i, band in enumerate(("VV", "VH"))}
                for date in ("before", "after")}
        return result

    return {"totalPixels": 65536, "labeledPixels": count(labeled), "mappedPixels": count(mapped),
            "nativeValidPixels": count(native),
            "perDateValidPixels": {role: count(mask) for role, mask in per_date.items()},
            "common": describe(common),
            "byClass": {str(code): {"providerClass": name, **describe(common & (label == code))}
                        for code, name in ((0, "background"), (1, "permanent water"), (2, "flooded water"))},
            "overlappingExclusions": {
                "meaning": "Independent counts overlap; do not add. Union is totalPixels minus commonPixels.",
                "unlabeledPixels": count(~labeled), "unmappedPixels": count(~mapped),
                "nativeInvalidPixels": count(~native),
                "perDateInvalidPowerPixels": {role: count(~mask) for role, mask in power.items()},
                "excludedUnionPixels": count(~common), "perBandPowerDiagnostics": invalid_power}}


def analyze(plan, directory):
    """Offline: verify exact provider files before importing/opening any raster."""
    value = load_plan(plan)
    directory = Path(directory)
    if directory.is_symlink() or not directory.is_dir():
        raise SampleError("Regular acquired directory required")
    raw, records = {}, []
    for asset in value["assets"]:
        content = _read_private(directory / NAMES[asset["role"]], asset["bytes"])
        records.append(_verify(content, asset))
        raw[asset["role"]] = content
    import rasterio
    from rasterio.io import MemoryFile
    from rasterio.windows import Window

    arrays, masks, transform = {}, {}, None
    # Memory files exclude unpinned sidecars and any network/virtual paths.
    with rasterio.Env(GDAL_PAM_ENABLED="NO", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        for role in ROLES:
            if raw[role][:4] not in (b"II*\0", b"MM\0*"):
                raise SampleError("Classic TIFF required")
            with MemoryFile(raw[role]) as memory, memory.open(driver="GTiff") as raster:
                bands, dtype = (2, "float32") if role in ("before", "after") else (1, "uint8")
                affine = raster.transform
                if (raster.driver != "GTiff" or raster.crs != rasterio.crs.CRS.from_epsg(32632)
                        or raster.width != 1024 or raster.height != 1024
                        or raster.count != bands or raster.dtypes != (dtype,) * bands
                        or raster.scales != (1.0,) * bands or raster.offsets != (0.0,) * bands
                        or not all(math.isfinite(x) for x in tuple(affine))
                        or affine.b != 0 or affine.d != 0
                        or abs(affine.a - 10) > 1e-9 or abs(affine.e + 10) > 1e-9
                        or (transform is not None and affine != transform)):
                    raise SampleError("Native raster grid or structure mismatch")
                transform = affine
                data = raster.read(window=Window(384, 384, 256, 256))
                mask = raster.read_masks(window=Window(384, 384, 256, 256))
                arrays[role], masks[role] = (data, mask) if bands == 2 else (data[0], mask[0])
    summary = summarize_arrays(arrays["before"], arrays["after"], arrays["label"], arrays["validity"], masks)
    common = summary["common"]["commonPixels"]
    simple = (
        f"Tile {value['tileId']}: before {value['acquisitionTimes']['before']} and after "
        f"{value['acquisitionTimes']['after']} (filename times; timezone unverified). "
        f"{common:,} of 65,536 fixed crop pixels ({100 * common / 65536:.2f}%) pass all shared validity rules. "
        "Both dates and both radar bands use those same pixels within each provider class. "
        "One static provider label groups both dates; it is not a separate ground observation at each date. "
        "Provider background does not independently prove dry ground. "
    )
    for item in summary["byClass"].values():
        simple += f"Provider {item['providerClass']}: {item['commonPixels']:,} shared pixels. "
        if item["commonPixels"] == 0:
            simple += "This class is absent from the shared population, so its radar summary is withheld. "
        elif item["commonPixels"] < 30:
            simple += "Its radar summary is withheld because fewer than 30 shared pixels meet the display rule. "
    return {"schemaVersion": VERSION, "plainLanguage": HEADER, "planSha256": PLAN_SHA256,
            "inSimpleTerms": simple.strip(),
            "dataset": DATASET, "revision": REVISION, "tileId": value["tileId"], "split": value["split"],
            "eventTime": value["eventTime"], "acquisitionTimes": value["acquisitionTimes"],
            "license": value["license"], "radiometry": value["radiometry"],
            "geometryCompatibility": value["geometryCompatibility"], "assets": records,
            "nativeGrid": {"crs": "EPSG:32632", "width": 1024, "height": 1024,
                           "affine": list(transform)[:6], "cellAreaM2": 100,
                           "nominalSpacingToleranceM": 1e-9, "crossAssetTransformEquality": "exact",
                           "bandScales": 1, "bandOffsets": 0},
            "crop": {**value["window"], "affine": list(transform @ rasterio.Affine.translation(384, 384))[:6]},
            "units": {"input": "linear sigma0 power, provider asserted", "summary": "10 log10(power), dB",
                      "area": "native projected square metres", "percentileMethod": "linear"},
            "maskPolicy": {"rule": value["maskPolicy"],
                           "native": "Internal TIFF native masks only; no unpinned external sidecars",
                           "classGrouping": "Same static provider label for both dates, not per-date ground truth",
                           "perDateValidPixels": "Both bands satisfy power bounds and that date's native masks, before label/validity gates",
                           "common": "label in 0/1/2 AND validity==1 AND all four native masks (both radar bands) AND both dates' both bands finite, >0, <=1000",
                           "denominator": "One common population for all dates/bands; each class uses only its common subset"},
            "minimumSummaryPixels": 30, "summary": summary}


def write_json_new(path, value):
    """Private complete file, atomically linked to a new name without replacement."""
    path = Path(path).absolute()
    if os.path.lexists(path):
        raise SampleError("New output required")
    fd, temporary = tempfile.mkstemp(prefix=".geoid-json-owned-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as target:
            target.write(_json_bytes(value))
            target.flush()
            os.fsync(target.fileno())
        os.link(temporary, path, follow_symlinks=False)
    finally:
        os.unlink(temporary)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    fetch_parser = commands.add_parser("fetch", help="Explicit network opt-in; four frozen assets only")
    fetch_parser.add_argument("--plan", required=True)
    fetch_parser.add_argument("--destination", required=True, help="New directory; includes private receipt.json")
    analyze_parser = commands.add_parser("analyze", help="Offline descriptive crop summary; optional rasterio required")
    analyze_parser.add_argument("--plan", required=True)
    analyze_parser.add_argument("--directory", required=True)
    analyze_parser.add_argument("--output", required=True, help="New private JSON file")
    args = parser.parse_args(argv)
    try:
        if args.command == "fetch":
            fetch(args.plan, args.destination)
        else:
            write_json_new(args.output, analyze(args.plan, args.directory))
        print(json.dumps({"status": "completed", "operation": args.command, "schemaVersion": VERSION}))
        return 0
    except Exception:
        print("GEOID sample refused: changed, unsupported, unavailable input or output; no retry.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
