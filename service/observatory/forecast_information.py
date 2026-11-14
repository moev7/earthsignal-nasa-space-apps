"""Pinned, receipt-cutoff information sets and station-day target timing; no model."""
from copy import deepcopy
from datetime import date, datetime

from .gauge_time import (
    NIST_DST_URL, POLICY_MAX_DATE, POLICY_MIN_YEAR, RULE_VERSION,
    USGS_REGISTRY_URL, forecast_timing, station_day,
)
from .vintage_contract import validate_gauge_snapshot
from .vintages import VintageError, _hash, _properties, _timestamp, canonical_hash, canonical_json

METHOD = 'gauge-forecast-information-v1'
_ERROR = 'Invalid forecast information input'
_INTERVAL_KEYS = ('date', 'start', 'end', 'startUtc', 'endUtc', 'durationHours')
_STATION_KEYS = _INTERVAL_KEYS + ('timezoneCode', 'dstflag', 'metadataHash',
                                  'registryHash', 'ruleVersion')


def _station_result(result):
    # Do not forward primitive diagnostics (which can contain local file paths).
    return dict(status=result['status'],
                **{k: result[k] for k in _STATION_KEYS})


def _withheld_attempt(horizon, reason):
    return dict(horizonDays=horizon, status='withheld', reason=reason,
                timingEligible=False, observationCutoff=None, targetInterval=None,
                lagHours=None, leadStartHours=None, leadEndHours=None,
                ruleVersion=RULE_VERSION)


def _timing_attempts(latest, withholding, properties, issue_dt, horizons):
    attempts = []
    for horizon in horizons:
        if withholding:
            attempts.append(_withheld_attempt(horizon, withholding))
            continue
        timing = forecast_timing(latest, horizon, issue_dt, properties)
        target = timing['targetInterval']
        eligible = (timing['status'] == 'future' and target is not None and
                    datetime.fromisoformat(target['startUtc'].replace('Z', '+00:00')) > issue_dt)
        reason = {'future': 'whole_target_after_issue', 'partly_elapsed': 'target_already_started',
                  'expired': 'target_expired', 'withheld': 'station_time_withheld'}[timing['status']]
        attempts.append(dict(
            horizonDays=horizon, status=timing['status'], reason=reason, timingEligible=eligible,
            observationCutoff=({k: timing['observationCutoff'][k] for k in _INTERVAL_KEYS}
                               if timing['observationCutoff'] is not None else None),
            targetInterval=({k: target[k] for k in _INTERVAL_KEYS}
                            if target is not None else None),
            lagHours=timing['lagHours'], leadStartHours=timing['leadStartHours'],
            leadEndHours=timing['leadEndHours'], ruleVersion=timing['ruleVersion']))

    return attempts


def validate_information_summary(report, summary):
    """Check archived report structure/joins and recompute disclosed timing.

    This does not replay the missing observation ledger or verify informationHash.
    Only the trusted completed archive may use it; current publication still
    reproduces the whole report from the complete snapshot.
    """
    try:
        def keys(value, expected):
            if type(value) is not dict or len(value) != len(expected) or set(value) != set(expected):
                raise ValueError()
        keys(report, ('method','status','reason','issueTime','snapshotHash','informationHash',
            'availabilityBasis','identity','start','end','counts','exclusionReasons',
            'latestRetainedDate','stationTime','timingAttempts','limitations'))
        if report['method'] != METHOD or report['availabilityBasis'] != 'local-receipt-only':
            raise ValueError()
        for key in ('identity','start','end','issueTime','snapshotHash','availabilityBasis'):
            if canonical_json(report[key]) != canonical_json(summary[key]):
                raise ValueError()
        _hash(report['informationHash'])
        counts = report['counts']
        keys(counts, ('calendarDays','attemptedRecords','retainedRecords','excludedRecords',
            'unknownCalendarDays','nullWithdrawals','unresolvedStationTime','incompleteAtIssue'))
        if any(type(v) is not int or not 0 <= v <= 2000 for v in counts.values()):
            raise ValueError()
        if (counts['calendarDays'] != summary['calendarDays'] or
            counts['attemptedRecords'] != summary['observationCount'] or
            counts['unknownCalendarDays'] != summary['unknownDays'] or
            counts['retainedRecords'] + counts['excludedRecords'] != counts['attemptedRecords'] or
            counts['nullWithdrawals'] != summary['withdrawnRecords'] or
            sum(counts[k] for k in ('nullWithdrawals','unresolvedStationTime','incompleteAtIssue')) != counts['excludedRecords']):
            raise ValueError()
        reasons = {k: counts[v] for k,v in (
            ('null_withdrawal','nullWithdrawals'),('unresolved_station_time','unresolvedStationTime'),
            ('incomplete_at_issue','incompleteAtIssue')) if counts[v]}
        if canonical_json(report['exclusionReasons']) != canonical_json(reasons):
            raise ValueError()
        latest = report['latestRetainedDate']
        if (latest is None) != (counts['retainedRecords'] == 0):
            raise ValueError()
        if latest is not None:
            if type(latest) is not str or date.fromisoformat(latest).isoformat() != latest or not summary['start'] <= latest <= summary['end']:
                raise ValueError()
        station = report['stationTime']
        keys(station, ('ruleVersion','registryHashes','registrySource','dstRuleSource','minYear',
            'reviewCeiling','retainedMetadataCount','properties','stationPropertiesHash','metadataHash'))
        for key,value in (('ruleVersion',RULE_VERSION),('registrySource',USGS_REGISTRY_URL),
            ('dstRuleSource',NIST_DST_URL),('minYear',POLICY_MIN_YEAR),('reviewCeiling',POLICY_MAX_DATE.isoformat())):
            if type(station[key]) is not type(value) or station[key] != value:
                raise ValueError()
        if type(station['registryHashes']) is not list or len(station['registryHashes']) > 1:
            raise ValueError()
        for value in station['registryHashes']:
            _hash(value)
        metadata_count = station['retainedMetadataCount']
        if type(metadata_count) is not int or not 0 <= metadata_count <= counts['retainedRecords']:
            raise ValueError()
        reason = 'no_eligible_day' if not counts['retainedRecords'] else ('mixed_station_metadata' if metadata_count != 1 else None)
        if report['reason'] != reason or report['status'] != ('withheld' if reason else 'resolved'):
            raise ValueError()
        if metadata_count == 1:
            _properties(station['properties'])
            if station['stationPropertiesHash'] != canonical_hash(station['properties']):
                raise ValueError()
            resolved = station_day(latest, station['properties'])
            if resolved['status'] != 'resolved' or station['metadataHash'] != resolved['metadataHash']:
                raise ValueError()
        elif any(station[k] is not None for k in ('properties','stationPropertiesHash','metadataHash')):
            raise ValueError()
        attempts = report['timingAttempts']
        if type(attempts) is not list or len(attempts) != 3:
            raise ValueError()
        expected = _timing_attempts(latest, reason, station['properties'],
            datetime.fromisoformat(_timestamp(report['issueTime']).replace('Z','+00:00')), (1,3,7))
        if canonical_json(attempts) != canonical_json(expected):
            raise ValueError()
        limitations = report['limitations']
        if type(limitations) is not list or not 1 <= len(limitations) <= 8 or any(type(v) is not str or not 1 <= len(v) <= 500 for v in limitations):
            raise ValueError()
        return deepcopy(report)
    except (VintageError, ValueError, TypeError, KeyError, AttributeError, OverflowError, RecursionError):
        raise ValueError(_ERROR) from None


def forecast_information(snapshot, *, expected_snapshot_hash, issue_time, horizons=(1, 3, 7)):
    """Return detached {report, ledger, points} bound by report.informationHash.

    expected_snapshot_hash must be independently trusted, not freshly obtained
    from untrusted input. Local receipts are the sole availability basis. This
    prerequisite neither predicts discharge nor establishes publication skill.
    """
    try:
        pin = _hash(expected_snapshot_hash)
        issue = _timestamp(issue_time)
        if type(horizons) not in (list, tuple) or not 1 <= len(horizons) <= 7:
            raise ValueError()
        if any(type(h) is not int or not 1 <= h <= 7 for h in horizons):
            raise ValueError()
        ordered_horizons = sorted(set(horizons))
        validate_gauge_snapshot(snapshot, expected_issue_time=issue)
        # Bound the input before copying; validate the detached copy too so a
        # caller mutation during copying cannot slip past the external pin.
        snapshot = deepcopy(snapshot)
        validate_gauge_snapshot(snapshot, expected_issue_time=issue)
        if snapshot['snapshotHash'] != pin:
            raise ValueError()
    except (VintageError, ValueError, TypeError, KeyError, AttributeError,
            OverflowError, RecursionError):
        raise ValueError(_ERROR) from None

    # Never retain caller-owned references or read mutable observation history.
    issue_dt = datetime.fromisoformat(issue.replace('Z', '+00:00'))
    ledger, points, reasons, metadata = [], [], {}, {}
    registry_hashes = set()
    for record in snapshot['observations']:
        station = _station_result(station_day(record['date'], record['stationTimeProperties']))
        if station['registryHash'] is not None:
            registry_hashes.add(station['registryHash'])
        if record['value'] is None:
            reason = 'null_withdrawal'
        elif station['status'] != 'resolved':
            reason = 'unresolved_station_time'
        elif datetime.fromisoformat(station['endUtc'].replace('Z', '+00:00')) > issue_dt:
            reason = 'incomplete_at_issue'
        else:
            reason = None
        ledger.append(dict(record=record, status='excluded' if reason else 'retained',
                           reason=reason, stationDay=station))
        if reason:
            reasons[reason] = reasons.get(reason, 0) + 1
            continue
        interval = {k: station[k] for k in _INTERVAL_KEYS}
        points.append(dict(date=record['date'], value=record['value'], quality=record['quality'],
                           qualifiers=deepcopy(record['qualifiers']), versionHash=record['versionHash'],
                           interval=interval))
        metadata[record['stationPropertiesHash']] = dict(
            stationPropertiesHash=record['stationPropertiesHash'], metadataHash=station['metadataHash'],
            properties=deepcopy(record['stationTimeProperties']))

    latest = points[-1]['date'] if points else None
    withholding = 'no_eligible_day' if not points else (
        'mixed_station_metadata' if len(metadata) != 1 else None)
    attempts = _timing_attempts(latest, withholding,
        next(iter(metadata.values()))['properties'] if metadata else None,
        issue_dt, ordered_horizons)

    uniform_metadata = next(iter(metadata.values())) if len(metadata) == 1 else None
    report = dict(
        method=METHOD, status='withheld' if withholding else 'resolved', reason=withholding,
        issueTime=issue, snapshotHash=pin, availabilityBasis=snapshot['availabilityBasis'],
        identity=deepcopy(snapshot['identity']), start=snapshot['start'], end=snapshot['end'],
        counts=dict(calendarDays=snapshot['calendarDays'], attemptedRecords=len(ledger),
                    retainedRecords=len(points), excludedRecords=len(ledger) - len(points),
                    unknownCalendarDays=snapshot['unknownDays'],
                    nullWithdrawals=reasons.get('null_withdrawal', 0),
                    unresolvedStationTime=reasons.get('unresolved_station_time', 0),
                    incompleteAtIssue=reasons.get('incomplete_at_issue', 0)),
        exclusionReasons=dict(sorted(reasons.items())), latestRetainedDate=latest,
        stationTime=dict(ruleVersion=RULE_VERSION, registryHashes=sorted(registry_hashes),
                         registrySource=USGS_REGISTRY_URL, dstRuleSource=NIST_DST_URL,
                         minYear=POLICY_MIN_YEAR, reviewCeiling=POLICY_MAX_DATE.isoformat(),
                         retainedMetadataCount=len(metadata),
                         properties=uniform_metadata['properties'] if uniform_metadata else None,
                         stationPropertiesHash=(uniform_metadata['stationPropertiesHash']
                                                if uniform_metadata else None),
                         metadataHash=uniform_metadata['metadataHash'] if uniform_metadata else None),
        timingAttempts=attempts,
        limitations=[
            'Local receipt integrity does not prove true or complete historical upstream availability.',
            'Snapshot pin must come from independently trusted capture or storage.',
            'Station metadata is not proof of historical station configuration.',
            'Timing eligibility is not publication readiness, a prediction, skill or full E5 acceptance.',
        ])
    result = dict(report=report, ledger=ledger, points=points)
    report['informationHash'] = canonical_hash(result)
    return deepcopy(result)
