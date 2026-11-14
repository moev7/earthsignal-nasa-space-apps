"""Ground-motion science core for NISAR GUNW products: pure NumPy, no I/O.

Turns per-pair unwrapped phase into line-of-sight (LOS) millimetres, stacks a chain of
pairs into a rate, joins neighbouring frames, and splits ascending + descending rates into
vertical and east components. Everything here is deterministic and unit-tested with
analytical arrays; reading products lives in ``gunw_reader`` and orchestration in
``ground_motion_study``.

Conventions (recorded in every published manifest):
- LOS displacement is positive TOWARD the satellite (uplift-like), negative AWAY (subsidence-like).
- ``PHASE_SIGN`` maps unwrapped phase to that convention. ISCE3 forms interferograms as
  reference x conj(secondary), so positive phase means the range grew (motion away from the
  satellite), hence -1. This must be confirmed against an independent reference before results
  are treated as verified; the study CLI records how it was checked.
- Rates are millimetres per year; time spans use 365.25-day years.
"""
from __future__ import annotations

import math

import numpy as np

ALGORITHM_VERSION = 'ground-motion-1.0'
PHASE_SIGN = -1.0
SPEED_OF_LIGHT = 299_792_458.0
DAYS_PER_YEAR = 365.25
MIN_REFERENCE_PIXELS = 50


class GroundMotionError(ValueError):
    """A science precondition failed; the code is stable and safe to show to users."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def wavelength_from_frequency(center_frequency_hz: float) -> float:
    if not (math.isfinite(center_frequency_hz) and 1e9 < center_frequency_hz < 2e9):
        raise GroundMotionError('UNSUPPORTED_BAND', 'Only L-band centre frequencies are supported')
    return SPEED_OF_LIGHT / center_frequency_hz


def valid_sample_mask(mask: np.ndarray) -> np.ndarray:
    """Decode the GUNW uint32 mask (spec 1.5.0) into usable land samples.

    Bits 0-7 hold a three-digit decimal: water flag, reference subswath, secondary subswath
    (0 in either subswath digit = invalid sample). Bits 8-23 are anomaly flags for the
    secondary and reference RSLCs and must all be zero. Bit 24 (ionosphere filled) is allowed.
    The 255 fill value decodes as invalid (water digit 2).
    """
    m = np.asarray(mask, dtype=np.uint32)
    low = m & 0xFF
    water, ref_sub, sec_sub = low // 100, (low // 10) % 10, low % 10
    anomalies = (m >> 8) & 0xFFFF
    return (water == 0) & (ref_sub > 0) & (sec_sub > 0) & (anomalies == 0)


def largest_component(components: np.ndarray, usable: np.ndarray) -> np.ndarray:
    """Keep only the connected component with most usable pixels.

    Separate components are unwrapped independently and can differ by whole 2*pi cycles, so
    mixing them would create false steps in the ground motion.
    """
    labels = np.where(usable & (components > 0), components, 0).astype(np.int64)
    counts = np.bincount(labels.ravel())
    if counts.size <= 1 or counts[1:].max() == 0:
        return np.zeros_like(usable, dtype=bool)
    best = int(np.argmax(counts[1:]) + 1)
    return labels == best


def pair_quality(phase, coherence, components, mask, min_coherence: float) -> np.ndarray:
    if not 0.0 < min_coherence < 1.0:
        raise GroundMotionError('BAD_THRESHOLD', 'Coherence threshold must be between 0 and 1')
    usable = np.isfinite(phase) & np.isfinite(coherence) & (coherence >= min_coherence) & valid_sample_mask(mask)
    return largest_component(components, usable)


def phase_to_los_mm(phase, wavelength_m: float, corrections=()) -> np.ndarray:
    """Unwrapped phase minus phase-screen corrections, as LOS millimetres toward the satellite."""
    corrected = np.asarray(phase, dtype=np.float64).copy()
    for screen in corrections:
        corrected -= screen
    return PHASE_SIGN * corrected * wavelength_m / (4.0 * math.pi) * 1000.0


def reference_to(values: np.ndarray, valid: np.ndarray, region: np.ndarray | None = None):
    """Subtract the median over a reference region (or all valid pixels); invalid -> NaN."""
    pick = valid if region is None else (valid & region)
    if int(pick.sum()) < MIN_REFERENCE_PIXELS:
        raise GroundMotionError('REFERENCE_EMPTY', 'Too few reliable pixels in the reference area')
    ref = float(np.median(values[pick]))
    return np.where(valid, values - ref, np.nan), ref


def stack_rate(displacements_mm, spans_days, min_coverage: float = 0.6, min_pairs: int = 3):
    """Rate from a chain of pairs by interferogram stacking: sum(displacement) / sum(time).

    Each pixel uses only the pairs where it was reliable. Returns rate (mm/yr), its standard
    error (mm/yr), the number of pairs used, and the fraction of the chain's time covered.
    Pixels below ``min_coverage`` or ``min_pairs`` are NaN ("not measured").
    """
    d = np.stack([np.asarray(x, dtype=np.float64) for x in displacements_mm])
    t = np.asarray(spans_days, dtype=np.float64)
    if d.shape[0] != t.size or d.shape[0] == 0 or np.any(t <= 0):
        raise GroundMotionError('BAD_STACK', 'Each pair needs a positive time span')
    ok = np.isfinite(d)
    tt = np.where(ok, t[:, None, None], 0.0)
    n = ok.sum(axis=0)
    covered = tt.sum(axis=0)
    total = np.where(ok, d, 0.0).sum(axis=0)
    with np.errstate(invalid='ignore', divide='ignore'):
        rate_per_day = total / covered
        resid = np.where(ok, d - rate_per_day[None] * t[:, None, None], 0.0)
        se_per_day = np.sqrt((resid ** 2).sum(axis=0) * n / np.maximum(n - 1, 1)) / covered
    coverage = covered / t.sum()
    keep = (coverage >= min_coverage) & (n >= min_pairs)
    rate = np.where(keep, rate_per_day * DAYS_PER_YEAR, np.nan)
    sigma = np.where(keep, se_per_day * DAYS_PER_YEAR, np.nan)
    return rate, sigma, np.where(keep, n, 0), np.where(keep, coverage, 0.0)


def chain_gaps(pairs):
    """Return (end, next_start) date pairs where a sequential chain is broken."""
    ordered = sorted(pairs)
    return [(a[1], b[0]) for a, b in zip(ordered, ordered[1:]) if a[1] != b[0]]


def _grid_index(coords: np.ndarray, spacing: float) -> np.ndarray:
    idx = coords / spacing
    rounded = np.round(idx)
    if np.max(np.abs(idx - rounded)) > 1e-6:
        raise GroundMotionError('GRID_MISMATCH', 'Grids are not on a shared lattice')
    return rounded.astype(np.int64)


def mosaic(tiles, spacing: float, min_overlap: int = 200, align: bool = True):
    """Join frames on a shared lattice: (x_centres, y_centres, values) tiles.

    Pixel centres must be ``offset + k * spacing`` for one shared offset. With ``align``, each
    later tile is shifted by the median difference over its overlap with what is already placed
    (frames carry independent reference offsets); without it (uncertainties, unit vectors)
    tiles are only averaged.
    Returns (x, y, values, offsets_applied).
    """
    if not tiles:
        raise GroundMotionError('NO_TILES', 'Nothing to join')
    origin_x = float(np.asarray(tiles[0][0], float)[0]) % spacing
    origin_y = float(np.asarray(tiles[0][1], float)[0]) % spacing
    xi = [_grid_index(np.asarray(t[0], float) - origin_x, spacing) for t in tiles]
    yi = [_grid_index(np.asarray(t[1], float) - origin_y, -spacing) for t in tiles]   # rows run north -> south
    x0, x1 = min(a[0] for a in xi), max(a[-1] for a in xi)
    y0, y1 = min(a[0] for a in yi), max(a[-1] for a in yi)
    total = np.zeros((y1 - y0 + 1, x1 - x0 + 1))
    count = np.zeros_like(total)
    offsets = []
    for (_, _, vals), ix, iy in zip(tiles, xi, yi):
        vals = np.asarray(vals, float)
        rows, cols = slice(iy[0] - y0, iy[-1] - y0 + 1), slice(ix[0] - x0, ix[-1] - x0 + 1)
        with np.errstate(invalid='ignore'):
            placed = np.where(count[rows, cols] > 0, total[rows, cols] / np.maximum(count[rows, cols], 1), np.nan)
        both = np.isfinite(placed) & np.isfinite(vals)
        shift = 0.0
        if align and count.any():
            if int(both.sum()) < min_overlap:
                raise GroundMotionError('NO_OVERLAP', 'Frames overlap too little to align them')
            shift = float(np.median(placed[both] - vals[both]))
        offsets.append(shift)
        good = np.isfinite(vals)
        total[rows, cols] += np.where(good, vals + shift, 0.0)
        count[rows, cols] += good
    with np.errstate(invalid='ignore'):
        out = np.where(count > 0, total / count, np.nan)
    x = origin_x + np.arange(x0, x1 + 1) * spacing
    y = origin_y - np.arange(y0, y1 + 1) * spacing
    return x, y, out, offsets


def _window_sum(a: np.ndarray, k: int) -> np.ndarray:
    """Sum over a (2k+1) x (2k+1) window at every pixel (zero outside), via integral images."""
    p = np.pad(a, ((k + 1, k), (k + 1, k)))
    c = p.cumsum(0).cumsum(1)
    n = 2 * k + 1
    return c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n]


def local_plane_fit(values: np.ndarray, spacing_m: float, half_window: int, min_pixels: int):
    """Fit z = a + gx*dx + gy*dy over a square window around every pixel (NaN = not measured).

    Returns (a, gx, gy, sigma_gx, sigma_gy, n): the local mean, the slope east and north in
    value-units per metre, their standard errors from the window residuals, and the number of
    measured pixels used. Windows with fewer than ``min_pixels`` give NaN. Measuring slope over
    a window (rather than between neighbouring pixels) keeps per-pixel noise from turning into
    false tilts; the standard errors say how far the slope can be trusted.
    """
    if half_window < 1 or min_pixels < 4:
        raise GroundMotionError('BAD_WINDOW', 'The slope window is too small')
    z = np.asarray(values, float)
    w = np.isfinite(z).astype(float)
    z0 = np.where(w > 0, z, 0.0)
    k = half_window
    rows, cols = z.shape
    # Offsets are measured from the window centre, so the sums below use local coordinates.
    yy, xx = np.mgrid[0:rows, 0:cols].astype(float)
    s = {name: _window_sum(arr, k) for name, arr in {
        'n': w, 'x': w * xx, 'y': w * yy, 'xx': w * xx * xx, 'yy': w * yy * yy, 'xy': w * xx * yy,
        'z': z0, 'xz': z0 * xx, 'yz': z0 * yy, 'zz': z0 * z0}.items()}
    n = s['n']
    # Shift sums to local coordinates (u = x - xc, v = y - yc).
    sx, sy = s['x'] - n * xx, s['y'] - n * yy
    sxx = s['xx'] - 2 * xx * s['x'] + n * xx * xx
    syy = s['yy'] - 2 * yy * s['y'] + n * yy * yy
    sxy = s['xy'] - xx * s['y'] - yy * s['x'] + n * xx * yy
    sxz, syz = s['xz'] - xx * s['z'], s['yz'] - yy * s['z']
    a_mat = np.stack([np.stack([n, sx, sy], -1), np.stack([sx, sxx, sxy], -1), np.stack([sy, sxy, syy], -1)], -2)
    b = np.stack([s['z'], sxz, syz], -1)
    ok = n >= min_pixels
    det = np.linalg.det(np.where(ok[..., None, None], a_mat, np.eye(3)))
    ok &= np.abs(det) > 1e-9
    a_safe = np.where(ok[..., None, None], a_mat, np.eye(3))
    beta = np.linalg.solve(a_safe, np.where(ok[..., None], b, 0.0)[..., None])[..., 0]
    rss = np.maximum(s['zz'] - (beta * np.where(ok[..., None], b, 0.0)).sum(-1), 0.0)
    with np.errstate(invalid='ignore', divide='ignore'):
        var = rss / np.maximum(n - 3, 1)
        inv = np.linalg.inv(a_safe)
    nan = np.where(ok, 1.0, np.nan)
    # Pixel units -> metres: x grows east; rows grow south, so north slope is -d/drow.
    gx = beta[..., 1] / spacing_m * nan
    gy = -beta[..., 2] / spacing_m * nan
    sgx = np.sqrt(var * inv[..., 1, 1]) / spacing_m * nan
    sgy = np.sqrt(var * inv[..., 2, 2]) / spacing_m * nan
    return beta[..., 0] * nan, gx, gy, sgx, sgy, np.where(ok, n, 0).astype(int)


def decompose_up_east(asc_los, desc_los, asc_vec, desc_vec):
    """Vertical and east motion from ascending and descending LOS (north motion assumed zero).

    ``*_vec`` are (east, north, up) unit-vector components from the ground toward the
    satellite; LOS toward the satellite = east*vE + north*vN + up*vU. With vN = 0 this is a
    2x2 system per pixel. Pixels where the geometries are nearly parallel return NaN.
    """
    ae, _, au = (np.asarray(c, float) for c in asc_vec)
    de, _, du = (np.asarray(c, float) for c in desc_vec)
    det = ae * du - de * au
    with np.errstate(invalid='ignore', divide='ignore'):
        ok = np.abs(det) > 0.1
        v_up = np.where(ok, (ae * desc_los - de * asc_los) / det, np.nan)
        v_east = np.where(ok, (du * asc_los - au * desc_los) / det, np.nan)
    return v_up, v_east


def decompose_up_sigma(asc_sigma, desc_sigma, asc_vec, desc_vec):
    """Standard error of the vertical rate from ``decompose_up_east``, treating the two LOS errors as independent."""
    ae, _, au = (np.asarray(c, float) for c in asc_vec)
    de, _, du = (np.asarray(c, float) for c in desc_vec)
    det = ae * du - de * au
    with np.errstate(invalid='ignore', divide='ignore'):
        return np.where(np.abs(det) > 0.1, np.hypot(de * asc_sigma, ae * desc_sigma) / np.abs(det), np.nan)


def bilinear(x_src, y_src, field, x_dst, y_dst):
    """Separable bilinear resample of a coarse grid onto 1-D destination axes."""
    xs, ys, f = np.asarray(x_src, float), np.asarray(y_src, float), np.asarray(field, float)
    if xs[0] > xs[-1]:
        xs, f = xs[::-1], f[:, ::-1]
    if ys[0] > ys[-1]:
        ys, f = ys[::-1], f[::-1]
    fx = np.stack([np.interp(x_dst, xs, row) for row in f])          # (len(ys), len(x_dst))
    return np.stack([np.interp(y_dst, ys, col) for col in fx.T]).T   # (len(y_dst), len(x_dst))


def interpolate_height(heights, cube, target_height: float):
    """Linear interpolation of a (height, y, x) cube at one height."""
    h = np.asarray(heights, float)
    if not h[0] <= target_height <= h[-1]:
        raise GroundMotionError('HEIGHT_RANGE', 'Reference height is outside the metadata cube')
    k = int(np.clip(np.searchsorted(h, target_height) - 1, 0, h.size - 2))
    w = (target_height - h[k]) / (h[k + 1] - h[k])
    return (1 - w) * np.asarray(cube[k], float) + w * np.asarray(cube[k + 1], float)


def lonlat_to_utm(lon, lat, zone: int):
    """WGS84 longitude/latitude to UTM (northern hemisphere) metres, Krueger series (~mm)."""
    a, f, k0 = 6378137.0, 1 / 298.257223563, 0.9996
    n = f / (2 - f)
    big_a = a / (1 + n) * (1 + n ** 2 / 4 + n ** 4 / 64)
    alpha = (n / 2 - 2 * n ** 2 / 3 + 5 * n ** 3 / 16, 13 * n ** 2 / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240)
    e = 2 * math.sqrt(n) / (1 + n)
    phi = np.radians(np.asarray(lat, float))
    lam = np.radians(np.asarray(lon, float)) - math.radians(zone * 6 - 183)
    t = np.sinh(np.arctanh(np.sin(phi)) - e * np.arctanh(e * np.sin(phi)))
    xi = np.arctan2(t, np.cos(lam))
    eta = np.arctanh(np.sin(lam) / np.sqrt(1 + t ** 2))
    east = eta + sum(al * np.cos(2 * j * xi) * np.sinh(2 * j * eta) for j, al in enumerate(alpha, 1))
    north = xi + sum(al * np.sin(2 * j * xi) * np.cosh(2 * j * eta) for j, al in enumerate(alpha, 1))
    return 500000.0 + k0 * big_a * east, k0 * big_a * north


def utm_zone_from_epsg(epsg: int) -> int:
    if not 32601 <= epsg <= 32660:
        raise GroundMotionError('UNSUPPORTED_CRS', 'Only northern-hemisphere UTM grids are supported')
    return epsg - 32600
