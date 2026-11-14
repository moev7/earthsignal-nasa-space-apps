"""Reconcile the frozen optical development windows, without network access.

This verifies receipt consistency, not reference truth, radar accuracy or a
prospective experiment. Unknown SCL classes are never silently made dry land.
"""
import hashlib
import json
from pathlib import Path
import zipfile
import numpy as np
from .observatory.methods import array_hash

ROOT=Path(__file__).resolve().parents[1]/'examples/optical-reference-development'
RECEIPT_SHA256='6b3a1e5ad64ee44ed6f7eefc8b3fee381ffc53e74941befa503070c6f7954429'
ITEMS_SHA256='df82133a8601016c1403a52f18896f4255c025f63c0659d0ff489403571b22fb'

def verify(root=ROOT):
    receipt_path=root/'receipt.json'
    if receipt_path.stat().st_size>128*1024:raise ValueError('receipt too large')
    raw=receipt_path.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=RECEIPT_SHA256:raise ValueError('frozen receipt hash mismatch')
    metadata=(root/'source-items.json').read_bytes()
    if len(metadata)>128*1024 or hashlib.sha256(metadata).hexdigest()!=ITEMS_SHA256:raise ValueError('frozen metadata hash mismatch')
    items={x['side']:x['item'] for x in json.loads(metadata)}
    receipt=json.loads(raw)
    if receipt['schemaVersion']!='experiment-1':raise ValueError('unsupported receipt')
    grids=[];scenes=[];totals=[]
    for record in receipt['results']:
        side=record['side']
        if side not in ('before','after'):raise ValueError('unexpected side')
        item=items[side]
        if record['itemId']!=item['id'] or record['observedAt']!=item['properties']['datetime']:raise ValueError('source identity mismatch')
        path=root/(side+'.npz')
        if path.stat().st_size>2*1024**2:raise ValueError('archive too large')
        raw=path.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=record['archiveHash']:raise ValueError('archive hash mismatch')
        expected={n+s for n in ('scl','red','green','blue') for s in ('','_aoi')}
        with zipfile.ZipFile(path) as archive:
            if len(archive.infolist())!=8 or {i.filename for i in archive.infolist()}!={n+'.npy' for n in expected} or sum(i.file_size for i in archive.infolist())>4*1024**2:raise ValueError('archive envelope')
        with np.load(path,allow_pickle=False) as arrays:
            if set(arrays.files)!=expected:raise ValueError('archive arrays')
            for name in ('scl','red','green','blue'):
                band=record['bands'][name];a=arrays[name];mask=arrays[name+'_aoi']
                if band['asset']!=item['assets'][name]:raise ValueError('source asset mismatch')
                if a.ndim!=2 or a.size>1000000 or list(a.shape)!=band['shape'] or mask.shape!=a.shape:raise ValueError('array shape')
                if mask.dtype!=np.uint8 or not np.isin(mask,[0,1]).all():raise ValueError('aoi mask')
                if array_hash(a)!=band['arrayHash'] or array_hash(mask)!=band['aoiHash']:raise ValueError('array hash mismatch')
            qa=arrays['scl'].copy();mask=arrays['scl_aoi'].astype(bool)
            counts={str(int(v)):int(np.count_nonzero(mask&(qa==v))) for v in np.unique(qa[mask])}
            if counts!=record['sclCounts'] or int(mask.sum())!=record['aoiPixels'] or counts.get('6',0)!=record['sclWaterPixels']:raise ValueError('count mismatch')
            band=record['bands']['scl']
            t=band['transform']
            if len(t)!=6 or not np.isfinite(t).all() or t[1]!=20 or t[2]!=0 or t[4]!=0 or t[5]!=-20:raise ValueError('unsupported optical grid')
            grids.append((band['crs'],band['transform'],band['shape']))
            scenes.append((qa,mask));totals.append({'side':side,'itemId':record['itemId'],'observedAt':record['observedAt'],'aoiPixels':int(mask.sum()),'sclCounts':counts})
    if [x['side'] for x in totals]!=['before','after'] or grids[0]!=grids[1]:raise ValueError('pair grid/order')
    before,before_mask=scenes[0];after,after_mask=scenes[1]
    if not np.array_equal(before_mask,after_mask):raise ValueError('pair area')
    area=before_mask
    known=area & np.isin(before,[4,5,6]) & np.isin(after,[4,5,6])
    matrix={f'{i}->{j}':int(np.count_nonzero(known&(before==i)&(after==j))) for i in (4,5,6) for j in (4,5,6)}
    count=int(known.sum());unknown=int(area.sum())-count
    if sum(matrix.values())!=count:raise ValueError('population mismatch')
    return {'status':'development-only; unreviewed optical classifier', 'scenes':totals,'commonOpticalKnownPixels':count,'uncertainOpticalPixels':unknown,'commonOpticalKnownFraction':count/int(area.sum()),'sclTransitions':matrix,'nominalProjectedCellAreaM2':400,'originalRadarMeasurementsChanged':False,'fieldAccuracyEstablished':False}

if __name__=='__main__':print(json.dumps(verify(),indent=2,allow_nan=False))
