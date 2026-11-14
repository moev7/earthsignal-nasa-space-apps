"""Bounded descriptive seasonal slopes for one approved daily discharge series.

No significance test, confidence interval, event detection or extrapolation.
The original observations remain separate; this module never imputes a day.
"""
import calendar
import hashlib
import json
import math
from datetime import date

VERSION = 'station-seasonal-sen-v1'
REFERENCE = 'https://pubs.usgs.gov/tm/04/a03/tm4a3.pdf'


def median(values):
    ordered = sorted(values)
    n = len(ordered)
    if not n:
        return None
    return ordered[n//2] if n % 2 else ordered[n//2-1]/2 + ordered[n//2]/2


def seasonal_trend(series):
    """Input is publication-bound to a single USGS station/time-series by caller."""
    points = series['points']
    base = dict(methodVersion=VERSION, inputHash=hashlib.sha256(json.dumps(
        {k:v for k,v in series.items() if k not in ('analysis','seasonalTrend','seasonalSampling')},
        sort_keys=True, separators=(',',':'), allow_nan=False).encode()).hexdigest(),
        status='withheld', reason='', unit=series['unit']+'/year', slope=None,
        years=[], commonMonths=[], pairCount=0, months=[], byMonth=[], leaveYearOut=[],
        sensitivityRange=None, signStable=None, references=[REFERENCE],
        notes=[
            'Describes one station and recorded time-series; not area-wide conditions, a cause, a hazard or a forecast.',
            'Only complete calendar months with at least 80% approved finite nonnegative daily readings qualify. This is an initial engineering gate, not proof that missing days are representative.',
            'Eligible years have at least six qualifying months; at least three years and six common months across every eligible year are required.',
            'Each month and year-pair has equal weight. The slope is the median of same-month interyear median differences divided by their calendar-year separation.',
            'Leave-one-year-out calculations keep the original common months fixed. Their range is sensitivity to recorded years, not a confidence interval or probability.',
            'A zero slope or stable sign does not establish no environmental change or predictive reliability. Seasonal responses, interventions and nonlinear changes may differ.',
            'Approval status does not rule out station, rating-curve or sampling changes. Missing peaks can bias monthly medians even at high coverage.'
        ])
    def withheld(reason):
        base['reason'] = reason
        return base
    if series['id'] != 'usgs-discharge' or series['unit'] != 'ft^3/s' or len(series['evidenceIds']) != 1:
        return withheld('Requires one source-bound USGS daily mean discharge series in ft^3/s.')
    if not points or len(points)>2000:
        return withheld('Requires a daily history of at most 2000 calendar slots.')
    dates = [date.fromisoformat(p['date']) for p in points]
    if any((b-a).days != 1 for a,b in zip(dates,dates[1:])):
        return withheld('Requires ordered consecutive calendar slots; unobserved days must be explicit, never interpolated.')
    groups = {}
    for d,p in zip(dates,points):
        groups.setdefault((d.year,d.month),[]).append(p)
    for (year,month),rows in sorted(groups.items()):
        days = calendar.monthrange(year,month)[1]
        good = lambda p: (isinstance(p['value'],(int,float)) and not isinstance(p['value'],bool)
                          and math.isfinite(p['value']) and p['value']>=0
                          and p['quality'].strip().lower() in ('approved','a'))
        values = [p['value'] for p in rows if good(p)]
        run = longest = 0
        for p in rows:
            run = 0 if good(p) else run+1
            longest = max(longest,run)
        complete = dates[0] <= date(year,month,1) and dates[-1] >= date(year,month,days)
        eligible = complete and len(values)*5 >= days*4
        base['months'].append(dict(year=year,month=month,calendarDays=days,recordedDays=len(rows),
            approvedDays=len(values),excludedDays=len(rows)-len(values),longestExcludedRun=longest,
            complete=complete,eligible=eligible,median=median(values) if eligible else None))
    eligible = [m for m in base['months'] if m['eligible']]
    years = sorted(y for y in {m['year'] for m in eligible} if sum(m['year']==y for m in eligible)>=6)
    base['years'] = years
    common = sorted(set.intersection(*[{m['month'] for m in eligible if m['year']==y} for y in years])) if years else []
    base['commonMonths'] = common
    if len(years)<3 or len(common)<6:
        return withheld('Needs at least three years with six common approved, coverage-screened calendar months. Partial or sparse months remain visible.')
    medians = {(m['year'],m['month']):m['median'] for m in eligible}
    def slopes(ys,month):
        return [(medians[b,month]-medians[a,month])/(b-a) for i,a in enumerate(ys) for b in ys[i+1:]]
    all_slopes = [v for m in common for v in slopes(years,m)]
    if not all(math.isfinite(v) for v in all_slopes):
        return withheld('Nonfinite intermediate slope; numerical result withheld.')
    base['byMonth'] = [dict(month=m,slope=median(slopes(years,m)),pairCount=len(slopes(years,m))) for m in common]
    base['leaveYearOut'] = [dict(omittedYear=y,slope=median([v for m in common for v in slopes([z for z in years if z!=y],m)])) for y in years]
    sensitivity = [v['slope'] for v in base['leaveYearOut']]
    slope = median(all_slopes)
    base.update(status='descriptive',reason='Computational support gates passed; scientific accuracy and prospective usefulness remain unvalidated.',
        slope=slope,pairCount=len(all_slopes),sensitivityRange=dict(minimum=min(sensitivity),maximum=max(sensitivity)),
        signStable=all((v>0)-(v<0)==(slope>0)-(slope<0) for v in sensitivity))
    return base


def trend_metric(series, trend):
    from .providers import metric
    return metric('gauge-seasonal-sen-slope','Season-matched descriptive discharge slope',trend['slope'],trend['unit'],series['evidenceIds'],
        'Median of same-month interyear monthly-median slopes. One approved station series; no significance, confidence interval or extrapolation. '+trend['methodVersion'],
        f'{len(trend["years"])} recorded years; {len(trend["commonMonths"])} common calendar months; {trend["pairCount"]} correlated month/year pairs')


def trend_finding(series, trend):
    from .providers import finding
    result=finding(f'Same-month comparisons across {len(trend["years"])} recorded years give a descriptive discharge slope of {trend["slope"]:.6g} {trend["unit"]}. '
        f'Omitting each year in turn gives {trend["sensitivityRange"]["minimum"]:.6g} to {trend["sensitivityRange"]["maximum"]:.6g} {trend["unit"]} on the same common months. '
        'This range measures sensitivity to those years; it is not a confidence interval, cause or forecast.',series['evidenceIds'],section='meaning',
        applicability=['One recorded USGS station, daily-mean time-series and original units only.'],uncertainty=trend['notes'])
    result.update(methodVersion=trend['methodVersion'],assumptions=['Approved finite nonnegative daily values only.','Complete months with >=80% approved days; >=3 eligible years and >=6 common months.'])
    return result
