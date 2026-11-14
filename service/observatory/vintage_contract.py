"""Verify exported local-receipt snapshots without reading mutable ledger state."""
from datetime import date

from .vintages import (
    MAX_DAYS, POLICY_VERSION, VintageError, canonical_hash, canonical_json,
    _day, _hash, _identity, _properties, _records, _timestamp,
)

MAX_RECORD_BYTES = 8192  # Same payload ceiling as the ledger decoder.
MAX_SNAPSHOT_BYTES = MAX_DAYS * MAX_RECORD_BYTES + 8192
_ERROR = 'Invalid observation availability snapshot'
_SNAPSHOT_KEYS = {'policyVersion', 'availabilityBasis', 'identity', 'issueTime',
                  'start', 'end', 'calendarDays', 'unknownDays', 'observations', 'snapshotHash'}
_RECORD_KEYS = {'identity', 'date', 'value', 'quality', 'qualifiers',
                'stationTimeProperties', 'revision', 'receivedAt', 'firstReceivedAt',
                'contentHash', 'stationPropertiesHash', 'sourceResponseHash',
                'sourceMetadataHash', 'versionHash'}
_INVALID = (VintageError, ValueError, TypeError, KeyError, AttributeError,
            OverflowError, RecursionError)


def _require(condition):
    if not condition:
        raise ValueError(_ERROR)


def validate_gauge_snapshot(snapshot, expected_issue_time=None):
    """Strict as_of schema/integrity validation, optionally bound to an issue instant.

    Returns None on success; raises a sanitized ValueError on malformed input.
    A self-hash proves integrity only. Consumers still need a separately trusted
    snapshot pin/capture and must not infer historical upstream completeness.
    """
    try:
        _require(type(snapshot) is dict and set(snapshot) == _SNAPSHOT_KEYS)
        _require(snapshot['policyVersion'] == POLICY_VERSION and
                 snapshot['availabilityBasis'] == 'local-receipt-only')
        start, end = _day(snapshot['start']), _day(snapshot['end'])
        calendar_days = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
        _require(type(snapshot['calendarDays']) is int and
                 snapshot['calendarDays'] == calendar_days and 1 <= calendar_days <= MAX_DAYS)
        observations = snapshot['observations']
        _require(type(observations) is list and len(observations) <= calendar_days)
        _require(type(snapshot['unknownDays']) is int and
                 snapshot['unknownDays'] == calendar_days - len(observations))
        identity = _identity(snapshot['identity'])
        issue = _timestamp(snapshot['issueTime'])
        _require(issue == snapshot['issueTime'])
        if expected_issue_time is not None:
            _require(issue == _timestamp(expected_issue_time))
        days = []
        for record in observations:
            _require(type(record) is dict and set(record) == _RECORD_KEYS)
            _require(record['identity'] == identity and type(record['revision']) is int
                     and 1 <= record['revision'] <= 100000)
            properties = _properties(record['stationTimeProperties'])
            normalized = _records([{k: record[k] for k in ('date', 'value', 'quality', 'qualifiers')}],
                                  identity, properties)[0]
            content = normalized[2]
            _require(all(content[k] == record[k] for k in content))
            _require(normalized[1] == _hash(record['contentHash']))
            _require(_hash(record['stationPropertiesHash']) == canonical_hash(properties))
            _require(_hash(record['versionHash']) == canonical_hash(
                {k: v for k, v in record.items() if k != 'versionHash'}))
            first, received = _timestamp(record['firstReceivedAt']), _timestamp(record['receivedAt'])
            _require(first == record['firstReceivedAt'] and received == record['receivedAt']
                     and first <= received <= issue)
            _require(start <= record['date'] <= end)
            _hash(record['sourceResponseHash'])
            _hash(record['sourceMetadataHash'])
            _require(len(canonical_json(record).encode('utf-8')) <= MAX_RECORD_BYTES)
            days.append(record['date'])
        _require(days == sorted(set(days)))
        _require(_hash(snapshot['snapshotHash']) == canonical_hash(
            {k: v for k, v in snapshot.items() if k != 'snapshotHash'}))
        _require(len(canonical_json(snapshot).encode('utf-8')) <= MAX_SNAPSHOT_BYTES)
    except _INVALID:
        raise ValueError(_ERROR) from None


def validate_gauge_vintage(value, request, processed_at):
    """Capture wrapper: additionally bind receipt, requested range and processing time."""
    try:
        _require(type(value) is dict)
        if value.get('status') == 'unavailable':
            _require(set(value) == {'status', 'reason'} and value['reason'] in (
                'invalid_input', 'receipt_order', 'receipt_tie', 'version_limit', 'storage_limit',
                'ledger_unavailable', 'schema_mismatch'))
            return
        _require(set(value) == {'status', 'receipt', 'snapshot'} and value['status'] == 'captured')
        receipt, snapshot = value['receipt'], value['snapshot']
        _require(type(receipt) is dict and set(receipt) == {
            'policyVersion', 'receivedAt', 'insertedVersions', 'unchangedRecords'})
        _require(receipt['policyVersion'] == POLICY_VERSION)
        _require(all(type(receipt[k]) is int and 0 <= receipt[k] <= MAX_DAYS
                     for k in ('insertedVersions', 'unchangedRecords')))
        _require(1 <= receipt['insertedVersions'] + receipt['unchangedRecords'] <= MAX_DAYS)
        validate_gauge_snapshot(snapshot, expected_issue_time=receipt['receivedAt'])
        _require(snapshot['start'] == request['start'] and snapshot['end'] == request['end'])
        _require(snapshot['issueTime'] == receipt['receivedAt'] and
                 snapshot['issueTime'] <= _timestamp(processed_at))
    except _INVALID:
        raise ValueError(_ERROR) from None
