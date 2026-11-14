"""Bounded analysis of published native float32 gamma0/difference exports only."""
import json
import math
import re
import threading
from pathlib import Path
from .store import Problem
from .inspection import inspection_windows

MAX_PIXELS = 1_000_000
_ANALYSIS_SLOT = threading.BoundedSemaphore(1)


def invalid(message='Invalid analysis request'):
    return Problem(400, 'invalid_request', message)


def parse_body(body):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate key')
            result[key] = value
        return result
    try:
        return json.loads(body, object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeDecodeError):
        raise Problem(400, 'invalid_json', 'Invalid JSON request') from None


def coordinate(value):
    if (not isinstance(value, list) or len(value) != 2 or
        any(isinstance(n, bool) or not isinstance(n, (int, float)) for n in value) or
        not -180 <= value[0] <= 180 or not -90 <= value[1] <= 90):
        raise invalid('Coordinates must be finite WGS84 longitude/latitude pairs')
    return value


def _cross(a, b, c):
    return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])


def _on(a, b, c):
    return (_cross(a, b, c) == 0 and min(a[0], b[0]) <= c[0] <= max(a[0], b[0]) and
            min(a[1], b[1]) <= c[1] <= max(a[1], b[1]))


def _intersects(a, b, c, d):
    p, q, r, s = _cross(a,b,c), _cross(a,b,d), _cross(c,d,a), _cross(c,d,b)
    return ((p*q < 0 and r*s < 0) or _on(a,b,c) or _on(a,b,d) or _on(c,d,a) or _on(c,d,b))


def polygon(value):
    if value is None:
        return None
    if (not isinstance(value, dict) or set(value) != {'type', 'coordinates'} or value['type'] != 'Polygon' or
        not isinstance(value['coordinates'], list) or len(value['coordinates']) != 1):
        raise invalid('Select one simple Polygon without holes')
    ring = value['coordinates'][0]
    if not isinstance(ring, list) or not 4 <= len(ring) <= 65:
        raise invalid('Polygon must have 4–65 coordinates including closure')
    for point in ring:
        coordinate(point)
    if ring[0] != ring[-1] or len({tuple(p) for p in ring[:-1]}) != len(ring)-1:
        raise invalid('Polygon must be closed with distinct vertices')
    n = len(ring)-1
    # GeoJSON planar edges crossing the dateline are ambiguous for this bounded crop tool.
    if any(abs(b[0]-a[0]) > 180 for a,b in zip(ring,ring[1:])):
        raise invalid('Polygon must not cross the antimeridian')
    origin = ring[0]
    if sum(_cross(origin, ring[i], ring[i+1]) for i in range(1,n)) == 0:
        raise invalid('Polygon must have nonzero area')
    for i in range(n):
        a,b = ring[i:i+2]
        c = ring[(i+2) % n]
        if _on(a,b,c) or _on(b,c,a):
            raise invalid('Polygon edges must not overlap')
        for j in range(i+1,n):
            if j == i+1 or (i == 0 and j == n-1):
                continue
            if _intersects(a,b,ring[j],ring[j+1]):
                raise invalid('Polygon must not self-intersect')
    return value


def validate_request(value):
    if not isinstance(value, dict) or set(value)-{'polygon','point','transect','thresholdDb'}:
        raise invalid()
    result = {'polygon': polygon(value.get('polygon')), 'thresholdDb': value.get('thresholdDb',3)}
    t = result['thresholdDb']
    if isinstance(t,bool) or not isinstance(t,(int,float)) or not .1 <= t <= 30:
        raise invalid('thresholdDb must be between 0.1 and 30')
    if 'point' in value:
        result['point'] = coordinate(value['point'])
    if 'transect' in value:
        line = value['transect']
        if not isinstance(line,list) or len(line) != 2:
            raise invalid('Transect requires two endpoints')
        result['transect'] = [coordinate(p) for p in line]
        if abs(line[0][0]-line[1][0]) > 180:
            raise invalid('Transect must not cross the antimeridian')
    return result


def inside_polygon(x, y, ring):
    """Vectorized planar GeoJSON inclusion, including pixel centers on boundary."""
    import numpy as np
    inside = np.zeros(np.shape(x), dtype=bool)
    boundary = inside.copy()
    for a,b in zip(ring,ring[1:]):
        dx,dy = b[0]-a[0], b[1]-a[1]
        cross = (x-a[0])*dy - (y-a[1])*dx
        tolerance = 1e-12 * max(abs(dx),abs(dy),1e-12)
        boundary |= ((np.abs(cross) <= tolerance) & (x >= min(a[0],b[0])-1e-12) &
                     (x <= max(a[0],b[0])+1e-12) & (y >= min(a[1],b[1])-1e-12) &
                     (y <= max(a[1],b[1])+1e-12))
        if dy != 0:
            inside ^= ((a[1] > y) != (b[1] > y)) & (x < dx*(y-a[1])/dy+a[0])
    return inside | boundary


def selection_mask(shape, transform, selection, to_wgs84):
    import numpy as np
    if selection is None:
        return np.ones(shape,dtype=bool)
    selected = np.zeros(shape,dtype=bool)
    # Transform native centers, rather than rasterizing a resampled display layer.
    for start in range(0,selected.size,8192):
        indices = np.arange(start,min(start+8192,selected.size))
        rows,cols = np.divmod(indices,shape[1])
        rows = rows.astype(float)+.5; cols = cols.astype(float)+.5
        x = transform[0]+cols*transform[1]+rows*transform[2]
        y = transform[3]+cols*transform[4]+rows*transform[5]
        points = np.asarray(to_wgs84(list(zip(x.ravel(),y.ravel()))))
        if not np.isfinite(points[:,:2]).all():
            raise Problem(422,'invalid_grid','Native coordinate transformation failed')
        selected.ravel()[start:start+len(rows)] = inside_polygon(points[:,0],points[:,1],selection['coordinates'][0])
    return selected


def common_mask(before, after, difference, validity):
    import numpy as np
    if (before.ndim != 2 or before.shape != after.shape or before.shape != difference.shape or
        before.shape != validity.shape or before.size > MAX_PIXELS or not before.size):
        raise Problem(422,'invalid_grid','Native raster grids are incompatible or exceed the pixel limit')
    return ((validity == 1) & np.isfinite(before) & (before > 0) & np.isfinite(after) &
            (after > 0) & np.isfinite(difference))


def _distribution(values, edges):
    import numpy as np
    if not len(values):
        return {'edges':[], 'counts':[]}
    return {'edges': edges.tolist(), 'counts':np.histogram(values,bins=edges)[0].tolist()}


def summarize(before, after, difference, validity, selected, pixel_area, threshold):
    """All values use the same selected common-valid population; no causal inference."""
    import numpy as np
    common = common_mask(before,after,difference,validity)
    if selected.shape != before.shape or not math.isfinite(pixel_area) or pixel_area <= 0:
        raise Problem(422,'invalid_grid','Native pixel selection or area is invalid')
    mask = common & selected
    b = 10*np.log10(before[mask].astype(np.float64))
    a = 10*np.log10(after[mask].astype(np.float64))
    d = difference[mask].astype(np.float64)
    total, valid = int(np.count_nonzero(selected)), int(len(d))
    area = pixel_area/1e6
    increased, decreased = int(np.count_nonzero(d > threshold)), int(np.count_nonzero(d < -threshold))
    summary = dict(totalPixels=total,validPixels=valid,validPercent=100*valid/total if total else 0,
                   pixelAreaM2=pixel_area,validAreaKm2=valid*area,
                   beforeMedianDb=float(np.median(b)) if valid else None,
                   afterMedianDb=float(np.median(a)) if valid else None,
                   medianChangeDb=float(np.median(d)) if valid else None,
                   p05Db=float(np.percentile(d,5)) if valid else None,
                   p95Db=float(np.percentile(d,95)) if valid else None,
                   increasedAreaKm2=increased*area,decreasedAreaKm2=decreased*area,
                   withinThresholdAreaKm2=(valid-increased-decreased)*area)
    shared_edges = np.histogram_bin_edges(np.concatenate((b,a)), bins=32) if valid else np.array([])
    diff_edges = np.histogram_bin_edges(d,bins=32) if valid else np.array([])
    distributions = dict(before=_distribution(b,shared_edges),after=_distribution(a,shared_edges),difference=_distribution(d,diff_edges))
    return summary, distributions, common


def probe(point, before, after, difference, common, transform, to_native):
    sample = dict(coordinate=point,valid=False,beforeDb=None,afterDb=None,differenceDb=None,reason='outside-crop')
    try:
        x,y = to_native(point)[:2]
        det = transform[1]*transform[5]-transform[2]*transform[4]
        dx,dy = x-transform[0],y-transform[3]
        col = (dx*transform[5]-dy*transform[2])/det
        row = (dy*transform[1]-dx*transform[4])/det
        if not math.isfinite(col) or not math.isfinite(row):
            raise ValueError()
        # floor selects the nearest native pixel center, with deterministic tie handling.
        col,row = math.floor(col),math.floor(row)
    except (ValueError,RuntimeError,OverflowError,ZeroDivisionError):
        sample['reason'] = 'coordinate-transform-failed'
        return sample
    if not (0 <= row < before.shape[0] and 0 <= col < before.shape[1]):
        return sample
    if not common[row,col]:
        sample['reason'] = 'excluded-or-no-data'
        return sample
    sample.update(valid=True,beforeDb=10*math.log10(float(before[row,col])),
                  afterDb=10*math.log10(float(after[row,col])),differenceDb=float(difference[row,col]),reason=None)
    return sample


def _distance(a,b):
    lon1,lat1,lon2,lat2 = map(math.radians,(*a,*b))
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 2*6371008.8*math.asin(math.sqrt(min(1,max(0,h))))


def transect(endpoints, sampler):
    a,b = endpoints
    points = [[a[0]+(b[0]-a[0])*i/127, a[1]+(b[1]-a[1])*i/127] for i in range(128)]
    points[0],points[-1] = list(a),list(b)
    distance, result = 0., []
    for i,point in enumerate(points):
        if i:
            distance += _distance(points[i-1],point)
        result.append(dict(sampler(point),distanceM=distance))
    return result


def _paths(root, job_id):
    if not isinstance(job_id,str) or not re.fullmatch(r'[a-f0-9]{32}',job_id):
        raise Problem(422,'invalid_artifacts','Native analysis artifacts are unavailable')
    root = Path(root)
    folder = root/'results'/job_id
    try:
        if any(p.is_symlink() for p in (root,root/'results',folder)):
            raise ValueError()
        base = root.resolve(strict=True)
        paths = [folder/(name+'.tif') for name in ('before','after','difference','validity')]
        for path in paths:
            if path.is_symlink() or not path.is_file() or not path.resolve(strict=True).is_relative_to(base):
                raise ValueError()
        return paths
    except (OSError,ValueError):
        raise Problem(422,'invalid_artifacts','Native analysis artifacts are unavailable') from None


def _native(root, job_id, limit):
    try:
        from osgeo import gdal, osr
    except ImportError:
        raise Problem(503,'analysis_unavailable','Native GDAL analysis runtime unavailable') from None
    paths = _paths(root,job_id)
    datasets = []
    try:
        for path in paths:
            ds = gdal.OpenEx(str(path),gdal.OF_RASTER | gdal.OF_READONLY,
                             allowed_drivers=['GTiff'],sibling_files=[path.name])
            if ds is None or ds.RasterCount != 1 or not 0 < ds.RasterXSize*ds.RasterYSize <= min(MAX_PIXELS,limit):
                raise ValueError()
            # A native export must not reference any external sidecar/remote source.
            if any(Path(p).resolve() != path.resolve() for p in ds.GetFileList() or []):
                raise ValueError()
            datasets.append(ds)
        first = datasets[0]
        gt = first.GetGeoTransform()
        crs = osr.SpatialReference()
        if crs.ImportFromWkt(first.GetProjectionRef()) != 0 or not crs.IsProjected():
            raise ValueError()
        units = crs.GetLinearUnits()
        determinant = gt[1]*gt[5]-gt[2]*gt[4]
        if not all(math.isfinite(v) for v in (*gt,units,determinant)) or units <= 0 or determinant == 0:
            raise ValueError()
        for index,ds in enumerate(datasets):
            other = osr.SpatialReference()
            if other.ImportFromWkt(ds.GetProjectionRef()) != 0:
                raise ValueError()
            if ((ds.RasterXSize,ds.RasterYSize) != (first.RasterXSize,first.RasterYSize) or
                ds.GetGeoTransform() != gt or not crs.IsSame(other) or
                ds.GetRasterBand(1).DataType != (gdal.GDT_Byte if index == 3 else gdal.GDT_Float32)):
                raise ValueError()
        crs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        wgs = osr.SpatialReference(); wgs.ImportFromEPSG(4326)
        wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        forward = osr.CoordinateTransformation(wgs,crs)
        reverse = osr.CoordinateTransformation(crs,wgs)
        import numpy as np
        arrays = []
        masks = np.ones((first.RasterYSize,first.RasterXSize),dtype=bool)
        for ds in datasets:
            band = ds.GetRasterBand(1)
            values = band.ReadAsArray()
            if values is None:
                raise ValueError()
            nodata = band.GetNoDataValue()
            if nodata is not None:
                masks &= np.isfinite(values) if math.isnan(nodata) else values != nodata
            if band.GetMaskFlags() != gdal.GMF_ALL_VALID:
                masks &= band.GetMaskBand().ReadAsArray() != 0
            arrays.append(values)
        arrays[3] = np.where(masks,arrays[3],0)
        return arrays,gt,crs,abs(determinant)*units*units,forward,reverse
    except (RuntimeError,ValueError,TypeError,OSError,AttributeError):
        raise Problem(422,'invalid_grid','Native analysis rasters are unreadable or incompatible') from None
    finally:
        datasets.clear()


def analyze(store, user, job_id, request):
    job = store.get(user,job_id)
    request = validate_request(request)
    if job['status'] != 'completed':
        raise Problem(409,'not_completed','Analysis requires a completed comparison')
    if not _ANALYSIS_SLOT.acquire(blocking=False):
        raise Problem(429,'analysis_busy','Native analysis is busy; retry later')
    try:
        arrays,gt,crs,area,forward,reverse = _native(store.config.root,job['id'],store.config.max_pixels)
        before,after,difference,validity = arrays
        selected = selection_mask(before.shape,gt,request['polygon'],reverse.TransformPoints)
        summary,distributions,common = summarize(*arrays,selected,area,request['thresholdDb'])
        try:
            inspection = inspection_windows(difference, common, selected, gt, area,
                                            request['thresholdDb'], lambda point: reverse.TransformPoint(*point))
        except ValueError:
            raise Problem(422, 'invalid_grid', 'Native inspection support is invalid') from None
        sampler = lambda point: probe(point,before,after,difference,common,gt,lambda p: forward.TransformPoint(*p))
        result = job.get('result') or {}
        processing = result.get('processing') or {}
        authority = crs.GetAuthorityName(None); code = crs.GetAuthorityCode(None)
        insights = [f"{summary['validPixels']} of {summary['totalPixels']} selected native pixels are common-valid.",
                    f"Areas above +{request['thresholdDb']:g} dB, below -{request['thresholdDb']:g} dB, and within the threshold partition common-valid pixels.",
                    'Threshold categories describe backscatter differences; they do not establish statistical significance, a cause, flooding, or damage.',
                    'Before/after dB values are derived from exported float32 gamma0; differences use the native exported float32 dB raster.']
        if summary['validPixels'] == 0:
            insights.append('No common-valid pixels in this selection; statistics and distributions are empty.')
        response = dict(schemaVersion='1.0',kind='radar-analysis',jobId=job['id'],selection={k:request[k] for k in ('polygon','thresholdDb')},
                        summary=summary,distributions=distributions,probe=sampler(request['point']) if 'point' in request else None,
                        transect=transect(request['transect'],sampler) if 'transect' in request else [],insights=insights,
                        inspectionWindows=inspection,
                        provenance=dict(algorithm='native-radar-analysis-v2',
                                        crs=f'{authority}:{code}' if authority and code else 'projected-native-grid',
                                        beforeId=job['beforeId'],afterId=job['afterId'],
                                        method='Native pixel-center GeoJSON inclusion (boundary included); common validity intersection; 10*log10 exported gamma0; exported difference dB; nearest native probes; 128 linear WGS84 transect samples with cumulative spherical distance (R=6371008.8 m); source processing: '+str(processing.get('algorithmVersion','unknown')),
                                        units='dB',valueSource='native-exported-rasters'))
        json.dumps(response,allow_nan=False)
        return response
    finally:
        _ANALYSIS_SLOT.release()
