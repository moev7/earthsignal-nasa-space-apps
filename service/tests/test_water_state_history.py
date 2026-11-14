import copy
import json
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta, timezone

from service.observatory.water_history import MAX_OBSERVATIONS, VERSION, summarize_water_history


def observation(source, time, state='water', visibility='observable', **updates):
    row = dict(sourceId=source, acquisitionTime=time, state=state, visibility=visibility,
               visibilityReason='Synthetic visible common footprint' if visibility == 'observable' else 'Synthetic cloud mask',
               evidenceIds=[f'evidence-{source}'], siteId='fixture-site', supportId='fixture-fixed-footprint-mask-v1',
               quantityId='open-water-presence', classificationMethodId='fixture-classifier-v1')
    row.update(updates)
    return row


class WaterStateHistoryTests(unittest.TestCase):
    def test_aggregate_text_admission_precedes_canonical_serialization(self):
        evidence = [str(i).ljust(1024, '🛰') for i in range(32)]
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        rows = [observation(f's{i}', (start+timedelta(minutes=i)).isoformat(),
                            evidenceIds=evidence) for i in range(64)]
        # Reused strings keep this probe small; any hashing would fail explicitly.
        with patch('service.observatory.water_history.json.dumps',
                   side_effect=AssertionError('Oversized input reached serialization')):
            with self.assertRaisesRegex(ValueError, 'aggregate text'):
                summarize_water_history(rows)

    def test_returned_observations_intervals_and_transitions_do_not_alias(self):
        result = summarize_water_history([
            observation('a', '2026-01-01T00:00:00Z'),
            observation('cloud', '2026-01-02T00:00:00Z', 'unknown', 'unobservable'),
            observation('b', '2026-01-03T00:00:00Z', 'dry')])
        interval = copy.deepcopy(result['knownEndpointIntervals'][0])
        result['observations'][0]['evidenceIds'].append('new')
        self.assertEqual(result['knownEndpointIntervals'][0], interval)
        result['intervalCensoredTransitions'][0]['left']['state'] = 'dry'
        result['intervalCensoredTransitions'][0]['interveningUnknownObservations'][0]['evidenceIds'].append('changed')
        self.assertEqual(result['knownEndpointIntervals'][0], interval)
        self.assertEqual(result['observations'][1]['evidenceIds'], ['evidence-cloud'])

    def test_control_characters_in_provenance_are_rejected(self):
        for changes in ({'siteId': 'site\n1'}, {'evidenceIds': ['ev\x001']},
                        {'visibilityReason': 'visible\x7fmask'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                summarize_water_history([observation('a', '2026-01-01T00:00:00Z', **changes)])

    def test_irregular_cadence_counts_acquisitions_without_time_weighting(self):
        rows = [observation('a', '2026-01-01T00:00:00Z'),
                observation('b', '2026-01-02T00:00:00Z'),
                observation('c', '2026-02-01T00:00:00Z', 'dry')]
        result = summarize_water_history(rows)
        self.assertEqual(result['counts'], dict(attempted=3, observable=3, water=2, dry=1, unknown=0))
        self.assertEqual(result['waterFractionAmongObservableAcquisitions'], 2/3)
        self.assertEqual([g['elapsedSeconds'] for g in result['acquisitionGaps']], [86400, 30*86400])
        self.assertEqual(result['observedTimeSpan'], dict(start=rows[0]['acquisitionTime'],
                         end=rows[-1]['acquisitionTime'], elapsedSeconds=31*86400))
        self.assertIn('unequal-acquisition-spacing', result['samplingSupport']['flags'])
        self.assertFalse(result['samplingSupport']['sensitivityEvaluated'])
        self.assertNotIn('hydroperiod', result)
        self.assertNotIn('waterDuration', result)

    def test_opposite_known_endpoints_cross_unknown_cloud_and_missing_records(self):
        rows = [observation('water', '2026-01-01T00:00:00Z'),
                observation('cloud', '2026-01-05T00:00:00Z', 'unknown', 'unobservable'),
                observation('ambiguous', '2026-01-07T00:00:00Z', 'unknown'),
                observation('dry', '2026-01-21T00:00:00Z', 'dry')]
        result = summarize_water_history(rows)
        transition, = result['intervalCensoredTransitions']
        self.assertEqual(transition['direction'], 'water-to-dry')
        self.assertEqual(transition['left']['sourceId'], 'water')
        self.assertEqual(transition['right']['acquisitionTime'], rows[-1]['acquisitionTime'])
        self.assertEqual(transition['right']['evidenceIds'], ['evidence-dry'])
        self.assertTrue(transition['leftOpen']); self.assertTrue(transition['rightClosed'])
        self.assertEqual(transition['minimumTransitions'], 1)
        self.assertTrue(transition['multipleTransitionsUnresolved'])
        self.assertEqual([r['sourceId'] for r in transition['interveningUnknownObservations']], ['cloud', 'ambiguous'])
        self.assertEqual(transition['interveningUnknownObservations'][0]['visibility'], 'unobservable')
        self.assertEqual(transition['elapsedSeconds'], 20*86400)
        self.assertEqual(result['waterFractionAmongObservableAcquisitions'], 1/3)
        self.assertEqual(result['counts']['unknown'], 2)
        self.assertEqual(len(result['acquisitionGaps']), 3)
        self.assertIn('unknown-observations', result['samplingSupport']['flags'])

    def test_equal_water_or_dry_endpoints_do_not_establish_continuity(self):
        for state in ('water', 'dry'):
            with self.subTest(state=state):
                result = summarize_water_history([
                    observation('a', '2026-01-01T00:00:00Z', state),
                    observation('gap', '2026-01-02T00:00:00Z', 'unknown', 'unobservable'),
                    observation('b', '2026-01-31T00:00:00Z', state)])
                self.assertEqual(result['intervalCensoredTransitions'], [])
                interval, = result['knownEndpointIntervals']
                self.assertEqual(interval['endpointRelation'], 'same')
                self.assertEqual(interval['minimumTransitions'], 0)
                self.assertFalse(interval['continuityEstablished'])
                self.assertTrue(interval['multipleTransitionsUnresolved'])
                self.assertEqual(len(interval['interveningUnknownObservations']), 1)

    def test_direct_opposite_endpoints_and_several_transitions_remain_intervals(self):
        result = summarize_water_history([
            observation('a', '2026-01-01T00:00:00Z', 'dry'),
            observation('b', '2026-01-02T00:00:00Z', 'water'),
            observation('c', '2026-01-03T00:00:00Z', 'dry')])
        self.assertEqual([t['direction'] for t in result['intervalCensoredTransitions']], ['dry-to-water', 'water-to-dry'])
        self.assertTrue(all(t['multipleTransitionsUnresolved'] for t in result['intervalCensoredTransitions']))
        self.assertEqual(result['intervalCensoredTransitions'][0]['interveningUnknownObservations'], [])

    def test_all_unobservable_unknown_and_empty_support_are_explicit(self):
        for rows in ([], [observation('a', '2026-01-01T00:00:00Z', 'unknown', 'unobservable'),
                         observation('b', '2026-01-02T00:00:00Z', 'unknown', 'unobservable')]):
            with self.subTest(count=len(rows)):
                result = summarize_water_history(rows)
                self.assertIsNone(result['waterFractionAmongObservableAcquisitions'])
                self.assertEqual(result['counts']['unknown'], len(rows))
                self.assertEqual(result['counts']['attempted'], len(rows))
                self.assertEqual(result['knownEndpointIntervals'], [])
                self.assertEqual(result['intervalCensoredTransitions'], [])
                support = result['samplingSupport']
                self.assertEqual(support['knownAcquisitions'], 0)
                self.assertIsNone(support['knownTimeSpan']); self.assertIsNone(support['observableTimeSpan'])
                self.assertIsNone(support['leadingUnknownAcquisitions'])
                self.assertIsNone(support['trailingUnknownAcquisitions'])
                self.assertEqual(result['identity'] is None, not rows)
                self.assertEqual(result['observedTimeSpan'] is None, not rows)
                self.assertEqual(json.loads(json.dumps(result, allow_nan=False)), result)

    def test_observable_unknown_is_not_promoted_to_known_or_dropped_from_denominator(self):
        result = summarize_water_history([observation('a', '2026-01-01T00:00:00Z', 'unknown')])
        self.assertEqual(result['waterFractionAmongObservableAcquisitions'], 0)
        self.assertEqual(result['counts'], dict(attempted=1, observable=1, water=0, dry=0, unknown=1))
        self.assertEqual(result['observations'][0]['state'], 'unknown')
        self.assertIsNone(result['samplingSupport']['knownTimeSpan'])

    def test_singleton_and_leading_trailing_unknowns_have_no_added_dates(self):
        row = observation('known', '2026-01-10T12:30:00Z')
        result = summarize_water_history([row])
        self.assertEqual(result['observedTimeSpan'], dict(start=row['acquisitionTime'], end=row['acquisitionTime'], elapsedSeconds=0))
        self.assertEqual(result['acquisitionGaps'], [])
        self.assertEqual(result['intervalCensoredTransitions'], [])
        self.assertEqual(result['samplingSupport']['knownAcquisitions'], 1)
        self.assertIn('fewer-than-two-known-acquisitions', result['samplingSupport']['flags'])
        result = summarize_water_history([
            observation('a', '2026-01-01T00:00:00Z', 'unknown', 'unobservable'), row,
            observation('b', '2026-01-31T00:00:00Z', 'unknown', 'unobservable')])
        self.assertEqual(result['samplingSupport']['leadingUnknownAcquisitions'], 1)
        self.assertEqual(result['samplingSupport']['trailingUnknownAcquisitions'], 1)
        self.assertEqual(result['samplingSupport']['knownTimeSpan']['elapsedSeconds'], 0)

    def test_duplicate_sources_instants_and_permuted_input_are_rejected(self):
        a = observation('a', '2026-01-01T00:00:00Z')
        b = observation('b', '2026-01-02T00:00:00Z', 'dry')
        for rows in ([a, a], [b, a], [a, dict(b, sourceId='a')],
                     [a, dict(b, acquisitionTime=a['acquisitionTime'])],
                     [a, dict(b, acquisitionTime='2026-01-01T03:30:00+03:30')]):
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                summarize_water_history(rows)

    def test_utc_ordering_canonicalization_and_hash_stability(self):
        rows = [observation('a', '2026-01-02T01:00:00+03:30'),
                observation('b', '2026-01-01T23:00:00Z', 'dry')]
        before = copy.deepcopy(rows)
        result = summarize_water_history(rows)
        self.assertEqual(result['observations'][0]['acquisitionTime'], '2026-01-01T21:30:00Z')
        self.assertEqual(result['acquisitionGaps'][0]['elapsedSeconds'], 5400)
        canonical = copy.deepcopy(rows); canonical[0]['acquisitionTime'] = '2026-01-01T21:30:00.000000Z'
        self.assertEqual(result, summarize_water_history(canonical))
        self.assertEqual(rows, before)
        result['observations'][0]['evidenceIds'].append('output-only')
        self.assertEqual(rows, before)
        self.assertEqual(summarize_water_history(rows), summarize_water_history(tuple(copy.deepcopy(rows))))
        rows[0]['evidenceIds'] = ['z', 'a']
        h = summarize_water_history(rows)['inputHash']
        rows[0] = dict(reversed(list(rows[0].items())))
        rows[0]['evidenceIds'].reverse()
        self.assertEqual(h, summarize_water_history(rows)['inputHash'])
        rows[0]['visibilityReason'] = 'Different recorded evidence rationale'
        self.assertNotEqual(h, summarize_water_history(rows)['inputHash'])

    def test_mismatched_compatibility_identity_is_rejected(self):
        for key in ('siteId', 'supportId', 'quantityId', 'classificationMethodId'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                summarize_water_history([observation('a', '2026-01-01T00:00:00Z'),
                                         observation('b', '2026-01-02T00:00:00Z', **{key: 'different'})])

    def test_invalid_visibility_states_provenance_and_schema_are_rejected(self):
        row = observation('a', '2026-01-01T00:00:00Z')
        invalid = [dict(row, visibility='unobservable'), dict(row, visibility=True),
                   dict(row, state='wet'), dict(row, state=None), dict(row, state=['water']),
                   dict(row, evidenceIds=[]), dict(row, evidenceIds=['e', 'e']),
                   dict(row, evidenceIds=['e']*33), dict(row, evidenceIds=[float('nan')]),
                   dict(row, sourceId=' '), dict(row, supportId=''), dict(row, visibilityReason=''),
                   dict(row, siteId=' padded'), dict(row, quantityId='x'*1025),
                   dict(row, reviewedTruth=True), {k: v for k, v in row.items() if k != 'evidenceIds'}]
        for candidate in invalid:
            with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                summarize_water_history([candidate])
        for collection in (None, {}, 'records', iter([row]), [None]):
            with self.subTest(collection=collection), self.assertRaises(ValueError):
                summarize_water_history(collection)

    def test_invalid_naive_date_only_unknown_offset_and_overprecision_times_are_rejected(self):
        for time in ('2026-01-01', '2026-01-01T00:00:00', '2026-02-30T00:00:00Z',
                     '2026-01-01T00:00:00-00:00', '2026-01-01T00:00:00+00:99',
                     '2026-01-01T00:00:00+24:00', '2026-01-01T00:00:00.0000001Z',
                     '0001-01-01T00:00:00+01:00', None, float('inf')):
            with self.subTest(time=time), self.assertRaises(ValueError):
                summarize_water_history([observation('a', time)])

    def test_exact_bound_is_serializable_and_over_bound_is_rejected(self):
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        rows = [observation(f's{i}', (start+timedelta(minutes=i)).isoformat(), 'water' if i%2 else 'dry')
                for i in range(MAX_OBSERVATIONS)]
        result = summarize_water_history(rows)
        self.assertEqual(result['counts']['attempted'], MAX_OBSERVATIONS)
        self.assertEqual(len(result['intervalCensoredTransitions']), MAX_OBSERVATIONS-1)
        self.assertEqual(result['methodVersion'], VERSION)
        self.assertRegex(result['inputHash'], r'^[0-9a-f]{64}$')
        self.assertEqual(json.loads(json.dumps(result, allow_nan=False)), result)
        with self.assertRaises(ValueError):
            summarize_water_history(rows + [observation('too-many', '2027-01-01T00:00:00Z')])


if __name__ == '__main__':
    unittest.main()
