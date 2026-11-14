"""Bounded public provider adapters; catalogue discovery is never a measurement."""
from service.range_reader import RangeError
import csv
import hashlib
import io
import json
import math
import re
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit
from .net import METHOD_VERSION, ProviderError, vetted_url
from service.assessment_validation import inside, on_segment, validate_geometry

PIN = '452c0145b1dbdd5ca82c6d13d7fadc8fba0bbd06'
PIN_WATER_SHA = '317bc6c665b31f034ff3d1edee6413a4718305215b51302fdf75382eec05d213'
PIN_HISTORY_SHA = 'f481fbb5c7e5d5493be396980e0fe5bfff1b22f341e3efae042690a9fd14e5b5'
FIRMS_ROOT = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/'
STAC = 'https://earth-search.aws.element84.com/v1'
USGS = 'https://api.waterdata.usgs.gov/ogcapi/v1/collections'
NIFC = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0'
_DSWX_PRODUCT = re.compile(r'OPERA_L3_DSWx-HLS_T(?P<tile>\d{2}[A-Z]{3})_(?P<acquisition>\d{8}T\d{6}Z)_(?P<processing>\d{8}T\d{6}Z)_(?:L8|L9|S2A|S2B|S2C|S2D)_30_v(?P<version>\d+\.\d+)\Z')
_CMR_TIME = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})\Z')


def _cmr_instant(value):
    if not isinstance(value,str) or not _CMR_TIME.fullmatch(value) or value.endswith('-00:00'):
        return None
    if not value.endswith('Z') and (int(value[-5:-3])>23 or int(value[-2:])>59):
        return None
    try:
        return datetime.fromisoformat(value.replace('Z','+00:00')).astimezone(timezone.utc)
    except (ValueError, OverflowError):
        return None


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def polygons(area):
    """Use short arcs consistently with the request validator, including holes."""
    source = [area['coordinates']] if area['type'] == 'Polygon' else area['coordinates']
    result = []
    for poly in source:
        rings = []
        for raw in poly:
            ring = []
            for lon, lat in raw:
                if ring:
                    lon += 360*round((ring[-1][0]-lon)/360)
                ring.append((lon, lat))
            if rings:
                shift = 360*round((rings[0][0][0]-ring[0][0])/360)
                ring = [(lon+shift, lat) for lon, lat in ring]
            rings.append(ring)
        result.append(rings)
    return result


def contains(area, lon, lat):
    for rings in polygons(area):
        lon0 = lon+360*round((rings[0][0][0]-lon)/360)
        point = (lon0, lat)
        shell = inside(point, rings[0]) or any(on_segment(a, b, point) for a, b in zip(rings[0], rings[0][1:]))
        hole = any(inside(point, r) or any(on_segment(a, b, point) for a, b in zip(r, r[1:])) for r in rings[1:])
        if shell and not hole:
            return True
    return False


def search_boxes(area):
    boxes = []
    for rings in polygons(area):
        xs, ys = zip(*rings[0]); west, east = min(xs), max(xs)
        shift = 360*math.floor((west+180)/360); west -= shift; east -= shift
        if east <= 180:
            boxes.append([west, min(ys), east, max(ys)])
        else:
            boxes.extend([[west, min(ys), 180, max(ys)], [-180, min(ys), east-360, max(ys)]])
    # Keep searches bounded; callers explicitly report an incomplete discovery if
    # more than two disjoint boxes are requested rather than broadening to globe.
    return list({tuple(b): b for b in boxes}.values())


def box_geometry(box):
    west, south, east, north = box
    if east-west >= 180 or north > 85 or south < -85 or west == east or north == south:
        return None
    area = {'type': 'Polygon', 'coordinates': [[[west,south],[east,south],[east,north],[west,north],[west,south]]]}
    validate_geometry(area)
    return area


def bundle():
    return {'evidence': [], 'metrics': [], 'findings': [], 'series': [], 'missing': [], 'candidates': [], 'observations': 0, 'rasters': []}


def evidence(source, version, title, transfer, *, key=None, geometry=None, start=None, end=None,
             quantity='catalogue metadata', unit='record', resolution=None, support='Source footprint; not a measured AOI',
             notes=(), mask='Discovery only; no pixel values read', public=False, coverage=None, published=None):
    key = key or transfer.sha256
    return {'id': 'e-'+digest([source, version, key])[:24], 'sourceId': source,
            'sourceVersion': version, 'title': title[:500], 'url': transfer.url,
            'geometry': geometry, 'spatialSupport': {'resolution': resolution, 'unit': 'm' if resolution else 'none', 'description': support},
            'timestamps': {'observedStart': start, 'observedEnd': end, 'publishedAt': published,
                           'retrievedAt': transfer.retrieved_at, 'validThrough': None},
            'quantity': quantity, 'unit': unit, 'quality': {'commonCoveragePercent': coverage, 'notes': list(notes)},
            'maskPolicy': mask, 'methodVersion': METHOD_VERSION, 'hashes': {'response': transfer.sha256}, 'public': public}


def metric(id, label, value, unit, refs, description, denominator=None):
    return dict(id=id, label=label, value=value, unit=unit, evidenceIds=refs, description=description, denominator=denominator)


def finding(text, refs, *, observed=False, section='changed', applicability=(), uncertainty=()):
    return dict(text=text, evidenceIds=refs, type='Observed' if observed else 'Derived', section=section,
                applicability=list(applicability), uncertainty=list(uncertainty))


def merge(target, source):
    for key in ('evidence', 'metrics', 'findings', 'series', 'missing', 'candidates'):
        target[key].extend(source[key])
    target['observations'] += source['observations']
    return target


def _days(start, end, cap=2000):
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    n = (last-first).days+1
    if n > cap:
        raise ProviderError('series_date_limit')
    return [(first+timedelta(days=i)).isoformat() for i in range(n)]


def historical_water(request, budget):
    out = bundle()
    # This example has a known public mosaic footprint, not an arbitrary crop.
    footprint = [-115.90214616115489,35.10731096063997,-113.52113587801435,37.041254047568394]
    overlap = any(b[0] <= footprint[2] and b[2] >= footprint[0] and b[1] <= footprint[3] and b[3] >= footprint[1] for b in search_boxes(request['area']))
    if not overlap:
        out['missing'].append('Pinned historical Lake Mead regional examples do not overlap the selected area; no local measurement was assigned.')
        return out
    for file, source, expected in [('processed-water.json','pinned-water-mosaic',PIN_WATER_SHA), ('water-history.json','pinned-water-history',PIN_HISTORY_SHA)]:
        if request.get('options',{}).get('sourceIds') is not None and source not in request['options']['sourceIds']: continue
        t = budget.fetch('https://nasa.r8volt.com/data/'+file, max_bytes=1024**2)
        d = t.json()
        if d.get('schemaVersion') != '1.0' or d.get('source',{}).get('commit') != PIN or d['source'].get('sha256') != expected:
            raise ProviderError('pinned_provenance_changed')
        if file == 'processed-water.json':
            e = evidence(source, PIN, 'Historical OPERA regional mosaic, 2023-03-31', t,
                         geometry=box_geometry(footprint), start=d['date'], end=d['date'], quantity='regional classified open-water footprint', unit='km2',
                         resolution=30, support='Entire supplied regional mosaic, not the selected area or Lake Mead boundary',
                         notes=[d['dateBasis'],d['caveat']], mask=d['processing']['method'], public=True,
                         coverage=d['includedCoveragePercent'], published=d['processing']['processedAt'])
            e['hashes']['upstreamRaster'] = expected
            out['evidence'].append(e)
            # Show quantitative historical context only when its date is requested;
            # it cannot satisfy the private area's observation requirement.
            if request['start'] <= d['date'] <= request['end']:
                value = d['openWaterClassAreaKm2']
                if not isinstance(value,(int,float)) or not math.isfinite(value):
                    raise ProviderError('invalid_historical_value')
                out['metrics'].append(metric('historical-regional-water','Historical regional open-water class area',value,'km2',[e['id']],
                    'Entire 2023-03-31 repository mosaic; not measured within the selected geometry.', 'Native included pixels in the full supplied mosaic'))
                out['findings'].append(finding(f'The historical regional mosaic labels {value:g} km² as open-water class on {d["date"]}; this figure covers the full mosaic, not the selected area or Lake Mead alone.',[e['id']],observed=True,
                    applicability=['Historical regional example only; acquisition date comes from its filename.']))
        else:
            points = d.get('points',[])
            if len(points) > 16000 or d.get('unit') != 'ft' or d.get('status') != 'historical-observed':
                raise ProviderError('invalid_historical_series')
            e = evidence(source, PIN, 'Archived Lake Mead gauge elevations',t,start=d['dateRange'][0],end=d['dateRange'][1],
                         quantity=d['quantity'],unit='ft',support='Lake Mead gauge archive; station geometry and vertical datum are unspecified',
                         notes=[d['notice']],mask='Finite archived daily values; missing days remain missing',public=True)
            e['hashes']['upstreamExport'] = expected
            out['evidence'].append(e)
            try:
                days = _days(request['start'],request['end'])
            except ProviderError:
                out['missing'].append('Historical series display is limited to 2000 requested days; select a shorter period.')
                continue
            by_day = {p['date']:p['value'] for p in points if request['start'] <= p.get('date','') <= request['end'] and
                      isinstance(p.get('value'),(int,float)) and not isinstance(p['value'],bool) and math.isfinite(p['value'])}
            if by_day:
                out['series'].append({'id':'historical-lake-mead-elevation','label':'Historical Lake Mead gauge context (location/datum unverified)',
                    'unit':'ft','evidenceIds':[e['id']], 'points':[{'date':day,'value':by_day.get(day),'quality':'archived observation' if day in by_day else 'missing'} for day in days]})
                out['findings'].append(finding(f'The archived Lake Mead export contains {len(by_day)} finite daily elevations within the requested dates. Missing dates remain gaps; no station geometry or vertical datum is supplied, so this regional context is not an observation of the selected area.',[e['id']],observed=True,applicability=['Archived named gauge only; no volume conversion.']))
    out['missing'].append('The pinned water examples are historical regional context; a current local gauge or quality-masked satellite crop is required for an AOI assessment.')
    return out


def _daily_duplicates(records):
    """Conservative, order-independent summary of one station-series day.

    Equal numbers never imply equal approval metadata. Preserve every distinct
    status in a stable label; conflicting values (including an invalid record)
    remain withheld even when a later duplicate repeats an earlier value.
    """
    values = {value for value, _ in records}
    if len(values) != 1:
        return None, 'conflicting duplicate day; value withheld'
    statuses = sorted({quality for _, quality in records}, key=lambda q: (q.casefold(), q))
    quality = statuses[0] if len(statuses) == 1 else 'mixed duplicate approval status: '+ ' | '.join(statuses)
    return next(iter(values)), quality


def _daily_qualifiers(value):
    """Preserve bounded JSON flags; approval status is a separate source field."""
    if value is None:
        return []
    values = [value] if type(value) is str else value
    if type(values) is not list or len(values) > 16:
        raise ProviderError('unsupported_gauge_qualifier')
    if any(type(item) is not str or not 1 <= len(item) <= 64 or
           any(ord(c) < 32 or ord(c) > 126 for c in item) or
           any(c in item for c in ('<', '>', '\\')) for item in values):
        raise ProviderError('unsupported_gauge_qualifier')
    return sorted(set(values))


def usgs_daily(request, budget, *, capture=None):
    out = bundle(); options = request.get('options',{}); station = options.get('gaugeId')
    boxes = search_boxes(request['area']); metadata_by_id = {}
    if station:
        if not re.fullmatch(r'(?:USGS-)?\d{8,15}',station):
            raise ProviderError('unsupported_gauge_id')
        station = station if station.startswith('USGS-') else 'USGS-'+station
        url = USGS+'/monitoring-locations/items/'+station+'?f=json'
        metadata = budget.fetch(url); features = [metadata.json()]; metadata_by_id[str(features[0].get('id',''))] = metadata.sha256
    else:
        if len(boxes)>2:
            out['missing'].append('USGS discovery searches only the first two component boxes; other components are unsearched.')
        features = []; metadata = None
        for box in boxes[:2]:
            metadata = budget.fetch(USGS+'/monitoring-locations/items?'+urlencode({'f':'json','bbox':','.join(map(str,box)),'limit':5}))
            batch = metadata.json().get('features',[])[:5]
            features.extend(batch)
            for feature in batch: metadata_by_id.setdefault(str(feature.get('id','')),metadata.sha256)
        features.sort(key=lambda f: str(f.get('id','')))
    selected = None
    for feature in features:
        if not str(feature.get('id','')).startswith('USGS-'): continue
        geom = feature.get('geometry') or {}; coords = geom.get('coordinates',[])
        if geom.get('type') == 'Point' and len(coords)==2 and contains(request['area'],*coords):
            selected = feature; break
    if not selected:
        out['missing'].append('No selected USGS monitoring location lies inside the exact area; a nearby station is not a local observation.')
        return out
    station = selected.get('id') or selected.get('properties',{}).get('monitoring_location_id')
    if not isinstance(station,str) or not re.fullmatch(r'USGS-\d{8,15}',station):
        raise ProviderError('invalid_station_metadata')
    t = budget.fetch(USGS+'/daily/items?'+urlencode({'f':'json','monitoring_location_id':station,'parameter_code':'00060',
        'statistic_id':'00003','datetime':request['start']+'/'+request['end'],'limit':2000}),max_bytes=2*1024**2)
    d = t.json(); records = d.get('features',[])
    if len(records)>2000:
        raise ProviderError('series_record_limit')
    if any(l.get('rel')=='next' for l in d.get('links',[])):
        out['missing'].append('USGS daily response is truncated at 2000 records; no pagination or complete period claim.')
    groups = {}; qualifiers = {}
    for item in records:
        p = item.get('properties',{}); geom = item.get('geometry') or {}
        if (p.get('monitoring_location_id') != station or p.get('parameter_code')!='00060' or p.get('statistic_id')!='00003' or
                geom.get('type')!='Point' or len(geom.get('coordinates',[]))!=2 or not contains(request['area'],*geom['coordinates'])):
            continue
        day = p.get('time','')[:10]
        if not request['start'] <= day <= request['end']:
            continue
        try:
            if date.fromisoformat(day).isoformat()!=day: continue
        except (ValueError,TypeError):
            continue
        try:
            value = None if isinstance(p.get('value'),bool) else float(p['value'])
        except (ValueError,TypeError,KeyError):
            value = None
        if value is not None and (not math.isfinite(value) or value < 0): value = None
        key = (p.get('time_series_id') or p.get('timeseries_id'),p.get('unit_of_measure'))
        if not key[0] or key[1]!='ft^3/s': continue
        quality = str(p.get('approval_status') or p.get('approvals_status') or 'approval unknown')
        groups.setdefault(key, {}).setdefault(day, []).append((value, quality))
        # JSON may carry a string, null, or an array of source flags. Never
        # promote a flagged estimate to an unqualified observation.
        flags = qualifiers.setdefault((key,day),set())
        flags.update(_daily_qualifiers(p.get('qualifier')))
        if len(flags) > 16:
            raise ProviderError('unsupported_gauge_qualifier')
    groups = {key: {day: _daily_duplicates(records) for day, records in days.items()}
              for key, days in groups.items()}
    if not groups:
        out['missing'].append(f'USGS {station} has no usable daily mean discharge observations for this period; other parameters were not substituted.')
        return out
    key, by_day = sorted(groups.items(),key=lambda x:(-len(x[1]),str(x[0])))[0]
    if capture is not None:
        # Capture actual returned records, including explicit invalid/conflicting
        # revisions, before withholding a wholly invalid measurement response.
        # Absent dates are never synthesized into revision withdrawals.
        capture(dict(identity=dict(station=station,timeSeriesId=key[0],parameter='00060',statistic='00003',unit=key[1]),
            receivedAt=t.retrieved_at,responseHash=t.sha256,metadataHash=metadata_by_id[station],
            stationTime={k:selected.get('properties',{}).get(k) for k in ('country_code','time_zone_abbreviation','uses_daylight_savings')},
            records=[dict(date=day,value=value,quality=quality,qualifiers=sorted(qualifiers.get((key,day),set())))
                     for day,(value,quality) in sorted(by_day.items())]))
    valid = sorted((day,v[0]) for day,v in by_day.items() if v[0] is not None)
    if not valid:
        out['missing'].append('USGS daily records contain no finite nonnegative discharge values.'); return out
    e = evidence('usgs-daily','OGC-v1:'+key[0],f'USGS {station}: daily mean discharge',t,key=key[0]+t.sha256,
        start=valid[0][0],end=valid[-1][0],quantity='daily mean discharge',unit='ft^3/s',
        support=f'Point station {station} at {selected["geometry"]["coordinates"]}; no area or flood extent inferred',
        notes=['Provisional/approval status is preserved in the series. Equal-value duplicate statuses are retained together in stable order; conflicting values, including invalid duplicates, are withheld.',
               'Daily duplicate policy: usgs-daily-duplicates-v1. At most one station and one time-series, statistic 00003, parameter 00060.',
               'Qualifier policy: usgs-json-qualifiers-v2. String/null/at most16 string-array flags preserved independently of approval; estimated values are source estimates, not unqualified measurements.',
               'These are currently retrieved observations, potentially revised. Retrieval time is not original publication time; historical as-of availability is not established.'],
        mask='Finite nonnegative daily discharge; exact station/time/point-in-polygon filters',public=False)
    e['hashes']['stationMetadata'] = metadata_by_id[station]
    out['evidence'].append(e); refs=[e['id']]; out['observations'] += len(valid)
    out['metrics'].append(metric('gauge-last-discharge','Latest recorded daily mean discharge',valid[-1][1],'ft^3/s',refs,
        f'Recorded {valid[-1][0]} at {station}; point support, not area-wide discharge. Source flags: '+(' | '.join(sorted(qualifiers.get((key,valid[-1][0]),set()))) or 'none reported'),'One station-day'))
    if len(valid)>1:
        out['metrics'].append(metric('gauge-endpoint-change','Recorded endpoint discharge difference',valid[-1][1]-valid[0][1],'ft^3/s',refs,
            f'Last minus first available daily observation ({valid[0][0]} to {valid[-1][0]}), not a fitted trend.','Same station, parameter, statistic and time-series'))
    try:
        days = _days(request['start'],request['end'])
        out['series'].append({'id':'usgs-discharge','label':f'{station} daily mean discharge','unit':'ft^3/s','evidenceIds':refs,
            'points':[{'date':day,'value':by_day.get(day,(None,''))[0], 'quality':by_day.get(day,(None,'missing'))[1] +
                       (' · source qualifiers: '+' | '.join(sorted(qualifiers[(key,day)])) if qualifiers.get((key,day)) else '')} for day in days]})
    except ProviderError:
        out['missing'].append('USGS series display requires at most 2000 requested days; bounded observations remain recorded but no complete period plot is published.')
    qualified=sum(bool(qualifiers.get((key,day))) for day,_ in valid)
    qualification=(f' {qualified} recorded days carry source qualifiers, including estimated readings or sensor conditions; flagged values remain source-qualified records rather than unqualified measurements.' if qualified else ' No source qualifiers were reported for these finite records; this does not establish measurement accuracy.')
    out['findings'].append(finding(f'USGS {station} reports {len(valid)} finite recorded daily mean discharge values.'+qualification+f' The last available value is {valid[-1][1]:g} ft³/s on {valid[-1][0]}; point-supported records cannot establish inundation, reservoir volume, or conditions elsewhere in the area.',refs,observed=True,applicability=['One exact in-area station, parameter 00060 and daily-mean statistic 00003.']))
    return out


def firms(request, budget):
    out = bundle(); boxes=search_boxes(request['area']); now=datetime.now(timezone.utc).date()
    start,end=date.fromisoformat(request['start']),date.fromisoformat(request['end'])
    if end<now-timedelta(days=7) or start>now:
        out['missing'].append('FIRMS rolling feeds cover the last seven days only; the requested historical/future window is not covered.')
        return out
    usa = all(-125<=b[0] and b[2]<=-66 and 24<=b[1] and b[3]<=50 for b in boxes)
    window = '24h' if start>=now-timedelta(days=1) else '7d'
    region = 'USA_contiguous_and_Hawaii' if usa else 'Global'
    t=budget.fetch(FIRMS_ROOT+f'SUOMI_VIIRS_C2_{region}_{window}.csv',max_bytes=2*1024**2)
    try:
        reader=csv.DictReader(io.StringIO(t.data.decode('utf-8-sig')))
        if not {'latitude','longitude','acq_date','acq_time','confidence','version','satellite'}<=set(reader.fieldnames or []):
            raise ProviderError('invalid_firms_columns')
        selected=[]; all_dates=[]; versions=set(); bad=0
        for n,row in enumerate(reader):
            if n>=40000: raise ProviderError('firms_row_limit')
            try:
                lon,lat=float(row['longitude']),float(row['latitude']); day=row['acq_date']; date.fromisoformat(day)
                time=row['acq_time'].zfill(4)
                stamp=datetime.fromisoformat(day+'T'+time[:2]+':'+time[2:]+':00+00:00')
                if not math.isfinite(lon) or not math.isfinite(lat) or not (-180<=lon<=180 and -90<=lat<=90): raise ValueError()
                versions.add(row['version']); all_dates.append(day)
                if request['start']<=day<=request['end'] and contains(request['area'],lon,lat) and row['confidence'] in ('nominal','high'):
                    selected.append((stamp.isoformat(),lon,lat,row['satellite'],row['confidence']))
            except (ValueError,KeyError,TypeError): bad+=1
    except UnicodeError: raise ProviderError('invalid_firms_csv') from None
    e=evidence('firms-thermal','VIIRS-C2:'+','.join(sorted(versions)) if versions else 'VIIRS-C2',f'S-NPP VIIRS thermal detections ({region}, rolling {window})',t,
        start=min(all_dates) if all_dates else None,end=max(all_dates) if all_dates else None,
        quantity='thermal anomaly detection records',unit='detections',resolution=375,
        support='Nominal 375m thermal pixels; record centres filtered to exact polygon and holes',
        notes=[f'Rolling {window} feed; downloaded table may not cover the full request.',f'{bad} malformed rows excluded.','Nominal/high confidence only; repeat overpasses are separate detections.'],
        mask='Exact AOI centre/date filter; exclude low/unknown confidence; no perimeter or damage interpretation',public=False)
    out['evidence'].append(e); refs=[e['id']]
    if selected:
        out['observations']=len(selected)
        out['metrics'].append(metric('thermal-detections','Filtered thermal anomaly records',len(selected),'detections',refs,
            'Nominal/high confidence record centres in area and requested dates from the bounded rolling feed; repeated overpasses remain records.','Selected records, not distinct fires or hectares'))
        out['findings'].append(finding(f'The downloaded VIIRS feed contains {len(selected)} nominal/high-confidence thermal detection records whose centres fall inside the selected area and requested dates. These are thermal pixels and repeat overpasses, not distinct fires, burned hectares, perimeters, or damage.',refs,observed=True,applicability=['Only retrieved rolling feed, exact point/date filter; spatial sampling completeness is unknown.']))
    else:
        out['missing'].append('No qualifying thermal detections were returned inside the selected area/window; this is not evidence of no fire or of safety.')
        out['findings'].append(finding('The bounded rolling VIIRS feed returned no qualifying thermal detection records after area, date and confidence filters. Satellite sampling, clouds and the feed window prevent a no-fire conclusion.',refs,observed=True,applicability=['Search result only; not an absence-of-fire observation.']))
    if start<now-timedelta(days=7): out['missing'].append('Part of the requested period predates the rolling FIRMS feed.')
    return out


def _asset_url(href):
    if isinstance(href,str) and href.startswith('s3://usgs-landsat/collection02/'):
        href='https://usgs-landsat.s3.us-west-2.amazonaws.com/'+href[len('s3://usgs-landsat/'):]
    return vetted_url(href)


def stac_discovery(request,budget,kind):
    out=bundle(); collection='sentinel-2-c1-l2a' if kind=='sentinel' else 'landsat-c2-l2'
    source='sentinel-2-indices' if kind=='sentinel' else 'landsat-c2-lst'
    boxes=search_boxes(request['area']); items={}
    if len(boxes)>2: out['missing'].append('STAC searches the first two disjoint component boxes only; remaining components are unsearched.')
    for box in boxes[:2]:
        for ordering in ('+properties.datetime','-properties.datetime'):
            t=budget.fetch(STAC+'/search?'+urlencode({'collections':collection,'bbox':','.join(map(str,box)),
                'datetime':request['start']+'T00:00:00Z/'+request['end']+'T23:59:59Z','limit':2,'sortby':ordering}))
            d=t.json()
            if not isinstance(d.get('features'),list) or len(d['features'])>2: raise ProviderError('invalid_stac_response')
            for item in d['features']:
                if item.get('collection')!=collection or not isinstance(item.get('id'),str): continue
                p=item.get('properties',{}); observed=p.get('datetime')
                if not isinstance(observed,str) or not request['start']<=observed[:10]<=request['end']: continue
                items[item['id']] = (item,t)
    selected=sorted(items.values(),key=lambda x:(x[0]['properties']['datetime'],x[0]['id']))
    if len(selected)>4: selected=selected[:2]+selected[-2:]
    for item,t in selected:
        p=item['properties']; version=p.get('s2:processing_baseline') if kind=='sentinel' else p.get('landsat:collection_number')
        if not version: out['missing'].append('Catalogue item lacks a verified processing/collection version.'); continue
        try:
            footprint=item.get('geometry'); validate_geometry(footprint)
        except (ValueError,TypeError,KeyError): footprint=box_geometry(item.get('bbox',[0,0,0,0]))
        e=evidence(source,collection+':'+str(version),item['id'],t,key=[item['id'],digest(item)],geometry=footprint,
            start=p['datetime'],end=p['datetime'],resolution=20 if kind=='sentinel' else 30,
            notes=['Catalogue metadata and cloud percentage are not AOI valid-pixel coverage.', f'Platform: {p.get("platform","unknown")}; grid: {p.get("grid:code","unknown")}.'],published=p.get('created'))
        e['hashes']['item']=digest(item)
        out['evidence'].append(e)
        out['findings'].append(finding(f'The catalogue identifies {item["id"]}, acquired {p["datetime"][:10]}, in {collection} processing version {version}. Its footprint intersects a search box; discovery alone does not establish usable pixels or change within the selected area.',[e['id']],observed=True,section='unknown',applicability=['Source catalogue record only, not an AOI observation.']))
        keys={'red':'red','nir':'nir','swir':'swir16','qa':'scl'} if kind=='sentinel' else {'temperature':'lwir11','qa':'qa_pixel'}
        assets={}; metadata={}
        try:
            for name,key in keys.items():
                asset=item['assets'][key]; href=_asset_url(asset['href']); band=asset.get('raster:bands',[{}])[0]
                metadata[name]=dict(band)
                assets[name]={'href':href, **{k:band[k] for k in ('scale','offset','nodata') if k in band}}
            if kind=='sentinel':
                # B8A/B11 and SCL share a native 20m grid; B04 is 10m.
                # Raster engine explicitly requires/masks the coarser common grid.
                # C1 supplies DN calibration directly; no ambiguous legacy BOA flag.
                for name in ('red','nir','swir'):
                    if not math.isclose(float(metadata[name].get('scale',0)),.0001): raise ProviderError('unsupported_reflectance_scale')
                offsets={float(metadata[name].get('offset',0)) for name in ('red','nir','swir')}
                if len(offsets)!=1 or not offsets <= {0.0,-0.1}: raise ProviderError('contradictory_reflectance_offset')
            elif (not math.isclose(float(metadata['temperature'].get('scale',0)),.00341802) or
                  float(metadata['temperature'].get('offset',0))!=149 or metadata['temperature'].get('unit')!='kelvin'):
                raise ProviderError('unsupported_temperature_scale')
            e['quality']['notes'].append('Discovered science assets: '+ '; '.join(name+'='+asset['href'] for name,asset in assets.items()))
            e['quality']['notes'].append('Calibration: '+json.dumps(metadata,sort_keys=True,separators=(',',':')))
            out['candidates'].append(dict(kind=kind,assets=assets,metadata=metadata,evidenceId=e['id'],itemId=item['id'],
                date=p['datetime'],grid=p.get('grid:code'),version=version,platform=p.get('platform')))
        except (KeyError,ValueError,TypeError) as exc:
            out['missing'].append('Discovered '+collection+' item cannot be measured: '+(exc.code if isinstance(exc,ProviderError) else 'required QA/science assets or scale metadata missing')+'.')
    if not out['evidence']: out['missing'].append('No bounded '+collection+' catalogue items were discovered within the selected dates and search boxes.')
    return out


def cmr_discovery(request,budget,*,hls=False,ascending=False):
    out=bundle(); boxes=search_boxes(request['area'])
    source='hls-ndvi-ndmi' if hls else 'opera-dswx-hls'; name='HLSL30' if hls else 'OPERA_L3_DSWX-HLS_V1'
    for box in boxes[:2]:
        params={'short_name':name,'page_size':2,'bounding_box':','.join(map(str,box)),
                'temporal':request['start']+'T00:00:00Z,'+request['end']+'T23:59:59Z','sort_key':'start_date' if ascending else '-start_date'}
        if hls: params['version']='2.0'
        t=budget.fetch('https://cmr.earthdata.nasa.gov/search/granules.json?'+urlencode(params))
        entries=t.json().get('feed',{}).get('entry',[])
        if len(entries)>2: raise ProviderError('cmr_record_limit')
        for item in entries:
            ident=item.get('id'); product=item.get('producer_granule_id'); raw_start=item.get('time_start'); raw_end=item.get('time_end')
            if not ident or not product: continue
            start_instant=_cmr_instant(raw_start);end_instant=_cmr_instant(raw_end)
            start=start_instant.isoformat().replace('+00:00','Z') if start_instant else None
            end=end_instant.isoformat().replace('+00:00','Z') if end_instant and (start_instant is None or end_instant>=start_instant) else None
            if start and not request['start']<=start[:10]<=request['end']: continue
            processing = None if hls or not isinstance(product,str) else _DSWX_PRODUCT.fullmatch(product)
            version='2.0' if hls else processing['version'] if processing else 'processing-unverified'
            if hls and not re.search(r'v2\.0(?:\D|$)',product+' '+item.get('title','')+' '+item.get('dataset_id',''),re.I):
                out['missing'].append('CMR HLS record lacks verified version-2 metadata; excluded.'); continue
            footprint=None
            if item.get('boxes'):
                try:
                    south,west,north,east=map(float,item['boxes'][0].split()); footprint=box_geometry([west,south,east,north])
                except (ValueError,TypeError): pass
            e=evidence(source,name+':'+version,ident+': '+product,t,key=[ident,product],geometry=footprint,start=start,end=end,
                resolution=30,notes=['Actual CMR granule discovery; protected assets require Earthdata and are not silently downloaded.'],published=item.get('updated'))
            e['hashes']['granuleMetadata']=digest(item)
            out['evidence'].append(e)
            timing='with source-reported observation date '+start[:10] if start else 'with unverified source timing'
            out['findings'].append(finding(f'NASA CMR identifies {ident}, product {product}, {timing}. This establishes catalogue metadata in a search footprint; it does not measure the selected area or establish a water or vegetation change.',[e['id']],observed=True,section='unknown',applicability=['Discovery only; use source granule ID to reproduce the query.']))
            timing_note=None
            if start_instant is None or (raw_end is not None and (end_instant is None or end_instant<start_instant)):
                timing_note='CMR source timing is invalid, unknown-offset or contradictory; catalogue metadata retained and pixel measurements withheld.'
            elif not hls and processing:
                try:
                    filename_acquisition=datetime.strptime(processing['acquisition'],'%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
                    filename_processing=datetime.strptime(processing['processing'],'%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
                    if filename_processing<filename_acquisition or filename_acquisition.date()!=start_instant.date():
                        timing_note='Producer acquisition day and CMR centre-sensing day are not admitted as the same UTC day by the conservative timing policy; catalogue metadata retained and pixel measurements withheld. These time bases may legitimately differ across midnight; no source error or corrected acquisition instant is inferred.'
                except ValueError:
                    timing_note='Producer filename timing is not representable; catalogue metadata retained and pixel measurements withheld.'
            if timing_note:
                e['quality']['notes'].append(timing_note);out['missing'].append(timing_note);continue
            if not hls:
                e['quality']['notes'].append('DSWx filename time describes the input HLS acquisition tag; CMR time describes reported centre sensing. Exact instants are not asserted equal. This adapter admits pixel comparisons only when both UTC calendar days match.')
            if not hls and (processing is None or version not in ('1.0','1.1')):
                note = ('The OPERA producer identity/processing-version grammar is unverified; pixel measurements withheld.' if processing is None else
                        f'OPERA processing version {version} is retained as catalogue evidence but its B01_WTR class semantics are not admitted by this adapter; pixel measurements withheld. Collection major V1 is distinct from the producer processing version.')
                e['quality']['notes'].append(note); out['missing'].append(note)
                continue
            science_assets={};ambiguous_assets=set()
            for link in item.get('links',[]):
                href=link.get('href','')
                key=next((k for suffix,k in ({'.B04.tif':'red','.B05.tif':'nir','.B06.tif':'swir','.Fmask.tif':'qa'} if hls else {'_B01_WTR.tif':'water'}).items() if href.endswith(suffix)),None)
                if key and href.startswith('https://'):
                    try:
                        from .raster import validate_asset
                        validate_asset(href)
                        suffix=next(s for s,k in ({'.B04.tif':'red','.B05.tif':'nir','.B06.tif':'swir','.Fmask.tif':'qa'} if hls else {'_B01_WTR.tif':'water'}).items() if k==key)
                        if urlsplit(href).path.rsplit('/',1)[-1] != product+suffix:
                            out['missing'].append('Required source COG filename does not match its producer granule ID; catalogue evidence retained and pixel measurements withheld.')
                            continue
                        if key in ambiguous_assets:continue
                        if key in science_assets and science_assets[key]['href']!=href:
                            ambiguous_assets.add(key);science_assets.pop(key)
                            out['missing'].append('Required source COG has ambiguous duplicate assets; catalogue evidence retained and pixel measurements withheld.')
                            continue
                        science_assets[key]=dict(href=href,**(dict(scale=.0001,offset=0,nodata=-9999) if hls and key!='qa' else dict(nodata=255) if key=='qa' else dict(expectedProcessingVersion='1.1') if not hls and version=='1.1' else {}))
                    except (ValueError,TypeError,RangeError):out['missing'].append('Required source COG has an unvetted download host or ambiguous duplicate asset; it is not read.')
            tile=re.search(r'(?:_|\.)T(\d{2}[A-Z]{3})(?:_|\.)',product)
            required={'red','nir','swir','qa'} if hls else {'water'}
            if set(science_assets)==required and tile:
                if not hls and version=='1.1':
                    e['quality']['notes'].append('Processing 1.1 is a conditional pixel-read candidate only. Before reading pixels, the original B01 must declare the supported PROTEUS 1.0.2 product schema, collapsed WTR palette and projected 30 m grid; selected values must match its known domain. Unsupported variants remain withheld. No field accuracy or general processing-1.1 compatibility is inferred.')
                e['quality']['notes'].append('Source COGs use range-only reads and the configured Earthdata connection; access failure never triggers full-granule download.')
                out['candidates'].append(dict(kind='hls' if hls else 'dswx',assets=science_assets,metadata={},evidenceId=e['id'],itemId=ident,date=start,grid=tile.group(1),version=version,platform='HLS-L30' if hls else 'OPERA-DSWx-HLS'))
            else:out['missing'].append('Required calibrated science/quality COGs or tile identity are missing; catalogue entry remains discovery only.')
    if not out['evidence']: out['missing'].append('No bounded '+name+' CMR granules were discovered for the selected dates/boxes.')
    return out


def nifc_perimeters(request,budget):
    out=bundle(); boxes=search_boxes(request['area'])
    # Source-level query only; unlike FIRMS, these are documented vector perimeters.
    for box in boxes[:2]:
        params={'f':'geojson','where':'1=1','geometry':','.join(map(str,box)),'geometryType':'esriGeometryEnvelope','inSR':4326,
                'spatialRel':'esriSpatialRelIntersects','outSR':4326,'outFields':'OBJECTID,poly_IncidentName,poly_DateCurrent,poly_GISAcres',
                'returnGeometry':'true','resultRecordCount':20}
        t=budget.fetch(NIFC+'/query?'+urlencode(params),max_bytes=1024**2); d=t.json()
        if d.get('error'): raise ProviderError('perimeter_query_unavailable')
        features=d.get('features',[])
        if d.get('exceededTransferLimit') or len(features)==20: out['missing'].append('NIFC perimeter discovery may be truncated at 20 records; no complete inventory claim.')
        if not isinstance(features,list) or len(features)>20: raise ProviderError('perimeter_record_limit')
        for f in features:
            p=f.get('properties',{}); stamp=p.get('poly_DateCurrent')
            try:
                observed=datetime.fromtimestamp(float(stamp)/1000,timezone.utc).isoformat()
            except (TypeError,ValueError,OverflowError): continue
            if not request['start']<=observed[:10]<=request['end']: continue
            try: validate_geometry(f.get('geometry'))
            except (ValueError,TypeError,KeyError,RangeError):
                out['missing'].append('A documented perimeter exceeds bounded geometry/topology limits; it was not simplified or assigned to the AOI.'); continue
            ident=str(p.get('OBJECTID','unknown'))
            e=evidence('nifc-perimeters','WFIGS-current',f'Documented NIFC perimeter record {ident}',t,key=[ident,observed],geometry=f['geometry'],start=observed,end=observed,
                quantity='documented perimeter record',support='Agency perimeter intersecting a search envelope; exact AOI intersection is not computed',
                notes=['DateCurrent is the perimeter record update time, not ignition or complete event duration.'],mask='Source polygon retained; no fire damage inference',public=False)
            out['evidence'].append(e)
            out['findings'].append(finding(f'NIFC returns documented perimeter record {ident}, updated {observed[:10]}, intersecting the discovery envelope. It is separate from thermal detections; no damage, area inside the selected polygon, or event onset is inferred.',[e['id']],observed=True,section='meaning',applicability=['Search-envelope overlap only, not exact AOI exposure.']))
    out['missing'].append('NIFC current records are not a complete historical perimeter archive; exact AOI exposure/damage requires additional validated overlay evidence.')
    return out


def nws_context(request,budget):
    out=bundle(); boxes=search_boxes(request['area'])
    box=boxes[0]; lon=(box[0]+box[2])/2; lat=(box[1]+box[3])/2
    if not (-125<=lon<=-66 and 24<=lat<=50):
        out['missing'].append('NWS context adapter is limited to the contiguous United States.'); return out
    t=budget.fetch(f'https://api.weather.gov/points/{lat:.4f},{lon:.4f}'); p=t.json().get('properties',{})
    forecast=p.get('forecast')
    if not forecast or urlsplit(forecast).hostname!='api.weather.gov': raise ProviderError('invalid_nws_forecast_link')
    t=budget.fetch(forecast); d=t.json().get('properties',{}); periods=d.get('periods',[])[:14]
    if not periods: out['missing'].append('NWS returned no forecast periods.'); return out
    e=evidence('nws-weather-context','NWS-API-v1', 'Published NWS weather context',t,start=periods[0].get('startTime'),end=periods[-1].get('endTime'),
        quantity='published official weather forecast context',support='NWS forecast grid containing the selected envelope centre; not AOI forecast validation',
        notes=['Official context only; no numeric private causal forecast or danger advice.','Weather forecast validity is separate from assessment observation dates.'],mask='Published provider context, no local prediction model',published=d.get('updated'))
    e['timestamps']['validThrough']=periods[-1].get('endTime')
    out['evidence'].append(e)
    out['findings'].append(finding(f'NWS publishes weather context updated {d.get("updated","at an unspecified time")} for the grid at the search-envelope centre, valid through {periods[-1].get("endTime","an unspecified time")}. This external forecast is current context, not validation of a private area forecast or a causal explanation of observed change.',[e['id']],observed=True,section='future',applicability=['Published forecast metadata only; consult the official source for operational guidance.']))
    alert=budget.fetch('https://api.weather.gov/alerts/active?'+urlencode({'point':f'{lat:.4f},{lon:.4f}'}))
    a=alert.json()
    if not isinstance(a.get('features'),list): raise ProviderError('invalid_nws_alerts')
    ae=evidence('nws-weather-context','NWS-API-v1','Published NWS active-alert query',alert,quantity='active alert query',support='Point query at discovery envelope centre',
        notes=['No-alert response does not establish safety; alerts are current, not historical.'],mask='Published alert query; no risk advice')
    out['evidence'].append(ae)
    out['findings'].append(finding(f'The current NWS point query returns {len(a["features"])} active alert records at retrieval. This count is official context at one point, not evidence of area-wide safety or a historical hazard record.',[ae['id']],observed=True,section='future',applicability=['Current point query only.']))
    return out
