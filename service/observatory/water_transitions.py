"""Class-1 indicator accounting on native common support, not field truth."""
import math
import re
import numpy as np
from .methods import array_hash
from .vintages import canonical_hash

VERSION = 'class1-common-pixel-transition-v1'
CATEGORIES = ('gain', 'loss', 'persistentClass1', 'nonClass1Both', 'unknown')
HASHES = ('grid', 'areaMask', 'commonMask', 'beforeIndicator', 'afterIndicator', 'categories')
MAX_PIXELS = 1_000_000


def _require(ok):
    if not ok:
        raise ValueError('Invalid class-1 transition accounting')


def _number(value):
    try:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    except OverflowError:
        return False


def _grid(grid):
    _require(isinstance(grid, dict) and set(grid) == {'crs', 'resolution', 'transform', 'width', 'height', 'aggregation', 'aoiPolicy'})
    _require(isinstance(grid['crs'], str) and bool(grid['crs']) and len(grid['crs']) <= 10000)
    _require(isinstance(grid['aoiPolicy'], str) and bool(grid['aoiPolicy']) and len(grid['aoiPolicy']) <= 4096)
    _require(all(type(grid[k]) is int and grid[k] > 0 for k in ('width', 'height')))
    _require(grid['width'] * grid['height'] <= MAX_PIXELS)
    resolution = grid['resolution']
    _require(_number(resolution) and resolution > 0)
    t = grid['transform']
    _require(isinstance(t, list) and len(t) == 6 and all(_number(v) for v in t))
    _require(t[2] == t[4] == 0 and t[1] == resolution and abs(t[5] + resolution) <= 1e-6)
    _require(isinstance(grid['aggregation'], dict) and bool(grid['aggregation']))
    _require(all(isinstance(k, str) and 0 < len(k) <= 128 and type(v) is int and 1 <= v <= 6 for k, v in grid['aggregation'].items()))
    pixel_area = float(resolution) * float(resolution) / 1e6
    _require(math.isfinite(pixel_area) and pixel_area > 0)
    return pixel_area


def classify_transitions(before, after, before_valid, after_valid, area, grid):
    """Return detached JSON accounting and uint8 category codes.

    The producer must already establish product/method compatibility and a
    projected metre grid. Binary zero is not class 1, including partial water.
    Invalid and outside-area values never become zero-valued observations.
    """
    pixel_area = _grid(grid)
    shape = (grid['height'], grid['width'])
    arrays = (before, after, before_valid, after_valid, area)
    _require(all(isinstance(a, np.ndarray) and a.ndim == 2 and a.shape == shape for a in arrays))
    _require(all(a.dtype == np.bool_ for a in (before_valid, after_valid, area)))
    _require(all(a.dtype.kind in 'biuf' for a in (before, after)))
    total = int(np.count_nonzero(area))
    _require(total > 0)
    bv = before_valid & area; av = after_valid & area
    for values, valid in ((before, bv), (after, av)):
        _require(bool(np.all(np.isfinite(values[valid]) & ((values[valid] == 0) | (values[valid] == 1)))))
    common = bv & av
    valid_count = int(np.count_nonzero(common))
    _require(valid_count > 0)
    codes = np.full(shape, 255, dtype=np.uint8)
    codes[area] = 4
    codes[common & (before == 0) & (after == 0)] = 0
    codes[common & (before == 0) & (after == 1)] = 1
    codes[common & (before == 1) & (after == 0)] = 2
    codes[common & (before == 1) & (after == 1)] = 3
    counts = {key: int(np.count_nonzero(codes == code)) for key, code in
              zip(CATEGORIES, (1, 2, 3, 0, 4))}
    report = dict(methodVersion=VERSION, classDefinition='mapped-class1-indicator',
        totalPixels=total, validPixels=valid_count, pixelAreaKm2=pixel_area,
        counts=counts, areasKm2={k: v * pixel_area for k, v in counts.items()},
        netChangeKm2=(counts['gain'] - counts['loss']) * pixel_area,
        turnoverKm2=(counts['gain'] + counts['loss']) * pixel_area,
        hashes=dict(grid=canonical_hash(grid), areaMask=array_hash(area.astype(np.uint8)),
            commonMask=array_hash(common.astype(np.uint8)),
            beforeIndicator=array_hash(np.where(bv, before, np.nan).astype(np.float64)),
            afterIndicator=array_hash(np.where(av, after, np.nan).astype(np.float64)),
            categories=array_hash(codes)))
    validate_report(report, grid)
    return report, codes


def validate_report(report, grid):
    """Check JSON identities and accounting; native verification checks arrays."""
    pixel_area = _grid(grid)
    _require(isinstance(report, dict) and set(report) == {
        'methodVersion', 'classDefinition', 'totalPixels', 'validPixels',
        'pixelAreaKm2', 'counts', 'areasKm2', 'netChangeKm2', 'turnoverKm2', 'hashes'})
    _require(report['methodVersion'] == VERSION and report['classDefinition'] == 'mapped-class1-indicator')
    total, valid = report['totalPixels'], report['validPixels']
    _require(type(total) is int and type(valid) is int and 0 < valid <= total <= grid['width'] * grid['height'])
    counts = report['counts']; areas = report['areasKm2']; hashes = report['hashes']
    _require(isinstance(counts, dict) and set(counts) == set(CATEGORIES))
    _require(all(type(v) is int and 0 <= v <= total for v in counts.values()))
    _require(sum(counts.values()) == total and total - counts['unknown'] == valid)
    _require(isinstance(areas, dict) and set(areas) == set(CATEGORIES))
    expected = {k: v * pixel_area for k, v in counts.items()}
    expected.update(pixelAreaKm2=pixel_area,
        netChangeKm2=(counts['gain']-counts['loss'])*pixel_area,
        turnoverKm2=(counts['gain']+counts['loss'])*pixel_area)
    actual = dict(areas, **{k: report[k] for k in ('pixelAreaKm2', 'netChangeKm2', 'turnoverKm2')})
    _require(all(_number(actual[k]) and math.isclose(actual[k], v, rel_tol=1e-12, abs_tol=1e-15) for k, v in expected.items()))
    _require(isinstance(hashes, dict) and set(hashes) == set(HASHES))
    _require(all(isinstance(v, str) and re.fullmatch('[a-f0-9]{64}', v) for v in hashes.values()))
    _require(hashes['grid'] == canonical_hash(grid))
