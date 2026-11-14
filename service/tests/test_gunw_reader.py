"""Structure checks and crop reading for GUNW products, using a small synthetic HDF5 file."""
import tempfile
import unittest
from pathlib import Path

import h5py
import numpy as np

from service import gunw_reader as gr
from service.ground_motion import GroundMotionError

NX, NY = 60, 40
X = 385_960.0 + 80.0 * np.arange(NX)
Y = 3_960_040.0 - 80.0 * np.arange(NY)


def build(path: Path, *, spec='1.5.0', phase_units='radians', spacing=80.0):
    with h5py.File(path, 'w') as h:
        ident = h.create_group(gr.IDENT)
        for k, v in {'productType': 'GUNW', 'productSpecificationVersion': spec, 'radarBand': 'L',
                     'isGeocoded': 'True', 'orbitPassDirection': 'Ascending', 'granuleId': 'SYNTHETIC_GUNW',
                     'referenceZeroDopplerStartTime': '2026-06-18T01:45:54.000000000',
                     'secondaryZeroDopplerStartTime': '2026-06-30T01:45:53.000000000',
                     'productVersion': '1.0.11'}.items():
            ident[k] = np.bytes_(v)
        ident['listOfFrequencies'] = np.array([b'A'])
        ident['trackNumber'] = np.uint32(56)
        ident['frameNumber'] = np.uint16(19)
        freq = h.create_group(gr.FREQ)
        freq['centerFrequency'] = 1.229e9
        freq['listOfPolarizations'] = np.array([b'HH'])
        g = h.create_group(gr.GRID)
        g['xCoordinates'], g['yCoordinates'] = X, Y
        g['xCoordinateSpacing'], g['yCoordinateSpacing'] = spacing, -spacing
        g['projection'] = np.uint32(32639)
        g['mask'] = np.full((NY, NX), 11, np.uint32)
        pol = g.create_group('HH')
        pol['projection'] = np.uint32(32639)
        ramp = np.tile(np.arange(NX, dtype=np.float32), (NY, 1))
        for name, data, units in (('unwrappedPhase', ramp, phase_units),
                                  ('coherenceMagnitude', np.full((NY, NX), 0.8, np.float32), '1'),
                                  ('connectedComponents', np.ones((NY, NX), np.uint16), '1'),
                                  ('ionospherePhaseScreen', np.zeros((NY, NX), np.float32), 'radians')):
            pol[name] = data
            pol[name].attrs['units'] = np.bytes_(units)
        rg = h.create_group(gr.RADAR_GRID)
        rx = 383_250.0 + 500.0 * np.arange(14)
        ry = 3_962_250.0 - 500.0 * np.arange(12)
        rg['xCoordinates'], rg['yCoordinates'] = rx, ry
        rg['projection'] = np.uint32(32639)
        rg['heightAboveEllipsoid'] = np.array([0.0, 500.0, 1000.0, 1500.0, 2000.0])
        shape = (5, ry.size, rx.size)
        rg['wetTroposphericPhaseScreen'] = np.ones(shape)
        rg['hydrostaticTroposphericPhaseScreen'] = np.full(shape, 2.0)
        rg['losUnitVectorX'] = np.full(shape, -0.6, np.float32)
        rg['losUnitVectorY'] = np.full(shape, -0.1, np.float32)


class ReaderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'gunw.h5'

    def tearDown(self):
        self.tmp.cleanup()

    def test_reads_crop_with_facts_corrections_and_geometry(self):
        build(self.path)
        with h5py.File(self.path, 'r') as h:
            crop = gr.read_crop(h, (X[10], Y[30], X[29], Y[5]))
        self.assertEqual((crop.track, crop.frame, crop.direction), (56, 19, 'A'))
        self.assertEqual((crop.reference_date, crop.secondary_date), ('2026-06-18', '2026-06-30'))
        self.assertEqual(crop.phase.shape, (26, 20))
        self.assertEqual(float(crop.phase[0, 0]), 10.0)
        np.testing.assert_allclose(crop.troposphere, 3.0)
        np.testing.assert_allclose(crop.los_up, np.sqrt(1 - 0.36 - 0.01), rtol=1e-6)
        self.assertAlmostEqual(crop.wavelength_m, 0.24393, places=5)

    def test_save_and_load_round_trip(self):
        build(self.path)
        with h5py.File(self.path, 'r') as h:
            crop = gr.read_crop(h, (X[0], Y[-1], X[-1], Y[0]))
        npz = Path(self.tmp.name) / 'crop.npz'
        crop.save(npz)
        again = gr.PairCrop.load(npz)
        self.assertEqual(again.granule, 'SYNTHETIC_GUNW')
        self.assertEqual(again.epsg, 32639)
        np.testing.assert_array_equal(again.mask, crop.mask)

    def test_refuses_unknown_specification(self):
        build(self.path, spec='9.9.9')
        with h5py.File(self.path, 'r') as h, self.assertRaises(GroundMotionError) as ctx:
            gr.read_crop(h, (X[0], Y[-1], X[-1], Y[0]))
        self.assertEqual(ctx.exception.code, 'UNSUPPORTED_SPEC')

    def test_refuses_wrong_units_and_spacing(self):
        build(self.path, phase_units='degrees')
        with h5py.File(self.path, 'r') as h, self.assertRaises(GroundMotionError) as ctx:
            gr.validate_structure(h)
        self.assertEqual(ctx.exception.code, 'PRODUCT_UNITS')
        build(self.path, spacing=20.0)
        with h5py.File(self.path, 'r') as h, self.assertRaises(GroundMotionError) as ctx:
            gr.validate_structure(h)
        self.assertEqual(ctx.exception.code, 'PRODUCT_GRID')

    def test_reports_no_overlap(self):
        build(self.path)
        with h5py.File(self.path, 'r') as h, self.assertRaises(GroundMotionError) as ctx:
            gr.read_crop(h, (0.0, 0.0, 10.0, 10.0))
        self.assertEqual(ctx.exception.code, 'NO_OVERLAP')


class FakeAsset:
    def __init__(self, data: bytes):
        self.data, self.calls = data, []

    def length(self):
        return len(self.data)

    def fetch(self, start, end):
        self.calls.append((start, end))
        return self.data[start:end + 1]


class BlockReaderTests(unittest.TestCase):
    def test_small_reads_become_few_aligned_block_requests(self):
        data = bytes(range(256)) * 12_000                      # ~3 MB
        asset = FakeAsset(data)
        f = gr.BlockRangeFile(asset)
        out = bytearray()
        for pos in range(0, 2_500_000, 997):
            f.seek(pos)
            out += f.read(13)
        self.assertEqual(bytes(out[:13]), data[:13])
        f.seek(2_000_000)
        self.assertEqual(f.read(40), data[2_000_000:2_000_040])
        self.assertLessEqual(len(asset.calls), 3)
        self.assertTrue(all(s % gr.BLOCK_BYTES == 0 for s, _ in asset.calls))

    def test_hdf5_opens_through_block_reader(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'gunw.h5'
            build(path)
            asset = FakeAsset(path.read_bytes())
            with h5py.File(gr.BlockRangeFile(asset), 'r') as h:
                crop = gr.read_crop(h, (X[0], Y[-1], X[-1], Y[0]))
            self.assertEqual(crop.phase.shape, (NY, NX))


if __name__ == '__main__':
    unittest.main()
