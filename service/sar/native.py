"""Numerical native readers. Never warp analytical arrays or infer calibration from colors."""
from dataclasses import dataclass
import hashlib
import json
import math
from datetime import datetime
from pathlib import Path
import numpy as np
from .net import SarError,PublicReader,digest,StableAsset
from .catalog import native_assets

MAX_PIXELS=262144  # Bounded JSON/PNG outputs fit the existing 8 MiB artifact cap.

@dataclass
class NativeCrop:
    values: np.ndarray
    valid: np.ndarray
    grid: dict
    convention: str
    quantity: str
    unit: str
    evidence: dict

def affine_window(gt,width,height,bounds,max_pixels=MAX_PIXELS):
    if len(gt)!=6 or not all(math.isfinite(v) for v in gt) or gt[1]<=0 or gt[5]>=0 or gt[2]!=0 or gt[4]!=0:
        raise SarError('grid_unknown','Only verified north-up regular native grids are supported')
    left=max(0,math.ceil((bounds[0]-gt[0])/gt[1]-.5));right=min(width,math.floor((bounds[2]-gt[0])/gt[1]-.5)+1)
    top=max(0,math.ceil((bounds[3]-gt[3])/gt[5]-.5));bottom=min(height,math.floor((bounds[1]-gt[3])/gt[5]-.5)+1)
    if left>=right or top>=bottom:raise SarError('no_overlap','No native pixel centers intersect this crop')
    if (right-left)*(bottom-top)>max_pixels:raise SarError('pixel_limit','Crop exceeds the native pixel budget; choose a smaller area')
    return (left,top,right-left,bottom-top),[gt[0]+left*gt[1],gt[1],0,gt[3]+top*gt[5],0,gt[5]]

def power_to_db(values,valid,representation):
    values=np.asarray(values)
    if values.ndim!=2 or values.dtype.kind not in 'iuf' or valid.dtype!=np.bool_ or valid.shape!=values.shape:
        raise SarError('representation_unknown','Expected real native raster and exact boolean validity')
    out=np.full(values.shape,np.nan,dtype=np.float64)
    keep=valid & np.isfinite(values)
    if representation=='dB':out[keep]=values[keep]
    elif representation in ('power','amplitude'):
        keep &= values>0
        out[keep]=(10 if representation=='power' else 20)*np.log10(values[keep].astype(np.float64))
    else:raise SarError('calibration_unknown','Native calibrated power, amplitude or dB representation is not documented')
    return out,keep

def input_digest(crop):
    h=hashlib.sha256(json.dumps({'grid':crop.grid,'convention':crop.convention,'evidence':crop.evidence},sort_keys=True,allow_nan=False).encode())
    h.update(np.where(crop.valid,crop.values,0).astype('<f8').tobytes());h.update(crop.valid.astype('u1').tobytes())
    return h.hexdigest()

def compare(crops):
    a,b=crops
    for c in crops:
        if (c.values.ndim!=2 or c.valid.dtype!=np.bool_ or c.valid.shape!=c.values.shape or
            c.values.shape!=(c.grid.get('height'),c.grid.get('width')) or np.any(c.valid & ~np.isfinite(c.values))):
            raise SarError('invalid_crop','Comparison requires exact native grids and finite valid samples')
    if any(c.unit!='dB' or c.quantity!='radar backscatter' for c in crops):
        raise SarError('incompatible_quantity','Only calibrated backscatter observations may produce a dB difference')
    if a.grid!=b.grid or a.convention!=b.convention or a.quantity!=b.quantity or a.unit!=b.unit:
        raise SarError('incompatible_grid','Native grids, radiometry and quantities must match; scientific resampling is disabled')
    for key in ('sourceId','channel','track','direction','mode','sourceProcessing'):
        av,bv=a.evidence.get(key),b.evidence.get(key)
        if av is None or av!=bv or (isinstance(av,dict) and any(v is None for v in av.values())):
            raise SarError('incompatible_pair','Known acquisition geometry, source, channel and mode must match')
    if a.evidence.get('sourceId')=='nisar':
        from service.processing import validate_metadata_pair
        validate_metadata_pair(a.evidence.get('metadata',{}),b.evidence.get('metadata',{}))
    if acquisition_time(a.evidence.get('acquiredAt'))>=acquisition_time(b.evidence.get('acquiredAt')):
        raise SarError('chronology','Choose two distinct chronological acquisitions')
    valid=a.valid & b.valid
    return NativeCrop(np.where(valid,b.values-a.values,np.nan),valid,a.grid,a.convention,'radar backscatter difference','dB',
        {'before':a.evidence,'after':b.evidence,'beforeCropSha256':input_digest(a),'afterCropSha256':input_digest(b)})

def acquisition_time(value):
    try:
        if not isinstance(value,str):raise ValueError()
        result=datetime.fromisoformat(value.replace('Z','+00:00'))
        if result.tzinfo is None:raise ValueError()
        return result
    except ValueError:raise SarError('chronology','Acquisition times need explicit, verified time zones before comparison') from None

def _project(bounds,crs):
    try:
        from osgeo import osr
        src=osr.SpatialReference();src.ImportFromEPSG(4326);src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        dst=osr.SpatialReference();dst.SetFromUserInput(crs);dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        return osr.CoordinateTransformation(src,dst).TransformBounds(*bounds,21)
    except ImportError:
        from rasterio.warp import transform_bounds
        return transform_bounds('EPSG:4326',crs,*bounds,densify_pts=21)

def cog_asset(item,channel,*,native=False,reader=None):
    """Require explicit source radiometry; filenames alone never calibrate DN."""
    if item.get('collection')=='rcm-ard' and reader is not None:
        from .rcm import descriptor
        return descriptor(item,channel,reader)
    candidates=[]
    for key,asset in native_assets(item).items():
        if native and item.get('collection')=='Radarsat-1-L1-COG' and key=='cog' and channel in item.get('properties',{}).get('sar:polarizations',[]):
            return asset,'native source values','native',{}
        bands=asset.get('raster:bands',[])
        metadata=' '.join(str(asset.get(k,'')) for k in ('title','description'))+' '+key
        pol=asset.get('sar:polarization') or asset.get('polarization')
        if pol is not None:
            if pol!=channel:continue
        elif not re_channel(metadata,channel):continue
        conventions=[c for c in ('gamma0','sigma0','beta0') if c in metadata.lower().replace('_','').replace(' ','')]
        if len(conventions)!=1:continue
        convention=conventions[0]
        if not isinstance(bands,list) or len(bands)!=1:continue
        unit=bands[0].get('unit')
        representation={'dB':'dB','db':'dB','decibel':'dB','power':'power','linear power':'power','amplitude':'amplitude'}.get(unit)
        if representation:candidates.append((asset,convention,representation,bands[0]))
    if len(candidates)!=1:raise SarError('calibration_unknown','Exactly one source-declared calibrated channel with explicit raster units is required; DN and browse files are withheld')
    return candidates[0]

def read_cog(source,item,bounds,channel,reader,*,native=False,pixel_window=None):
    """Require explicit STAC radiometry/units, then read only native source windows."""
    asset,convention,representation,bandmeta=cog_asset(item,channel,native=native,reader=reader)
    if bandmeta.get('scale',1)!=1 or bandmeta.get('offset',0)!=0:
        raise SarError('calibration_unknown','Non-identity calibration needs a separately verified LUT reader')
    remote=reader.asset(asset['href'])
    if native and pixel_window is None:raise SarError('grid_unknown','Choose an explicit source pixel window; a geographic crop cannot be inferred from GCPs')
    values,valid,grid=read_tiff(remote,bounds,pixel_window=pixel_window if native else None)
    if 'maskAsset' in bandmeta:
        quality,quality_valid,quality_grid=read_tiff(reader.asset(bandmeta['maskAsset']),bounds)
        if quality_grid!=grid or quality.dtype.kind not in 'iu' or not np.isin(quality,bandmeta['maskCodes']).all():
            raise SarError('mask_unknown','RCM quality values or native grid are inconsistent')
        valid &= quality_valid & (quality==bandmeta['validCode'])
    if native:
        valid &= np.isfinite(values)
        promoted=values.astype(np.complex128 if np.iscomplexobj(values) else np.float64)
        db=np.where(valid,np.abs(promoted),np.nan)
    else:db,valid=power_to_db(values,valid,representation)
    p=item.get('properties',{})
    return NativeCrop(db,valid,grid,convention,'native source magnitude (calibration withheld)' if native else 'radar backscatter','source units' if native else 'dB',
        {'sourceId':source,'channel':channel,'recordId':item['id'],'acquiredAt':p.get('datetime') or p.get('start_datetime'),
         'track':p.get('sat:relative_orbit'),'direction':p.get('sat:orbit_state'),'mode':p.get('sar:instrument_mode'),
         'asset':asset['href'],'etag':remote.etag,'sourceBytes':remote.size,'calibration':representation+' '+convention,
         'pixelWindow':pixel_window if native else None,'geolocation':'Source pixel coordinates only; geographic search box does not geocode these samples' if native else 'Declared native affine grid',
         'sourceProcessing':{k:bandmeta.get(k) for k in ('processor','noiseRemovalApplied','sourceFiltering')},
         'quality':bandmeta if 'maskAsset' in bandmeta else 'Source native nodata/internal validity; no invented layover/shadow classification',
         'rights':item.get('license',p.get('license','not specified'))})

def source_window(window,width,height):
    if (not isinstance(window,(tuple,list)) or len(window)!=4 or any(type(v) is not int for v in window) or
        min(window[:2])<0 or min(window[2:])<1 or window[0]+window[2]>width or window[1]+window[3]>height or window[2]*window[3]>MAX_PIXELS):
        raise SarError('pixel_limit','Source pixel window is outside the image or native pixel budget')
    return tuple(window),[window[0],1,0,window[1],0,1]

def read_tiff(remote,bounds,*,pixel_window=None):
    # Rasterio/GDAL lazy TIFF mask scans may hold the Python GIL while waiting
    # for HTTP. A separate decoder keeps the Python range proxy serviceable.
    import io,subprocess,sys
    from service.range_reader import RangeProxy
    with RangeProxy([remote]) as proxy:
        command=[sys.executable,'-m','service.sar.tiff_decoder']
        spec=json.dumps({'url':proxy.vsi_path(0),'bounds':bounds,'pixelWindow':pixel_window})
        try:
            result=subprocess.run(command,input=spec.encode(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                timeout=120,cwd=Path(__file__).resolve().parents[2],check=False)
            proxy.check()
            if result.returncode or len(result.stdout)>12*1024**2:raise SarError('raster_unknown','Native TIFF decoder could not verify this bounded source window')
            with np.load(io.BytesIO(result.stdout),allow_pickle=False) as data:
                values=data['values'];valid=data['valid'];grid=json.loads(str(data['grid'].item()))
            if values.ndim!=2 or values.size>MAX_PIXELS or valid.shape!=values.shape or valid.dtype!=np.bool_:
                raise SarError('raster_unknown','Decoder returned an invalid native raster')
            return values,valid,grid
        except subprocess.TimeoutExpired:raise SarError('raster_timeout','Native TIFF read exceeded its 120-second decoder limit; choose a smaller source window') from None

def decode_tiff_window(url,bounds,pixel_window=None):
    try:
        from osgeo import gdal
        with gdal.config_options({'GDAL_DISABLE_READDIR_ON_OPEN':'EMPTY_DIR','CPL_VSIL_CURL_ALLOWED_EXTENSIONS':'.h5','GDAL_CACHEMAX':'32','GDAL_NUM_THREADS':'1'}):
            ds=gdal.Open(url,gdal.GA_ReadOnly)
            if ds is None or ds.RasterCount!=1:raise SarError('raster_unknown','Expected one science raster band')
            crs=ds.GetProjection();gt=list(ds.GetGeoTransform())
            if pixel_window is not None:
                win,gt=source_window(pixel_window,ds.RasterXSize,ds.RasterYSize);crs='SOURCE_PIXEL_GRID (not geocoded)'
            else:
                if not crs:raise SarError('grid_unknown','Source raster CRS is missing')
                win,gt=affine_window(gt,ds.RasterXSize,ds.RasterYSize,_project(bounds,crs))
            band=ds.GetRasterBand(1);values=band.ReadAsArray(*win);valid=band.GetMaskBand().ReadAsArray(*win)>0
            if pixel_window is None and (band.GetScale() not in (None,1) or band.GetOffset() not in (None,0)):
                raise SarError('calibration_unknown','TIFF calibration scale/offset requires a verified source-specific reader')
            nodata=band.GetNoDataValue()
            if nodata is not None:valid &= values!=nodata
            ds=None
    except ImportError:
        import rasterio
        from rasterio.windows import Window
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.h5',GDAL_CACHEMAX=32*1024**2,GDAL_NUM_THREADS='1'):
            with rasterio.open(url) as ds:
                if ds.count!=1:raise SarError('grid_unknown','Expected one science band')
                if pixel_window is None and (ds.scales!=(1.0,) or ds.offsets!=(0.0,)):
                    raise SarError('calibration_unknown','TIFF calibration scale/offset requires a verified source-specific reader')
                if pixel_window is not None:
                    win,gt=source_window(pixel_window,ds.width,ds.height);crs='SOURCE_PIXEL_GRID (not geocoded)'
                else:
                    if ds.crs is None:raise SarError('grid_unknown','Expected a declared native CRS')
                    crs=ds.crs.to_wkt();win,gt=affine_window(list(ds.transform.to_gdal()),ds.width,ds.height,_project(bounds,crs))
                values=ds.read(1,window=Window(*win));valid=ds.read_masks(1,window=Window(*win))>0
    return values,valid,{'width':values.shape[1],'height':values.shape[0],'crs':crs,'transform':gt}

def re_channel(text,channel):
    import re
    return re.search(r'(?<![A-Za-z])'+re.escape(channel)+r'(?![A-Za-z])',text,re.I) is not None

def read_nisar(item,bounds,channel,operation,netrc,reader):
    from service.range_reader import RemoteAsset,authenticated_opener,RangeFile
    from service.gunw_reader import BlockRangeFile
    import h5py
    p=item['properties'];url=p.get('url')
    if operation=='los-displacement' and (channel!='HH' or p.get('processingLevel')!='GUNW'):
        raise SarError('unsupported_product','LOS processing requires a supported HH GUNW product')
    if operation!='los-displacement' and (p.get('processingLevel')!='GCOV' or channel!='HH'):
        raise SarError('unsupported_product','This verified GCOV mask reader currently supports Frequency A HH only; use the separate GOFF/GSLC product reader')
    remote=StableAsset(url,authenticated_opener(Path(netrc)),reader.budget)
    if operation=='los-displacement':
        with h5py.File(BlockRangeFile(remote),'r') as h5:
            return read_gunw(h5,p,bounds,remote)
    if p.get('processingLevel')!='GCOV' or channel!='HH':raise SarError('unsupported_product','This verified GCOV mask reader currently supports Frequency A HH only')
    from service.processing import inspect_metadata,compare_arrays
    meta=inspect_metadata(remote,p,file_reader=BlockRangeFile)
    path='/science/LSAR/GCOV/grids/frequencyA'
    with h5py.File(BlockRangeFile(remote),'r') as h5:
        g=h5[path];gt=[meta['xCoordinates']['0']-meta['xSpacing']/2,meta['xSpacing'],0,meta['yCoordinates']['0']-meta['ySpacing']/2,0,meta['ySpacing']]
        win,gt=affine_window(gt,meta['shape'][1],meta['shape'][0],_project(bounds,'EPSG:'+str(meta['epsg'])))
        x,y,w,h=win;sel=np.s_[y:y+h,x:x+w]
        power=g['HHHH'][sel];mask=g['mask'][sel];exception=g['inputDataExceptionMask'][sel]
    # Reuse the existing authoritative mask/exception implementation, including its schema-specific focus bits.
    result=compare_arrays(power,power,mask,mask,before_fill=meta['powerAttributes'].get('_FillValue'),
        after_fill=meta['powerAttributes'].get('_FillValue'),before_exception=exception,after_exception=exception)
    valid=result[3]
    db=np.full(power.shape,np.nan);db[valid]=10*np.log10(power[valid].astype(np.float64))
    return NativeCrop(db,valid,{'width':w,'height':h,'crs':'EPSG:'+str(meta['epsg']),'transform':gt},'gamma0','radar backscatter','dB',
        {'sourceId':'nisar','channel':channel,'track':meta['trackNumber'],'direction':meta['orbitPassDirection'],'mode':meta['frequencyModes'],
         'recordId':p['fileID'],'acquiredAt':meta['zeroDopplerStartTime'].removesuffix('Z')+'Z','metadata':meta,'etag':remote.etag,'sourceBytes':remote.size,
         'sourceProcessing':{k:meta[k] for k in ('productVersion','productSpecificationVersion','compositeReleaseId')}})

def read_gunw(h5,catalog,bounds,remote):
    """Bounded single-pair LOS only; no height-dependent geometry or atmosphere is inferred."""
    from service.gunw_reader import validate_structure,GRID,IDENT,FREQ,POLARIZATION,LAYERS
    from service.ground_motion import largest_component,valid_sample_mask,phase_to_los_mm,reference_to
    for parent,names in ((IDENT,('productType','productSpecificationVersion','radarBand','isGeocoded','listOfFrequencies',
        'orbitPassDirection','granuleId','trackNumber','frameNumber','referenceZeroDopplerStartTime','secondaryZeroDopplerStartTime','productVersion')),
        (FREQ,('listOfPolarizations','centerFrequency'))):
        for name in names:
            key=parent+'/'+name
            if key not in h5 or h5[key].size>64 or h5[key].dtype.itemsize*h5[key].size>8192 or h5[key].dtype.kind=='O':
                raise SarError('metadata_unknown','GUNW identification must use bounded fixed-width native metadata')
    facts=validate_structure(h5)
    try:
        from osgeo import osr
        crs=osr.SpatialReference();crs.ImportFromEPSG(facts['epsg'])
        metric=bool(crs.IsProjected()) and math.isclose(crs.GetLinearUnits(),1,rel_tol=0,abs_tol=1e-12)
    except ImportError:
        from rasterio.crs import CRS
        crs=CRS.from_epsg(facts['epsg'])
        metric=crs.is_projected and math.isclose(crs.linear_units_factor[1],1,rel_tol=0,abs_tol=1e-12)
    if not metric:raise SarError('grid_unknown','GUNW 80-metre grid requires a projected CRS in metres')
    if facts['granule']!=catalog.get('sceneName'):
        raise SarError('source_identity','GUNW file identity disagrees with the exact catalog record')
    g=h5[GRID];pol=g[POLARIZATION];ident=h5[IDENT]
    for name in ('coherenceMagnitude','connectedComponents'):
        unit=pol[name].attrs.get('units','')
        if (unit.decode() if isinstance(unit,bytes) else str(unit))!='1':
            raise SarError('mask_unknown','GUNW coherence and component units must be dimensionless')
    def text(name):
        v=ident[name][()]
        return v.decode() if isinstance(v,bytes) else str(v)
    reference,secondary=text('referenceZeroDopplerStartTime'),text('secondaryZeroDopplerStartTime')
    # NISAR identification UTC fields omit the zone by producer convention.
    def utc(value):
        import re
        return acquisition_time(value if re.search(r'(Z|[+-]\d{2}:\d{2})$',value) else value+'Z')
    if utc(reference)>=utc(secondary):raise SarError('chronology','GUNW reference must precede secondary acquisition')
    if (str(facts['track'])!=str(catalog.get('pathNumber')) or str(facts['frame'])!=str(catalog.get('frameNumber')) or
        text('orbitPassDirection').casefold()!=str(catalog.get('flightDirection')).casefold()):
        raise SarError('source_identity','GUNW track, frame or direction disagrees with catalog')
    width,height=g['xCoordinates'].size,g['yCoordinates'].size
    if not width or not height:raise SarError('grid_unknown','Empty GUNW axes')
    x0,y0=float(g['xCoordinates'][0]),float(g['yCoordinates'][0])
    win,gt=affine_window([x0-40,80,0,y0+40,0,-80],width,height,_project(bounds,'EPSG:'+str(facts['epsg'])))
    x,y,w,h=win;sel=np.s_[y:y+h,x:x+w]
    # Verify every selected center, plus the outer endpoints, before reading science arrays.
    for name,start,count,origin,step,total in (('xCoordinates',x,w,x0,80,width),('yCoordinates',y,h,y0,-80,height)):
        axis=g[name]
        if (axis.ndim!=1 or not np.allclose(axis[start:start+count],origin+step*np.arange(start,start+count),rtol=0,atol=1e-6) or
            not math.isclose(float(axis[-1]),origin+step*(total-1),rel_tol=0,abs_tol=1e-6)):
            raise SarError('grid_unknown','GUNW selected coordinate grid is irregular')
    if (g['mask'].dtype!=np.dtype('uint32') or pol['connectedComponents'].dtype!=np.dtype('uint16') or
        any(pol[n].dtype.kind!='f' for n in ('unwrappedPhase','coherenceMagnitude','ionospherePhaseScreen'))):
        raise SarError('mask_unknown','Unsupported GUNW science or quality encoding')
    layers={n:pol[n][sel] for n in LAYERS};mask=g['mask'][sel]
    usable=np.ones((h,w),bool)
    for name,data in layers.items():
        usable &= np.isfinite(data)
        fill=pol[name].attrs.get('_FillValue')
        if fill is not None:usable &= data!=fill
    components=layers['connectedComponents'];coherence=layers['coherenceMagnitude']
    usable &= (components>0)&(components<65535)&(coherence>=.6)&(coherence<=1)&valid_sample_mask(mask)
    # Reject reserved bits and invalid subswath digits rather than treating them as land.
    low=mask&255
    usable &= ((mask>>25)==0)&(((low//10)%10)<=3)&((low%10)<=3)
    valid=largest_component(components,usable)
    values,ref=reference_to(phase_to_los_mm(layers['unwrappedPhase'],facts['wavelength_m'],[layers['ionospherePhaseScreen']]),valid)
    return NativeCrop(values,valid,{'width':w,'height':h,'crs':'EPSG:'+str(facts['epsg']),'transform':gt},'LOS toward radar','relative line-of-sight displacement','mm',
        {'sourceId':'nisar','recordId':catalog['fileID'],'channel':'HH','granule':facts['granule'],'specification':facts['spec_version'],
         'referenceDate':reference,'secondaryDate':secondary,'reference':'Median of quality-valid pixels in selected crop','referenceMm':float(ref),
         'wavelengthM':facts['wavelength_m'],'coherenceMinimum':.6,'ionosphereApplied':True,'troposphereApplied':False,
         'etag':remote.etag,'sourceBytes':remote.size,
         'notice':'Single-pair relative LOS; phase-sign convention needs independent source validation. No vertical motion, annual rate or structural safety.'})
