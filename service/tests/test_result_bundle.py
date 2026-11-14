"""Tests for the Ground Truth result-bundle exporter (synthetic inputs, no network)."""
import json
import math
import tempfile
import unittest
from pathlib import Path

import numpy as np

from service import ground_motion as gm
from service import result_bundle as rb

ASC = (-0.62, -0.12, 0.775)
DESC = (0.62, -0.12, 0.775)
CENTRE = (51.30, 35.60)
BBOX = [51.26, 35.57, 51.34, 35.63]


def synthetic_run(folder: Path, hole=True):
    """A 12 km grid with a Gaussian sinking bowl (-200 mm/yr) at CENTRE and an unmeasured corner."""
    cx, cy = gm.lonlat_to_utm(CENTRE[0], CENTRE[1], 39)
    cx, cy = 40.0 + 80.0 * round(float(cx) / 80.0), 40.0 + 80.0 * round(float(cy) / 80.0)
    x = cx + 80.0 * np.arange(-75, 76)
    y = cy - 80.0 * np.arange(-75, 76)
    r2 = (x[None, :] - cx) ** 2 + (y[:, None] - cy) ** 2
    up = -200.0 * np.exp(-r2 / (2 * 2000.0 ** 2))
    if hole:
        up[:20, :20] = np.nan
    arrays = {'epsg': np.int32(32639), 'x': x, 'y': y, 'vertical_rate': up, 'east_rate': np.zeros_like(up)}
    for d, v in (('A', ASC), ('D', DESC)):
        arrays[f'{d}_rate'] = v[2] * up
        arrays[f'{d}_sigma'] = np.full_like(up, 10.0)
        for k, c in zip(('los_east', 'los_north', 'los_up'), v):
            arrays[f'{d}_{k}'] = np.full_like(up, c)
        arrays[f'{d}_x'], arrays[f'{d}_y'] = x, y
    np.savez_compressed(folder / 'ground_motion.npz', **arrays)
    pair = lambda d, i: {'granule': f'NISAR_L2_PR_GUNW_0{i}_056_{d}_019', 'reference': '2026-06-18'}  # noqa: E731
    summary = {'algorithm': gm.ALGORITHM_VERSION, 'bbox_lonlat': BBOX, 'reference_lonlat': BBOX,
               'collections_searched': ['NISAR_L2_GUNW_PROVISIONAL_V1'], 'rejected': [],
               'settings': {'min_coherence': 0.4, 'min_coverage': 0.6, 'corrections': ['ionosphere (product)']},
               'stacks': [{'direction': d, 'track': 56, 'frame': 19, 'pairs': 3, 'first': '2026-06-18', 'last': '2026-10-16',
                           'troposphere_applied': False, 'measured_fraction': 0.5,
                           'pairs_detail': [pair(d, i) for i in range(3)]} for d in ('A', 'D')],
               'reference_offsets_mm_per_year': {'A': 1.0, 'D': 2.0}}
    (folder / 'summary.json').write_text(json.dumps(summary))
    ring = [[CENTRE[0] + dx, CENTRE[1] + dy] for dx, dy in ((0, 0), (2e-4, 0), (2e-4, 2e-4), (0, 2e-4), (0, 0))]
    ring[1][0] += 1.23456789e-7
    bld = {'type': 'FeatureCollection',
           'metadata': {'attribution': '© OpenStreetMap contributors', 'osm_snapshot': '2026-11-05T21:23:02Z',
                        'bbox_lonlat': BBOX, 'heights': {'default': 1}, 'method': {}},
           'features': [{'type': 'Feature', 'geometry': {'type': 'Polygon', 'coordinates': [ring]},
                         'properties': {'osm_id': 1, 'category': 'low', 'vertical_mm_per_year': -190.0,
                                        'window_pixels': 49, 'height_estimated': True, 'height_m': 12.8,
                                        'height_source': 'default'}}]}
    (folder / 'buildings.geojson').write_text(json.dumps(bld))
    return x, y, up


class HelperTests(unittest.TestCase):
    def test_vertical_sigma_propagation(self):
        s = gm.decompose_up_sigma(np.array([10.0]), np.array([10.0]), ASC, DESC)
        det = ASC[0] * DESC[2] - DESC[0] * ASC[2]
        self.assertAlmostEqual(float(s[0]), math.hypot(0.62 * 10, 0.62 * 10) / abs(det), places=9)
        self.assertTrue(np.isnan(gm.decompose_up_sigma(np.array([1.0]), np.array([1.0]), ASC, ASC)[0]))

    def test_mercator_round_trip_and_lattice_shape(self):
        lat = np.array([-60.0, 0.0, 35.6])
        np.testing.assert_allclose(rb.mercator_lat(rb.mercator_y(lat)), lat, atol=1e-12)
        lon, lat = rb.mercator_lattice(BBOX, 80.0)
        self.assertEqual(lon.shape, lat.shape)
        self.assertTrue(np.all(np.diff(lat[:, 0]) < 0))                 # north first
        self.assertAlmostEqual(lon.shape[1], 0.08 * 111320 * math.cos(math.radians(35.6)) / 80, delta=1)

    def test_colourise_marks_gaps_transparent_and_sinking_warm(self):
        rgba = rb.colourise(np.array([[-250.0, 0.0, 250.0, np.nan]]))
        self.assertEqual(rgba[0, 3, 3], 0)
        self.assertEqual(tuple(rgba[0, 0, :3]), (194, 61, 23))
        self.assertEqual(tuple(rgba[0, 1, :3]), (244, 241, 234))
        self.assertEqual(tuple(rgba[0, 2, :3]), (34, 80, 143))
        self.assertTrue(np.all(rgba[0, :3, 3] == rb.OVERLAY_ALPHA))

    def test_grid_must_be_regular(self):
        with self.assertRaises(gm.GroundMotionError):
            rb._check_grid(np.array([0.0, 80.0, 170.0]), np.array([0.0, -80.0, -160.0]))


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.x, self.y, self.up = synthetic_run(self.dir)
        self.out = self.dir / 'bundle'

    def tearDown(self):
        self.tmp.cleanup()

    def export(self, buildings=True):
        return rb.export(self.dir / 'ground_motion.npz', self.dir / 'summary.json', self.out, 'test', 'Test',
                         self.dir / 'buildings.geojson' if buildings else None)

    def test_bundle_is_valid_and_records_provenance(self):
        m = self.export()
        self.assertEqual(rb.validate(self.out), [])
        self.assertEqual(m['provenance'], 'measured')
        self.assertEqual(m['source']['product_status'], 'provisional')
        self.assertEqual(len(m['source']['granules']), 6)
        self.assertEqual(m['source']['period'], {'start': '2026-06-18', 'end': '2026-10-16'})
        self.assertEqual(set(m['files']), {'vertical_rate.png', 'vertical_grid.json', 'buildings.geojson'})
        self.assertIn('tilt_not_damage', {c['id'] for c in m['caveats']})
        self.assertEqual(m['layers']['vertical_rate']['bounds'], [[35.57, 51.26], [35.63, 51.34]])

    def test_value_grid_reads_the_bowl_and_leaves_gaps_empty(self):
        m = self.export()
        g = json.loads((self.out / 'vertical_grid.json').read_text())
        rate = np.array([np.nan if v is None else v for v in g['vertical_rate']], float).reshape(g['rows'], g['cols'])
        sig = np.array([np.nan if v is None else v for v in g['vertical_sigma']], float).reshape(g['rows'], g['cols'])
        i = int((g['north'] - CENTRE[1]) / g['dlat'])
        j = int((CENTRE[0] - g['west']) / g['dlon'])
        self.assertLess(rate[i, j], -190)
        self.assertEqual(int(np.nanmedian(sig)), 9)                          # 10 mm/yr LOS -> ~9.1 vertical
        self.assertEqual(m['stats']['median_sigma'], 9.1)
        fastest = m['stats']['fastest_neighbourhood']
        self.assertLess(abs(fastest['lon'] - CENTRE[0]), 0.006)
        self.assertLess(abs(fastest['lat'] - CENTRE[1]), 0.006)
        areas, strict = m['stats']['area_km2_sinking_faster_than'], m['stats']['area_km2_sinking_faster_than_2sigma']
        # Bowl: -200 exp(-r^2 / 2 s^2), s = 2 km -> faster than 100 inside r = s sqrt(2 ln 2) = 2.35 km (17.4 km^2).
        self.assertAlmostEqual(areas['100'], math.pi * 2 * 2.0 ** 2 * math.log(2), delta=0.5)
        self.assertLessEqual(strict['100'], areas['100'])
        self.assertEqual(areas['200'], 0.0)

    def test_png_centre_is_measured_and_warm(self):
        from PIL import Image
        self.export()
        img = np.asarray(Image.open(self.out / 'vertical_rate.png'))
        self.assertEqual(img.shape[2], 4)
        h, w = img.shape[:2]
        centre = img[h // 2, w // 2]
        self.assertEqual(centre[3], rb.OVERLAY_ALPHA)
        self.assertGreater(int(centre[0]), int(centre[2]))                    # warm: sinking

    def test_unmeasured_patch_is_transparent_and_empty_data_refused(self):
        from PIL import Image
        z = dict(np.load(self.dir / 'ground_motion.npz'))
        up = z['vertical_rate'].copy()
        z['vertical_rate'] = np.full_like(up, np.nan)
        np.savez_compressed(self.dir / 'ground_motion.npz', **z)
        with self.assertRaises(gm.GroundMotionError):
            self.export()                                                     # nothing measured: refuse
        up[60:90, 60:90] = np.nan
        z['vertical_rate'] = up
        np.savez_compressed(self.dir / 'ground_motion.npz', **z)
        self.export()
        img = np.asarray(Image.open(self.out / 'vertical_rate.png'))
        h, w = img.shape[:2]
        self.assertEqual(img[h // 2, w // 2, 3], 0)

    def test_buildings_are_slimmed_and_rounded(self):
        self.export()
        b = json.loads((self.out / 'buildings.geojson').read_text())
        props = b['features'][0]['properties']
        self.assertNotIn('window_pixels', props)
        self.assertNotIn('height_estimated', props)
        self.assertEqual(props['vertical_mm_per_year'], -190.0)
        self.assertEqual(b['features'][0]['geometry']['coordinates'][0][1][0], round(CENTRE[0] + 2e-4, 6))

    def test_stale_buildings_removed_and_tampering_detected(self):
        self.export()
        m = self.export(buildings=False)
        self.assertIsNone(m['buildings'])
        self.assertFalse((self.out / 'buildings.geojson').exists())
        with (self.out / 'vertical_grid.json').open('a') as f:
            f.write(' ')
        self.assertEqual(rb.validate(self.out), ['hash mismatch for vertical_grid.json'])

    def test_caveats_are_derived_and_analyst_notes_kept_apart(self):
        m = rb.export(self.dir / 'ground_motion.npz', self.dir / 'summary.json', self.out, 'test', 'Test',
                      notes=[{'id': 'stripes', 'text': 'Swath-edge stripes.'}])
        by_id = {c['id']: c for c in m['caveats']}
        self.assertIn('4 months of data (2026-06-18 to 2026-10-16)', by_id['short_record']['text'])
        self.assertIn('±9 mm/yr', by_id['uncertainty']['text'])
        self.assertEqual(by_id['provisional']['source'], 'method')
        self.assertEqual(by_id['stripes']['source'], 'analyst')
        with self.assertRaises(gm.GroundMotionError):
            rb.export(self.dir / 'ground_motion.npz', self.dir / 'summary.json', self.out, 'test', 'Test',
                      notes=[{'text': 'no id'}])

    def test_focus_area_is_local_metres_around_the_high_buildings(self):
        b = json.loads((self.dir / 'buildings.geojson').read_text())
        with self.assertRaises(gm.GroundMotionError):
            rb.export(self.dir / 'ground_motion.npz', self.dir / 'summary.json', self.out, 'test', 'Test',
                      self.dir / 'buildings.geojson', focus='auto')            # no "high" building to centre on
        b['features'][0]['properties']['category'] = 'high'
        (self.dir / 'buildings.geojson').write_text(json.dumps(b))
        m = rb.export(self.dir / 'ground_motion.npz', self.dir / 'summary.json', self.out, 'test', 'Test',
                      self.dir / 'buildings.geojson', focus='auto')
        self.assertEqual(rb.validate(self.out), [])
        self.assertIn('focus.json', m['files'])
        f = json.loads((self.out / 'focus.json').read_text())
        self.assertEqual(f['categories'], {'high': 1})
        ring = np.array(f['buildings'][0]['ring'])
        self.assertLess(np.abs(ring).max(), rb.FOCUS_SIZE_M / 2)              # footprint inside the square
        self.assertAlmostEqual(ring[:, 0].max() - ring[:, 0].min(), 2e-4 * 111320 * math.cos(math.radians(35.6)), delta=1)
        g = f['grid']
        self.assertEqual(len(g['vertical_rate']), len(g['north']))
        self.assertEqual(len(g['vertical_rate'][0]), len(g['east']))
        self.assertTrue(all(abs(v) <= rb.FOCUS_SIZE_M / 2 + 80 for v in g['east'] + g['north']))
        self.assertTrue(g['north'][0] > g['north'][-1])
        # The bowl centre is at CENTRE: the grid value nearest the focus origin is close to -200 mm/yr.
        i = int(np.argmin(np.abs(g['north'])))
        j = int(np.argmin(np.abs(g['east'])))
        self.assertLess(g['vertical_rate'][i][j], -190)
        # A later export without a focus removes the stale file.
        m = self.export()
        self.assertIsNone(m['focus'])
        self.assertFalse((self.out / 'focus.json').exists())

    def test_focus_context_is_converted_to_local_metres(self):
        x, y, up = self.x, self.y, self.up
        b = json.loads((self.dir / 'buildings.geojson').read_text())
        line = [[CENTRE[0] - 0.001, CENTRE[1]], [CENTRE[0] + 0.001, CENTRE[1]]]
        area = rb.focus_area(x, y, up, np.full_like(up, 9.0), b['features'], 39, 32639, CENTRE,
                             context=[{'kind': 'road:primary', 'coords': line}])
        road = area['context'][0]
        self.assertEqual(road['kind'], 'road:primary')
        (e0, n0), (e1, n1) = road['line']
        self.assertAlmostEqual(e1 - e0, 0.002 * 111320 * math.cos(math.radians(CENTRE[1])), delta=1.5)
        self.assertLess(abs(n0), 2) and self.assertLess(abs(n1), 2)
        box = rb.focus_context_bbox(CENTRE)
        self.assertLess(box[0], CENTRE[0] - 0.0066)
        self.assertGreater(box[3], CENTRE[1] + 0.0054)

    def test_refuses_without_provenance(self):
        s = json.loads((self.dir / 'summary.json').read_text())
        s['stacks'] = []
        (self.dir / 'summary.json').write_text(json.dumps(s))
        with self.assertRaises(gm.GroundMotionError):
            self.export()


if __name__ == '__main__':
    unittest.main()
