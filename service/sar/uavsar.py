"""Annotation-led, bounded UAVSAR calibrated diagonal GRD reader."""
import math
import re
import numpy as np
from urllib.parse import urlsplit
from service.range_reader import RemoteAsset,authenticated_opener
from .net import SarError,vetted,StableAsset
from .native import NativeCrop,affine_window,power_to_db

def annotation(text):
    result={}
    for line in text.splitlines():
        line=line.split(';',1)[0].strip()
        if not line or '=' not in line:continue
        key,value=line.split('=',1)
        key=re.sub(r'\s*\([^)]*\)\s*$','',key).strip()
        if key in result:raise SarError('annotation_unknown','Duplicate UAVSAR annotation key')
        result[key]=value.strip()
    return result

def geometry(meta):
    try:
        rows=int(meta['grd_mag.set_rows']);cols=int(meta['grd_mag.set_cols'])
        lat=float(meta['grd_mag.row_addr']);lon=float(meta['grd_mag.col_addr'])
        dy=float(meta['grd_mag.row_mult']);dx=float(meta['grd_mag.col_mult'])
        if not(0<rows<=200000 and 0<cols<=200000 and -180<=lon<=180 and -90<=lat<=90 and dx>0 and dy<0 and all(math.isfinite(v) for v in (lat,lon,dx,dy))):raise ValueError()
        return rows,cols,[lon,dx,0,lat,0,dy]
    except (KeyError,TypeError,ValueError):raise SarError('annotation_unknown','UAVSAR native grid metadata is missing or unsupported') from None

def read_uavsar(item,bounds,channel,reader,netrc):
    from .jobs import uavsar_inputs
    if channel not in ('HH','HV','VV'):raise SarError('unsupported_channel','Only documented diagonal UAVSAR GRD power channels are supported')
    links=uavsar_inputs(item,channel)
    if links is None:raise SarError('native_assets_missing','Original numeric UAVSAR GRD and annotation links are required')
    def asset(url):
        if urlsplit(url).hostname=='cumulus.asf.earthdatacloud.nasa.gov':
            return StableAsset(url,authenticated_opener(netrc),reader.budget)
        return reader.asset(url)
    ann=asset(links['annotation']);size=ann.length()
    if size>256*1024:raise SarError('annotation_limit','UAVSAR annotation exceeds its metadata cap')
    raw=ann.fetch(0,size-1)
    try:meta=annotation(raw.decode('ascii'))
    except UnicodeError:raise SarError('annotation_unknown','UAVSAR annotation must be ASCII') from None
    rows,cols,gt=geometry(meta)
    if meta.get('GRD Data Units')!='linear power' or meta.get('grd_pwr.val_size')!='4' or meta.get('grd_pwr.val_frmt')!='REAL*4' or meta.get('grd_pwr.set_proj')!='EQA':
        raise SarError('representation_unknown','Original annotation must declare equiangular real float32 linear-power GRD data')
    if meta.get('Antenna Pattern Calibration Applied','').split()[0:1]!=['Yes']:
        raise SarError('calibration_unknown','UAVSAR annotation does not confirm radiometric antenna calibration')
    declared=meta.get('grd'+channel+channel)
    if declared!=urlsplit(links['grid']).path.rsplit('/',1)[-1]:raise SarError('source_identity','UAVSAR annotation does not name the selected numeric grid')
    grid=asset(links['grid'])
    if grid.length()!=rows*cols*4:raise SarError('representation_unknown','UAVSAR diagonal GRD must contain little-endian float32 power on the declared grid')
    win,gt=affine_window(gt,cols,rows,bounds)
    x,y,w,h=win
    if h>2048:raise SarError('request_limit','Choose a shorter UAVSAR native window')
    values=np.empty((h,w),dtype=np.float32)
    for row in range(h):
        start=((y+row)*cols+x)*4
        values[row]=np.frombuffer(grid.fetch(start,start+w*4-1),dtype='<f4')
    db,valid=power_to_db(values,np.isfinite(values)&(values>0),'power')
    p=item['properties']
    return NativeCrop(db,valid,{'width':w,'height':h,'crs':'EPSG:4326','transform':gt},'producer-calibrated GRD power; source-defined area normalization','radar backscatter','dB',
        {'sourceId':'uavsar','recordId':p['fileID'],'channel':channel,'acquiredAt':p.get('startTime'),
         'track':'_'.join(p['fileID'].split('_')[:2]),'direction':meta.get('Look Direction'),'mode':meta.get('Acquisition Mode'),
         'sourceProcessing':{k:meta.get(k) for k in ('Processor Version Number','Area Normalized','Slope Calibration in GRD','Cross Talk Removed','RFI removed')},
         'annotationUrl':links['annotation'],'annotationSha256':__import__('hashlib').sha256(raw).hexdigest(),
         'asset':links['grid'],'etag':grid.etag,'sourceBytes':grid.size,'calibration':'Producer-calibrated diagonal GRD power, little-endian float32; sigma0/gamma0 equivalence is not asserted',
         'pixelRegistration':'Producer GRD annotation upper-left and degree increments',
         'quality':'Finite positive diagonal power; additional interpretation requires source quality review'})
