"""Experimental, receipt-pinned freeze/issue/score artifacts. No database/network access or E5 claim."""
from copy import deepcopy
from datetime import date, datetime, timedelta
import hashlib
import json
import math
import numpy as np

from . import forecast_v3 as forecasts
from .forecast_information import forecast_information
from .gauge_time import RULE_VERSION
from .vintage_contract import MAX_RECORD_BYTES, MAX_SNAPSHOT_BYTES
from .vintages import VintageError, _hash, _timestamp, canonical_hash, canonical_json

VERSION = 'daily-discharge-policy-v1'
PREDICTOR_VERSION = 'daily-discharge-predictors-v1'
QUALITY_VERSION = 'approved-literals-empty-qualifiers-v1'
APPROVED_LITERALS = ('Approved', 'approved')
HORIZONS = (1, 3, 7)
METHODS = ('candidate', 'persistence', 'seasonal-naive')
CONSTANTS = dict(minDays=1460, maxDays=2000, nominalCoverage=.9,
                 minimumImprovement=.1, minimumCoverage=.8, maximumLagHours=48,
                 zeroTolerance=1e-10, improvementTolerance=1e-12,
                 trendWindowDays=28, damping=.9, qualityVersion=QUALITY_VERSION,
                 selectionVersion=forecasts.VERSION, ruleVersion=RULE_VERSION,
                 predictorVersion=PREDICTOR_VERSION, approvedLiterals=list(APPROVED_LITERALS),
                 kernelVersion='frozen-forecast-v3-076fb17',
                 receiptCompletionVersion='completed-at-receipt-v1')
LIMITATIONS = [
    'Experimental single-station daily discharge only; no skill, coverage guarantee or E5 pass.',
    'Final-year release diagnostics are POLICY-DEVELOPMENT, not untouched policy evaluation.',
    'Local receipts and trusted hashes do not prove timestamp authenticity or complete upstream availability.',
    'Only literal Approved or approved with empty qualifiers is accepted; other quality strings are unsupported.',
    'Dependent targets, nonstationarity and historical metadata uncertainty remain; no significance inference.',
    'No current-engine comparison, high-flow utility or real scientist usefulness evidence is supplied.',
    'Artifacts embed bounded station snapshots including receipt/source lineage; treat these as private data.',
    'Later truth revisions produce new score artifacts; frozen policy and original issued artifact remain unchanged.',
    'Freeze/issue times are analytic cutoffs, not evidence artifacts existed then; independent custody is needed for preregistration.',
]
ERROR = 'Invalid forecast policy input'
_INVALID = (VintageError, ValueError, TypeError, KeyError, AttributeError,
            OverflowError, RecursionError, FloatingPointError, IndexError)
POLICY_KEYS = {'artifact', 'methodVersion', 'freezeTime', 'sourceSnapshot',
               'forecastInformation', 'identity', 'stationTime', 'constants',
               'status', 'reason', 'selectionReceipt', 'selectionHash',
               'sourceInputHash', 'development', 'limitations', 'policyHash'}
ISSUE_KEYS = {'artifact', 'methodVersion', 'policyHash', 'freezeTime', 'issueTime',
              'sourceSnapshot', 'snapshotHash', 'forecastInformation', 'identity',
              'attempts', 'counts', 'countScope', 'methodCounts', 'limitations', 'issueHash'}
DEVELOPMENT_KEYS = {'horizonDays', 'model', 'radii', 'mae', 'baselineMae',
                    'coverage', 'negativePredictionCount', 'nonzeroErrorCount',
                    'origins', 'gates', 'eligible', 'role'}


def _require(condition):
    if not condition:
        raise ValueError(ERROR)


def _same(a, b):
    # Python equality alone considers True == 1; canonical JSON preserves types.
    _require(canonical_json(a) == canonical_json(b))


def _finite(value, low=0, high=None):
    _require(type(value) in (int, float) and math.isfinite(value) and value >= low)
    if high is not None:
        _require(value <= high)
    return value


def _integer(value, low, high):
    _require(type(value) is int and low <= value <= high)


def _dt(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def _seal(value, key):
    value[key] = canonical_hash(value)
    # A JSON round-trip also separates repeated internal mutable references.
    return json.loads(canonical_json(value))


def _bounded(value, *, byte_limit=MAX_SNAPSHOT_BYTES + 65536):
    # Bound arbitrary untrusted nested artifacts before hashing or copying.
    remaining = 160000
    serialized_bytes = 0
    stack = [(value, 0)]
    while stack:
        item, depth = stack.pop()
        remaining -= 1
        _require(remaining >= 0 and depth <= 12)
        if type(item) is dict:
            _require(len(item) <= 40 and all(type(k) is str and len(k) <= 128 for k in item))
            serialized_bytes += 2 + max(0, len(item)-1) + sum(len(canonical_json(k))+1 for k in item)
            stack.extend((v, depth+1) for v in item.values())
        elif type(item) is list:
            _require(len(item) <= 2000)
            serialized_bytes += 2 + max(0, len(item)-1)
            stack.extend((v, depth+1) for v in item)
        elif type(item) is str:
            _require(len(item) <= 1024)
            serialized_bytes += len(canonical_json(item))
        elif type(item) in (int, float):
            _require(math.isfinite(item))
            serialized_bytes += len(canonical_json(item))
        else:
            _require(item is None or type(item) is bool)
            serialized_bytes += len(canonical_json(item))
        _require(serialized_bytes <= byte_limit)


def _pinned(value, keys, key, pin):
    _bounded(value)
    _require(type(value) is dict and set(value) == keys)
    _require(_hash(pin) == _hash(value[key]))
    # Bound collections before canonical serialization/copying.
    _require(type(value['limitations']) is list and len(value['limitations']) == len(LIMITATIONS))
    _same(value['limitations'], LIMITATIONS)
    _require(canonical_hash({k: v for k, v in value.items() if k != key}) == pin)
    _require(len(canonical_json(value).encode('utf-8')) <= MAX_SNAPSHOT_BYTES + 65536)
    detached = deepcopy(value)
    _require(canonical_hash({k: v for k, v in detached.items() if k != key}) == pin)
    return detached


def _info(snapshot, pin, at):
    # Shared historical validation hashes records before some field/byte checks.
    # This additive path must admit every raw external snapshot before that work.
    _bounded(snapshot, byte_limit=MAX_SNAPSHOT_BYTES)
    _require(type(snapshot) is dict and type(snapshot.get('observations')) is list)
    for record in snapshot['observations']:
        _bounded(record, byte_limit=MAX_RECORD_BYTES)
    return forecast_information(snapshot, expected_snapshot_hash=pin, issue_time=at,
                                horizons=HORIZONS)


def _quality(point):
    return point['quality'] in APPROVED_LITERALS and point['qualifiers'] == []


def _received_complete(entry):
    end = entry['stationDay']['endUtc']
    return end is not None and _dt(entry['record']['receivedAt']) >= _dt(end)


def _support_reason(info):
    points = info['points']
    if info['report']['status'] != 'resolved':
        return info['report']['reason']
    if not 1460 <= len(points) <= 2000:
        return 'insufficient_completed_history'
    if any(not _quality(p) for p in points):
        return 'unsupported_quality'
    if any(entry['status'] == 'retained' and not _received_complete(entry) for entry in info['ledger']):
        return 'incomplete_when_received'
    if any(date.fromisoformat(b['date']) - date.fromisoformat(a['date']) != timedelta(days=1)
           for a, b in zip(points, points[1:])):
        return 'discontinuous_completed_history'
    return None


def _folds(points):
    n = len(points)
    test = n - 365
    selection = test - 365
    calibration = selection + 182
    return (selection, calibration, test,
            list(range(selection, calibration - 7, 5)),
            list(range(calibration, test - 7, 5)), list(range(test, n - 7, 7)))


def _selection_receipt(points, development):
    selection, calibration, test, so, co, _ = _folds(points)
    return dict(methodVersion=forecasts.VERSION,
                models={str(d['horizonDays']): d['model'] for d in development},
                trainingStart=points[0]['date'], trainingEnd=points[selection-1]['date'],
                selectionStart=points[selection]['date'], selectionEnd=points[calibration-1]['date'],
                calibrationStart=points[calibration]['date'], calibrationEnd=points[test-1]['date'],
                testStart=points[test]['date'], trainingMinimumDays=730,
                selectionOrigins=len(so), calibrationOrigins=len(co), trendWindowDays=28,
                damping=.9, intervalNominalCoverage=.9,
                radii={str(d['horizonDays']): d['radii']['candidate'] for d in development})


def _gates(d):
    best = min(d['baselineMae'].values())
    improvement = (best-d['mae'])/best if best > 0 else 0.
    return dict(improvementFraction=improvement,
                improvement=best > 0 and improvement >= .1-1e-12,
                coverage=d['coverage'] >= .8,
                nonnegative=d['negativePredictionCount'] == 0,
                zeroBand=not (d['radii']['candidate'] <= 1e-10 and d['nonzeroErrorCount'] > 0))


def _eligible(gates):
    return all(gates[k] for k in ('improvement', 'coverage', 'nonnegative', 'zeroBand'))


def freeze_policy(snapshot, *, expected_snapshot_hash, freeze_time):
    """Fit once on the pinned freeze information set; return ready or withheld."""
    try:
        at = _timestamp(freeze_time)
        info = _info(snapshot, expected_snapshot_hash, at)
        # Source is copied and revalidated against the external pin, never caller-owned.
        source = deepcopy(snapshot)
        _info(source, expected_snapshot_hash, at)
        reason = _support_reason(info)
        development = []
        selection = selection_hash = input_hash = None
        if reason is None:
            try:
                with np.errstate(over='raise', invalid='raise', divide='raise'):
                    # No issue-time stale/target gate participates in development.
                    # Only validation/selection are consumed, never evaluator forecasts.
                    evaluation = forecasts.evaluate_gauge(info['points'], source['identity']['station'],
                                                          source['identity']['unit'], now=_dt(at))
                    if len(evaluation['validation']) != 3:
                        raise FloatingPointError()
                    values = np.array([p['value'] for p in info['points']], dtype=float)
                    _, _, _, _, co, origins = _folds(info['points'])
                    for validation in evaluation['validation']:
                        h, model = validation['horizonDays'], validation['model']
                        radii = dict(candidate=evaluation['frozenSelection']['radii'][str(h)])
                        for baseline in METHODS[1:]:
                            radii[baseline] = forecasts.calibration_radius(np.array([
                                abs(forecasts.predict(values, o, h, baseline)-values[o+h]) for o in co]))
                        prediction = np.array([forecasts.predict(values, o, h, model) for o in origins])
                        residual = np.abs(prediction-values[np.array(origins)+h])
                        d = dict(horizonDays=h, model=model, radii=radii, mae=validation['mae'],
                                 baselineMae={b['model']: b['mae'] for b in validation['baselinePerformance']},
                                 coverage=validation['intervalCoverage'],
                                 negativePredictionCount=validation['intervalDiagnostics']['negativePredictionCount'],
                                 nonzeroErrorCount=int((residual > 1e-10).sum()), origins=len(origins),
                                 role='POLICY-DEVELOPMENT')
                        d['gates'] = _gates(d)
                        d['eligible'] = _eligible(d['gates'])
                        development.append(d)
                    selection = evaluation['frozenSelection']
                    selection_hash = evaluation['selectionHash']
                    input_hash = evaluation['sourceInputHash']
                    # Validate every numeric result, including baseline widths.
                    for d in development:
                        _finite(d['mae']); _finite(d['coverage'], high=1)
                        _finite(d['gates']['improvementFraction'], low=-math.inf)
                        for mae in d['baselineMae'].values():
                            _finite(mae)
                        for q in d['radii'].values():
                            _finite(q); _finite(2*q)
            except (FloatingPointError, OverflowError, ValueError):
                reason = 'unsupported_numerical_range'
                development = []
                selection = selection_hash = input_hash = None
        policy = _seal(dict(artifact='frozen-policy', methodVersion=VERSION, freezeTime=at,
                            sourceSnapshot=source, forecastInformation=info['report'],
                            identity=source['identity'], stationTime=info['report']['stationTime'],
                            constants=CONSTANTS, status='withheld' if reason else 'ready', reason=reason,
                            selectionReceipt=selection, selectionHash=selection_hash,
                            sourceInputHash=input_hash, development=development,
                            limitations=LIMITATIONS), 'policyHash')
        _validate_policy(policy, policy['policyHash'])
        return policy
    except _INVALID:
        raise ValueError(ERROR) from None


def _validate_policy(policy, pin):
    """Check structure/lineage and development equations without evaluating/fitting."""
    _bounded(policy)
    _require(type(policy) is dict and set(policy) == POLICY_KEYS)
    _require(type(policy['development']) is list and len(policy['development']) <= 3)
    at = _timestamp(policy['freezeTime'])
    _require(at == policy['freezeTime'])
    source = policy['sourceSnapshot']
    info = _info(source, source['snapshotHash'], at)
    policy = _pinned(policy, POLICY_KEYS, 'policyHash', pin)
    # Recheck the detached source; pin protects mutation at the copy boundary.
    copied = _info(policy['sourceSnapshot'], source['snapshotHash'], at)
    _same(info, copied)
    _same(policy['forecastInformation'], info['report'])
    _same(policy['identity'], source['identity'])
    _same(policy['stationTime'], info['report']['stationTime'])
    _same(policy['constants'], CONSTANTS)
    _require(policy['artifact'] == 'frozen-policy' and policy['methodVersion'] == VERSION)
    support = _support_reason(info)
    if policy['status'] == 'withheld':
        _require(policy['reason'] == (support or 'unsupported_numerical_range'))
        _same(policy['development'], [])
        _require(all(policy[k] is None for k in ('selectionReceipt', 'selectionHash', 'sourceInputHash')))
        return policy
    _require(policy['status'] == 'ready' and policy['reason'] is None and support is None)
    _require(len(policy['development']) == 3)
    origins = len(_folds(info['points'])[-1])
    for h, d in zip(HORIZONS, policy['development']):
        _require(type(d) is dict and set(d) == DEVELOPMENT_KEYS)
        _require(type(d['horizonDays']) is int and d['horizonDays'] == h)
        _require(d['model'] in forecasts.MODELS and d['role'] == 'POLICY-DEVELOPMENT')
        _require(type(d['radii']) is dict and set(d['radii']) == set(METHODS))
        for q in d['radii'].values():
            _finite(q); _finite(2*q)
        _finite(d['mae']); _finite(d['coverage'], high=1)
        _require(type(d['baselineMae']) is dict and set(d['baselineMae']) == set(METHODS[1:]))
        for mae in d['baselineMae'].values():
            _finite(mae)
        _integer(d['origins'], origins, origins)
        _integer(d['negativePredictionCount'], 0, origins)
        _integer(d['nonzeroErrorCount'], 0, origins)
        _same(d['gates'], _gates(d))
        _same(d['eligible'], _eligible(d['gates']))
        if d['model'] in METHODS[1:]:
            _same(d['radii']['candidate'], d['radii'][d['model']])
            _same(d['mae'], d['baselineMae'][d['model']])
    receipt = _selection_receipt(info['points'], policy['development'])
    _same(policy['selectionReceipt'], receipt)
    _require(_hash(policy['selectionHash']) == hashlib.sha256(
        json.dumps(receipt, sort_keys=True).encode()).hexdigest())
    _require(_hash(policy['sourceInputHash']) == hashlib.sha256(
        json.dumps(info['points'], sort_keys=True, allow_nan=False).encode()).hexdigest())
    return policy


def _predict(info, model, h, timing):
    """Frozen-family prediction on exact past-only calendar support.

    Trend coefficients update from the declared 28-day window; family selection
    and empirical interval calibration remain confined to policy development.
    """
    latest = info['report']['latestRetainedDate']
    if latest is None or timing['targetInterval'] is None or timing['targetInterval']['startUtc'] is None:
        return None, [], 'missing_predictor_support'
    if model == 'seasonal-naive':
        days = [(date.fromisoformat(timing['targetInterval']['date'])-timedelta(days=365)).isoformat()]
    elif model == 'persistence':
        days = [latest]
    else:
        days = [(date.fromisoformat(latest)-timedelta(days=i)).isoformat() for i in range(27, -1, -1)]
    lookup = {p['date']: p for p in info['points']}
    records = [lookup.get(day) for day in days]
    lineage = [p['versionHash'] for p in records if p is not None]
    if any(p is None for p in records):
        return None, lineage, 'missing_predictor_support'
    if any(not _quality(p) for p in records):
        return None, lineage, 'unsupported_predictor_quality'
    ledger = {entry['record']['date']: entry for entry in info['ledger']}
    if any(not _received_complete(ledger[day]) for day in days):
        return None, lineage, 'incomplete_when_received'
    try:
        with np.errstate(over='raise', invalid='raise', divide='raise'):
            if model in ('persistence', 'seasonal-naive'):
                point = records[0]['value']
            else:
                values = np.array([p['value'] for p in records], dtype=float)
                point = forecasts.predict(values, 27, h, model)
            _finite(point)
        return float(point), lineage, None
    except (ValueError, FloatingPointError, OverflowError):
        return None, lineage, 'invalid_prediction'


def _method_counts(attempts, scoring=False):
    counts = {}
    for method in METHODS:
        selected = [a for a in attempts if a['method'] == method]
        published = sum(a['publicationStatus' if scoring else 'status'] == 'published' for a in selected)
        count = dict(attempted=3, published=published, withheld=3-published, publicationRate=published/3)
        if scoring:
            scoreable = sum(a['scoreStatus'] == 'scored' for a in selected)
            count.update(outcomeAvailableAttempts=sum(a['outcomeStatus'] == 'available' for a in selected),
                         scoreablePublished=scoreable, unscoreablePublished=published-scoreable)
        counts[method] = count
    return counts


def _make_issue(policy, source, info, at):
    _require(_dt(at) > _dt(policy['freezeTime']))
    _same(source['identity'], policy['identity'])
    # Different metadata/rules are a contract error, not a silently transferred policy.
    props = policy['stationTime']['properties']
    if props is not None:
        for record in source['observations']:
            _same(record['stationTimeProperties'], props)
    _require(info['report']['stationTime']['ruleVersion'] == policy['stationTime']['ruleVersion'])
    if props is not None and source['observations']:
        _same(info['report']['stationTime']['registryHashes'], policy['stationTime']['registryHashes'])
    development = {d['horizonDays']: d for d in policy['development']}
    attempts = []
    for timing in info['report']['timingAttempts']:
        h = timing['horizonDays']
        d = development.get(h)
        for method in METHODS:
            model = d['model'] if method == 'candidate' and d else method
            reasons = []
            if policy['status'] != 'ready':
                reasons.append('policy_withheld')
            if not timing['timingEligible']:
                reasons.append(timing['reason'])
            if timing['lagHours'] is None or not 0 <= timing['lagHours'] <= 48:
                reasons.append('stale_or_unresolved_observation')
            if method == 'candidate' and d and not d['eligible']:
                reasons.append('candidate_development_gate_failed')
            point, lineage, support = _predict(info, model, h, timing) if d else (None, [], None)
            if support:
                reasons.append(support)
            q = d['radii'][method] if d else None
            distribution = None
            if point is not None and q is not None:
                lower, upper = point-q, point+q
                if not all(math.isfinite(v) for v in (lower, upper)):
                    reasons.append('unsupported_numerical_range')
                elif point < 0 or lower < 0:
                    reasons.append('negative_discharge_band')
                elif not reasons:
                    distribution = dict(point=point, lower=lower, upper=upper,
                                        unit=policy['identity']['unit'], nominalCoverage=.9)
            predictor = dict(methodVersion=PREDICTOR_VERSION, model=model, horizonDays=h,
                             informationHash=info['report']['informationHash'],
                             targetInterval=timing['targetInterval'], inputVersionHashes=lineage,
                             radius=q)
            attempts.append(dict(method=method, model=model, horizonDays=h,
                                 status='withheld' if reasons else 'published', reasons=reasons,
                                 distribution=distribution, timing=deepcopy(timing),
                                 predictor=predictor, predictorHash=canonical_hash(predictor)))
    published = sum(a['status'] == 'published' for a in attempts)
    return _seal(dict(artifact='issued-policy', methodVersion=VERSION, policyHash=policy['policyHash'],
                      freezeTime=policy['freezeTime'], issueTime=at, sourceSnapshot=source,
                      snapshotHash=source['snapshotHash'], forecastInformation=info['report'],
                      identity=policy['identity'], attempts=attempts,
                      counts=dict(attempted=9, published=published, withheld=9-published,
                                  publicationRate=published/9),
                      countScope='all-method-horizon-attempts', methodCounts=_method_counts(attempts),
                      limitations=LIMITATIONS), 'issueHash')


def issue_policy(policy, snapshot, *, expected_policy_hash, expected_snapshot_hash, issue_time):
    """Issue exactly nine attempts using frozen radii and this issue's predictors."""
    try:
        policy = _validate_policy(policy, expected_policy_hash)
        at = _timestamp(issue_time)
        info = _info(snapshot, expected_snapshot_hash, at)
        source = deepcopy(snapshot)
        _info(source, expected_snapshot_hash, at)
        return _make_issue(policy, source, info, at)
    except _INVALID:
        raise ValueError(ERROR) from None


def _validate_issue(policy, issued, pin):
    _bounded(issued)
    _require(type(issued) is dict and set(issued) == ISSUE_KEYS)
    _require(type(issued['attempts']) is list and len(issued['attempts']) == 9)
    at = _timestamp(issued['issueTime'])
    _require(at == issued['issueTime'])
    info = _info(issued['sourceSnapshot'], issued['snapshotHash'], at)
    issued = _pinned(issued, ISSUE_KEYS, 'issueHash', pin)
    # Regeneration validates every nested field, type, gate, target, distribution and hash.
    regenerated = _make_issue(policy, issued['sourceSnapshot'], info, at)
    _same(issued, regenerated)
    return issued


def _metric(distribution, actual):
    point, lower, upper = (distribution[k] for k in ('point', 'lower', 'upper'))
    bias = point-actual
    width = upper-lower
    winkler = width + 20*max(lower-actual, actual-upper, 0)
    _finite(abs(bias)); _finite(width); _finite(winkler)
    return dict(absoluteError=abs(bias), signedBias=bias, bandHit=lower <= actual <= upper,
                bandWidth=width, winkler=winkler, nominalCoverage=.9)


def score_issue(policy, issued, outcome_snapshot, *, expected_policy_hash, expected_issue_hash,
                expected_snapshot_hash, score_time):
    """Score the immutable original attempts against a separately pinned later receipt."""
    try:
        policy = _validate_policy(policy, expected_policy_hash)
        issued = _validate_issue(policy, issued, expected_issue_hash)
        at = _timestamp(score_time)
        _require(_dt(at) > _dt(issued['issueTime']))
        info = _info(outcome_snapshot, expected_snapshot_hash, at)
        _same(info['report']['identity'], policy['identity'])
        props = policy['stationTime']['properties']
        if props is not None:
            for entry in info['ledger']:
                _same(entry['record']['stationTimeProperties'], props)
        lookup = {entry['record']['date']: entry for entry in info['ledger']}
        scored = []
        for attempt in issued['attempts']:
            target = attempt['timing']['targetInterval']
            reason = None
            entry = lookup.get(target['date']) if target else None
            if target is None or target['endUtc'] is None:
                reason = 'unresolved_target'
            elif _dt(target['endUtc']) > _dt(at):
                reason = 'target_incomplete_at_score'
            elif entry is None:
                reason = 'missing_outcome'
            elif entry['status'] != 'retained':
                reason = entry['reason']
            elif not _quality(entry['record']):
                reason = 'unsupported_outcome_quality'
            elif not _received_complete(entry):
                reason = 'incomplete_when_received'
            elif _dt(entry['record']['receivedAt']) <= _dt(issued['issueTime']):
                reason = 'outcome_not_later_received'
            actual = entry['record']['value'] if reason is None else None
            metrics = None
            score_reason = reason or ('original_withheld' if attempt['status'] == 'withheld' else None)
            if score_reason is None:
                try:
                    metrics = _metric(attempt['distribution'], actual)
                except (ValueError, OverflowError):
                    score_reason = 'unsupported_score_numerical_range'
            scored.append(dict(method=attempt['method'], horizonDays=attempt['horizonDays'],
                               publicationStatus=attempt['status'], publicationReasons=attempt['reasons'],
                               targetInterval=target, outcomeStatus='available' if reason is None else 'unavailable',
                               outcomeReason=reason, outcomeValue=actual,
                               outcomeVersionHash=entry['record']['versionHash'] if entry else None,
                               scoreStatus='scored' if metrics is not None else 'non_scoreable',
                               scoreReason=score_reason, metrics=metrics))
        comparisons = []
        for h in HORIZONS:
            matched = {s['method']: s for s in scored if s['horizonDays'] == h}
            for baseline in METHODS[1:]:
                candidate, reference = matched['candidate'], matched[baseline]
                comparable = candidate['metrics'] is not None and reference['metrics'] is not None
                comparisons.append(dict(horizonDays=h, candidate='candidate', baseline=baseline,
                                        matchedCases=int(comparable),
                                        absoluteErrorDifference=(candidate['metrics']['absoluteError']-
                                                                 reference['metrics']['absoluteError'] if comparable else None),
                                        winklerDifference=(candidate['metrics']['winkler']-
                                                           reference['metrics']['winkler'] if comparable else None)))
        published = issued['counts']['published']
        count = sum(s['scoreStatus'] == 'scored' for s in scored)
        return _seal(dict(artifact='scored-issue', methodVersion=VERSION, policyHash=expected_policy_hash,
                          issueHash=expected_issue_hash, outcomeSnapshotHash=expected_snapshot_hash,
                          outcomeInformation=info['report'], freezeTime=policy['freezeTime'],
                          issueTime=issued['issueTime'], scoreTime=at, attempts=scored, comparisons=comparisons,
                          counts=dict(attempted=9, published=published, withheld=9-published,
                                      publicationRate=published/9,
                                      outcomeAvailableAttempts=sum(s['outcomeStatus'] == 'available' for s in scored),
                                      scoreablePublished=count, unscoreablePublished=published-count),
                          countScope='all-method-horizon-attempts', methodCounts=_method_counts(scored, scoring=True),
                          limitations=LIMITATIONS), 'scoreHash')
    except _INVALID:
        raise ValueError(ERROR) from None
