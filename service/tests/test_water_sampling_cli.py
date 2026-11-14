import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import mock_open, patch

from service.benchmarks import water_sampling as cli
from service.observatory.vintages import canonical_hash
from service.tests.test_water_sampling import density

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / 'examples/water-sampling-demo'


class WaterSamplingCliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.input, self.output = self.root / 'input.json', self.root / 'result.json'

    def tearDown(self):
        self.temp.cleanup()

    def envelope(self):
        return dict(schemaVersion=1, observations=density(), options=dict(months=[4], exclude=None))

    def invoke(self, raw=None, pin=None):
        raw = json.dumps(self.envelope()).encode() if raw is None else raw
        self.input.write_bytes(raw)
        pin = hashlib.sha256(raw).hexdigest() if pin is None else pin
        with contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()) as err:
            code = cli.main(['--input', str(self.input), '--input-pin', pin, '--output', str(self.output)])
        return code, out.getvalue(), err.getvalue(), pin

    def test_wrapper_hash_private_output(self):
        code, out, err, pin = self.invoke()
        self.assertEqual((code, err), (0, ''))
        result = json.loads(self.output.read_bytes())
        self.assertEqual(set(result), {'schemaVersion', 'kind', 'sourceFileSha256', 'summary', 'artifactHash'})
        self.assertEqual(result['sourceFileSha256'], pin)
        self.assertEqual(result['kind'], 'water-sampling-sensitivity')
        self.assertEqual(result['artifactHash'], canonical_hash({k: v for k, v in result.items() if k != 'artifactHash'}))
        self.assertEqual(result['summary']['views']['all']['pooledWaterFraction'], 1/13)
        self.assertEqual(result['summary']['views']['all']['equalYearWaterFraction'], .5)
        self.assertEqual(os.stat(self.output).st_mode & 0o777, 0o600)
        self.assertEqual(set(json.loads(out)), {'artifactHash', 'methodVersion', 'attempted', 'observable', 'water', 'dry', 'unknown'})

    def test_pin_precedes_parse_and_no_output(self):
        with patch.object(cli.json, 'loads', side_effect=AssertionError('Unpinned parse')):
            for pin in ('0'*64, 'BAD', 'F'*64, ''):
                code, out, _, _ = self.invoke(pin=pin)
                self.assertEqual((code, out), (2, ''))
                self.assertFalse(self.output.exists())

    def test_exact_envelope_strict_json_and_utf8(self):
        invalid = [b'{"schemaVersion":1,"observations":[],"options":{"months":null,"exclude":null,"months":null}}',
                   b'{"schemaVersion":1,"schemaVersion":1,"observations":[],"options":{"months":null,"exclude":null}}',
                   b'{"schemaVersion":1.0,"observations":[],"options":{"months":null,"exclude":null}}',
                   b'{"schemaVersion":1,"observations":[],"options":{"months":[4.0],"exclude":null}}',
                   b'{"schemaVersion":1,"observations":[],"options":{"months":[NaN],"exclude":null}}',
                   b'{"schemaVersion":1,"observations":[],"options":{"months":[Infinity],"exclude":null}}',
                   b'{"schemaVersion":1,"observations":[],"options":{"months":[1e999],"exclude":null}}',
                   b'\xff', b'[]']
        value = self.envelope()
        for change in (dict(schemaVersion=True), dict(observations={}), dict(options={}),
                       dict(options=dict(months=[True], exclude=None)), dict(extra='unaccepted')):
            invalid.append(json.dumps(dict(value, **change)).encode())
        invalid.append(json.dumps({k: v for k, v in value.items() if k != 'options'}).encode())
        for raw in invalid:
            with self.subTest(raw=raw):
                code, out, err, _ = self.invoke(raw)
                self.assertEqual((code, out), (2, ''))
                self.assertFalse(self.output.exists())
                self.assertNotIn(str(self.input), err)

    def test_existing_destination_symlink_and_directory_untouched(self):
        self.output.write_bytes(b'keep')
        self.assertEqual(self.invoke()[:2], (2, ''))
        self.assertEqual(self.output.read_bytes(), b'keep')
        self.output.unlink()
        target = self.root / 'target'
        target.write_bytes(b'target')
        self.output.symlink_to(target)
        self.assertEqual(self.invoke()[:2], (2, ''))
        self.assertEqual(target.read_bytes(), b'target')
        self.output.unlink()
        self.output.mkdir()
        self.assertEqual(self.invoke()[:2], (2, ''))
        self.assertTrue(self.output.is_dir())
        self.assertEqual(list(self.root.glob('.forecast-policy-*')), [])

    def test_input_limit_bounded_read_output_limit_cleanup(self):
        raw = json.dumps(self.envelope()).encode()
        opener = mock_open(read_data=raw)
        with patch('builtins.open', opener):
            self.assertEqual(cli.read_pinned('unused', hashlib.sha256(raw).hexdigest()), self.envelope())
        opener().read.assert_called_once_with(cli.MAX_FILE_BYTES+1)
        with patch.object(cli, 'MAX_FILE_BYTES', 8):
            self.assertEqual(self.invoke(b' '*9)[:2], (2, ''))
        self.assertFalse(self.output.exists())
        with patch('service.benchmarks.forecast_policy.MAX_FILE_BYTES', 128):
            self.assertEqual(self.invoke()[:2], (2, ''))
            self.assertFalse(self.output.exists())
        self.assertEqual(list(self.root.glob('.forecast-policy-*')), [])

    def test_full_synthetic_fixtures_independent_process_reproduction(self):
        metadata = json.loads((FIXTURES / 'metadata.json').read_bytes())
        self.assertIs(metadata['synthetic'], True)
        self.assertEqual(set(metadata['fixtures']), {'density', 'unknown', 'missing-year'})
        for name, pins in metadata['fixtures'].items():
            source, expected = FIXTURES / pins['input'], FIXTURES / pins['result']
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), pins['inputSha256'])
            self.assertEqual(hashlib.sha256(expected.read_bytes()).hexdigest(), pins['resultSha256'])
            self.assertEqual(json.loads(expected.read_bytes())['artifactHash'], pins['artifactHash'])
            results = []
            for index in range(2):
                output = self.root / f'{name}-{index}.json'
                proc = subprocess.run([sys.executable, '-B', '-m', 'service.benchmarks.water_sampling',
                    '--input', str(source), '--input-pin', pins['inputSha256'], '--output', str(output)],
                    cwd=ROOT, capture_output=True, text=True, timeout=20, check=False)
                self.assertEqual(proc.returncode, 0, proc.stderr)
                self.assertEqual(output.read_bytes(), expected.read_bytes())
                self.assertEqual(os.stat(output).st_mode & 0o777, 0o600)
                results.append(output.read_bytes())
            self.assertEqual(*results)
        proc = subprocess.run([sys.executable, '-B', str(FIXTURES / 'build.py')], cwd=ROOT,
                              capture_output=True, text=True, timeout=20, check=False)
        self.assertEqual(proc.returncode, 0, proc.stderr)


if __name__ == '__main__':
    unittest.main()
