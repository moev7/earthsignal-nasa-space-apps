"""Offline IPC regressions for complete receipts, not scientific validation."""
import copy
import hashlib
import json
import os
import resource
import runpy
import subprocess
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from service.assessment_validation import validate_assessment_manifest
from service.config import Config
from service.observatory.vintage_reference import ARTIFACT, load_reference
from service.store import Store
from service.tests.test_observatory_providers import QueueBudget, daily, request, station
from service.worker import Worker


_REPO = Path(__file__).resolve().parents[2]
_LAUNCHER = (
    'from service.tests.test_receipt_processing import _processing_child; '
    '_processing_child()'
)
_SAFE_ERROR = {
    'code': 'processing_failed',
    'message': 'Processing could not produce a verified compatible crop',
}


def _processing_child():
    """Inject provider fixtures before executing the real module's __main__."""
    request_path, stage, mutation, days = sys.argv[1:]
    stage = Path(stage)
    site = station()
    site['properties'].update(
        country_code='US', time_zone_abbreviation='PST', uses_daylight_savings='Y',
    )
    start = date(2025, 6, 1)
    records = [
        daily((start + timedelta(days=i)).isoformat(), str(100 + i),
              approval_status='Approved', qualifier=['ESTIMATED'] if i == 1 else None)
        for i in range(int(days))
    ]
    queue = QueueBudget(site, dict(features=records, links=[]))
    from service.observatory import engine
    actual_assessment = engine.run_assessment

    def assessment_then_damage(*args, **kwargs):
        # Damage only AFTER the real engine's own validation/writes. This models
        # a stage changed before the IPC entrypoint's independent final check.
        manifest = actual_assessment(*args, **kwargs)
        artifact = stage / ARTIFACT
        if mutation == 'missing':
            artifact.unlink()
        elif mutation == 'corrupt':
            raw = artifact.read_bytes()
            artifact.write_bytes(b'!' + raw[1:])  # Same size, wrong hash/content.
        elif mutation == 'symlink':
            artifact.unlink()
            artifact.symlink_to(stage / 'manifest.json')
        elif mutation == 'oversized':
            size = Config.environment().artifact_bytes + 1
            raw = artifact.read_bytes()
            raw += b' ' * (size - len(raw))
            artifact.write_bytes(raw)
            manifest['gaugeVintage']['artifact'].update(
                bytes=size, sha256=hashlib.sha256(raw).hexdigest(),
            )
        return manifest

    sys.argv = ['service.run_job', request_path, str(stage)]
    with patch('service.observatory.net.Budget.fetch', side_effect=queue.fetch), \
            patch('socket.create_connection', side_effect=AssertionError('Network forbidden')), \
            patch.object(engine, 'run_assessment', side_effect=assessment_then_damage):
        # No resource mock: main applies its actual RLIMIT_FSIZE in this child.
        runpy.run_module('service.run_job', run_name='__main__')


class ReceiptProcessingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir="/var/tmp")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = Config(self.root, b'synthetic-fixture-secret-32-bytes!!',
                             reserve_bytes=0, gauge_vintages_enabled=True)
        self.store = Store(self.config)
        self.parent_limit = resource.getrlimit(resource.RLIMIT_FSIZE)
        self.addCleanup(lambda: self.assertEqual(
            resource.getrlimit(resource.RLIMIT_FSIZE), self.parent_limit,
        ))

    def process(self, mutation='none', *, days=90, oversized_request=False):
        self.request = request(end=(date(2025, 6, 1) + timedelta(days=days - 1)).isoformat())
        self.request['options']['sourceIds'] = ['usgs-daily']
        self.job = self.store.submit('owner', self.request, 'processing-fixture',
                                     'observatory-contract-v1', kind='assessment')
        self.row = self.store.claim()
        self.stage = self.root / 'staging' / self.row['id']
        self.stage.mkdir()
        request_path = self.stage / 'request.json'
        envelope = dict(kind='assessment', request=self.request, owner='owner')
        raw = json.dumps(envelope).encode()
        if oversized_request:
            # Valid JSON with padding: only the entrypoint's byte admission fails.
            raw += b' ' * (self.config.artifact_bytes + 1 - len(raw))
        request_path.write_bytes(raw)
        # Inherit no production EARTHSIGNAL variables or credential paths.
        environment = {
            'PATH': os.defpath,
            'PYTHONPATH': str(_REPO),
            'EARTHSIGNAL_DATA_DIR': str(self.root),
            'EARTHSIGNAL_GATEWAY_SECRET': self.config.secret.decode(),
            'EARTHSIGNAL_NETRC': str(self.root / 'nonexistent-fixture.netrc'),
            'EARTHSIGNAL_GAUGE_VINTAGES_ENABLED': 'true',
            'EARTHSIGNAL_ASSESSMENT_DOMAINS': 'water',
        }
        result = subprocess.run(
            [sys.executable, '-c', _LAUNCHER, str(request_path), str(self.stage),
             mutation, str(days)], cwd=_REPO, env=environment,
            capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(resource.getrlimit(resource.RLIMIT_FSIZE), self.parent_limit)
        return result

    def assert_published(self, manifest):
        # Publication checks every real JSON/CSV sidecar, reference, file bounds
        # and committed Store state; no mocked completion/publication shortcut.
        for name in manifest['artifacts']:
            artifact = self.stage / name
            self.assertTrue(artifact.is_file(), name)
            self.assertFalse(artifact.is_symlink(), name)
            self.assertLessEqual(artifact.stat().st_size, self.config.artifact_bytes, name)
        self.assertEqual(json.loads((self.stage / 'evidence.json').read_text()), manifest['evidence'])
        self.assertEqual(json.loads((self.stage / 'brief.json').read_text()), manifest['brief'])
        self.assertEqual(json.loads((self.stage / 'area.geojson').read_text()), manifest['area'])
        self.assertTrue(Worker(self.store).publish(self.row, self.stage))
        saved = self.store.get('owner', self.job['id'], 'assessment')
        self.assertEqual(saved['status'], 'completed')
        output = self.root / 'results' / self.job['id']
        self.assertEqual(json.loads((output / 'manifest.json').read_text()), manifest)
        self.assertFalse((output / 'request.json').exists())
        self.assertFalse((output / 'error.json').exists())
        self.assertFalse(self.stage.exists())
        return output

    def assert_failed(self, result):
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr, '')
        error = json.loads((self.stage / 'error.json').read_text())
        self.assertEqual(error, _SAFE_ERROR)
        self.assertNotIn(str(self.root), json.dumps(error))
        self.assertFalse((self.root / 'results' / self.job['id']).exists())
        self.assertEqual(self.store.get('owner', self.job['id'], 'assessment')['status'], 'running')
        with self.assertRaises(ValueError):
            Worker(self.store).publish(self.row, self.stage)
        self.assertEqual(self.store.get('owner', self.job['id'], 'assessment')['status'], 'running')
        self.assertFalse((self.root / 'results' / self.job['id']).exists())

    def test_long_receipt_survives_real_ipc_validation_and_publication(self):
        result = self.process()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.stage / 'error.json').exists())
        manifest = json.loads((self.stage / 'manifest.json').read_text())
        vintage = manifest['gaugeVintage']
        self.assertEqual(vintage['status'], 'referenced')
        self.assertEqual(vintage['snapshotRef']['observationCount'], 90)
        self.assertEqual(vintage['snapshotRef']['qualifiedRecords'], 1)
        self.assertEqual(vintage['snapshotRef']['withdrawnRecords'], 0)
        self.assertIn(ARTIFACT, manifest['artifacts'])
        self.assertLess((self.stage / 'manifest.json').stat().st_size, 256 * 1024)
        snapshot = load_reference(self.stage, vintage, max_bytes=self.config.artifact_bytes)
        self.assertEqual([r['value'] for r in snapshot['observations']], list(range(100, 190)))
        self.assertTrue(all(r['quality'] == 'Approved' for r in snapshot['observations']))
        self.assertEqual(snapshot['observations'][1]['qualifiers'], ['ESTIMATED'])
        self.assertIn('ESTIMATED', manifest['series'][0]['points'][1]['quality'])
        before = copy.deepcopy(manifest)
        validate_assessment_manifest(manifest, self.request, referenced_snapshot=snapshot)
        self.assertEqual(manifest, before)
        # This is the exact missing argument in the pre-fix IPC boundary.
        with self.assertRaises(ValueError):
            validate_assessment_manifest(manifest, self.request)
        raw = (self.stage / ARTIFACT).read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), vintage['artifact']['sha256'])
        output = self.assert_published(manifest)
        self.assertEqual((output / ARTIFACT).read_bytes(), raw)

    def test_missing_reference_fails_sanitized_at_ipc_boundary(self):
        self.assert_failed(self.process('missing'))
        self.assertFalse((self.stage / ARTIFACT).exists())

    def test_same_size_corrupt_reference_fails_sanitized_at_ipc_boundary(self):
        self.assert_failed(self.process('corrupt'))
        manifest = json.loads((self.stage / 'manifest.json').read_text())
        self.assertEqual((self.stage / ARTIFACT).stat().st_size,
                         manifest['gaugeVintage']['artifact']['bytes'])

    def test_symlink_reference_fails_sanitized_at_ipc_boundary(self):
        self.assert_failed(self.process('symlink'))
        self.assertTrue((self.stage / ARTIFACT).is_symlink())

    def test_reference_above_unchanged_export_cap_fails_sanitized(self):
        self.assert_failed(self.process('oversized'))
        self.assertEqual(self.config.artifact_bytes, 8 * 1024**2)
        self.assertEqual((self.stage / ARTIFACT).stat().st_size, self.config.artifact_bytes + 1)

    def test_small_captured_receipt_keeps_legacy_ipc_and_publication_behavior(self):
        result = self.process(days=3)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.stage / 'error.json').exists())
        manifest = json.loads((self.stage / 'manifest.json').read_text())
        self.assertEqual(manifest['gaugeVintage']['status'], 'captured')
        self.assertNotIn(ARTIFACT, manifest['artifacts'])
        self.assertFalse((self.stage / ARTIFACT).exists())
        snapshot = manifest['gaugeVintage']['snapshot']
        self.assertEqual([r['value'] for r in snapshot['observations']], [100, 101, 102])
        self.assertEqual(snapshot['observations'][1]['qualifiers'], ['ESTIMATED'])
        validate_assessment_manifest(manifest, self.request)
        self.assert_published(manifest)

    def test_oversized_valid_json_request_is_rejected_before_processing(self):
        self.assert_failed(self.process(oversized_request=True))
        self.assertFalse((self.stage / 'manifest.json').exists())
        self.assertFalse((self.stage / ARTIFACT).exists())
        self.assertFalse((self.root / 'gauge-vintages.sqlite3').exists())


if __name__ == '__main__':
    unittest.main()
