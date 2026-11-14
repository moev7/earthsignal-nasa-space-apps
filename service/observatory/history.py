"""Reproducible descriptive histories; never fill gaps or infer a cause."""
import hashlib
import json
from datetime import date, timedelta
import numpy as np
from .methods import seasonal_baseline

VERSION = 'history-descriptive-v1'


def analyze_series(series):
    points=series['points']
    if len(points)>2000: raise ValueError('History exceeds bounded support')
    dates=[date.fromisoformat(p['date']) for p in points]
    if dates!=sorted(set(dates)): raise ValueError('History dates must be unique and ordered')
    for p in points:
        if p['value'] is not None and (isinstance(p['value'],bool) or not isinstance(p['value'],(int,float)) or not np.isfinite(p['value'])):
            raise ValueError('History has invalid observations')
    observed=[p for p in points if p['value'] is not None]
    values=np.asarray([p['value'] for p in observed],dtype=float)
    calendar_days=(dates[-1]-dates[0]).days+1 if dates else 0
    gaps=[(date.fromisoformat(b['date'])-date.fromisoformat(a['date'])).days-1 for a,b in zip(observed,observed[1:])]
    spread=dict(median=float(np.median(values)) if len(values) else None,
                p05=float(np.percentile(values,5)) if len(values) else None,
                p95=float(np.percentile(values,95)) if len(values) else None)
    histogram=[]
    if len(values):
        count,edges=np.histogram(values,bins=12)
        histogram=[dict(lower=float(edges[i]),upper=float(edges[i+1]),count=int(n)) for i,n in enumerate(count)]
    # Calculate at recorded dates only. A missing target stays missing; no
    # interpolation. Thin the derived display to <=128 actual timestamp slots.
    indices=sorted(set(np.linspace(0,max(len(points)-1,0),min(len(points),128),dtype=int).tolist())) if points else []
    rolling=[]
    for i in indices:
        start=dates[i]-timedelta(days=27)
        window=[p['value'] for d,p in zip(dates[:i+1],points[:i+1]) if d>=start and p['value'] is not None]
        rolling.append(dict(date=points[i]['date'],value=float(np.median(window)) if points[i]['value'] is not None and len(window)>=3 else None))
    baseline=seasonal_baseline(points,observed[-1]['date']) if observed else dict(supported=False,sampleCount=0,distinctYearCount=0,median=None,mad=None,dates=[],reason='No finite observation to compare.')
    percentile=None
    if baseline['supported']:
        baseline_values=np.array([p['value'] for p in points if p['date'] in set(baseline['dates'])],dtype=float)
        last=observed[-1]['value']
        percentile=float(100*(np.count_nonzero(baseline_values<last)+.5*np.count_nonzero(baseline_values==last))/len(baseline_values))
    return dict(methodVersion=VERSION,inputHash=hashlib.sha256(json.dumps(series,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest(),
        observedCount=len(observed),calendarDays=calendar_days,missingDays=calendar_days-len(observed),
        maxGapDays=max(gaps,default=0),firstDate=observed[0]['date'] if observed else None,lastDate=observed[-1]['date'] if observed else None,
        latest=observed[-1]['value'] if observed else None,endpointDifference=observed[-1]['value']-observed[0]['value'] if len(observed)>1 else None,
        spread=spread,histogram=histogram,rolling=rolling,rollingWindowDays=28,
        seasonal=dict(supported=baseline['supported'],sampleCount=baseline['sampleCount'],distinctYearCount=baseline['distinctYearCount'],
            median=baseline['median'],mad=baseline['mad'],percentile=percentile,reason=baseline['reason']),
        notes=['Statistics describe recorded finite observations only; p05/p95 are sample spread, not confidence bounds.',
               'Endpoint difference is last minus first recorded summary, not a fitted trend or a common-pixel change.',
               '28-day rolling median requires at least three recorded values; missing target dates stay missing. Display is thinned to at most 128 timestamp slots.',
               'Seasonal comparison uses earlier years within ±30 calendar days, at least 12 distinct days and two earlier years; no causal or forecast meaning.',
               'A missing day can mean no acquisition, masking, source gaps or bounded selection; counts do not establish complete sampling.'])


def gauge_evaluation(series,evidence,now=None,*,method_version=None):
    """Only the exact same USGS series is eligible; archives never upgraded."""
    from .forecasts import evaluate_gauge, VERSION as current_version
    if method_version=='gauge-selection-calibration-holdout-v2':
        from .forecast_v2 import evaluate_gauge
    elif method_version=='gauge-selection-calibration-holdout-v3':
        from .forecast_v3 import evaluate_gauge
    elif method_version not in (None,current_version):
        raise ValueError('Unsupported archived forecast method')
    if series['id']!='usgs-discharge' or len(series['evidenceIds'])!=1:return None
    source=next((e for e in evidence if e['id']==series['evidenceIds'][0] and e['sourceId']=='usgs-daily'),None)
    if source is None:return None
    result=evaluate_gauge(series['points'],series['label'],series['unit'],now=now)
    fields=('methodVersion','trainingStart','trainingEnd','testStart','testEnd','origins','mae','intervalCoverage','intervalWidth','applicability','limitations','model','horizonDays','baselinePerformance','improvementFraction','calibrationOrigins','intervalDiagnostics')
    if result['methodVersion']=='gauge-selection-calibration-holdout-v2':fields=fields[:-1]
    validations=[{k:v[k] for k in fields} for v in result['validation']]
    fold_keys=('selectionStart','selectionEnd','calibrationStart','calibrationEnd','testStart')
    return dict(seriesId=series['id'],methodVersion=result['methodVersion'],status='experimental',forecasts=result['forecasts'],
                withheld=result['withheld'],validation=validations,
                selectionHash=result.get('selectionHash'),sourceInputHash=result.get('sourceInputHash'),
                folds={k:result['frozenSelection'][k] for k in fold_keys} if result.get('frozenSelection') else None,
                notes=['Single-station retrospective experiment with frozen model selection and independent residual calibration.',
                       'Eligibility uses the final holdout; this is not prospective validation or operational flood guidance.',
                       'All evaluated horizons, including failures, remain visible. Missing daily values are not interpolated.'])
