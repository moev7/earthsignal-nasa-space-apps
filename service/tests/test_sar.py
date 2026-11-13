"""Native-value, product, source and owner boundaries for the shared SAR processor."""
from dataclasses import replace
from pathlib import Path
import hashlib,hmac,json,tempfile,time,unittest
from unittest.mock import patch
import numpy as np
from service.sar import jobs
from service.sar.catalog import maturity,native_assets,validate_search,search
from service.sar.net import SarError,vetted,TransferBudget
from service.sar.native import NativeCrop,power_to_db,affine_window,compare,read_cog
from service.sar.uavsar import annotation,geometry
from service.config import Config
from service.store import Store,Problem
from service.api import API
from service.worker import Worker
from service.auth import canonical

def request(**changes):
    r=dict({'schemaVersion':'1.0','sourceId':'radarsat-1','operation':'native-observation','recordIds':['scene-1'],'bbox':[0,0,.01,.01],'channel':'HH'},**changes)
    if r['operation']=='native-observation':r.setdefault('pixelWindow',[0,0,3,2])
    return r
def record(ident='scene-1'):
    return {'id':ident,'sourceId':'radarsat-1','title':'Native test scene','product':'SLC','acquiredAt':'1996-01-01T00:00:00Z','endAt':'1996-01-01T00:01:00Z',
      'collection':'Radarsat-1-L1-COG','maturity':'source-defined','channels':['HH'],'bbox':[0,0,.01,.01],'scienceAssets':1,'referenceUrl':'https://registry.opendata.aws/radarsat-1/','notice':'Synthetic transport test fixture, not a real measurement.'}
def crop():
    values=np.array([[1.,np.nan,3.],[4.,5.,6.]])
    return NativeCrop(values,np.isfinite(values),{'width':3,'height':2,'crs':'SOURCE_PIXEL_GRID (not geocoded)','transform':[0,1,0,0,0,1]},'native source values','native source magnitude (calibration withheld)','source units',
      {'sourceId':'radarsat-1','recordId':'scene-1','channel':'HH','track':1,'direction':'D','mode':'test','sourceProcessing':{},'acquiredAt':'1996-01-01T00:00:00Z'})

class NativeTests(unittest.TestCase):
    def test_calibration_masks_and_amplitude_power_are_not_interchangeable(self):
        v=np.array([[1.,10.,100.,0.,-1.,np.nan]])
        d,m=power_to_db(v,np.ones(v.shape,bool),'power')
        np.testing.assert_allclose(d[0,:3],[0,10,20]);self.assertEqual(m.sum(),3)
        a,_=power_to_db(v,np.ones(v.shape,bool),'amplitude');np.testing.assert_allclose(a[0,:3],[0,20,40])
        self.assertTrue(np.isnan(d[0,3:]).all())
        with self.assertRaises(SarError):power_to_db(v.astype(complex),np.ones(v.shape,bool),'power')
        with self.assertRaises(SarError):power_to_db(v,np.ones(v.shape,bool),'DN')
    def test_native_pixel_centers_and_affine_bounds(self):
        win,gt=affine_window([0,1,0,3,0,-1],3,3,[.5,.5,2.5,2.5])
        self.assertEqual(win,(0,0,3,3));self.assertEqual(gt,[0,1,0,3,0,-1])
        with self.assertRaises(SarError):affine_window([0,1,.1,3,0,-1],3,3,[0,0,1,1])
        with self.assertRaises(SarError):affine_window([0,1,0,3,0,-1],3,3,[4,4,5,5])
    def test_pair_checks_grid_source_quantity_and_mask_population(self):
        a=crop();b=crop()
        for c in (a,b):c.unit='dB';c.quantity='radar backscatter';c.convention='gamma0'
        b.values=b.values+2;b.evidence={**b.evidence,'acquiredAt':'1996-01-13T00:00:00Z'}
        r=compare([a,b]);np.testing.assert_allclose(r.values[r.valid],2);self.assertTrue(np.isnan(r.values[0,1]))
        for field,value in [('sourceId','uavsar'),('track',None),('sourceProcessing',{'different':True})]:
            bad=crop();bad.unit='dB';bad.quantity='radar backscatter';bad.convention='gamma0';bad.evidence={**b.evidence,field:value}
            with self.assertRaises(SarError):compare([a,bad])
        b.convention='sigma0'
        with self.assertRaises(SarError):compare([a,b])
    def test_source_allowlists_never_authorize_arbitrary_s3_or_credentials(self):
        for url in ['http://127.0.0.1/x','https://evil.test/x.tif','https://s3-ca-central-1.amazonaws.com/private/x','https://uavsar.jpl.nasa.gov/../x','https://uavsar.jpl.nasa.gov/a?token=secret']:
            with self.assertRaises(SarError):vetted(url)
        self.assertEqual(vetted('https://s3-ca-central-1.amazonaws.com/radarsat-r1-l1-cog/x.tif'),'https://s3-ca-central-1.amazonaws.com/radarsat-r1-l1-cog/x.tif')
        self.assertEqual(maturity('NISAR_L2_GCOV_V1'),'validated');self.assertEqual(maturity('UNKNOWN_V1'),'not specified')
    def test_browse_assets_and_ambiguous_annotation_cannot_be_science(self):
        self.assertEqual(native_assets({'assets':{'preview':{'href':'https://rcm-ceos-ard.s3.ca-central-1.amazonaws.com/preview.tif'}}}),{})
        with self.assertRaises(SarError):annotation('x=1\nx=2')
        with self.assertRaises(SarError):geometry({})
        q={'sourceId':'saocom','bbox':[0,0,1,1],'start':'2026-01-01','end':'2026-11-13','product':'GCOV'}
        self.assertEqual(search(q)['status'],'access-required')
        with self.assertRaises(SarError):validate_search({**q,'end':'2026-02-30'})

class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)
        self.config=Config(self.path,b's'*32,reserve_bytes=0)
        self.store=Store(self.config);self.api=API(self.store);self.nonce=0
    def tearDown(self):self.temp.cleanup()
    def call(self,method,path,body=None,owner='owner',key='sar-test-key'):
        raw=json.dumps(body).encode() if body is not None else b'';self.nonce+=1
        timestamp=str(int(time.time()));nonce='sar_test_nonce_'+str(self.nonce).zfill(12)
        signature=hmac.new(self.config.secret,canonical(method,path,owner,timestamp,nonce,raw),hashlib.sha256).hexdigest()
        return self.api.dispatch(method,path,{'X-Earthsignal-User':owner,'X-Earthsignal-Timestamp':timestamp,'X-Earthsignal-Nonce':nonce,'X-Earthsignal-Signature':signature,'Idempotency-Key':key},raw)
    def staged(self):
        r=request();j=self.store.submit('owner',r,'study-key',jobs.METHOD,kind=jobs.KIND);row=self.store.claim();stage=self.path/'staging'/j['id'];stage.mkdir()
        jobs.write_result(r,[record()],crop(),{'schemaVersion':'1.0','method':jobs.METHOD,'request':r,'inputs':[{'cropSha256':__import__('service.sar.native',fromlist=['input_digest']).input_digest(crop()),'grid':crop().grid,'convention':crop().convention,'evidence':crop().evidence}]},stage)
        return j,row,stage
    def test_numeric_publication_recomputes_masks_statistics_hashes_and_owner_scope(self):
        j,row,stage=self.staged();m=jobs.verify(stage,request());self.assertEqual(m['coverage']['valid'],5);self.assertFalse(m['published'])
        self.assertTrue(Worker(self.store).publish(row,stage))
        status,payload,_=self.call('GET','/api/sar-studies/'+j['id']);self.assertEqual(status,200);self.assertEqual(payload['result']['stats']['median'],4)
        with self.assertRaises(Problem) as caught:self.call('GET','/api/sar-studies/'+j['id'],owner='someone-else')
        self.assertEqual(caught.exception.status,404)
        self.assertEqual(self.store.list('owner'),[])
        self.assertEqual(len(self.store.list('owner',jobs.KIND)),1)
    def test_tampered_numbers_or_alpha_never_commit(self):
        j,row,stage=self.staged();p=stage/'values.json';v=json.loads(p.read_text());v['values'][0]=999;p.write_text(json.dumps(v))
        with self.assertRaises(ValueError):Worker(self.store).publish(row,stage)
        self.assertNotEqual(self.store.get('owner',j['id'],jobs.KIND)['status'],'completed')
    def test_queue_reuses_idempotency_and_shares_limits_with_existing_jobs(self):
        r=request();a=self.call('POST','/api/sar-studies',r)[1];b=self.call('POST','/api/sar-studies',r)[1];self.assertEqual(a['id'],b['id'])
        with self.assertRaises(Problem) as caught:self.call('POST','/api/sar-studies',{**r,'channel':'VV'})
        self.assertEqual(caught.exception.code,'idempotency_conflict')
        self.store.submit('owner',{'beforeId':'b','afterId':'a','bbox':[0,0,.01,.01]},'radar-job','v')
        with self.assertRaises(Problem) as caught:self.call('POST','/api/sar-studies',r,key='third-key')
        self.assertEqual(caught.exception.code,'owner_limit')
    def test_license_and_unsupported_endpoint_gates_precede_science_download(self):
        for source in ('saocom','rcm'):
            with self.assertRaises(Problem) as caught:self.call('POST','/api/sar-studies',request(sourceId=source,operation='backscatter-observation'))
            self.assertEqual(caught.exception.code,'license_required')
        with self.assertRaises(Problem):self.call('POST','/api/sar-studies/extra',request())

if __name__=='__main__':unittest.main()
