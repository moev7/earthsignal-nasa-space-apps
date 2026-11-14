"""Native-grid NISAR GCOV Frequency A HHHH gamma0 crop comparison.

Scientific arrays never pass through a warp. Fail closed on metadata, mask,
grid or transport uncertainty. Browser PNGs alone are warped to Web Mercator.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib import error, parse, request

from .range_reader import (RangeError, RangeFile, RangeProxy, RemoteAsset,
                           SafeRedirect, TransferBudget, authenticated_opener,
                           validate_url)

ALGORITHM_VERSION = "gcov-hhhh-v3"
MAX_PIXELS = 1_000_000
GRID_PATH = "/science/LSAR/GCOV/grids/frequencyA"
IDENTIFICATION = "/science/LSAR/identification"
MASK_SOURCE = "https://github.com/isce-framework/isce3/blob/v0.25.13/python/packages/nisar/products/XML/L2/nisar_L2_GCOV.xml"
MASK_SOURCES = {
    "1.5.0": MASK_SOURCE,
    "1.6.0": "https://github.com/isce-framework/isce3/blob/127452609bb9b3bdf3f7a2bf1cdf49c493b49441/python/packages/nisar/products/XML/L2/nisar_L2_GCOV.xml",
}
MASK_POLICY = ("GCOV valid samples subswath mask: retain positive subswath IDs 1..254; "
    "exclude 0 (partially focused/invalid) and 255 (outside acquisition). "
    "Also exclude fill, non-finite and non-positive HHHH power and centers outside the requested bbox. "
    "Difference uses the intersection of both validity masks. This is not a layover/shadow mask.")


class ProcessingError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def capability(netrc_path: Path) -> tuple[bool, str]:
    try:
        path = Path(netrc_path)
        if not path.is_file() or not os.access(path, os.R_OK):
            return False, "Configure a readable Earthdata netrc file on the processing host"
        import numpy  # noqa: F401
        import h5py  # noqa: F401
        from PIL import Image  # noqa: F401
        from osgeo import gdal
        version = int(gdal.VersionInfo("VERSION_NUM"))
        if not 3120000 <= version < 3130000:
            return False, "Processing requires GDAL 3.12.x with the NETCDF driver (runtime 3.12.2)"
        for driver in ("netCDF", "GTiff", "MEM"):
            if not gdal.GetDriverByName(driver):
                return False, f"Processing host lacks GDAL {driver} driver"
        if gdal.GetDriverByName("netCDF").GetMetadataItem("DCAP_VIRTUALIO") != "YES":
            return False, "GDAL NETCDF must support virtual IO for bounded range-only access"
        return True, "Earthdata file and native processing dependencies are available; source access is checked per job"
    except (ImportError, OSError, RuntimeError, TypeError):
        return False, "Install the pinned NumPy, Pillow, h5py and GDAL processing dependencies"


class _CatalogRedirect(SafeRedirect):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parts = parse.urlsplit(newurl)
        if parts.scheme != "https" or parts.hostname != "api.daac.asf.alaska.edu" or parts.port not in (None, 443):
            raise ProcessingError("CATALOG_REDIRECT", "ASF lookup redirected outside its official HTTPS endpoint")
        return request.HTTPRedirectHandler.redirect_request(self, req, fp, code, msg, headers, newurl)


def lookup_source(product_id: str) -> dict:
    """Exact ASF fileID lookup. No wildcard/granule-name approximation."""
    if not isinstance(product_id, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,220}", product_id):
        raise ProcessingError("INVALID_ID", "A single exact ASF product ID is required")
    url = "https://api.daac.asf.alaska.edu/services/search/param?" + parse.urlencode({"product_list": product_id, "output": "geojson"})
    try:
        opener = request.build_opener(request.ProxyHandler({}), _CatalogRedirect())
        with opener.open(request.Request(url, headers={"User-Agent": "EarthSignal/GCOV-crop-1"}), timeout=30) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise ProcessingError("CATALOG_LIMIT", "ASF exact-ID response exceeded the metadata limit")
        data = json.loads(raw)
        entries = [f["properties"] for f in data.get("features", []) if f.get("properties", {}).get("fileID") == product_id]
        if len(entries) != 1 or len(data.get("features", [])) != 1:
            raise ProcessingError("SOURCE_NOT_FOUND", "ASF did not return one exact product ID")
        source = entries[0]
        validate_url(source.get("url"))
        if source.get("processingLevel") != "GCOV" or source.get("platform") != "NISAR":
            raise ProcessingError("UNSUPPORTED_PRODUCT", "Only real NISAR GCOV acquisitions are supported")
        if not parse.urlsplit(source["url"]).path.lower().endswith(".h5"):
            raise ProcessingError("UNSUPPORTED_PRODUCT", "ASF source must be a GCOV science HDF5 asset")
        return source
    except ProcessingError:
        raise
    except RangeError as exc:
        raise ProcessingError(exc.code, str(exc)) from None
    except (error.URLError, OSError, ValueError, KeyError, TypeError):
        raise ProcessingError("CATALOG_UNAVAILABLE", "Official ASF exact-ID lookup failed") from None


def _time(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.rstrip("Z") + ("+00:00" if value.endswith("Z") else ""))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except (TypeError, ValueError, AttributeError):
        raise ProcessingError("METADATA_INVALID", "Source acquisition time is missing or invalid") from None


def validate_pair(before: dict, after: dict) -> None:
    """Catalog candidate preflight; ancillary HDF5 checks remain mandatory."""
    if not before.get("fileID") or before.get("fileID") == after.get("fileID"):
        raise ProcessingError("SAME_ACQUISITION", "Select two distinct acquisitions")
    if (_time(before.get("startTime")) >= _time(after.get("startTime"))
            or _time(before.get("startTime")).date() == _time(after.get("startTime")).date()):
        raise ProcessingError("CHRONOLOGY", "Before must precede after; duplicate or reversed acquisition times are unsupported")
    for key in ("pathNumber", "frameNumber", "flightDirection", "collectionName"):
        if before.get(key) is None or before.get(key) != after.get(key):
            raise ProcessingError("INCOMPATIBLE_PAIR", f"Both products must have the same known catalog {key}")
    collection = before["collectionName"]
    if not isinstance(collection, str) or not collection.startswith("NISAR_L2_GCOV_PROVISIONAL_"):
        raise ProcessingError("UNSUPPORTED_COLLECTION", "Only matching NISAR GCOV provisional collections are supported")
    if before.get("pgeVersion") != after.get("pgeVersion"):
        raise ProcessingError("INCOMPATIBLE_PAIR", "Catalog processor releases differ")


def _json_value(value):
    import numpy as np
    if isinstance(value, bytes):
        return value.decode("utf-8").rstrip("\x00")
    if isinstance(value, np.ndarray):
        return [_json_value(v) for v in value.tolist()] if value.ndim else _json_value(value.item())
    if isinstance(value, (list, tuple)):
        return [_json_value(v) for v in value]
    if isinstance(value, np.generic):
        return _json_value(value.item())
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    return value


def _small(group, key, *, required=True):
    if key not in group:
        if required:
            raise ProcessingError("METADATA_MISSING", f"Required ancillary metadata {key} is absent")
        return None
    ds = group[key]
    if ds.size > 64 or ds.dtype.itemsize * ds.size > 8192:
        raise ProcessingError("METADATA_LIMIT", "Ancillary metadata is unexpectedly large")
    value = _json_value(ds[()])
    if isinstance(value, str) and (not value or len(value) > 8192 or "NOT SPECIFIED" in value):
        raise ProcessingError("METADATA_INVALID", f"Ancillary metadata {key} is unspecified")
    return value


def _attrs(dataset):
    keys = ("standard_name", "long_name", "description", "units", "_FillValue", "valid_min",
            "valid_max", "grid_mapping", "scale_factor", "add_offset", "flag_values", "flag_meanings",
            "isReceiveOnlyChannel1", "isReceiveOnlyChannel2")
    return {key: _json_value(dataset.attrs[key]) for key in keys if key in dataset.attrs}


def mask_policy(attrs: dict) -> str:
    # Match the documented official mask rather than guessing the meaning of 0.
    if (str(attrs.get("long_name", "")).strip().lower() != "valid samples subswath mask"
            or str(attrs.get("_FillValue")) != "255"
            or attrs.get("flag_values") is not None or attrs.get("flag_meanings") is not None):
        raise ProcessingError("MASK_UNKNOWN", "GCOV mask semantics are absent or unknown; comparison is unavailable")
    return MASK_POLICY


def inspect_metadata(asset: RemoteAsset, catalog: dict) -> dict:
    import h5py
    import numpy as np
    try:
        with RangeFile(asset) as fileobj, h5py.File(fileobj, "r") as h5:
            if IDENTIFICATION not in h5 or GRID_PATH not in h5:
                raise ProcessingError("METADATA_MISSING", "NISAR LSAR GCOV ancillary groups are absent")
            ident, grid = h5[IDENTIFICATION], h5[GRID_PATH]
            names = ("missionId", "productType", "productLevel", "radarBand", "granuleId", "trackNumber",
                "frameNumber", "orbitPassDirection", "lookDirection", "zeroDopplerStartTime", "zeroDopplerEndTime",
                "compositeReleaseId", "productVersion", "productSpecificationVersion", "processingType", "isMixedMode", "listOfObservationModes")
            meta = {key: _small(ident, key) for key in names}
            meta["diagnosticModeFlag"] = _small(ident, "diagnosticModeFlag", required=False)
            if (meta["missionId"] != "NISAR" or meta["productType"] != "GCOV"
                    or meta["productLevel"] != "L2" or meta["radarBand"] != "L"):
                raise ProcessingError("UNSUPPORTED_PRODUCT", "Ancillary metadata does not identify a real NISAR L-band L2 GCOV acquisition")
            if str(meta["isMixedMode"]).lower() not in ("false", "0") or meta["diagnosticModeFlag"] not in (None, 0):
                raise ProcessingError("UNSUPPORTED_MODE", "Mixed or diagnostic radar modes are unsupported")
            if not isinstance(meta["listOfObservationModes"], list) or not meta["listOfObservationModes"]:
                raise ProcessingError("METADATA_INVALID", "Observation mode metadata must be present")
            meta["listOfObservationModes"] = sorted(set(meta["listOfObservationModes"]))
            if len(meta["listOfObservationModes"]) != 1:
                raise ProcessingError("UNSUPPORTED_MODE", "Multiple observation modes are unsupported")
            # The authoritative ID is checked verbatim against sceneName; no
            # scientific field is inferred from the granule's filename.
            if meta["granuleId"] != catalog.get("sceneName"):
                raise ProcessingError("SOURCE_ID_MISMATCH", "HDF5 granule ID differs from the exact ASF catalog record")
            # PR means nominal production, not provisional maturity. Maturity
            # is asserted by ASF's catalog and official archive collection
            # directory; the HDF5 has no collectionName field. Check both and
            # record exactly this evidence without inventing an HDF5 field.
            collection = catalog.get("collectionName")
            archive_parts = parse.unquote(parse.urlsplit(catalog["url"]).path).split("/")
            if (not isinstance(collection, str) or not collection.startswith("NISAR_L2_GCOV_PROVISIONAL_")
                    or collection not in archive_parts or not meta["granuleId"].startswith("NISAR_L2_PR_GCOV_")
                    or meta["processingType"] != "Nominal"):
                raise ProcessingError("UNSUPPORTED_COLLECTION", "Exact ASF provisional archive collection and nominal GCOV identification must agree")
            meta["collectionVerification"] = {
                "collection": collection, "authority": "ASF exact fileID catalog record and official asset archive directory",
                "hdf5Evidence": "Exact granuleId matches ASF sceneName; NISAR L2 PR GCOV identifier agrees with processingType=Nominal and compositeReleaseId",
                "maturitySource": "ASF catalog/archive, not an HDF5 collection field; PR indicates nominal production, not provisional maturity"}
            for field, catalog_field in (("trackNumber", "pathNumber"), ("frameNumber", "frameNumber"),
                                         ("orbitPassDirection", "flightDirection")):
                if str(meta[field]).casefold() != str(catalog.get(catalog_field)).casefold():
                    raise ProcessingError("SOURCE_METADATA_MISMATCH", f"HDF5 {field} disagrees with ASF")
            if abs((_time(meta["zeroDopplerStartTime"]) - _time(catalog["startTime"])).total_seconds()) > 1:
                raise ProcessingError("SOURCE_METADATA_MISMATCH", "HDF5 acquisition time disagrees with ASF")
            if _time(meta["zeroDopplerEndTime"]) <= _time(meta["zeroDopplerStartTime"]):
                raise ProcessingError("METADATA_INVALID", "HDF5 acquisition interval is empty")
            for name in ("HHHH", "mask", "xCoordinates", "yCoordinates", "projection", "xCoordinateSpacing", "yCoordinateSpacing"):
                if name not in grid:
                    raise ProcessingError("METADATA_MISSING", f"Required Frequency A dataset {name} is absent")
            power, mask = grid["HHHH"], grid["mask"]
            meta["powerAttributes"], meta["maskAttributes"] = _attrs(power), _attrs(mask)
            attrs = meta["powerAttributes"]
            for key in ("isReceiveOnlyChannel1", "isReceiveOnlyChannel2"):
                if key in attrs and str(attrs[key]).casefold() not in ("false", "0"):
                    raise ProcessingError("UNSUPPORTED_MODE", "HHHH receive-only or unknown channel flags cannot represent supported backscatter")
            meta["exceptionMaskPresent"] = "inputDataExceptionMask" in grid
            schema = meta["productSpecificationVersion"]
            if schema not in ("1.5.0", "1.6.0"):
                raise ProcessingError("MASK_UNKNOWN", "Only verified GCOV mask schemas 1.5.0 and 1.6.0 are supported")
            if not meta["exceptionMaskPresent"]:
                raise ProcessingError("METADATA_MISSING", "Supported GCOV schemas require the documented input data exception mask")
            if meta["exceptionMaskPresent"]:
                exceptions = grid["inputDataExceptionMask"]
                ea = _attrs(exceptions)
                dtype = np.dtype("uint8" if schema == "1.5.0" else "uint16")
                fill_valid = ea.get("_FillValue") is None if schema == "1.5.0" else str(ea.get("_FillValue")) == "65535"
                if (exceptions.dtype != dtype or not fill_valid
                        or exceptions.shape != power.shape
                        or ea.get("valid_min") != 0 or ea.get("grid_mapping") != "projection"
                        or ea.get("flag_values") is not None or ea.get("flag_meanings") is not None):
                    raise ProcessingError("MASK_UNKNOWN", "Unsupported input data exception mask definition")
                meta["exceptionMaskAttributes"] = ea
            radiometry = " ".join(str(attrs.get(k, "")).lower() for k in ("standard_name", "long_name", "description"))
            gamma0_explicit = "gamma0" in radiometry.replace("_", "").replace(" ", "")
            # Current product XML labels covariance HHHH without gamma0 in
            # its name. ASF defines production GCOV as linear gamma0. Verify
            # that known covariance schema, RTC applied flag and gamma-to-sigma
            # ancillary factor instead of demanding an attribute it lacks.
            if not gamma0_explicit:
                parameters_path = "/science/LSAR/GCOV/metadata/processingInformation/parameters"
                if parameters_path not in h5:
                    raise ProcessingError("RADIOMETRY_UNKNOWN", "Gamma0 radiometry cannot be verified from ancillary metadata")
                applied = _small(h5[parameters_path], "radiometricTerrainCorrectionApplied")
                factor = grid.get("rtcGammaToSigmaFactor")
                factor_attrs = _attrs(factor) if factor is not None else {}
                gamma0_explicit = (attrs.get("long_name") == "Geocoded polarimetric covariance term HHHH"
                    and str(applied).casefold() in ("true", "1") and factor is not None
                    and factor.shape == power.shape and factor_attrs.get("units") == "1"
                    and "gamma0 to sigma0" in str(factor_attrs.get("long_name", "")).casefold())
                meta["radiometricTerrainCorrectionApplied"] = applied
                meta["rtcGammaToSigmaFactorAttributes"] = factor_attrs
            if (not gamma0_explicit or "sigma0" in radiometry or "beta0" in radiometry or "decibel" in radiometry
                    or attrs.get("units") != "1" or power.dtype.kind != "f" or power.ndim != 2
                    or attrs.get("scale_factor", 1) != 1 or attrs.get("add_offset", 0) != 0):
                raise ProcessingError("RADIOMETRY_UNKNOWN", "HHHH must explicitly identify unscaled linear gamma0 power")
            if any(str(attrs.get(key, "False")).casefold() not in ("false", "0")
                   for key in ("isReceiveOnlyChannel1", "isReceiveOnlyChannel2")):
                raise ProcessingError("UNSUPPORTED_MODE", "Receive-only covariance channels are not science backscatter")
            mask_policy(meta["maskAttributes"])
            if mask.dtype != np.dtype("uint8") or mask.shape != power.shape:
                raise ProcessingError("MASK_GRID", "GCOV mask must be uint8 on the exact power grid")
            if attrs.get("grid_mapping") != "projection" or meta["maskAttributes"].get("grid_mapping") != "projection":
                raise ProcessingError("GRID_METADATA", "Power and mask must share the explicit projection mapping")
            meta["shape"] = list(power.shape)
            for name in ("xCoordinates", "yCoordinates"):
                axis = grid[name]
                expected = power.shape[1 if name == "xCoordinates" else 0]
                if axis.ndim != 1 or axis.size != expected:
                    raise ProcessingError("GRID_METADATA", "Grid coordinate axes do not match the power raster")
                # No whole-axis/full-image read. Verify endpoint, middle and
                # local spacing against the declared regular coordinate grid.
                indices = sorted(set([0, min(1, axis.size-1), axis.size // 2, axis.size - 1]))
                meta[name] = {str(i): float(axis[i]) for i in indices}
            meta["epsg"] = int(_small(grid, "projection"))
            meta["xSpacing"] = float(_small(grid, "xCoordinateSpacing"))
            meta["ySpacing"] = float(_small(grid, "yCoordinateSpacing"))
            for name, spacing in (("xCoordinates", meta["xSpacing"]), ("yCoordinates", meta["ySpacing"])):
                axis = meta[name]
                if not math.isfinite(spacing) or spacing == 0:
                    raise ProcessingError("GRID_METADATA", "Invalid coordinate spacing")
                for i, value in axis.items():
                    if not math.isfinite(value) or not math.isclose(value, axis["0"] + int(i) * spacing, abs_tol=1e-6, rel_tol=0):
                        raise ProcessingError("GRID_METADATA", "Grid coordinate axis is not regular")
            if meta["xSpacing"] <= 0 or meta["ySpacing"] >= 0:
                raise ProcessingError("GRID_METADATA", "Only native north-up east-positive grids are supported")
            # Mode includes both A/B available polarization and actual source
            # bandwidth, rather than opaque filename mode codes.
            source_swaths = "/science/LSAR/GCOV/metadata/sourceData/swaths"
            meta["frequencyModes"] = {}
            for frequency in ("A", "B"):
                frequency_path = f"/science/LSAR/GCOV/grids/frequency{frequency}"
                if frequency_path in h5:
                    swath_path = f"{source_swaths}/frequency{frequency}"
                    if swath_path not in h5:
                        raise ProcessingError("METADATA_MISSING", "Source bandwidth ancillary metadata is absent")
                    meta["frequencyModes"][frequency] = {
                        "polarizations": sorted(_small(h5[frequency_path], "listOfPolarizations")),
                        "processedRangeBandwidth": _small(h5[swath_path], "processedRangeBandwidth"),
                        "acquiredRangeBandwidth": _small(h5[swath_path], "acquiredRangeBandwidth"),
                    }
                    mode = meta["frequencyModes"][frequency]
                    if (any(not isinstance(pol, str) or len(pol) != 2 for pol in mode["polarizations"])
                            or any(type(mode[key]) not in (int, float) or not math.isfinite(mode[key]) or mode[key] <= 0
                                   for key in ("processedRangeBandwidth", "acquiredRangeBandwidth"))):
                        raise ProcessingError("METADATA_INVALID", "Source polarization or bandwidth metadata is invalid")
            if "HH" not in meta["frequencyModes"]["A"]["polarizations"]:
                raise ProcessingError("SOURCE_METADATA_MISMATCH", "Frequency A metadata does not identify an HH science channel")
            return meta
    except (ProcessingError, RangeError):
        raise
    except (OSError, ValueError, KeyError, TypeError):
        if asset.error:
            raise asset.error
        raise ProcessingError("HDF5_METADATA", "Unable to inspect bounded HDF5 ancillary metadata") from None


def validate_metadata_pair(before: dict, after: dict):
    for field in ("trackNumber", "frameNumber", "orbitPassDirection", "lookDirection", "compositeReleaseId",
                  "productVersion", "productSpecificationVersion", "processingType", "listOfObservationModes", "frequencyModes"):
        if before.get(field) is None or before.get(field) != after.get(field):
            raise ProcessingError("INCOMPATIBLE_PAIR", f"Native ancillary metadata {field} must match")
    if (before["granuleId"] == after["granuleId"] or _time(before["zeroDopplerStartTime"]) >= _time(after["zeroDopplerStartTime"])
            or _time(before["zeroDopplerStartTime"]).date() == _time(after["zeroDopplerStartTime"]).date()):
        raise ProcessingError("CHRONOLOGY", "Native acquisition IDs and times must be distinct and chronological")


def aligned_offset(first: tuple, second: tuple) -> tuple[int, int]:
    if not all(math.isfinite(v) for v in (*first, *second)):
        raise ProcessingError("GRID_MISMATCH", "Raster transforms must be finite")
    if any(abs(v) > 1e-12 for v in (first[2], first[4], second[2], second[4])) or first[1] <= 0 or first[5] >= 0:
        raise ProcessingError("GRID_MISMATCH", "Only north-up native grids are supported")
    if not math.isclose(first[1], second[1], abs_tol=1e-9, rel_tol=0) or not math.isclose(first[5], second[5], abs_tol=1e-9, rel_tol=0):
        raise ProcessingError("GRID_MISMATCH", "Native pixel resolutions differ; scientific resampling is disabled")
    offsets = ((second[0] - first[0]) / first[1], (second[3] - first[3]) / first[5])
    if any(abs(v - round(v)) > 1e-7 for v in offsets):
        raise ProcessingError("GRID_MISMATCH", "Native grid origins are not integer-pixel aligned")
    return tuple(round(v) for v in offsets)


def _srs(code_or_wkt):
    from osgeo import osr
    srs = osr.SpatialReference()
    if srs.SetFromUserInput(str(code_or_wkt)) != 0:
        raise ProcessingError("GRID_CRS", "Invalid source coordinate reference system")
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return srs


def _check_grid(dataset, meta):
    from osgeo import osr
    transform = tuple(dataset.GetGeoTransform())
    expected = (meta["xCoordinates"]["0"] - meta["xSpacing"]/2, meta["xSpacing"], 0,
                meta["yCoordinates"]["0"] - meta["ySpacing"]/2, 0, meta["ySpacing"])
    if (dataset.RasterCount != 1 or [dataset.RasterYSize, dataset.RasterXSize] != meta["shape"]
            or any(not math.isclose(a, b, abs_tol=1e-6, rel_tol=0) for a, b in zip(transform, expected))):
        raise ProcessingError("GRID_METADATA", "NETCDF raster grid disagrees with native HDF5 coordinate metadata")
    crs = _srs(dataset.GetProjectionRef())
    if not crs.IsSame(_srs(f"EPSG:{meta['epsg']}")) or not crs.IsProjected() or not math.isclose(crs.GetLinearUnits(), 1.0):
        raise ProcessingError("GRID_CRS", "Native projected grid in meters must match HDF5 EPSG metadata")
    return transform, crs


def crop_windows(first, second, first_size, second_size, native_bounds, *, max_pixels=MAX_PIXELS):
    """Intersect a bbox envelope and two integer-aligned grids, no resampling."""
    if type(max_pixels) is not int or not 0 < max_pixels <= MAX_PIXELS:
        raise ProcessingError("PIXEL_LIMIT", "Configured pixel cap must be within one million native pixels")
    dx, dy = aligned_offset(first, second)
    xmin, ymin, xmax, ymax = native_bounds
    x0 = max(0, dx, math.floor((xmin - first[0]) / first[1]))
    x1 = min(first_size[0], dx + second_size[0], math.ceil((xmax - first[0]) / first[1]))
    y0 = max(0, dy, math.floor((ymax - first[3]) / first[5]))
    y1 = min(first_size[1], dy + second_size[1], math.ceil((ymin - first[3]) / first[5]))
    if x1 <= x0 or y1 <= y0:
        raise ProcessingError("NO_OVERLAP", "Requested crop has no common native-grid overlap")
    width, height = x1 - x0, y1 - y0
    if width * height > max_pixels:
        raise ProcessingError("PIXEL_LIMIT", "The common crop exceeds one million native pixels; reduce the bbox")
    transform = (first[0]+x0*first[1], first[1], 0, first[3]+y0*first[5], 0, first[5])
    return (x0, y0, width, height), (x0-dx, y0-dy, width, height), transform


def compare_arrays(before, after, before_mask, after_mask, *, before_fill=None, after_fill=None, aoi=None, before_exception=None, after_exception=None):
    import numpy as np
    arrays = [np.asarray(a) for a in (before, after, before_mask, after_mask)]
    if arrays[0].ndim != 2 or any(a.shape != arrays[0].shape for a in arrays):
        raise ProcessingError("MASK_GRID", "Power and validity arrays must share an exact crop grid")
    if arrays[0].size > MAX_PIXELS:
        raise ProcessingError("PIXEL_LIMIT", "Crop exceeds one million native pixels")
    b, a, bm, am = arrays
    if bm.dtype != np.uint8 or am.dtype != np.uint8:
        raise ProcessingError("MASK_UNKNOWN", "GCOV subswath masks must be uint8")
    bv = np.isfinite(b) & (b > 0) & (bm > 0) & (bm != 255)
    av = np.isfinite(a) & (a > 0) & (am > 0) & (am != 255)
    for valid, exceptions in ((bv, before_exception), (av, after_exception)):
        if exceptions is not None:
            exceptions = np.asarray(exceptions)
            if exceptions.dtype not in (np.dtype("uint8"), np.dtype("uint16")) or exceptions.shape != b.shape:
                raise ProcessingError("MASK_GRID", "Input data exception mask must have a verified unsigned type on the native crop grid")
            if exceptions.dtype == np.uint8:
                # Producer schema1.5: anomaly-only byte, no focus bits or fill.
                if np.any((exceptions != 0) & (exceptions != 2)):
                    raise ProcessingError("MASK_UNKNOWN", "Unsupported schema1.5 input data exception code")
                valid &= exceptions == 0
                continue
            codes = exceptions[exceptions != 65535] & 255
            if np.any((codes != 0) & (codes != 2)):
                raise ProcessingError("MASK_UNKNOWN", "Unsupported input data exception code")
            # Producer schema1.6: HH fully-focused bit256, sample-slip code2;
            # other high bits describe other channels and do not substitute HH.
            valid &= (exceptions != 65535) & ((exceptions & 256) != 0) & ((exceptions & 255) == 0)
    for valid, power, fill in ((bv, b, before_fill), (av, a, after_fill)):
        if fill is not None:
            try:
                valid &= power != float(fill)
            except (TypeError, ValueError):
                raise ProcessingError("RADIOMETRY_UNKNOWN", "Unknown power fill value") from None
        if aoi is not None:
            if aoi.shape != power.shape:
                raise ProcessingError("MASK_GRID", "AOI and crop grids differ")
            valid &= aoi
    common = bv & av
    if not common.any():
        raise ProcessingError("NO_VALID_PIXELS", "Crop has no common positive finite valid gamma0 pixels")
    difference = np.full(b.shape, np.nan, dtype=np.float64)
    # Algebraically identical to 10log10(after/before), without ratio overflow.
    difference[common] = 10 * (np.log10(a[common].astype(np.float64)) - np.log10(b[common].astype(np.float64)))
    values = difference[common]
    q05, median, q95 = np.percentile(values, [5, 50, 95])
    stats = {"medianDb": float(median), "p05Db": float(q05), "p95Db": float(q95),
             "minDb": float(values.min()), "maxDb": float(values.max())}
    coverage = {"totalPixels": int(b.size), "beforeValidPixels": int(bv.sum()), "afterValidPixels": int(av.sum()),
                "commonValidPixels": int(common.sum()), "commonValidPercent": float(100 * common.sum() / b.size)}
    return difference, bv, av, common, stats, coverage


def _roi_mask(transform, shape, crs, bbox):
    import numpy as np
    from osgeo import osr
    rows, cols = shape
    convert = osr.CoordinateTransformation(crs, _srs("EPSG:4326"))
    result = np.zeros(shape, dtype=bool)
    for row0 in range(0, rows, max(1, 65536 // cols)):
        row1 = min(rows, row0 + max(1, 65536 // cols))
        yy, xx = np.indices((row1-row0, cols))
        points = np.column_stack((transform[0]+(xx.ravel()+.5)*transform[1], transform[3]+(yy.ravel()+row0+.5)*transform[5]))
        ll = np.asarray(convert.TransformPoints(points.tolist()))
        valid = (np.isfinite(ll[:, 0]) & np.isfinite(ll[:, 1]) & (ll[:, 0] >= bbox[0])
                 & (ll[:, 0] <= bbox[2]) & (ll[:, 1] >= bbox[1]) & (ll[:, 1] <= bbox[3]))
        result[row0:row1] = valid.reshape((row1-row0, cols))
    return result


@contextmanager
def _gdal_options():
    from osgeo import gdal
    # Thread-local options are scoped and restored. netCDF must actually use
    # virtual IO to reach the bounded proxy; no copying to a temporary granule.
    settings = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "GDAL_PAM_ENABLED": "NO",
        "GDAL_HTTP_MULTIRANGE": "NO", "GDAL_HTTP_MAX_RETRY": "0", "CPL_VSIL_CURL_USE_HEAD": "YES",
        "CPL_VSIL_CURL_CHUNK_SIZE": "65536", "GDAL_NETCDF_BOTTOMUP": "NO",
        "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".h5", "GDAL_HTTP_PROXY": "", "GDAL_HTTP_NETRC": "NO"}
    old = {key: gdal.GetThreadLocalConfigOption(key) for key in settings}
    for key, value in settings.items():
        gdal.SetThreadLocalConfigOption(key, value)
    try:
        yield
    finally:
        for key, value in old.items():
            gdal.SetThreadLocalConfigOption(key, value)


def _open_raster(vsi, name):
    from osgeo import gdal
    ds = gdal.OpenEx(f'NETCDF:"{vsi}":{GRID_PATH}/{name}', gdal.OF_RASTER | gdal.OF_READONLY, allowed_drivers=["netCDF"])
    if ds is None:
        raise ProcessingError("GDAL_READ", "NETCDF driver could not open the bounded Frequency A dataset")
    return ds


def _write_tif(path, data, transform, crs, *, byte=False, description=""):
    import numpy as np
    from osgeo import gdal
    rows, cols = data.shape
    ds = gdal.GetDriverByName("GTiff").Create(str(path), cols, rows, 1, gdal.GDT_Byte if byte else gdal.GDT_Float32,
        options=["COMPRESS=DEFLATE", "TILED=YES", "BIGTIFF=IF_SAFER"])
    if ds is None:
        raise ProcessingError("OUTPUT_WRITE", "Could not create native GeoTIFF")
    ds.SetGeoTransform(transform)
    ds.SetProjection(crs.ExportToWkt())
    ds.SetMetadataItem("ALGORITHM_VERSION", ALGORITHM_VERSION)
    band = ds.GetRasterBand(1)
    band.SetDescription(description)
    if not byte:
        band.SetNoDataValue(float("nan"))
    band.WriteArray(data.astype(np.uint8 if byte else np.float32))
    ds.FlushCache()
    ds = None


def _preview_rgba(values, valid, minimum, maximum, *, diverging=False, excluded=False):
    import numpy as np
    rgba = np.zeros((*values.shape, 4), dtype=np.uint8)
    if excluded:
        rgba[~valid] = [245, 158, 11, 185]
        return rgba
    if diverging:
        strength = np.clip(np.abs(np.nan_to_num(values)) / maximum, 0, 1)
        # Zero is pale neutral; gains red, losses blue; common-valid only.
        rgb = np.empty((*values.shape, 3))
        rgb[..., 0] = np.where(values >= 0, 245, 245 - 208 * strength)
        rgb[..., 1] = 245 - 171 * strength
        rgb[..., 2] = np.where(values < 0, 245, 245 - 182 * strength)
        rgba[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    else:
        grey = (np.clip((np.nan_to_num(values, nan=minimum)-minimum)/(maximum-minimum), 0, 1)*255).astype(np.uint8)
        rgba[..., :3] = grey[..., None]
    rgba[..., 3] = np.where(valid, 255, 0)
    return rgba


def _write_previews(output_dir, arrays, transform, crs):
    import numpy as np
    from PIL import Image
    from osgeo import gdal, osr
    rows, cols, _ = arrays["before"].shape
    mercator = _srs("EPSG:3857")
    convert = osr.CoordinateTransformation(crs, mercator)
    native_bounds = (transform[0], transform[3]+rows*transform[5], transform[0]+cols*transform[1], transform[3])
    bounds = convert.TransformBounds(*native_bounds, 21)
    if not all(math.isfinite(v) for v in bounds) or bounds[2] <= bounds[0] or bounds[3] <= bounds[1]:
        raise ProcessingError("DISPLAY_BOUNDS", "Crop cannot be displayed in Web Mercator")
    aspect = (bounds[2]-bounds[0])/(bounds[3]-bounds[1])
    width, height = (1024, max(1, round(1024/aspect))) if aspect >= 1 else (max(1, round(1024*aspect)), 1024)
    for name, rgba in arrays.items():
        src = gdal.GetDriverByName("MEM").Create("", cols, rows, 4, gdal.GDT_Byte)
        src.SetGeoTransform(transform)
        src.SetProjection(crs.ExportToWkt())
        for band_index, interp in enumerate((gdal.GCI_RedBand, gdal.GCI_GreenBand, gdal.GCI_BlueBand, gdal.GCI_AlphaBand), 1):
            band = src.GetRasterBand(band_index)
            band.SetColorInterpretation(interp)
            band.WriteArray(rgba[:, :, band_index-1])
        dst = gdal.Warp("", src, format="MEM", dstSRS="EPSG:3857", outputBounds=bounds,
                        width=width, height=height, resampleAlg="near", srcAlpha=True, dstAlpha=True)
        if dst is None:
            raise ProcessingError("DISPLAY_WRITE", "Could not reproject display-only PNG")
        pixels = np.moveaxis(dst.ReadAsArray(), 0, -1)
        Image.fromarray(pixels.astype(np.uint8), "RGBA").save(output_dir / f"{name}.png")
        src = dst = None
    ll = osr.CoordinateTransformation(mercator, _srs("EPSG:4326"))
    southwest, northeast = ll.TransformPoint(bounds[0], bounds[1]), ll.TransformPoint(bounds[2], bounds[3])
    return [[southwest[1], southwest[0]], [northeast[1], northeast[0]]]


def _input_hash(power, mask, meta, window, exceptions=None):
    import numpy as np
    digest = hashlib.sha256()
    digest.update(json.dumps({"scope": "native crop power float64 + mask uint8 + optional exception mask uint16 + ancillary metadata + crop window", "meta": meta, "window": window}, sort_keys=True, allow_nan=False).encode())
    digest.update(np.asarray(power, dtype="<f8").tobytes(order="C"))
    digest.update(np.asarray(mask, dtype="u1").tobytes(order="C"))
    if exceptions is not None:
        digest.update(b"inputDataExceptionMask:uint16le\0")
        digest.update(np.asarray(exceptions, dtype="<u2").tobytes(order="C"))
    return digest.hexdigest()


def _validate_request(value):
    if set(value) != {"beforeId", "afterId", "bbox"}:
        raise ProcessingError("INVALID_REQUEST", "Request must contain only beforeId, afterId and bbox")
    for name in ("beforeId", "afterId"):
        if not isinstance(value[name], str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,220}", value[name]):
            raise ProcessingError("INVALID_ID", "An exact ASF product ID is required")
    bbox = value["bbox"]
    if (not isinstance(bbox, (tuple, list)) or len(bbox) != 4
            or any(type(v) not in (int, float) or not math.isfinite(v) for v in bbox)
            or not -180 <= bbox[0] < bbox[2] <= 180 or not -85 <= bbox[1] < bbox[3] <= 85):
        raise ProcessingError("INVALID_BBOX", "Crop must be nonempty, within ±85° latitude and not cross the antimeridian")
    if value["beforeId"] == value["afterId"]:
        raise ProcessingError("SAME_ACQUISITION", "Select two distinct acquisitions")


def process_job(request: dict, output_dir: Path, netrc_path: Path, progress=None,
                *, max_pixels=MAX_PIXELS, max_transfer_bytes=512*1024*1024) -> dict:
    import numpy as np
    from osgeo import gdal, osr
    _validate_request(request)
    if type(max_pixels) is not int or not 0 < max_pixels <= MAX_PIXELS:
        raise ProcessingError("PIXEL_LIMIT", "Configured pixel cap must be within one million native pixels")
    ready, message = capability(netrc_path)
    if not ready:
        raise ProcessingError("CAPABILITY_UNAVAILABLE", message)
    def phase(name):
        if progress:
            progress(name)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    phase("catalog")
    before, after = lookup_source(request["beforeId"]), lookup_source(request["afterId"])
    validate_pair(before, after)
    budget = TransferBudget(max_transfer_bytes)
    try:
        opener = authenticated_opener(Path(netrc_path))
        assets = [RemoteAsset(source["url"], opener, budget) for source in (before, after)]
        phase("metadata")
        metadata = [inspect_metadata(asset, source) for asset, source in zip(assets, (before, after))]
        validate_metadata_pair(*metadata)
        phase("crop")
        with RangeProxy(assets) as proxy, _gdal_options():
            datasets = []
            try:
                for index in range(2):
                    names = ["HHHH", "mask"] + (["inputDataExceptionMask"] if metadata[index]["exceptionMaskPresent"] else [])
                    datasets.append(tuple(_open_raster(proxy.vsi_path(index), name) for name in names))
                proxy.check()
                grids = [_check_grid(pair[0], meta) for pair, meta in zip(datasets, metadata)]
                for pair, meta, (gt, crs) in zip(datasets, metadata, grids):
                    for quality in pair[1:]:
                        mask_gt, mask_crs = _check_grid(quality, meta)
                        if mask_gt != gt or not mask_crs.IsSame(crs):
                            raise ProcessingError("MASK_GRID", "Power and quality mask native raster grids differ")
                if not grids[0][1].IsSame(grids[1][1]):
                    raise ProcessingError("GRID_MISMATCH", "Native coordinate reference systems differ; scientific reprojection is disabled")
                crs = grids[0][1]
                convert = osr.CoordinateTransformation(_srs("EPSG:4326"), crs)
                bounds = convert.TransformBounds(*request["bbox"], 21)
                if not all(math.isfinite(v) for v in bounds):
                    raise ProcessingError("INVALID_BBOX", "Crop cannot be transformed to the native grid")
                bw, aw, transform = crop_windows(grids[0][0], grids[1][0],
                    (datasets[0][0].RasterXSize, datasets[0][0].RasterYSize),
                    (datasets[1][0].RasterXSize, datasets[1][0].RasterYSize), bounds, max_pixels=max_pixels)
                powers, masks, exceptions = [], [], []
                for pair, window in zip(datasets, (bw, aw)):
                    powers.append(pair[0].GetRasterBand(1).ReadAsArray(*window))
                    masks.append(pair[1].GetRasterBand(1).ReadAsArray(*window))
                    exceptions.append(pair[2].GetRasterBand(1).ReadAsArray(*window) if len(pair) == 3 else None)
                    if len(pair) == 3 and exceptions[-1] is None:
                        raise ProcessingError("GDAL_READ", "Exception mask crop read failed")
                proxy.check()
                if any(a is None for a in (*powers, *masks)):
                    raise ProcessingError("GDAL_READ", "Bounded native crop read failed")
            finally:
                datasets.clear()  # close datasets before stopping proxy
        phase("difference")
        roi = _roi_mask(transform, powers[0].shape, crs, request["bbox"])
        diff, bv, av, common, stats, coverage = compare_arrays(*powers, *masks,
            before_fill=metadata[0]["powerAttributes"].get("_FillValue"),
            after_fill=metadata[1]["powerAttributes"].get("_FillValue"), aoi=roi, before_exception=exceptions[0], after_exception=exceptions[1])
        coverage["validAreaKm2"] = float(common.sum()*abs(transform[1]*transform[5])/1e6)
        phase("artifacts")
        _write_tif(output_dir / "before.tif", np.where(bv, powers[0], np.nan), transform, crs, description="Frequency A HHHH linear gamma0 before")
        _write_tif(output_dir / "after.tif", np.where(av, powers[1], np.nan), transform, crs, description="Frequency A HHHH linear gamma0 after")
        _write_tif(output_dir / "difference.tif", diff, transform, crs, description="10 log10(after / before) dB; common-valid native pixels")
        _write_tif(output_dir / "validity.tif", common.astype(np.uint8), transform, crs, byte=True, description="1=common-valid; 0=excluded")
        bdb, adb = np.full(diff.shape, np.nan), np.full(diff.shape, np.nan)
        bdb[bv], adb[av] = 10*np.log10(powers[0][bv].astype(np.float64)), 10*np.log10(powers[1][av].astype(np.float64))
        minimum, maximum = map(float, np.percentile(np.concatenate((bdb[bv], adb[av])), [2, 98]))
        if maximum <= minimum:
            minimum, maximum = minimum-1, maximum+1
        limit = max(1.0, float(np.percentile(np.abs(diff[common]), 98)))
        image_bounds = _write_previews(output_dir, {
            "before": _preview_rgba(bdb, bv, minimum, maximum), "after": _preview_rgba(adb, av, minimum, maximum),
            "difference": _preview_rgba(diff, common, -limit, limit, diverging=True),
            "excluded": _preview_rgba(diff, common, 0, 1, excluded=True)}, transform, crs)
        sources = []
        for source, meta in zip((before, after), metadata):
            sources.append({"id": source["fileID"], "acquiredAt": _time(meta["zeroDopplerStartTime"]).isoformat().replace("+00:00", "Z"),
                "track": int(meta["trackNumber"]), "frame": int(meta["frameNumber"]), "direction": meta["orbitPassDirection"],
                "mode": meta["listOfObservationModes"][0], "release": meta["compositeReleaseId"],
                "collection": source["collectionName"], "url": source["url"]})
        artifact_names = ["before.tif", "after.tif", "difference.tif", "validity.tif", "before.png", "after.png", "difference.png", "excluded.png", "manifest.json"]
        hashes = {name: hashlib.sha256((output_dir/name).read_bytes()).hexdigest() for name in artifact_names if name != "manifest.json"}
        result = {"schemaVersion": "1.0", "kind": "radar-change", "title": "NISAR HH backscatter difference",
            "before": sources[0], "after": sources[1],
            "crop": {"bbox": request["bbox"], "crs": f"EPSG:{metadata[0]['epsg']}", "resolution": [transform[1], abs(transform[5])],
                "width": int(diff.shape[1]), "height": int(diff.shape[0]), "transform": list(transform), "imageBounds": image_bounds},
            "stats": stats, "coverage": coverage, "layers": {name: f"{name}.png" for name in ("before", "after", "difference", "excluded")},
            "artifacts": artifact_names,
            "display": {"backscatterMinDb": minimum, "backscatterMaxDb": maximum, "differenceLimitDb": limit},
            "processing": {"algorithmVersion": ALGORITHM_VERSION, "method": "10*log10(after gamma0 / before gamma0); common valid native pixels; no scientific resampling",
                "processedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "beforeSha256": _input_hash(powers[0], masks[0], metadata[0], bw, exceptions[0]),
                "afterSha256": _input_hash(powers[1], masks[1], metadata[1], aw, exceptions[1]), "maskPolicy": MASK_POLICY + "; schema1.5 exception byte: retain code0, exclude sample-slip2; schema1.6: require fully-focused HH bit256, no low-byte anomaly and exclude fill65535; require the versioned map and reject unknown definitions/codes",
                "sourceMetadata": {"before": metadata[0], "after": metadata[1], "maskSpecification": MASK_SOURCES[metadata[0]["productSpecificationVersion"]],
                    "hashScope": "Native crop power float64 + subswath mask uint8 + exception mask canonical uint16 + inspected ancillary metadata + crop window; not a full-granule checksum",
                    "artifactSha256": hashes, "transferBytes": budget.transferred, "transferLimitBytes": budget.limit,
                    "rangeIo": {"schemaVersion": "1.0", "cachePolicy": "contained-range-lru-v1",
                        "assets": [asset.telemetry_snapshot() for asset in assets]},
                    "gdalVersion": gdal.VersionInfo("RELEASE_NAME"), "displayCrs": "EPSG:3857", "displayResampling": "nearest; display-only"}},
            "notice": "Backscatter difference from provisional radar data. Speckle, soil moisture, vegetation, surface roughness and acquisition conditions can alter backscatter; this measurement does not establish flooding or damage. Native valid-pixel statistics; Web Mercator PNGs are display-only."}
        (output_dir / "manifest.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
        phase("complete")
        return result
    except RangeError as exc:
        raise ProcessingError(exc.code, str(exc)) from None
    except ProcessingError:
        raise
    except RuntimeError:
        for asset in locals().get("assets", []):
            if asset.error:
                raise ProcessingError(asset.error.code, str(asset.error)) from None
        raise ProcessingError("GDAL_READ", "Native GDAL processing failed; no prepared result was produced") from None
