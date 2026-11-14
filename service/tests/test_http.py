import hashlib
import hmac
import http.client
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from http.server import ThreadingHTTPServer
from service.api import API, handler
from service.auth import canonical
from service.config import Config
from service.store import Store

class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.config=Config(Path(self.temp.name),b's'*32,reserve_bytes=0)
        self.store=Store(self.config)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),handler(API(self.store,lambda:dict(ready=True,message='ready',maxPixels=1000000))))
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()
    def call(self,method,path,body=None,headers=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=5)
        connection.request(method,path,body=body,headers=headers or {})
        response=connection.getresponse();result=(response.status,json.loads(response.read()))
        connection.close();return result
    def signed(self,method,path,body):
        timestamp=str(int(time.time()));nonce='abcdefgh12345678'
        signature=hmac.new(self.config.secret,canonical(method,path,'owner',timestamp,nonce,body),hashlib.sha256).hexdigest()
        return {'X-Earthsignal-User':'owner','X-Earthsignal-Timestamp':timestamp,'X-Earthsignal-Nonce':nonce,
                'X-Earthsignal-Signature':signature,'Idempotency-Key':'http-one','Content-Type':'application/json'}
    def test_health_anonymous_failclosed_and_real_post_202(self):
        self.assertEqual(self.call('GET','/health')[0],200)
        self.assertEqual(self.call('GET','/api/change-jobs')[0],401)
        body=json.dumps(dict(beforeId='before',afterId='after',bbox=[0,0,1,1])).encode()
        status,payload=self.call('POST','/api/change-jobs',body,self.signed('POST','/api/change-jobs',body))
        self.assertEqual((status,payload['status']),(202,'queued'))
        self.assertEqual(len(self.store.list('owner')),1)
    def test_body_cap_and_chunked_rejection(self):
        self.assertEqual(self.call('POST','/api/change-jobs',b'x'*16385)[0],413)
        self.assertEqual(self.call('POST','/api/change-jobs',None,{'Transfer-Encoding':'chunked'})[0],400)

if __name__=='__main__':unittest.main()
