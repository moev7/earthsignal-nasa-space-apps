"""Shared-queue SAR study contract, native computation and independent publication checks."""
from datetime import datetime,timezone
from pathlib import Path
import hashlib
import json
import math
import re
from .catalog import SOURCES,bbox,resolve,ACCESS,native_assets
from .net import SarError,PublicReader,digest

KIND='sar-study'
METHOD='native-sar-study-2'
ARTIFACTS={'manifest.json','values.json','preview.png','provenance.json'}
OPERATIONS=('native-observation','backscatter-observation','backscatter-change','los-displacement','pixel-offset')
MAX_FILE=8*1024**2

def validate_request(r):
    if (type(r) is not dict or set(r)-{'pixelWindow','component','layer'}!={'schemaVersion','sourceId','operation','recordIds','bbox','channel'} or
        r['schemaVersion']!='1.0' or r['sourceId'] not in SOURCES or r['operation'] not in OPERATIONS or
        r['channel'] not in ('HH','HV','VH','VV','CH','CV','RR','RL')):
        raise SarError('invalid_request','Unsupported SAR study request')
    ids=r['recordIds'];n=2 if r['operation']=='backscatter-change' else 1
    if type(ids) is not list or len(ids)!=n or any(not isinstance(v,str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,240}',v) for v in ids) or len(set(ids))!=n:
        raise SarError('invalid_request','Choose the required number of distinct exact records')
    if r['operation']=='los-displacement' and r['sourceId']!='nisar':
        raise SarError('invalid_request','The verified LOS reader supports NISAR GUNW only')
    if r['operation']=='pixel-offset':
        if r['sourceId']!='nisar' or r.get('component','slant-range') not in ('slant-range','along-track') or type(r.get('layer',1)) is not int or not 1<=r.get('layer',1)<=3:
            raise SarError('invalid_request','Choose a NISAR GOFF component and layer 1..3')
    elif 'component' in r or 'layer' in r:
        raise SarError('invalid_request','Offset component and layer apply to GOFF only')
    if r['operation']=='native-observation' and r['sourceId']!='radarsat-1':
        raise SarError('invalid_request','Native source-value inspection is supported for RADARSAT-1 products')
    if r['operation']=='native-observation' and 'pixelWindow' not in r:
        raise SarError('invalid_request','Native source-value inspection requires an explicit pixel window; geographic geocoding is not inferred')
    if 'pixelWindow' in r:
        w=r['pixelWindow']
        if (r['operation']!='native-observation' or type(w) is not list or len(w)!=4 or
            any(type(v) is not int for v in w) or min(w[:2])<0 or min(w[2:])<1 or w[2]*w[3]>262144):
            raise SarError('invalid_request','Choose a bounded native pixel window for source-magnitude inspection')
    bbox(r['bbox'],crop=True)
    return r

def limits(config):
    return {'maxPixels':min(config.max_pixels,262144),'maxTransferBytes':config.transfer_bytes,'maxSeconds':config.wall_seconds}

def preflight(r,config,reader=None):
    validate_request(r)
    reader=reader or PublicReader(min(config.transfer_bytes,8*1024**2),30)
    records=[];gates=[];items=[]
    if r['operation']=='native-observation' and 'pixelWindow' not in r:
        gates.append('Choose a native pixel window. RADARSAT-1 GCPs are not a verified geographic affine grid; no geocoding is invented.')
    if r['sourceId']=='rcm' and not config.rcm_access_approved:
        gates.append('RCM Public User License approval is required before imagery reads. The operator has not enabled this source; catalog and metadata remain inspectable.')
    try:
        if r['sourceId'] in ACCESS:raise SarError('access_required',ACCESS[r['sourceId']])
        for ident in r['recordIds']:
            rec,item=resolve(r['sourceId'],ident,reader);records.append(rec);items.append(item)
        if r['sourceId']=='nisar':
            products=[i['properties'].get('processingLevel') for i in items]
            expected=['GUNW'] if r['operation']=='los-displacement' else ['GOFF'] if r['operation']=='pixel-offset' else ['GCOV','GSLC']
            if any(p not in expected for p in products) or len(set(products))!=1:
                gates.append('Choose one supported product family: GCOV/GSLC for backscatter, GUNW for LOS or GOFF for native pixel offsets.')
            elif products[0] in ('GCOV','GUNW') and r['channel']!='HH':
                gates.append('The verified GCOV and GUNW readers support Frequency A HH only.')
            elif products[0]=='GSLC' and len(items)==2:
                gates.append('GSLC currently supports individual beta0 observations with preserved complex samples. Pair processing requires a separately verified acquisition-mode comparison.')
            if not Path(config.netrc).is_file():gates.append('Native NISAR data needs the configured Earthdata credential file on the processing host.')
        elif r['sourceId']=='uavsar':
            if r['channel'] not in ('HH','HV','VV'):gates.append('The verified UAVSAR reader supports diagonal HH, HV and VV GRD power only.')
            for item in items:
                if not uavsar_inputs(item,r['channel']):gates.append('This UAVSAR record does not expose a verified numeric GRD plus annotation pair. Browse/KMZ assets are not analytical input.')
            if not Path(config.netrc).is_file():gates.append('ASF-hosted UAVSAR grids require the configured Earthdata credential file.')
        else:
            from .native import cog_asset
            for item in items:
                try:cog_asset(item,r['channel'],native=r['operation']=='native-observation',reader=reader)
                except SarError as e:gates.append(str(e))
        try:
            import numpy  # noqa: F401
            import h5py  # noqa: F401
            from PIL import Image  # noqa: F401
            try:from osgeo import gdal  # noqa: F401
            except ImportError:import rasterio  # noqa: F401
        except ImportError:gates.append('Install the native numerical/raster runtime on the science worker.')
        if len(records)==2:
            from .native import acquisition_time
            try:
                if acquisition_time(records[0].get('acquiredAt'))>=acquisition_time(records[1].get('acquiredAt')):gates.append('Select distinct chronological acquisitions in before / after order.')
            except SarError as e:gates.append(str(e))
            if not records[0]['collection'] or records[0]['collection']!=records[1]['collection']:gates.append('Comparisons require the same known source collection and processing convention.')
    except SarError as e:gates.append(str(e))
    return {'schemaVersion':'1.0','ready':not gates,'request':r,'method':METHOD,
        'quantity':'radar pixel offset' if r['operation']=='pixel-offset' else 'native source magnitude (calibration withheld)' if r['operation']=='native-observation' else 'relative line-of-sight displacement' if r['operation']=='los-displacement' else 'radar backscatter difference' if len(r['recordIds'])==2 else 'radar backscatter',
        'unit':'meters' if r['operation']=='pixel-offset' else 'source units' if r['operation']=='native-observation' else 'mm' if r['operation']=='los-displacement' else 'dB','records':records,'gates':list(dict.fromkeys(gates)),
        'notices':['Preflight checks metadata and runtime. Native file identity, masks, grids and actual coverage are verified by the queued worker.',
            'A completed job is private. It is not a reviewed public study.',
            'Backscatter does not measure water depth or ground motion; LOS displacement is not vertical motion or a building safety diagnosis.'], 'limits':limits(config)}

def uavsar_inputs(item,channel='HH'):
    p=item.get('properties',{})
    urls=[p.get('url')]+p.get('additionalUrls',[])
    # Only explicit source links qualify. Do not manufacture filenames from a browse URL.
    from .net import vetted
    annotations=set();grids=set()
    for u in urls:
        if not isinstance(u,str):continue
        try:vetted(u)
        except SarError:continue
        if u.lower().endswith('.ann'):annotations.add(u)
        if u.lower().endswith('.grd') and re.search(r'(?:_|L\d{3})'+re.escape(channel+channel)+r'_',u):grids.add(u)
    return {'annotation':next(iter(annotations)),'grid':next(iter(grids))} if len(annotations)==len(grids)==1 else None

def run(r,config,output,reader=None):
    validate_request(r)
    if r['sourceId']=='rcm' and not config.rcm_access_approved:
        raise SarError('license_required','RCM imagery access needs explicit operator license approval')
    from .native import read_nisar,read_cog,compare,input_digest,MAX_PIXELS
    from .uavsar import read_uavsar
    reader=reader or PublicReader(config.transfer_bytes,config.wall_seconds)
    records=[];crops=[];items=[]
    for ident in r['recordIds']:
        rec,item=resolve(r['sourceId'],ident,reader);records.append(rec);items.append(item)
        if r['sourceId']=='rcm':
            from .rcm import verify_license
            verify_license(item,reader)
    if len(records)==2:
        from .native import acquisition_time
        if not records[0]['collection'] or records[0]['collection']!=records[1]['collection']:
            raise SarError('incompatible_pair','Comparisons require the same known source collection')
        if acquisition_time(records[0]['acquiredAt'])>=acquisition_time(records[1]['acquiredAt']):
            raise SarError('chronology','Select chronological acquisitions before native reading')
    for item in items:
        if r['sourceId']=='nisar':
            product=item['properties'].get('processingLevel')
            if product=='GSLC' and r['operation']=='backscatter-observation':
                from .nisar_extended import read_gslc
                crop=read_gslc(item,r['bbox'],r['channel'],config.netrc,reader)
            elif product=='GOFF' and r['operation']=='pixel-offset':
                from .nisar_extended import read_goff
                crop=read_goff(item,r['bbox'],r['channel'],config.netrc,reader,r.get('component','slant-range'),r.get('layer',1))
            else:crop=read_nisar(item,r['bbox'],r['channel'],r['operation'],config.netrc,reader)
        elif r['sourceId']=='uavsar':crop=read_uavsar(item,r['bbox'],r['channel'],reader,config.netrc)
        else:crop=read_cog(r['sourceId'],item,r['bbox'],r['channel'],reader,native=r['operation']=='native-observation',pixel_window=r.get('pixelWindow'))
        if crop.values.size>min(config.max_pixels,MAX_PIXELS):raise SarError('pixel_limit','Native crop exceeds configured output budget')
        crops.append(crop)
    crop=compare(crops) if len(crops)==2 else crops[0]
    provenance={'schemaVersion':'1.0','method':METHOD,'request':r,'inputs':[{'cropSha256':input_digest(c),'grid':c.grid,'convention':c.convention,'evidence':c.evidence} for c in crops],
        'transferBytes':reader.budget.transferred,'notice':'Hashes identify extracted numeric arrays, validity, grid and metadata; not entire source files. No public publication authorized.'}
    if len(crops)==2:
        # Preserve independently verifiable source populations, including masks.
        # An opaque digest alone cannot establish that a subtraction was correct.
        for entry,c in zip(provenance['inputs'],crops):
            entry['values']=[float(v) if ok else None for v,ok in zip(c.values.ravel(),c.valid.ravel())]
    return write_result(r,records,crop,provenance,output)

def write_result(r,records,crop,provenance,output):
    import numpy as np
    from PIL import Image
    from service.processing import _preview_rgba
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    if (crop.values.ndim!=2 or crop.values.dtype.kind not in 'iuf' or crop.valid.dtype!=np.bool_ or
        crop.valid.shape!=crop.values.shape or crop.values.shape!=(crop.grid.get('height'),crop.grid.get('width'))):
        raise SarError('invalid_crop','Native values and exact boolean validity must share the declared grid')
    valid=crop.valid & np.isfinite(crop.values)
    if not valid.any():raise SarError('no_valid_pixels','No quality-valid native samples in this crop')
    selected=crop.values[valid].astype(np.float64)
    values={'width':crop.grid['width'],'height':crop.grid['height'],'values':[float(v) if ok else None for v,ok in zip(crop.values.ravel(),valid.ravel())],'unit':crop.unit}
    raw=json.dumps(values,allow_nan=False,separators=(',',':')).encode()
    if len(raw)>MAX_FILE:raise SarError('artifact_limit','Native values exceed the artifact budget; choose a smaller crop')
    (output/'values.json').write_bytes(raw)
    provenance_raw=json.dumps(provenance,sort_keys=True,allow_nan=False).encode()
    if len(provenance_raw)>MAX_FILE:raise SarError('artifact_limit','Input verification evidence exceeds artifact budget; choose a smaller crop')
    (output/'provenance.json').write_bytes(provenance_raw)
    low,high=np.percentile(selected,[2,98]);high=max(float(high),float(low)+1e-9)
    diverging=r['operation'] in ('backscatter-change','los-displacement','pixel-offset')
    maximum=max(float(np.percentile(np.abs(selected),98)),1e-9)
    pixels=_preview_rgba(crop.values,valid,float(low),maximum if diverging else high,diverging=diverging)
    Image.fromarray(pixels).save(output/'preview.png')
    files={name:{'bytes':(output/name).stat().st_size,'sha256':hashlib.sha256((output/name).read_bytes()).hexdigest()} for name in ('values.json','preview.png','provenance.json')}
    m={'schemaVersion':'1.0','kind':KIND,'method':METHOD,'sourceId':r['sourceId'],'operation':r['operation'],'channel':r['channel'],
        'quantity':crop.quantity,'unit':crop.unit,'grid':crop.grid,'coverage':{'total':int(valid.size),'valid':int(valid.sum()),'fraction':float(valid.mean())},
        'stats':{'min':float(selected.min()),'median':float(np.median(selected)),'max':float(selected.max())},'records':records,'artifacts':files,
        'notices':['Native grid; no scientific resampling. Missing samples are null and transparent.',
            'Preview color stretch is display-only. Read the native values and provenance for analysis.',
            'Different sensors, calibration conventions and quantities cannot be directly subtracted.',
            'Private analytical result; publication and interpretation need independent review.'],
        'published':False,'processedAt':datetime.now(timezone.utc).isoformat()}
    (output/'manifest.json').write_text(json.dumps(m,allow_nan=False))
    return m

def verify(stage,r):
    """Recompute native population/statistics and all file hashes at publication boundary."""
    import numpy as np
    from PIL import Image
    stage=Path(stage);validate_request(r)
    if any(p.is_symlink() or not p.is_file() or p.name not in ARTIFACTS|{'request.json','error.json'} or p.stat().st_size>MAX_FILE for p in stage.iterdir()):raise ValueError('Unsafe SAR artifact')
    if not all((stage/n).is_file() for n in ARTIFACTS):raise ValueError('Incomplete SAR result')
    m=json.loads((stage/'manifest.json').read_text())
    if (m.get('schemaVersion')!='1.0' or m.get('kind')!=KIND or m.get('method')!=METHOD or m.get('published') is not False or
        any(m.get(k)!=r[k] for k in ('sourceId','operation','channel')) or set(m.get('artifacts',{}))!=ARTIFACTS-{'manifest.json'}):raise ValueError('SAR result identity mismatch')
    for name,info in m['artifacts'].items():
        raw=(stage/name).read_bytes()
        if len(raw)!=info['bytes'] or hashlib.sha256(raw).hexdigest()!=info['sha256']:raise ValueError('SAR artifact checksum mismatch')
    values=json.loads((stage/'values.json').read_text());g=m['grid']
    if (type(g['width']) is not int or type(g['height']) is not int or min(g['width'],g['height'])<1 or g['width']*g['height']>262144 or
        values['width']!=g['width'] or values['height']!=g['height'] or len(values['values'])!=g['width']*g['height'] or values['unit']!=m['unit']):raise ValueError('SAR native grid mismatch')
    flat=values['values']
    if any(v is not None and (type(v) not in (int,float) or not math.isfinite(v)) for v in flat):raise ValueError('Invalid native values')
    keep=np.array([v for v in flat if v is not None],float)
    if not keep.size or m['coverage']!={'total':len(flat),'valid':int(keep.size),'fraction':float(keep.size/len(flat))}:raise ValueError('SAR coverage mismatch')
    expected={'min':float(keep.min()),'median':float(np.median(keep)),'max':float(keep.max())}
    if m['stats']!=expected:raise ValueError('SAR statistics mismatch')
    expected_quantity={'native-observation':('source units','native source magnitude (calibration withheld)'),
        'los-displacement':('mm','relative line-of-sight displacement'),
        'pixel-offset':('meters','radar pixel offset'),
        'backscatter-observation':('dB','radar backscatter'),'backscatter-change':('dB','radar backscatter difference')}[r['operation']]
    if (m['unit'],m['quantity'])!=expected_quantity:raise ValueError('SAR unit or quantity mismatch')
    if (not isinstance(g.get('crs'),str) or not g['crs'] or not isinstance(g.get('transform'),list) or len(g['transform'])!=6 or
        any(type(v) not in (int,float) or not math.isfinite(v) for v in g['transform'])):raise ValueError('Invalid native geometry')
    if r['operation']=='native-observation':
        x,y,w,h=r['pixelWindow']
        if (g['width'],g['height'],g['crs'],g['transform'])!=(w,h,'SOURCE_PIXEL_GRID (not geocoded)',[x,1,0,y,0,1]):
            raise ValueError('Native source window identity mismatch')
    if [x['id'] for x in m['records']]!=r['recordIds'] or any(x['sourceId']!=r['sourceId'] for x in m['records']):raise ValueError('SAR source mismatch')
    provenance=json.loads((stage/'provenance.json').read_text())
    if provenance.get('schemaVersion')!='1.0' or provenance.get('request')!=r or provenance.get('method')!=METHOD or len(provenance.get('inputs',[]))!=len(r['recordIds']):raise ValueError('SAR provenance mismatch')
    for item,ident in zip(provenance['inputs'],r['recordIds']):
        evidence=item.get('evidence')
        if (not re.fullmatch('[a-f0-9]{64}',item.get('cropSha256','')) or not isinstance(evidence,dict) or
            evidence.get('sourceId')!=r['sourceId'] or evidence.get('recordId')!=ident or evidence.get('channel')!=r['channel'] or
            item.get('grid')!=g or not isinstance(item.get('convention'),str) or not item['convention']):
            raise ValueError('Incomplete or mismatched native provenance')
    if r['operation']!='backscatter-change':
        from .native import NativeCrop,input_digest
        array=np.array([np.nan if v is None else v for v in flat],dtype=float).reshape(g['height'],g['width'])
        item=provenance['inputs'][0]
        crop=NativeCrop(array,np.isfinite(array),g,item['convention'],m['quantity'],m['unit'],item['evidence'])
        if input_digest(crop)!=item['cropSha256']:raise ValueError('Native input digest disagrees with output samples')
    else:
        from .native import NativeCrop,input_digest,compare
        crops=[]
        for item in provenance['inputs']:
            source=item.get('values')
            if (not isinstance(source,list) or len(source)!=len(flat) or
                any(v is not None and (type(v) not in (int,float) or not math.isfinite(v)) for v in source)):
                raise ValueError('Missing native comparison populations')
            array=np.array([np.nan if v is None else v for v in source],dtype=float).reshape(g['height'],g['width'])
            c=NativeCrop(array,np.isfinite(array),g,item['convention'],'radar backscatter','dB',item['evidence'])
            if input_digest(c)!=item['cropSha256']:raise ValueError('Native comparison input digest mismatch')
            crops.append(c)
        difference=compare(crops)
        actual=np.array([np.nan if v is None else v for v in flat],dtype=float).reshape(g['height'],g['width'])
        if not np.array_equal(actual,difference.values,equal_nan=True):raise ValueError('Native subtraction or common validity mismatch')
    with Image.open(stage/'preview.png') as image:
        if image.size!=(g['width'],g['height']):raise ValueError('SAR preview grid mismatch')
        alpha=np.asarray(image.convert('RGBA'))[:,:,3].ravel()
        if not np.array_equal(alpha>0,np.array([v is not None for v in flat])):raise ValueError('SAR preview masks disagree')
    return m

def download(root,job,name):
    if name not in ARTIFACTS or job['status']!='completed':raise ValueError('Unavailable SAR artifact')
    if not re.fullmatch('[a-f0-9]{32}',job['id']):raise ValueError('Unsafe job identity')
    directory=Path(root)/'results'/job['id'];path=directory/name
    if directory.is_symlink() or path.is_symlink() or not path.is_file() or path.stat().st_size>MAX_FILE:raise ValueError('Unsafe artifact')
    if name=='manifest.json':
        if json.loads(path.read_bytes())!=job['result']:raise ValueError('Artifact manifest changed')
    else:
        info=job['result']['artifacts'][name];raw=path.read_bytes()
        if len(raw)!=info['bytes'] or hashlib.sha256(raw).hexdigest()!=info['sha256']:raise ValueError('Artifact changed')
    return path
