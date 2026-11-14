"""Offline transport/cache regressions; intentionally standard-library only."""
import http.client
import io
import json
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from email.message import Message
from unittest.mock import patch
from urllib import error

from service.range_reader import (MAX_CACHE_BYTES, MAX_CACHE_ENTRIES,
    MAX_RANGE_BYTES, MAX_TELEMETRY_VALUE, RangeError, RemoteAsset, TransferBudget)


URL = "https://nisar.asf.earthdatacloud.nasa.gov/NISAR/test.h5"
DATA = bytes(range(256)) * 8


class Response(io.BytesIO):
    def __init__(self, payload, start, end, total, *, headers=None, status=206, url=URL):
        super().__init__(payload)
        self.status, self.url = status, url
        self.headers = Message()
        self.headers["Content-Range"] = f"bytes {start}-{end}/{total}"
        self.headers["Content-Length"] = str(end - start + 1)
        self.headers["ETag"] = '"stable"'
        for name, value in (headers or {}).items():
            if name in self.headers:
                del self.headers[name]
            if value is not None:
                self.headers[name] = value
        self.read_sizes = []

    def geturl(self):
        return self.url

    def read(self, size=-1):
        if size < 0:
            raise AssertionError("Unbounded body read")
        self.read_sizes.append(size)
        return super().read(size)


class MemoryOpener:
    def __init__(self, data=DATA, factory=None):
        self.data, self.factory = data, factory
        self.requests, self.responses = [], []

    def open(self, req, timeout=30):
        self.requests.append(req)
        start, end = map(int, req.headers["Range"].removeprefix("bytes=").split("-"))
        end = min(end, len(self.data) - 1)
        if self.factory:
            response = self.factory(self.data[start:end + 1], start, end, len(self.data))
        else:
            response = Response(self.data[start:end + 1], start, end, len(self.data))
        self.responses.append(response)
        return response


class RangeCacheTests(unittest.TestCase):
    def asset(self, data=DATA, *, factory=None, budget=None, opener=None):
        opener = opener or MemoryOpener(data, factory)
        return RemoteAsset(URL, opener, budget or TransferBudget())

    def assert_reconciled(self, asset, transferred):
        self.assertEqual(asset.budget.transferred, transferred)
        self.assertEqual(asset.budget.reserved, 0)
        self.assertEqual(asset.telemetry_snapshot()["body_bytes_received"], transferred)

    def test_exact_and_nested_reuse_preserves_bytes_and_exhausted_budget(self):
        asset = self.asset(budget=TransferBudget(100))
        self.assertEqual(asset.fetch(100, 199), DATA[100:200])
        self.assertEqual(asset.fetch(100, 199), DATA[100:200])
        for start, end in ((101, 198), (100, 150), (150, 199), (160, 160)):
            self.assertEqual(asset.fetch(start, end), DATA[start:end + 1])
        self.assert_reconciled(asset, 100)
        stats = asset.telemetry_snapshot()
        self.assertEqual(stats["fetch_calls"], 6)
        self.assertEqual(stats["requested_bytes"], 400)
        self.assertEqual(stats["open_attempts"], 1)
        self.assertEqual(stats["exact_cache_hits"], 1)
        self.assertEqual(stats["containing_cache_hits"], 4)
        self.assertEqual(stats["cache_bytes_served"], 300)
        self.assertEqual(stats["cache_entries"], 1)
        self.assertEqual(stats["cache_bytes"], 100)

    def test_partial_overlaps_are_fetched_in_full_without_stitching(self):
        asset = self.asset()
        for start, end in ((0, 9), (10, 19), (5, 14), (15, 24)):
            self.assertEqual(asset.fetch(start, end), DATA[start:end + 1])
        self.assertEqual([r.headers["Range"] for r in asset.opener.requests],
                         ["bytes=0-9", "bytes=10-19", "bytes=5-14", "bytes=15-24"])
        self.assert_reconciled(asset, 40)
        self.assertEqual(asset.telemetry_snapshot()["containing_cache_hits"], 0)

    def test_each_asset_has_its_own_cache_and_shared_transfer_budget(self):
        budget = TransferBudget(20)
        first, second = self.asset(budget=budget), self.asset(budget=budget)
        self.assertEqual(first.fetch(0, 9), second.fetch(0, 9))
        self.assertEqual(first.fetch(2, 4), DATA[2:5])
        self.assertEqual(len(first.opener.requests), 1)
        self.assertEqual(len(second.opener.requests), 1)
        with self.assertRaises(RangeError) as failure:
            second.fetch(10, 10)
        self.assertEqual(failure.exception.code, "TRANSFER_LIMIT")
        self.assertEqual(budget.transferred, 20)
        self.assertEqual(budget.reserved, 0)
        self.assertIsNone(second.error)  # Reservation failures remain non-sticky.
        self.assertEqual(second.fetch(1, 1), DATA[1:2])

    def test_entry_eviction_with_tiny_reads_and_exact_lru_touch(self):
        self.assertEqual(MAX_CACHE_ENTRIES, 256)
        asset = self.asset()
        for offset in range(MAX_CACHE_ENTRIES):
            self.assertEqual(asset.fetch(offset, offset), DATA[offset:offset + 1])
        asset.fetch(0, 0)  # Keep the oldest entry, evict the next oldest.
        asset.fetch(MAX_CACHE_ENTRIES, MAX_CACHE_ENTRIES)
        self.assertIn((0, 0), asset.cache)
        self.assertNotIn((1, 1), asset.cache)
        self.assertEqual(len(asset.cache), MAX_CACHE_ENTRIES)
        self.assertEqual(asset.cache_bytes, MAX_CACHE_ENTRIES)
        self.assertEqual(asset.telemetry_snapshot()["cache_entries"], MAX_CACHE_ENTRIES)
        asset.fetch(1, 1)
        self.assertEqual(len(asset.opener.requests), MAX_CACHE_ENTRIES + 2)
        self.assert_reconciled(asset, MAX_CACHE_ENTRIES + 2)

    def test_byte_eviction_at_default_bound(self):
        self.assertEqual(MAX_CACHE_BYTES, 16 * 1024 * 1024)
        block = MAX_RANGE_BYTES
        asset = self.asset(data=b"a" * block + b"b" * block + b"c" * block)
        self.assertEqual(asset.fetch(0, block - 1), b"a" * block)
        self.assertEqual(asset.fetch(block, 2 * block - 1), b"b" * block)
        self.assertEqual(asset.fetch(2 * block, 3 * block - 1), b"c" * block)
        self.assertNotIn((0, block - 1), asset.cache)
        self.assertEqual(asset.telemetry_snapshot()["cache_entries"], 2)
        self.assertEqual(asset.telemetry_snapshot()["cache_bytes"], MAX_CACHE_BYTES)
        self.assert_reconciled(asset, 3 * block)

    def test_containing_hit_updates_owner_lru_without_adding_entries(self):
        asset = self.asset()
        with patch("service.range_reader.MAX_CACHE_ENTRIES", 2):
            asset.fetch(0, 9)
            asset.fetch(20, 29)
            asset.fetch(1, 8)
            asset.fetch(40, 49)
        self.assertEqual(list(asset.cache), [(0, 9), (40, 49)])
        self.assertEqual(asset.cache_bytes, 20)
        self.assert_reconciled(asset, 30)

    def test_most_recent_single_container_is_used(self):
        asset = self.asset()
        asset.fetch(0, 19)
        asset.fetch(10, 29)
        self.assertEqual(asset.fetch(12, 17), DATA[12:18])
        self.assertEqual(list(asset.cache)[-1], (10, 29))
        self.assertEqual(len(asset.opener.requests), 2)

    def test_eof_clipping_stores_actual_interval_and_reuses_clipped_requests(self):
        asset = self.asset(data=b"abcdefghij", budget=TransferBudget(25))
        for start, end in ((5, 29), (5, 29), (5, 9), (7, 29), (9, 9)):
            self.assertEqual(asset.fetch(start, end), b"abcdefghij"[start:end + 1])
        self.assertEqual(list(asset.cache), [(5, 9)])
        self.assertEqual(asset.length(), 10)
        self.assert_reconciled(asset, 5)
        self.assertEqual(asset.telemetry_snapshot()["exact_cache_hits"], 2)
        self.assertEqual(asset.telemetry_snapshot()["containing_cache_hits"], 2)
        self.assertEqual(asset.telemetry_snapshot()["requested_bytes"], 79)
        # The unused reservation is released and can serve another asset.
        second = self.asset(budget=asset.budget)
        self.assertEqual(second.fetch(0, 19), DATA[:20])
        self.assertEqual(asset.budget.transferred, 25)
        self.assertEqual(asset.budget.reserved, 0)

    def test_outside_eof_never_returns_cached_empty_or_negative_slice(self):
        asset = self.asset(data=b"abcdefghij")
        asset.fetch(0, 19)
        # Even a malformed 206 describing an inverted interval fails closed.
        with self.assertRaises(RangeError) as failure:
            asset.fetch(10, 19)
        self.assertEqual(failure.exception.code, "BAD_RANGE")
        self.assertEqual(len(asset.opener.requests), 2)
        self.assert_reconciled(asset, 10)

    def test_source_etag_change_is_sticky_even_for_cached_ranges(self):
        asset = self.asset()
        asset.fetch(0, 9)
        asset.opener.factory = lambda *args: Response(*args, headers={"ETag": '"changed"'})
        with self.assertRaises(RangeError) as changed:
            asset.fetch(20, 29)
        self.assertEqual(changed.exception.code, "SOURCE_CHANGED")
        self.assertEqual(asset.opener.requests[-1].headers["If-match"], '"stable"')
        for start, end in ((0, 9), (1, 8)):
            with self.assertRaises(RangeError) as cached:
                asset.fetch(start, end)
            self.assertIs(cached.exception, changed.exception)
        self.assertEqual(asset.telemetry_snapshot()["exact_cache_hits"], 0)
        self.assertEqual(asset.telemetry_snapshot()["containing_cache_hits"], 0)
        self.assertEqual(asset.opener.responses[-1].read_sizes, [])
        self.assert_reconciled(asset, 10)

    def test_source_size_change_is_sticky_before_body_read(self):
        asset = self.asset()
        asset.fetch(0, 9)
        asset.opener.factory = lambda payload, first, last, total: Response(payload, first, last, total + 1)
        with self.assertRaises(RangeError) as failure:
            asset.fetch(20, 29)
        self.assertEqual(failure.exception.code, "SOURCE_CHANGED")
        self.assertEqual(asset.opener.responses[-1].read_sizes, [])
        self.assert_reconciled(asset, 10)

    def test_invalid_headers_and_destination_fail_before_body_or_cache(self):
        variants = [
            ({"Content-Range": "bytes 1-4/2048"}, 206, URL, "BAD_RANGE"),
            ({"Content-Range": "bytes 0-3/*"}, 206, URL, "BAD_RANGE"),
            ({"Content-Length": "3"}, 206, URL, "BAD_RANGE"),
            ({"Content-Encoding": "gzip"}, 206, URL, "BAD_RANGE"),
            ({}, 200, URL, "RANGE_UNSUPPORTED"),
            ({}, 206, "https://untrusted.test/secret", "UNSAFE_ASSET"),
        ]
        for headers, status, url, code in variants:
            with self.subTest(headers=headers, status=status, code=code):
                asset = self.asset(factory=lambda *args: Response(*args, headers=headers, status=status, url=url))
                with self.assertRaises(RangeError) as failure:
                    asset.fetch(0, 3)
                self.assertEqual(failure.exception.code, code)
                self.assertEqual(asset.opener.responses[-1].read_sizes, [])
                self.assertEqual(asset.telemetry_snapshot()["cache_entries"], 0)
                self.assert_reconciled(asset, 0)

    def test_missing_etag_after_pinned_etag_fails_closed(self):
        asset = self.asset()
        asset.fetch(0, 9)
        asset.opener.factory = lambda *args: Response(*args, headers={"ETag": None})
        with self.assertRaises(RangeError) as failure:
            asset.fetch(20, 29)
        self.assertEqual(failure.exception.code, "SOURCE_CHANGED")
        self.assert_reconciled(asset, 10)

    def test_truncation_accounts_partial_body_and_is_not_cached(self):
        asset = self.asset(factory=lambda payload, *args: Response(payload[:3], *args))
        with self.assertRaises(RangeError) as failure:
            asset.fetch(0, 9)
        self.assertEqual(failure.exception.code, "BAD_RANGE")
        self.assertEqual(asset.telemetry_snapshot()["cache_entries"], 0)
        self.assert_reconciled(asset, 3)
        with self.assertRaises(RangeError) as again:
            asset.fetch(0, 1)
        self.assertIs(again.exception, failure.exception)

    def test_real_truncated_http_chunk_conservatively_charges_hidden_payload(self):
        class Socket:
            def makefile(self, *_):
                return io.BytesIO(b"HTTP/1.1 206 Partial Content\r\n"
                    b"Content-Range: bytes 0-9/100\r\nContent-Length: 10\r\n"
                    b"Transfer-Encoding: chunked\r\n\r\nA\r\nabc")
        response = http.client.HTTPResponse(Socket())
        response.begin()
        response.geturl = lambda: URL
        asset = self.asset(factory=lambda *args: response)
        with self.assertRaises(RangeError) as failure:
            asset.fetch(0, 9)
        self.assertEqual(failure.exception.code, "BAD_RANGE")
        stats = asset.telemetry_snapshot()
        # http.client consumed 'abc' but exposes no partial payload to callers.
        self.assertEqual(stats["body_bytes_received"], 0)
        self.assertEqual(stats["unobserved_bytes_charged"], 10)
        self.assertEqual(stats["body_bytes_charged"], 10)
        self.assertEqual(asset.budget.transferred, 10)
        self.assertEqual(asset.budget.reserved, 0)
        self.assertEqual(stats["cache_entries"], 0)
        self.assertEqual(len(asset.opener.requests), 1)

    def test_read_oserror_counts_previously_received_body(self):
        class BrokenResponse(Response):
            def read(self, size=-1):
                if self.tell():
                    raise OSError("sensitive transport detail")
                return super().read(min(size, 3))
        asset = self.asset(factory=lambda *args: BrokenResponse(*args))
        with self.assertRaises(RangeError) as failure:
            asset.fetch(0, 9)
        self.assertEqual(failure.exception.code, "SOURCE_HTTP")
        self.assert_reconciled(asset, 3)
        self.assertEqual(asset.telemetry_snapshot()["cache_entries"], 0)

    def test_incomplete_read_counts_exception_partial_and_is_sticky(self):
        class IncompleteResponse(Response):
            def read(self, size=-1):
                if self.tell():
                    raise http.client.IncompleteRead(b"xy", size - 2)
                return super().read(min(size, 3))
        asset = self.asset(factory=lambda *args: IncompleteResponse(*args))
        with self.assertRaises(RangeError) as failure:
            asset.fetch(0, 9)
        self.assertEqual(failure.exception.code, "BAD_RANGE")
        self.assertEqual(asset.budget.transferred, 10)
        self.assertEqual(asset.budget.reserved, 0)
        self.assertEqual(asset.telemetry_snapshot()["body_bytes_received"], 5)
        self.assertEqual(asset.telemetry_snapshot()["unobserved_bytes_charged"], 5)
        self.assertEqual(asset.telemetry_snapshot()["body_bytes_charged"], 10)
        self.assertEqual(asset.telemetry_snapshot()["cache_entries"], 0)
        with self.assertRaises(RangeError) as again:
            asset.fetch(0, 0)
        self.assertIs(again.exception, failure.exception)

    def test_open_failure_counts_attempt_without_body_and_preserves_auth_code(self):
        for failure, code in ((error.URLError("sensitive network detail"), "SOURCE_HTTP"),
                              (error.HTTPError(URL, 403, "sensitive auth detail", {}, None), "EARTHDATA_AUTH")):
            with self.subTest(code=code):
                opener = MemoryOpener()
                with patch.object(opener, "open", side_effect=failure) as opened:
                    asset = self.asset(opener=opener)
                    with self.assertRaises(RangeError) as caught:
                        asset.fetch(0, 9)
                    self.assertEqual(caught.exception.code, code)
                    with self.assertRaises(RangeError):
                        asset.fetch(0, 9)
                    self.assertEqual(opened.call_count, 1)
                self.assertEqual(asset.telemetry_snapshot()["open_attempts"], 1)
                self.assert_reconciled(asset, 0)

    def test_invalid_requests_rejected_before_cache_and_do_not_poison_asset(self):
        asset = self.asset(data=b"abcdefghij")
        asset.fetch(0, 9)
        invalid = ((-1, 0), (4, 3), (0, MAX_RANGE_BYTES), (0.0, 1), ("0", 1),
                   (None, 1), (True, 1), (0, False))
        for start, end in invalid:
            with self.subTest(start=start, end=end):
                with self.assertRaises(RangeError) as failure:
                    asset.fetch(start, end)
                self.assertEqual(failure.exception.code, "RANGE_REQUIRED")
        self.assertIsNone(asset.error)
        self.assertEqual(asset.fetch(1, 1), b"b")
        self.assertEqual(asset.telemetry_snapshot()["requested_bytes"], 11)
        self.assertEqual(asset.telemetry_snapshot()["fetch_calls"], len(invalid) + 2)
        self.assert_reconciled(asset, 10)

    def test_integer_index_values_remain_supported(self):
        class Index:
            def __init__(self, value):
                self.value = value

            def __index__(self):
                return self.value
        asset = self.asset()
        self.assertEqual(asset.fetch(Index(0), Index(4)), DATA[:5])
        self.assertEqual(asset.fetch(Index(1), Index(3)), DATA[1:4])
        self.assert_reconciled(asset, 5)

    def test_range_validation_precedes_sticky_error(self):
        asset = self.asset(factory=lambda *args: Response(*args, status=200))
        with self.assertRaises(RangeError):
            asset.fetch(0, 9)
        with self.assertRaises(RangeError) as failure:
            asset.fetch(-1, 0)
        self.assertEqual(failure.exception.code, "RANGE_REQUIRED")
        self.assertEqual(asset.error.code, "RANGE_UNSUPPORTED")

    def test_concurrent_repeated_reads_share_single_fetch(self):
        asset = self.asset()
        barrier = threading.Barrier(8)
        def fetch():
            barrier.wait(timeout=5)
            return asset.fetch(100, 199)
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(fetch) for _ in range(8)]
            self.assertEqual([f.result(timeout=5) for f in futures], [DATA[100:200]] * 8)
        self.assertEqual(asset.telemetry_snapshot()["exact_cache_hits"], 7)
        self.assertEqual(asset.telemetry_snapshot()["open_attempts"], 1)
        self.assert_reconciled(asset, 100)

    def test_nested_reads_wait_for_inflight_container_and_snapshot_is_consistent(self):
        entered, release = threading.Event(), threading.Event()
        class BlockingOpener(MemoryOpener):
            def open(self, req, timeout=30):
                entered.set()
                if not release.wait(timeout=5):
                    raise AssertionError("Test failed to release upstream")
                return super().open(req, timeout)
        asset = self.asset(opener=BlockingOpener())
        ranges = [(100, 199), (120, 180), (100, 150), (199, 199)]
        with ThreadPoolExecutor(max_workers=6) as pool:
            first = pool.submit(asset.fetch, 100, 199)
            try:
                self.assertTrue(entered.wait(timeout=5))
                self.assertEqual(asset.budget.reserved, 100)
                started = [threading.Event() for _ in ranges]
                def fetch(interval, ready):
                    ready.set()
                    return asset.fetch(*interval)
                pending = [pool.submit(fetch, interval, ready) for interval, ready in zip(ranges, started)]
                snapshot = pool.submit(asset.telemetry_snapshot)
                self.assertTrue(all(ready.wait(timeout=5) for ready in started))
                self.assertFalse(snapshot.done())
            finally:
                release.set()
            self.assertEqual(first.result(timeout=5), DATA[100:200])
            self.assertEqual([f.result(timeout=5) for f in pending], [DATA[s:e + 1] for s, e in ranges])
            stats = snapshot.result(timeout=5)
        self.assertEqual(stats["open_attempts"], 1)
        self.assertEqual(stats["body_bytes_received"], 100)
        self.assertEqual(stats["cache_entries"], 1)
        self.assertEqual(stats["cache_bytes"], 100)
        self.assertEqual(asset.telemetry_snapshot()["containing_cache_hits"], 3)
        self.assert_reconciled(asset, 100)

    def test_telemetry_is_detached_numeric_bounded_and_contains_no_private_data(self):
        secret_url = URL.replace("test.h5", "sensitive-path.h5")
        secret = "opaque-secret-credential"
        opener = MemoryOpener()
        asset = RemoteAsset(secret_url, opener, TransferBudget())
        with patch.object(opener, "open", side_effect=OSError(secret)), \
             patch("service.range_reader.time.perf_counter_ns", side_effect=[0, 1000]):
            with self.assertRaises(RangeError):
                asset.fetch(1200, 1209)
        stats = asset.telemetry_snapshot()
        self.assertEqual(set(stats), {"fetch_calls", "requested_bytes", "exact_cache_hits",
            "containing_cache_hits", "cache_bytes_served", "open_attempts",
            "body_bytes_received", "unobserved_bytes_charged", "body_bytes_charged",
            "elapsed_fetch_seconds", "cache_entries", "cache_bytes"})
        serialized = json.dumps(stats, allow_nan=False)
        for private in (secret_url, "sensitive-path", secret, "1200", "1209", "SOURCE_HTTP"):
            self.assertNotIn(private, serialized)
        self.assertTrue(all(isinstance(value, (int, float)) and value >= 0 for value in stats.values()))
        stats["fetch_calls"] = -1
        self.assertEqual(asset.telemetry_snapshot()["fetch_calls"], 1)
        # Saturation is deterministic without running an impractical number of calls.
        with asset.lock:
            asset._telemetry = dict.fromkeys(asset._telemetry, MAX_TELEMETRY_VALUE)
        with self.assertRaises(RangeError):
            asset.fetch(0, 0)
        saturated = asset.telemetry_snapshot()
        self.assertTrue(all(value <= MAX_TELEMETRY_VALUE for value in saturated.values()))
        self.assertEqual(saturated["fetch_calls"], MAX_TELEMETRY_VALUE)
        self.assertEqual(saturated["requested_bytes"], MAX_TELEMETRY_VALUE)

    def test_elapsed_time_includes_hits_and_failures(self):
        asset = self.asset()
        with patch("service.range_reader.time.perf_counter_ns", side_effect=[0, 100, 200, 250, 300, 325]):
            asset.fetch(0, 9)
            asset.fetch(1, 2)
            with self.assertRaises(RangeError):
                asset.fetch(-1, 0)
        self.assertEqual(asset.telemetry_snapshot()["elapsed_fetch_seconds"], 175 / 1_000_000_000)


if __name__ == "__main__":
    unittest.main()
