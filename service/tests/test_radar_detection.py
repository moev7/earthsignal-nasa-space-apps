"""Synthetic software checks only; no independently reviewed real field corpus."""
import copy
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import hashlib
import json
import unittest
from unittest.mock import patch

import numpy as np

from service.benchmarks.evaluator import array_sha256
from service.benchmarks.radar import (
    CHUNK_CELLS, MAX_CELLS, MAX_HISTORY, UNKNOWN, Case, Footprint, Frame, Grid, Product,
    Profile, RadarError, Reference, Source, Spec, apply, connected_groups, digest,
    freeze, pair_scores, support_comparison, temporal_scores,
)


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


PRODUCT = Product('synthetic', 'SYNTHETIC', 'NONE', 'HH', 'synthetic_power',
                  'LINEAR_POWER', 'test-release', 'test-crid', 'synthetic',
                  ('Artificial fixtures, no sensor accuracy evidence',), 'track-frame-orbit')
DEFINITION = 'Independently reviewed target class stable over the stated interval; mean power may vary'
MASK = 'Fixture producer validity only; no asserted layover/RFI/noise-floor mask'


def grid(shape=(1, 4)):
    return Grid('lattice', 'ASSERTED_SYNTHETIC_METRE_CRS', shape, (0., 10., 0., 0., 0., -10.),
                'metre', 'Synthetic nominal affine areas only')


def frame(values, ident, day, *, mask=None, product=PRODUCT, g=None):
    a = np.asarray(values, dtype=np.float64)
    if a.ndim == 1:
        a = a.reshape(1, -1)
    m = np.ones(a.shape, dtype=bool) if mask is None else np.asarray(mask, dtype=bool).reshape(a.shape)
    date = (datetime(2024, 1, 1, tzinfo=timezone.utc)+timedelta(days=day)).isoformat()
    source = Source(ident, ident+'-acquisition', date, sha(ident), array_sha256(a),
                    array_sha256(m), product, MASK, 'Synthetic metadata assertion only')
    return Frame(a, m, grid(a.shape) if g is None else g, source)


def reference(shape, labels=None, visible=None):
    a = np.ones(shape, dtype=np.int8) if labels is None else np.asarray(labels, dtype=np.int8).reshape(shape)
    m = np.ones(shape, dtype=bool) if visible is None else np.asarray(visible, dtype=bool).reshape(shape)
    return Reference(a, m, DEFINITION, 'fixture-review', True, True, True,
                     'Artificial independent-review flags test gates only', '2025-01-01T00:00:00Z',
                     array_sha256(a), array_sha256(m))


def case(unit=0, scores=(0, 0, 0, 0), temporal=False):
    cid = 'case-'+str(unit)
    scores = np.asarray(scores, dtype=float).reshape(1, -1)
    target = frame(10**(scores/10), cid+'-target', unit*3+2)
    if temporal:
        histories = (frame(np.ones(scores.shape), cid+'-history0', unit*3),
                     frame(np.ones(scores.shape), cid+'-history1', unit*3+1))
        before = None
    else:
        before, histories = frame(np.ones(scores.shape), cid+'-before', unit*3+1), ()
    return Case(cid, 'event-'+str(unit), 'site-'+str(unit), 'frozen-stratum', target,
                before, histories, reference(scores.shape))


def spec(method='empirical_pair', **kw):
    p = Profile(PRODUCT, grid(), 'frozen-stratum', MASK, DEFINITION)
    args = dict(method=method, profile=p, frozen_at='2026-01-01T00:00:00Z',
                lower_candidates=(-10., -3., -1.), upper_candidates=(1., 3., 10.),
                lower_tail_budget=.25, upper_tail_budget=.25, minimum_cells=1,
                minimum_independent_units=1, minimum_valid_histories=2,
                task_parameter_evidence='Frozen choices for synthetic bounded software test, not science defaults')
    if method == 'fixed_pair':
        args.update(lower_candidates=(), upper_candidates=())
    args.update(kw)
    return Spec(**args)


def detect(policy, c, stage='exploratory'):
    return apply(policy, c, expected_receipt_sha256=policy['receipt_sha256'], stage=stage)


class RadarNumerics(unittest.TestCase):
    def test_equal_doubling_reversed_and_input_immutability(self):
        b = np.array([[1., 2., 4., .25]])
        a = np.array([[1., 4., 2., .5]])
        m = np.ones(b.shape, bool)
        before = [array_sha256(x) for x in (b, a, m)]
        r = pair_scores(b, a, m, m)
        np.testing.assert_allclose(r.values, [[0, 10*np.log10(2), -10*np.log10(2), 10*np.log10(2)]])
        np.testing.assert_array_equal(pair_scores(a, b, m, m).values, -r.values)
        self.assertEqual(before, [array_sha256(x) for x in (b, a, m)])
        self.assertEqual(r.counts, {'total_cells': 4, 'valid_cells': 4, 'unknown_cells': 0})

    def test_extreme_powers_never_ratio_overflow(self):
        tiny = np.nextafter(0., 1.)
        huge = np.finfo(float).max
        b = np.array([[tiny, huge, tiny, huge]])
        a = np.array([[huge, tiny, tiny, huge]])
        with np.errstate(all='raise'):
            r = pair_scores(b, a, np.ones(b.shape, bool), np.ones(b.shape, bool))
        self.assertTrue(np.all(np.isfinite(r.values)))
        self.assertGreater(r.values[0, 0], 6000)
        self.assertEqual(r.values[0, 1], -r.values[0, 0])
        np.testing.assert_array_equal(r.values[0, 2:], [0, 0])

    def test_invalid_masked_cells_unknown_counts_reconcile(self):
        b = np.array([[1., 0., -1., np.nan, np.inf, 1., 1.]])
        a = np.ones(b.shape)
        m = np.ones(b.shape, bool); m[0, -1] = False
        r = pair_scores(b, a, m, m)
        self.assertEqual(r.counts['valid_cells'], 2)
        self.assertEqual(r.counts['unknown_cells'], 5)
        self.assertTrue(np.all(np.isnan(r.values[~r.valid])))
        self.assertEqual(r.counts['total_cells'], r.counts['valid_cells']+r.counts['unknown_cells'])

    def test_temporal_linear_median_is_not_median_db_estimand(self):
        a = np.array([[5., 1., 2., 9.]])
        h = [np.array([[1., 1., 2., 1.]]), np.array([[9., 1., 2., 9.]])]
        m = np.ones(a.shape, bool)
        r = temporal_scores(a, m, h, [m, m], minimum_valid_histories=2, chunk_cells=2)
        self.assertEqual(r.values[0, 0], 0)  # Linear median 5, geometric median 3 would differ.
        np.testing.assert_allclose(r.values, [[0, 0, 0, 10*np.log10(9/5)]])
        np.testing.assert_array_equal(r.history_counts, [[2, 2, 2, 2]])

    def test_even_median_overflow_and_minimum_subnormal(self):
        tiny, huge = np.nextafter(0., 1.), np.finfo(float).max
        target = np.array([[tiny, huge, huge/2]])
        h = [np.array([[tiny, huge, tiny]]), np.array([[tiny, huge, huge]])]
        m = np.ones(target.shape, bool)
        with np.errstate(over='raise', divide='raise', invalid='raise'):
            r = temporal_scores(target, m, h, [m, m], minimum_valid_histories=2)
        np.testing.assert_array_equal(r.values, [[0, 0, 0]])

    def test_unequal_subnormal_history_does_not_create_increase_alert(self):
        tiny = np.nextafter(0., 1.)
        target = np.array([[2*tiny]])
        mask = np.ones(target.shape, bool)
        histories = [np.array([[tiny]]), np.array([[2*tiny]])]
        result = temporal_scores(target, mask, histories, [mask, mask], minimum_valid_histories=2)
        # Float64 round-to-even represents the midpoint 1.5*tiny as 2*tiny.
        self.assertEqual(result.values[0, 0], 0)
        self.assertFalse(result.values[0, 0] > 3)

    def test_odd_median_missing_histories_no_fallback_immutable(self):
        h = [np.array([[1., 1., 0.]]), np.array([[2., np.nan, -1.]]), np.array([[100., 3., np.inf]])]
        a, m = np.array([[2., 2., 2.]]), np.ones((1, 3), bool)
        hashes = [array_sha256(x) for x in h+[a, m]]
        r = temporal_scores(a, m, h, [m, m, m], minimum_valid_histories=2)
        np.testing.assert_array_equal(r.valid, [[True, True, False]])
        np.testing.assert_array_equal(r.values[:, :2], [[0, 0]])
        self.assertEqual(r.counts['insufficient_history_cells'], 1)
        self.assertEqual(hashes, [array_sha256(x) for x in h+[a, m]])

    def test_bounds_dtypes_and_no_implicit_mask(self):
        a, m = np.ones((1, 4)), np.ones((1, 4), bool)
        for bad in (np.ones((1, MAX_CELLS+1)), np.ones((4,)), np.ones((1, 4), dtype=complex),
                    np.ma.array(a, mask=False), np.array([['a']], dtype=object)):
            with self.subTest(dtype=bad.dtype), self.assertRaises(RadarError):
                pair_scores(bad, bad, m, m)
        with self.assertRaises(RadarError):
            pair_scores(a, a, m.astype(int), m)
        for count, chunk in ((MAX_HISTORY+1, 1), (1, CHUNK_CELLS+1), (0, 1)):
            with self.assertRaises(RadarError):
                temporal_scores(a, m, [a]*count, [m]*count, minimum_valid_histories=1, chunk_cells=chunk)


class RadarPolicies(unittest.TestCase):
    def test_duplicate_pair_asset_is_withheld_in_fit_and_final_registration(self):
        original = case()
        duplicate = replace(original, target=replace(original.target, source=replace(
            original.target.source, sha256=original.before.source.sha256)))
        fitted = freeze(spec(), [duplicate])
        self.assertEqual(fitted['status'], 'withheld')
        self.assertTrue(any('asset' in reason.lower() for reason in fitted['reasons']))
        baseline = freeze(spec('fixed_pair'), heldout=[duplicate])
        self.assertEqual(baseline['status'], 'withheld')
        self.assertIsNone(baseline['thresholds'])
    def test_baseline_fixed_strict_boundaries_and_signed_flags(self):
        c = case(scores=(-4, 0, 4, 0))
        p = freeze(spec('fixed_pair'), heldout=[c])
        d = detect(p, c, 'final')
        np.testing.assert_array_equal(d.flags, [[-1, 0, 1, 0]])
        with patch('service.benchmarks.radar.pair_scores', return_value=pair_scores(
                np.ones((1, 4)), np.ones((1, 4)), np.ones((1, 4), bool), np.ones((1, 4), bool))) as call:
            call.return_value.values[:] = [[-3, 3, np.nextafter(-3., -np.inf), np.nextafter(3., np.inf)]]
            d = detect(p, c)
            np.testing.assert_array_equal(d.flags, [[0, 0, -1, 1]])
        self.assertEqual(p['thresholds'], {'lower_db': -3., 'upper_db': 3.})
        self.assertEqual(d.receipt['field_validation'], 'not_established')

    def test_asymmetric_fit_largest_lower_smallest_upper_every_crop(self):
        a, b = case(0, (-10, -2, 0, 8)), case(1, (0, 0, 2, 2))
        p = freeze(spec(), [a, b], heldout=[case(10)])
        self.assertEqual(p['status'], 'fitted_offline_not_activated')
        self.assertEqual(p['thresholds'], {'lower_db': -3., 'upper_db': 3.})
        self.assertEqual(p['independent_units'], 2)
        self.assertEqual(p['attempts'][0]['selected_rates']['target_stable_nuisance_alert_fraction'], .5)
        self.assertEqual(p['candidate_checks']['upper'][1]['bottleneck_case_ids'], [a.id])
        json.dumps(p, allow_nan=False)
        json.dumps(detect(p, case(10), 'final').receipt, allow_nan=False)

    def test_worst_small_crop_cannot_be_dominated_by_giant_pool(self):
        large = case(0, np.zeros(10000))
        small = case(1, (10, 10, 0, 0))
        p = freeze(spec(lower_tail_budget=0, upper_tail_budget=.1), [large, small])
        self.assertEqual(p['thresholds']['upper_db'], 10.)
        self.assertEqual(p['attempts'][1]['upper_tail_rates'][1], .5)
        self.assertEqual(p['candidate_checks']['upper'][1]['bottleneck_case_ids'], [small.id])
        self.assertEqual(p['attempts'][0]['denominator_nominal_m2'], 1000000.)

    def test_infeasible_candidates_withhold_and_preserve_attempts(self):
        cases = [case(0, (20, 20, 20, 20)), case(1)]
        p = freeze(spec(upper_tail_budget=0), cases)
        self.assertEqual(p['status'], 'withheld')
        self.assertIsNone(p['thresholds'])
        self.assertEqual(len(p['attempts']), 2)
        self.assertIn('Infeasible upper candidate tail-area budget', p['reasons'])
        with self.assertRaisesRegex(RadarError, 'withheld'):
            detect(p, case(10))

    def test_unreviewed_reference_not_silently_dropped(self):
        good, bad = case(0), case(1)
        bad = replace(bad, reference=replace(bad.reference, independently_reviewed=False))
        p = freeze(spec(), [good, bad])
        self.assertEqual(p['status'], 'withheld')
        self.assertEqual([a['status'] for a in p['attempts']], ['admitted', 'failed'])
        self.assertIn('Unreviewed', p['attempts'][1]['reasons'][0])

    def test_unknown_invisible_and_nonstable_reference_remain_unscored(self):
        c = case()
        c = replace(c, reference=reference((1, 4), [1, -1, 1, 0], [1, 1, 0, 1]))
        p = freeze(spec(), [c])
        counts = p['attempts'][0]['reference']['counts']
        self.assertEqual(counts['scored_target_stable_cells'], 1)
        self.assertEqual(counts['reference_unknown_cells'], 1)
        self.assertEqual(counts['reference_unobservable_cells'], 1)
        self.assertEqual(counts['reference_total_cells'], counts['visible_known_target_stable_cells']+
                         counts['visible_known_nonstable_cells']+counts['visible_unknown_cells']+
                         counts['reference_unobservable_cells'])
        self.assertEqual(p['attempts'][0]['denominator_cells'], 1)
        unknown = replace(c, reference=reference((1, 4), [-1]*4))
        q = freeze(spec(), [unknown])
        self.assertEqual(q['status'], 'withheld')
        self.assertEqual(q['attempts'][0]['reference']['counts']['scored_target_stable_cells'], 0)

    def test_unknown_signal_stable_reference_kept_in_abstention_counts(self):
        c = case()
        c = replace(c, target=frame([0, np.nan, 1, 1], 'missing-target', 2))
        p = freeze(spec(), [c])
        counts = p['attempts'][0]['reference']['counts']
        self.assertEqual(counts['visible_known_target_stable_cells'], 4)
        self.assertEqual(counts['scored_target_stable_cells'], 2)
        self.assertEqual(counts['target_stable_unknown_signal_cells'], 2)
        d = detect(p, c, 'calibration')
        np.testing.assert_array_equal(d.flags, [[UNKNOWN, UNKNOWN, 0, 0]])
        n = d.receipt['counts']
        self.assertEqual(n['valid_cells'], n['signal_increase_cells']+n['signal_decrease_cells']+n['no_alert_cells'])
        self.assertEqual(n['total_cells'], n['unknown_cells']+n['valid_cells'])

    def test_minimum_cells_and_independent_units_are_declared_task_parameters(self):
        for s in (spec(minimum_cells=5), spec(minimum_independent_units=2)):
            p = freeze(s, [case()])
            self.assertEqual(p['status'], 'withheld')
            self.assertIsNone(p['thresholds'])
        with self.assertRaisesRegex(RadarError, 'task parameter'):
            freeze(spec(task_parameter_evidence=''))

    def test_transitive_connected_groups_and_unit_count(self):
        a, b, c, d = [case(i) for i in range(4)]
        b = replace(b, site_id=a.site_id)
        c = replace(c, event_id=b.event_id)
        groups = connected_groups([a, c, d, b])
        self.assertEqual(groups, [[a.id, b.id, c.id], [d.id]])
        p = freeze(spec(minimum_independent_units=3), [a, c, d, b])
        self.assertEqual(p['independent_units'], 2)
        self.assertEqual(p['status'], 'withheld')

    def test_heldout_split_leakage_event_site_source_date_acquisition_asset(self):
        a, final = case(0), case(10)
        bad_cases = [replace(final, event_id=a.event_id), replace(final, site_id=a.site_id)]
        for field in ('id', 'acquisition_id', 'sha256', 'acquired_at'):
            source = replace(final.before.source, **{field: getattr(a.before.source, field)})
            bad_cases.append(replace(final, before=replace(final.before, source=source)))
        for bad in bad_cases:
            with self.subTest(bad=bad.before.source.id):
                p = freeze(spec(), [a], heldout=[bad])
                self.assertEqual(p['status'], 'withheld')
                self.assertTrue(any('leakage' in x for x in p['reasons']))

    def test_acquisition_dates_normalized_for_split_identity(self):
        a, final = case(), case(10)
        source = replace(final.before.source, acquired_at='2024-01-02T03:30:00+03:30')
        final = replace(final, before=replace(final.before, source=source))
        p = freeze(spec(), [a], heldout=[final])
        self.assertEqual(p['status'], 'withheld')
        self.assertTrue(any('leakage' in reason for reason in p['reasons']))

    def test_failed_reference_case_still_enforces_split_barrier(self):
        a, final = case(), case(10)
        a = replace(a, reference=None)
        p = freeze(spec(), [a], heldout=[replace(final, event_id=a.event_id)])
        self.assertTrue(any('leakage' in x for x in p['reasons']))
        self.assertEqual(len(p['attempts']), 1)

    def test_policy_and_mask_mutation_fail_integrity_and_external_pin(self):
        c, final = case(), case(10)
        p = freeze(spec(), [c], heldout=[final])
        original_pin = p['receipt_sha256']
        for change in ('thresholds', 'spec', 'attempts'):
            q = copy.deepcopy(p)
            if change == 'thresholds':
                q['thresholds']['upper_db'] = 100
            elif change == 'spec':
                q['spec']['profile']['stratum'] = 'edited'
            else:
                q['attempts'][0]['reference']['definition'] = 'edited'
            with self.assertRaisesRegex(RadarError, 'integrity'):
                apply(q, final, expected_receipt_sha256=original_pin)
            q['receipt_sha256'] = digest({k: v for k, v in q.items() if k != 'receipt_sha256'})
            with self.assertRaisesRegex(RadarError, 'integrity'):
                apply(q, final, expected_receipt_sha256=original_pin)
        final.target.mask[0, 0] = False
        with self.assertRaisesRegex(RadarError, 'mask hash'):
            detect(p, final, 'final')

    def test_power_and_reference_mutation_fail(self):
        c = case(); c.target.power[0, 0] = 2
        self.assertEqual(freeze(spec(), [c])['status'], 'withheld')
        c = case(); c.reference.labels[0, 0] = -1
        p = freeze(spec(), [c])
        self.assertIn('Reference/mask hash changed', p['attempts'][0]['reasons'])

    def test_json_roundtrip_external_pin_and_unregistered_final(self):
        c, final = case(), case(10)
        p = json.loads(json.dumps(freeze(spec(), [c], heldout=[final])))
        detect(p, final, 'final')
        with self.assertRaisesRegex(RadarError, 'not registered'):
            detect(p, case(11), 'final')
        with self.assertRaisesRegex(RadarError, 'leakage'):
            detect(p, c, 'final')
        detect(p, case(11), 'exploratory')
        with self.assertRaisesRegex(RadarError, 'external'):
            apply(p, final, expected_receipt_sha256='')

    def test_strict_empirical_ties_do_not_alert(self):
        c = case(scores=(-10, 0, 10, 0))
        p = freeze(spec(lower_candidates=(-10.,), upper_candidates=(10.,),
                        lower_tail_budget=0, upper_tail_budget=0), [c])
        np.testing.assert_array_equal(detect(p, c, 'calibration').flags, [[0, 0, 0, 0]])
        self.assertEqual(p['attempts'][0]['selected_rates']['target_stable_nuisance_alert_fraction'], 0)

    def test_stratum_product_grid_and_mask_mismatch_withheld(self):
        c = case()
        cases = [replace(c, stratum='unmatched')]
        for key, val in (('release', 'different'), ('crid', 'different'), ('geometry', 'different-track'),
                         ('units', 'DB'), ('polarization', 'VV'), ('maturity', 'unresolved'),
                         ('track', 'nisar_l_band')):
            cases.append(replace(c, target=replace(c.target, source=replace(c.target.source,
                         product=replace(PRODUCT, **{key: val})))))
        cases.append(replace(c, target=replace(c.target, grid=replace(c.target.grid, crs='OTHER'))))
        cases.append(replace(c, target=replace(c.target, source=replace(c.target.source,
                             producer_mask_definition='undocumented'))))
        for bad in cases:
            with self.subTest(bad=bad.stratum):
                p = freeze(spec(), [bad])
                self.assertEqual(p['status'], 'withheld')
                self.assertEqual(p['attempts'][0]['status'], 'failed')

    def test_supported_tracks_are_separate_and_nisar_hh_required(self):
        for track, sensor, band, pol in [('nisar_l_band', 'NISAR', 'L', 'HH'),
                                       ('sentinel1_c_band', 'Sentinel-1', 'C', 'VV')]:
            product = replace(PRODUCT, track=track, sensor=sensor, band=band, polarization=pol)
            s = spec('fixed_pair', profile=replace(spec().profile, product=product))
            c = case()
            c = replace(c, before=replace(c.before, source=replace(c.before.source, product=product)),
                        target=replace(c.target, source=replace(c.target.source, product=product)))
            p = freeze(s, heldout=[c])
            detect(p, c, 'final')  # Still artificial inputs: no field result implied.
            self.assertEqual(freeze(s, heldout=[case()])['status'], 'withheld')
        with self.assertRaisesRegex(RadarError, 'HH'):
            freeze(spec(profile=replace(spec().profile, product=replace(PRODUCT, track='nisar_l_band',
                          sensor='NISAR', band='L', polarization='VV'))))

    def test_integer_offset_crops_allowed_no_fractional_or_pair_regridding(self):
        c = case()
        for shift, accepted in ((10., True), (2.5, False)):
            g = replace(c.target.grid, transform=(shift, 10., 0., 0., 0., -10.))
            crop = replace(c, before=replace(c.before, grid=g), target=replace(c.target, grid=g))
            self.assertEqual(freeze(spec(), [crop])['status'] == 'fitted_offline_not_activated', accepted)
        g = replace(c.target.grid, transform=(10., 10., 0., 0., 0., -10.))
        self.assertEqual(freeze(spec(), [replace(c, target=replace(c.target, grid=g))])['status'], 'withheld')
        with self.assertRaises(RadarError):
            freeze(spec(profile=replace(spec().profile, grid=replace(grid(), linear_units='degree'))))

    def test_candidate_and_case_bounds_freeze_time_and_frozen_reference_definition(self):
        for values in ((-1., -3.), (0.,), (float('-inf'),), (-3., -3.), tuple(range(-300, 0))):
            with self.assertRaises(RadarError):
                freeze(spec(lower_candidates=values), [case()])
        for c in (replace(case(), reference=replace(case().reference, frozen_at='2027-01-01T00:00:00Z')),
                  replace(case(), reference=replace(case().reference, definition='SCL automatically assumed truth'))):
            self.assertEqual(freeze(spec(), [c])['status'], 'withheld')
        with self.assertRaisesRegex(RadarError, 'case count'):
            freeze(spec(), [case()]*33)
        p = freeze(spec(), [case(), case()])
        self.assertEqual(p['status'], 'withheld')
        self.assertEqual(len(p['attempts']), 2)

    def test_optional_footprint_counts_and_hashes_are_explicit(self):
        c = case()
        c = replace(c, target=frame([1, 0, 1, 1], c.target.source.id, 2))
        window_policy = freeze(spec('fixed_pair'))
        d = detect(window_policy, c)
        self.assertEqual(d.receipt['coverage_denominator'], 'native_rectangular_window')
        self.assertIsNone(d.receipt['valid_target_footprint_fraction'])
        self.assertEqual(d.receipt['case']['missing_within_requested_aoi'], 'not_inferable_without_footprint')
        aoi = np.array([[True, True, False, False]])
        footprint = Footprint(aoi, 'Externally supplied AOI pixel centres', array_sha256(aoi))
        c = replace(c, footprint=footprint)
        s = spec('fixed_pair', profile=replace(spec().profile, target_footprint_definition=footprint.definition))
        p = freeze(s, heldout=[c])
        d = detect(p, c, 'final')
        self.assertEqual(d.receipt['valid_window_fraction'], .25)
        self.assertEqual(d.receipt['valid_target_footprint_fraction'], .5)
        self.assertEqual(d.receipt['counts']['outside_target_footprint_cells'], 2)
        self.assertEqual(d.receipt['counts']['invalid_within_target_footprint_cells'], 1)
        np.testing.assert_array_equal(d.flags, [[0, UNKNOWN, UNKNOWN, UNKNOWN]])
        with self.assertRaisesRegex(RadarError, 'footprint availability'):
            detect(window_policy, c)
        aoi[0, 0] = False
        with self.assertRaisesRegex(RadarError, 'Footprint hash changed'):
            detect(p, c)

    def test_freeze_does_not_score_heldout(self):
        with patch('service.benchmarks.radar.pair_scores', side_effect=AssertionError('final must not be scored')):
            self.assertEqual(freeze(spec('fixed_pair'), heldout=[case()])['status'], 'fitted_offline_not_activated')


class RadarTemporalPolicies(unittest.TestCase):
    def test_distinct_temporal_fit_and_never_reuse_pair_policy(self):
        c, final = case(0, temporal=True), case(10, temporal=True)
        p = freeze(spec('empirical_temporal'), [c], heldout=[final])
        d = detect(p, final, 'final')
        self.assertEqual(d.receipt['estimand'], 'departure_from_causal_linear_power_median')
        pair = freeze(spec(), [case()])
        with self.assertRaisesRegex(RadarError, 'Pair method'):
            detect(pair, final)
        with self.assertRaisesRegex(RadarError, 'Temporal method'):
            detect(p, case(20))

    def test_history_future_duplicate_dates_source_ids_acquisitions_and_order(self):
        c = case(0, temporal=True)
        a, b = c.history
        tests = [replace(c, history=(a, replace(b, source=replace(b.source, acquired_at=c.target.source.acquired_at)))),
                 replace(c, history=(a, replace(b, source=replace(b.source, acquired_at=a.source.acquired_at)))),
                 replace(c, history=(b, a))]
        for key in ('id', 'acquisition_id', 'sha256'):
            tests.append(replace(c, history=(a, replace(b, source=replace(b.source, **{key: getattr(a.source, key)})))))
        for bad in tests:
            with self.subTest(bad=bad.history[1].source.id):
                p = freeze(spec('empirical_temporal'), [bad])
                self.assertEqual(p['status'], 'withheld')
                self.assertEqual(p['attempts'][0]['status'], 'failed')

    def test_history_age_gap_cutoff_and_insufficiency_never_fallback(self):
        c = case(temporal=True)
        for s in (spec('empirical_temporal', maximum_history_age_seconds=86400),
                  spec('empirical_temporal', maximum_history_gap_seconds=3600),
                  spec('empirical_temporal', history_cutoff_seconds=86400),
                  spec('empirical_temporal', minimum_valid_histories=3)):
            p = freeze(s, [c])
            self.assertEqual(p['status'], 'withheld')
            self.assertIsNone(p['thresholds'])
        p = freeze(spec('empirical_temporal'), [c])
        short = replace(case(10, temporal=True), history=(case(10, temporal=True).history[0],))
        d = detect(p, short)
        self.assertEqual(d.receipt['status'], 'withheld_no_valid_support')
        np.testing.assert_array_equal(d.flags, np.full((1, 4), UNKNOWN))
        self.assertEqual(d.receipt['counts']['insufficient_history_cells'], 4)

    def test_history_participates_in_connected_split_leakage(self):
        c, final = case(0, temporal=True), case(10, temporal=True)
        h = final.history[0]
        h = replace(h, source=replace(h.source, sha256=c.history[0].source.sha256))
        final = replace(final, history=(h, final.history[1]))
        p = freeze(spec('empirical_temporal'), [c], heldout=[final])
        self.assertEqual(p['status'], 'withheld')
        self.assertTrue(any('leakage' in r for r in p['reasons']))
        self.assertEqual(connected_groups([c, final]), [[c.id, final.id]])

    def test_history_product_grid_mismatch_and_array_limit(self):
        c = case(temporal=True)
        h = c.history[0]
        bad = replace(h, source=replace(h.source, product=replace(PRODUCT, release='other')))
        self.assertEqual(freeze(spec('empirical_temporal'), [replace(c, history=(bad, c.history[1]))])['status'], 'withheld')
        shifted = replace(h, grid=replace(h.grid, transform=(10., 10., 0., 0., 0., -10.)))
        self.assertEqual(freeze(spec('empirical_temporal'), [replace(c, history=(shifted, c.history[1]))])['status'], 'withheld')
        self.assertEqual(freeze(spec('empirical_temporal'), [replace(c, history=(h,)*13)])['status'], 'withheld')

    def test_entire_input_set_immutable_and_coverage_comparison(self):
        pair, temporal = case(10), case(10, temporal=True)
        # Both methods inspect the exact same target; pair before differs from history.
        temporal = replace(temporal, target=pair.target)
        h = temporal.history[0]
        temporal = replace(temporal, history=(frame([0, 1, 1, 1], h.source.id, 30), temporal.history[1]))
        p = freeze(spec('fixed_pair'))
        t = freeze(spec('empirical_temporal'), [case(0, temporal=True)])
        inputs = [pair.before.power, pair.before.mask, pair.target.power, pair.target.mask,
                  temporal.history[0].power, temporal.history[0].mask,
                  temporal.history[1].power, temporal.history[1].mask]
        old = [array_sha256(x) for x in inputs]
        a, b = detect(p, pair), detect(t, temporal)
        report = support_comparison([a, b])
        self.assertFalse(report['identical_support'])
        self.assertEqual(report['common_cells'], 3)
        self.assertEqual([x['valid_cells'] for x in report['methods']], [4, 3])
        self.assertEqual(old, [array_sha256(x) for x in inputs])
        self.assertTrue(support_comparison([a, a])['identical_support'])


if __name__ == '__main__':
    unittest.main()
