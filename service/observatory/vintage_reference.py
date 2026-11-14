"""Bounded full-receipt artifacts; metadata alone is not snapshot reproduction.

The caller owns protected staging, publication and external source trust. This
module only builds references, verifies joins and reads the fixed local artifact.
It never changes the ledger, embedded vintage contract or hosting limits.
"""
from copy import deepcopy
from datetime import date
import hashlib
import json
import math
import os
import stat

from .vintage_contract import (
    MAX_RECORD_BYTES, _RECORD_KEYS, _SNAPSHOT_KEYS, validate_gauge_vintage,
)
from .vintages import (
    MAX_DAYS, POLICY_VERSION, VintageError, _day, _hash, _identity,
    _properties, _text, _timestamp, canonical_json,
)

ARTIFACT = 'gauge-vintage-snapshot.json'
REFERENCE_VERSION = 'gauge-receipt-reference-v1'
EMBED_MAX_BYTES = 64 * 1024
_MAX_BYTES = 8 * 1024 * 1024
_ERROR = 'Invalid gauge receipt reference'
_REFERENCE_KEYS = {'status', 'referenceVersion', 'receipt', 'snapshotRef', 'artifact'}
_RECEIPT_KEYS = {'policyVersion', 'receivedAt', 'insertedVersions', 'unchangedRecords'}
_HEADER_KEYS = _SNAPSHOT_KEYS - {'observations'}
_SUMMARY_KEYS = _HEADER_KEYS | {'observationCount', 'qualifiedRecords', 'withdrawnRecords'}
_IDENTITY_KEYS = {'station', 'timeSeriesId', 'parameter', 'statistic', 'unit'}
_PROPERTY_KEYS = {'country_code', 'time_zone_abbreviation', 'uses_daylight_savings'}
_INVALID = (VintageError, ValueError, TypeError, KeyError, AttributeError,
            OverflowError, RecursionError, OSError)


def _require(condition):
    if not condition:
        raise ValueError(_ERROR)


def _keys(value, keys):
    # Length first: never allocate a key set for an unbounded hostile mapping.
    _require(type(value) is dict and len(value) == len(keys) and set(value) == keys)


def _integer(value, low, high):
    _require(type(value) is int and low <= value <= high)


def _limit(value):
    _integer(value, 1, _MAX_BYTES)
    return value


def _string(value, limit):
    _require(type(value) is str and len(value) <= limit)


def _time(value):
    _string(value, 32)
    _require(_timestamp(value) == value)


def _bounded_identity(value):
    _keys(value, _IDENTITY_KEYS)
    for item in value.values():
        _string(item, 128)
    _identity(value)


def _header(value):
    _require(value['policyVersion'] == POLICY_VERSION and
             type(value['policyVersion']) is str and
             value['availabilityBasis'] == 'local-receipt-only' and
             type(value['availabilityBasis']) is str)
    _bounded_identity(value['identity'])
    _time(value['issueTime'])
    for key in ('start', 'end'):
        _string(value[key], 10)
        _day(value[key])
    days = (date.fromisoformat(value['end']) - date.fromisoformat(value['start'])).days + 1
    _integer(value['calendarDays'], 1, MAX_DAYS)
    _require(value['calendarDays'] == days)
    _integer(value['unknownDays'], 0, days)
    _string(value['snapshotHash'], 64)
    _hash(value['snapshotHash'])


def _receipt(value, header):
    _keys(value, _RECEIPT_KEYS)
    _require(type(value['policyVersion']) is str and value['policyVersion'] == POLICY_VERSION)
    _time(value['receivedAt'])
    _require(value['receivedAt'] == header['issueTime'])
    for key in ('insertedVersions', 'unchangedRecords'):
        _integer(value[key], 0, MAX_DAYS)
    _integer(value['insertedVersions'] + value['unchangedRecords'], 1, MAX_DAYS)


def _admit_snapshot(snapshot, max_bytes):
    """Flat schema/size admission before existing contract serialization/hashing."""
    _keys(snapshot, _SNAPSHOT_KEYS)
    _header(snapshot)
    rows = snapshot['observations']
    _require(type(rows) is list and len(rows) <= snapshot['calendarDays'])
    _require(snapshot['unknownDays'] == snapshot['calendarDays'] - len(rows))
    # Exact size, including the required final LF, without allocating full JSON.
    size = len(canonical_json({k: ([] if k == 'observations' else v)
                               for k, v in snapshot.items()}).encode('utf-8')) + 1
    for index, row in enumerate(rows):
        _keys(row, _RECORD_KEYS)
        _bounded_identity(row['identity'])
        _require(row['identity'] == snapshot['identity'])
        _string(row['date'], 10)
        _day(row['date'])
        for key in ('receivedAt', 'firstReceivedAt'):
            _time(row[key])
        _integer(row['revision'], 1, 100000)
        value = row['value']
        if value is not None:
            _require(type(value) in (int, float))
            if type(value) is int:
                _require(value.bit_length() <= 1024)
            _require(math.isfinite(value) and value >= 0)
        _text(row['quality'], 256)
        qualifiers = row['qualifiers']
        _require(type(qualifiers) is list and len(qualifiers) <= 16)
        for qualifier in qualifiers:
            _text(qualifier, 64)
        properties = row['stationTimeProperties']
        _require(type(properties) is dict and len(properties) <= len(_PROPERTY_KEYS)
                 and set(properties) <= _PROPERTY_KEYS)
        _properties(properties)
        for key in ('contentHash', 'stationPropertiesHash', 'sourceResponseHash',
                    'sourceMetadataHash', 'versionHash'):
            _string(row[key], 64)
            _hash(row[key])
        record_bytes = len(canonical_json(row).encode('utf-8'))
        _require(record_bytes <= MAX_RECORD_BYTES)
        size += record_bytes + (1 if index else 0)
        _require(size <= max_bytes)
    _require(size <= max_bytes)


def _make_reference(receipt, snapshot, raw):
    header = {k: deepcopy(snapshot[k]) for k in _HEADER_KEYS}
    rows = snapshot['observations']
    header.update(observationCount=len(rows),
                  qualifiedRecords=sum(bool(row['qualifiers']) for row in rows),
                  withdrawnRecords=sum(row['value'] is None for row in rows))
    return dict(status='referenced', referenceVersion=REFERENCE_VERSION,
                receipt=deepcopy(receipt), snapshotRef=header,
                artifact=dict(name=ARTIFACT, bytes=len(raw),
                              sha256=hashlib.sha256(raw).hexdigest()))


def build_reference(vintage, *, max_bytes):
    """Return a detached reference and complete canonical snapshot UTF-8 + LF.

    The explicit cap must fit the ordinary 8 MiB artifact ceiling. Oversized or
    invalid receipts fail; no records are truncated or substituted.
    """
    try:
        max_bytes = _limit(max_bytes)
        _keys(vintage, {'status', 'receipt', 'snapshot'})
        _require(type(vintage['status']) is str and vintage['status'] == 'captured')
        snapshot = vintage['snapshot']
        _admit_snapshot(snapshot, max_bytes)
        _receipt(vintage['receipt'], snapshot)
        request = {key: snapshot[key] for key in ('start', 'end')}
        validate_gauge_vintage(vintage, request, snapshot['issueTime'])
        raw = (canonical_json(snapshot) + '\n').encode('utf-8')
        _require(len(raw) <= max_bytes)
        return _make_reference(vintage['receipt'], snapshot, raw), raw
    except _INVALID:
        raise ValueError(_ERROR) from None


def validate_reference(reference, request, processed_at, *, snapshot=None):
    """Validate metadata, or reproduce the entire reference from an actual snapshot.

    Omitting snapshot is STRUCTURAL validation for trusted archived metadata
    only. It cannot establish artifact existence, source authenticity or full
    reproduction. Current producers must supply the actual snapshot.
    """
    try:
        _keys(reference, _REFERENCE_KEYS)
        _require(type(reference['status']) is str and reference['status'] == 'referenced')
        _require(type(reference['referenceVersion']) is str and
                 reference['referenceVersion'] == REFERENCE_VERSION)
        header = reference['snapshotRef']
        _keys(header, _SUMMARY_KEYS)
        _header(header)
        _receipt(reference['receipt'], header)
        for key in ('observationCount', 'qualifiedRecords', 'withdrawnRecords'):
            _integer(header[key], 0, MAX_DAYS)
        count = header['observationCount']
        _require(header['unknownDays'] == header['calendarDays'] - count and
                 header['qualifiedRecords'] <= count and header['withdrawnRecords'] <= count)
        _require(type(request) is dict)
        for key in ('start', 'end'):
            _string(request[key], 10)
            _day(request[key])
            _require(request[key] == header[key])
        _require(header['issueTime'] <= _timestamp(processed_at))
        artifact = reference['artifact']
        _keys(artifact, {'name', 'bytes', 'sha256'})
        _require(type(artifact['name']) is str and artifact['name'] == ARTIFACT)
        _integer(artifact['bytes'], 1, _MAX_BYTES)
        _string(artifact['sha256'], 64)
        _hash(artifact['sha256'])
        if snapshot is not None:
            wrapper = dict(status='captured', receipt=reference['receipt'], snapshot=snapshot)
            expected, _ = build_reference(wrapper, max_bytes=_MAX_BYTES)
            validate_gauge_vintage(wrapper, request, processed_at)
            # Canonical comparison binds all metadata, population and both pins.
            _require(canonical_json(reference) == canonical_json(expected))
        return deepcopy(reference)
    except _INVALID:
        raise ValueError(_ERROR) from None


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result)
        result[key] = value
    return result


def _constant(_):
    raise ValueError(_ERROR)


def _number(value):
    parsed = float(value)
    _require(math.isfinite(parsed))
    return parsed


def load_reference(directory, reference, *, max_bytes):
    """Read only the fixed regular artifact, then check exact bytes and full join.

    Directory is the caller's trusted stage. No receipt metadata becomes a path.
    NONBLOCK + NOFOLLOW and fstat prevent FIFO blocking and final-link races.
    The derived cutoff is only the receipt issue instant; publication separately
    validates the real request and processing timestamp.
    """
    try:
        max_bytes = _limit(max_bytes)
        _require(type(reference) is dict and type(reference.get('snapshotRef')) is dict)
        header = reference['snapshotRef']
        request = {key: header[key] for key in ('start', 'end')}
        verified = validate_reference(reference, request, header['issueTime'])
        artifact = verified['artifact']
        _require(artifact['bytes'] <= max_bytes)
        flags = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK
        directory_fd = os.open(directory, flags | os.O_DIRECTORY)
        try:
            before = os.stat(ARTIFACT, dir_fd=directory_fd, follow_symlinks=False)
            _require(stat.S_ISREG(before.st_mode) and before.st_size == artifact['bytes'])
            descriptor = os.open(ARTIFACT, flags, dir_fd=directory_fd)
            with os.fdopen(descriptor, 'rb') as stream:
                info = os.fstat(stream.fileno())
                _require(stat.S_ISREG(info.st_mode) and info.st_size == artifact['bytes'] and
                         (info.st_dev, info.st_ino) == (before.st_dev, before.st_ino))
                raw = stream.read(artifact['bytes'] + 1)
        finally:
            os.close(directory_fd)
        _require(len(raw) == artifact['bytes'] and
                 hashlib.sha256(raw).hexdigest() == artifact['sha256'])
        snapshot = json.loads(raw.decode('utf-8'), object_pairs_hook=_pairs,
                              parse_constant=_constant, parse_float=_number)
        _admit_snapshot(snapshot, max_bytes)
        _require(raw == (canonical_json(snapshot) + '\n').encode('utf-8'))
        validate_reference(verified, request, header['issueTime'], snapshot=snapshot)
        return snapshot
    except _INVALID:
        raise ValueError(_ERROR) from None
