"""Bounded observatory contracts at admission and atomic publication boundaries.

No client evidence is accepted. Geometry uses short longitude arcs and validates
in an unwrapped plane, including holes and disjoint polygon components.
"""
import json
import math
import re
from datetime import date, datetime
from urllib.parse import urlsplit, parse_qsl
import ipaddress

ARTIFACTS = frozenset({'manifest.json', 'brief.json', 'metrics.csv', 'area.geojson', 'evidence.json'})
RASTER_ARTIFACTS = frozenset(f'{quantity}-{layer}.{ext}' for quantity in ('ndvi','ndmi','temperature','water') for layer in ('before','after','difference','excluded') for ext in ('tif','png')) | frozenset({'water-transition.tif', 'water-transition.png'})
VINTAGE_ARTIFACTS = frozenset({'gauge-vintage-snapshot.json'})
DOMAINS = {'water', 'fire', 'ecology', 'urban'}
QUESTIONS = {'change', 'seasonal', 'explain', 'exposure', 'future', 'options'}
CLAIM_TYPES = {'Observed', 'Derived', 'Possible explanation', 'Forecast', 'Scenario', 'Human annotation'}


def require(ok):
    if not ok:
        raise ValueError('Invalid observatory contract')


def keys(value, required, optional=()):
    require(isinstance(value, dict) and set(required) <= set(value) <= set(required) | set(optional))


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def string(value, maximum=4096, empty=False):
    require(isinstance(value, str) and (empty or bool(value)) and len(value) <= maximum and
            all(ord(c) >= 32 or c in '\n\t' for c in value))


def identifier(value):
    string(value, 128)
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]*', value) is not None)


def strings(value, maximum=64):
    require(isinstance(value, list) and len(value) <= maximum)
    for item in value:
        string(item)


def day(value):
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', value) is not None)
    return date.fromisoformat(value)


def timestamp(value, nullable=False):
    if nullable and value is None:
        return
    string(value, 64)
    if nullable and re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        day(value)
        return
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(parsed.tzinfo is not None)


def cross(a, b, c):
    return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])


def on_segment(a, b, p):
    return abs(cross(a, b, p)) <= 1e-10 and min(a[0], b[0])-1e-10 <= p[0] <= max(a[0], b[0])+1e-10 and min(a[1], b[1])-1e-10 <= p[1] <= max(a[1], b[1])+1e-10


def intersects(a, b, c, d):
    x, y, z, w = cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)
    return ((x > 0 > y or y > 0 > x) and (z > 0 > w or w > 0 > z)) or any((on_segment(a, b, c), on_segment(a, b, d), on_segment(c, d, a), on_segment(c, d, b)))


def inside(point, ring):
    result = False
    for a, b in zip(ring, ring[1:]):
        if on_segment(a, b, point):
            return False  # touching shells/holes is rejected
        if (a[1] > point[1]) != (b[1] > point[1]) and point[0] < (b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0]:
            result = not result
    return result


def rings_intersect(a, b):
    return any(intersects(p, q, r, s) for p, q in zip(a, a[1:]) for r, s in zip(b, b[1:]))


def shift_ring(ring, anchor):
    shift = 360 * round((anchor - ring[0][0])/360)
    return [(x+shift, y) for x, y in ring]


def validate_geometry(area):
    keys(area, {'type', 'coordinates'})
    require(area['type'] in ('Polygon', 'MultiPolygon'))
    polygons = [area['coordinates']] if area['type'] == 'Polygon' else area['coordinates']
    require(isinstance(polygons, list) and 1 <= len(polygons) <= 16)
    count, unwrapped = 0, []
    for polygon in polygons:
        require(isinstance(polygon, list) and 1 <= len(polygon) <= 16)
        rings = []
        for ring in polygon:
            require(isinstance(ring, list) and 4 <= len(ring) <= 512 and ring[0] == ring[-1])
            count += len(ring)
            require(count <= 512)
            points = []
            for position in ring:
                require(isinstance(position, list) and len(position) == 2 and all(number(x) for x in position))
                x, y = position
                require(-180 <= x <= 180 and -85 <= y <= 85)
                if points:
                    x += 360 * round((points[-1][0]-x)/360)
                    require(abs(x-points[-1][0]) < 180 and (x, y) != points[-1])
                points.append((x, y))
            require(points[0] == points[-1] and max(x for x, _ in points)-min(x for x, _ in points) < 360)
            require(abs(sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(points, points[1:]))) > 1e-10)
            n = len(points)-1
            for i in range(n):
                # Adjacent edges may share one endpoint, but may not backtrack.
                a, b, c = points[i-1 if i else n-1], points[i], points[i+1]
                require(not (abs(cross(a, b, c)) <= 1e-10 and on_segment(a, b, c)))
                for j in range(i+1, n):
                    if j == i+1 or (i == 0 and j == n-1):
                        continue
                    require(not intersects(points[i], points[i+1], points[j], points[j+1]))
            if rings:
                points = shift_ring(points, rings[0][0][0])
                require(inside(points[0], rings[0]) and not rings_intersect(points, rings[0]))
                for other in rings[1:]:
                    require(not rings_intersect(points, other) and not inside(points[0], other) and not inside(other[0], points))
            rings.append(points)
        for other in unwrapped:
            aligned = [shift_ring(r, other[0][0][0]) for r in rings]
            require(not any(rings_intersect(a, b) for a in aligned for b in other))
            def in_polygon(p, poly):
                return inside(p, poly[0]) and not any(inside(p, h) for h in poly[1:])
            require(not in_polygon(aligned[0][0], other) and not in_polygon(other[0][0], aligned))
        unwrapped.append(rings)
    return area


def bounded_json(value, limit=16384):
    require(len(json.dumps(value, allow_nan=False, separators=(',', ':')).encode()) <= limit)


def validate_assessment_request(request):
    keys(request, {'schemaVersion', 'domain', 'question', 'area', 'start', 'end'}, {'options'})
    require(request['schemaVersion'] == '1.0' and request['domain'] in DOMAINS and request['question'] in QUESTIONS)
    validate_geometry(request['area'])
    require(day(request['start']) <= day(request['end']))
    if 'options' in request:
        options = request['options']
        keys(options, set(), {'sourceIds', 'gaugeId', 'referenceStart', 'referenceEnd'})
        if 'sourceIds' in options:
            require(isinstance(options['sourceIds'], list) and len(options['sourceIds']) <= 16)
            for source in options['sourceIds']:
                identifier(source)
            require(len(set(options['sourceIds'])) == len(options['sourceIds']))
        if 'gaugeId' in options:
            require(isinstance(options['gaugeId'], str) and re.fullmatch(r'[A-Za-z0-9_-]{1,64}', options['gaugeId']) is not None)
        require(('referenceStart' in options) == ('referenceEnd' in options))
        if 'referenceStart' in options:
            require(day(options['referenceStart']) <= day(options['referenceEnd']))
    bounded_json(request)
    return request


def validate_scenario_request(request):
    keys(request, {'schemaVersion', 'assessmentId', 'kind', 'inputs', 'assumptions', 'objectives'})
    require(request['schemaVersion'] == '1.0' and request['kind'] in ('threshold', 'footprint', 'options'))
    require(isinstance(request['assessmentId'], str) and re.fullmatch(r'[a-f0-9]{32}', request['assessmentId']) is not None)
    strings(request['assumptions'], 12); strings(request['objectives'], 8)
    require(bool(request['objectives']) and all(len(s) <= 500 for s in request['assumptions']) and all(len(s) <= 250 for s in request['objectives']))
    inputs = request['inputs']
    keys(inputs, set(), {'metricId', 'threshold', 'operator', 'footprints', 'weights', 'thresholdRange'})
    if request['kind'] == 'threshold':
        require({'metricId', 'threshold', 'operator'} <= set(inputs))
    if request['kind'] in ('footprint', 'options'):
        require('footprints' in inputs)
    if 'metricId' in inputs:
        identifier(inputs['metricId'])
    if 'threshold' in inputs:
        require(number(inputs['threshold']))
    if 'thresholdRange' in inputs:
        require(request['kind']=='threshold')
        bounds=inputs['thresholdRange'];keys(bounds,{'minimum','maximum'})
        require(all(number(v) for v in bounds.values()) and bounds['minimum']<bounds['maximum'])
        from .observatory.scenarios import threshold_grid
        grid=threshold_grid(bounds)
        require(all(number(v) for v in grid) and all(a<b for a,b in zip(grid,grid[1:])))
    if 'operator' in inputs:
        require(inputs['operator'] in ('above', 'below'))
    if 'footprints' in inputs:
        footprints = inputs['footprints']
        require(isinstance(footprints, list) and 1 <= len(footprints) <= 8)
        ids = []
        positions = 0
        for item in footprints:
            keys(item, {'id', 'name', 'geometry'}, {'cost', 'benefit'})
            identifier(item['id']); string(item['id'], 64); string(item['name'], 100); ids.append(item['id'])
            validate_geometry(item['geometry'])
            polygons = [item['geometry']['coordinates']] if item['geometry']['type'] == 'Polygon' else item['geometry']['coordinates']
            positions += sum(len(r) for p in polygons for r in p)
            for key in ('cost', 'benefit'):
                if key in item:
                    require(number(item[key]) and (key != 'cost' or item[key] >= 0))
        require(positions <= 512 and len(set(ids)) == len(ids))
    if 'weights' in inputs:
        keys(inputs['weights'], {'cost', 'benefit'})
        require(all(number(v) and v >= 0 for v in inputs['weights'].values()) and sum(inputs['weights'].values()) > 0)
    bounded_json(request)
    return request


def unique(items):
    require(isinstance(items, list) and len(items) <= 256)
    ids = []
    for item in items:
        require(isinstance(item, dict))
        identifier(item.get('id')); ids.append(item['id'])
    require(len(ids) == len(set(ids)))
    return set(ids)


def references(value, valid):
    strings(value)
    require(len(set(value)) == len(value) and set(value) <= valid)


def validate_claims(claims, evidence_ids, scenario=False):
    ids = unique(claims)
    for claim in claims:
        keys(claim, {'id', 'type', 'text', 'evidenceIds', 'methodVersion', 'assumptions', 'uncertainty', 'applicability', 'counterevidence'})
        require(claim['type'] in CLAIM_TYPES)
        # Forecasts need a validation record; hypotheses have explicit evidence and limits.
        require(claim['type'] != 'Forecast')
        if claim['type'] == 'Possible explanation':
            require(bool(claim['evidenceIds']) and bool(claim['uncertainty']) and bool(claim['applicability']))
        if scenario:
            require(claim['type'] == 'Scenario')
        string(claim['text']); string(claim['methodVersion'], 200)
        references(claim['evidenceIds'], evidence_ids)
        if claim['type'] in ('Observed', 'Derived'):
            require(bool(claim['evidenceIds']))
        for key in ('assumptions', 'uncertainty', 'applicability', 'counterevidence'):
            strings(claim[key])
    return ids


def validate_metrics(metrics, evidence_ids, scenario=False):
    unique(metrics)
    for metric in metrics:
        keys(metric, {'id', 'label', 'value', 'unit', 'evidenceIds', 'description', 'denominator'})
        for key in ('label', 'unit', 'description'):
            string(metric[key])
        require(metric['value'] is None or number(metric['value']))
        require(metric['denominator'] is None or isinstance(metric['denominator'], str))
        references(metric['evidenceIds'], evidence_ids)
        require(scenario or metric['value'] is None or bool(metric['evidenceIds']))


def validate_brief(brief, claim_ids):
    keys(brief, {'title', 'sections'})
    string(brief['title'])
    require(isinstance(brief['sections'], list) and len(brief['sections']) <= 5)
    ids = []
    for section in brief['sections']:
        keys(section, {'id', 'title', 'claimIds'})
        require(section['id'] in ('changed', 'meaning', 'future', 'options', 'unknown'))
        ids.append(section['id']); string(section['title'])
        references(section['claimIds'], claim_ids)
    require(len(ids) == len(set(ids)))


def validate_assessment_manifest(manifest, request, *, allow_archived=False, referenced_snapshot=None):
    validate_assessment_request(request)
    keys(manifest, {'schemaVersion', 'kind', 'domain', 'question', 'area', 'time', 'processedAt', 'methodVersion', 'title', 'outcome', 'evidence', 'claims', 'metrics', 'quality', 'brief', 'artifacts'}, {'series','rasters','forecastEvaluation','gaugeVintage','forecastInformation'})
    require(manifest['schemaVersion'] == '1.0' and manifest['kind'] == 'assessment' and manifest['domain'] == request['domain'] and manifest['question'] == request['question'] and manifest['area'] == request['area'])
    require(manifest['time'] == {'start': request['start'], 'end': request['end']})
    timestamp(manifest['processedAt']); string(manifest['methodVersion'], 200); string(manifest['title'])
    require(manifest['outcome'] in ('complete', 'partial', 'unavailable'))
    require(isinstance(manifest['artifacts'],list) and len(manifest['artifacts'])==len(set(manifest['artifacts'])) and ARTIFACTS<=set(manifest['artifacts'])<=ARTIFACTS|RASTER_ARTIFACTS|VINTAGE_ARTIFACTS)
    evidence_ids = unique(manifest['evidence'])
    for record in manifest['evidence']:
        keys(record, {'id', 'sourceId', 'sourceVersion', 'title', 'url', 'geometry', 'spatialSupport', 'timestamps', 'quantity', 'unit', 'quality', 'maskPolicy', 'methodVersion', 'hashes', 'public'})
        for key in ('sourceId', 'sourceVersion', 'title', 'quantity', 'unit', 'maskPolicy', 'methodVersion'):
            string(record[key])
        identifier(record['sourceId'])
        string(record['url'], 2048)
        url = urlsplit(record['url'])
        require(url.scheme == 'https' and bool(url.hostname) and not url.username and not url.password and not url.fragment and url.port in (None, 443))
        require(url.hostname not in ('localhost', 'localhost.localdomain') and not url.hostname.endswith(('.localhost', '.local')))
        try:
            address = ipaddress.ip_address(url.hostname)
        except ValueError:
            address = None
        require(address is None or address.is_global)
        require(not re.search(r'/api/(?:assessments|scenarios|change-jobs|assessment-snapshots)(?:/|$)', url.path, re.I))
        require(not any(re.search(r'(?:token|secret|password|signature|credential|api.?key|authorization)', key, re.I) for key, _ in parse_qsl(url.query)))
        require(isinstance(record['public'], bool))
        if record['geometry'] is not None:
            validate_geometry(record['geometry'])
        support = record['spatialSupport']; keys(support, {'resolution', 'unit', 'description'})
        require(support['resolution'] is None or (number(support['resolution']) and support['resolution'] > 0))
        string(support['unit']); string(support['description'])
        times = record['timestamps']; keys(times, {'observedStart', 'observedEnd', 'publishedAt', 'retrievedAt', 'validThrough'})
        for key, value in times.items():
            timestamp(value, key != 'retrievedAt')
        if times['observedStart'] and times['observedEnd']:
            require(day(times['observedStart'][:10]) <= day(times['observedEnd'][:10]))
        quality = record['quality']; keys(quality, {'commonCoveragePercent', 'notes'})
        coverage = quality['commonCoveragePercent']
        require(coverage is None or (number(coverage) and 0 <= coverage <= 100)); strings(quality['notes'])
        require(isinstance(record['hashes'], dict) and len(record['hashes']) <= 32)
        for key, value in record['hashes'].items():
            identifier(key); require(isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None)
    expected_files=set(ARTIFACTS)
    rasters=manifest.get('rasters',[])
    require(isinstance(rasters,list) and len(rasters)<=2)
    unique(rasters)
    for view in rasters:
        keys(view,{'id','quantity','unit','bounds','grid','before','after','commonCoveragePercent','validPixels','totalPixels','scale','files','hashes','notes'}, {'transitionAccounting'})
        require(view['id'] in ('ndvi','ndmi','temperature','water'));string(view['quantity']);string(view['unit']);strings(view['notes'])
        require(isinstance(view['bounds'],list) and len(view['bounds'])==2 and all(isinstance(p,list) and len(p)==2 and all(number(v) for v in p) for p in view['bounds']))
        require(-85<=view['bounds'][0][0]<view['bounds'][1][0]<=85 and -180<=view['bounds'][0][1]<view['bounds'][1][1]<=180)
        grid=view['grid'];keys(grid,{'crs','resolution','transform','width','height','aggregation','aoiPolicy'})
        string(grid['crs'],10000);string(grid['aoiPolicy']);require(number(grid['resolution']) and grid['resolution']>0)
        require(all(isinstance(grid[k],int) and not isinstance(grid[k],bool) and grid[k]>0 for k in ('width','height')) and grid['width']*grid['height']<=1000000)
        require(isinstance(grid['transform'],list) and len(grid['transform'])==6 and all(number(v) for v in grid['transform']))
        require(isinstance(grid['aggregation'],dict) and all(isinstance(v,int) and not isinstance(v,bool) and 1<=v<=6 for v in grid['aggregation'].values()))
        require(all(isinstance(view[k],int) and not isinstance(view[k],bool) for k in ('validPixels','totalPixels')) and 0<view['validPixels']<=view['totalPixels']<=grid['width']*grid['height'])
        require(number(view['commonCoveragePercent']) and abs(view['commonCoveragePercent']-100*view['validPixels']/view['totalPixels'])<1e-8)
        for key in ('before','after'):
            record=view[key];keys(record,{'date','evidenceId','coveragePercent'});timestamp(record['date']);require(record['evidenceId'] in evidence_ids and request['start']<=record['date'][:10]<=request['end'])
            require(number(record['coveragePercent']) and view['commonCoveragePercent']<=record['coveragePercent']<=100)
        require(view['before']['date']<view['after']['date'])
        keys(view['scale'],{'minimum','maximum','differenceLimit'});require(all(number(v) for v in view['scale'].values()) and view['scale']['minimum']<view['scale']['maximum'] and view['scale']['differenceLimit']>0)
        accounting = view.get('transitionAccounting')
        has_accounting = 'transitionAccounting' in view
        require(isinstance(view['files'], dict))
        require(has_accounting == ('transition' in view['files']))
        if has_accounting:
            from .observatory.water_transitions import validate_report
            require(view['id'] == 'water')
            validate_report(accounting, grid)
            require(accounting['totalPixels'] == view['totalPixels'] and accounting['validPixels'] == view['validPixels'])
        keys(view['files'],{'before','after','difference','excluded'}, {'transition'} if has_accounting else ());files=set()
        for layer,rendered in view['files'].items():
            keys(rendered,{'raster','preview'});require(rendered=={'raster':f'{view["id"]}-{layer}.tif','preview':f'{view["id"]}-{layer}.png'});files.update(rendered.values())
        require(set(view['hashes'])==files and all(isinstance(h,str) and re.fullmatch('[a-f0-9]{64}',h) for h in view['hashes'].values()))
        expected_files.update(files)
    if manifest.get('gaugeVintage',{}).get('status')=='referenced':
        expected_files.update(VINTAGE_ARTIFACTS)
    require(set(manifest['artifacts'])==expected_files)
    claim_ids = validate_claims(manifest['claims'], evidence_ids)
    by_id = {e['id']: e for e in manifest['evidence']}
    for claim in manifest['claims']:
        if claim['type'] in ('Observed', 'Derived'):
            # v1 accepts local findings only when limited support is explicit.
            low = any(by_id[e]['quality']['commonCoveragePercent'] is not None and by_id[e]['quality']['commonCoveragePercent'] < 80 for e in claim['evidenceIds'])
            require(not low or bool(claim['applicability']))
    validate_metrics(manifest['metrics'], evidence_ids)
    if 'series' in manifest:
        require(isinstance(manifest['series'], list) and len(manifest['series']) <= 8)
        unique(manifest['series'])
        for series in manifest['series']:
            keys(series, {'id', 'label', 'unit', 'evidenceIds', 'points'}, {'analysis','seasonalTrend','seasonalSampling'})
            string(series['label']); string(series['unit']); references(series['evidenceIds'], evidence_ids)
            require(bool(series['evidenceIds']))
            support = [by_id[e] for e in series['evidenceIds']]
            require(all(e['unit'] == series['unit'] for e in support))
            if series['id'] == 'usgs-discharge':
                require(len(support) == 1 and support[0]['sourceId'] == 'usgs-daily' and
                        support[0]['quantity'] == 'daily mean discharge' and series['unit'] == 'ft^3/s')
            require(isinstance(series['points'], list) and len(series['points']) <= 2000)
            days = []
            for point in series['points']:
                keys(point, {'date', 'value', 'quality'})
                days.append(day(point['date'])); string(point['quality'])
                require(point['value'] is None or number(point['value']))
                require(request['start'] <= point['date'] <= request['end'])
                if point['value'] is not None:
                    require(any(e['timestamps']['observedStart'] and e['timestamps']['observedEnd'] and
                                e['timestamps']['observedStart'][:10] <= point['date'] <= e['timestamps']['observedEnd'][:10]
                                for e in support))
            require(days == sorted(set(days)))
            if 'analysis' in series:
                from .observatory.history import analyze_series
                require(series['analysis']==analyze_series({k:v for k,v in series.items() if k not in ('analysis','seasonalTrend','seasonalSampling')}))
            if 'seasonalSampling' in series:
                from .observatory.sampling import seasonal_sampling
                require(series['seasonalSampling']==seasonal_sampling(series))
            if 'seasonalTrend' in series:
                from .observatory.seasonal_trend import seasonal_trend, trend_metric, trend_finding
                require(series['id']=='usgs-discharge')
                require(series['seasonalTrend']==seasonal_trend(series))
                trend=series['seasonalTrend']
                metrics=[m for m in manifest['metrics'] if m['id']=='gauge-seasonal-sen-slope']
                claims=[c for c in manifest['claims'] if c['methodVersion']==trend['methodVersion']]
                if trend['status']=='descriptive':
                    require(metrics==[trend_metric(series,trend)] and len(claims)==1)
                    expected=trend_finding(series,trend)
                    require(all(claims[0][k]==expected[k] for k in ('text','type','evidenceIds','methodVersion','assumptions','uncertainty','applicability')))
                else:
                    require(not metrics and not claims)
    if any(m['id']=='gauge-seasonal-sen-slope' for m in manifest['metrics']):
        require(any(s.get('seasonalTrend',{}).get('status')=='descriptive' for s in manifest.get('series',[])))
    if 'gaugeVintage' in manifest:
        require(request['domain']=='water')
        require(type(manifest['gaugeVintage']) is dict and type(manifest['gaugeVintage'].get('status')) is str)
        if manifest['gaugeVintage']['status']=='referenced':
            require(manifest['methodVersion']=='observatory-1.6.0')
            from .observatory.vintage_reference import validate_reference
            require(allow_archived or referenced_snapshot is not None)
            validate_reference(manifest['gaugeVintage'],request,manifest['processedAt'],snapshot=referenced_snapshot)
        else:
            from .observatory.vintage_contract import validate_gauge_vintage
            validate_gauge_vintage(manifest['gaugeVintage'],request,manifest['processedAt'])
    vintage=manifest.get('gaugeVintage')
    captured=vintage is not None and vintage['status'] in ('captured','referenced')
    referenced=vintage is not None and vintage['status']=='referenced'
    require(('gauge-vintage-snapshot.json' in manifest['artifacts']) == referenced)
    if 'forecastInformation' in manifest:
        require(captured and manifest['methodVersion'] in ('observatory-1.5.0','observatory-1.6.0'))
        from .observatory.forecast_information import forecast_information
        from .observatory.vintages import canonical_json
        bounded_json(manifest['forecastInformation'],16*1024)
        snapshot=referenced_snapshot if referenced else vintage['snapshot']
        if snapshot is not None:
            expected=forecast_information(snapshot,expected_snapshot_hash=snapshot['snapshotHash'],issue_time=snapshot['issueTime'])['report']
            # JSON types matter: Python equality alone considers True equal to 1.
            require(canonical_json(manifest['forecastInformation'])==canonical_json(expected))
        else:
            # Only the verified archive path may retain metadata after full bytes
            # expire. This is a bounded reference, not a full snapshot replay.
            require(allow_archived and referenced)
            from .observatory.forecast_information import validate_information_summary
            validate_information_summary(manifest['forecastInformation'],vintage['snapshotRef'])
    elif captured and manifest['methodVersion'] in ('observatory-1.5.0','observatory-1.6.0'):
        require(False)
    if 'forecastEvaluation' in manifest:
        validate_forecast_evaluation(manifest['forecastEvaluation'],manifest,allow_archived=allow_archived)
    require(isinstance(manifest['quality'], list) and len(manifest['quality']) <= 7)
    dimensions = []
    for quality in manifest['quality']:
        keys(quality, {'dimension', 'status', 'message'})
        require(quality['dimension'] in ('coverage', 'measurement', 'attribution', 'prediction', 'transfer', 'delivery', 'freshness') and quality['status'] in ('supported', 'limited', 'withheld', 'unknown'))
        dimensions.append(quality['dimension']); string(quality['message'])
    require(len(dimensions) == len(set(dimensions)))
    validate_brief(manifest['brief'], claim_ids)
    bounded_json(manifest, 256*1024)
    return manifest


def validate_scenario_manifest(manifest, request, parent):
    validate_scenario_request(request)
    keys(manifest, {'schemaVersion', 'kind', 'assessmentId', 'scenarioKind', 'methodVersion', 'changedInputs', 'assumptions', 'objectives', 'outputs', 'sensitivities', 'alternatives', 'claims', 'limitations', 'artifacts'}, {'weightSweep','thresholdSweep'})
    require(manifest['schemaVersion'] == '1.0' and manifest['kind'] == 'scenario' and manifest['assessmentId'] == request['assessmentId'] and manifest['scenarioKind'] == request['kind'])
    require(manifest['changedInputs'] == request['inputs'] and manifest['objectives'] == request['objectives'])
    string(manifest['methodVersion']); strings(manifest['assumptions']); strings(manifest['objectives'])
    require(set(request['assumptions']) <= set(manifest['assumptions']))
    strings(manifest['sensitivities']); strings(manifest['limitations'])
    require(isinstance(manifest['artifacts'], list) and len(manifest['artifacts']) == len(ARTIFACTS) and set(manifest['artifacts']) == ARTIFACTS)
    evidence_ids = {e['id'] for e in parent['evidence']}
    validate_metrics(manifest['outputs'], evidence_ids, scenario=True)
    validate_claims(manifest['claims'], evidence_ids, scenario=True)
    if request['kind']=='threshold':
        metric=next((m for m in parent['metrics'] if m['id']==request['inputs']['metricId']),None)
        require(metric is not None and number(metric['value']))
        value=metric['value'];threshold=request['inputs']['threshold'];operator=request['inputs']['operator']
        margin=value-threshold;require(number(margin))
        meets=value>threshold if operator=='above' else value<threshold
        require(len(manifest['outputs'])==(44 if 'thresholdRange' in request['inputs'] else 2))
        for id,expected,unit in [('threshold-comparison',int(meets),'boolean (1=yes, 0=no)'),('threshold-margin',margin,metric['unit'])]:
            output=next((m for m in manifest['outputs'] if m['id']==id),None)
            require(output is not None and output['value']==expected and output['unit']==unit and output['evidenceIds']==metric['evidenceIds'] and output['denominator']==metric['denominator'])
    unique(manifest['alternatives'])
    for alternative in manifest['alternatives']:
        keys(alternative, {'id', 'name', 'cost', 'benefit', 'pareto', 'score'})
        string(alternative['name'])
        require(all(alternative[k] is None or number(alternative[k]) for k in ('cost', 'benefit', 'score')))
        require(alternative['pareto'] is None or isinstance(alternative['pareto'], bool))
    if 'weightSweep' in manifest:
        from .observatory.scenarios import weight_sweep
        require(request['kind']!='threshold' and bool(request['inputs'].get('weights')))
        require(manifest['weightSweep']==weight_sweep(request['inputs']['footprints']))
    require(('thresholdRange' in request['inputs'])==('thresholdSweep' in manifest))
    if 'thresholdSweep' in manifest:
        from .observatory.scenarios import threshold_sweep
        metric=next((m for m in parent['metrics'] if m['id']==request['inputs']['metricId']),None)
        require(metric is not None and number(metric['value']))
        expected=threshold_sweep(metric,request['inputs']['thresholdRange'],request['inputs']['operator'])
        require(manifest['thresholdSweep']==expected and manifest['methodVersion']==expected['methodVersion'])
        require(number(manifest['thresholdSweep']['recordedValue']) and number(manifest['thresholdSweep']['crossing']['threshold']) and type(manifest['thresholdSweep']['conditionChanges']) is int)
        require(all(type(c['meets']) is bool and number(c['threshold']) and number(c['margin']) for c in manifest['thresholdSweep']['cases']))
        require(type(manifest['thresholdSweep']['crossing']['withinRange']) is bool and manifest['thresholdSweep']['crossing']['meetsAtEquality'] is False)
        for i,case in enumerate(expected['cases']):
            for suffix,value,unit in [('condition',int(case['meets']),'boolean (1=yes, 0=no)'),('margin',case['margin'],metric['unit'])]:
                output=next((m for m in manifest['outputs'] if m['id']==f'threshold-sweep-{i}-{suffix}'),None)
                require(output is not None and output['value']==value and output['unit']==unit and output['evidenceIds']==metric['evidenceIds'] and output['denominator']==metric['denominator'])
    bounded_json(manifest, 256*1024)
    return manifest


def validate_forecast_evaluation(evaluation, manifest, *, allow_archived=False):
    from .observatory.history import gauge_evaluation
    from .observatory.forecasts import VERSION
    from .observatory.net import METHOD_VERSION as assessment_version
    keys(evaluation,{'seriesId','methodVersion','status','selectionHash','sourceInputHash','folds','forecasts','withheld','validation','notes'})
    method=evaluation['methodVersion']
    require(evaluation['seriesId']=='usgs-discharge' and evaluation['status']=='experimental')
    require((method==VERSION and manifest['methodVersion']==assessment_version) or
            (allow_archived and method==VERSION and manifest['methodVersion'] in ('observatory-1.3.0','observatory-1.4.0','observatory-1.5.0')) or
            (allow_archived and method=='gauge-selection-calibration-holdout-v2' and manifest['methodVersion']=='observatory-1.2.0'))
    strings(evaluation['notes']);strings(evaluation['withheld'])
    series=next((s for s in manifest.get('series',[]) if s['id']==evaluation['seriesId']),None)
    require(series is not None and len(series['evidenceIds'])==1)
    require(any(e['id']==series['evidenceIds'][0] and e['sourceId']=='usgs-daily' for e in manifest['evidence']))
    require(isinstance(evaluation['forecasts'],list) and len(evaluation['forecasts'])<=3)
    # Bind the issue to publication, then replay at that same captured timestamp.
    issues=[f.get('issueTime') for f in evaluation['forecasts']]
    require(not issues or len(set(issues))==1)
    issue=manifest['processedAt'];timestamp(issue)
    require(all(datetime.fromisoformat(value.replace('Z','+00:00')) ==
                datetime.fromisoformat(issue.replace('Z','+00:00')) for value in issues))
    expected=gauge_evaluation({k:v for k,v in series.items() if k!='analysis'},manifest['evidence'],now=datetime.fromisoformat(issue.replace('Z','+00:00')),method_version=method)
    require(expected is not None)
    require(evaluation==expected)
