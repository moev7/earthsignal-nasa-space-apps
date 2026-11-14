import csv
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from service.config import Config
from service.assessment_validation import validate_assessment_manifest
from service.observatory.engine import run_assessment
from service.observatory import providers as p
from service.observatory.net import ProviderError
from service.tests.test_observatory_providers import request,QueueBudget,station,daily


class EngineTests(unittest.TestCase):
    def config(self,tmp):return Config(Path(tmp),b'test-no-real-secret',netrc=Path(tmp)/'absent',wall_seconds=60)

    def test_real_adapter_engine_five_artifacts_and_claims(self):
        r=request();r['options']['sourceIds']=['usgs-daily']
        fixture=QueueBudget(station(),{'features':[daily('2025-06-01','14300'),daily('2025-06-03','17600')],'links':[]})
        with tempfile.TemporaryDirectory() as tmp,patch('service.observatory.net.Budget.fetch',side_effect=fixture.fetch):
            result=run_assessment(r,self.config(tmp),Path(tmp)/'stage')
            validate_assessment_manifest(result,r)
            self.assertEqual(result['outcome'],'partial');self.assertEqual(result['metrics'][1]['value'],3300)
            self.assertTrue(result['evidence']);self.assertTrue(result['claims']);self.assertEqual(len(result['brief']['sections']),5)
            self.assertEqual(set(x.name for x in (Path(tmp)/'stage').iterdir()),{'manifest.json','brief.json','metrics.csv','area.geojson','evidence.json'})
            self.assertEqual(json.loads((Path(tmp)/'stage/evidence.json').read_text()),result['evidence'])
            self.assertEqual(json.loads((Path(tmp)/'stage/brief.json').read_text()),result['brief'])
            with (Path(tmp)/'stage/metrics.csv').open() as stream: table=list(csv.DictReader(stream))
            self.assertEqual([m['id'] for m in table],[m['id'] for m in result['metrics']])
            self.assertEqual(float(table[1]['value']),3300)
            self.assertIsNone(result['series'][0]['points'][1]['value'])

    def test_provider_failure_unavailable_not_empty_complete(self):
        r=request();r['options']['sourceIds']=['usgs-daily']
        with tempfile.TemporaryDirectory() as tmp,patch('service.observatory.net.Budget.fetch',side_effect=ProviderError('access_gate')):
            result=run_assessment(r,self.config(tmp),tmp)
            self.assertEqual(result['outcome'],'unavailable');self.assertFalse(result['metrics']);self.assertFalse(result['claims'])
            self.assertIn('access_gate',result['quality'][1]['message']);validate_assessment_manifest(result,r)

    def test_unknown_and_unimplemented_selected_source_no_network(self):
        r=request('urban');r['options']={'sourceIds':['nlcd-histories','not-real']}
        with tempfile.TemporaryDirectory() as tmp,patch('service.observatory.net.Budget.fetch') as fetch:
            result=run_assessment(r,self.config(tmp),tmp);fetch.assert_not_called()
            self.assertEqual(result['outcome'],'unavailable');self.assertIn('unsupported',result['quality'][1]['message'])

    def test_invalid_request_rejected_before_fetch_and_output(self):
        r=request();r['end']='2020-01-01'
        with tempfile.TemporaryDirectory() as tmp,patch('service.observatory.net.Budget.fetch') as fetch:
            with self.assertRaises(ValueError):run_assessment(r,self.config(tmp),Path(tmp)/'stage')
            fetch.assert_not_called();self.assertFalse((Path(tmp)/'stage').exists())

    def test_deterministic_claim_ids_and_no_unsupported_forecast(self):
        r=request();r['question']='future';r['options']['sourceIds']=['usgs-daily']
        outputs=[]
        for _ in range(2):
            fixture=QueueBudget(station(),{'features':[daily('2025-06-01','14300')],'links':[]})
            with tempfile.TemporaryDirectory() as tmp,patch('service.observatory.net.Budget.fetch',side_effect=fixture.fetch):
                outputs.append(run_assessment(r,self.config(tmp),tmp))
        self.assertEqual(outputs[0]['claims'],outputs[1]['claims']);self.assertEqual(outputs[0]['brief'],outputs[1]['brief'])
        self.assertFalse(any(c['type'] in ('Forecast','Possible explanation','Human annotation') for c in outputs[0]['claims']))
        self.assertEqual(next(q for q in outputs[0]['quality'] if q['dimension']=='prediction')['status'],'withheld')




    def test_raster_comparison_uses_common_population_not_independent_medians(self):
        import sys,types,hashlib
        from copy import deepcopy
        from service.tests.test_observatory_providers import stac_item
        item=stac_item();before=deepcopy(item);before['id']='S2C_T11SPV_20250601T182903_L2A';before['properties']['datetime']='2025-06-01T18:34:48+00:00'
        fixture=QueueBudget({'features':[before,item]},{'features':[before,item]})
        r=request('ecology','2025-06-01','2025-06-30');r['options']={'sourceIds':['sentinel-2-indices']}
        def crop(value):
            return dict(metrics=[p.metric('ndvi-median','Median NDVI',value,'index',[],'One acquisition valid population','1000 AOI centres')],
                coveragePercent=40,totalPixels=1000,validPixels=400,hashes={'mask':hashlib.sha256(str(value).encode()).hexdigest()},
                grid={'crs':'EPSG:32611','resolution':20},maskPolicy='SCL 4/5/6',_arrays=object(),_valid=object(),_area=object())
        fake=types.ModuleType('service.observatory.raster')
        fake.crop_bands=__import__('unittest.mock',fromlist=['Mock']).Mock(side_effect=[crop(.1),crop(.8)])
        fake.compare_crops=__import__('unittest.mock',fromlist=['Mock']).Mock(return_value=dict(
            metrics=[p.metric('ndvi-difference','Median common-valid NDVI difference',.2,'index',[],'Pixelwise common population','300 common centres')],
            comparisons={},coveragePercent=30,hashes={'ndviCommonMask':hashlib.sha256(b'common').hexdigest()}))
        with tempfile.TemporaryDirectory() as tmp,patch.dict(sys.modules,{'service.observatory.raster':fake}),patch('service.observatory.net.Budget.fetch',side_effect=fixture.fetch):
            result=run_assessment(r,self.config(tmp),tmp)
        fake.compare_crops.assert_called_once()
        measured=next(m for m in result['metrics'] if m['id']=='ndvi-difference')
        self.assertEqual(measured['value'],.2);self.assertNotEqual(measured['value'],.8-.1)
        self.assertEqual(len(measured['evidenceIds']),3)
        comparison=next(e for e in result['evidence'] if e['id']==measured['evidenceIds'][-1])
        self.assertEqual(comparison['quality']['commonCoveragePercent'],30)
        self.assertFalse(comparison['public']);self.assertNotIn('_arrays',json.dumps(result))
        validate_assessment_manifest(result,r)

    def test_actual_threshold_scenario_artifact_contract(self):
        from service.observatory.engine import run_scenario
        from service.assessment_validation import validate_scenario_manifest,validate_brief
        parent=dict(area=request()['area'],evidence=[],metrics=[p.metric('m','Discharge',5,'ft^3/s',[],'Synthetic scenario contract fixture','One station-day')])
        scenario=dict(schemaVersion='1.0',assessmentId='a'*32,kind='threshold',inputs={'metricId':'m','threshold':4,'operator':'above'},assumptions=['Fixture test only'],objectives=['Compare threshold'])
        with tempfile.TemporaryDirectory() as tmp:
            result=run_scenario(scenario,parent,self.config(tmp),tmp)
            validate_scenario_manifest(result,scenario,parent)
            brief=json.loads((Path(tmp)/'brief.json').read_text());validate_brief(brief,{c['id'] for c in result['claims']})
            self.assertNotIn('brief',result);self.assertEqual(result['outputs'][0]['value'],1)
            self.assertEqual(json.loads((Path(tmp)/'area.geojson').read_text()),parent['area'])



class LiveRoundtripTests(unittest.TestCase):
    @unittest.skipUnless(__import__('os').environ.get('EARTHSIGNAL_LIVE_OBSERVATORY')=='1','Explicit opt-in read-only public endpoint smoke')
    def test_all_domains_real_public_evidence_and_valid_artifacts(self):
        from datetime import datetime,timezone,timedelta
        today=datetime.now(timezone.utc).date()
        cases=[('water',p.box_geometry([-114.8,36,-114.7,36.05]),'2025-06-01','2025-06-03',{'gaugeId':'09421500','sourceIds':['usgs-daily','opera-dswx-hls','pinned-water-mosaic','pinned-water-history','nws-weather-context']}),
               ('fire',p.box_geometry([-84,45,-78,49]),(today-timedelta(days=1)).isoformat(),today.isoformat(),{'sourceIds':['firms-thermal','nifc-perimeters','nws-weather-context']}),
               ('ecology',p.box_geometry([-115,35.94,-114.99,35.95]),'2025-06-01','2025-06-30',{'sourceIds':['sentinel-2-indices','hls-ndvi-ndmi','nws-weather-context']}),
               ('urban',p.box_geometry([-115,35.94,-114.99,35.95]),'2025-06-01','2025-06-30',{'sourceIds':['landsat-c2-lst','nws-weather-context']})]
        for domain,area,start,end,options in cases:
            with self.subTest(domain=domain),tempfile.TemporaryDirectory() as tmp:
                r=dict(schemaVersion='1.0',domain=domain,question='change',area=area,start=start,end=end,options=options)
                result=run_assessment(r,Config(Path(tmp),b'live-smoke-no-secret',netrc=Path(tmp)/'absent',wall_seconds=150),Path(tmp)/'stage')
                validate_assessment_manifest(result,r)
                expected={'water':'usgs-daily','fire':'firms-thermal','ecology':'sentinel-2-indices','urban':'landsat-c2-lst'}[domain]
                self.assertIn(expected,{e['sourceId'] for e in result['evidence']},'Live source outage or missing expected domain evidence: '+result['quality'][1]['message'])
                self.assertEqual({f.name for f in (Path(tmp)/'stage').iterdir()},set(result['artifacts']))
                self.assertNotEqual(result['outcome'],'complete')
                self.assertTrue(all(e['hashes'] for e in result['evidence']))
                self.assertTrue(all(e['timestamps']['retrievedAt'] for e in result['evidence']))
                print('LIVE_RECEIPT',json.dumps(dict(domain=domain,outcome=result['outcome'],metrics=result['metrics'],
                    evidence=[dict(id=e['id'],sourceId=e['sourceId'],title=e['title'],sourceVersion=e['sourceVersion'],hashes=e['hashes']) for e in result['evidence']],quality=result['quality']),ensure_ascii=False))

if __name__=='__main__':unittest.main()
