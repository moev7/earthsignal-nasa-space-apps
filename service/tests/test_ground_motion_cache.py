import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
from service import ground_motion_study as study
from service import ground_motion_timeseries as series
from service.gunw_reader import PairCrop


def crop(height=0):
    array=np.ones((2,2))
    return PairCrop('granule',1,2,'A','2026-06-18','2026-06-30','1.5.0','1',32639,.24,height,
                    np.array([1.,81.]),np.array([81.,1.]),*[array.copy() for _ in range(9)])


class CacheTests(unittest.TestCase):
    def test_geometry_source_height_and_reader_identity_control_reuse_and_series_lookup(self):
        g={'granule':'granule','url':'https://nisar.asf.earthdatacloud.nasa.gov/one.h5','collection':'NISAR_L2_GUNW_PROVISIONAL_V1'}
        bbox=[51.,35.,51.01,35.01]
        self.assertNotEqual(study.crop_cache_identity(g,bbox,0),study.crop_cache_identity(g,[51.,35.,51.02,35.01],0))
        self.assertNotEqual(study.crop_cache_identity(g,bbox,0),study.crop_cache_identity(g,bbox,1))
        self.assertNotEqual(study.crop_cache_identity(g,bbox,0),study.crop_cache_identity({**g,'url':g['url']+'new'},bbox,0))
        class H5:
            def __getitem__(self,key):return np.asarray(32639)
            def close(self):pass
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)
            # A legacy entry must never satisfy a new geometry-dependent fetch.
            crop().save(root/'granule.npz')
            with patch('service.gunw_reader.open_remote',return_value=(H5(),SimpleNamespace(etag='etag',size=100))),patch.object(study,'read_crop',return_value=crop()) as reader:
                a,_=study.fetch(g,root,bbox,root/'netrc',1000,0)
                b,spent=study.fetch(g,root,bbox,root/'netrc',1000,0)
                self.assertEqual(reader.call_count,1)
                self.assertEqual(spent,0)
                np.testing.assert_array_equal(a.phase,b.phase)
                loaded=series.load_crops(['granule'],root,bbox)
                np.testing.assert_array_equal(loaded[('A',1,2)][0].phase,a.phase)
                path=root/(study.crop_cache_identity(g,bbox,0)+'.npz')
                path.write_bytes(path.read_bytes()+b'changed')
                with self.assertRaisesRegex(Exception,'content'):
                    study.fetch(g,root,bbox,root/'netrc',1000,0)
                with self.assertRaisesRegex(Exception,'content'):
                    series.load_crops(['granule'],root,bbox)

    def test_multiple_heights_cannot_be_silently_selected_for_series(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)
            for n in [1,2]:
                (root/(str(n)*64+'.json')).write_text(json.dumps({'key':str(n)*64,'granule':'g','bbox':[0,0,1,1],'referenceHeightM':n}))
            with self.assertRaisesRegex(Exception,'Multiple crop geometries'):
                series.load_crops(['g'],root,[0,0,1,1])

    def test_legacy_cache_cannot_satisfy_an_unverified_geometry(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);crop().save(root/'granule.npz')
            with self.assertRaisesRegex(Exception,'Legacy crops'):
                series.load_crops(['granule'],root,[51,35,51.1,35.1])
            loaded=series.load_crops(['granule'],root,allow_legacy=True)
            self.assertEqual(loaded[('A',1,2)][0].granule,'granule')
