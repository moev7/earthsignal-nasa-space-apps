"""Export the frozen Lake Mead GCOV study without network access or resampling.

Run ``python -m service.export_public_radar``; add ``--check`` for read-only QA.
The unchanged original manifest/numerical artifacts are in native-radar-development;
prepared-study supplies the historical verification receipt. Original source PNG
metadata describes its absent Web Mercator previews. Public PNGs are newly rendered
native-grid views: their authoritative checksums are the outer ``files`` table.
Before/after TIFFs remain linear gamma0; only JSON/PNG display values use dB.
Rasterio is the already-used optional offline reader, not a service dependency.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image

from .processing import _preview_rgba
from .verify_native_radar import MANIFEST_SHA256, ROOT, pinned_bytes

PROJECT = Path(__file__).resolve().parents[1]
OUTPUT = PROJECT / "public/data/radar/lake-mead-gcov-2026"
VERIFICATION = PROJECT / "examples/prepared-study/verification.json"
VERIFICATION_SHA256 = "4a587518478e55759b2b396cc15451cf9f91284c6d7c8969772cabe0ac3261fc"
TIFF_NAMES = ("before.tif", "after.tif", "difference.tif", "validity.tif")
STATS_KEYS = ("medianDb", "p05Db", "p95Db", "minDb", "maxDb")


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _statistics(values):
    p05, median, p95 = np.percentile(values, [5, 50, 95])
    return dict(zip(STATS_KEYS, map(float, (median, p05, p95, values.min(), values.max()))))


def _validate_arrays(source, arrays, receipt):
    """Check native mask, radiometry, coverage and original measurement evidence."""
    before, after, difference, validity = (arrays[name] for name in TIFF_NAMES)
    crop, coverage = source["crop"], source["coverage"]
    shape = (crop["height"], crop["width"])
    _require(shape == (114, 94), "Unexpected frozen study dimensions")
    _require(all(a.shape == shape for a in arrays.values()), "Native raster dimensions mismatch")
    _require(all(a.dtype == np.float32 for a in (before, after, difference)) and
             validity.dtype == np.uint8, "Unexpected native raster dtype")
    _require(np.isin(validity, [0, 1]).all(), "Invalid common-valid mask codes")
    common = validity == 1
    _require(common.any(), "Empty common-valid mask")
    valid_per_date = []
    for name, power in (("before", before), ("after", after)):
        valid = np.isfinite(power)
        _require(np.isnan(power[~valid]).all(), "Invalid power must be NaN")
        _require((power[valid] > 0).all(), "Valid gamma0 must be positive")
        _require(int(valid.sum()) == coverage[name + "ValidPixels"], "Per-date coverage mismatch")
        valid_per_date.append(valid)
    _require(np.array_equal(common, valid_per_date[0] & valid_per_date[1]),
             "Common validity differs from power intersection")
    _require(np.array_equal(common, np.isfinite(difference)) and
             np.isnan(difference[~common]).all(), "Difference validity mismatch")
    count = int(common.sum())
    _require(common.size == coverage["totalPixels"] and count == coverage["commonValidPixels"],
             "Native pixel coverage mismatch")
    _require(abs(100 * count / common.size - coverage["commonValidPercent"]) < 1e-10,
             "Native percent coverage mismatch")
    gt = crop["transform"]
    cell_area = abs(gt[1] * gt[5] - gt[2] * gt[4])
    _require(cell_area == 100 and crop["resolution"] == [10, 10], "Unexpected native cell area")
    _require(abs(count * cell_area / 1e6 - coverage["validAreaKm2"]) < 1e-12,
             "Native valid area mismatch")
    before_db = np.full(shape, np.nan)
    after_db = np.full(shape, np.nan)
    before_db[common] = 10 * np.log10(before[common].astype(np.float64))
    after_db[common] = 10 * np.log10(after[common].astype(np.float64))
    # Original float64 arithmetic and original Float32 TIFF agree within rounding.
    expected = 10 * (np.log10(after[common].astype(np.float64)) -
                     np.log10(before[common].astype(np.float64)))
    _require(np.allclose(difference[common], expected, atol=1e-5, rtol=0),
             "Native difference does not match gamma0 powers")
    _require(np.allclose(after_db[common] - before_db[common], difference[common],
                        atol=1e-5, rtol=0), "Public dB arithmetic mismatch")
    for key, actual in _statistics(expected).items():
        _require(abs(actual - source["stats"][key]) < 1e-10, "Original statistics mismatch: " + key)
        _require(abs(actual - receipt["stats"][key]) < 1e-10, "Verification statistics mismatch: " + key)
    for key, actual in _statistics(difference[common]).items():
        _require(abs(actual - source["stats"][key]) < 1e-6,
                 "Exported Float32 statistics mismatch: " + key)
    _require(receipt["exportChecks"] == "passed" and
             receipt["nativeSourceReproduction"] == "passed" and
             receipt["extractedInputDigests"] == "matched" and
             receipt["validPixels"] == count and
             abs(receipt["medianDb"] - source["stats"]["medianDb"]) < 1e-10,
             "Historical verification receipt mismatch")
    display = source["display"]
    # Reproduce original shared stretch using each date's own valid footprint.
    all_db = np.concatenate([10 * np.log10(power[valid].astype(np.float64))
                             for power, valid in zip((before, after), valid_per_date)])
    minimum, maximum = np.percentile(all_db, [2, 98])
    if maximum <= minimum:
        minimum, maximum = minimum - 1, maximum + 1
    limit = max(1.0, float(np.percentile(np.abs(expected), 98)))
    _require(np.allclose([minimum, maximum, limit],
                        [display["backscatterMinDb"], display["backscatterMaxDb"],
                         display["differenceLimitDb"]], atol=1e-10, rtol=0),
             "Original display stretch mismatch")
    return common, before_db, after_db


def build_export(source_dir=ROOT, verification_path=VERIFICATION):
    """Return fully verified frozen export bytes, before any output is written."""
    from rasterio.io import MemoryFile
    from rasterio.crs import CRS

    source_dir = Path(source_dir)
    source = json.loads(pinned_bytes(source_dir / "manifest.json", MANIFEST_SHA256, 128 * 1024))
    receipt_raw = pinned_bytes(Path(verification_path), VERIFICATION_SHA256, 128 * 1024)
    receipt = json.loads(receipt_raw)
    hashes = source["processing"]["sourceMetadata"]["artifactSha256"]
    payloads, arrays = {}, {}
    for name in TIFF_NAMES:
        raw = pinned_bytes(source_dir / name, hashes[name], 1024**2)
        # Decode precisely the verified bytes; do not load mutable sidecars.
        with MemoryFile(raw) as memory, memory.open() as dataset:
            _require(dataset.driver == "GTiff" and dataset.count == 1 and
                     dataset.shape == (114, 94) and
                     dataset.crs == CRS.from_string(source["crop"]["crs"]) and
                     list(dataset.transform.to_gdal()) == source["crop"]["transform"],
                     "Native TIFF grid mismatch: " + name)
            if name != "validity.tif":
                _require(dataset.nodata is not None and np.isnan(dataset.nodata),
                         "Native TIFF nodata mismatch: " + name)
            arrays[name] = dataset.read(1)
        payloads[name] = raw
    common, before_db, after_db = _validate_arrays(source, arrays, receipt)

    def nullable(array):
        return [float(value) if valid else None
                for value, valid in zip(array.ravel(), common.ravel())]

    values = {"width": 94, "height": 114, "beforeDb": nullable(before_db),
              "afterDb": nullable(after_db), "differenceDb": nullable(arrays["difference.tif"])}
    payloads["values.json"] = _json_bytes(values)
    display = source["display"]
    minimum, maximum, limit = (display[key] for key in
                               ("backscatterMinDb", "backscatterMaxDb", "differenceLimitDb"))
    previews = {
        "before": _preview_rgba(before_db, common, minimum, maximum),
        "after": _preview_rgba(after_db, common, minimum, maximum),
        "difference": _preview_rgba(arrays["difference.tif"], common, -limit, limit, diverging=True),
        "excluded": _preview_rgba(arrays["difference.tif"], common, 0, 1, excluded=True),
    }
    for name, rgba in previews.items():
        stream = io.BytesIO()
        Image.fromarray(rgba).save(stream, format="PNG")
        payloads[name + ".png"] = stream.getvalue()
    payloads["verification.json"] = receipt_raw
    manifest = {"schema": "earthsignal.radar-study/1", "id": "lake-mead-gcov-2026",
                "provenance": "measured", "quantity": "HH radar backscatter change", "units": "dB",
                "presentation": {"grid": "native", "resampling": "none", "notice": "Public PNGs use the native 94 x 114 measurement grid. The unchanged source manifest records historical Web Mercator previews; its original PNG hashes do not describe these public PNGs. Use the outer files table for public file integrity."},
                "source": source, "files": {name: {"bytes": len(raw),
                    "sha256": hashlib.sha256(raw).hexdigest()} for name, raw in sorted(payloads.items())}}
    payloads["manifest.json"] = _json_bytes(manifest)
    return manifest, payloads


def _json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n").encode()


def _check_export(output_dir, manifest, payloads):
    """Verify file integrity and reconstructed content across libm/PNG builds.

    Native TIFFs and receipts stay byte-exact. Float64 log10 can differ by a few
    ulps across NumPy CPU implementations; PNG compression is not pixel content.
    """
    path = output_dir / "manifest.json"
    _require(path.is_file(), "Frozen public export mismatch: manifest.json")
    stored = json.loads(path.read_bytes())
    _require({k: v for k, v in stored.items() if k != "files"} ==
             {k: v for k, v in manifest.items() if k != "files"} and
             set(stored.get("files", {})) == set(manifest["files"]),
             "Frozen public export mismatch: manifest.json")
    for name, expected in payloads.items():
        if name == "manifest.json":
            continue
        path = output_dir / name
        _require(path.is_file(), "Frozen public export mismatch: " + name)
        raw = path.read_bytes()
        _require(stored["files"][name] == {"bytes": len(raw),
                 "sha256": hashlib.sha256(raw).hexdigest()},
                 "Frozen public export integrity mismatch: " + name)
        matches = raw == expected
        if not matches and name == "values.json":
            actual, rebuilt = json.loads(raw), json.loads(expected)
            matches = (set(actual) == set(rebuilt) and
                       all(actual[k] == rebuilt[k] for k in ("width", "height", "differenceDb")))
            for key in ("beforeDb", "afterDb"):
                left, right = actual.get(key, []), rebuilt[key]
                if len(left) != len(right):
                    matches = False
                    break
                # Preserve exact masks; permit only Float64 arithmetic roundoff.
                if any((x is None) != (y is None) for x, y in zip(left, right)):
                    matches = False
                    break
                valid = [(x, y) for x, y in zip(left, right) if y is not None]
                matches = matches and np.allclose([x for x, _ in valid],
                    [y for _, y in valid], rtol=0, atol=1e-12)
        elif not matches and name.endswith(".png"):
            with Image.open(io.BytesIO(raw)) as actual, Image.open(io.BytesIO(expected)) as rebuilt:
                matches = (actual.mode == rebuilt.mode == "RGBA" and actual.size == rebuilt.size and
                           np.array_equal(np.asarray(actual), np.asarray(rebuilt)))
        _require(matches, "Frozen public export mismatch: " + name)
    return stored


def export_public_radar(output_dir=OUTPUT, *, check=False, source_dir=ROOT, verification_path=VERIFICATION):
    manifest, payloads = build_export(source_dir, verification_path)
    output_dir = Path(output_dir)
    if check:
        return _check_export(output_dir, manifest, payloads)
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, raw in payloads.items():
        (output_dir / name).write_bytes(raw)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify the existing export without writing")
    args = parser.parse_args()
    manifest = export_public_radar(check=args.check)
    print(json.dumps({"status": "verified" if args.check else "exported", "id": manifest["id"],
                      "files": len(manifest["files"]), "width": 94, "height": 114,
                      "commonValidPixels": manifest["source"]["coverage"]["commonValidPixels"]}))


if __name__ == "__main__":
    main()
