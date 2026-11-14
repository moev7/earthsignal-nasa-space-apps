import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from service.observatory.scenarios import run_scenario,pareto_alternatives,threshold_sweep
from service.assessment_validation import validate_scenario_manifest,validate_scenario_request

class ScenarioTests(unittest.TestCase):
    def parent(self):return {'area':{'type':'Polygon','coordinates':[[[0,0],[1,0],[1,1],[0,1],[0,0]]]},'evidence':[],'metrics':[{'id':'temperature','label':'Surface temperature','value':300.,'unit':'K','evidenceIds':[],'description':'surface only','denominator':'valid subset'}]}
    def test_threshold_preserves_quantity_and_assumptions(self):
        request={'schemaVersion':'1.0','assessmentId':'a'*32,'kind':'threshold','inputs':{'metricId':'temperature','threshold':299,'operator':'above'},'assumptions':['Selected period only'],'objectives':['Inspect threshold']}
        with tempfile.TemporaryDirectory() as output:
            result=run_scenario(request,self.parent(),SimpleNamespace(),output)
            validate_scenario_manifest(result,request,self.parent());self.assertEqual(result['outputs'][0]['value'],1)
            self.assertEqual(result['changedInputs'],request['inputs']);self.assertNotIn('probability',json.dumps(result).lower().replace('no occurrence probability','').replace('not a forecast or a probability',''))
            self.assertEqual(json.loads(Path(output,'evidence.json').read_text()),[])
    def test_unknown_candidate_not_dominated_or_ranked(self):
        result=pareto_alternatives([{'id':'a','name':'A','cost':10,'benefit':8},{'id':'b','name':'B','cost':20,'benefit':7},{'id':'c','name':'C','cost':1}],{'cost':1,'benefit':1})
        self.assertTrue(result[0]['pareto']);self.assertFalse(result[1]['pareto']);self.assertIsNone(result[2]['pareto']);self.assertIsNone(result[2]['score']);self.assertIsNone(result[2]['benefit'])
        self.assertGreater(result[0]['score'],result[1]['score'])
    def test_ranking_requires_explicit_weights(self):
        result=pareto_alternatives([{'id':'a','name':'A','cost':10,'benefit':8}]);self.assertIsNone(result[0]['score'])
    def test_unavailable_metric_rejected(self):
        request={'schemaVersion':'1.0','assessmentId':'a'*32,'kind':'threshold','inputs':{'metricId':'unknown','threshold':0,'operator':'above'},'assumptions':[],'objectives':['Check']}
        with tempfile.TemporaryDirectory() as output,self.assertRaises(ValueError):run_scenario(request,self.parent(),None,output)

    def test_threshold_range_equality_reversal_and_export(self):
        import csv
        metric=self.parent()['metrics'][0]
        bounds={'minimum':290.,'maximum':310.}
        above=threshold_sweep(metric,bounds,'above');below=threshold_sweep(metric,bounds,'below')
        self.assertEqual(len(above['cases']),21)
        self.assertEqual([c['threshold'] for c in above['cases']],list(range(290,311)))
        self.assertEqual([sum(c['meets'] for c in s['cases']) for s in [above,below]],[10,10])
        self.assertFalse(above['cases'][10]['meets']);self.assertFalse(below['cases'][10]['meets'])
        self.assertEqual(above['crossing'],dict(threshold=300.,withinRange=True,meetsAtEquality=False))
        self.assertEqual(above['conditionChanges'],1)
        request=dict(schemaVersion='1.0',assessmentId='a'*32,kind='threshold',inputs=dict(metricId='temperature',threshold=299.,operator='above',thresholdRange=bounds),assumptions=['Test assumptions'],objectives=['Inspect threshold sensitivity'])
        with tempfile.TemporaryDirectory() as output:
            result=run_scenario(request,self.parent(),None,output);validate_scenario_manifest(result,request,self.parent())
            self.assertEqual(result['thresholdSweep'],above)
            with Path(output,'metrics.csv').open() as stream:rows=list(csv.DictReader(stream))
            self.assertEqual(len(rows),44)
            self.assertEqual(next(r for r in rows if r['id']=='threshold-sweep-10-condition')['value'],'0')
            self.assertEqual(next(r for r in rows if r['id']=='threshold-sweep-10-margin')['value'],'0.0')
            for mutate in [lambda r:r.pop('thresholdSweep'),lambda r:r['thresholdSweep']['cases'][0].update(meets=False),lambda r:r['thresholdSweep'].update(unit='°C'),lambda r:r['outputs'][-1].update(value=999)]:
                corrupt=json.loads(json.dumps(result));mutate(corrupt)
                with self.assertRaises(ValueError):validate_scenario_manifest(corrupt,request,self.parent())

    def test_threshold_range_outside_and_negative_values(self):
        metric={**self.parent()['metrics'][0],'value':-2.}
        sweep=threshold_sweep(metric,dict(minimum=0.,maximum=20.),'below')
        self.assertFalse(sweep['crossing']['withinRange']);self.assertEqual(sweep['conditionChanges'],0)
        self.assertTrue(all(c['meets'] for c in sweep['cases']))
        self.assertEqual(sweep['cases'][0]['margin'],-2.)

    def test_decimal_grid_zero_and_tenths_preserve_strict_equality(self):
        for value,bounds,index in [(0.,dict(minimum=-14.,maximum=6.),14),(.1,dict(minimum=0.,maximum=.2),10)]:
            metric={**self.parent()['metrics'][0],'value':value}
            for operator in ['above','below']:
                sweep=threshold_sweep(metric,bounds,operator)
                self.assertEqual(sweep['cases'][index]['threshold'],value)
                self.assertFalse(sweep['cases'][index]['meets'])
                self.assertEqual(sweep['cases'][index]['margin'],0.)

    def test_exact_boundary_and_scalar_replay(self):
        parent=self.parent();parent['metrics'][0]['value']=300.00004
        request=dict(schemaVersion='1.0',assessmentId='a'*32,kind='threshold',inputs=dict(metricId='temperature',threshold=300.,operator='above'),assumptions=[],objectives=['Inspect'])
        for bounds in [None,dict(minimum=290.,maximum=310.)]:
            if bounds:request['inputs']['thresholdRange']=bounds
            with tempfile.TemporaryDirectory() as output:
                result=run_scenario(request,parent,None,output);validate_scenario_manifest(result,request,parent)
                self.assertEqual(result['outputs'][0]['value'],1)
                self.assertIn('300.00004 K',result['claims'][0]['text'])
                if bounds:self.assertIn('exact condition boundary is 300.00004 K',result['claims'][1]['text'])
                for index,value in [(0,0),(1,999)]:
                    corrupt=json.loads(json.dumps(result));corrupt['outputs'][index]['value']=value
                    with self.assertRaises(ValueError):validate_scenario_manifest(corrupt,request,parent)

    def test_threshold_range_rejects_invalid_or_unresolvable_bounds(self):
        request=dict(schemaVersion='1.0',assessmentId='a'*32,kind='threshold',inputs=dict(metricId='temperature',threshold=299.,operator='above'),assumptions=[],objectives=['Inspect'])
        for bounds in [dict(minimum=1.,maximum=1.),dict(minimum=2.,maximum=1.),dict(minimum=False,maximum=1.),dict(minimum=0.,maximum=float('inf')),dict(minimum=1.,maximum=1.0000000000000002),dict(minimum=0.,maximum=1.,steps=1000000)]:
            with self.assertRaises(ValueError):validate_scenario_request({**request,'inputs':{**request['inputs'],'thresholdRange':bounds}})
        metric={**self.parent()['metrics'][0],'value':1e308}
        with self.assertRaises(ValueError):threshold_sweep(metric,dict(minimum=-1e308,maximum=-1e307),'above')

if __name__=='__main__':unittest.main()
