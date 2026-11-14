"""Independent local-artifact regressions; no network or scientific-accuracy claims."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from service.observatory.vintage_contract import validate_gauge_snapshot
from service.observatory.vintage_reference import (
    ARTIFACT, REFERENCE_VERSION, build_reference, load_reference, validate_reference,
)
from service.observatory.vintages import MAX_DAYS


CAP = 8 * 1024 * 1024
FIXTURE = Path(__file__).resolve().parents[2] / 'examples/gauge-vintage-receipt/capture.json'


def encoded(value):
    # Independent encoder: do not use the helper's serialization implementation.
    return json.dumps(value, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=True, allow_nan=False).encode('utf-8')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def seal_snapshot(snapshot):
    snapshot['snapshotHash'] = digest(encoded(
        {key: value for key, value in snapshot.items() if key != 'snapshotHash'}))


def seal_record(record):
    record['contentHash'] = digest(encoded({
        key: record[key] for key in ('identity', 'date', 'value', 'quality', 'qualifiers',
                                     'stationTimeProperties')
    }))
    record['versionHash'] = digest(encoded(
        {key: value for key, value in record.items() if key != 'versionHash'}))


class VintageReferenceTests(unittest.TestCase):
    def setUp(self):
        self.vintage = json.loads(FIXTURE.read_text(encoding='utf-8'))[0]
        self.snapshot = self.vintage['snapshot']
        self.request = {key: self.snapshot[key] for key in ('start', 'end')}
        self.processed = self.snapshot['issueTime']
        self.reference, self.raw = build_reference(self.vintage, max_bytes=CAP)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def reject(self, function, *args, **kwargs):
        with self.assertRaisesRegex(ValueError, '^Invalid gauge receipt reference$'):
            function(*args, **kwargs)

    def validate(self, reference, **kwargs):
        return validate_reference(reference, self.request, self.processed, **kwargs)

    def repin(self, raw):
        reference = copy.deepcopy(self.reference)
        reference['artifact'].update(bytes=len(raw), sha256=digest(raw))
        return reference

    def write(self, raw):
        (self.directory / ARTIFACT).write_bytes(raw)

    def test_exact_canonical_lf_bytes_and_independent_digest_pins(self):
        self.assertEqual(self.raw, encoded(self.snapshot) + b'\n')
        self.assertTrue(self.raw.endswith(b'\n'))
        self.assertFalse(self.raw.endswith(b'\n\n'))
        self.assertEqual(self.reference['status'], 'referenced')
        self.assertEqual(self.reference['referenceVersion'], REFERENCE_VERSION)
        self.assertEqual(self.reference['artifact'], {
            'name': 'gauge-vintage-snapshot.json', 'bytes': len(self.raw),
            'sha256': digest(self.raw),
        })
        self.assertNotEqual(digest(self.raw), digest(self.raw[:-1]))
        semantic_digest = digest(encoded({key: value for key, value in self.snapshot.items()
                                          if key != 'snapshotHash'}))
        self.assertEqual(self.reference['snapshotRef']['snapshotHash'], semantic_digest)
        self.assertEqual(self.reference['snapshotRef']['observationCount'], 3)
        self.assertEqual(self.reference['snapshotRef']['qualifiedRecords'], 0)
        self.assertEqual(self.reference['snapshotRef']['withdrawnRecords'], 0)

    def test_build_detaches_nested_caller_metadata_and_bytes(self):
        frozen = copy.deepcopy(self.vintage)
        self.reference['receipt']['insertedVersions'] = 1
        self.reference['snapshotRef']['identity']['station'] = 'USGS-12345678'
        self.assertEqual(self.vintage, frozen)
        reference, raw = build_reference(self.vintage, max_bytes=CAP)
        saved = copy.deepcopy(reference)
        self.vintage['receipt']['insertedVersions'] = 2
        self.snapshot['identity']['station'] = 'USGS-87654321'
        self.snapshot['observations'][0]['value'] = 999.0
        self.assertEqual(reference, saved)
        self.assertEqual(raw, self.raw)

    def test_validate_and_load_return_detached_objects(self):
        frozen = copy.deepcopy(self.reference)
        result = self.validate(self.reference, snapshot=self.snapshot)
        result['snapshotRef']['identity']['station'] = 'USGS-12345678'
        result['receipt']['insertedVersions'] = 1
        self.assertEqual(self.reference, frozen)
        self.write(self.raw)
        loaded = load_reference(self.directory, self.reference, max_bytes=CAP)
        self.assertEqual(loaded, self.snapshot)
        loaded['observations'][0]['identity']['station'] = 'USGS-87654321'
        self.assertEqual(load_reference(self.directory, self.reference, max_bytes=CAP),
                         self.snapshot)
        self.assertEqual((self.directory / ARTIFACT).read_bytes(), self.raw)

    def test_archived_metadata_is_structural_not_full_reproduction(self):
        bad = copy.deepcopy(self.reference)
        bad['snapshotRef'].update(qualifiedRecords=1, withdrawnRecords=1,
                                 snapshotHash='0' * 64)
        bad['artifact']['sha256'] = '0' * 64
        self.assertEqual(self.validate(bad), bad)
        self.reject(validate_reference, bad, self.request, self.processed,
                    snapshot=self.snapshot)
        self.reject(load_reference, self.directory, bad, max_bytes=CAP)

    def test_full_join_rejects_structurally_valid_tampered_pins_counts_identity(self):
        mutations = {
            'qualified count': lambda r: r['snapshotRef'].update(qualifiedRecords=1),
            'withdrawn count': lambda r: r['snapshotRef'].update(withdrawnRecords=1),
            'population': lambda r: r['snapshotRef'].update(observationCount=2, unknownDays=1),
            'snapshot pin': lambda r: r['snapshotRef'].update(snapshotHash='0' * 64),
            'byte pin': lambda r: r['artifact'].update(sha256='0' * 64),
            'byte count': lambda r: r['artifact'].update(bytes=len(self.raw) + 1),
            'station identity': lambda r: r['snapshotRef']['identity'].update(station='USGS-12345678'),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                bad = copy.deepcopy(self.reference)
                mutate(bad)
                self.assertEqual(self.validate(bad), bad)
                self.reject(validate_reference, bad, self.request, self.processed,
                            snapshot=self.snapshot)

    def test_structurally_impossible_counts_and_hashes_rejected(self):
        cases = [
            ('snapshotRef', 'observationCount', 4),
            ('snapshotRef', 'unknownDays', 1),
            ('snapshotRef', 'qualifiedRecords', 4),
            ('snapshotRef', 'withdrawnRecords', -1),
            ('snapshotRef', 'snapshotHash', 'A' * 64),
            ('artifact', 'sha256', 'not-a-hash'),
            ('artifact', 'bytes', CAP + 1),
            ('receipt', 'insertedVersions', MAX_DAYS + 1),
        ]
        for section, key, value in cases:
            with self.subTest(section=section, key=key, value=value):
                bad = copy.deepcopy(self.reference)
                bad[section][key] = value
                self.reject(validate_reference, bad, self.request, self.processed)

    def test_request_and_processing_time_bindings(self):
        for key in ('start', 'end'):
            with self.subTest(key=key):
                request = dict(self.request, **{key: '2025-06-02'})
                self.reject(validate_reference, self.reference, request, self.processed)
        self.reject(validate_reference, self.reference, self.request,
                    '2026-10-12T13:51:34.485315Z')
        self.reject(validate_reference, self.reference, self.request, 'not-a-time')
        bad = copy.deepcopy(self.reference)
        bad['receipt']['receivedAt'] = '2026-10-12T13:51:34.485315Z'
        self.reject(validate_reference, bad, self.request, self.processed)

    def test_exact_size_cap_accepts_boundary_rejects_one_less(self):
        self.assertEqual(build_reference(self.vintage, max_bytes=len(self.raw)),
                         (self.reference, self.raw))
        self.reject(build_reference, self.vintage, max_bytes=len(self.raw) - 1)
        self.write(self.raw)
        self.assertEqual(load_reference(self.directory, self.reference,
                                        max_bytes=len(self.raw)), self.snapshot)
        self.reject(load_reference, self.directory, self.reference,
                    max_bytes=len(self.raw) - 1)

    def test_invalid_caps_cannot_raise_ceiling_or_accept_bools(self):
        for cap in (False, True, 0, -1, CAP + 1, float(CAP), str(CAP), None):
            with self.subTest(cap=cap):
                self.reject(build_reference, self.vintage, max_bytes=cap)
                self.reject(load_reference, self.directory, self.reference, max_bytes=cap)

    def test_numeric_metadata_bools_rejected(self):
        fields = {
            'receipt': ('insertedVersions', 'unchangedRecords'),
            'snapshotRef': ('calendarDays', 'unknownDays', 'observationCount',
                            'qualifiedRecords', 'withdrawnRecords'),
            'artifact': ('bytes',),
        }
        for section, keys in fields.items():
            for key in keys:
                with self.subTest(section=section, key=key):
                    bad = copy.deepcopy(self.reference)
                    bad[section][key] = True
                    self.reject(validate_reference, bad, self.request, self.processed)
        for section, keys in {'receipt': fields['receipt'],
                              'snapshot': ('calendarDays', 'unknownDays')}.items():
            for key in keys:
                with self.subTest(wrapper=section, key=key):
                    bad = copy.deepcopy(self.vintage)
                    bad[section][key] = True
                    self.reject(build_reference, bad, max_bytes=CAP)
        for key in ('revision', 'value'):
            with self.subTest(record=key):
                bad = copy.deepcopy(self.vintage)
                bad['snapshot']['observations'][0][key] = True
                self.reject(build_reference, bad, max_bytes=CAP)

    def test_unknown_reference_keys_rejected_at_every_schema_level(self):
        for path in ((), ('receipt',), ('snapshotRef',), ('snapshotRef', 'identity'),
                     ('artifact',)):
            with self.subTest(path=path):
                bad = copy.deepcopy(self.reference)
                target = bad
                for key in path:
                    target = target[key]
                target['unexpected'] = 1
                self.reject(validate_reference, bad, self.request, self.processed)

    def test_unknown_snapshot_keys_rejected_before_build(self):
        for path in ((), ('receipt',), ('snapshot',), ('snapshot', 'identity'),
                     ('snapshot', 'observations', 0),
                     ('snapshot', 'observations', 0, 'identity'),
                     ('snapshot', 'observations', 0, 'stationTimeProperties')):
            with self.subTest(path=path):
                bad = copy.deepcopy(self.vintage)
                target = bad
                for key in path:
                    target = target[key]
                target['unexpected'] = 1
                self.reject(build_reference, bad, max_bytes=CAP)

    def test_existing_2000_day_ceiling_is_not_raised(self):
        self.assertEqual(MAX_DAYS, 2000)
        bad = copy.deepcopy(self.vintage)
        # This inclusive range is exactly 2001 days.
        bad['snapshot'].update(start='2020-01-01', end='2025-06-23',
                               calendarDays=2001, unknownDays=1998)
        self.reject(build_reference, bad, max_bytes=CAP)
        reference = copy.deepcopy(self.reference)
        reference['snapshotRef'].update(start='2020-01-01', end='2025-06-23',
                                        calendarDays=2001, unknownDays=1998)
        self.reject(validate_reference, reference,
                    {'start': '2020-01-01', 'end': '2025-06-23'}, self.processed)

    def test_valid_qualified_withdrawn_and_unknown_population(self):
        vintage = copy.deepcopy(self.vintage)
        snapshot = vintage['snapshot']
        snapshot['observations'].pop()
        snapshot['unknownDays'] = 1
        snapshot['observations'][0]['qualifiers'] = ['Estimated']
        snapshot['observations'][1]['value'] = None
        for row in snapshot['observations']:
            seal_record(row)
        seal_snapshot(snapshot)
        validate_gauge_snapshot(snapshot)
        reference, raw = build_reference(vintage, max_bytes=CAP)
        header = reference['snapshotRef']
        self.assertEqual((header['observationCount'], header['qualifiedRecords'],
                          header['withdrawnRecords'], header['unknownDays']), (2, 1, 1, 1))
        self.assertEqual(self.validate(reference, snapshot=snapshot), reference)
        self.write(raw)
        self.assertEqual(load_reference(self.directory, reference, max_bytes=CAP), snapshot)

    def test_corrupt_and_truncated_files_rejected_even_with_updated_byte_digest(self):
        for name, raw in (('truncated', self.raw[:-8]), ('not-json', b'not json\n'),
                          ('invalid-utf8', b'\xff\n')):
            with self.subTest(name=name):
                self.write(raw)
                self.reject(load_reference, self.directory, self.repin(raw), max_bytes=CAP)

    def test_noncanonical_files_rejected_even_with_updated_byte_digest(self):
        cases = {
            'pretty': json.dumps(self.snapshot, indent=2).encode('utf-8') + b'\n',
            'no-lf': self.raw[:-1],
            'extra-lf': self.raw + b'\n',
            'crlf': self.raw[:-1] + b'\r\n',
            'reordered': json.dumps(self.snapshot, separators=(',', ':')).encode('utf-8') + b'\n',
        }
        for name, raw in cases.items():
            with self.subTest(name=name):
                self.assertNotEqual(raw, self.raw)
                self.write(raw)
                self.reject(load_reference, self.directory, self.repin(raw), max_bytes=CAP)

    def test_duplicate_keys_rejected_even_with_updated_byte_digest(self):
        raw = self.raw.replace(b'"calendarDays":3', b'"calendarDays":3,"calendarDays":3', 1)
        self.assertNotEqual(raw, self.raw)
        self.write(raw)
        self.reject(load_reference, self.directory, self.repin(raw), max_bytes=CAP)

    def test_nonfinite_numbers_rejected_even_with_updated_byte_digest(self):
        for token in (b'NaN', b'Infinity', b'-Infinity', b'1e999'):
            with self.subTest(token=token):
                raw = self.raw.replace(b'"value":14300.0', b'"value":' + token, 1)
                self.assertNotEqual(raw, self.raw)
                self.write(raw)
                self.reject(load_reference, self.directory, self.repin(raw), max_bytes=CAP)

    def test_rehashed_semantically_invalid_snapshot_cannot_bypass_full_join(self):
        cases = {
            'stale content hash': lambda s: s['observations'][0].update(value=14301.0),
            'wrong row identity': lambda s: s['observations'][0]['identity'].update(station='USGS-12345678'),
            'duplicate day': lambda s: s['observations'][1].update(date='2025-06-01'),
            'wrong unknown count': lambda s: s.update(unknownDays=1),
        }
        for name, mutate in cases.items():
            with self.subTest(name=name):
                snapshot = copy.deepcopy(self.snapshot)
                mutate(snapshot)
                seal_snapshot(snapshot)
                raw = encoded(snapshot) + b'\n'
                reference = self.repin(raw)
                reference['snapshotRef']['snapshotHash'] = snapshot['snapshotHash']
                self.write(raw)
                self.reject(load_reference, self.directory, reference, max_bytes=CAP)

    def test_valid_alternate_snapshot_still_requires_original_semantic_pin(self):
        snapshot = copy.deepcopy(self.snapshot)
        snapshot['observations'][0]['sourceResponseHash'] = '0' * 64
        seal_record(snapshot['observations'][0])
        seal_snapshot(snapshot)
        validate_gauge_snapshot(snapshot)
        raw = encoded(snapshot) + b'\n'
        self.write(raw)
        self.reject(load_reference, self.directory, self.repin(raw), max_bytes=CAP)

    def test_byte_digest_size_and_fixed_name_enforced(self):
        self.write(self.raw)
        bad = copy.deepcopy(self.reference)
        bad['artifact']['sha256'] = '0' * 64
        self.reject(load_reference, self.directory, bad, max_bytes=CAP)
        self.write(self.raw + b' ')
        self.reject(load_reference, self.directory, self.reference, max_bytes=CAP)
        self.write(self.raw)
        for name in ('../gauge-vintage-snapshot.json', '/tmp/gauge-vintage-snapshot.json',
                     'other.json'):
            with self.subTest(name=name):
                bad = copy.deepcopy(self.reference)
                bad['artifact']['name'] = name
                self.reject(load_reference, self.directory, bad, max_bytes=CAP)

    def test_fixed_name_symlink_rejected_even_if_target_has_exact_valid_bytes(self):
        target = self.directory / 'target.json'
        target.write_bytes(self.raw)
        (self.directory / ARTIFACT).symlink_to(target)
        self.reject(load_reference, self.directory, self.reference, max_bytes=CAP)
        self.assertEqual(target.read_bytes(), self.raw)

    def test_fixed_name_fifo_rejected_without_blocking(self):
        os.mkfifo(self.directory / ARTIFACT)
        script = (
            'import json,sys\n'
            'from service.observatory.vintage_reference import load_reference\n'
            'try:\n'
            ' load_reference(sys.argv[1],json.load(sys.stdin),max_bytes=8388608)\n'
            'except ValueError as exc:\n'
            ' print(str(exc))\n'
            'else:\n'
            ' sys.exit("FIFO accepted")\n'
        )
        result = subprocess.run([sys.executable, '-c', script, str(self.directory)],
                                input=json.dumps(self.reference), text=True,
                                capture_output=True, timeout=3,
                                cwd=Path(__file__).resolve().parents[2])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'Invalid gauge receipt reference')


if __name__ == '__main__':
    unittest.main()
