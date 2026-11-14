"""Reproduce the original native radar measurements from frozen exported powers.

These are native-grid, producer-masked exports, not full granules or quiet
reference labels. The result is an effect-size inspection baseline, not water
classification, field accuracy or a noise probability.
"""
import hashlib
import io
import json
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[1]/'examples/native-radar-development'
MANIFEST_SHA256='31a95a132073e4a96db750ba58aa4167595fad72c44991582faa8f7cfbef8df5'
ARCHIVE_SHA256='a326bb0833522f5dc3b9432f8f791b3fe60e4c4315422d5a081ad27b5f2aff79'
AOI_SHA256='bd0a90564021dfacd912064d41cb8d7c6960eadfaaebdf1fc5b727c0ec8a6383'
NAMES={'before_power':'before.tif','after_power':'after.tif','difference_exported':'difference.tif','common_observable':'validity.tif'}

def pinned_bytes(path,expected,limit):
    with path.open('rb') as stream:raw=stream.read(limit+1)
    if len(raw)>limit or hashlib.sha256(raw).hexdigest()!=expected:raise ValueError('frozen input hash mismatch')
    return raw

def verify(root=ROOT):
    manifest=json.loads(pinned_bytes(root/'manifest.json',MANIFEST_SHA256,128*1024))
    raw=pinned_bytes(root/'inputs.npz',ARCHIVE_SHA256,1024**2)
    aoi_raw=pinned_bytes(root/'aoi.npz',AOI_SHA256,128*1024)
    with np.load(io.BytesIO(aoi_raw),allow_pickle=False) as mask:
        if mask.files!=['aoi']:raise ValueError('unexpected geometry arrays')
        aoi=mask['aoi']
        if aoi.dtype!=np.uint8 or not np.isin(aoi,[0,1]).all():raise ValueError('unsupported geometry mask')
        aoi=aoi.astype(bool)
    hashes=manifest['processing']['sourceMetadata']['artifactSha256']
    for name in NAMES.values():pinned_bytes(root/name,hashes[name],1024**2)
    with np.load(io.BytesIO(raw),allow_pickle=False) as arrays:
        if set(arrays.files)!=set(NAMES):raise ValueError('unexpected arrays')
        b=arrays['before_power'];a=arrays['after_power'];m=arrays['common_observable'];d=arrays['difference_exported']
        shape=(manifest['crop']['height'],manifest['crop']['width'])
        if b.shape!=shape or a.shape!=shape or m.shape!=shape or d.shape!=shape or aoi.shape!=shape or b.dtype!=np.float32 or a.dtype!=np.float32 or d.dtype!=np.float32 or m.dtype!=np.uint8 or not np.isin(m,[0,1]).all():raise ValueError('unsupported exported input contract')
        bv=np.isfinite(b)&(b>0);av=np.isfinite(a)&(a>0);common=m==1
        if not np.array_equal(common,bv&av):raise ValueError('mask/population mismatch')
        if np.any(common&~aoi):raise ValueError('valid pixels outside requested area')
        if int(common.sum())!=manifest['coverage']['commonValidPixels'] or int(bv.sum())!=manifest['coverage']['beforeValidPixels'] or int(av.sum())!=manifest['coverage']['afterValidPixels']:raise ValueError('coverage mismatch')
        score=10*(np.log10(a[common].astype(np.float64))-np.log10(b[common].astype(np.float64)))
        stats={k:float(v) for k,v in zip(('p05Db','medianDb','p95Db'),np.percentile(score,[5,50,95]))}
        stats.update(minDb=float(score.min()),maxDb=float(score.max()))
        if any(not np.isclose(v,manifest['stats'][k],atol=1e-12,rtol=1e-12) for k,v in stats.items()):raise ValueError('original measurement mismatch')
        error=float(np.max(np.abs(score-d[common])))
        if error>1e-6 or not np.isnan(d[~common]).all():raise ValueError('exported difference mismatch')
        decrease=int(np.count_nonzero(score < -3));increase=int(np.count_nonzero(score >3))
        within=int(common.sum())-decrease-increase
        t=manifest['crop']['transform'];cell_area=abs(t[1]*t[5]-t[2]*t[4])
        return {'kind':'native_export_reproduction','status':'development-only; no reviewed reference labels',
            'sources':{'before':manifest['before']['id'],'after':manifest['after']['id']},
            'stats':stats,'commonValidPixels':int(common.sum()),'excludedPixels':int(m.size-common.sum()),
            'geometryCoverage':{'windowPixels':int(m.size),'selectedAreaPixels':int(aoi.sum()),'outsideAreaPixels':int(np.count_nonzero(~aoi)),'validInsideArea':int(np.count_nonzero(aoi&common)),'invalidInsideArea':int(np.count_nonzero(aoi&~common)),'commonValidPercentOfSelectedArea':float(100*np.count_nonzero(aoi&common)/aoi.sum()),'originalCommonValidPercentOfWindow':manifest['coverage']['commonValidPercent'],'basis':'separate geometry-only reconstruction using original _roi_mask and frozen CRS/affine/bbox; original result unchanged'},
            'fixedBaseline':{'method':'strict ±3 dB signal excursions','decreasedPixels':decrease,'increasedPixels':increase,'withinPixels':within,'excursionFractionCommonValid':(decrease+increase)/int(common.sum()),'denominator':'common positive finite producer-masked native exported pixels; not the whole lake'},
            'nominalProjectedCellAreaM2':cell_area,'validAreaKm2':float(cell_area*common.sum()/1e6),
            'differenceFloat32MaxAbsErrorDb':error,'originalInputsHashScope':manifest['processing']['sourceMetadata']['hashScope'],
            'reproductionHashScope':'four exported GeoTIFFs and their native arrays, distinct from original raw-crop hashes',
            'fieldAccuracyEstablished':False,'quietCalibration':'withheld: independently reviewed target-stable references not supplied'}

if __name__=='__main__':print(json.dumps(verify(),indent=2,allow_nan=False))
