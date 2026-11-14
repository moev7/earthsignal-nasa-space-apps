"""Explicitly selected private historical point estimates; never public fetch auth.

One fixed ERA5 route, no retry/redirect/fallback. Private normalized cache and
account-wide counters live under the shared service root (not per assessment).
"""
import base64
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import time
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from service.range_reader import RangeError
from . import providers as p
from .geometry import contains, polygons
from .net import ProviderError, Transfer

SOURCE = 'meteomatics-weather-context'
MODEL = 'ecmwf-era5'
DOCS = 'https://www.meteomatics.com/en/api/request/optional-parameters/data-source/'
PARAMETERS = ('precip_24h:mm', 't_mean_2m_24h:C')
MAX_RESPONSE = 256 * 1024
STATE_BYTES = 2 * 1024**2  # DB <=512KiB, rollback journal <=DB plus fixed overhead.
CACHE_ROWS = 32
CACHE_TTL = 3600  # Includes gaps: recent reanalysis can arrive late or be revised.
UTC = timezone.utc


def utc_now():
    return datetime.now(UTC)


def credentials_ready(config, now):
    values = (config.meteomatics_username, config.meteomatics_password, config.meteomatics_valid_until)
    if not any(values):
        raise ProviderError('meteomatics_disabled')
    if not all(isinstance(v, str) and v for v in values):
        raise ProviderError('meteomatics_config_missing')
    user, password, expiry = values
    if (len(user) > 1024 or len(password) > 1024 or ':' in user or
            any(ord(c) < 32 or ord(c) == 127 for c in user + password)):
        raise ProviderError('meteomatics_config_invalid')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)', expiry):
        raise ProviderError('meteomatics_config_invalid')
    try:
        end = datetime.fromisoformat(expiry.replace('Z', '+00:00'))
    except ValueError:
        raise ProviderError('meteomatics_config_invalid') from None
    if now >= end:
        raise ProviderError('meteomatics_expired')


def requested_days(request, now):
    try:
        start, end = (date.fromisoformat(request[k]) for k in ('start', 'end'))
        if start.isoformat() != request['start'] or end.isoformat() != request['end'] or start > end:
            raise ValueError
    except (ValueError, TypeError, KeyError):
        raise ProviderError('meteomatics_invalid_dates') from None
    missing = []
    last = min(end, now.date() - timedelta(days=1))
    if end >= now.date():
        missing.append('Meteomatics: requested current/future UTC days withheld; only completed UTC days are queried.')
    if start > last:
        return [], missing
    first = max(start, last - timedelta(days=30))
    if first > start:
        missing.append('Meteomatics: requested historical range truncated to its 31 most recent completed UTC days; earlier requested days omitted.')
    return [(first + timedelta(days=i)).isoformat() for i in range((last-first).days+1)], missing


def sample_point(area):
    # Test each component's envelope centre, then a bounded deterministic grid.
    # Unwrapped longitude avoids sampling across the world at the antimeridian.
    for rings in polygons(area):
        xs, ys = zip(*rings[0])
        w, e, s, n = min(xs), max(xs), min(ys), max(ys)
        fractions = [(.5, .5)] + [(i/16, j/16) for j in range(1, 16) for i in range(1, 16)]
        for fx, fy in fractions:
            lon = round((w + (e-w)*fx + 180) % 360 - 180, 6)
            lat = round(s + (n-s)*fy, 6)
            if contains(area, lon, lat):
                return lat, lon
    raise ProviderError('meteomatics_point_unsupported')


def endpoint(day):
    return (date.fromisoformat(day) + timedelta(days=1)).isoformat() + 'T00:00:00Z'


class NoRedirect(HTTPRedirectHandler):
    def http_error_302(self, req, fp, code, msg, headers):
        fp.close()
        raise ProviderError('meteomatics_redirect_refused')
    http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302


def fetch(config, budget, days, point):
    """Build host/path/auth internally; returned URL is fixed public documentation."""
    credentials_ready(config, utc_now())
    budget.check()
    if budget.requests >= 24:
        raise ProviderError('request_budget_exceeded')
    lat, lon = point
    if (not 1 <= len(days) <= 31 or days != sorted(set(days)) or
            any(not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) for v in point) or
            not -90 <= lat <= 90 or not -180 <= lon <= 180):
        raise ProviderError('meteomatics_invalid_request')
    if any(date.fromisoformat(b)-date.fromisoformat(a) != timedelta(days=1) for a,b in zip(days,days[1:])):
        raise ProviderError('meteomatics_invalid_dates')
    if any(date.fromisoformat(d).isoformat() != d or date.fromisoformat(d) >= utc_now().date() for d in days):
        raise ProviderError('meteomatics_invalid_dates')
    url = (f'https://api.meteomatics.com/{endpoint(days[0])}--{endpoint(days[-1])}:P1D/'
           f'{",".join(PARAMETERS)}/{lat:.6f},{lon:.6f}/json?source={MODEL}')
    authorization = base64.b64encode((config.meteomatics_username+':'+config.meteomatics_password).encode()).decode('ascii')
    request = Request(url, headers={'Authorization': 'Basic '+authorization,
        'Accept': 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'EarthSignal-historical-context/1'})
    reserved = min(MAX_RESPONSE+1, budget.remaining)
    limit, size = reserved-1, 0
    if limit < 1:
        raise ProviderError('transfer_budget_exceeded')
    try:
        budget.transfer.reserve(reserved)
    except RangeError:
        raise ProviderError('transfer_budget_exceeded') from None
    try:
        budget.check()
        timeout = min(15, budget.wall_seconds-(time.monotonic()-budget.started))
        if timeout <= 0:
            raise ProviderError('time_budget_exceeded')
        budget.requests += 1
        # No proxies, cookies, auth managers or redirect forwarding.
        with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=timeout) as response:
            if response.geturl() != url:
                raise ProviderError('meteomatics_redirect_refused')
            if response.status != 200:
                code = {401:'meteomatics_http_401',403:'meteomatics_http_403',429:'meteomatics_http_429'}.get(response.status,'meteomatics_http_failure')
                raise ProviderError(code)
            if response.headers.get('Content-Encoding', 'identity').lower() not in ('identity', ''):
                raise ProviderError('meteomatics_unexpected_encoding')
            if response.headers.get('Content-Type', '').split(';')[0].strip().lower() != 'application/json':
                raise ProviderError('meteomatics_content_type')
            length = response.headers.get('Content-Length')
            if length is not None and (not re.fullmatch(r'\d{1,12}', length) or int(length) > limit):
                raise ProviderError('meteomatics_oversize')
            chunks = []
            while True:
                budget.check()
                chunk = response.read(min(64*1024, limit-size+1))
                if not chunk:
                    break
                size += len(chunk)
                if size > limit:
                    raise ProviderError('meteomatics_oversize')
                chunks.append(chunk)
            budget.check()
            credentials_ready(config, utc_now())
            data = b''.join(chunks)
            return Transfer(data, DOCS, hashlib.sha256(data).hexdigest(), utc_now().isoformat())
    except HTTPError as exc:
        code = {401:'meteomatics_http_401',403:'meteomatics_http_403',429:'meteomatics_http_429'}.get(exc.code,'meteomatics_http_failure')
        exc.close()  # No error-body read, export or implicit retry.
        raise ProviderError(code) from None
    except ProviderError:
        raise
    except Exception:
        raise ProviderError('meteomatics_network_failure') from None
    finally:
        budget.transfer.settle(reserved, size)


def parse_response(transfer, days, point):
    def reject():
        raise ProviderError('meteomatics_invalid_response')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                reject()
            result[key] = value
        return result
    try:
        raw = json.loads(transfer.data, object_pairs_hook=unique)
        if (not isinstance(raw, dict) or raw.get('version') != '3.0' or raw.get('status') != 'OK' or
                ('model' in raw and raw['model'] != MODEL) or ('source' in raw and raw['source'] != MODEL)):
            reject()
        data = raw.get('data')
        if not isinstance(data, list) or len(data) != 2:
            reject()
        expected = {endpoint(d):d for d in days}
        values = {}
        for item in data:
            if not isinstance(item, dict) or set(item) - {'parameter','coordinates','model','source'}:
                reject()
            parameter = item.get('parameter')
            if parameter not in PARAMETERS or parameter in values:
                reject()
            if any(k in item and item[k] != MODEL for k in ('model','source')):
                reject()
            coordinates = item.get('coordinates')
            if not isinstance(coordinates, list) or len(coordinates) != 1:
                reject()
            c = coordinates[0]
            if not isinstance(c, dict) or set(c) != {'lat','lon','dates'}:
                reject()
            for k, target in zip(('lat','lon'), point):
                if isinstance(c[k], bool) or not isinstance(c[k], (int,float)) or not math.isfinite(c[k]) or abs(c[k]-target) > 1e-7:
                    reject()
            if not isinstance(c['dates'], list) or len(c['dates']) > len(days):
                reject()
            rows = {}
            for row in c['dates']:
                if not isinstance(row, dict) or set(row) != {'date','value'}:
                    reject()
                stamp = row['date']
                if not isinstance(stamp,str) or stamp not in expected or expected[stamp] in rows:
                    reject()
                value = row['value']
                if (isinstance(value,bool) or not isinstance(value,(int,float)) or
                        not math.isfinite(value) or abs(value) > 1_000_000 or value in (-999,-888,-777,-666)):
                    value = None
                if parameter == PARAMETERS[0] and value is not None and value < 0:
                    value = None
                rows[expected[stamp]] = value
            values[parameter] = [rows.get(d) for d in days]
        return values
    except ProviderError:
        raise
    except Exception:
        reject()


class PrivateState:
    """Single namespace across processes/accounts: conservative shared account cap.

    flock is retained through network I/O. A persisted lease also fails closed
    after a killed writer until its maximum assessment wall time plus margin.
    No identity, credential, raw response or provider user field is persisted.
    """
    def __init__(self, config):
        self.config = config
        self.root = Path(config.root)
        self.directory = self.root / 'meteomatics-private'

    def admit(self):
        used = seen = 0
        def inaccessible(_):
            raise ProviderError('meteomatics_storage_unavailable')
        for directory, dirs, files in os.walk(self.root, followlinks=False, onerror=inaccessible):
            for name in dirs+files:
                seen += 1
                if seen > 100_000:
                    raise ProviderError('meteomatics_storage_unavailable')
                info = (Path(directory)/name).lstat()
                if stat.S_ISLNK(info.st_mode):
                    raise ProviderError('meteomatics_storage_unavailable')
                if stat.S_ISREG(info.st_mode):
                    used += info.st_size
        # Account for pending shared area-job reservations just as Store does.
        reserved = 0
        jobdb = self.root/'jobs.sqlite3'
        if jobdb.exists():
            db = sqlite3.connect(jobdb.as_uri()+'?mode=ro', uri=True, timeout=.1)
            try:
                rows = db.execute("SELECT id,length(CAST(request AS BLOB)) FROM jobs WHERE kind='area-experiment' AND state IN ('queued','running')").fetchall()
                for job, input_size in rows:
                    if not isinstance(job,str) or not re.fullmatch('[a-f0-9]{32}',job):
                        raise ProviderError('meteomatics_storage_unavailable')
                    stage = self.root/'staging'/job
                    size = sum(f.stat().st_size for f in stage.rglob('*') if f.is_file()) if stage.is_dir() else 0
                    reserved += max(0,self.config.job_reservation_bytes-input_size-size)
            finally:
                db.close()
        if used + reserved + STATE_BYTES >= self.config.storage_bytes or shutil.disk_usage(self.root).free < self.config.reserve_bytes + reserved + STATE_BYTES:
            raise ProviderError('meteomatics_storage_unavailable')

    @contextmanager
    def connection(self):
        db = lock = None
        try:
            if not self.root.is_absolute() or not self.root.is_dir() or self.root.is_symlink():
                raise ProviderError('meteomatics_storage_unavailable')
            self.admit()
            self.directory.mkdir(mode=0o700, exist_ok=True)
            info = self.directory.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077:
                raise ProviderError('meteomatics_storage_unavailable')
            for name in ('state.sqlite3','state.sqlite3-journal','state.lock'):
                path = self.directory/name
                if path.exists() or path.is_symlink():
                    info = path.lstat()
                    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077:
                        raise ProviderError('meteomatics_storage_unavailable')
            lock = os.open(self.directory/'state.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
            fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
            fd = os.open(self.directory/'state.sqlite3',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
            os.close(fd)
            db = sqlite3.connect(self.directory/'state.sqlite3',timeout=.1,isolation_level=None)
            db.execute('PRAGMA page_size=4096')
            if db.execute('PRAGMA page_size').fetchone()[0] != 4096:
                raise ProviderError('meteomatics_storage_unavailable')
            if db.execute('PRAGMA journal_mode=DELETE').fetchone()[0] != 'delete':
                raise ProviderError('meteomatics_storage_unavailable')
            db.execute('PRAGMA synchronous=FULL')
            db.execute('PRAGMA secure_delete=ON')
            db.execute('PRAGMA temp_store=MEMORY')
            if db.execute('PRAGMA max_page_count=128').fetchone()[0] > 128:
                raise ProviderError('meteomatics_storage_unavailable')
            db.executescript('''CREATE TABLE IF NOT EXISTS quota(id INTEGER PRIMARY KEY CHECK(id=1), day TEXT, calls INTEGER, lease REAL);
                CREATE TABLE IF NOT EXISTS attempts(at REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY, at REAL NOT NULL, payload TEXT NOT NULL);
                INSERT OR IGNORE INTO quota VALUES(1,'',0,0);''')
            yield db
        except ProviderError:
            raise
        except BlockingIOError:
            raise ProviderError('meteomatics_active_call') from None
        except Exception:
            raise ProviderError('meteomatics_storage_unavailable') from None
        finally:
            if db is not None:
                db.close()
            if lock is not None:
                os.close(lock)

    def acquire(self, db, now, wall_seconds):
        today = datetime.fromtimestamp(now,UTC).date().isoformat()
        db.execute('BEGIN IMMEDIATE')
        try:
            day, calls, lease = db.execute('SELECT day,calls,lease FROM quota WHERE id=1').fetchone()
            if lease > now:
                raise ProviderError('meteomatics_active_call')
            if day > today:
                raise ProviderError('meteomatics_clock_gate')
            if day != today:
                calls = 0
            db.execute('DELETE FROM attempts WHERE at<=?',(now-60,))
            if calls >= 500:
                raise ProviderError('meteomatics_daily_quota')
            if db.execute('SELECT count(*) FROM attempts').fetchone()[0] >= 30:
                raise ProviderError('meteomatics_minute_quota')
            db.execute('UPDATE quota SET day=?,calls=?,lease=? WHERE id=1',(today,calls+1,now+min(1200,max(1,wall_seconds))+60))
            db.execute('INSERT INTO attempts VALUES(?)',(now,))
            db.commit()  # Charge before the attempt; failures retain their charge.
        except BaseException:
            db.rollback()
            raise


def load(config, budget, days, point):
    credentials_ready(config, utc_now())
    budget.check()
    state = PrivateState(config)
    key = p.digest([MODEL,PARAMETERS,days,point,'historical-v1'])
    with state.connection() as db:
        now = utc_now().timestamp()
        db.execute('DELETE FROM cache WHERE at<=? OR at>?',(now-CACHE_TTL,now))
        row = db.execute('SELECT payload FROM cache WHERE key=?',(key,)).fetchone()
        if row:
            payload = json.loads(row[0])
            credentials_ready(config, utc_now())
            budget.check()
            return payload['values'], Transfer(b'', DOCS, payload['hash'], payload['retrieved']), True
        budget.check()
        state.acquire(db,now,budget.wall_seconds)
        try:
            transfer = fetch(config,budget,days,point)
            values = parse_response(transfer,days,point)
            payload = json.dumps(dict(values=values,hash=transfer.sha256,retrieved=transfer.retrieved_at),allow_nan=False,separators=(',',':'))
            if len(payload.encode()) > 8192:
                raise ProviderError('meteomatics_storage_unavailable')
            state.admit()
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM cache WHERE key IN (SELECT key FROM cache ORDER BY at DESC,key LIMIT -1 OFFSET ?)',(CACHE_ROWS-1,))
            db.execute('INSERT OR REPLACE INTO cache VALUES(?,?,?)',(key,now,payload))
            db.commit()
            return values, transfer, False
        finally:
            db.execute('UPDATE quota SET lease=0 WHERE id=1')


def historical_context(request, config, budget):
    out = p.bundle()
    if SOURCE not in request.get('options',{}).get('sourceIds',[]):
        return out
    credentials_ready(config,utc_now())
    days, missing = requested_days(request,utc_now())
    out['missing'].extend(missing)
    if not days:
        return out
    point = sample_point(request['area'])
    values, transfer, cached = load(config,budget,days,point)
    lat, lon = point
    for parameter, ident, label, unit, quantity in (
            (PARAMETERS[0],'meteomatics-precipitation','Daily precipitation estimate','mm','modeled daily precipitation'),
            (PARAMETERS[1],'meteomatics-temperature','Daily mean air temperature estimate','C','modeled daily mean air temperature')):
        notes = [
            'Enhanced-downscaled ERA5 reanalysis ESTIMATES (fixed source=ecmwf-era5); not station or satellite observations. Effective point accuracy is unverified.',
            f'Exact queried point: latitude {lat:.6f}, longitude {lon:.6f}. Point support, not selected-area mean.',
            f'Each displayed UTC day D represents [D 00:00 UTC, D+1 00:00 UTC); right-aligned provider endpoints {endpoint(days[0])} through {endpoint(days[-1])}.',
            'Original retrieval time and response hash retained'+('; private normalized cache hit.' if cached else '.'),
            'Missing dates, invalid numbers and reserved missing sentinels remain null; delayed availability and revisions are possible. Cache TTL is at most one hour.']
        evidence = p.evidence(SOURCE,'Meteomatics JSON 3.0; source=ecmwf-era5',label,transfer,
            key=p.digest([transfer.sha256,parameter,days,point]),start=days[0]+'T00:00:00Z',end=days[-1]+'T23:59:59Z',
            quantity=quantity,unit=unit,support=f'Modeled point estimate at latitude {lat:.6f}, longitude {lon:.6f}; not area mean',
            notes=notes,mask='Exact in-area point; completed UTC days only; missing remains null',public=False)
        out['evidence'].append(evidence)
        refs = [evidence['id']]
        points = [dict(date=d,value=v,quality='modeled ERA5 reanalysis estimate' if v is not None else 'missing modeled estimate') for d,v in zip(days,values[parameter])]
        out['series'].append(dict(id=ident,label=label+' (ERA5 modeled point context)',unit=unit,evidenceIds=refs,points=points))
        valid = [v for v in values[parameter] if v is not None]
        # Context estimates never increase the direct-observation count.
        out['metrics'].append(p.metric(ident+'-mean',label+' — available-day mean',sum(valid)/len(valid) if valid else None,unit,refs,
            'Descriptive arithmetic mean of available daily modeled point estimates only; gaps excluded, no causal or area-wide inference.',f'{len(valid)} available of {len(days)} requested completed UTC days at one point'))
        if valid:
            out['findings'].append(p.finding(f'{len(valid)} of {len(days)} requested completed UTC days have {label.lower()} values from enhanced-downscaled ERA5 reanalysis. These are historical modeled point-context estimates, not station or satellite observations, area means, causal attribution, hazard advice, forecast skill or water-volume evidence.',refs,
                section='meaning',applicability=['Exact recorded point and completed UTC intervals only.'],uncertainty=['Effective point accuracy and representativeness of the selected area are unverified.']))
        if len(valid) < len(days):
            out['missing'].append('Meteomatics: one or more daily modeled estimates are missing; gaps are not zero measurements.')
    return out
