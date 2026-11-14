"""Compose real provider evidence and deterministic briefs into five artifacts."""
import csv
import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from service.assessment_validation import validate_assessment_request, validate_assessment_manifest, validate_scenario_manifest
from .net import Budget, METHOD_VERSION, ProviderError
from . import providers as p
from .sources import source_registry

ARTIFACTS = ['manifest.json','brief.json','metrics.csv','area.geojson','evidence.json']
SECTIONS = [('changed','What changed'),('meaning','What it may mean'),('future','What could follow'),('options','Options to examine'),('unknown','What remains unknown')]


def _provider(out, name, call):
    try:
        p.merge(out,call())
    except ProviderError as exc:
        out['missing'].append(name+': '+exc.code+'. No source values substituted.')
    except (ValueError,TypeError,KeyError,OverflowError,AttributeError,IndexError):
        out['missing'].append(name+': malformed or unsupported provider metadata. No source values substituted.')


# Only locally defined public error codes may enter persisted missingness.
# Even an alphanumeric third-party code can contain a credential.
_FAILURE_CODES = frozenset((
    'empty_valid_mask', 'crop_unavailable', 'common_comparison_unavailable',
    'export_unavailable', 'time_budget_exceeded', 'transfer_budget_exceeded',
    'request_budget_exceeded', 'access_gate', 'rate_limit', 'http_failure',
    'network_failure', 'url_not_allowlisted', 'url_validation_failed',
    'address_not_public', 'invalid_json', 'response_too_large',
    'range_not_supported', 'unexpected_encoding', 'unsafe_headers',
    'redirect_missing_location', 'redirect_limit', 'unsafe_asset',
    'unsafe_sas_token', 'invalid_sas_expiry', 'expired_token',
    'no_signed_url', 'signed_url_mismatch',
    'UNSAFE_ASSET', 'SOURCE_HTTP', 'EARTHDATA_CONFIG', 'TRANSFER_LIMIT',
    'RANGE_REQUIRED', 'RANGE_UNSUPPORTED', 'BAD_RANGE', 'SOURCE_CHANGED',
    'RASTER_RUNTIME', 'CROP_LIMIT', 'UNSUPPORTED_MASK', 'UNSUPPORTED_RASTER',
    'UNSUPPORTED_GRID', 'INCOMPATIBLE_GRID', 'EMPTY_AREA', 'UNSUPPORTED_SCALE',
    'EMPTY_COMMON',
))
_STOP_CODES = frozenset(('time_budget_exceeded', 'transfer_budget_exceeded',
                         'request_budget_exceeded', 'TRANSFER_LIMIT'))


def _failure_code(exc, default):
    code = getattr(exc, 'code', None)
    return code if isinstance(code, str) and code in _FAILURE_CODES else default


def _measure(out,request,config,budget,output):
    if not out['candidates']: return
    try:
        from .raster import crop_bands, compare_crops
    except ImportError:
        out['missing'].append('Science raster dependencies are unavailable; catalogue discovery is retained but pixel measurements are withheld.')
        return
    from .selection import compatible_groups
    groups, omissions = compatible_groups(out['candidates'],out['evidence'],request)
    if omissions['rejected']:
        out['missing'].append(f'Selection withheld {omissions["rejected"]} candidates with missing, contradictory or unsupported essential compatibility/acquisition metadata; no unknown identities are treated as compatible.')
    if omissions['duplicates']:
        out['missing'].append(f'Selection omitted {omissions["duplicates"]} same-day duplicate records: latest acquisition time, then lexical item/evidence identity and content hash break ties deterministically; this is not a quality ranking.')
    if not groups: return
    sources={e['id']:e for e in out['evidence']}
    measured=[]; endpoints=None; attempts=0; attempted=set(); failures=set(); stopped=False
    for rank,group in enumerate(groups):
        if attempts>=4 or stopped: break
        first=latest=None; successes=0
        records=group['selected']
        # A failed preferred pair gets a distinct-group recovery opportunity,
        # reserving two of the four slots when another multi-date group exists.
        fallback=any(len(g['selected'])>=2 for g in groups[rank+1:])
        for index,c in enumerate(records):
            if attempts>=4: break
            if index>=2 and successes<2 and fallback and 4-attempts>=2:
                out['missing'].append('Preferred compatible group produced fewer than two successful crops after two attempts; remaining slots reserved for a separate compatible fallback pair.')
                break
            source=sources[c['evidenceId']]
            selection=(f'Selection: compatible group {group["id"]}, rank {rank+1}; '
                f'{len(group["records"])} distinct discovered dates. Multi-date groups precede newer singletons; '
                'then latest endpoint, earliest baseline and lexical compatibility identity. '
                'Up to four attempts total across all groups share the original transfer/runtime budgets. '
                'Same-day tie-break is deterministic, not an assumed quality score; accessibility and AOI coverage require cropping.')
            source['quality']['notes'].append(selection)
            attempts+=1; attempted.add(c['evidenceId'])
            try:
                budget.check()
                assets=c['assets']
                if c.get('signer')=='planetary':
                    from .planetary import sign_assets
                    assets=sign_assets(c,budget)
                crop=crop_bands(assets,request['area'],config,budget.transfer,kind=c['kind'])
                if not crop.get('validPixels') or not crop.get('metrics'):
                    raise ProviderError('empty_valid_mask')
                e=deepcopy(source); e['id']='e-'+p.digest([source['id'],request['area'],crop.get('hashes'),crop.get('grid')])[:24]
                e['geometry']=request['area']; e['public']=False
                e['title']=source['title']+' — quality-masked selected-area crop'
                e['timestamps']=dict(source.get('timestamps',{}),observedStart=c['date'],observedEnd=c['date'])
                e['quantity']='quality-masked '+('NDVI/NDMI' if c['kind'] in ('sentinel','hls') else 'surface temperature' if c['kind']=='landsat' else 'classified water footprint')
                e['unit']='index' if c['kind'] in ('sentinel','hls') else 'K' if c['kind']=='landsat' else 'km2'
                e['quality']['commonCoveragePercent']=crop.get('coveragePercent')
                e['quality']['notes'] += [f'{crop["validPixels"]} valid pixels of {crop["totalPixels"]} selected-area pixels; acquisition {c["date"]}.',
                    'Coverage describes this acquisition, not a common temporal mask; no whole-area change inferred.']
                e['quality']['notes'] += crop.get('qualityNotes',[])
                e['maskPolicy']=crop.get('maskPolicy','Conservative QA, finite science values and selected polygon; calibrated native/common processing grid')
                e['spatialSupport']['description']='Selected-area processing grid '+str(crop.get('grid','verified native grid'))[:700]
                e['hashes'].update(crop.get('hashes',{})); e['hashes']['area']=p.digest(request['area'])
                out['evidence'].append(e)
                out['observations']+=crop['validPixels']
                # Scalar records never own arrays. Streaming endpoints retain the
                # first and latest SUCCESSFUL crop, irrespective of failed slots.
                scalar={k:deepcopy(v) for k,v in crop.items() if not k.startswith('_')}
                measured.append((group,c,scalar,e))
                record=(c,crop,e)
                if first is None: first=record
                latest=record; successes+=1
                del crop,record
            except Exception as exc:
                code=_failure_code(exc,'crop_unavailable'); failures.add(c['evidenceId'])
                out['missing'].append(f'Selected {c["kind"]} crop on {c["date"][:10]}: {code}. Pixel measurements withheld for that acquisition.')
                if code in _STOP_CODES: stopped=True; break
        if successes>=2:
            endpoints=(first,latest)
            break
        # Fallback groups never reuse a previous group's single successful array.
        first=latest=None
    unattempted=sum(len(g['records']) for g in groups)-len(attempted)
    if unattempted:
        out['missing'].append(f'Selection omitted {unattempted} distinct group/date candidates after compatible recovery or the four-attempt limit; bounded discovery may also omit other acquisitions. Omitted dates are not zero-valued observations.')
    successful_groups={g['id'] for g,_,_,_ in measured}
    multiple=len(successful_groups)>1
    for group,c,crop,e in measured:
        for m in crop['metrics']:
            metric=dict(m)
            suffix='-'+group['id'] if multiple else ''
            metric['id']=c['kind']+'-'+c['date'][:10]+suffix+'-'+m['id']; metric['evidenceIds']=[e['id']]
            metric['description']=m['description']+f' Acquisition {c["date"][:10]}; valid subset only, no temporal difference.'
            out['metrics'].append(metric)
            if metric['value'] is not None:
                out['findings'].append(p.finding(f'On {c["date"][:10]}, {metric["label"]} is {metric["value"]:.5g} {metric["unit"]} over {crop["validPixels"]} valid selected-area pixels. This summarises one acquisition; clear-sky sampling and masked pixels limit its interpretation.',[e['id']],
                    applicability=['Only the valid population of this acquisition; no biodiversity, air heat, volume or causal inference.']))
    if endpoints:
        before,after=endpoints
        try:
            budget.check()
            compared=compare_crops(before[1],after[1],before[0]['kind'])
            e=deepcopy(after[2]); e['id']='e-'+p.digest([before[2]['id'],after[2]['id'],compared['hashes']])[:24]
            e['title']='Common-valid comparison: '+before[0]['itemId']+' to '+after[0]['itemId']
            e['timestamps']['observedStart']=before[0]['date']; e['timestamps']['observedEnd']=after[0]['date']
            e['quality']['commonCoveragePercent']=compared['coveragePercent']
            e['quality']['notes']=['Pixelwise differences on the same target grid and common temporal valid mask.',
                'Endpoints are the first and latest successful acquisitions within one compatible kind/grid/version/platform/source group; failed or omitted dates remain missing.',
                'Only the valid intersection is measured; no attribution or intervention effect inferred.']
            e['hashes'].update(compared['hashes']); e['hashes']['beforeEvidence']=p.digest([before[2]['id'],before[2]['hashes']]); e['hashes']['afterEvidence']=p.digest([after[2]['id'],after[2]['hashes']])
            e['maskPolicy']='Intersection of before/after QA, finite science data and exact selected polygon on identical grid'
            out['evidence'].append(e)
            refs=[before[2]['id'],after[2]['id'],e['id']]
            for m in compared['metrics']:
                metric=dict(m); metric['evidenceIds']=refs; out['metrics'].append(metric)
                if m['value'] is not None:
                    out['findings'].insert(0,p.finding(f'From {before[0]["date"][:10]} to {after[0]["date"][:10]}, {m["label"]} is {m["value"]:.5g} {m["unit"]} on the common valid population covering {compared["coveragePercent"]:.1f}% of selected-area pixel centres. This is a measured pixelwise difference, not subtraction of independently masked medians or a causal effect.',refs,
                        applicability=['Common valid intersection only; coverage does not establish representativeness of excluded pixels.']))
        except Exception as exc:
            code=_failure_code(exc,'common_comparison_unavailable')
            out['missing'].append('Endpoint comparison: '+code+'. Independent medians are not subtracted as change.')
        else:
            # Export failures do not erase already computed measurements. Restrict
            # the arrays passed to the exporter BEFORE any artifacts are written.
            if isinstance(before[1].get('_arrays'),dict) and output is not None:
                try:
                    budget.check()
                    from .views import export_comparison
                    names=sorted(set(before[1]['_arrays'])&set(after[1]['_arrays']))[:2]
                    views=[]
                    for endpoint in (before[1],after[1]):
                        view=dict(endpoint)
                        view['_arrays']={name:endpoint['_arrays'][name] for name in names}
                        view['_valid']={name:endpoint['_valid'][name] for name in names}
                        views.append(view)
                    out['rasters']=export_comparison(*views,dict(date=before[0]['date'],evidenceId=before[2]['id']),dict(date=after[0]['date'],evidenceId=after[2]['id']),output)
                except Exception as exc:
                    out['missing'].append('Comparison exports: '+_failure_code(exc,'export_unavailable')+'. Analytical measurements retained; raster views unavailable.')
    elif measured:
        out['missing'].append('No compatible group yielded two successful acquisition dates within the four-attempt budget; single-acquisition summaries retained, temporal change withheld.')
    for group in groups:
        history=[(c,crop,e) for g,c,crop,e in measured if g['id']==group['id']]
        if not history: continue
        try: days=p._days(request['start'],request['end'],cap=512)
        except ProviderError: days=sorted({c['date'][:10] for c,_,_ in history})
        metric_ids={m['id'] for _,crop,_ in history for m in crop['metrics']}
        attempted_days={c['date'][:10] for c in group['selected'] if c['evidenceId'] in attempted}
        for metric_id in sorted(metric_ids)[:2]:
            values={c['date'][:10]:next((m['value'] for m in crop['metrics'] if m['id']==metric_id),None) for c,crop,_ in history}
            sample=next(m for _,crop,_ in history for m in crop['metrics'] if m['id']==metric_id)
            out['series'].append(dict(id='crop-'+metric_id+('-'+group['id'] if multiple else ''),label=sample['label']+' (bounded compatible acquisitions)',unit=sample['unit'],
                evidenceIds=[e['id'] for _,crop,e in history if any(m['id']==metric_id for m in crop['metrics'])],
                points=[dict(date=d,value=values.get(d),quality='quality-masked acquisition' if d in values else 'crop unavailable' if d in attempted_days else 'missing / not selected') for d in days]))


def _claims_and_brief(out,request):
    evidence_ids=[e['id'] for e in out['evidence']]
    claims=[]; sections=[]
    # Reports remain reproducible from persisted evidence; no generative completion.
    limits={
        'meaning': 'Interpret each result at its recorded support and valid population. Station readings do not establish area-wide conditions. Thermal detections are not damage, greenness is not biodiversity, and surface temperature is not air temperature.',
        'future': 'No independently validated local forecast is available. Official weather context, when retrieved, has separate issue and validity times. Observed differences cannot establish future trends, intervention effects or causal mechanisms.',
        'options': 'Inspect source dates, units, masks and missing observations. Repeat comparable measurements and compare a common valid population. Use scenario thresholds or options only with explicit assumptions, objectives and reconsideration conditions.',
        'unknown': 'Causation, complete sampling and decision usefulness remain unverified. Missing data, access gates and zero-match queries are not zero-valued environmental measurements.'}
    for section,title in SECTIONS:
        found=[f for f in out['findings'] if f['section']==section]
        # Every statement is a claim with resolvable evidence references. A totally
        # unavailable job has empty claim lists and an explicit quality explanation.
        if section!='changed' and evidence_ids:
            text=limits[section]
            if section=='unknown' and out['missing']: text += ' '+ out['missing'][0][:280]
            found=found[:1]+[p.finding(text,evidence_ids[:16],section=section,applicability=['Bounded selected evidence only; unsupported interpretation withheld.'])]
        elif section=='changed': found=found[:1]
        claim_ids=[]
        for f in found:
            ident='c-'+p.digest([section,f['text'],f['evidenceIds']])[:24]
            if any(c['id']==ident for c in claims): continue
            claims.append(dict(id=ident,type=f['type'],text=f['text'],evidenceIds=f['evidenceIds'],methodVersion=f.get('methodVersion',METHOD_VERSION),
                assumptions=f.get('assumptions',[]),uncertainty=f['uncertainty'],applicability=f['applicability'],counterevidence=[]))
            claim_ids.append(ident)
        sections.append(dict(id=section,title=title,claimIds=claim_ids))
    return claims,dict(title=request['domain'].capitalize()+' evidence brief',sections=sections)


def run_assessment(request,config,output,*,owner=None):
    validate_assessment_request(request)
    budget=Budget(config); out=p.bundle()
    gauge_vintage=None
    def capture_gauge(payload):
        nonlocal gauge_vintage
        if not config.gauge_vintages_enabled or owner is None:
            return
        from .vintages import ObservationVintageLedger, VintageError
        try:
            ledger=ObservationVintageLedger(config.root.resolve(),owner,storage_root=config.root.resolve(),
                storage_bytes=config.storage_bytes,reserve_bytes=config.reserve_bytes)
            receipt=ledger.capture(payload['identity'],payload['records'],station_time_properties=payload['stationTime'],
                response_hash=payload['responseHash'],metadata_hash=payload['metadataHash'],received_at=payload['receivedAt'])
            snapshot=ledger.as_of(payload['identity'],payload['receivedAt'],start=request['start'],end=request['end'])
            gauge_vintage=dict(status='captured',receipt=receipt,snapshot=snapshot)
        except VintageError as exc:
            gauge_vintage=dict(status='unavailable',reason=exc.code)
            out['missing'].append('Observation availability archive: '+exc.code+'. Current measurements remain usable; historical as-of availability is not established.')
    selected=request.get('options',{}).get('sourceIds')
    known={s['id']:s for s in source_registry()}
    def enabled(name): return selected is None or name in selected
    if selected is not None:
        for name in selected:
            if name not in known or request['domain'] not in known[name]['domains']:
                out['missing'].append('Requested source '+name+' is unknown or not applicable to this domain.')
            elif known[name]['status']!='available':
                out['missing'].append('Requested source '+name+' is '+known[name]['status']+' and has no implemented assessment adapter.')
    domain=request['domain']
    if domain=='water':
        if enabled('usgs-daily'): _provider(out,'USGS daily',lambda:p.usgs_daily(request,budget,capture=capture_gauge))
        if enabled('opera-dswx-hls'):
            _provider(out,'OPERA CMR earliest',lambda:p.cmr_discovery(request,budget,ascending=True))
            _provider(out,'OPERA CMR latest',lambda:p.cmr_discovery(request,budget))
        if enabled('pinned-water-mosaic') or enabled('pinned-water-history'): _provider(out,'Pinned historical water',lambda:p.historical_water(request,budget))
    elif domain=='fire':
        if enabled('firms-thermal'): _provider(out,'FIRMS',lambda:p.firms(request,budget))
        if enabled('nifc-perimeters'): _provider(out,'NIFC',lambda:p.nifc_perimeters(request,budget))
    elif domain=='ecology':
        if enabled('sentinel-2-indices'): _provider(out,'Sentinel STAC',lambda:p.stac_discovery(request,budget,'sentinel'))
        if enabled('hls-ndvi-ndmi'):
            _provider(out,'HLS CMR earliest',lambda:p.cmr_discovery(request,budget,hls=True,ascending=True))
            _provider(out,'HLS CMR latest',lambda:p.cmr_discovery(request,budget,hls=True))
    elif domain=='urban':
        if enabled('landsat-pc-lst'):
            from .planetary import discover
            _provider(out,'Planetary Computer Landsat',lambda:discover(request,budget))
        if selected is not None and enabled('landsat-c2-lst'): _provider(out,'Landsat STAC',lambda:p.stac_discovery(request,budget,'landsat'))
        out['missing'].append('Annual NLCD release-specific COG endpoints and matched annual change are not implemented; no old multi-year NLCD substitution.')
    _measure(out,request,config,budget,output)
    if selected is not None and 'meteomatics-weather-context' in selected:
        from .meteomatics import historical_context
        _provider(out,'Meteomatics historical context',lambda:historical_context(request,config,budget))
    if enabled('nws-weather-context'): _provider(out,'NWS context',lambda:p.nws_context(request,budget))
    processed_at=datetime.now(timezone.utc)
    from .history import analyze_series, gauge_evaluation
    for series in out['series'][:8]:
        series['analysis']=analyze_series(series)
        from .sampling import seasonal_sampling
        series['seasonalSampling']=seasonal_sampling(series)
        if series['id']=='usgs-discharge':
            from .seasonal_trend import seasonal_trend
            trend=seasonal_trend(series)
            series['seasonalTrend']=trend
            if trend['status']=='descriptive':
                from .seasonal_trend import trend_metric, trend_finding
                out['metrics'].append(trend_metric(series,trend))
                out['findings'].append(trend_finding(series,trend))
    evaluation=next((v for s in out['series'] if (v:=gauge_evaluation(s,out['evidence'],now=processed_at)) is not None),None)
    seasonal_supported=any(s['analysis']['seasonal']['supported'] for s in out['series'][:8])
    for s in out['series'][:8]:
        a=s['analysis'];season=a['seasonal']
        if season['supported']:
            out['findings'].append(p.finding(f'The latest {s["label"]} reading ({a["lastDate"]}) lies at sample percentile {season["percentile"]:.1f} among {season["sampleCount"]} comparable calendar-window readings across {season["distinctYearCount"]} earlier years. This is descriptive seasonal context for the recorded series, not a detection probability or causal explanation.',s['evidenceIds'],section='meaning',applicability=['Same recorded series and units only; sampling and measurement population may differ.']))
    # Question-specific negative results are explicit, independent of data access.
    if request['question'] in ('seasonal','explain','exposure','future','options') and not (request['question']=='seasonal' and seasonal_supported):
        out['missing'].append({'seasonal':'Comparable multi-year seasonal baseline is not established by these bounded observations.',
            'explain':'Causal attribution is withheld; associated measurements do not establish a mechanism.',
            'exposure':'Population/assets and an exact validated hazard overlay were not supplied; exposure is withheld.',
            'future':'No independent chronologically validated local forecast is available; future claims are withheld.',
            'options':'Decision costs, effects, objectives and uncertainty are not measured here; use explicit scenario assumptions.'}[request['question']])
    # Deduplicate catalog entries across ascending/descending searches and boxes.
    out['evidence']=list({e['id']:e for e in out['evidence']}.values())
    refs={e['id'] for e in out['evidence']}
    out['findings']=[f for f in out['findings'] if set(f['evidenceIds'])<=refs]
    out['missing']=list(dict.fromkeys(out['missing']))
    claims,brief=_claims_and_brief(out,request)
    weather_estimates=sum(point['value'] is not None
        for series in out['series'] if series['id'].startswith('meteomatics-')
        for point in series['points'])
    outcome='partial' if out['observations']>0 or weather_estimates else 'unavailable'
    # v1 intentionally reports partial until the requested question's full
    # evidence/temporal comparison is supported, even if individual metrics exist.
    result=dict(schemaVersion='1.0',kind='assessment',domain=domain,question=request['question'],area=request['area'],
        time=dict(start=request['start'],end=request['end']),processedAt=processed_at.isoformat(),methodVersion=METHOD_VERSION,
        title=domain.capitalize()+' assessment: '+request['question'],outcome=outcome,evidence=out['evidence'],claims=claims,
        metrics=out['metrics'],quality=[
            dict(dimension='coverage',status='limited' if out['observations'] else 'unknown',message=('Common temporal valid coverage: '+', '.join(f"{v['quantity']}: {v['validPixels']} / {v['totalPixels']} selected-area pixels ({v['commonCoveragePercent']:.2f}%)" for v in out['rasters'])+'. Statistics describe the common valid subset; high coverage does not establish representativeness. Masks and excluded pixels are exported.' if out['rasters'] else 'Exact support is recorded per source; whole-area and common temporal coverage are not established.')),
            dict(dimension='measurement',status='limited' if out['observations'] else 'withheld',message=('Recorded source values are limited to supported station-days or valid pixels; source estimates retain their flags. ' if out['observations'] else 'Historical modeled weather context is available; no direct local observation was measured. ' if weather_estimates else 'No usable local observation was measured. ')+(' '.join(out['missing'])[:3600] or 'The selected question remains only partly supported.')),
            dict(dimension='attribution',status='withheld',message='No validated causal attribution; deterministic boundaries only.'),
            dict(dimension='prediction',status='limited' if evaluation and evaluation['forecasts'] else 'withheld',message='Single-station forecast evaluation is experimental; all evaluated horizons and withholding reasons are retained. Prospective reliability is not established.' if evaluation else 'No validated local numeric forecast; official NWS context is separately dated.'),
            dict(dimension='transfer',status='unknown',message='Scientific generalization to other stations, seasons or regions has not been validated.'),
            dict(dimension='delivery',status='supported',message=f'Cumulative metadata and raster transfer: {budget.used} bytes; hard shared cap {budget.limit} bytes; no full-granule fallback.'),
            dict(dimension='freshness',status='limited',message='Source observed and retrieved times are separate; historical examples and rolling windows are explicit.')],
        brief=brief,artifacts=ARTIFACTS)
    if gauge_vintage is not None:
        result['gaugeVintage']=gauge_vintage
        if gauge_vintage['status']=='captured':
            from .forecast_information import forecast_information
            snapshot=gauge_vintage['snapshot']
            # Pin comes from this trusted ledger read; no mutable reread at validation.
            result['forecastInformation']=forecast_information(snapshot,
                expected_snapshot_hash=snapshot['snapshotHash'],issue_time=snapshot['issueTime'])['report']
    if out['series']: result['series']=out['series'][:8]
    if evaluation:result['forecastEvaluation']=evaluation
    if out['rasters']:
        result['rasters']=out['rasters']
        result['artifacts']=ARTIFACTS+[name for view in out['rasters'] for files in view['files'].values() for name in files.values()]
    referenced_snapshot=None
    if gauge_vintage is not None and gauge_vintage['status']=='captured':
        from .vintages import canonical_json
        from .vintage_reference import ARTIFACT, EMBED_MAX_BYTES, build_reference
        # Large receipts remain complete in a protected artifact, while the
        # compact result stays within the original256KiB manifest allowance.
        if len(canonical_json(gauge_vintage).encode('utf-8')) > EMBED_MAX_BYTES:
            reference,raw=build_reference(gauge_vintage,max_bytes=config.artifact_bytes)
            referenced_snapshot=gauge_vintage['snapshot']
            result['gaugeVintage']=reference
            result['artifacts']=list(result['artifacts'])+[ARTIFACT]
            destination=Path(output);destination.mkdir(parents=True,exist_ok=True)
            with (destination/ARTIFACT).open('xb') as stream:
                stream.write(raw)
    validate_assessment_manifest(result,request,referenced_snapshot=referenced_snapshot)
    _write_artifacts(output,result)
    return result


def run_scenario(request,parent,config,output):
    from .scenarios import run_scenario as calculate
    result=calculate(request,parent,config,output)
    validate_scenario_manifest(result,request,parent)
    # Scenario manifest intentionally contains no extra brief/area/evidence keys.
    brief=json.loads((Path(output)/'brief.json').read_text())
    _write_artifacts(output,result,area_override=parent['area'],evidence_override=parent['evidence'],brief_override=brief)
    return result


def _write_artifacts(output,result,area_override=None,evidence_override=None,brief_override=None):
    path=Path(output); path.mkdir(parents=True,exist_ok=True)
    artifacts={'manifest.json':result,'brief.json':brief_override if brief_override is not None else result['brief'],
        'area.geojson':area_override if area_override is not None else result['area'],
        'evidence.json':evidence_override if evidence_override is not None else result['evidence']}
    for name,value in artifacts.items():
        (path/name).write_text(json.dumps(value,allow_nan=False,ensure_ascii=False,separators=(',',':')))
    with (path/'metrics.csv').open('w',newline='') as stream:
        writer=csv.writer(stream); writer.writerow(['id','unit','value','label','description','denominator','evidenceIds'])
        for m in result.get('metrics',result.get('outputs',[])):
            writer.writerow([m['id'],m['unit'],m['value'] if m['value'] is not None else '',m['label'],m['description'],
                m['denominator'] if m['denominator'] is not None else '',json.dumps(m['evidenceIds'],separators=(',',':'))])
