"""Analytical tests for the GUNW ground-motion science core (no network, no GDAL)."""
import math
import unittest

import numpy as np

from service import ground_motion as gm

LAMBDA = gm.SPEED_OF_LIGHT / 1.229e9


class MaskTests(unittest.TestCase):
    def test_decodes_water_subswath_and_anomaly_bits(self):
        values = np.array([11, 12, 21, 111, 0, 10, 1, 255, 11 | (1 << 24), 11 | (1 << 8), 11 | (1 << 16)], np.uint32)
        expected = [True, True, True, False, False, False, False, False, True, False, False]
        self.assertEqual(gm.valid_sample_mask(values).tolist(), expected)

    def test_keeps_only_the_largest_connected_component(self):
        comps = np.array([[1, 1, 2], [1, 2, 2], [0, 2, 2]], np.uint16)
        usable = np.ones((3, 3), bool)
        self.assertEqual(int(gm.largest_component(comps, usable).sum()), 5)
        self.assertFalse(gm.largest_component(np.zeros((2, 2), np.uint16), np.ones((2, 2), bool)).any())

    def test_quality_combines_coherence_mask_and_components(self):
        phase = np.zeros((2, 2))
        phase[0, 0] = np.nan
        coh = np.array([[0.9, 0.2], [0.9, 0.9]])
        mask = np.array([[11, 11], [111, 11]], np.uint32)
        q = gm.pair_quality(phase, coh, np.ones((2, 2), np.uint16), mask, 0.4)
        self.assertEqual(q.tolist(), [[False, False], [False, True]])
        with self.assertRaises(gm.GroundMotionError):
            gm.pair_quality(phase, coh, np.ones((2, 2)), mask, 1.5)


class ConversionTests(unittest.TestCase):
    def test_wavelength_from_l_band_frequency(self):
        self.assertAlmostEqual(gm.wavelength_from_frequency(1.229e9), 0.24393, places=5)
        with self.assertRaises(gm.GroundMotionError):
            gm.wavelength_from_frequency(5.4e9)

    def test_positive_phase_is_motion_away_from_satellite(self):
        phase = np.array([4 * math.pi / LAMBDA * 0.01])        # 1 cm of range increase
        self.assertAlmostEqual(float(gm.phase_to_los_mm(phase, LAMBDA)[0]), -10.0, places=6)

    def test_corrections_are_subtracted_before_conversion(self):
        phase = np.full(3, 2.0)
        mm = gm.phase_to_los_mm(phase, LAMBDA, [np.full(3, 0.5), np.full(3, 1.5)])
        np.testing.assert_allclose(mm, 0.0, atol=1e-12)

    def test_reference_subtracts_region_median_and_blanks_invalid(self):
        v = np.arange(100, dtype=float).reshape(10, 10)
        valid = np.ones_like(v, bool)
        valid[0, 0] = False
        region = np.zeros_like(valid)
        region[5:, :] = True
        out, ref = gm.reference_to(v, valid, region)
        self.assertEqual(ref, 74.5)
        self.assertTrue(np.isnan(out[0, 0]))
        with self.assertRaises(gm.GroundMotionError):
            gm.reference_to(v, valid, np.zeros_like(valid))


class StackTests(unittest.TestCase):
    def test_recovers_known_rate_and_reports_uncertainty(self):
        rng = np.random.default_rng(7)
        spans = [12, 12, 24, 12, 12, 12]
        truth = -150.0                                        # mm/yr
        disp = [truth * t / gm.DAYS_PER_YEAR + rng.normal(0, 1.0, (20, 20)) for t in spans]
        rate, sigma, n, cov = gm.stack_rate(disp, spans)
        self.assertLess(abs(np.nanmean(rate) - truth), 3.0)
        self.assertTrue(np.all(sigma > 0))
        self.assertTrue(np.all(n == 6))
        np.testing.assert_allclose(cov, 1.0)

    def test_gaps_reduce_coverage_and_low_coverage_is_not_measured(self):
        spans = [12, 12, 12, 12, 12]
        disp = [np.full((1, 2), -2.0) for _ in spans]
        for d in disp[:3]:
            d[0, 1] = np.nan                                  # second pixel only valid in 2 of 5 pairs
        rate, _, n, cov = gm.stack_rate(disp, spans, min_coverage=0.6)
        self.assertAlmostEqual(float(rate[0, 0]), -2.0 / 12 * gm.DAYS_PER_YEAR, places=6)
        self.assertTrue(np.isnan(rate[0, 1]))
        self.assertEqual(int(n[0, 1]), 0)

    def test_rejects_bad_spans(self):
        with self.assertRaises(gm.GroundMotionError):
            gm.stack_rate([np.zeros((1, 1))], [0])

    def test_chain_gaps(self):
        pairs = [('2026-06-18', '2026-06-30'), ('2026-07-12', '2026-07-24'), ('2026-06-30', '2026-07-10')]
        self.assertEqual(gm.chain_gaps(pairs), [('2026-07-10', '2026-07-12')])


class MosaicAndGeometryTests(unittest.TestCase):
    def test_mosaic_aligns_frame_offsets_on_shared_lattice(self):
        x = 40.0 + 80.0 * np.arange(10)
        y1 = 1_000_040.0 - 80.0 * np.arange(30)
        y2 = y1 - 80.0 * 20
        field = lambda yy: np.tile((yy / 1000.0)[:, None], (1, 10))   # noqa: E731
        mx, my, out, offsets = gm.mosaic([(x, y1, field(y1)), (x, y2, field(y2) + 5.0)], 80.0, min_overlap=50)
        self.assertEqual(out.shape, (50, 10))
        self.assertAlmostEqual(offsets[1], -5.0, places=9)
        np.testing.assert_allclose(out, field(my), atol=1e-9)
        _, _, avg, _ = gm.mosaic([(x, y1, field(y1)), (x, y2, field(y2) + 5.0)], 80.0, align=False)
        self.assertAlmostEqual(float(avg[25, 0] - field(my)[25, 0]), 2.5, places=9)

    def test_mosaic_refuses_grids_off_the_lattice(self):
        x = 40.0 + 80.0 * np.arange(5)
        y = 1000.0 - 80.0 * np.arange(5)
        with self.assertRaises(gm.GroundMotionError):
            gm.mosaic([(x, y, np.zeros((5, 5))), (x + 7.0, y, np.zeros((5, 5)))], 80.0)

    def test_decomposition_recovers_vertical_and_east(self):
        asc = (-0.62, -0.12, 0.775)
        desc = (0.62, -0.12, 0.775)
        up, east = -60.0, 8.0
        los = lambda v: v[0] * east + v[2] * up              # noqa: E731
        vu, ve = gm.decompose_up_east(np.array([los(asc)]), np.array([los(desc)]), asc, desc)
        self.assertAlmostEqual(float(vu[0]), up, places=9)
        self.assertAlmostEqual(float(ve[0]), east, places=9)
        nan_up, _ = gm.decompose_up_east(np.array([1.0]), np.array([1.0]), asc, asc)
        self.assertTrue(np.isnan(nan_up[0]))

    def test_bilinear_reproduces_a_plane_and_height_interpolation(self):
        xs, ys = np.array([0.0, 500.0, 1000.0]), np.array([1000.0, 500.0, 0.0])
        plane = 2 * xs[None, :] + 3 * ys[:, None]
        xd, yd = np.array([125.0, 760.0]), np.array([900.0, 80.0])
        np.testing.assert_allclose(gm.bilinear(xs, ys, plane, xd, yd), 2 * xd[None, :] + 3 * yd[:, None])
        cube = np.stack([np.zeros((2, 2)), np.full((2, 2), 10.0)])
        np.testing.assert_allclose(gm.interpolate_height([1000.0, 1500.0], cube, 1100.0), 2.0)
        with self.assertRaises(gm.GroundMotionError):
            gm.interpolate_height([1000.0, 1500.0], cube, 2000.0)

    def test_local_plane_fit_recovers_slope_in_metres(self):
        rows, cols = np.mgrid[0:30, 0:40].astype(float)
        z = 5 + 0.5 * cols - 0.25 * rows                    # +0.5 per pixel east, +0.25 per pixel north
        a, gx, gy, sgx, sgy, n = gm.local_plane_fit(z, 80.0, 3, 20)
        self.assertAlmostEqual(float(a[10, 10]), 7.5, places=9)
        self.assertAlmostEqual(float(gx[10, 10]), 0.5 / 80, places=12)
        self.assertAlmostEqual(float(gy[10, 10]), 0.25 / 80, places=12)
        self.assertLess(float(np.nanmax(sgx)), 1e-9)
        self.assertEqual(int(n[10, 10]), 49)
        self.assertTrue(np.isnan(gx[0, 0]))                   # corner window has only 16 pixels

    def test_local_plane_fit_reports_honest_uncertainty_and_skips_gaps(self):
        rng = np.random.default_rng(1)
        rows, cols = np.mgrid[0:60, 0:60].astype(float)
        z = 0.5 * cols + rng.normal(0, 1, cols.shape)
        z[20:40, 20:40] = np.nan
        _, gx, _, sgx, _, n = gm.local_plane_fit(z, 1.0, 3, 20)
        self.assertTrue(np.isnan(gx[30, 30]))
        spread, claimed = float(np.nanstd(gx)), float(np.nanmedian(sgx))
        self.assertLess(abs(float(np.nanmean(gx)) - 0.5), 0.01)
        self.assertLess(abs(spread / claimed - 1), 0.35)       # reported error within ~35% of actual scatter
        with self.assertRaises(gm.GroundMotionError):
            gm.local_plane_fit(z, 1.0, 0, 20)

    def test_utm_matches_reference_projection(self):
        # Reference values from PROJ (EPSG:4326 -> EPSG:32639).
        cases = [((51.4, 35.7), (536187.189, 3950748.613)), ((53.9, 36.9), (758399.162, 4087707.442)),
                 ((48.2, 33.1), (238688.835, 3665861.608))]
        for (lon, lat), (e, n) in cases:
            x, y = gm.lonlat_to_utm(lon, lat, 39)
            self.assertAlmostEqual(float(x), e, delta=0.01)
            self.assertAlmostEqual(float(y), n, delta=0.01)
        self.assertEqual(gm.utm_zone_from_epsg(32639), 39)
        with self.assertRaises(gm.GroundMotionError):
            gm.utm_zone_from_epsg(32739)


if __name__ == '__main__':
    unittest.main()
