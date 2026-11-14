"""Exercise the offline detector on verified real development exports.

No network, resampling, independent reference labels or automatic activation.
The source hashes here identify exported GeoTIFFs, not whole NISAR granules.
"""
from dataclasses import replace
import io
import json

import numpy as np

from service.verify_native_radar import (
    AOI_SHA256, ARCHIVE_SHA256, ROOT, pinned_bytes, verify,
)
from .evaluator import array_sha256, canonical_json
from .radar import Case, Footprint, Frame, Grid, Product, Profile, Source, Spec, apply, freeze

FROZEN_AT = '2026-10-12T19:42:19Z'
MASK = ('Finite positive exported power after original producer-mask and bbox '
        'policy; discarded source values/masks are not reconstructed')
FOOTPRINT = 'Frozen original bbox pixel-centre geometry, separately reconstructed; not a product-quality mask'
REFERENCE = 'Independent time-matched review of target class stability; not supplied for this development case'


def load_case(root=ROOT):
    """Verify every pinned input before constructing asserted detector metadata."""
    verification = verify(root)
    manifest = json.loads((root / 'manifest.json').read_bytes())
    with np.load(io.BytesIO(pinned_bytes(root / 'inputs.npz', ARCHIVE_SHA256, 1024**2)), allow_pickle=False) as data:
        before = data['before_power'].copy()
        after = data['after_power'].copy()
    with np.load(io.BytesIO(pinned_bytes(root / 'aoi.npz', AOI_SHA256, 128*1024)), allow_pickle=False) as data:
        footprint = data['aoi'].astype(bool)
    metadata = manifest['processing']['sourceMetadata']
    grid = Grid('nisar-track5-frame20-frequencyA-lattice', manifest['crop']['crs'], before.shape,
                tuple(manifest['crop']['transform']), 'metre',
                'Original native GeoTIFF metre CRS/affine; nominal projected cell area, not geodesic')
    frames = []
    for side, power in [('before', before), ('after', after)]:
        original, source = metadata[side], manifest[side]
        geometry = canonical_json({k: original[k] for k in (
            'trackNumber', 'frameNumber', 'orbitPassDirection', 'lookDirection',
            'productVersion', 'productSpecificationVersion', 'frequencyModes')})
        product = Product('nisar_l_band', 'NISAR', 'L', 'HH', 'GCOV-frequencyA-HHHH',
                          'LINEAR_POWER', source['collection'], original['compositeReleaseId'],
                          'provisional', (manifest['notice'], 'Original mask is not a layover/shadow mask'), geometry)
        mask = np.isfinite(power) & (power > 0)
        item = Source(source['id'], source['id'], source['acquiredAt'],
                      metadata['artifactSha256'][side + '.tif'], array_sha256(power),
                      array_sha256(mask), product, MASK,
                      'Pinned original manifest and independently checked exported GeoTIFF: '
                      'source.sha256 covers this export only; HDF5 acquisition identity is asserted by original provenance')
        frames.append(Frame(power, mask, grid, item))
    profile = Profile(frames[1].source.product, grid, 'unclassified-development-crop', MASK, REFERENCE, FOOTPRINT)
    case = Case('native-radar-development', 'lake-mead-2026-development', 'lake-mead-small-island-patch',
                profile.stratum, frames[1], before=frames[0],
                footprint=Footprint(footprint, FOOTPRINT, array_sha256(footprint)))
    return case, profile, verification


def evaluate(root=ROOT):
    case, profile, verification = load_case(root)
    baseline = Spec('fixed_pair', profile, FROZEN_AT,
                    task_parameter_evidence='Reproduce the original strict ±3 dB descriptive baseline on an inspected development case')
    fixed = freeze(baseline)
    detection = apply(fixed, case, expected_receipt_sha256=fixed['receipt_sha256'], stage='exploratory')
    counts = detection.receipt['counts']
    expected = verification['fixedBaseline']
    if (counts['signal_decrease_cells'], counts['signal_increase_cells'], counts['no_alert_cells']) != (
            expected['decreasedPixels'], expected['increasedPixels'], expected['withinPixels']):
        raise ValueError('Detector and original baseline population differ')
    candidate = replace(baseline, method='empirical_pair', lower_candidates=(-10., -6., -3., -1.),
                        upper_candidates=(1., 3., 6., 10.), lower_tail_budget=.05, upper_tail_budget=.05,
                        minimum_independent_units=2,
                        task_parameter_evidence='Development readiness exercise only: candidate grid/budgets are not preregistered field policy; no reviewed calibration labels exist')
    pair = freeze(candidate, [case])
    temporal_case = replace(case, id=case.id + '-temporal', before=None)
    temporal = freeze(replace(candidate, method='empirical_temporal', minimum_valid_histories=3), [temporal_case])
    return {
        'schemaVersion': 'radar-development-1', 'status': 'development-only',
        'frozenAt': FROZEN_AT, 'originalMeasurementsChanged': False,
        'fieldAccuracyEstablished': False, 'sourceHashScope': 'Pinned native exported rasters; not full granules',
        'verification': verification, 'fixedPolicy': fixed, 'fixedDetection': detection.receipt,
        'empiricalPairPolicy': pair, 'empiricalTemporalPolicy': temporal,
        'readiness': {
            'fixedPair': 'Observed signal excursions reproduced; no event classes or calibrated confidence',
            'empiricalPair': 'Withheld: independently reviewed target-stable references and sufficient independent units absent',
            'empiricalTemporal': 'Withheld: no frozen compatible preceding history or independently reviewed reference',
            'nextEvidence': ['Independent, time-matched target-stable and true-change labels',
                             'Separate calibration and untouched event/site acquisitions',
                             'Frozen compatible preceding native history for temporal detection'],
        },
    }


if __name__ == '__main__':
    print(json.dumps(evaluate(), indent=2, allow_nan=False))
