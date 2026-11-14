"""Small deterministic numerical methods with explicit valid populations."""
import hashlib
import math
import numpy as np
METHOD_VERSION = 'observatory-metrics-v2'

def array_hash(values):
    a = np.ascontiguousarray(values)
    return hashlib.sha256(str(a.shape).encode()+a.dtype.str.encode()+a.tobytes()).hexdigest()

def nd_index(a, b, valid):
    a,b=np.asarray(a,dtype=np.float64),np.asarray(b,dtype=np.float64)
    good=np.asarray(valid,dtype=bool)&np.isfinite(a)&np.isfinite(b)&(a+b>0)
    values=np.full(a.shape,np.nan)
    np.divide(a-b,a+b,out=values,where=good)
    good &= np.isfinite(values) & (values >= -1) & (values <= 1)
    values[~good]=np.nan
    return values,good

def sentinel_valid(scl):
    return np.isin(scl,[4,5,6])  # Conservative clear vegetation/bare land/water only.

def hls_valid(fmask):
    # HLS v2: bits 1..4 cloud/adjacent-cloud/shadow/snow; bit 0 reserved.
    # Also exclude reserved cirrus, fill 255 and high aerosol (bits 6..7 == 3).
    mask=np.asarray(fmask,dtype=np.uint8)
    return ((mask&31)==0)&((mask>>6)!=3)&(mask!=255)

def landsat_valid(qa):
    # QA_PIXEL: fill, dilated cloud, cirrus, cloud, cloud shadow and snow bits 0..5.
    return (np.asarray(qa,dtype=np.uint16)&63)==0

def dswx_valid(classes):
    return np.isin(classes,[0,1,2])  # Not-water, water, partial-water only.

def landsat_kelvin(dn):
    return np.asarray(dn,dtype=np.float64)*0.00341802+149.0

def summary(values, valid, total):
    selected=np.asarray(values)[np.asarray(valid,dtype=bool)]
    selected=selected[np.isfinite(selected)]; n=int(selected.size)
    return {'count':n,'total':int(total),'coveragePercent':100*n/total if total else 0.,
            'median':float(np.median(selected)) if n else None,
            'p05':float(np.percentile(selected,5)) if n else None,
            'p95':float(np.percentile(selected,95)) if n else None,
            'scope':'finite valid subset only; whole-area interpretation withheld',
            'spreadInterpretation':'p05/p95 describe the distribution of valid values, not a confidence interval'}

def common_difference(before, after, before_valid, after_valid, area_mask):
    if before.shape != after.shape or before.shape != area_mask.shape: raise ValueError('Incompatible array grids')
    common=np.asarray(before_valid,dtype=bool)&np.asarray(after_valid,dtype=bool)&np.asarray(area_mask,dtype=bool)&np.isfinite(before)&np.isfinite(after)
    if not np.any(common): raise ValueError('Empty common valid intersection')
    total=int(np.count_nonzero(area_mask))
    result=summary(np.asarray(after,dtype=float)-np.asarray(before,dtype=float),common,total)
    result.update(beforeValidPixels=int(np.count_nonzero(before_valid&area_mask)),afterValidPixels=int(np.count_nonzero(after_valid&area_mask)),commonValidPixels=int(np.count_nonzero(common)),maskHash=array_hash(common.astype(np.uint8)))
    return result

def seasonal_baseline(points, target_date, radius_days=30, min_samples=12, min_years=2):
    from datetime import date
    target=date.fromisoformat(target_date); chosen={}
    # Fixed leap-year calendar keeps month/day alignment across leap years.
    ordinal=lambda d: date(2000,d.month,d.day).timetuple().tm_yday
    for p in points:
        d=date.fromisoformat(p['date']); value=p.get('value')
        distance=abs(ordinal(d)-ordinal(target)); distance=min(distance,366-distance)
        if d.year < target.year and distance<=radius_days and isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value):
            # Conflicting repeats are excluded, never counted as independent days.
            if p['date'] in chosen and chosen[p['date']]!=value: chosen[p['date']]=None
            elif p['date'] not in chosen: chosen[p['date']]=value
    chosen={d:v for d,v in sorted(chosen.items()) if v is not None}
    values=np.array(list(chosen.values()),dtype=float);years={d[:4] for d in chosen}
    supported=len(chosen)>=min_samples and len(years)>=min_years
    return {'sampleCount':len(chosen),'distinctYearCount':len(years),'dates':list(chosen),'median':float(np.median(values)) if supported else None,'mad':float(np.median(np.abs(values-np.median(values)))) if supported else None,'supported':supported,'reason':f'Requires {min_samples} distinct dated samples across {min_years} earlier years in a ±{radius_days}-day calendar window.','limitations':['Earlier calendar years only; month/day aligned on a fixed leap-year calendar.','This is a descriptive sample baseline; years and readings are not proven independent or representative.','Different acquisition conditions and changing measurement populations can confound comparison.']}

def persistent_departure(points, baseline, min_observations=3, max_gap_days=32):
    from datetime import date
    if not baseline.get('supported') or baseline.get('mad') is None:return {'supported':False,'persistent':None,'reason':'Insufficient seasonal baseline'}
    selected=points[-min_observations:];values=[p.get('value') for p in selected]
    if len(values)<min_observations or any(not isinstance(v,(int,float)) or isinstance(v,bool) or not math.isfinite(v) for v in values):return {'supported':False,'persistent':None,'reason':'Missing consecutive observations'}
    try:
        dates=[date.fromisoformat(p['date']) for p in selected]
        if any(not 0<(b-a).days<=max_gap_days for a,b in zip(dates,dates[1:])):raise ValueError()
    except (ValueError,TypeError,KeyError):return {'supported':False,'persistent':None,'reason':'Dated consecutive observations must be ordered and no more than '+str(max_gap_days)+' days apart.'}
    threshold=max(3*1.4826*baseline['mad'],1e-9); departures=np.array(values)-baseline['median']
    persistent=bool(np.all(departures>threshold) or np.all(departures < -threshold))
    return {'supported':True,'persistent':persistent,'observations':min_observations,'maxGapDays':max_gap_days,'threshold':threshold,'methodVersion':'persistence-dated-robust-v2','limitations':['A descriptive monitoring rule, not a regime-shift forecast or cause diagnosis.','Gap and 3-MAD thresholds are product rules, not validated detection accuracy.','Three acquisitions need not be independent ecological observations.']}
