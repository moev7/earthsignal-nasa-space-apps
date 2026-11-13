"""Deterministic local guard tests. Fixtures are synthetic, never live receipts."""
import copy
from contextlib import closing
import gzip
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('sar_package_builder', SCRIPTS / 'build-sar-science-package.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
a = builder.recipe

CORE = ('__init__.py', 'api.py', 'auth.py', 'config.py', 'store.py', 'worker.py',
        'run_job.py', 'processing.py', 'range_reader.py', 'ground_motion.py', 'gunw_reader.py',
        'observatory/__init__.py', 'observatory/net.py',
        'sar/__init__.py', 'sar/jobs.py', 'sar/catalog.py', 'sar/net.py', 'sar/native.py',
        'sar/tiff_decoder.py', 'sar/rcm.py', 'sar/uavsar.py', 'sar/nisar_extended.py')


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.source = self.root / 'candidate'
        self.source.mkdir()
        for name in CORE:
            path = self.source / name
            path.parent.mkdir(exist_ok=True, parents=True)
            path.write_text('# synthetic package fixture\n')
        (self.source / 'sar/jobs.py').write_text("METHOD='synthetic-sar-2'\n")
        (self.source / 'observatory/net.py').write_text("METHOD_VERSION='synthetic-observatory'\n")
        self.package = self.root / 'science.tar.gz'
        self.manifest_path = self.root / 'source.json'
        self.old = builder.inventory(self.source)
        # The fixture models a host with neither SAR nor GUNW/ground-motion.
        self.old = {n: h for n, h in self.old.items() if not n.startswith('sar/') and n not in ('ground_motion.py', 'gunw_reader.py')}
        self.result = builder.build(self.source, self.old, self.package, self.manifest_path,
                                    'synthetic-observatory', a.ABSENT)
        self.manifest = json.loads(self.manifest_path.read_text())
        self.receipt = dict(schema='earthsignal.sar-approval/1', approved=True,
                            manifest_sha256=self.result['manifest_sha256'],
                            package_sha256=self.result['package_sha256'], expires_at=2000,
                            venv=str(self.root / 'external-venv'),
                            runtime={k: 'synthetic-1' for k in ('numpy', 'Pillow', 'h5py', 'GDAL', 'fastapi', 'uvicorn')},
                            checks=dict(environment=True, resources=True, rollback_compatible=True), retained={})

    def tearDown(self):
        self.tmp.cleanup()

    def approve(self, receipt=None):
        return a.validate_receipt(self.receipt if receipt is None else receipt,
                                  self.manifest, self.result['manifest_sha256'], now=1000)

    def tar(self, entries):
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
            for name, data, kind in entries:
                info = tarfile.TarInfo(name)
                info.type = kind
                info.size = len(data) if kind == tarfile.REGTYPE else 0
                if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                    info.linkname = '../../escape'
                archive.addfile(info, io.BytesIO(data) if info.size else None)
        path = self.root / 'malicious.tar.gz'
        path.write_bytes(buffer.getvalue())
        return path


class ReceiptTests(Fixture):
    def test_bound_receipt_and_explicit_empty_retention_are_valid(self):
        self.assertIs(self.approve(), self.receipt)

    def test_expired_future_unapproved_unbound_receipts_reject(self):
        for key, value in (('expires_at', 1000), ('expires_at', 1000000),
                           ('expires_at', float('nan')), ('approved', False),
                           ('manifest_sha256', 'f' * 64), ('package_sha256', 'e' * 64)):
            with self.subTest(key=key, value=value):
                receipt = copy.deepcopy(self.receipt)
                receipt[key] = value
                with self.assertRaises(RuntimeError):
                    self.approve(receipt)

    def test_each_approval_gate_and_runtime_version_is_required(self):
        for check in self.receipt['checks']:
            receipt = copy.deepcopy(self.receipt)
            receipt['checks'][check] = False
            with self.subTest(check=check), self.assertRaisesRegex(RuntimeError, check):
                self.approve(receipt)
        receipt = copy.deepcopy(self.receipt)
        del receipt['runtime']['GDAL']
        with self.assertRaisesRegex(RuntimeError, 'runtime'):
            self.approve(receipt)

    def test_retention_receipt_requires_real_hash_shape(self):
        receipt = copy.deepcopy(self.receipt)
        receipt['retained'] = {'not-a-job': {'manifestHash': 'a' * 64, 'files': {}}}
        with self.assertRaisesRegex(RuntimeError, 'retained'):
            self.approve(receipt)
        receipt['retained'] = {'a' * 32: {'manifestHash': 'b' * 64, 'files': {'../escape': 'c' * 64}}}
        with self.assertRaisesRegex(RuntimeError, 'Unsafe'):
            self.approve(receipt)

    def test_pinned_json_rejects_mismatch_and_duplicate_keys(self):
        with self.assertRaisesRegex(RuntimeError, 'mismatch'):
            a.pinned_json(self.manifest_path, 'f' * 64)
        path = self.root / 'duplicate.json'
        path.write_bytes(b'{"approved":false,"approved":true}')
        with self.assertRaisesRegex(RuntimeError, 'Duplicate'):
            a.pinned_json(path, a.sha(path.read_bytes()))


class PackageTests(Fixture):
    def test_build_reproducibility_and_explicit_new_transitive_sources(self):
        second = self.root / 'second.tar.gz'
        second_manifest = self.root / 'second.json'
        result = builder.build(self.source, self.old, second, second_manifest,
                               'synthetic-observatory', a.ABSENT)
        self.assertEqual(self.result, result)
        self.assertEqual(self.package.read_bytes(), second.read_bytes())
        for name in ('gunw_reader.py', 'ground_motion.py', 'sar/tiff_decoder.py', 'sar/nisar_extended.py'):
            self.assertEqual(self.manifest['old'][name], a.ABSENT)
            self.assertTrue(a.valid_hash(self.manifest['new'][name]))
        target = self.root / 'unpacked'
        a.safe_unpack(self.package, target, self.manifest['new'], self.result['package_sha256'])
        with patch.object(a, 'SOURCE_COMPONENTS', tuple(self.manifest['new'])):
            a.verify_source(target / 'service', self.manifest['new'])

    def test_no_overwrite_or_guessed_old_hashes(self):
        with self.assertRaisesRegex(RuntimeError, 'Output exists'):
            builder.build(self.source, self.old, self.package, self.manifest_path, 'old', a.ABSENT)
        old = dict(self.old, **{'api.py': a.ABSENT})
        with self.assertRaisesRegex(RuntimeError, 'observed'):
            builder.build(self.source, old, self.root / 'unused.tar.gz', self.root / 'unused.json', 'old', a.ABSENT)

    def test_required_dependency_and_unsafe_inventory_reject(self):
        for name in ('gunw_reader.py', 'ground_motion.py', 'sar/tiff_decoder.py'):
            manifest = copy.deepcopy(self.manifest)
            del manifest['new'][name]
            del manifest['old'][name]
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, 'transitive'):
                a.validate_manifest(manifest)
        for name in ('../escape', '/absolute', 'sar/../escape', '.venv/lib.py', 'sar\\escape', 'sar//escape'):
            manifest = copy.deepcopy(self.manifest)
            manifest['old'][name] = a.ABSENT
            manifest['new'][name] = 'a' * 64
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, 'Unsafe'):
                a.validate_manifest(manifest)

    def test_static_import_check_catches_missing_lazy_dependency(self):
        (self.source / 'api.py').write_text('def lazy():\n from .missing_module import run\n')
        with self.assertRaisesRegex(RuntimeError, 'missing_module'):
            builder.check_imports(self.source, builder.inventory(self.source))

    def test_inventory_ignores_env_venv_tests_and_rejects_runtime_links(self):
        (self.source / '.env').write_text('not read or bundled')
        (self.source / '.venv').symlink_to(self.root / 'nonexistent')
        (self.source / 'tests').mkdir()
        (self.source / 'tests/ignored.py').write_text('ignored')
        self.assertEqual(set(builder.inventory(self.source)), set(CORE))
        (self.source / 'linked.py').symlink_to(self.source / 'api.py')
        with self.assertRaisesRegex(RuntimeError, 'Linked'):
            builder.inventory(self.source)

    def test_unknown_importable_file_rejects_full_fingerprint(self):
        (self.source / 'injected.py').write_text('# extra')
        with patch.object(a, 'SOURCE_COMPONENTS', tuple(self.manifest['new'])), self.assertRaisesRegex(RuntimeError, 'Unexpected source tree'):
            a.verify_source(self.source, self.manifest['new'])

    def test_malicious_member_types_names_and_duplicates_reject_before_extract(self):
        for entries in ([('../escape', b'x', tarfile.REGTYPE)],
                        [('/absolute', b'x', tarfile.REGTYPE)],
                        [('service/api.py', b'', tarfile.SYMTYPE)],
                        [('service/api.py', b'', tarfile.LNKTYPE)],
                        [('service/api.py', b'', tarfile.FIFOTYPE)],
                        [('service/api.py', b'x', tarfile.REGTYPE)] * 2):
            path = self.tar(entries)
            target = self.root / 'forbidden-extract'
            with self.subTest(entries=entries), self.assertRaises(RuntimeError):
                a.safe_unpack(path, target, self.manifest['new'], a.sha(path.read_bytes()))
            self.assertFalse(target.exists())

    def test_package_hash_missing_member_and_component_corruption_reject(self):
        with self.assertRaisesRegex(RuntimeError, 'Package hash'):
            a.safe_unpack(self.package, self.root / 'no-hash', self.manifest['new'], 'f' * 64)
        path = self.tar([('service/api.py', b'wrong', tarfile.REGTYPE)])
        with self.assertRaisesRegex(RuntimeError, 'inventory'):
            a.safe_unpack(path, self.root / 'missing', self.manifest['new'], a.sha(path.read_bytes()))
        expected = {'api.py': a.sha(b'correct')}
        with self.assertRaisesRegex(RuntimeError, 'component hash'):
            a.safe_unpack(path, self.root / 'corrupt', expected, a.sha(path.read_bytes()))

    def test_archive_resource_caps(self):
        with patch.object(a, 'MAX_MEMBERS', 1), self.assertRaisesRegex(RuntimeError, 'member limit'):
            a.safe_unpack(self.package, self.root / 'too-many', self.manifest['new'], self.result['package_sha256'])
        with patch.object(a, 'MAX_EXPANDED', 1), self.assertRaisesRegex(RuntimeError, 'Expanded package'):
            a.safe_unpack(self.package, self.root / 'too-big', self.manifest['new'], self.result['package_sha256'])
        bomb = self.root / 'bomb.tar.gz'
        bomb.write_bytes(gzip.compress(b'\0' * 40000))
        with patch.object(a, 'MAX_EXPANDED', 1), patch.object(a, 'MAX_MEMBERS', 1), self.assertRaisesRegex(RuntimeError, 'stream expansion'):
            a.safe_unpack(bomb, self.root / 'bomb-output', {}, a.sha(bomb.read_bytes()))


class PreservationTests(unittest.TestCase):
    def test_retained_subset_allows_new_jobs_but_never_drift_or_loss(self):
        before = {'a': {'files': {'manifest.json': 'hash'}}}
        after = dict(before, b={'files': {}})
        a.check_retained(before, after)
        with self.assertRaises(RuntimeError):
            a.check_retained(before, after, exact=True)
        for actual in ({}, {'a': {'files': {'manifest.json': 'changed'}}}):
            with self.assertRaises(RuntimeError):
                a.check_retained(before, actual)

    def test_final_admission_failure_never_rolls_back_or_restarts(self):
        with patch.object(a, 'REPORT', {}), patch.object(a, 'restore_source') as restore, patch.object(a, 'start') as start, patch.object(a, 'command') as command:
            a.recover_failure(RuntimeError('health failed after admitting'), True, True)
            restore.assert_not_called()
            start.assert_not_called()
            command.assert_not_called()
            self.assertIn('retained after final admission', a.REPORT['status'])

    def test_admission_race_does_not_stop_worker(self):
        with patch.object(a, 'command') as command, patch.object(a, 'pending', return_value=1):
            with self.assertRaisesRegex(RuntimeError, 'New work'):
                a.stop_empty()
            self.assertEqual(command.call_args_list, [unittest.mock.call('systemctl', 'stop', 'earthsignal-api'),
                                                     unittest.mock.call('systemctl', 'start', 'earthsignal-api')])


class SmokeTests(Fixture):
    def test_http_smoke_checks_nonce_fingerprint_auth_queue_and_replay(self):
        def response(payload):
            value = io.BytesIO(json.dumps(payload).encode())
            value.status = 200
            return value
        nonce_values = [SimpleNamespace(hex=value * 32) for value in ('a', 'b', 'c', 'd', 'e')]
        expected_hash = None
        with patch.object(a, 'SOURCE_COMPONENTS', tuple(self.manifest['new'])):
            expected_hash = a.verify_source(self.source, self.manifest['new'])
        health = dict(status='ok', methodVersion='synthetic-observatory', release='b' * 32, codeHash=expected_hash)
        unsigned = a.urllib.error.HTTPError('local', 401, 'unauthorized', {}, io.BytesIO(b'{"error":{"code":"unauthorized"}}'))
        replay = a.urllib.error.HTTPError('local', 401, 'replay', {}, io.BytesIO(b'{"error":{"code":"replay"}}'))
        replies = [response(health), unsigned, response({'schemaVersion': '1.0', 'jobs': []}), replay]
        with patch.object(a, 'LIVE', self.source), patch.object(a, 'DATA', self.root), \
             patch.object(a, 'SOURCE_COMPONENTS', tuple(self.manifest['new'])), \
             patch.object(a.shutil, 'chown'), patch.object(a.uuid, 'uuid4', side_effect=nonce_values), \
             patch.object(a.subprocess, 'Popen') as popen, patch.object(a.os, 'killpg'), \
             patch.object(a.urllib.request, 'urlopen', side_effect=replies) as request:
            popen.return_value.poll.return_value = None
            a.smoke('synthetic-observatory', self.manifest['new'], 'synthetic-sar-2', self.receipt['runtime'])
            args, kwargs = popen.call_args
            self.assertEqual(args[0][0], "/usr/sbin/runuser")
            compile(args[0][-1], '<isolated-smoke>', 'exec')
            self.assertIn('assert Worker(store).run_one() is False', args[0][-1])
            self.assertIn('service.sar.tiff_decoder', args[0][-1])
            self.assertNotIn('EARTHSIGNAL_GATEWAY_SECRET', kwargs['env'])
            self.assertNotIn('EARTHSIGNAL_NETRC', kwargs['env'])
            self.assertEqual(request.call_count, 4)

    def test_venv_inside_exchanged_source_rejects(self):
        for path in (a.LIVE, a.OLD, a.NEW, a.STAGE):
            receipt = copy.deepcopy(self.receipt)
            receipt['venv'] = str(path / 'nested-venv')
            with self.subTest(path=path), self.assertRaisesRegex(RuntimeError, 'external venv'):
                self.approve(receipt)


class LifecycleTests(Fixture):
    """Mock only OS/service edges; actual archives, DB backup and inventories."""
    def setUp(self):
        super().setUp()
        self.service_root = self.root / 'opt'
        self.service_root.mkdir()
        self.data = self.root / 'data'
        self.data.mkdir()
        (self.data / 'results').mkdir()
        self.live = self.service_root / 'service'
        self.live.mkdir()
        for name in self.old:
            path = self.live / name
            path.parent.mkdir(exist_ok=True, parents=True)
            path.write_bytes((self.source / name).read_bytes())
        self.venv = self.root / 'external-venv'
        self.venv.mkdir()
        (self.live / '.venv').symlink_to(self.venv)
        with closing(sqlite3.connect(self.data / 'jobs.sqlite3')) as db, db:
            db.execute('create table jobs(id text primary key,result text,prepared integer,state text)')
        paths = dict(ROOT=self.service_root, DATA=self.data, LIVE=self.live,
                     OLD=self.service_root / 'old', NEW=self.service_root / 'new',
                     STAGE=self.service_root / 'stage', BACKUP=self.root / 'backup',
                     REPORT={'package': str(self.package)}, SOURCE_COMPONENTS=tuple(self.manifest['old']))
        self.patches = [patch.object(a, name, value) for name, value in paths.items()]
        self.patches += [patch.object(a.time, 'time', return_value=1000),
                         patch.object(a.shutil, 'disk_usage', return_value=type('Disk', (), {'free': 10 * 1024**3})()),
                         patch.object(a.shutil, 'chown'), patch.object(a, 'command', return_value='active'),
                         patch.object(a.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'active', '')),
                         patch.object(a, 'stop_empty'), patch.object(a, 'smoke'), patch.object(a, 'start'),
                         patch.object(a, 'exchange', side_effect=self.fake_exchange)]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        super().tearDown()

    def fake_exchange(self, left, right):
        # Tests sequencing on Mac; real atomicity is tested by legacy Linux suite.
        temporary = self.service_root / 'synthetic-exchange'
        left.rename(temporary)
        right.rename(left)
        temporary.rename(right)

    def admit_new_prepared(self):
        ident = 'a' * 32
        with closing(sqlite3.connect(self.data / 'jobs.sqlite3')) as db, db:
            db.execute('insert or ignore into jobs values(?,?,1,?)', (ident, '{"postActivation":true}', 'completed'))
        result = self.data / 'results' / ident
        result.mkdir(exist_ok=True)
        (result / 'manifest.json').write_text('{"postActivation":true}')

    def test_activation_and_later_rollback_keep_post_activation_jobs_no_db_restore(self):
        a.start.side_effect = self.admit_new_prepared
        a.run(self.manifest, self.receipt, 'activate', self.result['manifest_sha256'])
        self.assertEqual(a.REPORT['status'], 'activated')
        backup = (a.BACKUP / 'jobs.sqlite3').read_bytes()
        current = a.retained()
        self.assertEqual(len(current), 1)
        a.run(self.manifest, self.receipt, 'rollback', self.result['manifest_sha256'])
        self.assertEqual(a.retained(), current)
        self.assertEqual((a.BACKUP / 'jobs.sqlite3').read_bytes(), backup)
        with closing(sqlite3.connect(a.BACKUP / 'jobs.sqlite3')) as db:
            self.assertEqual(db.execute('select count(*) from jobs').fetchone()[0], 0)
        self.assertFalse(a.REPORT['databaseRestored'])
        self.assertEqual(a.source_components(self.live), self.manifest['old'])
        self.assertIn('post-activation jobs preserved', a.REPORT['status'])

    def test_smoke_failure_before_admission_restores_old_source(self):
        a.smoke.side_effect = RuntimeError('injected smoke failure')
        with self.assertRaisesRegex(RuntimeError, 'injected'):
            a.run(self.manifest, self.receipt, 'activate', self.result['manifest_sha256'])
        self.assertEqual(a.source_components(self.live), self.manifest['old'])
        a.start.assert_called_once()
        self.assertFalse(json.loads((a.BACKUP / 'activation.json').read_text())['databaseRestored'])

    def test_late_failure_keeps_new_source_and_new_jobs(self):
        def late_failure():
            self.admit_new_prepared()
            raise RuntimeError('injected service health failure')
        a.start.side_effect = late_failure
        with self.assertRaisesRegex(RuntimeError, 'injected'):
            a.run(self.manifest, self.receipt, 'activate', self.result['manifest_sha256'])
        self.assertEqual(a.source_components(self.live), self.manifest['new'])
        self.assertEqual(len(a.retained()), 1)
        self.assertIn('retained after final admission', a.REPORT['status'])

    def test_failed_rollback_smoke_recovers_serving_new_release(self):
        a.run(self.manifest, self.receipt, 'activate', self.result['manifest_sha256'])
        a.smoke.side_effect = RuntimeError('injected old smoke failure')
        with self.assertRaisesRegex(RuntimeError, 'injected'):
            a.run(self.manifest, self.receipt, 'rollback', self.result['manifest_sha256'])
        self.assertEqual(a.source_components(self.live), self.manifest['new'])
        self.assertIn('previously serving release restored', a.REPORT['status'])

    def test_rollback_refuses_queued_post_activation_work_without_stopping_it(self):
        a.run(self.manifest, self.receipt, 'activate', self.result['manifest_sha256'])
        a.stop_empty.reset_mock()
        with closing(sqlite3.connect(self.data / 'jobs.sqlite3')) as db, db:
            db.execute('insert into jobs values(?,?,0,?)', ('c' * 32, None, 'queued'))
        with self.assertRaisesRegex(RuntimeError, 'empty queue'):
            a.run(self.manifest, self.receipt, 'rollback', self.result['manifest_sha256'])
        a.stop_empty.assert_not_called()
        self.assertEqual(a.source_components(self.live), self.manifest['new'])

    def test_expiry_during_rehearsal_restores_old_and_prevents_new_admission(self):
        real_validate = a.validate_receipt
        validations = 0
        def expire(*args, **kwargs):
            nonlocal validations
            validations += 1
            if validations == 2:
                raise RuntimeError('injected receipt expiry')
            return real_validate(*args, **kwargs)
        with patch.object(a, 'validate_receipt', side_effect=expire), self.assertRaisesRegex(RuntimeError, 'expiry'):
            a.run(self.manifest, self.receipt, 'activate', self.result['manifest_sha256'])
        self.assertEqual(a.source_components(self.live), self.manifest['old'])
        a.start.assert_called_once()
        self.assertNotEqual(a.REPORT['status'], 'activated')


class WebStartupTests(unittest.TestCase):
    class Response:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *_): pass
        def read(self): return b'{"user":null}'

    def test_delayed_socket_bind_is_admitted_within_the_fixed_startup_budget(self):
        with patch.object(a.urllib.request, 'urlopen', side_effect=[OSError('not listening'), self.Response()]) as request, patch.object(a.time, 'sleep') as sleep:
            a.web_health()
            self.assertEqual(request.call_count, 2)
            sleep.assert_called_once_with(.5)

    def test_failed_web_start_does_not_report_recovery_or_retry_without_bound(self):
        with patch.object(a.urllib.request, 'urlopen', side_effect=OSError('not listening')) as request, patch.object(a.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'web did not recover'):
                a.web_health()
            self.assertEqual(request.call_count, 20)


if __name__ == '__main__':
    unittest.main()
