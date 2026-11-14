"""Reproduce research counterexamples against the current engine; no network/writes.

Run from repository root:
  PYTHONDONTWRITEBYTECODE=1 service/.venv/bin/python -B \
    docs/research/scientific-excellence-2026-10-12/experiments.py

All inputs are synthetic. These are behavior checks, NOT measured field accuracy.
"""
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
import numpy as np
from service.analysis import summarize
from service.processing import compare_arrays
from service.observatory import providers
from service.observatory.engine import _measure
from service.observatory.forecasts import evaluate_gauge
from service.observatory.history import analyze_series
from service.observatory.methods import common_difference
from service.observatory.net import ProviderError
from service.tests.test_observatory_providers import request, station, daily, QueueBudget


def run():
    result = {'scope': 'Synthetic counterexamples; not field error rates', 'seed': 20261012}
    rng = np.random.default_rng(20261012)
    radar = []
    for looks in (1, 4, 16):
        before = rng.gamma(looks, 1 / looks, (256, 256)).astype(np.float32)
        after = rng.gamma(looks, 1 / looks, (256, 256)).astype(np.float32)
        mask = np.ones(before.shape, dtype=np.uint8)
        difference, _, _, common, _, _ = compare_arrays(before, after, mask, mask)
        summary, _, _ = summarize(before, after, difference, common.astype(np.uint8), mask.astype(bool), 400, 3.)
        radar.append({'independent_gamma_looks': looks, 'pixels': before.size,
                      'fraction_exceeding_3db': (summary['increasedAreaKm2'] + summary['decreasedAreaKm2']) / summary['validAreaKm2']})
    result['radar_unchanged_mean_power'] = radar

    points = [{'date': '2024-06-01', 'value': 0., 'quality': 'fixture'}]
    points += [{'date': f'2025-06-{d:02d}', 'value': 100., 'quality': 'fixture'} for d in range(1, 13)]
    points += [{'date': '2026-06-01', 'value': 50., 'quality': 'fixture'}]
    result['unbalanced_seasonal_sampling'] = analyze_series(
        {'id': 'fixture', 'label': 'fixture', 'unit': 'index', 'evidenceIds': [], 'points': points})['seasonal']
    result['year_balanced_alternative'] = {'median': 50., 'midrank_percentile': 50.,
                                         'note': 'Alternative estimand; not universally preferable.'}

    duplicates = []
    for qualities in (['Approved', 'Provisional'], ['Provisional', 'Approved']):
        output = providers.usgs_daily(request(), QueueBudget(station(), {'features': [
            daily('2025-06-01', '100', approval_status=q) for q in qualities
        ] + [daily('2025-06-03', '300')], 'links': []}))
        duplicates.append({'order': qualities, 'retained': output['series'][0]['points'][0]})
    result['equal_value_duplicate_quality'] = duplicates

    start = date(2022, 1, 1)
    points = [{'date': (start + timedelta(days=i)).isoformat(), 'value': 100. + 2 * i,
               'quality': 'Approved'} for i in range(1460)]
    last = date.fromisoformat(points[-1]['date'])
    now = datetime.combine(last, datetime.min.time(), timezone.utc) + timedelta(hours=12)
    approved = evaluate_gauge(points, 'fixture', 'ft^3/s', now)
    provisional = evaluate_gauge([dict(p, quality='Provisional') for p in points], 'fixture', 'ft^3/s', now)
    result['forecast_quality_numerical_gate'] = {
        'approved_count': len(approved['forecasts']), 'provisional_count': len(provisional['forecasts']),
        'same_selection_hash': approved['selectionHash'] == provisional['selectionHash'],
        'same_validation': approved['validation'] == provisional['validation'],
        'note': 'Provisional values are not inherently invalid; policy and vintage handling must be explicit.'}
    late = now + timedelta(days=2)
    result['forecast_remaining_lead'] = [
        {'label_days': f['horizonDays'], 'remaining_days': (datetime.fromisoformat(f['validThrough']) - late).total_seconds() / 86400}
        for f in evaluate_gauge(points, 'fixture', 'ft^3/s', late)['forecasts']]

    mask = np.ones((10, 10), dtype=bool)
    thermal = common_difference(np.full(mask.shape, 300.), np.full(mask.shape, 302.), mask, mask, mask)
    result['thermal_shared_retrieval_offset'] = {k: thermal[k] for k in ('median', 'coveragePercent', 'p05', 'p95')}

    class Budget:
        transfer = None
        def check(self):
            pass

    def bundle(platforms):
        output = providers.bundle()
        output['candidates'] = [dict(kind='sentinel', grid='tile', version='05.11', platform=p,
            sourceId='sentinel-2-indices', date=f'2025-06-{i+1:02d}T00:00:00Z', itemId=str(i),
            evidenceId=str(i), assets={}) for i, p in enumerate(platforms)]
        output['evidence'] = [dict(id=str(i), quality={'notes': []}, title='fixture', spatialSupport={}, hashes={})
                              for i in range(len(platforms))]
        return output

    def crop():
        return dict(metrics=[dict(id='ndvi-median', label='Median NDVI', value=.5, unit='index', description='fixture')],
                    validPixels=1, totalPixels=1, coveragePercent=100, hashes={},
                    grid=dict(crs='fixture', resolution=20, transform=[0,20,0,0,0,-20], width=1, height=1),
                    _arrays={'ndvi': np.array([[.5]])}, _valid={'ndvi': np.array([[True]])}, _area=np.array([[True]]))

    output = bundle(['sentinel-2a', 'sentinel-2a', 'sentinel-2c'])
    with patch('service.observatory.raster.crop_bands', side_effect=lambda *a, **k: crop()) as mock:
        _measure(output, request('ecology', '2025-06-01', '2025-06-04'), None, Budget(), None)
        result['latest_singleton'] = {'crop_calls': mock.call_count, 'observations': output['observations']}
    output = bundle(['sentinel-2a'] * 4)
    with patch('service.observatory.raster.crop_bands', side_effect=[ProviderError('fixture_unavailable'), crop(), crop(), crop()]):
        _measure(output, request('ecology', '2025-06-01', '2025-06-04'), None, Budget(), None)
    result['failed_first_endpoint'] = {'observations': output['observations'], 'missing': output['missing']}
    return result


if __name__ == '__main__':
    print(json.dumps(run(), indent=2, allow_nan=False))
