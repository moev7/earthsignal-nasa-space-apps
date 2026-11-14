import hashlib, json, unittest
from pathlib import Path
import numpy as np
from affine import Affine
from process_water import summarize

class ProcessingTest(unittest.TestCase):
    def test_area_uses_native_pixel_determinant(self):
        pixels=np.array([[0,1,2],[1,252,253],[255,0,1]],dtype=np.uint8)
        area,counts=summarize(pixels,Affine(30,0,0,0,-30,0))
        self.assertEqual(area,900)
        self.assertAlmostEqual(counts['1']['areaKm2'],0.0027)
        self.assertEqual(sum(c['pixels'] for c in counts.values()),pixels.size)
        included=sum(counts.get(str(i),{}).get('pixels',0) for i in [0,1,2])
        self.assertEqual(included,6)
    def test_generated_receipt_matches_actual_source(self):
        root=Path(__file__).resolve().parents[2]/'public/data'
        manifest=json.loads((root/'processed-water.json').read_text())
        self.assertEqual(hashlib.sha256((root/'lake-mead-water.tif').read_bytes()).hexdigest(),manifest['source']['sha256'])
        self.assertAlmostEqual(manifest['openWaterClassAreaKm2'],447485*900/1e6)
        self.assertAlmostEqual(manifest['class2AreaKm2'],109531*900/1e6)
        self.assertEqual(sum(x['pixels'] for x in manifest['classes'].values()),manifest['totalPixels'])
        self.assertEqual(manifest['includedPixels'],sum(manifest['classes'][str(i)]['pixels'] for i in [0,1,2]))
        self.assertLess(manifest['includedPixels'],manifest['totalPixels'])
if __name__=='__main__':unittest.main()
