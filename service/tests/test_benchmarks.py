"""Exact arithmetic and adversarial bounds, using synthetic vectors only."""

import copy
import hashlib
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import numpy as np

from service.benchmarks import BenchmarkError, array_sha256, evaluate, file_sha256
from service.benchmarks.__main__ import main
from service.benchmarks.evaluator import ARRAYS, MAX_ARCHIVE_BYTES, MAX_CASES, MAX_PIXELS
from service.benchmarks.synthetic import write_fixture


class BenchmarkTests(unittest.TestCase):
    def setUp(self):
        # The assignment reserves writes only in this package and test file.
        self.tmp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / "benchmarks")
        self.root = Path(self.tmp.name) / "fixture"
        receipt = write_fixture(self.root)
        self.path = Path(receipt["manifest"])
        self.manifest = json.loads(self.path.read_text())

    def tearDown(self):
        self.tmp.cleanup()

    def run_manifest(self, manifest=None):
        if manifest is not None:
            self.path.write_text(json.dumps(manifest, allow_nan=False))
        return evaluate(self.path, expected_manifest_sha256=file_sha256(self.path))

    def rewrite_arrays(self, arrays):
        case = self.manifest["cases"][0]
        archive = self.root / case["inputs"]["path"]
        np.savez_compressed(archive, **arrays)
        case["inputs"]["archive_sha256"] = file_sha256(archive)
        case["inputs"]["array_sha256"] = {k: array_sha256(v) for k, v in arrays.items()}
        case["mask"]["sha256"] = case["inputs"]["array_sha256"]["common_observable"]

    def arrays(self):
        with np.load(self.root / "synthetic.npz", allow_pickle=False) as a:
            return {name: a[name] for name in ARRAYS}

    def metrics(self):
        return self.run_manifest(self.manifest)["cases"][0]["metrics"]

    def test_gdal_origins_do_not_change_area_and_rotation_uses_correct_coefficients(self):
        case=self.manifest['cases'][0]
        baseline=self.metrics()['area_m2']
        case['grid']['transform']=[500000,2,0,4000000,0,-2]
        self.assertEqual(self.metrics()['area_m2'],baseline)
        # Arithmetic grid fixture: determinant |2*(-2)-1*1| = 5 m2.
        case['grid']['transform']=[500000,2,1,4000000,1,-2]
        case['grid']['pixel_area_m2']=5
        self.assertEqual(self.metrics()['area_m2']['common_observable'],45)
        case['grid']['pixel_area_m2']=4
        with self.assertRaises(BenchmarkError):self.run_manifest(self.manifest)

    def test_native_projected_area_is_explicit_and_not_equal_area(self):
        baseline=self.metrics()['area_m2']
        self.manifest['cases'][0]['grid']['area_method']='constant_projected_grid_m2'
        result=self.run_manifest(self.manifest)
        self.assertEqual(result['cases'][0]['metrics']['area_m2'],baseline)
        self.assertEqual(result['area_basis']['method'],'constant_projected_grid_m2')
        self.assertIn('not geodesic',result['area_basis']['description'])
        self.assertEqual(result['field_validation'],'not_established_by_this_runner')

    def test_mixed_area_semantics_cannot_be_pooled(self):
        other=copy.deepcopy(self.manifest['cases'][0]);other['id']='second'
        other['grid']['area_method']='constant_projected_grid_m2'
        self.manifest['cases'].append(other)
        with self.assertRaisesRegex(BenchmarkError,'Mixed area bases'):self.run_manifest(self.manifest)

    def test_missing_or_ambiguous_affine_convention_is_rejected(self):
        grid=self.manifest['cases'][0]['grid']
        for value in (None,'rasterio','unknown'):
            if value is None:grid.pop('transform_convention',None)
            else:grid['transform_convention']=value
            with self.assertRaises(BenchmarkError):self.run_manifest(self.manifest)

    def test_exact_counts_area_abstention_and_denominators(self):
        result = self.run_manifest()
        score = result["cases"][0]["metrics"]
        c = score["counts"]
        self.assertEqual(c["confusion"], [[1, 1, 1, 0, 0], [0, 1, 0, 0, 1],
                                         [0, 1, 0, 0, 0], [0, 0, 0, 1, 0]])
        self.assertEqual(c["total_pixels"], 10)
        self.assertEqual(c["common_observable_pixels"], 9)
        self.assertEqual(c["reference_valid_pixels"], 7)
        self.assertEqual(c["reference_unknown_common_pixels"], 2)
        self.assertEqual(c["outside_common_pixels"], 1)
        self.assertEqual(c["mapped_pixels"], {"no_detection": 1, "gain": 4, "loss": 1,
                                             "persistent_water": 2, "unknown": 1})
        self.assertEqual(score["area_m2"]["mapped_common"], {"no_detection": 4, "gain": 16,
                                                               "loss": 4, "persistent_water": 8, "unknown": 4})
        self.assertEqual(score["area_m2"]["reference_valid"], 28)
        self.assertEqual(score["area_m2"]["reference_unknown_common"], 8)
        self.assertEqual(score["area_m2"]["outside_common_unknown"], 4)
        self.assertEqual(score["area_m2"]["false_alert"], 12)
        self.assertEqual(score["false_alert_area_per_common_observable_area"], 1/3)
        self.assertEqual(score["false_alert_area_per_reference_valid_area"], 3/7)
        self.assertEqual(score["quiet_false_alert_area_per_quiet_reference_area"], 1/2)
        self.assertEqual(score["prediction_abstention_rate_reference_valid"], 1/7)
        self.assertEqual(score["denominators"], {"conditional_pixels": 6, "inclusive_pixels": 7})
        gain = score["per_class"]["gain"]
        self.assertEqual(gain["conditional"]["recall"], 1)
        self.assertEqual(gain["inclusive"]["recall"], 1/2)
        self.assertEqual(gain["conditional"]["iou"], 1/3)
        self.assertEqual(gain["inclusive"]["iou"], 1/4)
        self.assertEqual(gain["inclusive"]["precision"], 1/3)
        self.assertEqual(gain["inclusive"]["omission"], 1/2)
        self.assertAlmostEqual(gain["inclusive"]["commission"], 2/3)
        self.assertEqual(score["inclusive_change_recall"], 1/3)
        self.assertEqual(score["area_bias"]["gain"], {"mapped_minus_reference_m2": 4, "relative": 1/2})
        self.assertEqual(result["task_budget_result"]["status"], "not_applicable_synthetic_software_check")
        self.assertEqual(result["field_validation"], "not_established_by_this_runner")
        self.assertIn("accuracy_adjusted_or_design_unbiased_area", result["withheld_metrics"])

    def test_repeat_scientific_result_and_full_lineage_are_identical(self):
        a = self.run_manifest()
        b = self.run_manifest()
        self.assertEqual(a, b)
        self.assertEqual(json.dumps(a, sort_keys=True, allow_nan=False), json.dumps(b, sort_keys=True, allow_nan=False))
        self.assertEqual(a["manifest_sha256"], file_sha256(self.path))
        self.assertEqual(a["cases"][0]["lineage"], self.manifest["cases"][0])
        self.assertEqual(len(a["policy_sha256"]), 64)

    def test_unchanged_reference_does_not_create_change_truth(self):
        arrays = self.arrays()
        for k in ARRAYS:
            arrays[k] = np.ones((2, 5), dtype=np.int8) if k.endswith("observable") else np.zeros((2, 5), dtype=np.int8)
        arrays["prediction_after"][0, 0] = 1
        self.rewrite_arrays(arrays)
        score = self.metrics()
        self.assertEqual(score["counts"]["confusion"][0], [9, 1, 0, 0, 0])
        self.assertEqual(score["area_m2"]["false_alert"], 4)
        self.assertEqual(score["false_alert_area_per_reference_valid_area"], 0.1)
        self.assertIsNone(score["inclusive_change_recall"])
        self.assertIsNone(score["per_class"]["gain"]["inclusive"]["recall"])

    def test_gain_loss_reversal_is_false_alert_and_omission(self):
        arrays = self.arrays()
        for k in ARRAYS:
            arrays[k] = np.ones((2, 5), dtype=np.int8) if k.endswith("observable") else np.zeros((2, 5), dtype=np.int8)
        arrays["reference_after"][0, 0] = 1
        arrays["prediction_before"][0, 0] = 1
        self.rewrite_arrays(arrays)
        score = self.metrics()
        self.assertEqual(score["counts"]["confusion"][1], [0, 0, 1, 0, 0])
        self.assertEqual(score["per_class"]["gain"]["inclusive"]["omission"], 1)
        self.assertEqual(score["per_class"]["loss"]["inclusive"]["commission"], 1)
        self.assertEqual(score["inclusive_change_recall"], 0)
        self.assertEqual(score["area_m2"]["false_alert"], 4)
        self.assertEqual(score["area_m2"]["quiet_false_alert"], 0)
        arrays["reference_before"], arrays["reference_after"] = arrays["reference_after"], arrays["reference_before"]
        arrays["prediction_before"], arrays["prediction_after"] = arrays["prediction_after"], arrays["prediction_before"]
        self.rewrite_arrays(arrays)
        reversed_score = self.metrics()
        self.assertEqual(reversed_score["counts"]["confusion"][2], [0, 1, 0, 0, 0])
        self.assertEqual(reversed_score["area_m2"]["false_alert"], 4)

    def test_abstentions_remain_in_every_reference_valid_denominator(self):
        arrays = self.arrays()
        arrays["prediction_before"][:] = -1
        self.rewrite_arrays(arrays)
        score = self.metrics()
        self.assertEqual(score["denominators"], {"conditional_pixels": 0, "inclusive_pixels": 7})
        self.assertEqual(score["prediction_abstention_rate_reference_valid"], 1)
        for name in ("no_detection", "gain", "loss", "persistent_water"):
            self.assertEqual(score["per_class"][name]["inclusive"]["recall"], 0)
            self.assertEqual(score["per_class"][name]["inclusive"]["omission"], 1)
            self.assertIsNone(score["per_class"][name]["conditional"]["recall"])

    def test_reference_unknown_is_not_scored_as_dry_or_silently_dropped(self):
        arrays = self.arrays()
        arrays["reference_before"][:] = -1
        self.rewrite_arrays(arrays)
        result = self.run_manifest(self.manifest)
        score = result["cases"][0]["metrics"]
        self.assertEqual(score["counts"]["reference_valid_pixels"], 0)
        self.assertEqual(score["counts"]["reference_unknown_common_pixels"], 9)
        self.assertEqual(score["denominators"], {"conditional_pixels": 0, "inclusive_pixels": 0})
        self.assertEqual(score["counts"]["mapped_pixels"]["gain"], 4)
        self.assertIsNone(score["false_alert_area_per_reference_valid_area"])
        self.assertIn("no final reference-valid support", result["task_budget_result"]["reasons"])

    def test_whole_event_site_acquisition_leakage_each_fail_closed(self):
        for shared in ("event_id", "site_id", "acquisition_ids"):
            with self.subTest(shared=shared):
                m = copy.deepcopy(self.manifest)
                other = copy.deepcopy(m["cases"][0])
                other.update(id="development-other", fold="development", event_id="other-event", site_id="other-site",
                             acquisition_ids=["other-before", "other-after"])
                for i, source in enumerate(other["sources"]):
                    source["acquisition_id"] = other["acquisition_ids"][i]
                other[shared] = m["cases"][0][shared]
                if shared == "acquisition_ids":
                    for i, source in enumerate(other["sources"]):
                        source["acquisition_id"] = other["acquisition_ids"][i]
                m["cases"].append(other)
                with self.assertRaisesRegex(BenchmarkError, "Split leakage"):
                    self.run_manifest(m)

    def test_disjoint_folds_are_pooled_separately(self):
        m = copy.deepcopy(self.manifest)
        other = copy.deepcopy(m["cases"][0])
        other.update(id="development-other", fold="development", event_id="other-event", site_id="other-site",
                     acquisition_ids=["other-before", "other-after"])
        for i, source in enumerate(other["sources"]):
            source["acquisition_id"] = other["acquisition_ids"][i]
            source['product_id']='other-product-'+str(i)
            source['sha256']=hashlib.sha256(('other-source-'+str(i)).encode()).hexdigest()
        m["cases"].append(other)
        result = self.run_manifest(m)
        self.assertEqual(set(result["pooled_by_fold"]), {"development", "final"})
        self.assertEqual(result["pooled_by_fold"]["final"]["counts"]["reference_valid_pixels"], 7)

    def test_source_aliases_cannot_bypass_whole_acquisition_split_barrier(self):
        for shared in ('product_id','sha256'):
            m=copy.deepcopy(self.manifest);first=m['cases'][0]
            other=copy.deepcopy(first)
            other.update(id='other',fold='development',event_id='other-event',site_id='other-site',acquisition_ids=['other-before','other-after'])
            for i,source in enumerate(other['sources']):
                source['acquisition_id']=other['acquisition_ids'][i]
                source['product_id']='other-product-'+str(i)
                source['sha256']=hashlib.sha256(('other-source-'+str(i)).encode()).hexdigest()
            other['sources'][0][shared]=first['sources'][0][shared]
            m['cases'].append(other)
            with self.assertRaisesRegex(BenchmarkError,'Split leakage: source'):
                self.run_manifest(m)

    def test_quiet_only_budget_cannot_reward_total_abstention(self):
        # Deliberately declared field metadata tests the publication gate only.
        # Arrays remain artificial; this is not a real sensor/reference case.
        m=self.manifest;m['track']='sentinel1_c_band';m['evidence_kind']='field_reference'
        for source in m['cases'][0]['sources']:
            source['sensor']='Sentinel-1';source['frequency_band']='C'
        m['policy']['task_budget']['min_inclusive_change_recall']=None
        arrays=self.arrays();arrays['prediction_before'][:]=-1
        self.rewrite_arrays(arrays)
        result=self.run_manifest(m)
        self.assertEqual(result['task_budget_result']['status'],'not_met_on_supplied_reference')
        self.assertEqual(result['task_budget_result']['scope'],'quiet_false_alert_and_abstention_only_no_change_sensitivity')
        self.assertEqual(result['field_validation'],'not_established_by_this_runner')
        m['policy']['task_budget']['prediction_abstention_rate_reference_valid_max']=1
        with self.assertRaises(BenchmarkError):self.run_manifest(m)

    def test_pooled_areas_sum_case_areas_and_pixels_pool_explicitly(self):
        other = copy.deepcopy(self.manifest["cases"][0])
        other["id"] = "another-same-fold-case"
        other["grid"]["pixel_area_m2"] = 8
        other["grid"]["transform"][1] = 4
        self.manifest["cases"].append(other)
        result = self.run_manifest(self.manifest)
        score = result["pooled_by_fold"]["final"]
        self.assertEqual(score["counts"]["reference_valid_pixels"], 14)
        self.assertEqual(score["area_m2"]["reference_valid"], 84)
        self.assertEqual(score["area_m2"]["false_alert"], 36)
        self.assertEqual(score["false_alert_area_per_reference_valid_area"], 3/7)

    def test_manifest_archive_array_policy_and_geometry_tamper(self):
        frozen = file_sha256(self.path)
        self.manifest["policy"]["algorithm"]["version"] = "changed-after-freeze"
        self.path.write_text(json.dumps(self.manifest))
        with self.assertRaisesRegex(BenchmarkError, "Manifest hash changed"):
            evaluate(self.path, expected_manifest_sha256=frozen)
        archive = self.root / "synthetic.npz"
        with archive.open("ab") as stream:
            stream.write(b"tamper")
        with self.assertRaisesRegex(BenchmarkError, "Archive hash changed"):
            self.run_manifest(self.manifest)
        self.manifest["cases"][0]["inputs"]["archive_sha256"] = file_sha256(archive)
        self.manifest["cases"][0]["inputs"]["array_sha256"]["prediction_before"] = "0"*64
        with self.assertRaisesRegex(BenchmarkError, "Array hash changed"):
            self.run_manifest(self.manifest)
        self.manifest["cases"][0]["geometry"]["definition"] += " changed"
        with self.assertRaisesRegex(BenchmarkError, "Geometry hash changed"):
            self.run_manifest(self.manifest)

    def test_mixed_track_and_product_release_fail_closed(self):
        for field, value in (("sensor", "NISAR"), ("frequency_band", "C"), ("crid", "new-crid"),
                             ("product_release", "new-release"), ("maturity", "new-maturity")):
            with self.subTest(field=field):
                m = copy.deepcopy(self.manifest)
                m["cases"][0]["sources"][1][field] = value
                with self.assertRaises(BenchmarkError):
                    self.run_manifest(m)

    def test_rights_independence_timing_visibility_are_ineligible_never_pass(self):
        for key, value in (("independence", "unresolved"), ("temporal_match", "unresolved"),
                           ("visibility", "unresolved"), ("dependency_ids", ["SYNTHETIC-product-0"])):
            with self.subTest(key=key):
                m = copy.deepcopy(self.manifest)
                m["cases"][0]["reference"][key] = value
                result = self.run_manifest(m)
                self.assertEqual(result["eligibility"], "ineligible")
                self.assertTrue(result["cases"][0]["ineligibility_reasons"])
                self.assertNotIn("met_on_supplied_reference", result["task_budget_result"]["status"])
        m = copy.deepcopy(self.manifest)
        m["cases"][0]["reference"]["licence"]["status"] = "unresolved"
        result = self.run_manifest(m)
        self.assertEqual(result["eligibility"], "ineligible")
        self.assertIn("reference evaluation rights unresolved", result["cases"][0]["ineligibility_reasons"])

    def test_invalid_shapes_classes_masks_and_nonfinite_fail(self):
        initial = copy.deepcopy(self.manifest)
        base = self.arrays()
        for value in (2, np.nan, np.inf):
            with self.subTest(value=value):
                self.manifest = copy.deepcopy(initial)
                arrays = {k: v.copy().astype(float) for k, v in base.items()}
                arrays["prediction_before"][0, 0] = value
                self.rewrite_arrays(arrays)
                with self.assertRaises(BenchmarkError):
                    self.run_manifest(self.manifest)
        self.manifest = copy.deepcopy(initial)
        arrays = {k: v.copy() for k, v in base.items()}
        arrays["prediction_before"] = arrays["prediction_before"].reshape(1, 10)
        self.rewrite_arrays(arrays)
        with self.assertRaisesRegex(BenchmarkError, "shape"):
            self.run_manifest(self.manifest)
        self.manifest = copy.deepcopy(initial)
        arrays = {k: v.copy() for k, v in base.items()}
        arrays["reference_observable"][-1, -1] = 1
        self.rewrite_arrays(arrays)
        with self.assertRaisesRegex(BenchmarkError, "subset"):
            self.run_manifest(self.manifest)

    def test_oversized_case_count_and_manifest_grid_precede_loading(self):
        for mutation in ("cases", "shape"):
            m = copy.deepcopy(self.manifest)
            if mutation == "cases":
                m["cases"] *= MAX_CASES+1
            else:
                m["cases"][0]["grid"]["shape"] = [MAX_PIXELS+1, 1]
            with patch("numpy.load", side_effect=AssertionError("must not allocate")):
                with self.assertRaisesRegex(BenchmarkError, "bounds"):
                    self.run_manifest(m)

    def test_oversized_npy_header_is_checked_before_allocation(self):
        archive = self.root / "synthetic.npz"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as z:
            for name in ARRAYS:
                member = io.BytesIO()
                np.lib.format.write_array_header_1_0(member, {"descr": "|i1", "fortran_order": False,
                                                             "shape": (MAX_PIXELS+1, 1)})
                z.writestr(name + ".npy", member.getvalue())
        self.manifest["cases"][0]["inputs"]["archive_sha256"] = file_sha256(archive)
        with patch("numpy.load", side_effect=AssertionError("must not allocate")):
            with self.assertRaisesRegex(BenchmarkError, "shape/pixel"):
                self.run_manifest(self.manifest)

    def test_oversized_zip_compressed_and_uncompressed_fail_before_load(self):
        archive = self.root / "synthetic.npz"
        original = archive.read_bytes()
        with archive.open("wb") as stream:
            stream.truncate(MAX_ARCHIVE_BYTES+1)
        with patch("numpy.load", side_effect=AssertionError("must not allocate")):
            with self.assertRaisesRegex(BenchmarkError, "compressed size"):
                self.run_manifest(self.manifest)
        raw = bytearray(original)
        central = raw.index(b"PK\x01\x02")
        struct.pack_into("<I", raw, central+24, MAX_ARCHIVE_BYTES+1)
        archive.write_bytes(raw)
        self.manifest["cases"][0]["inputs"]["archive_sha256"] = file_sha256(archive)
        with patch("numpy.load", side_effect=AssertionError("must not allocate")):
            with self.assertRaisesRegex(BenchmarkError, "uncompressed size"):
                self.run_manifest(self.manifest)

    def test_object_pickle_array_is_rejected_before_loading(self):
        arrays = self.arrays()
        arrays["prediction_before"] = arrays["prediction_before"].astype(object)
        archive = self.root / "synthetic.npz"
        np.savez_compressed(archive, **arrays)
        self.manifest["cases"][0]["inputs"]["archive_sha256"] = file_sha256(archive)
        with patch("numpy.load", side_effect=AssertionError("must not allocate")):
            with self.assertRaisesRegex(BenchmarkError, "dtype"):
                self.run_manifest(self.manifest)

    def test_declared_header_bytes_are_bounded_before_read_or_load(self):
        archive = self.root / "synthetic.npz"
        with zipfile.ZipFile(archive, "w") as z:
            for name in ARRAYS:
                z.writestr(name + ".npy", b"\x93NUMPY\x02\x00" + struct.pack("<I", 2**32-1))
        self.manifest["cases"][0]["inputs"]["archive_sha256"] = file_sha256(archive)
        with patch("numpy.load", side_effect=AssertionError("must not allocate")):
            with self.assertRaisesRegex(BenchmarkError, "header byte limit"):
                self.run_manifest(self.manifest)

    def test_unknown_source_lineage_and_area_inconsistency_are_withheld(self):
        m = copy.deepcopy(self.manifest)
        for source in m["cases"][0]["sources"]:
            source["maturity"] = "unresolved"
        result = self.run_manifest(m)
        self.assertEqual(result["eligibility"], "ineligible")
        self.assertIn("source maturity unresolved", result["cases"][0]["ineligibility_reasons"])
        m["cases"][0]["grid"]["pixel_area_m2"] = 5
        with self.assertRaisesRegex(BenchmarkError, "affine cell area"):
            self.run_manifest(m)

    def test_freeze_timing_and_explicit_recall_policy(self):
        m = copy.deepcopy(self.manifest)
        m["cases"][0]["reference"]["frozen_at"] = "2026-01-04T00:00:00Z"
        with self.assertRaisesRegex(BenchmarkError, "Reference frozen after policy"):
            self.run_manifest(m)
        m = copy.deepcopy(self.manifest)
        del m["policy"]["task_budget"]["min_inclusive_change_recall"]
        with self.assertRaisesRegex(BenchmarkError, "Explicit recall"):
            self.run_manifest(m)

    def test_local_paths_only_and_array_hash_includes_shape_dtype(self):
        for path in ("../outside.npz", "/tmp/outside.npz", "https://example.test/a.npz"):
            with self.subTest(path=path):
                m = copy.deepcopy(self.manifest)
                m["cases"][0]["inputs"]["path"] = path
                with self.assertRaisesRegex(BenchmarkError, "local relative"):
                    self.run_manifest(m)
        a = np.zeros((2, 5), dtype=np.int8)
        self.assertNotEqual(array_sha256(a), array_sha256(a.reshape(1, 10)))
        self.assertNotEqual(array_sha256(a), array_sha256(a.astype(np.int64)))

    def test_missing_final_holdout_is_unknown_not_a_success(self):
        self.manifest["cases"][0]["fold"] = "development"
        result = self.run_manifest(self.manifest)
        self.assertIn("no final reference-valid support", result["task_budget_result"]["reasons"])
        self.assertIn("insufficient held-out cases/events for preregistered task", result["task_budget_result"]["reasons"])

    def test_duplicate_json_nonfinite_and_invalid_numeric_budget(self):
        self.path.write_text('{"schema_version":1,"schema_version":1}')
        with self.assertRaisesRegex(BenchmarkError, "Duplicate JSON"):
            self.run_manifest()
        self.path.write_text('{"schema_version": NaN}')
        with self.assertRaisesRegex(BenchmarkError, "Nonfinite"):
            self.run_manifest()
        m = copy.deepcopy(self.manifest)
        m["policy"]["task_budget"]["false_alert_area_per_reference_valid_area_max"] = -1
        with self.assertRaisesRegex(BenchmarkError, "numeric range"):
            self.run_manifest(m)

    def test_cli_outputs_deterministic_json_and_explicit_error(self):
        out = io.StringIO()
        with patch("sys.stdout", out):
            self.assertEqual(main(["evaluate", str(self.path), "--manifest-sha256", file_sha256(self.path)]), 0)
        self.assertEqual(json.loads(out.getvalue()), self.run_manifest())
        err = io.StringIO()
        with patch("sys.stderr", err):
            self.assertEqual(main(["evaluate", str(self.path), "--manifest-sha256", "0"*64]), 2)
        self.assertEqual(json.loads(err.getvalue())["status"], "invalid_no_score")
        with self.assertRaises(FileExistsError):
            write_fixture(self.root)


if __name__ == "__main__":
    unittest.main()
