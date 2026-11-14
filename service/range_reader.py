"""Authenticated, allowlisted range-only transport; never downloads a granule.

GDAL sees a loopback proxy, not the authenticated remote URL. Every upstream
body read shares one atomic job budget (including HDF5 ancillary reads). Signed
redirect URLs, cookies and credentials are never exposed in logs/manifests.
"""
from __future__ import annotations

import http.client
import http.cookiejar
import io
import netrc
import operator
import re
import secrets
import threading
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error, parse, request

MAX_TRANSFER_BYTES = 512 * 1024 * 1024
MAX_RANGE_BYTES = 8 * 1024 * 1024
MAX_CACHE_BYTES = 16 * 1024 * 1024
MAX_CACHE_ENTRIES = 256
MAX_TELEMETRY_VALUE = (1 << 63) - 1
ASSET_HOSTS = frozenset({"nisar.asf.earthdatacloud.nasa.gov", "cumulus.asf.earthdatacloud.nasa.gov", "datapool.asf.alaska.edu"})
# Exact NISAR CloudFront distribution visible in ASF's published product spec.
# Deliberately no wildcard cloudfront.net / amazonaws.com destinations.
REDIRECT_HOSTS = ASSET_HOSTS | {"urs.earthdata.nasa.gov", "d1mv8zhcvry6x4.cloudfront.net"}


class RangeError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def validate_url(url: str, *, redirect: bool = False) -> str:
    try:
        parts = parse.urlsplit(url)
        allowed = REDIRECT_HOSTS if redirect else ASSET_HOSTS
        if (parts.scheme != "https" or parts.hostname not in allowed
                or parts.username or parts.password or parts.port not in (None, 443)
                or parts.fragment or not parts.path.startswith("/")
                or (parts.query and not redirect)
                or "PRIVATE" in parse.unquote(parts.path).upper()):
            raise ValueError
    except (ValueError, TypeError):
        raise RangeError("UNSAFE_ASSET", "Asset or redirect is outside the official HTTPS allowlist") from None
    return url


class SafeRedirect(request.HTTPRedirectHandler):
    def http_error_302(self, req, fp, code, msg, headers):
        # urllib's default handler drains fp.read() with no bound. Closing the
        # redirect response prevents an unaccounted full-body transfer.
        location = headers.get("Location") or headers.get("URI")
        if not location:
            fp.close()
            raise RangeError("UNSAFE_ASSET", "Redirect destination is missing")
        newurl = parse.urljoin(req.full_url, location)
        try:
            redirected = self.redirect_request(req, fp, code, msg, headers, newurl)
        finally:
            fp.close()
        depth = getattr(req, "_range_redirect_depth", 0) + 1
        if depth > 5:
            raise RangeError("SOURCE_HTTP", "Source exceeded the bounded redirect count")
        redirected._range_redirect_depth = depth
        return self.parent.open(redirected, timeout=req.timeout)

    http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl, redirect=True)  # Before ANY destination connection.
        result = super().redirect_request(req, fp, code, msg, headers, newurl)
        if result is not None:
            # Earthdata basic auth is scoped to its host; never forward it to CDN.
            result.remove_header("Authorization")
            result.remove_header("Cookie")
        return result


def authenticated_opener(netrc_path: Path):
    # Runtime credential loading only. Never return or log the credential values.
    try:
        auth = netrc.netrc(str(netrc_path)).authenticators("urs.earthdata.nasa.gov")
        if not auth:
            raise ValueError
        manager = request.HTTPPasswordMgrWithPriorAuth()
        manager.add_password(None, "https://urs.earthdata.nasa.gov", auth[0], auth[2], is_authenticated=True)
    except (OSError, ValueError, netrc.NetrcParseError):
        raise RangeError("EARTHDATA_CONFIG", "Earthdata netrc is unreadable or lacks the Earthdata host entry") from None
    return request.build_opener(request.ProxyHandler({}), SafeRedirect(),
                                request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
                                request.HTTPBasicAuthHandler(manager))


class TransferBudget:
    def __init__(self, limit: int = MAX_TRANSFER_BYTES):
        if not 0 < limit <= MAX_TRANSFER_BYTES:
            raise ValueError("Transfer limit must be within the hard 512 MiB cap")
        self.limit, self.transferred, self.reserved = limit, 0, 0
        self.lock = threading.Lock()

    def reserve(self, size: int):
        with self.lock:
            if self.transferred + self.reserved + size > self.limit:
                raise RangeError("TRANSFER_LIMIT", "The pair exceeded its 512 MiB range-transfer budget; reduce the crop")
            self.reserved += size

    def settle(self, reserved: int, received: int):
        with self.lock:
            self.reserved -= reserved
            self.transferred += received


class RemoteAsset:
    def __init__(self, url: str, opener, budget: TransferBudget, validator=validate_url):
        self.validate = validator
        self.url = validator(url)
        self.opener, self.budget = opener, budget
        self.size = None
        self.error = None
        self.etag = None
        self.lock = threading.RLock()
        self.cache = OrderedDict()
        self.cache_bytes = 0
        self._telemetry = dict.fromkeys(("fetch_calls", "requested_bytes",
            "exact_cache_hits", "containing_cache_hits", "cache_bytes_served",
            "open_attempts", "body_bytes_received", "unobserved_bytes_charged",
            "body_bytes_charged", "elapsed_fetch_ns"), 0)

    def _count(self, name: str, amount: int = 1):
        # Called only while holding self.lock. Fixed counters saturate rather
        # than retaining per-request data or growing integers indefinitely.
        self._telemetry[name] = min(MAX_TELEMETRY_VALUE, self._telemetry[name] + amount)

    def telemetry_snapshot(self) -> dict:
        """Return a detached, thread-safe aggregate with no source identifiers.

        Calls include failed/invalid fetches; requested bytes count only valid
        bounded requests (before EOF clipping). Open attempts count calls to
        opener.open, not HTTP transactions performed internally by redirects or
        authentication. Elapsed time includes lock waits and failed fetches.
        Exact hits compare EOF-clipped intervals. No request history is kept.
        Incomplete HTTP chunks can hide consumed payload from Python. Such a
        failure charges the unread validated interval conservatively; received
        bytes remain only those exposed by the response API.
        """
        with self.lock:
            result = dict(self._telemetry)
            result["elapsed_fetch_seconds"] = result.pop("elapsed_fetch_ns") / 1_000_000_000
            result.update(cache_entries=len(self.cache), cache_bytes=self.cache_bytes)
            return result

    def fetch(self, start: int, end: int) -> bytes:
        started = time.perf_counter_ns()
        with self.lock:  # Serialize auth/cookies and enforce stable source size/ETag.
            self._count("fetch_calls")
            try:
                try:
                    if isinstance(start, bool) or isinstance(end, bool):
                        raise TypeError
                    start, end = operator.index(start), operator.index(end)
                except TypeError:
                    raise RangeError("RANGE_REQUIRED", "Only bounded single HTTP byte ranges are allowed") from None
                if start < 0 or end < start or end - start + 1 > MAX_RANGE_BYTES:
                    raise RangeError("RANGE_REQUIRED", "Only bounded single HTTP byte ranges are allowed")
                self._count("requested_bytes", end - start + 1)
                return self._fetch_locked(start, end)
            finally:
                self._count("elapsed_fetch_ns", time.perf_counter_ns() - started)

    def _fetch_locked(self, start: int, end: int) -> bytes:
        if self.error:
            raise self.error
        # Store actual response intervals, not an end beyond EOF. Requests
        # must pass the original range cap before any clipping/cache lookup.
        effective_end = min(end, self.size - 1) if self.size is not None else end
        key = (start, effective_end)
        if key in self.cache:
            self.cache.move_to_end(key)
            data = self.cache[key]
            self._count("exact_cache_hits")
            self._count("cache_bytes_served", len(data))
            return data
        # A single validated interval must supply the entire result. Never
        # stitch partial overlaps together or fetch speculative bytes.
        for cached_key in reversed(self.cache):
            first, last = cached_key
            if first <= start <= effective_end <= last:
                data = self.cache[cached_key][start - first:effective_end - first + 1]
                self.cache.move_to_end(cached_key)
                self._count("containing_cache_hits")
                self._count("cache_bytes_served", len(data))
                return data
        reserved = end - start + 1
        received = 0
        unobserved_charge = 0
        self.budget.reserve(reserved)
        try:
            req = request.Request(self.url, headers={"Range": f"bytes={start}-{end}",
                "Accept-Encoding": "identity", "User-Agent": "EarthSignal/GCOV-crop-1"})
            if self.etag:
                req.add_header("If-Match", self.etag)
            self._count("open_attempts")
            with self.opener.open(req, timeout=30) as response:
                self.validate(response.geturl(), redirect=True)
                if response.status != 206:
                    raise RangeError("RANGE_UNSUPPORTED", "Source did not honor HTTP Range; full-granule fallback is disabled")
                match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
                if not match:
                    raise RangeError("BAD_RANGE", "Source returned an invalid Content-Range")
                first, last, total = map(int, match.groups())
                expected_end = min(end, total - 1)
                if first != start or last != expected_end or last < first or total <= last:
                    raise RangeError("BAD_RANGE", "Source returned a different byte interval")
                if self.size is not None and self.size != total:
                    raise RangeError("SOURCE_CHANGED", "Source length changed during processing")
                length = last - first + 1
                declared = response.headers.get("Content-Length")
                if declared is not None and declared != str(length):
                    raise RangeError("BAD_RANGE", "Content-Length does not match the requested interval")
                if response.headers.get("Content-Encoding", "identity") != "identity":
                    raise RangeError("BAD_RANGE", "Encoded range responses cannot be used for HDF5 offsets")
                etag = response.headers.get("ETag")
                if self.etag and self.etag != etag:
                    raise RangeError("SOURCE_CHANGED", "Source ETag changed during processing")
                chunks = []
                while received < length:
                    try:
                        chunk = response.read(min(65536, length - received))
                    except http.client.IncompleteRead as exc:
                        # http.client can discard an incomplete chunk's partial
                        # payload. Charge the remaining validated interval so a
                        # broken response cannot undercount its transfer budget.
                        received += len(exc.partial)
                        unobserved_charge = max(0, length - received)
                        raise RangeError("BAD_RANGE", "Source truncated a byte range") from None
                    if not chunk:
                        raise RangeError("BAD_RANGE", "Source truncated a byte range")
                    received += len(chunk)
                    chunks.append(chunk)
                # Read exactly the validated range; do not read even one
                # additional body byte beyond the reserved budget.
                data = b"".join(chunks)
                self.size, self.etag = total, etag
            self.cache[(start, last)] = data
            self.cache_bytes += len(data)
            while self.cache_bytes > MAX_CACHE_BYTES or len(self.cache) > MAX_CACHE_ENTRIES:
                _, discarded = self.cache.popitem(last=False)
                self.cache_bytes -= len(discarded)
            return data
        except RangeError as exc:
            self.error = exc
            raise
        except (error.URLError, OSError, ValueError) as exc:
            code = "EARTHDATA_AUTH" if isinstance(exc, error.HTTPError) and exc.code in (401, 403) else "SOURCE_HTTP"
            self.error = RangeError(code, "Official source access failed; check Earthdata authorization and network availability")
            raise self.error from None
        finally:
            self._count("body_bytes_received", received)
            self._count("unobserved_bytes_charged", unobserved_charge)
            self._count("body_bytes_charged", received + unobserved_charge)
            self.budget.settle(reserved, received + unobserved_charge)

    def length(self):
        if self.size is None:
            self.fetch(0, 0)
        return self.size


class RangeFile(io.RawIOBase):
    """Seekable h5py file object. read(-1) is prohibited, even for small assets."""
    def __init__(self, asset: RemoteAsset):
        super().__init__()
        self.asset, self.position = asset, 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=io.SEEK_SET):
        base = 0 if whence == io.SEEK_SET else self.position if whence == io.SEEK_CUR else self.asset.length() if whence == io.SEEK_END else None
        if base is None or base + offset < 0:
            raise ValueError("Invalid seek")
        self.position = base + offset
        return self.position

    def read(self, size=-1):
        if size < 0:
            raise RangeError("RANGE_REQUIRED", "Unbounded file reads are disabled")
        size = min(size, max(0, self.asset.length() - self.position))
        if size > MAX_RANGE_BYTES:
            raise RangeError("RANGE_REQUIRED", "Ancillary read exceeds the single-range cap")
        if not size:
            return b""
        data = self.asset.fetch(self.position, self.position + size - 1)
        self.position += len(data)
        return data

    def readinto(self, buffer):
        data = self.read(len(buffer))
        buffer[:len(data)] = data
        return len(data)


class RangeProxy:
    def __init__(self, assets: list[RemoteAsset]):
        self.assets = assets
        self.token = secrets.token_hex(24)
        self.server = None

    def __enter__(self):
        owner = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_):
                pass  # Do not log signed URLs, cookies, or private file paths.

            def serve(self, head=False):
                match = re.fullmatch(rf"/{owner.token}/(\d+)\.h5", self.path)
                if not match or int(match[1]) >= len(owner.assets):
                    self.send_error(404)
                    return
                asset = owner.assets[int(match[1])]
                try:
                    total = asset.length()
                    if head:
                        self.send_response(200)
                        self.send_header("Content-Length", str(total))
                    else:
                        interval = re.fullmatch(r"bytes=(\d+)-(\d+)", self.headers.get("Range", ""))
                        if not interval:
                            raise RangeError("RANGE_REQUIRED", "Bounded Range header required")
                        start, end = map(int, interval.groups())
                        if start >= total:
                            raise RangeError("BAD_RANGE", "Range outside source")
                        end = min(end, total - 1)
                        data = asset.fetch(start, end)
                        self.send_response(206)
                        self.send_header("Content-Length", str(len(data)))
                        self.send_header("Content-Range", f"bytes {start}-{end}/{total}")
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Content-Type", "application/octet-stream")
                    self.end_headers()
                    if not head:
                        self.wfile.write(data)
                except RangeError as exc:
                    asset.error = exc
                    self.send_error(502, "Range source unavailable")

            def do_HEAD(self):
                self.serve(head=True)

            def do_GET(self):
                self.serve()

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def vsi_path(self, index):
        return f"/vsicurl/http://127.0.0.1:{self.server.server_port}/{self.token}/{index}.h5"

    def check(self):
        for asset in self.assets:
            if asset.error:
                raise asset.error

    def __exit__(self, *_):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
