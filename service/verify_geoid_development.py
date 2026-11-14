"""Reproduce the frozen GEOID crop without network, rasterio or original files.

This verifies an inspected development export, not source radiometry, independent
reference accuracy, a flood classifier or transfer to another radar sensor.
"""
import hashlib
import io
import json
from pathlib import Path
import zipfile

import numpy as np

from service.benchmarks.geoid_sample import PLAN_SHA256, summarize_arrays

ROOT = Path(__file__).resolve().parents[1] / 'examples/geoid-development'
ARCHIVE_SHA256 = '73661a1b15b7d34fc58dee68810a270607cfa7e673f2452d2e3b173b27877074'
ACQUISITION_SHA256 = '1cd68fa239a88807494939692d7692aaa93f3f799965b9444b873738cb08d260'
RESULT_SHA256 = '08bfac1d07867cfbc94c0b1e7f3c694aaf05b3eb146fe87bad8cb81d8409be16'
ROLES = ('before', 'after', 'label', 'validity')


def _pinned(path, sha256, limit):
    if path.is_symlink() or not path.is_file():
        raise ValueError('Pinned regular development artifact required')
    with path.open('rb') as source:
        raw = source.read(limit + 1)
    if len(raw) > limit or hashlib.sha256(raw).hexdigest() != sha256:
        raise ValueError('Development artifact identity mismatch')
    return raw


def _same_summary(actual, expected):
    if isinstance(expected, dict):
        return (isinstance(actual, dict) and actual.keys() == expected.keys()
                and all(_same_summary(actual[k], v) for k, v in expected.items()))
    if isinstance(expected, float):
        return (isinstance(actual, float) and np.isfinite(actual)
                and bool(np.isclose(actual, expected, rtol=0, atol=1e-12)))
    return type(actual) is type(expected) and actual == expected


def verify(root=ROOT):
    root = Path(root)
    plan = json.loads(_pinned(root / 'selection-plan.json', PLAN_SHA256, 32768))
    acquisition = json.loads(_pinned(root / 'acquisition-receipt.json', ACQUISITION_SHA256, 32768))
    archive = _pinned(root / 'inputs.npz', ARCHIVE_SHA256, 2 * 1024**2)
    saved = json.loads(_pinned(root / 'result.json', RESULT_SHA256, 32768))
    expected = {role + suffix for role in ROLES for suffix in ('', '_native_mask')}
    # Bound uncompressed input as well as compressed bytes; object arrays never load.
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        entries = zipped.infolist()
        if (len(entries) != 8 or {x.filename for x in entries} != {k + '.npy' for k in expected}
                or sum(x.file_size for x in entries) > 2 * 1024**2):
            raise ValueError('Unexpected crop archive structure')
    with np.load(io.BytesIO(archive), allow_pickle=False) as source:
        arrays = {k: source[k].copy() for k in expected}
    for role in ROLES:
        shape = (2, 256, 256) if role in ('before', 'after') else (1, 256, 256)
        dtype = np.float32 if role in ('before', 'after') else np.uint8
        for key, dt in ((role, dtype), (role + '_native_mask', np.bool_)):
            array = arrays[key]
            pin = acquisition['cropArchiveContents'][key]
            if (array.shape != shape or array.dtype != dt or pin['shape'] != list(array.shape)
                    or pin['dtype'] != str(array.dtype)
                    or pin['sha256COrderBytes'] != hashlib.sha256(array.tobytes(order='C')).hexdigest()):
                raise ValueError('Crop array identity or definition mismatch')
    masks = {role: arrays[role + '_native_mask'].astype(np.uint8) * 255 for role in ROLES}
    for role in ('label', 'validity'):
        masks[role] = masks[role][0]
    summary = summarize_arrays(arrays['before'], arrays['after'], arrays['label'][0],
                               arrays['validity'][0], masks)
    if not _same_summary(summary, saved['summary']):
        raise ValueError('Saved result no longer reconciles with the source crop')
    # A second direct population/count oracle is intentionally independent of
    # summarize_arrays and reconciles the frozen observed subset.
    a, b = arrays['before'], arrays['after']
    label, validity = arrays['label'][0], arrays['validity'][0]
    population = (label < 3) & (validity == 1)
    for role in ROLES:
        population &= arrays[role + '_native_mask'].all(axis=0)
    for power in (a, b):
        population &= (np.isfinite(power) & (power > 0) & (power <= 1000)).all(axis=0)
    if (int(population.sum()) != 7935 or summary['common']['commonPixels'] != 7935
            or sum(x['commonPixels'] for x in summary['byClass'].values()) != 7935
            or int((label == 255).sum()) != 57600 or int((validity == 1).sum()) != 7936
            or summary['overlappingExclusions']['excludedUnionPixels'] != 57601):
        raise ValueError('Frozen population reconciliation failed')
    for role, power in (('before', a), ('after', b)):
        for i, band in enumerate(('VV', 'VH')):
            direct = np.quantile(10 * np.log10(power[i][population].astype(np.float64)),
                                 [.05, .25, .5, .75, .95], method='linear')
            for j, q in enumerate(('p05', 'p25', 'p50', 'p75', 'p95')):
                actual = summary['common']['perDate'][role][band]['percentilesDb'][q]
                if not np.isclose(actual, direct[j], rtol=0, atol=1e-12):
                    raise ValueError('Percentile reconciliation failed')
    for code in ('1', '2'):
        if summary['byClass'][code]['status'] != 'withheld-absent-class':
            raise ValueError('Absent class was not withheld')
    return {'schemaVersion': 'geoid-development-reproduction-1', 'status': 'development-only',
            'tileId': plan['tileId'], 'planSha256': PLAN_SHA256,
            'cropArchiveSha256': ARCHIVE_SHA256, 'acquisitionSha256': ACQUISITION_SHA256,
            'savedResultSha256': RESULT_SHA256, 'percentileAbsoluteToleranceDb': 1e-12,
            'sourceAssetBytes': acquisition['assetBodyBytes'],
            'fieldAccuracyEstablished': False, 'temporalComparisonAuthorized': False,
            'wholeAreaConclusionAuthorized': False, 'NISARTransferEstablished': False,
            'summary': summary}


if __name__ == '__main__':
    print(json.dumps(verify(), indent=2, sort_keys=True, allow_nan=False))
