"""Numerical correctness, bounded validation, signed routes, optional native IO."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from service import analysis
from service.store import Problem, Store
from service.config import Config
from service.api import API
from service.tests import test_service as service_fixture
try:
    from osgeo import gdal, osr
except ImportError:
    gdal = osr = None


def square(x0=0,y0=0,x1=2,y1=2):
    return {'type':'Polygon','coordinates':[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]}


class Numerics(unittest.TestCase):
    def setUp(self):
        self.before = np.array([[1,10,100],[0,1,np.nan]],dtype=np.float32)
        self.after = np.array([[10,1,100],[1,10,1]],dtype=np.float32)
        self.diff = np.array([[10,-10,0],[np.nan,10,np.nan]],dtype=np.float32)
        self.validity = np.array([[1,1,1],[1,0,1]],dtype=np.uint8)
        self.selected = np.ones((2,3),dtype=bool)

    def test_population_bins_and_threshold_partition(self):
        s,d,common = analysis.summarize(self.before,self.after,self.diff,self.validity,self.selected,400,3)
        self.assertEqual((s['totalPixels'],s['validPixels'],s['validPercent']),(6,3,50))
        self.assertEqual(s['beforeMedianDb'],10)
        self.assertEqual(s['afterMedianDb'],10)
        self.assertEqual(s['medianChangeDb'],0)
        self.assertEqual(d['before']['edges'],d['after']['edges'])
        for distribution in d.values():
            self.assertEqual(sum(distribution['counts']),3)
            self.assertEqual(len(distribution['edges']),len(distribution['counts'])+1)
        self.assertAlmostEqual(s['increasedAreaKm2']+s['decreasedAreaKm2']+s['withinThresholdAreaKm2'],s['validAreaKm2'])
        self.assertEqual(s['increasedAreaKm2'],.0004)
        self.assertEqual(int(common.sum()),3)
        json.dumps({'summary':s,'distributions':d},allow_nan=False)

    def test_threshold_equality_is_within(self):
        d = np.array([[-3,3,3.1,-3.1]],dtype=np.float32)
        a = np.ones_like(d)
        s,_,_ = analysis.summarize(a,a,d,a,np.ones_like(a,dtype=bool),1e6,3)
        self.assertEqual((s['increasedAreaKm2'],s['decreasedAreaKm2'],s['withinThresholdAreaKm2']),(1,1,2))

    def test_zero_valid_and_zero_selected_finite(self):
        for mask,validity in [(self.selected,np.zeros_like(self.validity)),(np.zeros_like(self.selected),self.validity)]:
            s,d,_ = analysis.summarize(self.before,self.after,self.diff,validity,mask,400,3)
            self.assertEqual(s['validPixels'],0)
            for name in ('beforeMedianDb','afterMedianDb','medianChangeDb','p05Db','p95Db'):
                self.assertIsNone(s[name])
            self.assertEqual(d,{k:{'edges':[],'counts':[]} for k in ('before','after','difference')})
            json.dumps(s,allow_nan=False)

    def test_native_center_boundary_and_no_data_selection(self):
        # Native centers are (0.5,0.5), (1.5,0.5), etc; boundary centers included.
        selected = analysis.selection_mask((2,3),(0,1,0,0,0,1),square(.5,.5,1.5,1.5),lambda p:p)
        np.testing.assert_array_equal(selected,[[1,1,0],[1,1,0]])
        s,d,_ = analysis.summarize(self.before,self.after,self.diff,self.validity,selected,400,3)
        self.assertEqual((s['totalPixels'],s['validPixels']),(4,2))
        self.assertEqual(sum(d['before']['counts']),2)
        out = analysis.selection_mask((2,3),(0,1,0,0,0,1),square(5,5,6,6),lambda p:p)
        self.assertEqual(int(out.sum()),0)

    def test_selection_transform_batches_bound_wide_grid_memory(self):
        sizes = []
        def transform(points):
            sizes.append(len(points))
            return points
        selected = analysis.selection_mask((1,1_000_000),(0,1e-6,0,0,0,1),square(0,0,1,1),transform)
        self.assertEqual(int(selected.sum()),1_000_000)
        self.assertEqual(sum(sizes),1_000_000)
        self.assertLessEqual(max(sizes),8192)

    def test_coordinate_and_body_validation(self):
        for value in (None,[],[0],[0,91],[181,0],[True,0],[float('nan'),0],[0,float('inf')],[10**1000,0],'0,0'):
            with self.subTest(value=value), self.assertRaises(Problem):
                analysis.validate_request({'point':value})
        for value in ({'url':'remote'},[],{'point':None},{'thresholdDb':True},{'thresholdDb':0},{'thresholdDb':31},{'thresholdDb':10**1000},{'transect':[[0,0]]},{'transect':[[179,0],[-179,0]]}):
            with self.subTest(value=value), self.assertRaises(Problem):
                analysis.validate_request(value)
        for raw in (b'{',b'{"thresholdDb":NaN}',b'{"point":[0,0],"point":[1,1]}',b'\xff'):
            with self.assertRaises(Problem):
                analysis.parse_body(raw)
        self.assertEqual(analysis.validate_request({})['thresholdDb'],3)

    def test_simple_polygon_validation(self):
        ring = [[0,0],[2,2],[0,2],[2,0],[0,0]]
        bad = [dict(square(),extra=1),{'type':'MultiPolygon','coordinates':[]},
               {'type':'Polygon','coordinates':[ring]},
               {'type':'Polygon','coordinates':[[[0,0],[1,0],[0,0],[0,1],[0,0]]]},
               {'type':'Polygon','coordinates':[[[0,0],[2,0],[1,0],[1,1],[0,0]]]},
               {'type':'Polygon','coordinates':[[[0,0],[1,1],[2,2],[0,0]]]},
               {'type':'Polygon','coordinates':[square()['coordinates'][0],square()['coordinates'][0]]},
               square(179,0,-179,1),{'type':'Polygon','coordinates':[[[0,0]]*66]}]
        for value in bad:
            with self.subTest(value=value), self.assertRaises(Problem):
                analysis.polygon(value)
        self.assertEqual(analysis.polygon(square()),square())
        self.assertIsNone(analysis.polygon(None))

    def test_probe_nearest_cell_no_data_outside_and_rotated_grid(self):
        common = analysis.common_mask(self.before,self.after,self.diff,self.validity)
        sampler = lambda p: analysis.probe(p,self.before,self.after,self.diff,common,(0,1,0,0,0,1),lambda p:p)
        sample = sampler([.5,.5])
        self.assertTrue(sample['valid']); self.assertEqual(sample['beforeDb'],0); self.assertEqual(sample['afterDb'],10)
        for point,reason in (([-.01,.5],'outside-crop'),([3,.5],'outside-crop'),([.5,2],'outside-crop'),([1.5,1.5],'excluded-or-no-data')):
            value = sampler(point)
            self.assertEqual(value['reason'],reason); self.assertIsNone(value['differenceDb'])
        rotated = analysis.probe([1.5,.5],self.before,self.after,self.diff,common,(0,2,1,0,1,-2),lambda p:p)
        self.assertTrue(rotated['valid'])
        invalid = analysis.probe([0,0],self.before,self.after,self.diff,common,(0,1,0,0,0,1),lambda p:[float('inf'),0])
        self.assertEqual(invalid['reason'],'coordinate-transform-failed')

    def test_transect_endpoints_distance_and_null_gaps(self):
        common = analysis.common_mask(self.before,self.after,self.diff,self.validity)
        sampler = lambda p: analysis.probe(p,self.before,self.after,self.diff,common,(0,1,0,0,0,1),lambda p:p)
        endpoints = [[.5,.5],[2.5,1.5]]
        result = analysis.transect(endpoints,sampler)
        self.assertEqual(len(result),128)
        self.assertEqual(result[0]['coordinate'],endpoints[0]); self.assertEqual(result[-1]['coordinate'],endpoints[-1])
        self.assertEqual(result[0]['distanceM'],0)
        self.assertGreater(result[-1]['distanceM'],200000)
        self.assertTrue(all(a['distanceM'] <= b['distanceM'] for a,b in zip(result,result[1:])))
        self.assertIsNone(result[-1]['differenceDb'])
        zero = analysis.transect([[0,0],[0,0]],sampler)
        self.assertTrue(all(s['distanceM'] == 0 for s in zero))

    def test_shape_and_pixel_bounds(self):
        with self.assertRaises(Problem):
            analysis.common_mask(self.before,self.after[:1],self.diff,self.validity)
        a = np.ones((1001,1000),dtype=np.float32)
        with self.assertRaises(Problem):
            analysis.common_mask(a,a,a,a)

    def test_path_escape_symlink_and_generic_errors(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); folder = root/'results'/('a'*32); folder.mkdir(parents=True)
            for name in ('before','after','difference','validity'):
                (folder/(name+'.tif')).write_bytes(b'fixture')
            self.assertEqual(len(analysis._paths(root,'a'*32)),4)
            for job_id in ('../secret','/tmp/secret','bad'):
                with self.assertRaises(Problem) as caught:
                    analysis._paths(root,job_id)
                self.assertNotIn(temp,str(caught.exception))
            (folder/'before.tif').unlink(); (folder/'before.tif').symlink_to(folder/'after.tif')
            with self.assertRaises(Problem):
                analysis._paths(root,'a'*32)
            other = root/'results'/('b'*32); other.symlink_to(folder,target_is_directory=True)
            with self.assertRaises(Problem):
                analysis._paths(root,'b'*32)


class Routes(unittest.TestCase):
    setUp = service_fixture.Tests.setUp
    tearDown = service_fixture.Tests.tearDown
    headers = service_fixture.Tests.headers
    submit = service_fixture.Tests.submit

    def test_auth_ownership_status_and_validation_before_native_read(self):
        job = self.submit(); target = f"/api/change-jobs/{job['id']}/analysis"
        for headers,user in (({},None),(self.headers('POST',target,user='other',body=b'{}'),'other')):
            with self.assertRaises(Problem) as caught, patch('service.analysis._native') as native:
                self.api.dispatch('POST',target,headers,b'{}')
            self.assertEqual(caught.exception.status,401 if user is None else 404); native.assert_not_called()
        with self.assertRaises(Problem) as caught:
            self.api.dispatch('POST',target,self.headers('POST',target,body=b'{}'),b'{}')
        self.assertEqual(caught.exception.code,'not_completed')
        self.store.claim(); self.store.complete(job['id'],{}); self.store.pin(job['id'])
        body = b'{"thresholdDb":false}'
        with self.assertRaises(Problem), patch('service.analysis._native') as native:
            self.api.dispatch('POST',target,self.headers('POST',target,body=body),body)
        native.assert_not_called()
        with patch('service.analysis.analyze',return_value={'test':'native'}) as run:
            status,result,_ = self.api.dispatch('POST',target,self.headers('POST',target,user='other',body=b'{}'),b'{}')
        self.assertEqual(status,200); self.assertEqual(result,{'test':'native'})
        self.assertEqual(run.call_args.args[1],'other')

    def test_nonblocking_single_analysis_slot(self):
        job = self.submit(); self.store.claim(); self.store.complete(job['id'],{})
        analysis._ANALYSIS_SLOT.acquire()
        try:
            with self.assertRaises(Problem) as caught, patch('service.analysis._native') as native:
                analysis.analyze(self.store,'user',job['id'],{})
            self.assertEqual((caught.exception.status,caught.exception.code),(429,'analysis_busy'))
            native.assert_not_called()
        finally:
            analysis._ANALYSIS_SLOT.release()
        with patch('service.analysis._native',side_effect=Problem(422,'invalid_grid','bad')):
            with self.assertRaises(Problem):
                analysis.analyze(self.store,'user',job['id'],{})
        self.assertTrue(analysis._ANALYSIS_SLOT.acquire(False)); analysis._ANALYSIS_SLOT.release()

    def test_response_uses_native_float32_db_and_provenance(self):
        job = self.submit(); self.store.claim(); self.store.complete(job['id'],{'processing':{'algorithmVersion':'gcov-test'}})
        before = np.array([[.1,1],[10,100]],dtype=np.float32)
        after = before*2; difference = np.full((2,2),np.float32(3.0103)); valid = np.array([[1,0],[1,1]],dtype=np.uint8)
        class CRS:
            def GetAuthorityName(self,_): return 'EPSG'
            def GetAuthorityCode(self,_): return '32611'
        class Forward:
            def TransformPoint(self,*p): return p
        class Reverse:
            def TransformPoints(self,p): return p
            def TransformPoint(self,*p): return p
        native = ([before,after,difference,valid],(0,1,0,0,0,1),CRS(),400,Forward(),Reverse())
        with patch('service.analysis._native',return_value=native):
            response = analysis.analyze(self.store,'user',job['id'],{'point':[.5,.5],'transect':[[.5,.5],[1.5,1.5]]})
        self.assertEqual(response['summary']['validPixels'],3)
        self.assertEqual(response['provenance']['algorithm'],'native-radar-analysis-v2')
        inspection = response['inspectionWindows']
        self.assertEqual((inspection['selectedPixels'], inspection['validPixels'], inspection['unknownPixels']), (4, 3, 1))
        self.assertEqual(inspection['candidates'][0]['representative']['coordinate'], [.5, .5])
        self.assertEqual(inspection['thresholdDb'], response['selection']['thresholdDb'])
        self.assertIn('source processing: gcov-test',response['provenance']['method'])
        self.assertEqual(response['provenance']['crs'],'EPSG:32611')
        self.assertEqual(response['probe']['differenceDb'],float(difference[0,0]))
        self.assertAlmostEqual(response['probe']['beforeDb'],-10,places=6)
        self.assertEqual(len(response['transect']),128)
        json.dumps(response,allow_nan=False)


@unittest.skipIf(gdal is None,'Requires native GDAL runtime')
class NativeIntegration(unittest.TestCase):
    def test_native_grid_nodata_and_wgs84_axis_order(self):
        from service.processing import _write_tif
        with tempfile.TemporaryDirectory() as temp:
            store = Store(Config(Path(temp),b'x'*32,reserve_bytes=0))
            job = store.submit('owner',{'beforeId':'b','afterId':'a','bbox':[-117,36,-116,37]},'native','test')
            store.claim(); store.complete(job['id'],{})
            folder = Path(temp)/'results'/job['id']; folder.mkdir()
            crs = osr.SpatialReference(); crs.ImportFromEPSG(32611)
            gt = (500000,20,0,4000000,0,-20)
            data = np.array([[1,10],[0,100]],dtype=np.float32)
            for name,array in [('before',data),('after',data*2),('difference',np.full((2,2),3.0103,dtype=np.float32)),('validity',np.ones((2,2),dtype=np.uint8))]:
                _write_tif(folder/(name+'.tif'),array,gt,crs,byte=name=='validity')
            crs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
            wgs = osr.SpatialReference(); wgs.ImportFromEPSG(4326); wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
            reverse = osr.CoordinateTransformation(crs,wgs)
            point = list(reverse.TransformPoint(500010,3999990)[:2])
            result = analysis.analyze(store,'owner',job['id'],{'point':point})
            self.assertEqual(result['summary']['validPixels'],3)
            self.assertTrue(result['probe']['valid']); self.assertAlmostEqual(result['probe']['afterDb'],3.0103,places=4)
            self.assertEqual(result['summary']['pixelAreaM2'],400)
            ring = [list(reverse.TransformPoint(x,y)[:2]) for x,y in
                    [(500000,4000000),(500020,4000000),(500020,3999980),(500000,3999980),(500000,4000000)]]
            selected = analysis.analyze(store,'owner',job['id'],{'polygon':{'type':'Polygon','coordinates':[ring]}})
            self.assertEqual((selected['summary']['totalPixels'],selected['summary']['validPixels']),(1,1))
            for distribution in selected['distributions'].values():
                self.assertEqual(sum(distribution['counts']),1)
            # Explicit finite band nodata must be excluded, not mistaken for gamma0.
            ds = gdal.Open(str(folder/'before.tif'),gdal.GA_Update)
            ds.GetRasterBand(1).SetNoDataValue(10); ds=None
            self.assertEqual(analysis.analyze(store,'owner',job['id'],{})['summary']['validPixels'],2)
            # Same shape with mismatched origin is rejected before arrays are analyzed.
            ds = gdal.Open(str(folder/'after.tif'),gdal.GA_Update)
            ds.SetGeoTransform((500001,20,0,4000000,0,-20)); ds=None
            with self.assertRaises(Problem) as caught:
                analysis.analyze(store,'owner',job['id'],{})
            self.assertEqual(caught.exception.code,'invalid_grid')
