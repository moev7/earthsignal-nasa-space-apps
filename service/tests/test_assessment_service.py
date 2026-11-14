"""Service-boundary fixtures only; these are not real provider/science results."""
import copy
import csv
import hashlib
import hmac
import json
import subprocess
import sys
import tempfile
import types
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from service.api import API, create_app
from service.auth import canonical
from service.config import Config
from service.store import Store, Problem
from service.worker import Worker
from service.assessment_validation import (ARTIFACTS, validate_geometry,
    validate_assessment_request, validate_scenario_request, validate_assessment_manifest)

AREA = {'type': 'Polygon', 'coordinates': [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]]}
REQUEST = dict(schemaVersion='1.0', domain='water', question='change', area=AREA, start='2026-01-01', end='2026-01-02')
RADAR = {'beforeId': 'before', 'afterId': 'after', 'bbox': [1, 2, 3, 4]}


def fixture(request=REQUEST):
    evidence = dict(id='e1', sourceId='fixture', sourceVersion='test', title='Test only', url='https://example.org/public', geometry=None,
        spatialSupport=dict(resolution=None, unit='unknown', description='Test support'),
        timestamps=dict(observedStart='2026-01-01', observedEnd='2026-01-02', publishedAt=None, retrievedAt='2026-01-03T00:00:00Z', validThrough=None),
        quantity='test', unit='m', quality=dict(commonCoveragePercent=None, notes=['Not real evidence']), maskPolicy='fixture', methodVersion='test-v1', hashes={'response': 'a'*64}, public=True)
    claim = dict(id='c1', type='Observed', text='Test claim', evidenceIds=['e1'], methodVersion='test-v1', assumptions=[], uncertainty=['Fixture only'], applicability=['Local support only'], counterevidence=[])
    metric = dict(id='m1', label='Test metric', value=2.5, unit='m', evidenceIds=['e1'], description='Fixture only', denominator=None)
    return dict(schemaVersion='1.0', kind='assessment', domain=request['domain'], question=request['question'], area=copy.deepcopy(request['area']),
        time={'start': request['start'], 'end': request['end']}, processedAt='2026-01-03T00:00:00Z', methodVersion='test-v1', title='Service test fixture',
        outcome='partial', evidence=[evidence], claims=[claim], metrics=[metric], quality=[dict(dimension='coverage', status='unknown', message='Fixture only')],
        brief=dict(title='Test brief', sections=[dict(id='changed', title='Fixture', claimIds=['c1'])]), artifacts=sorted(ARTIFACTS))


def scenario_request(parent):
    return dict(schemaVersion='1.0', assessmentId=parent, kind='threshold', inputs=dict(metricId='m1', threshold=2, operator='above'), assumptions=['Threshold supplied'], objectives=['Compare test metric'])


def scenario_fixture(request):
    claim = dict(id='s1', type='Scenario', text='Conditional fixture', evidenceIds=['e1'], methodVersion='test-v1', assumptions=request['assumptions'], uncertainty=['Fixture only'], applicability=['Local support'], counterevidence=[])
    metric=fixture()['metrics'][0];value=metric['value'];threshold=request['inputs']['threshold']
    meets=value>threshold if request['inputs']['operator']=='above' else value<threshold
    outputs=[dict(id=id,label='Fixture threshold',value=quantity,unit=unit,evidenceIds=metric['evidenceIds'],description='Fixture only',denominator=metric['denominator']) for id,quantity,unit in [('threshold-comparison',int(meets),'boolean (1=yes, 0=no)'),('threshold-margin',value-threshold,metric['unit'])]]
    return dict(schemaVersion='1.0', kind='scenario', assessmentId=request['assessmentId'], scenarioKind=request['kind'], methodVersion='test-v1', changedInputs=request['inputs'],
        assumptions=request['assumptions'], objectives=request['objectives'], outputs=outputs, sensitivities=['Fixture only'], alternatives=[], claims=[claim], limitations=['Not a forecast'], artifacts=sorted(ARTIFACTS))


class GeometryTests(unittest.TestCase):
    def test_holes_multipolygons_and_antimeridian(self):
        hole = [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]]
        validate_geometry({'type': 'Polygon', 'coordinates': AREA['coordinates'] + [hole]})
        dateline = [[[179, 0], [-179, 0], [-179, 4], [179, 4], [179, 0]], [[179.5, 1], [-179.5, 1], [-179.5, 2], [179.5, 2], [179.5, 1]]]
        validate_geometry({'type': 'MultiPolygon', 'coordinates': [dateline, AREA['coordinates']]})
        # A polygon inside another component's hole is disjoint and valid.
        inner = [[[1.2, 1.2], [1.8, 1.2], [1.8, 1.8], [1.2, 1.8], [1.2, 1.2]]]
        validate_geometry({'type': 'MultiPolygon', 'coordinates': [AREA['coordinates'] + [hole], inner]})

    def test_reject_intersections_outside_overlapping_holes_and_bounds(self):
        invalid = [
            {'type': 'Polygon', 'coordinates': [[[0, 0], [3, 3], [0, 3], [3, 0], [0, 0]]]},
            {'type': 'Polygon', 'coordinates': AREA['coordinates'] + [[[5, 5], [6, 5], [6, 6], [5, 5]]]},
            {'type': 'MultiPolygon', 'coordinates': [AREA['coordinates'], AREA['coordinates']]},
            {'type': 'Polygon', 'coordinates': [[[0, 86], [1, 86], [1, 87], [0, 86]]]},
            {'type': 'Polygon', 'coordinates': [[[0, 0], [1, 0], [0.5, 0], [0, 1], [0, 0]]]},
            {'type': 'Polygon', 'coordinates': [[[0, 0], [180, 0], [180, 1], [0, 0]]]},
            {'type': 'Polygon', 'coordinates': [[[True, 0], [1, 0], [1, 1], [True, 0]]]},
        ]
        hole = [[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]]
        invalid.append({'type': 'Polygon', 'coordinates': AREA['coordinates'] + [hole, hole]})
        for area in invalid:
            with self.subTest(area=area), self.assertRaises(ValueError):
                validate_geometry(area)

    def test_contract_bounds_and_client_evidence_rejected(self):
        for request in ({**REQUEST, 'evidence': []}, {**REQUEST, 'start': '2026-02-30'}, {**REQUEST, 'options': {'url': 'https://evil.org'}},
            {**REQUEST, 'area': {**AREA, 'coordinates': [AREA['coordinates'][0]*103]}}, {**REQUEST, 'options': {'referenceStart': '2026-01-01'}}):
            with self.assertRaises((ValueError, TypeError)):
                validate_assessment_request(request)
        request = scenario_request('a'*32)
        for bad in ({**request, 'parent': fixture()}, {**request, 'inputs': {**request['inputs'], 'threshold': float('nan')}}, {**request, 'objectives': []}):
            with self.assertRaises(ValueError):
                validate_scenario_request(bad)


class AssessmentServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.now = 1000000
        self.config = Config(Path(self.temp.name), b's'*32, reserve_bytes=0)
        self.store = Store(self.config, lambda: self.now)
        self.api = API(self.store, lambda: dict(ready=True, message='ready', maxPixels=1_000_000))
        self.serial = 0

    def tearDown(self):
        self.temp.cleanup()

    def submit(self, key='assessment', owner='owner', request=REQUEST, kind='assessment'):
        return self.store.submit(owner, request, key, 'observatory-contract-v1', kind=kind)

    def signed(self, method, path, body=b'', owner='owner', key='api-one'):
        self.serial += 1
        ts, nonce = str(self.now), f'nonce_{self.serial:020d}'
        sig = hmac.new(self.config.secret, canonical(method, path, owner, ts, nonce, body), hashlib.sha256).hexdigest()
        return {'X-Earthsignal-User': owner, 'X-Earthsignal-Timestamp': ts, 'X-Earthsignal-Nonce': nonce, 'X-Earthsignal-Signature': sig, 'Idempotency-Key': key}

    def call(self, method, path, payload=None, owner='owner', key='api-one'):
        body = json.dumps(payload).encode() if payload is not None else b''
        return self.api.dispatch(method, path, self.signed(method, path, body, owner, key), body)

    def problem(self, code, fn):
        with self.assertRaises(Problem) as c:
            fn()
        self.assertEqual(c.exception.code, code)

    def stage(self, row, manifest=None, parent=None):
        stage = self.config.root/'staging'/row['id']; stage.mkdir(exist_ok=True)
        manifest = manifest or fixture(json.loads(row['request']))
        if manifest['kind'] == 'assessment':
            area, evidence, brief, metrics = manifest['area'], manifest['evidence'], manifest['brief'], manifest['metrics']
        else:
            area, evidence = parent['area'], parent['evidence']
            brief = dict(title='Scenario fixture', sections=[dict(id='options', title='Conditional', claimIds=['s1'])])
            metrics = manifest['outputs']
        for name, value in [('manifest.json', manifest), ('area.geojson', area), ('evidence.json', evidence), ('brief.json', brief)]:
            (stage/name).write_text(json.dumps(value))
        with (stage/'metrics.csv').open('w', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=['id', 'label', 'value', 'unit', 'description', 'denominator', 'evidenceIds'])
            writer.writeheader()
            for metric in metrics:
                writer.writerow({**metric, 'value': '' if metric['value'] is None else metric['value'], 'evidenceIds': json.dumps(metric['evidenceIds'])})
        return stage

    def completed(self, owner='owner'):
        job = self.submit(owner=owner); row = self.store.claim()
        self.assertTrue(Worker(self.store).publish(row, self.stage(row)))
        return job['id']

    def test_independent_feature_flags_preserve_history_and_radar(self):
        disabled = API(Store(replace(self.config, assessment_domains=(), scenarios_enabled=False), lambda: self.now))
        body = json.dumps(REQUEST).encode()
        self.problem('feature_disabled', lambda: disabled.dispatch('POST', '/api/assessments', self.signed('POST', '/api/assessments', body), body))
        self.assertEqual(disabled.dispatch('GET', '/api/assessments', self.signed('GET', '/api/assessments'), b'')[1]['jobs'], [])
        self.assertEqual(disabled.dispatch('GET', '/api/sources', self.signed('GET', '/api/sources'), b'')[1]['assessmentDomains'], [])
        job = self.store.submit('owner', RADAR, 'radar-independent', 'v1')
        self.assertIn(job['id'], [j['id'] for j in self.store.list('owner')])

    def test_radar_wire_lists_and_shared_idempotency(self):
        radar = self.store.submit('owner', RADAR, 'radar', 'v1')
        self.now += 1
        assessment = self.submit()
        self.assertNotIn('kind', radar); self.assertNotIn('request', radar)
        self.assertEqual(assessment['request'], REQUEST)
        self.assertEqual([j['id'] for j in self.store.list('owner')], [radar['id']])
        self.assertEqual([j['id'] for j in self.store.list('owner', 'assessment')], [assessment['id']])
        self.assertEqual(self.submit()['id'], assessment['id'])
        self.problem('idempotency_conflict', lambda: self.submit(key='radar'))
        self.problem('idempotency_conflict', lambda: self.submit(request={**REQUEST, 'domain': 'fire'}))
        self.problem('owner_limit', lambda: self.submit(key='third'))
        self.assertEqual(self.store.claim()['id'], radar['id'])
        self.assertIsNone(self.store.claim())

    def test_signed_new_routes_ownership_crosskind_brief_artifact(self):
        self.problem('unauthorized', lambda: self.api.dispatch('GET', '/api/assessments', {}, b''))
        status, job, _ = self.call('POST', '/api/assessments', REQUEST)
        self.assertEqual(status, 202)
        job_id = job['id']; row = self.store.claim()
        self.assertTrue(Worker(self.store).publish(row, self.stage(row)))
        self.assertEqual(self.call('GET', '/api/assessments')[1]['jobs'][0]['id'], job_id)
        self.assertEqual(self.call('GET', f'/api/assessments/{job_id}/brief')[1], fixture()['brief'])
        file = self.call('GET', f'/api/assessments/{job_id}/artifacts/evidence.json')[2]
        self.assertEqual(json.loads(file.read_text()), fixture()['evidence'])
        for path in (f'/api/change-jobs/{job_id}', f'/api/scenarios/{job_id}', f'/api/assessments/{job_id}/artifacts/before.tif', f'/api/assessments/{job_id}/artifacts/%2e%2e%2fjobs.sqlite3'):
            self.problem('not_found', lambda path=path: self.call('GET', path))
        self.problem('not_found', lambda: self.call('GET', f'/api/assessments/{job_id}', owner='other'))
        self.problem('not_found', lambda: self.call('POST', f'/api/change-jobs/{job_id}/cancel'))
        self.problem('not_found', lambda: self.call('POST', f'/api/assessments/{job_id}/cancel', owner='other'))
        self.assertEqual(self.call('GET', '/api/assessments', owner='other')[1]['jobs'], [])

    def test_scenario_parent_completed_owned_kind_expiry_and_no_client_manifest(self):
        parent = self.submit()['id']
        request = scenario_request(parent)
        self.problem('parent_not_completed', lambda: self.submit(key='scenario', request=request, kind='scenario'))
        row = self.store.claim(); Worker(self.store).publish(row, self.stage(row))
        self.problem('not_found', lambda: self.submit(owner='other', request=request, kind='scenario'))
        self.problem('invalid_request', lambda: self.submit(key='scenario', request={**request, 'parent': fixture()}, kind='scenario'))
        status, job, _ = self.call('POST', '/api/scenarios', request)
        self.assertEqual(status, 202)
        row = self.store.claim(); self.assertEqual(self.store.parent_for_job(row), fixture())
        Worker(self.store).publish(row, self.stage(row, scenario_fixture(request), fixture()))
        self.assertEqual(self.call('GET', '/api/scenarios')[1]['jobs'][0]['id'], job['id'])
        self.assertEqual(self.call('GET', f"/api/scenarios/{job['id']}/artifacts/manifest.json")[0], 200)
        self.problem('not_found', lambda: self.store.get('owner', job['id'], 'assessment'))
        self.now += self.config.expiry_seconds+1
        self.problem('not_found', lambda: self.submit(key='expired-parent', request=request, kind='scenario'))

    def test_scenario_verified_db_parent_cannot_be_forged(self):
        parent = self.completed()
        with self.store.transaction() as db:
            db.execute("UPDATE jobs SET result='{}' WHERE id=?", (parent,))
        self.problem('invalid_parent', lambda: self.submit(key='scenario', request=scenario_request(parent), kind='scenario'))

    def test_atomic_partial_cancel_and_crash_after_rename(self):
        job = self.submit(); row = self.store.claim(); stage = self.stage(row)
        (stage/'evidence.json').unlink()
        with self.assertRaises(ValueError): Worker(self.store).publish(row, stage)
        self.assertFalse((self.config.root/'results'/job['id']).exists())
        self.problem('not_found', lambda: self.call('GET', f"/api/assessments/{job['id']}/artifacts/manifest.json"))
        stage = self.stage(row); self.store.cancel('owner', job['id'], 'assessment')
        self.assertFalse(Worker(self.store).publish(row, stage))
        self.assertFalse((self.config.root/'results'/job['id']).exists())
        other = self.submit(key='crash'); row = self.store.claim(); stage = self.stage(row)
        with patch.object(self.store, 'complete', side_effect=RuntimeError('simulated crash')), self.assertRaises(RuntimeError):
            Worker(self.store).publish(row, stage)
        self.assertTrue((self.config.root/'results'/other['id']).exists())
        self.problem('not_found', lambda: self.call('GET', f"/api/assessments/{other['id']}/artifacts/manifest.json"))
        self.store.recover(restart=True)
        self.assertFalse((self.config.root/'results'/other['id']).exists())
        self.assertEqual(self.store.get('owner', other['id'], 'assessment')['error']['code'], 'interrupted')

    def test_publication_rejects_manifest_claim_artifact_tampering(self):
        self.submit(); row = self.store.claim()
        mutations = [lambda m: m['claims'][0].update(evidenceIds=['unknown']), lambda m: m['brief']['sections'][0].update(claimIds=['unknown']),
            lambda m: m['evidence'][0].update(url='https://user:secret@example.org/private'), lambda m: m.update(artifacts=sorted(ARTIFACTS)+['private.txt']),
            lambda m: m['claims'][0].update(type='Forecast'), lambda m: m['metrics'][0].update(value=float('nan')),
            lambda m: m.update(area={'type': 'Polygon', 'coordinates': []})]
        for mutate in mutations:
            manifest = fixture(); mutate(manifest); stage = self.stage(row, manifest)
            with self.assertRaises((ValueError, TypeError)): Worker(self.store).publish(row, stage)
        stage = self.stage(row)
        (stage/'area.geojson').write_text(json.dumps({**AREA, 'privateOwner': 'other'}))
        with self.assertRaises(ValueError): Worker(self.store).publish(row, stage)
        stage = self.stage(row)
        (stage/'metrics.csv').write_text('id,value,unit\nm1,900,m\n')
        with self.assertRaises(ValueError): Worker(self.store).publish(row, stage)
        stage = self.stage(row)
        (stage/'private.txt').write_text('do not publish')
        with self.assertRaises(ValueError): Worker(self.store).publish(row, stage)
        (stage/'private.txt').unlink(); (stage/'brief.json').unlink(); (stage/'brief.json').symlink_to(stage/'manifest.json')
        with self.assertRaises(ValueError): Worker(self.store).publish(row, stage)
        self.assertFalse((self.config.root/'results'/row['id']).exists())

    def test_snapshot_durable_owner_scope_hash_expiry_no_client_payload(self):
        parent = self.completed()
        path = f'/api/assessments/{parent}/snapshot'
        self.problem('invalid_request', lambda: self.call('POST', path, {'manifest': fixture()}))
        status, snapshot, _ = self.call('POST', path)
        self.assertEqual(status, 201)
        encoded = json.dumps(fixture(), sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
        self.assertEqual(snapshot['manifestHash'], hashlib.sha256(encoded).hexdigest())
        self.assertEqual(self.call('POST', path)[1]['id'], snapshot['id'])
        self.problem('not_found', lambda: self.call('GET', f"/api/assessment-snapshots/{snapshot['id']}", owner='other'))
        self.assertEqual(self.call('GET', '/api/assessment-snapshots', owner='other')[1]['snapshots'], [])
        self.now += self.config.expiry_seconds+1; self.store.cleanup()
        self.assertFalse((self.config.root/'results'/parent).exists())
        reopened = Store(self.config, lambda: self.now)
        self.assertEqual(reopened.snapshots('owner', snapshot['id']), snapshot)
        self.assertNotIn('/api/assessments/', json.dumps(snapshot))
        self.problem('not_found', lambda: self.call('GET', f'/api/assessments/{parent}'))

    def test_shared_storage_queue_daily_and_cancel_expiry(self):
        job = self.submit(); self.store.cancel('owner', job['id'], 'assessment')
        for i in range(4):
            job = self.store.submit('owner', RADAR, f'radar{i}', 'v1'); self.store.cancel('owner', job['id'])
        self.problem('daily_limit', lambda: self.submit(key='six'))
        queue = Store(replace(self.config, queue_limit=1), lambda: self.now)
        queue.submit('new', RADAR, 'new', 'v1')
        self.problem('queue_full', lambda: queue.submit('third', REQUEST, 'third', 'v1', kind='assessment'))
        disk = Store(replace(self.config, storage_bytes=0), lambda: self.now)
        self.problem('storage_limit', lambda: disk.submit('third', REQUEST, 'disk', 'v1', kind='assessment'))
        self.now += self.config.expiry_seconds+1; self.store.cleanup()
        self.assertEqual(self.store.list('owner', 'assessment'), [])

    def test_ipc_envelopes_radar_shape_and_gateway_secret_removed(self):
        # Simulate isolated process completion without inventing a provider result.
        for kind, request in [('radar', RADAR), ('assessment', REQUEST)]:
            with self.subTest(kind=kind):
                job = self.store.submit('owner', request, kind, 'v1', kind=kind)
                captured = {}
                def launch(argv, **kwargs):
                    captured.update(argv=argv, env=kwargs['env'], payload=json.loads(Path(argv[-2]).read_text()))
                    if kind == 'assessment':
                        self.stage({'id': job['id'], 'request': json.dumps(request)}, fixture())
                    else:
                        from service.tests.test_worker import manifest
                        from service.store import ARTIFACTS as RADAR_ARTIFACTS
                        stage = Path(argv[-1])
                        for name in RADAR_ARTIFACTS: (stage/name).write_bytes(b'fixture')
                        (stage/'manifest.json').write_text(json.dumps(manifest()))
                    return types.SimpleNamespace(poll=lambda: 0, returncode=0)
                with patch('service.worker.subprocess.Popen', side_effect=launch):
                    self.assertTrue(Worker(self.store).run_one())
                self.assertEqual(captured['argv'][1:3], ['-m', 'service.run_job'])
                self.assertEqual(captured['payload'], request if kind == 'radar' else {'kind': kind, 'request': request, 'owner':'owner'})
                self.assertEqual(captured['env']['EARTHSIGNAL_GATEWAY_SECRET'], 'isolated-science-process-no-gateway-access')
                self.assertEqual(self.store.get('owner', job['id'], kind)['status'], 'completed')
        parent = self.store.list('owner', 'assessment')[0]['id']; request = scenario_request(parent)
        job = self.submit(key='scenario-ipc', request=request, kind='scenario')
        def scenario_launch(argv, **kwargs):
            envelope = json.loads(Path(argv[-2]).read_text())
            self.assertEqual(envelope, {'kind': 'scenario', 'request': request, 'parent': fixture()})
            self.stage({'id': job['id'], 'request': json.dumps(request)}, scenario_fixture(request), fixture())
            return types.SimpleNamespace(poll=lambda: 0, returncode=0)
        with patch('service.worker.subprocess.Popen', side_effect=scenario_launch): Worker(self.store).run_one()
        self.assertEqual(self.store.get('owner', job['id'], 'scenario')['status'], 'completed')

    def test_assessment_subprocess_cancel_timeout_and_safe_errors(self):
        for action, expected in [('cancel', 'cancelled'), ('timeout', 'failed'), ('error', 'failed')]:
            job = self.submit(key=action)
            worker = Worker(Store(replace(self.config, wall_seconds=0), lambda: self.now)) if action == 'timeout' else Worker(self.store)
            real = subprocess.Popen
            children = []
            def launch(argv, **kwargs):
                if action == 'error':
                    (Path(argv[-1])/'error.json').write_text(json.dumps({'code': 'private', 'message': 'https://user:password@example.org/token'}))
                    return types.SimpleNamespace(poll=lambda: 0, returncode=1)
                child = real([sys.executable, '-c', 'import time; time.sleep(30)'], start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                children.append(child)
                if action == 'cancel': self.store.cancel('owner', job['id'], 'assessment')
                return child
            with patch('service.worker.subprocess.Popen', side_effect=launch):
                result = worker.run_one()
            self.assertTrue(result)
            self.assertEqual(self.store.get('owner', job['id'], 'assessment')['status'], expected)
            for child in children: self.assertIsNotNone(child.poll())
            self.assertFalse((self.config.root/'staging'/job['id']).exists())
            self.assertNotIn('password', json.dumps(self.store.get('owner', job['id'], 'assessment')))

    def test_source_registry_server_only_and_unavailable_sanitized(self):
        module = types.ModuleType('service.observatory.sources'); module.source_registry = lambda: [dict(id='fixture', public=True)]
        with patch.dict(sys.modules, {'service.observatory.sources': module}):
            self.assertEqual(self.call('GET', '/api/sources')[1]['sources'], [dict(id='fixture', public=True)])
            module.source_registry = lambda: (_ for _ in ()).throw(RuntimeError('private token'))
            self.problem('sources_unavailable', lambda: self.call('GET', '/api/sources'))

    def test_expired_idempotency_does_not_reexpose_private_manifest(self):
        self.completed()
        self.now += self.config.expiry_seconds+1
        self.problem('not_found', lambda: self.submit())
        self.assertEqual(self.store.list('owner', 'assessment'), [])

    def test_threshold_unknown_metric_rejected_without_queue_entry(self):
        parent = self.completed(); request = scenario_request(parent)
        request['inputs']['metricId'] = 'unknown'
        self.problem('invalid_metric', lambda: self.submit(key='unknown-metric', request=request, kind='scenario'))
        self.assertEqual(self.store.list('owner', 'scenario'), [])

    def test_snapshot_rejects_private_artifact_and_secret_urls(self):
        for url in ('https://example.org/api/assessments/other/artifacts/evidence.json',
                    'https://example.org/public?token=secret', 'https://127.0.0.1/private',
                    'https://localhost/private'):
            manifest = fixture(); manifest['evidence'][0]['url'] = url
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_assessment_manifest(manifest, REQUEST)

    def test_one_worker_flock_remains_exclusive(self):
        first, second = Worker(self.store), Worker(self.store)
        first.lock()
        try:
            with self.assertRaises(BlockingIOError): second.lock()
        finally:
            first.lock_file.close()
            if hasattr(second, 'lock_file'): second.lock_file.close()

    def test_science_dispatch_envelope_and_exception_privacy(self):
        from service.run_job import main
        parent = fixture(); request = scenario_request('a'*32)
        module = types.ModuleType('service.observatory.engine')
        calls = []
        def assessment(req, config, output):
            calls.append(('assessment', req, config, output)); return fixture(req)
        def scenario(req, verified_parent, config, output):
            calls.append(('scenario', req, verified_parent, config, output)); return scenario_fixture(req)
        module.run_assessment, module.run_scenario = assessment, scenario
        stage = self.config.root/'staging'/'dispatch'; stage.mkdir()
        request_path = stage/'request.json'
        envelopes = [{'kind': 'assessment', 'request': REQUEST}, {'kind': 'scenario', 'request': request, 'parent': parent}]
        for envelope in envelopes:
            request_path.write_text(json.dumps(envelope))
            with patch.dict(sys.modules, {'service.observatory.engine': module}), patch('service.run_job.Config.environment', return_value=self.config), patch('resource.setrlimit'), patch('sys.argv', ['run_job', str(request_path), str(stage)]):
                self.assertEqual(main(), 0)
            self.assertEqual(json.loads((stage/'manifest.json').read_text())['kind'], envelope['kind'])
        self.assertEqual(calls[1][2], parent)
        module.run_assessment = lambda *args: (_ for _ in ()).throw(RuntimeError('https://user:password@example.org/?token=private'))
        request_path.write_text(json.dumps(envelopes[0]))
        with patch.dict(sys.modules, {'service.observatory.engine': module}), patch('service.run_job.Config.environment', return_value=self.config), patch('resource.setrlimit'), patch('sys.argv', ['run_job', str(request_path), str(stage)]):
            self.assertEqual(main(), 1)
        self.assertNotIn('password', (stage/'error.json').read_text())
        self.assertNotIn('private', (stage/'error.json').read_text())

    def test_signed_owner_survives_api_and_processing_envelope(self):
        from service.run_job import main
        owner = 'x'*256
        code, submitted, _ = self.call('POST', '/api/assessments', REQUEST, owner=owner)
        self.assertEqual(code, 202)
        self.problem('not_found', lambda: self.call('GET', '/api/assessments/'+submitted['id'], owner='x'*255))
        module = types.ModuleType('service.observatory.engine')
        captured = []
        def assessment(req, config, output, *, owner):
            captured.append(owner)
            return fixture(req)
        module.run_assessment = assessment
        module.run_scenario = lambda *args: None
        stage = self.config.root/'staging'/'opaque-owner'; stage.mkdir()
        request_path = stage/'request.json'
        request_path.write_text(json.dumps({'kind':'assessment','request':REQUEST,'owner':owner}))
        with patch.dict(sys.modules, {'service.observatory.engine':module}), patch('service.run_job.Config.environment', return_value=self.config), patch('resource.setrlimit'), patch('sys.argv',['run_job',str(request_path),str(stage)]):
            self.assertEqual(main(),0)
        self.assertEqual(captured,[owner])
        self.problem('unauthorized', lambda:self.call('GET','/api/assessments',owner='x'*257))

    def test_existing_database_kind_migration_preserves_old_rows(self):
        job = self.store.submit('owner', RADAR, 'legacy', 'v1')
        self.store.claim(); self.store.complete(job['id'], {}); self.store.pin(job['id'])
        with self.store.transaction() as db: db.execute('ALTER TABLE jobs DROP COLUMN kind')
        migrated = Store(self.config, lambda: self.now)
        self.assertTrue(migrated.get('other', job['id'])['prepared'])
        with migrated.connect() as db:
            self.assertEqual(db.execute('SELECT kind FROM jobs WHERE id=?', (job['id'],)).fetchone()[0], 'radar')
        self.assertNotIn('kind', migrated.get('owner', job['id']))


class AssessmentHTTPTests(AssessmentServiceTests):
    # Keep HTTP checks separate from inherited service cases (load_tests below).
    def test_http_artifact_cache_headers_owner_and_crosskind(self):
        from fastapi.testclient import TestClient
        parent = self.completed(); client = TestClient(create_app(self.api))
        try:
            path = f'/api/assessments/{parent}/artifacts/manifest.json'
            self.assertEqual(client.get(path).status_code, 401)
            response = client.get(path, headers=self.signed('GET', path))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['cache-control'], 'private, no-store')
            self.assertEqual(response.headers['x-content-type-options'], 'nosniff')
            self.assertEqual(response.json(), fixture())
            self.assertEqual(client.get(path, headers=self.signed('GET', path, owner='other')).status_code, 404)
            path = f'/api/scenarios/{parent}/artifacts/manifest.json'
            self.assertEqual(client.get(path, headers=self.signed('GET', path)).status_code, 404)
        finally: client.close()


def load_tests(loader, tests, pattern):
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(GeometryTests))
    suite.addTests(loader.loadTestsFromTestCase(AssessmentServiceTests))
    suite.addTest(AssessmentHTTPTests('test_http_artifact_cache_headers_owner_and_crosskind'))
    return suite


if __name__ == '__main__': unittest.main()
