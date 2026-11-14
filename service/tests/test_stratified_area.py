"""Synthetic finite-population tests, never field accuracy or calibration.

Exhaustive SRSWOR enumeration obtains true estimator covariance from the actual
sample distribution. Its Fraction unit-total oracle does not reproduce the
production covariance formula. No GDAL, network or reference review adapter.
"""
from copy import deepcopy
from decimal import Decimal
from fractions import Fraction
import hashlib
from itertools import combinations, product
import json
import math
import unittest
from unittest.mock import patch

from service.benchmarks import stratified_area as sa


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def fixture(sizes=(100, 900), sample_labels=None, classes=("water", "other"), area=400):
    if sample_labels is None:
        sample_labels = [["water"] * 8 + ["other"] * 12,
                         ["water"] * 3 + ["other"] * 27]
    design = {
        "schemaVersion": 1, "kind": "stratified-area-design",
        "methodVersion": "stratified-srswor-equal-area-v1",
        "frameId": "synthetic nominal frame", "frameHash": "a" * 64,
        "cellAreaM2": area, "areaBasis": "nominal-equal-area-cells", "classes": list(classes),
        "responseTarget": {"id": "synthetic reference-defined categories", "version": "1",
                           "definition": "Synthetic mutually exclusive exhaustive categories; not field observations.",
                           "sha256": "b" * 64},
        "strata": [{"id": f"stratum-{h}", "N": size,
                    "sampleIds": [f"h{h}-u{i}" for i in range(len(labels))]}
                   for h, (size, labels) in enumerate(zip(sizes, sample_labels))],
    }
    outcomes = {
        "schemaVersion": 1, "kind": "stratified-reference-outcomes", "designHash": digest(design),
        "responseTargetHash": design["responseTarget"]["sha256"],
        "records": [{"sampleId": sample_id, "stratumId": stratum["id"], "status": "reviewed",
                     "visibility": "observable", "label": label}
                    for stratum, labels in zip(design["strata"], sample_labels)
                    for sample_id, label in zip(stratum["sampleIds"], labels)],
    }
    return design, outcomes


def repin(design, outcomes):
    outcomes["designHash"] = digest(design)
    outcomes["responseTargetHash"] = design["responseTarget"]["sha256"]


class StratifiedNumericalTests(unittest.TestCase):
    def assert_matrix_properties(self, artifact):
        covariance = artifact["proportionCovariance"]
        size = len(covariance)
        for i in range(size):
            self.assertGreaterEqual(covariance[i][i], 0)
            self.assertAlmostEqual(math.fsum(covariance[i]), 0, delta=2e-16)
            for j in range(size):
                self.assertEqual(covariance[i][j], covariance[j][i])
                if i != j:
                    self.assertLessEqual(covariance[i][j], 0)
        # Quadratic forms cover negative and positive contrasts, not just axes.
        for vector in product(range(-2, 3), repeat=size):
            quadratic = math.fsum(vector[i] * covariance[i][j] * vector[j]
                                  for i in range(size) for j in range(size))
            self.assertGreaterEqual(quadratic, -1e-15)
        for i, j in combinations(range(size), 2):
            self.assertGreaterEqual(covariance[i][i] * covariance[j][j]
                                    - covariance[i][j] ** 2, -1e-16)
        if size == 3:
            a, b, c = covariance
            determinant = (a[0] * (b[1] * c[2] - b[2] * c[1])
                           - a[1] * (b[0] * c[2] - b[2] * c[0])
                           + a[2] * (b[0] * c[1] - b[1] * c[0]))
            self.assertAlmostEqual(determinant, 0, delta=1e-16)
        area = artifact["nominalFrameAreaM2"]
        self.assertAlmostEqual(sum(c["areaM2"] for c in artifact["classes"]), area, delta=area * 2e-15)
        for i, row in enumerate(covariance):
            for j, value in enumerate(row):
                self.assertAlmostEqual(artifact["areaCovarianceM4"][i][j], value * area ** 2,
                                       delta=max(1e-24, abs(value * area ** 2) * 2e-15))
            self.assertAlmostEqual(artifact["classes"][i]["areaSamplingSE_M2"], math.sqrt(row[i]) * area)

    def test_unequal_oversampling_pinned_fraction_fixture(self):
        design, outcomes = fixture()
        result = sa.estimate_area(design, outcomes)
        self.assertEqual((result["N"], result["n"]), (1000, 50))
        self.assertAlmostEqual(result["classes"][0]["proportion"], float(Fraction(13, 100)))
        self.assertAlmostEqual(result["proportionCovariance"][0][0], float(Fraction(4809, 1900000)), delta=1e-17)
        self.assertNotAlmostEqual(result["classes"][0]["proportion"], 11 / 50)
        self.assertEqual(result["classes"][0]["areaM2"], 52000)
        self.assertEqual([s["weight"] for s in result["strata"]], [0.1, 0.9])
        self.assertEqual([s["selectionProbability"] for s in result["strata"]], [0.2, 30 / 900])
        self.assertEqual([s["expansionWeight"] for s in result["strata"]], [5, 30])
        self.assertEqual(result["counts"]["knownLabelCounts"], {"water": 11, "other": 39})
        self.assertEqual(result["pointEstimateStatus"], "available")
        self.assertEqual(result["samplingVarianceStatus"], "estimable")
        self.assert_matrix_properties(result)

    def test_second_pinned_fixture(self):
        design, outcomes = fixture((100, 50), [["water"] * 3 + ["other"] * 7,
                                            ["water"] * 2 + ["other"] * 3])
        result = sa.estimate_area(design, outcomes)
        self.assertAlmostEqual(result["classes"][0]["proportion"], float(Fraction(1, 3)))
        self.assertAlmostEqual(result["proportionCovariance"][0][0], float(Fraction(23, 1500)), delta=1e-17)
        self.assert_matrix_properties(result)

    def test_exhaustive_finite_populations_unbiased_mean_covariance_and_variance_estimator(self):
        cases = [
            # Nonbinary categories, unequal populations, singleton census, empty stratum.
            ([["A", "A", "B", "C"], ["B", "C", "C"], ["C"], []], [2, 2, 1, 0]),
            ([["A", "B", "B"], ["A", "C"]], [2, 2]),
            ([["A", "A", "A", "B", "B"]], [2]),
            ([["A", "B", "C"], ["C", "C"]], [3, 2]),
        ]
        total_enumerated = 0
        for populations, ns in cases:
            with self.subTest(populations=populations, ns=ns):
                classes = ("A", "B", "C")
                total = sum(map(len, populations))
                truth = [Fraction(sum(pop.count(k) for pop in populations), total) for k in classes]
                sample_spaces = [list(combinations(range(len(pop)), n)) for pop, n in zip(populations, ns)]
                exact_estimates, results = [], []
                for selected_sets in product(*sample_spaces):
                    labels = [[pop[i] for i in chosen] for pop, chosen in zip(populations, selected_sets)]
                    design, outcomes = fixture(tuple(map(len, populations)), labels, classes, area=7)
                    result = sa.estimate_area(design, outcomes)
                    results.append(result)
                    # Unit-based Horvitz-Thompson total: each selected indicator
                    # is expanded by its exact inclusion probability then /N.
                    # No covariance formula or stratum-ph matrix is used here.
                    estimate = [sum((Fraction(int(pop[i] == k), 1)
                                     / Fraction(n, len(pop)) / total
                                     for pop, n, chosen in zip(populations, ns, selected_sets)
                                     for i in chosen), Fraction(0)) for k in classes]
                    exact_estimates.append(estimate)
                    for k in range(3):
                        self.assertAlmostEqual(result["classes"][k]["proportion"], float(estimate[k]), delta=2e-16)
                    self.assert_matrix_properties(result)
                count = len(results)
                total_enumerated += count
                expected_mean = [sum((e[k] for e in exact_estimates), Fraction(0)) / count for k in range(3)]
                self.assertEqual(expected_mean, truth)
                distribution_cov = [[sum(((e[i] - truth[i]) * (e[j] - truth[j])
                                          for e in exact_estimates), Fraction(0)) / count
                                     for j in range(3)] for i in range(3)]
                for i in range(3):
                    for j in range(3):
                        average_estimated_cov = math.fsum(r["proportionCovariance"][i][j] for r in results) / count
                        self.assertAlmostEqual(average_estimated_cov, float(distribution_cov[i][j]), delta=3e-17)
                # A category contrast requires covariance, not independent-SE addition.
                differences = [e[0] - e[1] for e in exact_estimates]
                contrast_truth = truth[0] - truth[1]
                true_difference_var = sum(((d - contrast_truth) ** 2 for d in differences), Fraction(0)) / count
                average_difference_var = math.fsum(r["proportionCovariance"][0][0]
                    + r["proportionCovariance"][1][1] - 2 * r["proportionCovariance"][0][1]
                    for r in results) / count
                self.assertAlmostEqual(average_difference_var, float(true_difference_var), delta=5e-17)
        self.assertEqual(total_enumerated, 32)

    def test_census_including_one_unit_has_zero_sampling_variance(self):
        design, outcomes = fixture((1, 2, 0), [["water"], ["water", "other"], []])
        result = sa.estimate_area(design, outcomes)
        self.assertEqual(result["proportionCovariance"], [[0, 0], [0, 0]])
        self.assertEqual(result["areaCovarianceM4"], [[0, 0], [0, 0]])
        self.assertEqual(result["classes"][0]["proportion"], 2 / 3)
        self.assertTrue(all(s["isCensus"] for s in result["strata"]))
        self.assertEqual(result["strata"][2]["selectionProbability"], None)
        self.assertEqual(result["strata"][2]["weight"], 0)
        self.assertEqual(result["strata"][2]["samplingVarianceStatus"], "empty-stratum")
        self.assertEqual(result["nonEstimableVarianceStrata"], [])
        self.assert_matrix_properties(result)

    def test_noncensus_singleton_nulls_entire_covariance_not_point(self):
        design, outcomes = fixture((10, 100), [["water"], ["water", "other"]])
        result = sa.estimate_area(design, outcomes)
        self.assertEqual(result["nonEstimableVarianceStrata"], ["stratum-0"])
        self.assertEqual(result["pointEstimateStatus"], "available")
        self.assertEqual(result["samplingVarianceStatus"], "non-estimable")
        self.assertAlmostEqual(result["classes"][0]["proportion"], 6 / 11)
        self.assertIsNone(result["proportionCovariance"])
        self.assertIsNone(result["areaCovarianceM4"])
        for row in result["classes"]:
            self.assertIsNotNone(row["areaM2"])
            self.assertIsNone(row["proportionSamplingSE"])
            self.assertIsNone(row["areaSamplingSE_M2"])

    def test_one_class_and_homogeneous_noncensus_caution(self):
        for classes, labels in [(("water",), [["water", "water"]]),
                                (("water", "other"), [["water", "water"]])]:
            with self.subTest(classes=classes):
                design, outcomes = fixture((100,), labels, classes)
                result = sa.estimate_area(design, outcomes)
                self.assertEqual(result["classes"][0]["proportion"], 1)
                self.assertEqual(result["classes"][0]["areaSamplingSE_M2"], 0)
                self.assertFalse(result["strata"][0]["isCensus"])
                self.assertTrue(any("homogeneous" in line and "absent a census" in line for line in result["limitations"]))
                self.assert_matrix_properties(result)

    def test_numerical_upper_and_lower_cell_area_bounds(self):
        for area in (1000000, 1000000.0, 1e-12):
            design, outcomes = fixture((1000000,), [["water", "other"]], area=area)
            result = sa.estimate_area(design, outcomes)
            self.assertGreater(result["nominalFrameAreaM2"], 0)
            self.assertLessEqual(result["nominalFrameAreaM2"], 1e12)
            self.assertTrue(math.isfinite(result["classes"][0]["areaSamplingSE_M2"]))
            canonical(result)  # No nonfinite output even at declared boundaries.
            self.assertTrue(any("binary64" in line for line in result["limitations"]))

    def test_underflow_scale_areas_refused_and_floor_covariance_consistent(self):
        for area in (math.ulp(0.0), 1e-200, 1e-13):
            design,outcomes=fixture((4,),[["water","other"]],area=area)
            with self.assertRaises(ValueError):sa.estimate_area(design,outcomes)
        design,outcomes=fixture((4,),[["water","other"]],area=1e-12)
        result=sa.estimate_area(design,outcomes)
        variance=result["areaCovarianceM4"][0][0]
        self.assertGreater(variance,0)
        se=result["classes"][0]["areaSamplingSE_M2"]
        self.assertAlmostEqual(se*se/variance,1,places=14)


class StratifiedMissingnessTests(unittest.TestCase):
    def assert_withheld(self, result):
        self.assertEqual(result["pointEstimateStatus"], "withheld")
        self.assertEqual(result["samplingVarianceStatus"], "withheld")
        self.assertIsNone(result["proportionCovariance"])
        self.assertIsNone(result["areaCovarianceM4"])
        for row in result["classes"]:
            self.assertTrue(all(row[k] is None for k in ("proportion", "areaM2", "proportionSamplingSE", "areaSamplingSE_M2")))
        self.assertTrue(all(row["classProportions"] is None for row in result["strata"]))

    def test_every_unknown_state_withholds_all_classes_no_respondent_reweighting(self):
        states = [("unreviewed", "unknown", "unreviewed"),
                  ("reviewed", "unobservable", "reviewed_unobservable"),
                  ("reviewed", "unknown", "reviewed_unknown_visibility"),
                  ("reviewed", "observable", "reviewed_observable_unknown")]
        for status, visibility, name in states:
            with self.subTest(state=name):
                design, outcomes = fixture()
                outcomes["records"][0].update(status=status, visibility=visibility, label=None)
                result = sa.estimate_area(design, outcomes)
                self.assert_withheld(result)
                self.assertEqual(result["counts"]["unknown"], 1)
                self.assertEqual(result["counts"]["known"], 49)
                self.assertEqual(result["counts"]["byState"][name], 1)
                self.assertEqual(result["counts"]["knownLabelCounts"], {"water": 10, "other": 39})
                self.assertEqual(result["strata"][0]["pointWithholdingReasons"], [name])
                self.assertEqual(result["pointWithholdingReasons"], ["incomplete-selected-outcomes"])
                self.assertEqual([s["weight"] for s in result["strata"]], [0.1, 0.9])
                self.assertEqual([s["n"] for s in result["strata"]], [20, 30])

    def test_counts_partition_and_stratum_specific_reasons(self):
        design, outcomes = fixture((5, 5), [["water"] * 5, ["other"] * 5])
        changes = [(0, "unreviewed", "unknown"), (1, "reviewed", "unobservable"),
                   (5, "reviewed", "unknown"), (6, "reviewed", "observable")]
        for i, status, visibility in changes:
            outcomes["records"][i].update(status=status, visibility=visibility, label=None)
        result = sa.estimate_area(design, outcomes)
        self.assert_withheld(result)
        self.assertEqual(result["counts"]["byState"], {"known": 6, "unreviewed": 1,
            "reviewed_unobservable": 1, "reviewed_unknown_visibility": 1, "reviewed_observable_unknown": 1})
        self.assertEqual(result["counts"]["byStatus"], {"reviewed": 9, "unreviewed": 1})
        self.assertEqual(result["counts"]["byVisibility"], {"observable": 7, "unobservable": 1, "unknown": 2})
        self.assertEqual(sum(result["counts"]["byState"].values()), 10)
        for key in ("total", "known", "unknown"):
            self.assertEqual(sum(s["counts"][key] for s in result["strata"]), result["counts"][key])
        self.assertEqual(result["strata"][0]["pointWithholdingReasons"], ["unreviewed", "reviewed_unobservable"])
        self.assertEqual(result["strata"][1]["pointWithholdingReasons"], ["reviewed_unknown_visibility", "reviewed_observable_unknown"])

    def test_unsampled_positive_stratum_valid_withheld_including_no_samples_anywhere(self):
        for labels in ([["water", "other"], [], []], [[], [], []]):
            design, outcomes = fixture((10, 90, 0), labels)
            result = sa.estimate_area(design, outcomes)
            self.assert_withheld(result)
            expected = ["stratum-1"] if labels[0] else ["stratum-0", "stratum-1"]
            self.assertEqual(result["unsampledStrata"], expected)
            self.assertEqual(result["pointWithholdingReasons"], ["unsampled-positive-strata"])
            self.assertEqual(result["strata"][1]["selectionProbability"], 0)
            self.assertIsNone(result["strata"][1]["expansionWeight"])
            self.assertEqual(result["strata"][1]["pointWithholdingReasons"], ["unsampled-positive-stratum"])
            self.assertEqual(result["strata"][2]["counts"]["total"], 0)
            self.assertEqual(result["strata"][2]["pointWithholdingReasons"], [])
            self.assertEqual(result["N"], 100)

    def test_incomplete_and_unsampled_reasons_coexist(self):
        design, outcomes = fixture((10, 90), [["water"], []])
        outcomes["records"][0].update(status="unreviewed", visibility="unknown", label=None)
        result = sa.estimate_area(design, outcomes)
        self.assert_withheld(result)
        self.assertEqual(result["pointWithholdingReasons"], ["incomplete-selected-outcomes", "unsampled-positive-strata"])
        self.assertEqual(result["nonEstimableVarianceStrata"], ["stratum-0"])


class StratifiedProvenanceTests(unittest.TestCase):
    def test_hashes_exact_canonical_bytes_and_detached_input_provenance(self):
        design, outcomes = fixture()
        initial_design, initial_outcomes = deepcopy(design), deepcopy(outcomes)
        result = sa.estimate_area(design, outcomes)
        self.assertEqual((design, outcomes), (initial_design, initial_outcomes))
        self.assertEqual(result["designHash"], digest(design))
        self.assertEqual(result["artifactHash"], digest({k: v for k, v in result.items() if k != "artifactHash"}))
        self.assertLessEqual(len(canonical(result)), 2 * 1024 * 1024)
        self.assertLessEqual(len(canonical({"design": design, "outcomes": outcomes})), 2 * 1024 * 1024)
        self.assertEqual(result["inputs"], {"design": design, "outcomes": outcomes})
        self.assertEqual(result["responseTarget"], design["responseTarget"])
        design["strata"][0]["sampleIds"].clear()
        outcomes["records"][0]["label"] = "other"
        self.assertEqual(result["inputs"], {"design": initial_design, "outcomes": initial_outcomes})
        result["inputs"]["design"]["responseTarget"]["definition"] = "mutated"
        self.assertEqual(initial_design["responseTarget"]["definition"], design["responseTarget"]["definition"])
        self.assertNotEqual(result["responseTarget"]["definition"], "mutated")

    def test_object_key_order_irrelevant_record_order_only_changes_provenance_hash(self):
        design, outcomes = fixture()
        baseline = sa.estimate_area(design, outcomes)
        reordered = {key: design[key] for key in reversed(design)}
        reordered["strata"] = [{key: s[key] for key in reversed(s)} for s in design["strata"]]
        reordered["responseTarget"] = {key: design["responseTarget"][key] for key in reversed(design["responseTarget"])}
        self.assertEqual(sa.estimate_area(reordered, outcomes), baseline)
        other = deepcopy(outcomes)
        other["records"].reverse()
        result = sa.estimate_area(design, other)
        for key in ("classes", "strata", "counts", "proportionCovariance", "areaCovarianceM4", "designHash"):
            self.assertEqual(result[key], baseline[key])
        self.assertNotEqual(result["artifactHash"], baseline["artifactHash"])

    def test_repinning_design_permutations_preserves_numerics_after_mapping_order(self):
        design, outcomes = fixture((7, 13, 0), [["water", "other", "water"], ["other", "water"], []])
        baseline = sa.estimate_area(design, outcomes)
        for s in design["strata"]:
            s["sampleIds"].reverse()
        design["strata"].reverse()
        design["classes"].reverse()
        repin(design, outcomes)
        result = sa.estimate_area(design, outcomes)
        self.assertNotEqual(result["designHash"], baseline["designHash"])
        self.assertNotEqual(result["artifactHash"], baseline["artifactHash"])
        self.assertEqual({c["id"]: c for c in result["classes"]}, {c["id"]: c for c in baseline["classes"]})
        self.assertEqual(result["proportionCovariance"], [row[::-1] for row in baseline["proportionCovariance"][::-1]])
        self.assertEqual(result["counts"], baseline["counts"])

    def test_unicode_canonical_utf8_is_not_ascii_escaped_or_normalized(self):
        design, outcomes = fixture((2,), [["e\u0301", "é"]], classes=("e\u0301", "é"))
        design["frameId"] = "آب"
        design["responseTarget"]["definition"] = "水 面 categories"
        repin(design, outcomes)
        result = sa.estimate_area(design, outcomes)
        self.assertEqual(result["classOrder"], ["e\u0301", "é"])
        self.assertEqual(result["designHash"], digest(design))
        self.assertIn("آب".encode(), canonical(result))
        ascii_hash = hashlib.sha256(json.dumps(design, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()
        self.assertNotEqual(result["designHash"], ascii_hash)

    def test_integrity_does_not_authenticate_sampling_or_observations(self):
        design, outcomes = fixture()
        result = sa.estimate_area(design, outcomes)
        for key in ("fieldTruthEstablished", "referenceErrorQuantified", "mapAccuracyEstimated", "confidenceIntervalsProvided"):
            self.assertIs(result[key], False)
        self.assertIs(result["experimental"], True)
        self.assertIs(result["conditionalOnDeclaredDesignAndOutcomes"], True)
        self.assertEqual(result["referenceUncertainty"], {"status": "not-quantified", "includedInSamplingSE": False})
        text = " ".join(result["limitations"])
        for word in ("coverage", "projection", "time", "qualified", "probability", "bias", "field truth"):
            self.assertIn(word, text)
        self.assertEqual(result["methodVersion"], "stratified-srswor-equal-area-v1")
        self.assertEqual(result["limits"]["maxNominalFrameAreaM2"], 10 ** 12)


class StratifiedValidationTests(unittest.TestCase):
    def reject_design(self, modify):
        design, outcomes = fixture()
        modify(design)
        # JSON-representable modifications are repinned so this actually tests
        # the schema; unsupported types never reach the hash check.
        try:
            repin(design, outcomes)
        except (TypeError, ValueError, UnicodeError, OverflowError):
            pass
        with self.assertRaises(ValueError):
            sa.estimate_area(design, outcomes)

    def reject_outcomes(self, modify):
        design, outcomes = fixture()
        modify(outcomes)
        with self.assertRaises(ValueError):
            sa.estimate_area(design, outcomes)

    def test_exact_fields_and_required_fields_at_every_object_level(self):
        paths = [(), ("responseTarget",), ("strata", 0)]
        for path in paths:
            for mode in ("extra", "missing"):
                with self.subTest(path=path, mode=mode):
                    def change(d):
                        obj = d
                        for key in path:
                            obj = obj[key]
                        if mode == "extra":
                            obj["extra"] = None
                        else:
                            obj.pop(next(iter(obj)))
                    self.reject_design(change)
        for path in ((), ("records", 0)):
            for mode in ("extra", "missing"):
                with self.subTest(path=path, mode=mode):
                    def change(o):
                        obj = o
                        for key in path:
                            obj = obj[key]
                        if mode == "extra":
                            obj["extra"] = None
                        else:
                            obj.pop(next(iter(obj)))
                    self.reject_outcomes(change)

    def test_strict_integer_and_number_types_bounds(self):
        for field in ("schemaVersion", "N"):
            for invalid in (True, False, 1.0, "1", None, -1, 1000001, Fraction(1), Decimal(1)):
                with self.subTest(field=field, invalid=repr(invalid)):
                    def change(d):
                        if field == "N":
                            d["strata"][0]["N"] = invalid
                        else:
                            d[field] = invalid
                    self.reject_design(change)
        for invalid in (True, False, 1.0, "1", None, 2):
            self.reject_outcomes(lambda o: o.update(schemaVersion=invalid))
        for invalid in (True, False, None, "400", 0, -1, 1000001, math.inf, -math.inf, math.nan, Decimal(400), Fraction(400), 10 ** 5000):
            with self.subTest(area=repr(invalid) if type(invalid) is not int or invalid.bit_length() < 100 else "huge int"):
                self.reject_design(lambda d: d.update(cellAreaM2=invalid))

    def test_list_counts_duplicates_population_and_sample_limits(self):
        changes = [
            lambda d: d.update(classes=[]), lambda d: d.update(classes=[str(i) for i in range(9)]),
            lambda d: d.update(classes=["water", "water"]), lambda d: d.update(classes=["unknown"]),
            lambda d: d.update(classes=["UNKNOWN"]), lambda d: d.update(strata=[]),
            lambda d: d.update(strata=d["strata"] * 33),
            lambda d: d["strata"][1].update(id=d["strata"][0]["id"]),
            lambda d: d["strata"][0].update(sampleIds=["dup", "dup"]),
            lambda d: d["strata"][1]["sampleIds"].__setitem__(0, d["strata"][0]["sampleIds"][0]),
            lambda d: d["strata"][0].update(N=19), lambda d: d["strata"][0].update(N=0),
            lambda d: d["strata"][0].update(N=1000000),
            lambda d: [s.update(N=0, sampleIds=[]) for s in d["strata"]],
            lambda d: d["strata"][0].update(sampleIds=[f"s{i}" for i in range(321)], N=500),
            lambda d: d.update(classes=tuple(d["classes"])),
            lambda d: d.update(strata=tuple(d["strata"])),
            lambda d: d["strata"][0].update(sampleIds=tuple(d["strata"][0]["sampleIds"])),
        ]
        for i, change in enumerate(changes):
            with self.subTest(change=i):
                self.reject_design(change)
        design, outcomes = fixture((500, 500), [["water"] * 161, ["other"] * 160])
        with self.assertRaisesRegex(ValueError, "total sample count"):
            sa.estimate_area(design, outcomes)

    def test_all_valid_structural_maxima_in_one_fixture(self):
        classes = tuple(f"class-{i}" for i in range(8))
        sizes = [15625] * 64
        labels = [[classes[(h + i) % 8] for i in range(5)] for h in range(64)]
        design, outcomes = fixture(sizes, labels, classes)
        design["frameId"] = "f" * 128
        design["responseTarget"].update(id="t" * 128, version="v" * 128, definition="d" * 4096)
        repin(design, outcomes)
        result = sa.estimate_area(design, outcomes)
        self.assertEqual((result["N"], result["n"], len(result["strata"]), len(result["classes"])), (1000000, 320, 64, 8))
        self.assertEqual(sum(result["counts"]["knownLabelCounts"].values()), 320)
        self.assertEqual(result["samplingVarianceStatus"], "estimable")
        self.assertLessEqual(len(canonical(result)), 2 * 1024 * 1024)

    def test_text_controls_separators_trim_lengths_and_nontext_ids(self):
        paths = [("frameId",), ("classes", 0), ("strata", 0, "id"),
                 ("strata", 0, "sampleIds", 0), ("responseTarget", "id"),
                 ("responseTarget", "version"), ("responseTarget", "definition")]
        invalid_texts = ("", " leading", "trailing ", "\t", "a\nb", "a\rb", "a\x00b", "a\x7fb",
                         "a\u0085b", "a\u00a0b", "a\u200bb", "a\u2028b", "a\u2029b", "a\ue000b", "a\ufdd0b", "a\ud800b", True, 2, None)
        for path in paths:
            for value in (*invalid_texts, "x" * (4097 if path[-1] == "definition" else 129)):
                with self.subTest(path=path, value=repr(value)):
                    def change(d):
                        obj = d
                        for key in path[:-1]:
                            obj = obj[key]
                        obj[path[-1]] = value
                    self.reject_design(change)
        for key in ("sampleId", "stratumId"):
            for value in invalid_texts:
                self.reject_outcomes(lambda o: o["records"][0].update({key: value}))

    def test_hash_format_and_pins_are_hard_gates(self):
        for invalid in ("a" * 63, "a" * 65, "A" * 64, "g" * 64, "a" * 64 + "\n", None, True):
            for field in ("frameHash", "target"):
                with self.subTest(field=field, invalid=invalid):
                    def change(d):
                        if field == "target":
                            d["responseTarget"]["sha256"] = invalid
                        else:
                            d[field] = invalid
                    self.reject_design(change)
            for field in ("designHash", "responseTargetHash"):
                self.reject_outcomes(lambda o: o.update({field: invalid}))
        self.reject_outcomes(lambda o: o.update(designHash="f" * 64))
        self.reject_outcomes(lambda o: o.update(responseTargetHash="c" * 64))
        design, outcomes = fixture()
        design["responseTarget"]["definition"] = "Changed category target"
        with self.assertRaisesRegex(ValueError, "designHash mismatch"):
            sa.estimate_area(design, outcomes)

    def test_record_bijection_and_correct_strata(self):
        changes = [lambda o: o["records"].pop(),
                   lambda o: o["records"].append(deepcopy(o["records"][0])),
                   lambda o: o["records"].__setitem__(1, deepcopy(o["records"][0])),
                   lambda o: o["records"][0].update(sampleId="foreign"),
                   lambda o: o["records"][0].update(stratumId="stratum-1"),
                   lambda o: o["records"][0].update(stratumId="foreign"),
                   lambda o: o.update(records=tuple(o["records"])),
                   lambda o: o.update(records={}), lambda o: o.update(records=None)]
        for i, change in enumerate(changes):
            with self.subTest(change=i):
                self.reject_outcomes(change)

    def test_outcome_status_visibility_label_compatibility(self):
        for status, visibility, label in product(("reviewed", "unreviewed"),
                                                ("observable", "unobservable", "unknown"),
                                                ("water", "other", None)):
            valid = ((status == "unreviewed" and visibility == "unknown" and label is None)
                     or (status == "reviewed" and (visibility == "observable" or label is None)))
            with self.subTest(status=status, visibility=visibility, label=label):
                design, outcomes = fixture()
                outcomes["records"][0].update(status=status, visibility=visibility, label=label)
                if valid:
                    result = sa.estimate_area(design, outcomes)
                    self.assertEqual(result["counts"]["unknown"], int(label is None))
                else:
                    with self.assertRaises(ValueError):
                        sa.estimate_area(design, outcomes)
        for field, invalids in {"status": [None, True, [], "pending", "Reviewed"],
                               "visibility": [None, True, {}, "visible", "Observable"],
                               "label": [True, 0, [], "unknown", "undeclared"]}.items():
            for value in invalids:
                self.reject_outcomes(lambda o: o["records"][0].update({field: value}))

    def test_fixed_kind_method_area_basis_and_top_level_types(self):
        for field in ("kind", "methodVersion", "areaBasis"):
            for value in (None, [], True, "unsupported"):
                self.reject_design(lambda d: d.update({field: value}))
        self.reject_outcomes(lambda o: o.update(kind="unsupported"))
        for invalid in ([], None, "design", True):
            design, outcomes = fixture()
            with self.assertRaises(ValueError):
                sa.estimate_area(invalid, outcomes)
            with self.assertRaises(ValueError):
                sa.estimate_area(design, invalid)

    def test_non_json_types_cycles_depth_nodes_invalid_keys_and_budget(self):
        for bad in (b"bytes", set(), object(), Decimal(1), Fraction(1)):
            with self.assertRaises(ValueError):
                sa._canonical(bad)
        cycle = []
        cycle.append(cycle)
        with self.assertRaisesRegex(ValueError, "structure"):
            sa._canonical(cycle)
        deep = None
        for _ in range(18):
            deep = [deep]
        with self.assertRaisesRegex(ValueError, "structure"):
            sa._canonical(deep)
        with self.assertRaisesRegex(ValueError, "structure"):
            sa._canonical([None] * 100001)
        with self.assertRaisesRegex(ValueError, "keys"):
            sa._canonical({1: "not-string-key"})
        with self.assertRaisesRegex(ValueError, "integer"):
            sa._canonical(1 << 4096)
        # Exact encoded boundaries include escaping, punctuation and UTF-8.
        for value in ("水", {"a": "a\\b\"c"}, [None, True, 1, 0.25]):
            encoded = canonical(value)
            self.assertEqual(sa._canonical(value, len(encoded)), encoded)
            with self.assertRaisesRegex(ValueError, "byte limit"):
                sa._canonical(value, len(encoded) - 1)
        design, outcomes = fixture()
        outcomes["extra"] = "水" * sa.MAX_BYTES
        with self.assertRaisesRegex(ValueError, "byte limit"):
            sa.estimate_area(design, outcomes)

    def test_artifact_bound_includes_hash(self):
        design, outcomes = fixture()
        result = sa.estimate_area(design, outcomes)
        # Force a boundary between the same artifact with and without its hash.
        # Patch the serializer limit only, not any numerical or schema checks.
        boundary = len(canonical(result)) - 1
        original = sa._canonical
        with patch.object(sa, "_canonical", side_effect=lambda value: original(value, boundary)):
            with self.assertRaisesRegex(ValueError, "byte limit"):
                sa.estimate_area(design, outcomes)


if __name__ == "__main__":
    unittest.main()
