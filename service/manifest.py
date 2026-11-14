"""Validate the publication boundary against lib/radar-contract.ts version 1.0."""
import math
from datetime import datetime
from urllib.parse import urlsplit

HOSTS = {'nisar.asf.earthdatacloud.nasa.gov','cumulus.asf.earthdatacloud.nasa.gov','datapool.asf.alaska.edu'}

def validate_manifest(m, request):
    def require(ok):
        if not ok:
            raise ValueError('Invalid processing manifest')
    def number(v):
        return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)
    def integer(v, minimum=0):
        return isinstance(v,int) and not isinstance(v,bool) and v >= minimum
    def date(v):
        require(isinstance(v,str))
        parsed = datetime.fromisoformat(v.replace('Z','+00:00'))
        require(parsed.tzinfo is not None)
        return parsed
    require(isinstance(m,dict) and m.get('schemaVersion')=='1.0' and m.get('kind')=='radar-change')
    for k in ('title','notice'):
        require(isinstance(m.get(k),str) and bool(m[k]))
    for name,key in (('before','beforeId'),('after','afterId')):
        s=m[name]
        require(s['id']==request[key])
        date(s['acquiredAt'])
        for k in ('track','frame'):
            require(integer(s[k]))
        for k in ('direction','mode','release','collection'):
            require(isinstance(s[k],str) and bool(s[k]))
        url=urlsplit(s['url'])
        require(url.scheme=='https' and url.hostname in HOSTS and not url.username and not url.password and not url.query and not url.fragment)
    require(date(m['before']['acquiredAt']) < date(m['after']['acquiredAt']))
    for k in ('track','frame','direction','mode','release','collection'):
        require(m['before'][k]==m['after'][k])
    c=m['crop']
    require(c['bbox']==request['bbox'] and isinstance(c['crs'],str) and c['crs'])
    require(integer(c['width'],1) and integer(c['height'],1) and c['width']*c['height']<=1_000_000)
    for key,length in (('resolution',2),('transform',6)):
        require(isinstance(c[key],list) and len(c[key])==length and all(number(x) for x in c[key]))
    require(all(x>0 for x in c['resolution']))
    bounds=c['imageBounds']
    require(isinstance(bounds,list) and len(bounds)==2 and all(isinstance(p,list) and len(p)==2 and all(number(x) for x in p) for p in bounds))
    for k in ('medianDb','p05Db','p95Db','minDb','maxDb'):
        require(number(m['stats'][k]))
    stats=m['stats']
    require(stats['minDb']<=stats['p05Db']<=stats['medianDb']<=stats['p95Db']<=stats['maxDb'])
    cov=m['coverage']
    total=c['width']*c['height']
    require(cov['totalPixels']==total)
    for k in ('beforeValidPixels','afterValidPixels','commonValidPixels'):
        require(integer(cov[k]) and cov[k]<=total)
    require(0<cov['commonValidPixels']<=min(cov['beforeValidPixels'],cov['afterValidPixels']))
    require(number(cov['commonValidPercent']) and abs(cov['commonValidPercent']-100*cov['commonValidPixels']/total)<1e-6)
    require(number(cov['validAreaKm2']) and cov['validAreaKm2']>0)
    require(m['layers']==dict(before='before.png',after='after.png',difference='difference.png',excluded='excluded.png'))
    expected={'before.png','after.png','difference.png','excluded.png','before.tif','after.tif','difference.tif','validity.tif','manifest.json'}
    require(isinstance(m['artifacts'],list) and set(m['artifacts'])==expected)
    d=m['display']
    require(all(number(d[k]) for k in ('backscatterMinDb','backscatterMaxDb','differenceLimitDb')))
    require(d['backscatterMinDb']<d['backscatterMaxDb'] and d['differenceLimitDb']>0)
    p=m['processing']
    for k in ('algorithmVersion','method','maskPolicy'):
        require(isinstance(p[k],str) and bool(p[k]))
    date(p['processedAt'])
    for k in ('beforeSha256','afterSha256'):
        require(isinstance(p[k],str) and len(p[k])==64 and all(x in '0123456789abcdef' for x in p[k]))
    require(isinstance(p['sourceMetadata'],dict))
    return m
