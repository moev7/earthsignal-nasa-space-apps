"""Bounded local receipt history, not provider publication history or a model."""
from __future__ import annotations

import fcntl
import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
import stat
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from service.identity import valid_owner

POLICY_VERSION = 'usgs-observation-vintages-v1'
MAX_VERSIONS = 100_000
MAX_BYTES = 32 * 1024**2
MAX_DAYS = 2000
_PAGE = 4096
# WAL index is <=64 KiB for the <=4072-page database; allow 128 KiB.
_OVERHEAD = 128 * 1024
_FILES = ('gauge-vintages.sqlite3', 'gauge-vintages.sqlite3-wal',
          'gauge-vintages.sqlite3-shm', 'gauge-vintages.lock')
_MESSAGES = {
    'invalid_input': 'Invalid vintage ledger input',
    'receipt_order': 'Receipt precedes the recorded series receipt',
    'receipt_tie': 'Conflicting revision at an equal receipt timestamp',
    'version_limit': 'Vintage version capacity reached',
    'storage_limit': 'Vintage storage capacity unavailable',
    'ledger_unavailable': 'Vintage ledger unavailable',
    'schema_mismatch': 'Vintage ledger policy or schema unsupported',
}


class VintageError(Exception):
    """Stable, sanitized errors; no owner, input, SQL or filesystem path."""
    def __init__(self, code):
        self.code = code
        super().__init__(_MESSAGES[code])


def canonical_json(value):
    """Canonical UTF-8 JSON convention used for all exported hashes."""
    return json.dumps(value, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=True, allow_nan=False)


def canonical_hash(value):
    return hashlib.sha256(canonical_json(value).encode('utf-8')).hexdigest()


def _invalid():
    raise VintageError('invalid_input')


def _token(value):
    if (type(value) is not str or len(value) > 128 or '..' in value or
            not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:@-]*', value)):
        _invalid()
    return value


def _hash(value):
    if type(value) is not str or not re.fullmatch(r'[0-9a-f]{64}', value):
        _invalid()
    return value


def _day(value):
    if type(value) is not str or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
        _invalid()
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        _invalid()
    if parsed.isoformat() != value:
        _invalid()
    return value


def _timestamp(value):
    # String syntax deliberately excludes reduced, week, ordinal and naive dates.
    if type(value) is str:
        if len(value) > 32 or not re.fullmatch(
                r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
                r'(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})', value):
            _invalid()
        if value.endswith('-00:00'):
            _invalid()  # RFC3339 unknown offset is not proof of an aware receipt.
        suffix = value[-6:]
        if suffix[0] in '+-' and (int(suffix[1:3]) > 23 or int(suffix[4:]) > 59):
            _invalid()
        try:
            value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            _invalid()
    if type(value) is not datetime or value.tzinfo is None:
        _invalid()
    try:
        if value.utcoffset() is None:
            _invalid()
        normalized = value.astimezone(timezone.utc)
    except (ValueError, OverflowError):
        _invalid()
    return normalized.isoformat(timespec='microseconds').replace('+00:00', 'Z')


def _identity(value):
    keys = {'station', 'timeSeriesId', 'parameter', 'statistic', 'unit'}
    if type(value) is not dict or set(value) != keys:
        _invalid()
    if (type(value['station']) is not str or
            not re.fullmatch(r'USGS-[0-9]{8,15}', value['station'])):
        _invalid()
    _token(value['timeSeriesId'])
    if any(type(item) is not str for item in value.values()):
        _invalid()
    if (value['parameter'] != '00060' or value['statistic'] != '00003' or
            value['unit'] != 'ft^3/s'):
        _invalid()
    return dict(value)


def _text(value, limit):
    if (type(value) is not str or not 1 <= len(value) <= limit or
            any(ord(c) < 32 or ord(c) > 126 for c in value) or
            any(c in value for c in ('<', '>', '\\'))):
        _invalid()
    return value


def _properties(value):
    keys = {'country_code', 'time_zone_abbreviation', 'uses_daylight_savings'}
    if type(value) is not dict or not set(value) <= keys:
        _invalid()
    return {key: None if val is None else _text(val, 32) for key, val in value.items()}


def _records(records, identity, properties):
    if type(records) not in (list, tuple) or not 1 <= len(records) <= MAX_DAYS:
        _invalid()
    normalized = []
    days = set()
    for record in records:
        if (type(record) is not dict or not {'date', 'value', 'quality'} <= set(record)
                or not set(record) <= {'date', 'value', 'quality', 'qualifiers'}):
            _invalid()
        day = _day(record['date'])
        if day in days:
            _invalid()  # Caller must resolve duplicates, even equal ones, first.
        days.add(day)
        value = record['value']
        if value is not None:
            if type(value) not in (int, float):
                _invalid()
            original = value
            try:
                value = float(value)
            except (OverflowError, ValueError):
                _invalid()
            if (not math.isfinite(value) or value < 0 or
                    (type(original) is int and value != original)):
                _invalid()
            if value == 0:
                value = 0.0
        qualifiers = record.get('qualifiers', [])
        if type(qualifiers) is not list or len(qualifiers) > 16:
            _invalid()
        qualifiers = sorted(set(_text(q, 64) for q in qualifiers))
        content = dict(identity=identity, date=day, value=value,
                       quality=_text(record['quality'], 256), qualifiers=qualifiers,
                       stationTimeProperties=properties)
        normalized.append((day, canonical_hash(content), content))
    return sorted(normalized)


def _integer(value, low, high):
    if type(value) is not int or not low <= value <= high:
        _invalid()
    return value


def _decode_payload(encoded, identity, day=None):
    """Fail closed on corrupt local records without exporting parse diagnostics."""
    try:
        if len(encoded.encode('utf-8')) > 8192:
            raise ValueError()
        payload = json.loads(encoded)
        expected = {'identity', 'date', 'value', 'quality', 'qualifiers', 'stationTimeProperties',
                    'revision', 'receivedAt', 'firstReceivedAt', 'contentHash',
                    'stationPropertiesHash', 'sourceResponseHash', 'sourceMetadataHash', 'versionHash'}
        if type(payload) is not dict or set(payload) != expected:
            raise ValueError()
        if payload['identity'] != identity or (day is not None and payload['date'] != day):
            raise ValueError()
        version_hash = payload['versionHash']
        content = {k: v for k, v in payload.items() if k != 'versionHash'}
        if canonical_hash(content) != version_hash:
            raise ValueError()
        return payload
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError, RecursionError):
        raise VintageError('ledger_unavailable') from None


class ObservationVintageLedger:
    """Owner-scoped SQLite WAL ledger; root and owner are trusted service inputs.

    Use capture(identity, records, station_time_properties=..., response_hash=...,
    metadata_hash=..., received_at=...) and as_of(identity, issue_time,
    start=..., end=...). Reads never export the owner or a global sequence.
    All instances sharing a root cooperate through a local advisory lock.
    """
    def __init__(self, root, owner, *, storage_root=None,
                 storage_bytes=1024**3, reserve_bytes=3 * 1024**3,
                 max_versions=MAX_VERSIONS, max_bytes=MAX_BYTES):
        if not valid_owner(owner):_invalid()
        self._owner = owner
        self._max_versions = _integer(max_versions, 1, MAX_VERSIONS)
        self._max_bytes = _integer(max_bytes, _OVERHEAD + 16 * _PAGE, MAX_BYTES)
        self._storage_bytes = _integer(storage_bytes, 1, 1024**4)
        self._reserve_bytes = _integer(reserve_bytes, 0, 1024**4)
        try:
            for path in (root, storage_root if storage_root is not None else root):
                if not isinstance(path, (str, Path)):
                    _invalid()
                p = Path(path)
                if not p.is_absolute() or '..' in p.parts or p.is_symlink() or not p.is_dir():
                    _invalid()
            self._root = Path(root).resolve()
            self._storage_root = Path(storage_root if storage_root is not None else root).resolve()
            if not self._root.is_relative_to(self._storage_root):
                _invalid()
        except (OSError, ValueError):
            raise VintageError('invalid_input') from None
        self._path = self._root / _FILES[0]
        # Every dirty page enters WAL once (cache_spill=OFF). Cap simultaneous
        # DB + WAL at 2*pages*4096 + pages*24 + 128 KiB, including initialization.
        self._page_cap = (self._max_bytes - _OVERHEAD) // (2 * _PAGE + 24)
        with self._connection(write=True) as db:
            schema = '''
                CREATE TABLE IF NOT EXISTS policy (
                    singleton INTEGER PRIMARY KEY CHECK(singleton=1), version TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS series_receipts (
                    owner TEXT NOT NULL, identity TEXT NOT NULL, received_at TEXT NOT NULL,
                    PRIMARY KEY(owner, identity)) WITHOUT ROWID;
                CREATE TABLE IF NOT EXISTS versions (
                    owner TEXT NOT NULL, identity TEXT NOT NULL, day TEXT NOT NULL,
                    revision INTEGER NOT NULL, received_at TEXT NOT NULL,
                    content_hash TEXT NOT NULL, payload TEXT NOT NULL,
                    PRIMARY KEY(owner, identity, day, revision));
                CREATE TRIGGER IF NOT EXISTS immutable_versions_update BEFORE UPDATE ON versions
                    BEGIN SELECT RAISE(ABORT, 'immutable'); END;
                CREATE TRIGGER IF NOT EXISTS immutable_versions_delete BEFORE DELETE ON versions
                    BEGIN SELECT RAISE(ABORT, 'immutable'); END;
            '''
            # Triggers contain semicolons: execute complete statements individually.
            statements = []
            buffer = ''
            for line in schema.splitlines():
                buffer += line + '\n'
                if sqlite3.complete_statement(buffer):
                    statements.append(buffer)
                    buffer = ''
            for statement in statements:
                db.execute(statement)
            policy = db.execute('SELECT version FROM policy WHERE singleton=1').fetchone()
            if policy is None:
                db.execute('INSERT INTO policy VALUES (1, ?)', (POLICY_VERSION,))
            elif policy[0] != POLICY_VERSION:
                raise VintageError('schema_mismatch')
            if db.execute('SELECT COUNT(*) FROM versions').fetchone()[0] > self._max_versions:
                raise VintageError('version_limit')

    def _file_sizes(self):
        total = 0
        for name in _FILES:
            path = self._root / name
            try:
                info = path.lstat()
            except FileNotFoundError:
                continue
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise VintageError('ledger_unavailable')
            total += info.st_size
        if total > self._max_bytes:
            raise VintageError('storage_limit')
        return total

    def _private_files(self):
        # Only fixed ledger files are managed here; never chmod shared storage.
        for name in _FILES:
            path = self._root / name
            try:
                info = path.lstat()
            except FileNotFoundError:
                continue
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise VintageError('ledger_unavailable')
            os.chmod(path, 0o600, follow_symlinks=False)

    def _admit(self):
        existing = self._file_sizes()
        additional = self._max_bytes - existing
        used, seen = 0, 0
        # A bounded scan includes all shared service storage, without following links.
        def inaccessible(_):
            raise VintageError('storage_limit')
        for directory, dirs, files in os.walk(self._storage_root, followlinks=False,
                                               onerror=inaccessible):
            for name in dirs + files:
                seen += 1
                if seen > 100_000:
                    raise VintageError('storage_limit')
                info = (Path(directory) / name).lstat()
                if stat.S_ISLNK(info.st_mode):
                    raise VintageError('storage_limit')
                if stat.S_ISREG(info.st_mode):
                    used += info.st_size
        if (used + additional > self._storage_bytes or
                shutil.disk_usage(self._root).free < self._reserve_bytes + additional):
            raise VintageError('storage_limit')

    @contextmanager
    def _connection(self, *, write):
        db, lock = None, None
        try:
            self._file_sizes()
            lock = os.open(self._root / _FILES[3], os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            if not stat.S_ISREG(os.fstat(lock).st_mode) or os.fstat(lock).st_nlink != 1:
                raise VintageError('ledger_unavailable')
            os.fchmod(lock, 0o600)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self._admit()
            # SQLite copies its DB permissions to WAL/SHM. Establish the DB
            # mode before SQLite can create either, without changing umask.
            fd = os.open(self._path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            try:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise VintageError('ledger_unavailable')
                os.fchmod(fd, 0o600)
            finally:
                os.close(fd)
            db = sqlite3.connect(self._path, timeout=5, isolation_level=None)
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA page_size=4096')
            if db.execute('PRAGMA page_size').fetchone()[0] != _PAGE:
                raise VintageError('schema_mismatch')
            db.execute('PRAGMA cache_spill=OFF')
            db.execute('PRAGMA cache_size=-32768')
            if db.execute('PRAGMA journal_mode=WAL').fetchone()[0] != 'wal':
                raise VintageError('ledger_unavailable')
            db.execute('PRAGMA synchronous=FULL')
            db.execute('PRAGMA wal_autocheckpoint=0')
            if db.execute('PRAGMA max_page_count=' + str(self._page_cap)).fetchone()[0] > self._page_cap:
                raise VintageError('storage_limit')
            # No ledger reader/writer can overlap this lock. External SQLite
            # readers pinning WAL prevent writes, rather than enlarging history.
            checkpoint = db.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()
            if checkpoint[0] != 0:
                raise VintageError('ledger_unavailable')
            self._private_files()
            self._file_sizes()
            db.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
            yield db
            if write:
                pages = db.execute('PRAGMA page_count').fetchone()[0]
                if pages > self._page_cap:
                    raise VintageError('storage_limit')
                self._admit()  # Shared-storage/disk recheck before acceptance.
            self._private_files()
            db.commit()
            self._file_sizes()
        except sqlite3.Error as exc:
            if db is not None and db.in_transaction:
                db.rollback()
            code = 'storage_limit' if getattr(exc, 'sqlite_errorcode', None) == sqlite3.SQLITE_FULL else 'ledger_unavailable'
            raise VintageError(code) from None
        except OSError:
            if db is not None and db.in_transaction:
                db.rollback()
            raise VintageError('ledger_unavailable') from None
        except BaseException:
            if db is not None and db.in_transaction:
                db.rollback()
            raise
        finally:
            if db is not None:
                db.close()
            if lock is not None:
                os.close(lock)

    def capture(self, identity, records, *, station_time_properties,
                response_hash, metadata_hash, received_at):
        """Atomically record 1..2000 resolved observed dates, never padded gaps.

        Hashes identify upstream response bytes (caller responsibility); changed
        response bytes alone do not revise unchanged semantic observations.
        Receipt times are monotonically nondecreasing per owner/full identity.
        Equal times permit unchanged overlap or disjoint dates, never revisions.
        """
        identity = _identity(identity)
        properties = _properties(station_time_properties)
        response_hash, metadata_hash = _hash(response_hash), _hash(metadata_hash)
        received_at = _timestamp(received_at)
        rows = _records(records, identity, properties)
        key = canonical_hash(identity)
        inserted = 0
        with self._connection(write=True) as db:
            head = db.execute('SELECT received_at FROM series_receipts WHERE owner=? AND identity=?',
                              (self._owner, key)).fetchone()
            if head is not None and received_at < head[0]:
                raise VintageError('receipt_order')
            changes = []
            for day, content_hash, content in rows:
                latest = db.execute('SELECT revision, content_hash, payload FROM versions '
                                    'WHERE owner=? AND identity=? AND day=? ORDER BY revision DESC LIMIT 1',
                                    (self._owner, key, day)).fetchone()
                if latest is not None and latest['content_hash'] == content_hash:
                    continue
                if latest is not None and head is not None and received_at == head[0]:
                    raise VintageError('receipt_tie')
                revision = latest['revision'] + 1 if latest is not None else 1
                first = _decode_payload(latest['payload'], identity, day)['firstReceivedAt'] if latest is not None else received_at
                payload = dict(content, revision=revision, receivedAt=received_at,
                               firstReceivedAt=first, contentHash=content_hash,
                               stationPropertiesHash=canonical_hash(properties),
                               sourceResponseHash=response_hash, sourceMetadataHash=metadata_hash)
                payload['versionHash'] = canonical_hash(payload)
                changes.append((self._owner, key, day, revision, received_at,
                                content_hash, canonical_json(payload)))
            count = db.execute('SELECT COUNT(*) FROM versions').fetchone()[0]
            if count + len(changes) > self._max_versions:
                raise VintageError('version_limit')
            db.executemany('INSERT INTO versions VALUES (?, ?, ?, ?, ?, ?, ?)', changes)
            db.execute('INSERT INTO series_receipts VALUES (?, ?, ?) '
                       'ON CONFLICT(owner, identity) DO UPDATE SET received_at=excluded.received_at',
                       (self._owner, key, received_at))
            inserted = len(changes)
        return dict(policyVersion=POLICY_VERSION, receivedAt=received_at,
                    insertedVersions=inserted, unchangedRecords=len(rows) - inserted)

    def as_of(self, identity, issue_time, *, start, end):
        """Inclusive <=2000-calendar-day view at a timezone-aware local receipt cutoff.

        Unknown dates have no fabricated value/quality/receipt. Explicit nulls
        remain recorded withdrawals. Output and hashes contain no owner ID.
        """
        identity = _identity(identity)
        issue_time = _timestamp(issue_time)
        start, end = _day(start), _day(end)
        calendar_days = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
        if not 1 <= calendar_days <= MAX_DAYS:
            _invalid()
        key = canonical_hash(identity)
        with self._connection(write=False) as db:
            rows = db.execute('''
                SELECT v.payload FROM versions v
                WHERE v.owner=? AND v.identity=? AND v.day BETWEEN ? AND ?
                  AND v.received_at<=?
                  AND v.revision=(SELECT MAX(w.revision) FROM versions w
                      WHERE w.owner=v.owner AND w.identity=v.identity AND w.day=v.day
                        AND w.received_at<=?)
                ORDER BY v.day
            ''', (self._owner, key, start, end, issue_time, issue_time)).fetchall()
        observations = [_decode_payload(row[0], identity) for row in rows]
        # Identity is once at the top; version hashes reproduce full stored record.
        snapshot = dict(policyVersion=POLICY_VERSION, availabilityBasis='local-receipt-only',
                        identity=identity, issueTime=issue_time, start=start, end=end,
                        calendarDays=calendar_days, unknownDays=calendar_days-len(observations),
                        observations=observations)
        snapshot['snapshotHash'] = canonical_hash(snapshot)
        return snapshot
