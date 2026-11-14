"""Boundary/attestation tests; arithmetic has its own independent enumerated tests."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from service.benchmarks import area_experiment as cli


def context():
    return {'studyId':'synthetic-only','stage':'development',
            'sourceEvidence':[{'id':'synthetic-source','sha256':'a'*64,'observedAt':'2026-01-01T00:00:00Z'}],
            'geometryHash':'b'*64,'protocolFrozenAt':'2025-01-01T00:00:00Z',
            'selectionFrozenAt':'2025-02-01T00:00:00Z','outcomesFrozenAt':'2026-02-01T00:00:00Z',
            'referenceQuality':'unverified','reviewEvidenceHash':None}


class AreaExperimentTests(unittest.TestCase):
    def test_freeze_order_source_times_and_review_declarations(self):
        cli.validate_context(context())
        for key,value in [('protocolFrozenAt','2026-03-01T00:00:00Z'),('selectionFrozenAt','2024-01-01T00:00:00Z'),('outcomesFrozenAt','2026-01-01'),('referenceQuality','externally-reviewed')]:
            c=context();c[key]=value
            with self.assertRaises(ValueError):cli.validate_context(c)
        c=context();c['sourceEvidence'][0]['observedAt']='2027-01-01T00:00:00Z'
        with self.assertRaises(ValueError):cli.validate_context(c)

    def test_pin_before_decode_and_calculation_private_output_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'input';destination=root/'output'
            source.write_bytes(b'not json')
            args=['--input',str(source),'--input-pin','0'*64,'--output',str(destination)]
            with patch.object(cli,'experiment') as calculate,contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(cli.main(args),2);calculate.assert_not_called()
            source.write_text('{}');pin=hashlib.sha256(source.read_bytes()).hexdigest();args[3]=pin
            result={'scientificReadiness':'requires-external-scientific-review','context':{'studyId':'private-name'}}
            with patch.object(cli,'experiment',return_value=result),contextlib.redirect_stdout(io.StringIO()) as out,contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(cli.main(args),0);original=destination.read_bytes()
                self.assertEqual(destination.stat().st_mode & 0o777,0o600)
                self.assertNotIn('private-name',out.getvalue());self.assertEqual(cli.main(args),2)
                self.assertEqual(destination.read_bytes(),original)

    def test_exact_ascii_output_bound_duplicate_keys_and_invalid_utf8(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'input';output=root/'output'
            for raw in [b'{"a":1,"a":2}',b'\xc3(']:
                source.write_bytes(raw);args=['--input',str(source),'--input-pin',hashlib.sha256(raw).hexdigest(),'--output',str(output)]
                with patch.object(cli,'experiment') as calculate,contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(cli.main(args),2);calculate.assert_not_called()
            source.write_bytes(b'{}');args[3]=hashlib.sha256(b'{}').hexdigest()
            # 180000 emoji <1MiB as UTF-8, but >2MiB in the actual ASCII writer.
            with patch.object(cli,'experiment',return_value={'note':'🌊'*180000}),contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(cli.main(args),2);self.assertFalse(output.exists())

    def test_committed_demo_stays_synthetic_and_attestations_do_not_promote_truth(self):
        source=Path(__file__).resolve().parents[2]/'examples/stratified-area-demo/input.json'
        value=json.loads(source.read_text())
        result=cli.experiment(value)
        self.assertEqual(result['scientificReadiness'],'withheld-development-evidence')
        a=result['calculation']['classes'][0]
        self.assertAlmostEqual(a['proportion'],.13);self.assertAlmostEqual(a['areaM2'],52000)
        self.assertFalse(result['mapAccuracyEstimated']);self.assertFalse(result['scientificallyValidated'])
        value['context']['stage']='evaluation'
        self.assertEqual(result['context']['stage'],'development')
        value['evidenceKind']='declared-reference-experiment'
        value['context']['referenceQuality']='externally-reviewed';value['context']['reviewEvidenceHash']='c'*64
        self.assertEqual(cli.experiment(value)['scientificReadiness'],'requires-external-scientific-review')
        self.assertFalse(cli.experiment(value)['fieldTruthEstablished'])
        value['outcomes']['records'][0]['label']=None
        incomplete=cli.experiment(value)
        self.assertEqual(incomplete['calculation']['pointEstimateStatus'],'withheld')
        self.assertTrue(all(x['areaM2'] is None for x in incomplete['calculation']['classes']))
        self.assertIn('Area estimates are withheld',incomplete['plainLanguage'])

    def test_invalid_unknown_offsets_cannot_change_lineage_order(self):
        for key in ('protocolFrozenAt','selectionFrozenAt','outcomesFrozenAt'):
            for offset in ('+00:60','+01:99','-00:60','+24:00','-00:00'):
                c=context();c[key]=c[key][:-1]+offset
                with self.subTest(key=key,offset=offset),self.assertRaises(ValueError):cli.validate_context(c)
        for offset in ('+00:60','-01:99','-00:00'):
            c=context();c['sourceEvidence'][0]['observedAt']='2026-01-01T00:00:00'+offset
            with self.assertRaises(ValueError):cli.validate_context(c)
        c=context();c['protocolFrozenAt']='2025-01-01T01:00:00+00:60';c['selectionFrozenAt']='2025-01-01T00:30:00Z'
        with self.assertRaises(ValueError):cli.validate_context(c)
        c['protocolFrozenAt']='2025-01-01T01:00:00+01:00';cli.validate_context(c)
