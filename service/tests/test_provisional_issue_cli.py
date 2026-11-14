"""CLI I/O contracts for the offline provisional experiment."""
import contextlib
import copy
from datetime import date, timedelta
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from service.benchmarks.forecast_policy import write_new
from service.benchmarks.provisional_issue import main
from service.observatory import forecast_policy as fp
from service.observatory.vintages import canonical_hash
from service.tests import test_forecast_policy
from service.tests.test_vintages import record


class ProvisionalIssueCliTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture = test_forecast_policy.PolicyTests()
        fixture.setUp()
        try:
            cls.policy, _ = fixture.freeze()
        finally:
            fixture.doCleanups()

    def setUp(self):
        self.fixture = test_forecast_policy.PolicyTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)

    def write(self, root, name, value):
        path = Path(root) / name
        path.write_text(json.dumps(value))
        return path

    def run_cli(self, args):
        with contextlib.redirect_stdout(io.StringIO()) as stdout, \
             contextlib.redirect_stderr(io.StringIO()) as stderr:
            result = main(args)
        return result, stdout.getvalue(), stderr.getvalue()

    def saved_case(self, root):
        source = Path(__file__).resolve().parents[2] / 'examples/gauge-vintage-receipt/capture.json'
        original = json.loads(source.read_text())[0]['snapshot']
        self.assertEqual(original['snapshotHash'],
                         'af5a11a94aec157726724c311fef561393b40df0076dfa8933cc6bad2a6202b6')
        policy = fp.freeze_policy(original, expected_snapshot_hash=original['snapshotHash'],
                                  freeze_time=original['issueTime'])
        self.assertEqual(policy['status'], 'withheld')
        snapshot = copy.deepcopy(original)
        # An offline analytic cutoff, not a new source retrieval/availability claim.
        cutoff = fp._dt(original['issueTime']) + timedelta(seconds=1)
        snapshot['issueTime'] = cutoff.isoformat(timespec='microseconds').replace('+00:00', 'Z')
        snapshot['snapshotHash'] = canonical_hash({k: v for k, v in snapshot.items() if k != 'snapshotHash'})
        policy_path = self.write(root, 'policy.json', policy)
        snap_path = self.write(root, 'snapshot.json', snapshot)
        args = ['compute', '--policy', str(policy_path), '--policy-pin', policy['policyHash'],
                '--snapshot', str(snap_path), '--snapshot-pin', snapshot['snapshotHash'],
                '--at', snapshot['issueTime'], '--output', str(Path(root) / 'experiment.json')]
        return args, original, snapshot

    def test_insufficient_history_and_real_capture_bad_pin_publish_nothing(self):
        with tempfile.TemporaryDirectory() as root:
            args, original, snapshot = self.saved_case(root)
            output = Path(args[-1])
            result, stdout, stderr = self.run_cli(args)
            self.assertEqual(result, 0, stderr)
            artifact = json.loads(output.read_text())
            self.assertTrue(artifact['attempts'])
            self.assertTrue(all(a['status'] == 'withheld' for a in artifact['attempts']))
            self.assertEqual(json.loads(stdout)['artifactHash'], artifact['experimentHash'])
            self.assertFalse(json.loads(stdout)['operationalPublication'])
            self.assertIn('EXPERIMENTAL', json.loads(stdout)['label'])
            self.assertEqual(artifact['sourceSnapshot']['observations'], original['observations'])
            self.assertEqual(artifact['snapshotHash'], snapshot['snapshotHash'])
            self.assertEqual(os.stat(output).st_mode & 0o777, 0o600)
            bad_output = Path(root) / 'bad.json'
            args[args.index('--snapshot-pin') + 1] = '0' * 64
            args[-1] = str(bad_output)
            result, _, stderr = self.run_cli(args)
            self.assertEqual(result, 2)
            self.assertFalse(bad_output.exists())
            self.assertNotIn(str(root), stderr)

    def test_ready_fixture_compute_then_score_without_fit_or_calibration(self):
        f = self.fixture
        f.capture(f.history(), '2025-12-30T12:00:00Z')
        issue_at = '2026-01-04T12:00:00Z'
        f.capture([record((date(2025, 12, 30)+timedelta(days=i)).isoformat(),
                          3920+2*i, 'Provisional') for i in range(5)], issue_at)
        issue_snapshot = f.snapshot(issue_at, '2022-01-05', '2026-01-03')
        f.capture([
            record('2026-01-06', 3940, 'Approved'),
            record('2026-01-10', 3950, 'approved')],
            '2026-01-11T12:00:00Z')
        truth = f.snapshot('2026-01-11T12:00:00Z', '2026-01-04', '2026-01-10')
        with tempfile.TemporaryDirectory() as root:
            policy = self.write(root, 'policy.json', self.policy)
            issue = self.write(root, 'issue.json', issue_snapshot)
            later = self.write(root, 'truth.json', truth)
            experiment_path = Path(root) / 'experiment.json'
            compute = ['compute', '--policy', str(policy), '--policy-pin', self.policy['policyHash'],
                       '--snapshot', str(issue), '--snapshot-pin', issue_snapshot['snapshotHash'],
                       '--at', issue_at, '--output', str(experiment_path)]
            with patch.object(fp.forecasts, 'evaluate_gauge', side_effect=AssertionError('fit')), \
                 patch.object(fp.forecasts, '_evaluate_gauge', side_effect=AssertionError('fit')), \
                 patch.object(fp.forecasts, 'calibration_radius', side_effect=AssertionError('calibration')):
                result, _, stderr = self.run_cli(compute)
                self.assertEqual(result, 0, stderr)
                experiment = json.loads(experiment_path.read_text())
                self.assertEqual(experiment['counts']['computed'], 6)
                score_path = Path(root) / 'score.json'
                score = ['score', '--policy', str(policy), '--policy-pin', self.policy['policyHash'],
                         '--experiment', str(experiment_path), '--experiment-pin', experiment['experimentHash'],
                         '--snapshot', str(later), '--snapshot-pin', truth['snapshotHash'],
                         '--at', '2026-01-11T12:00:00Z', '--output', str(score_path)]
                result, stdout, stderr = self.run_cli(score)
                self.assertEqual(result, 0, stderr)
            scored = json.loads(score_path.read_text())
            self.assertEqual(json.loads(stdout)['artifactHash'], scored['scoreHash'])
            self.assertEqual(scored['counts']['scoreableComputed'], 6)
            self.assertFalse(json.loads(stdout)['operationalPublication'])
            self.assertEqual(os.stat(score_path).st_mode & 0o777, 0o600)
            before = experiment_path.read_bytes()
            score[score.index('--experiment-pin') + 1] = '0' * 64
            score[-1] = str(Path(root) / 'bad-experiment-pin.json')
            result, _, stderr = self.run_cli(score)
            self.assertEqual(result, 2)
            self.assertFalse(Path(score[-1]).exists())
            self.assertEqual(experiment_path.read_bytes(), before)
            self.assertNotIn(str(root), stderr)

    def test_score_requires_independent_experiment_pin_and_sanitizes_bad_json(self):
        with tempfile.TemporaryDirectory() as root:
            empty = self.write(root, 'empty.json', {})
            output = Path(root) / 'out.json'
            base = ['score', '--policy', str(empty), '--policy-pin', '0'*64,
                    '--experiment', str(empty), '--experiment-pin', '', '--snapshot', str(empty),
                    '--snapshot-pin', '0'*64, '--at', '2026-01-01T00:00:00Z', '--output', str(output)]
            result, _, stderr = self.run_cli(base)
            self.assertEqual(result, 2)
            self.assertFalse(output.exists())
            self.assertNotIn(str(empty), stderr)
            malformed = Path(root) / 'malformed.json'
            for raw in (b'{"x":1,"x":2}', b'{"x":1e400}'):
                malformed.write_bytes(raw)
                args = ['compute', '--policy', str(malformed), '--policy-pin', 'x', '--snapshot', str(empty),
                        '--snapshot-pin', 'x', '--at', 'x', '--output', str(output)]
                result, _, stderr = self.run_cli(args)
                self.assertEqual(result, 2)
                self.assertFalse(output.exists())
                self.assertNotIn(str(malformed), stderr)
                self.assertNotIn(raw.decode(), stderr)

    def test_existing_destination_is_preserved(self):
        with tempfile.TemporaryDirectory() as root:
            dest = Path(root) / 'existing.json'
            dest.write_text('keep')
            args, _, _ = self.saved_case(root)
            args[-1] = str(dest)
            with patch('service.benchmarks.provisional_issue.write_new', wraps=write_new) as writer:
                result, _, _ = self.run_cli(args)
                writer.assert_called_once()
            self.assertEqual(result, 2)
            self.assertEqual(dest.read_text(), 'keep')

    def test_valid_computation_does_not_replace_existing_symlink(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / 'target'; target.write_text('preserved')
            link = Path(root) / 'link'; link.symlink_to(target)
            args, _, _ = self.saved_case(root)
            args[-1] = str(link)
            result, _, _ = self.run_cli(args)
            self.assertEqual(result, 2)
            self.assertTrue(link.is_symlink())
            self.assertEqual(target.read_text(), 'preserved')


if __name__ == '__main__':
    unittest.main()
