"""Export a frozen, self-describing result bundle for the Ground Truth website.

Reads the outputs of ``service.ground_motion_study`` (``ground_motion.npz`` + ``summary.json``) and,
optionally, ``service.buildings`` (``buildings.geojson``), and writes a directory a static site can
load without any server:

  manifest.json       provenance, method, caveats, colour scale, headline statistics, file hashes
  vertical_rate.png   vertical rate, resampled onto a Web-Mercator-aligned grid (transparent = not measured)
  vertical_grid.json  coarse lon/lat grid of vertical rate and its uncertainty, for hover read-outs
  buildings.geojson   building footprints with ground-tilt ratings (OSM, ODbL)

Every number in the bundle is derived from the measurements; nothing is filled in or smoothed over
gaps. Example:

  python -m service.result_bundle --ground out/ground_motion.npz --summary out/summary.json \\
      --buildings bld/buildings.geojson --id tehran-sw-2026 --title "South-west Tehran" --out bundle/
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np

from . import ground_motion as gm

SCHEMA = 'earthsignal.result-bundle/1'
EARTH_M_PER_DEG = 111_320.0
COLOUR_LIMIT_MM = 250.0
# Sinking (negative) is warm, uplift (positive) is cool; the same ramp as the study quicklooks.
COLOUR_STOPS = ((-1.0, (194, 61, 23)), (-0.5, (240, 163, 94)), (0.0, (244, 241, 234)),
                (0.5, (110, 159, 211)), (1.0, (34, 80, 143)))
OVERLAY_ALPHA = 220
VALUE_GRID_M = 400.0
VALUE_WINDOW_PIXELS = 2          # 5 x 5 source pixels per value cell
VALUE_MIN_PIXELS = 13            # at least half the window must be measured
BUILDING_FIELDS = ('osm_id', 'category', 'vertical_mm_per_year', 'ground_tilt_per_year',
                   'ground_tilt_sigma_per_year', 'tilt_toward_deg', 'years_to_1_in_500', 'years_to_1_in_300',
                   'years_to_1_in_250', 'years_to_1_in_150', 'height_m', 'height_source')
COORD_DECIMALS = 6               # ~0.1 m


# ---------------------------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------------------------

def mercator_y(lat_deg):
    lat = np.radians(np.asarray(lat_deg, float))
    return np.log(np.tan(np.pi / 4 + lat / 2))


def mercator_lat(y):
    return np.degrees(2 * np.arctan(np.exp(np.asarray(y, float))) - np.pi / 2)


def _check_grid(x, y):
    if x.size < 2 or y.size < 2 or not (np.all(np.diff(x) > 0) and np.all(np.diff(y) < 0)):
        raise gm.GroundMotionError('bad_grid', 'grid x must increase and y must decrease')
    spacing = float(x[1] - x[0])
    if not (np.allclose(np.diff(x), spacing) and np.allclose(np.diff(y), -spacing)):
        raise gm.GroundMotionError('bad_grid', 'grid must be regular with square pixels')
    return spacing


def sample_nearest(x, y, values, lon, lat, zone):
    """Nearest-pixel sample of a UTM grid at lon/lat points (NaN outside the grid). No interpolation across gaps."""
    spacing = _check_grid(x, y)
    ex, ny = gm.lonlat_to_utm(lon, lat, zone)
    col = np.rint((np.asarray(ex) - x[0]) / spacing).astype(int)
    row = np.rint((y[0] - np.asarray(ny)) / spacing).astype(int)
    inside = (col >= 0) & (col < x.size) & (row >= 0) & (row < y.size)
    out = np.full(np.shape(col), np.nan)
    out[inside] = values[row[inside], col[inside]]
    return out, row, col, inside


def mercator_lattice(bbox, spacing_m):
    """Pixel-centre lon/lat of a Web-Mercator-aligned image covering bbox at roughly spacing_m."""
    w, s, e, n = bbox
    lat_c = (s + n) / 2
    width = max(2, int(round((e - w) * EARTH_M_PER_DEG * math.cos(math.radians(lat_c)) / spacing_m)))
    y_s, y_n = float(mercator_y(s)), float(mercator_y(n))
    height = max(2, int(round((y_n - y_s) / math.radians(e - w) * width)))
    lon = w + (np.arange(width) + 0.5) * (e - w) / width
    lat = mercator_lat(y_n - (np.arange(height) + 0.5) * (y_n - y_s) / height)
    return np.meshgrid(lon, lat)


# ---------------------------------------------------------------------------------------------
# Layers
# ---------------------------------------------------------------------------------------------

def colourise(values, limit_mm=COLOUR_LIMIT_MM):
    """RGBA image: diverging ramp clipped at +-limit; unmeasured pixels fully transparent."""
    v = np.clip(np.nan_to_num(np.asarray(values, float)) / limit_mm, -1, 1)
    pos = np.array([p for p, _ in COLOUR_STOPS])
    rgb = np.stack([np.interp(v, pos, [c[k] for _, c in COLOUR_STOPS]) for k in range(3)], axis=-1)
    alpha = np.where(np.isfinite(values), OVERLAY_ALPHA, 0)
    return np.dstack([np.rint(rgb), alpha]).astype(np.uint8)


def value_grid(x, y, vertical, sigma, bbox, zone, cell_m=VALUE_GRID_M):
    """Coarse lon/lat grid of block medians (vertical rate and its uncertainty), None where too little was measured."""
    w, s, e, n = bbox
    lat_c = (s + n) / 2
    dlat = cell_m / EARTH_M_PER_DEG
    dlon = cell_m / (EARTH_M_PER_DEG * math.cos(math.radians(lat_c)))
    cols, rows = int(math.floor((e - w) / dlon)), int(math.floor((n - s) / dlat))
    lon = w + (np.arange(cols) + 0.5) * dlon
    lat = n - (np.arange(rows) + 0.5) * dlat
    glon, glat = np.meshgrid(lon, lat)
    _, row, col, inside = sample_nearest(x, y, vertical, glon, glat, zone)
    k = VALUE_WINDOW_PIXELS
    rate = np.full(glon.shape, np.nan)
    sig = np.full(glon.shape, np.nan)
    for i, j in zip(*np.nonzero(inside)):
        r, c = row[i, j], col[i, j]
        block = vertical[max(r - k, 0):r + k + 1, max(c - k, 0):c + k + 1]
        ok = np.isfinite(block)
        if ok.sum() >= VALUE_MIN_PIXELS:
            rate[i, j] = np.median(block[ok])
            sblock = sigma[max(r - k, 0):r + k + 1, max(c - k, 0):c + k + 1][ok]
            sblock = sblock[np.isfinite(sblock)]
            if sblock.size:
                sig[i, j] = np.median(sblock)   # per-pixel error, not divided down: block values are correlated
    return {'west': w, 'north': n, 'dlon': round(dlon, 7), 'dlat': round(dlat, 7), 'cols': cols, 'rows': rows,
            'order': 'row-major from the north-west corner; cell centres at west+(i+0.5)*dlon, north-(j+0.5)*dlat',
            'units': 'mm/yr', 'positive': 'up',
            'vertical_rate': _int_list(rate), 'vertical_sigma': _int_list(sig)}, glon, glat, rate, sig


def _int_list(a):
    return [None if not math.isfinite(v) else int(round(v)) for v in np.asarray(a, float).ravel()]


def headline_stats(vertical, sigma, spacing_m, glon, glat, grate):
    """Statistics the story can quote.

    ``area_km2_sinking_faster_than`` counts measured pixels at or beyond each rate; the ``_2sigma`` variant
    additionally requires the pixel's sinking to exceed twice its own uncertainty (a stricter, smaller area).
    """
    finite = np.isfinite(vertical)
    if not finite.any():
        raise gm.GroundMotionError('no_data', 'vertical rate has no measured pixels')
    px_km2 = (spacing_m / 1000.0) ** 2
    significant = finite & np.isfinite(sigma) & (vertical < -2 * sigma)
    stats = {'measured_fraction': round(float(finite.mean()), 3),
             'measured_area_km2': round(float(finite.sum() * px_km2), 1),
             'vertical_rate_p1': round(float(np.percentile(vertical[finite], 1)), 1),
             'vertical_rate_median': round(float(np.median(vertical[finite])), 1),
             'vertical_rate_p99': round(float(np.percentile(vertical[finite], 99)), 1),
             'median_sigma': round(float(np.nanmedian(sigma[finite])), 1),
             'area_km2_sinking_faster_than': {
                 str(t): round(float((finite & (vertical <= -t)).sum() * px_km2), 1) for t in (50, 100, 200)},
             'area_km2_sinking_faster_than_2sigma': {
                 str(t): round(float((significant & (vertical <= -t)).sum() * px_km2), 1) for t in (50, 100, 200)}}
    # Fastest-sinking ~1.2 km neighbourhood: 3 x 3 mean of the 400 m value grid, all nine cells measured.
    padded = np.pad(grate, 1, constant_values=np.nan)
    neigh = np.stack([padded[i:i + grate.shape[0], j:j + grate.shape[1]] for i in range(3) for j in range(3)])
    full = np.all(np.isfinite(neigh), axis=0)
    if full.any():
        smooth = np.where(full, neigh.mean(axis=0), np.inf)
        i, j = np.unravel_index(int(np.argmin(smooth)), smooth.shape)
        stats['fastest_neighbourhood'] = {'lon': round(float(glon[i, j]), 4), 'lat': round(float(glat[i, j]), 4),
                                          'vertical_rate': round(float(smooth[i, j]), 1), 'size_m': 3 * VALUE_GRID_M}
    return stats


def slim_buildings(geojson):
    feats = []
    for f in geojson['features']:
        props = {k: f['properties'][k] for k in BUILDING_FIELDS if k in f['properties']}
        ring = [[round(p[0], COORD_DECIMALS), round(p[1], COORD_DECIMALS)] for p in f['geometry']['coordinates'][0]]
        feats.append({'type': 'Feature', 'properties': props, 'geometry': {'type': 'Polygon', 'coordinates': [ring]}})
    return {'type': 'FeatureCollection', 'features': feats}


# ---------------------------------------------------------------------------------------------
# Focus area: one neighbourhood at full 80 m resolution, in local metres, for the 3D view
# ---------------------------------------------------------------------------------------------

FOCUS_SIZE_M = 1200.0
FOCUS_STEP_DEG = 0.002           # ~200 m search step for the automatic choice
FOCUS_MAX_BUILDINGS = 2500
FOCUS_FIELDS = tuple(k for k in BUILDING_FIELDS if k != 'osm_id')


def _centroids(features):
    pts = np.array([np.mean(np.array(f['geometry']['coordinates'][0][:-1]), axis=0) for f in features]).reshape(-1, 2)
    return pts[:, 0], pts[:, 1]


def pick_focus(features, zone, size_m=FOCUS_SIZE_M):
    """Centre (lon, lat) of the size_m square holding the most "high" buildings; ties go to more "elevated" ones."""
    cats = np.array([f['properties']['category'] for f in features])
    if not (cats == 'high').any():
        raise gm.GroundMotionError('no_focus', 'no "high" buildings to centre a focus area on')
    lon, lat = _centroids(features)
    keep = np.isin(cats, ('high', 'elevated'))
    bx, by = gm.lonlat_to_utm(lon[keep], lat[keep], zone)
    weight = np.where(cats[keep] == 'high', 1.0, 1e-3)
    hl, ht = lon[cats == 'high'], lat[cats == 'high']
    clon, clat = np.meshgrid(np.arange(hl.min(), hl.max() + FOCUS_STEP_DEG, FOCUS_STEP_DEG),
                             np.arange(ht.min(), ht.max() + FOCUS_STEP_DEG, FOCUS_STEP_DEG))
    cx, cy = gm.lonlat_to_utm(clon.ravel(), clat.ravel(), zone)
    half = size_m / 2
    scores = np.zeros(cx.size)
    for start in range(0, cx.size, 2000):            # chunks keep the comparison matrix small
        sl = slice(start, start + 2000)
        inside = (np.abs(bx[None, :] - cx[sl, None]) <= half) & (np.abs(by[None, :] - cy[sl, None]) <= half)
        scores[sl] = inside @ weight
    k = int(np.argmax(scores))
    return round(float(clon.ravel()[k]), 5), round(float(clat.ravel()[k]), 5)


def focus_context_bbox(centre, size_m=FOCUS_SIZE_M, margin_m=150.0):
    """Lon/lat box around a focus square (with a margin), for extracting map context."""
    half = size_m / 2 + margin_m
    dlat = half / EARTH_M_PER_DEG
    dlon = half / (EARTH_M_PER_DEG * math.cos(math.radians(centre[1])))
    return (centre[0] - dlon, centre[1] - dlat, centre[0] + dlon, centre[1] + dlat)


def focus_area(x, y, vertical, sigma, features, zone, epsg, centre, size_m=FOCUS_SIZE_M, context=None):
    """80 m vertical rate and building footprints inside a square, in metres east/north of its centre."""
    spacing = _check_grid(x, y)
    cx, cy = (float(v) for v in gm.lonlat_to_utm(centre[0], centre[1], zone))
    half = size_m / 2
    cols = np.nonzero(np.abs(x - cx) <= half + spacing)[0]
    rows = np.nonzero(np.abs(y - cy) <= half + spacing)[0]
    if cols.size < 2 or rows.size < 2:
        raise gm.GroundMotionError('no_focus', 'focus area lies outside the measured grid')
    sub = (slice(rows[0], rows[-1] + 1), slice(cols[0], cols[-1] + 1))
    as_rows = lambda a: [[None if not math.isfinite(v) else round(float(v), 1) for v in r] for r in a]  # noqa: E731
    lon, lat = _centroids(features)
    ex, ny = gm.lonlat_to_utm(lon, lat, zone)
    inside = np.nonzero((np.abs(np.asarray(ex) - cx) <= half) & (np.abs(np.asarray(ny) - cy) <= half))[0]
    if inside.size > FOCUS_MAX_BUILDINGS:
        raise gm.GroundMotionError('too_many_buildings', f'{inside.size} buildings in the focus area; shrink it')
    out_b, counts = [], {}
    for i in inside:
        f = features[int(i)]
        ring = np.array(f['geometry']['coordinates'][0])
        rx, ry = gm.lonlat_to_utm(ring[:, 0], ring[:, 1], zone)
        props = {k: f['properties'][k] for k in FOCUS_FIELDS if k in f['properties']}
        props['osm_id'] = f['properties'].get('osm_id')
        props['ring'] = [[round(float(a - cx), 1), round(float(b - cy), 1)] for a, b in zip(rx, ry)]
        out_b.append(props)
        counts[props['category']] = counts.get(props['category'], 0) + 1
    ctx = []
    for item in context or []:
        pts = np.array(item['coords'], float)
        px, py = gm.lonlat_to_utm(pts[:, 0], pts[:, 1], zone)
        ctx.append({'kind': item['kind'],
                    'line': [[round(float(a - cx), 1), round(float(b - cy), 1)] for a, b in zip(px, py)]})
    return {
        'centre_lonlat': [centre[0], centre[1]], 'size_m': size_m,
        'context': ctx,
        'context_source': 'OpenStreetMap streets, green areas and water (drawing only)' if ctx else None,
        'coordinates': f'metres east (x) and north (y) of the centre, in EPSG:{epsg}',
        'spacing_m': spacing,
        'grid': {'east': [round(float(v - cx), 1) for v in x[sub[1]]],
                 'north': [round(float(v - cy), 1) for v in y[sub[0]]],
                 'order': 'rows from north to south, columns from west to east; null = not measured',
                 'units': 'mm/yr', 'positive': 'up',
                 'vertical_rate': as_rows(vertical[sub]), 'vertical_sigma': as_rows(sigma[sub])},
        'buildings': out_b, 'categories': counts,
    }


# ---------------------------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------------------------

CAVEATS = [
    ('relative', 'Rates are relative to the median of the whole area, not absolute. A stable benchmark (GNSS) would be needed to fix the zero.'),
    ('short_record', 'Built from {months:.0f} months of data ({start} to {end}). The yearly rate is a straight-line extrapolation and may include seasonal motion.'),
    ('uncertainty', 'A typical 80 m pixel is uncertain by about ±{median_sigma:.0f} mm/yr (one standard error, median over the area), mostly from atmospheric delay. Read patterns several kilometres wide, not single pixels.'),
    ('vertical_assumption', 'Vertical motion is computed from two viewing directions assuming no north-south ground motion.'),
    ('no_data', 'Transparent areas were not measured (water, vegetation change, steep terrain or low coherence). Not measured does not mean not moving.'),
]
PROVISIONAL_CAVEAT = ('provisional', 'NISAR products in this bundle are PROVISIONAL releases; calibration and processing may change in later versions.')
BUILDING_CAVEATS = [
    ('tilt_not_damage', 'Building ratings describe ground tilt beneath each footprint from 80 m radar pixels. They are not an assessment of any building.'),
    ('osm_partial', 'OpenStreetMap does not map every building. Missing buildings are unmapped, not unaffected.'),
    ('heights', 'Most buildings have no height in OpenStreetMap and use a flagged estimate.'),
]


def code_version(repo: Path) -> str | None:
    """Short commit of the producing code, marked '+uncommitted' when tracked or untracked files differ from it."""
    def git(*args):
        return subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True,
                              timeout=10, check=True).stdout.strip()
    try:
        rev = git('rev-parse', '--short', 'HEAD')
        return f'{rev}+uncommitted' if git('status', '--porcelain', '--untracked-files=normal') else rev
    except (OSError, subprocess.SubprocessError):
        return None


def source_record(summary):
    stacks, granules = [], []
    for s in summary.get('stacks', []):
        stacks.append({k: s.get(k) for k in ('direction', 'track', 'frame', 'pairs', 'first', 'last',
                                             'troposphere_applied', 'measured_fraction')})
        granules += [p['granule'] for p in s.get('pairs_detail', []) if isinstance(p, dict)]
    if not stacks or not granules:
        raise gm.GroundMotionError('no_provenance', 'summary.json lists no stacks/granules; refusing to export without provenance')
    firsts = [s['first'] for s in stacks if s.get('first')]
    lasts = [s['last'] for s in stacks if s.get('last')]
    provisional = any('_PR_' in g for g in granules)
    return {'mission': 'NISAR (NASA-ISRO SAR mission)',
            'sensor': 'L-band SAR, 24.4 cm wavelength',
            'product': 'Level-2 geocoded unwrapped interferograms (GUNW)',
            'provider': 'NASA Alaska Satellite Facility DAAC',
            'collections_searched': summary.get('collections_searched', []),
            'product_status': 'provisional' if provisional else 'validated',
            'period': {'start': min(firsts) if firsts else None, 'end': max(lasts) if lasts else None},
            'stacks': stacks, 'granules': sorted(set(granules)), 'rejected_granules': summary.get('rejected', [])}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def _write_json(path: Path, obj, compact=True):
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(obj, separators=(',', ':')) if compact else json.dumps(obj, indent=1, ensure_ascii=False))
    os.replace(tmp, path)


def export(ground_npz: Path, summary_json: Path, out: Path, bundle_id: str, title: str,
           buildings_geojson: Path | None = None, repo: Path | None = None, notes: list | None = None,
           version: str | None = None, focus: str | tuple[float, float] | None = None,
           osm_context: Path | None = None) -> dict:
    """Write the bundle into ``out``. ``notes`` are site-specific analyst caveats ({id, text}) kept apart from method caveats.

    ``focus`` ('auto' or a (lon, lat) centre, needs buildings) also writes ``focus.json``: one
    1.2 km neighbourhood at full 80 m resolution with its footprints, for the 3D city view.
    """
    from PIL import Image

    out.mkdir(parents=True, exist_ok=True)
    summary = json.loads(summary_json.read_text())
    z = np.load(ground_npz)
    if 'vertical_rate' not in z.files:
        raise gm.GroundMotionError('no_vertical', 'ground_motion.npz has no vertical_rate (needs both directions)')
    x, y, vertical = z['x'], z['y'], z['vertical_rate']
    spacing = _check_grid(x, y)
    epsg = int(z['epsg'])
    zone = gm.utm_zone_from_epsg(epsg)
    for d in ('A', 'D'):
        if z[f'{d}_rate'].shape != vertical.shape:
            raise gm.GroundMotionError('bad_grid', f'{d} grids are not on the vertical grid')
    sigma = gm.decompose_up_sigma(z['A_sigma'], z['D_sigma'],
                                  (z['A_los_east'], z['A_los_north'], z['A_los_up']),
                                  (z['D_los_east'], z['D_los_north'], z['D_los_up']))
    sigma = np.where(np.isfinite(vertical), sigma, np.nan)
    bbox = [float(v) for v in summary['bbox_lonlat']]
    source = source_record(summary)

    lon, lat = mercator_lattice(bbox, spacing)
    img, *_ = sample_nearest(x, y, vertical, lon, lat, zone)
    Image.fromarray(colourise(img), 'RGBA').save(out / 'vertical_rate.png', optimize=True)

    grid, glon, glat, grate, _ = value_grid(x, y, vertical, sigma, bbox, zone)
    _write_json(out / 'vertical_grid.json', grid)
    stats = headline_stats(vertical, sigma, spacing, glon, glat, grate)

    period = source['period']
    months = (date.fromisoformat(period['end']) - date.fromisoformat(period['start'])).days / 30.44
    fields = {**stats, **period, 'months': months}
    caveats = [{'id': i, 'text': t.format(**fields), 'source': 'method'} for i, t in CAVEATS]
    if source['product_status'] == 'provisional':
        caveats.append({'id': PROVISIONAL_CAVEAT[0], 'text': PROVISIONAL_CAVEAT[1], 'source': 'method'})
    for note in notes or []:
        if not (isinstance(note, dict) and note.get('id') and note.get('text')):
            raise gm.GroundMotionError('bad_notes', 'each note needs an id and text')
        caveats.append({'id': str(note['id']), 'text': str(note['text']), 'source': 'analyst'})
    files = ['vertical_rate.png', 'vertical_grid.json']
    buildings = None
    if buildings_geojson:
        bj = json.loads(buildings_geojson.read_text())
        meta = bj.get('metadata', {})
        if not meta.get('attribution'):
            raise gm.GroundMotionError('no_provenance', 'buildings.geojson has no attribution metadata')
        slim = slim_buildings(bj)
        _write_json(out / 'buildings.geojson', slim)
        files.append('buildings.geojson')
        counts: dict[str, int] = {}
        for f in slim['features']:
            counts[f['properties']['category']] = counts.get(f['properties']['category'], 0) + 1
        buildings = {'file': 'buildings.geojson', 'count': len(slim['features']), 'categories': counts,
                     'bbox_lonlat': meta.get('bbox_lonlat'), 'osm_snapshot': meta.get('osm_snapshot'),
                     'heights': meta.get('heights'), 'method': meta.get('method'),
                     'category_rule': {'high': 'ground tilt reaches 1 in 500 within 10 years at the measured rate',
                                       'elevated': '1 in 500 within 30 years', 'low': 'more than 30 years',
                                       'not_enough_evidence': 'measured tilt smaller than twice its uncertainty',
                                       'not_measured': 'no radar measurement beneath the building'},
                     'fields': {'vertical_mm_per_year': 'local mean vertical rate, negative = sinking',
                                'ground_tilt_per_year': 'slope change per year (dimensionless; 0.002 = 1 in 500)',
                                'tilt_toward_deg': 'bearing the ground tilts toward, degrees from north',
                                'years_to_1_in_N': 'years for the measured tilt to accumulate to 1 in N'},
                     'attribution': meta['attribution'], 'licence': 'ODbL 1.0'}
        caveats += [{'id': i, 'text': t, 'source': 'method'} for i, t in BUILDING_CAVEATS]
    elif (out / 'buildings.geojson').exists():
        (out / 'buildings.geojson').unlink()      # never leave a stale layer from an earlier export

    focus_meta = None
    if focus is not None:
        if not buildings:
            raise gm.GroundMotionError('no_focus', 'a focus area needs the building layer')
        auto = focus == 'auto'
        centre = pick_focus(slim['features'], zone) if auto else (float(focus[0]), float(focus[1]))
        context = None
        if osm_context:
            from .buildings import extract_context
            context = extract_context(osm_context, focus_context_bbox(centre))
        area = focus_area(x, y, vertical, sigma, slim['features'], zone, epsg, centre, context=context)
        area['selection'] = ('automatic: the 1.2 km square with the most "high" building ratings' if auto
                             else 'chosen by the analyst')
        _write_json(out / 'focus.json', area)
        files.append('focus.json')
        focus_meta = {'file': 'focus.json', 'centre_lonlat': area['centre_lonlat'], 'size_m': area['size_m'],
                      'selection': area['selection'], 'buildings': len(area['buildings']),
                      'categories': area['categories']}
    elif (out / 'focus.json').exists():
        (out / 'focus.json').unlink()

    settings = summary.get('settings', {})
    manifest = {
        'schema': SCHEMA, 'id': bundle_id, 'title': title,
        'generated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'provenance': 'measured',
        'producer': {'software': 'earthsignal', 'algorithm': summary.get('algorithm', gm.ALGORITHM_VERSION),
                     'code_version': version or (code_version(repo) if repo else None)},
        'source': source,
        'processing': {'min_coherence': settings.get('min_coherence'), 'min_coverage': settings.get('min_coverage'),
                       'corrections': settings.get('corrections'),
                       'rate': 'sum of displacements over sum of time spans per pixel (12- and 24-day pairs)',
                       'vertical': 'ascending + descending line-of-sight rates, north motion assumed zero',
                       'reference': 'median of the whole area',
                       'reference_area_lonlat': summary.get('reference_lonlat'),
                       'reference_offsets_mm_per_year': summary.get('reference_offsets_mm_per_year'),
                       'grid_crs': f'EPSG:{epsg}', 'grid_spacing_m': spacing},
        'bbox_lonlat': bbox,
        'layers': {'vertical_rate': {
            'file': 'vertical_rate.png', 'units': 'mm/yr', 'positive': 'up',
            'bounds': [[bbox[1], bbox[0]], [bbox[3], bbox[2]]],
            'image_projection': 'pixels aligned to Web Mercator (EPSG:3857); bounds are [[south, west], [north, east]] in degrees',
            'sampling': 'nearest 80 m pixel, no interpolation across gaps',
            'colour': {'limit_mm_per_year': COLOUR_LIMIT_MM, 'alpha': OVERLAY_ALPHA, 'no_data': 'transparent',
                       'stops': [{'value': p * COLOUR_LIMIT_MM, 'colour': '#%02x%02x%02x' % c} for p, c in COLOUR_STOPS]}}},
        'values': {'file': 'vertical_grid.json', 'cell_m': VALUE_GRID_M,
                   'method': f'median of {2 * VALUE_WINDOW_PIXELS + 1}x{2 * VALUE_WINDOW_PIXELS + 1} pixels; '
                             f'empty when fewer than {VALUE_MIN_PIXELS} were measured',
                   'sigma': 'one standard error per pixel, propagated from the line-of-sight stack scatter'},
        'buildings': buildings,
        'focus': focus_meta,
        'stats': stats,
        'caveats': caveats,
        'attribution': ['NISAR data: NASA/JPL-Caltech and ISRO, distributed by the ASF DAAC'] +
                       ([buildings['attribution']] if buildings else []),
        'files': {name: {'bytes': (out / name).stat().st_size, 'sha256': sha256(out / name)} for name in files},
    }
    _write_json(out / 'manifest.json', manifest, compact=False)
    return manifest


def validate(bundle: Path) -> list[str]:
    """Problems with a bundle on disk (empty list = good). Checks schema, provenance and file hashes."""
    problems = []
    try:
        m = json.loads((bundle / 'manifest.json').read_text())
    except (OSError, ValueError) as exc:
        return [f'manifest unreadable: {exc}']
    if m.get('schema') != SCHEMA:
        problems.append(f"unknown schema {m.get('schema')!r}")
    if m.get('provenance') != 'measured':
        problems.append('provenance must be "measured"')
    if not m.get('source', {}).get('granules'):
        problems.append('no source granules recorded')
    if not m.get('caveats'):
        problems.append('no caveats recorded')
    for name, info in m.get('files', {}).items():
        p = bundle / name
        if not p.is_file():
            problems.append(f'missing {name}')
        elif sha256(p) != info.get('sha256'):
            problems.append(f'hash mismatch for {name}')
    return problems


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--ground', required=True, help='ground_motion.npz from service.ground_motion_study')
    p.add_argument('--summary', required=True, help='summary.json from the same run')
    p.add_argument('--buildings', help='buildings.geojson from service.buildings (optional)')
    p.add_argument('--notes', help='JSON list of site-specific analyst caveats, each {"id": ..., "text": ...}')
    p.add_argument('--focus', nargs='+', metavar='auto|LON LAT',
                   help='Also export one 1.2 km neighbourhood at 80 m for the 3D view: "auto" or a centre')
    p.add_argument('--osm-context', help='OSM extract (.pbf) to draw real streets and parks around the focus area')
    p.add_argument('--code-version', help='Override the detected git version of the producing code')
    p.add_argument('--id', required=True)
    p.add_argument('--title', required=True)
    p.add_argument('--out', required=True)
    args = p.parse_args(argv)
    out = Path(args.out)
    focus = None
    if args.focus:
        focus = 'auto' if args.focus == ['auto'] else tuple(float(v) for v in args.focus[:2])
    manifest = export(Path(args.ground), Path(args.summary), out, args.id, args.title,
                      Path(args.buildings) if args.buildings else None, repo=Path(__file__).resolve().parent.parent,
                      notes=json.loads(Path(args.notes).read_text()) if args.notes else None,
                      version=args.code_version, focus=focus,
                      osm_context=Path(args.osm_context) if args.osm_context else None)
    problems = validate(out)
    print(json.dumps({'stats': manifest['stats'], 'files': manifest['files'], 'problems': problems}, indent=1))
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
