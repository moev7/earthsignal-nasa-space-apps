"""Descriptive externally classified water states; no interpolation or hydroperiod."""
import hashlib
import json
import re
from copy import deepcopy
from datetime import datetime, timezone

VERSION = 'recorded-water-history-v1'
MAX_OBSERVATIONS = 2000
MAX_TEXT_CHARACTERS = 1024 ** 2
_IDENTITY = ('siteId', 'supportId', 'quantityId', 'classificationMethodId')
_FIELDS = frozenset((*_IDENTITY, 'sourceId', 'evidenceIds', 'acquisitionTime',
                     'state', 'visibility', 'visibilityReason'))
_TIME = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
                   r'(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})\Z')


def _text(value, name):
    if (not isinstance(value, str) or not value or value != value.strip()
            or len(value) > 1024 or not value.isprintable()):
        raise ValueError(f'{name} must be nonempty trimmed printable text of at most 1024 characters.')
    return value


def _instant(value):
    if not isinstance(value, str) or not _TIME.fullmatch(value) or value.endswith('-00:00'):
        raise ValueError('acquisitionTime requires an ISO timestamp with an explicit known timezone offset.')
    if not value.endswith('Z') and (int(value[-5:-3]) > 23 or int(value[-2:]) > 59):
        raise ValueError('acquisitionTime has an invalid timezone offset.')
    try:
        instant = datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc)
    except (ValueError, OverflowError) as exc:
        raise ValueError('acquisitionTime is not a representable timezone-aware instant.') from exc
    return instant, instant.isoformat().replace('+00:00', 'Z')


def _endpoint(record):
    return dict(sourceId=record['sourceId'], acquisitionTime=record['acquisitionTime'],
                state=record['state'], evidenceIds=list(record['evidenceIds']))


def _span(rows, times):
    if not rows:
        return None
    return dict(start=rows[0]['acquisitionTime'], end=rows[-1]['acquisitionTime'],
                elapsedSeconds=(times[-1] - times[0]).total_seconds())


def summarize_water_history(observations):
    """Validate and summarize 0..2000 strictly ordered recorded classifications.

    Input is a list/tuple of exact-schema dictionaries (see docs/water-state-history.md).
    Compatibility is asserted by the caller, never independently established here.
    Invalid input raises ValueError; valid sparse/unknown input stays descriptive.
    """
    if not isinstance(observations, (list, tuple)) or len(observations) > MAX_OBSERVATIONS:
        raise ValueError(f'observations must be a list or tuple of at most {MAX_OBSERVATIONS} records.')
    rows, times, source_ids = [], [], set()
    identity = None
    text_characters = 0
    for index, record in enumerate(observations):
        if not isinstance(record, dict) or record.keys() != _FIELDS:
            raise ValueError(f'Observation {index} must contain exactly the documented fields.')
        row = {key: _text(record[key], key) for key in (*_IDENTITY, 'sourceId', 'visibilityReason')}
        asserted = {key: row[key] for key in _IDENTITY}
        if identity is None:
            identity = asserted
        elif asserted != identity:
            raise ValueError('All observations must assert the same site, support, quantity and classification method.')
        if row['sourceId'] in source_ids:
            raise ValueError('sourceId must uniquely identify each recorded classification.')
        source_ids.add(row['sourceId'])
        evidence = record['evidenceIds']
        if not isinstance(evidence, (list, tuple)) or not 1 <= len(evidence) <= 32:
            raise ValueError('evidenceIds requires 1..32 distinct evidence identifiers.')
        evidence = [_text(value, 'evidenceIds entry') for value in evidence]
        if len(set(evidence)) != len(evidence):
            raise ValueError('evidenceIds must not contain duplicates.')
        row['evidenceIds'] = sorted(evidence)
        instant, row['acquisitionTime'] = _instant(record['acquisitionTime'])
        if times and instant <= times[-1]:
            raise ValueError('acquisitionTime must be strictly increasing and unique after UTC normalization.')
        state, visibility = record['state'], record['visibility']
        if not isinstance(state, str) or state not in ('water', 'dry', 'unknown'):
            raise ValueError('state must be water, dry or unknown.')
        if not isinstance(visibility, str) or visibility not in ('observable', 'unobservable'):
            raise ValueError('visibility must be observable or unobservable.')
        if state != 'unknown' and visibility != 'observable':
            raise ValueError('Known water/dry states require observable support.')
        row.update(state=state, visibility=visibility)
        # Count repeated retained strings too. ASCII escaping costs at most 12
        # bytes per Unicode code point; admit before building canonical JSON.
        text_characters += sum(len(value) for value in row.values() if isinstance(value, str))
        text_characters += sum(len(value) for value in row['evidenceIds'])
        if text_characters > MAX_TEXT_CHARACTERS:
            raise ValueError('Observation aggregate text exceeds the supported character budget.')
        rows.append(row)
        times.append(instant)

    counts = dict(attempted=len(rows), observable=sum(r['visibility'] == 'observable' for r in rows),
                  water=sum(r['state'] == 'water' for r in rows),
                  dry=sum(r['state'] == 'dry' for r in rows),
                  unknown=sum(r['state'] == 'unknown' for r in rows))
    known = [i for i, row in enumerate(rows) if row['state'] != 'unknown']
    observable = [i for i, row in enumerate(rows) if row['visibility'] == 'observable']
    acquisition_gaps = [dict(leftSourceId=rows[i-1]['sourceId'], rightSourceId=rows[i]['sourceId'],
                             start=rows[i-1]['acquisitionTime'], end=rows[i]['acquisitionTime'],
                             elapsedSeconds=(times[i] - times[i-1]).total_seconds())
                        for i in range(1, len(rows))]
    intervals, transitions = [], []
    for left, right in zip(known, known[1:]):
        opposite = rows[left]['state'] != rows[right]['state']
        interval = dict(left=_endpoint(rows[left]), right=_endpoint(rows[right]),
                        elapsedSeconds=(times[right] - times[left]).total_seconds(),
                        interveningUnknownObservations=[dict(sourceId=r['sourceId'],
                            acquisitionTime=r['acquisitionTime'], evidenceIds=list(r['evidenceIds']),
                            state=r['state'], visibility=r['visibility'], visibilityReason=r['visibilityReason'])
                            for r in rows[left+1:right]],
                        endpointRelation='opposite' if opposite else 'same',
                        minimumTransitions=1 if opposite else 0,
                        multipleTransitionsUnresolved=True, continuityEstablished=False)
        intervals.append(interval)
        if opposite:
            transitions.append(dict(**deepcopy(interval), direction=f"{rows[left]['state']}-to-{rows[right]['state']}",
                                    leftOpen=True, rightClosed=True))
    flags = []
    if counts['unknown']:
        flags.append('unknown-observations')
    if len(known) < 2:
        flags.append('fewer-than-two-known-acquisitions')
    if len({gap['elapsedSeconds'] for gap in acquisition_gaps}) > 1:
        flags.append('unequal-acquisition-spacing')
    canonical = json.dumps(rows, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)
    return dict(methodVersion=VERSION, inputHash=hashlib.sha256(canonical.encode('utf-8')).hexdigest(),
                status='descriptive', identity=identity, observations=rows, counts=counts,
                waterFractionAmongObservableAcquisitions=counts['water']/counts['observable']
                    if counts['observable'] else None,
                observedTimeSpan=_span(rows, times),
                samplingSupport=dict(knownAcquisitions=len(known),
                    observableTimeSpan=_span([rows[i] for i in observable], [times[i] for i in observable]),
                    knownTimeSpan=_span([rows[i] for i in known], [times[i] for i in known]),
                    leadingUnknownAcquisitions=known[0] if known else None,
                    trailingUnknownAcquisitions=len(rows)-known[-1]-1 if known else None,
                    flags=flags, sensitivityEvaluated=False),
                acquisitionGaps=acquisition_gaps, knownEndpointIntervals=intervals,
                intervalCensoredTransitions=transitions,
                limitations=[
                    'Externally supplied classifications and compatibility assertions are not independently verified truth.',
                    'The water fraction counts observable acquisitions, including observable unknown classifications; it is not a fraction of days or water duration.',
                    'Acquisition gaps describe elapsed time between supplied records, not the number of missing acquisitions or visibility between them.',
                    'Opposite known endpoints imply at least one transition in (left, right] conditional on valid classifications; timing and additional transitions remain unresolved.',
                    'Equal known endpoints do not establish continuous water, continuous dry conditions, or absence of changes.',
                    'No interpolation, hydroperiod, cause, confidence, ecological trend or forecast is estimated.',
                    'Leading/trailing unknown counts are undefined without a known acquisition; all unknown records remain counted and visible.',
                ])
