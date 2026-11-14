import copy
import unittest
from datetime import date, timedelta
from service.observatory.seasonal_trend import seasonal_trend


def station_series(start=date(2022,1,1), end=date(2024,12,31), slope=5):
    points=[]
    for i in range((end-start).days+1):
        d=start+timedelta(days=i)
        points.append(dict(date=d.isoformat(),value=100+d.month*20+slope*(d.year-2022),quality='Approved'))
    return dict(id='usgs-discharge',label='Synthetic station',unit='ft^3/s',evidenceIds=['e-fixture'],points=points)


class SeasonalTrendTests(unittest.TestCase):
    def test_exact_season_matched_slope_and_fixed_support(self):
        s=station_series(); t=seasonal_trend(s)
        self.assertEqual(t['status'],'descriptive'); self.assertEqual(t['slope'],5)
        self.assertEqual(t['pairCount'],36); self.assertEqual(t['commonMonths'],list(range(1,13)))
        self.assertEqual(t['sensitivityRange'],dict(minimum=5,maximum=5)); self.assertTrue(t['signStable'])
        self.assertEqual(t,seasonal_trend(copy.deepcopy(s)))
        s['points'][0]['quality']='Provisional'; self.assertNotEqual(t['inputHash'],seasonal_trend(s)['inputHash'])

    def test_seasonal_cycle_and_zero_flow_are_not_false_trends(self):
        s=station_series(slope=0)
        self.assertEqual(seasonal_trend(s)['slope'],0)
        for p in s['points']:p['value']=0
        t=seasonal_trend(s); self.assertEqual(t['status'],'descriptive'); self.assertEqual(t['slope'],0)
        self.assertEqual(t['sensitivityRange'],dict(minimum=0,maximum=0))

    def test_isolated_extreme_does_not_dominate_monthly_medians(self):
        s=station_series(); s['points'][-1]['value']=1e308
        self.assertEqual(seasonal_trend(s)['slope'],5)
        for p in s['points']:p['value']=1e308
        t=seasonal_trend(s); self.assertEqual(t['slope'],0)
        self.assertTrue(all(m['median']==1e308 for m in t['months']))

    def test_missing_quality_and_partial_months_are_auditable(self):
        s=station_series(start=date(2022,1,2),end=date(2025,1,10))
        for p in s['points']:
            if p['date'].startswith('2023-06') and int(p['date'][-2:])<=7:p.update(value=None,quality='missing')
            if p['date'].startswith('2024-07'):p['quality']='Provisional'
        t=seasonal_trend(s)
        june=next(m for m in t['months'] if m['year']==2023 and m['month']==6)
        self.assertEqual(june['longestExcludedRun'],7); self.assertFalse(june['eligible'])
        self.assertFalse(t['months'][0]['complete']); self.assertFalse(t['months'][-1]['complete'])
        self.assertNotIn(1,t['commonMonths']); self.assertNotIn(6,t['commonMonths']); self.assertNotIn(7,t['commonMonths'])
        self.assertEqual(t['slope'],5)

    def test_too_few_years_irregular_dates_unknown_quality_withhold(self):
        s=station_series(end=date(2023,12,31)); self.assertEqual(seasonal_trend(s)['status'],'withheld')
        s=station_series(); s['points'].pop(10); self.assertEqual(seasonal_trend(s)['status'],'withheld')
        s=station_series()
        for p in s['points']:p['quality']='approval unknown'
        t=seasonal_trend(s); self.assertEqual(t['status'],'withheld'); self.assertIsNone(t['slope'])
        self.assertTrue(all(m['median'] is None for m in t['months']))

    def test_six_months_must_be_shared_not_just_present_somewhere(self):
        s=station_series()
        for p in s['points']:
            year=int(p['date'][:4]); month=int(p['date'][5:7])
            if month>(6 if year==2022 else 7) or (year!=2022 and month==1):p['value']=None
        t=seasonal_trend(s); self.assertEqual(len(t['years']),3)
        self.assertEqual(len(t['commonMonths']),5); self.assertEqual(t['status'],'withheld')

    def test_one_anomalous_year_produces_visible_sensitivity(self):
        s=station_series()
        for p in s['points']:
            if p['date'].startswith('2023'):p['value']+=100
        t=seasonal_trend(s)
        self.assertEqual(t['slope'],5); self.assertFalse(t['signStable'])
        self.assertEqual(t['sensitivityRange'],dict(minimum=-95,maximum=105))
        self.assertEqual([v['omittedYear'] for v in t['leaveYearOut']],t['years'])

    def test_engine_publication_replays_trend_metric_and_claim(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        from service.config import Config
        from service.observatory.engine import run_assessment
        from service.assessment_validation import validate_assessment_manifest
        from service.tests.test_observatory_providers import request, QueueBudget, station, daily
        s=station_series();r=request();r.update(start=s['points'][0]['date'],end=s['points'][-1]['date'])
        r['options']['sourceIds']=['usgs-daily']
        records=[]
        for point in s['points']:
            record=daily(point['date'],str(point['value']))
            record['properties']['approval_status']='Approved'
            records.append(record)
        fixture=QueueBudget(station(),dict(features=records,links=[]))
        with tempfile.TemporaryDirectory() as tmp,patch('service.observatory.net.Budget.fetch',side_effect=fixture.fetch):
            result=run_assessment(r,Config(Path(tmp),b'fixture-secret'),tmp)
        self.assertEqual(result['series'][0]['seasonalTrend']['slope'],5)
        validate_assessment_manifest(result,r)
        for change in ('slope','support','metric','claim','duplicate-series','unsupported-unit'):
            bad=copy.deepcopy(result)
            if change=='slope':bad['series'][0]['seasonalTrend']['slope']=999
            if change=='support':bad['series'][0]['seasonalTrend']['months'][0]['approvedDays']=1
            if change=='metric':next(m for m in bad['metrics'] if m['id']=='gauge-seasonal-sen-slope')['value']=999
            if change=='claim':next(c for c in bad['claims'] if c['methodVersion']=='station-seasonal-sen-v1')['text']='A flood is certain.'
            if change=='duplicate-series':bad['series'].append(copy.deepcopy(bad['series'][0]))
            if change=='unsupported-unit':
                bad['series'][0]['unit']='m^3/s'
                for evidence in bad['evidence']:
                    if evidence['id'] in bad['series'][0]['evidenceIds']:evidence['unit']='m^3/s'
            with self.assertRaises(ValueError):validate_assessment_manifest(bad,r)


if __name__=='__main__':unittest.main()
