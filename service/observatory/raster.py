"""Windowed COG measurements, exact integer aggregation and recorded AOI masks.

GDAL reads through a range-only loopback proxy with one shared transfer budget.
No remote full-granule download, display reprojection or arbitrary URL is accepted.
"""
import hashlib
from http.cookiejar import CookieJar
import json
import math
import netrc
from urllib import request as http
from urllib.parse import urlsplit, urljoin
import numpy as np
from ..range_reader import RemoteAsset, RangeProxy, RangeError, TransferBudget
from .geometry import unwrapped_geojson, polygons
from .methods import (array_hash, nd_index, sentinel_valid, hls_valid, landsat_valid, dswx_valid, landsat_kelvin, summary, common_difference)
from .dswx_schema import validate_header, UNSUPPORTED_MESSAGE, QUALITY_NOTE

ASSET_HOSTS = frozenset({'sentinel-cogs.s3.us-west-2.amazonaws.com', 'sentinel2-c1-l2a.s3.eu-central-1.amazonaws.com', 'e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com',
    'usgs-landsat.s3.us-west-2.amazonaws.com', 'data.lpdaac.earthdatacloud.nasa.gov', 'lpdaac.earthdata.nasa.gov',
    'opera-dswx-s1.s3.us-west-2.amazonaws.com', 'opera-pst-rs-pop1.s3.us-west-2.amazonaws.com',
    'podaac-ops-cumulus-protected.s3.us-west-2.amazonaws.com', 'podaac-ops-cumulus-public.s3.us-west-2.amazonaws.com', 'archive.podaac.earthdata.nasa.gov'})
# Exact PO.DAAC distribution documented by NASA SWOT access guidance; redirect only.
REDIRECT_HOSTS = ASSET_HOSTS | {'urs.earthdata.nasa.gov','deotb6e7tfubr.cloudfront.net'}

def validate_asset(url, *, redirect=False):
    try:
        p=urlsplit(url)
        if p.hostname == 'landsateuwest.blob.core.windows.net':
            from .planetary import canonical_asset,validate_signed_asset
            canonical_asset(url)
            if p.query: validate_signed_asset(url)
            return url
        if p.scheme!='https' or p.hostname not in (REDIRECT_HOSTS if redirect else ASSET_HOSTS) or p.username or p.password or p.port not in (None,443) or p.fragment or (p.query and not redirect): raise ValueError()
        if not p.path.startswith('/'): raise ValueError()
    except (ValueError,TypeError):raise RangeError('UNSAFE_ASSET','Raster asset is outside the exact HTTPS source allowlist') from None
    return url

class Redirect(http.HTTPRedirectHandler):
    def http_error_302(self,req,fp,code,msg,headers):
        location=headers.get('Location')
        fp.close()
        if not location: raise RangeError('SOURCE_HTTP','Missing asset redirect')
        new=urljoin(req.full_url,location);validate_asset(new,redirect=True)
        depth=getattr(req,'_depth',0)+1
        if depth>5: raise RangeError('SOURCE_HTTP','Too many asset redirects')
        result=self.redirect_request(req,fp,code,msg,headers,new)
        result.remove_header('Authorization');result.remove_header('Cookie');result._depth=depth
        return self.parent.open(result,timeout=req.timeout)
    http_error_301=http_error_303=http_error_307=http_error_308=http_error_302

class EarthdataAuth(http.HTTPBasicAuthHandler):
    """Explicit host boundary, including preemptive requests and challenges."""
    def http_request(self,req):
        if urlsplit(req.full_url).hostname != 'urs.earthdata.nasa.gov':
            req.remove_header('Authorization')
            return req
        return super().http_request(req)
    https_request=http_request
    def http_error_401(self,req,fp,code,msg,headers):
        if urlsplit(req.full_url).hostname != 'urs.earthdata.nasa.gov': return None
        return super().http_error_401(req,fp,code,msg,headers)

def opener(path):
    handlers=[http.ProxyHandler({}),Redirect(),http.HTTPCookieProcessor(CookieJar())]
    try:
        auth=netrc.netrc(str(path)).authenticators('urs.earthdata.nasa.gov')
        if auth:
            manager=http.HTTPPasswordMgrWithPriorAuth();manager.add_password(None,'https://urs.earthdata.nasa.gov',auth[0],auth[2],is_authenticated=True)
            handlers.append(EarthdataAuth(manager))
    except (OSError,netrc.NetrcParseError):pass  # Public assets remain usable; protected source errors stay explicit.
    return http.build_opener(*handlers)

def _runtime():
    try:
        from osgeo import gdal,ogr,osr
    except ImportError:raise RangeError('RASTER_RUNTIME','Native GDAL is required for bounded raster measurements') from None
    gdal.UseExceptions();gdal.SetCacheMax(16*1024*1024)
    gdal.SetConfigOption('GDAL_DISABLE_READDIR_ON_OPEN','EMPTY_DIR');gdal.SetConfigOption('GDAL_PAM_ENABLED','NO')
    gdal.SetConfigOption('CPL_VSIL_CURL_USE_HEAD','YES');gdal.SetConfigOption('GDAL_HTTP_TIMEOUT','30')
    gdal.SetConfigOption('GDAL_NUM_THREADS','1');gdal.SetConfigOption('VSI_CACHE','FALSE')
    return gdal,ogr,osr

def _metric(id,label,value,unit,total,description):
    return dict(id=id,label=label,value=value,unit=unit,evidenceIds=[],description=description,denominator=f'{total} AOI pixel centres on the recorded grid')

def _validate_dswx_domain(values, selected):
    """Check raw native pixels on selected support, before masks/statistics."""
    if (values.ndim != 2 or values.shape != selected.shape
            or selected.dtype != np.bool_
            or not np.isin(values[selected], (0,1,2,252,253,254,255)).all()):
        raise RangeError('UNSUPPORTED_RASTER',UNSUPPORTED_MESSAGE)

def crop_bands(assets,area,config,budget=None,kind='sentinel'):
    # Bound projection densification before any provider connection or large allocation.
    perimeter=sum(math.dist(a,b) for p in polygons(area) for r in p for a,b in zip(r,r[1:]))
    if perimeter/.001>8192:raise RangeError('CROP_LIMIT','Area perimeter exceeds the bounded projection support; select a smaller crop')
    gdal,ogr,osr=_runtime()
    required={'sentinel':{'red','nir','swir','qa'},'hls':{'red','nir','swir','qa'},'landsat':{'temperature','qa'},'dswx':{'water'}}
    extras={'st_qa','cloud_distance','radsat'} if kind=='landsat' else set()
    if kind not in required or not required[kind]<=set(assets) or not set(assets)<=required[kind]|extras:raise RangeError('UNSUPPORTED_MASK','Required analytical bands and documented quality layer are missing')
    budget=budget or TransferBudget(config.transfer_bytes)
    metadata={k:({'href':v} if isinstance(v,str) else v) for k,v in assets.items()}
    for m in metadata.values():validate_asset(m.get('href'))
    transport=opener(config.netrc);names=list(metadata)
    remotes=[RemoteAsset(metadata[n]['href'],transport,budget,validator=validate_asset) for n in names]
    with RangeProxy(remotes) as proxy:
        try:
            datasets={n:gdal.OpenEx(proxy.vsi_path(i),gdal.OF_RASTER,allowed_drivers=['GTiff']) for i,n in enumerate(names)}
        except RuntimeError:
            proxy.check()
            raise RangeError('UNSUPPORTED_RASTER','The range source was not readable with the verified GeoTIFF driver') from None
        proxy.check()
        schema_required=kind=='dswx' and 'expectedProcessingVersion' in metadata['water']
        if any(ds is None or ds.RasterCount!=1 for ds in datasets.values()):raise RangeError('UNSUPPORTED_RASTER',UNSUPPORTED_MESSAGE if schema_required else 'Only verified single-band GeoTIFF layers are supported')
        try:
            refs={n:ds.GetSpatialRef() for n,ds in datasets.items()};transforms={n:ds.GetGeoTransform() for n,ds in datasets.items()}
        except (ValueError,TypeError,AttributeError,RuntimeError,OverflowError):
            if schema_required:raise RangeError('UNSUPPORTED_RASTER',UNSUPPORTED_MESSAGE) from None
            raise
        schema_receipt=None
        if schema_required:
            # Header witness precedes all ReadAsArray calls, including AOI mask.
            try:
                ds=datasets['water'];band=ds.GetRasterBand(1);table=band.GetColorTable();r=refs['water']
                palette_count=table.GetCount() if table is not None else 0
                if not 5<=palette_count<=256:raise ValueError(UNSUPPORTED_MESSAGE)
                schema_receipt=validate_header(ds.GetMetadata(),band.GetDescription(),gdal.GetDataTypeName(band.DataType),band.GetNoDataValue(),
                    [table.GetColorEntry(i) for i in range(palette_count)],metadata['water']['expectedProcessingVersion'],
                    bool(r.IsProjected()) if r is not None else False,r.GetLinearUnits() if r is not None else None,transforms['water'])
                if 'nodata' in metadata['water'] and (type(metadata['water']['nodata']) not in (int,float) or metadata['water']['nodata']!=255):raise ValueError(UNSUPPORTED_MESSAGE)
            except (ValueError,TypeError,AttributeError,RuntimeError,OverflowError):
                raise RangeError('UNSUPPORTED_RASTER',UNSUPPORTED_MESSAGE) from None
        ref=next(iter(refs.values()))
        if ref is None or not ref.IsProjected() or abs(ref.GetLinearUnits()-1)>1e-8:raise RangeError('UNSUPPORTED_GRID','Measurements require a projected grid in metres')
        if any(r is None or not ref.IsSame(r) for r in refs.values()):raise RangeError('INCOMPATIBLE_GRID','Analytical bands use different coordinate reference systems')
        if any(t[2]!=0 or t[4]!=0 or t[1]<=0 or t[5]>=0 for t in transforms.values()):raise RangeError('UNSUPPORTED_GRID','Rotated or unsupported raster grids are rejected')
        coarse=max(names,key=lambda n:abs(transforms[n][1]));base=transforms[coarse];resolution=base[1]
        if abs(resolution+base[5])>1e-6:raise RangeError('UNSUPPORTED_GRID','Square metric pixels are required')
        factors={}
        for n,t in transforms.items():
            ratio=resolution/t[1];factor=round(ratio)
            if not 1<=factor<=6 or abs(ratio-factor)>1e-6 or abs(t[1]+t[5])>1e-6 or abs((base[0]-t[0])/t[1]-round((base[0]-t[0])/t[1]))>1e-6 or abs((base[3]-t[3])/t[5]-round((base[3]-t[3])/t[5]))>1e-6:raise RangeError('INCOMPATIBLE_GRID','Band grids must be integer aligned for exact aggregation')
            if n in ('qa','radsat') and factor!=1:raise RangeError('UNSUPPORTED_MASK','Categorical quality masks must be native on the target grid')
            factors[n]=factor
        wgs=osr.SpatialReference();wgs.ImportFromEPSG(4326);wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER);ref.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        shape=ogr.CreateGeometryFromJson(json.dumps(unwrapped_geojson(area)))
        # Densify geographic edges before projection, independently of display simplification.
        shape.Segmentize(.001);shape.Transform(osr.CoordinateTransformation(wgs,ref))
        envelope=shape.GetEnvelope();xoff=math.floor((envelope[0]-base[0])/resolution);yoff=math.floor((envelope[3]-base[3])/base[5])
        width=math.ceil((envelope[1]-base[0])/resolution)-xoff;height=math.ceil((envelope[2]-base[3])/base[5])-yoff
        if width<=0 or height<=0 or width*height*max(factors.values())**2>config.max_pixels:raise RangeError('CROP_LIMIT','Native crop exceeds the one-million-pixel limit; select a smaller area')
        transform=(base[0]+xoff*resolution,resolution,0,base[3]+yoff*base[5],0,base[5])
        mask_ds=gdal.GetDriverByName('MEM').Create('',width,height,1,gdal.GDT_Byte);mask_ds.SetGeoTransform(transform);mask_ds.SetProjection(ref.ExportToWkt())
        vector=ogr.GetDriverByName('Memory').CreateDataSource('');layer=vector.CreateLayer('area',srs=ref,geom_type=ogr.wkbMultiPolygon);feature=ogr.Feature(layer.GetLayerDefn());feature.SetGeometry(shape);layer.CreateFeature(feature)
        gdal.RasterizeLayer(mask_ds,[1],layer,burn_values=[1]);area_mask=mask_ds.ReadAsArray().astype(bool);total=int(area_mask.sum())
        if not total:raise RangeError('EMPTY_AREA','No native pixel centre falls inside the selected polygon')
        arrays={};finite={};hashes={}
        for n,ds in datasets.items():
            t=transforms[n];f=factors[n];sx=round((transform[0]-t[0])/t[1]);sy=round((transform[3]-t[3])/t[5]);fw,fh=width*f,height*f
            band=ds.GetRasterBand(1);nodata=metadata[n].get('nodata',band.GetNoDataValue())
            raw=np.full((fh,fw),np.nan,dtype=np.float32);left,top=max(0,sx),max(0,sy);right,bottom=min(ds.RasterXSize,sx+fw),min(ds.RasterYSize,sy+fh)
            if right>left and bottom>top:
                value=band.ReadAsArray(left,top,right-left,bottom-top)
                proxy.check()
                if value is None:raise RangeError('SOURCE_HTTP','The native raster window could not be read')
                if schema_receipt is not None:
                    # One 30 m categorical layer has factor 1; padding outside
                    # source extent is unavailable support, not source classes.
                    _validate_dswx_domain(value,area_mask[top-sy:bottom-sy,left-sx:right-sx])
                raw[top-sy:bottom-sy,left-sx:right-sx]=value
            valid=np.isfinite(raw)
            if nodata is not None:valid &= raw!=nodata
            hashes[n]=array_hash(raw);hashes[n+'Mask']=array_hash(valid.astype(np.uint8))
            raw[~valid]=np.nan
            if f>1:
                blocks=raw.reshape(height,f,width,f);block_valid=valid.reshape(height,f,width,f).all(axis=(1,3));raw=blocks.mean(axis=(1,3));valid=block_valid
            if n not in ('qa','water','radsat'):
                scale=metadata[n].get('scale');offset=metadata[n].get('offset')
                if n in ('st_qa','cloud_distance') and (scale!=.01 or offset!=0):raise RangeError('UNSUPPORTED_SCALE','Ancillary calibration must be verified at 0.01 with zero offset')
                if kind in ('sentinel','hls') and (scale is None or offset is None):raise RangeError('UNSUPPORTED_SCALE','Reflectance scale and offset must be verified from source asset metadata')
                if scale is not None:
                    if not isinstance(scale,(float,int)) or not math.isfinite(scale) or not isinstance(offset,(float,int)) or not math.isfinite(offset):raise RangeError('UNSUPPORTED_SCALE','Unsupported source calibration')
                    raw=raw.astype(np.float64)*scale+offset
                elif n=='temperature':raw=landsat_kelvin(raw)
            arrays[n]=raw;finite[n]=valid & area_mask
        all_valid=area_mask.copy()
        for v in finite.values():all_valid &= v
        metrics=[];analytical={};valid_masks={};quality_notes=[]
        if schema_receipt is not None:
            hashes['waterSourceSchema']=schema_receipt['receiptHash'];quality_notes.append(QUALITY_NOTE)
        if kind in ('sentinel','hls'):
            all_valid &= (hls_valid if kind=='hls' else sentinel_valid)(np.nan_to_num(arrays['qa'],nan=255))
            for id,label,a,b in [('ndvi','NDVI','nir','red'),('ndmi','NDMI','nir','swir')]:
                values,valid=nd_index(arrays[a],arrays[b],all_valid);stat=summary(values,valid,total)
                analytical[id]=values;valid_masks[id]=valid
                metrics.append(_metric(id+'-median',f'Median {label}',stat['median'],'index',total,'Quality-masked normalized reflectance difference; not biodiversity or a cause diagnosis. '+stat['scope']))
        elif kind=='landsat':
            all_valid &= landsat_valid(np.nan_to_num(arrays['qa'],nan=1)) & (arrays['temperature']>149)
            if 'radsat' in arrays:
                # L8/9 bit11 is terrain occlusion. Optical saturation flags
                # do not by themselves document saturation of thermal band10.
                all_valid &= (np.nan_to_num(arrays['radsat'],nan=2048).astype(np.uint16)&2048)==0
                quality_notes.append('QA_RADSAT bit 11 terrain occlusion excluded; optical saturation flags are not treated as thermal saturation.')
            else:quality_notes.append('QA_RADSAT not supplied: terrain-occlusion check unavailable.')
            for name,unit in [('st_qa','K'),('cloud_distance','km')]:
                if name in arrays:
                    all_valid &= arrays[name]>=0
                else:quality_notes.append(name+' not supplied: ancillary source-quality summary unavailable.')
            values=arrays['temperature'];stat=summary(values,all_valid,total);analytical['temperature']=values;valid_masks['temperature']=all_valid
            metrics.append(_metric('surface-temperature-median','Median surface temperature',stat['median'],'K',total,'Landsat surface retrieval, distinct from air temperature and personal heat exposure. '+stat['scope']))
            for name,unit in [('st_qa','K'),('cloud_distance','km')]:
                if name in arrays:
                    s=summary(arrays[name],all_valid,total)
                    if s['count']:
                        quality_notes.append(f'{name}: source ancillary median {s["median"]:.5g} {unit}; p95 {s["p95"]:.5g} {unit} over the retained temperature population. Scale 0.01, offset 0. No arbitrary uncertainty/cloud-distance cutoff imposed.')
            quality_notes.append('ST_QA describes source retrieval uncertainty per pixel; its spatial median is not a confidence interval for the area median.')
        else:
            all_valid &= dswx_valid(arrays['water']);analytical['water']=arrays['water'];valid_masks['water']=all_valid
            for cls,id,label in [(1,'water-area','Class-1 water mapped footprint'),(2,'partial-water-area','Class-2 partial-water pixel footprint')]:
                count=int(np.count_nonzero(all_valid&(arrays['water']==cls)))
                metrics.append(_metric(id,label,count*resolution**2/1e6,'km²',total,'Native classified pixel footprint; no accuracy-adjusted area estimate. Class 2 is not fractional open-water area.'))
        valid_union=np.logical_and.reduce(list(valid_masks.values()));count=int(valid_union.sum())
        if not count:
            for metric in metrics:metric['value']=None
        grid={'crs':ref.ExportToWkt(),'resolution':resolution,'transform':list(transform),'width':width,'height':height,'aggregation':{n:factors[n] for n in names},'aoiPolicy':'Pixel centres, holes excluded; geographic edges densified at 0.001 degrees before projection'}
        hashes['aoiMask']=array_hash(area_mask.astype(np.uint8));hashes['validMask']=array_hash(valid_union.astype(np.uint8));hashes['grid']=hashlib.sha256(json.dumps(grid,sort_keys=True).encode()).hexdigest()
        datasets.clear();mask_ds=None;vector=None;proxy.check()
        return {'metrics':metrics,'coveragePercent':100*count/total,'totalPixels':total,'validPixels':count,'hashes':hashes,'grid':grid,'qualityNotes':quality_notes,'maskPolicy':{'sentinel':'SCL classes 4/5/6; all required bands finite/nonfill; exact integer block averages with all contributing pixels valid','hls':'HLS v2 Fmask bits 0–4 clear, high aerosol and fill excluded; all reflectance bands finite/nonfill; native 30m grid','landsat':'QA_PIXEL bits 0–5 clear; supplied QA_RADSAT bit11 clear; ancillary nonfill/nonnegative where supplied; no uncertainty/cloud-distance cutoff; no air-temperature inference','dswx':'DSWx classes 0/1/2 valid; other mask/snow/cloud/no-data classes excluded'}[kind], '_arrays':analytical,'_valid':valid_masks,'_area':area_mask}

def compare_crops(before,after,kind):
    if any(before['grid'][k]!=after['grid'][k] for k in ('crs','resolution','transform','width','height')):raise RangeError('INCOMPATIBLE_GRID','Comparison requires the same native target grid; no date-to-date resampling fallback')
    result={};metrics=[]
    for name in before['_arrays']:
        b,a=before['_arrays'][name],after['_arrays'][name];bv,av=before['_valid'][name],after['_valid'][name]
        if kind=='dswx':
            common=bv&av&before['_area'];total=int(before['_area'].sum());n=int(common.sum())
            if not n:raise RangeError('EMPTY_COMMON','No common valid water pixels')
            value=(int(np.count_nonzero(common&(a==1)))-int(np.count_nonzero(common&(b==1))))*before['grid']['resolution']**2/1e6
            stat={'coveragePercent':100*n/total,'count':n,'total':total,'median':value,'scope':'valid subset only; whole-area interpretation withheld','maskHash':array_hash(common.astype(np.uint8))}
            metrics.append(_metric('water-area-change','Common-valid class-1 water footprint change',value,'km²',total,'After minus before in the same observed population; mapped area, not validated area. '+stat['scope']))
        else:
            stat=common_difference(b,a,bv,av,before['_area']);unit='K' if name=='temperature' else 'index'
            metrics.append(_metric(name+'-difference',f'Median common-valid {name} difference',stat['median'],unit,stat['total'],'Median of pixelwise after-minus-before differences on the recorded common valid mask. '+stat['scope']))
        result[name]=stat
    return {'metrics':metrics,'comparisons':result,'coveragePercent':min(v['coveragePercent'] for v in result.values()),'hashes':{name+'CommonMask':s['maskHash'] for name,s in result.items()}}
