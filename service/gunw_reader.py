"""Read a bounded crop of a NISAR L2 GUNW product (specification 1.5.0) with strict checks.

The structure, units, grid spacing and projection are verified before any crop value is read.
Unknown specification versions are refused rather than guessed. Remote products are read with
HTTP range requests through ``range_reader`` (authenticated, host-allowlisted, budgeted), so
only the HDF5 blocks covering the crop are transferred.
"""
from __future__ import annotations

import io
from collections import OrderedDict
from dataclasses import dataclass, fields
from pathlib import Path

import numpy as np

from .ground_motion import GroundMotionError, bilinear, interpolate_height, wavelength_from_frequency

SUPPORTED_SPECS = frozenset({'1.5.0'})
ROOT = 'science/LSAR'
IDENT = ROOT + '/identification'
FREQ = ROOT + '/GUNW/grids/frequencyA'
GRID = FREQ + '/unwrappedInterferogram'
RADAR_GRID = ROOT + '/GUNW/metadata/radarGrid'
POLARIZATION = 'HH'
SPACING_M = 80.0
MAX_CROP_PIXELS = 1_000_000
LAYERS = ('unwrappedPhase', 'coherenceMagnitude', 'connectedComponents', 'ionospherePhaseScreen')


@dataclass(frozen=True)
class PairCrop:
    granule: str
    track: int
    frame: int
    direction: str            # 'A' ascending or 'D' descending
    reference_date: str       # ISO date of the earlier acquisition
    secondary_date: str       # ISO date of the later acquisition
    spec_version: str
    product_version: str
    epsg: int
    wavelength_m: float
    reference_height_m: float
    x: np.ndarray             # pixel-centre eastings, ascending
    y: np.ndarray             # pixel-centre northings, descending
    phase: np.ndarray         # radians
    coherence: np.ndarray
    components: np.ndarray
    ionosphere: np.ndarray    # radians
    troposphere: np.ndarray   # radians, wet + hydrostatic at the reference height
    mask: np.ndarray          # uint32 GUNW mask
    los_east: np.ndarray      # ground -> satellite unit vector, east component
    los_north: np.ndarray
    los_up: np.ndarray

    def save(self, path: Path):
        np.savez_compressed(path, **{f.name: np.asarray(getattr(self, f.name)) for f in fields(self)})

    @classmethod
    def load(cls, path: Path) -> 'PairCrop':
        with np.load(path, allow_pickle=False) as z:
            values = {}
            for f in fields(cls):
                v = z[f.name]
                values[f.name] = v.item() if v.ndim == 0 else v
            for name in ('granule', 'direction', 'reference_date', 'secondary_date', 'spec_version', 'product_version'):
                values[name] = str(values[name])
            for name in ('track', 'frame', 'epsg'):
                values[name] = int(values[name])
            for name in ('wavelength_m', 'reference_height_m'):
                values[name] = float(values[name])
        return cls(**values)


def _text(node) -> str:
    v = node[()]
    if isinstance(v, np.ndarray):
        v = v.ravel()[0] if v.size else b''
    return v.decode() if isinstance(v, bytes) else str(v)


def _texts(node) -> list[str]:
    return [x.decode() if isinstance(x, bytes) else str(x) for x in np.asarray(node[()]).ravel()]


def _require(ok: bool, code: str, message: str):
    if not ok:
        raise GroundMotionError(code, message)


def _units(ds) -> str:
    u = ds.attrs.get('units', b'')
    return u.decode() if isinstance(u, bytes) else str(u)


def validate_structure(h5) -> dict:
    """Check identification, frequency, polarisation, units and grid; return product facts."""
    for path in (IDENT, FREQ, GRID, GRID + '/' + POLARIZATION, RADAR_GRID):
        _require(path in h5, 'PRODUCT_STRUCTURE', 'The product is missing a required group')
    ident = h5[IDENT]
    _require(_text(ident['productType']) == 'GUNW', 'PRODUCT_TYPE', 'Not a GUNW product')
    spec = _text(ident['productSpecificationVersion'])
    _require(spec in SUPPORTED_SPECS, 'UNSUPPORTED_SPEC', 'This GUNW specification version is not supported yet')
    _require(_text(ident['radarBand']) == 'L', 'UNSUPPORTED_BAND', 'Only L-band GUNW products are supported')
    _require(_text(ident['isGeocoded']) == 'True', 'PRODUCT_STRUCTURE', 'The product is not geocoded')
    _require('A' in _texts(ident['listOfFrequencies']), 'PRODUCT_STRUCTURE', 'Frequency A is missing')
    _require(POLARIZATION in _texts(h5[FREQ + '/listOfPolarizations']), 'PRODUCT_STRUCTURE', 'HH polarisation is missing')
    g = h5[GRID]
    pol = g[POLARIZATION]
    for name in LAYERS:
        _require(name in pol, 'PRODUCT_STRUCTURE', 'A required unwrapped-interferogram layer is missing')
    _require(_units(pol['unwrappedPhase']) == 'radians' and _units(pol['ionospherePhaseScreen']) == 'radians',
             'PRODUCT_UNITS', 'Phase layers are not in radians')
    _require(float(g['xCoordinateSpacing'][()]) == SPACING_M and float(g['yCoordinateSpacing'][()]) == -SPACING_M,
             'PRODUCT_GRID', 'Unexpected unwrapped-interferogram pixel spacing')
    epsg = int(g['projection'][()])
    _require(int(pol['projection'][()]) == epsg and int(h5[RADAR_GRID + '/projection'][()]) == epsg,
             'PRODUCT_GRID', 'Layers disagree on the map projection')
    nx, ny = g['xCoordinates'].shape[0], g['yCoordinates'].shape[0]
    for name in LAYERS:
        _require(pol[name].shape == (ny, nx), 'PRODUCT_GRID', 'Layer shape does not match its coordinates')
    _require(g['mask'].shape == (ny, nx), 'PRODUCT_GRID', 'Mask shape does not match its coordinates')
    direction = _text(ident['orbitPassDirection'])
    _require(direction in ('Ascending', 'Descending'), 'PRODUCT_STRUCTURE', 'Unknown orbit direction')
    return {
        'granule': _text(ident['granuleId']),
        'track': int(ident['trackNumber'][()]),
        'frame': int(ident['frameNumber'][()]),
        'direction': direction[0],
        'reference_date': _text(ident['referenceZeroDopplerStartTime'])[:10],
        'secondary_date': _text(ident['secondaryZeroDopplerStartTime'])[:10],
        'spec_version': spec,
        'product_version': _text(ident['productVersion']),
        'epsg': epsg,
        'wavelength_m': wavelength_from_frequency(float(h5[FREQ + '/centerFrequency'][()])),
    }


def _span(coords: np.ndarray, lo: float, hi: float) -> slice:
    idx = np.flatnonzero((coords >= lo) & (coords <= hi))
    if idx.size == 0:
        raise GroundMotionError('NO_OVERLAP', 'The study area does not overlap this product')
    return slice(int(idx[0]), int(idx[-1]) + 1)


def _cube_at(rg, name: str, k: int, rows: slice, cols: slice, heights, target: float):
    cube = rg[name][k:k + 2, rows, cols]
    return interpolate_height(heights[k:k + 2], cube, target)


def read_crop(h5, bbox_xy, reference_height_m: float = 1100.0) -> PairCrop:
    """Read the crop ``(xmin, ymin, xmax, ymax)`` in the product's own projected metres.

    The troposphere screens and line-of-sight vectors live on a coarse 3-D metadata grid; they
    are taken at one reference height (the GUNW has no per-pixel elevation), which suits a
    plain of roughly even height and is recorded in the result.
    """
    facts = validate_structure(h5)
    xmin, ymin, xmax, ymax = bbox_xy
    _require(xmin < xmax and ymin < ymax, 'BAD_BBOX', 'The study area is empty')
    g = h5[GRID]
    pol = g[POLARIZATION]
    x_all, y_all = g['xCoordinates'][()], g['yCoordinates'][()]
    cols, rows = _span(x_all, xmin, xmax), _span(y_all, ymin, ymax)
    _require((rows.stop - rows.start) * (cols.stop - cols.start) <= MAX_CROP_PIXELS, 'CROP_TOO_LARGE',
             'The study area is larger than one million pixels')
    x, y = x_all[cols], y_all[rows]
    layers = {name: pol[name][rows, cols] for name in LAYERS}
    mask = g['mask'][rows, cols]

    rg = h5[RADAR_GRID]
    heights = rg['heightAboveEllipsoid'][()]
    k = int(np.clip(np.searchsorted(heights, reference_height_m) - 1, 0, heights.size - 2))
    rx, ry = rg['xCoordinates'][()], rg['yCoordinates'][()]
    pad = 1000.0
    rcols, rrows = _span(rx, x[0] - pad, x[-1] + pad), _span(ry, y[-1] - pad, y[0] + pad)
    _require(rcols.stop - rcols.start >= 2 and rrows.stop - rrows.start >= 2, 'PRODUCT_GRID',
             'The metadata grid does not cover the study area')
    sub_x, sub_y = rx[rcols], ry[rrows]

    def coarse(name):
        return bilinear(sub_x, sub_y, _cube_at(rg, name, k, rrows, rcols, heights, reference_height_m), x, y)

    troposphere = coarse('wetTroposphericPhaseScreen') + coarse('hydrostaticTroposphericPhaseScreen')
    los_e, los_n = coarse('losUnitVectorX'), coarse('losUnitVectorY')
    los_u = np.sqrt(np.clip(1.0 - los_e ** 2 - los_n ** 2, 0.0, 1.0))
    return PairCrop(
        **facts, reference_height_m=float(reference_height_m), x=x, y=y,
        phase=layers['unwrappedPhase'].astype(np.float32),
        coherence=layers['coherenceMagnitude'].astype(np.float32),
        components=layers['connectedComponents'].astype(np.uint16),
        ionosphere=layers['ionospherePhaseScreen'].astype(np.float32),
        troposphere=troposphere.astype(np.float32), mask=mask.astype(np.uint32),
        los_east=los_e.astype(np.float32), los_north=los_n.astype(np.float32), los_up=los_u.astype(np.float32))


BLOCK_BYTES = 1 << 20
MAX_BLOCKS = 96


class BlockRangeFile(io.RawIOBase):
    """Seekable reader that turns HDF5's many small reads into few 1 MiB aligned range requests.

    Every request still goes through ``RemoteAsset`` (host allowlist, Earthdata auth, transfer
    budget, per-request cap); this only rounds reads to aligned blocks and keeps a bounded LRU.
    """

    def __init__(self, asset):
        self.asset, self.pos = asset, 0
        self.size = asset.length()
        self.blocks: OrderedDict[int, bytes] = OrderedDict()

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=io.SEEK_SET):
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self.pos, io.SEEK_END: self.size}[whence]
        self.pos = max(0, base + offset)
        return self.pos

    def _block(self, index: int) -> bytes:
        if index in self.blocks:
            self.blocks.move_to_end(index)
            return self.blocks[index]
        start = index * BLOCK_BYTES
        data = self.asset.fetch(start, min(self.size, start + BLOCK_BYTES) - 1)
        self.blocks[index] = data
        while len(self.blocks) > MAX_BLOCKS:
            self.blocks.popitem(last=False)
        return data

    def readinto(self, buffer):
        view = memoryview(buffer).cast('B')
        want = max(0, min(len(view), self.size - self.pos))
        got = 0
        while got < want:
            index, offset = divmod(self.pos + got, BLOCK_BYTES)
            chunk = self._block(index)[offset:offset + want - got]
            if not chunk:
                break
            view[got:got + len(chunk)] = chunk
            got += len(chunk)
        self.pos += got
        return got


def open_remote(url: str, netrc_path: Path, budget):
    """Open a remote GUNW over budgeted, authenticated range requests (h5py file object)."""
    import h5py

    from .range_reader import RemoteAsset, authenticated_opener
    asset = RemoteAsset(url, authenticated_opener(netrc_path), budget)
    return h5py.File(BlockRangeFile(asset), 'r'), asset
