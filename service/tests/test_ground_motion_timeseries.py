"""Analytical tests for the date-by-date ground-motion time series (no network)."""
import unittest

import numpy as np

from service import ground_motion as gm
from service import ground_motion_timeseries as ts


class CumulativeTests(unittest.TestCase):
    def test_linear_subsidence_accumulates_rate_times_time(self):
        rate = np.full((2, 3), -365.25)              # -1 mm per day
        spans = [12, 12, 24]
        disp = [rate / 365.25 * t for t in spans]
        cum, bridged = ts.cumulative(disp, spans, rate)
        self.assertEqual(cum.shape, (4, 2, 3))
        np.testing.assert_allclose(cum[:, 0, 0], [0, -12, -24, -48])
        self.assertEqual(bridged, 0.0)

    def test_unreliable_step_is_bridged_with_the_pixel_rate_and_reported(self):
        rate = np.array([[-365.25, np.nan]])
        disp = [np.array([[-12.0, -5.0]]), np.array([[np.nan, -5.0]])]
        cum, bridged = ts.cumulative(disp, [12, 12], rate)
        np.testing.assert_allclose(cum[:, 0, 0], [0, -12, -24])
        self.assertTrue(np.all(np.isnan(cum[:, 0, 1])), 'no rate -> never shown')
        self.assertAlmostEqual(bridged, 0.5)


class EpochTests(unittest.TestCase):
    def test_chain_epochs_lists_dates_and_rejects_gaps(self):
        self.assertEqual(ts.chain_epochs([('2026-06-30', '2026-07-12'), ('2026-06-18', '2026-06-30')]),
                         ['2026-06-18', '2026-06-30', '2026-07-12'])
        with self.assertRaises(gm.GroundMotionError):
            ts.chain_epochs([('2026-06-18', '2026-06-30'), ('2026-07-12', '2026-07-24')])

    def test_descending_dates_are_interpolated_linearly_and_held_at_the_ends(self):
        values = np.array([0.0, -12.0, -24.0])[:, None, None]
        out = ts.interpolate_epochs(values, ['2026-06-23', '2026-07-05', '2026-07-17'],
                                    ['2026-06-18', '2026-06-29', '2026-07-17', '2026-07-30'])
        np.testing.assert_allclose(out[:, 0, 0], [0.0, -6.0, -24.0, -24.0])


if __name__ == '__main__':
    unittest.main()
