"""Manual native-cell oracles for inspection aids, not event accuracy tests."""
import json
import math
import unittest

import numpy as np

from service.inspection import inspection_windows


IDENTITY = (0, 1, 0, 0, 0, 1)


def summarize(difference, common=None, selected=None, transform=IDENTITY,
              pixel_area_m2=400, threshold_db=3, to_wgs84=lambda point: point):
    if common is None:
        common = np.ones(difference.shape, dtype=bool)
    if selected is None:
        selected = np.ones(difference.shape, dtype=bool)
    return inspection_windows(difference, common, selected, transform,
                              pixel_area_m2, threshold_db, to_wgs84)


class InspectionTests(unittest.TestCase):
    def assert_finite_json(self, result):
        self.assertEqual(json.loads(json.dumps(result, allow_nan=False)), result)

    def test_strict_threshold_signs_and_row_major_peak_tie(self):
        difference = np.array([[3, -3, 3.25, -8], [8, -3.25, 0, .5]])
        result = summarize(difference)
        block = result['candidates'][0]
        self.assertEqual(result['schemaVersion'], 'native-inspection-windows-v1')
        self.assertEqual((result['blockSizePixels'], result['limit']), (32, 12))
        self.assertEqual(result['ranking'],
                         'exceeded-pixel-count_then_peak-absolute-db_then_native-order')
        self.assertEqual(result['thresholdDb'], 3)
        self.assertEqual((block['selectedPixels'], block['validPixels'],
                          block['unknownPixels']), (8, 8, 0))
        self.assertEqual((block['increasedPixels'], block['decreasedPixels'],
                          block['withinThresholdPixels']), (2, 2, 4))
        self.assertEqual(block['validPercent'], 100)
        self.assertEqual(block['exceededAreaKm2'], .0016)
        self.assertEqual(block['representative'], {
            'row': 0, 'column': 3, 'differenceDb': -8.,
            'coordinate': [3.5, .5], 'coordinateStatus': 'available'})
        self.assert_finite_json(result)

    def test_selected_common_and_finite_intersection_unknown_accounting(self):
        difference = np.array([[10, -9, np.nan, np.inf], [-np.inf, 3, -3, 100.]])
        common = np.array([[True, False, True, True], [True, True, True, True]])
        selected = np.array([[True, True, True, True], [True, True, True, False]])
        result = summarize(difference, common, selected)
        self.assertEqual((result['selectedPixels'], result['validPixels'],
                          result['unknownPixels']), (7, 3, 4))
        block = result['candidates'][0]
        self.assertEqual((block['increasedPixels'], block['decreasedPixels'],
                          block['withinThresholdPixels']), (1, 0, 2))
        self.assertEqual(block['unknownPixels'], 4)
        self.assertAlmostEqual(block['validPercent'], 300 / 7)
        self.assertEqual(block['representative']['differenceDb'], 10)
        self.assert_finite_json(result)

    def test_threshold_is_not_rounded_to_native_float_precision(self):
        for dtype in (np.float16, np.float32):
            native_above = np.nextafter(dtype(3), dtype(4))
            for fraction in (.25, .5, .75):
                threshold = 3 + (float(native_above) - 3) * fraction
                difference = np.array([[3, -3, native_above, -native_above]], dtype=dtype)
                result = summarize(difference, threshold_db=threshold)
                block = result['candidates'][0]
                self.assertEqual((block['increasedPixels'], block['decreasedPixels'],
                                  block['withinThresholdPixels']), (1, 1, 2))
                self.assertEqual(result['thresholdDb'], threshold)

    def test_native_float32_point_one_cutoff_matches_analysis_summary(self):
        from service.analysis import summarize as analysis_summary
        difference = np.array([[.1, -.1, 0]], dtype=np.float32)
        masks = np.ones_like(difference, dtype=bool)
        result = summarize(difference, threshold_db=.1, pixel_area_m2=100)
        summary, _, _ = analysis_summary(np.ones_like(difference), np.ones_like(difference),
                                         difference, np.ones_like(difference, dtype=np.uint8), masks, 100, .1)
        block = result['candidates'][0]
        self.assertEqual((block['increasedPixels'], block['decreasedPixels'], block['withinThresholdPixels']), (1, 1, 1))
        self.assertEqual(block['increasedPixels'] * .0001, summary['increasedAreaKm2'])
        self.assertEqual(block['decreasedPixels'] * .0001, summary['decreasedAreaKm2'])

    def test_empty_selection_no_valid_support_and_empty_grids(self):
        calls = []
        for difference, common, selected, counts in (
            (np.array([[8., np.nan]]), np.zeros((1, 2), bool),
             np.ones((1, 2), bool), (2, 0, 2)),
            (np.array([[np.nan, np.inf]]), np.ones((1, 2), bool),
             np.ones((1, 2), bool), (2, 0, 2)),
            (np.array([[8., 9.]]), np.ones((1, 2), bool),
             np.zeros((1, 2), bool), (0, 0, 0)),
            (np.empty((0, 2)), np.empty((0, 2), bool),
             np.empty((0, 2), bool), (0, 0, 0)),
            (np.empty((2, 0)), np.empty((2, 0), bool),
             np.empty((2, 0), bool), (0, 0, 0)),
        ):
            with self.subTest(counts=counts, shape=difference.shape):
                result = summarize(difference, common, selected,
                                   to_wgs84=lambda point: calls.append(point))
                self.assertEqual(tuple(result[k] for k in
                                 ('selectedPixels', 'validPixels', 'unknownPixels')), counts)
                self.assertEqual(result['status'], 'withheld_no_valid_support')
                self.assertEqual(result['candidates'], [])
                self.assertEqual(tuple(result[k] for k in
                                 ('candidateWindows', 'returnedWindows', 'omittedWindows')),
                                 (0, 0, 0))
                self.assert_finite_json(result)
        self.assertEqual(calls, [])

    def test_supported_but_no_strict_threshold_candidates(self):
        def unexpected_transform(point):
            self.fail('No candidate should be projected')
        result = summarize(np.array([[3, -3, 0.]]), to_wgs84=unexpected_transform)
        self.assertEqual(result['status'], 'no_threshold_candidates')
        self.assertEqual((result['selectedPixels'], result['validPixels'],
                          result['unknownPixels']), (3, 3, 0))
        self.assertEqual(result['candidates'], [])
        self.assertEqual(result['candidateWindows'], 0)

    def test_crop_anchoring_and_partial_edge_windows_manual_counts(self):
        difference = np.zeros((33, 35))
        difference[0, 0] = 5
        difference[31, 32] = -6
        difference[32, 0] = 7
        difference[32, 34] = -8
        result = summarize(difference, pixel_area_m2=1e6)
        # One exceeded cell per block, so peaks decide the order.
        self.assertEqual([c['window'] for c in result['candidates']], [
            {'rowStart': 32, 'rowEndExclusive': 33, 'columnStart': 32, 'columnEndExclusive': 35},
            {'rowStart': 32, 'rowEndExclusive': 33, 'columnStart': 0, 'columnEndExclusive': 32},
            {'rowStart': 0, 'rowEndExclusive': 32, 'columnStart': 32, 'columnEndExclusive': 35},
            {'rowStart': 0, 'rowEndExclusive': 32, 'columnStart': 0, 'columnEndExclusive': 32},
        ])
        self.assertEqual([c['selectedPixels'] for c in result['candidates']], [3, 32, 96, 1024])
        self.assertEqual([c['exceededAreaKm2'] for c in result['candidates']], [1, 1, 1, 1])
        self.assertEqual(result['selectedPixels'], 1155)

    def test_count_before_peak_and_all_three_ranking_tiebreaks(self):
        difference = np.zeros((64, 96))
        difference[0, 0] = 30  # Largest peak loses to two exceeded cells.
        difference[0, 32:34] = [4, -4]
        difference[0, 64:66] = [7, -7]
        difference[32, 0:2] = [-7, 7]
        difference[32, 32:34] = [7, -7]
        result = summarize(difference)
        origins = [(c['window']['rowStart'], c['window']['columnStart'])
                   for c in result['candidates']]
        self.assertEqual(origins, [(0, 64), (32, 0), (32, 32), (0, 32), (0, 0)])

    def test_top12_truncation_is_stable_and_only_returned_points_transform(self):
        difference = np.zeros((32, 32 * 15))
        difference[0, ::32] = 4
        calls = []
        def transform(point):
            calls.append(point)
            return (0, 0)
        first = summarize(difference, to_wgs84=transform)
        self.assertEqual((first['candidateWindows'], first['returnedWindows'],
                          first['omittedWindows']), (15, 12, 3))
        self.assertEqual([c['window']['columnStart'] for c in first['candidates']],
                         list(range(0, 32 * 12, 32)))
        self.assertEqual(calls, [(column + .5, .5) for column in range(0, 384, 32)])
        self.assertEqual(first, summarize(difference, to_wgs84=lambda point: (0, 0)))
        self.assert_finite_json(first)

    def test_late_stronger_block_replaces_heap_root(self):
        difference = np.zeros((1, 32 * 15))
        difference[0, ::32] = 4
        difference[0, 448:450] = [-5, 5]
        result = summarize(difference, to_wgs84=lambda point: (0, 0))
        self.assertEqual([c['window']['columnStart'] for c in result['candidates']],
                         [448] + list(range(0, 352, 32)))
        self.assertEqual(result['omittedWindows'], 3)

    def test_rotated_affine_uses_exact_native_center_and_optional_z(self):
        difference = np.zeros((3, 4))
        difference[2, 3] = -9
        calls = []
        def transform(point):
            calls.append(point)
            return [point[0] / 10, point[1] / 10, float('nan')]
        result = summarize(difference, transform=(10, 2, 3, 20, -1, 4), to_wgs84=transform)
        # x = 10 + 3.5*2 + 2.5*3; y = 20 - 3.5 + 2.5*4.
        self.assertEqual(calls, [(24.5, 26.5)])
        self.assertEqual(result['candidates'][0]['representative']['coordinate'], [2.45, 2.65])
        self.assert_finite_json(result)

    def test_projection_failures_keep_native_candidate_and_never_retry(self):
        def raising(point):
            raise RuntimeError('Projection failed')
        invalid_returns = [None, [], [0], [0, 0, 0, 0], '0,0', [True, 0],
                           [0, False], ['0', 0], [np.nan, 0], [0, np.inf],
                           [180.01, 0], [0, -90.01], [10**1000, 0]]
        for callback in [raising] + [lambda point, value=value: value for value in invalid_returns]:
            calls = []
            def once(point):
                calls.append(point)
                return callback(point)
            with self.subTest(callback=callback):
                result = summarize(np.array([[-8.]]), to_wgs84=once)
                representative = result['candidates'][0]['representative']
                self.assertEqual(representative, {
                    'row': 0, 'column': 0, 'differenceDb': -8.,
                    'coordinate': None, 'coordinateStatus': 'unavailable'})
                self.assertEqual(result['status'], 'candidates')
                self.assertEqual(len(calls), 1)
                self.assert_finite_json(result)
        for point in ([-180, -90], [180, 90]):
            result = summarize(np.array([[8.]]), to_wgs84=lambda _: point)
            self.assertEqual(result['candidates'][0]['representative']['coordinate'], point)

    def test_failing_projection_still_has_top12_and_twelve_attempts(self):
        calls = []
        def fail(point):
            calls.append(point)
            raise ValueError('No projection')
        result = summarize(np.full((32, 480), 5.), to_wgs84=fail)
        self.assertEqual(len(calls), 12)
        self.assertEqual(result['returnedWindows'], 12)
        self.assertTrue(all(c['representative']['coordinate'] is None for c in result['candidates']))

    def test_scalar_cell_oracle_with_mixed_support_and_partial_blocks(self):
        # Independent scalar iteration provides the population and ranking
        # oracle, without the implementation's vector masks or heap algorithm.
        rows, columns = np.indices((67, 71))
        difference = ((rows * 13 + columns * 7) % 23 - 11).astype(float)
        common = (rows + columns) % 5 != 0
        selected = (rows * 2 + columns) % 7 != 0
        difference[::9, ::11] = np.nan
        expected = []
        selected_total = valid_total = 0
        for r0 in (0, 32, 64):
            for c0 in (0, 32, 64):
                chosen = valid = increased = decreased = within = 0
                exceeded_cells = []
                for r in range(r0, min(r0 + 32, 67)):
                    for c in range(c0, min(c0 + 32, 71)):
                        if not selected[r, c]:
                            continue
                        chosen += 1
                        if not common[r, c] or not math.isfinite(difference[r, c]):
                            continue
                        valid += 1
                        value = float(difference[r, c])
                        if value > 3:
                            increased += 1
                        elif value < -3:
                            decreased += 1
                        else:
                            within += 1
                        if abs(value) > 3:
                            exceeded_cells.append((r, c, value))
                selected_total += chosen
                valid_total += valid
                if exceeded_cells:
                    representative = sorted(exceeded_cells, key=lambda p: (-abs(p[2]), p[0], p[1]))[0]
                    expected.append((increased + decreased, abs(representative[2]), r0, c0,
                                     chosen, valid, increased, decreased, within, representative))
        expected.sort(key=lambda item: (-item[0], -item[1], item[2], item[3]))
        result = summarize(difference, common, selected, to_wgs84=lambda point: (0, 0))
        self.assertEqual((result['selectedPixels'], result['validPixels'], result['unknownPixels']),
                         (selected_total, valid_total, selected_total - valid_total))
        self.assertEqual(result['candidateWindows'], len(expected))
        for block, oracle in zip(result['candidates'], expected):
            _, _, r, c, chosen, valid, increased, decreased, within, representative = oracle
            self.assertEqual((block['window']['rowStart'], block['window']['columnStart']), (r, c))
            self.assertEqual((block['selectedPixels'], block['validPixels'], block['unknownPixels'],
                              block['increasedPixels'], block['decreasedPixels'],
                              block['withinThresholdPixels']),
                             (chosen, valid, chosen - valid, increased, decreased, within))
            self.assertEqual(tuple(block['representative'][k] for k in ('row', 'column', 'differenceDb')),
                             representative)
            self.assertAlmostEqual(block['exceededAreaKm2'], (increased + decreased) * .0004)

    def test_input_arrays_and_affine_are_immutable_including_noncontiguous_views(self):
        source = np.arange(100., dtype=float).reshape(10, 10)
        source[0, 0] = np.nan
        difference = source[::2, ::2]
        common = np.ones((5, 5), bool)
        selected = common.copy()
        affine = list(IDENTITY)
        snapshots = [a.copy() for a in (source, common, selected)]
        for a in (source, difference, common, selected):
            a.flags.writeable = False
        summarize(difference, common, selected, transform=affine)
        for actual, expected in zip((source, common, selected), snapshots):
            np.testing.assert_array_equal(actual, expected)
        self.assertEqual(affine, list(IDENTITY))

    def test_rejects_malformed_arrays_and_does_not_cast_masks_or_values(self):
        good = np.array([[5.]])
        mask = np.array([[True]])
        invalid = [None, [], [1], [[[1]]], [[1], [2, 3]], [['5']], [[True]], [[1j]],
                   np.array([[5]], dtype=object), np.ma.array([[5]], mask=False)]
        for difference in invalid:
            with self.subTest(difference=repr(difference)), self.assertRaises(ValueError):
                inspection_windows(difference, mask, mask, IDENTITY, 400, 3, lambda p: p)
        for bad in (None, [[1]], [[0.]], [['true']], np.ones((1, 2), bool),
                    np.array([[True]], dtype=object), [True], np.ma.array(mask)):
            for key in ('common', 'selected'):
                with self.subTest(mask=repr(bad), key=key), self.assertRaises(ValueError):
                    inspection_windows(
                        good, bad if key == 'common' else mask,
                        bad if key == 'selected' else mask, IDENTITY, 400, 3, lambda p: p)
        with self.assertRaises(ValueError):
            summarize(np.zeros((1001, 1000)))

    def test_rejects_malformed_affine_area_threshold_and_callback(self):
        invalid = {
            'transform': [None, [], (0, 1, 0, 0, 1), (0, 1, 0, 0, 0, 1, 2),
                          (0, 1, 2, 0, 2, 4), (0, 0, 0, 0, 0, 0),
                          (np.nan, 1, 0, 0, 0, 1), (0, np.inf, 0, 0, 0, 1),
                          (0, True, 0, 0, 0, 1), ('0', 1, 0, 0, 0, 1)],
            'pixel_area_m2': [0, -1, True, '400', np.nan, np.inf, None, 1j, 10**1000],
            'threshold_db': [0, .099, 30.001, True, '3', np.nan, np.inf, None, 1j, 10**1000],
            'to_wgs84': [None, 1, [], 'identity'],
        }
        for key, values in invalid.items():
            for value in values:
                with self.subTest(key=key, value=repr(value)), self.assertRaises(ValueError):
                    summarize(np.array([[5.]]), **{key: value})

    def test_accepts_threshold_endpoints_and_finite_extreme_area(self):
        for threshold in (.1, 30):
            result = summarize(np.array([[31.]]), threshold_db=threshold,
                               pixel_area_m2=float.fromhex('0x1.fffffffffffffp+1023'))
            self.assertEqual(result['thresholdDb'], threshold)
            self.assert_finite_json(result)
        # Do not overflow an otherwise finite nominal area by multiplying first.
        self.assert_finite_json(summarize(np.full((32, 32), 31.), pixel_area_m2=1e308))

    def test_affine_determinant_extremes_and_coordinate_overflow(self):
        for scale in (1e-250, 1e250):
            result = summarize(np.array([[5.]]), transform=(0, scale, 0, 0, 0, scale),
                               to_wgs84=lambda point: (0, 0))
            self.assertEqual(result['candidates'][0]['representative']['coordinate'], [0, 0])
        calls = []
        result = summarize(np.array([[0., 5.]]), transform=(1e308, 1e308, 0, 0, 0, 1),
                           to_wgs84=lambda point: calls.append(point))
        self.assertEqual(calls, [])
        self.assertIsNone(result['candidates'][0]['representative']['coordinate'])
        self.assert_finite_json(result)

    def test_integer_minimum_peak_does_not_overflow(self):
        difference = np.array([[np.iinfo(np.int64).min, 4]], dtype=np.int64)
        result = summarize(difference)
        self.assertEqual(result['candidates'][0]['representative']['column'], 0)
        self.assertEqual(result['candidates'][0]['decreasedPixels'], 1)
        self.assert_finite_json(result)

    def test_million_cell_boundary_and_call_bound(self):
        calls = []
        result = summarize(np.full((1000, 1000), 4., dtype=np.float32),
                           to_wgs84=lambda point: calls.append(point) or (0, 0))
        self.assertEqual((result['selectedPixels'], result['validPixels']), (1_000_000, 1_000_000))
        self.assertEqual(result['candidateWindows'], 1024)
        self.assertEqual(result['omittedWindows'], 1012)
        self.assertEqual(len(calls), 12)
        self.assert_finite_json(result)

    def test_limitations_and_result_lists_are_independent(self):
        first = summarize(np.array([[5.]]))
        text = ' '.join(first['limitations']).lower()
        for phrase in ('no event class', 'significance', 'confidence', 'not feature objects',
                       'nominal projected', 'heuristic', 'unvalidated'):
            self.assertIn(phrase, text)
        first['limitations'].clear()
        self.assertTrue(summarize(np.array([[5.]]))['limitations'])

    def test_empty_extreme_dimension_and_underflow_area_are_refused(self):
        # Zero allocated cells must not permit an unbounded outer-window loop.
        for shape in ((1_000_001, 0), (0, 1_000_001)):
            with self.assertRaises(ValueError):
                summarize(np.empty(shape))
        with self.assertRaises(ValueError):
            summarize(np.array([[5.]]), pixel_area_m2=float.fromhex('0x0.0000000000001p-1022'))


if __name__ == '__main__':
    unittest.main()
