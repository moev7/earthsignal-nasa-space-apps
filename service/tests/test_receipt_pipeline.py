"""Synthetic long-history storage/ownership checks, not field forecast validation."""
import copy
import hashlib
import json
import tempfile
import unittest
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from service.api import API
from service.assessment_validation import validate_assessment_manifest
from service.observatory.engine import run_assessment
from service.observatory.vintage_reference import ARTIFACT, load_reference
from service.store import Store
from service.worker import Worker
from service.tests import test_assessment_service as service_tests
from service.tests.test_observatory_providers import QueueBudget, daily, request, station


class ReceiptPipelineTests(unittest.TestCase):
    setUp = service_tests.AssessmentServiceTests.setUp
    tearDown = service_tests.AssessmentServiceTests.tearDown
    signed = service_tests.AssessmentServiceTests.signed
    call = service_tests.AssessmentServiceTests.call
    problem = service_tests.AssessmentServiceTests.problem

    def build(self, *, artifact_bytes=None, null=False, metadata=True):
        options = dict(gauge_vintages_enabled=True)
        if artifact_bytes is not None:
            options['artifact_bytes'] = artifact_bytes
        self.config = replace(self.config, **options)
        self.store = Store(self.config, lambda: self.now)
        self.api = API(self.store)
        r = request(end='2025-08-29')
        r['options']['sourceIds'] = ['usgs-daily']
        job = self.store.submit('owner', r, 'long-history', 'observatory-contract-v1', kind='assessment')
        row = self.store.claim()
        site = station()
        if metadata:
            site['properties'].update(country_code='US', time_zone_abbreviation='PST', uses_daylight_savings='Y')
        start = date(2025, 6, 1)
        records = [daily((start+timedelta(days=i)).isoformat(), 'invalid' if null and i == 0 else str(100+i),
                         approval_status='Approved', qualifier=['ESTIMATED'] if i == 1 else None) for i in range(90)]
        queue = QueueBudget(site, dict(features=records, links=[]))
        stage = self.config.root/'staging'/row['id']
        with patch('service.observatory.net.Budget.fetch', side_effect=queue.fetch):
            manifest = run_assessment(r, self.config, stage, owner='owner')
        return job, row, r, manifest, stage

    def test_complete_history_publishes_protected_file_with_unchanged_records(self):
        job, row, request, manifest, stage = self.build(null=True)
        vintage = manifest['gaugeVintage']
        self.assertEqual(vintage['status'], 'referenced')
        self.assertEqual(vintage['snapshotRef']['observationCount'], 90)
        self.assertEqual(vintage['snapshotRef']['qualifiedRecords'], 1)
        self.assertEqual(vintage['snapshotRef']['withdrawnRecords'], 1)
        self.assertEqual(len(manifest['series'][0]['points']), 90)
        self.assertIn('ESTIMATED', manifest['series'][0]['points'][1]['quality'])
        self.assertLess(len(json.dumps(manifest).encode()), 256*1024)
        snapshot = load_reference(stage, vintage, max_bytes=self.config.artifact_bytes)
        self.assertEqual(snapshot['observations'][1]['qualifiers'], ['ESTIMATED'])
        before = copy.deepcopy(manifest)
        validate_assessment_manifest(manifest, request, referenced_snapshot=snapshot)
        self.assertEqual(before, manifest)
        with self.assertRaises(ValueError):
            validate_assessment_manifest(manifest, request)
        self.assertTrue(Worker(self.store).publish(row, stage))
        path = f"/api/assessments/{job['id']}/artifacts/{ARTIFACT}"
        status, _, file = self.call('GET', path)
        self.assertEqual(status, 200)
        self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(), vintage['artifact']['sha256'])
        self.problem('not_found', lambda: self.call('GET', path, owner='other'))
        self.problem('not_found', lambda: self.call('GET', f"/api/change-jobs/{job['id']}/artifacts/{ARTIFACT}"))
        saved = self.store.snapshot('owner', job['id'])
        self.assertEqual(saved['manifest'], manifest)
        self.now += self.config.expiry_seconds+1
        self.store.cleanup()
        self.problem('not_found', lambda: self.call('GET', path))
        preserved = self.store.snapshots('owner', saved['id'])
        self.assertEqual(preserved['manifest'], before)
        validate_assessment_manifest(preserved['manifest'], request, allow_archived=True)
        self.problem('not_found', lambda: self.store.snapshots('other', saved['id']))
        self.assertFalse((self.config.root/'results'/job['id']).exists())

    def test_bad_file_or_metadata_never_completes_or_publishes(self):
        job, row, request, manifest, stage = self.build()
        raw = (stage/ARTIFACT).read_bytes()
        for mutation in ('missing', 'corrupt', 'noncanonical', 'symlink', 'count', 'timing'):
            with self.subTest(mutation=mutation):
                file = stage/ARTIFACT
                file.unlink(missing_ok=True)
                file.write_bytes(raw)
                bad = copy.deepcopy(manifest)
                if mutation == 'missing': file.unlink()
                if mutation == 'corrupt': file.write_bytes(raw[:-1]+b' ')
                if mutation == 'noncanonical':
                    alternate = json.dumps(json.loads(raw), indent=2).encode()
                    file.write_bytes(alternate)
                    bad['gaugeVintage']['artifact'].update(bytes=len(alternate), sha256=hashlib.sha256(alternate).hexdigest())
                if mutation == 'symlink':
                    file.unlink(); file.symlink_to(stage/'manifest.json')
                if mutation == 'count': bad['gaugeVintage']['snapshotRef']['qualifiedRecords']=0
                if mutation == 'timing': bad['forecastInformation']['timingAttempts'][0]['timingEligible']=True
                (stage/'manifest.json').write_text(json.dumps(bad))
                with self.assertRaises(ValueError): Worker(self.store).publish(row, stage)
                self.assertEqual(self.store.get('owner', job['id'], 'assessment')['status'], 'running')
                self.assertFalse((self.config.root/'results'/job['id']).exists())
                self.problem('not_found', lambda: self.call('GET', f"/api/assessments/{job['id']}/artifacts/{ARTIFACT}"))

    def test_archive_is_structural_and_rejects_bad_population_and_timing(self):
        _, _, request, manifest, stage = self.build()
        (stage/ARTIFACT).unlink()
        validate_assessment_manifest(manifest, request, allow_archived=True)
        mutations = [lambda r:r['forecastInformation']['counts'].update(retainedRecords=True),
                     lambda r:r['forecastInformation']['counts'].update(retainedRecords=89),
                     lambda r:r['forecastInformation']['timingAttempts'][0].update(timingEligible=True),
                     lambda r:r['forecastInformation']['timingAttempts'][0].update(leadEndHours=123),
                     lambda r:r['forecastInformation']['stationTime'].update(stationPropertiesHash='a'*64),
                     lambda r:r['forecastInformation'].update(extra='unsupported'),
                     lambda r:r.update(methodVersion='observatory-1.5.0')]
        for mutate in mutations:
            bad=copy.deepcopy(manifest);mutate(bad)
            with self.assertRaises(ValueError): validate_assessment_manifest(bad, request, allow_archived=True)
        # A well-shaped report hash alone cannot replay the missing ledger.
        shaped=copy.deepcopy(manifest);shaped['forecastInformation']['informationHash']='b'*64
        validate_assessment_manifest(shaped, request, allow_archived=True)
        with self.assertRaises(ValueError): validate_assessment_manifest(shaped, request)

    def test_unknown_station_time_archived_summary_stays_withheld(self):
        _, _, request, manifest, _ = self.build(metadata=False)
        self.assertEqual(manifest['forecastInformation']['status'], 'withheld')
        validate_assessment_manifest(manifest, request, allow_archived=True)

    def test_existing_artifact_cap_rejects_long_receipt_without_budget_raise(self):
        with self.assertRaises(ValueError): self.build(artifact_bytes=64*1024)
        self.assertEqual(self.config.artifact_bytes, 64*1024)
        self.assertFalse(list((self.config.root/'results').iterdir()))


if __name__ == '__main__': unittest.main()
