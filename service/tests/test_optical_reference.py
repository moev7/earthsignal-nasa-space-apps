"""Frozen real optical development data: reconciliation, not field validation."""
import shutil
import tempfile
import unittest
from pathlib import Path
from service.verify_optical_reference import ROOT,verify

class OpticalReferenceTests(unittest.TestCase):
    def test_frozen_native_population_and_unknowns(self):
        r=verify()
        self.assertEqual(r['commonOpticalKnownPixels'],2453)
        self.assertEqual(r['uncertainOpticalPixels'],46)
        self.assertEqual(sum(r['sclTransitions'].values())+r['uncertainOpticalPixels'],2499)
        self.assertEqual(r['sclTransitions']['5->6'],27)
        self.assertEqual(r['sclTransitions']['6->5'],39)
        self.assertFalse(r['fieldAccuracyEstablished'])

    def test_changed_metadata_receipt_or_inputs_fail_closed(self):
        for name in ('receipt.json','source-items.json','before.npz','after.npz'):
            with self.subTest(name=name),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp)/'frozen';shutil.copytree(ROOT,root)
                p=root/name;p.write_bytes(p.read_bytes()+b' ')
                with self.assertRaises(ValueError):verify(root)

if __name__=='__main__':unittest.main()
