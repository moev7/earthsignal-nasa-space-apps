"""Public source metadata and range transport. No client-provided host is trusted."""
import hashlib
import ipaddress
import json
import re
import socket
import time
from urllib.parse import urlsplit, urljoin, parse_qsl
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler
from urllib.error import HTTPError, URLError
from service.range_reader import RemoteAsset, TransferBudget, RangeError

HOSTS = frozenset({
    'api.daac.asf.alaska.edu', 'cmr.earthdata.nasa.gov',
    'www.eodms-sgdot.nrcan-rncan.gc.ca', 'eodms-sgdot.nrcan-rncan.gc.ca',
    'radarsat-r1-l1-cog.s3.ca-central-1.amazonaws.com', 'radarsat-r1-l1-cog.s3.amazonaws.com',
    'rcm-ceos-ard.s3.ca-central-1.amazonaws.com',
    'uavsar.jpl.nasa.gov', 'downloaduav.jpl.nasa.gov', 'uavsar.asf.alaska.edu',
    'cumulus.asf.earthdatacloud.nasa.gov', 's3-ca-central-1.amazonaws.com',
})

class SarError(ValueError, RangeError):
    def __init__(self, code, message):
        self.code = code
        ValueError.__init__(self,message)

class StableAsset(RemoteAsset):
    """Scientific reads require a strong source validator on the first response."""
    def _fetch_locked(self,start,end):
        data=super()._fetch_locked(start,end)
        if not self.etag or not re.fullmatch(r'"[^"\r\n]+"',self.etag):
            self.error=SarError('source_identity','Native source requires a stable strong ETag; weak or missing validators are not accepted')
            raise self.error
        return data

def vetted(url, *, resolve=False, redirect=False):
    try:
        p = urlsplit(url)
        if (p.scheme != 'https' or p.hostname not in HOSTS or p.username or p.password or
            p.port not in (None,443) or p.fragment or len(url)>4096 or
            re.search(r'[\x00-\x20\\]',url) or re.search(r'%2e|%2f|%5c',p.path,re.I) or
            any(x in ('.','..') for x in p.path.split('/')) or
            any(re.search(r'token|password|secret|signature|credential|x-amz',k,re.I) for k,_ in parse_qsl(p.query))):
            raise ValueError()
        if p.hostname=='cumulus.asf.earthdatacloud.nasa.gov' and not p.path.startswith('/PRODUCTS/UAVSAR/'):
            raise ValueError()
        if p.hostname=='s3-ca-central-1.amazonaws.com' and not p.path.startswith('/radarsat-r1-l1-cog/'):
            raise ValueError()
        if resolve:
            addresses=socket.getaddrinfo(p.hostname,443,type=socket.SOCK_STREAM)
            if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses): raise ValueError()
        return url
    except (ValueError,OSError,TypeError):
        raise SarError('unsafe_asset','Source is outside the verified public SAR allowlist') from None

class Redirects(HTTPRedirectHandler):
    def http_error_302(self,req,fp,code,msg,headers):
        location=headers.get('Location');fp.close()
        if not location: raise SarError('source_redirect','Source redirect has no destination')
        url=vetted(urljoin(req.full_url,location),resolve=True)
        depth=getattr(req,'_sar_redirects',0)+1
        if depth>3: raise SarError('source_redirect','Source redirect limit reached')
        new=Request(url,headers={k:v for k,v in req.header_items() if k.lower() not in ('authorization','cookie')})
        new._sar_redirects=depth
        return self.parent.open(new,timeout=req.timeout)
    http_error_301=http_error_303=http_error_307=http_error_308=http_error_302

class PublicReader:
    def __init__(self,limit=512*1024**2,seconds=120):
        self.budget=TransferBudget(limit);self.started=time.monotonic();self.seconds=seconds;self.requests=0
        self.opener=build_opener(ProxyHandler({}),Redirects())
    def json(self,url):
        vetted(url,resolve=True)
        if self.requests>=24 or time.monotonic()-self.started>self.seconds:
            raise SarError('metadata_limit','Metadata request budget exhausted')
        self.requests+=1
        cap=min(2*1024**2,self.budget.limit-self.budget.transferred-self.budget.reserved)
        if cap<2: raise SarError('transfer_limit','Metadata transfer budget exhausted')
        self.budget.reserve(cap);received=0
        try:
            with self.opener.open(Request(url,headers={'Accept':'application/json','Accept-Encoding':'identity','User-Agent':'Earthsignal-SAR/1.0'}),timeout=min(15,max(1,self.seconds-(time.monotonic()-self.started)))) as response:
                if response.headers.get('Content-Encoding','identity') not in ('identity',''): raise SarError('source_encoding','Unsupported encoded metadata')
                raw=response.read(cap);received=len(raw)
                if received>=cap: raise SarError('metadata_limit','Source metadata exceeds its byte cap')
            data=json.loads(raw,parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            if not isinstance(data,dict):raise SarError('source_schema','Source metadata must be a JSON object')
            return data
        except HTTPError as e:
            e.close();raise SarError('access_required' if e.code in (401,403) else 'source_unavailable','Public source access is unavailable') from None
        except (URLError,OSError,ValueError,RecursionError) as e:
            if isinstance(e,SarError):raise
            raise SarError('source_unavailable','Source did not return bounded valid metadata') from None
        finally:self.budget.settle(cap,received)
    def asset(self,url):
        vetted(url,resolve=True)
        return StableAsset(url,self.opener,self.budget,validator=vetted)
    def text(self,url,cap=256*1024):
        """Bounded original annotation/metadata bytes, never a science-file download."""
        vetted(url,resolve=True)
        if self.requests>=24 or time.monotonic()-self.started>self.seconds:raise SarError('metadata_limit','Metadata request budget exhausted')
        self.requests+=1;cap=min(cap,self.budget.limit-self.budget.transferred-self.budget.reserved)
        if cap<2:raise SarError('transfer_limit','Metadata byte budget exhausted')
        self.budget.reserve(cap);received=0
        try:
            with self.opener.open(Request(url,headers={'Accept-Encoding':'identity','User-Agent':'Earthsignal-SAR/1.0'}),timeout=15) as response:
                if response.headers.get('Content-Encoding','identity') not in ('identity',''):raise SarError('source_encoding','Unsupported metadata encoding')
                raw=response.read(cap);received=len(raw)
                if received>=cap:raise SarError('metadata_limit','Metadata document exceeds its bound')
                return raw
        except (HTTPError,URLError,OSError) as e:
            if isinstance(e,HTTPError):e.close()
            raise SarError('metadata_unavailable','Native source metadata is unavailable') from None
        finally:self.budget.settle(cap,received)

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
