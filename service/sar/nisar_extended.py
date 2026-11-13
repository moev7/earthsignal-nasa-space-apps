"""Bounded NISAR L-band Frequency A GSLC/GOFF readers, producer schema 1.6.0.

Producer definitions are pinned, not inferred from filenames or browse imagery:
https://github.com/isce-framework/isce3/tree/8a6bf71b03f4327143fa2c890a2f38d3774acc52
GSLC: python/packages/nisar/products/XML/L2/nisar_L2_GSLC.xml
GOFF: python/packages/nisar/products/insar/{GOFF_writer,InSAR_base_writer,
      InSAR_products_info,ROFF_writer,units}.py
Radiometry: https://nisar-docs.asf.alaska.edu/gslc/ (beta0 = abs(DN)**2).
Offsets: https://nisar-docs.asf.alaska.edu/goff/ (80 m, unfiltered outliers).

Only native complex64 GSLC is admitted; packed complex32 and unfamiliar layouts
remain explicit gates. No LUT conversion, interferometry, LOS, velocity, vertical
motion, filtering, resampling, full-file download or authentication fallback.
"""
from __future__ import annotations

import base64
import hashlib
import math
import re
from pathlib import Path

import h5py
import numpy as np

from service.gunw_reader import BlockRangeFile
from service.range_reader import authenticated_opener
from .native import NativeCrop, affine_window, _project, acquisition_time
from .net import SarError, StableAsset

PRODUCER_COMMIT = '8a6bf71b03f4327143fa2c890a2f38d3774acc52'
PRODUCER_ROOT = 'https://github.com/isce-framework/isce3/blob/' + PRODUCER_COMMIT + '/'
MAX_PIXELS = 262144
MAX_AXIS = 262144
MAX_CHUNK_BYTES = 8 * 1024**2
IDENT = '/science/LSAR/identification'
FOCUS = {'HH': 256, 'HV': 512, 'VH': 1024, 'VV': 2048,
         'LH': 4096, 'LV': 8192, 'RH': 16384, 'RV': 32768}


def _require(ok, code, message):
    if not ok:
        raise SarError(code, message)


def _decode(value):
    return value.decode('utf-8') if isinstance(value, bytes) else str(value)


def _dataset(group, name):
    # External/soft links, virtual datasets and external raw storage may bypass
    # the authenticated, immutable shared transfer budget; never follow them.
    _require(name in group and isinstance(group.get(name, getlink=True), h5py.HardLink),
             'schema_unknown', 'Required native hard-linked dataset is absent')
    ds = group[name]
    _require(isinstance(ds, h5py.Dataset) and not ds.is_virtual and not ds.external,
             'schema_unknown', 'External or virtual scientific storage is unsupported')
    _require(ds.dtype.kind != 'O', 'metadata_unknown', 'Variable-length storage is unsupported')
    if ds.chunks:
        _require(math.prod(ds.chunks) * ds.dtype.itemsize <= MAX_CHUNK_BYTES,
                 'resource_limit', 'HDF5 decoded chunk exceeds the bounded reader limit')
    return ds


def _group(h5, path):
    current = h5
    for part in path.strip('/').split('/'):
        _require(part in current and isinstance(current.get(part, getlink=True), h5py.HardLink),
                 'schema_unknown', 'Required native group is absent')
        current = current[part]
        _require(isinstance(current, h5py.Group), 'schema_unknown', 'Expected native HDF5 group')
    return current


def _small(group, name, *, array=False):
    ds = _dataset(group, name)
    _require(ds.size <= 64 and ds.size * ds.dtype.itemsize <= 8192 and
             (ds.ndim <= 1 if array else ds.shape == ()),
             'metadata_limit', 'Identification metadata must be bounded native scalars or lists')
    value = ds[()]
    if array:
        return [_decode(v) for v in np.asarray(value).reshape(-1)]
    return value.item() if isinstance(value, np.generic) else value


def _text(group, name):
    return _decode(_small(group, name))


def _attr(ds, name, default=None):
    if name not in ds.attrs:
        return default
    aid = ds.attrs.get_id(name)
    _require(aid.dtype.kind != 'O' and math.prod(aid.shape or (1,)) * aid.dtype.itemsize <= 8192,
             'metadata_limit', 'Dataset attributes must use bounded fixed-width values')
    value = ds.attrs[name]
    _require(np.asarray(value).size == 1, 'schema_unknown', 'Expected scalar attribute')
    return value


def _units(ds):
    return _decode(_attr(ds, 'units', ''))


def _utc(value):
    value = _decode(value)
    # Producer identification timestamps are explicitly UTC even without Z.
    return acquisition_time(value if re.search(r'(Z|[+-]\d{2}:\d{2})$', value) else value + 'Z')


def _identity(h5, item, product, channel):
    p = item.get('properties', {})
    _require(channel in FOCUS, 'channel_unknown', 'Unsupported NISAR polarization')
    _require(p.get('platform') == 'NISAR' and p.get('processingLevel') == product and
             isinstance(p.get('fileID'), str) and bool(p['fileID']),
             'source_identity', 'Exact NISAR catalog product and file identifier are required')
    ident = _group(h5, IDENT)
    names = ('missionId', 'productType', 'productLevel', 'radarBand', 'isGeocoded',
             'productSpecificationVersion', 'granuleId', 'trackNumber', 'frameNumber',
             'orbitPassDirection', 'lookDirection', 'productVersion', 'compositeReleaseId')
    meta = {name: _decode(_small(ident, name)) for name in names}
    _require(meta['missionId'] == 'NISAR' and meta['productType'] == product and
             meta['productLevel'] == 'L2' and meta['radarBand'] == 'L' and meta['isGeocoded'] == 'True',
             'source_identity', 'Not a geocoded NISAR L-band product')
    _require(meta['productSpecificationVersion'] == '1.6.0', 'unsupported_spec',
             'Only the pinned producer specification 1.6.0 is verified')
    _require(all(meta.values()), 'metadata_unknown', 'Product version metadata is incomplete')
    _require(meta['granuleId'] == p.get('sceneName') and
             meta['trackNumber'] == str(p.get('pathNumber')) and
             meta['frameNumber'] == str(p.get('frameNumber')) and
             meta['orbitPassDirection'].casefold() == str(p.get('flightDirection')).casefold(),
             'source_identity', 'Native granule or acquisition geometry disagrees with catalog')
    _require(meta['orbitPassDirection'] in ('Ascending', 'Descending') and
             meta['lookDirection'] in ('Left', 'Right') and
             'A' in _small(ident, 'listOfFrequencies', array=True),
             'metadata_unknown', 'Known viewing geometry and Frequency A are required')
    time_names = ('zeroDopplerStartTime', 'zeroDopplerEndTime') if product == 'GSLC' else (
        'referenceZeroDopplerStartTime', 'referenceZeroDopplerEndTime',
        'secondaryZeroDopplerStartTime', 'secondaryZeroDopplerEndTime')
    times = {name: _utc(_text(ident, name)) for name in time_names}
    for start, end in zip(time_names[::2], time_names[1::2]):
        _require(times[start] < times[end], 'chronology', 'Native acquisition interval is empty')
    if product == 'GOFF':
        _require(times[time_names[0]] < times[time_names[2]], 'chronology',
                 'GOFF reference acquisition must precede secondary acquisition')
    _require(abs((times[time_names[0]] - _utc(p.get('startTime', ''))).total_seconds()) <= 1,
             'source_identity', 'Native reference acquisition time disagrees with catalog')
    meta.update({name: value.isoformat() for name, value in times.items()})
    frequency = _group(h5, f'/science/LSAR/{product}/grids/frequencyA')
    _require(channel in _small(frequency, 'listOfPolarizations', array=True),
             'channel_unknown', 'Requested polarization is absent from Frequency A')
    return p, meta, frequency


def _grid(group, bounds, *, offsets=False):
    xds, yds = (_dataset(group, n + 'Coordinates') for n in ('x', 'y'))
    dx, dy = (float(_small(group, n + 'CoordinateSpacing')) for n in ('x', 'y'))
    epsg = _small(group, 'projection')
    _require(isinstance(epsg, int) and (32601 <= epsg <= 32660 or 32701 <= epsg <= 32760 or epsg in (3413, 3031)),
             'grid_unknown', 'Only NISAR UTM or polar stereographic metre grids are verified')
    _require(math.isfinite(dx) and math.isfinite(dy) and dx > 0 and dy < 0,
             'grid_unknown', 'Expected a north-up projected native grid')
    if offsets:
        _require(dx == 80 and dy == -80, 'grid_unknown', 'Verified GOFF posting is 80 metres')
    for ds, spacing in ((xds, dx), (yds, dy)):
        _require(ds.ndim == 1 and 0 < ds.size <= MAX_AXIS and ds.dtype.kind == 'f' and
                 ds.dtype.itemsize == 8 and _units(ds) == 'meters',
                 'grid_unknown', 'Coordinate axes must be bounded float64 metre arrays')
        origin = float(ds[0])
        _require(math.isfinite(origin), 'grid_unknown', 'Coordinate origin is not finite')
        # Check the complete declared axis in bounded blocks, including gaps
        # outside the requested crop; endpoints alone do not establish affinity.
        for start in range(0, ds.size, 4096):
            actual = ds[start:start + 4096]
            expected = origin + np.arange(start, start + actual.size) * spacing
            _require(np.isfinite(actual).all() and np.allclose(actual, expected, rtol=0, atol=1e-6),
                     'grid_unknown', 'Coordinate axis is not the declared affine grid')
    _require(all(_units(_dataset(group, n + 'CoordinateSpacing')) == 'meters' for n in ('x', 'y')),
             'grid_unknown', 'Native spacing must be declared in metres')
    gt = [float(xds[0]) - dx/2, dx, 0, float(yds[0]) - dy/2, 0, dy]
    _require(isinstance(bounds, (list, tuple)) and len(bounds) == 4 and
             all(isinstance(v, (int, float)) and math.isfinite(v) for v in bounds) and
             -180 <= bounds[0] < bounds[2] <= 180 and -90 <= bounds[1] < bounds[3] <= 90,
             'grid_unknown', 'Expected finite ordered WGS84 bounds')
    win, gt = affine_window(gt, xds.size, yds.size, _project(bounds, 'EPSG:' + str(epsg)), MAX_PIXELS)
    x, y, w, h = win
    return np.s_[y:y+h, x:x+w], (yds.size, xds.size), {
        'width': w, 'height': h, 'crs': 'EPSG:' + str(epsg), 'transform': gt}, list(win)


def _plane(group, name, shape, kind, size, *, units=None, fill=None):
    ds = _dataset(group, name)
    _require(ds.shape == shape and ds.dtype.kind == kind and ds.dtype.itemsize == size,
             'representation_unknown', 'Native plane type or shape differs from verified producer schema')
    _require(_decode(_attr(ds, 'grid_mapping', '')) == 'projection' and
             _attr(ds, 'scale_factor', 1) == 1 and _attr(ds, 'add_offset', 0) == 0,
             'schema_unknown', 'Native plane grid mapping or scaling is unsupported')
    _require(_attr(ds, 'flag_values') is None and _attr(ds, 'flag_meanings') is None,
             'mask_unknown', 'Unfamiliar flag enumeration cannot override the producer mask')
    if units is not None:
        _require(_units(ds) == units, 'units_unknown', 'Native plane units differ from verified producer units')
    declared_fill = _attr(ds, '_FillValue')
    _require(declared_fill is not None, 'fill_unknown', 'Native plane fill value is absent')
    if fill == 'complex_nan':
        _require(np.iscomplexobj(declared_fill) and np.isnan(declared_fill.real) and np.isnan(declared_fill.imag),
                 'fill_unknown', 'GSLC requires the documented complex NaN fill')
    elif fill == 'nan':
        _require(np.isrealobj(declared_fill) and np.isnan(declared_fill), 'fill_unknown',
                 'GOFF requires the producer NaN fill')
    elif fill is not None:
        _require(declared_fill == fill, 'fill_unknown', 'Native mask fill differs from the producer definition')
    return ds


def _proof(array, *, original=False):
    raw = array.tobytes(order='C')
    result = {'dtype': array.dtype.str, 'shape': list(array.shape), 'sha256': hashlib.sha256(raw).hexdigest(),
              'byteOrder': 'dtype-declared', 'order': 'C', 'bytes': len(raw)}
    if original:
        result.update(encoding='base64', data=base64.b64encode(raw).decode('ascii'))
    return result


def _evidence(p, meta, channel, remote, window):
    return {'sourceId': 'nisar', 'recordId': p['fileID'], 'channel': channel, 'frequency': 'A',
            'acquiredAt': meta.get('zeroDopplerStartTime', meta.get('referenceZeroDopplerStartTime')),
            'track': meta['trackNumber'], 'direction': meta['orbitPassDirection'], 'mode': 'Frequency A ' + channel,
            'metadata': meta, 'etag': remote.etag, 'sourceBytes': remote.size, 'pixelWindow': window,
            'producerCommit': PRODUCER_COMMIT,
            'sourceProcessing': {k: meta[k] for k in ('productVersion', 'productSpecificationVersion', 'compositeReleaseId')}}


def read_gslc(item, bounds, channel, netrc, reader):
    """Return beta0 dB observation plus byte-exact original complex crop evidence."""
    remote = StableAsset(item.get('properties', {}).get('url'), authenticated_opener(Path(netrc)), reader.budget)
    with BlockRangeFile(remote) as stream, h5py.File(stream, 'r', rdcc_nbytes=MAX_CHUNK_BYTES) as h5:
        p, meta, g = _identity(h5, item, 'GSLC', channel)
        sel, shape, grid, win = _grid(g, bounds)
        ds = _plane(g, channel, shape, 'c', 8, units='1', fill='complex_nan')
        _require(_decode(_attr(ds, 'isReceiveOnly', '')) == 'False', 'unsupported_mode',
                 'GSLC receive-only or unknown channel cannot represent backscatter')
        mask_ds = _plane(g, 'mask', shape, 'u', 1, fill=255)
        _require(_decode(_attr(mask_ds, 'long_name', '')) == 'Valid samples subswath mask',
                 'mask_unknown', 'Unknown GSLC subswath mask contract')
        ex_ds = _plane(g, 'inputDataExceptionMask', shape, 'u', 2, fill=65535)
        params = _group(h5, '/science/LSAR/GSLC/metadata/processingInformation/parameters')
        flags = {n: _text(params, n) for n in ('ellipsoidalFlatteningApplied', 'topographicFlatteningApplied')}
        _require(all(v in ('True', 'False') for v in flags.values()) and 'True' in flags.values(),
                 'schema_unknown', 'GSLC phase flattening metadata is unknown or disabled')
        # All structural, grid, pixel budget and type checks precede science reads.
        original, mask, exceptions = ds[sel], mask_ds[sel], ex_ds[sel]
    _require(np.isin(mask, [0, 1, 2, 3, 255]).all(), 'mask_unknown', 'Unknown GSLC subswath code')
    anomalies = exceptions[exceptions != 65535] & 255
    _require(np.isin(anomalies, [0, 2]).all(), 'mask_unknown', 'Unknown GSLC input anomaly code')
    valid = ((mask > 0) & (mask < 4) & (exceptions != 65535) &
             ((exceptions & FOCUS[channel]) != 0) & ((exceptions & 255) == 0) & np.isfinite(original))
    z = original.astype(np.complex128)
    # Promote both components before squaring to avoid float32 overflow.
    beta0 = z.real**2 + z.imag**2
    valid &= np.isfinite(beta0) & (beta0 > 0)
    values = np.full(original.shape, np.nan, dtype=np.float64)
    values[valid] = 10 * np.log10(beta0[valid])
    evidence = _evidence(p, meta, channel, remote, win)
    evidence.update(sourceComplex=_proof(original, original=True), sourceMask=_proof(mask),
                    sourceExceptions=_proof(exceptions), phaseFlattening=flags,
                    calibration='beta0 = real(DN)^2 + imag(DN)^2; dB = 10 log10(beta0)',
                    radiometricTerrainCorrection=False, lutConversionApplied=False,
                    quality='Fully focused selected polarization; no anomaly, finite nonzero complex DN; no invented layover/shadow mask',
                    producerReferences=[PRODUCER_ROOT + 'python/packages/nisar/products/XML/L2/nisar_L2_GSLC.xml',
                                        'https://nisar-docs.asf.alaska.edu/gslc/'])
    return NativeCrop(values, valid, grid, 'beta0', 'radar backscatter', 'dB', evidence)


def read_goff(item, bounds, channel, netrc, reader, component='slant-range', layer=1):
    """Read native source offsets in metres, never infer LOS/vertical/rate.

    Screening is a reader policy, not a producer outlier-removal guarantee:
    both acquisitions focused, known valid subswaths, no anomaly, finite offset,
    positive SNR and positive correlation peak <=1, nonnegative variance.
    """
    _require(component in ('slant-range', 'along-track') and type(layer) is int and 1 <= layer <= 3,
             'unsupported_product', 'Choose a declared GOFF component and layer 1..3')
    remote = StableAsset(item.get('properties', {}).get('url'), authenticated_opener(Path(netrc)), reader.budget)
    with BlockRangeFile(remote) as stream, h5py.File(stream, 'r', rdcc_nbytes=MAX_CHUNK_BYTES) as h5:
        p, meta, freq = _identity(h5, item, 'GOFF', channel)
        layer_name = 'layer' + str(layer)
        _require(layer_name in _small(freq, 'listOfLayers', array=True), 'schema_unknown', 'Requested GOFF layer is absent')
        offsets = _group(h5, freq.name + '/pixelOffsets')
        pol = _group(h5, offsets.name + '/' + channel)
        g = _group(h5, pol.name + '/' + layer_name)
        sel, shape, grid, win = _grid(g, bounds, offsets=True)
        # Masks have their own coordinate declarations. Prove co-registration,
        # rather than assuming equal array shape means equal native pixels.
        for group in (offsets, pol):
            other_sel, other_shape, other_grid, other_win = _grid(group, bounds, offsets=True)
            _require(other_shape == shape and other_grid == grid and other_win == win,
                     'grid_unknown', 'GOFF mask and offset grids disagree')
        name = 'slantRangeOffset' if component == 'slant-range' else 'alongTrackOffset'
        planes = {n: _plane(g, n, shape, 'f', 4, units=u, fill='nan') for n, u in (
            (name, 'meters'), (name + 'Variance', 'meters^2'), ('snr', '1'), ('correlationSurfacePeak', '1'))}
        mask_ds = _plane(offsets, 'mask', shape, 'u', 4, fill=255)
        focus_ds = _plane(pol, 'validDataMask', shape, 'u', 1, units='1', fill=255)
        arrays = {n: ds[sel] for n, ds in planes.items()}
        mask, focus = mask_ds[sel], focus_ds[sel]
    code = mask & 255
    # Low-byte decimal encoding: water flag, reference subswath, secondary
    # subswath. High bytes contain anomalies; top byte is reserved.
    water, ref, sec = code // 100, (code % 100) // 10, code % 10
    known = (mask == 255) | ((water <= 1) & (ref <= 3) & (sec <= 3) & ((mask >> 24) == 0))
    _require(known.all() and np.isin(focus, [0, 1, 2, 3, 255]).all(),
             'mask_unknown', 'GOFF has unknown subswath, focus or reserved mask codes')
    anomalies = ((mask >> 8) & 255, (mask >> 16) & 255)
    _require(all(np.isin(a, [0, 2]).all() for a in anomalies), 'mask_unknown', 'Unknown GOFF anomaly bits')
    offset, variance, snr, peak = (arrays[n] for n in (name, name + 'Variance', 'snr', 'correlationSurfacePeak'))
    valid = ((mask != 255) & (ref > 0) & (sec > 0) & (focus == 3) &
             (anomalies[0] == 0) & (anomalies[1] == 0) & np.isfinite(offset) &
             np.isfinite(variance) & (variance >= 0) & np.isfinite(snr) & (snr > 0) &
             np.isfinite(peak) & (peak > 0) & (peak <= 1))
    values = np.where(valid, offset.astype(np.float64), np.nan)
    evidence = _evidence(p, meta, channel, remote, win)
    evidence.update(component=component, layer=layer, sourcePlanes={n: _proof(a) for n, a in arrays.items()},
                    sourceMask=_proof(mask), sourceFocusMask=_proof(focus),
                    uncertainty={'source': name + 'Variance', 'unit': 'meters^2',
                                 'screening': 'finite and >=0; no absolute-uncertainty cutoff'},
                    quality={'snr': 'finite and >0 (reader policy, no producer threshold claimed)',
                             'correlationSurfacePeak': 'finite and 0<peak<=1',
                             'mask': 'both focused, valid subswaths, no anomalies; water retained'},
                    sourceFiltering='Raw unculled unfiltered offsets; residual outliers may remain',
                    conversion='None: native component offsets, not LOS/vertical displacement or rate',
                    producerReferences=[PRODUCER_ROOT + 'python/packages/nisar/products/insar/' + f for f in
                                        ('GOFF_writer.py', 'InSAR_products_info.py', 'InSAR_base_writer.py', 'units.py')]
                                        + ['https://nisar-docs.asf.alaska.edu/goff/'])
    return NativeCrop(values, valid, grid, 'native ' + component + ' offset',
                      'radar pixel offset', 'meters', evidence)
