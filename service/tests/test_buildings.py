"""Tests for OSM building parsing and ground-tilt ratings (no network)."""
import math
import unittest

import numpy as np

from service import buildings as bd
from service import ground_motion as gm


def way(i, ring, **tags):
    return {'type': 'way', 'id': i, 'tags': {'building': 'yes', **tags},
            'geometry': [{'lon': lon, 'lat': lat} for lon, lat in ring]}


SQUARE = [(51.20, 35.60), (51.2002, 35.60), (51.2002, 35.6002), (51.20, 35.6002), (51.20, 35.60)]


class ParsingTests(unittest.TestCase):
    def test_height_from_tags_levels_or_flagged_default(self):
        self.assertEqual(bd.parse_height({'height': '24 m'}), (24.0, 'height'))
        self.assertEqual(bd.parse_height({'height': '12,5'}), (12.5, 'height'))
        self.assertEqual(bd.parse_height({'building:levels': '5'}), (16.0, 'levels'))
        self.assertEqual(bd.parse_height({'height': 'tall', 'building:levels': 'many'}), (12.8, 'default'))
        self.assertEqual(bd.parse_height({'height': '9000'})[1], 'default')

    def test_keeps_only_closed_building_ways(self):
        osm = {'elements': [
            way(1, SQUARE),
            way(2, SQUARE[:-1]),                                       # not closed
            {'type': 'node', 'id': 3, 'tags': {'building': 'yes'}},
            {'type': 'way', 'id': 4, 'tags': {'highway': 'primary'}, 'geometry': []},
            way(5, [SQUARE[0], SQUARE[1], SQUARE[0], SQUARE[0]]),      # degenerate
        ]}
        parsed = bd.parse_buildings(osm)
        self.assertEqual([b['id'] for b in parsed], [1])
        self.assertEqual(parsed[0]['height_source'], 'default')

    def test_query_is_bounded_to_the_area(self):
        q = bd.overpass_query((51.05, 35.55, 51.45, 35.72))
        self.assertIn('(35.55,51.05,35.72,51.45)', q)
        self.assertIn('maxsize', q)
        self.assertIn('out count;', bd.overpass_query((0, 0, 1, 1), count_only=True))


class ContextTests(unittest.TestCase):
    def test_context_kinds(self):
        self.assertEqual(bd.context_kind({'highway': 'primary'}), 'road:primary')
        self.assertIsNone(bd.context_kind({'highway': 'footway'}))
        self.assertEqual(bd.context_kind({'leisure': 'park'}), 'green')
        self.assertEqual(bd.context_kind({'natural': 'water'}), 'water')
        self.assertIsNone(bd.context_kind({'building': 'yes'}))


class RatingTests(unittest.TestCase):
    def test_categories_follow_years_to_1_in_500(self):
        self.assertEqual(bd.rate_tilt(float('nan'), 1e-5)[0], 'not_measured')
        self.assertEqual(bd.rate_tilt(1e-4, 1e-4)[0], 'not_enough_evidence')
        cat, years = bd.rate_tilt(4e-4, 1e-5)                   # 1/500 in 5 years
        self.assertEqual(cat, 'high')
        self.assertAlmostEqual(years['years_to_1_in_500'], 5.0)
        self.assertAlmostEqual(years['years_to_1_in_150'], round(1 / 150 / 4e-4, 1))
        self.assertEqual(bd.rate_tilt(1e-4, 1e-5)[0], 'elevated')   # 20 years
        self.assertEqual(bd.rate_tilt(2e-5, 1e-6)[0], 'low')         # 100 years

    def test_tilt_uncertainty_propagation(self):
        t, s = bd.tilt_from_slopes(3.0, 4.0, 0.3, 0.4)
        self.assertEqual(t, 5.0)
        self.assertAlmostEqual(s, math.hypot(0.9, 1.6) / 5.0)
        self.assertTrue(math.isnan(bd.tilt_from_slopes(float('nan'), 1, 1, 1)[0]))

    def test_assess_reads_tilt_beneath_each_building(self):
        zone = 39
        x0, y0 = gm.lonlat_to_utm(51.19, 35.61, zone)
        x0, y0 = 40.0 + 80.0 * np.floor(float(x0) / 80.0), 40.0 + 80.0 * np.floor(float(y0) / 80.0)
        x = x0 + 80.0 * np.arange(60)
        y = y0 - 80.0 * np.arange(60)
        # Ground sinks 0.04 mm/yr more for every metre east: tilt 4e-5 per year (1 in 500 in 50 years).
        vertical = np.tile(-0.04 * (x - x[0]), (y.size, 1))
        b = bd.parse_buildings({'elements': [way(1, SQUARE), way(2, [(p[0] + 5, p[1]) for p in SQUARE])]})
        feats = bd.assess(b, x, y, 32639, vertical, 80.0)
        p = feats[0]['properties']
        self.assertEqual(p['category'], 'low')
        self.assertAlmostEqual(p['ground_tilt_per_year'], 4e-5, places=9)
        self.assertEqual(p['tilt_toward_deg'], 90)                         # sinks toward the east
        self.assertAlmostEqual(p['years_to_1_in_500'], 50.0, places=1)
        self.assertEqual(feats[1]['properties']['category'], 'not_measured')  # far outside the grid
        self.assertEqual(feats[0]['geometry']['type'], 'Polygon')


if __name__ == '__main__':
    unittest.main()
