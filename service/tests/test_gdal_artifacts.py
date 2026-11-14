"""Native exported-mask reconciliation on the actual GDAL runtime; no archive data."""
import tempfile
import unittest
from pathlib import Path
import numpy as np
try:
    from osgeo import gdal, osr
except ImportError:
    gdal = osr = None
from service.processing import compare_arrays, _write_tif, _write_previews, _preview_rgba

@unittest.skipIf(gdal is None, 'Requires deployed native GDAL runtime')
class GDALArtifacts(unittest.TestCase):
    def test_geotiff_counts_grid_and_display_layers(self):
        before=np.array([[1,0,1],[2,np.nan,2]],dtype=np.float32)
        after=np.array([[8,1,2],[4,4,4]],dtype=np.float32)
        bm=np.array([[1,1,0],[1,1,1]],dtype=np.uint8)
        am=np.array([[1,1,1],[0,1,1]],dtype=np.uint8)
        exceptions=np.array([[2,0,0],[0,0,0]],dtype=np.uint8)
        diff,bv,av,common,stats,coverage=compare_arrays(before,after,bm,am,before_exception=exceptions,after_exception=np.zeros_like(exceptions))
        self.assertEqual((coverage['beforeValidPixels'],coverage['afterValidPixels'],coverage['commonValidPixels']),(2,5,1))
        np.testing.assert_array_equal(bv,[[False,False,False],[True,False,True]])
        np.testing.assert_array_equal(common,[[False,False,False],[False,False,True]])
        gt=(500000,20,0,4000000,0,-20)
        crs=osr.SpatialReference(); crs.ImportFromEPSG(32611)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for name,data in [('before',np.where(bv,before,np.nan)),('after',np.where(av,after,np.nan)),('difference',diff)]:
                _write_tif(root/(name+'.tif'),data,gt,crs)
                ds=gdal.Open(str(root/(name+'.tif')))
                self.assertEqual(ds.GetGeoTransform(),gt)
                expected={'before':2,'after':5,'difference':1}[name]
                self.assertEqual(np.isfinite(ds.ReadAsArray()).sum(),expected)
                ds=None
            _write_tif(root/'validity.tif',common.astype(np.uint8),gt,crs,byte=True)
            ds=gdal.Open(str(root/'validity.tif'))
            np.testing.assert_array_equal(ds.ReadAsArray(),[[0,0,0],[0,0,1]]); ds=None
            arrays={'before':_preview_rgba(before,bv,0,4),'after':_preview_rgba(after,av,0,4),'difference':_preview_rgba(diff,common,-4,4,diverging=True),'excluded':_preview_rgba(diff,common,0,1,excluded=True)}
            bounds=_write_previews(root,arrays,gt,crs)
            self.assertLess(bounds[0][0],bounds[1][0]); self.assertLess(bounds[0][1],bounds[1][1])
            from PIL import Image
            for name in arrays:
                with Image.open(root/(name+'.png')) as preview:
                    self.assertEqual(preview.mode,'RGBA')
                    self.assertLessEqual(max(preview.size),1024)
        self.assertAlmostEqual(stats['medianDb'],3.010299956639812)
