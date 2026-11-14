"""Deterministic catalogue grouping; discovery never proves usable pixels."""
from datetime import datetime, timezone
from .providers import digest

COMPATIBILITY = ('kind', 'grid', 'version', 'platform', 'sourceId')
KINDS = frozenset(('sentinel', 'hls', 'landsat', 'dswx'))


def compatible_groups(candidates, evidence, request):
    """Return ranked unique-day groups and credential-free omission counts.

    Prefer any multi-date group over a singleton, then the newest endpoint,
    earliest baseline and lexical compatibility key. Same-day duplicates use
    latest acquisition time, item ID, evidence ID and a final content hash. This
    is a reproducibility tie-break, not an unverified quality ranking.
    """
    sources = {e['id']: e for e in evidence}
    grouped = {}
    rejected = duplicates = 0
    for original in candidates:
        try:
            c = dict(original)
            source = sources[c['evidenceId']]
            linked = source.get('sourceId')
            if c.get('sourceId') is None:
                c['sourceId'] = linked
            elif linked is not None and c['sourceId'] != linked:
                raise ValueError()
            if any(not isinstance(c.get(k), str) or not c[k].strip() or
                   c[k].strip().lower() in ('unknown', 'none', 'unspecified')
                   for k in COMPATIBILITY):
                raise ValueError()
            if c['kind'] not in KINDS or not isinstance(c['itemId'], str) or not c['itemId']:
                raise ValueError()
            stamp = datetime.fromisoformat(c['date'].replace('Z', '+00:00'))
            if stamp.tzinfo is None:
                raise ValueError()
            stamp = stamp.astimezone(timezone.utc)
            # Existing manifests use the recorded acquisition's calendar date.
            # Ambiguous cross-midnight offsets are withheld rather than relabelled.
            day = stamp.date().isoformat()
            if day != c['date'][:10] or not request['start'] <= day <= request['end']:
                raise ValueError()
            key = tuple(c[k] for k in COMPATIBILITY)
            tie = (stamp, c['itemId'], c['evidenceId'], digest(c))
            days = grouped.setdefault(key, {})
            if day in days:
                duplicates += 1
            if day not in days or tie > days[day][0]:
                days[day] = (tie, c)
        except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
            rejected += 1
    groups = []
    for key, days in grouped.items():
        records = [days[day][1] for day in sorted(days)]
        groups.append(dict(key=key, id=digest(key)[:12], records=records,
                           selected=records if len(records) <= 4 else records[:2] + records[-2:]))
    # Stable sorting preserves lexical key order on equal temporal ranks.
    groups.sort(key=lambda g: g['key'])
    groups.sort(key=lambda g: g['records'][0]['date'])
    groups.sort(key=lambda g: g['records'][-1]['date'], reverse=True)
    groups.sort(key=lambda g: len(g['records']) >= 2, reverse=True)
    return groups, dict(rejected=rejected, duplicates=duplicates)
