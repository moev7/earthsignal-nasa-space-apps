"""Network-free E1 recovery checks; these do not measure field accuracy."""
import gc
import hashlib
import itertools
import json
import unittest
import weakref
from copy import deepcopy
from unittest.mock import patch

import numpy as np

from service.observatory import providers as p
from service.observatory.engine import _measure
from service.observatory.methods import array_hash
from service.observatory.net import Budget, ProviderError, Transfer
from service.observatory.raster import compare_crops
from service.observatory.selection import compatible_groups
from service.range_reader import RangeError
from service.tests.test_observatory_providers import request


class NoNetworkBudget:
    def __init__(self):
        self.transfer = object()
        self.checks = 0

    def check(self):
        self.checks += 1


def candidate(day, *, item=None, **overrides):
    item = item or 'item-'+str(day)
    return dict(dict(kind='sentinel', grid='tile', version='05.11',
        platform='sentinel-2a', sourceId='sentinel-2-indices',
        date=f'2025-06-{day:02d}T12:00:00Z', itemId=item,
        evidenceId='e-'+hashlib.sha256(item.encode()).hexdigest()[:24],
        assets={'fixture': item}), **overrides)


def bundle(candidates):
    out = p.bundle()
    out['candidates'] = deepcopy(candidates)
    for c in candidates:
        transfer = Transfer(b'', 'https://earth-search.aws.element84.com/v1/search',
            hashlib.sha256(c['itemId'].encode()).hexdigest(), '2025-07-01T00:00:00Z')
        e = p.evidence(c.get('sourceId') or 'sentinel-2-indices', 'fixture:05.11',
            c['itemId'], transfer, start=c.get('date'), end=c.get('date'))
        e['id'] = c['evidenceId']
        out['evidence'].append(e)
    return out


def crop(value=.5, *, valid=None, values=None, grid=None, names=('ndvi',)):
    valid = np.ones((2, 2), dtype=bool) if valid is None else np.array(valid, dtype=bool)
    array = np.full(valid.shape, value) if values is None else np.array(values, dtype=float)
    count = int(valid.sum())
    grid = grid or dict(crs='EPSG:32611', resolution=20,
        transform=[500000, 20, 0, 4000000, 0, -20], width=2, height=2,
        aggregation={'nir': 1}, aoiPolicy='Exact selected pixel centres')
    metrics = [p.metric(name+'-median', 'Median '+name.upper(),
        float(np.median(array[valid])) if count else None, 'index', [],
        'Synthetic acquisition metric', 'Selected valid pixels') for name in names]
    return dict(metrics=metrics, validPixels=count, totalPixels=4,
        coveragePercent=25*count,
        hashes={'mask': hashlib.sha256(valid.tobytes()).hexdigest(),
                'values': hashlib.sha256(array.tobytes()).hexdigest()},
        grid=grid, maskPolicy='Synthetic QA and area',
        _arrays={name: array.copy() for name in names},
        _valid={name: valid.copy() for name in names},
        _area=np.ones(valid.shape, dtype=bool))


class EvidenceRecoveryTests(unittest.TestCase):
    def measure(self, candidates, effects=None, *, budget=None, output=None):
        out = bundle(candidates)
        effects = effects if effects is not None else lambda *a, **k: crop()
        with patch('service.observatory.raster.crop_bands', side_effect=effects) as reads, \
             patch('service.observatory.raster.compare_crops', wraps=compare_crops) as compares, \
             patch('service.observatory.views.export_comparison', return_value=[]) as exports:
            _measure(out, request('ecology', '2025-06-01', '2025-06-30'),
                     None, budget or NoNetworkBudget(), output)
        return out, reads, compares, exports

    def comparison(self, out):
        return next(e for e in out['evidence'] if e['title'].startswith('Common-valid comparison:'))

    def test_older_pair_beats_newest_incompatible_singleton(self):
        candidates = [candidate(1), candidate(2), candidate(9, platform='sentinel-2c')]
        out, reads, compares, _ = self.measure(candidates)
        self.assertEqual([c.args[0]['fixture'] for c in reads.call_args_list], ['item-1', 'item-2'])
        self.assertEqual(compares.call_count, 1)
        self.assertEqual(self.comparison(out)['timestamps']['observedEnd'], candidates[1]['date'])
        self.assertIn('omitted 1', ' '.join(out['missing']))
        notes = ' '.join(note for e in out['evidence'] for note in e['quality']['notes'])
        self.assertIn('Multi-date groups precede newer singletons', notes)

    def test_failed_first_final_or_both_compare_actual_successful_dates(self):
        for failures, expected in (({1}, (2, 4)), ({4}, (1, 3)), ({1, 4}, (2, 3))):
            with self.subTest(failures=failures):
                effects = [ProviderError('access_gate') if day in failures else crop(day/10)
                           for day in range(1, 5)]
                out, reads, compares, exports = self.measure(
                    [candidate(i) for i in range(1, 5)], effects, output='unused')
                self.assertEqual(reads.call_count, 4)
                self.assertEqual(compares.call_count, 1)
                e = self.comparison(out)
                self.assertEqual(e['timestamps']['observedStart'], candidate(expected[0])['date'])
                self.assertEqual(e['timestamps']['observedEnd'], candidate(expected[1])['date'])
                self.assertEqual(exports.call_args.args[2]['date'], e['timestamps']['observedStart'])
                self.assertEqual(exports.call_args.args[3]['date'], e['timestamps']['observedEnd'])
                for day in failures:
                    self.assertIn(f'2025-06-{day:02d}', ' '.join(out['missing']))
                    self.assertEqual(out['series'][0]['points'][day-1]['quality'], 'crop unavailable')
                self.assertAlmostEqual(next(m for m in out['metrics'] if m['id']=='ndvi-difference')['value'],
                    (expected[1]-expected[0])/10)

    def test_every_compatibility_dimension_isolates_groups(self):
        for field, value in [('kind', 'hls'), ('grid', 'other-tile'),
                             ('version', 'other-release'), ('platform', 'sentinel-2c'),
                             ('sourceId', 'hls-ndvi-ndmi')]:
            with self.subTest(field=field):
                out, _, compares, _ = self.measure([candidate(1), candidate(2, **{field: value})])
                compares.assert_not_called()
                self.assertEqual(out['observations'], 8)
                self.assertEqual(len(out['series']), 2)
                for series in out['series']:
                    self.assertEqual(sum(point['value'] is not None for point in series['points']), 1)
                    self.assertEqual(len(series['evidenceIds']), 1)
                self.assertIn('temporal change withheld', ' '.join(out['missing']))

    def test_candidate_permutations_and_same_day_ties_are_deterministic(self):
        candidates = [candidate(1, item='a'), candidate(1, item='z'),
                      candidate(1, item='early', date='2025-06-01T01:00:00Z'), candidate(2)]
        expected = None
        for order in itertools.permutations(candidates):
            out, reads, _, _ = self.measure(order)
            selected = [c.args[0]['fixture'] for c in reads.call_args_list]
            self.assertEqual(selected, ['z', 'item-2'])
            evidence = self.comparison(out)
            actual = (out['metrics'], out['series'], evidence['timestamps'], evidence['hashes'], out['missing'])
            if expected is None: expected = actual
            self.assertEqual(actual, expected)
        self.assertIn('same-day duplicate', ' '.join(out['missing']))

    def test_identical_time_and_item_uses_evidence_identity_under_permutation(self):
        a = candidate(1, item='same', evidenceId='e-a')
        b = candidate(1, item='same', evidenceId='e-b')
        for order in ([a, b, candidate(2)], [b, a, candidate(2)]):
            groups, omissions = compatible_groups(order, bundle(order)['evidence'],
                request('ecology', '2025-06-01', '2025-06-30'))
            self.assertEqual(groups[0]['records'][0]['evidenceId'], 'e-b')
            self.assertEqual(omissions['duplicates'], 1)

    def test_missing_essential_metadata_is_withheld_and_source_resolves_from_evidence(self):
        for field in ('grid', 'version', 'platform', 'kind'):
            for bad in (None, '', 'unknown'):
                with self.subTest(field=field, bad=bad):
                    c = candidate(1, **{field: bad})
                    out, reads, compares, _ = self.measure([c])
                    reads.assert_not_called(); compares.assert_not_called()
                    self.assertIn('essential compatibility', ' '.join(out['missing']))
        a, b = candidate(1), candidate(2)
        del a['sourceId']; del b['sourceId']
        out, reads, compares, _ = self.measure([a, b])
        self.assertEqual(reads.call_count, 2); self.assertEqual(compares.call_count, 1)
        self.assertEqual(out['evidence'][-1]['sourceId'], 'sentinel-2-indices')
        data = bundle([candidate(1), candidate(2)])
        del data['evidence'][0]['sourceId']; del data['evidence'][1]['sourceId']
        for c in data['candidates']: del c['sourceId']
        groups, omissions = compatible_groups(data['candidates'], data['evidence'],
            request('ecology', '2025-06-01', '2025-06-30'))
        self.assertEqual(groups, []); self.assertEqual(omissions['rejected'], 2)

    def test_contradictory_source_id_and_invalid_dates_withheld(self):
        for changes in ({'sourceId': 'other-source'}, {'date': 'not-a-date'},
                        {'date': '2025-06-01T12:00:00'}, {'date': '2025-07-01T12:00:00Z'},
                        {'date': '2025-06-01T23:00:00-05:00'}):
            with self.subTest(changes=changes):
                data = bundle([candidate(1)])
                data['candidates'][0].update(changes)
                groups, omissions = compatible_groups(data['candidates'], data['evidence'],
                    request('ecology', '2025-06-01', '2025-06-30'))
                self.assertFalse(groups); self.assertEqual(omissions['rejected'], 1)

    def test_all_failed_and_one_success_remain_missing_not_zero_change(self):
        for successful in (None, 2):
            effects = [crop(.2) if i==successful else ProviderError('access_gate') for i in range(1, 5)]
            out, reads, compares, exports = self.measure([candidate(i) for i in range(1, 5)], effects)
            self.assertEqual(reads.call_count, 4); compares.assert_not_called(); exports.assert_not_called()
            self.assertEqual(out['observations'], 0 if successful is None else 4)
            self.assertFalse(any(m['id']=='ndvi-difference' for m in out['metrics']))
            if successful is None:
                self.assertFalse(out['metrics']); self.assertFalse(out['series'])
            else:
                points = out['series'][0]['points']
                self.assertEqual(points[1]['value'], .2)
                self.assertTrue(all(p['value'] is None for i, p in enumerate(points) if i!=1))
                self.assertIn('single-acquisition summaries retained', ' '.join(out['missing']))

    def test_singleton_is_still_measured(self):
        out, reads, compares, _ = self.measure([candidate(7)])
        self.assertEqual(reads.call_count, 1); compares.assert_not_called()
        self.assertEqual(out['series'][0]['points'][6]['value'], .5)
        self.assertEqual(out['observations'], 4)

    def test_at_most_four_reads_first_two_last_two_and_no_budget_reset(self):
        budget = NoNetworkBudget()
        out, reads, compares, _ = self.measure([candidate(i) for i in range(1, 9)], budget=budget)
        self.assertEqual(reads.call_count, 4)
        self.assertEqual([call.args[0]['fixture'] for call in reads.call_args_list],
                         ['item-1', 'item-2', 'item-7', 'item-8'])
        self.assertTrue(all(call.args[3] is budget.transfer for call in reads.call_args_list))
        self.assertEqual(budget.checks, 5)
        self.assertEqual(out['observations'], 16)
        self.assertIn('omitted 4', ' '.join(out['missing']))

    def test_cumulative_transfer_limit_stops_remaining_attempts(self):
        budget = Budget(transfer_bytes=8)
        def read(*args, **kwargs):
            self.assertIs(args[3], budget.transfer)
            budget.transfer.reserve(8); budget.transfer.settle(8, 8)
            return crop()
        out, reads, compares, _ = self.measure([candidate(i) for i in range(1, 5)], read, budget=budget)
        self.assertEqual(reads.call_count, 1); self.assertEqual(budget.used, 8)
        compares.assert_not_called()
        self.assertIn('transfer_budget_exceeded', ' '.join(out['missing']))
        self.assertEqual(out['observations'], 4)

    def test_expired_runtime_prevents_any_read(self):
        budget = Budget(wall_seconds=0)
        out, reads, compares, _ = self.measure([candidate(1), candidate(2)], budget=budget)
        reads.assert_not_called(); compares.assert_not_called()
        self.assertIn('time_budget_exceeded', ' '.join(out['missing']))

    def test_fallback_pair_uses_remaining_slots_without_mixing_successes(self):
        # Newer preferred group: one success. Older fallback: two successes.
        newer = [candidate(i, item='new-'+str(i), grid='new') for i in range(10, 15)]
        older = [candidate(i, item='old-'+str(i), grid='old') for i in (1, 2)]
        effects = [crop(.9), ProviderError('access_gate'), crop(.1), crop(.3)]
        out, reads, compares, exports = self.measure(newer+older, effects, output='unused')
        self.assertEqual([call.args[0]['fixture'] for call in reads.call_args_list],
            ['new-10', 'new-11', 'old-1', 'old-2'])
        self.assertEqual(compares.call_count, 1)
        self.assertEqual(self.comparison(out)['timestamps']['observedStart'], older[0]['date'])
        self.assertEqual(self.comparison(out)['timestamps']['observedEnd'], older[1]['date'])
        self.assertAlmostEqual(next(m for m in out['metrics'] if m['id']=='ndvi-difference')['value'], .2)
        self.assertEqual(len(out['series']), 2)
        self.assertEqual(sorted(sum(pt['value'] is not None for pt in s['points']) for s in out['series']), [1, 2])
        self.assertEqual(exports.call_args.args[2]['date'], older[0]['date'])
        self.assertIn('fallback pair', ' '.join(out['missing']))

    def test_fallback_partial_success_never_compared_to_preferred_success(self):
        candidates = [candidate(10), candidate(11), candidate(1, grid='other'), candidate(2, grid='other')]
        effects = [crop(.9), ProviderError('access_gate'), crop(.1), ProviderError('access_gate')]
        out, reads, compares, _ = self.measure(candidates, effects)
        self.assertEqual(reads.call_count, 4); compares.assert_not_called()
        self.assertEqual(len(out['series']), 2)
        self.assertFalse(any(m['id']=='ndvi-difference' for m in out['metrics']))

    def test_first_and_latest_arrays_retained_but_intermediate_arrays_released(self):
        references = []
        retained_at_read = []
        def read(*args, **kwargs):
            gc.collect()
            retained_at_read.append([i+1 for i, ref in enumerate(references) if ref() is not None])
            result = crop((len(references)+1)/10)
            references.append(weakref.ref(result['_arrays']['ndvi']))
            return result
        out, _, compares, _ = self.measure([candidate(i) for i in range(1, 5)], read)
        self.assertEqual(retained_at_read, [[], [1], [1, 2], [1, 3]])
        before, after, _ = compares.call_args.args
        self.assertAlmostEqual(before['_arrays']['ndvi'][0, 0], .1)
        self.assertAlmostEqual(after['_arrays']['ndvi'][0, 0], .4)
        self.assertFalse(any(ref() is not None for ref in references[1:3]))
        self.assertNotIn('_arrays', json.dumps(out['evidence']))
        self.assertEqual(len([m for m in out['metrics'] if 'median' in m['id']]), 4)

    def test_real_comparison_uses_same_grid_common_mask_and_preserves_metric_ids(self):
        before = crop(valid=[[1,1],[0,0]], values=[[0,.1],[.8,.8]])
        after = crop(valid=[[0,1],[1,0]], values=[[.8,.12],[.2,.8]])
        original_metrics = deepcopy([before['metrics'], after['metrics']])
        out, _, compares, exports = self.measure([candidate(1), candidate(2)], [before, after], output='unused')
        metric = next(m for m in out['metrics'] if m['id']=='ndvi-difference')
        self.assertAlmostEqual(metric['value'], .02)
        self.assertNotAlmostEqual(metric['value'], .16-.05)
        e = self.comparison(out)
        self.assertEqual(e['quality']['commonCoveragePercent'], 25)
        self.assertEqual(e['hashes']['ndviCommonMask'],
            array_hash(np.array([[0,1],[0,0]],dtype=np.uint8)))
        self.assertEqual([before['metrics'], after['metrics']], original_metrics)
        series = out['series'][0]
        self.assertEqual(series['id'], 'crop-ndvi-median')
        self.assertAlmostEqual(series['points'][0]['value'], .05)
        self.assertAlmostEqual(series['points'][1]['value'], .16)
        self.assertTrue(all(point['value'] is None for point in series['points'][2:]))
        self.assertEqual(compares.call_args.args[:2], (before, after))
        self.assertEqual(set(exports.call_args.args[0]['_arrays']), {'ndvi'})

    def test_actual_grid_mismatch_and_empty_common_mask_withhold_comparison(self):
        before = crop(valid=[[1,0],[0,0]])
        for after in (crop(grid=dict(before['grid'], transform=[500020,20,0,4000000,0,-20])),
                      crop(valid=[[0,0],[0,1]])):
            with self.subTest(after=after['grid']):
                out, _, _, exports = self.measure([candidate(1), candidate(2)], [before, after], output='unused')
                exports.assert_not_called()
                self.assertFalse(any(m['id']=='ndvi-difference' for m in out['metrics']))
                self.assertIn('Endpoint comparison:', ' '.join(out['missing']))
                self.assertEqual(len(out['series']), 1)

    def test_export_receives_at_most_two_views_without_mutating_crops(self):
        names = ('ndvi', 'ndmi', 'extra')
        before, after = crop(.1, names=names), crop(.2, names=names)
        out, _, _, exports = self.measure([candidate(1), candidate(2)], [before, after], output='unused')
        self.assertEqual(len(exports.call_args.args[0]['_arrays']), 2)
        self.assertEqual(set(before['_arrays']), set(names))
        self.assertEqual(set(after['_arrays']), set(names))
        self.assertEqual(len(out['metrics']), 9)

    def test_sanitized_crop_signer_comparison_and_export_failures(self):
        secret = 'AuthorizationSECRET0123456789'
        hostile = ProviderError(secret)
        out, _, _, _ = self.measure([candidate(1)], [hostile])
        self.assertNotIn(secret, json.dumps(out)); self.assertIn('crop_unavailable', ' '.join(out['missing']))
        data = bundle([candidate(1, signer='planetary')])
        with patch('service.observatory.planetary.sign_assets', side_effect=hostile), \
             patch('service.observatory.raster.crop_bands') as reads:
            _measure(data, request('ecology', '2025-06-01', '2025-06-30'), None, NoNetworkBudget(), None)
        reads.assert_not_called(); self.assertNotIn(secret, json.dumps(data))
        for target, expected in [('compare_crops', 'common_comparison_unavailable'),
                                 ('export_comparison', 'export_unavailable')]:
            data = bundle([candidate(1), candidate(2)])
            module = 'raster' if target=='compare_crops' else 'views'
            with patch('service.observatory.raster.crop_bands', side_effect=[crop(.1), crop(.3)]), \
                 patch(f'service.observatory.{module}.{target}', side_effect=RangeError(secret, 'https://signed.invalid/?token='+secret)):
                _measure(data, request('ecology', '2025-06-01', '2025-06-30'), None, NoNetworkBudget(), 'unused')
            self.assertNotIn(secret, json.dumps(data)); self.assertNotIn('signed.invalid', json.dumps(data))
            self.assertIn(expected, ' '.join(data['missing']))
            if target=='export_comparison':
                self.assertTrue(any(m['id']=='ndvi-difference' for m in data['metrics']))
                self.assertFalse(data['rasters'])


if __name__ == '__main__':
    unittest.main()
