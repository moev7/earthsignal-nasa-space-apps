"""Synthetic native HDF5 bytes from producer 1.6 contracts, NOT live NISAR evidence."""
import base64
import hashlib
import io
import math
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import h5py
import numpy as np

from service.range_reader import TransferBudget, RangeError
from service.sar.net import SarError
from service.sar.nisar_extended import read_gslc, read_goff, IDENT
from service.tests.test_processing import Response


def fixture(product='GSLC', endian='<', mutate=None, shape=(4, 5)):
    """Synthetic declarations only; no ASF catalog or live source claim."""
    ny, nx = shape
    item = {'properties': {'platform': 'NISAR', 'processingLevel': product, 'fileID': 'synthetic-' + product,
        'sceneName': 'SYNTHETIC_' + product, 'pathNumber': 1, 'frameNumber': 2,
        'flightDirection': 'Ascending', 'startTime': '2026-01-01T00:00:00Z',
        'url': 'https://nisar.asf.earthdatacloud.nasa.gov/NISAR/synthetic-' + product + '.h5'}}
    stream = io.BytesIO()
    with h5py.File(stream, 'w') as h:
        ident = h.require_group(IDENT)
        facts = {'missionId': 'NISAR', 'productType': product, 'productLevel': 'L2', 'radarBand': 'L',
            'isGeocoded': 'True', 'productSpecificationVersion': '1.6.0', 'granuleId': 'SYNTHETIC_' + product,
            'trackNumber': 1, 'frameNumber': 2, 'orbitPassDirection': 'Ascending', 'lookDirection': 'Left',
            'productVersion': '0.1.0', 'compositeReleaseId': 'RTEST', 'listOfFrequencies': ['A']}
        if product == 'GSLC':
            facts.update(zeroDopplerStartTime='2026-01-01T00:00:00.000000000',
                         zeroDopplerEndTime='2026-01-01T00:01:00.000000000')
        else:
            for prefix, date in [('reference', '2026-01-01'), ('secondary', '2026-01-13')]:
                facts[prefix + 'ZeroDopplerStartTime'] = date + 'T00:00:00.000000000'
                facts[prefix + 'ZeroDopplerEndTime'] = date + 'T00:01:00.000000000'
        for k, v in facts.items():
            ident[k] = np.bytes_(v) if isinstance(v, str) else np.array(v, dtype='S2') if isinstance(v, list) else v
        f = h.require_group('/science/LSAR/' + product + '/grids/frequencyA')
        f['listOfPolarizations'] = np.array(['HH', 'VV'], dtype='S2')
        spacing = 80 if product == 'GOFF' else 10

        def geo(g):
            for name, value in {'xCoordinates': 100 + spacing * np.arange(nx, dtype='f8'),
                'yCoordinates': 1000 - spacing * np.arange(ny, dtype='f8'),
                'xCoordinateSpacing': float(spacing), 'yCoordinateSpacing': -float(spacing),
                'projection': np.uint32(32639)}.items():
                ds = g.create_dataset(name, data=value)
                if name != 'projection':
                    ds.attrs['units'] = np.bytes_('meters')

        def plane(g, name, data, units=None, fill=None):
            ds = g.create_dataset(name, data=data, chunks=True)
            ds.attrs['grid_mapping'] = np.bytes_('projection')
            if units is not None:
                ds.attrs['units'] = np.bytes_(units)
            ds.attrs['_FillValue'] = fill
            return ds

        if product == 'GSLC':
            geo(f)
            numbers = (np.arange(nx * ny).reshape(shape) + 3 + 4j).astype(endian + 'c8')
            for channel in ('HH', 'VV'):
                ds = plane(f, channel, numbers, '1', np.complex64(complex(np.nan, np.nan)))
                ds.attrs['isReceiveOnly'] = np.bytes_('False')
            ds = plane(f, 'mask', np.ones(shape, 'u1'), fill=np.uint8(255))
            ds.attrs['long_name'] = np.bytes_('Valid samples subswath mask')
            plane(f, 'inputDataExceptionMask', np.full(shape, 256 | 2048, dtype=endian + 'u2'), fill=np.uint16(65535))
            p = h.require_group('/science/LSAR/GSLC/metadata/processingInformation/parameters')
            p['ellipsoidalFlatteningApplied'] = np.bytes_('False')
            p['topographicFlatteningApplied'] = np.bytes_('True')
        else:
            f['listOfLayers'] = np.array(['layer1', 'layer2', 'layer3'], dtype='S6')
            offsets = f.require_group('pixelOffsets'); geo(offsets)
            plane(offsets, 'mask', np.full(shape, 11, dtype=endian + 'u4'), fill=np.uint32(255))
            pol = offsets.require_group('HH'); geo(pol)
            plane(pol, 'validDataMask', np.full(shape, 3, 'u1'), '1', np.uint8(255))
            for layer in (1, 2, 3):
                g = pol.require_group('layer' + str(layer)); geo(g)
                for name, unit, data in (
                    ('slantRangeOffset', 'meters', np.arange(nx * ny).reshape(shape) / 4 - 2),
                    ('alongTrackOffset', 'meters', np.arange(nx * ny).reshape(shape) / -8 + 2),
                    ('slantRangeOffsetVariance', 'meters^2', np.full(shape, .25)),
                    ('alongTrackOffsetVariance', 'meters^2', np.full(shape, .5)),
                    ('snr', '1', np.full(shape, 4)), ('correlationSurfacePeak', '1', np.full(shape, .8))):
                    plane(g, name, np.asarray(data, dtype=endian + 'f4'), unit, np.float32(np.nan))
        if mutate:
            mutate(h)
    return item, stream.getvalue()


class Opener:
    def __init__(self, raw, url):
        self.raw, self.url, self.requests = raw, url, []

    def open(self, req, timeout=30):
        start, end = map(int, req.headers['Range'][6:].split('-'))
        self.requests.append((start, end))
        return Response(self.raw[start:end + 1], start, len(self.raw), url=self.url)


FREQ = '/science/LSAR/GSLC/grids/frequencyA/'
OFF = '/science/LSAR/GOFF/grids/frequencyA/pixelOffsets/'
LAYER = OFF + 'HH/layer1/'


class ExtendedReaderTests(unittest.TestCase):
    def read(self, product='GSLC', *, endian='<', mutate=None, shape=(4, 5), projected=None,
             budget=None, item_change=None, **kwargs):
        item, raw = fixture(product, endian, mutate, shape)
        if item_change:
            item_change(item)
        reader = SimpleNamespace(budget=budget or TransferBudget())
        opener = Opener(raw, item['properties']['url'])
        step = 80 if product == 'GOFF' else 10
        projected = projected or [100, 1000 - step * (shape[0] - 1), 100 + step * (shape[1] - 1), 1000]
        with patch('service.sar.nisar_extended.authenticated_opener', return_value=opener), \
             patch('service.sar.nisar_extended._project', return_value=projected):
            result = (read_gslc if product == 'GSLC' else read_goff)(
                item, [50, 30, 51, 31], kwargs.pop('channel', 'HH'), 'unused-fixture-netrc', reader, **kwargs)
        self.assertTrue(opener.requests)
        self.assertLessEqual(reader.budget.transferred, reader.budget.limit)
        self.assertEqual(reader.budget.reserved, 0)
        return result, raw, opener, reader

    def test_gslc_independent_complex_math_and_exact_original_endianness(self):
        for endian in ('<', '>'):
            with self.subTest(endian=endian):
                crop, raw, _, _ = self.read(endian=endian)
                expected = np.array([[10 * math.log10((3 + y*5 + x)**2 + 16) for x in range(5)] for y in range(4)])
                np.testing.assert_allclose(crop.values, expected, rtol=0, atol=1e-13)
                self.assertEqual((crop.convention, crop.quantity, crop.unit), ('beta0', 'radar backscatter', 'dB'))
                proof = crop.evidence['sourceComplex']
                original = base64.b64decode(proof['data'])
                with h5py.File(io.BytesIO(raw), 'r') as h:
                    self.assertEqual(original, h[FREQ + 'HH'][()].tobytes())
                    self.assertEqual(proof['dtype'], h[FREQ + 'HH'].dtype.str)
                self.assertEqual(proof['sha256'], hashlib.sha256(original).hexdigest())
                self.assertFalse(crop.evidence['lutConversionApplied'])

    def test_gslc_window_preserves_original_samples_and_native_grid(self):
        c, _, _, _ = self.read(projected=[110, 980, 130, 990])
        self.assertEqual(c.values.shape, (2, 3))
        self.assertEqual(c.grid['transform'], [105, 10, 0, 995, 0, -10])
        self.assertEqual(c.evidence['pixelWindow'], [1, 1, 3, 2])
        z = np.frombuffer(base64.b64decode(c.evidence['sourceComplex']['data']), dtype='<c8').reshape(2, 3)
        np.testing.assert_array_equal(z.real, [[9, 10, 11], [14, 15, 16]])

    def test_gslc_all_critical_fill_focus_anomaly_and_finite_masks(self):
        def change(h):
            h[FREQ + 'mask'][0, :3] = [0, 255, 3]
            h[FREQ + 'inputDataExceptionMask'][1, :4] = [0, 256 | 2, 65535, 2048]
            h[FREQ + 'HH'][2, :3] = [0j, complex(np.nan, 1), complex(1, np.inf)]
        c, _, _, _ = self.read(mutate=change)
        expected = np.ones((4, 5), bool)
        expected[0, :2] = False; expected[1, :4] = False; expected[2, :3] = False
        np.testing.assert_array_equal(c.valid, expected)
        self.assertTrue(np.isnan(c.values[~expected]).all())

    def test_selected_polarization_focus_bit_is_used(self):
        def change(h): h[FREQ + 'inputDataExceptionMask'][0, 0] = 256
        c, _, _, _ = self.read(channel='VV', mutate=change)
        self.assertFalse(c.valid[0, 0]); self.assertTrue(c.valid[0, 1])

    def test_complex_power_promotes_before_squaring(self):
        def change(h): h[FREQ + 'HH'][0, 0] = np.complex64(1e30 + 1e30j)
        c, _, _, _ = self.read(mutate=change)
        self.assertTrue(c.valid[0, 0]); self.assertAlmostEqual(c.values[0, 0], 603.0102999566, places=5)

    def test_gslc_rejects_unknown_spec_mission_identity_and_dates(self):
        for key, value in [('productSpecificationVersion', '1.5.0'), ('missionId', 'OTHER'),
            ('granuleId', 'wrong'), ('radarBand', 'S'), ('productType', 'GCOV'),
            ('zeroDopplerStartTime', '2026-01-02T00:00:00'), ('zeroDopplerEndTime', '2025-01-01T00:00:00')]:
            def change(h, key=key, value=value):
                del h[IDENT + '/' + key]; h[IDENT + '/' + key] = np.bytes_(value)
            with self.subTest(key=key), self.assertRaises(SarError): self.read(mutate=change)

    def test_gslc_rejects_real_reinterpretation_and_unknown_fill_or_mask(self):
        def real(h):
            del h[FREQ + 'HH']; h[FREQ + 'HH'] = np.ones((4, 5), 'f4')
        cases = [real,
            lambda h: h[FREQ + 'HH'].attrs.modify('_FillValue', 0j),
            lambda h: h[FREQ + 'mask'].__setitem__((0, 0), 4),
            lambda h: h[FREQ + 'inputDataExceptionMask'].__setitem__((0, 0), 257),
            lambda h: h[FREQ + 'HH'].attrs.modify('isReceiveOnly', np.bytes_('True'))]
        for case in cases:
            with self.subTest(case=case), self.assertRaises(SarError): self.read(mutate=case)

    def test_disabled_or_unknown_flattening_rejects(self):
        def change(h):
            p = h['/science/LSAR/GSLC/metadata/processingInformation/parameters']
            del p['topographicFlatteningApplied']; p['topographicFlatteningApplied'] = np.bytes_('False')
        with self.assertRaises(SarError): self.read(mutate=change)

    def test_goff_independent_source_offset_oracle_both_components_and_endianness(self):
        for endian in ('<', '>'):
            for component, divisor, intercept in [('slant-range', 4, -2), ('along-track', -8, 2)]:
                with self.subTest(endian=endian, component=component):
                    c, _, _, _ = self.read('GOFF', endian=endian, component=component)
                    expected = np.array([[(y*5 + x) / divisor + intercept for x in range(5)] for y in range(4)])
                    np.testing.assert_array_equal(c.values, expected)
                    self.assertEqual(c.unit, 'meters'); self.assertEqual(c.quantity, 'radar pixel offset')
                    self.assertTrue(c.valid.all())
                    self.assertIn('residual outliers', c.evidence['sourceFiltering'])
                    self.assertEqual(c.evidence['uncertainty']['unit'], 'meters^2')

    def test_goff_screening_mask_snr_variance_peak_and_outlier_retention(self):
        def change(h):
            h[OFF + 'mask'][0] = [0, 255, 11 | (2 << 8), 111, 11]
            h[OFF + 'HH/validDataMask'][1] = [0, 1, 2, 255, 3]
            h[LAYER + 'snr'][2, :2] = [0, np.nan]
            h[LAYER + 'slantRangeOffsetVariance'][2, 2:] = [-1, np.nan, 0]
            h[LAYER + 'correlationSurfacePeak'][3, :3] = [0, 1.1, np.inf]
            h[LAYER + 'slantRangeOffset'][3, 3:] = [np.nan, 1000000]
        c, _, _, _ = self.read('GOFF', mutate=change)
        expected = np.zeros((4, 5), bool)
        expected[0, 3:] = True; expected[1, 4] = True; expected[2, 4] = True; expected[3, 4] = True
        np.testing.assert_array_equal(c.valid, expected)
        self.assertEqual(c.values[3, 4], 1000000)  # no fictional outlier rejection

    def test_goff_window_and_layer_selection(self):
        c, _, _, _ = self.read('GOFF', layer=2, projected=[180, 840, 340, 920])
        self.assertEqual(c.values.shape, (2, 3)); self.assertEqual(c.evidence['layer'], 2)
        np.testing.assert_array_equal(c.values, [[-.5, -.25, 0], [.75, 1, 1.25]])

    def test_goff_rejects_guessed_units_fill_grid_and_mask_semantics(self):
        cases = [lambda h: h[LAYER + 'slantRangeOffset'].attrs.modify('units', np.bytes_('pixels')),
            lambda h: h[LAYER + 'slantRangeOffsetVariance'].attrs.modify('units', np.bytes_('meters')),
            lambda h: h[LAYER + 'snr'].attrs.modify('_FillValue', -999),
            lambda h: h[LAYER + 'xCoordinateSpacing'].__setitem__((), 40),
            lambda h: h[OFF + 'mask'].__setitem__((0, 0), 1 << 31 | 11),
            lambda h: h[OFF + 'mask'].__setitem__((0, 0), 44),
            lambda h: h[OFF + 'mask'].__setitem__((0, 0), 11 | (1 << 8)),
            lambda h: h[OFF + 'HH/validDataMask'].__setitem__((0, 0), 4),
            lambda h: h[OFF + 'HH/xCoordinates'].__setitem__(0, 110)]
        for case in cases:
            with self.subTest(case=case), self.assertRaises(SarError): self.read('GOFF', mutate=case)

    def test_goff_unknown_spec_mission_pair_chronology_and_catalog_fail_closed(self):
        for name, value in [('missionId', 'OTHER'), ('productSpecificationVersion', '2.0.0'),
            ('secondaryZeroDopplerStartTime', '2025-01-01T00:00:00'), ('granuleId', 'mismatch')]:
            def change(h, name=name, value=value):
                del h[IDENT + '/' + name]; h[IDENT + '/' + name] = np.bytes_(value)
            with self.subTest(name=name), self.assertRaises(SarError): self.read('GOFF', mutate=change)
        with self.assertRaises(SarError):
            self.read('GOFF', item_change=lambda i: i['properties'].update(platform='ALOS'))
        for kwargs in ({'component': 'los'}, {'layer': True}, {'layer': 0}, {'layer': 4}):
            with self.subTest(kwargs=kwargs), self.assertRaises(SarError): self.read('GOFF', **kwargs)

    def test_grid_internal_irregularity_outside_crop_rejects(self):
        def change(h): h[FREQ + 'xCoordinates'][3] += .5
        with self.assertRaises(SarError): self.read(mutate=change, projected=[100, 990, 110, 1000])

    def test_unknown_projection_and_scaling_reject(self):
        for change in (lambda h: h[FREQ + 'projection'].__setitem__((), 4326),
                       lambda h: h[FREQ + 'HH'].attrs.__setitem__('scale_factor', 2)):
            with self.assertRaises(SarError): self.read(mutate=change)

    def test_variable_length_metadata_and_external_links_reject(self):
        def variable(h):
            del h[IDENT + '/missionId']; h[IDENT + '/missionId'] = 'NISAR'
        def external(h):
            del h[FREQ + 'HH']; h[FREQ + 'HH'] = h5py.ExternalLink('/forbidden-file', 'HH')
        def soft(h):
            del h[FREQ + 'VV']; h[FREQ + 'VV'] = h5py.SoftLink(FREQ + 'HH')
        for case in (variable, external):
            with self.assertRaises(SarError): self.read(mutate=case)
        with self.assertRaises(SarError): self.read(mutate=soft, channel='VV')

    def test_native_output_cap_precedes_science_reads(self):
        for product in ('GSLC', 'GOFF'):
            native_getitem = h5py.Dataset.__getitem__
            def no_science(ds, key, **kwargs):
                self.assertLess(ds.ndim, 2, 'Science plane read before output admission')
                return native_getitem(ds, key, **kwargs)
            with self.subTest(product=product), patch.object(h5py.Dataset, '__getitem__', no_science), \
                 self.assertRaises(SarError) as caught:
                self.read(product, shape=(513, 512))
            self.assertEqual(caught.exception.code, 'pixel_limit')

    def test_identity_failure_precedes_all_science_reads(self):
        native_getitem = h5py.Dataset.__getitem__
        def no_science(ds, key, **kwargs):
            self.assertLess(ds.ndim, 2, 'Science plane read before identity verification')
            return native_getitem(ds, key, **kwargs)
        def change(h):
            del h[IDENT + '/missionId']; h[IDENT + '/missionId'] = np.bytes_('OTHER')
        for product in ('GSLC', 'GOFF'):
            with self.subTest(product=product), patch.object(h5py.Dataset, '__getitem__', no_science), \
                 self.assertRaises(SarError) as caught:
                self.read(product, mutate=change)
            self.assertEqual(caught.exception.code, 'source_identity')

    def test_range_reads_do_not_fetch_unrelated_large_science_payload(self):
        def change(h):
            # Allocated source bytes, deliberately not sparse file metadata.
            h.create_dataset('unrelated-original-bytes', data=np.zeros(12 * 1024**2, 'u1'))
        c, raw, opener, reader = self.read(mutate=change, projected=[100, 990, 110, 1000])
        self.assertEqual(c.values.shape, (2, 2))
        self.assertLess(reader.budget.transferred, len(raw) // 2)
        self.assertTrue(all(end - start + 1 <= 1024**2 for start, end in opener.requests))

    def test_gslc_packed_complex32_and_oversized_decoded_chunk_remain_gates(self):
        def packed(h):
            del h[FREQ + 'HH']
            h[FREQ + 'HH'] = np.ones((4, 5), dtype=[('r', '<f2'), ('i', '<f2')])
        def huge_chunk(h):
            del h[FREQ + 'HH']
            h.create_dataset(FREQ + 'HH', shape=(2048, 2048), dtype='c8', chunks=(2048, 2048))
        for change, code in ((packed, 'representation_unknown'), (huge_chunk, 'resource_limit')):
            with self.subTest(code=code), self.assertRaises(SarError) as caught:
                self.read(mutate=change)
            self.assertEqual(caught.exception.code, code)

    def test_shared_range_budget_exhaustion_never_download_falls_back(self):
        with self.assertRaises(RangeError) as caught:
            self.read(budget=TransferBudget(10))
        self.assertEqual(caught.exception.code, 'TRANSFER_LIMIT')


if __name__ == '__main__':
    unittest.main()
