"""Bounded what-if comparisons; assumptions never acquire probabilities."""
import csv
import json
import math
from decimal import Decimal, localcontext
from pathlib import Path
from .geometry import spherical_area_km2, unwrapped_geojson
from ..assessment_validation import validate_scenario_request

VERSION='scenario-threshold-footprint-sensitivity-v4'
ARTIFACTS=['manifest.json','brief.json','metrics.csv','area.geojson','evidence.json']

def threshold_grid(bounds):
    # Decimal input strings round-trip finite doubles. 750 digits cover the entire
    # binary64 exponent span; division by 20 terminates, including zero crossings.
    with localcontext() as context:
        context.prec=750
        minimum=Decimal(str(bounds['minimum']));maximum=Decimal(str(bounds['maximum']))
        return [float(minimum+(maximum-minimum)*i/20) for i in range(21)]

def threshold_sweep(metric, bounds, operator):
    """21 explicit thresholds applied to one recorded value, never future outcomes."""
    value=metric['value'];cases=[]
    for threshold in threshold_grid(bounds):
        margin=value-threshold
        if not math.isfinite(margin):raise ValueError('Threshold margin exceeds finite numerical support')
        cases.append(dict(threshold=threshold,meets=value>threshold if operator=='above' else value<threshold,margin=margin))
    return dict(methodVersion=VERSION,metricId=metric['id'],recordedValue=value,unit=metric['unit'],
        denominator=metric['denominator'],evidenceIds=metric['evidenceIds'],operator=operator,cases=cases,
        conditionChanges=sum(a['meets']!=b['meets'] for a,b in zip(cases,cases[1:])),
        crossing=dict(threshold=value,withinRange=bounds['minimum']<=value<=bounds['maximum'],meetsAtEquality=False),
        notes=['21 evenly spaced user-selected thresholds, including both endpoints; decimal interpolation precedes binary64 conversion. The recorded measurement is held fixed.',
               'Above and below are strict inequalities: equality meets neither condition.',
               'A tested threshold count is not a probability, forecast, safety limit or measured intervention effect.',
               'Original dates, valid-population, coverage and measurement limitations remain applicable.'])

def _claim(id,text,evidence,assumptions):
    return {'id':id,'type':'Scenario','text':text,'evidenceIds':evidence,'methodVersion':VERSION,'assumptions':assumptions,'uncertainty':['No occurrence probability or confirmed effect is assigned.'],'applicability':['The recorded selection and supplied assumptions only.'],'counterevidence':[]}

def pareto_alternatives(candidates,weights=None):
    result=[]
    known=[c for c in candidates if 'cost' in c and 'benefit' in c]
    costs=[c['cost'] for c in known];benefits=[c['benefit'] for c in known]
    for c in candidates:
        complete='cost' in c and 'benefit' in c
        pareto=None;score=None
        if complete:
            pareto=not any(other['cost']<=c['cost'] and other['benefit']>=c['benefit'] and (other['cost']<c['cost'] or other['benefit']>c['benefit']) for other in known)
            if weights:
                cost=(c['cost']-min(costs))/(max(costs)-min(costs)) if max(costs)>min(costs) else 0.
                benefit=(c['benefit']-min(benefits))/(max(benefits)-min(benefits)) if max(benefits)>min(benefits) else 0.
                score=(weights['benefit']*benefit-weights['cost']*cost)/(weights['cost']+weights['benefit'])
        result.append({'id':c['id'],'name':c['name'],'cost':c.get('cost'),'benefit':c.get('benefit'),'pareto':pareto,'score':score})
    return result

def weight_sweep(candidates):
    """Enumerate explicit alternative preferences; counts are not probabilities."""
    cases=[];wins={c['id']:0 for c in candidates if 'cost' in c and 'benefit' in c}
    for i in range(21):
        share=i/20
        alternatives=pareto_alternatives(candidates,{'cost':share,'benefit':1-share})
        known=[a for a in alternatives if a['score'] is not None]
        best=max((a['score'] for a in known),default=None)
        winners=sorted(a['id'] for a in known if abs(a['score']-best)<=1e-12) if best is not None else []
        for id in winners:wins[id]+=1
        cases.append(dict(costShare=share,winners=winners))
    return dict(methodVersion=VERSION,cases=cases,
        winnerCounts=[dict(id=id,count=count,total=21) for id,count in sorted(wins.items())],
        rankingChanges=sum(a['winners']!=b['winners'] for a,b in zip(cases,cases[1:])),
        notes=['21 deterministic cost-weight shares from 0 to 1; benefit share = 1 minus cost share.',
               'Ties retain all co-winners. Counts describe tested preferences, not likelihood or measured benefits.',
               'Min–max scales are fixed to the fully specified candidate set. Changing candidates changes this comparison.',
               'Costs and effects themselves remain supplied assumptions; this sweep changes preferences only.'])

def overlap_km2(area,candidate):
    try:from osgeo import ogr
    except ImportError:return None
    anchor=unwrapped_geojson(area)['coordinates'][0][0][0][0]
    a=ogr.CreateGeometryFromJson(json.dumps(unwrapped_geojson(area,anchor)))
    b=ogr.CreateGeometryFromJson(json.dumps(unwrapped_geojson(candidate,anchor)))
    geometry=a.Intersection(b)
    if geometry is None:raise ValueError('Geometry intersection failed')
    if geometry.IsEmpty():return 0.
    data=json.loads(geometry.ExportToJson())
    if data['type'] in ('Polygon','MultiPolygon'):
        # Rewrap longitude before the common WGS84 validator; coordinates used analytically are unchanged arcs.
        def wrap(item):
            if isinstance(item,list) and len(item)==2 and all(isinstance(v,(int,float)) for v in item):return [((item[0]+180)%360)-180,item[1]]
            return [wrap(v) for v in item]
        data['coordinates']=wrap(data['coordinates'])
        return spherical_area_km2(data)
    return 0.  # Boundary contact or points contribute no area.

def run_scenario(request,parent,config,output):
    validate_scenario_request(request)
    assumptions=list(request['assumptions']);evidence=[e['id'] for e in parent.get('evidence',[])][:64]
    metrics=[];claims=[];alternatives=[];sweep=None;threshold_cases=None
    limits=['A scenario is conditional, not a forecast or a probability.','Unknown costs or effects remain unknown. Objectives and weights reflect user choices.']
    sensitivities=['Revisit this comparison when objectives, assumptions, measured inputs or source validity change.']
    if request['kind']=='threshold':
        metric=next((m for m in parent['metrics'] if m['id']==request['inputs']['metricId']),None)
        if not metric or metric['value'] is None:raise ValueError('Measured quantity is unavailable for threshold exploration')
        value=metric['value'];threshold=request['inputs']['threshold'];operator=request['inputs']['operator'];meets=value>threshold if operator=='above' else value<threshold
        if not math.isfinite(value-threshold):raise ValueError('Threshold margin exceeds finite numerical support')
        refs=metric['evidenceIds'];assumptions.append(f'Threshold uses the recorded {metric["unit"]} quantity; {operator} is a strict inequality.')
        metrics.append({'id':'threshold-comparison','label':'Recorded quantity meets selected threshold','value':1 if meets else 0,'unit':'boolean (1=yes, 0=no)','evidenceIds':refs,'description':'A comparison of the recorded value to a user threshold; no future target is predicted.','denominator':metric['denominator']})
        metrics.append({'id':'threshold-margin','label':'Recorded value minus selected threshold','value':value-threshold,'unit':metric['unit'],'evidenceIds':refs,'description':'Signed margin of the same recorded quantity; not time to crossing or intervention benefit.','denominator':metric['denominator']})
        claims.append(_claim('threshold',f'The recorded {metric["label"].lower()} is {value} {metric["unit"]}. It {"meets" if meets else "does not meet"} the selected {operator} {threshold} {metric["unit"]} condition. This evaluates a stated threshold on the original measurement; it does not predict when a future crossing will occur.',refs,assumptions))
        limits.extend(['Area, elevation, discharge and volume are not converted into one another without compatible accounting inputs.','The original valid-population and coverage limitations still apply.'])
        sensitivities.append(f'The comparison switches at {value} {metric["unit"]}; equality does not satisfy a strict above/below condition.')
        if 'thresholdRange' in request['inputs']:
            threshold_cases=threshold_sweep(metric,request['inputs']['thresholdRange'],operator)
            for i,case in enumerate(threshold_cases['cases']):
                for suffix,quantity,unit in [('condition',int(case['meets']),'boolean (1=yes, 0=no)'),('margin',case['margin'],metric['unit'])]:
                    metrics.append(dict(id=f'threshold-sweep-{i}-{suffix}',label=f'Threshold {case["threshold"]:.17g} {metric["unit"]} · {suffix}',value=quantity,unit=unit,evidenceIds=refs,
                        description=f'Fixed recorded value, strict {operator} condition at threshold {case["threshold"]:.17g}; tested assumption, not a future outcome.',denominator=metric['denominator']))
            claims.append(_claim('threshold-sensitivity',f'The original measurement is held fixed while 21 explicitly selected thresholds are tested. The exact condition boundary is {value} {metric["unit"]}; equality satisfies neither above nor below. The tested settings describe sensitivity to a chosen threshold, not the likelihood of future conditions.',refs,assumptions))
    else:
        candidates=request['inputs']['footprints'];weights=request['inputs'].get('weights')
        alternatives=pareto_alternatives(candidates,weights)
        assumptions.extend(['Candidate costs and benefits are user-supplied assumptions in mutually comparable units, not measured intervention effects.','Footprint overlap is with the selected assessment area, not automatically a measured hazard or change footprint.'])
        for i,candidate in enumerate(candidates):
            area=overlap_km2(parent['area'],candidate['geometry'])
            metrics.append({'id':f'candidate-{i+1}-overlap','label':f'Candidate {i+1} selected-area overlap','value':area,'unit':'km² (spherical footprint estimate)','evidenceIds':evidence,'description':'Geographic polygon intersection with spherical area estimate; not classified-pixel area, exposure, damage or causal benefit.','denominator':'Recorded selection boundary; holes and multiple polygons retained'})
        claims.append(_claim('footprints','The candidate footprints are compared with the recorded selection boundary. This shows where proposals share geographic space with the selected area. It does not establish overlap with detected water, burning pixels, biodiversity loss, human heat exposure or confirmed damage; those require corresponding measured footprints and suitable contextual evidence.',evidence,assumptions))
        claims.append(_claim('tradeoffs','Pareto alternatives show which fully specified candidates are not dominated in assumed cost and benefit. A weighted score is shown only when explicit weights and both assumed quantities are supplied. Missing quantities remain unknown; an unknown candidate is not treated as worse than a known candidate.',evidence,assumptions))
        limits.extend(['No numerical conservation, firefighting, restoration or cooling benefit is inferred from area overlap.','Geographic intersection and spherical area are approximate footprint methods, distinct from native raster measurements.'])
        if any(m['value'] is None for m in metrics):limits.append('Native GDAL geometry support unavailable; spatial overlap values are withheld.')
        if weights:
            sensitivities.append(f'Cost weight {weights["cost"]}; benefit weight {weights["benefit"]}. Scores use min–max normalization within fully specified candidates; changing candidates or weights can change ranks.')
            sweep=weight_sweep(candidates)
            sensitivities.append(f'{sweep["rankingChanges"]} changes in the winning set across 21 tested preference settings; tied winners are retained. These counts are not likelihoods.')
        else:sensitivities.append('No weights supplied; no weighted ranking is published.')
    claims.append(_claim('reassessment','Use this comparison to identify evidence worth collecting and conditions for reconsidering the options. Check source dates, missing coverage, costs and assumed effects before acting. New observations, changed rainfall or management assumptions, or a different objective may change which alternatives remain useful.',evidence,assumptions))
    result={'schemaVersion':'1.0','kind':'scenario','assessmentId':request['assessmentId'],'scenarioKind':request['kind'],'methodVersion':VERSION,'changedInputs':request['inputs'],'assumptions':assumptions,'objectives':request['objectives'],'outputs':metrics,'sensitivities':sensitivities,'alternatives':alternatives,'claims':claims,'limitations':limits,'artifacts':ARTIFACTS}
    if sweep:result['weightSweep']=sweep
    if threshold_cases:result['thresholdSweep']=threshold_cases
    brief={'title':'Conditional planning comparison','sections':[{'id':'changed','title':'Changed assumptions','claimIds':[claims[0]['id']]},{'id':'options','title':'Options and tradeoffs','claimIds':[c['id'] for c in claims[1:-1]]},{'id':'unknown','title':'Conditions for reassessment','claimIds':['reassessment']}]}
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    for name,value in [('manifest.json',result),('brief.json',brief),('area.geojson',parent['area']),('evidence.json',parent['evidence'])]:
        (output/name).write_text(json.dumps(value,allow_nan=False))
    with (output/'metrics.csv').open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=['id','label','value','unit','description','denominator','evidenceIds']);writer.writeheader()
        for metric in metrics:writer.writerow({**metric,'evidenceIds':';'.join(metric['evidenceIds'])})
    return result
