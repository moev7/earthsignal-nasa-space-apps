import unittest
from datetime import date,datetime,timedelta,timezone
import numpy as np
from service.observatory.forecasts import interval_diagnostics,calibration_radius,evaluate_gauge


class IntervalDiagnosticsTests(unittest.TestCase):
    def test_score_penalizes_width_and_missing_distance(self):
        self.assertEqual(interval_diagnostics([0],[0],1)['intervalScore'],2)
        self.assertEqual(interval_diagnostics([2],[0],1)['intervalScore'],22)
        self.assertEqual(interval_diagnostics([1],[0],0)['intervalScore'],20)
        self.assertEqual(interval_diagnostics([-2],[0],1)['intervalScore'],22)
        self.assertEqual(interval_diagnostics([0,0],[0,0],5e307)['intervalScore'],1e308)

    def test_miss_run_and_population_reconcile_in_evaluation_order(self):
        d=interval_diagnostics([2,2,0,-2,2],[0]*5,1)
        self.assertEqual(d['belowCount'],1);self.assertEqual(d['withinCount'],1);self.assertEqual(d['aboveCount'],3)
        self.assertEqual(d['longestMissRun'],2)
        # Boundary tolerance agrees with the retrospective coverage definition.
        d=interval_diagnostics([1+5e-11],[0],1);self.assertEqual(d['withinCount'],1)

    def test_finite_calibration_rank_and_invalid_inputs(self):
        self.assertEqual(calibration_radius(np.arange(35)),32)
        for actual,prediction,radius in [([],[],1),([1],[0,1],1),([np.nan],[0],1),([1],[0],-1)]:
            with self.assertRaises(ValueError):interval_diagnostics(actual,prediction,radius)

    def test_baselines_use_calibration_without_final_year_leakage(self):
        first=date(2022,1,1)
        points=[dict(date=(first+timedelta(days=i)).isoformat(),value=100+2.*i) for i in range(1460)]
        now=datetime.fromisoformat(points[-1]['date']).replace(tzinfo=timezone.utc)+timedelta(hours=12)
        a=evaluate_gauge(points,'Synthetic','ft^3/s',now)
        self.assertEqual(len(a['validation']),3)
        for v in a['validation']:
            d=v['intervalDiagnostics'];self.assertEqual(d['belowCount']+d['withinCount']+d['aboveCount'],v['origins'])
            self.assertEqual(d['withinCount']/v['origins'],v['intervalCoverage'])
            self.assertEqual(len(d['baselineScores']),2)
        for p in points[-365:]:p['value']+=1000
        b=evaluate_gauge(points,'Synthetic','ft^3/s',now)
        self.assertEqual(a['selectionHash'],b['selectionHash'])
        self.assertNotEqual(a['validation'][0]['intervalDiagnostics']['intervalScore'],b['validation'][0]['intervalDiagnostics']['intervalScore'])

    def test_extreme_finite_input_withholds_nonfinite_calculation(self):
        first=date(2022,1,1)
        points=[dict(date=(first+timedelta(days=i)).isoformat(),value=1e308) for i in range(1460)]
        now=datetime.fromisoformat(points[-1]['date']).replace(tzinfo=timezone.utc)+timedelta(hours=12)
        result=evaluate_gauge(points,'Synthetic','ft^3/s',now)
        self.assertFalse(result['forecasts']);self.assertFalse(result['validation'])
        self.assertIn('Numerical range',result['withheld'][0])
