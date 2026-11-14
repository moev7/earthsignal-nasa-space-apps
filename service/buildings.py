"""Building footprints from OpenStreetMap, rated by the measured ground tilt beneath them.

What this can and cannot say:
- The NISAR map has 80 m pixels, larger than most buildings. We measure how fast the GROUND
  tilts over a few hundred metres (a local plane fit, with its uncertainty), not how a single
  building bends. A steady tilt makes a building lean and strains pipes and roads; whether it
  cracks depends on how the slope changes across the footprint and how the building is built,
  which this data cannot resolve. Results are therefore "ground tilt" ratings, never damage.
- Where the tilt is smaller than twice its uncertainty the rating is "not enough evidence";
  where the ground was not measured it is "not measured" (never "no risk").
- Footprints are a dated OpenStreetMap snapshot (c) OpenStreetMap contributors, ODbL 1.0.
  Heights come from OSM tags; missing heights use a default and are flagged as estimated.

Example:
    python -m service.buildings --bbox 51.05 35.55 51.45 35.72 \
        --ground /tmp/tehran-gm/ground_motion.npz --out /tmp/tehran-buildings
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import ground_motion as gm

OVERPASS = 'https://overpass-api.de/api/interpreter'
OSM_HOSTS = frozenset({'overpass-api.de'})
ATTRIBUTION = '© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)'
USER_AGENT = 'Earthsignal-Buildings/1.0'
MAX_RESPONSE_BYTES = 400 * 1024 * 1024
FLOOR_HEIGHT_M = 3.2
DEFAULT_FLOORS = 4
# Bjerrum (1963) levels, as "1 in N". Applied here to ground tilt, as context for how long the
# measured tilt would take to reach each level; not a statement about any building's damage.
LEVELS = (500, 300, 250, 150)
SLOPE_WINDOW_PIXELS = 3          # half-width: 7 x 7 pixels = 560 m at 80 m spacing
MIN_WINDOW_PIXELS = 20


def overpass_query(bbox, count_only: bool = False) -> str:
    w, s, e, n = bbox
    out = 'out count;' if count_only else 'out tags geom;'
    return f'[out:json][timeout:600][maxsize:{MAX_RESPONSE_BYTES}];way["building"]({s},{w},{n},{e});{out}'


def fetch_overpass(bbox, count_only: bool = False) -> dict:
    url = OVERPASS
    if urllib.parse.urlsplit(url).hostname not in OSM_HOSTS:
        raise ValueError('Overpass host is not allowlisted')

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise ValueError('Unexpected Overpass redirect')

    body = urllib.parse.urlencode({'data': overpass_query(bbox, count_only)}).encode()
    req = urllib.request.Request(url, data=body, headers={'User-Agent': USER_AGENT})
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=900) as response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ValueError('Overpass response exceeded the size cap; narrow the area')
    return json.loads(raw)


def extract_from_pbf(pbf_path: Path, bbox) -> dict:
    """Building ways inside ``bbox`` from a downloaded OSM extract, shaped like an Overpass reply.

    For bulk work the public Overpass service asks users to avoid heavy automated queries; a
    Geofabrik country extract is the intended route. Needs the optional ``osmium`` package
    (offline preparation only, not a service runtime dependency).
    """
    import osmium

    w, s, e, n = bbox
    elements = []
    proc = osmium.FileProcessor(str(pbf_path)).with_locations().with_filter(osmium.filter.KeyFilter('building'))
    for obj in proc:
        if not obj.is_way():
            continue
        try:
            pts = [(nd.location.lon, nd.location.lat) for nd in obj.nodes]
        except osmium.InvalidLocationError:
            continue
        if not pts or not any(w <= lon <= e and s <= lat <= n for lon, lat in pts):
            continue
        elements.append({'type': 'way', 'id': obj.id, 'tags': dict(obj.tags),
                         'geometry': [{'lon': lon, 'lat': lat} for lon, lat in pts]})
    header = osmium.io.Reader(str(pbf_path), osmium.osm.osm_entity_bits.NOTHING).header()
    stamp = header.get('osmosis_replication_timestamp') or None
    return {'osm3s': {'timestamp_osm_base': stamp, 'source': f'OSM extract {Path(pbf_path).name}'},
            'elements': elements}


# Street classes kept for the 3D context layer, with a drawn width in metres.
ROAD_WIDTHS = {'motorway': 22, 'trunk': 20, 'primary': 16, 'secondary': 13, 'tertiary': 11,
               'unclassified': 8, 'residential': 8, 'living_street': 7, 'service': 5, 'pedestrian': 6}
GREEN = {('leisure', 'park'), ('leisure', 'garden'), ('leisure', 'pitch'), ('landuse', 'grass'),
         ('landuse', 'recreation_ground'), ('landuse', 'forest'), ('landuse', 'orchard'), ('natural', 'wood')}


def context_kind(tags: dict) -> str | None:
    """'road:<class>', 'green' or 'water' for the ways the 3D view draws, else None."""
    hw = tags.get('highway')
    if hw in ROAD_WIDTHS:
        return f'road:{hw}'
    if any(tags.get(k) == v for k, v in GREEN):
        return 'green'
    if tags.get('natural') == 'water' or tags.get('waterway') in ('river', 'canal'):
        return 'water'
    return None


def extract_context(pbf_path: Path, bbox) -> list[dict]:
    """Streets, green areas and water inside ``bbox`` from an OSM extract (for drawing, not analysis)."""
    import osmium

    w, s, e, n = bbox
    out = []
    proc = osmium.FileProcessor(str(pbf_path)).with_locations().with_filter(
        osmium.filter.KeyFilter('highway', 'leisure', 'landuse', 'natural', 'waterway'))
    for obj in proc:
        if not obj.is_way():
            continue
        kind = context_kind(dict(obj.tags))
        if not kind:
            continue
        try:
            pts = [(nd.location.lon, nd.location.lat) for nd in obj.nodes]
        except osmium.InvalidLocationError:
            continue
        if len(pts) >= 2 and any(w <= lon <= e and s <= lat <= n for lon, lat in pts):
            out.append({'kind': kind, 'coords': [[round(a, 7), round(b, 7)] for a, b in pts]})
    return out


_NUMBER = re.compile(r'^\s*(\d+(?:[.,]\d+)?)\s*(m|meters?|metres?)?\s*$', re.I)


def parse_height(tags: dict) -> tuple[float, str]:
    """Height in metres and its source: 'height' tag, 'levels' tag, or 'default' (estimated)."""
    m = _NUMBER.match(str(tags.get('height', '')))
    if m:
        h = float(m.group(1).replace(',', '.'))
        if 2.0 <= h <= 400.0:
            return h, 'height'
    m = _NUMBER.match(str(tags.get('building:levels', '')))
    if m and not m.group(2):
        levels = float(m.group(1).replace(',', '.'))
        if 1 <= levels <= 120:
            return round(levels * FLOOR_HEIGHT_M, 1), 'levels'
    return DEFAULT_FLOORS * FLOOR_HEIGHT_M, 'default'


def parse_buildings(osm: dict) -> list[dict]:
    """Closed building ways with at least three distinct corners."""
    out = []
    for el in osm.get('elements', []):
        if el.get('type') != 'way' or 'building' not in el.get('tags', {}):
            continue
        ring = [(round(p['lon'], 7), round(p['lat'], 7)) for p in el.get('geometry', []) if p]
        if len(ring) < 4 or ring[0] != ring[-1] or len(set(ring)) < 3:
            continue
        height, source = parse_height(el['tags'])
        out.append({'id': int(el['id']), 'ring': ring, 'height_m': height, 'height_source': source})
    return out


def rate_tilt(tilt_per_year: float, sigma: float) -> tuple[str, dict]:
    """Category and years-to-level for a ground tilt rate (dimensionless per year)."""
    if not (math.isfinite(tilt_per_year) and math.isfinite(sigma)):
        return 'not_measured', {}
    if tilt_per_year <= 0 or tilt_per_year < 2 * sigma:
        return 'not_enough_evidence', {}
    years = {f'years_to_1_in_{n}': round((1 / n) / tilt_per_year, 1) for n in LEVELS}
    y500 = years['years_to_1_in_500']
    return ('high' if y500 <= 10 else 'elevated' if y500 <= 30 else 'low'), years


def tilt_from_slopes(gx: float, gy: float, sgx: float, sgy: float) -> tuple[float, float]:
    """Tilt magnitude and its standard error (first-order), in the slopes' units."""
    if not all(math.isfinite(v) for v in (gx, gy, sgx, sgy)):
        return float('nan'), float('nan')
    tilt = math.hypot(gx, gy)
    if tilt == 0:
        return 0.0, math.hypot(sgx, sgy)
    return tilt, math.hypot(gx * sgx, gy * sgy) / tilt


def assess(buildings, x, y, epsg: int, vertical_rate, spacing: float):
    """Attach measured vertical rate (negative = sinking) and ground-tilt ratings to each building (nearest-pixel sample)."""
    mean, gx, gy, sgx, sgy, n = gm.local_plane_fit(vertical_rate, spacing, SLOPE_WINDOW_PIXELS, MIN_WINDOW_PIXELS)
    zone = gm.utm_zone_from_epsg(epsg)
    centres = np.array([np.mean(np.array(b['ring'][:-1]), axis=0) for b in buildings]).reshape(-1, 2)
    ex, ny = gm.lonlat_to_utm(centres[:, 0], centres[:, 1], zone)
    col = np.rint((np.asarray(ex) - x[0]) / spacing).astype(int)
    row = np.rint((y[0] - np.asarray(ny)) / spacing).astype(int)
    inside = (col >= 0) & (col < x.size) & (row >= 0) & (row < y.size)
    results = []
    for i, b in enumerate(buildings):
        props = {'osm_id': b['id'], 'height_m': b['height_m'], 'height_estimated': b['height_source'] == 'default',
                 'height_source': b['height_source']}
        category = 'not_measured'
        if inside[i]:
            r, c = row[i], col[i]
            tilt_mm_m, sigma_mm_m = tilt_from_slopes(gx[r, c], gy[r, c], sgx[r, c], sgy[r, c])
            category, years = rate_tilt(tilt_mm_m * 1e-3, sigma_mm_m * 1e-3)
            if math.isfinite(mean[r, c]):
                props['vertical_mm_per_year'] = round(float(mean[r, c]), 1)
            if math.isfinite(tilt_mm_m):
                props['ground_tilt_per_year'] = float(f'{tilt_mm_m * 1e-3:.3g}')
                props['ground_tilt_sigma_per_year'] = float(f'{sigma_mm_m * 1e-3:.3g}')
                # Bearing of the downhill direction (where the ground sinks fastest), degrees from north.
                props['tilt_toward_deg'] = round(math.degrees(math.atan2(-gx[r, c], -gy[r, c])) % 360)
            props['window_pixels'] = int(n[r, c])
            props.update(years)
        props['category'] = category
        results.append({'type': 'Feature', 'properties': props,
                        'geometry': {'type': 'Polygon', 'coordinates': [[list(p) for p in b['ring']]]}})
    return results


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--bbox', type=float, nargs=4, required=True, metavar=('W', 'S', 'E', 'N'))
    p.add_argument('--ground', help='ground_motion.npz from service.ground_motion_study (needs vertical_rate)')
    p.add_argument('--out', required=True)
    p.add_argument('--count-only', action='store_true', help='Ask Overpass how many buildings; download nothing else')
    p.add_argument('--pbf', help='Read buildings from a downloaded OSM extract (e.g. Geofabrik) instead of Overpass')
    p.add_argument('--max-buildings', type=int, default=200_000)
    args = p.parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    if args.count_only:
        res = fetch_overpass(args.bbox, count_only=True)
        print(json.dumps(res.get('elements', [{}])[0].get('tags', {}), indent=1))
        return 0
    if not args.ground:
        raise SystemExit('--ground is required unless --count-only')
    snapshot = out / 'osm_buildings_snapshot.json'
    if snapshot.exists():
        osm = json.loads(snapshot.read_text())
    else:
        osm = extract_from_pbf(Path(args.pbf), args.bbox) if args.pbf else fetch_overpass(args.bbox)
        tmp = snapshot.with_suffix('.tmp')
        tmp.write_text(json.dumps(osm))
        os.replace(tmp, snapshot)
    buildings = parse_buildings(osm)
    if len(buildings) > args.max_buildings:
        raise SystemExit(f'{len(buildings)} buildings exceeds --max-buildings; narrow the area')
    z = np.load(args.ground)
    x, y, vertical = z['x'], z['y'], z['vertical_rate']
    features = assess(buildings, x, y, int(z['epsg']), vertical, float(x[1] - x[0]))
    counts: dict[str, int] = {}
    for f in features:
        counts[f['properties']['category']] = counts.get(f['properties']['category'], 0) + 1
    meta = {'attribution': ATTRIBUTION,
            'osm_snapshot': osm.get('osm3s', {}).get('timestamp_osm_base'),
            'generated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'bbox_lonlat': args.bbox, 'buildings': len(features), 'categories': counts,
            'heights': {s: sum(b['height_source'] == s for b in buildings) for s in ('height', 'levels', 'default')},
            'method': {'tilt': f'local plane fit of vertical rate over {2 * SLOPE_WINDOW_PIXELS + 1}x{2 * SLOPE_WINDOW_PIXELS + 1} pixels',
                       'significance': 'tilt must exceed twice its standard error',
                       'categories': 'years for the measured ground tilt to reach 1 in 500: high <= 10, elevated <= 30, low > 30',
                       'levels': 'Bjerrum (1963), applied to ground tilt as context only'},
            'caveat': 'Ground tilt beneath buildings, from 80 m radar pixels. Not an assessment of any building.'}
    (out / 'buildings.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'metadata': meta, 'features': features},
                                                      separators=(',', ':')))
    (out / 'buildings_summary.json').write_text(json.dumps(meta, indent=1))
    print(json.dumps(meta, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
