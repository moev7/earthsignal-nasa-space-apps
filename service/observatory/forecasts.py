"""Bounded single-station experiment with chronological, disjoint folds.

Selection chooses a model family, calibration fixes its empirical residual band,
and the final year evaluates all horizons. Eligibility based on this holdout is
still retrospective product policy, not prospective validation.
"""
import hashlib
import json
from datetime import date, datetime, timedelta, timezone
import numpy as np

VERSION='gauge-selection-calibration-holdout-v3'
MODELS=('persistence','seasonal-naive','local-trend','damped-trend')
HORIZONS=(1,3,7)


def predict(values,origin,horizon,model):
    if model=='persistence':return float(values[origin])
    if model=='seasonal-naive':return float(values[origin+horizon-365])
    segment=values[origin-27:origin+1];x=np.arange(28,dtype=float)
    slope=float(np.dot(x-x.mean(),segment-segment.mean())/np.dot(x-x.mean(),x-x.mean()))
    intercept=float(segment.mean()-slope*x.mean())
    advance=horizon if model=='local-trend' else sum(.9**i for i in range(1,horizon+1))
    return intercept+slope*(27+advance)


def interval_diagnostics(actual,prediction,radius):
    """90% Winkler score and descriptive miss runs; no iid coverage claim."""
    actual=np.asarray(actual,dtype=float);prediction=np.asarray(prediction,dtype=float)
    if not actual.size or actual.shape!=prediction.shape or actual.ndim!=1 or not np.all(np.isfinite(actual)) or not np.all(np.isfinite(prediction)) or not np.isfinite(radius) or radius<0:
        raise ValueError('Invalid interval evaluation')
    error=actual-prediction
    score=2*radius+20*np.maximum(np.abs(error)-radius,0)
    if not np.all(np.isfinite(score)):raise FloatingPointError('Nonfinite interval score')
    # Scores are nonnegative: scale the reduction so finite large scores do
    # not overflow merely because NumPy sums them before dividing by n.
    scale=float(np.max(score));mean_score=0. if scale==0 else float(np.mean(score/scale))*scale
    if not np.isfinite(mean_score):raise FloatingPointError('Nonfinite mean interval score')
    # Match the existing boundary tolerance used by retrospective coverage.
    below=error < -radius-1e-10;above=error > radius+1e-10;miss=below|above
    longest=run=0
    for flag in miss:
        run=run+1 if flag else 0;longest=max(longest,run)
    return dict(methodVersion='forecast-interval-diagnostics-v1',nominalCoverage=.9,boundaryTolerance=1e-10,
        intervalScore=mean_score,belowCount=int(below.sum()),withinCount=int((~miss).sum()),aboveCount=int(above.sum()),
        longestMissRun=longest,negativePredictionCount=int((prediction<0).sum()))


def calibration_radius(residuals):
    # Finite order-statistic correction. Dependence prevents an exchangeable-data
    # coverage guarantee; this remains an empirical chronological experiment.
    rank=int(np.ceil((len(residuals)+1)*.9))
    if rank>len(residuals):raise ValueError('Insufficient calibration origins')
    return float(np.sort(residuals)[rank-1])


def evaluate_gauge(points,target,unit,now=None,stale_days=2):
    try:
        with np.errstate(over='raise',invalid='raise',divide='raise'):
            return _evaluate_gauge(points,target,unit,now,stale_days)
    except (FloatingPointError,OverflowError):
        return {'methodVersion':VERSION,'forecasts':[],'withheld':['Numerical range exceeds supported forecast calculations; no nonfinite result is published.'],'validation':[]}


def _evaluate_gauge(points,target,unit,now=None,stale_days=2):
    now=now or datetime.now(timezone.utc)
    withheld=lambda message:{'methodVersion':VERSION,'forecasts':[],'withheld':[message],'validation':[]}
    if now.tzinfo is None: return withheld('Issue time must include a timezone.')
    now=now.astimezone(timezone.utc)
    if not isinstance(points,list) or not 1460<=len(points)<=2000:
        return withheld('1460–2000 consecutive daily values are required: two-year warmup, disjoint selection/calibration and a final unseen seasonal cycle.')
    try:
        dates=[date.fromisoformat(p['date']) for p in points]
        if not all(isinstance(p['value'],(int,float)) and not isinstance(p['value'],bool) for p in points):raise ValueError()
        values=np.array([p['value'] for p in points],dtype=float)
        if not np.all(np.isfinite(values)) or np.any(values<0):raise ValueError()
        if any(b-a!=timedelta(days=1) for a,b in zip(dates,dates[1:])):raise ValueError()
        if dates[-1]>now.date():return withheld('Observations are later than the issue date; forecasts and retrospective evaluation withheld.')
    except (ValueError,TypeError,KeyError):
        return withheld('Daily history is missing, discontinuous, duplicated, unordered or invalid; no interpolation is substituted.')
    n=len(values);test_start=n-365;selection_start=test_start-365;calibration_start=selection_start+182
    # Five-day pretest origins give >=30 in each half-year; seven-day final
    # origins reduce overlapping evaluation targets. Independence is not claimed.
    selection_origins=list(range(selection_start,calibration_start-7,5))
    calibration_origins=list(range(calibration_start,test_start-7,5))
    test_origins=list(range(test_start,n-7,7))
    if min(len(selection_origins),len(calibration_origins),len(test_origins))<30:
        return withheld('At least 30 evaluable origins are required in each disjoint fold.')
    frozen={};radii={}
    for h in HORIZONS:
        errors={m:np.array([predict(values,o,h,m)-values[o+h] for o in selection_origins]) for m in MODELS}
        frozen[h]=min(MODELS,key=lambda m:float(np.mean(np.abs(errors[m]))))
        residuals=np.array([abs(predict(values,o,h,frozen[h])-values[o+h]) for o in calibration_origins])
        radii[h]=calibration_radius(residuals)
    selection_record={'methodVersion':VERSION,'models':{str(h):m for h,m in frozen.items()},
        'trainingStart':dates[0].isoformat(),'trainingEnd':dates[selection_start-1].isoformat(),
        'selectionStart':dates[selection_start].isoformat(),'selectionEnd':dates[calibration_start-1].isoformat(),
        'calibrationStart':dates[calibration_start].isoformat(),'calibrationEnd':dates[test_start-1].isoformat(),
        'testStart':dates[test_start].isoformat(),'trainingMinimumDays':730,'selectionOrigins':len(selection_origins),
        'calibrationOrigins':len(calibration_origins),'trendWindowDays':28,'damping':.9,'intervalNominalCoverage':.9,
        'radii':{str(h):r for h,r in radii.items()}}
    selection_hash=hashlib.sha256(json.dumps(selection_record,sort_keys=True).encode()).hexdigest()
    results=[];validations=[];messages=[]
    stale=(now.date()-dates[-1]).days>stale_days
    for h in HORIZONS:
        model=frozen[h];actual=np.array([values[o+h] for o in test_origins])
        prediction=np.array([predict(values,o,h,model) for o in test_origins]);mae=float(np.mean(np.abs(actual-prediction)))
        baselines=[{'model':m,'mae':float(np.mean([abs(predict(values,o,h,m)-values[o+h]) for o in test_origins]))} for m in ('persistence','seasonal-naive')]
        strongest=min(baselines,key=lambda b:b['mae']);q=radii[h]
        residuals=np.abs(actual-prediction);coverage=float(np.mean(residuals<=q+1e-10))
        diagnostics=interval_diagnostics(actual,prediction,q)
        diagnostics['calibrationOrigins']=len(calibration_origins)
        diagnostics['calibrationRank']=int(np.ceil((len(calibration_origins)+1)*.9))
        diagnostics['baselineScores']=[]
        for baseline in ('persistence','seasonal-naive'):
            baseline_q=calibration_radius(np.array([abs(predict(values,o,h,baseline)-values[o+h]) for o in calibration_origins]))
            baseline_prediction=np.array([predict(values,o,h,baseline) for o in test_origins])
            diagnostic=interval_diagnostics(actual,baseline_prediction,baseline_q)
            diagnostics['baselineScores'].append(dict(model=baseline,intervalScore=diagnostic['intervalScore'],
                intervalCoverage=diagnostic['withinCount']/len(test_origins),intervalWidth=2*baseline_q))
        improvement=(strongest['mae']-mae)/strongest['mae'] if strongest['mae']>0 else 0.
        limitations=['One historical station and final seasonal cycle do not establish future reliability.',
            'Model family selected before independent residual calibration; final year never chooses the model or interval radius.',
            'Release gates use this final holdout; all attempts are reported, but prospective release-policy evaluation remains unperformed.',
            'Nominal 90% empirical bands require >=80% evaluated coverage; this tolerance is a product gate, not a statistical guarantee.',
            'Selection/calibration origins are five days apart; temporal dependence and nonstationarity remain.',
            'Interval score penalizes width and misses on the same test targets; lower is better for this quantity/horizon. Miss runs count consecutive evaluated targets, not calendar days.',
            'Calibration uses rank ceil((n+1)*0.9) from a separate period. Temporal dependence prevents an exchangeability-based coverage guarantee.',
            'No causal water-volume, inundation or regional forecast is inferred.']
        validation={'methodVersion':VERSION,'trainingStart':dates[0].isoformat(),'trainingEnd':dates[selection_start-1].isoformat(),
            'testStart':dates[test_start].isoformat(),'testEnd':dates[-1].isoformat(),'origins':len(test_origins),'mae':mae,
            'intervalCoverage':coverage,'intervalWidth':2*q,'applicability':[f'{target}; {unit}; daily support; {h}-day horizon only.'],
            'limitations':limitations,'selectionHash':selection_hash,'model':model,'horizonDays':h,'baselinePerformance':baselines,
            'improvementFraction':improvement,'calibrationOrigins':len(calibration_origins),'intervalDiagnostics':diagnostics}
        validations.append(validation)
        reasons=[]
        if strongest['mae']<=0 or improvement<.1-1e-12:reasons.append('did not improve MAE by 10% over the strongest simple baseline')
        if coverage<.8:reasons.append('empirical interval coverage is below the 80% product gate')
        if q<=1e-10 and np.any(residuals>1e-10):reasons.append('zero-width band does not cover nonzero evaluation errors')
        if diagnostics['negativePredictionCount']:reasons.append('candidate produced negative discharge during the final evaluation')
        if stale:reasons.append('latest daily observation is stale for a current issue')
        valid_through=datetime.combine(dates[-1]+timedelta(days=h),datetime.min.time(),timezone.utc)
        if valid_through<=now:reasons.append('observation-based target date is already expired at issue time')
        point=predict(values,n-1,h,model)
        if not np.isfinite(point) or point<0:reasons.append('candidate predicts invalid negative discharge')
        if reasons:
            messages.append(f'{h}-day forecast withheld: '+ '; '.join(reasons)+'.')
            continue
        fields=('methodVersion','trainingStart','trainingEnd','testStart','testEnd','origins','mae','intervalCoverage','intervalWidth','applicability','limitations')
        results.append({'schemaVersion':'1.0','target':target,'issueTime':now.isoformat(),'horizonDays':h,'model':model,'modelVersion':VERSION,
            'distribution':{'point':point,'lower':point-q,'upper':point+q,'unit':unit},'baselines':baselines,
            'validation':{k:validation[k] for k in fields},'validThrough':valid_through.isoformat()})
    return {'methodVersion':VERSION,'forecasts':results,'withheld':messages,'validation':validations,'frozenSelection':selection_record,
        'selectionHash':selection_hash,'sourceInputHash':hashlib.sha256(json.dumps(points,sort_keys=True,allow_nan=False).encode()).hexdigest()}
