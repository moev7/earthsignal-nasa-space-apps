"""Archive replay is separate from new worker publication and owner boundaries."""
import copy
import hashlib
from pathlib import Path
import tempfile
import unittest
from dataclasses import replace
from datetime import date,datetime,timedelta,timezone
from unittest.mock import patch

from service.assessment_validation import validate_assessment_manifest
from service.config import Config
from service.observatory.engine import run_assessment
from service.observatory.history import gauge_evaluation
from service.observatory.net import METHOD_VERSION
from service.store import Store,Problem
from service.tests.test_observatory_providers import request,QueueBudget,station,daily


class ForecastArchiveTests(unittest.TestCase):
    def legacy(self,root):
        r=request();r['options']['sourceIds']=['usgs-daily']
        fixture=QueueBudget(station(),dict(features=[daily('2025-06-01','100'),daily('2025-06-03','200')],links=[]))
        out=root/'artifacts';out.mkdir()
        cfg=replace(Config(root,b'fixture-secret'),reserve_bytes=0,job_reservation_bytes=0)
        with patch('service.observatory.net.Budget.fetch',side_effect=fixture.fetch):a=run_assessment(r,cfg,out)
        a['methodVersion']='observatory-1.2.0';a['series'][0].pop('seasonalTrend')
        a['forecastEvaluation']=gauge_evaluation(a['series'][0],a['evidence'],now=datetime.fromisoformat(a['processedAt']),method_version='gauge-selection-calibration-holdout-v2')
        return cfg,r,a

    def test_archived_replay_never_downgrades_new_publication(self):
        with tempfile.TemporaryDirectory() as tmp:
            _,r,a=self.legacy(Path(tmp))
            validate_assessment_manifest(a,r,allow_archived=True)
            with self.assertRaises(ValueError):validate_assessment_manifest(a,r)
            for field,value in [('assessment','observatory-1.3.0'),('forecast','unknown-v2')]:
                bad=copy.deepcopy(a)
                if field=='assessment':bad['methodVersion']=value
                else:bad['forecastEvaluation']['methodVersion']=value
                with self.assertRaises(ValueError):validate_assessment_manifest(bad,r,allow_archived=True)
            bad=copy.deepcopy(a);bad['forecastEvaluation']['sourceInputHash']='a'*64
            with self.assertRaises(ValueError):validate_assessment_manifest(bad,r,allow_archived=True)
            current=copy.deepcopy(a);current['methodVersion']=METHOD_VERSION
            current['forecastEvaluation']=gauge_evaluation(current['series'][0],current['evidence'],now=datetime.fromisoformat(current['processedAt']))
            validate_assessment_manifest(current,r)
            for version in ('observatory-1.2.0','unknown-assessment'):
                mixed=copy.deepcopy(current);mixed['methodVersion']=version
                for archived in (False,True):
                    with self.assertRaises(ValueError):validate_assessment_manifest(mixed,r,allow_archived=archived)

    def test_v3_forecast_remains_exactly_replayable_in_v13_assessment(self):
        with tempfile.TemporaryDirectory() as tmp:
            _,r,a=self.legacy(Path(tmp))
            a['methodVersion']='observatory-1.3.0'
            a['forecastEvaluation']=gauge_evaluation(a['series'][0],a['evidence'],now=datetime.fromisoformat(a['processedAt']))
            before=copy.deepcopy(a)
            validate_assessment_manifest(a,r,allow_archived=True)
            self.assertEqual(a,before)
            with self.assertRaises(ValueError):validate_assessment_manifest(a,r)
            bad=copy.deepcopy(a);bad['forecastEvaluation']['sourceInputHash']='a'*64
            with self.assertRaises(ValueError):validate_assessment_manifest(bad,r,allow_archived=True)

    def test_v14_assessment_forecasts_remain_archived_without_new_timing_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            _,r,a=self.legacy(Path(tmp))
            a['methodVersion']='observatory-1.4.0'
            a['forecastEvaluation']=gauge_evaluation(a['series'][0],a['evidence'],now=datetime.fromisoformat(a['processedAt']))
            before=copy.deepcopy(a)
            validate_assessment_manifest(a,r,allow_archived=True)
            self.assertEqual(a,before)
            with self.assertRaises(ValueError):validate_assessment_manifest(a,r)

    def test_verified_legacy_parent_keeps_scenarios_snapshots_and_ownership(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg,r,a=self.legacy(Path(tmp));store=Store(cfg)
            job=store.submit('alice',r,'legacy','observatory-1.2.0',kind='assessment')
            self.assertEqual(store.claim()['id'],job['id']);store.complete(job['id'],a)
            before=store.get('alice',job['id'],kind='assessment')['result']
            snapshot=store.snapshot('alice',job['id']);self.assertEqual(snapshot['manifest'],a)
            scenario=dict(schemaVersion='1.0',assessmentId=job['id'],kind='threshold',inputs=dict(metricId=a['metrics'][0]['id'],threshold=150,operator='above'),assumptions=['Fixture only'],objectives=['Check archived measurement'])
            self.assertEqual(store.submit('alice',scenario,'scenario','v4',kind='scenario')['status'],'queued')
            self.assertEqual(store.get('alice',job['id'],kind='assessment')['result'],before)
            with self.assertRaises(Problem) as error:store.snapshot('bob',job['id'])
            self.assertEqual(error.exception.status,404)
            with self.assertRaises(Problem) as error:store.submit('bob',scenario,'other','v4',kind='scenario')
            self.assertEqual(error.exception.status,404)

    def test_v3_body_is_frozen_and_replays_exactly(self):
        body=(Path(__file__).resolve().parents[1]/'observatory/forecast_v3.py').read_text().partition('# BEGIN FROZEN V3 BODY\n')[2]
        self.assertEqual(hashlib.sha256(body.encode()).hexdigest(),'97cd43dcc3f524bb728ab5f78aebe2db4608516d668cec500eb06ddc7c90f8cc')
        with tempfile.TemporaryDirectory() as tmp:
            _,r,a=self.legacy(Path(tmp))
            issue=datetime.fromisoformat(a['processedAt'])
            self.assertEqual(gauge_evaluation(a['series'][0],a['evidence'],issue),gauge_evaluation(a['series'][0],a['evidence'],issue,method_version='gauge-selection-calibration-holdout-v3'))

    def test_legacy_numerical_body_is_pinned_and_has_no_v3_diagnostics(self):
        body=(Path(__file__).resolve().parents[1]/'observatory/forecast_v2.py').read_text().partition('# BEGIN FROZEN V2 BODY\n')[2]
        self.assertEqual(hashlib.sha256(body.encode()).hexdigest(),'97bfc4b940edeb61085fe0abe70a58fb8510290990439e1940b336fa88363def')
        first=date(2022,1,1);points=[dict(date=(first+timedelta(days=i)).isoformat(),value=100+2.*i,quality='Approved') for i in range(1460)]
        s=dict(id='usgs-discharge',label='Synthetic station',unit='ft^3/s',evidenceIds=['e'],points=points)
        e=[dict(id='e',sourceId='usgs-daily')];now=datetime.fromisoformat(points[-1]['date']).replace(tzinfo=timezone.utc)+timedelta(hours=12)
        old=gauge_evaluation(s,e,now,method_version='gauge-selection-calibration-holdout-v2')
        new=gauge_evaluation(s,e,now)
        self.assertEqual(len(old['validation']),3);self.assertEqual(len(new['validation']),3)
        self.assertTrue(all('intervalDiagnostics' not in v for v in old['validation']))
        self.assertTrue(all('intervalDiagnostics' in v for v in new['validation']))


if __name__=='__main__':unittest.main()
