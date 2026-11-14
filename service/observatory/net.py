"""Credential-free, allowlisted, cumulative transfer/time budgets for public data.

All metadata and raster adapters must share one Budget per assessment. Errors
contain fixed codes, never provider response bodies, URLs, or authorization data.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
import re
import socket
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlsplit, urljoin
from urllib.request import Request, build_opener, HTTPRedirectHandler
from service.range_reader import TransferBudget, RangeError

METHOD_VERSION = 'observatory-1.6.0'
# Exact known provider hosts. Discovered assets never authorize another host.
HOST_PATHS = {
    'nasa.r8volt.com': ('/data/processed-water.json', '/data/water-history.json'),
    'firms.modaps.eosdis.nasa.gov': ('/data/active_fire/',),
    'api.waterdata.usgs.gov': ('/ogcapi/v1/',),
    'api.weather.gov': ('/points/', '/gridpoints/', '/alerts'),
    'cmr.earthdata.nasa.gov': ('/search/',),
    'earth-search.aws.element84.com': ('/v1/',),
    'planetarycomputer.microsoft.com': ('/api/stac/v1/', '/api/sas/v1/sign'),
    'lpdaac-stac.earthdata.nasa.gov': ('/',),
    'services3.arcgis.com': ('/T4QMspbfLg3qTGWY/arcgis/rest/services/',),
    'sentinel-cogs.s3.us-west-2.amazonaws.com': ('/sentinel-s2-l2a-cogs/',),
    'e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com': ('/sentinel-2-c1-l2a/',),
    'usgs-landsat.s3.us-west-2.amazonaws.com': ('/collection02/',),
    'usgs-landsat.s3.amazonaws.com': ('/collection02/',),
    'opera-pst-rs-pop1.s3.us-west-2.amazonaws.com': ('/products/',),
    'opera-pst-rs-pop1.s3.amazonaws.com': ('/products/',),
}
SENSITIVE = re.compile(r'(token|secret|password|signature|credential|api.?key|authorization|x-amz)', re.I)

class ProviderError(ValueError):
    """Sanitized, stable provider failure suitable for a private result."""
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def vetted_url(url, *, resolve=False):
    try:
        p = urlsplit(url)
        if (p.scheme != 'https' or p.hostname not in HOST_PATHS or p.username or
                p.password or p.port not in (None, 443) or p.fragment or
                len(url) > 8192 or any(ord(c) < 32 for c in url) or
                any(SENSITIVE.search(k) for k, _ in parse_qsl(p.query)) or
                not any(p.path.startswith(prefix) for prefix in HOST_PATHS[p.hostname]) or
                '/../' in p.path or '%' in p.path):
            raise ProviderError('url_not_allowlisted')
        if p.hostname == 'nasa.r8volt.com' and p.path not in HOST_PATHS[p.hostname]:
            raise ProviderError('url_not_allowlisted')
        if resolve:
            addresses = socket.getaddrinfo(p.hostname, 443, type=socket.SOCK_STREAM)
            if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
                raise ProviderError('address_not_public')
        return url
    except (ValueError, OSError) as exc:
        if isinstance(exc, ProviderError):
            raise
        raise ProviderError('url_validation_failed') from None


class _VettedRedirects(HTTPRedirectHandler):
    def http_error_302(self, req, fp, code, msg, headers):
        # Default urllib drains an unbounded redirect body; close it instead.
        location = headers.get('Location') or headers.get('URI')
        fp.close()
        if not location:
            raise ProviderError('redirect_missing_location')
        newurl = urljoin(req.full_url, location)
        vetted_url(newurl, resolve=True)
        depth = getattr(req, '_public_redirect_depth', 0)+1
        if depth > 3:
            raise ProviderError('redirect_limit')
        redirected = Request(newurl, headers=dict(req.header_items()))
        redirected._public_redirect_depth = depth
        return self.parent.open(redirected, timeout=req.timeout)

    http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302


@dataclass(frozen=True)
class Transfer:
    data: bytes
    url: str
    sha256: str
    retrieved_at: str

    def json(self):
        try:
            return json.loads(self.data, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        except (ValueError, UnicodeError, RecursionError):
            raise ProviderError('invalid_json') from None


class Budget:
    def __init__(self, config=None, *, transfer_bytes=None, wall_seconds=None, transfer=None):
        self.limit = min(int(transfer_bytes if transfer_bytes is not None else getattr(config, 'transfer_bytes', 16*1024**2)), 512*1024**2)
        self.wall_seconds = min(float(wall_seconds if wall_seconds is not None else getattr(config, 'wall_seconds', 120)), 1200)
        self.started = time.monotonic()
        self.transfer = transfer or TransferBudget(self.limit)
        self.requests = 0
        self.opener = build_opener(_VettedRedirects())

    @property
    def used(self):
        return self.transfer.transferred

    @property
    def remaining(self):
        return max(0, self.transfer.limit-self.transfer.transferred-self.transfer.reserved)

    def check(self):
        if time.monotonic()-self.started >= self.wall_seconds:
            raise ProviderError('time_budget_exceeded')
        if self.used >= self.limit:
            raise ProviderError('transfer_budget_exceeded')

    def fetch(self, url, *, max_bytes=1024**2, headers=None):
        self.check()
        if self.requests >= 24:
            raise ProviderError('request_budget_exceeded')
        vetted_url(url, resolve=True)
        self.check()
        self.requests += 1
        limit = min(max_bytes, self.remaining)
        # Callers cannot pass credentials; range requests are the only extra header.
        safe_headers = {'User-Agent': 'EarthSignal-observatory/1.1 (public scientific data)',
                        'Accept': 'application/geo+json,application/json,text/csv,*/*', 'Accept-Encoding': 'identity'}
        if headers:
            if set(headers) != {'Range'} or not re.fullmatch(r'bytes=\d+-\d+', headers['Range']):
                raise ProviderError('unsafe_headers')
            safe_headers.update(headers)
        reserved, size = min(limit+1, self.remaining), 0
        limit = reserved-1
        if limit < 1:
            raise ProviderError('transfer_budget_exceeded')
        try:
            self.transfer.reserve(reserved)
        except RangeError:
            raise ProviderError('transfer_budget_exceeded') from None
        try:
            timeout = max(.1, min(15, self.wall_seconds-(time.monotonic()-self.started)))
            with self.opener.open(Request(url, headers=safe_headers), timeout=timeout) as response:
                vetted_url(response.geturl())
                if headers and response.status != 206:
                    raise ProviderError('range_not_supported')
                if response.headers.get('Content-Encoding', 'identity') not in ('identity', ''):
                    raise ProviderError('unexpected_encoding')
                length = response.headers.get('Content-Length')
                if length is not None and int(length) > limit:
                    raise ProviderError('response_too_large')
                chunks, size = [], 0
                while True:
                    self.check()
                    chunk = response.read(min(64*1024, limit-size+1))
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > limit:
                        raise ProviderError('response_too_large')
                    chunks.append(chunk)
                data = b''.join(chunks)
                return Transfer(data, response.geturl(), hashlib.sha256(data).hexdigest(), datetime.now(timezone.utc).isoformat())
        except ProviderError:
            raise
        except HTTPError as exc:
            exc.close()
            code = 'access_gate' if exc.code in (401, 403) else 'rate_limit' if exc.code == 429 else 'http_failure'
            raise ProviderError(code) from None
        except (OSError, URLError, ValueError):
            raise ProviderError('network_failure') from None
        finally:
            self.transfer.settle(reserved, size)
