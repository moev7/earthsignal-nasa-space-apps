"""Date-by-date ground motion from the NISAR pairs already used for a result bundle.

The rate map says how fast the ground moves; this module shows it moving. For every track/frame
chain it adds the sequential 12/24-day interferograms into cumulative line-of-sight (LOS)
displacement at each acquisition date, joins frames, puts both look directions on one grid,
interpolates the descending dates onto the ascending ones, and splits them into vertical motion.

Honesty rules, recorded in the manifest:
- Only pixels the rate map measured are shown (same coherence, coverage and reference rules).
- Where one pair is unreliable at a pixel, that step is bridged with the pixel's own measured
  rate (never more than the coverage rule allows); the bridged share is reported.
- Each date is referenced to the median of the whole area, like the rate map.

Example (reads cached crops, transfers nothing):

    python -m service.ground_motion_timeseries --bundle public/data/nisar/tehran-sw-2026 --cache .nisar-cache
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import numpy as np

from . import ground_motion as gm
from . import result_bundle as rb

FRAME_LIMIT_MM = 80.0          # colour limit for cumulative displacement frames


def chain_epochs(pairs):
    """Acquisition dates of a sequential chain [(reference, secondary), ...]; raises on a gap."""
    ordered = sorted(pairs)
    gaps = gm.chain_gaps(ordered)
    if gaps:
        raise gm.GroundMotionError('CHAIN_GAP', f'The chain is broken between {gaps[0][0]} and {gaps[0][1]}')
    return [ordered[0][0]] + [b for _, b in ordered]


def cumulative(displacements_mm, spans_days, rate_mm_per_year):
    """Cumulative displacement at each epoch of a sequential chain (first epoch = 0).

    A pair that is NaN at a pixel contributes rate x span instead (the pixel's own measured
    rate); pixels without a rate stay NaN at every epoch. Returns (cum[epochs, y, x], bridged
    fraction of measured pixel-steps).
    """
    d = np.stack([np.asarray(x, float) for x in displacements_mm])
    t = np.asarray(spans_days, float)
    rate = np.asarray(rate_mm_per_year, float)
    step = np.where(np.isfinite(d), d, rate[None] / gm.DAYS_PER_YEAR * t[:, None, None])
    measured = np.isfinite(rate)
    cum = np.concatenate([np.zeros((1,) + rate.shape), np.cumsum(step, axis=0)])
    cum[:, ~measured] = np.nan
    bridged = float((~np.isfinite(d))[:, measured].mean()) if measured.any() else 0.0
    return cum, bridged


def interpolate_epochs(values, from_dates, to_dates):
    """Linear interpolation in time of a (epochs, y, x) stack; held at the ends (no extrapolation)."""
    src = np.array([date.fromisoformat(d).toordinal() for d in from_dates], float)
    out = []
    for d in to_dates:
        t = float(np.clip(date.fromisoformat(d).toordinal(), src[0], src[-1]))
        k = int(np.clip(np.searchsorted(src, t, side='right') - 1, 0, src.size - 2))
        w = (t - src[k]) / (src[k + 1] - src[k])
        out.append((1 - w) * values[k] + w * values[k + 1])
    return np.stack(out)


def chain_cumulative(chain, min_coherence: float, min_coverage: float, troposphere: bool):
    """Cumulative LOS displacement for one track/frame chain of PairCrops."""
    chain = sorted(chain, key=lambda c: c.reference_date)
    epochs = chain_epochs([(c.reference_date, c.secondary_date) for c in chain])
    disp, spans = [], []
    for c in chain:
        valid = gm.pair_quality(c.phase, c.coherence, c.components, c.mask, min_coherence)
        screens = [c.ionosphere, c.troposphere] if troposphere else [c.ionosphere]
        disp.append(gm.reference_to(gm.phase_to_los_mm(c.phase, c.wavelength_m, screens), valid)[0])
        spans.append((date.fromisoformat(c.secondary_date) - date.fromisoformat(c.reference_date)).days)
    rate, *_ = gm.stack_rate(disp, spans, min_coverage=min_coverage)
    cum, bridged = cumulative(disp, spans, rate)
    return epochs, cum, bridged


def build(crops, decisions, min_coherence: float, min_coverage: float):
    """Vertical cumulative displacement per ascending date on the union grid of both directions."""
    from .ground_motion_study import place
    per_dir, report = {}, []
    for direction in ('A', 'D'):
        keys = sorted(k for k in crops if k[0] == direction)
        if not keys:
            raise gm.GroundMotionError('NO_DIRECTION', f'No {direction} pairs in the cache')
        tiles, vec_tiles, epochs = [], defaultdict(list), None
        for key in keys:
            e, cum, bridged = chain_cumulative(crops[key], min_coherence, min_coverage, decisions.get(key, False))
            if epochs is not None and e != epochs:
                raise gm.GroundMotionError('EPOCHS', 'Frames of one direction must share acquisition dates')
            epochs = e
            c0 = crops[key][0]
            tiles.append((c0.x, c0.y, cum))
            for comp in ('los_east', 'los_north', 'los_up'):
                vec_tiles[comp].append((c0.x, c0.y, getattr(c0, comp)))
            report.append({'direction': key[0], 'track': key[1], 'frame': key[2], 'epochs': len(e),
                           'bridged_fraction': round(bridged, 4)})
        spacing = float(tiles[0][0][1] - tiles[0][0][0])
        frames = []
        for k in range(len(epochs)):
            x, y, v, _ = gm.mosaic([(tx, ty, c[k]) for tx, ty, c in tiles], spacing, align=k > 0)
            frames.append(v)
        vecs = {comp: gm.mosaic(t, spacing, align=False)[2] for comp, t in vec_tiles.items()}
        per_dir[direction] = {'x': x, 'y': y, 'epochs': epochs, 'cum': np.stack(frames), **vecs}
    a, d = per_dir['A'], per_dir['D']
    gx = np.union1d(a['x'], d['x'])
    gy = np.union1d(a['y'], d['y'])[::-1]
    on = lambda r, v: place(r['x'], r['y'], v, gx, gy)  # noqa: E731
    acum = np.stack([on(a, v) for v in a['cum']])
    dcum = np.stack([on(d, v) for v in d['cum']])
    for stack in (acum, dcum):                      # whole-area median reference at every date
        for k in range(stack.shape[0]):
            f = stack[k][np.isfinite(stack[k])]
            if f.size:
                stack[k] -= np.median(f)
    dcum = interpolate_epochs(dcum, d['epochs'], a['epochs'])
    av = tuple(on(a, a[c]) for c in ('los_east', 'los_north', 'los_up'))
    dv = tuple(on(d, d[c]) for c in ('los_east', 'los_north', 'los_up'))
    up = np.stack([gm.decompose_up_east(acum[k], dcum[k], av, dv)[0] for k in range(acum.shape[0])])
    return gx, gy, a['epochs'], up, report


def load_crops(granules, cache: Path, bbox=None, *, allow_legacy=False):
    from .gunw_reader import PairCrop
    crops, missing = defaultdict(list), []
    receipts = []
    for receipt in cache.glob('*.json'):
        value = json.loads(receipt.read_text())
        if isinstance(value, dict) and 'key' in value and 'granule' in value:
            receipts.append(value)
    for name in granules:
        matches = [v for v in receipts if v['granule'] == name and
                   (bbox is None or v.get('bbox') == list(bbox))]
        if len(matches) > 1:
            raise gm.GroundMotionError('CACHE_AMBIGUOUS', 'Multiple crop geometries match this study; use an isolated study cache')
        if matches:
            proof = matches[0]
            if not __import__('re').fullmatch('[a-f0-9]{64}', proof['key']):
                raise gm.GroundMotionError('CACHE_IDENTITY', 'Unsafe crop cache identity')
            path = cache / (proof['key'] + '.npz')
            if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != proof.get('sha256'):
                raise gm.GroundMotionError('CACHE_IDENTITY', 'Crop cache content changed')
        else:
            # Read-only compatibility for the original frozen study's legacy cache.
            # New processing never reuses or creates these granule-only entries.
            path = cache / f'{name}.npz'
            if path.exists() and not allow_legacy:
                raise gm.GroundMotionError('CACHE_IDENTITY', 'Legacy crops have no verified geometry receipt; migrate or explicitly inspect the historical cache before reuse')
        if not path.exists():
            missing.append(name)
            continue
        c = PairCrop.load(path)
        if c.granule != name:
            raise gm.GroundMotionError('CACHE_IDENTITY', 'Crop source does not match study granule')
        crops[(c.direction, c.track, c.frame)].append(c)
    if missing:
        raise gm.GroundMotionError('CACHE_MISSING', f'{len(missing)} granules are not cached, e.g. {missing[0]}')
    return crops


def export(bundle: Path, cache: Path) -> dict:
    """Add frames/vertical_<date>.png and timeseries.json to an existing bundle and re-hash its manifest."""
    from PIL import Image

    manifest = json.loads((bundle / 'manifest.json').read_text())
    src, proc = manifest['source'], manifest['processing']
    crops = load_crops(src['granules'], cache, manifest['bbox_lonlat'])
    decisions = {(s['direction'], s['track'], s['frame']): bool(s['troposphere_applied']) for s in src['stacks']}
    gx, gy, epochs, up, report = build(crops, decisions, proc['min_coherence'], proc['min_coverage'])
    zone = gm.utm_zone_from_epsg(int(proc['grid_crs'].split(':')[1]))
    bbox = manifest['bbox_lonlat']

    frames_dir = bundle / 'frames'
    frames_dir.mkdir(exist_ok=True)
    for old in frames_dir.glob('vertical_*.png'):
        old.unlink()
    for name in [n for n in manifest['files'] if n.startswith('frames/')]:
        del manifest['files'][name]
    lon, lat = rb.mercator_lattice(bbox, float(gx[1] - gx[0]))
    names, grids = [], []
    for day, frame in zip(epochs, up):
        img, *_ = rb.sample_nearest(gx, gy, frame, lon, lat, zone)
        name = f'frames/vertical_{day}.png'
        Image.fromarray(rb.colourise(img, FRAME_LIMIT_MM), 'RGBA').save(bundle / name, optimize=True)
        names.append(name)
        grids.append(rb.value_grid(gx, gy, frame, np.zeros_like(frame), bbox, zone)[0])
    g0 = grids[0]
    rb._write_json(bundle / 'timeseries.json', {
        'dates': epochs, 'units': 'mm', 'positive': 'up',
        'grid': {k: g0[k] for k in ('west', 'north', 'dlon', 'dlat', 'cols', 'rows', 'order')},
        'cell_method': manifest['values']['method'],
        'vertical_mm': [g['vertical_rate'] for g in grids]})

    last = up[-1][np.isfinite(up[-1])]
    manifest['timeseries'] = {
        'file': 'timeseries.json', 'frames': names, 'dates': epochs, 'units': 'mm', 'positive': 'up',
        'colour': {'limit_mm': FRAME_LIMIT_MM,
                   'stops': [{'value': p * FRAME_LIMIT_MM, 'colour': '#%02x%02x%02x' % c} for p, c in rb.COLOUR_STOPS]},
        'method': ('sequential pairs added per track/frame into cumulative line-of-sight displacement; '
                   'descending dates interpolated linearly onto the ascending dates; vertical from both '
                   'directions with north motion assumed zero; each date referenced to the whole-area median'),
        'bridging': "a step unreliable at a pixel is filled with that pixel's measured rate x the step length",
        'chains': report,
        'days': (date.fromisoformat(epochs[-1]) - date.fromisoformat(epochs[0])).days,
        'fastest_1pct_mm': round(float(np.percentile(last, 1)), 1) if last.size else None,
    }
    for name in names + ['timeseries.json']:
        manifest['files'][name] = {'bytes': (bundle / name).stat().st_size, 'sha256': rb.sha256(bundle / name)}
    rb._write_json(bundle / 'manifest.json', manifest, compact=False)
    return manifest['timeseries']


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--bundle', required=True, help='Existing result bundle directory (its manifest lists the granules)')
    p.add_argument('--cache', required=True, help='Directory of cached PairCrop .npz files')
    args = p.parse_args(argv)
    meta = export(Path(args.bundle), Path(args.cache))
    problems = rb.validate(Path(args.bundle))
    print(json.dumps({**{k: v for k, v in meta.items() if k not in ('frames', 'colour')}, 'problems': problems}, indent=1))
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
