"""Operator experiment only: bounded public optical windows, no water truth."""
import argparse, hashlib, json, math, resource, time
from datetime import datetime,timezone
from pathlib import Path
import numpy as np
from service.observatory.raster import _runtime, opener, validate_asset
from service.range_reader import RemoteAsset, RangeProxy, TransferBudget
from service.observatory.methods import array_hash

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
root=args.output
root.mkdir(mode=0o700, exist_ok=False)
metadata=Path(__file__).with_name('source-items.json').read_bytes()
if hashlib.sha256(metadata).hexdigest()!='df82133a8601016c1403a52f18896f4255c025f63c0659d0ff489403571b22fb':raise ValueError('source metadata hash mismatch')
items = json.loads(metadata)
gdal, ogr, osr = _runtime()
budget = TransferBudget(32*1024**2)
started = time.monotonic()
started_at=datetime.now(timezone.utc).isoformat()
bbox = [-114.75,36.05,-114.74,36.06]
area = {'type':'Polygon','coordinates':[[[bbox[0],bbox[1]],[bbox[2],bbox[1]],[bbox[2],bbox[3]],[bbox[0],bbox[3]],[bbox[0],bbox[1]]]]}
results = []
for entry in items:
    item=entry['item']; side=entry['side']; arrays={}; band_records={}
    for name in ('scl','red','green','blue'):
        if time.monotonic()-started>180: raise RuntimeError('runtime bound')
        asset=item['assets'][name]
        remote=RemoteAsset(asset['href'],opener(Path('/nonexistent-public-only.netrc')),budget,validator=validate_asset)
        with RangeProxy([remote]) as proxy:
            ds=gdal.OpenEx(proxy.vsi_path(0),gdal.OF_RASTER,allowed_drivers=['GTiff']); proxy.check()
            if ds is None or ds.RasterCount!=1:raise RuntimeError('unsupported source')
            ref=ds.GetSpatialRef(); ref.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
            if not ref.IsProjected() or abs(ref.GetLinearUnits()-1)>1e-8:raise RuntimeError('nonmetric grid')
            t=ds.GetGeoTransform()
            if t[2]!=0 or t[4]!=0 or t[1]<=0 or t[5]>=0:raise RuntimeError('rotated grid')
            wgs=osr.SpatialReference();wgs.ImportFromEPSG(4326);wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
            shape=ogr.CreateGeometryFromJson(json.dumps(area));shape.Segmentize(.001);shape.Transform(osr.CoordinateTransformation(wgs,ref))
            xmin,xmax,ymin,ymax=shape.GetEnvelope()
            x=math.floor((xmin-t[0])/t[1]);y=math.floor((ymax-t[3])/t[5])
            width=math.ceil((xmax-t[0])/t[1])-x;height=math.ceil((ymin-t[3])/t[5])-y
            if min(x,y)<0 or x+width>ds.RasterXSize or y+height>ds.RasterYSize or width*height>1000000:raise RuntimeError('crop bounds')
            a=ds.GetRasterBand(1).ReadAsArray(x,y,width,height);proxy.check()
            transform=[t[0]+x*t[1],t[1],0,t[3]+y*t[5],0,t[5]]
            mem=gdal.GetDriverByName('MEM').Create('',width,height,1,gdal.GDT_Byte);mem.SetGeoTransform(transform);mem.SetProjection(ref.ExportToWkt())
            vec=ogr.GetDriverByName('Memory').CreateDataSource('');layer=vec.CreateLayer('aoi',srs=ref,geom_type=ogr.wkbPolygon);f=ogr.Feature(layer.GetLayerDefn());f.SetGeometry(shape);layer.CreateFeature(f)
            gdal.RasterizeLayer(mem,[1],layer,burn_values=[1]);mask=mem.ReadAsArray().astype(np.uint8)
            arrays[name]=a;arrays[name+'_aoi']=mask
            band_records[name]={'arrayHash':array_hash(a),'aoiHash':array_hash(mask),'transform':transform,'crs':ref.ExportToWkt(),'shape':list(a.shape),'asset':asset,'etag':remote.etag}
            ds=None;mem=None;vec=None
    np.savez_compressed(root/(side+'.npz'),**arrays)
    qa=arrays['scl'];mask=arrays['scl_aoi'].astype(bool)
    classes={str(int(v)):int(np.count_nonzero(mask&(qa==v))) for v in np.unique(qa[mask])}
    total=int(mask.sum());assert sum(classes.values())==total
    from PIL import Image
    channels=[]
    for name in ('red','green','blue'):
        m=item['assets'][name]['raster:bands'][0];reflectance=arrays[name].astype(float)*m['scale']+m['offset']
        channels.append((np.clip(reflectance/.3,0,1)*255).astype(np.uint8))
    Image.fromarray(np.stack(channels,axis=-1)).save(root/(side+'.png'))
    results.append({'side':side,'itemId':item['id'],'observedAt':item['properties']['datetime'],'bands':band_records,'sclCounts':classes,'aoiPixels':total,'sclWaterPixels':classes.get('6',0),'status':'unreviewed optical classifier; not independent truth','archiveHash':hashlib.sha256((root/(side+'.npz')).read_bytes()).hexdigest()})
report={'schemaVersion':'experiment-1','area':area,'results':results,'bytesTransferred':budget.transferred,'elapsedSeconds':time.monotonic()-started,'maxRssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'acquisitionRunStartedAt':started_at,'acquisitionRunCompletedAt':datetime.now(timezone.utc).isoformat(),'interpretation':'SCL classes and RGB visibility only. No field accuracy, water-transition attribution or real-time claim.'}
(root/'receipt.json').write_text(json.dumps(report,indent=2,allow_nan=False))
print(json.dumps({k:report[k] for k in ('bytesTransferred','elapsedSeconds','maxRssKiB')}))
print(json.dumps([{k:r[k] for k in ('side','itemId','sclCounts','aoiPixels','sclWaterPixels','status')} for r in results]))
