"""Descriptive seasonal sampling sensitivity; neither estimator is ground truth."""
import hashlib
import json
import math
from datetime import date
from statistics import mean

VERSION='seasonal-sampling-sensitivity-v1'


def _median(values):
    values=sorted(values);n=len(values)
    return values[n//2] if n%2 else mean(values[n//2-1:n//2+1])


def _percentile(values, target):
    return 100*(sum(v<target for v in values)+.5*sum(v==target for v in values))/len(values)


def seasonal_sampling(series):
    """Compare pooled readings with one median per earlier calendar year.

    Keep the existing ±30-day/12-reading/two-year descriptive gate. Balancing
    changes the estimand; sparse years do not become well observed by weighting.
    """
    points=series['points']
    if not isinstance(points,list) or len(points)>2000:raise ValueError('Bounded dated history required')
    dates=[date.fromisoformat(p['date']) for p in points]
    if dates!=sorted(set(dates)):raise ValueError('Unique ordered dates required')
    for p in points:
        value=p['value']
        if value is not None and (isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value)):
            raise ValueError('Finite observations or explicit missing values required')
    raw={k:series[k] for k in ('id','label','unit','evidenceIds','points')}
    digest=hashlib.sha256(json.dumps(raw,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
    observed=[(d,p) for d,p in zip(dates,points) if p['value'] is not None]
    target_date,target=observed[-1] if observed else (None,None)
    ordinal=lambda d:date(2000,d.month,d.day).timetuple().tm_yday
    years={}
    if target_date:
        for d,p in observed:
            distance=abs(ordinal(d)-ordinal(target_date));distance=min(distance,366-distance)
            if d.year<target_date.year and distance<=30:years.setdefault(d.year,[]).append(p)
    pooled=[p['value'] for year in sorted(years) for p in years[year]]
    yearly=[dict(year=year,count=len(readings),dates=[p['date'] for p in readings],median=_median([p['value'] for p in readings]))
            for year,readings in sorted(years.items())]
    supported=len(pooled)>=12 and len(yearly)>=2
    medians=[y['median'] for y in yearly]
    pm=_median(pooled) if supported else None
    ym=_median(medians) if supported else None
    pp=_percentile(pooled,target['value']) if supported else None
    yp=_percentile(medians,target['value']) if supported else None
    sign=lambda v: (v>0)-(v<0)
    # Comparisons rather than subtraction avoid overflow for finite extremes.
    direction=lambda median: sign((target['value']>median)-(target['value']<median))
    return dict(methodVersion=VERSION,inputHash=digest,targetDate=target_date.isoformat() if target_date else None,
        targetValue=target['value'] if target else None,supported=supported,sampleCount=len(pooled),yearCount=len(yearly),
        windowDays=30,byYear=yearly,maxYearSharePercent=100*max((y['count'] for y in yearly),default=0)/len(pooled) if pooled else None,
        pooled=dict(median=pm,percentile=pp,estimand='Every recorded earlier-season reading has equal weight.'),
        yearBalanced=dict(median=ym,percentile=yp,estimand='Each earlier year contributes one median; years have equal weight.'),
        percentileDifferencePoints=yp-pp if supported else None,
        directionChanges=direction(pm)!=direction(ym) if supported else None,
        sparseYears=[y['year'] for y in yearly if y['count']<3],
        notes=['Descriptive sensitivity only; no p-value, detection probability, causal trend or forecast.',
            'Earlier calendar years within ±30 month/day-aligned days; same series, units and recorded support. Missing values stay missing.',
            'Balancing years changes the question, not the accuracy. One poorly sampled year still contributes one median.',
            'Years with fewer than three readings are highlighted for inspection; three is a display flag, not a validated scientific adequacy threshold.',
            'Neither readings nor years are established independent or representative. Changing masks and acquisition conditions can confound either summary.'])
