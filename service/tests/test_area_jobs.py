"""Private queue boundary tests; native arithmetic remains independently tested."""
from dataclasses import replace
import csv
import hashlib
import hmac
import http.client
import io
import json
import math
from pathlib import Path
import resource
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from fastapi.testclient import TestClient
from service import area_jobs as area
from service.api import API, create_app, handler
from service.auth import authenticate, body_limit, canonical
from service.config import Config
from service.store import Store, Problem
from service.worker import Worker
from service.tests.test_stratified_area import fixture
from service.tests.test_area_experiment_cli import context

PATH = '/api/area-experiments'
RADAR = {'beforeId':'before','afterId':'after','bbox':[0,0,1,1]}


def envelope(**kwargs):
    design, outcomes = fixture(**kwargs)
    return {'schemaVersion':1,'kind':'stratified-area-experiment',
            'evidenceKind':'synthetic-software-check','design':design,
            'outcomes':outcomes,'context':context()}


def raw_input(value=None):
    return json.dumps(value or envelope(),ensure_ascii=False).encode('utf-8')


class AreaJobsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.now = time.time()
        self.config = Config(Path(self.temp.name), b's'*32, reserve_bytes=0, area_experiments_enabled=True)
        self.store = Store(self.config,lambda:self.now)
        self.api = API(self.store)
        self.serial = 0

    def tearDown(self):
        self.temp.cleanup()

    def signed(self, method, path, raw=b'', owner='owner', key='one'):
        self.serial += 1
        ts, nonce = str(int(self.now)), f'nonce_{self.serial:020d}'
        signature = hmac.new(self.config.secret, canonical(method,path,owner,ts,nonce,raw),hashlib.sha256).hexdigest()
        return {'X-Earthsignal-User':owner,'X-Earthsignal-Timestamp':ts,'X-Earthsignal-Nonce':nonce,
                'X-Earthsignal-Signature':signature,'Idempotency-Key':key,'Content-Length':str(len(raw))}

    def call(self, method, path=PATH, raw=b'', owner='owner', key='one'):
        return self.api.dispatch(method,path,self.signed(method,path,raw,owner,key),raw)

    def submit(self, raw=None, key='one', owner='owner'):
        return self.store.submit(owner,area.admit(raw or raw_input()),key,area.METHOD,kind=area.KIND)

    def row(self, job):
        with self.store.connect() as db:
            return dict(db.execute('SELECT * FROM jobs WHERE id=?',(job['id'],)).fetchone())

    def compact(self, job):
        row = self.row(job)
        self.assertEqual(set(json.loads(row['request'])), {'inputFileSha256','inputBytes'})
        self.assertNotIn('synthetic-only',row['request'])
        return row

    def staged(self, value=None):
        job = self.submit(raw_input(value))
        row = self.store.claim()
        stage = self.config.root/'staging'/row['id']
        stage.mkdir(mode=0o700)
        area.run(json.loads(row['request']),stage)
        return job,row,stage

    def problem(self, code, fn):
        with self.assertRaises(Problem) as caught:
            fn()
        self.assertEqual(caught.exception.code,code)

    def test_authenticated_wire_exact_hash_no_private_input(self):
        raw = raw_input() + b' \n'
        self.problem('unauthorized', lambda:self.api.dispatch('POST',PATH,{},raw))
        status,job,_ = self.call('POST',raw=raw)
        self.assertEqual(status,202)
        self.assertEqual(job['request'],{'inputFileSha256':hashlib.sha256(raw).hexdigest(),'inputBytes':len(raw)})
        self.assertIsNone(job['expiresAt'])
        self.assertNotIn('synthetic-only',json.dumps(job))
        self.assertEqual(self.call('GET')[1]['jobs'],[job])
        self.assertTrue(self.call('GET')[1]['enabled'])
        self.assertEqual(self.call('GET',PATH+'/'+job['id'])[1],job)
        self.problem('not_found',lambda:self.call('GET',PATH+'/'+job['id'],owner='other'))
        self.problem('not_found',lambda:self.call('POST',PATH+'/'+job['id']+'/cancel',owner='other'))
        self.problem('unauthorized',lambda:authenticate(self.store,'POST',PATH,self.signed('POST',PATH,raw),raw+b' '))

    def test_feature_flag_only_blocks_submissions(self):
        job,row,stage = self.staged()
        Worker(self.store).publish(row,stage)
        self.store.config = replace(self.config,area_experiments_enabled=False)
        self.assertFalse(self.call('GET')[1]['enabled'])
        self.problem('feature_disabled',lambda:self.call('POST',raw=raw_input(),key='new'))
        self.assertEqual(self.call('POST',raw=raw_input())[1]['id'],job['id'])
        self.assertEqual(self.call('GET',PATH+'/'+job['id'])[1]['status'],'completed')
        self.assertEqual(self.call('GET',PATH+'/'+job['id']+'/artifacts/input.json')[2].data,raw_input())
        self.assertEqual(self.call('POST',PATH+'/'+job['id']+'/cancel')[1]['status'],'completed')

    def test_config_default_and_strict_boolean(self):
        self.assertFalse(Config(self.config.root,b's'*32).area_experiments_enabled)
        for value,expected in [('true',True),('false',False)]:
            with patch.dict('os.environ',{'EARTHSIGNAL_GATEWAY_SECRET':'s'*32,'EARTHSIGNAL_AREA_EXPERIMENTS_ENABLED':value}):
                self.assertEqual(Config.environment().area_experiments_enabled,expected)
        with patch.dict('os.environ',{'EARTHSIGNAL_GATEWAY_SECRET':'s'*32,'EARTHSIGNAL_AREA_EXPERIMENTS_ENABLED':'yes'}):
            with self.assertRaises(RuntimeError):Config.environment()

    def test_strict_json_structure_and_raw_byte_limit(self):
        for raw in (b'{"a":1,"a":2}', b'\xff', b'{"x":NaN}', b'{"x":1e999}',
                    b'{"x":'+b'['*33+b'0'+b']'*33+b'}', b'[0,'*10001+b'0'+b']'*10001,
                    b'{}', b'[]', b'x'*(area.MAX_BYTES+1)):
            with self.subTest(raw=raw[:30]):
                self.problem('invalid_request' if len(raw)<=area.MAX_BYTES else 'body_too_large',
                             lambda:self.call('POST',raw=raw))
        raw=raw_input(); padded=raw + b' '*(area.MAX_BYTES-len(raw))
        self.assertEqual(self.call('POST',raw=padded)[1]['request']['inputBytes'],area.MAX_BYTES)

    def test_caps_at_auth_fastapi_and_http_exact_collection_only(self):
        client=TestClient(create_app(self.api))
        server=ThreadingHTTPServer(('127.0.0.1',0),handler(self.api))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            targets=[('POST',PATH+'?q=1'),('POST',PATH+'/'),('POST',PATH+'/id/cancel'),
                     ('GET',PATH),('POST','/api/change-jobs'),('POST','/api/assessments'),('POST','/api/scenarios')]
            for method,path in targets:
                raw=b' '*16385
                with self.subTest(method=method,path=path):
                    self.assertEqual(body_limit(method,path),16384)
                    self.problem('body_too_large',lambda:authenticate(self.store,method,path,{},raw))
                    self.assertEqual(client.request(method,path,content=raw).status_code,413)
                    conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5)
                    conn.request(method,path,body=raw);response=conn.getresponse()
                    self.assertEqual(response.status,413);response.read();conn.close()
            for transport in ('asgi','http'):
                raw=raw_input()+b' '*17000
                headers=self.signed('POST',PATH,raw,key=transport)
                if transport=='asgi':
                    response=client.post(PATH,content=raw,headers=headers)
                    self.assertEqual(response.status_code,202)
                else:
                    conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5)
                    conn.request('POST',PATH,body=raw,headers=headers);response=conn.getresponse()
                    self.assertEqual(response.status,202);response.read();conn.close()
            for method in ('GET','POST'):
                self.assertEqual(client.request(method,PATH,content=b'x'*(area.MAX_BYTES+1)).status_code,413)
        finally:
            client.close();server.shutdown();server.server_close();thread.join()

    def test_shared_owner_daily_queue_and_crosskind_replay(self):
        first=self.submit()
        radar=self.store.submit('owner',RADAR,'radar','v1')
        self.problem('owner_limit',lambda:self.submit(key='third'))
        self.problem('idempotency_conflict',lambda:self.store.submit('owner',RADAR,'one','v1'))
        self.store.cancel('owner',first['id'],area.KIND);self.store.cancel('owner',radar['id'])
        for i in range(3):
            job=self.submit(key=str(i));self.store.cancel('owner',job['id'],area.KIND)
        self.problem('daily_limit',lambda:self.submit(key='six'))
        other=Store(replace(self.config,queue_limit=1),lambda:self.now)
        other.submit('a',RADAR,'a','v1')
        self.problem('queue_full',lambda:other.submit('b',area.admit(raw_input()),'b',area.METHOD,kind=area.KIND))

    def test_area_reservations_aggregate_db_wal_and_old_limits(self):
        first=self.submit()
        with patch('service.store.shutil.disk_usage') as disk:
            disk.return_value.free=10**12
            self.assertTrue(self.store.disk_ready())
            self.store.config=replace(self.config,storage_bytes=self.config.job_reservation_bytes+100000)
            self.problem('storage_limit',lambda:self.submit(key='two',owner='other'))
            # DB/WAL physical storage participates, including unrelated usage.
            (self.config.root/'space').write_bytes(b'x'*200000)
            self.assertFalse(self.store.disk_ready())
        self.store.config=self.config
        self.assertEqual(self.row(first)['state'],'queued')

    def test_cancel_fail_complete_replay_identity_and_compaction(self):
        raw=raw_input()
        for terminal in ('cancel','fail','complete'):
            job=self.submit(raw,key=terminal)
            if terminal=='cancel':self.store.cancel('owner',job['id'],area.KIND)
            else:
                row=self.store.claim()
                if terminal=='fail':self.store.fail(job['id'],'evil','private literal')
                else:
                    stage=self.config.root/'staging'/job['id'];stage.mkdir(mode=0o700)
                    area.run(json.loads(row['request']),stage);Worker(self.store).publish(row,stage)
            compact=self.compact(job)
            self.assertEqual(self.submit(raw,key=terminal)['id'],job['id'])
            self.assertEqual(self.row(job)['cache'],compact['cache'])
            self.problem('idempotency_conflict',lambda:self.submit(raw+b' ',key=terminal))
            self.assertNotIn('private literal',compact['error'] or '')

    def test_restart_storage_failure_queue_ttl_no_retry(self):
        job=self.submit();row=self.store.claim()
        stage=self.config.root/'staging'/job['id'];stage.mkdir();(stage/'partial').write_text('private')
        self.assertEqual(self.store.recover(restart=True),1)
        self.compact(job);self.assertFalse(stage.exists());self.assertIsNone(self.store.claim())
        job=self.submit(key='two')
        with patch.object(self.store,'disk_ready',return_value=False):self.assertIsNone(self.store.claim())
        self.compact(job)
        job=self.submit(key='three');self.now+=self.config.wall_seconds+area.QUEUE_ALLOWANCE
        self.store.cleanup();self.compact(job)
        self.assertEqual(self.row(job)['state'],'failed')
        self.assertEqual(self.row(job)['phase'],'Expired in queue')
        self.assertIsNone(self.store.claim())

    def test_real_subprocess_success_native_values_permissions_and_expiry(self):
        raw=raw_input()+b' \n';job=self.submit(raw)
        start=time.monotonic();self.assertTrue(Worker(self.store).run_one());elapsed=time.monotonic()-start
        result=self.store.get('owner',job['id'],area.KIND)
        self.assertEqual(result['status'],'completed',result['error'])
        self.compact(job)
        self.assertEqual(set(result['result']),{'schemaVersion','kind','inputFileSha256','methodVersion','artifacts',*area.FLAGS})
        for flag in area.FLAGS:self.assertIs(result['result'][flag],False)
        output=self.config.root/'results'/job['id']
        self.assertEqual({p.name for p in output.iterdir()},area.ARTIFACTS)
        self.assertEqual((output/'input.json').read_bytes(),raw)
        native=json.loads((output/'result.json').read_bytes())
        row=native['calculation']['classes'][0]
        self.assertAlmostEqual(row['proportion'],.13);self.assertEqual(row['areaM2'],52000)
        self.assertAlmostEqual(row['areaSamplingSE_M2'],math.sqrt(4809/1900000)*400000,places=6)
        for path in output.iterdir():self.assertEqual(path.stat().st_mode & 0o777,0o600)
        self.assertEqual(output.stat().st_mode & 0o777,0o700)
        self.assertEqual((self.config.root/'jobs.sqlite3').stat().st_mode & 0o777,0o600)
        with self.store.connect() as db:self.assertEqual(db.execute('PRAGMA secure_delete').fetchone()[0],1)
        print(f'area real subprocess: wall={elapsed:.3f}s children_maxrss={resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss}')
        self.now+=self.config.expiry_seconds+1
        self.problem('not_found',lambda:self.call('GET',PATH+'/'+job['id']+'/artifacts/input.json'))
        self.store.cleanup();self.assertFalse(output.exists())

    def test_publication_rejects_partial_tamper_extra_and_cancel_cas(self):
        job,row,stage=self.staged()
        original=(stage/'result.json').read_bytes()
        for name,raw in [('result.json',b'{}'),('areas.csv',b'id\nsecret'),('manifest.json',b'{}'),('input.json',b'{}')]:
            prior=(stage/name).read_bytes();(stage/name).write_bytes(raw)
            with self.subTest(name=name),self.assertRaises(ValueError):Worker(self.store).publish(row,stage)
            (stage/name).write_bytes(prior)
        (stage/'unexpected').write_bytes(b'x')
        with self.assertRaises(ValueError):Worker(self.store).publish(row,stage)
        (stage/'unexpected').unlink();(stage/'result.json').unlink()
        with self.assertRaises(OSError):Worker(self.store).publish(row,stage)
        (stage/'result.json').write_bytes(original)
        real=self.store.complete
        def race(job_id,manifest):
            self.store.cancel('owner',job_id,area.KIND)
            return real(job_id,manifest)
        with patch.object(self.store,'complete',side_effect=race):self.assertFalse(Worker(self.store).publish(row,stage))
        self.compact(job);self.assertFalse((self.config.root/'results'/job['id']).exists())

    def test_protected_download_hash_size_manifest_links_and_unknown_name(self):
        job,row,stage=self.staged();Worker(self.store).publish(row,stage)
        prefix=PATH+'/'+job['id']+'/artifacts/'
        client=TestClient(create_app(self.api))
        try:
            for name in area.ARTIFACTS:
                path=prefix+name
                self.problem('not_found',lambda:self.call('GET',path,owner='other'))
                self.problem('unauthorized',lambda:self.api.dispatch('GET',path,{},b''))
                response=client.get(path,headers=self.signed('GET',path))
                self.assertEqual(response.status_code,200);self.assertEqual(response.headers['cache-control'],'private, no-store')
            output=self.config.root/'results'/job['id']
            for name in area.ARTIFACTS:
                original=(output/name).read_bytes();(output/name).write_bytes(b'changed')
                self.problem('not_found',lambda:self.call('GET',prefix+name))
                (output/name).write_bytes(original)
            path=output/'input.json';original=path.read_bytes();path.unlink();path.symlink_to(self.config.root/'jobs.sqlite3')
            self.problem('not_found',lambda:self.call('GET',prefix+'input.json'))
            path.unlink();path.write_bytes(original)
            with path.open('wb') as stream:stream.truncate(area.MAX_BYTES+1)
            self.problem('not_found',lambda:self.call('GET',prefix+'input.json'))
            self.problem('not_found',lambda:self.call('GET',prefix+'..%2fjobs.sqlite3'))
        finally:client.close()

    def test_withheld_unknown_singleton_and_csv_formula_guard(self):
        for case, value in [('unknown',envelope()),('singleton',envelope(sizes=(100,),sample_labels=[['water']])),
                            ('formula',envelope(classes=('=1+1','other'),sample_labels=[['=1+1']*8+['other']*12,['=1+1']*3+['other']*27]))]:
            if case=='unknown':value['outcomes']['records'][0]['label']=None
            request=area.admit(raw_input(value))
            output=self.config.root/case;output.mkdir(mode=0o700)
            area.run(request,output)
            result=json.loads((output/'result.json').read_bytes())
            table=list(csv.DictReader(io.StringIO((output/'areas.csv').read_text())))
            if case=='unknown':
                self.assertEqual(result['calculation']['pointEstimateStatus'],'withheld')
                self.assertEqual(table[0]['areaM2'],'');self.assertEqual(table[0]['areaSamplingSE_M2'],'')
            elif case=='singleton':
                self.assertEqual(result['calculation']['samplingVarianceStatus'],'non-estimable')
                self.assertEqual(table[0]['areaSamplingSE_M2'],'');self.assertNotEqual(table[0]['areaM2'],'')
            else:self.assertEqual(table[0]['id'],"'=1+1")

    def test_actual_subprocess_invalid_science_fails_sanitized_and_compacts(self):
        value=envelope();value['outcomes']['designHash']='0'*64
        job=self.submit(raw_input(value));self.assertTrue(Worker(self.store).run_one())
        row=self.compact(job)
        self.assertEqual(row['state'],'failed');self.assertNotIn('synthetic-only',row['error'])
        self.assertFalse((self.config.root/'results'/job['id']).exists())
        self.assertFalse((self.config.root/'staging'/job['id']).exists())

    def test_area_worker_cancellation_and_timeout_terminate_subprocess(self):
        import subprocess
        import sys
        real=subprocess.Popen
        for mode in ('cancel','timeout'):
            job=self.submit(key=mode)
            children=[]
            def launch(*args,**kwargs):
                child=real([sys.executable,'-c','import time; time.sleep(30)'],
                           stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
                children.append(child)
                if mode=='cancel':self.store.cancel('owner',job['id'],area.KIND)
                return child
            worker=Worker(self.store)
            if mode=='timeout':self.store.config=replace(self.config,wall_seconds=0)
            with patch('service.worker.subprocess.Popen',side_effect=launch):
                self.assertTrue(worker.run_one())
            self.assertIsNotNone(children[0].poll())
            row=self.compact(job)
            self.assertEqual(row['state'],'cancelled' if mode=='cancel' else 'failed')
            if mode=='timeout':self.assertEqual(json.loads(row['error'])['code'],'time_limit')
            self.assertFalse((self.config.root/'staging'/job['id']).exists())

    def test_queue_deadline_compacts_while_other_job_running(self):
        radar=self.store.submit('owner',RADAR,'radar','v1');self.store.claim()
        job=self.submit()
        self.now+=self.config.wall_seconds+area.QUEUE_ALLOWANCE
        self.assertTrue(self.store.heartbeat(radar['id']))
        self.compact(job)
        self.assertEqual(json.loads(self.row(job)['error'])['code'],'queue_expired')

    def test_compact_manifest_cannot_accept_private_context_or_promoted_flags(self):
        job,row,stage=self.staged()
        manifest=json.loads((stage/'manifest.json').read_bytes())
        for change in ({'context':{'studyId':'private'}},{'fieldTruthEstablished':True}, {'artifacts':{}}):
            with self.assertRaises(ValueError):self.store.complete(job['id'],{**manifest,**change})
        self.assertEqual(self.row(job)['state'],'running')
        self.assertIn('inputText',json.loads(self.row(job)['request']))

    def test_source_result_csv_and_total_artifact_bounds_before_publication(self):
        job,row,stage=self.staged()
        for name in ('input.json','result.json','areas.csv','manifest.json'):
            original=(stage/name).read_bytes()
            with (stage/name).open('wb') as stream:stream.truncate(area.MAX_BYTES+1)
            with self.assertRaises(ValueError):Worker(self.store).publish(row,stage)
            (stage/name).write_bytes(original)
        with patch.object(area,'TOTAL_BYTES',1):
            with self.assertRaises(ValueError):Worker(self.store).publish(row,stage)


if __name__=='__main__':unittest.main()
