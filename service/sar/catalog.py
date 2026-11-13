"""Exact official catalog adapters. Browses are never promoted to native assets."""
from datetime import datetime,timezone,date
import math
import re
from urllib.parse import urlencode,quote,urlsplit
from .net import SarError,PublicReader,vetted

SOURCES=('nisar','radarsat-1','rcm','saocom','uavsar')
EODMS='https://www.eodms-sgdot.nrcan-rncan.gc.ca/search'
COLLECTIONS={'radarsat-1':'Radarsat-1-L1-COG','rcm':'rcm-ard'}
SOURCE_URLS={'nisar':'https://nisar-docs.asf.alaska.edu/',
 'radarsat-1':'https://registry.opendata.aws/radarsat-1/',
 'rcm':'https://www.asc-csa.gc.ca/eng/satellites/radarsat/access-to-data/about.asp',
 'saocom':'https://catalogos.conae.gov.ar/catalogo/catalogoSatSaocomInfo.html',
 'uavsar':'https://uavsar.jpl.nasa.gov/education/postcards.html'}
ACCESS={'saocom':'SAOCOM numerical access requires a verified CONAE license and product-level reader. No terms are accepted automatically.'}

def bbox(value,*,crop=False):
    if (type(value) is not list or len(value)!=4 or any(type(v) not in (float,int) or not math.isfinite(v) for v in value) or
        not(-180<=value[0]<value[2]<=180 and -90<=value[1]<value[3]<=90) or
        (crop and (value[2]-value[0]>.2+1e-12 or value[3]-value[1]>.2+1e-12))):
        raise SarError('invalid_request','Choose a valid bounded WGS84 crop')
    return value

def validate_search(q):
    if type(q) is not dict or set(q)!={'sourceId','bbox','start','end','product'} or q['sourceId'] not in SOURCES or q['product'] not in ('GCOV','GUNW','GOFF','GSLC'):
        raise SarError('invalid_request','Unsupported source search')
    bbox(q['bbox'])
    try:
        if any(not isinstance(q[k],str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',q[k]) for k in ('start','end')):raise ValueError()
        a,b=map(date.fromisoformat,(q['start'],q['end']))
        if not 0<=(b-a).days<=366:raise ValueError()
    except (TypeError,ValueError):raise SarError('invalid_request','Search valid dates within one year') from None

def maturity(collection):
    if not isinstance(collection,str):return 'unknown'
    if '_PROVISIONAL_' in collection:return 'provisional'
    if '_BETA_' in collection:return 'beta'
    if re.fullmatch(r'NISAR_L2_(GCOV|GUNW|GOFF|GSLC)_V\d+',collection):return 'validated'
    return 'not specified'

def native_assets(item):
    out={}
    for key,a in item.get('assets',{}).items():
        if not isinstance(a,dict) or re.search('quicklook|thumbnail|browse|preview',key+' '+str(a.get('title','')),re.I):continue
        href=a.get('href','')
        if not isinstance(href,str) or not urlsplit(href).path.lower().endswith(('.tif','.tiff')):continue
        try:vetted(href)
        except SarError:continue
        out[key]=a
    return out

def record(source,item):
    p=item.get('properties',{})
    if source=='nisar':
        ident=p.get('fileID');collection=p.get('collectionName')
        rawchannels=[p.get('mainBandPolarization'),p.get('polarization')]
        channels=[s for v in rawchannels for s in (v if isinstance(v,list) else [v]) if isinstance(s,str)]
        b=None
        return {'id':ident,'sourceId':source,'title':str(p.get('sceneName',ident)), 'product':str(p.get('processingLevel','unknown')),
            'acquiredAt':p.get('startTime'),'endAt':p.get('stopTime'),'collection':collection,
            'maturity':maturity(collection),'channels':list(dict.fromkeys(channels)), 'bbox':b,
            'scienceAssets':int(isinstance(p.get('url'),str) and p['url'].endswith('.h5')),
            'referenceUrl':SOURCE_URLS[source], 'notice':'Archive footprint and metadata only. Native masks, product specification and pair compatibility are checked during processing.'}
    b=item.get('bbox');b=b if isinstance(b,list) and len(b)==4 else None
    channels=p.get('sar:polarizations',[]) if isinstance(p.get('sar:polarizations',[]),list) else []
    if source=='rcm':channels=list(dict.fromkeys(channels+[c.upper() for c in ('rr','rl') if c in native_assets(item)]))
    return {'id':item['id'],'sourceId':source,'title':str(p.get('title',item['id'])),'product':str(p.get('sar:product_type',p.get('product_type',item.get('collection','unknown')))),
        'acquiredAt':p.get('datetime') or p.get('start_datetime'),'endAt':p.get('end_datetime') or p.get('datetime'),
        'collection':item.get('collection',COLLECTIONS.get(source)), 'maturity':'source-defined',
        'channels':channels,
        'bbox':b,'scienceAssets':len(native_assets(item)), 'referenceUrl':SOURCE_URLS[source],
        'notice':'Catalog presence does not establish usable coverage, calibration or permission to publish.'}

def search(q,reader=None):
    validate_search(q);source=q['sourceId'];reader=reader or PublicReader(8*1024**2,30)
    response={'schemaVersion':'1.0','sourceId':source,'retrievedAt':datetime.now(timezone.utc).isoformat(),
        'status':'ready','notice':'Bounded archive discovery; not a measurement or exhaustive archive inventory.', 'limit':24,'complete':False,'records':[]}
    if source in ACCESS:
        response.update(status='access-required',notice=ACCESS[source]);return response
    if source=='uavsar':
        params={'dataset':'UAVSAR','processingLevel':'POLSAR','bbox':','.join(map(str,q['bbox'])),'start':q['start'],'end':q['end'],'maxResults':'24','output':'geojson'}
    elif source=='nisar':
        params={'dataset':'NISAR','processingLevel':q['product'],'bbox':','.join(map(str,q['bbox'])),'start':q['start'],'end':q['end'],'maxResults':'24','output':'geojson'}
    else:
        url=f'{EODMS}/collections/{COLLECTIONS[source]}/items?'+urlencode({'bbox':','.join(map(str,q['bbox'])),'datetime':q['start']+'T00:00:00Z/'+q['end']+'T23:59:59Z','limit':24})
        data=reader.json(url)
        if data.get('type')!='FeatureCollection' or not isinstance(data.get('features'),list):raise SarError('source_schema','Source did not return a feature collection')
        response['records']=[record(source,i) for i in data['features'][:24]]
        response['complete']=len(data['features'])<24 and not any(l.get('rel')=='next' for l in data.get('links',[]))
        return response
    data=reader.json('https://api.daac.asf.alaska.edu/services/search/param?'+urlencode(params))
    if data.get('type')!='FeatureCollection' or not isinstance(data.get('features'),list):raise SarError('source_schema','ASF did not return a feature collection')
    response['records']=[asf_record(source,i) for i in data['features'][:24]]
    return response

def asf_record(source,item):
    r=record('nisar',item)
    if source=='uavsar':
        r.update(sourceId=source,maturity='source-defined',referenceUrl=SOURCE_URLS[source],notice='Original UAVSAR numeric grid and annotation required. A browse or KMZ cannot be analyzed.')
        p=item.get('properties',{});urls=[p.get('url')]+p.get('additionalUrls',[])
        r['scienceAssets']=sum(isinstance(u,str) and u.endswith('.grd') for u in urls)
        r['channels']=[c for c in ('HH','HV','VV') if any(isinstance(u,str) and re.search(r'(?:_|L\d{3})'+c+c+r'_',u) for u in urls)]
    return r

def resolve(source,ident,reader):
    if source not in SOURCES or not isinstance(ident,str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,240}',ident):
        raise SarError('invalid_request','Select an exact supported source record')
    if source in ACCESS:raise SarError('access_required',ACCESS[source])
    if source in COLLECTIONS:
        item=reader.json(f'{EODMS}/collections/{COLLECTIONS[source]}/items/{quote(ident,safe="")}')
        if isinstance(item,dict) and item.get('id') is None and source=='rcm':
            # RCM's item response omits id; its search response includes it.
            # Bind the canonical self URL, never the distinct rcm_uuid field.
            links=[l.get('href') for l in item.get('links',[]) if isinstance(l,dict) and l.get('rel')=='self']
            if len(links)==1:
                link=urlsplit(vetted(links[0]))
                if (link.hostname in ('www.eodms-sgdot.nrcan-rncan.gc.ca','eodms-sgdot.nrcan-rncan.gc.ca') and
                    link.path==f'/search/collections/{COLLECTIONS[source]}/items/{ident}' and not link.query):
                    item={**item,'id':ident}
        if (not isinstance(item,dict) or item.get('id')!=ident or item.get('type')!='Feature' or
            item.get('collection')!=COLLECTIONS[source]):raise SarError('source_identity','Exact source identity and collection did not match')
        return record(source,item),item
    data=reader.json('https://api.daac.asf.alaska.edu/services/search/param?'+urlencode({'product_list':ident,'output':'geojson'}))
    items=data.get('features',[])
    if len(items)!=1 or items[0].get('properties',{}).get('fileID')!=ident:raise SarError('source_identity','Expected exactly one matching ASF source')
    platform=items[0]['properties'].get('platform','')
    if (source=='nisar' and platform!='NISAR') or (source=='uavsar' and 'UAVSAR' not in str(platform)):
        raise SarError('source_identity','Catalog mission does not match selected source')
    return asf_record(source,items[0]),items[0]
