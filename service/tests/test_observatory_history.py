import copy
import tempfile
import unittest
from datetime import date,datetime,timedelta,timezone
from pathlib import Path
from unittest.mock import patch
import numpy as np
from service.observatory.history import analyze_series
from service.observatory.methods import summary,seasonal_baseline,persistent_departure
from service.observatory.forecasts import evaluate_gauge
from service.observatory.scenarios import weight_sweep
from service.observatory.engine import run_assessment
from service.assessment_validation import validate_assessment_manifest
from service.tests.test_observatory_providers import request,QueueBudget,station,daily
from service.config import Config

class HistoryTests(unittest.TestCase):
    def series(self,points):return dict(id='fixture',label='Fixture measurements',unit='index',evidenceIds=[],points=[dict(p,quality='fixture') for p in points])
    def test_gap_distribution_and_rolling_population(self):
        s=self.series([{'date':'2025-01-01','value':1.},{'date':'2025-01-02','value':3.},{'date':'2025-01-03','value':None},{'date':'2025-01-04','value':5.},{'date':'2025-02-04','value':7.}])
        a=analyze_series(s)
        self.assertEqual(a['observedCount'],4);self.assertEqual(a['calendarDays'],35);self.assertEqual(a['missingDays'],31);self.assertEqual(a['maxGapDays'],30)
        self.assertEqual(sum(b['count'] for b in a['histogram']),4);self.assertEqual(a['spread']['median'],4.)
        self.assertIsNone(a['rolling'][2]['value']);self.assertEqual(a['rolling'][3]['value'],3.);self.assertIsNone(a['rolling'][4]['value'])
        self.assertEqual(a['endpointDifference'],6.);self.assertFalse(a['seasonal']['supported'])
        self.assertEqual(a,analyze_series(copy.deepcopy(s)))
        s['points'][0]['quality']='changed';self.assertNotEqual(a['inputHash'],analyze_series(s)['inputHash'])
    def test_single_prior_year_and_duplicates_cannot_establish_seasonality(self):
        points=[{'date':f'2025-06-{i:02d}','value':10.} for i in range(1,13)]
        a=seasonal_baseline(points*10,'2026-06-01');self.assertEqual(a['sampleCount'],12);self.assertEqual(a['distinctYearCount'],1);self.assertFalse(a['supported'])
        a=seasonal_baseline(points+[{'date':'2024-06-01','value':9.}],'2026-06-01');self.assertTrue(a['supported'])
        a=seasonal_baseline(points+[{'date':'2024-06-01','value':9.},{'date':'2024-06-01','value':15.}],'2026-06-01');self.assertFalse(a['supported'])
    def test_calendar_alignment_and_future_exclusion(self):
        points=[{'date':'2024-03-01','value':1.},{'date':'2025-03-01','value':2.},{'date':'2026-03-01','value':100.}]
        a=seasonal_baseline(points,'2026-03-01',radius_days=0,min_samples=2)
        self.assertEqual(a['sampleCount'],2);self.assertTrue(a['supported']);self.assertEqual(a['median'],1.5)
    def test_centuries_apart_are_not_persistent(self):
        baseline={'supported':True,'median':0.,'mad':1.}
        points=[{'date':d,'value':20.} for d in ['2001-01-01','2011-01-01','2026-01-01']]
        self.assertFalse(persistent_departure(points,baseline)['supported'])
        points=[{'date':f'2026-01-{i:02d}','value':20.} for i in (1,2,3)]
        self.assertTrue(persistent_departure(points,baseline)['persistent'])
        points[-1]['value']=True;self.assertFalse(persistent_departure(points,baseline)['supported'])
    def test_high_coverage_never_proves_representativeness(self):
        a=summary(np.array([0.]*8+[100.]*2),np.array([True]*8+[False]*2),10)
        self.assertEqual(a['coveragePercent'],80);self.assertEqual(a['p95'],0);self.assertIn('withheld',a['scope']);self.assertIn('not a confidence',a['spreadInterpretation'])
    def test_missing_empty_invalid_and_bounded_histories(self):
        a=analyze_series(self.series([]));self.assertEqual(a['observedCount'],0);self.assertIsNone(a['latest'])
        for points in [[{'date':'2025-01-01','value':True}], [{'date':'2025-01-01','value':1.}]*2]:
            with self.assertRaises(ValueError):analyze_series(self.series(points))
    def test_engine_analysis_is_retained_and_tampering_rejected(self):
        r=request();r['options']['sourceIds']=['usgs-daily']
        fixture=QueueBudget(station(),{'features':[daily('2025-06-01','100'),daily('2025-06-03','200')],'links':[]})
        with tempfile.TemporaryDirectory() as tmp,patch('service.observatory.net.Budget.fetch',side_effect=fixture.fetch):
            a=run_assessment(r,Config(Path(tmp),b'fixture-secret'),tmp)
            self.assertEqual(a['series'][0]['analysis']['observedCount'],2)
            self.assertFalse(a['forecastEvaluation']['forecasts']);self.assertTrue(a['forecastEvaluation']['withheld'])
            bad=copy.deepcopy(a);bad['series'][0]['unit']='km2'
            with self.assertRaises(ValueError):validate_assessment_manifest(bad,r)
            bad_request=copy.deepcopy(r);bad_request['start']=bad_request['end']='2025-06-03'
            bad=copy.deepcopy(a);bad['time']={'start':bad_request['start'],'end':bad_request['end']}
            with self.assertRaises(ValueError):validate_assessment_manifest(bad,bad_request)
            bad=copy.deepcopy(a);bad['evidence'][0]['timestamps']['observedStart']='2025-06-03'
            with self.assertRaises(ValueError):validate_assessment_manifest(bad,r)
            from service.observatory.history import gauge_evaluation
            forecast=copy.deepcopy(a);fr=copy.deepcopy(r)
            first=date(2022,10,10)
            points=[dict(date=(first+timedelta(days=i)).isoformat(),value=2.*i,quality='fixture') for i in range(1460)]
            fr['start']=points[0]['date'];fr['end']=points[-1]['date'];forecast['time']={'start':fr['start'],'end':fr['end']}
            forecast['series'][0]['points']=points;forecast['series'][0].pop('analysis');forecast['series'][0].pop('seasonalTrend',None);forecast['series'][0].pop('seasonalSampling',None)
            forecast['evidence'][0]['timestamps'].update(observedStart=fr['start'],observedEnd=fr['end'])
            forecast['processedAt']=fr['end']+'T12:00:00+00:00'
            forecast['forecastEvaluation']=gauge_evaluation(forecast['series'][0],forecast['evidence'],now=datetime.fromisoformat(forecast['processedAt']))
            self.assertTrue(forecast['forecastEvaluation']['forecasts'])
            validate_assessment_manifest(forecast,fr)
            forecast['processedAt']='2026-10-10T12:00:00+00:00'
            with self.assertRaises(ValueError):validate_assessment_manifest(forecast,fr)
            a['series'][0]['analysis']['observedCount']=100
            with self.assertRaises(ValueError):validate_assessment_manifest(a,r)

class ForecastRegressionTests(unittest.TestCase):
    def points(self):
        first=date(2022,10,10)
        return [{'date':(first+timedelta(days=i)).isoformat(),'value':2.*i} for i in range(1460)]
    def issue(self,points,days=0):return datetime.combine(date.fromisoformat(points[-1]['date'])+timedelta(days=days),datetime.min.time(),timezone.utc)+timedelta(hours=12)
    def test_zero_coverage_withholds_even_with_point_skill(self):
        points=self.points()
        for i in range(1095,1460):points[i]['value']+=1.5*np.sin(i)
        r=evaluate_gauge(points,'fixture','ft^3/s',self.issue(points))
        self.assertEqual(len(r['validation']),3);self.assertFalse(r['forecasts'])
        self.assertTrue(all(v['improvementFraction']>.1 for v in r['validation']))
        self.assertTrue(all(v['intervalCoverage']==0 for v in r['validation']))
    def test_disjoint_folds_frozen_before_final_cycle(self):
        points=self.points();r=evaluate_gauge(points,'fixture','ft^3/s',self.issue(points));f=r['frozenSelection']
        self.assertLess(f['selectionEnd'],f['calibrationStart']);self.assertLess(f['calibrationEnd'],f['testStart'])
        self.assertGreaterEqual(f['selectionOrigins'],30);self.assertGreaterEqual(f['calibrationOrigins'],30)
        for p in points[-365:]:p['value']+=100
        other=evaluate_gauge(points,'fixture','ft^3/s',self.issue(points));self.assertEqual(r['selectionHash'],other['selectionHash'])
    def test_expired_target_and_stale_keep_validation_but_withhold(self):
        points=self.points();r=evaluate_gauge(points,'fixture','ft^3/s',self.issue(points,2))
        self.assertFalse(any(f['horizonDays']==1 for f in r['forecasts']));self.assertTrue(any('expired' in s for s in r['withheld']))
        old=evaluate_gauge(points,'fixture','ft^3/s',self.issue(points,20))
        self.assertEqual(len(old['validation']),3);self.assertFalse(old['forecasts']);self.assertTrue(any('stale' in s for s in old['withheld']))

class SweepTests(unittest.TestCase):
    def test_known_rank_reversal_ties_and_unknowns(self):
        result=weight_sweep([{'id':'cheap','name':'Cheap','cost':10,'benefit':5},{'id':'effective','name':'Effective','cost':100,'benefit':50},{'id':'unknown','name':'Unknown','cost':0}])
        self.assertEqual(result['cases'][0]['winners'],['effective']);self.assertEqual(result['cases'][-1]['winners'],['cheap'])
        self.assertEqual(result['cases'][10]['winners'],['cheap','effective']);self.assertEqual(result['rankingChanges'],2)
        self.assertEqual({w['id'] for w in result['winnerCounts']},{'cheap','effective'})
    def test_tied_candidates_all_co_win(self):
        r=weight_sweep([{'id':'a','name':'A','cost':1,'benefit':1},{'id':'b','name':'B','cost':1,'benefit':1}])
        self.assertEqual(r['rankingChanges'],0);self.assertTrue(all(w['count']==21 for w in r['winnerCounts']))

if __name__=='__main__':unittest.main()
