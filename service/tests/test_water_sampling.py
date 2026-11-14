import copy
from datetime import datetime, timedelta, timezone
import json
import unittest
from unittest.mock import patch

from service.observatory.vintages import canonical_hash
from service.observatory.water_history import MAX_OBSERVATIONS, summarize_water_history
from service.observatory.water_sampling import VERSION, analyze_water_sampling


def observation(source, time, state='water', visibility='observable', **extra):
    return dict(siteId='synthetic-site', supportId='synthetic-fixed-support-v1',
                quantityId='synthetic-open-water-v1', classificationMethodId='synthetic-v1',
                sourceId=source, evidenceIds=['synthetic-' + source], acquisitionTime=time,
                state=state, visibility=visibility, visibilityReason='Synthetic test only', **extra)


def density():
    return [observation('water-2024', '2024-04-01T00:00:00Z')] + [
        observation(f'dry-{day:02}', f'2025-04-{day:02}T00:00:00Z', 'dry') for day in range(1, 13)]


class WaterSamplingTests(unittest.TestCase):
    def test_density_pooled_vs_equal_year_and_eight_removed(self):
        result = analyze_water_sampling(density(), months=[4], exclude=dict(
            start='2025-04-04T00:00:00Z', end='2025-04-12T00:00:00Z'))
        all_view, retained = result['views']['all'], result['views']['withoutBlock']
        self.assertEqual(all_view['pooledWaterFraction'], 1/13)
        self.assertEqual(all_view['equalYearWaterFraction'], .5)
        self.assertEqual(retained['counts'], dict(attempted=5, observable=5, water=1, dry=4, unknown=0))
        self.assertEqual(retained['pooledWaterFraction'], 1/5)
        self.assertEqual(retained['equalYearWaterFraction'], .5)
        self.assertEqual(result['exclusion']['matchedSourceIds'], [f'dry-{day:02}' for day in range(4, 12)])
        self.assertEqual(result['differences']['withoutBlockVsSeason'], dict(
            pooledWaterFractionDelta=1/5-1/13, equalYearWaterFractionDelta=0))

    def test_unknown_denominator_full_history_and_whole_year_withheld(self):
        rows = [observation('a', '2024-04-01T00:00:00Z'),
                observation('b', '2024-04-02T00:00:00Z', 'unknown'),
                observation('c', '2025-04-01T00:00:00Z', 'dry'),
                observation('d', '2025-04-02T00:00:00Z', 'unknown', 'unobservable')]
        result = analyze_water_sampling(rows, months=[4], exclude=dict(
            start='2024-04-01T00:00:00Z', end='2024-04-03T00:00:00Z'))
        self.assertEqual(result['history'], summarize_water_history(rows))
        self.assertFalse(result['history']['samplingSupport']['sensitivityEvaluated'])
        self.assertEqual(result['views']['all']['counts']['unknown'], 2)
        self.assertEqual(result['views']['all']['observableUnknown'], 1)
        self.assertEqual(result['views']['all']['pooledWaterFraction'], 1/3)
        self.assertEqual(result['views']['all']['equalYearWaterFraction'], .25)
        retained = result['views']['withoutBlock']
        self.assertEqual(retained['withheldYears'], [2024])
        self.assertIsNone(retained['equalYearWaterFraction'])
        self.assertEqual(retained['pooledWaterFraction'], 0)
        self.assertIsNone(result['differences']['withoutBlockVsSeason']['equalYearWaterFractionDelta'])

    def test_reject_adviser_unknown_denominator_counterexample(self):
        start = datetime(2024, 4, 1, tzinfo=timezone.utc)
        rows = [observation(str(i), (start+timedelta(seconds=i)).isoformat(),
                            'water' if i < 10 else 'dry' if i < 20 else 'unknown') for i in range(110)]
        view = analyze_water_sampling(rows)['views']['all']
        self.assertEqual(view['pooledWaterFraction'], 10/110)
        self.assertEqual(view['observableUnknown'], 90)
        # Same known water/dry balance, with ambiguous observations concentrated
        # in 2025: retain them in that year's denominator, too.
        split = [observation(f'2024-{i}', f'2024-04-01T00:00:{i:02}Z',
                             'water' if i < 5 else 'dry') for i in range(10)]
        start_2025 = datetime(2025, 4, 1, tzinfo=timezone.utc)
        split += [observation(f'2025-{i}', (start_2025+timedelta(seconds=i)).isoformat(),
                              'water' if i < 5 else 'dry' if i < 10 else 'unknown') for i in range(100)]
        split_view = analyze_water_sampling(split)['views']['all']
        self.assertEqual(split_view['pooledWaterFraction'], 10/110)
        self.assertEqual(split_view['equalYearWaterFraction'], .275)

    def test_fixed_missing_and_zero_observable_years_not_dropped(self):
        rows = [observation('a', '2024-04-01T00:00:00Z'),
                observation('c', '2026-04-01T00:00:00Z', 'dry')]
        for middle in ([], [observation('b', '2025-04-01T00:00:00Z', 'unknown', 'unobservable')]):
            result = analyze_water_sampling(rows[:1] + middle + rows[1:])
            self.assertEqual(result['yearPopulation'], [2024, 2025, 2026])
            for view in result['views'].values():
                self.assertEqual(view['withheldYears'], [2025])
                self.assertIsNone(view['equalYearWaterFraction'])
                self.assertEqual(view['pooledWaterFraction'], .5)
                self.assertEqual(view['yearSummaries'][1]['counts']['attempted'], len(middle))
                self.assertIsNone(view['yearSummaries'][1]['waterFraction'])
        result = analyze_water_sampling(rows, months=[5])
        self.assertEqual(result['views']['season']['withheldYears'], [2024, 2025, 2026])
        self.assertIsNone(result['views']['season']['pooledWaterFraction'])

    def test_no_record_block_changes_no_fractions_and_not_water_evidence(self):
        result = analyze_water_sampling(density(), months=[4], exclude=dict(
            start='2024-07-01T00:00:00Z', end='2024-08-01T00:00:00Z'))
        self.assertEqual(result['exclusion']['matchedSourceIds'], [])
        self.assertEqual(result['views']['season'], result['views']['withoutBlock'])
        self.assertEqual(result['differences']['withoutBlockVsSeason'], dict(
            pooledWaterFractionDelta=0, equalYearWaterFractionDelta=0))
        self.assertTrue(any('not evidence about water' in line for line in result['limitations']))

    def test_unknown_only_zero_is_not_dry_empty_unobservable(self):
        for visibility, expected in (('observable', 0), ('unobservable', None)):
            result = analyze_water_sampling([observation('x', '2024-04-01T00:00:00Z', 'unknown', visibility)])
            for view in result['views'].values():
                self.assertEqual(view['counts']['dry'], 0)
                self.assertEqual(view['pooledWaterFraction'], expected)
                self.assertEqual(view['equalYearWaterFraction'], expected)
            self.assertTrue(any('not evidence of dry' in line for line in result['limitations']))
        result = analyze_water_sampling([])
        self.assertEqual(result['yearPopulation'], [])
        for view in result['views'].values():
            self.assertEqual(view['yearSummaries'], [])
            self.assertEqual(view['withheldYears'], [])
            self.assertIsNone(view['equalYearWaterFraction'])
            self.assertIsNone(view['pooledWaterFraction'])

    def test_utc_month_year_boundaries_leap_day_half_open_and_season_match(self):
        rows = [observation('prior-year', '2024-01-01T00:00:00+01:00'),
                observation('feb', '2024-03-01T00:30:00+01:00'),
                observation('march', '2024-03-01T01:00:00+01:00', 'dry')]
        result = analyze_water_sampling(rows, months=[2], exclude=dict(
            start='2024-02-29T23:30:00Z', end='2024-03-01T01:00:00+01:00'))
        self.assertEqual(result['yearPopulation'], [2023, 2024])
        self.assertEqual(result['views']['season']['selectedSourceIds'], ['feb'])
        self.assertEqual(result['exclusion']['matchedSourceIds'], ['feb'])
        self.assertEqual(result['options']['exclude']['end'], '2024-03-01T00:00:00Z')
        march = analyze_water_sampling(rows, months=[3], exclude=dict(
            start='2024-02-29T23:30:00Z', end='2024-03-01T00:00:00Z'))
        self.assertEqual(march['exclusion']['matchedSourceIds'], [])
        self.assertEqual(march['views']['withoutBlock']['selectedSourceIds'], ['march'])

    def test_partition_year_provenance_and_input_immutability_hashes(self):
        rows, months = density(), [5, 4]
        exclude = dict(start='2025-04-04T03:30:00+03:30', end='2025-04-12T00:00:00Z')
        before = copy.deepcopy((rows, months, exclude))
        result = analyze_water_sampling(rows, months=months, exclude=exclude)
        self.assertEqual((rows, months, exclude), before)
        self.assertEqual(result['methodVersion'], VERSION)
        self.assertEqual(result['status'], 'descriptive')
        self.assertEqual(result['inputHash'], canonical_hash(result['history']['observations']))
        self.assertEqual(result['optionsHash'], canonical_hash(result['options']))
        self.assertEqual(result['options']['months'], [4, 5])
        original_ids = [row['sourceId'] for row in rows]
        for view in result['views'].values():
            a, b = view['selectedSourceIds'], view['excludedSourceIds']
            self.assertFalse(set(a) & set(b))
            self.assertEqual(set(a) | set(b), set(original_ids))
            self.assertEqual(a, [source for source in original_ids if source in a])
            self.assertEqual(b, [source for source in original_ids if source in b])
            self.assertEqual(a, [source for year in view['yearSummaries'] for source in year['sourceIds']])
        equivalent = analyze_water_sampling(rows, months=[4, 5], exclude=dict(
            start='2025-04-04T00:00:00Z', end='2025-04-12T00:00:00Z'))
        self.assertEqual(result, equivalent)
        self.assertNotEqual(result['optionsHash'], analyze_water_sampling(rows)['optionsHash'])
        self.assertEqual(json.loads(json.dumps(result, allow_nan=False)), result)
        result['history']['observations'][0]['evidenceIds'].append('output-only')
        result['options']['months'].append(6)
        self.assertEqual((rows, months, exclude), before)

    def test_options_types_and_invalid_timestamps(self):
        invalid_months = ([], (), [True], [False], [1.0], [0], [13], [1, 1], '4', {4}, 4, [None], [[4]])
        for months in invalid_months:
            with self.subTest(months=months), self.assertRaises(ValueError):
                analyze_water_sampling([], months=months)
        start, end = '2024-04-01T00:00:00Z', '2024-04-02T00:00:00Z'
        invalid_blocks = (True, [], {}, dict(start=start), dict(start=start, end=end, extra=1),
                          dict(start=end, end=start), dict(start=start, end=start))
        for exclude in invalid_blocks:
            with self.subTest(exclude=exclude), self.assertRaises(ValueError):
                analyze_water_sampling([], exclude=exclude)
        for value in ('2024-04-01', '2024-04-01T00:00Z', '2024-04-01T00:00:00',
                      '2024-04-01T00:00:00-00:00', '2023-02-29T00:00:00Z',
                      '2024-04-01T00:00:00+24:00', '2024-04-01T00:00:00+00:60',
                      '2024-04-01T00:00:00.0000001Z', '0001-01-01T00:00:00+01:00', None, True):
            with self.subTest(time=value), self.assertRaises(ValueError):
                analyze_water_sampling([], exclude=dict(start=value, end=end))

    def test_existing_strict_validation_order_compatibility_and_limits(self):
        rows = density()
        for bad in (rows[::-1], rows + [rows[-1]], [dict(rows[0], extra=True)],
                    rows[:1] + [dict(rows[1], supportId='different')],
                    [dict(rows[0], state='water', visibility='unobservable')],
                    [dict(rows[0], sourceId='bad\ncontrol')]):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                analyze_water_sampling(bad)
        admitted = [observation('a', '1900-01-01T00:00:00Z'), observation('b', '2099-12-31T00:00:00Z')]
        self.assertEqual(len(analyze_water_sampling(admitted)['yearPopulation']), 200)
        with self.assertRaises(ValueError):
            analyze_water_sampling([admitted[0], observation('b', '2100-01-01T00:00:00Z')])
        start = datetime(2024, 4, 1, tzinfo=timezone.utc)
        rows = [observation(str(i), (start+timedelta(seconds=i)).isoformat()) for i in range(MAX_OBSERVATIONS)]
        self.assertEqual(analyze_water_sampling(rows)['views']['all']['counts']['attempted'], MAX_OBSERVATIONS)
        with self.assertRaises(ValueError):
            analyze_water_sampling(rows + [observation('overflow', '2025-01-01T00:00:00Z')])
        bloated = [dict(row, evidenceIds=[f'{j:04}'+'x'*1020 for j in range(32)]) for row in rows[:40]]
        with patch('service.observatory.water_history.json.dumps', side_effect=AssertionError('Serialized before admission')):
            with self.assertRaises(ValueError):
                analyze_water_sampling(bloated)


if __name__ == '__main__':
    unittest.main()
