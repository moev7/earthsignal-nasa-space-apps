"""Pure offline point experiment. Trusted external pins are caller obligations.

Approved-only v1 development selects the family; this module neither fits nor
calibrates it. Provisional predictor values are preserved, never relabeled.
"""
from copy import deepcopy
from datetime import date, timedelta
import math

import numpy as np

from . import forecast_policy as fp
from .vintage_contract import _RECORD_KEYS, _SNAPSHOT_KEYS
from .vintages import _day, _identity, _properties, _text
from .vintages import _hash, _timestamp, canonical_hash

VERSION = 'offline-provisional-point-experiment-v1'
PREDICTOR_VERSION = 'approved-provisional-empty-qualifiers-point-v1'
LABEL = 'OFFLINE EXPERIMENTAL — NOT OPERATIONAL PUBLICATION'
ERROR = 'Invalid provisional forecast experiment input'
QUALITY_LITERALS = ('Approved', 'approved', 'Provisional', 'provisional')
HORIZONS = fp.HORIZONS
METHODS = fp.METHODS
CONSTANTS = dict(qualityLiterals=list(QUALITY_LITERALS), qualifiersRequired=[],
                 predictorVersion=PREDICTOR_VERSION, developmentPolicyVersion=fp.VERSION,
                 kernelVersion='frozen-forecast-v3-076fb17', trendWindowDays=28,
                 damping=.9, maximumLagHours=48, horizons=list(HORIZONS),
                 receiptCompletionVersion='completed-at-receipt-and-issue-v1')
LIMITATIONS = [
    'Offline experimental points only; operational publication is disabled.',
    'Approved-only POLICY-DEVELOPMENT is inherited, not independent final evaluation.',
    'Prediction uncertainty and input/truth revision uncertainty are unquantified.',
    'No skill, E5 pass, statistical independence, coverage or scientist usefulness guarantee.',
    'Local receipt pins do not prove authentic timestamps or complete upstream availability.',
    'Literal Approved/approved/Provisional/provisional with empty qualifiers only for predictors.',
    'Later truth must be completed Approved/approved with empty qualifiers; revisions produce new scores.',
    'Nine method-horizon attempts repeat three targets and are not nine independent observations.',
    'No interval scores or calibration guarantees transfer from the development policy.',
    'Embedded bounded station snapshots contain private receipt/source lineage.',
]
ISSUE_KEYS = {'artifact', 'methodVersion', 'label', 'operationalPublication', 'policyHash',
              'freezeTime', 'issueTime', 'sourceSnapshot', 'snapshotHash', 'identity',
              'forecastInformation', 'constants', 'uncertainty', 'attempts', 'counts',
              'methodCounts', 'countScope', 'targetCounts', 'limitations', 'experimentHash'}


def _require(condition):
    if not condition:
        raise ValueError(ERROR)


def _admit(value, key, pin):
    # External pin syntax and matching declared pin precede hashing/copying.
    _hash(pin)
    fp._bounded(value)
    _require(type(value) is dict and type(value.get(key)) is str and value[key] == pin)


def _admit_snapshot(snapshot, pin):
    _admit(snapshot, 'snapshotHash', pin)
    fp._bounded(snapshot, byte_limit=fp.MAX_SNAPSHOT_BYTES)
    _require(set(snapshot) == _SNAPSHOT_KEYS)
    _require(type(snapshot.get('observations')) is list)
    _require(type(snapshot['calendarDays']) is int and type(snapshot['unknownDays']) is int)
    _identity(snapshot['identity'])
    for record in snapshot['observations']:
        fp._bounded(record, byte_limit=fp.MAX_RECORD_BYTES)
        _require(type(record) is dict and set(record) == _RECORD_KEYS)
        # Shape checks precede any v1 content hashing, including finite nested
        # numeric qualifiers and bool-as-number. Full semantics remain v1's.
        _identity(record['identity']); _properties(record['stationTimeProperties'])
        _day(record['date']); _timestamp(record['receivedAt']); _timestamp(record['firstReceivedAt'])
        _require(type(record['revision']) is int)
        if record['value'] is not None:
            fp._finite(record['value'])
        _text(record['quality'], 256)
        _require(type(record['qualifiers']) is list and len(record['qualifiers']) <= 16)
        for qualifier in record['qualifiers']:
            _text(qualifier, 64)
        for key in ('contentHash', 'stationPropertiesHash', 'sourceResponseHash',
                    'sourceMetadataHash', 'versionHash'):
            _hash(record[key])


def _match(policy, source, info):
    fp._same(source['identity'], policy['identity'])
    station = policy['stationTime']
    props = station['properties']
    if props is not None:
        for record in source['observations']:
            fp._same(record['stationTimeProperties'], props)
    fp._same(info['report']['stationTime']['ruleVersion'], station['ruleVersion'])
    if props is not None and source['observations']:
        fp._same(info['report']['stationTime']['registryHashes'], station['registryHashes'])


def _predict(info, model, horizon, timing, at):
    latest = info['report']['latestRetainedDate']
    target = timing['targetInterval']
    if latest is None or target is None or target['startUtc'] is None:
        return None, [], 'missing_predictor_support'
    if model == 'persistence':
        days = [latest]
    elif model == 'seasonal-naive':
        days = [(date.fromisoformat(target['date'])-timedelta(days=365)).isoformat()]
    else:
        days = [(date.fromisoformat(latest)-timedelta(days=i)).isoformat()
                for i in range(27, -1, -1)]
    ledger = {entry['record']['date']: entry for entry in info['ledger']}
    support, reasons = [], []
    for day in days:
        entry = ledger.get(day)
        record = entry['record'] if entry else None
        received_complete = bool(entry and entry['stationDay']['endUtc'] is not None and
                                 fp._received_complete(entry))
        issue_complete = bool(entry and entry['stationDay']['endUtc'] is not None and
                              fp._dt(entry['stationDay']['endUtc']) <= fp._dt(at))
        reason = None
        if entry is None:
            reason = 'missing_predictor_support'
        elif entry['status'] != 'retained':
            reason = entry['reason']
        elif record['quality'] not in QUALITY_LITERALS or record['qualifiers'] != []:
            reason = 'unsupported_predictor_quality'
        elif not received_complete:
            reason = 'incomplete_when_received'
        elif not issue_complete:
            reason = 'incomplete_at_issue'
        support.append(dict(date=day, value=record['value'] if record else None,
                            quality=record['quality'] if record else None,
                            qualifiers=deepcopy(record['qualifiers']) if record else None,
                            versionHash=record['versionHash'] if record else None,
                            receivedAt=record['receivedAt'] if record else None,
                            completedAtReceipt=received_complete, completedAtIssue=issue_complete,
                            status='supported' if reason is None else 'withheld', reason=reason))
        if reason:
            reasons.append(reason)
    if reasons:
        return None, support, reasons[0]
    try:
        with np.errstate(over='raise', invalid='raise', divide='raise'):
            if model in ('persistence', 'seasonal-naive'):
                point = support[0]['value']
            else:
                point = fp.forecasts.predict(np.array([p['value'] for p in support], dtype=float),
                                             27, horizon, model)
            fp._finite(point)
        return float(point), support, None
    except (ValueError, FloatingPointError, OverflowError):
        return None, support, 'invalid_prediction'


def _counts(attempts):
    computed = sum(a['status'] == 'computed' for a in attempts)
    return dict(attempted=len(attempts), computed=computed,
                withheld=len(attempts)-computed, computationRate=computed/len(attempts))


def _targets(attempts, scoring=False):
    targets = [a['targetInterval']['date'] for a in attempts if a['targetInterval'] is not None]
    unresolved = sum(a['targetInterval'] is None or a['targetInterval']['startUtc'] is None or
                     a['targetInterval']['endUtc'] is None for a in attempts)
    result = dict(distinctTargetCount=len(set(targets)), duplicateTargetAttempts=len(targets)-len(set(targets)),
                  unresolvedTargetAttempts=unresolved, independentObservationClaim=False)
    if scoring:
        scored = [a['targetInterval']['date'] for a in attempts if a['scoreStatus'] == 'scored']
        result.update(scoredDistinctTargetCount=len(set(scored)),
                      duplicateScoredTargetAttempts=len(scored)-len(set(scored)))
    return result


def _make(policy, source, info, at):
    _require(fp._dt(at) > fp._dt(policy['freezeTime']))
    _match(policy, source, info)
    development = {d['horizonDays']: d for d in policy['development']}
    attempts = []
    for timing in info['report']['timingAttempts']:
        horizon = timing['horizonDays']
        d = development.get(horizon)
        for method in METHODS:
            model = d['model'] if method == 'candidate' and d else method
            point, support, support_reason = _predict(info, model, horizon, timing, at)
            reasons = []
            if policy['status'] != 'ready':
                reasons.append('policy_withheld')
            if not timing['timingEligible']:
                reasons.append(timing['reason'])
            if timing['lagHours'] is None or not 0 <= timing['lagHours'] <= 48:
                reasons.append('stale_or_unresolved_observation')
            if method == 'candidate' and d and not d['eligible']:
                reasons.append('candidate_development_gate_failed')
            if support_reason:
                reasons.append(support_reason)
            predictor = dict(methodVersion=PREDICTOR_VERSION, model=model, horizonDays=horizon,
                             informationHash=info['report']['informationHash'],
                             targetInterval=timing['targetInterval'], support=support,
                             inputVersionHashes=[s['versionHash'] for s in support if s['versionHash'] is not None])
            attempts.append(dict(method=method, model=model, horizonDays=horizon,
                                 status='withheld' if reasons else 'computed', reasons=reasons,
                                 point=None if reasons else point, unit=policy['identity']['unit'],
                                 targetInterval=timing['targetInterval'], timing=timing,
                                 predictor=predictor, predictorHash=canonical_hash(predictor)))
    return fp._seal(dict(artifact='offline-provisional-point-issue', methodVersion=VERSION,
                         label=LABEL, operationalPublication=False, policyHash=policy['policyHash'],
                         freezeTime=policy['freezeTime'], issueTime=at, sourceSnapshot=source,
                         snapshotHash=source['snapshotHash'], identity=policy['identity'],
                         forecastInformation=info['report'], constants=CONSTANTS,
                         uncertainty=dict(prediction='unquantified', revision='unquantified'),
                         attempts=attempts, counts=_counts(attempts),
                         methodCounts={m: _counts([a for a in attempts if a['method'] == m]) for m in METHODS},
                         countScope='all-nine-method-horizon-attempts', targetCounts=_targets(attempts),
                         limitations=LIMITATIONS), 'experimentHash')


def compute_provisional_issue(policy, snapshot, *, expected_policy_hash, expected_snapshot_hash, issue_time):
    """Compute nine fixed point attempts on a separately pinned issue cutoff."""
    try:
        _hash(expected_policy_hash); _hash(expected_snapshot_hash)
        _admit(policy, 'policyHash', expected_policy_hash)
        _admit_snapshot(snapshot, expected_snapshot_hash)
        policy = fp._validate_policy(policy, expected_policy_hash)
        at = _timestamp(issue_time)
        info = fp._info(snapshot, expected_snapshot_hash, at)
        source = deepcopy(snapshot)
        fp._info(source, expected_snapshot_hash, at)
        return _make(policy, source, info, at)
    except fp._INVALID:
        raise ValueError(ERROR) from None


def _validate_computed(policy, computed, pin):
    _admit(computed, 'experimentHash', pin)
    _require(set(computed) == ISSUE_KEYS)
    _require(type(computed['attempts']) is list and len(computed['attempts']) == 9)
    _hash(computed['snapshotHash'])
    _admit_snapshot(computed['sourceSnapshot'], computed['snapshotHash'])
    _require(canonical_hash({k: v for k, v in computed.items() if k != 'experimentHash'}) == pin)
    regenerated = compute_provisional_issue(policy, computed['sourceSnapshot'],
                                            expected_policy_hash=policy['policyHash'],
                                            expected_snapshot_hash=computed['snapshotHash'],
                                            issue_time=computed['issueTime'])
    # Full canonical comparison rejects unknown nested keys and bool-as-number.
    fp._same(computed, regenerated)
    return regenerated


def _mean(values):
    if not values:
        return None
    scale = max(abs(v) for v in values)
    result = 0. if scale == 0 else math.fsum(v/scale/len(values) for v in values)*scale
    fp._finite(result, low=-math.inf)
    return result


def _score_counts(attempts):
    count = _counts([dict(status=a['computationStatus']) for a in attempts])
    scoreable = [a for a in attempts if a['scoreStatus'] == 'scored']
    count.update(outcomeAvailableAttempts=sum(a['outcomeStatus'] == 'available' for a in attempts),
                 scoreableComputed=len(scoreable), unscoreableComputed=count['computed']-len(scoreable),
                 mae=_mean([a['metrics']['absoluteError'] for a in scoreable]),
                 bias=_mean([a['metrics']['signedError'] for a in scoreable]))
    return count


def score_provisional_issue(policy, computed, later_snapshot, *, expected_policy_hash,
                            expected_experiment_hash, expected_snapshot_hash, score_time):
    """Score original fixed attempts against completed, separately pinned later truth."""
    try:
        for pin in (expected_policy_hash, expected_experiment_hash, expected_snapshot_hash):
            _hash(pin)
        _admit(policy, 'policyHash', expected_policy_hash)
        _admit(computed, 'experimentHash', expected_experiment_hash)
        _admit_snapshot(later_snapshot, expected_snapshot_hash)
        policy = fp._validate_policy(policy, expected_policy_hash)
        computed = _validate_computed(policy, computed, expected_experiment_hash)
        at = _timestamp(score_time)
        _require(fp._dt(at) > fp._dt(computed['issueTime']))
        info = fp._info(later_snapshot, expected_snapshot_hash, at)
        source = deepcopy(later_snapshot)
        fp._info(source, expected_snapshot_hash, at)
        _match(policy, source, info)
        lookup = {entry['record']['date']: entry for entry in info['ledger']}
        attempts = []
        for attempt in computed['attempts']:
            target = attempt['targetInterval']
            entry = lookup.get(target['date']) if target else None
            reason = None
            if target is None or target['endUtc'] is None:
                reason = 'unresolved_target'
            elif fp._dt(target['endUtc']) > fp._dt(at):
                reason = 'target_incomplete_at_score'
            elif entry is None:
                reason = 'missing_outcome'
            elif entry['status'] != 'retained':
                reason = entry['reason']
            elif not fp._quality(entry['record']):
                reason = 'unsupported_outcome_quality'
            elif not fp._received_complete(entry):
                reason = 'incomplete_when_received'
            elif fp._dt(entry['record']['receivedAt']) < fp._dt(target['endUtc']):
                reason = 'outcome_received_before_target_end'
            elif fp._dt(entry['record']['receivedAt']) <= fp._dt(computed['issueTime']):
                reason = 'outcome_not_later_received'
            actual = entry['record']['value'] if reason is None else None
            score_reason = reason or ('original_withheld' if attempt['status'] == 'withheld' else None)
            metrics = None
            if score_reason is None:
                error = attempt['point']-actual
                if math.isfinite(error):
                    metrics = dict(absoluteError=abs(error), signedError=error)
                else:
                    score_reason = 'unsupported_score_numerical_range'
            attempts.append(dict(method=attempt['method'], model=attempt['model'],
                                 horizonDays=attempt['horizonDays'], computationStatus=attempt['status'],
                                 computationReasons=attempt['reasons'], point=attempt['point'],
                                 targetInterval=target, outcomeStatus='available' if reason is None else 'unavailable',
                                 outcomeReason=reason, outcomeValue=actual,
                                 outcomeLineage=entry['record'] if entry else None,
                                 scoreStatus='scored' if metrics else 'non_scoreable',
                                 scoreReason=score_reason, metrics=metrics))
        comparisons = []
        for horizon in HORIZONS:
            matched = {a['method']: a for a in attempts if a['horizonDays'] == horizon}
            for baseline in METHODS[1:]:
                candidate, reference = matched['candidate'], matched[baseline]
                fp._same(candidate['targetInterval'], reference['targetInterval'])
                comparable = candidate['metrics'] is not None and reference['metrics'] is not None
                comparisons.append(dict(horizonDays=horizon, targetInterval=candidate['targetInterval'],
                                        candidate='candidate', baseline=baseline, matchedCases=int(comparable),
                                        absoluteErrorDifference=(candidate['metrics']['absoluteError']-
                                                                 reference['metrics']['absoluteError'] if comparable else None)))
        return fp._seal(dict(artifact='offline-provisional-point-score', methodVersion=VERSION,
                             label=LABEL, operationalPublication=False, policyHash=expected_policy_hash,
                             experimentHash=expected_experiment_hash, snapshotHash=expected_snapshot_hash,
                             sourceSnapshot=source, forecastInformation=info['report'], identity=policy['identity'],
                             freezeTime=policy['freezeTime'], issueTime=computed['issueTime'], scoreTime=at,
                             constants=CONSTANTS, uncertainty=dict(prediction='unquantified', revision='unquantified'),
                             attempts=attempts, comparisons=comparisons, counts=_score_counts(attempts),
                             methodCounts={m: _score_counts([a for a in attempts if a['method'] == m]) for m in METHODS},
                             countScope='all-nine-method-horizon-attempts', targetCounts=_targets(attempts, scoring=True),
                             limitations=LIMITATIONS), 'scoreHash')
    except fp._INVALID:
        raise ValueError(ERROR) from None
