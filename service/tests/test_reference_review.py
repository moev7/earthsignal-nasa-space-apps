"""Offline sampling/schema tests; CRS integration needs the GDAL runtime.

Core tests isolate the native CRS parser, not the sampler or review validator.
The separate native-CRS class never mocks the parser and explicitly skips when
GDAL is absent, so a local NumPy-only run does not imply verified CRS parsing.
"""
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import random
import unittest
from unittest.mock import patch

import numpy as np

from service.benchmarks import reference_review as rr
from service.observatory.methods import array_hash


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                    ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def rehash(packet):
    packet["packetHash"] = digest({k: v for k, v in packet.items() if k != "packetHash"})
    return packet


def grid(shape=(3, 5), crs="EPSG:32611"):
    return {"crs": crs, "transform": [702640.0, 20, 0, 3992980.0, 0, -20], "shape": list(shape)}


SOURCES = [{"id": "development-before", "observedAt": "2026-06-28T18:34:25.348000Z"},
           {"id": "development-after", "observedAt": "2026-07-03T18:34:25+00:00"}]
PINS = {name: char * 64 for name, char in zip(
    ("receipt", "metadata", "beforeArchive", "afterArchive"), "abcd")}


def decision(status="unreviewed", label="unknown", visibility="unknown"):
    return {"status": status, "label": label, "visibility": visibility,
            "reason": "Mixed cell; cannot assign a known target." if status == "reviewed" else "",
            "reviewedAt": "2026-10-14T10:00:00+03:30" if status == "reviewed" else None}


def review_for(packet):
    return {"schemaVersion": 1, "kind": rr.REVIEW_KIND, "packetHash": packet["packetHash"],
            "reviewerAlias": "reviewer-01", "reviews": [
                {"sampleId": s["id"], "before": decision(), "after": decision()}
                for s in packet["samples"]]}


class ReferenceReviewTests(unittest.TestCase):
    def setUp(self):
        # Only native CRS parsing is isolated; native integration has its own tests.
        self.parser = patch.object(rr, "_projected_metres", return_value=None)
        self.parser.start()
        self.addCleanup(self.parser.stop)
        self.before = np.array([[5, 6, 6, 4, 3], [4, 5, 6, 6, 0], [5, 6, 4, 11, 99]], dtype=np.int16)
        self.after = np.array([[6, 5, 6, 5, 6], [6, 6, 4, 6, 5], [4, 5, 5, 6, 99]], dtype=np.int16)
        self.aoi = np.ones((3, 5), dtype=np.uint8)
        self.aoi[2, 4] = 0  # invalid values outside AOI are not part of population

    def make(self, **changes):
        kwargs = {"grid": grid(), "sources": deepcopy(SOURCES), "source_pins": deepcopy(PINS),
                  "seed": 2718, "per_stratum": 2}
        kwargs.update(changes)
        return rr.make_packet(self.before, self.after, self.aoi, **kwargs)

    def test_complete_population_partition_including_unknown_and_zero_strata(self):
        packet, audit = self.make()
        # Explicit cell-by-cell oracle (the selected area actually has 14 cells).
        oracle = {"gain": {(0, 0), (1, 0), (1, 1)}, "loss": {(0, 1), (1, 2), (2, 1)},
                  "water_both": {(0, 2), (1, 3)}, "non_water_both": {(0, 3), (2, 0), (2, 2)},
                  "unknown": {(0, 4), (1, 4), (2, 3)}}
        expected = {name: len(cells) for name, cells in oracle.items()}
        self.assertEqual(audit["populationCount"], 14)
        self.assertEqual({name: s["N_h"] for name, s in audit["strata"].items()}, expected)
        for name, cells in oracle.items():
            selected = {(c["row"], c["col"]) for c in audit["samples"] if c["stratum"] == name}
            self.assertTrue(selected.issubset(cells))
            self.assertEqual(len(selected), min(2, len(cells)))
        self.assertNotIn("population", audit)
        self.assertEqual(sum(s["N_h"] for s in audit["strata"].values()), 14)
        self.assertEqual(len(packet["samples"]), 10)
        self.before[:] = 5
        self.after[:] = 5
        _, audit = self.make()
        for name in ("gain", "loss", "water_both", "unknown"):
            self.assertEqual(audit["strata"][name], {"N_h": 0, "n_h": 0,
                             "selectionProbability": None, "designWeight": None})
        self.aoi[:] = 0
        packet, audit = self.make()
        self.assertEqual(packet["samples"], [])
        self.assertEqual(audit["populationCount"], 0)
        self.assertEqual(rr.validate_review(packet, review_for(packet))["counts"]["attempted"], 0)

    def test_seeded_sampling_repeatability_allocation_probability_and_no_replacement(self):
        packet, audit = self.make(per_stratum=1)
        self.assertEqual((packet, audit), self.make(per_stratum=1))
        self.assertNotEqual(packet, self.make(seed=2719, per_stratum=1)[0])
        oracle_rng = random.Random(2718)
        populations = {"gain": [0, 5, 6], "loss": [1, 7, 11],
                       "water_both": [2, 8], "non_water_both": [3, 10, 12],
                       "unknown": [4, 9, 13]}
        for name, stats in audit["strata"].items():
            indices = populations[name]
            expected = set(oracle_rng.sample(indices, min(1, len(indices))))
            selected = [c for c in audit["samples"] if c["stratum"] == name]
            self.assertEqual({c["row"] * 5 + c["col"] for c in selected}, expected)
            self.assertEqual(stats["n_h"], 1)
            self.assertEqual(stats["selectionProbability"], 1 / len(indices))
            self.assertEqual(stats["designWeight"], len(indices))
            self.assertEqual(selected[0]["selectionProbability"], stats["selectionProbability"])
        self.assertEqual(len({s["id"] for s in packet["samples"]}), len(packet["samples"]))
        self.assertEqual(len({(s["row"], s["col"]) for s in packet["samples"]}), len(packet["samples"]))
        _, audit = self.make(per_stratum=64)
        self.assertEqual(len(audit["samples"]), 14)
        self.assertTrue(all(s["selectionProbability"] == s["designWeight"] == 1 for s in audit["strata"].values()))
        self.assertEqual(audit["sampling"]["algorithm"], rr.SAMPLING_ALGORITHM)
        self.assertEqual(audit["sampling"]["orderAlgorithm"], rr.ORDER_ALGORITHM)
        self.assertTrue(audit["sampling"]["pythonVersion"])

    def test_hashes_native_coordinates_and_detached_outputs(self):
        g, sources, pins = grid(), deepcopy(SOURCES), deepcopy(PINS)
        original = (self.before.copy(), self.after.copy(), self.aoi.copy())
        packet, audit = self.make(grid=g, sources=sources, source_pins=pins)
        self.assertEqual(packet["packetHash"], digest({k: v for k, v in packet.items() if k != "packetHash"}))
        self.assertEqual(audit["auditHash"], digest({k: v for k, v in audit.items() if k != "auditHash"}))
        self.assertEqual(audit["packetHash"], packet["packetHash"])
        self.assertEqual(audit["inputHashes"], {"before_scl": array_hash(self.before),
                         "after_scl": array_hash(self.after), "aoi": array_hash(self.aoi)})
        sample = packet["samples"][0]
        t = packet["grid"]["transform"]
        self.assertEqual(t[0] + (sample["col"] + .5) * t[1], 702650 + sample["col"] * 20)
        self.assertEqual(t[3] + (sample["row"] + .5) * t[5], 3992970 - sample["row"] * 20)
        g["shape"][0] = 999
        sources[0]["id"] = "changed"
        pins["receipt"] = "f" * 64
        self.assertEqual(rr.validate_packet(packet), packet)
        detached = rr.validate_packet(packet)
        detached["samples"].clear()
        self.assertTrue(packet["samples"])
        for current, prior in zip((self.before, self.after, self.aoi), original):
            np.testing.assert_array_equal(current, prior)
        self.aoi[0, 0] = 0
        self.assertNotEqual(self.make()[1]["inputHashes"]["aoi"], audit["inputHashes"]["aoi"])
        self.before[0, 0] = 4
        self.assertNotEqual(self.make()[1]["inputHashes"]["before_scl"], audit["inputHashes"]["before_scl"])

    def test_verified_frozen_window_population_reconciles_without_truth_claims(self):
        from service.verify_optical_reference import ROOT, verify

        verified = verify()  # Existing frozen hashes and population checks, not field truth.
        receipt_raw = (ROOT / "receipt.json").read_bytes()
        receipt = json.loads(receipt_raw)
        records = receipt["results"]
        with np.load(ROOT / "before.npz", allow_pickle=False) as before:
            b, area = before["scl"].copy(), before["scl_aoi"].copy()
        with np.load(ROOT / "after.npz", allow_pickle=False) as after:
            a = after["scl"].copy()
        native = {k: records[0]["bands"]["scl"][k] for k in ("crs", "transform", "shape")}
        sources = [{"id": r["itemId"], "observedAt": r["observedAt"]} for r in records]
        pins = {"receipt": hashlib.sha256(receipt_raw).hexdigest(),
                "metadata": hashlib.sha256((ROOT / "source-items.json").read_bytes()).hexdigest(),
                "beforeArchive": records[0]["archiveHash"], "afterArchive": records[1]["archiveHash"]}
        packet, audit = rr.make_packet(b, a, area, grid=native, sources=sources, source_pins=pins,
                                      seed=20261014, per_stratum=8)
        self.assertEqual(audit["populationCount"], 2499)
        self.assertEqual(audit["strata"]["unknown"]["N_h"], verified["uncertainOpticalPixels"])
        self.assertEqual(sum(s["N_h"] for name, s in audit["strata"].items() if name != "unknown"),
                         verified["commonOpticalKnownPixels"])
        matrix = verified["sclTransitions"]
        self.assertEqual(audit["strata"]["gain"]["N_h"], matrix["4->6"] + matrix["5->6"])
        self.assertEqual(audit["strata"]["loss"]["N_h"], matrix["6->4"] + matrix["6->5"])
        self.assertEqual(audit["strata"]["water_both"]["N_h"], matrix["6->6"])
        self.assertEqual(len(packet["samples"]), 40)
        self.assertEqual(rr.validate_review(packet, review_for(packet))["counts"]["unreviewed"], 80)

    def test_public_packet_has_no_classifier_or_allocation_leakage(self):
        packet, audit = self.make(per_stratum=1)
        self.assertEqual(set(packet), {"schemaVersion", "kind", "methodVersion", "developmentOnly", "grid",
                                     "sources", "source_pins", "samples", "responseDefinition", "limits", "packetHash"})
        for sample in packet["samples"]:
            self.assertEqual(set(sample), {"id", "row", "col"})
            self.assertRegex(sample["id"], r"^s-[0-9a-f]{32}$")
        serialized = json.dumps(packet)
        for forbidden in ("beforeClass", "afterClass", '"stratum"', '"strata"', '"seed"',
                          '"perStratum"', '"selectionProbability"', '"designWeight"', '"prediction"'):
            self.assertNotIn(forbidden, serialized)
        self.assertNotEqual([s["stratum"] for s in audit["samples"]], list(rr.STRATA))
        self.assertEqual([(s["id"], s["row"], s["col"]) for s in audit["samples"]],
                         [(s["id"], s["row"], s["col"]) for s in packet["samples"]])
        self.assertTrue(audit["private"])

    def test_partial_review_and_reviewed_uncertainty_are_distinct(self):
        packet, _ = self.make()
        review = review_for(packet)
        review["reviews"][0]["before"] = decision("reviewed", "unknown", "unobservable")
        review["reviews"][0]["after"] = decision("reviewed", "water", "observable")
        review["reviews"][1]["before"] = decision("reviewed", "non_water", "observable")
        review["reviews"][1]["after"] = decision("reviewed", "unknown", "unknown")
        summary = rr.validate_review(packet, review)
        self.assertEqual(summary["counts"], {"attempted": 20, "reviewed": 4, "water": 1,
                         "non_water": 1, "unknown": 2, "unreviewed": 16,
                         "visibility": {"observable": 2, "unobservable": 1, "unknown": 17}})
        self.assertEqual(summary["endpointCounts"]["before"]["reviewed"], 2)
        self.assertEqual(summary["endpointCounts"]["after"]["water"], 1)
        self.assertEqual(summary["review"], review)
        self.assertEqual(summary["reviewHash"], digest(review))
        review["reviews"][0]["before"]["reason"] = "Modified later"
        self.assertNotEqual(summary["review"], review)
        self.assertEqual(set(summary), {"schemaVersion", "kind", "methodVersion", "developmentOnly",
                                       "packetHash", "reviewHash", "counts", "endpointCounts", "review"})

    def test_visibility_contradictions_and_unreviewed_contradictions_fail(self):
        packet, _ = self.make()
        for label in ("water", "non_water"):
            for visibility in ("unknown", "unobservable"):
                review = review_for(packet)
                review["reviews"][0]["before"] = decision("reviewed", label, visibility)
                with self.subTest(label=label, visibility=visibility), self.assertRaises(ValueError):
                    rr.validate_review(packet, review)
        for key, value in (("reason", "Touched"), ("reviewedAt", "2026-10-14T10:00:00Z"),
                           ("visibility", "observable"), ("label", "non_water")):
            review = review_for(packet)
            review["reviews"][0]["before"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                rr.validate_review(packet, review)
        for visibility in rr.VISIBILITIES:
            review = review_for(packet)
            review["reviews"][0]["before"] = decision("reviewed", "unknown", visibility)
            self.assertEqual(rr.validate_review(packet, review)["counts"]["unknown"], 1)

    def test_packet_tamper_hash_extra_fields_duplicates_bounds_and_bools(self):
        packet, _ = self.make()
        mutations = [lambda p: p["sources"][0].update(id="tampered"),
                     lambda p: p.update(extra="not allowed"),
                     lambda p: p.update(schemaVersion=True),
                     lambda p: p.update(developmentOnly=1),
                     lambda p: p["samples"][0].update(row=True),
                     lambda p: p["samples"][0].update(col=5),
                     lambda p: p["samples"][0].update(row=-1),
                     lambda p: p["samples"][0].update(id="gain-1"),
                     lambda p: p["samples"][1].update(id=p["samples"][0]["id"]),
                     lambda p: p["samples"][1].update(row=p["samples"][0]["row"], col=p["samples"][0]["col"]),
                     lambda p: p["samples"][0].update(stratum="gain"),
                     lambda p: p["responseDefinition"].update(water="SCL6 means truth"),
                     lambda p: p["limits"].update(maxSamples=True),
                     lambda p: p.update(packetHash="e" * 64)]
        for index, mutate in enumerate(mutations):
            p = deepcopy(packet)
            mutate(p)
            with self.subTest(index=index), self.assertRaises(ValueError):
                rr.validate_packet(p)
            if index not in (0, 13):
                rehash(p)  # Even a recomputed hash cannot bypass the schema.
                with self.subTest(index=index, rehashed=True), self.assertRaises(ValueError):
                    rr.validate_packet(p)

    def test_review_foreign_missing_duplicate_and_extra_fields(self):
        packet, _ = self.make()
        mutations = [lambda r: r.update(packetHash="f" * 64),
                     lambda r: r["reviews"].pop(),
                     lambda r: r["reviews"].append(deepcopy(r["reviews"][0])),
                     lambda r: r["reviews"][0].update(sampleId="s-" + "f" * 32),
                     lambda r: r["reviews"][1].update(sampleId=r["reviews"][0]["sampleId"]),
                     lambda r: r.update(schemaVersion=True),
                     lambda r: r.update(sourceId="untrusted truth"),
                     lambda r: r["reviews"][0].update(truth=True),
                     lambda r: r["reviews"][0]["before"].update(extra="invalid"),
                     lambda r: r["reviews"][0].update(sampleId=True),
                     lambda r: r["reviews"][0]["before"].update(label=True),
                     lambda r: r["reviews"][0]["before"].update(visibility=float("nan")),
                     lambda r: r["reviews"][0]["before"].update(status={}),
                     lambda r: r.update(reviews=tuple(r["reviews"]))]
        for index, mutate in enumerate(mutations):
            review = review_for(packet)
            mutate(review)
            with self.subTest(index=index), self.assertRaises(ValueError):
                rr.validate_review(packet, review)
        r = review_for(packet)
        r["reviews"].reverse()  # exact coverage, independent of input review order
        self.assertEqual(rr.validate_review(packet, r)["counts"]["unreviewed"], 20)

    def test_invalid_source_identity_pins_and_strict_aware_increasing_times(self):
        for timestamp in ("2026-07-03", "2026-07-03T18:34:25", "2026-07-03 18:34:25Z",
                          "2026-02-30T10:00:00Z", "2026-07-03T18:34:25-00:00",
                          "2026-07-03T18:34:25+24:00", True, None, "2026-07-03T18:34:25.1234567Z"):
            sources = deepcopy(SOURCES)
            sources[1]["observedAt"] = timestamp
            with self.subTest(timestamp=timestamp), self.assertRaises(ValueError):
                self.make(sources=sources)
        for sources in (SOURCES[::-1], [SOURCES[0]], SOURCES + [SOURCES[1]], tuple(SOURCES),
                        [SOURCES[0], {**SOURCES[1], "id": SOURCES[0]["id"]}],
                        [SOURCES[0], {**SOURCES[1], "observedAt": SOURCES[0]["observedAt"]}],
                        [{**SOURCES[0], "extra": 1}, SOURCES[1]],
                        [{**SOURCES[0], "id": " padded "}, SOURCES[1]]):
            with self.subTest(sources=sources), self.assertRaises(ValueError):
                self.make(sources=deepcopy(sources))
        sources = deepcopy(SOURCES)
        sources[1]["observedAt"] = "2026-06-28T20:34:25.348000+02:00"  # same instant
        with self.assertRaises(ValueError):
            self.make(sources=sources)
        for pins in ({**PINS, "extra": "a" * 64}, {k: v for k, v in PINS.items() if k != "receipt"},
                     {**PINS, "receipt": "A" * 64}, {**PINS, "receipt": "a" * 63},
                     {**PINS, "metadata": True}, {**PINS, "receipt": "a" * 65}):
            with self.subTest(pins=pins), self.assertRaises(ValueError):
                self.make(source_pins=pins)

    def test_grid_shapes_native_affine_and_nonfinite_numbers(self):
        mutations = [lambda g: g.update(shape=[True, 5]), lambda g: g.update(shape=[3, 4]),
                     lambda g: g.update(shape=[0, 5]), lambda g: g.update(shape=[1001, 1000]),
                     lambda g: g.update(shape=(3, 5)), lambda g: g.update(extra="invalid"),
                     lambda g: g.update(crs=""), lambda g: g.update(crs=True),
                     lambda g: g["transform"].__setitem__(1, 10),
                     lambda g: g["transform"].__setitem__(2, .1),
                     lambda g: g["transform"].__setitem__(4, .1),
                     lambda g: g["transform"].__setitem__(5, 20),
                     lambda g: g["transform"].__setitem__(0, float("inf")),
                     lambda g: g["transform"].__setitem__(0, float("nan")),
                     lambda g: g["transform"].__setitem__(2, False),
                     lambda g: g["transform"].__setitem__(0, 1e100),
                     lambda g: g["transform"].__setitem__(0, 10**1000),
                     lambda g: g.update(transform=[0, 20, 0, 0, 0])]
        for index, mutate in enumerate(mutations):
            g = grid()
            mutate(g)
            with self.subTest(index=index), self.assertRaises(ValueError):
                self.make(grid=g)

    def test_array_type_shape_class_domain_binary_mask_and_explicit_sampling_parameters(self):
        kwargs = dict(grid=grid(), sources=SOURCES, source_pins=PINS, seed=0, per_stratum=1)
        for name, value in (("seed", True), ("seed", -1), ("seed", 2**32), ("seed", 1.5),
                            ("seed", np.int64(1)), ("per_stratum", True), ("per_stratum", 0),
                            ("per_stratum", 65), ("per_stratum", "2")):
            with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                rr.make_packet(self.before, self.after, self.aoi, **{**kwargs, name: value})
        with self.assertRaises(TypeError):
            rr.make_packet(self.before, self.after, self.aoi, grid=grid(), sources=SOURCES, source_pins=PINS)
        arrays = [(self.before.tolist(), self.after, self.aoi),
                  (self.before.astype(float), self.after, self.aoi),
                  (self.before.astype(bool), self.after, self.aoi),
                  (self.before, self.after[0], self.aoi),
                  (self.before, self.after, self.aoi.astype(float)),
                  (self.before, self.after[:, :4], self.aoi),
                  (np.empty((0, 5), dtype="u1"), np.empty((0, 5), dtype="u1"), np.empty((0, 5), dtype="u1")),
                  (np.zeros((1001, 1000), dtype="u1"), self.after, self.aoi)]
        for index, values in enumerate(arrays):
            with self.subTest(index=index), self.assertRaises(ValueError):
                rr.make_packet(*values, **kwargs)
        for value in (-1, 12, 999):
            before = self.before.copy()
            before[0, 0] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                rr.make_packet(before, self.after, self.aoi, **kwargs)
        area = self.aoi.copy()
        area[0, 0] = 2
        with self.assertRaises(ValueError):
            rr.make_packet(self.before, self.after, area, **kwargs)
        # Bool mask is permitted, and unsigned/signed integer SCL are permitted.
        rr.make_packet(self.before.astype("u1"), self.after, self.aoi.astype(bool), **kwargs)
        # Every valid-but-unclear source class remains in the unknown population.
        self.before = np.arange(12, dtype="u1").reshape(3, 4)
        self.after = np.full((3, 4), 6, dtype="u1")
        self.aoi = np.ones((3, 4), dtype="u1")
        _, audit = self.make(grid=grid((3, 4)))
        self.assertEqual(audit["strata"]["unknown"]["N_h"], 9)

    def test_review_alias_reason_time_and_aggregate_text_bounds(self):
        packet, _ = self.make()
        for alias in ("", " padded ", "a" * 65, "a\nb", True, "\x00", "\ud800"):
            review = review_for(packet)
            review["reviewerAlias"] = alias
            with self.subTest(alias=repr(alias)), self.assertRaises(ValueError):
                rr.validate_review(packet, review)
        for reason in ("", " padded ", "a" * 1001, "a\nb", None, True):
            review = review_for(packet)
            review["reviews"][0]["before"] = decision("reviewed")
            review["reviews"][0]["before"]["reason"] = reason
            with self.subTest(reason=reason), self.assertRaises(ValueError):
                rr.validate_review(packet, review)
        for time in (None, True, "2026-10-14", "2026-10-14T10:00:00", "2026-02-30T10:00:00Z"):
            review = review_for(packet)
            review["reviews"][0]["before"] = decision("reviewed")
            review["reviews"][0]["before"]["reviewedAt"] = time
            with self.subTest(time=time), self.assertRaises(ValueError):
                rr.validate_review(packet, review)
        self.before = np.tile(np.array([5, 6, 6, 5, 0], dtype="u1"), (64, 1))
        self.after = np.tile(np.array([6, 5, 6, 5, 6], dtype="u1"), (64, 1))
        self.aoi = np.ones((64, 5), dtype="u1")
        packet, _ = self.make(grid=grid((64, 5)), per_stratum=64)
        self.assertEqual(len(packet["samples"]), rr.MAX_SAMPLES)
        review = review_for(packet)
        for entry in review["reviews"]:
            for side in ("before", "after"):
                entry[side] = decision("reviewed")
                entry[side]["reason"] = "a" * 1000
        self.assertEqual(rr.validate_review(packet, review)["counts"]["reviewed"], 640)
        for entry in review["reviews"]:
            for side in ("before", "after"):
                entry[side]["reason"] = "水" * 1000  # <=1000 characters, >1MiB aggregate UTF-8
        with self.assertRaisesRegex(ValueError, "aggregate text"):
            rr.validate_review(packet, review)
        oversized = deepcopy(packet)
        oversized["samples"].append(deepcopy(packet["samples"][0]))
        with self.assertRaises(ValueError):
            rr.validate_packet(rehash(oversized))
        bad = deepcopy(packet)
        bad["extra"] = "x" * (rr.MAX_TEXT_BYTES + 1)
        with self.assertRaisesRegex(ValueError, "aggregate text"):
            rr.validate_packet(bad)


@unittest.skipUnless(importlib.util.find_spec("osgeo"), "GDAL/OSR absent: native CRS integration unverified")
class NativeReferenceReviewCRSTests(unittest.TestCase):
    def make(self, crs):
        array = np.array([[6]], dtype="u1")
        return rr.make_packet(array, array, np.ones_like(array), grid=grid((1, 1), crs),
                              sources=SOURCES, source_pins=PINS, seed=0, per_stratum=1)

    def test_actual_projected_metre_epsg_and_frozen_wkt(self):
        packet, _ = self.make("EPSG:32611")
        self.assertEqual(rr.validate_packet(packet), packet)
        root = Path(__file__).resolve().parents[2]
        receipt = json.loads((root / "examples/optical-reference-development/receipt.json").read_text())
        crs = receipt["results"][0]["bands"]["scl"]["crs"]
        packet, _ = self.make(crs)
        self.assertEqual(rr.validate_packet(packet), packet)

    def test_geographic_feet_geocentric_invalid_and_file_crs_fail_closed(self):
        for crs in ("EPSG:4326", "EPSG:2227", "EPSG:4978", "EPSG:999999", "EPSG:0",
                    "/tmp/arbitrary.wkt", "https://example.invalid/crs", "PROJCS[broken]", "EPSG:32611 "):
            with self.subTest(crs=crs), self.assertRaises(ValueError):
                self.make(crs)


if __name__ == "__main__":
    unittest.main()
