"""Discriminating synthetic failure fixtures; no live-source execution claim."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import h5py
import numpy as np
from PIL import Image

from service.sar import jobs
from service.sar.catalog import resolve
from service.sar.native import compare,read_nisar,read_gunw,input_digest,cog_asset
from service.sar.net import SarError,StableAsset,vetted
from service.range_reader import TransferBudget,RangeError
from service.processing import ProcessingError
from service.tests.test_processing import catalog,hdf_fixture,Response
from service.tests.test_gunw_reader import build,X,Y
from service.tests import test_sar as fixtures
from service.tests.test_sar import crop,request,record
from service.worker import Worker
from service.ground_motion import GroundMotionError


class NumericalIdentityTests(unittest.TestCase):
    def test_tiff_internal_scale_is_not_silently_treated_as_calibrated_power(self):
        from rasterio.io import MemoryFile
        from rasterio.transform import from_origin
        from service.sar.native import decode_tiff_window
        with MemoryFile() as mem:
            with mem.open(driver='GTiff',width=2,height=2,count=1,dtype='float32',crs='EPSG:4326',transform=from_origin(0,2,1,1)) as ds:
                ds.write(np.ones((2,2),np.float32),1);ds.scales=(2.0,);ds.offsets=(1.0,)
            with self.assertRaises(SarError):decode_tiff_window(mem.name,[0,0,2,2])
            values,_,grid=decode_tiff_window(mem.name,[0,0,.1,.1],pixel_window=[0,0,2,2])
            np.testing.assert_array_equal(values,1)
            self.assertEqual(grid['crs'],'SOURCE_PIXEL_GRID (not geocoded)')

    def test_gcov_reader_uses_real_hdf_bytes_and_schema_specific_exception_bits(self):
        source=catalog()
        raw=hdf_fixture(source)
        class Opener:
            def open(self,req,timeout=30):
                a,b=map(int,req.headers['Range'][6:].split('-'))
                return Response(raw[a:b+1],a,len(raw),url=source['url'])
        with patch('service.range_reader.authenticated_opener',return_value=Opener()),patch('service.sar.native._project',return_value=[95,975,135,1005]):
            result=read_nisar({'properties':source},[0,0,.1,.1],'HH','backscatter-observation','unused',SimpleNamespace(budget=TransferBudget()))
        self.assertEqual(result.values.shape,(3,4))
        np.testing.assert_array_equal(result.values,0)
        self.assertEqual(result.evidence['recordId'],source['fileID'])
        self.assertEqual(result.evidence['metadata']['productSpecificationVersion'],'1.6.0')

    def test_gcov_comparison_rejects_frame_look_and_processing_mode_changes(self):
        a=crop();a.evidence.update(sourceId='nisar',metadata={
            'trackNumber':1,'frameNumber':2,'orbitPassDirection':'Ascending','lookDirection':'Left',
            'compositeReleaseId':'R1','productVersion':'1','productSpecificationVersion':'1.6.0',
            'processingType':'Nominal','listOfObservationModes':['science'],'frequencyModes':{'A':'HH'},
            'granuleId':'before','zeroDopplerStartTime':'2026-01-01T00:00:00Z'})
        a.quantity='radar backscatter';a.unit='dB';a.convention='gamma0'
        b=copy.deepcopy(a);b.evidence.update(recordId='after',acquiredAt='2026-01-13T00:00:00Z')
        b.evidence['metadata'].update(granuleId='after',zeroDopplerStartTime='2026-01-13T00:00:00Z')
        self.assertEqual(compare([a,b]).valid.sum(),5)
        for key,value in [('frameNumber',3),('lookDirection','Right'),('processingType','Custom'),('listOfObservationModes',['diagnostic'])]:
            bad=copy.deepcopy(b);bad.evidence['metadata'][key]=value
            with self.subTest(key=key),self.assertRaises(ProcessingError):compare([a,bad])

    def test_partial_processing_metadata_and_nonfinite_valid_samples_reject(self):
        a=crop();a.quantity='radar backscatter';a.unit='dB'
        a.evidence['sourceProcessing']={'processor':None}
        b=copy.deepcopy(a);b.evidence['acquiredAt']='1996-01-13T00:00:00Z'
        with self.assertRaises(SarError):compare([a,b])
        a.evidence['sourceProcessing']={};b.evidence['sourceProcessing']={}
        b.valid[0,1]=True
        with self.assertRaises(SarError):compare([a,b])

    def test_explicit_channel_cannot_be_overridden_by_title_or_mixed_radiometry(self):
        base={'href':'https://rcm-ceos-ard.s3.ca-central-1.amazonaws.com/a.tif',
              'title':'HH gamma0 power','sar:polarization':'VV','raster:bands':[{'unit':'power'}]}
        with self.assertRaises(SarError):cog_asset({'assets':{'science':base}},'HH')
        base['sar:polarization']='HH';base['title']='HH gamma0 sigma0'
        with self.assertRaises(SarError):cog_asset({'assets':{'science':base}},'HH')

    def test_gunw_bounded_direct_layers_reject_fill_components_and_invalid_quality(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'gunw.h5';build(path)
            from service.gunw_reader import GRID
            with h5py.File(path,'r+') as h:
                p=h[GRID+'/HH'];p['connectedComponents'][0,0]=65535
                p['coherenceMagnitude'][0,1]=1.1
                p['ionospherePhaseScreen'][0,2]=999
                p['ionospherePhaseScreen'].attrs['_FillValue']=999
                h[GRID+'/mask'][0,3]=np.uint32(1<<31|11)
                h[GRID+'/mask'][0,4]=44
                # These unused height-dependent arrays must never be read.
                del h['science/LSAR/GUNW/metadata/radarGrid/heightAboveEllipsoid']
            c={'sceneName':'SYNTHETIC_GUNW','fileID':'catalog-exact','pathNumber':56,'frameNumber':19,'flightDirection':'Ascending'}
            with h5py.File(path,'r') as h,patch('service.sar.native._project',return_value=[X[0],Y[-1],X[-1],Y[0]]):
                result=read_gunw(h,c,[0,0,.1,.1],SimpleNamespace(etag='"fixture"',size=path.stat().st_size))
            np.testing.assert_array_equal(result.valid[0,:5],False)
            self.assertEqual(result.valid.sum(),40*60-5)
            self.assertEqual(result.evidence['recordId'],'catalog-exact')
            self.assertNotIn('geometryHeightM',result.evidence)
            self.assertFalse(result.evidence['troposphereApplied'])
            self.assertAlmostEqual(float(np.median(result.values[result.valid])),0)
            expected=-299792458/1.229e9/(4*np.pi)*1000
            self.assertAlmostEqual(result.values[1,11]-result.values[1,10],expected)
            with h5py.File(path,'r+') as h:h[GRID+'/xCoordinates'][10]+=1
            with h5py.File(path,'r') as h,patch('service.sar.native._project',return_value=[X[0],Y[-1],X[-1],Y[0]]),self.assertRaises(SarError):
                read_gunw(h,c,[0,0,.1,.1],SimpleNamespace(etag='"fixture"',size=1))

    def test_gunw_output_cap_rejects_before_science_layer_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'gunw.h5';build(path)
            c={'sceneName':'SYNTHETIC_GUNW','fileID':'exact','pathNumber':56,'frameNumber':19,'flightDirection':'Ascending'}
            with h5py.File(path,'r') as h,patch('service.sar.native._project',return_value=[X[0],Y[-1],X[-1],Y[0]]):
                # Default hard window cap is captured by affine_window's signature.
                original=__import__('service.sar.native',fromlist=['affine_window']).affine_window
                with patch('service.sar.native.affine_window',side_effect=lambda *a:original(*a,max_pixels=10)),self.assertRaises(SarError) as caught:
                    read_gunw(h,c,[0,0,.1,.1],SimpleNamespace(etag='"fixture"',size=1))
                self.assertEqual(caught.exception.code,'pixel_limit')


class TransportIdentityTests(unittest.TestCase):
    def test_range_ignored_or_validator_changes_never_fall_back(self):
        url='https://rcm-ceos-ard.s3.ca-central-1.amazonaws.com/test.tif'
        class Opener:
            def __init__(self,mode):self.mode=mode;self.calls=0;self.bodies=[]
            def open(self,req,timeout=30):
                a,b=map(int,req.headers['Range'][6:].split('-'));self.calls+=1
                headers={'ETag':'"one"' if self.calls==1 else '"two"'}
                if self.mode=='weak':headers['ETag']='W/"one"'
                if self.mode=='missing':headers['ETag']=''
                response=Response(b'abcd'[a:b+1],a,4,status=200 if self.mode=='full' else 206,url=url,headers=headers)
                self.bodies.append(response)
                return response
        for mode in ('full','weak','missing','changed'):
            with self.subTest(mode=mode):
                opener=Opener(mode);budget=TransferBudget(64);asset=StableAsset(url,opener,budget,validator=vetted)
                if mode=='changed':self.assertEqual(asset.fetch(0,0),b'a')
                with self.assertRaises(RangeError):asset.fetch(1,1)
                count=opener.calls
                with self.assertRaises(RangeError):asset.fetch(2,2)
                self.assertEqual(opener.calls,count)
                self.assertEqual(budget.reserved,0)
                self.assertLessEqual(budget.transferred,2)

    def test_resolved_collection_cannot_silently_change_sensor(self):
        class Reader:
            def json(self,url):return {'type':'Feature','id':'exact','collection':'rcm-ard'}
        with self.assertRaises(SarError):resolve('radarsat-1','exact',Reader())

    def test_native_window_required_and_unsupported_products_reject_before_auth(self):
        r=request();del r['pixelWindow']
        with self.assertRaises(SarError):jobs.validate_request(r)
        for product in ('GOFF','GSLC'):
            with patch('service.range_reader.authenticated_opener') as auth,self.assertRaises(SarError):
                read_nisar({'properties':{'processingLevel':product}},[0,0,.1,.1],'HH','backscatter-observation','unused',None)
            auth.assert_not_called()


class PublicationRegressionTests(unittest.TestCase):
    setUp=fixtures.PublicationTests.setUp
    tearDown=fixtures.PublicationTests.tearDown
    staged=fixtures.PublicationTests.staged
    def rehash(self,stage,name):
        p=stage/'manifest.json';m=json.loads(p.read_text());raw=(stage/name).read_bytes()
        m['artifacts'][name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
        p.write_text(json.dumps(m));return m

    def test_rehashed_source_identity_or_grid_tamper_still_rejects(self):
        _,_,stage=self.staged();p=stage/'provenance.json';original=p.read_text()
        for field,value in [('recordId','wrong-scene'),('sourceId','uavsar'),('channel','VV')]:
            evidence=json.loads(original);evidence['inputs'][0]['evidence'][field]=value;p.write_text(json.dumps(evidence));self.rehash(stage,p.name)
            with self.subTest(field=field),self.assertRaises(ValueError):jobs.verify(stage,request())
        evidence=json.loads(original);evidence['inputs'][0]['grid']['transform'][0]=9;p.write_text(json.dumps(evidence));self.rehash(stage,p.name)
        with self.assertRaises(ValueError):jobs.verify(stage,request())

    def test_rehashed_numbers_with_recomputed_stats_fail_input_digest(self):
        _,_,stage=self.staged();p=stage/'values.json';v=json.loads(p.read_text());v['values'][0]=2
        p.write_text(json.dumps(v));m=self.rehash(stage,p.name);m['stats']['min']=2;(stage/'manifest.json').write_text(json.dumps(m))
        with self.assertRaisesRegex(ValueError,'input digest'):jobs.verify(stage,request())

    def test_rehashed_alpha_tamper_and_cancelled_publication_do_not_commit(self):
        j,row,stage=self.staged()
        self.store.cancel('owner',j['id'],jobs.KIND)
        self.assertFalse(Worker(self.store).publish(row,stage))
        self.assertFalse((self.path/'results'/j['id']).exists())
        self.assertEqual(self.store.get('owner',j['id'],jobs.KIND)['status'],'cancelled')

    def test_preview_alpha_with_recomputed_hash_cannot_change_missingness(self):
        _,_,stage=self.staged();p=stage/'preview.png'
        with Image.open(p) as image:rgba=np.array(image.convert('RGBA'))
        rgba[0,1,3]=255;Image.fromarray(rgba).save(p);self.rehash(stage,p.name)
        with self.assertRaisesRegex(ValueError,'masks disagree'):jobs.verify(stage,request())

    def test_comparison_outputs_are_recomputed_from_hashed_source_populations(self):
        a=crop();a.unit='dB';a.quantity='radar backscatter';a.convention='gamma0'
        b=copy.deepcopy(a);b.values+=2;b.evidence.update(recordId='scene-2',acquiredAt='1996-01-13T00:00:00Z')
        r=request(operation='backscatter-change',recordIds=['scene-1','scene-2'])
        inputs=[{'cropSha256':input_digest(c),'grid':c.grid,'convention':c.convention,'evidence':c.evidence,
                 'values':[float(v) if ok else None for v,ok in zip(c.values.ravel(),c.valid.ravel())]} for c in (a,b)]
        with tempfile.TemporaryDirectory() as tmp:
            stage=Path(tmp);jobs.write_result(r,[record(),record('scene-2')],compare([a,b]),{'schemaVersion':'1.0','method':jobs.METHOD,'request':r,'inputs':inputs},stage)
            jobs.verify(stage,r)
            p=stage/'values.json';v=json.loads(p.read_text());v['values'][0]=3;p.write_text(json.dumps(v))
            m=self.rehash(stage,p.name);m['stats']['max']=3;(stage/'manifest.json').write_text(json.dumps(m))
            with self.assertRaisesRegex(ValueError,'subtraction'):jobs.verify(stage,r)


if __name__=='__main__':unittest.main()
