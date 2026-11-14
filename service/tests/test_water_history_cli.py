import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import mock_open, patch

from service.benchmarks import water_history as cli
from service.observatory.vintages import canonical_hash


def rows():
    common = dict(siteId='site', supportId='support-v1', quantityId='water-presence-v1',
                 classificationMethodId='external-v1')
    return [
        dict(common, sourceId='a', evidenceIds=['ea'], acquisitionTime='2026-01-01T00:00:00Z',
             state='water', visibility='observable', visibilityReason='clear'),
        dict(common, sourceId='b', evidenceIds=['eb'], acquisitionTime='2026-01-02T00:00:00Z',
             state='unknown', visibility='observable', visibilityReason='ambiguous'),
        dict(common, sourceId='cloud', evidenceIds=['ec-cloud'], acquisitionTime='2026-01-03T00:00:00Z',
             state='unknown', visibility='unobservable', visibilityReason='cloud obscures support'),
        dict(common, sourceId='c', evidenceIds=['ec'], acquisitionTime='2026-01-04T00:00:00Z',
             state='dry', visibility='observable', visibilityReason='clear'),
    ]


class WaterHistoryCliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.input = self.root / 'input.json'
        self.output = self.root / 'artifact.json'

    def tearDown(self):
        self.temp.cleanup()

    def raw(self, value):
        return json.dumps(value, separators=(',', ':')).encode()

    def invoke(self, raw=None, output=None):
        raw = self.raw(dict(schemaVersion=1, observations=rows())) if raw is None else raw
        self.input.write_bytes(raw)
        pin = hashlib.sha256(raw).hexdigest()
        out = []
        err = []
        with patch('sys.stdout', new_callable=__import__('io').StringIO) as stdout, \
             patch('sys.stderr', new_callable=__import__('io').StringIO) as stderr:
            code = cli.main(['--input', str(self.input), '--input-pin', pin,
                             '--output', str(output or self.output)])
            out.append(stdout.getvalue())
            err.append(stderr.getvalue())
        return code, ''.join(out), ''.join(err), pin

    def test_artifact_counts_hash_and_private_file(self):
        code, stdout, stderr, pin = self.invoke()
        self.assertEqual((code, stderr), (0, ''))
        result = json.loads(self.output.read_text())
        self.assertEqual(result['sourceFileSha256'], pin)
        self.assertEqual(result['summary']['counts'], dict(attempted=4, observable=3, water=1, dry=1, unknown=2))
        self.assertEqual(result['summary']['intervalCensoredTransitions'][0]['direction'], 'water-to-dry')
        self.assertEqual(len(result['summary']['intervalCensoredTransitions'][0]['interveningUnknownObservations']), 2)
        self.assertEqual(result['summary']['waterFractionAmongObservableAcquisitions'], 1 / 3)
        self.assertEqual(result['artifactHash'], canonical_hash({k: v for k, v in result.items() if k != 'artifactHash'}))
        self.assertEqual(os.stat(self.output).st_mode & 0o777, 0o600)
        self.assertEqual(set(json.loads(stdout)), {'artifactHash', 'methodVersion', 'attempted', 'observable', 'water', 'dry', 'unknown'})

    def test_observable_unknown_zero_is_not_dry(self):
        obs = rows()[1:2]
        envelope = self.raw(dict(schemaVersion=1, observations=obs))
        code, _, _, _ = self.invoke(envelope)
        self.assertEqual(code, 0)
        result = json.loads(self.output.read_text())['summary']
        self.assertEqual(result['waterFractionAmongObservableAcquisitions'], 0)
        self.assertEqual(result['counts']['dry'], 0)

    def test_bad_pin_precedes_summarizer_and_writes_nothing(self):
        raw = self.raw(dict(schemaVersion=1, observations=rows()))
        self.input.write_bytes(raw)
        with patch.object(cli, 'MAX_FILE_BYTES', 20 * 1024**2), \
             patch.object(cli.json, 'loads', side_effect=AssertionError('Unpinned input reached parser')), \
             patch('service.observatory.water_history.summarize_water_history', side_effect=AssertionError):
            with patch('sys.stderr', new_callable=__import__('io').StringIO):
                code = cli.main(['--input', str(self.input), '--input-pin', '0' * 64, '--output', str(self.output)])
        self.assertEqual(code, 2)
        self.assertFalse(self.output.exists())

    def test_envelope_and_strict_json_rejections(self):
        invalid = [b'{"schemaVersion":true,"observations":[]}',
                   b'{"schemaVersion":1,"observations":[],"extra":0}',
                   b'{"schemaVersion":1,"observations":{}}',
                   b'{"schemaVersion":1,"schemaVersion":1,"observations":[]}',
                   b'{"schemaVersion":1,"observations":[],"x":NaN}',
                   b'{"schemaVersion":1.0,"observations":[]}']
        for raw in invalid:
            with self.subTest(raw=raw):
                code, out, _, _ = self.invoke(raw)
                self.assertEqual(code, 2)
                self.assertEqual(out, '')
                self.assertFalse(self.output.exists())

    def test_summary_rejects_identity_and_order(self):
        bad_identity = rows()
        bad_identity[1]['supportId'] = 'other'
        bad_order = rows()
        bad_order[1]['acquisitionTime'] = '2025-01-01T00:00:00Z'
        for observations in (bad_identity, bad_order):
            raw = self.raw(dict(schemaVersion=1, observations=observations))
            code, out, _, _ = self.invoke(raw)
            self.assertEqual((code, out), (2, ''))
            self.assertFalse(self.output.exists())

    def test_existing_destination_and_symlink_are_preserved(self):
        self.output.write_bytes(b'keep')
        code, out, _, _ = self.invoke()
        self.assertEqual((code, out), (2, ''))
        self.assertEqual(self.output.read_bytes(), b'keep')
        self.output.unlink()
        target = self.root / 'target'
        target.write_bytes(b'target')
        self.output.symlink_to(target)
        code, out, _, _ = self.invoke()
        self.assertEqual((code, out), (2, ''))
        self.assertEqual(target.read_bytes(), b'target')
        self.assertEqual(list(self.root.glob('.forecast-policy-*')), [])

    def test_bounded_single_read(self):
        raw = self.raw(dict(schemaVersion=1, observations=rows()))
        opener = mock_open(read_data=raw)
        with patch('builtins.open', opener):
            self.assertEqual(cli.read_pinned('not-a-real-file', hashlib.sha256(raw).hexdigest()), rows())
        opener().read.assert_called_once_with(cli.MAX_FILE_BYTES + 1)
        with patch.object(cli, 'MAX_FILE_BYTES', 8):
            code, out, _, _ = self.invoke(b' ' * 9)
        self.assertEqual((code, out), (2, ''))
        self.assertFalse(self.output.exists())

    def test_output_cap_publishes_nothing_and_preserves_existing_destination(self):
        # Input remains admissible; the shared writer's smaller cap rejects the
        # complete result before creating or replacing any output file.
        with patch('service.benchmarks.forecast_policy.MAX_FILE_BYTES', 128):
            code, stdout, _, _ = self.invoke()
            self.assertEqual((code, stdout), (2, ''))
            self.assertFalse(self.output.exists())
            self.output.write_bytes(b'keep this result')
            code, stdout, _, _ = self.invoke()
            self.assertEqual((code, stdout), (2, ''))
            self.assertEqual(self.output.read_bytes(), b'keep this result')
            self.assertEqual(list(self.root.glob('.forecast-policy-*')), [])

    def test_subprocess_smoke(self):
        raw = self.raw(dict(schemaVersion=1, observations=rows()))
        self.input.write_bytes(raw)
        proc = subprocess.run([sys.executable, '-m', 'service.benchmarks.water_history',
                               '--input', str(self.input), '--input-pin', hashlib.sha256(raw).hexdigest(),
                               '--output', str(self.output)], capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue(self.output.exists())


if __name__ == '__main__':
    unittest.main()
