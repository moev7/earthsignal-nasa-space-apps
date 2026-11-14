"""Frozen real-data integration and identity gates; no network or native driver."""
import tempfile
from pathlib import Path
import shutil
import unittest

from service.verify_geoid_development import ROOT, verify


class FrozenGeoidDevelopmentTests(unittest.TestCase):
    def test_native_export_reconciles_and_withholds_missing_classes(self):
        result = verify()
        self.assertEqual(result['sourceAssetBytes'], 19687587)
        self.assertEqual(result['summary']['common']['commonPixels'], 7935)
        self.assertEqual(result['summary']['byClass']['0']['commonPixels'], 7935)
        self.assertEqual(result['summary']['byClass']['1']['perDate'], None)
        self.assertEqual(result['summary']['byClass']['2']['perDate'], None)
        self.assertFalse(result['fieldAccuracyEstablished'])
        self.assertFalse(result['temporalComparisonAuthorized'])
        self.assertFalse(result['wholeAreaConclusionAuthorized'])
        self.assertFalse(result['NISARTransferEstablished'])

    def test_changed_plan_archive_or_acquisition_is_rejected(self):
        for name in ('selection-plan.json', 'inputs.npz', 'acquisition-receipt.json', 'result.json'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                for source in ROOT.iterdir():
                    if source.name in ('selection-plan.json', 'inputs.npz', 'acquisition-receipt.json', 'result.json'):
                        shutil.copyfile(source, root / source.name)
                target = root / name
                raw = target.read_bytes()
                target.write_bytes(raw[:-1] + bytes([raw[-1] ^ 1]))
                with self.assertRaises(ValueError):
                    verify(root)


if __name__ == '__main__':
    unittest.main()
