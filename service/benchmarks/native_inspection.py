"""Reproduce inspection windows from the original pinned NISAR development crop.

Offline, optional Rasterio test reader; no source mutation or event validation.
"""
import io
import json

import numpy as np

from service.analysis import common_mask, summarize
from service.inspection import inspection_windows
from service.verify_native_radar import (
    AOI_SHA256, ARCHIVE_SHA256, MANIFEST_SHA256, ROOT, pinned_bytes, verify,
)


def evaluate(root=ROOT):
    from rasterio.io import MemoryFile
    from rasterio.warp import transform as project

    original = verify(root)
    manifest = json.loads(pinned_bytes(root / 'manifest.json', MANIFEST_SHA256, 128 * 1024))
    hashes = manifest['processing']['sourceMetadata']['artifactSha256']
    arrays = []
    for name in ('before.tif', 'after.tif', 'difference.tif', 'validity.tif'):
        # Decode only the exact verified bytes, with no sidecars or second file read.
        with MemoryFile(pinned_bytes(root / name, hashes[name], 1024**2)) as memory:
            with memory.open() as dataset:
                if (dataset.driver != 'GTiff' or dataset.count != 1 or
                        dataset.crs.to_string() != manifest['crop']['crs'] or
                        tuple(dataset.transform.to_gdal()) != tuple(manifest['crop']['transform'])):
                    raise ValueError('Original native inspection grid mismatch')
                arrays.append(dataset.read(1))
    with np.load(io.BytesIO(pinned_bytes(root / 'inputs.npz', ARCHIVE_SHA256, 1024**2)), allow_pickle=False) as archive:
        for array, name in zip(arrays, ('before_power', 'after_power', 'difference_exported', 'common_observable')):
            if array.dtype != archive[name].dtype or not np.array_equal(array, archive[name], equal_nan=True):
                raise ValueError('Original TIFF and frozen native arrays differ')
    with np.load(io.BytesIO(pinned_bytes(root / 'aoi.npz', AOI_SHA256, 128 * 1024)), allow_pickle=False) as archive:
        selected = archive['aoi'].astype(bool)
    common = common_mask(*arrays)
    affine = tuple(manifest['crop']['transform'])
    area = original['nominalProjectedCellAreaM2']
    def to_wgs84(point):
        longitude, latitude = project(manifest['crop']['crs'], 'EPSG:4326', [point[0]], [point[1]])
        return longitude[0], latitude[0]
    inspection = inspection_windows(arrays[2], common, selected, affine, area, 3, to_wgs84)
    summary, _, _ = summarize(*arrays, selected, area, 3)
    if (inspection['validPixels'] != original['commonValidPixels'] or
            inspection['selectedPixels'] != original['geometryCoverage']['selectedAreaPixels'] or
            inspection['omittedWindows']):
        raise ValueError('Unexpected original inspection population or truncation')
    for key, expected in (
            ('increasedPixels', original['fixedBaseline']['increasedPixels']),
            ('decreasedPixels', original['fixedBaseline']['decreasedPixels'])):
        if sum(candidate[key] for candidate in inspection['candidates']) != expected:
            raise ValueError('Inspection windows do not recover original threshold counts')
    return {
        'schemaVersion': 'native-inspection-development-1',
        'status': 'development-only; inspection utility not evaluated',
        'originalMeasurementsChanged': False,
        'source': {
            'manifestSha256': MANIFEST_SHA256, 'nativeArraysSha256': ARCHIVE_SHA256,
            'selectionMaskSha256': AOI_SHA256, 'artifactSha256': {name: hashes[name] for name in ('before.tif', 'after.tif', 'difference.tif', 'validity.tif')},
            'beforeId': manifest['before']['id'], 'afterId': manifest['after']['id'],
            'crs': manifest['crop']['crs'], 'transform': list(affine),
            'selection': 'Original geographic bbox pixel-centre mask; not padded rectangular window',
        },
        'summary': summary,
        'inspectionWindows': inspection,
        'fieldAccuracyEstablished': False,
        'humanInspectionBenefitEstablished': False,
    }


if __name__ == '__main__':
    print(json.dumps(evaluate(), indent=2, allow_nan=False))
