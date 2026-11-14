"""Offline input/output guarantees, not a forecast accuracy study."""
import json
import contextlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from service.benchmarks.forecast_policy import main, read_object, write_new


class ForecastPolicyCliTests(unittest.TestCase):
    def test_real_receipt_freeze_withholds_and_bad_pin_creates_no_artifact(self):
        fixture = Path(__file__).resolve().parents[2] / 'examples/gauge-vintage-receipt/capture.json'
        snapshot = json.loads(fixture.read_text())[0]['snapshot']
        pin = 'af5a11a94aec157726724c311fef561393b40df0076dfa8933cc6bad2a6202b6'
        self.assertEqual(snapshot['snapshotHash'], pin)
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'snapshot.json'
            source.write_text(json.dumps(snapshot))
            destination = Path(root) / 'policy.json'
            args = ['freeze', '--snapshot', str(source), '--snapshot-pin', pin,
                    '--at', snapshot['issueTime'], '--output', str(destination)]
            with contextlib.redirect_stdout(io.StringIO()) as stdout:
                self.assertEqual(main(args), 0)
            policy = json.loads(destination.read_text())
            self.assertEqual(policy['status'], 'withheld')
            self.assertEqual(policy['development'], [])
            self.assertEqual(json.loads(stdout.getvalue())['artifactHash'], policy['policyHash'])
            args[4] = '0' * 64
            args[-1] = str(Path(root) / 'invalid.json')
            with contextlib.redirect_stderr(io.StringIO()) as stderr:
                self.assertEqual(main(args), 2)
            self.assertFalse(Path(args[-1]).exists())
            self.assertNotIn(str(source), stderr.getvalue())

    def test_duplicate_nonfinite_nonobject_and_oversize_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'input.json'
            for raw in (b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":Infinity}', b'[]',
                        b'{"a":1e400}', b'{"a":-1e400}', b'{"a":[{"b":1e400}]}'):
                path.write_bytes(raw)
                with self.assertRaises(ValueError):
                    read_object(path)
            path.write_bytes(b'{"a":"123456789"}')
            with patch('service.benchmarks.forecast_policy.MAX_FILE_BYTES', 8):
                with self.assertRaises(ValueError):
                    read_object(path)
            path.write_text('{"a":1}')
            self.assertEqual(read_object(path), {'a': 1})

    def test_complete_private_output_and_existing_file_preserved(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'artifact.json'
            write_new(path, {'a': 1})
            original = path.read_bytes()
            self.assertEqual(json.loads(original), {'a': 1})
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                write_new(path, {'a': 2})
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual([p.name for p in Path(root).iterdir()], ['artifact.json'])

    def test_existing_symlink_not_followed_and_failed_write_not_published(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            target = base / 'target'; target.write_text('preserved')
            link = base / 'link'; link.symlink_to(target)
            with self.assertRaises(FileExistsError):
                write_new(link, {'a': 1})
            self.assertTrue(link.is_symlink())
            self.assertEqual(target.read_text(), 'preserved')
            fresh = base / 'new'
            with patch('service.benchmarks.forecast_policy.os.fsync', side_effect=OSError()):
                with self.assertRaises(OSError):
                    write_new(fresh, {'a': 1})
            self.assertFalse(fresh.exists())
            self.assertEqual(sorted(p.name for p in base.iterdir()), ['link', 'target'])


if __name__ == '__main__':
    unittest.main()
