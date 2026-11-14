"""Offline deterministic transport, native-grid, and denominator acceptance tests."""
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from copy import deepcopy
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from service.benchmarks import geoid_sample as sample

ROOT = Path(__file__).resolve().parents[2]
PLAN = ROOT / "examples/geoid-development/selection-plan.json"
ORIGINAL = json.loads(PLAN.read_bytes())
BODIES = {role: b"synthetic-not-a-raster-" + role.encode() for role in sample.ROLES}


@contextmanager
def frozen_fixture(root, bodies=None):
    """Test-only pin substitution: production has no configurable pin or URL."""
    bodies = BODIES if bodies is None else bodies
    plan = deepcopy(ORIGINAL)
    for asset in plan["assets"]:
        body = bodies[asset["role"]]
        asset["bytes"] = len(body)
        asset["identity"]["value"] = sample._provider_hash(body, asset["identity"]["algorithm"])
    raw = json.dumps(plan).encode()
    path = root / "plan.json"
    path.write_bytes(raw)
    with patch.object(sample, "PLAN_SHA256", hashlib.sha256(raw).hexdigest()):
        yield path, plan


class Response:
    def __init__(self, body=b"", status=200, headers=None, failure=None):
        self.status = status
        self.headers = [("Content-Length", str(len(body)))] if headers is None else headers
        self.body = io.BytesIO(body)
        self.failure = failure
        self.closed, self.reads, self.timeouts = False, 0, []

    def read(self, size, timeout):
        self.reads += 1
        self.timeouts.append(timeout)
        if self.failure:
            raise self.failure
        return self.body.read(size)

    def close(self):
        self.closed = True


class Transport:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), []

    def open(self, url, timeout):
        self.calls.append((url, timeout))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def responses(plan, bodies=None):
    bodies = BODIES if bodies is None else bodies
    return [Response(bodies[a["role"]]) for a in plan["assets"]]


class FetchTests(unittest.TestCase):
    def test_original_pin_and_no_optional_import_for_cli_help(self):
        self.assertEqual(hashlib.sha256(PLAN.read_bytes()).hexdigest(), sample.PLAN_SHA256)
        self.assertEqual(sum(a["bytes"] for a in sample.load_plan(PLAN)["assets"]), 19687587)
        result = subprocess.run([sys.executable, "-S", str(ROOT / "service/benchmarks/geoid_sample.py"), "--help"],
                                cwd=ROOT, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("fetch", result.stdout)
        self.assertIn("analyze", result.stdout)

    def test_success_hashes_private_modes_atomic_bundle_and_source_only_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with frozen_fixture(root) as (plan_path, plan):
                replies = responses(plan)
                transport = Transport(replies)
                destination = root / "new"
                receipt = sample.fetch(plan_path, destination, transport=transport)
                self.assertEqual(set(p.name for p in destination.iterdir()),
                                 {"before.tif", "after.tif", "label.tif", "validity.tif", "receipt.json"})
                self.assertEqual(destination.stat().st_mode & 0o777, 0o700)
                self.assertTrue(all(p.stat().st_mode & 0o777 == 0o600 for p in destination.iterdir()))
                self.assertEqual(receipt, json.loads((destination / "receipt.json").read_bytes()))
                self.assertEqual(receipt["assetBodyBytes"], sum(map(len, BODIES.values())))
                for record in receipt["assets"]:
                    self.assertEqual(record["sha256"], hashlib.sha256(BODIES[record["role"]]).hexdigest())
                    self.assertEqual((destination / sample.NAMES[record["role"]]).read_bytes(), BODIES[record["role"]])
                self.assertTrue(all(r.closed for r in replies))
                self.assertEqual(len(transport.calls), 4)
                self.assertNotIn("https:", json.dumps(receipt))
                self.assertTrue(all("/resolve/" + sample.REVISION + "/sample/" in url for url, _ in transport.calls))
                self.assertTrue(all(0 < timeout <= sample.READ_TIMEOUT for r in replies for timeout in r.timeouts))
                self.assertFalse(list(root.glob(".geoid-owned-*")))

    def test_plan_mutations_fail_before_transport_or_staging(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for field, replacement in (("revision", "other"), ("dataset", "private/other"), ("assets", [])):
                plan = deepcopy(ORIGINAL)
                plan[field] = replacement
                path = root / "bad.json"
                path.write_text(json.dumps(plan))
                transport = Transport([])
                with self.subTest(field=field), self.assertRaises(sample.SampleError):
                    sample.fetch(path, root / "new", transport=transport)
                self.assertEqual(transport.calls, [])
                self.assertFalse((root / "new").exists())
                self.assertFalse(list(root.glob(".geoid-owned-*")))

    def assert_rejected_response(self, make_response):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with frozen_fixture(root) as (path, plan):
                reply = make_response(plan["assets"][0])
                transport = Transport([reply])
                with self.assertRaises(sample.SampleError):
                    sample.fetch(path, root / "new", transport=transport)
                self.assertTrue(reply.closed)
                self.assertFalse((root / "new").exists())
                self.assertFalse(list(root.glob(".geoid-owned-*")))
                self.assertEqual(len(transport.calls), 1)

    def test_missing_wrong_duplicate_length_encoding_range_and_status(self):
        for headers in ([], [("Content-Length", "1")], [("Content-Length", "01")],
                        [("Content-Length", "-1")], [("Content-Length", "999999999999999")]):
            with self.subTest(headers=headers):
                self.assert_rejected_response(lambda a: Response(BODIES[a["role"]], headers=headers))
        for extra in (("Content-Encoding", "gzip"), ("Content-Encoding", "br"),
                      ("Transfer-Encoding", "chunked"), ("Content-Range", "bytes 0-1/2"),
                      ("Content-Length", "22")):
            with self.subTest(extra=extra):
                self.assert_rejected_response(lambda a: Response(BODIES[a["role"]], headers=[("Content-Length", str(a["bytes"])), extra]))
        for status in (206, 404, 500):
            with self.subTest(status=status):
                self.assert_rejected_response(lambda a: Response(BODIES[a["role"]], status=status))

    def test_identity_encoding_accepted(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with frozen_fixture(root) as (path, plan):
                replies = responses(plan)
                for reply in replies:
                    reply.headers.append(("Content-Encoding", "identity"))
                sample.fetch(path, root / "new", transport=Transport(replies))

    def test_same_length_mutation_short_body_overlong_and_lfs_pointer(self):
        for body in (b"!" * len(BODIES["after"]), BODIES["after"][:-1], BODIES["after"] + b"!",
                     b"version https://git-lfs.github.com/spec/v1\noid sha256:fake\nsize 9805934\n"):
            with self.subTest(body=body):
                self.assert_rejected_response(lambda a: Response(body, headers=[("Content-Length", str(a["bytes"]))]))

    def test_mask_git_blob_identity_is_not_plain_sha1_and_is_reverified(self):
        self.assertNotEqual(sample._provider_hash(BODIES["label"], "git-blob-sha1"), hashlib.sha1(BODIES["label"]).hexdigest())
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with frozen_fixture(root) as (path, plan):
                replies = responses(plan)
                i = next(i for i, a in enumerate(plan["assets"]) if a["role"] == "label")
                replies[i] = Response(b"!" * len(BODIES["label"]))
                with self.assertRaises(sample.SampleError):
                    sample.fetch(path, root / "new", transport=Transport(replies))
                self.assertFalse((root / "new").exists())
                self.assertFalse(list(root.glob(".geoid-owned-*")))

    def test_redirect_allowlist_no_body_read_no_query_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with frozen_fixture(root) as (path, plan):
                redirect = Response(b"never read this body", 302, [("Location", "https://cdn.hf.co/file?secret=SIGNED")])
                transport = Transport([redirect] + responses(plan))
                receipt = sample.fetch(path, root / "new", transport=transport)
                self.assertEqual(redirect.reads, 0)
                self.assertTrue(redirect.closed)
                self.assertEqual(transport.calls[1][0], "https://cdn.hf.co/file?secret=SIGNED")
                self.assertNotIn("SIGNED", json.dumps(receipt))
                self.assertNotIn("?", json.dumps(receipt))

    def test_unsafe_redirects_close_without_read_and_without_token_errors(self):
        urls = ("http://huggingface.co/file?secret=SIGNED", "https://hf.co.attacker.test/file?secret=SIGNED",
                "https://evil.test/hf.co", "https://u:p@hf.co/file", "https://hf.co:444/file",
                "file:///tmp/file", "https://hf.co/file#fragment", "https://hf.co/\nsecret")
        for url in urls:
            with self.subTest(url=url):
                self.assert_rejected_response(lambda a: Response(status=302, headers=[("Location", url)]))
        for headers in ([], [("Location", "https://hf.co/a"), ("Location", "https://hf.co/b")]):
            self.assert_rejected_response(lambda a: Response(status=302, headers=headers))

    def test_redirect_limit_is_per_asset_and_no_retry(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with frozen_fixture(root) as (path, _):
                replies = [Response(status=302, headers=[("Location", "https://huggingface.co/a")]) for _ in range(6)]
                transport = Transport(replies)
                with self.assertRaisesRegex(sample.SampleError, "Acquisition failed"):
                    sample.fetch(path, root / "new", transport=transport)
                self.assertEqual(len(transport.calls), 6)
                self.assertTrue(all(r.closed and r.reads == 0 for r in replies))
                self.assertFalse(list(root.glob(".geoid-owned-*")))

    def test_each_asset_can_redirect_with_safe_relative_locations(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with frozen_fixture(root) as (path, plan):
                replies = []
                for asset in plan["assets"]:
                    replies.extend([Response(status=302, headers=[("Location", "/one")]),
                                    Response(status=307, headers=[("Location", "https://cdn.huggingface.co/two")]),
                                    Response(BODIES[asset["role"]])])
                transport = Transport(replies)
                sample.fetch(path, root / "new", transport=transport)
                self.assertEqual(len(transport.calls), 12)  # Eight redirects total, two per asset.
                self.assertTrue(all(r.closed for r in replies))

    def test_failed_read_counts_partial_and_cleans_up_without_exception_url(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with frozen_fixture(root) as (path, _):
                reply = Response(failure=http.client.IncompleteRead(b"1234567", 99))
                reply.headers = [("Content-Length", str(len(BODIES["after"])))]
                with self.assertRaisesRegex(sample.SampleError, "consumed asset body bytes=7"):
                    sample.fetch(path, root / "new", transport=Transport([reply]))
                self.assertTrue(reply.closed)
                self.assertFalse(list(root.glob(".geoid-owned-*")))
                for failure in (RuntimeError("https://hf.co/?token=PRIVATE"), sample.SampleError("https://hf.co/?token=PRIVATE")):
                    transport = Transport([failure])
                    with self.assertRaises(sample.SampleError) as caught:
                        sample.fetch(path, root / "new", transport=transport)
                    self.assertNotIn("PRIVATE", str(caught.exception))
                    self.assertNotIn("https", str(caught.exception))
                    self.assertEqual(len(transport.calls), 1)

    def test_planned_actual_budget_and_clock_deadline(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with frozen_fixture(root) as (path, plan):
                with patch.object(sample, "MAX_BYTES", 20), self.assertRaises(sample.SampleError):
                    sample.fetch(path, root / "new", transport=Transport([]))
                budget = sample._Budget(lambda: 0)
                with patch.object(sample, "MAX_BYTES", 3):
                    budget.count(b"123")
                    with self.assertRaises(sample.SampleError):
                        budget.count(b"4")
                    self.assertEqual(budget.bytes, 4)
                clock = iter((0, 0, 0, 0, 181))
                replies = responses(plan)
                with self.assertRaisesRegex(sample.SampleError, "Acquisition failed"):
                    sample.fetch(path, root / "new", transport=Transport(replies), clock=lambda: next(clock))
                self.assertTrue(replies[0].closed)
                self.assertFalse(list(root.glob(".geoid-owned-*")))

    def test_existing_destination_symlinks_and_publication_race_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with frozen_fixture(root) as (path, plan):
                destination = root / "existing"
                destination.mkdir()
                (destination / "keep").write_text("untouched")
                link = root / "link"
                link.symlink_to(destination, target_is_directory=True)
                dangling = root / "dangling"
                dangling.symlink_to(root / "absent")
                for target in (destination, link, dangling):
                    transport = Transport([])
                    with self.assertRaises(sample.SampleError):
                        sample.fetch(path, target, transport=transport)
                    self.assertEqual(transport.calls, [])
                self.assertEqual((destination / "keep").read_text(), "untouched")
                publish = sample._publish_directory

                def race(stage, target):
                    target.mkdir()
                    return publish(stage, target)

                with patch.object(sample, "_publish_directory", side_effect=race), self.assertRaises(sample.SampleError):
                    sample.fetch(path, root / "race", transport=Transport(responses(plan)))
                self.assertTrue((root / "race").is_dir())
                self.assertEqual(list((root / "race").iterdir()), [])
                self.assertFalse(list(root.glob(".geoid-owned-*")))

    def test_default_transport_sends_no_credentials_and_reads_at_most_once(self):
        with patch.object(sample.http.client, "HTTPSConnection") as factory:
            response = factory.return_value.getresponse.return_value
            response.status = 200
            response.getheaders.return_value = [("Content-Length", "1")]
            response.read1.return_value = b"x"
            connection = sample.HTTPSTransport().open("https://hf.co/a?token=temporary", 3)
            factory.return_value.request.assert_called_once_with("GET", "/a?token=temporary", headers={"Accept-Encoding": "identity", "Connection": "close"})
            self.assertEqual(connection.read(10, 2), b"x")
            response.read1.assert_called_once_with(10)
            response.fp.raw._sock.settimeout.assert_called_once_with(2)
            connection.close()
            response.close.assert_called_once()
            factory.return_value.close.assert_called_once()

    def test_real_http_parser_wrapper_eof_and_header_deadline_without_network(self):
        class Raw(io.RawIOBase):
            def __init__(self, sock):
                self._sock = sock

            def readable(self):
                return True

            def readinto(self, buffer):
                value = self._sock.source.read(len(buffer))
                buffer[:len(value)] = value
                return len(value)

        class Socket:
            def __init__(self):
                self.source = io.BytesIO(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nabc")
                self.settimeout = Mock()

            def makefile(self, mode, buffering):
                self.asserted = (mode, buffering)
                return Raw(self)

        sock = Socket()
        response = http.client.HTTPResponse(sample._HeaderSocket(sock, sample.time.monotonic() + 10))
        response.begin()
        self.assertEqual(sock.source.read(), b"abc")  # Headers did not prefetch any body.
        sock.source.seek(-3, io.SEEK_END)
        wrapped = sample._HTTPSResponse(Mock(), response)
        self.assertEqual(wrapped.status, 200)
        self.assertEqual(wrapped.read(64, 1), b"abc")
        self.assertEqual(wrapped.read(64, 1), b"")
        wrapped.close()
        self.assertEqual(sock.asserted, ("rb", 0))
        sock = Socket()
        reader = sample._DeadlineReader(Raw(sock), 2)
        with patch.object(sample.time, "monotonic", side_effect=[0, 1, 3]):
            self.assertEqual(reader.readinto(bytearray(1)), 1)
            self.assertEqual(reader.readinto(bytearray(1)), 1)
            with self.assertRaises(TimeoutError):
                reader.readinto(bytearray(1))
        self.assertEqual(sock.settimeout.call_args_list[0].args, (2,))
        self.assertEqual(sock.settimeout.call_args_list[1].args, (1,))

    def test_private_json_exclusive_output_cli_error_privacy(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "result.json"
            sample.write_json_new(target, {"version": sample.VERSION})
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            original = target.read_bytes()
            with self.assertRaises(sample.SampleError):
                sample.write_json_new(target, {})
            self.assertEqual(target.read_bytes(), original)
            self.assertFalse(list(root.glob(".geoid-json-owned-*")))
            with patch.object(sample, "analyze", side_effect=RuntimeError("https://hf.co/?token=PRIVATE")), redirect_stderr(io.StringIO()) as err:
                self.assertEqual(sample.main(["analyze", "--plan", str(PLAN), "--directory", temp, "--output", str(root / "other")]), 2)
            self.assertNotIn("PRIVATE", err.getvalue())


try:
    import numpy as np
except ImportError:
    np = None


def crop_arrays():
    before = np.full((2, 256, 256), 10, dtype=np.float32)
    before[1] = 100
    label = np.zeros((256, 256), dtype=np.uint8)
    validity = np.ones_like(label)
    masks = {role: np.full((2, 256, 256) if role in ("before", "after") else (256, 256), 255, dtype=np.uint8)
             for role in sample.ROLES}
    return before, before.copy(), label, validity, masks


@unittest.skipIf(np is None, "numpy optional in service default")
class SummaryTests(unittest.TestCase):
    def test_equal_dates_known_db_and_every_class_same_date_band_denominator(self):
        before, after, label, validity, masks = crop_arrays()
        label.flat[:30] = 1
        label.flat[30:59] = 2
        result = sample.summarize_arrays(before, after, label, validity, masks)
        self.assertEqual(result["totalPixels"], 65536)
        self.assertEqual(result["common"]["commonPixels"], 65536)
        self.assertEqual(result["common"]["areaM2"], 6553600)
        self.assertEqual(sum(c["commonPixels"] for c in result["byClass"].values()), 65536)
        for item in (result["common"], result["byClass"]["0"], result["byClass"]["1"]):
            self.assertEqual(item["status"], "displayed")
            self.assertEqual(item["perDate"]["before"], item["perDate"]["after"])
            for date in ("before", "after"):
                for band, db in (("VV", 10), ("VH", 20)):
                    self.assertEqual(item["perDate"][date][band]["pixels"], item["commonPixels"])
                    self.assertEqual(set(item["perDate"][date][band]["percentilesDb"].values()), {db})
        self.assertEqual(result["byClass"]["2"]["status"], "withheld-below-display-gate")
        self.assertIsNone(result["byClass"]["2"]["perDate"])

    def test_absent_classes_and_empty_common_are_explicit_withheld(self):
        arrays = crop_arrays()
        result = sample.summarize_arrays(*arrays)
        for key in ("1", "2"):
            self.assertEqual(result["byClass"][key]["status"], "withheld-absent-class")
            self.assertIsNone(result["byClass"][key]["perDate"])
        arrays[3][:] = 0
        result = sample.summarize_arrays(*arrays)
        self.assertEqual(result["common"]["commonPixels"], 0)
        self.assertIsNone(result["common"]["perDate"])

    def test_overlapping_exclusions_and_single_band_rejects_both_dates(self):
        before, after, label, validity, masks = crop_arrays()
        label.flat[0] = 255
        validity.flat[0] = 0
        masks["label"].flat[0] = 0
        before[0].flat[0] = np.nan
        before[0].flat[1] = 0
        before[1].flat[2] = -1
        after[0].flat[3] = 1001
        after[1].flat[4] = np.inf
        after[1].flat[5] = -np.inf
        after[1].flat[6] = 1000  # Inclusive upper bound.
        masks["after"][1].flat[7] = 0
        masks["validity"].flat[8] = 0
        result = sample.summarize_arrays(before, after, label, validity, masks)
        self.assertEqual(result["labeledPixels"], 65535)
        self.assertEqual(result["mappedPixels"], 65535)
        self.assertEqual(result["nativeValidPixels"], 65533)
        self.assertEqual(result["common"]["commonPixels"], 65528)
        self.assertEqual(result["perDateValidPixels"], {"before": 65533, "after": 65532})
        ex = result["overlappingExclusions"]
        self.assertEqual(ex["excludedUnionPixels"], 8)
        self.assertEqual(ex["perDateInvalidPowerPixels"], {"before": 3, "after": 3})
        self.assertEqual(ex["perBandPowerDiagnostics"]["after"]["VH"]["nonfinite"], 2)
        self.assertEqual(ex["perBandPowerDiagnostics"]["after"]["VV"]["above1000"], 1)
        for date in ("before", "after"):
            for band in ("VV", "VH"):
                self.assertEqual(result["common"]["perDate"][date][band]["pixels"], 65528)

    def test_linear_percentiles_of_db_not_log_of_interpolated_power(self):
        arrays = crop_arrays()
        arrays[0][0] = np.arange(1, 65537, dtype=np.float32).reshape(256, 256) / 100
        result = sample.summarize_arrays(*arrays)
        actual = result["common"]["perDate"]["before"]["VV"]["percentilesDb"]
        expected = np.percentile(10 * np.log10(arrays[0][0].astype(np.float64)), [5, 25, 50, 75, 95], method="linear")
        np.testing.assert_allclose(list(actual.values()), expected, rtol=0, atol=0)

    def test_unsupported_labels_validity_native_masks_shapes_and_dtype(self):
        for index, bad in ((2, 3), (2, 254), (3, 2), (3, 255)):
            arrays = crop_arrays()
            arrays[index].flat[0] = bad
            with self.subTest(index=index, bad=bad), self.assertRaises(sample.SampleError):
                sample.summarize_arrays(*arrays)
        arrays = crop_arrays()
        arrays[4]["before"][0].flat[0] = 1
        with self.assertRaises(sample.SampleError):
            sample.summarize_arrays(*arrays)
        for index in range(4):
            arrays = list(crop_arrays())
            arrays[index] = arrays[index].astype(np.float64)
            with self.subTest(index=index), self.assertRaises(sample.SampleError):
                sample.summarize_arrays(*arrays)
        arrays = list(crop_arrays())
        arrays[0] = arrays[0][:, :255]
        with self.assertRaises(sample.SampleError):
            sample.summarize_arrays(*arrays)


try:
    import rasterio
    from rasterio.io import MemoryFile
    from rasterio.transform import Affine
except ImportError:
    rasterio = None


def raster_body(role, *, transform=None, crs="EPSG:32632", width=1024, height=1024,
                dtype=None, count=None, bad_value=None, scales=None, offsets=None, invalid_native=False):
    radar = role in ("before", "after")
    dtype = dtype or ("float32" if radar else "uint8")
    count = count or (2 if radar else 1)
    data = np.full((count, height, width), 10 if radar else 1 if role == "validity" else 0, dtype=dtype)
    if bad_value is not None:
        data[0, 384, 384] = bad_value
    with rasterio.Env(GDAL_TIFF_INTERNAL_MASK="YES"), MemoryFile() as memory:
        with memory.open(driver="GTiff", width=width, height=height, count=count, dtype=dtype,
                         crs=crs, transform=transform or Affine(10, 0, 500000, 0, -10, 5800000),
                         compress="deflate") as target:
            target.write(data)
            if scales is not None:
                target.scales = scales
            if offsets is not None:
                target.offsets = offsets
            if invalid_native:
                mask = np.full((height, width), 255, dtype=np.uint8)
                mask[384, 384] = 0
                target.write_mask(mask)
        return memory.read()


@unittest.skipIf(rasterio is None or np is None, "optional rasterio/numpy required")
class AnalyzeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bodies = {role: raster_body(role) for role in sample.ROLES}

    @contextmanager
    def case(self, bodies=None):
        bodies = self.bodies if bodies is None else bodies
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with frozen_fixture(root, bodies) as (path, plan):
                directory = root / "files"
                directory.mkdir()
                for role, body in bodies.items():
                    (directory / sample.NAMES[role]).write_bytes(body)
                yield path, directory, plan

    def test_native_analysis_lineage_crop_header_and_no_forbidden_outputs(self):
        with self.case() as (path, directory, plan):
            with patch.object(sample.HTTPSTransport, "open", side_effect=AssertionError("offline")):
                result = sample.analyze(path, directory)
            self.assertEqual(result["summary"]["common"]["commonPixels"], 65536)
            self.assertEqual(result["nativeGrid"]["affine"], [10, 0, 500000, 0, -10, 5800000])
            self.assertEqual(result["crop"]["affine"], [10, 0, 503840, 0, -10, 5796160])
            self.assertEqual({k: result["crop"][k] for k in plan["window"]}, plan["window"])
            self.assertEqual(result["acquisitionTimes"], plan["acquisitionTimes"])
            self.assertEqual(result["planSha256"], sample.PLAN_SHA256)
            self.assertIn("n=1", result["plainLanguage"])
            self.assertIn("not current risk", result["plainLanguage"])
            self.assertIn("not field truth", result["plainLanguage"])
            self.assertIn("65,536 of 65,536", result["inSimpleTerms"])
            self.assertIn("100.00%", result["inSimpleTerms"])
            self.assertIn("does not independently prove dry ground", result["inSimpleTerms"])
            self.assertIn("class is absent", result["inSimpleTerms"])
            self.assertIn("One static provider label groups both dates", result["inSimpleTerms"])
            self.assertEqual(result["units"]["summary"], "10 log10(power), dB")
            self.assertEqual(result["summary"]["byClass"]["2"]["status"], "withheld-absent-class")
            forbidden = {"difference", "ratio", "pvalue", "confidenceinterval", "accuracy", "prediction", "nisar"}

            def check_keys(value):
                if isinstance(value, dict):
                    self.assertFalse(forbidden & {k.lower() for k in value})
                    for item in value.values():
                        check_keys(item)
                elif isinstance(value, list):
                    for item in value:
                        check_keys(item)

            check_keys(result)
            # JSON serializable without nonfinite output or relative URL leakage.
            json.dumps(result, allow_nan=False)

    def test_all_hashes_verified_before_any_raster_open(self):
        with self.case() as (path, directory, _):
            victim = directory / "validity.tif"
            original = victim.read_bytes()
            victim.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
            with patch("rasterio.io.MemoryFile") as opener, self.assertRaises(sample.SampleError):
                sample.analyze(path, directory)
            opener.assert_not_called()

    def test_plan_hash_symlink_asset_and_directory_rejected(self):
        with self.case() as (path, directory, _):
            path.write_bytes(path.read_bytes() + b" ")
            with patch("rasterio.io.MemoryFile") as opener, self.assertRaises(sample.SampleError):
                sample.analyze(path, directory)
            opener.assert_not_called()
        with self.case() as (path, directory, _):
            asset = directory / "before.tif"
            saved = directory / "other.tif"
            asset.rename(saved)
            asset.symlink_to(saved)
            with self.assertRaises(OSError):
                sample.analyze(path, directory)
            directory_link = directory.parent / "link"
            directory_link.symlink_to(directory, target_is_directory=True)
            with self.assertRaises(sample.SampleError):
                sample.analyze(path, directory_link)

    def test_grid_crs_band_type_and_scale_mismatches(self):
        cases = ({"crs": "EPSG:4326"}, {"width": 1023}, {"height": 1023},
                 {"count": 1}, {"dtype": "float64"},
                 {"transform": Affine(10, 0, 500001, 0, -10, 5800000)},
                 {"transform": Affine(10, 0.01, 500000, 0, -10, 5800000)},
                 {"transform": Affine(10.0001, 0, 500000, 0, -10, 5800000)},
                 {"transform": Affine(10, 0, 500000, 0, 10, 5800000)},
                 {"scales": (2, 1)}, {"offsets": (0, 1)})
        for change in cases:
            with self.subTest(change=change):
                bodies = {**self.bodies, "after": raster_body("after", **change)}
                with self.case(bodies) as (path, directory, _), self.assertRaises(sample.SampleError):
                    sample.analyze(path, directory)

    def test_spacing_tolerance_but_cross_asset_transform_equality_is_exact(self):
        transform = Affine(10.000000000000114, 0, 500000, 0, -10, 5800000)
        bodies = {role: raster_body(role, transform=transform) for role in sample.ROLES}
        with self.case(bodies) as (path, directory, _):
            result = sample.analyze(path, directory)
            self.assertEqual(result["nativeGrid"]["affine"][0], transform.a)
        bodies["after"] = self.bodies["after"]
        with self.case(bodies) as (path, directory, _), self.assertRaises(sample.SampleError):
            sample.analyze(path, directory)

    def test_unsupported_mask_label_values_and_mask_structure(self):
        for role, options in (("label", {"bad_value": 3}), ("validity", {"bad_value": 2}),
                              ("label", {"dtype": "uint16"}), ("validity", {"count": 2})):
            with self.subTest(role=role, options=options):
                bodies = {**self.bodies, role: raster_body(role, **options)}
                with self.case(bodies) as (path, directory, _), self.assertRaises(sample.SampleError):
                    sample.analyze(path, directory)

    def test_external_unpinned_mask_sidecar_not_loaded(self):
        with self.case() as (path, directory, _):
            # A malicious local GDAL sidecar cannot silently change a pinned file's population.
            (directory / "before.tif.aux.xml").write_text('<PAMDataset><PAMRasterBand band="1"><NoDataValue>10</NoDataValue></PAMRasterBand></PAMDataset>')
            result = sample.analyze(path, directory)
            self.assertEqual(result["summary"]["common"]["commonPixels"], 65536)

    def test_internal_native_mask_and_invalid_power_both_constrain_common(self):
        bodies = {**self.bodies, "before": raster_body("before", invalid_native=True),
                  "after": raster_body("after", bad_value=np.nan)}
        with self.case(bodies) as (path, directory, _):
            result = sample.analyze(path, directory)
            self.assertEqual(result["summary"]["nativeValidPixels"], 65535)
            self.assertEqual(result["summary"]["common"]["commonPixels"], 65535)
            self.assertEqual(result["summary"]["overlappingExclusions"]["perDateInvalidPowerPixels"]["after"], 1)


if __name__ == "__main__":
    unittest.main()
