"""Ground-motion study from real NISAR GUNW products: catalogue -> crops -> rates -> summary.

Example (writes only under --out; crops are cached so re-runs transfer nothing):

    python -m service.ground_motion_study --bbox 51.05 35.50 51.65 35.80 \
        --reference 51.40 35.76 51.48 35.80 --out /tmp/tehran-gm --max-total-mb 950

Every run records the products used, settings, transfer totals and diagnostics in
``summary.json``. Nothing is invented: a product that fails a check is listed with its
reason and left out; areas without reliable data stay NaN ("not measured").
"""
from __future__ import annotations

import argparse
import hashlib
import math
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

import numpy as np

from . import ground_motion as gm
from .gunw_reader import PairCrop, read_crop

CMR = 'https://cmr.earthdata.nasa.gov/search/granules.json'
COLLECTIONS = ('NISAR_L2_GUNW_V1', 'NISAR_L2_GUNW_PROVISIONAL_V1')
DATA_HOST = 'nisar.asf.earthdatacloud.nasa.gov'
MAX_GRANULES = 400
TITLE = re.compile(r'^NISAR_L2_(?:PR|UR)_GUNW_\d{3}_(\d{3})_([AD])_(\d{3})_\d{3}_\d{4}_[A-Z]{2}_'
                   r'(\d{8})T\d{6}_\d{8}T\d{6}_(\d{8})T\d{6}_\d{8}T\d{6}_[A-Z]\d{5}_[A-Z]_[A-Z]_[A-Z]_\d{3}$')


def search(bbox, collection: str) -> list[dict]:
    """Bounded catalogue search; returns granules with their parsed track/frame/dates."""
    query = urllib.parse.urlencode({'short_name': collection, 'bounding_box': ','.join(map(str, bbox)),
                                    'page_size': MAX_GRANULES, 'sort_key': 'start_date'})

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise ValueError('Unexpected catalogue redirect')

    with urllib.request.build_opener(NoRedirect()).open(f'{CMR}?{query}', timeout=60) as response:
        hits = int(response.headers.get('CMR-Hits', '0'))
        raw = response.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024 or hits > MAX_GRANULES:
        raise ValueError('Catalogue result is larger than the bounded study allows; narrow the area')
    out = []
    for entry in json.loads(raw)['feed']['entry']:
        m = TITLE.match(entry['title'])
        urls = [l['href'] for l in entry.get('links', [])
                if l.get('href', '').endswith('/' + entry['title'] + '.h5')
                and urllib.parse.urlsplit(l['href']).hostname == DATA_HOST]
        if not m or len(urls) != 1:
            continue
        track, direction, frame, d0, d1 = m.groups()
        out.append({'granule': entry['title'], 'url': urls[0], 'collection': collection, 'track': int(track),
                    'direction': direction, 'frame': int(frame),
                    'reference_date': f'{d0[:4]}-{d0[4:6]}-{d0[6:]}', 'secondary_date': f'{d1[:4]}-{d1[4:6]}-{d1[6:]}'})
    return out


def bbox_to_grid(bbox, epsg: int):
    zone = gm.utm_zone_from_epsg(epsg)
    xs, ys = gm.lonlat_to_utm([bbox[0], bbox[2], bbox[0], bbox[2]], [bbox[1], bbox[1], bbox[3], bbox[3]], zone)
    return float(np.min(xs)), float(np.min(ys)), float(np.max(xs)), float(np.max(ys))


def crop_cache_identity(granule, bbox, height):
    """A crop is identified by source, footprint, geometry and reader version."""
    if (len(bbox) != 4 or any(not math.isfinite(float(v)) for v in bbox) or
            not -180 <= bbox[0] < bbox[2] <= 180 or not -90 <= bbox[1] < bbox[3] <= 90 or
            not math.isfinite(float(height))):
        raise ValueError('Invalid cached crop geometry')
    value = {'schema': 'gunw-crop-cache/2', 'granule': granule['granule'],
             'url': granule['url'], 'collection': granule['collection'],
             'bbox': list(map(float, bbox)), 'height': float(height),
             'reader': 'gunw-native-1.5.0-quality-1'}
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False,
                                    separators=(',', ':')).encode()).hexdigest()


def fetch(granule: dict, cache: Path, bbox, netrc: Path, per_file_bytes: int, height: float):
    """Return crop and transfer count. Legacy granule-only cache is not reused.

    Content-addressed source identity and request geometry prevent a different
    footprint or height silently inheriting old samples. A saved byte digest
    rejects corrupted local NPZs before reuse. Remote source mutation is checked
    when reading; an offline cached run retains its original source provenance.
    """
    key = crop_cache_identity(granule, bbox, height)
    path = cache / f"{key}.npz"
    receipt = cache / f"{key}.json"
    if path.is_file() and receipt.is_file():
        proof = json.loads(receipt.read_text())
        if proof.get('key') != key or proof.get('sha256') != hashlib.sha256(path.read_bytes()).hexdigest():
            raise gm.GroundMotionError('CACHE_IDENTITY', 'Cached crop content does not match its identity receipt')
        crop = PairCrop.load(path)
        if crop.granule != granule['granule'] or crop.reference_height_m != float(height):
            raise gm.GroundMotionError('CACHE_IDENTITY', 'Cached crop source or geometry changed')
        return crop, 0
    from .gunw_reader import open_remote
    from .range_reader import TransferBudget
    budget = TransferBudget(per_file_bytes)
    h5, asset = open_remote(granule['url'], netrc, budget)
    try:
        epsg = int(h5['science/LSAR/GUNW/grids/frequencyA/unwrappedInterferogram/projection'][()])
        crop = read_crop(h5, bbox_to_grid(bbox, epsg), reference_height_m=height)
    finally:
        h5.close()
    if crop.granule != granule['granule']:
        raise gm.GroundMotionError('IDENTITY', 'The file identity does not match the catalogue record')
    tmp = path.with_suffix('.tmp.npz')
    crop.save(tmp)
    sha = hashlib.sha256(tmp.read_bytes()).hexdigest()
    os.replace(tmp, path)
    proof = {'key': key, 'sha256': sha, 'granule': granule['granule'], 'sourceUrl': granule['url'],
             'etag': asset.etag, 'sourceBytes': asset.size, 'bbox': list(bbox),
             'referenceHeightM': height}
    staged = receipt.with_suffix('.tmp.json')
    staged.write_text(json.dumps(proof, sort_keys=True, allow_nan=False))
    os.replace(staged, receipt)
    return crop, int(budget.transferred)


def days(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def stack_frame(crops: list[PairCrop], min_coherence: float, min_coverage: float, troposphere: str = 'auto'):
    """Rate for one track/frame chain, plus per-pair diagnostics and the troposphere decision.

    ``troposphere='auto'`` applies the product's troposphere screens to the whole chain only if
    they reduce the scatter of most pairs; a weather-model screen that adds noise (seen on
    evening passes) is left out, and the decision is recorded.
    """
    pairs, diag = [], []
    for c in crops:
        valid = gm.pair_quality(c.phase, c.coherence, c.components, c.mask, min_coherence)
        base = gm.phase_to_los_mm(c.phase, c.wavelength_m, [c.ionosphere])
        corrected = gm.phase_to_los_mm(c.phase, c.wavelength_m, [c.ionosphere, c.troposphere])
        spread = lambda a: float(np.std(a[valid] - np.median(a[valid])))  # noqa: E731
        diag.append({'granule': c.granule, 'reference': c.reference_date, 'secondary': c.secondary_date,
                     'valid_fraction': round(float(valid.mean()), 4),
                     'std_mm_iono_only': round(spread(base), 2), 'std_mm_with_troposphere': round(spread(corrected), 2)})
        pairs.append((valid, base, corrected, days(c.reference_date, c.secondary_date)))
    helped = sum(d['std_mm_with_troposphere'] < d['std_mm_iono_only'] for d in diag)
    use_tropo = troposphere == 'on' or (troposphere == 'auto' and helped * 2 > len(diag))
    disp = [gm.reference_to(corr if use_tropo else base, valid)[0] for valid, base, corr, _ in pairs]
    rate, sigma, n, cov = gm.stack_rate(disp, [p[3] for p in pairs], min_coverage=min_coverage)
    decision = {'troposphere_applied': bool(use_tropo), 'pairs_where_troposphere_reduced_scatter': helped}
    return rate, sigma, n, diag, decision


def place(x, y, values, gx, gy):
    """Put a grid onto a target lattice (same spacing); NaN where it does not reach."""
    out = np.full((gy.size, gx.size), np.nan)
    ci = np.searchsorted(gx, x)
    ri = np.searchsorted(-gy, -y)
    okc = (ci < gx.size) & (np.abs(gx[np.clip(ci, 0, gx.size - 1)] - x) < 1e-3)
    okr = (ri < gy.size) & (np.abs(gy[np.clip(ri, 0, gy.size - 1)] - y) < 1e-3)
    out[np.ix_(ri[okr], ci[okc])] = np.asarray(values)[np.ix_(okr, okc)]
    return out


def quicklook(values, path: Path, limit_mm: float):
    from PIL import Image
    stops = np.array([[34, 80, 143], [110, 159, 211], [244, 241, 234], [240, 163, 94], [194, 61, 23]], float)
    v = np.clip(np.nan_to_num(values) / limit_mm, -1, 1)
    t = (1 - v) / 2 * 4                                  # sinking (negative) -> warm colours
    i = np.clip(t.astype(int), 0, 3)
    f = (t - i)[..., None]
    rgb = stops[i] * (1 - f) + stops[i + 1] * f
    rgb[~np.isfinite(values)] = [86, 96, 110]
    Image.fromarray(rgb.astype(np.uint8)).save(path)


def run(args) -> dict:
    out = Path(args.out)
    cache = out / 'cache'
    cache.mkdir(parents=True, exist_ok=True)
    granules = []
    for collection in COLLECTIONS:
        granules += search(args.bbox, collection)
    # Prefer validated over provisional for the same pair.
    chosen = {}
    for g in granules:
        key = (g['track'], g['direction'], g['frame'], g['reference_date'], g['secondary_date'])
        if key not in chosen or g['collection'] == COLLECTIONS[0]:
            chosen[key] = g
    granules = sorted(chosen.values(), key=lambda g: (g['direction'], g['track'], g['frame'], g['reference_date']))
    if args.directions:
        granules = [g for g in granules if g['direction'] in args.directions]
    summary = {'algorithm': gm.ALGORITHM_VERSION, 'bbox_lonlat': args.bbox, 'reference_lonlat': args.reference,
               'collections_searched': list(COLLECTIONS), 'granules_found': len(granules),
               'settings': {'min_coherence': args.min_coherence, 'min_coverage': args.min_coverage,
                            'reference_height_m': args.height, 'phase_sign': gm.PHASE_SIGN,
                            'los_convention': 'positive toward the satellite',
                            'troposphere_mode': args.troposphere,
                            'corrections': ['ionosphere (product)',
                                            'troposphere wet+hydrostatic (product, at reference height; per-stack decision in stacks[])']},
               'rejected': [], 'transfer_bytes': 0}
    if args.plan_only:
        summary['granules'] = granules
        return summary

    crops = defaultdict(list)
    limit = int(args.max_total_mb * 1e6)
    for g in granules:
        if summary['transfer_bytes'] >= limit:
            raise SystemExit(f"Stopped: transfer reached {summary['transfer_bytes'] / 1e6:.0f} MB, the --max-total-mb limit")
        try:
            crop, spent = fetch(g, cache, args.bbox, Path(args.netrc), int(args.per_file_mb * 1e6), args.height)
        except gm.GroundMotionError as exc:
            summary['rejected'].append({'granule': g['granule'], 'code': exc.code, 'reason': str(exc)})
            continue
        summary['transfer_bytes'] += spent
        print(f"{g['granule'][17:45]}  {spent / 1e6:6.1f} MB  total {summary['transfer_bytes'] / 1e6:7.1f} MB", flush=True)
        crops[(crop.direction, crop.track, crop.frame)].append(crop)

    results, stacks = {}, []
    for direction in sorted({k[0] for k in crops}):
        tiles, sig_tiles, vec_tiles = [], [], defaultdict(list)
        for key in sorted(k for k in crops if k[0] == direction):
            chain = sorted(crops[key], key=lambda c: c.reference_date)
            rate, sigma, n, diag, decision = stack_frame(chain, args.min_coherence, args.min_coverage, args.troposphere)
            c0 = chain[0]
            stacks.append({'direction': direction, 'track': key[1], 'frame': key[2], 'pairs': len(chain), **decision,
                           'first': chain[0].reference_date, 'last': chain[-1].secondary_date,
                           'chain_gaps': gm.chain_gaps([(c.reference_date, c.secondary_date) for c in chain]),
                           'measured_fraction': round(float(np.isfinite(rate).mean()), 4), 'pairs_detail': diag})
            tiles.append((c0.x, c0.y, rate))
            sig_tiles.append((c0.x, c0.y, sigma))
            for comp in ('los_east', 'los_north', 'los_up'):
                vec_tiles[comp].append((c0.x, c0.y, getattr(c0, comp)))
        x, y, rate, offsets = gm.mosaic(tiles, gm_spacing(crops))
        _, _, sigma, _ = gm.mosaic(sig_tiles, gm_spacing(crops), align=False)
        vecs = {comp: gm.mosaic(t, gm_spacing(crops), align=False)[2] for comp, t in vec_tiles.items()}
        results[direction] = {'x': x, 'y': y, 'rate': rate, 'sigma': sigma, 'offsets': offsets, **vecs}
    summary['stacks'] = stacks
    epsg = next(iter(crops.values()))[0].epsg
    rx0, ry0, rx1, ry1 = bbox_to_grid(args.reference, epsg)
    arrays = {'epsg': np.int32(epsg)}
    for direction, r in results.items():
        region = (r['x'][None, :] >= rx0) & (r['x'][None, :] <= rx1) & (r['y'][:, None] >= ry0) & (r['y'][:, None] <= ry1)
        r['rate'], ref = gm.reference_to(r['rate'], np.isfinite(r['rate']), region)
        summary.setdefault('reference_offsets_mm_per_year', {})[direction] = round(ref, 2)
        for k in ('x', 'y', 'rate', 'sigma', 'los_east', 'los_north', 'los_up'):
            arrays[f'{direction}_{k}'] = r[k]
        quicklook(r['rate'], out / f'los_rate_{direction}.png', args.colour_limit)
    if {'A', 'D'} <= set(results):
        a, d = results['A'], results['D']
        gx = np.union1d(a['x'], d['x'])
        gy = np.union1d(a['y'], d['y'])[::-1]
        pa = {k: place(a['x'], a['y'], a[k], gx, gy) for k in ('rate', 'los_east', 'los_north', 'los_up')}
        pd = {k: place(d['x'], d['y'], d[k], gx, gy) for k in ('rate', 'los_east', 'los_north', 'los_up')}
        up, east = gm.decompose_up_east(pa['rate'], pd['rate'], (pa['los_east'], pa['los_north'], pa['los_up']),
                                         (pd['los_east'], pd['los_north'], pd['los_up']))
        arrays.update({'x': gx, 'y': gy, 'vertical_rate': up, 'east_rate': east})
        quicklook(up, out / 'vertical_rate.png', args.colour_limit)
        finite = up[np.isfinite(up)]
        if finite.size:
            summary['vertical_rate_mm_per_year'] = {'p1': round(float(np.percentile(finite, 1)), 1),
                                                    'median': round(float(np.median(finite)), 1),
                                                    'p99': round(float(np.percentile(finite, 99)), 1),
                                                    'measured_fraction': round(float(np.isfinite(up).mean()), 4)}
    np.savez_compressed(out / 'ground_motion.npz', **arrays)
    return summary


def gm_spacing(crops) -> float:
    c = next(iter(crops.values()))[0]
    return float(c.x[1] - c.x[0])


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--bbox', type=float, nargs=4, required=True, metavar=('W', 'S', 'E', 'N'))
    p.add_argument('--reference', type=float, nargs=4, required=True, metavar=('W', 'S', 'E', 'N'),
                   help='Area assumed stable; rates are relative to its median')
    p.add_argument('--out', required=True)
    p.add_argument('--netrc', default=os.environ.get('EARTHSIGNAL_NETRC', str(Path.home() / '.netrc')))
    p.add_argument('--directions', default='AD')
    p.add_argument('--min-coherence', type=float, default=0.4)
    p.add_argument('--min-coverage', type=float, default=0.6)
    p.add_argument('--height', type=float, default=1100.0, help='Reference height for troposphere and LOS (m)')
    p.add_argument('--troposphere', choices=('auto', 'on', 'off'), default='auto',
                   help='auto: apply the product troposphere screens per stack only where they reduce scatter')
    p.add_argument('--per-file-mb', type=float, default=80.0)
    p.add_argument('--max-total-mb', type=float, default=950.0)
    p.add_argument('--colour-limit', type=float, default=150.0, help='Quick-look colour range, mm/yr')
    p.add_argument('--plan-only', action='store_true', help='List the products; transfer nothing')
    args = p.parse_args(argv)
    summary = run(args)
    text = json.dumps(summary, indent=1, default=str)
    Path(args.out).mkdir(parents=True, exist_ok=True)
    (Path(args.out) / ('plan.json' if args.plan_only else 'summary.json')).write_text(text)
    print(text if args.plan_only else json.dumps({k: v for k, v in summary.items() if k != 'stacks'}, indent=1, default=str))
    return 0


if __name__ == '__main__':
    sys.exit(main())
