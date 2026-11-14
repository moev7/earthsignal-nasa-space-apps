#!/usr/bin/env python3
"""Reconcile an exported station trend without importing Earthsignal methods.

This checks recorded-input arithmetic and support, not source accuracy, causal
attribution or prospective decision usefulness. Offline and standard-library only.
"""
import argparse
import calendar
import hashlib
import itertools
import json
import math
from datetime import date, timedelta
from pathlib import Path
import statistics


def midpoint(values):
    if len(values)%2:return statistics.median(values)
    return math.fsum([statistics.median_low(values)/2,statistics.median_high(values)/2])


def reconcile(series):
    t=series['seasonalTrend'];points=series['points']
    assert t['methodVersion']=='station-seasonal-sen-v1'
    assert t['unit']=='ft^3/s/year'
    assert series['id']=='usgs-discharge' and series['unit']=='ft^3/s' and len(series['evidenceIds'])==1
    raw={k:v for k,v in series.items() if k not in ('analysis','seasonalTrend')}
    digest=hashlib.sha256(json.dumps(raw,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
    assert t['inputHash']==digest,'Input hash differs'
    assert 0<len(points)<=2000
    dates=[date.fromisoformat(p['date']) for p in points]
    assert all(b==a+timedelta(days=1) for a,b in itertools.pairwise(dates))
    def approved(p):
        v=p['value']
        return isinstance(v,(float,int)) and not isinstance(v,bool) and math.isfinite(v) and v>=0 and p['quality'].strip().casefold() in ('a','approved')
    grouped={}
    for d,p in zip(dates,points):grouped.setdefault((d.year,d.month),[]).append(p)
    monthly=[]
    for (year,month),rows in sorted(grouped.items()):
        days=calendar.monthrange(year,month)[1];valid=[p['value'] for p in rows if approved(p)]
        runs=[sum(1 for _ in group) for is_good,group in itertools.groupby(rows,key=approved) if not is_good]
        complete=dates[0]<=date(year,month,1) and dates[-1]>=date(year,month,days)
        qualifies=complete and len(valid)*5>=days*4
        monthly.append(dict(year=year,month=month,calendarDays=days,recordedDays=len(rows),approvedDays=len(valid),
            excludedDays=len(rows)-len(valid),longestExcludedRun=max(runs,default=0),complete=complete,eligible=qualifies,median=midpoint(valid) if qualifies else None))
    assert monthly==t['months'],'Monthly support or medians differ'
    eligible=[m for m in monthly if m['eligible']]
    years=sorted(y for y in {m['year'] for m in eligible} if sum(m['year']==y for m in eligible)>=6)
    common=sorted(m for m in range(1,13) if years and all(any(r['year']==y and r['month']==m for r in eligible) for y in years))
    assert years==t['years'] and common==t['commonMonths'],'Seasonal population differs'
    if len(years)<3 or len(common)<6:
        assert t['status']=='withheld' and t['slope'] is None and t['pairCount']==0
        return dict(status='withheld',years=years,commonMonths=common,inputHash=digest)
    values={(m['year'],m['month']):m['median'] for m in eligible}
    def slopes(ys,months):return [(values[b,m]-values[a,m])/(b-a) for m in months for a,b in itertools.combinations(ys,2)]
    slopes_all=slopes(years,common);slope=midpoint(slopes_all)
    leave=[dict(omittedYear=y,slope=midpoint(slopes([z for z in years if z!=y],common))) for y in years]
    assert t['status']=='descriptive' and t['slope']==slope and t['pairCount']==len(slopes_all),'Overall slope differs'
    assert t['byMonth']==[dict(month=m,slope=midpoint(slopes(years,[m])),pairCount=len(years)*(len(years)-1)//2) for m in common]
    assert t['leaveYearOut']==leave,'Fixed-season sensitivity differs'
    assert t['sensitivityRange']==dict(minimum=min(r['slope'] for r in leave),maximum=max(r['slope'] for r in leave))
    sign=lambda x:(x>0)-(x<0)
    assert t['signStable']==all(sign(r['slope'])==sign(slope) for r in leave)
    return dict(status='descriptive',slope=slope,unit=t['unit'],years=years,commonMonths=common,pairs=len(slopes_all),inputHash=digest)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('manifest',type=Path);args=parser.parse_args()
    manifest=json.loads(args.manifest.read_text())
    records=[reconcile(s) for s in manifest.get('series',[]) if 'seasonalTrend' in s]
    assert records,'No recorded seasonal trend exists in this manifest; archived results are not upgraded'
    print(json.dumps(dict(reconciled=records,limitations='Recorded arithmetic/support only; not independent source/field validation.'),allow_nan=False,indent=2))


if __name__=='__main__':main()
