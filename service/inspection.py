"""Deterministic places to inspect in an existing native radar-difference crop.

This module does not detect or classify environmental events. Coordinates are
single native pixel centers; the input difference and masks are never resampled.
"""
import heapq
import math
from fractions import Fraction
from numbers import Real

import numpy as np


_BLOCK_SIZE = 32
_LIMIT = 12
_MAX_PIXELS = 1_000_000
_LIMITATIONS = (
    'No event class, statistical significance, or confidence is established.',
    'Fixed native windows are inspection aids, not feature objects.',
    'Areas are nominal projected pixel footprints, not measured ground areas.',
    'Thresholding and ranking are heuristic and unvalidated.',
)


def _finite_real(value, name):
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, Real):
        raise ValueError(f'{name} must be a finite real number')
    try:
        number = float(value)
    except (OverflowError, ValueError):
        raise ValueError(f'{name} must be a finite real number') from None
    if not math.isfinite(number):
        raise ValueError(f'{name} must be a finite real number')
    return number


def _array(value, name, kinds):
    # Inspect dtype before doing numerical work; do not coerce strings, objects,
    # complex differences, or integer masks into apparently valid inputs.
    if np.ma.isMaskedArray(value):
        raise ValueError(f'{name} must not be a masked array')
    try:
        array = np.asarray(value)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(f'{name} must be a rectangular 2D array') from None
    if array.ndim != 2 or array.dtype.kind not in kinds:
        raise ValueError(f'{name} has an invalid dimension or dtype')
    return array


def _coordinate(row, column, transform, to_wgs84):
    """One attempt only, including when projection or output validation fails."""
    try:
        x = transform[0] + (column + .5)*transform[1] + (row + .5)*transform[2]
        y = transform[3] + (column + .5)*transform[4] + (row + .5)*transform[5]
        if not math.isfinite(x) or not math.isfinite(y):
            return None
        point = to_wgs84((x, y))
        if not isinstance(point, (tuple, list)) or len(point) not in (2, 3):
            return None
        lon = _finite_real(point[0], 'longitude')
        lat = _finite_real(point[1], 'latitude')
        if -180 <= lon <= 180 and -90 <= lat <= 90:
            return [lon, lat]
    except Exception:
        # A failed projection cannot invalidate native evidence or justify
        # substituting another point. No retry or fabricated coordinate.
        pass
    return None


def inspection_windows(difference, common, selected, transform, pixel_area_m2,
                       threshold_db, to_wgs84):
    """Return a finite JSON summary of ranked 32x32 native inspection windows.

    Masks must be boolean arrays, differences real numeric arrays, and all three
    arrays 2D with identical shapes and at most one million cells. Empty grids
    are allowed and have no valid support. Nonfinite differences are unknown
    when selected, as are selected cells outside ``common``. ``to_wgs84`` takes
    a single ``(x, y)`` native point and returns ``(lon, lat[, z])``; z is unused.
    Malformed inputs raise ValueError. A failed coordinate conversion instead
    preserves the candidate with a null coordinate.

    Numeric temporaries are block sized; only the best twelve candidate records
    are retained. Coordinates are transformed only after ranking, at most once
    for each returned candidate. Neither arrays nor the affine are modified.
    """
    difference = _array(difference, 'difference', 'iuf')
    common = _array(common, 'common', 'b')
    selected = _array(selected, 'selected', 'b')
    if (difference.size > _MAX_PIXELS or any(dimension > _MAX_PIXELS for dimension in difference.shape) or common.shape != difference.shape or
            selected.shape != difference.shape):
        raise ValueError('Arrays must have the same shape and at most 1000000 cells')
    try:
        affine = tuple(transform)
    except TypeError:
        raise ValueError('transform must contain six finite GDAL affine values') from None
    if len(affine) != 6:
        raise ValueError('transform must contain six finite GDAL affine values')
    affine = tuple(_finite_real(v, 'transform') for v in affine)
    # Exact products of the supplied floats avoid determinant overflow and
    # underflow accidentally accepting a singular grid or rejecting a tiny one.
    if (Fraction(affine[1])*Fraction(affine[5]) ==
            Fraction(affine[2])*Fraction(affine[4])):
        raise ValueError('transform must have a nonzero determinant')
    pixel_area = _finite_real(pixel_area_m2, 'pixel_area_m2')
    threshold = _finite_real(threshold_db, 'threshold_db')
    if pixel_area <= 0:
        raise ValueError('pixel_area_m2 must be positive')
    if pixel_area / 1e6 == 0:
        raise ValueError('pixel_area_m2 is too small for a nonzero square-kilometre footprint')
    if not .1 <= threshold <= 30:
        raise ValueError('threshold_db must be between 0.1 and 30')
    if not callable(to_wgs84):
        raise ValueError('to_wgs84 must be callable')
    # NumPy's weak Python-scalar promotion can round a threshold to float32
    # before comparison. Preserve the supplied threshold for strict boundaries.
    comparison_threshold = np.float64(threshold)

    total_selected = total_valid = total_candidates = 0
    best = []
    height, width = difference.shape
    for row in range(0, height, _BLOCK_SIZE):
        for column in range(0, width, _BLOCK_SIZE):
            end_row = min(row + _BLOCK_SIZE, height)
            end_column = min(column + _BLOCK_SIZE, width)
            region = np.s_[row:end_row, column:end_column]
            block = difference[region]
            chosen = selected[region]
            valid = chosen & common[region] & np.isfinite(block)
            selected_count = int(np.count_nonzero(chosen))
            valid_count = int(np.count_nonzero(valid))
            total_selected += selected_count
            total_valid += valid_count
            # NumPy 1.x can downcast even a float64 scalar to the array dtype.
            # Promote this bounded window, as analysis.summarize does, so the
            # recorded cutoff never rounds to float16/32 before comparison.
            comparison_block = block.astype(np.float64, copy=False)
            increased = int(np.count_nonzero(valid & (comparison_block > comparison_threshold)))
            decreased = int(np.count_nonzero(valid & (comparison_block < -comparison_threshold)))
            exceeded = increased + decreased
            if not exceeded:
                continue
            total_candidates += 1
            values = block[valid]
            low, high = values.min().item(), values.max().item()
            # Python integer abs avoids signed-integer overflow at dtype minima.
            peak = max(abs(low), abs(high))
            _finite_real(peak, 'difference peak')
            if abs(low) == abs(high):
                peak_mask = valid & ((block == low) | (block == high))
            else:
                peak_mask = valid & (block == (low if abs(low) > abs(high) else high))
            flat = int(np.flatnonzero(peak_mask)[0])
            local_row, local_column = divmod(flat, block.shape[1])
            record = {
                'window': {'rowStart': row, 'rowEndExclusive': end_row,
                           'columnStart': column, 'columnEndExclusive': end_column},
                'selectedPixels': selected_count,
                'validPixels': valid_count,
                'unknownPixels': selected_count - valid_count,
                'increasedPixels': increased,
                'decreasedPixels': decreased,
                'withinThresholdPixels': valid_count - exceeded,
                'exceededAreaKm2': exceeded*(pixel_area/1e6),
                'validPercent': 100*valid_count/selected_count,
                'representative': {
                    'row': row + local_row, 'column': column + local_column,
                    'differenceDb': _finite_real(block[local_row, local_column].item(),
                                                 'representative difference'),
                    'coordinate': None, 'coordinateStatus': 'unavailable',
                },
            }
            # The worst retained candidate is the heap root. Native origins
            # uniquely break ties, so record dictionaries are never compared.
            item = (exceeded, peak, -row, -column, record)
            if len(best) < _LIMIT:
                heapq.heappush(best, item)
            elif item[:4] > best[0][:4]:
                heapq.heapreplace(best, item)

    candidates = [item[4] for item in sorted(best, reverse=True)]
    for candidate in candidates:
        representative = candidate['representative']
        coordinate = _coordinate(representative['row'], representative['column'],
                                 affine, to_wgs84)
        representative['coordinate'] = coordinate
        if coordinate is not None:
            representative['coordinateStatus'] = 'available'
    status = ('withheld_no_valid_support' if not total_valid else
              'candidates' if candidates else 'no_threshold_candidates')
    return {
        'schemaVersion': 'native-inspection-windows-v1',
        'blockSizePixels': _BLOCK_SIZE, 'limit': _LIMIT, 'thresholdDb': threshold,
        'selectedPixels': total_selected, 'validPixels': total_valid,
        'unknownPixels': total_selected - total_valid,
        'candidateWindows': total_candidates, 'returnedWindows': len(candidates),
        'omittedWindows': total_candidates - len(candidates), 'status': status,
        'ranking': 'exceeded-pixel-count_then_peak-absolute-db_then_native-order',
        'candidates': candidates, 'limitations': list(_LIMITATIONS),
    }
