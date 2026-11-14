import hashlib
import hmac
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from service.api import API
from service.auth import canonical, authenticate
from service.config import Config
from service.store import Store, Problem, cache_key
from service.worker import Worker

REQ = {'beforeId':'before','afterId':'after','bbox':[1,2,3,4]}

class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.now = 1000000
        self.config = Config(Path(self.temp.name),b's'*32,reserve_bytes=0)
        self.store = Store(self.config,lambda:self.now)
        self.api=API(self.store,lambda:dict(ready=True,message='ready',maxPixels=1000000))
        self.serial=0
    def tearDown(self):
        self.temp.cleanup()
    def headers(self,method='GET',target='/api/change-jobs',user='user',body=b'',**extras):
        self.serial+=1
        ts=str(self.now)
        nonce=f'nonce_{self.serial:020d}'
        sig=hmac.new(self.config.secret,canonical(method,target,user,ts,nonce,body),hashlib.sha256).hexdigest()
        return dict({'X-Earthsignal-User':user,'X-Earthsignal-Timestamp':ts,'X-Earthsignal-Nonce':nonce,'X-Earthsignal-Signature':sig},**extras)
    def submit(self,user='user',key='one',req=None):
        return self.store.submit(user,req or REQ,key,'gcov-hhhh-v1')
    def problem(self,code,fn):
        with self.assertRaises(Problem) as c:
            fn()
        self.assertEqual(c.exception.code,code)
    def test_auth_replay_durable_and_tampering(self):
        headers=self.headers()
        self.assertEqual(authenticate(self.store,'GET','/api/change-jobs',headers,b''),'user')
        reopened=Store(self.config,lambda:self.now)
        self.problem('replay',lambda:authenticate(reopened,'GET','/api/change-jobs',headers,b''))
        headers=self.headers()
        self.problem('unauthorized',lambda:authenticate(self.store,'GET','/api/change-jobs?x=1',headers,b''))
        self.problem('unauthorized',lambda:authenticate(self.store,'GET','/api/change-jobs',{},b''))
        self.now+=61
        self.problem('stale_signature',lambda:authenticate(self.store,'GET','/api/change-jobs',headers,b''))
    def test_auth_signed_body_method_and_caps(self):
        body=json.dumps(REQ).encode()
        h=self.headers('POST',body=body,**{'Idempotency-Key':'one'})
        self.problem('unauthorized',lambda:authenticate(self.store,'POST','/api/change-jobs',h,body+b' '))
        self.problem('unauthorized',lambda:authenticate(self.store,'GET','/api/change-jobs',h,body))
        self.problem('body_too_large',lambda:authenticate(self.store,'POST','/api/change-jobs',h,b'x'*16385))
        status,job,_=self.api.dispatch('POST','/api/change-jobs',h,body)
        self.assertEqual((status,job['status']),(202,'queued'))
        self.assertEqual(self.store.claim()['id'],job['id'])
    def test_capability_fails_closed(self):
        api=API(self.store,lambda:dict(ready=False,message='Earthdata unavailable',maxPixels=1000000))
        body=json.dumps(REQ).encode()
        self.problem('processing_unavailable',lambda:api.dispatch('POST','/api/change-jobs',self.headers('POST',body=body,**{'Idempotency-Key':'one'}),body))
        self.assertEqual(self.store.list('user'),[])
        self.submit()
        status,job,_=api.dispatch('POST','/api/change-jobs',self.headers('POST',body=body,**{'Idempotency-Key':'one'}),body)
        self.assertEqual(status,202)
        self.assertEqual(len(self.store.list('user')),1)
    def test_idempotency_owner_and_cache_order(self):
        first=self.submit()
        self.assertEqual(self.submit()['id'],first['id'])
        self.problem('idempotency_conflict',lambda:self.submit(req={**REQ,'bbox':[0,0,1,1]}))
        second=self.submit('other')
        self.assertNotEqual(first['id'],second['id'])
        self.problem('not_found',lambda:self.store.get('other',first['id']))
        self.assertEqual(len(self.store.list('other')),1)
        self.problem('not_found',lambda:self.store.cancel('other',first['id']))
        reverse={**REQ,'beforeId':'after','afterId':'before'}
        self.assertNotEqual(cache_key(REQ,'v1'),cache_key(reverse,'v1'))
        self.assertNotEqual(cache_key(REQ,'v1'),cache_key(REQ,'v2'))
    def test_fifo_single_claim_cancel_and_no_publish(self):
        first=self.submit();self.now+=1;second=self.submit(key='two')
        row=self.store.claim()
        self.assertEqual(row['id'],first['id'])
        self.assertIsNone(self.store.claim())
        self.store.cancel('user',first['id'])
        self.assertFalse(self.store.heartbeat(first['id']))
        self.assertFalse(self.store.complete(first['id'],{}))
        self.assertEqual(self.store.claim()['id'],second['id'])
    def test_limits(self):
        first=self.submit();self.submit(key='two')
        self.problem('owner_limit',lambda:self.submit(key='three'))
        self.store.cancel('user',first['id'])
        for n in range(3):
            j=self.submit(key=f'extra{n}');self.store.cancel('user',j['id'])
        self.problem('daily_limit',lambda:self.submit(key='six'))
        other=Store(replace(self.config,queue_limit=1),lambda:self.now)
        self.problem('queue_full',lambda:other.submit('new',REQ,'one','v1'))
        disk=Store(replace(self.config,storage_bytes=0),lambda:self.now)
        self.problem('storage_limit',lambda:disk.submit('new',REQ,'one','v1'))
    def test_crash_lease_cleanup_and_expiry(self):
        job=self.submit();self.store.claim()
        stage=self.config.root/'staging'/job['id'];stage.mkdir();(stage/'partial').write_text('partial')
        self.now+=self.config.lease_seconds+1
        self.assertEqual(self.store.recover(),1)
        self.assertFalse(stage.exists())
        self.assertEqual(self.store.get('user',job['id'])['status'],'failed')
        self.assertIsNone(self.store.claim())
        self.now+=self.config.expiry_seconds+1
        self.problem('not_found',lambda:self.store.get('user',job['id']))
        self.store.cleanup()
        self.assertEqual(self.store.list('user'),[])
    def test_restart_fails_running_and_orphan_cleanup(self):
        job=self.submit();self.store.claim()
        orphan=self.config.root/'results'/job['id'];orphan.mkdir();(orphan/'partial').write_text('partial')
        self.assertEqual(self.store.recover(restart=True),1)
        self.assertFalse(orphan.exists())
        extra=self.config.root/'staging'/'abandoned';extra.mkdir()
        self.store.cleanup();self.assertFalse(extra.exists())
    def test_prepared_pinned_only_successful_visible_but_not_cancellable(self):
        job=self.submit()
        self.problem('not_completed',lambda:self.store.pin(job['id']))
        self.store.claim();self.assertTrue(self.store.complete(job['id'],{}));self.store.pin(job['id'])
        self.now+=8*86400;self.store.cleanup()
        self.assertTrue(self.store.get('other',job['id'])['prepared'])
        self.problem('not_found',lambda:self.store.cancel('other',job['id']))
    def test_partial_publication_never_visible(self):
        job=self.submit();row=self.store.claim()
        stage=self.config.root/'staging'/job['id'];stage.mkdir()
        (stage/'manifest.json').write_text('{}')
        with self.assertRaises(ValueError):
            Worker(self.store).publish(row,stage)
        self.assertFalse((self.config.root/'results'/job['id']).exists())
        target=f"/api/change-jobs/{job['id']}/artifacts/manifest.json"
        self.problem('not_found',lambda:self.api.dispatch('GET',target,self.headers(target=target),b''))
    def test_invalid_request(self):
        for req in ({**REQ,'bbox':[0,0,0,1]},{**REQ,'bbox':[0,0,float('nan'),1]}, {**REQ,'beforeId':'after'}, {**REQ,'url':'https://evil.test'}):
            self.problem('invalid_request',lambda:self.submit(req=req))

if __name__=='__main__':
    unittest.main()
