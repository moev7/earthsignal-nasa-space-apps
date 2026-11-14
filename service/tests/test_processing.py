"""Analytical native science and bounded transport tests; no Earthdata secrets."""
import io
import json
import tempfile
import unittest
from email.message import Message
from pathlib import Path
from unittest.mock import patch
from urllib import request, error

import h5py
import numpy as np

from service.processing import (GRID_PATH, IDENTIFICATION, MAX_PIXELS, ProcessingError,
    aligned_offset, capability, compare_arrays, crop_windows, inspect_metadata,
    lookup_source, mask_policy, validate_metadata_pair, validate_pair)
from service.range_reader import (MAX_RANGE_BYTES, MAX_TRANSFER_BYTES, RangeError,
    RangeFile, RangeProxy, RemoteAsset, SafeRedirect, TransferBudget, validate_url)

URL = "https://nisar.asf.earthdatacloud.nasa.gov/NISAR/NISAR_L2_GCOV_PROVISIONAL_V1/test.h5"


class Response(io.BytesIO):
    def __init__(self, payload, start=0, total=None, status=206, url=URL, headers=None):
        super().__init__(payload)
        self.status, self.url = status, url
        self.headers = Message()
        self.headers["Content-Range"] = f"bytes {start}-{start+len(payload)-1}/{total or len(payload)}"
        self.headers["Content-Length"] = str(len(payload))
        self.headers["ETag"] = '"test"'
        for key, value in (headers or {}).items():
            if key in self.headers:
                del self.headers[key]
            self.headers[key] = value

    def geturl(self):
        return self.url


class MemoryOpener:
    def __init__(self, data):
        self.data, self.calls = data, []

    def open(self, req, timeout=30):
        self.calls.append(req)
        start, end = map(int, req.headers["Range"].removeprefix("bytes=").split("-"))
        return Response(self.data[start:end+1], start, len(self.data))


def catalog(product_id="NISAR_L2_PR_GCOV_before", date="2026-09-01T00:00:00Z"):
    return {"fileID": product_id, "sceneName": product_id, "startTime": date,
        "pathNumber": 1, "frameNumber": 2, "flightDirection": "Ascending",
        "collectionName": "NISAR_L2_GCOV_PROVISIONAL_V1", "pgeVersion": "R05.00",
        "url": URL, "processingLevel": "GCOV", "platform": "NISAR"}


def hdf_fixture(source=None, overrides=None, attrs=None, production_radiometry=False, exception_attrs=None, include_exceptions=True):
    """A synthetic ancillary contract fixture, explicitly not a real product."""
    source = source or catalog()
    stream = io.BytesIO()
    with h5py.File(stream, "w") as f:
        ident = f.require_group(IDENTIFICATION)
        values = {"missionId": "NISAR", "productType": "GCOV", "productLevel": "L2", "radarBand": "L",
            "granuleId": source["sceneName"], "trackNumber": 1, "frameNumber": 2,
            "orbitPassDirection": "Ascending", "lookDirection": "Left",
            "zeroDopplerStartTime": source["startTime"], "zeroDopplerEndTime": source["startTime"].replace("00:00:00", "00:00:30"),
            "compositeReleaseId": "X05001", "productVersion": "0.1.0", "productSpecificationVersion": "1.6.0",
            "processingType": "Nominal", "isMixedMode": "False", "listOfObservationModes": ["science"], "diagnosticModeFlag": 0}
        values.update(overrides or {})
        for name, value in values.items():
            ident[name] = value
        grid = f.require_group(GRID_PATH)
        power = grid.create_dataset("HHHH", data=np.ones((3, 4), dtype=np.float32))
        power.attrs.update({"standard_name": "radar_backscatter_gamma0", "units": "1", "grid_mapping": "projection", "_FillValue": np.nan})
        power.attrs.update(attrs or {})
        if production_radiometry:
            del power.attrs["standard_name"]
            power.attrs["long_name"] = "Geocoded polarimetric covariance term HHHH"
            factor = grid.create_dataset("rtcGammaToSigmaFactor", data=np.ones((3, 4), dtype=np.float32))
            factor.attrs.update({"long_name": "Radiometric terrain correction area normalization factor gamma0 to sigma0", "units": "1"})
            parameters = f.require_group("/science/LSAR/GCOV/metadata/processingInformation/parameters")
            parameters["radiometricTerrainCorrectionApplied"] = "True"
        mask = grid.create_dataset("mask", data=np.ones((3, 4), dtype=np.uint8))
        mask.attrs.update({"long_name": "Valid samples subswath mask", "_FillValue": np.uint8(255), "grid_mapping": "projection"})
        if include_exceptions:
            legacy = values["productSpecificationVersion"] == "1.5.0"
            exceptions = grid.create_dataset("inputDataExceptionMask", data=np.full((3,4),0 if legacy else 256,dtype=np.uint8 if legacy else np.uint16))
            exceptions.attrs.update({"valid_min":0,"grid_mapping":"projection"})
            if not legacy:
                exceptions.attrs["_FillValue"] = np.uint16(65535)
            exceptions.attrs.update(exception_attrs or {})
        for key, value in {"xCoordinates": [100., 110., 120., 130.], "yCoordinates": [1000., 990., 980.],
                           "xCoordinateSpacing": 10., "yCoordinateSpacing": -10., "projection": 32638,
                           "listOfPolarizations": ["HH"]}.items():
            grid[key] = value
        swath = f.require_group("/science/LSAR/GCOV/metadata/sourceData/swaths/frequencyA")
        swath["processedRangeBandwidth"] = 40e6
        swath["acquiredRangeBandwidth"] = 40e6
    return stream.getvalue()


class NativeScienceTests(unittest.TestCase):
    def setUp(self):
        self.mask = np.ones((2, 3), dtype=np.uint8)
        self.power = np.array([[.1, .5, 1], [2, 4, 8]], dtype=np.float32)

    def test_equal_power_zero_db(self):
        diff, _, _, common, stats, coverage = compare_arrays(self.power, self.power, self.mask, self.mask)
        np.testing.assert_array_equal(diff, np.zeros((2, 3)))
        self.assertEqual(stats["medianDb"], 0)
        self.assertEqual(coverage["commonValidPercent"], 100)
        self.assertTrue(common.all())

    def test_doubled_power_is_positive_three_db_and_reverse_negative(self):
        doubled = self.power * 2
        forward = compare_arrays(self.power, doubled, self.mask, self.mask)[0]
        reverse = compare_arrays(doubled, self.power, self.mask, self.mask)[0]
        np.testing.assert_allclose(forward, 10*np.log10(2), atol=1e-12)
        np.testing.assert_allclose(reverse, -forward, atol=1e-12)

    def test_intersection_excludes_fill_nonpositive_nonfinite_and_aoi(self):
        b = np.array([[1, 0, np.nan], [1, 1, 1.]], dtype=np.float32)
        a = np.array([[2, 1, 2], [np.inf, -1, 999]], dtype=np.float32)
        bm, am = self.mask.copy(), self.mask.copy()
        am[0, 1] = 0
        bm[1, 1] = 255
        diff, bv, av, common, stats, coverage = compare_arrays(b, a, bm, am, after_fill=999)
        self.assertEqual(coverage, {"totalPixels": 6, "beforeValidPixels": 3, "afterValidPixels": 2,
            "commonValidPixels": 1, "commonValidPercent": 100/6})
        self.assertEqual(np.count_nonzero(np.isfinite(diff)), 1)
        self.assertAlmostEqual(stats["medianDb"], 10*np.log10(2))
        roi = np.array([[False, True, True], [True, True, True]])
        with self.assertRaisesRegex(ProcessingError, "no common"):
            compare_arrays(b, a, bm, am, after_fill=999, aoi=roi)

    def test_subswath_values_are_not_layover_codes(self):
        mask = np.array([[1, 2, 3], [4, 0, 255]], dtype=np.uint8)
        coverage = compare_arrays(self.power, self.power, mask, mask)[-1]
        self.assertEqual(coverage["commonValidPixels"], 4)

    def test_unknown_mask_attributes_fail_closed(self):
        with self.assertRaisesRegex(ProcessingError, "unknown"):
            mask_policy({"long_name": "layover shadow", "_FillValue": 255})
        with self.assertRaises(ProcessingError):
            mask_policy({"long_name": "Valid samples subswath mask", "_FillValue": 255, "flag_meanings": "valid invalid"})

    def test_bad_mask_shape_and_dtype(self):
        for mask in (np.ones((1, 2), dtype=np.uint8), self.mask.astype(np.int16)):
            with self.assertRaises(ProcessingError):
                compare_arrays(self.power, self.power, mask, self.mask)

    def test_exception_mask_hh_focus_anomalies_and_fill(self):
        mask = np.array([[256,258,0],[768,65535,256]],dtype=np.uint16)
        diff,bv,av,common,_,counts = compare_arrays(self.power,self.power,self.mask,self.mask,before_exception=mask)
        self.assertEqual(counts["beforeValidPixels"],3)
        self.assertEqual(counts["afterValidPixels"],6)
        self.assertEqual(counts["commonValidPixels"],3)
        self.assertEqual(np.count_nonzero(np.isfinite(diff)),3)
        bad=mask.copy(); bad[0,0]=257
        with self.assertRaisesRegex(ProcessingError,"Unsupported"):
            compare_arrays(self.power,self.power,self.mask,self.mask,before_exception=bad)

    def test_schema15_sample_slip_changes_per_date_and_common_coverage(self):
        before = np.array([[0,2,0],[0,0,0]],dtype=np.uint8)
        after = np.array([[0,0,2],[0,0,0]],dtype=np.uint8)
        diff,bv,av,common,stats,counts = compare_arrays(self.power,self.power*2,self.mask,self.mask,before_exception=before,after_exception=after)
        self.assertEqual((counts["beforeValidPixels"],counts["afterValidPixels"],counts["commonValidPixels"]),(5,5,4))
        self.assertEqual(np.count_nonzero(np.isfinite(diff)),4)
        self.assertAlmostEqual(stats["medianDb"],10*np.log10(2))
        before[0,0]=1
        with self.assertRaisesRegex(ProcessingError,"Unsupported"):
            compare_arrays(self.power,self.power,self.mask,self.mask,before_exception=before)

    def test_no_common_valid_pixels(self):
        with self.assertRaisesRegex(ProcessingError, "no common"):
            compare_arrays(self.power, self.power, self.mask*0, self.mask)

    def test_no_ratio_overflow(self):
        b, a = np.array([[1e-300]]), np.array([[1e300]])
        mask = np.ones((1, 1), dtype=np.uint8)
        self.assertEqual(compare_arrays(b, a, mask, mask)[0][0, 0], 6000)


class GridTests(unittest.TestCase):
    GT = (100., 10., 0., 1000., 0., -10.)

    def test_integer_shift_common_crop(self):
        second = (120., 10., 0., 980., 0., -10.)
        bw, aw, gt = crop_windows(self.GT, second, (10, 10), (10, 10), (90, 880, 250, 1010))
        self.assertEqual(bw, (2, 2, 8, 8))
        self.assertEqual(aw, (0, 0, 8, 8))
        self.assertEqual(gt, second)

    def test_subpixel_shift_and_different_resolution_are_rejected(self):
        for gt in ((100.5, 10., 0., 1000., 0., -10.), (100., 20., 0., 1000., 0., -10.), (100., 10., .1, 1000., 0., -10.)):
            with self.assertRaises(ProcessingError):
                aligned_offset(self.GT, gt)

    def test_no_overlap(self):
        with self.assertRaisesRegex(ProcessingError, "no common"):
            crop_windows(self.GT, self.GT, (10, 10), (10, 10), (300, 0, 400, 100))

    def test_pixel_limit_precedes_reads(self):
        with self.assertRaisesRegex(ProcessingError, "one million"):
            crop_windows(self.GT, self.GT, (2000, 2000), (2000, 2000), (100, -19000, 20100, 1000))

    def test_configured_pixel_cap_cannot_exceed_hard_cap(self):
        for limit in (0, MAX_PIXELS+1, True):
            with self.assertRaises(ProcessingError):
                crop_windows(self.GT, self.GT, (10, 10), (10, 10), (100, 900, 200, 1000), max_pixels=limit)
        with self.assertRaises(ProcessingError):
            crop_windows(self.GT, self.GT, (10, 10), (10, 10), (100, 900, 200, 1000), max_pixels=99)


class MetadataTests(unittest.TestCase):
    def test_documented_exception_mask_required_for_both_supported_schemas(self):
        for version in ("1.5.0", "1.6.0"):
            data=hdf_fixture(overrides={"productSpecificationVersion":version},include_exceptions=False)
            with self.assertRaisesRegex(ProcessingError,"require"):
                inspect_metadata(RemoteAsset(URL,MemoryOpener(data),TransferBudget()),catalog())

    def test_schema15_anomaly_mask_definition_is_distinct(self):
        metadata=self.inspect(hdf_fixture(overrides={"productSpecificationVersion":"1.5.0"}))
        self.assertTrue(metadata["exceptionMaskPresent"])
        self.assertNotIn("_FillValue",metadata["exceptionMaskAttributes"])
        for attrs in ({"_FillValue":65535},{"flag_meanings":"focused"}):
            with self.assertRaises(ProcessingError):
                self.inspect(hdf_fixture(overrides={"productSpecificationVersion":"1.5.0"},exception_attrs=attrs))
    def test_receive_only_channels_and_unknown_exception_mask_definitions_rejected(self):
        for data in (hdf_fixture(attrs={"isReceiveOnlyChannel1":"True"}),
                     hdf_fixture(exception_attrs={"flag_meanings":"unknown"}),
                     hdf_fixture(overrides={"productSpecificationVersion":"1.7.0"},exception_attrs={})):
            with self.assertRaises(ProcessingError):
                inspect_metadata(RemoteAsset(URL,MemoryOpener(data),TransferBudget()),catalog())
        data=hdf_fixture(exception_attrs={})
        metadata=inspect_metadata(RemoteAsset(URL,MemoryOpener(data),TransferBudget()),catalog())
        self.assertTrue(metadata["exceptionMaskPresent"])

    def inspect(self, data, source=None):
        asset = RemoteAsset(URL, MemoryOpener(data), TransferBudget())
        return inspect_metadata(asset, source or catalog())

    def test_hdf5_ancillary_inspected_via_bounded_reads(self):
        source = catalog()
        data = hdf_fixture(source)
        opener = MemoryOpener(data)
        asset = RemoteAsset(URL, opener, TransferBudget())
        metadata = inspect_metadata(asset, source)
        self.assertEqual(metadata["trackNumber"], 1)
        self.assertEqual(metadata["frequencyModes"]["A"]["polarizations"], ["HH"])
        self.assertEqual(metadata["powerAttributes"]["_FillValue"], "nan")
        self.assertTrue(all("Range" in req.headers for req in opener.calls))

    def test_filename_does_not_supply_missing_or_contradictory_fields(self):
        for overrides in ({"trackNumber": 9}, {"missionId": "ALOS"}, {"granuleId": "other"}, {"isMixedMode": "True"}):
            with self.assertRaises(ProcessingError):
                self.inspect(hdf_fixture(overrides=overrides))

    def test_gamma0_metadata_required(self):
        with self.assertRaises(ProcessingError) as result:
            self.inspect(hdf_fixture(attrs={"standard_name": "radar_backscatter_sigma0"}))
        self.assertEqual(result.exception.code, "RADIOMETRY_UNKNOWN")

    def test_receive_only_channel_is_not_backscatter(self):
        with self.assertRaises(ProcessingError) as result:
            self.inspect(hdf_fixture(attrs={"isReceiveOnlyChannel1": "True"}))
        self.assertEqual(result.exception.code, "UNSUPPORTED_MODE")

    def test_official_covariance_schema_verifies_gamma0_ancillary(self):
        metadata = self.inspect(hdf_fixture(production_radiometry=True))
        self.assertEqual(metadata["radiometricTerrainCorrectionApplied"], "True")
        self.assertEqual(metadata["powerAttributes"]["long_name"], "Geocoded polarimetric covariance term HHHH")

    def test_covariance_schema_without_rtc_applied_fails_closed(self):
        payload = io.BytesIO(hdf_fixture(production_radiometry=True))
        with h5py.File(payload, "r+") as f:
            f["/science/LSAR/GCOV/metadata/processingInformation/parameters/radiometricTerrainCorrectionApplied"][()] = "False"
        with self.assertRaises(ProcessingError) as result:
            self.inspect(payload.getvalue())
        self.assertEqual(result.exception.code, "RADIOMETRY_UNKNOWN")

    def test_native_release_mode_and_track_compatibility(self):
        before = self.inspect(hdf_fixture())
        for field, replacement in (("compositeReleaseId", "X99999"), ("trackNumber", 7),
                                   ("productSpecificationVersion", "9.0"), ("frequencyModes", {"A": {"polarizations": ["VV"]}})):
            after = dict(before, granuleId="after", zeroDopplerStartTime="2026-09-13T00:00:00Z")
            after[field] = replacement
            with self.assertRaises(ProcessingError):
                validate_metadata_pair(before, after)

    def test_catalog_requires_chronology_and_same_provisional_collection(self):
        before, after = catalog(), catalog("after", "2026-09-13T00:00:00Z")
        validate_pair(before, after)
        for changed in (dict(after, startTime=before["startTime"]), dict(after, startTime="2026-09-01T02:00:00Z"),
                        dict(after, collectionName="NISAR_L2_GCOV_BETA_V1"), dict(after, frameNumber=3)):
            with self.assertRaises(ProcessingError):
                validate_pair(before, changed)

    def test_lookup_uses_product_list_and_exact_file_id(self):
        source = catalog("before")
        opener = MemoryOpener(b"")
        payload = json.dumps({"features": [{"properties": source}]}).encode()
        with patch("service.processing.request.build_opener") as builder:
            builder.return_value.open.return_value = Response(payload, status=200)
            self.assertEqual(lookup_source("before")["fileID"], "before")
            req = builder.return_value.open.call_args.args[0]
            self.assertIn("product_list=before", req.full_url)
            self.assertNotIn("granule_list", req.full_url)
        with patch("service.processing.request.build_opener") as builder:
            builder.return_value.open.return_value = Response(payload, status=200)
            with self.assertRaises(ProcessingError):
                lookup_source("different")

    def test_collection_evidence_is_catalog_and_archive_not_invented_hdf5(self):
        metadata = self.inspect(hdf_fixture())
        self.assertIn("not an HDF5", metadata["collectionVerification"]["maturitySource"])
        with self.assertRaises(ProcessingError) as result:
            self.inspect(hdf_fixture(), dict(catalog(), url="https://nisar.asf.earthdatacloud.nasa.gov/NISAR/NISAR_L2_GCOV_BETA_V1/test.h5"))
        self.assertEqual(result.exception.code, "UNSUPPORTED_COLLECTION")


class RangeTests(unittest.TestCase):
    def test_https_exact_allowlist_and_queryless_original(self):
        validate_url(URL)
        for url in ("http://nisar.asf.earthdatacloud.nasa.gov/test.h5", "https://127.0.0.1/test.h5", "https://nisar.asf.earthdatacloud.nasa.gov.evil.test/a.h5",
                    URL+"?token=secret", "https://u:p@nisar.asf.earthdatacloud.nasa.gov/a.h5", "https://nisar.asf.earthdatacloud.nasa.gov/PRIVATE/a.h5"):
            with self.assertRaises(RangeError):
                validate_url(url)

    def test_redirect_rejected_before_connection_and_auth_removed(self):
        handler = SafeRedirect()
        req = request.Request(URL, headers={"Authorization": "never-forward", "Cookie": "never-forward", "Range": "bytes=0-9"})
        with self.assertRaises(RangeError):
            handler.redirect_request(req, None, 302, "redirect", {}, "https://evil.test/a.h5")
        redirected = handler.redirect_request(req, None, 302, "redirect", {}, "https://d1mv8zhcvry6x4.cloudfront.net/a.h5?Signature=opaque")
        self.assertNotIn("Authorization", redirected.headers)
        self.assertNotIn("Cookie", redirected.headers)
        self.assertEqual(redirected.headers["Range"], "bytes=0-9")

    def test_redirect_body_is_closed_without_unbounded_read(self):
        handler = SafeRedirect()
        req = request.Request(URL)
        req.timeout = 30
        body = Response(b"body must never be drained")
        headers = Message()
        headers["Location"] = "https://evil.test/a.h5"
        with patch.object(body, "read", wraps=body.read) as read:
            with self.assertRaises(RangeError):
                handler.http_error_302(req, body, 302, "redirect", headers)
            read.assert_not_called()
            self.assertTrue(body.closed)

    def test_full_granule_response_rejected_without_reading_body(self):
        response = Response(b"body-must-not-be-read", status=200)
        class Opener:
            def open(self, *args, **kwargs):
                return response
        with patch.object(response, "read", wraps=response.read) as read:
            budget = TransferBudget()
            with self.assertRaisesRegex(RangeError, "full-granule"):
                RemoteAsset(URL, Opener(), budget).fetch(0, 3)
            read.assert_not_called()
            self.assertEqual(budget.transferred, 0)

    def test_hard_byte_cap_shared_between_sources(self):
        budget = TransferBudget(limit=5)
        first, second = RemoteAsset(URL, MemoryOpener(b"abcdef"), budget), RemoteAsset(URL, MemoryOpener(b"abcdef"), budget)
        self.assertEqual(first.fetch(0, 2), b"abc")
        self.assertEqual(second.fetch(0, 1), b"ab")
        with self.assertRaisesRegex(RangeError, "budget"):
            second.fetch(2, 2)
        self.assertEqual(budget.transferred, 5)
        with self.assertRaises(ValueError):
            TransferBudget(MAX_TRANSFER_BYTES+1)

    def test_incorrect_content_range_rejected(self):
        with patch.object(MemoryOpener, "open", return_value=Response(b"abcd", headers={"Content-Range": "bytes 5-8/10"})):
            with self.assertRaisesRegex(RangeError, "different byte"):
                RemoteAsset(URL, MemoryOpener(b""), TransferBudget()).fetch(0, 3)

    def test_seekable_file_only_bounded_reads(self):
        asset = RemoteAsset(URL, MemoryOpener(b"abcdefghij"), TransferBudget())
        with RangeFile(asset) as file:
            self.assertEqual(file.seek(-3, io.SEEK_END), 7)
            self.assertEqual(file.read(3), b"hij")
            self.assertEqual(file.read(1), b"")
            with self.assertRaises(RangeError):
                file.read()
            with self.assertRaises(RangeError):
                asset.fetch(0, MAX_RANGE_BYTES)

    def test_loopback_proxy_head_and_range_only_get(self):
        asset = RemoteAsset(URL, MemoryOpener(b"abcdefghij"), TransferBudget())
        with RangeProxy([asset]) as proxy:
            url = proxy.vsi_path(0).removeprefix("/vsicurl/")
            with request.urlopen(request.Request(url, method="HEAD")) as response:
                self.assertEqual(response.headers["Content-Length"], "10")
            with request.urlopen(request.Request(url, headers={"Range": "bytes=3-5"})) as response:
                self.assertEqual(response.read(), b"def")
                self.assertEqual(response.headers["Content-Range"], "bytes 3-5/10")
            with self.assertRaises(error.HTTPError) as denied:
                request.urlopen(url)
            self.assertEqual(denied.exception.code,502)
            denied.exception.close()
            with self.assertRaises(RangeError):
                proxy.check()

    def test_missing_netrc_capability_does_not_read_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            ready, message = capability(Path(directory) / "not-configured")
            self.assertFalse(ready)
            self.assertIn("netrc", message)


if __name__ == "__main__":
    unittest.main()
