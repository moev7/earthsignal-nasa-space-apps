import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
from service.observatory.raster import validate_asset,crop_bands,compare_crops,EarthdataAuth
from service.range_reader import RangeError,TransferBudget
try:from osgeo import gdal,osr
except ImportError:gdal=osr=None

class AssetTests(unittest.TestCase):
    def test_earthdata_auth_is_never_added_to_public_asset_hosts(self):
        from urllib.request import HTTPPasswordMgrWithPriorAuth,Request
        manager=HTTPPasswordMgrWithPriorAuth();manager.add_password(None,'https://urs.earthdata.nasa.gov','fixture','test-only-password',is_authenticated=True)
        handler=EarthdataAuth(manager)
        for host in ('e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com','archive.podaac.earthdata.nasa.gov','deotb6e7tfubr.cloudfront.net'):
            req=Request('https://'+host+'/test.tif',headers={'Authorization':'Basic fixture'})
            self.assertFalse(handler.https_request(req).has_header('Authorization'))
            self.assertIsNone(handler.http_error_401(req,None,401,'Unauthorized',{}))
        req=Request('https://urs.earthdata.nasa.gov/oauth/authorize')
        self.assertTrue(handler.https_request(req).has_header('Authorization'))

    def test_arbitrary_urls_and_auth_queries_denied(self):
        for url in ['http://sentinel-cogs.s3.us-west-2.amazonaws.com/a.tif','https://localhost/a','https://evil.example/a','https://sentinel-cogs.s3.us-west-2.amazonaws.com/a?token=private','https://user:pass@sentinel-cogs.s3.us-west-2.amazonaws.com/a']:
            with self.assertRaises(RangeError):validate_asset(url)
        self.assertTrue(validate_asset('https://sentinel-cogs.s3.us-west-2.amazonaws.com/a.tif'))

@unittest.skipIf(gdal is None,'Native GDAL required for actual COG window tests')
class NativeRasterTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.ref=osr.SpatialReference();self.ref.ImportFromEPSG(32611);self.ref.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        self.transform=(700000,20,0,4000000,0,-20)
        wgs=osr.SpatialReference();wgs.ImportFromEPSG(4326);wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        convert=osr.CoordinateTransformation(self.ref,wgs)
        ring=[list(convert.TransformPoint(x,y)[:2]) for x,y in [(700000,3999940),(700060,3999940),(700060,4000000),(700000,4000000),(700000,3999940)]]
        self.area={'type':'Polygon','coordinates':[ring]};self.config=SimpleNamespace(netrc=self.root/'absent.netrc',max_pixels=1000000,transfer_bytes=512*1024*1024)
    def tearDown(self):self.tmp.cleanup()
    def raster(self,name,values,shift=0):
        path=self.root/(name+'.tif');mem=gdal.GetDriverByName('MEM').Create('',3,3,1,gdal.GDT_UInt16)
        mem.SetProjection(self.ref.ExportToWkt());t=list(self.transform);t[0]+=shift;mem.SetGeoTransform(t);mem.GetRasterBand(1).WriteArray(values)
        ds=gdal.GetDriverByName('COG').CreateCopy(str(path),mem);ds=None;mem=None
        return {'href':'https://sentinel-cogs.s3.us-west-2.amazonaws.com/'+name+'.tif','scale':.0001,'offset':0.,'nodata':0}
    def local(self):
        root=self.root
        class Asset:
            def __init__(self,url,opener,budget,validator=None):
                self.data=(root/url.rsplit('/',1)[-1]).read_bytes();self.error=None;self.budget=budget
            def length(self):return len(self.data)
            def fetch(self,start,end):
                data=self.data[start:end+1];self.budget.reserve(len(data));self.budget.settle(len(data),len(data));return data
        return patch('service.observatory.raster.RemoteAsset',Asset)
    def test_calibrated_indices_masks_and_common_population(self):
        qa=np.full((3,3),4,np.uint16);qa[1,1]=8
        assets={n:self.raster(n,np.full((3,3),v,np.uint16)) for n,v in [('red',2000),('nir',8000),('swir',4000)]};assets['qa']=self.raster('qa',qa)
        with self.local():result=crop_bands(assets,self.area,self.config)
        self.assertEqual(result['totalPixels'],9);self.assertEqual(result['validPixels'],8);self.assertAlmostEqual(result['metrics'][0]['value'],.6)
        comparison=compare_crops(result,result,'sentinel');self.assertEqual(comparison['metrics'][0]['value'],0);self.assertAlmostEqual(comparison['coveragePercent'],800/9)
    def test_shifted_grid_rejected(self):
        assets={n:self.raster(n,np.full((3,3),4 if n=='qa' else 1000,np.uint16),shift=5 if n=='qa' else 0) for n in ['red','nir','swir','qa']}
        with self.local(),self.assertRaises(RangeError):crop_bands(assets,self.area,self.config)
    def test_hole_reconciles_denominator(self):
        wgs=osr.SpatialReference();wgs.ImportFromEPSG(4326);wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER);convert=osr.CoordinateTransformation(self.ref,wgs)
        hole=[list(convert.TransformPoint(x,y)[:2]) for x,y in [(700021,3999961),(700039,3999961),(700039,3999979),(700021,3999979),(700021,3999961)]]
        area={'type':'Polygon','coordinates':[self.area['coordinates'][0],hole]}
        assets={'water':self.raster('water',np.ones((3,3),np.uint16))}
        with self.local():result=crop_bands(assets,area,self.config,kind='dswx')
        self.assertEqual(result['totalPixels'],8);self.assertEqual(result['validPixels'],8);self.assertAlmostEqual(result['metrics'][0]['value'],8*400/1e6)

    def test_landsat_ancillary_scaling_terrain_mask_and_missing_disclosure(self):
        assets={'temperature':self.raster('temperature',np.full((3,3),50000,np.uint16)),
                'qa':self.raster('qa',np.zeros((3,3),np.uint16))}
        assets['temperature'].update(scale=.00341802,offset=149.,nodata=0)
        assets['qa'].pop('nodata')
        for n,v in [('st_qa',150),('cloud_distance',300)]:
            assets[n]=self.raster(n,np.full((3,3),v,np.uint16));assets[n].update(scale=.01,offset=0,nodata=-9999)
        radsat=np.zeros((3,3),np.uint16);radsat[0,0]=2048;radsat[0,1]=1
        assets['radsat']=self.raster('radsat',radsat);assets['radsat'].pop('nodata')
        with self.local():result=crop_bands(assets,self.area,self.config,kind='landsat')
        self.assertEqual(result['validPixels'],8)  # Optical saturation is not thermal saturation.
        self.assertAlmostEqual(result['metrics'][0]['value'],319.901)
        self.assertTrue(any('median 1.5 K' in n for n in result['qualityNotes']))
        self.assertTrue(any('median 3 km' in n for n in result['qualityNotes']))
        self.assertIn('radsatMask',result['hashes'])
        assets.pop('radsat');assets.pop('st_qa');assets.pop('cloud_distance')
        with self.local():legacy=crop_bands(assets,self.area,self.config,kind='landsat')
        self.assertEqual(legacy['validPixels'],9);self.assertTrue(any('unavailable' in n for n in legacy['qualityNotes']))

    def test_ancillary_nodata_and_calibration_fail_closed(self):
        assets={'temperature':self.raster('temperature',np.full((3,3),50000,np.uint16)),
                'qa':self.raster('qa',np.zeros((3,3),np.uint16))}
        assets['temperature'].update(scale=.00341802,offset=149.,nodata=0);assets['qa'].pop('nodata')
        values=np.full((3,3),100,np.uint16);values[1,1]=65535
        assets['st_qa']=self.raster('st_qa',values);assets['st_qa'].update(scale=.01,offset=0,nodata=65535)
        with self.local():result=crop_bands(assets,self.area,self.config,kind='landsat')
        self.assertEqual(result['validPixels'],8)
        assets['st_qa']['scale']=.1
        with self.local(),self.assertRaises(RangeError):crop_bands(assets,self.area,self.config,kind='landsat')

    def test_native_exports_independently_reconcile_mask_grid_and_difference(self):
        from service.observatory.views import export_comparison,verify_exports
        import hashlib
        qa=np.full((3,3),4,np.uint16);qa[1,1]=8
        assets={n:self.raster(n,np.full((3,3),v,np.uint16)) for n,v in [('red',2000),('nir',8000),('swir',4000)]};assets['qa']=self.raster('qa',qa)
        with self.local():before=crop_bands(assets,self.area,self.config)
        assets['nir']=self.raster('nir',np.full((3,3),9000,np.uint16))
        with self.local():after=crop_bands(assets,self.area,self.config)
        destination=self.root/'export'
        views=export_comparison(before,after,{'date':'2025-06-01T00:00:00Z','evidenceId':'e-before'},{'date':'2025-06-20T00:00:00Z','evidenceId':'e-after'},destination)
        self.assertEqual(len(views),2)
        for view in views:verify_exports(view,destination)
        view=views[0];name=view['files']['difference']['raster'];ds=gdal.Open(str(destination/name),gdal.GA_Update)
        values=ds.ReadAsArray();valid=np.isfinite(values);values[valid]+=1;ds.GetRasterBand(1).WriteArray(values);ds=None
        view['hashes'][name]=hashlib.sha256((destination/name).read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError,'cannot be reproduced'):verify_exports(view,destination)

    def test_water_category_exports_reconcile_partial_water_masks_and_tampering(self):
        from service.observatory.views import export_comparison,verify_exports
        import copy,hashlib
        before_raw=np.array([[0,1,1],[2,1,0],[0,0,0]],np.uint16)
        after_raw=np.array([[1,0,1],[2,253,0],[0,0,0]],np.uint16)
        assets={'water':self.raster('water',before_raw)};assets['water'].pop('nodata')
        with self.local():before=crop_bands(assets,self.area,self.config,kind='dswx')
        assets={'water':self.raster('water',after_raw)};assets['water'].pop('nodata')
        with self.local():after=crop_bands(assets,self.area,self.config,kind='dswx')
        output=self.root/'water-export'
        view=export_comparison(before,after,{'date':'2025-06-01T00:00:00Z','evidenceId':'e-before'},{'date':'2025-06-20T00:00:00Z','evidenceId':'e-after'},output)[0]
        r=view['transitionAccounting']
        self.assertEqual(r['counts'],dict(gain=1,loss=1,persistentClass1=1,nonClass1Both=5,unknown=1))
        self.assertEqual(r['netChangeKm2'],0)
        self.assertAlmostEqual(r['turnoverKm2'],.0008)
        verify_exports(view,output)
        bad=copy.deepcopy(view);bad['transitionAccounting']['counts']['gain']=2
        with self.assertRaises(ValueError):verify_exports(bad,output)
        # A self-consistent forged report with wrong population allocation must
        # still fail against actual pixels, even if counts/area algebra matches.
        bad=copy.deepcopy(view);bad['transitionAccounting']['counts']['persistentClass1']=2;bad['transitionAccounting']['counts']['nonClass1Both']=4
        for key in ('persistentClass1','nonClass1Both'):bad['transitionAccounting']['areasKm2'][key]=bad['transitionAccounting']['counts'][key]*r['pixelAreaKm2']
        with self.assertRaisesRegex(ValueError,'cannot be reproduced'):verify_exports(bad,output)
        filename=view['files']['transition']['raster'];ds=gdal.Open(str(output/filename),gdal.GA_Update)
        values=ds.ReadAsArray();values[0,0]=0;ds.GetRasterBand(1).WriteArray(values);ds=None
        view['hashes'][filename]=hashlib.sha256((output/filename).read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError,'cannot be reproduced'):verify_exports(view,output)

    def test_water_export_rejects_different_selected_support_without_partial_artifacts(self):
        from service.observatory.views import export_comparison
        import copy
        assets={'water':self.raster('water',np.ones((3,3),np.uint16))}
        with self.local():before=crop_bands(assets,self.area,self.config,kind='dswx')
        after=copy.deepcopy(before);after['_area'][0,0]=False
        output=self.root/'different-area'
        with self.assertRaisesRegex(ValueError,'same native grid'):export_comparison(before,after,{}, {},output)
        self.assertFalse(list(output.iterdir()))

if __name__=='__main__':unittest.main()
