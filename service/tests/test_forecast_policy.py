"""Synthetic temporary-ledger contract checks, never real skill evidence."""
import copy
import math
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from service.observatory import forecast_policy as fp
from service.observatory.vintages import ObservationVintageLedger, canonical_hash, canonical_json
from service.tests.test_vintages import IDENTITY, PROPS, R1, R2, M1, record
from service.tests.test_forecast_information import rehash

FREEZE = '2025-12-30T12:00:00Z'
ISSUE = '2026-01-04T12:00:00Z'
SCORE = '2026-01-12T12:00:00Z'


def seal(artifact, key):
    artifact[key] = canonical_hash({k: v for k, v in artifact.items() if k != key})
    return artifact


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.ledger = ObservationVintageLedger(Path(self.temp.name).resolve(), 'policy-fixture', reserve_bytes=0)

    def capture(self, rows, at=FREEZE, props=PROPS, identity=IDENTITY):
        self.ledger.capture(identity, rows, station_time_properties=props,
                            response_hash=R1 if at == FREEZE else R2,
                            metadata_hash=M1, received_at=at)

    def snapshot(self, at, start, end, identity=IDENTITY):
        return self.ledger.as_of(identity, at, start=start, end=end)

    def history(self, end='2025-12-29', n=1460, pattern='trend'):
        last = date.fromisoformat(end)
        first = last-timedelta(days=n-1)
        rows = [record((first+timedelta(days=i)).isoformat(),
                       1000+i*2 if pattern == 'trend' else 1000+50*math.sin(i*.04), 'approved')
                for i in range(n)]
        return rows

    def freeze(self, rows=None, at=FREEZE):
        rows = rows if rows is not None else self.history()
        self.capture(rows, at)
        snap = self.snapshot(at, rows[0]['date'], rows[-1]['date'])
        policy = fp.freeze_policy(snap, expected_snapshot_hash=snap['snapshotHash'], freeze_time=at)
        return policy, snap

    def issue(self, policy, rows=None, at=ISSUE, start='2022-01-05', end='2026-01-03'):
        rows = rows if rows is not None else [record('2026-01-03', 4000, 'approved')]
        if rows:
            self.capture(rows, at)
        snap = self.snapshot(at, start, end)
        issued = fp.issue_policy(policy, snap, expected_policy_hash=policy['policyHash'],
                                 expected_snapshot_hash=snap['snapshotHash'], issue_time=at)
        return issued, snap

    def score(self, policy, issued, rows=None, at=SCORE):
        rows = rows if rows is not None else [record('2026-01-06', 4020, 'approved'),
                                              record('2026-01-10', 4030, 'approved')]
        if rows:
            self.capture(rows, at)
        snap = self.snapshot(at, '2026-01-04', '2026-01-10')
        return fp.score_issue(policy, issued, snap, expected_policy_hash=policy['policyHash'],
                              expected_issue_hash=issued['issueHash'],
                              expected_snapshot_hash=snap['snapshotHash'], score_time=at), snap

    def invalid(self, call):
        with self.assertRaises(ValueError) as error:
            call()
        self.assertEqual(str(error.exception), fp.ERROR)
        self.assertIsNone(error.exception.__cause__)

    def test_freeze_selection_baseline_radii_and_development_label(self):
        policy, snap = self.freeze()
        self.assertEqual(policy['status'], 'ready')
        self.assertEqual(policy['selectionReceipt']['methodVersion'], 'gauge-selection-calibration-holdout-v3')
        for d in policy['development']:
            self.assertEqual(d['role'], 'POLICY-DEVELOPMENT')
            self.assertTrue(d['eligible'])
            self.assertEqual(d['model'], 'local-trend')
            self.assertNotEqual(d['radii']['candidate'], d['radii']['persistence'])
            self.assertNotEqual(d['radii']['persistence'], d['radii']['seasonal-naive'])
        self.assertEqual(policy['forecastInformation']['counts']['retainedRecords'], 1460)
        self.assertEqual(policy['sourceSnapshot'], snap)
        self.assertIsNot(policy['identity'], policy['sourceSnapshot']['identity'])
        self.assertIsNot(policy['stationTime'], policy['forecastInformation']['stationTime'])

    def test_later_predictors_and_revised_truth_preserve_original_artifacts(self):
        policy, freeze_snap = self.freeze()
        frozen = canonical_json(policy)
        issued, snap = self.issue(policy)
        original = canonical_json(issued)
        self.capture([record('2026-01-03', 4500, 'approved')], '2026-01-05T12:00:00Z')
        later_snap = self.snapshot('2026-01-05T12:00:00Z', snap['start'], snap['end'])
        later = fp.issue_policy(policy, later_snap, expected_policy_hash=policy['policyHash'],
                                expected_snapshot_hash=later_snap['snapshotHash'], issue_time=later_snap['issueTime'])
        old_point = next(a for a in issued['attempts'] if a['method'] == 'persistence' and a['horizonDays'] == 3)
        new_point = next(a for a in later['attempts'] if a['method'] == 'persistence' and a['horizonDays'] == 3)
        self.assertEqual(old_point['distribution']['point'], 4000)
        self.assertEqual(new_point['distribution']['point'], 4500)
        scored, _ = self.score(policy, issued)
        revised, _ = self.score(policy, issued, [record('2026-01-06', 4100, 'approved')],
                                at='2026-01-13T12:00:00Z')
        self.assertNotEqual(scored['scoreHash'], revised['scoreHash'])
        self.assertEqual(canonical_json(policy), frozen)
        self.assertEqual(canonical_json(issued), original)
        self.assertEqual(self.snapshot(FREEZE, freeze_snap['start'], freeze_snap['end']), freeze_snap)
        self.assertEqual(self.snapshot(ISSUE, snap['start'], snap['end']), snap)

    def test_no_evaluation_or_calibration_in_issue_or_score_and_exact_denominators(self):
        policy, _ = self.freeze()
        with patch.object(fp.forecasts, 'evaluate_gauge', side_effect=AssertionError('fit forbidden')), \
             patch.object(fp.forecasts, 'calibration_radius', side_effect=AssertionError('calibrate forbidden')), \
             patch.object(fp.forecasts, '_evaluate_gauge', side_effect=AssertionError('fit forbidden')):
            issued, _ = self.issue(policy)
            scored, _ = self.score(policy, issued)
        self.assertEqual(len(issued['attempts']), 9)
        self.assertIsNot(issued['attempts'][3]['predictor']['targetInterval'],
                         issued['forecastInformation']['timingAttempts'][1]['targetInterval'])
        self.assertEqual(issued['counts'], dict(attempted=9, published=4, withheld=5, publicationRate=4/9))
        self.assertEqual(len(scored['attempts']), 9)
        self.assertEqual(issued['countScope'], 'all-method-horizon-attempts')
        self.assertEqual(scored['countScope'], 'all-method-horizon-attempts')
        self.assertEqual(issued['methodCounts']['candidate'],
                         dict(attempted=3, published=0, withheld=3, publicationRate=0))
        for method in fp.METHODS:
            counts = issued['methodCounts'][method]
            scored_counts = scored['methodCounts'][method]
            self.assertEqual(counts['attempted'], 3)
            self.assertLessEqual(counts['publicationRate'], 2/3)
            self.assertEqual(counts['published']+counts['withheld'], 3)
            self.assertEqual(scored_counts['scoreablePublished']+scored_counts['unscoreablePublished'], counts['published'])
        self.assertEqual(sum(c['published'] for c in scored['methodCounts'].values()), scored['counts']['published'])
        self.assertEqual(sum(c['outcomeAvailableAttempts'] for c in scored['methodCounts'].values()), scored['counts']['outcomeAvailableAttempts'])
        self.assertEqual(scored['counts'], dict(attempted=9, published=4, withheld=5, publicationRate=4/9,
            outcomeAvailableAttempts=6, scoreablePublished=4, unscoreablePublished=0))
        self.assertEqual(sum(c['matchedCases'] for c in scored['comparisons']), 0)  # candidate lacks last28
        persistence = next(s for s in scored['attempts'] if s['method'] == 'persistence' and s['horizonDays'] == 3)
        self.assertEqual(persistence['metrics']['absoluteError'], 20)
        self.assertEqual(persistence['metrics']['signedBias'], -20)
        self.assertEqual(persistence['metrics']['bandWidth'], 12)
        self.assertEqual(persistence['metrics']['winkler'], 292)
        self.assertFalse(persistence['metrics']['bandHit'])

    def test_candidate_gate_failure_does_not_suppress_baselines(self):
        policy, _ = self.freeze(self.history(pattern='seasonal'))
        self.assertTrue(any(not d['eligible'] for d in policy['development']))
        issued, _ = self.issue(policy)
        failed_horizons = {d['horizonDays'] for d in policy['development'] if not d['eligible']}
        for a in issued['attempts']:
            if a['horizonDays'] in failed_horizons and a['method'] == 'candidate':
                self.assertIn('candidate_development_gate_failed', a['reasons'])
        self.assertTrue(any(a['status'] == 'published' and a['method'] != 'candidate' for a in issued['attempts']))

    def test_issue_uses_separate_q_and_exact_trend_support(self):
        policy, _ = self.freeze()
        rows = [record((date(2025, 12, 30)+timedelta(days=i)).isoformat(), 3920+i*2, 'approved') for i in range(5)]
        issued, _ = self.issue(policy, rows)
        for a in issued['attempts']:
            if a['status'] == 'published':
                d = next(d for d in policy['development'] if d['horizonDays'] == a['horizonDays'])
                self.assertAlmostEqual(a['distribution']['upper']-a['distribution']['point'], d['radii'][a['method']])
                self.assertEqual(len(a['predictor']['inputVersionHashes']), 28 if a['method'] == 'candidate' else 1)
        self.assertTrue(any(a['method'] == 'candidate' and a['status'] == 'published' for a in issued['attempts']))
        scored, _ = self.score(policy, issued)
        self.assertEqual(sum(c['matchedCases'] for c in scored['comparisons']), 4)

    def test_freeze_insufficient_quality_null_gap_mixed_and_numerics(self):
        cases = [('insufficient_completed_history', self.history(n=20)),
                 ('unsupported_quality', self.history()),
                 ('discontinuous_completed_history', self.history()),
                 ('discontinuous_completed_history', self.history()),
                 ('unsupported_numerical_range', self.history())]
        for index, (reason, rows) in enumerate(cases):
            with self.subTest(reason=reason, index=index):
                self.ledger = ObservationVintageLedger(Path(self.temp.name).resolve(), 'case-'+str(index), reserve_bytes=0)
                if index == 1: rows[50]['qualifiers'] = ['A']
                if index == 2: rows.pop(50); rows.insert(0, record((date.fromisoformat(rows[0]['date'])-timedelta(days=1)).isoformat(), 10, 'approved'))
                if index == 3: rows[50]['value'] = None; rows.insert(0, record((date.fromisoformat(rows[0]['date'])-timedelta(days=1)).isoformat(), 10, 'approved'))
                if index == 4:
                    for r in rows: r['value'] = 1e308
                policy, _ = self.freeze(rows)
                self.assertEqual(policy['status'], 'withheld')
                self.assertEqual(policy['reason'], reason)
                self.assertEqual(policy['development'], [])
                issued, _ = self.issue(policy)
                self.assertEqual(issued['counts']['published'], 0)
        self.ledger = ObservationVintageLedger(Path(self.temp.name).resolve(), 'mixed', reserve_bytes=0)
        rows = self.history()
        self.capture(rows)
        self.capture([rows[50]], '2025-12-30T13:00:00Z', dict(PROPS, time_zone_abbreviation='MST'))
        snap = self.snapshot('2025-12-30T13:00:00Z', rows[0]['date'], rows[-1]['date'])
        policy = fp.freeze_policy(snap, expected_snapshot_hash=snap['snapshotHash'], freeze_time=snap['issueTime'])
        self.assertEqual(policy['reason'], 'mixed_station_metadata')

    def test_self_rehash_pins_and_nested_tamper_rejection(self):
        policy, freeze_snap = self.freeze()
        issued, snap = self.issue(policy)
        bad = copy.deepcopy(snap); bad['observations'][-1]['value'] = 9999; rehash(bad, records=True)
        self.invalid(lambda: fp.issue_policy(policy, bad, expected_policy_hash=policy['policyHash'],
                     expected_snapshot_hash=snap['snapshotHash'], issue_time=ISSUE))
        bad = copy.deepcopy(policy); bad['development'][0]['radii']['candidate'] = 7
        seal(bad, 'policyHash')
        self.invalid(lambda: fp.issue_policy(bad, snap, expected_policy_hash=policy['policyHash'],
                     expected_snapshot_hash=snap['snapshotHash'], issue_time=ISSUE))
        self.invalid(lambda: fp.issue_policy(bad, snap, expected_policy_hash=bad['policyHash'],
                     expected_snapshot_hash=snap['snapshotHash'], issue_time=ISSUE))  # receipt inconsistent
        truth = self.snapshot(SCORE, '2026-01-04', '2026-01-10')
        for mutation in (lambda a: a.update(extra=True),
                         lambda a: a['counts'].update(attempted=True),
                         lambda a: a['methodCounts']['candidate'].update(published=3),
                         lambda a: a['attempts'][4]['distribution'].update(point=300),
                         lambda a: a['attempts'][4]['timing'].update(leadStartHours=999),
                         lambda a: a['attempts'][4]['predictor'].update(radius=True),
                         lambda a: a.update(attempts=a['attempts']*1000)):
            bad = copy.deepcopy(issued); mutation(bad); seal(bad, 'issueHash')
            self.invalid(lambda: fp.score_issue(policy, bad, truth, expected_policy_hash=policy['policyHash'],
                         expected_issue_hash=bad['issueHash'], expected_snapshot_hash=truth['snapshotHash'], score_time=SCORE))
        bad = copy.deepcopy(freeze_snap); bad['observations'][0]['quality'] = 'provisional'; rehash(bad, records=True)
        self.invalid(lambda: fp.freeze_policy(bad, expected_snapshot_hash=freeze_snap['snapshotHash'], freeze_time=FREEZE))

    def test_wrong_identity_unit_metadata_boundaries_and_sanitized_inputs(self):
        policy, _ = self.freeze()
        issued, snap = self.issue(policy)
        for key, value in [('station', 'USGS-87654321'), ('timeSeriesId', 'other'), ('unit', 'm^3/s')]:
            bad = copy.deepcopy(snap)
            bad['identity'][key] = value
            for r in bad['observations']: r['identity'][key] = value
            rehash(bad, records=True)
            self.invalid(lambda: fp.issue_policy(policy, bad, expected_policy_hash=policy['policyHash'],
                         expected_snapshot_hash=bad['snapshotHash'], issue_time=ISSUE))
        bad = copy.deepcopy(snap)
        for r in bad['observations']: r['stationTimeProperties']['time_zone_abbreviation'] = 'MST'
        rehash(bad, records=True)
        self.invalid(lambda: fp.issue_policy(policy, bad, expected_policy_hash=policy['policyHash'],
                     expected_snapshot_hash=bad['snapshotHash'], issue_time=ISSUE))
        early = copy.deepcopy(policy['sourceSnapshot'])
        self.invalid(lambda: fp.issue_policy(policy, early, expected_policy_hash=policy['policyHash'],
                     expected_snapshot_hash=early['snapshotHash'], issue_time=FREEZE))
        self.invalid(lambda: fp.issue_policy(policy, snap, expected_policy_hash=policy['policyHash'],
                     expected_snapshot_hash=snap['snapshotHash'], issue_time='PRIVATE/path'))
        for value in (None, [], {}, {'private': 'data'}):
            self.invalid(lambda: fp.issue_policy(value, snap, expected_policy_hash='0'*64,
                         expected_snapshot_hash=snap['snapshotHash'], issue_time=ISSUE))
        with self.assertRaises(TypeError): fp.freeze_policy(snap, freeze_time=ISSUE)

    def test_timing_equal_target_expired_dst_year_ceiling(self):
        policy, _ = self.freeze()
        issued, _ = self.issue(policy, at='2026-01-04T08:00:00Z')
        self.assertTrue(all(a['status'] == 'withheld' for a in issued['attempts'] if a['horizonDays'] == 1))
        self.assertEqual(issued['attempts'][0]['timing']['leadStartHours'], 0)
        expired, _ = self.issue(policy, rows=[], at='2026-01-12T12:00:00Z')
        self.assertEqual(expired['counts']['published'], 0)
        self.assertTrue(all('stale_or_unresolved_observation' in a['reasons'] for a in expired['attempts']))
        self.assertEqual(expired['attempts'][3]['timing']['targetInterval']['date'], '2026-01-06')
        for day, issue, target_hours in [('2026-03-05', '2026-03-06T12:00:00Z', 23),
                                         ('2026-10-29', '2026-10-30T12:00:00Z', 25)]:
            result, _ = self.issue(policy, [record(day, 4000, 'approved')], at=issue, start=day, end=day)
            self.assertEqual(result['attempts'][3]['timing']['targetInterval']['durationHours'], target_hours)
        boundary, _ = self.issue(policy, [record('2026-12-31', 4000, 'approved')],
                                  at='2027-01-01T12:00:00Z', start='2026-12-31', end='2026-12-31')
        self.assertEqual(boundary['counts']['published'], 0)
        self.assertIsNone(boundary['attempts'][0]['timing']['targetInterval']['endUtc'])

    def test_quality_missing_null_and_later_outcome_receipts(self):
        policy, _ = self.freeze()
        issued, _ = self.issue(policy, [record('2026-01-03', 4000, 'provisional')])
        self.assertTrue(all('unsupported_predictor_quality' in a['reasons'] for a in issued['attempts'] if a['method'] == 'persistence'))
        self.assertTrue(any(a['method'] == 'seasonal-naive' and a['status'] == 'published' for a in issued['attempts']))
        score, _ = self.score(policy, issued, [])
        self.assertEqual(score['counts']['scoreablePublished'], 0)
        self.assertTrue(all(s['outcomeReason'] == 'missing_outcome' for s in score['attempts']))
        scored, _ = self.score(policy, issued, [record('2026-01-06', None, 'approved'), record('2026-01-10', 10, 'approved', qualifiers=['A'])])
        self.assertEqual(scored['attempts'][3]['outcomeReason'], 'null_withdrawal')
        self.assertEqual(scored['attempts'][6]['outcomeReason'], 'unsupported_outcome_quality')
        incomplete, _ = self.score(policy, issued, [], at='2026-01-12T13:00:00Z')
        self.assertEqual(incomplete['counts']['outcomeAvailableAttempts'], 0)

    def test_negative_bands_overflow_strict_bounds_and_detachment(self):
        policy, freeze_snap = self.freeze()
        issued, snap = self.issue(policy, [record('2026-01-03', 0, 'approved')])
        for a in issued['attempts']:
            if a['method'] == 'persistence' and a['horizonDays'] != 1:
                self.assertIn('negative_discharge_band', a['reasons'])
                self.assertIsNone(a['distribution'])
        stable = canonical_json(policy)
        freeze_snap['observations'][0]['value'] = 999
        snap['observations'][-1]['qualifiers'].append('A')
        issued['sourceSnapshot']['observations'][0]['value'] = 111
        self.assertEqual(canonical_json(policy), stable)
        huge, _ = self.issue(policy, [record('2026-01-03', 1e308, 'approved')], at='2026-01-05T12:00:00Z')
        scored, _ = self.score(policy, huge, [record('2026-01-06', 0, 'approved'), record('2026-01-10', 0, 'approved')])
        self.assertTrue(any(s['scoreReason'] == 'unsupported_score_numerical_range' for s in scored['attempts']))
        oversized = copy.deepcopy(policy)
        oversized['development'] = [['\u0800'*1024]*2000]*2
        with patch.object(fp, 'canonical_hash', side_effect=AssertionError('hash before budget rejection')):
            self.invalid(lambda: fp.issue_policy(oversized, snap, expected_policy_hash=policy['policyHash'],
                         expected_snapshot_hash=snap['snapshotHash'], issue_time=ISSUE))
        for mutation in (lambda p: p['constants'].update(maximumLagHours=True),
                         lambda p: p['development'][0].update(eligible=1),
                         lambda p: p['development'][0].update(origins=True),
                         lambda p: p['development'][0]['gates'].update(coverage=1),
                         lambda p: p['development'][0].update(extra=0),
                         lambda p: p.update(limitations=['x'*2000]*len(fp.LIMITATIONS))):
            bad = copy.deepcopy(policy); mutation(bad); seal(bad, 'policyHash')
            source = self.snapshot(ISSUE, '2026-01-03', '2026-01-03')
            self.invalid(lambda: fp.issue_policy(bad, source, expected_policy_hash=bad['policyHash'],
                         expected_snapshot_hash=source['snapshotHash'], issue_time=ISSUE))

    def test_explicit_provider_literals_maximum_history_and_missing_seasonal_support(self):
        rows = self.history(n=2000)
        for r in rows: r['quality'] = 'Approved'
        policy, _ = self.freeze(rows)
        self.assertEqual(policy['status'], 'ready')
        self.assertEqual(policy['forecastInformation']['counts']['retainedRecords'], 2000)
        issued, _ = self.issue(policy, start='2026-01-03', end='2026-01-03')
        self.assertTrue(all('missing_predictor_support' in a['reasons'] for a in issued['attempts']
                            if a['method'] == 'seasonal-naive'))
        for i, quality in enumerate(('APPROVED', 'preapproved', 'Provisional', 'approved revised')):
            issued, _ = self.issue(policy, [record('2026-01-03', 4000, quality)],
                                    at=f'2026-01-04T12:00:0{i+1}Z', start='2026-01-03', end='2026-01-03')
            self.assertTrue(all('unsupported_predictor_quality' in a['reasons'] for a in issued['attempts']
                                if a['method'] == 'persistence'))

    def test_score_boundaries_wrong_metadata_pin_and_not_later_receipt(self):
        policy, _ = self.freeze()
        # Future outcomes present at issue do not qualify as later received truth.
        issued, _ = self.issue(policy, [record('2026-01-03', 4000, 'approved'),
                                        record('2026-01-06', 4030, 'approved')], end='2026-01-06')
        self.assertEqual(issued['forecastInformation']['counts']['incompleteAtIssue'], 1)
        truth = self.snapshot(SCORE, '2026-01-04', '2026-01-10')
        score = fp.score_issue(policy, issued, truth, expected_policy_hash=policy['policyHash'],
                               expected_issue_hash=issued['issueHash'],
                               expected_snapshot_hash=truth['snapshotHash'], score_time=SCORE)
        self.assertEqual(score['attempts'][3]['outcomeReason'], 'incomplete_when_received')
        incomplete = self.snapshot('2026-01-06T12:00:00Z', '2026-01-04', '2026-01-10')
        score = fp.score_issue(policy, issued, incomplete, expected_policy_hash=policy['policyHash'],
                               expected_issue_hash=issued['issueHash'],
                               expected_snapshot_hash=incomplete['snapshotHash'], score_time=incomplete['issueTime'])
        self.assertEqual(score['attempts'][3]['outcomeReason'], 'target_incomplete_at_score')
        self.assertEqual(score['attempts'][6]['outcomeReason'], 'target_incomplete_at_score')
        self.invalid(lambda: fp.score_issue(policy, issued, truth, expected_policy_hash=policy['policyHash'],
                     expected_issue_hash=issued['issueHash'], expected_snapshot_hash=truth['snapshotHash'], score_time=ISSUE))
        wrong = copy.deepcopy(truth)
        for r in wrong['observations']: r['stationTimeProperties']['uses_daylight_savings'] = 'N'
        rehash(wrong, records=True)
        self.invalid(lambda: fp.score_issue(policy, issued, wrong, expected_policy_hash=policy['policyHash'],
                     expected_issue_hash=issued['issueHash'], expected_snapshot_hash=wrong['snapshotHash'], score_time=SCORE))
        altered = copy.deepcopy(truth); altered['observations'][0]['value'] = 50; rehash(altered, records=True)
        self.invalid(lambda: fp.score_issue(policy, issued, altered, expected_policy_hash=policy['policyHash'],
                     expected_issue_hash=issued['issueHash'], expected_snapshot_hash=truth['snapshotHash'], score_time=SCORE))
        self.invalid(lambda: fp.score_issue(policy, issued, truth, expected_policy_hash=policy['policyHash'],
                     expected_issue_hash='0'*64, expected_snapshot_hash=truth['snapshotHash'], score_time=SCORE))

    def test_predictor_overflow_negative_points_and_copy_boundary_tamper(self):
        policy, _ = self.freeze()
        rows = [record((date(2025, 12, 7)+timedelta(days=i)).isoformat(),
                       1e308 if i % 2 else 0, 'approved') for i in range(28)]
        issued, snap = self.issue(policy, rows)
        self.assertTrue(all('invalid_prediction' in a['reasons'] for a in issued['attempts']
                            if a['method'] == 'candidate'))
        negative_rows = [record((date(2025, 12, 7)+timedelta(days=i)).isoformat(),
                                max(0, 280-i*11), 'approved') for i in range(28)]
        negative, _ = self.issue(policy, negative_rows, at='2026-01-04T13:00:00Z')
        self.assertTrue(all('invalid_prediction' in a['reasons'] for a in negative['attempts']
                            if a['method'] == 'candidate'))
        original_copy = fp.deepcopy
        def mutate_artifact(value):
            copied = original_copy(value)
            if type(copied) is dict and copied.get('artifact') == 'frozen-policy':
                copied['constants']['maximumLagHours'] = 99
            return copied
        with patch.object(fp, 'deepcopy', side_effect=mutate_artifact):
            self.invalid(lambda: fp.issue_policy(policy, snap, expected_policy_hash=policy['policyHash'],
                         expected_snapshot_hash=snap['snapshotHash'], issue_time=ISSUE))

    def test_external_snapshot_bounds_precede_any_record_hashing(self):
        self.capture([record('2026-01-03', 4000, 'approved')], at=ISSUE)
        snapshot = self.snapshot(ISSUE, '2026-01-03', '2026-01-03')
        mutations = [dict(receivedAt='x' * 100000),
                     dict(sourceResponseHash='界' * 512, sourceMetadataHash='界' * 512,
                          versionHash='界' * 512)]
        for changes in mutations:
            with self.subTest(fields=list(changes)):
                bad = copy.deepcopy(snapshot)
                bad['observations'][0].update(changes)
                with patch('service.observatory.vintage_contract.canonical_hash',
                           side_effect=AssertionError('Unadmitted raw record was hashed')):
                    self.invalid(lambda: fp.freeze_policy(bad,
                        expected_snapshot_hash=snapshot['snapshotHash'], freeze_time=ISSUE))

    def test_in_progress_receipt_does_not_become_complete_without_a_revision(self):
        rows = self.history()
        self.capture(rows, at='2025-12-29T12:00:00Z')
        snap = self.snapshot(FREEZE, rows[0]['date'], rows[-1]['date'])
        withheld = fp.freeze_policy(snap, expected_snapshot_hash=snap['snapshotHash'], freeze_time=FREEZE)
        self.assertEqual(withheld['reason'], 'incomplete_when_received')
        self.capture([record('2025-12-29', rows[-1]['value']+1, 'approved')], at='2025-12-30T13:00:00Z')
        corrected = self.snapshot('2025-12-30T13:00:00Z', rows[0]['date'], rows[-1]['date'])
        policy = fp.freeze_policy(corrected, expected_snapshot_hash=corrected['snapshotHash'], freeze_time=corrected['issueTime'])
        self.assertEqual(policy['status'], 'ready')
        self.capture([record('2026-01-03', 4000, 'approved')], at='2026-01-03T12:00:00Z')
        issued, _ = self.issue(policy, rows=[])
        original = canonical_json(issued)
        self.assertTrue(all('incomplete_when_received' in a['reasons'] for a in issued['attempts'] if a['method'] == 'persistence'))
        revised, _ = self.issue(policy, [record('2026-01-03', 4001, 'approved')], at='2026-01-04T13:00:00Z')
        self.assertTrue(all(a['status'] == 'published' for a in revised['attempts']
                            if a['method'] == 'persistence' and a['horizonDays'] != 1))
        self.capture([record('2026-01-06', 4020, 'approved')], at='2026-01-06T12:00:00Z')
        partial, _ = self.score(policy, revised, rows=[], at='2026-01-07T12:00:00Z')
        self.assertEqual(partial['attempts'][4]['outcomeReason'], 'incomplete_when_received')
        completed, _ = self.score(policy, revised, [record('2026-01-06', 4021, 'approved')], at='2026-01-07T13:00:00Z')
        self.assertEqual(completed['attempts'][4]['scoreStatus'], 'scored')
        self.assertEqual(completed['attempts'][4]['outcomeValue'], 4021)
        self.assertEqual(canonical_json(issued), original)
        self.assertEqual(self.snapshot(FREEZE, snap['start'], snap['end']), snap)
        repeated = fp.freeze_policy(snap, expected_snapshot_hash=snap['snapshotHash'], freeze_time=FREEZE)
        self.assertEqual(repeated, withheld)


if __name__ == '__main__':
    unittest.main()
