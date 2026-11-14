"""Fake credentials and local fixtures only. Never calls the provider."""
from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import multiprocessing
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

from service.config import Config
from service.assessment_validation import validate_assessment_manifest
from service.observatory import meteomatics as m
from service.observatory.engine import run_assessment
from service.observatory.geometry import contains
from service.observatory.net import Budget, ProviderError, Transfer
from service.observatory.sources import source_registry
from service.tests.test_observatory_providers import request

NOW = datetime(2026,11,14,12,tzinfo=timezone.utc)
POINT = (36.025,-114.75)
DAYS = ['2024-02-28','2024-02-29','2024-03-01']


def config(root, **kwargs):
    return replace(Config(Path(root),b'FAKE_GATEWAY_SECRET',reserve_bytes=0,
        meteomatics_username='FAKE_USER',meteomatics_password='FAKE_PASSWORD',
        meteomatics_valid_until='2030-01-01T00:00:00Z'),**kwargs)


def response(days=DAYS, point=POINT):
    return dict(version='3.0',status='OK',dateGenerated='2026-11-14T12:00:00Z',user='PRIVATE_REMOTE_USER',
        data=[dict(parameter=parameter,coordinates=[dict(lat=point[0],lon=point[1],
            dates=[dict(date=m.endpoint(day),value=10+i) for i,day in enumerate(days)])]) for parameter in m.PARAMETERS])


def transfer(payload):
    data = json.dumps(payload).encode()
    return Transfer(data,m.DOCS,hashlib.sha256(data).hexdigest(),NOW.isoformat())


class Response(io.BytesIO):
    def __init__(self, body, url, status=200, headers=None):
        super().__init__(body)
        self.url, self.status = url,status
        self.headers = headers or {'Content-Type':'application/json'}
    def geturl(self):
        return self.url


def process_try_state(root, queue):
    try:
        with m.PrivateState(config(root)).connection():
            queue.put('acquired')
    except ProviderError as exc:
        queue.put(exc.code)


class AdapterTests(unittest.TestCase):
    def test_config_environment_repr_and_safe_missingness(self):
        env = dict(EARTHSIGNAL_GATEWAY_SECRET='FAKE_GATEWAY_SECRET'*3,EARTHSIGNAL_METEOMATICS_USERNAME='FAKE_USER',
            EARTHSIGNAL_METEOMATICS_PASSWORD='FAKE_PASSWORD',EARTHSIGNAL_METEOMATICS_VALID_UNTIL='2030-01-01T00:00:00Z')
        with patch.dict(os.environ,env,clear=True):
            c=Config.environment()
        for value in env.values():
            self.assertNotIn(value,repr(c))
        m.credentials_ready(c,NOW)
        for changes,code in [
            (dict(meteomatics_username='',meteomatics_password='',meteomatics_valid_until=''),'meteomatics_disabled'),
            (dict(meteomatics_password=''),'meteomatics_config_missing'),
            (dict(meteomatics_valid_until='FAKE_SECRET_INVALID'),'meteomatics_config_invalid'),
            (dict(meteomatics_valid_until='2026-11-14T12:00:00Z'),'meteomatics_expired'),
            (dict(meteomatics_valid_until='2026-99-14T12:00:00Z'),'meteomatics_config_invalid'),
            (dict(meteomatics_valid_until='2030-01-01T00:00:00+01:00'),'meteomatics_config_invalid'),
            (dict(meteomatics_username='FAKE:USER'),'meteomatics_config_invalid')]:
            with self.subTest(changes=tuple(changes)),self.assertRaisesRegex(ProviderError,'^'+code+'$'):
                m.credentials_ready(replace(c,**changes),NOW)

    def test_date_alignment_leap_month_and_completed_day_clipping(self):
        self.assertEqual([m.endpoint(d) for d in DAYS],['2024-02-29T00:00:00Z','2024-03-01T00:00:00Z','2024-03-02T00:00:00Z'])
        days,missing=m.requested_days(dict(start='2026-10-01',end='2026-11-15'),NOW)
        self.assertEqual((len(days),days[0],days[-1]),(31,'2026-10-14','2026-11-13'))
        self.assertTrue(any('truncated' in text for text in missing));self.assertTrue(any('current/future' in text for text in missing))
        days,missing=m.requested_days(dict(start='2026-11-14',end='2026-11-15'),NOW)
        self.assertEqual(days,[]);self.assertTrue(missing)
        for start,end in [('2026-02-30','2026-03-01'),('2026-01-02','2026-01-01'),('20261113','2026-11-13')]:
            with self.assertRaises(ProviderError):m.requested_days(dict(start=start,end=end),NOW)

    def test_sample_point_concave_hole_antimeridian(self):
        areas=[
            dict(type='Polygon',coordinates=[[[0,0],[4,0],[4,1],[1,1],[1,4],[0,4],[0,0]]]),
            dict(type='Polygon',coordinates=[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[1,3],[3,3],[3,1],[1,1]]]),
            dict(type='Polygon',coordinates=[[[179,0],[-179,0],[-179,2],[179,2],[179,0]]])]
        for area in areas:
            point=m.sample_point(area)
            self.assertTrue(contains(area,point[1],point[0]));self.assertEqual(point,m.sample_point(area))
        self.assertEqual(abs(m.sample_point(areas[-1])[1]),180)
        with patch.object(m,'contains',return_value=False),self.assertRaisesRegex(ProviderError,'point_unsupported'):
            m.sample_point(areas[0])

    def test_exact_response_and_missing_gaps(self):
        payload=response();payload['data'][0]['coordinates'][0]['dates'].pop(1)
        values=m.parse_response(transfer(payload),DAYS,POINT)
        self.assertEqual(values[m.PARAMETERS[0]],[10,None,12])
        self.assertEqual(values[m.PARAMETERS[1]],[10,11,12])

    def test_reserved_null_bool_malformed_nonfinite_never_zero(self):
        days=[(datetime(2024,1,1)+timedelta(days=i)).date().isoformat() for i in range(12)]
        bad=[-999,-888,-777,-666,None,True,'FAKE_PASSWORD',float('nan'),float('inf'),{},[],False]
        payload=response(days)
        for item in payload['data']:
            for row,value in zip(item['coordinates'][0]['dates'],bad):row['value']=value
        values=m.parse_response(transfer(payload),days,POINT)
        self.assertTrue(all(v is None for rows in values.values() for v in rows))
        payload=response();payload['data'][0]['coordinates'][0]['dates'][0]['value']=0
        self.assertEqual(m.parse_response(transfer(payload),DAYS,POINT)[m.PARAMETERS[0]][0],0)

    def test_reject_unexpected_duplicate_parameter_coordinate_date_unit_model_shape(self):
        mutations=[
            lambda x:x['data'].append(deepcopy(x['data'][0])),
            lambda x:x['data'][1].update(parameter=m.PARAMETERS[0]),
            lambda x:x['data'][0].update(parameter='precip_24h:inch'),
            lambda x:x.update(model='FOREIGN_PRIVATE_REMOTE_MODEL'),
            lambda x:x['data'][0].update(source='other'),
            lambda x:x['data'][0]['coordinates'].append(deepcopy(x['data'][0]['coordinates'][0])),
            lambda x:x['data'][0]['coordinates'][0].update(lon=0),
            lambda x:x['data'][0]['coordinates'][0].update(lat=True),
            lambda x:x['data'][0]['coordinates'][0]['dates'].append(deepcopy(x['data'][0]['coordinates'][0]['dates'][0])),
            lambda x:x['data'][0]['coordinates'][0]['dates'][0].update(date='2024-02-28T00:00:00Z'),
            lambda x:x['data'][0]['coordinates'][0]['dates'][0].update(date='2024-02-29T01:00:00Z'),
            lambda x:x['data'][0]['coordinates'][0]['dates'][0].update(date='2024-02-29T00:00:00+00:00'),
            lambda x:x.update(status='FAKE_PASSWORD'),
            lambda x:x['data'][0]['coordinates'][0].update(extra='SECRET')]
        for mutate in mutations:
            payload=response();mutate(payload)
            with self.subTest(mutation=mutations.index(mutate)),self.assertRaisesRegex(ProviderError,'^meteomatics_invalid_response$'):
                m.parse_response(transfer(payload),DAYS,POINT)
        raw=b'{"version":"3.0","version":"3.0"}'
        with self.assertRaises(ProviderError):m.parse_response(Transfer(raw,m.DOCS,'0'*64,NOW.isoformat()),DAYS,POINT)

    def test_fixed_https_auth_no_proxy_and_safe_transfer(self):
        captured=[]
        def open_request(req,timeout):
            captured.append((req,timeout))
            return Response(json.dumps(response()).encode(),req.full_url)
        opener=Mock();opener.open.side_effect=open_request
        with tempfile.TemporaryDirectory() as tmp,patch.object(m,'build_opener',return_value=opener) as build,patch.object(m,'utc_now',return_value=NOW):
            budget=Budget(config(tmp),wall_seconds=2)
            result=m.fetch(config(tmp),budget,DAYS,POINT)
        req,timeout=captured[0]
        self.assertEqual(req.full_url,'https://api.meteomatics.com/2024-02-29T00:00:00Z--2024-03-02T00:00:00Z:P1D/precip_24h:mm,t_mean_2m_24h:C/36.025000,-114.750000/json?source=ecmwf-era5')
        self.assertEqual(req.get_header('Authorization'),'Basic RkFLRV9VU0VSOkZBS0VfUEFTU1dPUkQ=')
        self.assertEqual(build.call_args.args[0].proxies,{})
        self.assertIsInstance(build.call_args.args[1],m.NoRedirect)
        self.assertTrue(0 < timeout <= 2);self.assertEqual(result.url,m.DOCS)
        self.assertEqual(budget.requests,1);self.assertEqual(budget.used,len(result.data));self.assertEqual(budget.transfer.reserved,0)
        self.assertNotIn('FAKE_',repr(result))

    def test_redirect_handler_closes_without_reading_or_forwarding(self):
        fp=Mock()
        with self.assertRaisesRegex(ProviderError,'redirect_refused'):
            m.NoRedirect().http_error_302(Mock(),fp,302,'PRIVATE',{'Location':'https://foreign.example/FAKE_PASSWORD'})
        fp.close.assert_called_once();fp.read.assert_not_called()

    def test_transport_failures_sanitized_bounded_and_accounted(self):
        cases=[
            ('oversize',lambda req:Response(b'x'*(m.MAX_RESPONSE+1),req.full_url)),
            ('oversize',lambda req:Response(b'',req.full_url,headers={'Content-Type':'application/json','Content-Length':str(m.MAX_RESPONSE+1)})),
            ('unexpected_encoding',lambda req:Response(b'PRIVATE',req.full_url,headers={'Content-Type':'application/json','Content-Encoding':'gzip'})),
            ('content_type',lambda req:Response(b'PRIVATE',req.full_url,headers={'Content-Type':'text/html'})),
            ('redirect_refused',lambda req:Response(b'PRIVATE','https://foreign.example/PRIVATE')),
            ('http_401',lambda req:Response(b'PRIVATE',req.full_url,status=401)),
            ('http_403',lambda req:Response(b'PRIVATE',req.full_url,status=403)),
            ('http_429',lambda req:Response(b'PRIVATE',req.full_url,status=429)),
        ]
        with tempfile.TemporaryDirectory() as tmp,patch.object(m,'utc_now',return_value=NOW):
            for code,make in cases:
                opener=Mock();opener.open.side_effect=lambda req,timeout:make(req)
                budget=Budget(config(tmp))
                with self.subTest(code=code),patch.object(m,'build_opener',return_value=opener),self.assertRaisesRegex(ProviderError,'^meteomatics_'+code+'$'):
                    m.fetch(config(tmp),budget,DAYS,POINT)
                self.assertEqual(budget.transfer.reserved,0);self.assertLessEqual(budget.used,m.MAX_RESPONSE+1)
                if code=='oversize' and budget.used:self.assertEqual(budget.used,m.MAX_RESPONSE+1)
            for status in [401,403,429,500]:
                body=Mock();opener=Mock();opener.open.side_effect=HTTPError('https://api.meteomatics.com/PRIVATE',status,'PRIVATE',{},body)
                with patch.object(m,'build_opener',return_value=opener),self.assertRaisesRegex(ProviderError,'^meteomatics_http_'):
                    m.fetch(config(tmp),Budget(config(tmp)),DAYS,POINT)
                body.read.assert_not_called();body.close.assert_called_once()
            opener=Mock();opener.open.side_effect=RuntimeError('FAKE_PASSWORD PRIVATE_REMOTE_USER')
            with patch.object(m,'build_opener',return_value=opener),self.assertRaisesRegex(ProviderError,'^meteomatics_network_failure$'):
                m.fetch(config(tmp),Budget(config(tmp)),DAYS,POINT)

    def test_transport_budget_request_and_wall_gates(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(m,'utc_now',return_value=NOW),patch.object(m,'build_opener') as opener:
            budget=Budget(config(tmp));budget.requests=24
            with self.assertRaisesRegex(ProviderError,'request_budget_exceeded'):m.fetch(config(tmp),budget,DAYS,POINT)
            budget=Budget(config(tmp),transfer_bytes=1)
            with self.assertRaisesRegex(ProviderError,'transfer_budget_exceeded'):m.fetch(config(tmp),budget,DAYS,POINT)
            budget=Budget(config(tmp),wall_seconds=1);budget.started-=2
            with self.assertRaisesRegex(ProviderError,'time_budget_exceeded'):m.fetch(config(tmp),budget,DAYS,POINT)
            opener.assert_not_called()

    def test_partial_read_failure_settles_actual_bytes_and_never_exports_error(self):
        class BrokenResponse(Response):
            def read(self, size):
                if self.tell():
                    raise OSError('FAKE_PASSWORD PRIVATE_REMOTE_USER')
                return super().read(min(size,3))
        opener=Mock();opener.open.side_effect=lambda req,timeout:BrokenResponse(b'PRIVATE',req.full_url)
        with tempfile.TemporaryDirectory() as tmp,patch.object(m,'utc_now',return_value=NOW),patch.object(m,'build_opener',return_value=opener):
            budget=Budget(config(tmp))
            with self.assertRaisesRegex(ProviderError,'^meteomatics_network_failure$'):
                m.fetch(config(tmp),budget,DAYS,POINT)
            self.assertEqual(budget.used,3);self.assertEqual(budget.transfer.reserved,0)
            opener.open.assert_called_once()

    def test_quota_persisted_minute_daily_attempt_failures_and_no_retry(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(m,'utc_now',return_value=NOW),patch.object(m,'fetch',side_effect=ProviderError('meteomatics_http_429')) as fetch:
            c=config(tmp)
            for _ in range(30):
                with self.assertRaisesRegex(ProviderError,'http_429'):m.load(c,Budget(c),DAYS,POINT)
            with self.assertRaisesRegex(ProviderError,'minute_quota'):m.load(c,Budget(c),DAYS,POINT)
            self.assertEqual(fetch.call_count,30)
            with m.PrivateState(c).connection() as db:
                self.assertEqual(db.execute('SELECT calls,lease FROM quota').fetchone(),(30,0))
                db.execute('UPDATE quota SET calls=500')
                db.execute('DELETE FROM attempts')
            with self.assertRaisesRegex(ProviderError,'daily_quota'):m.load(c,Budget(c),DAYS,POINT)
            self.assertEqual(fetch.call_count,30)

    def test_active_lock_across_processes_and_persisted_lease(self):
        with tempfile.TemporaryDirectory() as tmp:
            state=m.PrivateState(config(tmp))
            with state.connection() as db:
                ctx=multiprocessing.get_context('spawn');queue=ctx.Queue()
                child=ctx.Process(target=process_try_state,args=(tmp,queue));child.start()
                try:self.assertEqual(queue.get(timeout=10),'meteomatics_active_call')
                finally:child.join(timeout=10)
                self.assertEqual(child.exitcode,0)
                state.acquire(db,NOW.timestamp(),120)
            with m.PrivateState(config(tmp)).connection() as db:
                with self.assertRaisesRegex(ProviderError,'active_call'):state.acquire(db,NOW.timestamp()+1,120)
                state.acquire(db,NOW.timestamp()+181,120)
                self.assertEqual(db.execute('SELECT calls FROM quota').fetchone()[0],2)

    def test_rolling_minute_and_utc_day_reset(self):
        with tempfile.TemporaryDirectory() as tmp:
            state=m.PrivateState(config(tmp));now=NOW.timestamp()
            with state.connection() as db:
                state.acquire(db,now,1);db.execute('UPDATE quota SET lease=0,calls=500')
                with self.assertRaisesRegex(ProviderError,'daily_quota'):state.acquire(db,now+61,1)
                state.acquire(db,now+86400,1)
                self.assertEqual(db.execute('SELECT calls FROM quota').fetchone()[0],1)
                self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0],1)
                db.execute('UPDATE quota SET lease=0')
                with self.assertRaisesRegex(ProviderError,'clock_gate'):state.acquire(db,now,1)

    def test_cache_normalized_bounded_ttl_hash_retrieval_no_credentials_or_user(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(m,'utc_now',return_value=NOW),patch.object(m,'fetch',return_value=transfer(response())) as fetch:
            c=config(tmp)
            a=m.load(c,Budget(c),DAYS,POINT);b=m.load(c,Budget(c),DAYS,POINT)
            self.assertFalse(a[2]);self.assertTrue(b[2]);self.assertEqual(a[:2][0],b[:2][0])
            self.assertEqual(a[1].sha256,b[1].sha256);self.assertEqual(a[1].retrieved_at,b[1].retrieved_at)
            fetch.assert_called_once()
            with m.PrivateState(c).connection() as db:
                payload=db.execute('SELECT payload FROM cache').fetchone()[0]
                self.assertNotIn('FAKE_',payload);self.assertNotIn('PRIVATE_REMOTE_USER',payload)
                db.execute('UPDATE cache SET at=?',(NOW.timestamp()-m.CACHE_TTL,))
                for i in range(40):db.execute('INSERT INTO cache VALUES(?,?,?)',(str(i),NOW.timestamp(),payload))
            m.load(c,Budget(c),DAYS,POINT)
            self.assertEqual(fetch.call_count,2)
            with m.PrivateState(c).connection() as db:
                self.assertLessEqual(db.execute('SELECT count(*) FROM cache').fetchone()[0],m.CACHE_ROWS)
                self.assertEqual(db.execute('PRAGMA max_page_count').fetchone()[0],128)
            self.assertLess(sum(x.stat().st_size for x in (Path(tmp)/'meteomatics-private').iterdir()),m.STATE_BYTES)
            for f in (Path(tmp)/'meteomatics-private').iterdir():self.assertEqual(f.stat().st_mode & 0o077,0)

    def test_storage_reserve_capacity_and_symlink_withhold(self):
        with tempfile.TemporaryDirectory() as tmp:
            for c in [config(tmp,storage_bytes=m.STATE_BYTES),config(tmp,reserve_bytes=10**18)]:
                with self.assertRaisesRegex(ProviderError,'storage_unavailable'):
                    with m.PrivateState(c).connection():pass
            (Path(tmp)/'meteomatics-private').symlink_to(Path(tmp))
            with self.assertRaisesRegex(ProviderError,'storage_unavailable'):
                with m.PrivateState(config(tmp)).connection():pass

    def test_shared_area_job_reservation_is_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            db=sqlite3.connect(Path(tmp)/'jobs.sqlite3')
            db.execute('CREATE TABLE jobs(id TEXT, request TEXT, kind TEXT, state TEXT)')
            db.execute('INSERT INTO jobs VALUES(?,?,?,?)',('a'*32,'{}','area-experiment','running'));db.commit();db.close()
            c=config(tmp,storage_bytes=50*1024**2)
            with self.assertRaisesRegex(ProviderError,'storage_unavailable'):
                with m.PrivateState(c).connection():pass

    def test_sqlite_page_limit_is_enforced(self):
        with tempfile.TemporaryDirectory() as tmp:
            with m.PrivateState(config(tmp)).connection() as db:
                with self.assertRaises(sqlite3.DatabaseError):
                    db.execute('INSERT INTO cache VALUES(?,?,zeroblob(?))',('oversize',0,m.STATE_BYTES))
                self.assertLessEqual(db.execute('PRAGMA page_count').fetchone()[0],128)

    def test_all_missing_cache_is_finite_and_expired_configuration_cannot_read_it(self):
        payload=response()
        for item in payload['data']:item['coordinates'][0]['dates']=[]
        with tempfile.TemporaryDirectory() as tmp,patch.object(m,'utc_now',return_value=NOW),patch.object(m,'fetch',return_value=transfer(payload)) as fetch:
            c=config(tmp)
            m.load(c,Budget(c),DAYS,POINT)
            self.assertTrue(m.load(c,Budget(c),DAYS,POINT)[2])
            with self.assertRaisesRegex(ProviderError,'expired'):
                m.load(replace(c,meteomatics_valid_until=NOW.isoformat()),Budget(c),DAYS,POINT)
            with patch.object(m,'utc_now',return_value=NOW+timedelta(seconds=m.CACHE_TTL)):
                self.assertFalse(m.load(c,Budget(c),DAYS,POINT)[2])
            self.assertEqual(fetch.call_count,2)

    def test_off_explicit_selection_all_domains_engine_manifest_and_privacy(self):
        for domain in ('water','fire','ecology','urban'):
            with self.subTest(domain=domain),tempfile.TemporaryDirectory() as tmp,patch.object(m,'utc_now',return_value=NOW):
                r=request(domain,DAYS[0],DAYS[-1]);r['options']={'sourceIds':[m.SOURCE]}
                with patch.object(m,'fetch',return_value=transfer(response())) as fetch,patch('service.observatory.net.Budget.fetch',side_effect=AssertionError('public fetch should not run')):
                    result=run_assessment(r,config(tmp),Path(tmp)/'output')
                fetch.assert_called_once();validate_assessment_manifest(result,r)
                self.assertEqual([s['id'] for s in result['series']],['meteomatics-precipitation','meteomatics-temperature'])
                self.assertTrue(all(not e['public'] for e in result['evidence']))
                self.assertTrue(all(c['type']=='Derived' for c in result['claims']))
                self.assertEqual(result['series'][0]['points'][0]['date'],DAYS[0]);self.assertEqual(result['outcome'],'partial')
                measurement=next(q for q in result['quality'] if q['dimension']=='measurement')
                self.assertEqual(measurement['status'],'withheld')
                self.assertIn('no direct local observation',measurement['message'])
                for file in (Path(tmp)/'output').iterdir():
                    text=file.read_text()
                    for secret in ('FAKE_USER','FAKE_PASSWORD','PRIVATE_REMOTE_USER','Authorization','Basic '):self.assertNotIn(secret,text)
        self.assertEqual(next(s['domains'] for s in source_registry() if s['id']==m.SOURCE),['water','fire','ecology','urban'])
        with tempfile.TemporaryDirectory() as tmp:
            r=request();r['options']={'sourceIds':[]}
            self.assertEqual(m.historical_context(r,config(tmp),Budget(config(tmp)))['evidence'],[])
        with tempfile.TemporaryDirectory() as tmp,patch.object(m,'historical_context') as adapter,patch('service.observatory.net.Budget.fetch',side_effect=ProviderError('access_gate')):
            r=request();r['options']={};run_assessment(r,config(tmp),Path(tmp)/'default')
            r['options']={'sourceIds':[]};run_assessment(r,config(tmp),Path(tmp)/'empty')
            adapter.assert_not_called()

    def test_disabled_partial_expired_preserve_other_provider(self):
        from service.observatory import providers as p
        for changes in [dict(meteomatics_password=''),dict(meteomatics_valid_until='2000-01-01T00:00:00Z')]:
            with tempfile.TemporaryDirectory() as tmp,patch.object(m,'utc_now',return_value=NOW),patch.object(m,'fetch') as fetch,patch.object(p,'nws_context',return_value=p.bundle()) as nws:
                r=request();r['options']={'sourceIds':[m.SOURCE,'nws-weather-context']}
                result=run_assessment(r,config(tmp,**changes),Path(tmp)/'out')
                nws.assert_called_once();fetch.assert_not_called();self.assertIn('meteomatics_',result['quality'][1]['message'])
                self.assertNotIn('FAKE_',json.dumps(result))

    def test_all_missing_and_future_do_not_fabricate_observations(self):
        payload=response()
        for item in payload['data']:item['coordinates'][0]['dates']=[]
        with tempfile.TemporaryDirectory() as tmp,patch.object(m,'utc_now',return_value=NOW),patch.object(m,'fetch',return_value=transfer(payload)) as fetch:
            r=request(start=DAYS[0],end=DAYS[-1]);r['options']={'sourceIds':[m.SOURCE]}
            result=run_assessment(r,config(tmp),Path(tmp)/'missing');validate_assessment_manifest(result,r)
            self.assertEqual(result['outcome'],'unavailable');self.assertTrue(all(metric['value'] is None for metric in result['metrics']))
            self.assertTrue(all(pt['value'] is None for s in result['series'] for pt in s['points']))
            r['start']='2026-11-14';r['end']='2026-11-15'
            result=run_assessment(r,config(tmp),Path(tmp)/'future')
            self.assertEqual(result['evidence'],[]);self.assertIn('current/future',result['quality'][1]['message']);self.assertEqual(fetch.call_count,1)

    def test_expired_cache_never_used(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(m,'utc_now',return_value=NOW),patch.object(m,'load') as load:
            r=request();r['options']={'sourceIds':[m.SOURCE]}
            with self.assertRaisesRegex(ProviderError,'expired'):
                m.historical_context(r,config(tmp,meteomatics_valid_until=NOW.isoformat()),Budget(config(tmp)))
            load.assert_not_called()

if __name__=='__main__':unittest.main()
