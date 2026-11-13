"""Offline integrity and corruption checks for the measured public GCOV bridge."""
import copy
import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image
import rasterio

from service.export_public_radar import (
    OUTPUT, ROOT, TIFF_NAMES, VERIFICATION, _validate_arrays, export_public_radar,
)


class PublicRadarExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = json.loads((ROOT / "manifest.json").read_bytes())
        cls.manifest = json.loads((OUTPUT / "manifest.json").read_bytes())
        cls.values = json.loads((OUTPUT / "values.json").read_bytes())
        cls.receipt = json.loads(VERIFICATION.read_bytes())
        cls.arrays = {}
        for name in TIFF_NAMES:
            with rasterio.open(ROOT / name) as dataset:
                cls.arrays[name] = dataset.read(1)
        cls.common = cls.arrays["validity.tif"] == 1

    def test_original_source_receipt_and_all_file_hashes(self):
        manifest = self.manifest
        self.assertEqual(manifest["schema"], "earthsignal.radar-study/1")
        self.assertEqual(manifest["id"], "lake-mead-gcov-2026")
        self.assertEqual(manifest["provenance"], "measured")
        self.assertEqual(manifest["quantity"], "HH radar backscatter change")
        self.assertEqual(manifest["units"], "dB")
        self.assertEqual(manifest["source"], self.source)
        self.assertEqual(self.source["before"]["acquiredAt"], "2026-06-26T12:52:20Z")
        self.assertEqual(self.source["after"]["acquiredAt"], "2026-09-30T12:52:17Z")
        self.assertEqual(set(manifest["files"]), {*TIFF_NAMES, "values.json", "verification.json",
                                                 "before.png", "after.png", "difference.png", "excluded.png"})
        self.assertNotIn("manifest.json", manifest["files"])
        for name, evidence in manifest["files"].items():
            with self.subTest(name=name):
                raw = (OUTPUT / name).read_bytes()
                self.assertEqual(evidence["bytes"], len(raw))
                self.assertRegex(evidence["sha256"], r"^[0-9a-f]{64}$")
                self.assertEqual(evidence["sha256"], hashlib.sha256(raw).hexdigest())
        hashes = self.source["processing"]["sourceMetadata"]["artifactSha256"]
        for name in TIFF_NAMES:
            self.assertEqual((ROOT / name).read_bytes(), (OUTPUT / name).read_bytes())
            self.assertEqual(self.manifest["files"][name]["sha256"], hashes[name])
        self.assertEqual((OUTPUT / "verification.json").read_bytes(), VERIFICATION.read_bytes())

    def test_every_native_cell_units_mask_arithmetic_and_statistics(self):
        values = self.values
        self.assertEqual((values["width"], values["height"]), (94, 114))
        decoded = {}
        for key in ("beforeDb", "afterDb", "differenceDb"):
            self.assertEqual(len(values[key]), 10716)
            nulls = np.array([v is None for v in values[key]]).reshape(114, 94)
            np.testing.assert_array_equal(nulls, ~self.common)
            array = np.array([np.nan if v is None else v for v in values[key]]).reshape(114, 94)
            self.assertTrue(np.isfinite(array[self.common]).all())
            decoded[key] = array
        for key, name in (("beforeDb", "before.tif"), ("afterDb", "after.tif")):
            expected = 10 * np.log10(self.arrays[name][self.common].astype(np.float64))
            np.testing.assert_allclose(decoded[key][self.common], expected, rtol=0, atol=1e-12)
        np.testing.assert_array_equal(decoded["differenceDb"][self.common],
                                      self.arrays["difference.tif"][self.common])
        measured = decoded["afterDb"][self.common] - decoded["beforeDb"][self.common]
        np.testing.assert_allclose(measured, decoded["differenceDb"][self.common], rtol=0, atol=1e-5)
        summary = dict(zip(("p05Db", "medianDb", "p95Db"), np.percentile(measured, [5, 50, 95])))
        summary.update(minDb=measured.min(), maxDb=measured.max())
        for key, actual in summary.items():
            self.assertAlmostEqual(actual, self.source["stats"][key], places=10)
        self.assertEqual(int(self.common.sum()), 10002)
        self.assertEqual(int((~self.common).sum()), 714)
        self.assertEqual(self.source["coverage"]["validAreaKm2"], 1.0002)
        self.assertAlmostEqual(100 * self.common.mean(), 93.33706606942889)
        # A real interior cell detects row/column transposition or flipped rows.
        row, column = 38, 77
        self.assertAlmostEqual(values["differenceDb"][row * 94 + column], -12.48598861694336)

    def test_native_png_orientation_shared_stretch_and_excluded_overlay(self):
        images = {}
        for name in ("before", "after", "difference", "excluded"):
            with Image.open(OUTPUT / (name + ".png")) as image:
                self.assertEqual(image.size, (94, 114))
                self.assertEqual(image.mode, "RGBA")
                images[name] = np.array(image)
        display = self.source["display"]
        for name, key in (("before", "beforeDb"), ("after", "afterDb")):
            rgba = images[name]
            np.testing.assert_array_equal(rgba[:, :, 3], self.common.astype(np.uint8) * 255)
            values = np.array([np.nan if v is None else v for v in self.values[key]]).reshape(114, 94)
            expected_grey = (255 * np.clip((values[self.common] - display["backscatterMinDb"]) /
                             (display["backscatterMaxDb"] - display["backscatterMinDb"]), 0, 1)).astype(np.uint8)
            for channel in range(3):
                np.testing.assert_array_equal(rgba[:, :, channel][self.common], expected_grey)
        difference = images["difference"]
        np.testing.assert_array_equal(difference[:, :, 3], self.common.astype(np.uint8) * 255)
        scores = self.arrays["difference.tif"]
        negative = self.common & (scores < -1)
        positive = self.common & (scores > 1)
        self.assertTrue((difference[:, :, 2][negative] > difference[:, :, 0][negative]).all())
        self.assertTrue((difference[:, :, 0][positive] > difference[:, :, 2][positive]).all())
        np.testing.assert_array_equal(images["excluded"][self.common], np.zeros((10002, 4), dtype=np.uint8))
        np.testing.assert_array_equal(images["excluded"][~self.common],
                                      np.tile([245, 158, 11, 185], (714, 1)))

    def test_frozen_export_rebuild_and_read_only_check(self):
        before = {p.name: p.read_bytes() for p in OUTPUT.iterdir() if p.is_file()}
        self.assertEqual(export_public_radar(check=True), self.manifest)
        self.assertEqual(before, {p.name: p.read_bytes() for p in OUTPUT.iterdir() if p.is_file()})
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / "public"
            rebuilt = export_public_radar(destination)
            self.assertEqual(export_public_radar(destination, check=True), rebuilt)
            self.assertEqual(rebuilt["source"], self.manifest["source"])
            # Original TIFFs and the receipt are byte-exact on every platform.
            for name in (*TIFF_NAMES, "verification.json"):
                self.assertEqual((destination / name).read_bytes(), (OUTPUT / name).read_bytes())

    def test_portable_check_allows_only_log_roundoff_and_lossless_png_encoding(self):
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp)
            manifest = export_public_radar(destination)
            values_path = destination / "values.json"
            original_values = json.loads(values_path.read_bytes())
            values = copy.deepcopy(original_values)
            index = next(i for i, v in enumerate(values["beforeDb"]) if v is not None)

            def replace(name, raw):
                (destination / name).write_bytes(raw)
                manifest["files"][name] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
                (destination / "manifest.json").write_text(json.dumps(manifest))

            values["beforeDb"][index] += 1e-14
            replace("values.json", json.dumps(values).encode())
            image_path = destination / "before.png"
            with Image.open(image_path) as image:
                pixels = image.copy()
            pixels.save(image_path, compress_level=0)
            replace("before.png", image_path.read_bytes())
            self.assertEqual(export_public_radar(destination, check=True), manifest)
            values["beforeDb"][index] += 1e-8
            replace("values.json", json.dumps(values).encode())
            with self.assertRaisesRegex(ValueError, "values.json"):
                export_public_radar(destination, check=True)
            replace("values.json", json.dumps(original_values).encode())
            values["beforeDb"][index] = None
            replace("values.json", json.dumps(values).encode())
            with self.assertRaisesRegex(ValueError, "values.json"):
                export_public_radar(destination, check=True)
            replace("values.json", json.dumps(original_values).encode())
            pixels.putpixel((0, 0), (1, 2, 3, 255))
            pixels.save(image_path)
            replace("before.png", image_path.read_bytes())
            with self.assertRaisesRegex(ValueError, "before.png"):
                export_public_radar(destination, check=True)

    def test_corrupt_inputs_rejected_before_output(self):
        for name in ("manifest.json", *TIFF_NAMES, "verification.json"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                source = Path(tmp) / "source"
                source.mkdir()
                for original in ("manifest.json", *TIFF_NAMES):
                    shutil.copyfile(ROOT / original, source / original)
                receipt = source / "verification.json"
                shutil.copyfile(VERIFICATION, receipt)
                path = source / name
                path.write_bytes(path.read_bytes() + b"corrupt")
                destination = Path(tmp) / "public"
                with self.assertRaisesRegex(ValueError, "hash mismatch"):
                    export_public_radar(destination, source_dir=source, verification_path=receipt)
                self.assertFalse(destination.exists())

    def test_corrupt_public_values_rejected_even_with_recomputed_table_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp)
            manifest = export_public_radar(destination)
            values = copy.deepcopy(self.values)
            values["differenceDb"][38 * 94 + 77] += 1
            raw = json.dumps(values).encode()
            (destination / "values.json").write_bytes(raw)
            manifest["files"]["values.json"] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
            (destination / "manifest.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "values.json"):
                export_public_radar(destination, check=True)

    def test_invalid_grid_mask_power_difference_coverage_stats_and_receipt_rejected(self):
        for case in ("dimensions", "codes", "mask", "power", "difference", "coverage", "stats", "receipt", "stretch"):
            with self.subTest(case=case):
                source, receipt = copy.deepcopy(self.source), copy.deepcopy(self.receipt)
                arrays = {name: array.copy() for name, array in self.arrays.items()}
                row, column = 38, 77
                if case == "dimensions":
                    arrays["before.tif"] = arrays["before.tif"][:-1]
                elif case == "codes":
                    arrays["validity.tif"][row, column] = 2
                elif case == "mask":
                    arrays["validity.tif"][row, column] = 0
                elif case == "power":
                    arrays["before.tif"][row, column] = -1
                elif case == "difference":
                    arrays["difference.tif"][row, column] += 0.5
                elif case == "coverage":
                    source["coverage"]["commonValidPercent"] += 1
                elif case == "stats":
                    source["stats"]["medianDb"] += 0.1
                elif case == "receipt":
                    receipt["nativeSourceReproduction"] = "not_requested"
                elif case == "stretch":
                    source["display"]["differenceLimitDb"] += 1
                with self.assertRaises(ValueError):
                    _validate_arrays(source, arrays, receipt)


if __name__ == "__main__":
    unittest.main()
