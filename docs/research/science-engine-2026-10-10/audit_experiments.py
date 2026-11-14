"""Synthetic code-audit fixtures; never scientific field validation.
Run from repository root: service/.venv/bin/python docs/research/science-engine-2026-10-10/audit_experiments.py
"""
import json,sys,math
from pathlib import Path
from datetime import date,datetime,timedelta,timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[3]))
from service.observatory.forecasts import evaluate_gauge
from service.observatory.methods import seasonal_baseline,persistent_departure,summary
import numpy as np
start=date(2022,10,10);count=1460
points=[{'date':(start+timedelta(days=i)).isoformat(),'value':float(2*i)} for i in range(count)]
last=date.fromisoformat(points[-1]['date']);issue=datetime.combine(last+timedelta(days=2),datetime.min.time(),timezone.utc)+timedelta(hours=12)
stale=evaluate_gauge(points,'synthetic-linear','arbitrary-unit',now=issue)
shifted=[dict(p,value=p['value']+(math.sin(i)*1.5 if i>=count-365 else 0)) for i,p in enumerate(points)]
shift=evaluate_gauge(shifted,'synthetic-variance-shift','arbitrary-unit',now=datetime.combine(last,datetime.min.time(),timezone.utc))
oneyear=[{'date':(date(2025,6,1)+timedelta(days=i)).isoformat(),'value':float(i)} for i in range(12)]
base=seasonal_baseline(oneyear,'2026-06-10')
nonconsecutive=persistent_departure([{'date':'2001-01-01','value':20.},{'date':'2011-01-01','value':20.},{'date':'2026-01-01','value':20.}],{'supported':True,'median':0.,'mad':1.})
mask=np.array([True]*80+[False]*20);a=np.array([0.]*80+[100.]*20)
coverage=summary(a,mask,100)
out={'purpose':'Synthetic counterexamples for code gates, not measured real-world performance or validated prediction. No production code changed.','numpyVersion':np.__version__,'forecastExpiry':{'lastObservation':last.isoformat(),'issueTime':issue.isoformat(),'emitted':[{'horizon':f['horizonDays'],'validThrough':f['validThrough'],'expiredAtIssue':datetime.fromisoformat(f['validThrough'])<issue} for f in stale['forecasts']]},'ungatedCoverage':{'construction':'2*i training/selection; final365days add1.5*sin(i). Calibration nearlyzero but final error nonzero. Frozen trend can beat persistence while intervals under-cover.','emitted':[{'horizon':f['horizonDays'],'coverage':f['validation']['intervalCoverage'],'width':f['validation']['intervalWidth']} for f in shift['forecasts']],'validation':[{k:v[k] for k in ['horizonDays','intervalCoverage','improvementFraction','model']} for v in shift['validation']]},'seasonalSingleYear':{'sampleCount':base['sampleCount'],'distinctYears':1,'supported':base['supported']},'nonconsecutiveDates':nonconsecutive,'coverageBias':{'selectedMean':float(a[mask].mean()),'fullMean':float(a.mean()),'selectedP95':float(np.percentile(a[mask],95)),'fullP95':float(np.percentile(a,95)),'summary':coverage}}
assert any(f['expiredAtIssue'] for f in out['forecastExpiry']['emitted'])
assert any(f['coverage']<.9 for f in out['ungatedCoverage']['emitted'])
assert base['supported'] and nonconsecutive['persistent']
Path(__file__).with_name('audit-experiments.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))
