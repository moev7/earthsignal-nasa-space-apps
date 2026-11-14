"""Provider -> trusted owner -> immutable receipt -> protected result contract."""
import copy
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch
from service.config import Config
from service.observatory.engine import run_assessment
from service.observatory.vintages import ObservationVintageLedger
from service.assessment_validation import validate_assessment_manifest
from service.tests.test_observatory_providers import QueueBudget, station, daily, request


class VintageIntegrationTests(unittest.TestCase):
    def run_fixture(self,root,records,received='2026-10-09T00:00:00+00:00',owner='alice',**limits):
        r=request();r['options']['sourceIds']=['usgs-daily']
        cfg=replace(Config(root,b'fixture'),gauge_vintages_enabled=True,reserve_bytes=0,**limits)
        site=station();site['properties'].update(country_code='US',time_zone_abbreviation='PST',uses_daylight_savings='Y')
        queue=QueueBudget(site,dict(features=records,links=[]))
        def fetch(url,**kwargs):
            return replace(queue.fetch(url,**kwargs),retrieved_at=received)
        with patch('service.observatory.net.Budget.fetch',side_effect=fetch):
            result=run_assessment(r,cfg,root/'stage',owner=owner)
        validate_assessment_manifest(result,r)
        return result,r

    def test_real_pipeline_captures_revisions_and_owner_isolation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            first,r=self.run_fixture(root,[daily('2025-06-01','100',qualifier='Estimated'),daily('2025-06-03','200')])
            frozen=copy.deepcopy(first)
            second,_=self.run_fixture(root,[daily('2025-06-01','120',approval_status='Approved')],received='2026-10-10T00:00:00Z')
            snapshot=second['gaugeVintage']['snapshot']
            self.assertEqual([p['value'] for p in snapshot['observations']],[120,200])
            self.assertEqual(snapshot['unknownDays'],1)
            self.assertEqual(snapshot['observations'][0]['revision'],2)
            self.assertEqual(first,frozen)
            ledger=ObservationVintageLedger(root,'alice',reserve_bytes=0)
            earlier=ledger.as_of(snapshot['identity'],'2026-10-09T00:00:00Z',start=r['start'],end=r['end'])
            self.assertEqual([p['value'] for p in earlier['observations']],[100,200])
            self.assertEqual(earlier,first['gaugeVintage']['snapshot'])
            other=ObservationVintageLedger(root,'bob',reserve_bytes=0).as_of(snapshot['identity'],'2026-10-10T00:00:00Z',start=r['start'],end=r['end'])
            self.assertEqual(other['unknownDays'],3);self.assertFalse(other['observations'])
            exported=json.loads((root/'stage/manifest.json').read_text())
            self.assertEqual(exported,second)
            self.assertNotIn('alice',json.dumps(exported['gaugeVintage']))
            self.assertNotIn('area',json.dumps(exported['gaugeVintage']))

    def test_invalid_revision_is_saved_even_when_measurement_withheld(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            first,_=self.run_fixture(root,[daily('2025-06-01','100')])
            second,_=self.run_fixture(root,[daily('2025-06-01','invalid')],received='2026-10-10T00:00:00Z')
            self.assertEqual(second['outcome'],'unavailable')
            self.assertEqual(second['gaugeVintage']['status'],'captured')
            obs=second['gaugeVintage']['snapshot']['observations'][0]
            self.assertIsNone(obs['value']);self.assertEqual(obs['revision'],2)
            self.assertEqual(first['gaugeVintage']['snapshot']['observations'][0]['value'],100)

    def test_storage_failure_is_explicit_and_measurements_survive(self):
        with tempfile.TemporaryDirectory() as tmp:
            result,_=self.run_fixture(Path(tmp),[daily('2025-06-01','100')],storage_bytes=1)
            self.assertEqual(result['gaugeVintage'],{'status':'unavailable','reason':'storage_limit'})
            self.assertEqual(result['metrics'][0]['value'],100)
            self.assertIn('availability archive',result['quality'][1]['message'])

    def test_snapshot_tamper_and_incorrect_population_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            result,r=self.run_fixture(Path(tmp),[daily('2025-06-01','100')])
            for mutate in (lambda s:s.update(unknownDays=0),lambda s:s['observations'][0].update(value=999),lambda s:s.update(issueTime='2026-10-08T00:00:00.000000Z')):
                bad=copy.deepcopy(result);mutate(bad['gaugeVintage']['snapshot'])
                with self.assertRaises(ValueError):validate_assessment_manifest(bad,r)

    def test_unowned_direct_call_cannot_capture_under_shared_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            result,_=self.run_fixture(Path(tmp),[daily('2025-06-01','100')],owner=None)
            self.assertNotIn('gaugeVintage',result)
            self.assertFalse((Path(tmp)/'gauge-vintages.sqlite3').exists())

if __name__=='__main__':unittest.main()
