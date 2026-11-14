"""Real original radar exports; no reference class or calibrated error claim."""
import shutil
import tempfile
import unittest
from pathlib import Path
from service.verify_native_radar import ROOT,verify

class NativeRadarReproductionTests(unittest.TestCase):
    def test_original_measurements_and_inspection_population(self):
        r=verify()
        self.assertAlmostEqual(r['stats']['medianDb'],-1.4612621180681917,places=12)
        self.assertEqual(r['commonValidPixels'],10002)
        self.assertEqual(r['excludedPixels'],714)
        self.assertEqual(r['validAreaKm2'],1.0002)
        coverage=r['geometryCoverage']
        self.assertEqual((coverage['windowPixels'],coverage['selectedAreaPixels'],coverage['outsideAreaPixels'],coverage['invalidInsideArea']),(10716,10002,714,0))
        self.assertEqual(coverage['commonValidPercentOfSelectedArea'],100)
        self.assertAlmostEqual(coverage['originalCommonValidPercentOfWindow'],93.33706606942889)
        b=r['fixedBaseline']
        self.assertEqual((b['decreasedPixels'],b['increasedPixels'],b['withinPixels']),(3156,698,6148))
        self.assertEqual(sum(b[k] for k in ('decreasedPixels','increasedPixels','withinPixels')),10002)
        self.assertLessEqual(r['differenceFloat32MaxAbsErrorDb'],1e-6)
        self.assertFalse(r['fieldAccuracyEstablished'])
        self.assertTrue(r['quietCalibration'].startswith('withheld'))

    def test_frozen_metadata_and_each_input_reject_tampering(self):
        for name in ('manifest.json','inputs.npz','aoi.npz','before.tif','after.tif','difference.tif','validity.tif'):
            with self.subTest(name=name),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp)/'case';shutil.copytree(ROOT,root)
                p=root/name;p.write_bytes(p.read_bytes()+b' ')
                with self.assertRaises(ValueError):verify(root)

if __name__=='__main__':unittest.main()
