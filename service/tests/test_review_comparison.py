"""Synthetic software fixtures only: no collected human labels or field truth.

Only the native CRS parser is isolated in unit tests because local GDAL is
absent. All schema, hash, type, time, text, decision and comparison checks are
real. Separate native tests explicitly skip without osgeo; these unit results
do not establish native CRS integration, calibration or independence.
"""
from copy import deepcopy
import hashlib
import importlib.util
import json
import unittest
from unittest.mock import patch

from service.benchmarks import reference_review as rr
from service.benchmarks import review_comparison as rc


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def rehash(packet):
    packet["packetHash"] = digest({k: v for k, v in packet.items() if k != "packetHash"})
    return packet


def synthetic_packet(n=18):
    return rehash({
        "schemaVersion": 1, "kind": rr.PACKET_KIND, "methodVersion": rr.METHOD_VERSION,
        "developmentOnly": True,
        "grid": {"crs": "EPSG:32611", "transform": [702640.0, 20, 0, 3992980.0, 0, -20],
                 "shape": [1, max(n, 1)]},
        "sources": [{"id": "synthetic-before", "observedAt": "2026-06-28T18:34:25.348000Z"},
                    {"id": "synthetic-after", "observedAt": "2026-07-03T20:34:25+02:00"}],
        "source_pins": {name: char * 64 for name, char in zip(
            ("receipt", "metadata", "beforeArchive", "afterArchive"), "abcd")},
        "samples": [{"id": f"s-{i + 1:032x}", "row": 0, "col": i} for i in range(n)],
        "responseDefinition": deepcopy(rr.RESPONSE_DEFINITION), "limits": deepcopy(rr.LIMITS),
    })


# Six valid decision states, deliberately defined independently of production.
STATE_TRIPLES = (("unreviewed", "unknown", "unknown"),
                 ("reviewed", "unknown", "unobservable"),
                 ("reviewed", "unknown", "unknown"),
                 ("reviewed", "unknown", "observable"),
                 ("reviewed", "water", "observable"),
                 ("reviewed", "non_water", "observable"))


def synthetic_decision(state=0, token="A"):
    status, label, visibility = STATE_TRIPLES[state]
    return {"status": status, "label": label, "visibility": visibility,
            "reason": f"Synthetic software fixture {token}; no human observation." if state else "",
            "reviewedAt": "2026-10-14T10:00:00.123456+03:30" if state else None}


def synthetic_review(packet, alias="synthetic-A", states=None):
    if states is None:
        states = [0] * (2 * len(packet["samples"]))
    return {"schemaVersion": 1, "kind": rr.REVIEW_KIND, "packetHash": packet["packetHash"],
            "reviewerAlias": alias, "reviews": [
                {"sampleId": sample["id"],
                 "before": synthetic_decision(states[2 * i], f"{alias}-{i}-before"),
                 "after": synthetic_decision(states[2 * i + 1], f"{alias}-{i}-after")}
                for i, sample in enumerate(packet["samples"])]}


class ReviewComparisonTests(unittest.TestCase):
    def setUp(self):
        self.parser = patch.object(rr, "_projected_metres", return_value=None)
        self.crs_parser = self.parser.start()
        self.addCleanup(self.parser.stop)

    def all_pairs(self):
        packet = synthetic_packet()
        return packet, synthetic_review(packet, states=[i for i in range(6) for _ in range(6)]), \
            synthetic_review(packet, "synthetic-B", [j for _ in range(6) for j in range(6)])

    def test_all_36_pairs_independent_hand_pinned_oracle_and_joint_counts(self):
        packet, left, right = self.all_pairs()
        artifact = rc.compare_reviews(packet, left, right)
        # Explicit oracle, not a reimplementation of production conditionals.
        p, n, u, d, s = "pending", "not_observable", "uncertain", "different_labels", "same_label"
        oracle = [[p, p, p, p, p, p], [p, n, n, n, n, n],
                  [p, n, u, u, u, u], [p, n, u, u, u, u],
                  [p, n, u, u, s, d], [p, n, u, u, d, s]]
        self.assertEqual([r["status"] for r in artifact["rows"]], [v for row in oracle for v in row])
        self.assertEqual(artifact["counts"], {
            "expectedEndpointSlots": 36, "allSlots": 36, "comparableKnownSlots": 4,
            "primary": {p: 11, n: 9, u: 12, d: 2, s: 2}})
        self.assertEqual(artifact["jointCounts"]["leftByRight"], [[1] * 6 for _ in range(6)])
        self.assertEqual(artifact["jointCounts"]["stateOrder"], [
            "unreviewed", "reviewed_unobservable", "reviewed_unknown_visibility",
            "reviewed_observable_unknown", "reviewed_water", "reviewed_non_water"])
        self.assertEqual(artifact["jointCounts"]["denominator"], "allSlots")
        # Only known reviewed visibility states may disagree: 1 vs 3/4/5.
        flagged_pairs = {(1, 3), (1, 4), (1, 5), (3, 1), (4, 1), (5, 1)}
        self.assertEqual([r["knownVisibilityDisagreement"] for r in artifact["rows"]],
                         [(i, j) in flagged_pairs for i in range(6) for j in range(6)])
        self.assertEqual(artifact["flagCounts"], {"knownVisibilityDisagreement": 6})
        self.assertIn("Overlapping", artifact["flagCountSemantics"])
        for key, value in artifact["counts"]["primary"].items():
            self.assertEqual(sum(e[key] for e in artifact["endpointCounts"].values()), value)
        self.assertEqual(sum(artifact["counts"]["primary"].values()), 36)

    def test_per_date_raw_decisions_coordinates_sources_and_times_preserved(self):
        packet, left, right = self.all_pairs()
        artifact = rc.compare_reviews(packet, left, right)
        for i, sample in enumerate(packet["samples"]):
            for k, side in enumerate(("before", "after")):
                row = artifact["rows"][2 * i + k]
                self.assertEqual((row["sampleId"], row["row"], row["col"], row["side"]),
                                 (sample["id"], sample["row"], sample["col"], side))
                self.assertEqual((row["sourceId"], row["observedAt"]),
                                 (packet["sources"][k]["id"], packet["sources"][k]["observedAt"]))
                self.assertEqual(row["left"], left["reviews"][i][side])
                self.assertEqual(row["right"], right["reviews"][i][side])
                self.assertIsNot(row["left"], left["reviews"][i][side])
        for key in ("grid", "sources", "source_pins"):
            self.assertEqual(artifact[key], packet[key])
            self.assertIsNot(artifact[key], packet[key])
        for side, original in (("left", left), ("right", right)):
            self.assertEqual(artifact["inputs"][side]["reviewHash"], digest(original))
            self.assertEqual(artifact["inputs"][side]["reviewerAlias"], original["reviewerAlias"])
        self.assertEqual(artifact["inputs"]["left"]["position"], "A")
        self.assertEqual(artifact["inputs"]["right"]["position"], "B")

    def test_review_entry_permutations_and_swaps(self):
        packet = synthetic_packet(3)
        left = synthetic_review(packet, states=[1, 0, 4, 2, 4, 3])
        right = synthetic_review(packet, "synthetic-B", [5, 5, 4, 2, 5, 1])
        artifact = rc.compare_reviews(packet, left, right)
        permuted = deepcopy(left)
        permuted["reviews"] = permuted["reviews"][1:] + permuted["reviews"][:1]
        reversed_right = deepcopy(right)
        reversed_right["reviews"].reverse()
        other = rc.compare_reviews(packet, permuted, reversed_right)
        self.assertEqual(artifact["rows"], other["rows"])
        self.assertEqual(artifact["counts"], other["counts"])
        self.assertEqual(artifact["jointCounts"], other["jointCounts"])
        self.assertNotEqual(artifact["inputs"], other["inputs"])  # Raw review order is hashed.
        swapped = rc.compare_reviews(packet, right, left)
        for key in ("counts", "endpointCounts", "flagCounts"):
            self.assertEqual(artifact[key], swapped[key])
        self.assertEqual(swapped["jointCounts"]["leftByRight"],
                         [list(row) for row in zip(*artifact["jointCounts"]["leftByRight"])])
        for old, new in zip(artifact["rows"], swapped["rows"]):
            self.assertEqual(new, {**old, "left": old["right"], "right": old["left"]})
        self.assertEqual(swapped["inputs"]["left"]["reviewHash"], artifact["inputs"]["right"]["reviewHash"])
        self.assertNotEqual(swapped["comparisonHash"], artifact["comparisonHash"])
        # Packet sample order governs rows; validators permit arbitrary review order.
        reordered = deepcopy(packet)
        reordered["samples"].reverse()
        rehash(reordered)
        l2, r2 = deepcopy(left), deepcopy(right)
        l2["packetHash"] = r2["packetHash"] = reordered["packetHash"]
        result = rc.compare_reviews(reordered, l2, r2)
        self.assertEqual(result["counts"], artifact["counts"])
        self.assertEqual([r["sampleId"] for r in result["rows"]],
                         [s["id"] for s in reordered["samples"] for _ in range(2)])

    def test_empty_selection_has_explicit_status_and_zero_denominators(self):
        packet = synthetic_packet(0)
        result = rc.compare_reviews(packet, synthetic_review(packet), synthetic_review(packet, "synthetic-B"))
        self.assertEqual(result["status"], "no-selected-cells")
        self.assertEqual(result["rows"], [])
        self.assertEqual(result["counts"], {"expectedEndpointSlots": 0, "allSlots": 0,
                         "comparableKnownSlots": 0, "primary": {s: 0 for s in rc.PRIMARY_STATUSES}})
        self.assertEqual(result["flagCounts"]["knownVisibilityDisagreement"], 0)
        self.assertEqual(sum(map(sum, result["jointCounts"]["leftByRight"])), 0)

    def test_alias_nfc_ascii_collisions_and_documented_unicode_noncollisions(self):
        packet = synthetic_packet(1)
        for a, b in (("Alice", "alice"), ("aLIce", "ALICE"), ("Cafe\u0301", "Café"),
                     ("ÉA", "E\u0301a"), ("\u212bA", "Åa")):
            with self.subTest(a=a, b=b), self.assertRaisesRegex(ValueError, "normalized reviewer aliases"):
                rc.compare_reviews(packet, synthetic_review(packet, a), synthetic_review(packet, b))
        # ASCII-only convention intentionally does not fold these aliases.
        for a, b in (("É", "é"), ("Straße", "STRASSE"), ("Σ", "σ"), ("İ", "i"), ("Ａ", "ａ")):
            with self.subTest(a=a, b=b):
                result = rc.compare_reviews(packet, synthetic_review(packet, a), synthetic_review(packet, b))
                self.assertFalse(result["independenceEstablished"])
                self.assertIn("not full Unicode caseless", " ".join(result["limitations"]))
        same = synthetic_review(packet)
        with self.assertRaisesRegex(ValueError, "canonical review hashes"):
            rc.compare_reviews(packet, same, deepcopy(same))
        reordered_keys = {key: same[key] for key in reversed(same)}
        with self.assertRaisesRegex(ValueError, "canonical review hashes"):
            rc.compare_reviews(packet, same, reordered_keys)

    def test_no_mutation_deterministic_hash_self_exclusion_and_detachment(self):
        packet, left, right = self.all_pairs()
        originals = deepcopy((packet, left, right))
        result = rc.compare_reviews(packet, left, right)
        self.assertEqual(result, rc.compare_reviews(packet, left, right))
        self.assertEqual((packet, left, right), originals)
        self.assertEqual(result["comparisonHash"], digest({k: v for k, v in result.items() if k != "comparisonHash"}))
        self.assertEqual(json.loads(canonical(result)), result)
        result["rows"][0]["left"]["label"] = "water"
        result["grid"]["shape"][0] = 999
        result["sources"][0]["id"] = "changed"
        result["source_pins"]["receipt"] = "f" * 64
        result["inputs"]["left"]["reviewerAlias"] = "changed"
        self.assertEqual((packet, left, right), originals)
        stable = rc.compare_reviews(packet, left, right)
        revised = deepcopy(right)
        revised["reviews"][0]["after"]["reason"] = "Synthetic changed reason, unchanged interpretation."
        revised["reviews"][0]["after"]["reviewedAt"] = "2026-10-14T10:01:00+03:30"
        changed = rc.compare_reviews(packet, left, revised)
        self.assertEqual(stable["counts"], changed["counts"])
        self.assertNotEqual(stable["comparisonHash"], changed["comparisonHash"])
        self.assertNotEqual(stable["inputs"]["right"]["reviewHash"], changed["inputs"]["right"]["reviewHash"])
        left["reviews"][0]["before"]["label"] = "water"
        self.assertEqual(stable["rows"][0]["left"]["label"], "unknown")

    def test_no_truth_metrics_or_machine_fields_and_no_unknown_agreement(self):
        packet, left, right = self.all_pairs()
        result = rc.compare_reviews(packet, left, right)
        self.assertEqual((result["schemaVersion"], result["methodVersion"], result["kind"]),
                         (1, "optical-review-comparison-v1", "optical-image-review-comparison"))
        self.assertTrue(result["developmentOnly"])
        self.assertTrue(result["private"])
        for field in ("independenceEstablished", "fieldTruthEstablished", "accuracyEstimated",
                      "areaAdjusted", "adjudicationPerformed"):
            self.assertIs(result[field], False)
        forbidden = {"accuracy", "kappa", "percentage", "percentages", "agreementRate", "vote", "winner",
                     "adjudicatedLabel", "resolvedLabel", "populationArea", "areaEstimate", "strata",
                     "stratum", "beforeClass", "afterClass", "audit", "classifier", "designWeight"}

        def check(value):
            if isinstance(value, dict):
                self.assertFalse(forbidden.intersection(value))
                for v in value.values():
                    check(v)
            elif isinstance(value, list):
                for v in value:
                    check(v)
            self.assertNotIsInstance(value, float)  # No ratio/percentage outputs; grid coordinates are checked separately.

        # Grid intentionally retains exact input floating-point coordinates.
        check({k: v for k, v in result.items() if k != "grid"})
        unknown_unknown_rows = [r for r in result["rows"] if r["left"]["label"] == r["right"]["label"] == "unknown"]
        self.assertTrue(unknown_unknown_rows)
        self.assertTrue(all(r["status"] != "same_label" for r in unknown_unknown_rows))

    def test_missing_foreign_duplicate_and_invalid_review_fields_rejected_on_either_side(self):
        packet = synthetic_packet(2)
        mutations = [lambda r: r["reviews"].pop(),
                     lambda r: r.update(packetHash="f" * 64),
                     lambda r: r["reviews"][0].update(sampleId="s-" + "f" * 32),
                     lambda r: r["reviews"][1].update(sampleId=r["reviews"][0]["sampleId"]),
                     lambda r: r["reviews"].append(deepcopy(r["reviews"][0])),
                     lambda r: r.update(schemaVersion=True),
                     lambda r: r.update(reviewHash="f" * 64),
                     lambda r: r.update(reviews=tuple(r["reviews"])),
                     lambda r: r["reviews"][0]["before"].update(reason=" padded "),
                     lambda r: r["reviews"][0]["before"].update(reviewedAt="2026-02-30T10:00:00Z"),
                     lambda r: r["reviews"][0]["before"].update(reviewedAt="2026-10-14T10:00:00"),
                     lambda r: r["reviews"][0]["before"].update(label=True),
                     lambda r: r["reviews"][0]["before"].update(status={}),
                     lambda r: r["reviews"][0]["before"].update(visibility="bad"),
                     lambda r: r["reviews"][0]["before"].update(extra="bad"),
                     lambda r: r.update(reviewerAlias="a\nb")]
        for side in ("left", "right"):
            for i, mutate in enumerate(mutations):
                left = synthetic_review(packet, states=[4] * 4)
                right = synthetic_review(packet, "synthetic-B", [5] * 4)
                mutate(left if side == "left" else right)
                with self.subTest(side=side, index=i), self.assertRaises(ValueError):
                    rc.compare_reviews(packet, left, right)

    def test_tampered_duplicate_missing_foreign_and_native_grid_packet_rejections(self):
        original = synthetic_packet(2)
        mutations = [lambda p: p.pop("sources"),
                     lambda p: p["samples"][1].update(id=p["samples"][0]["id"]),
                     lambda p: p["samples"][1].update(col=p["samples"][0]["col"]),
                     lambda p: p["samples"][0].update(row=1),
                     lambda p: p["samples"][0].update(id="foreign"),
                     lambda p: p.update(schemaVersion=True),
                     lambda p: p["grid"]["transform"].__setitem__(1, 10),
                     lambda p: p["grid"]["transform"].__setitem__(2, .1),
                     lambda p: p["grid"].update(shape=[True, 2]),
                     lambda p: p["sources"][1].update(observedAt=p["sources"][0]["observedAt"]),
                     lambda p: p["sources"].reverse(),
                     lambda p: p["source_pins"].update(receipt="not-a-hash"),
                     lambda p: p.update(classifier="forbidden")]
        for i, mutate in enumerate(mutations):
            packet = deepcopy(original)
            mutate(packet)
            rehash(packet)
            with self.subTest(index=i), self.assertRaises(ValueError):
                rc.compare_reviews(packet, synthetic_review(packet), synthetic_review(packet, "synthetic-B"))
        packet = deepcopy(original)
        packet["grid"]["transform"][0] += 20  # Valid grid change without rehash must fail.
        with self.assertRaisesRegex(ValueError, "packet hash mismatch"):
            rc.compare_reviews(packet, synthetic_review(packet), synthetic_review(packet, "synthetic-B"))
        oversampled = synthetic_packet(321)
        with self.assertRaisesRegex(ValueError, "sample limit"):
            rc.compare_reviews(oversampled, synthetic_review(oversampled), synthetic_review(oversampled, "synthetic-B"))

    def test_partial_pending_precedence_unknown_visibility_and_invalid_known_unobservable(self):
        packet = synthetic_packet(2)
        left = synthetic_review(packet, states=[0, 1, 2, 3])
        right = synthetic_review(packet, "synthetic-B", [1, 0, 4, 3])
        result = rc.compare_reviews(packet, left, right)
        self.assertEqual([r["status"] for r in result["rows"]], ["pending", "pending", "uncertain", "uncertain"])
        self.assertEqual(result["flagCounts"]["knownVisibilityDisagreement"], 0)
        for side in ("left", "right"):
            for state in (0, 1, 2):
                l = synthetic_review(packet)
                r = synthetic_review(packet, "synthetic-B")
                target = l if side == "left" else r
                target["reviews"][0]["before"] = synthetic_decision(state)
                target["reviews"][0]["before"]["label"] = "water"
                with self.subTest(side=side, state=state), self.assertRaises(ValueError):
                    rc.compare_reviews(packet, l, r)

    def test_strict_json_nonfinite_unicode_cycles_types_and_pre_copy_input_bound(self):
        packet = synthetic_packet(1)
        left, right = synthetic_review(packet), synthetic_review(packet, "synthetic-B")
        for value in (float("nan"), float("inf"), float("-inf"), "\ud800", b"bytes", ("tuple",),
                      {1: "non-string-key"}, 10**5000):
            bad = deepcopy(left)
            bad["bad"] = value
            with self.subTest(value=type(value).__name__), self.assertRaises(ValueError):
                rc.compare_reviews(packet, bad, right)
        cyclic = deepcopy(left)
        cyclic["cycle"] = cyclic
        with self.assertRaisesRegex(ValueError, "too large/deep"):
            rc.compare_reviews(packet, cyclic, right)
        bad = deepcopy(left)
        bad["reviewerAlias"] = "x" * (rc.MAX_COMBINED_INPUT_BYTES + 1)
        self.crs_parser.reset_mock()
        with self.assertRaisesRegex(ValueError, "byte limit"):
            rc.compare_reviews(packet, bad, right)
        self.crs_parser.assert_not_called()  # Combined bound enforced before validation/copies.
        # UTF-8 bytes, not Python character count; still rejected before validation.
        bad["reviewerAlias"] = "水" * (rc.MAX_COMBINED_INPUT_BYTES // 3 + 1)
        with self.assertRaisesRegex(ValueError, "byte limit"):
            rc.compare_reviews(packet, bad, right)
        self.crs_parser.assert_not_called()

    def test_large_valid_two_reviews_exceed_old_joint_budget_and_output_is_bounded(self):
        packet = synthetic_packet(320)
        left = synthetic_review(packet, states=[4] * 640)
        right = synthetic_review(packet, "synthetic-B", [5] * 640)
        for review in (left, right):
            for entry in review["reviews"]:
                for side in ("before", "after"):
                    entry[side]["reason"] = "é" * 650
        self.assertGreater(len(canonical({"packet": packet, "left": left, "right": right})), 1024 * 1024)
        result = rc.compare_reviews(packet, left, right)
        self.assertEqual(result["counts"]["primary"]["different_labels"], 640)
        self.assertLessEqual(len(canonical(result)), rc.MAX_ARTIFACT_BYTES)
        self.assertEqual(result["limits"]["maxCombinedInputBytes"], 3 * 1024 * 1024)
        self.assertEqual(result["limits"]["maxArtifactBytes"], 4 * 1024 * 1024)
        # Exercise the output ceiling (including selfhash), using a small test
        # ceiling rather than introducing impossible oversized valid schemas.
        small = synthetic_packet(0)
        a, b = synthetic_review(small), synthetic_review(small, "synthetic-B")
        actual = rc.compare_reviews(small, a, b)
        # Existing integer limit metadata changes width when the ceiling changes;
        # choose a ceiling safely inside the hash-field overhead instead.
        ceiling = len(canonical(actual)) - 20
        with patch.object(rc, "MAX_ARTIFACT_BYTES", ceiling), self.assertRaisesRegex(ValueError, "byte limit"):
            rc.compare_reviews(small, a, b)

    def test_serialized_limit_exact_boundary_and_escape_overhead(self):
        value = {"text": "é\"\\"}
        size = len(canonical(value))
        self.assertEqual(rc._canonical_bounded(value, size), canonical(value))
        with self.assertRaisesRegex(ValueError, "byte limit"):
            rc._canonical_bounded(value, size - 1)
        # Punctuation/escaping counts too, even if raw string bytes fit.
        with self.assertRaisesRegex(ValueError, "byte limit"):
            rc._canonical_bounded(["\"" * 100], 120)


@unittest.skipUnless(importlib.util.find_spec("osgeo"), "GDAL/OSR absent: actual native CRS comparison unverified")
class NativeReviewComparisonTests(unittest.TestCase):
    def test_native_projected_grid_and_geographic_rejection(self):
        packet = synthetic_packet(1)
        a, b = synthetic_review(packet), synthetic_review(packet, "synthetic-B")
        self.assertEqual(rc.compare_reviews(packet, a, b)["counts"]["allSlots"], 2)
        packet["grid"]["crs"] = "EPSG:4326"
        rehash(packet)
        with self.assertRaises(ValueError):
            rc.compare_reviews(packet, synthetic_review(packet), synthetic_review(packet, "synthetic-B"))


if __name__ == "__main__":
    unittest.main()
