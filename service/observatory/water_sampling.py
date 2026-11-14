"""Descriptive sensitivity of recorded acquisition fractions; no temporal inference."""
from math import fsum

from service.observatory.vintages import canonical_hash
from service.observatory.water_history import _instant, summarize_water_history

VERSION = 'water-sampling-sensitivity-v1'
MAX_YEARS = 200


def _options(months, exclude):
    if months is None:
        months = list(range(1, 13))
    elif (not isinstance(months, (list, tuple)) or not months
          or any(type(month) is not int or not 1 <= month <= 12 for month in months)
          or len(set(months)) != len(months)):
        raise ValueError('months must be a nonempty list/tuple of distinct integers 1..12.')
    months = sorted(months)
    block = None
    if exclude is not None:
        if type(exclude) is not dict or set(exclude) != {'start', 'end'}:
            raise ValueError('exclude must contain exactly start and end.')
        start, start_text = _instant(exclude['start'])
        end, end_text = _instant(exclude['end'])
        if start >= end:
            raise ValueError('exclude requires start < end.')
        exclude = dict(start=start_text, end=end_text)
        block = (start, end)
    return dict(months=months, exclude=exclude, timeBasis='UTC', interval='[start,end)'), block


def _counts(rows):
    return dict(attempted=len(rows),
                observable=sum(row['visibility'] == 'observable' for row in rows),
                water=sum(row['state'] == 'water' for row in rows),
                dry=sum(row['state'] == 'dry' for row in rows),
                unknown=sum(row['state'] == 'unknown' for row in rows))


def _fraction(counts):
    return counts['water'] / counts['observable'] if counts['observable'] else None


def _view(rows, times, selected, years):
    retained, selected_ids, excluded_ids = [], [], []
    by_year = {year: [] for year in years}
    for row, instant, keep in zip(rows, times, selected):
        if keep:
            retained.append(row)
            selected_ids.append(row['sourceId'])
            by_year[instant.year].append(row)
        else:
            excluded_ids.append(row['sourceId'])
    counts = _counts(retained)
    yearly, withheld = [], []
    for year in years:
        group = by_year[year]
        year_counts = _counts(group)
        fraction = _fraction(year_counts)
        if fraction is None:
            withheld.append(year)
        yearly.append(dict(year=year, counts=year_counts, waterFraction=fraction,
                           firstAcquisition=group[0]['acquisitionTime'] if group else None,
                           lastAcquisition=group[-1]['acquisitionTime'] if group else None,
                           sourceIds=[row['sourceId'] for row in group]))
    return dict(counts=counts,
                observableUnknown=counts['observable'] - counts['water'] - counts['dry'],
                selectedSourceIds=selected_ids, excludedSourceIds=excluded_ids,
                yearSummaries=yearly, pooledWaterFraction=_fraction(counts),
                equalYearWaterFraction=fsum(item['waterFraction'] for item in yearly) / len(yearly)
                    if yearly and not withheld else None,
                withheldYears=withheld)


def _difference(left, right):
    def delta(key):
        a, b = left[key], right[key]
        return a - b if a is not None and b is not None else None
    return dict(pooledWaterFractionDelta=delta('pooledWaterFraction'),
                equalYearWaterFractionDelta=delta('equalYearWaterFraction'))


def analyze_water_sampling(observations, *, months=None, exclude=None):
    """Keep the v1 history intact; compare supplied records, never inferred gaps.

    Options select UTC months and optionally remove an explicit half-open block
    from that season. The fixed year population includes every UTC calendar year
    from first to last supplied acquisition, including missing/zero-observable
    years. Empty input has no years and no defined fractions.
    """
    options, block = _options(months, exclude)
    history = summarize_water_history(observations)
    rows = history['observations']
    times = [_instant(row['acquisitionTime'])[0] for row in rows]
    if times and times[-1].year - times[0].year + 1 > MAX_YEARS:
        raise ValueError(f'Acquisition span exceeds {MAX_YEARS} UTC calendar years.')
    years = list(range(times[0].year, times[-1].year + 1)) if times else []
    season = [instant.month in options['months'] for instant in times]
    removed = [keep and block is not None and block[0] <= instant < block[1]
               for instant, keep in zip(times, season)]
    views = dict(all=_view(rows, times, [True] * len(rows), years),
                 season=_view(rows, times, season, years),
                 withoutBlock=_view(rows, times,
                                    [keep and not drop for keep, drop in zip(season, removed)], years))
    return dict(methodVersion=VERSION, status='descriptive', inputHash=history['inputHash'],
                options=options, optionsHash=canonical_hash(options), history=history,
                yearPopulation=years, views=views,
                differences=dict(seasonVsAll=_difference(views['season'], views['all']),
                                 withoutBlockVsSeason=_difference(views['withoutBlock'], views['season'])),
                exclusion=dict(matchedSourceIds=[row['sourceId'] for row, drop in zip(rows, removed) if drop]),
                limitations=[
                    'Externally supplied classifications and compatibility assertions are not independently verified truth.',
                    'Fractions count recorded observable acquisitions, including observable unknowns; they do not measure days wet or water duration.',
                    'A zero water fraction with only observable unknown classifications is no positive water detection, not evidence of dry conditions.',
                    'Missing and zero-observable UTC years remain in the fixed population; the equal-year fraction is withheld if any such year exists.',
                    'Equal-year weighting is a different estimand from pooling acquisitions; neither is JRC occurrence or recurrence, which use different definitions and monthly normalization.',
                    'Month selection and the explicit exclusion block are descriptive comparisons, not a seasonal baseline, trend, uncertainty interval or sampling robustness guarantee.',
                    'An exclusion matching no records changes no retained fractions; this is not evidence about water or observation coverage in that interval.',
                    'No resampling, interpolation, gap-block inference, hydroperiod, hazard, cause, accuracy, confidence or forecast is estimated.',
                ])
