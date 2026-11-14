"""Offline synthetic checks only; no field skill or operational evidence."""
import copy
import json
import math
import unittest
from datetime import date, timedelta
from unittest.mock import patch

from service.observatory import forecast_policy as fp
from service.observatory import provisional_issue as pi
from service.observatory.vintages import canonical_hash, canonical_json
from service.tests import test_forecast_policy as fixtures
from service.tests.test_forecast_information import rehash
from service.tests.test_vintages import record

FREEZE, ISSUE, SCORE, seal = fixtures.FREEZE, fixtures.ISSUE, fixtures.SCORE, fixtures.seal


class ProvisionalTests(unittest.TestCase):
    # Reuse fixture helpers, without inheriting the v1 suite's test methods.
    setUp = fixtures.PolicyTests.setUp
    capture = fixtures.PolicyTests.capture
    snapshot = fixtures.PolicyTests.snapshot
    history = fixtures.PolicyTests.history

    @classmethod
    def setUpClass(cls):
        fixture = fixtures.PolicyTests()
        fixture.setUp()
        try:
            cls.policy, cls.freeze_snapshot = fixture.freeze()
            cls.seasonal_policy, _ = fixture.freeze(fixture.history(pattern='seasonal'),
                                                    at='2025-12-30T13:00:00Z')
        finally:
            fixture.doCleanups()

    def current(self, *, quality='Provisional', value=None, at=ISSUE, rows=None,
                start='2022-01-05', end='2026-01-03', policy=None):
        self.capture(self.history(), FREEZE)
        if rows is None:
            rows = [record((date(2025, 12, 30)+timedelta(days=i)).isoformat(),
                           3920+2*i if value is None else value, quality) for i in range(5)]
        if rows:
            self.capture(rows, at)
        snapshot = self.snapshot(at, start, end)
        policy = self.policy if policy is None else policy
        computed = pi.compute_provisional_issue(policy, snapshot, expected_policy_hash=policy['policyHash'],
                                                expected_snapshot_hash=snapshot['snapshotHash'], issue_time=at)
        return computed, snapshot

    def score(self, computed, rows=None, at=SCORE, policy=None):
        rows = ([record('2026-01-06', 3940, 'Approved'), record('2026-01-10', 3950, 'approved')]
                if rows is None else rows)
        if rows:
            self.capture(rows, at)
        snapshot = self.snapshot(at, '2026-01-04', '2026-01-10')
        policy = self.policy if policy is None else policy
        scored = pi.score_provisional_issue(policy, computed, snapshot, expected_policy_hash=policy['policyHash'],
                                            expected_experiment_hash=computed['experimentHash'],
                                            expected_snapshot_hash=snapshot['snapshotHash'], score_time=at)
        return scored, snapshot

    def invalid(self, call):
        with self.assertRaises(ValueError) as caught:
            call()
        self.assertEqual(str(caught.exception), pi.ERROR)
        self.assertIsNone(caught.exception.__cause__)

    def attempt(self, artifact, method='candidate', horizon=3):
        return next(a for a in artifact['attempts'] if a['method'] == method and a['horizonDays'] == horizon)

    def test_provisional_points_lineage_no_intervals_and_v1_still_strict(self):
        frozen = canonical_json(self.policy)
        computed, snapshot = self.current()
        strict = fp.issue_policy(self.policy, snapshot, expected_policy_hash=self.policy['policyHash'],
                                 expected_snapshot_hash=snapshot['snapshotHash'], issue_time=ISSUE)
        self.assertEqual(len(computed['attempts']), 9)
        self.assertEqual(computed['counts'], dict(attempted=9, computed=6, withheld=3, computationRate=6/9))
        self.assertFalse(computed['operationalPublication'])
        self.assertEqual(computed['methodVersion'], pi.VERSION)
        self.assertNotEqual(computed['methodVersion'], fp.VERSION)
        for a in computed['attempts']:
            if a['horizonDays'] == 1:
                self.assertEqual(a['status'], 'withheld')
                self.assertIsNone(a['point'])
            else:
                self.assertEqual(a['status'], 'computed')
                self.assertTrue(math.isfinite(a['point']) and a['point'] >= 0)
            for key in ('distribution', 'lower', 'upper', 'radii', 'radius', 'nominalCoverage'):
                self.assertNotIn(key, a)
                self.assertNotIn(key, a['predictor'])
            self.assertEqual(a['targetInterval'], self.attempt(computed, 'persistence', a['horizonDays'])['targetInterval'])
        for method in ('candidate', 'persistence'):
            self.assertIn('unsupported_predictor_quality', self.attempt(strict, method)['reasons'])
        support = self.attempt(computed)['predictor']['support']
        self.assertEqual(len(support), 28)
        self.assertEqual([p['quality'] for p in support[-5:]], ['Provisional']*5)
        for point in support:
            original = next(r for r in snapshot['observations'] if r['date'] == point['date'])
            for key in ('value', 'quality', 'qualifiers', 'versionHash', 'date', 'receivedAt'):
                self.assertEqual(point[key], original[key])
            self.assertTrue(point['completedAtReceipt'] and point['completedAtIssue'])
        self.assertEqual(canonical_json(self.policy), frozen)
        self.assertTrue(all(r['quality'] == 'approved' for r in self.policy['sourceSnapshot']['observations']))
        self.assertEqual(computed['uncertainty'], dict(prediction='unquantified', revision='unquantified'))
        self.assertEqual(computed['targetCounts']['duplicateTargetAttempts'], 6)

    def test_no_selection_fitting_or_calibration_during_compute_and_score(self):
        with patch.object(fp.forecasts, 'evaluate_gauge', side_effect=AssertionError('fit')), \
             patch.object(fp.forecasts, '_evaluate_gauge', side_effect=AssertionError('fit')), \
             patch.object(fp.forecasts, 'calibration_radius', side_effect=AssertionError('calibration')):
            computed, _ = self.current()
            scored, _ = self.score(computed)
        self.assertEqual(scored['counts']['scoreableComputed'], 6)
        self.assertEqual(scored['counts']['outcomeAvailableAttempts'], 6)
        self.assertEqual(sum(c['matchedCases'] for c in scored['comparisons']), 4)
        self.assertEqual(scored['targetCounts']['scoredDistinctTargetCount'], 2)
        self.assertEqual(scored['targetCounts']['duplicateScoredTargetAttempts'], 4)
        for method in pi.METHODS:
            counts = scored['methodCounts'][method]
            self.assertEqual(counts['attempted'], 3)
            self.assertEqual(counts['computed'], 2)
            selected = [a['metrics'] for a in scored['attempts'] if a['method'] == method and a['metrics']]
            self.assertAlmostEqual(counts['mae'], sum(m['absoluteError'] for m in selected)/2)
            self.assertAlmostEqual(counts['bias'], sum(m['signedError'] for m in selected)/2)
        self.assertNotIn('publicationRate', canonical_json(scored))
        self.assertNotIn('bandHit', canonical_json(scored))

    def test_quality_allowlist_and_qualifiers_are_model_specific(self):
        self.capture(self.history(), FREEZE)
        for index, (quality, qualifiers, accepted) in enumerate([
                ('Approved', [], True), ('approved', [], True), ('Provisional', [], True),
                ('provisional', [], True), ('PROVISIONAL', [], False), ('Mixed', [], False),
                ('unknown', [], False), ('Approved/Provisional', [], False), ('Provisional', ['P'], False)]):
            at = f'2026-01-04T12:{index:02d}:00Z'
            rows = [record((date(2025, 12, 30)+timedelta(days=i)).isoformat(), 3920+2*i, quality)
                    for i in range(5)]
            for row in rows:
                row['qualifiers'] = qualifiers
            self.capture(rows, at)
            snap = self.snapshot(at, '2022-01-05', '2026-01-03')
            computed = pi.compute_provisional_issue(self.policy, snap, expected_policy_hash=self.policy['policyHash'],
                                                    expected_snapshot_hash=snap['snapshotHash'], issue_time=at)
            for method in ('candidate', 'persistence'):
                a = self.attempt(computed, method)
                self.assertEqual(a['status'], 'computed' if accepted else 'withheld')
                if not accepted:
                    self.assertIn('unsupported_predictor_quality', a['reasons'])
                    self.assertEqual(a['predictor']['support'][-1]['quality'], quality)
                    self.assertEqual(a['predictor']['support'][-1]['qualifiers'], qualifiers)
            self.assertEqual(self.attempt(computed, 'seasonal-naive')['status'], 'computed')

    def test_missing_support_and_seasonal_exact_calendar_target(self):
        computed, _ = self.current(rows=[record('2026-01-03', 4000, 'Provisional')])
        self.assertIn('missing_predictor_support', self.attempt(computed)['reasons'])
        self.assertEqual(self.attempt(computed, 'persistence')['point'], 4000)
        seasonal = self.attempt(computed, 'seasonal-naive')
        expected = (date.fromisoformat(seasonal['targetInterval']['date'])-timedelta(days=365)).isoformat()
        self.assertEqual(seasonal['predictor']['support'][0]['date'], expected)
        at = '2026-01-04T13:00:00Z'
        snapshot = self.snapshot(at, '2026-01-03', '2026-01-03')
        missing = pi.compute_provisional_issue(self.policy, snapshot, expected_policy_hash=self.policy['policyHash'],
                                               expected_snapshot_hash=snapshot['snapshotHash'], issue_time=at)
        self.assertIn('missing_predictor_support', self.attempt(missing, 'seasonal-naive')['reasons'])

    def test_intraday_receipt_completion_issue_cutoff_stale_and_expired(self):
        self.capture(self.history(), FREEZE)
        self.capture([record('2026-01-03', 4000, 'Provisional')], '2026-01-03T12:00:00Z')
        snapshot = self.snapshot(ISSUE, '2022-01-05', '2026-01-03')
        computed = pi.compute_provisional_issue(self.policy, snapshot, expected_policy_hash=self.policy['policyHash'],
                                                expected_snapshot_hash=snapshot['snapshotHash'], issue_time=ISSUE)
        a = self.attempt(computed, 'persistence')
        self.assertIn('incomplete_when_received', a['reasons'])
        self.assertFalse(a['predictor']['support'][0]['completedAtReceipt'])
        self.assertTrue(a['predictor']['support'][0]['completedAtIssue'])
        self.capture([record('2026-01-04', 5000, 'Provisional')], ISSUE)
        snapshot = self.snapshot(ISSUE, '2022-01-05', '2026-01-04')
        computed = pi.compute_provisional_issue(self.policy, snapshot, expected_policy_hash=self.policy['policyHash'],
                                                expected_snapshot_hash=snapshot['snapshotHash'], issue_time=ISSUE)
        self.assertEqual(computed['forecastInformation']['latestRetainedDate'], '2026-01-03')
        self.assertEqual(computed['forecastInformation']['counts']['incompleteAtIssue'], 1)
        at = '2026-01-12T12:00:00Z'
        snapshot = self.snapshot(at, '2022-01-05', '2026-01-03')
        stale = pi.compute_provisional_issue(self.policy, snapshot, expected_policy_hash=self.policy['policyHash'],
                                             expected_snapshot_hash=snapshot['snapshotHash'], issue_time=at)
        self.assertEqual(stale['counts']['computed'], 0)
        for a in stale['attempts']:
            self.assertIn('stale_or_unresolved_observation', a['reasons'])
            self.assertIn('target_expired', a['reasons'])

    def test_withheld_freeze_preserves_all_attempts(self):
        self.capture([record('2025-12-29', 10, 'approved')], FREEZE)
        snapshot = self.snapshot(FREEZE, '2025-12-29', '2025-12-29')
        withheld = fp.freeze_policy(snapshot, expected_snapshot_hash=snapshot['snapshotHash'], freeze_time=FREEZE)
        self.capture([record('2026-01-03', 20, 'Provisional')], ISSUE)
        current = self.snapshot(ISSUE, '2025-12-29', '2026-01-03')
        result = pi.compute_provisional_issue(withheld, current, expected_policy_hash=withheld['policyHash'],
                                              expected_snapshot_hash=current['snapshotHash'], issue_time=ISSUE)
        self.assertEqual(result['counts']['computed'], 0)
        self.assertTrue(all('policy_withheld' in a['reasons'] and a['point'] is None for a in result['attempts']))

    def test_candidate_gate_preserves_baselines(self):
        computed, _ = self.current(policy=self.seasonal_policy)
        failed = {d['horizonDays'] for d in self.seasonal_policy['development'] if not d['eligible']}
        self.assertTrue(failed)
        for h in failed:
            self.assertIn('candidate_development_gate_failed', self.attempt(computed, 'candidate', h)['reasons'])
        self.assertTrue(any(a['status'] == 'computed' and a['method'] != 'candidate' for a in computed['attempts']))

    def test_revision_immutability_and_detachment(self):
        computed, snapshot = self.current()
        original = canonical_json(computed)
        frozen = canonical_json(self.policy)
        self.capture([record('2026-01-03', 5000, 'Provisional')], '2026-01-05T12:00:00Z')
        later_input = self.snapshot('2026-01-05T12:00:00Z', snapshot['start'], snapshot['end'])
        later_computed = pi.compute_provisional_issue(self.policy, later_input,
                            expected_policy_hash=self.policy['policyHash'],
                            expected_snapshot_hash=later_input['snapshotHash'], issue_time=later_input['issueTime'])
        self.assertEqual(self.attempt(later_computed, 'persistence')['point'], 5000)
        self.assertNotEqual(later_computed['experimentHash'], computed['experimentHash'])
        self.assertEqual(self.snapshot(ISSUE, snapshot['start'], snapshot['end']), snapshot)
        scored, _ = self.score(computed)
        old_score = canonical_json(scored)
        revised, _ = self.score(computed, [record('2026-01-06', 4100, 'Approved')],
                                 at='2026-01-13T12:00:00Z')
        self.assertNotEqual(scored['scoreHash'], revised['scoreHash'])
        self.assertEqual(canonical_json(scored), old_score)
        self.assertEqual(canonical_json(computed), original)
        self.assertEqual(canonical_json(self.policy), frozen)
        snapshot['observations'][-1]['quality'] = 'Changed'
        self.assertEqual(canonical_json(computed), original)
        computed['attempts'][3]['predictor']['targetInterval']['date'] = 'changed'
        self.assertEqual(computed['forecastInformation']['timingAttempts'][1]['targetInterval']['date'], '2026-01-06')
        self.assertEqual(scored['experimentHash'], canonical_hash({k: v for k, v in json.loads(original).items()
                                                                 if k != 'experimentHash'}))

    def test_missing_provisional_null_and_withheld_truth_denominators(self):
        computed, _ = self.current()
        scored, _ = self.score(computed, [record('2026-01-06', 3940, 'Provisional')])
        self.assertEqual(scored['counts']['scoreableComputed'], 0)
        self.assertEqual(scored['counts']['unscoreableComputed'], 6)
        self.assertEqual(self.attempt(scored)['outcomeReason'], 'unsupported_outcome_quality')
        self.assertEqual(self.attempt(scored, horizon=7)['outcomeReason'], 'missing_outcome')
        self.assertEqual(sum(c['matchedCases'] for c in scored['comparisons']), 0)
        null, _ = self.score(computed, [record('2026-01-06', None, 'Approved')],
                              at='2026-01-13T12:00:00Z')
        self.assertEqual(self.attempt(null)['outcomeReason'], 'null_withdrawal')
        self.assertEqual(self.attempt(null)['outcomeLineage']['quality'], 'Approved')
        self.assertEqual(null['counts']['attempted'], 9)
        withtruth, _ = self.score(computed, [record('2026-01-04', 3930, 'Approved'),
                                           record('2026-01-06', 3940, 'Approved')],
                                   at='2026-01-14T12:00:00Z')
        self.assertEqual(self.attempt(withtruth, horizon=1)['scoreReason'], 'original_withheld')
        self.assertEqual(self.attempt(withtruth, horizon=1)['outcomeStatus'], 'available')

    def test_truth_receipt_must_complete_target(self):
        computed, _ = self.current()
        self.capture([record('2026-01-06', 4000, 'Approved')], '2026-01-06T12:00:00Z')
        scored, _ = self.score(computed, rows=[])
        self.assertEqual(self.attempt(scored)['outcomeReason'], 'incomplete_when_received')
        self.assertEqual(self.attempt(scored)['scoreStatus'], 'non_scoreable')

    def test_external_pin_shape_and_size_admission_before_hashing(self):
        computed, snapshot = self.current()
        malformed = copy.deepcopy(snapshot)
        malformed['observations'][0]['qualifiers'] = [[float('nan')]]
        finite_nested = copy.deepcopy(snapshot)
        finite_nested['observations'][0]['qualifiers'] = [3.5]
        huge = copy.deepcopy(snapshot)
        huge['observations'][0]['quality'] = 'sensitive'*300
        oversized = copy.deepcopy(snapshot)
        oversized['observations'] = [None]*2001
        nested = copy.deepcopy(snapshot)
        nested['unexpected'] = [[[[[[[[[[[[[[None]]]]]]]]]]]]]]
        record_oversized = copy.deepcopy(snapshot)
        record_oversized['observations'][0]['qualifiers'] = ['x'*1000]*16
        for bad in (malformed, finite_nested, huge, oversized, nested, record_oversized):
            with patch.object(pi, 'canonical_hash', side_effect=AssertionError('hash before admission')), \
                 patch.object(fp, 'canonical_hash', side_effect=AssertionError('hash before admission')):
                self.invalid(lambda: pi.compute_provisional_issue(self.policy, bad,
                             expected_policy_hash=self.policy['policyHash'],
                             expected_snapshot_hash=snapshot['snapshotHash'], issue_time=ISSUE))
        for pin in (None, True, 'x', 'a'*65):
            with patch.object(fp, '_validate_policy', side_effect=AssertionError('pin not checked')):
                self.invalid(lambda: pi.compute_provisional_issue(self.policy, snapshot,
                             expected_policy_hash=pin, expected_snapshot_hash=snapshot['snapshotHash'], issue_time=ISSUE))
        self.invalid(lambda: pi.compute_provisional_issue(self.policy, snapshot,
                     expected_policy_hash=self.policy['policyHash'], expected_snapshot_hash='0'*64, issue_time=ISSUE))

    def test_rehashed_nested_artifact_unknown_keys_types_and_points_rejected(self):
        computed, _ = self.current()
        _, truth = self.score(computed)
        for mutate in (
                lambda a: a['attempts'][3].update(point=True),
                lambda a: a['attempts'][3].update(point=1e308),
                lambda a: a['counts'].update(attempted=True),
                lambda a: a['attempts'][3]['predictor'].update(unknown='private'),
                lambda a: a['attempts'][3]['predictor']['support'][0].update(completedAtReceipt=1),
                lambda a: a['attempts'][3].update(horizonDays=True),
                lambda a: a.update(operationalPublication=0),
                lambda a: a['sourceSnapshot'].update(calendarDays=True)):
            bad = copy.deepcopy(computed)
            mutate(bad)
            seal(bad, 'experimentHash')
            self.invalid(lambda: pi.score_provisional_issue(self.policy, bad, truth,
                         expected_policy_hash=self.policy['policyHash'], expected_experiment_hash=bad['experimentHash'],
                         expected_snapshot_hash=truth['snapshotHash'], score_time=SCORE))
        bad = copy.deepcopy(computed)
        bad['attempts'][0]['point'] = float('inf')
        self.invalid(lambda: pi.score_provisional_issue(self.policy, bad, truth,
                     expected_policy_hash=self.policy['policyHash'], expected_experiment_hash=computed['experimentHash'],
                     expected_snapshot_hash=truth['snapshotHash'], score_time=SCORE))
        bad = copy.deepcopy(computed)
        bad['attempts'][3]['point'] += 1
        seal(bad, 'experimentHash')
        self.invalid(lambda: pi.score_provisional_issue(self.policy, bad, truth,
                     expected_policy_hash=self.policy['policyHash'], expected_experiment_hash=computed['experimentHash'],
                     expected_snapshot_hash=truth['snapshotHash'], score_time=SCORE))

    def test_identity_metadata_and_phase_cutoff_must_match(self):
        _, snapshot = self.current()
        bad = copy.deepcopy(snapshot)
        bad['identity']['station'] = 'other'
        rehash(bad)
        self.invalid(lambda: pi.compute_provisional_issue(self.policy, bad,
                     expected_policy_hash=self.policy['policyHash'], expected_snapshot_hash=bad['snapshotHash'], issue_time=ISSUE))
        bad = copy.deepcopy(snapshot)
        for row in bad['observations']:
            row['stationTimeProperties']['uses_daylight_savings'] = 'N'
        rehash(bad, records=True)
        self.invalid(lambda: pi.compute_provisional_issue(self.policy, bad,
                     expected_policy_hash=self.policy['policyHash'], expected_snapshot_hash=bad['snapshotHash'], issue_time=ISSUE))
        self.invalid(lambda: pi.compute_provisional_issue(self.policy, snapshot,
                     expected_policy_hash=self.policy['policyHash'], expected_snapshot_hash=snapshot['snapshotHash'],
                     issue_time='2026-01-04T13:00:00Z'))
        self.invalid(lambda: pi.compute_provisional_issue(self.policy, self.freeze_snapshot,
                     expected_policy_hash=self.policy['policyHash'], expected_snapshot_hash=self.freeze_snapshot['snapshotHash'],
                     issue_time=FREEZE))

    def test_snapshot_bool_numbers_and_nested_unknown_fields_are_rejected(self):
        _, snapshot = self.current()
        for mutate in (lambda s: s.update(calendarDays=True),
                       lambda s: s.update(unknownDays=False),
                       lambda s: s['observations'][-1].update(value=True),
                       lambda s: s['observations'][-1].update(revision=True),
                       lambda s: s['observations'][-1].update(extra='private')):
            bad = copy.deepcopy(snapshot)
            mutate(bad)
            rehash(bad, records=True)
            self.invalid(lambda: pi.compute_provisional_issue(self.policy, bad,
                         expected_policy_hash=self.policy['policyHash'], expected_snapshot_hash=bad['snapshotHash'],
                         issue_time=ISSUE))

    def test_unresolved_target_preserved_and_unknown_truth_unscoreable(self):
        self.capture(self.history(), FREEZE)
        self.capture([record('2026-12-29', 5000, 'Provisional')], '2026-12-30T12:00:00Z')
        snapshot = self.snapshot('2026-12-30T12:00:00Z', '2026-12-29', '2026-12-29')
        computed = pi.compute_provisional_issue(self.policy, snapshot, expected_policy_hash=self.policy['policyHash'],
                                                expected_snapshot_hash=snapshot['snapshotHash'],
                                                issue_time=snapshot['issueTime'])
        self.assertEqual(computed['counts']['computed'], 0)
        target = self.attempt(computed)['targetInterval']
        self.assertEqual(target['date'], '2027-01-01')
        self.assertIsNone(target['endUtc'])
        self.assertEqual(computed['targetCounts']['unresolvedTargetAttempts'], 6)
        later = self.snapshot('2027-01-08T12:00:00Z', '2026-12-30', '2027-01-05')
        scored = pi.score_provisional_issue(self.policy, computed, later, expected_policy_hash=self.policy['policyHash'],
                                            expected_experiment_hash=computed['experimentHash'],
                                            expected_snapshot_hash=later['snapshotHash'], score_time=later['issueTime'])
        self.assertEqual(self.attempt(scored)['outcomeReason'], 'unresolved_target')
        self.assertEqual(scored['counts']['scoreableComputed'], 0)
        self.assertEqual(len(scored['attempts']), 9)

    def test_unresolved_past_support_is_withheld_without_structural_error(self):
        rows = [record((date(2006, 12, 19)+timedelta(days=i)).isoformat(), 100+i, 'Provisional')
                for i in range(28)]
        self.capture(rows, ISSUE)
        snapshot = self.snapshot(ISSUE, rows[0]['date'], rows[-1]['date'])
        # The v1 helper already guards null ends; make the experiment's own
        # guard explicit and verify it never calls the helper on null timing.
        original = fp._received_complete
        def complete(entry):
            self.assertIsNotNone(entry['stationDay']['endUtc'])
            return original(entry)
        with patch.object(fp, '_received_complete', side_effect=complete):
            computed = pi.compute_provisional_issue(self.policy, snapshot,
                            expected_policy_hash=self.policy['policyHash'],
                            expected_snapshot_hash=snapshot['snapshotHash'], issue_time=ISSUE)
        self.assertEqual(computed['counts']['attempted'], 9)
        self.assertEqual(computed['counts']['computed'], 0)
        self.assertIn('unresolved_station_time', self.attempt(computed)['reasons'])
        unresolved = self.attempt(computed)['predictor']['support'][0]
        self.assertEqual(unresolved['date'], '2006-12-19')
        self.assertFalse(unresolved['completedAtReceipt'])

    def test_finite_point_and_overflow_safe_score_reduction(self):
        computed, _ = self.current(value=1e308)
        self.assertEqual(self.attempt(computed, 'persistence')['point'], 1e308)
        self.assertIn('invalid_prediction', self.attempt(computed)['reasons'])
        scored, _ = self.score(computed, [record('2026-01-06', 0, 'Approved'),
                                        record('2026-01-10', 0, 'Approved')])
        self.assertEqual(scored['methodCounts']['persistence']['mae'], 1e308)
        self.assertEqual(scored['methodCounts']['persistence']['bias'], 1e308)
        self.assertNotIn('Infinity', canonical_json(scored))


if __name__ == '__main__':
    unittest.main()
