"""Native analytical exports and separately reprojected display previews."""
import hashlib
import json
import os
from tempfile import TemporaryDirectory
from pathlib import Path
import numpy as np
from PIL import Image
from .raster import _runtime

def _hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def _write(path,values,grid,byte=False):
    gdal,_,_=_runtime()
    ds=gdal.GetDriverByName('GTiff').Create(str(path),grid['width'],grid['height'],1,gdal.GDT_Byte if byte else gdal.GDT_Float64,options=['TILED=YES','COMPRESS=DEFLATE','PREDICTOR=2' if byte else 'PREDICTOR=3'])
    ds.SetGeoTransform(grid['transform']);ds.SetProjection(grid['crs'])
    band=ds.GetRasterBand(1);band.SetNoDataValue(255 if byte else float('nan'));band.WriteArray(values)
    ds.FlushCache();band=None;ds=None

def _preview(path,values,valid,grid,low,high,difference=False,excluded=False):
    gdal,_,_=_runtime()
    x=np.clip((np.nan_to_num(values,nan=low)-low)/max(high-low,1e-12),0,1)
    anchors=np.array([[33,102,172],[245,245,245],[179,88,6]] if difference else [[68,1,84],[49,104,142],[53,183,121],[253,231,37]],dtype=float)
    if excluded:
        colors=np.array([[0,0,0],[221,170,51],[51,170,221],[187,187,187]],dtype=np.uint8)
        rgba=np.zeros((*values.shape,4),np.uint8)
        rgba[:,:,:3]=colors[np.clip(values,0,3).astype(int)];rgba[:,:,3]=np.where(valid&(values!=0),210,0)
    else:
        rgba=np.zeros((*values.shape,4),np.uint8)
        for c in range(3):rgba[:,:,c]=np.interp(x,np.linspace(0,1,len(anchors)),anchors[:,c]).astype(np.uint8)
        rgba[:,:,3]=np.where(valid,230,0)
    mem=gdal.GetDriverByName('MEM').Create('',grid['width'],grid['height'],4,gdal.GDT_Byte)
    mem.SetGeoTransform(grid['transform']);mem.SetProjection(grid['crs'])
    for i in range(4):mem.GetRasterBand(i+1).WriteArray(rgba[:,:,i]);mem.GetRasterBand(i+1).SetColorInterpretation([gdal.GCI_RedBand,gdal.GCI_GreenBand,gdal.GCI_BlueBand,gdal.GCI_AlphaBand][i])
    # This nearest-neighbour display reprojection is never a measurement input.
    warped=gdal.Warp('',mem,format='MEM',dstSRS='EPSG:4326',width=420,height=420,resampleAlg='near',dstAlpha=True)
    t=warped.GetGeoTransform();w,h=warped.RasterXSize,warped.RasterYSize
    Image.fromarray(np.moveaxis(warped.ReadAsArray()[:4],0,-1).astype(np.uint8)).save(path)
    bounds=[[t[3]+h*t[5],t[0]],[t[3],t[0]+w*t[1]]]
    warped=None;mem=None
    return bounds


def _transition_preview(path, codes, grid):
    """Categorical display only; no resampled pixel enters accounting."""
    gdal, _, _ = _runtime()
    # non-class-1 / gain / loss / class-1 at both dates / unknown
    palette = np.array([[83, 94, 96, 170], [166, 235, 102, 240],
                        [243, 153, 111, 240], [86, 178, 216, 220],
                        [160, 163, 170, 200]], dtype=np.uint8)
    rgba = np.zeros((*codes.shape, 4), dtype=np.uint8)
    inside = codes != 255
    rgba[inside] = palette[codes[inside]]
    mem = gdal.GetDriverByName('MEM').Create('', grid['width'], grid['height'], 4, gdal.GDT_Byte)
    mem.SetGeoTransform(grid['transform']); mem.SetProjection(grid['crs'])
    for i, interpretation in enumerate((gdal.GCI_RedBand, gdal.GCI_GreenBand, gdal.GCI_BlueBand, gdal.GCI_AlphaBand)):
        mem.GetRasterBand(i+1).WriteArray(rgba[:, :, i]); mem.GetRasterBand(i+1).SetColorInterpretation(interpretation)
    warped = gdal.Warp('', mem, format='MEM', dstSRS='EPSG:4326', width=420, height=420, resampleAlg='near', dstAlpha=True)
    t = warped.GetGeoTransform()
    Image.fromarray(np.moveaxis(warped.ReadAsArray()[:4], 0, -1).astype(np.uint8)).save(path)
    bounds = [[t[3]+warped.RasterYSize*t[5], t[0]], [t[3], t[0]+warped.RasterXSize*t[1]]]
    warped = None; mem = None
    return bounds

def export_comparison(before,after,before_record,after_record,output):
    """Keep incomplete exports out of the worker's publishable staging set."""
    from service.assessment_validation import RASTER_ARTIFACTS
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    moved=[]
    try:
        with TemporaryDirectory(prefix='.comparison-',dir=output) as scratch:
            scratch=Path(scratch)
            views=_export_comparison(before,after,before_record,after_record,scratch)
            names={name for view in views for layer in view['files'].values() for name in layer.values()}
            # Reject incomplete/unreferenced output instead of hiding it behind
            # retained statistics. Worker verification still checks every hash,
            # grid, mask and population before the atomic result rename.
            if not names<=RASTER_ARTIFACTS or {p.name for p in scratch.iterdir()}!=names:
                raise ValueError('Invalid comparison export set')
            for name in sorted(names):
                source=scratch/name;target=output/name
                if source.is_symlink() or not source.is_file() or target.exists() or target.is_symlink():
                    raise ValueError('Invalid comparison export destination')
                os.replace(source,target);moved.append(target)
            return views
    except Exception:
        # Only paths created by this call are removed; existing artifacts and
        # request/manifest files are never overwritten or deleted.
        for path in moved:path.unlink(missing_ok=True)
        raise


def _export_comparison(before,after,before_record,after_record,output):
    views=[];path=Path(output);path.mkdir(parents=True,exist_ok=True)
    grid=before['grid'];area=before['_area']
    if any(grid[k] != after['grid'][k] for k in ('crs', 'resolution', 'transform', 'width', 'height')) or not np.array_equal(area, after['_area']):
        raise ValueError('Comparison exports require the same native grid and selected-area support')
    for name,b in before['_arrays'].items():
        a=after['_arrays'][name];bv=before['_valid'][name]&area;av=after['_valid'][name]&area;common=bv&av
        if not common.any():continue
        categorical=name=='water'
        if categorical:b=(b==1).astype(float);a=(a==1).astype(float)
        values=np.concatenate([b[common],a[common]])
        low,high=(0.,1.) if categorical else map(float,np.percentile(values,[2,98]))
        if high<=low:high=low+max(abs(low)*.01,.01)
        diff=np.where(common,a-b,np.nan);limit=float(np.percentile(np.abs(diff[common]),98)) or .01
        unit='K' if name=='temperature' else 'class-1 indicator (0/1)' if categorical else 'index'
        excluded=np.where(~area,255,(~bv).astype(np.uint8)+2*(~av).astype(np.uint8)).astype(np.uint8)
        layers={'before':np.where(bv,b,np.nan),'after':np.where(av,a,np.nan),'difference':diff,'excluded':excluded}
        files={};hashes={};bounds=None
        for layer,data in layers.items():
            tif=f'{name}-{layer}.tif';png=f'{name}-{layer}.png';_write(path/tif,data,grid,byte=layer=='excluded')
            bounds=_preview(path/png,data,area if layer=='excluded' else (common if layer=='difference' else bv if layer=='before' else av),grid,-limit if layer=='difference' else 0 if layer=='excluded' else low,limit if layer=='difference' else 3 if layer=='excluded' else high,difference=layer=='difference',excluded=layer=='excluded')
            files[layer]=dict(raster=tif,preview=png);hashes[tif]=_hash(path/tif);hashes[png]=_hash(path/png)
        accounting = None
        if categorical:
            from .water_transitions import classify_transitions
            accounting, codes = classify_transitions(b, a, bv, av, area, grid)
            tif = 'water-transition.tif'; png = 'water-transition.png'
            _write(path/tif, codes, grid, byte=True)
            transition_bounds = _transition_preview(path/png, codes, grid)
            if transition_bounds != bounds:
                raise ValueError('Categorical preview extent differs from analytical comparison')
            files['transition'] = dict(raster=tif, preview=png)
            hashes[tif] = _hash(path/tif); hashes[png] = _hash(path/png)
        view = dict(id=name,quantity={'ndvi':'Vegetation greenness index (NDVI)','ndmi':'Spectral moisture index (NDMI)','temperature':'Land surface temperature','water':'Mapped class-1 open-water indicator'}[name],unit=unit,bounds=bounds,grid=grid,
            before=dict(date=before_record['date'],evidenceId=before_record['evidenceId'],coveragePercent=100*int(bv.sum())/int(area.sum())),
            after=dict(date=after_record['date'],evidenceId=after_record['evidenceId'],coveragePercent=100*int(av.sum())/int(area.sum())),commonCoveragePercent=100*int(common.sum())/int(area.sum()),
            validPixels=int(common.sum()),totalPixels=int(area.sum()),scale=dict(minimum=low,maximum=high,differenceLimit=limit),files=files,hashes=hashes,
            notes=['Before/after use one shared display scale; difference is centred on zero.','GeoTIFFs retain the analytical grid; indicator/difference values are float64 and categorical codes are uint8. PNG previews alone are reprojected with nearest-neighbour sampling.','Excluded codes: 0 common-valid; 1 invalid before; 2 invalid after; 3 invalid both; 255 outside the recorded area.','Class-1 indicator zero means not class 1, including partial-water pixels; it does not establish dry ground.','Transition codes: 0 non-class-1 at both dates; 1 class-1 gain; 2 class-1 loss; 3 class-1 at both dates; 4 unknown comparison; 255 outside the recorded area. Endpoints do not establish continuity, cause or independently validated environmental change.'] if categorical else ['Before/after use one shared display scale; difference is centred on zero.','GeoTIFFs retain the analytical grid and float64 values; PNG previews alone are reprojected with nearest-neighbour sampling.','Excluded codes: 0 common-valid; 1 invalid before; 2 invalid after; 3 invalid both; 255 outside the recorded area.'])
        if accounting is not None:
            view['transitionAccounting'] = accounting
        views.append(view)
    return views

def verify_exports(view,path):
    """Reconcile exported populations and differences before atomic publication."""
    gdal,_,osr=_runtime();path=Path(path);layers={}
    ref=osr.SpatialReference();ref.ImportFromWkt(view['grid']['crs'])
    for layer,files in view['files'].items():
        for name in files.values():
            if _hash(path/name)!=view['hashes'][name]:raise ValueError('Raster artifact hash mismatch')
        with Image.open(path/files['preview']) as img:
            if img.size!=(420,420) or img.mode!='RGBA':raise ValueError('Unexpected preview dimensions')
            img.verify()
        ds=gdal.OpenEx(str(path/files['raster']),gdal.OF_RASTER,allowed_drivers=['GTiff'])
        if ds is None or ds.RasterCount!=1 or ds.RasterXSize!=view['grid']['width'] or ds.RasterYSize!=view['grid']['height'] or list(ds.GetGeoTransform())!=view['grid']['transform'] or not ds.GetSpatialRef().IsSame(ref):raise ValueError('Exported grid differs from provenance')
        layers[layer]=ds.ReadAsArray();ds=None
    codes=layers['excluded'];area=codes!=255;common=codes==0
    if not np.isin(codes,[0,1,2,3,255]).all() or int(area.sum())!=view['totalPixels'] or int(common.sum())!=view['validPixels']:raise ValueError('Exported coverage does not reconcile')
    bv=np.isfinite(layers['before']);av=np.isfinite(layers['after']);dv=np.isfinite(layers['difference'])
    if not np.array_equal(bv,area&((codes&1)==0)) or not np.array_equal(av,area&((codes&2)==0)) or not np.array_equal(dv,common):raise ValueError('Exported validity does not reconcile')
    if not np.allclose(layers['difference'][common],layers['after'][common]-layers['before'][common],atol=1e-12,rtol=1e-12):raise ValueError('Exported difference cannot be reproduced')
    if ('transitionAccounting' in view) != ('transition' in layers):
        raise ValueError('Incomplete transition accounting export')
    if 'transitionAccounting' in view:
        if view['id'] != 'water':
            raise ValueError('Unsupported transition quantity')
        from .water_transitions import classify_transitions, validate_report
        validate_report(view['transitionAccounting'], view['grid'])
        expected, transition_codes = classify_transitions(layers['before'], layers['after'], bv, av, area, view['grid'])
        if view['transitionAccounting'] != expected or not np.array_equal(layers['transition'], transition_codes):
            raise ValueError('Exported transition accounting cannot be reproduced')
