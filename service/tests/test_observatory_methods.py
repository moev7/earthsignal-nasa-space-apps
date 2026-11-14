import unittest
from datetime import date,timedelta,datetime,timezone
import numpy as np
from service.observatory.methods import nd_index,landsat_kelvin,sentinel_valid,hls_valid,landsat_valid,common_difference,seasonal_baseline,persistent_departure
from service.observatory.forecasts import evaluate_gauge

class MethodsTests(unittest.TestCase):
    def test_index_physical_denominator(self):
        values,valid=nd_index(np.array([.8,.2,0,np.nan]),np.array([.2,.8,0,.1]),np.ones(4,bool))
        self.assertAlmostEqual(values[0],.6);self.assertAlmostEqual(values[1],-.6);self.assertEqual(valid.tolist(),[True,True,False,False])
    def test_masks_and_temperature(self):
        self.assertEqual(sentinel_valid(np.arange(12)).tolist(),[False]*4+[True]*3+[False]*5)
        self.assertEqual(landsat_valid(np.array([0,1,2,4,8,16,32,128])).tolist(),[True]+[False]*6+[True])
        self.assertAlmostEqual(float(landsat_kelvin(10000)),183.1802)
        self.assertEqual(hls_valid(np.array([0,32,64,128,192,1,2,4,8,16,255])).tolist(),[True,True,True,True]+[False]*7)
    def test_same_population_and_coverage_abstention(self):
        before=np.array([1,2,3,4.]);after=np.array([2,4,6,8.]);mask=np.ones(4,bool)
        result=common_difference(before,after,np.array([1,1,0,0],bool),mask,mask)
        self.assertEqual(result['commonValidPixels'],2);self.assertEqual(result['coveragePercent'],50);self.assertEqual(result['median'],1.5);self.assertIn('withheld',result['scope'])
        reverse=common_difference(after,before,mask,np.array([1,1,0,0],bool),mask);self.assertEqual(reverse['median'],-1.5)
    def test_empty_overlap_rejected(self):
        with self.assertRaises(ValueError):common_difference(np.ones(2),np.ones(2),np.array([1,0],bool),np.array([0,1],bool),np.ones(2,bool))
    def test_baseline_never_uses_future(self):
        points=[{'date':f'202{i}-06-{d:02d}','value':i} for i in range(1,5) for d in range(1,13)]
        baseline=seasonal_baseline(points,'2023-06-01');self.assertEqual(baseline['sampleCount'],24);self.assertTrue(all(d<'2023' for d in baseline['dates']))
        self.assertIsNone(persistent_departure([{'value':None}]*3,baseline)['persistent'])

class ForecastTests(unittest.TestCase):
    def points(self,n=1460):
        start=date(2022,10,1)
        return [{'date':(start+timedelta(days=i)).isoformat(),'value':float(i)} for i in range(n)]
    def test_frozen_selection_and_unseen_year(self):
        points=self.points();now=datetime.combine(date.fromisoformat(points[-1]['date']),datetime.min.time(),timezone.utc)
        result=evaluate_gauge(points,'gauge-public','ft',now=now)
        self.assertEqual(len(result['forecasts']),3)
        self.assertTrue(all(v['origins']>=30 for v in result['validation']))
        self.assertTrue(all(v['improvementFraction']>=.1 for v in result['validation']))
        changed=[dict(p) for p in points]
        for p in changed[-365:]:p['value']+=1000
        other=evaluate_gauge(changed,'gauge-public','ft',now=now)
        self.assertEqual(result['selectionHash'],other['selectionHash'])
    def test_stale_missing_and_short_histories_abstain(self):
        points=self.points();stale=datetime(2030,1,1,tzinfo=timezone.utc)
        self.assertFalse(evaluate_gauge(points,'gauge','ft',stale)['forecasts'])
        self.assertFalse(evaluate_gauge(points[:900],'gauge','ft')['forecasts'])
        points[20]['value']=None
        self.assertFalse(evaluate_gauge(points,'gauge','ft',stale)['forecasts'])
    def test_unbeatable_baseline_is_negative_result(self):
        points=self.points();now=datetime.combine(date.fromisoformat(points[-1]['date']),datetime.min.time(),timezone.utc)
        for p in points:p['value']=5.
        result=evaluate_gauge(points,'gauge','ft',now)
        self.assertFalse(result['forecasts']);self.assertEqual(len(result['withheld']),3)

if __name__=='__main__':unittest.main()
