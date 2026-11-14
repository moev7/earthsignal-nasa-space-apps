import hashlib
import hmac
import json
import tempfile
import time
import unittest
from unittest.mock import patch
from pathlib import Path
from fastapi.testclient import TestClient
from service.api import API, create_app
from service.auth import canonical
from service.config import Config
from service.store import Store

class FastAPITests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.config=Config(Path(self.temp.name),b's'*32,reserve_bytes=0)
        self.store=Store(self.config)
        self.client=TestClient(create_app(API(self.store,lambda:dict(ready=True,message='ready',maxPixels=1000000))))
        self.serial=0
    def tearDown(self):self.client.close();self.temp.cleanup()
    def test_observatory_cache_uses_calculation_versions(self):
        from service.observatory.net import METHOD_VERSION
        from service.observatory.scenarios import VERSION
        from service.tests.test_observatory_providers import request
        app=API(self.store)
        with patch.object(self.store,'submit',return_value={'status':'queued'}) as submit:
            body=json.dumps(request()).encode()
            with patch('service.api.authenticate',return_value='owner'):
                app.dispatch('POST','/api/assessments',{'Idempotency-Key':'fixture'},body)
            self.assertEqual(submit.call_args.args[3],METHOD_VERSION)
            with patch('service.api.authenticate',return_value='owner'):
                app.dispatch('POST','/api/scenarios',{},b'{}')
            self.assertEqual(submit.call_args.args[3],VERSION)
    def signed(self,method,path,body=b''):
        self.serial+=1;timestamp=str(int(time.time()));nonce=f'nonce_{self.serial:020d}'
        signature=hmac.new(self.config.secret,canonical(method,path,'owner',timestamp,nonce,body),hashlib.sha256).hexdigest()
        return {'X-Earthsignal-User':'owner','X-Earthsignal-Timestamp':timestamp,'X-Earthsignal-Nonce':nonce,
          'X-Earthsignal-Signature':signature,'Idempotency-Key':'one','Content-Length':str(len(body))}
    def test_anonymous_signed_202_cancel_and_query_signature(self):
        self.assertEqual(self.client.get('/health').status_code,200)
        self.assertEqual(self.client.get('/api/change-jobs').status_code,401)
        body=json.dumps(dict(beforeId='before',afterId='after',bbox=[0,0,1,1])).encode()
        response=self.client.post('/api/change-jobs',content=body,headers=self.signed('POST','/api/change-jobs',body))
        self.assertEqual((response.status_code,response.json()['status']),(202,'queued'))
        path='/api/change-jobs/'+response.json()['id']+'/cancel'
        response=self.client.post(path,content=b'',headers=self.signed('POST',path))
        self.assertEqual(response.json()['status'],'cancelled')
        path='/api/change-jobs?x=%2F'
        self.assertEqual(self.client.get(path,headers=self.signed('GET',path)).status_code,200)
        self.assertEqual(self.client.get(path,headers=self.signed('GET','/api/change-jobs')).status_code,401)
    def test_oversized_chunked_duplicate_and_protected_stream(self):
        self.assertEqual(self.client.post('/api/change-jobs',content=b'x'*16385).status_code,413)
        self.assertEqual(self.client.post('/api/change-jobs',content=b'',headers={'Transfer-Encoding':'chunked'}).status_code,400)
        headers=list(self.signed('GET','/api/change-jobs').items())+[('X-Earthsignal-User','other')]
        self.assertEqual(self.client.get('/api/change-jobs',headers=headers).status_code,400)
        job=self.store.submit('owner',dict(beforeId='before',afterId='after',bbox=[0,0,1,1]),'one','v1')
        self.store.claim();self.store.complete(job['id'],{})
        output=self.config.root/'results'/job['id'];output.mkdir();(output/'before.png').write_bytes(b'unit-test-png-bytes')
        path=f"/api/change-jobs/{job['id']}/artifacts/before.png"
        self.assertEqual(self.client.get(path).status_code,401)
        response=self.client.get(path,headers=self.signed('GET',path))
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.content,b'unit-test-png-bytes')
        self.assertEqual(response.headers['cache-control'],'private, no-store')
        path=f"/api/change-jobs/{job['id']}/artifacts/%2e%2e%2fjobs.sqlite3"
        self.assertEqual(self.client.get(path,headers=self.signed('GET',path)).status_code,404)

if __name__=='__main__':unittest.main()
