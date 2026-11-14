"""Synthetic ledger behavior/resource tests; no field or forecasting claims."""
import fcntl
import hashlib
import os
import itertools
import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch

from service.observatory.vintages import (
    MAX_BYTES, MAX_DAYS, MAX_VERSIONS, POLICY_VERSION,
    ObservationVintageLedger, VintageError, canonical_hash, canonical_json,
)

IDENTITY = dict(station='USGS-12345678', timeSeriesId='series-1',
                parameter='00060', statistic='00003', unit='ft^3/s')
PROPS = dict(country_code='US', time_zone_abbreviation='PST', uses_daylight_savings='Y')
R1 = hashlib.sha256(b'response one').hexdigest()
R2 = hashlib.sha256(b'response two').hexdigest()
M1 = hashlib.sha256(b'metadata one').hexdigest()
T1 = '2026-01-04T12:00:00Z'
T2 = '2026-01-05T12:00:00Z'
T3 = '2026-01-06T12:00:00Z'


def record(day='2026-01-01', value=10, quality='provisional', **extra):
    return dict(date=day, value=value, quality=quality, **extra)


class VintageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.ledger = self.make()

    def make(self, owner='owner-one', **kw):
        return ObservationVintageLedger(self.root, owner, reserve_bytes=0, **kw)

    def capture(self, records=None, at=T1, ledger=None, identity=None, **kw):
        options = dict(station_time_properties=PROPS, response_hash=R1,
                       metadata_hash=M1, received_at=at)
        options.update(kw)
        return (ledger or self.ledger).capture(identity or IDENTITY,
                                             records or [record()], **options)

    def snapshot(self, at=T3, ledger=None, identity=None, **kw):
        options = dict(start='2026-01-01', end='2026-01-03')
        options.update(kw)
        return (ledger or self.ledger).as_of(identity or IDENTITY, at, **options)

    def count(self):
        with sqlite3.connect(self.root / 'gauge-vintages.sqlite3') as db:
            return db.execute('SELECT COUNT(*) FROM versions').fetchone()[0]

    def fails(self, code, action):
        with self.assertRaises(VintageError) as raised:
            action()
        self.assertEqual(raised.exception.code, code)
        return str(raised.exception)

    def test_revisions_A_B_A_and_old_issue_freezes_lineage(self):
        self.capture(at=T1)
        early = self.snapshot(T1)
        self.capture([record(value=20)], T2, response_hash=R2)
        self.capture(at=T3)
        self.assertEqual(self.count(), 3)
        self.assertEqual(self.snapshot(T1), early)
        middle = self.snapshot(T2)['observations'][0]
        final = self.snapshot()['observations'][0]
        self.assertEqual(middle['value'], 20)
        self.assertEqual(final['value'], 10)
        self.assertEqual(final['revision'], 3)
        self.assertEqual(final['firstReceivedAt'], '2026-01-04T12:00:00.000000Z')
        self.assertEqual(final['contentHash'], early['observations'][0]['contentHash'])
        self.assertNotEqual(final['versionHash'], early['observations'][0]['versionHash'])
        self.assertEqual(middle['sourceResponseHash'], R2)

    def test_unchanged_repeat_does_not_rewrite_first_receipt_or_lineage(self):
        self.capture([record(qualifiers=['P', 'A'])])
        first = self.snapshot()['observations'][0]
        out = self.capture([record(value=10.0, qualifiers=['A', 'P', 'P'])], T2,
                           response_hash=R2, metadata_hash=R2)
        self.assertEqual(out['insertedVersions'], 0)
        self.assertEqual(out['unchangedRecords'], 1)
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.snapshot()['observations'][0], first)
        self.fails('receipt_order', lambda: self.capture(at=T1))

    def test_quality_qualifier_null_and_metadata_are_revisions(self):
        self.capture()
        self.capture([record(quality='approved')], T2)
        self.capture([record(quality='approved', qualifiers=['A'])], T3)
        self.capture([record(value=None, quality='withdrawn')], '2026-01-07T12:00:00Z')
        self.capture([record(value=None, quality='withdrawn')], '2026-01-08T12:00:00Z',
                     station_time_properties=dict(PROPS, time_zone_abbreviation='MST'))
        self.assertEqual(self.count(), 5)
        null = self.snapshot('2026-01-08T12:00:00Z')['observations'][0]
        self.assertIsNone(null['value'])
        self.assertEqual(null['quality'], 'withdrawn')
        self.assertEqual(null['stationTimeProperties']['time_zone_abbreviation'], 'MST')
        self.assertEqual(self.snapshot(T2)['observations'][0]['quality'], 'approved')
        self.assertEqual(self.snapshot(T1)['observations'][0]['stationTimeProperties'], PROPS)

    def test_missing_day_is_unknown_and_omission_does_not_delete(self):
        self.capture([record(), record('2026-01-03', 30)])
        self.capture([record(value=12)], T2)
        snapshot = self.snapshot()
        self.assertEqual(snapshot['unknownDays'], 1)
        self.assertEqual([r['date'] for r in snapshot['observations']], ['2026-01-01', '2026-01-03'])
        self.assertEqual(snapshot['observations'][1]['value'], 30)
        before = self.snapshot('2026-01-04T11:59:59.999999Z')
        self.assertEqual(before['observations'], [])
        self.assertEqual(before['unknownDays'], 3)

    def test_owner_station_series_isolation_and_no_owner_export(self):
        self.capture()
        other_owner = self.make('owner-two')
        self.assertEqual(self.snapshot(ledger=other_owner)['observations'], [])
        self.capture([record(value=44)], ledger=other_owner)
        self.assertEqual(self.snapshot(ledger=other_owner)['observations'][0]['value'], 44)
        self.assertEqual(self.snapshot()['observations'][0]['value'], 10)
        for changed in (dict(IDENTITY, timeSeriesId='series-2'), dict(IDENTITY, station='USGS-123456789012345')):
            self.assertEqual(self.snapshot(identity=changed)['observations'], [])
            self.capture([record(value=99)], identity=changed)
            self.assertEqual(self.snapshot(identity=changed)['observations'][0]['value'], 99)
        exported = canonical_json(self.snapshot()) + canonical_json(self.capture(at=T2))
        self.assertNotIn('owner', exported)
        self.assertNotIn('owner-one', exported)
        self.assertNotIn('owner-two', exported)

    def test_input_and_qualifier_permutations_produce_identical_snapshots(self):
        rows = [record(), record('2026-01-02', 20, qualifiers=['P', 'A']), record('2026-01-03', None)]
        snapshots = []
        for permutation in itertools.permutations(rows):
            with tempfile.TemporaryDirectory() as root:
                ledger = ObservationVintageLedger(Path(root).resolve(), 'same', reserve_bytes=0)
                identity = dict(reversed(list(IDENTITY.items())))
                self.capture(list(permutation), ledger=ledger, identity=identity,
                             station_time_properties=dict(reversed(list(PROPS.items()))))
                snapshots.append(self.snapshot(ledger=ledger))
        self.assertTrue(all(snapshot == snapshots[0] for snapshot in snapshots))

    def test_equal_timestamps_are_stable_and_do_not_rank_arrival_order(self):
        self.capture()
        self.assertEqual(self.capture()['insertedVersions'], 0)
        self.fails('receipt_tie', lambda: self.capture([record(value=11), record('2026-01-02', 22)]))
        self.assertEqual(self.count(), 1)
        self.capture([record('2026-01-02', 22)])
        self.assertEqual(self.count(), 2)
        snapshots = []
        for rows in ([record(), record('2026-01-02', 22)], [record('2026-01-02', 22), record()]):
            with tempfile.TemporaryDirectory() as root:
                ledger = ObservationVintageLedger(Path(root).resolve(), 'same', reserve_bytes=0)
                for row in rows:
                    self.capture([row], ledger=ledger)
                snapshots.append(self.snapshot(ledger=ledger))
        self.assertEqual(snapshots[0], snapshots[1])

    def test_caller_must_resolve_even_equal_duplicate_dates(self):
        self.fails('invalid_input', lambda: self.capture([record(), record()]))
        self.assertEqual(self.count(), 0)
        # A caller-resolved equal-value duplicate preserves the mixed approval label.
        out = self.capture([record(quality='mixed duplicate approval status: approved | provisional', qualifiers=['A', 'P'])])
        self.assertEqual(out['insertedVersions'], 1)
        self.assertEqual(self.snapshot()['observations'][0]['qualifiers'], ['A', 'P'])

    def test_timestamp_validation_normalization_subsecond_cutoff_restart(self):
        self.capture(at='2026-01-04T15:30:00.123456+03:30')
        before = self.snapshot('2026-01-04T12:00:00.123455Z')
        self.assertEqual(before['observations'], [])
        exact = self.snapshot(datetime(2026, 1, 4, 12, 0, 0, 123456, timezone.utc))
        self.assertEqual(len(exact['observations']), 1)
        self.assertEqual(exact['observations'][0]['receivedAt'], '2026-01-04T12:00:00.123456Z')
        restarted = self.make()
        self.assertEqual(self.snapshot(ledger=restarted), self.snapshot())
        self.fails('receipt_order', lambda: self.capture(at=T1, ledger=restarted))
        for bad in ('2026-01-04', '20260104T12:00:00Z', '2026-W01-1T12:00:00Z',
                    '2026-01-04T12:00:00', '2026-01-04T12:00:00-00:00',
                    '2026-01-04T12:00:00+00:99', '2026-01-04T12:00:00+24:00',
                    '2026-01-04T12:00:60Z', '2026-01-04T12:00:00.1234567Z',
                    datetime(2026, 1, 4, 12), True, None):
            self.fails('invalid_input', lambda bad=bad: self.capture(at=bad))
            self.fails('invalid_input', lambda bad=bad: self.snapshot(bad))

    def test_hash_reproduction_and_detached_snapshots(self):
        self.capture()
        snapshot = self.snapshot()
        original = canonical_json(snapshot)
        expected = snapshot.pop('snapshotHash')
        raw = json.dumps(snapshot, ensure_ascii=True, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), expected)
        observation = snapshot['observations'][0]
        version_hash = observation.pop('versionHash')
        self.assertEqual(canonical_hash(observation), version_hash)
        content = {k: observation[k] for k in ('identity', 'date', 'value', 'quality', 'qualifiers', 'stationTimeProperties')}
        self.assertEqual(canonical_hash(content), observation['contentHash'])
        self.assertEqual(canonical_hash(PROPS), observation['stationPropertiesHash'])
        observation['quality'] = 'mutated'
        self.assertEqual(canonical_json(self.snapshot()), original)
        self.assertEqual(snapshot['availabilityBasis'], 'local-receipt-only')
        self.assertEqual(snapshot['policyVersion'], POLICY_VERSION)

    def test_nan_bool_negative_and_nonexact_integer_rejected_atomically(self):
        self.capture()
        before = self.snapshot()
        for bad in (True, False, float('nan'), float('inf'), -float('inf'), -1, '10', 2**53 + 1, 10**1000, [], {}):
            self.fails('invalid_input', lambda bad=bad: self.capture([record('2026-01-02', 22), record(value=bad)], T2))
            self.assertEqual(self.snapshot(), before)
        self.capture([record('2026-01-02', -0.0)], T2)
        self.assertEqual(self.snapshot()['observations'][1]['value'], 0.0)

    def test_all_valid_signed_principals_are_opaque_scoped_sql_values(self):
        for owner in ('x'*256,'../secret','/private/owner',"x';DROP_TABLE_versions;--",'<opaque>@%'):
            ledger=self.make(owner)
            self.capture(ledger=ledger)
            self.assertEqual(len(self.snapshot(ledger=ledger)['observations']),1)
            other=self.make(owner+'z' if len(owner)<256 else 'y'+owner[1:])
            self.assertEqual(self.snapshot(ledger=other)['observations'],[])
        self.assertEqual({p.name for p in self.root.iterdir()},{'gauge-vintages.sqlite3','gauge-vintages.lock'})

    def test_hostile_identity_path_and_oversize_inputs(self):
        for field, bad in (('station', '../12345678'), ('station', 'USGS-1234567'),
                           ('station', 'USGS-1234567890123456'), ('timeSeriesId', '../secret'),
                           ('timeSeriesId', 'a/b'), ('timeSeriesId', "x'; DROP TABLE versions;--"),
                           ('timeSeriesId', 'x'*129), ('parameter', '00065'),
                           ('statistic', '00001'), ('unit', 'm^3/s'), ('parameter', True)):
            self.fails('invalid_input', lambda field=field, bad=bad: self.capture(identity=dict(IDENTITY, **{field: bad})))
        for owner in ('', True, 'x'*257, 'space owner', 'bad\nowner', '非ASCII'):
            self.fails('invalid_input', lambda owner=owner: self.make(owner))
        for bad in (record(quality='x'*257), record(quality='<script>'), record(quality='x\nsecret'),
                    record(qualifiers=['x']*17), record(qualifiers=['x'*65]), record(qualifiers=[True]),
                    record(qualifiers='P'), dict(record(), surprise='private'),
                    dict(date='2026-01-01', quality='missing'), record(day='20260101'),
                    record(day='2026-02-30'), record(day=' 2026-01-01')):
            self.fails('invalid_input', lambda bad=bad: self.capture([bad]))
        for props in (dict(PROPS, secret='private'), dict(PROPS, uses_daylight_savings=True),
                      dict(PROPS, country_code='x'*33), []):
            self.fails('invalid_input', lambda props=props: self.capture(station_time_properties=props))
        for kw in ({'metadata_hash': '../secret'}, {'response_hash': 'a'*65}, {'response_hash': 'A'*64}):
            self.fails('invalid_input', lambda kw=kw: self.capture(**kw))
        self.fails('invalid_input', lambda: self.ledger.capture(IDENTITY, [], station_time_properties=PROPS,
                    response_hash=R1, metadata_hash=M1, received_at=T1))
        self.fails('invalid_input', lambda: self.capture([record()]*2001))
        self.assertEqual(self.count(), 0)

    def test_date_window_bounds_and_null_vs_unknown(self):
        self.capture([record(value=None, quality='explicit missing')], station_time_properties={})
        snapshot = self.snapshot()
        self.assertEqual(len(snapshot['observations']), 1)
        self.assertEqual(snapshot['unknownDays'], 2)
        for kw in ({'start': '2026-01-04'}, {'start': '2026-W01-1'}, {'end': '2036-01-01'}):
            self.fails('invalid_input', lambda kw=kw: self.snapshot(**kw))

    def test_row_cap_rolls_back_whole_batch_and_survives_restart(self):
        ledger = self.make(max_versions=2)
        self.capture(ledger=ledger)
        before = self.snapshot(ledger=ledger)
        self.fails('version_limit', lambda: self.capture([record(value=11), record('2026-01-02', 22)], T2, ledger=ledger))
        self.assertEqual(self.snapshot(ledger=ledger), before)
        self.assertEqual(self.count(), 1)
        self.capture([record(value=11)], T2, ledger=ledger)
        self.assertEqual(self.count(), 2)
        restarted = self.make(max_versions=2)
        self.assertEqual(self.capture([record(value=11)], T3, ledger=restarted)['insertedVersions'], 0)
        self.fails('version_limit', lambda: self.capture([record(value=12)], '2026-01-07T00:00:00Z', ledger=restarted))
        self.fails('invalid_input', lambda: self.make(max_versions=MAX_VERSIONS+1))
        self.fails('invalid_input', lambda: self.make(max_bytes=MAX_BYTES+1))

    def test_disk_and_shared_storage_admission_fail_without_acceptance(self):
        self.capture()
        before = self.snapshot()
        usage = type('Usage', (), {'free': 0})()
        with patch('service.observatory.vintages.shutil.disk_usage', return_value=usage):
            self.fails('storage_limit', lambda: self.capture([record(value=22)], T2))
        self.assertEqual(self.snapshot(), before)
        ledger = self.make(storage_bytes=MAX_BYTES)
        unrelated = self.root / 'other-service-data'
        unrelated.write_bytes(b'x')
        self.fails('storage_limit', lambda: self.capture([record(value=22)], T2, ledger=ledger))
        self.assertEqual(unrelated.read_bytes(), b'x')
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.count(), 1)

    def test_real_sqlite_page_cap_rolls_back_partial_insert(self):
        ledger = self.make(max_bytes=192*1024)
        self.capture(ledger=ledger)
        before = self.snapshot(ledger=ledger)
        rows = [record((datetime(2020, 1, 1) + timedelta(days=i)).date().isoformat(),
                       quality='q'*256, qualifiers=['x'*64]*16) for i in range(100)]
        # SQLite SQLITE_FULL happens during the batch, after some row inserts.
        self.fails('storage_limit', lambda: self.capture(rows, T2, ledger=ledger))
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.snapshot(ledger=ledger), before)
        self.assertLessEqual(sum(p.stat().st_size for p in self.root.glob('gauge-vintages.*')), 192*1024)
        # The rejected batch did not advance the monotonic receipt head.
        self.assertEqual(self.capture(at=T1, ledger=ledger)['insertedVersions'], 0)

    def test_atomic_failure_after_insert_before_commit(self):
        self.capture()
        before = self.snapshot()
        real_admit = self.ledger._admit
        calls = 0
        def fail_second_check():
            nonlocal calls
            calls += 1
            if calls == 2:
                raise VintageError('storage_limit')
            real_admit()
        with patch.object(self.ledger, '_admit', side_effect=fail_second_check):
            self.fails('storage_limit', lambda: self.capture([record(value=22)], T2))
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.snapshot(), before)

    def test_2000_actual_days_atomic_restart_and_wal_envelope(self):
        rows = [record((datetime(2020, 1, 1) + timedelta(days=i)).date().isoformat(), i)
                for i in range(MAX_DAYS)]
        self.assertEqual(self.capture(rows)['insertedVersions'], MAX_DAYS)
        snapshot = self.snapshot(start=rows[0]['date'], end=rows[-1]['date'])
        self.assertEqual(snapshot['unknownDays'], 0)
        self.assertEqual(len(snapshot['observations']), MAX_DAYS)
        self.assertEqual(self.count(), MAX_DAYS)
        # Keep a SQLite connection open so WAL/SHM remain observable after commit.
        with sqlite3.connect(self.root / 'gauge-vintages.sqlite3') as reader:
            self.assertEqual(reader.execute('PRAGMA journal_mode').fetchone()[0], 'wal')
            revised = [dict(row, quality='approved') for row in rows]
            self.capture(revised, T2)
            sizes = {p.name: p.stat().st_size for p in self.root.glob('gauge-vintages.*')}
            self.assertGreater(sizes.get('gauge-vintages.sqlite3-wal', 0), 0)
            self.assertGreater(sizes.get('gauge-vintages.sqlite3-shm', 0), 0)
            self.assertLessEqual(sum(sizes.values()), MAX_BYTES)
        self.assertEqual(self.snapshot(ledger=self.make(), start=rows[0]['date'], end=rows[-1]['date']),
                         self.snapshot(start=rows[0]['date'], end=rows[-1]['date']))

    def test_history_rows_are_immutable_at_sql_layer(self):
        self.capture()
        with sqlite3.connect(self.root / 'gauge-vintages.sqlite3') as db:
            for sql in ('UPDATE versions SET received_at="2099-01-01"', 'DELETE FROM versions'):
                with self.assertRaises(sqlite3.IntegrityError):
                    db.execute(sql)
        self.assertEqual(self.count(), 1)

    def test_global_row_cap_includes_other_owners_without_exporting_counts(self):
        ledger = self.make(max_versions=1)
        self.capture(ledger=ledger)
        other = self.make('owner-two', max_versions=1)
        self.fails('version_limit', lambda: self.capture(ledger=other))
        self.assertEqual(self.snapshot(ledger=other)['observations'], [])
        self.assertEqual(self.count(), 1)

    def test_lock_contention_fails_without_wait_or_partial_acceptance(self):
        self.capture()
        lock = os.open(self.root / 'gauge-vintages.lock', os.O_RDWR)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.fails('ledger_unavailable', lambda: self.capture([record(value=22)], T2))
        finally:
            os.close(lock)
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.capture(at=T1)['insertedVersions'], 0)

    def test_pinned_external_reader_blocks_wal_growth_without_acceptance(self):
        reader = sqlite3.connect(self.root / 'gauge-vintages.sqlite3', isolation_level=None)
        try:
            reader.execute('PRAGMA journal_mode').fetchone()
            self.capture()
            reader.execute('BEGIN')
            reader.execute('SELECT COUNT(*) FROM versions').fetchone()
            self.fails('ledger_unavailable', lambda: self.capture([record(value=22)], T2))
            self.assertEqual(reader.execute('SELECT COUNT(*) FROM versions').fetchone()[0], 1)
            self.assertLessEqual(sum(p.stat().st_size for p in self.root.glob('gauge-vintages.*')), MAX_BYTES)
            reader.rollback()
        finally:
            reader.close()
        self.assertEqual(self.capture(at=T1)['insertedVersions'], 0)
        self.assertEqual(self.count(), 1)

    def test_private_database_wal_shm_and_lock_ignore_caller_umask(self):
        for mask in (0o000, 0o777):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                unrelated = root / 'unrelated'
                unrelated.write_bytes(b'untouched')
                unrelated.chmod(0o644)
                previous = os.umask(mask)
                try:
                    ledger = ObservationVintageLedger(root, 'private', reserve_bytes=0)
                    with sqlite3.connect(root / 'gauge-vintages.sqlite3') as keeper:
                        keeper.execute('PRAGMA journal_mode').fetchone()
                        self.capture(ledger=ledger)
                        paths = list(root.glob('gauge-vintages.*'))
                        self.assertEqual(len(paths), 4)
                        for path in paths:
                            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                    self.assertEqual(unrelated.stat().st_mode & 0o777, 0o644)
                    self.assertEqual(unrelated.read_bytes(), b'untouched')
                finally:
                    os.umask(previous)

    def test_sanitized_operational_error_and_symlink_rejection(self):
        with patch('service.observatory.vintages.sqlite3.connect', side_effect=sqlite3.OperationalError('PRIVATE /secret owner-one')):
            message = self.fails('ledger_unavailable', lambda: self.capture())
            self.assertNotIn('PRIVATE', message)
            self.assertNotIn('owner-one', message)
            self.assertNotIn(str(self.root), message)
        link = self.root / 'root-link'
        link.symlink_to(self.root, target_is_directory=True)
        self.fails('invalid_input', lambda: ObservationVintageLedger(link, 'same', reserve_bytes=0))


if __name__ == '__main__':
    unittest.main()
