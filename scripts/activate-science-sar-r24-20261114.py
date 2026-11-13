"""Root-operated Linux source exchange; building this recipe does not deploy it.

Inputs: --manifest/--manifest-sha256, --package, --receipt/--receipt-sha256.
See build-sar-science-package.py --help for the root finalization contract.
No environment/license changes, dependency installation or database restore.
A failed/interrupted run leaves evidence and paths for inspection, never replay.
"""
import argparse
from contextlib import closing
import ctypes
import gzip
import hashlib
import hmac
import inspect
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import sqlite3
import subprocess
import tarfile
import time
import urllib.error
import urllib.request
import uuid

VERSION = 'sar-r24-20261114'
ABSENT = 'ABSENT'
ROOT = Path('/opt/earthsignal')
DATA = Path('/var/lib/earthsignal')
LIVE = ROOT / 'service'
OLD = ROOT / ('service.before-' + VERSION)
NEW = ROOT / ('service.next-' + VERSION)
STAGE = ROOT / ('science-stage-' + VERSION)
BACKUP = Path('/var/backups/earthsignal-science') / VERSION
# Default inventory also supports the legacy fingerprint regression suite.
SOURCE_COMPONENTS = ('api.py', 'auth.py', 'config.py', 'store.py', 'worker.py',
                     'run_job.py', 'assessment_validation.py', 'observatory/providers.py',
                     'observatory/dswx_schema.py', 'observatory/water_transitions.py')
REPORT = {}
WEB_WAS_ACTIVE = False
MAX_PACKAGE = 32 * 1024**2
MAX_EXPANDED = 64 * 1024**2
MAX_MEMBERS = 512
UNITS = ('earthsignal-api', 'earthsignal-worker')


class SourceStateUncertain(RuntimeError):
    """Leave units stopped until the atomic exchange is independently inspected."""


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def valid_hash(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None


def safe_name(name):
    if (not isinstance(name, str) or not name or '\\' in name or
            any(ord(c) < 32 for c in name) or
            str(PurePosixPath(name)) != name or PurePosixPath(name).is_absolute() or
            any(part in ('.', '..', '.venv', '__pycache__') or part.startswith('.')
                for part in name.split('/'))):
        raise RuntimeError('Unsafe source name')
    return name


def regular(path):
    path = Path(path)
    if any(p.is_symlink() for p in (path, *path.parents)) or not path.is_file():
        raise RuntimeError('Expected unlinked regular file: ' + str(path))
    return path


def pinned_json(path, digest):
    if not valid_hash(digest):
        raise RuntimeError('Root must pin a SHA-256')
    path = regular(path)
    with path.open('rb') as source:
        raw = source.read(2 * 1024**2 + 1)
    if len(raw) > 2 * 1024**2 or sha(raw) != digest:
        raise RuntimeError('Pinned JSON mismatch or size limit')
    def unique(pairs):
        result = {}
        for k, v in pairs:
            if k in result:
                raise RuntimeError('Duplicate JSON key')
            result[k] = v
        return result
    return json.loads(raw, object_pairs_hook=unique)


def validate_manifest(manifest):
    required = {'schema', 'release', 'package_sha256', 'old', 'new',
                'old_method', 'new_method', 'old_sar_method', 'new_sar_method'}
    if (type(manifest) is not dict or set(manifest) != required or
            manifest['schema'] != 'earthsignal.sar-source/1' or manifest['release'] != VERSION or
            not valid_hash(manifest['package_sha256'])):
        raise RuntimeError('Invalid finalized source manifest')
    old, new = manifest['old'], manifest['new']
    if type(old) is not dict or type(new) is not dict or not old or set(old) != set(new):
        raise RuntimeError('Explicit matching OLD/NEW inventories required')
    for name in old:
        safe_name(name)
        for inventory in (old, new):
            if inventory[name] != ABSENT and not valid_hash(inventory[name]):
                raise RuntimeError('Invalid component hash: ' + name)
        if old[name] == new[name] == ABSENT:
            raise RuntimeError('Component absent from both inventories')
    needed = {'__init__.py', 'api.py', 'auth.py', 'config.py', 'store.py', 'worker.py',
              'run_job.py', 'processing.py', 'range_reader.py', 'ground_motion.py', 'gunw_reader.py',
              'sar/__init__.py', 'sar/jobs.py', 'sar/catalog.py', 'sar/net.py', 'sar/native.py',
              'sar/tiff_decoder.py', 'sar/rcm.py', 'sar/uavsar.py', 'sar/nisar_extended.py'}
    if any(new.get(name, ABSENT) == ABSENT for name in needed):
        raise RuntimeError('Missing SAR transitive source inventory')
    for key in ('old_method', 'new_method', 'new_sar_method'):
        if not isinstance(manifest[key], str) or not re.fullmatch('[A-Za-z0-9_.-]{1,80}', manifest[key]):
            raise RuntimeError('Invalid method identity')
    if manifest['old_sar_method'] is not None and not isinstance(manifest['old_sar_method'], str):
        raise RuntimeError('Explicit old SAR method or null required')
    return manifest


def source_components(root):
    root = Path(root)
    result = {}
    for name in SOURCE_COMPONENTS:
        path = root / name
        if any(p.is_symlink() for p in (path, *path.parents) if p == root or root in p.parents):
            raise RuntimeError('Linked source component: ' + name)
        if not path.exists():
            result[name] = ABSENT
        elif not path.is_file():
            raise RuntimeError('Non-file source component: ' + name)
        else:
            result[name] = sha(path.read_bytes())
    return result


def source_fingerprint(components):
    if set(components) != set(SOURCE_COMPONENTS):
        raise RuntimeError('Incomplete source component inventory')
    return sha(json.dumps(sorted(components.items()), separators=(',', ':')).encode())


def verify_source(root, expected):
    source_fingerprint(expected)
    actual = source_components(root)
    if actual != expected:
        raise RuntimeError('Source component mismatch: ' + ', '.join(n for n in SOURCE_COMPONENTS if actual[n] != expected[n]))
    # Extra importable modules must not silently escape the named inventory.
    if set(runtime_inventory(root)) != {n for n, digest in expected.items() if digest != ABSENT}:
        raise RuntimeError('Unexpected source tree inventory')
    return source_fingerprint(actual)


def runtime_inventory(root):
    """Never descend into venv, hidden files, tests or deployment configuration."""
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise RuntimeError('Source root must be an unlinked directory')
    # Resolve platform aliases above the root (macOS /var -> /private/var),
    # while continuing to reject links inside the actual source tree.
    root = root.resolve(strict=True)
    result = {}
    def walk(directory):
        for path in sorted(directory.iterdir()):
            name = path.relative_to(root).as_posix()
            if path.name.startswith('.') or path.name in ('__pycache__', 'tests', 'deploy'):
                continue
            if path.is_symlink():
                raise RuntimeError('Linked source tree entry: ' + name)
            if path.is_dir():
                walk(path)
            elif path.suffix in ('.py', '.json') or (path.name.startswith('requirements') and path.suffix == '.txt'):
                safe_name(name)
                result[name] = sha(regular(path).read_bytes())
    walk(root)
    if not result:
        raise RuntimeError('Empty source inventory')
    return dict(sorted(result.items()))


def fingerprint_code():
    return ('import hashlib,json\nfrom pathlib import Path\n' +
            'SOURCE_COMPONENTS=' + repr(SOURCE_COMPONENTS) + '\nABSENT=' + repr(ABSENT) + '\n' +
            inspect.getsource(sha) + inspect.getsource(source_components) + inspect.getsource(source_fingerprint))


def validate_receipt(receipt, manifest, manifest_hash, now=None):
    now = time.time() if now is None else now
    if (type(receipt) is not dict or receipt.get('schema') != 'earthsignal.sar-approval/1' or
            receipt.get('manifest_sha256') != manifest_hash or
            receipt.get('package_sha256') != manifest['package_sha256'] or
            type(receipt.get('expires_at')) not in (int, float) or
            not now < receipt['expires_at'] <= now + 86400 or
            receipt.get('approved') is not True):
        raise RuntimeError('Root approval receipt absent, stale or unbound')
    for check in ('environment', 'resources', 'rollback_compatible'):
        if receipt.get('checks', {}).get(check) is not True:
            raise RuntimeError('Root approval check missing: ' + check)
    venv = receipt.get('venv')
    if (not isinstance(venv, str) or not Path(venv).is_absolute() or
            any(Path(venv).is_relative_to(path) for path in (LIVE, OLD, NEW, STAGE))):
        raise RuntimeError('Receipt requires stable external venv')
    runtime = receipt.get('runtime')
    if (type(runtime) is not dict or set(runtime) != {'numpy', 'Pillow', 'h5py', 'GDAL', 'fastapi', 'uvicorn'} or
            any(not isinstance(v, str) or not v for v in runtime.values())):
        raise RuntimeError('Explicit verified runtime versions required')
    inventory = receipt.get('retained')
    if type(inventory) is not dict:
        raise RuntimeError('Explicit retained inventory required, including empty')
    for ident, result in inventory.items():
        if not re.fullmatch('[0-9a-f]{32}', ident) or type(result) is not dict or not valid_hash(result.get('manifestHash')) or type(result.get('files')) is not dict:
            raise RuntimeError('Invalid retained receipt')
        for name, digest in result['files'].items():
            if '/' in safe_name(name) or not valid_hash(digest):
                raise RuntimeError('Invalid retained file receipt')
    return receipt


def safe_unpack(package, destination, expected, package_hash):
    """No extractall: admit exact regular-file members before creating anything."""
    package = regular(package)
    if package.stat().st_size > MAX_PACKAGE:
        raise RuntimeError('Package size limit')
    raw = package.read_bytes()
    if not valid_hash(package_hash) or sha(raw) != package_hash:
        raise RuntimeError('Package hash mismatch at extraction')
    for name in expected:
        safe_name(name)
    wanted = {'service/' + n: h for n, h in expected.items() if h != ABSENT}
    # Bound decompression, including metadata and padding, before tar parsing.
    raw_limit = MAX_EXPANDED + MAX_MEMBERS * 2048 + 10240
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as compressed:
        expanded = compressed.read(raw_limit + 1)
    if len(expanded) > raw_limit:
        raise RuntimeError('Tar stream expansion limit')
    with tarfile.open(fileobj=io.BytesIO(expanded), mode='r:') as archive:
        members = archive.getmembers()
        if len(members) > MAX_MEMBERS:
            raise RuntimeError('Archive member limit')
        names = set()
        total = 0
        for member in members:
            if (member.name in names or member.name not in wanted or not member.isfile() or
                    member.issparse() or member.pax_headers or member.size < 0):
                raise RuntimeError('Unexpected archive member: ' + member.name)
            names.add(member.name)
            total += member.size
            if total > MAX_EXPANDED:
                raise RuntimeError('Expanded package size limit')
        if names != set(wanted):
            raise RuntimeError('Archive inventory mismatch')
        destination.mkdir(mode=0o755)
        for member in members:
            # Paths come from validated inventory, never arbitrary tar names.
            path = destination / member.name
            path.parent.mkdir(parents=True, exist_ok=True)
            data = archive.extractfile(member).read(member.size + 1)
            if len(data) != member.size or sha(data) != wanted[member.name]:
                raise RuntimeError('Archive component hash mismatch: ' + member.name)
            with path.open('xb') as output:
                output.write(data)
            path.chmod(0o644)


def command(*args):
    return subprocess.check_output(args, text=True, timeout=60).strip()


def pending():
    with closing(sqlite3.connect('file:' + str(DATA / 'jobs.sqlite3') + '?mode=ro', uri=True)) as db:
        return db.execute("select count(*) from jobs where state in ('queued','running')").fetchone()[0]


def retained():
    with closing(sqlite3.connect('file:' + str(DATA / 'jobs.sqlite3') + '?mode=ro', uri=True)) as db:
        rows = db.execute('select id,result from jobs where prepared=1').fetchall()
    result = {}
    for ident, manifest in rows:
        if not re.fullmatch('[0-9a-f]{32}', ident):
            raise RuntimeError('Invalid retained job identity')
        directory = DATA / 'results' / ident
        if any(p.is_symlink() for p in (directory, directory.parent, DATA)):
            raise RuntimeError('Linked retained directory')
        files = {}
        for path in sorted(directory.iterdir()):
            files[path.name] = sha(regular(path).read_bytes())
        result[ident] = dict(manifestHash=sha(manifest.encode()), files=files)
    return result


def check_retained(expected, actual, exact=False):
    if (exact and set(expected) != set(actual)) or any(actual.get(k) != v for k, v in expected.items()):
        raise RuntimeError('Retained results changed; never restore database backup')


def exchange(left, right):
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = libc.renameat2
    renameat2.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
    renameat2.restype = ctypes.c_int
    if renameat2(-100, os.fsencode(left), -100, os.fsencode(right), 2) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def activate_source():
    exchange(LIVE, NEW)
    try:
        NEW.rename(OLD)
    except BaseException:
        try:
            exchange(LIVE, NEW)
        except BaseException as error:
            raise SourceStateUncertain('Forward source compensation failed') from error
        raise


def restore_source():
    exchange(LIVE, OLD)
    try:
        OLD.rename(NEW)
    except BaseException:
        try:
            exchange(LIVE, OLD)
        except BaseException as error:
            raise SourceStateUncertain('Rollback source compensation failed') from error
        raise


def active_health():
    for _ in range(20):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8030/health', timeout=2) as response:
                if response.status == 200 and json.load(response).get('status') == 'ok':
                    return
        except (OSError, ValueError):
            pass
        time.sleep(.5)
    raise RuntimeError('Science health unavailable')


def web_health():
    # systemctl start can return before Node binds its socket. A dependent web
    # unit stopped with the API needs the same bounded startup allowance.
    for _ in range(20):
        try:
            with urllib.request.urlopen('http://127.0.0.1:3040/api/auth/session', timeout=2) as response:
                if response.status == 200 and json.load(response).get('user') is None:
                    return
        except (OSError, ValueError):
            pass
        time.sleep(.5)
    raise RuntimeError('Previously active web did not recover')


def start():
    command('systemctl', 'start', *UNITS)
    active_health()
    if any(command('systemctl', 'is-active', unit) != 'active' for unit in UNITS):
        raise RuntimeError('Science unit inactive')
    if WEB_WAS_ACTIVE:
        command('systemctl', 'start', 'earthsignal-web')
        web_health()


def stop_empty():
    command('systemctl', 'stop', 'earthsignal-api')
    if pending():
        command('systemctl', 'start', 'earthsignal-api')
        raise RuntimeError('New work appeared; deployment stopped without interrupting it')
    command('systemctl', 'stop', 'earthsignal-worker')
    if pending():
        raise RuntimeError('Queue changed after stopping worker')


def recover_failure(error, switched, final_admission):
    if isinstance(error, SourceStateUncertain):
        REPORT['status'] = 'source compensation failed; units remain stopped pending manual inspection'
        return
    if not final_admission:
        if switched:
            command('systemctl', 'stop', *UNITS)
            try:
                restore_source()
            except BaseException as recovery:
                REPORT['status'] = 'source compensation failed during recovery; units remain stopped pending manual inspection'
                raise SourceStateUncertain('Recovery could not restore previous source') from recovery
        REPORT['status'] = 'failed before admission; previous source restored; restart pending'
        start()
        REPORT['status'] = 'failed before admission; previous source and supervised units restored'
    else:
        REPORT['status'] = 'current code retained after final admission; inspect health before further actions'


def smoke(expected, expected_components, sar_method=None, runtime=None):
    """Fingerprint-bound API + idle worker, no real data or gateway secrets."""
    expected_hash = verify_source(LIVE, expected_components)
    state = DATA / ('deployment-smoke-' + VERSION + '-' + uuid.uuid4().hex)
    state.mkdir(mode=0o700)
    shutil.chown(state, user='earthsignal', group='earthsignal')
    nonce = uuid.uuid4().hex
    secret = uuid.uuid4().hex + uuid.uuid4().hex
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1',
           'OPENBLAS_NUM_THREADS': '1', 'OMP_NUM_THREADS': '1', 'GDAL_NUM_THREADS': '1', 'GDAL_CACHEMAX': '32'}
    code = fingerprint_code() + '''
import importlib,os,uvicorn
from service.config import Config
from service.store import Store
from service.api import API,create_app
from service.worker import Worker
from service.observatory.net import METHOD_VERSION
'''
    code += 'assert METHOD_VERSION == ' + repr(expected) + '\n'
    if runtime:
        code += 'import importlib.metadata\nfrom osgeo import gdal,osr\nimport numpy,h5py\nfrom PIL import Image\n'
        code += 'actual={n:importlib.metadata.version(n) for n in ("numpy","Pillow","h5py","fastapi","uvicorn")}\n'
        code += 'actual["GDAL"]=gdal.__version__\nassert actual == ' + repr(runtime) + '\n'
    if sar_method is not None:
        code += 'from service.sar.jobs import METHOD\nassert METHOD == ' + repr(sar_method) + '\n'
        code += 'for module in ' + repr(('service.sar.native', 'service.sar.nisar_extended', 'service.sar.tiff_decoder', 'service.sar.rcm', 'service.sar.uavsar', 'service.gunw_reader', 'service.ground_motion', 'service.run_job')) + ': importlib.import_module(module)\n'
    code += 'config=Config(root=Path(' + repr(str(state)) + '),secret=' + repr(secret.encode()) + ',netrc=Path("/nonexistent-smoke-netrc"))\n'
    code += 'store=Store(config)\nassert Worker(store).run_one() is False\n'
    health = dict(status='ok', methodVersion=expected, release=nonce, codeHash=expected_hash)
    code += 'HEALTH=' + repr(health) + '\n'
    code += "HEALTH['codeHash']=source_fingerprint(source_components(Path('service')))\n"
    code += '''class SmokeAPI(API):
 def dispatch(self,method,target,headers,body):
  if method=='GET' and target=='/health':return 200,HEALTH,None
  return super().dispatch(method,target,headers,body)
uvicorn.run(create_app(SmokeAPI(store)),host='127.0.0.1',port=8031,workers=1,limit_concurrency=16,backlog=16,log_level='error')
'''
    process = subprocess.Popen(['/usr/sbin/runuser', '-u', 'earthsignal', '--', str(LIVE / '.venv/bin/python'), '-c', code],
                               cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        for _ in range(40):
            if process.poll() is not None:
                raise RuntimeError('Isolated API/worker/runtime smoke failed')
            try:
                with urllib.request.urlopen('http://127.0.0.1:8031/health', timeout=1) as response:
                    if response.status == 200 and json.load(response) == health:
                        break
            except (OSError, ValueError):
                pass
            time.sleep(.5)
        else:
            raise RuntimeError('Isolated health fingerprint unavailable')
        if sar_method is not None:
            url = 'http://127.0.0.1:8031/api/sar-studies'
            try:
                urllib.request.urlopen(url, timeout=2)
            except urllib.error.HTTPError as error:
                if error.code != 401:
                    raise RuntimeError('Unsigned SAR endpoint failed closed check') from error
            else:
                raise RuntimeError('Unsigned SAR endpoint accepted')
            timestamp, auth_nonce, user = str(int(time.time())), uuid.uuid4().hex, 'deployment-smoke'
            target = '/api/sar-studies'
            canonical = '\n'.join(('GET', target, user, timestamp, auth_nonce, sha(b''))).encode()
            headers = {'X-Earthsignal-User': user, 'X-Earthsignal-Timestamp': timestamp,
                       'X-Earthsignal-Nonce': auth_nonce,
                       'X-Earthsignal-Signature': hmac.new(secret.encode(), canonical, hashlib.sha256).hexdigest()}
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=2) as response:
                if response.status != 200 or json.load(response) != {'schemaVersion': '1.0', 'jobs': []}:
                    raise RuntimeError('Signed SAR empty shared queue unavailable')
            try:
                urllib.request.urlopen(request, timeout=2)
            except urllib.error.HTTPError as error:
                if error.code != 401 or json.load(error).get('error', {}).get('code') != 'replay':
                    raise RuntimeError('SAR replay protection unavailable') from error
            else:
                raise RuntimeError('SAR nonce replay accepted')
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)


def verify_venv(source, expected):
    venv = source / '.venv'
    if not venv.is_symlink():
        raise RuntimeError('Deployment requires a stable external virtual environment')
    actual = venv.resolve(strict=True)
    if (str(actual) != expected or not actual.is_dir() or
            any(actual.is_relative_to(path) for path in (LIVE, OLD, NEW, STAGE))):
        raise RuntimeError('Stable external virtual environment does not match receipt')
    return actual


def write_report(path):
    with path.open('x') as output:
        json.dump(REPORT, output, indent=2)
    path.chmod(0o600)


def run(manifest, receipt, action, manifest_hash):
    global SOURCE_COMPONENTS, WEB_WAS_ACTIVE
    SOURCE_COMPONENTS = tuple(sorted(manifest['old']))
    validate_receipt(receipt, manifest, manifest_hash)
    if LIVE.is_symlink() or not LIVE.is_dir() or pending():
        raise RuntimeError('Original source or empty queue unavailable')
    if shutil.disk_usage(DATA).free < 3 * 1024**3 + MAX_EXPANDED:
        raise RuntimeError('Insufficient deployment reserve')
    venv = verify_venv(LIVE, receipt['venv'])
    state = subprocess.run(['systemctl', 'is-active', 'earthsignal-web'], capture_output=True, text=True, timeout=10)
    if state.returncode not in (0, 3):
        raise RuntimeError('Web state unavailable')
    WEB_WAS_ACTIVE = state.returncode == 0
    if any(command('systemctl', 'is-active', unit) != 'active' for unit in UNITS):
        raise RuntimeError('Both supervised science units must initially be active')
    before = retained()
    check_retained(receipt['retained'], before, exact=action == 'activate')
    REPORT.update(release=VERSION, manifestSha256=manifest_hash, action=action,
                  databaseRestored=False, retainedBefore=before,
                  oldSourceFingerprint=source_fingerprint(manifest['old']),
                  newSourceFingerprint=source_fingerprint(manifest['new']))
    if action == 'rollback':
        rollback(manifest, receipt, before)
        return
    if any(p.exists() or p.is_symlink() for p in (OLD, NEW, STAGE, BACKUP)):
        raise RuntimeError('Release path exists; inspect rather than replay')
    verify_source(LIVE, manifest['old'])
    safe_unpack(Path(REPORT['package']), STAGE, manifest['new'], manifest['package_sha256'])
    (STAGE / 'service').rename(NEW)
    for path in (NEW, *NEW.rglob('*')):
        shutil.chown(path, user='root', group='earthsignal')
        path.chmod(0o755 if path.is_dir() else 0o644)
    (NEW / '.venv').symlink_to(venv)
    verify_source(NEW, manifest['new'])
    switched, admitted = False, False
    try:
        stop_empty()
        check_retained(before, retained(), exact=True)
        BACKUP.mkdir(parents=True, mode=0o700)
        BACKUP.chmod(0o700)
        with closing(sqlite3.connect('file:' + str(DATA / 'jobs.sqlite3') + '?mode=ro', uri=True)) as db, closing(sqlite3.connect(BACKUP / 'jobs.sqlite3')) as backup:
            db.backup(backup)
        (BACKUP / 'jobs.sqlite3').chmod(0o600)
        verify_source(LIVE, manifest['old'])
        verify_source(NEW, manifest['new'])
        activate_source()
        switched = True
        smoke(manifest['new_method'], manifest['new'], manifest['new_sar_method'], receipt['runtime'])
        restore_source()
        switched = False
        smoke(manifest['old_method'], manifest['old'], manifest['old_sar_method'], receipt['runtime'])
        check_retained(before, retained(), exact=True)
        # No API admission between rollback rehearsal and final activation.
        REPORT['rollbackRehearsal'] = 'old source API/idle worker smoke; database never restored'
        validate_receipt(receipt, manifest, manifest_hash)
        verify_source(LIVE, manifest['old'])
        verify_source(NEW, manifest['new'])
        activate_source()
        switched = True
        admitted = True  # Starting any real API may admit new work, even on a later error.
        start()
        smoke(manifest['new_method'], manifest['new'], manifest['new_sar_method'], receipt['runtime'])
        verify_source(LIVE, manifest['new'])
        check_retained(before, retained())
        REPORT['status'] = 'activated'
    except BaseException as error:
        recover_failure(error, switched, admitted)
        raise
    finally:
        if BACKUP.is_dir():
            write_report(BACKUP / 'activation.json')


def rollback(manifest, receipt, before):
    """Source-only rollback: keep all jobs/results admitted since activation."""
    if NEW.exists() or NEW.is_symlink() or not OLD.is_dir() or OLD.is_symlink():
        raise RuntimeError('Unexpected rollback paths; inspect rather than replay')
    activation = json.loads(regular(BACKUP / 'activation.json').read_text())
    if activation.get('status') != 'activated' or activation.get('manifestSha256') != REPORT['manifestSha256']:
        raise RuntimeError('Matching successful activation receipt required')
    report_path = BACKUP / 'rollback.json'
    if report_path.exists() or report_path.is_symlink():
        raise RuntimeError('Rollback already attempted; inspect rather than replay')
    verify_source(LIVE, manifest['new'])
    verify_source(OLD, manifest['old'])
    verify_venv(OLD, receipt['venv'])
    switched, admitted = False, False
    try:
        stop_empty()
        check_retained(before, retained(), exact=True)
        validate_receipt(receipt, manifest, REPORT['manifestSha256'])
        verify_source(LIVE, manifest['new'])
        verify_source(OLD, manifest['old'])
        restore_source()
        switched = True
        smoke(manifest['old_method'], manifest['old'], manifest['old_sar_method'], receipt['runtime'])
        check_retained(before, retained(), exact=True)
        admitted = True
        start()
        verify_source(LIVE, manifest['old'])
        check_retained(before, retained())
        REPORT['status'] = 'rolled back source; post-activation jobs preserved'
    except BaseException as error:
        if isinstance(error, SourceStateUncertain):
            REPORT['status'] = 'source compensation failed; units remain stopped pending manual inspection'
        elif not admitted:
            if switched:
                try:
                    activate_source()  # Restore the previously serving new release.
                except BaseException as compensation:
                    REPORT['status'] = 'rollback recovery failed; units remain stopped pending manual inspection'
                    raise SourceStateUncertain('Rollback recovery failed') from compensation
            start()
            REPORT['status'] = 'rollback failed before admission; previously serving release restored'
        else:
            REPORT['status'] = 'old source retained after admission; manual inspection required'
        raise
    finally:
        write_report(report_path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--receipt-sha256', required=True)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--action', choices=('activate', 'rollback'), default='activate')
    args = parser.parse_args()
    os.umask(0o077)
    manifest = validate_manifest(pinned_json(args.manifest, args.manifest_sha256))
    receipt = pinned_json(args.receipt, args.receipt_sha256)
    validate_receipt(receipt, manifest, args.manifest_sha256)
    if regular(args.package).stat().st_size > MAX_PACKAGE or sha(args.package.read_bytes()) != manifest['package_sha256']:
        raise RuntimeError('Package hash/size mismatch')
    REPORT.update(package=str(args.package.resolve()), approvalSha256=args.receipt_sha256)
    os.chdir(ROOT)
    run(manifest, receipt, args.action, args.manifest_sha256)
    print(json.dumps({k: v for k, v in REPORT.items() if k != 'retainedBefore'}, sort_keys=True))


if __name__ == '__main__':
    main()
