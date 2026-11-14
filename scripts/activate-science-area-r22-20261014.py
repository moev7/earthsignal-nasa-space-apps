"""Reversible sampling-workspace source activation; submissions default disabled.

Uses the prior independently tested activation protocol. The caller separately
verifies the service-scoped SQLite runtime, resource budgets, unexpired artifact
inventory and web release. Never restore this backup over later admitted jobs.
"""
import ctypes,hashlib,inspect,json,os,shutil,signal,sqlite3,subprocess,tarfile,time,urllib.request,uuid
from pathlib import Path

VERSION='area-workspace-r22-20261014'
PACKAGE_HASH='b5f08d4675e556f5a2b865e6e64c644836e025755695f1fc7412e27737eec69a'
ROOT=Path('/opt/earthsignal');DATA=Path('/var/lib/earthsignal')
LIVE=ROOT/'service';OLD=ROOT/('service.before-'+VERSION);NEW=ROOT/('service.next-'+VERSION)
PACKAGE=Path('/var/tmp/earthsignal-deploy-area-workspace-r22-20261014/science.tar.gz')
STAGE=ROOT/('science-stage-'+VERSION);BACKUP=Path('/var/backups/earthsignal-science')/VERSION
METHOD_VERSION='observatory-1.6.0'
ABSENT='ABSENT'
SOURCE_COMPONENTS=('api.py',
 'auth.py',
 'config.py',
 'store.py',
 'worker.py',
 'run_job.py',
 'area_jobs.py',
 'benchmarks/area_experiment.py',
 'benchmarks/stratified_area.py',
 'benchmarks/forecast_policy.py',
 'observatory/net.py',
 'assessment_validation.py',
 'observatory/dswx_schema.py',
 'observatory/water_transitions.py',
 'observatory/engine.py',
 'observatory/providers.py',
 'observatory/raster.py',
 'observatory/views.py')
OLD_COMPONENT_HASHES={'api.py': 'f0f6adfc7feb8b24bc1635a2bdc83815f6282feeceb424a78d4a90cd6b5c497d',
 'auth.py': '5e5886b4a7126fecd9b1749770505f2d8393cdd11fecee3992f33b49ec08f586',
 'config.py': '698967280b77b69dbefed115b3e0d7f6351359ee1dd16807ca0dae3f6ca1b4cd',
 'store.py': '4bdedbe3a4b37430ffd0f22a5c5a436fd343b69f2de1c608ba5bd34123ccd9ee',
 'worker.py': 'a061fcffc0aefe0f6d9c550d7c572ce37baf6b4089093e8fe9c681dfafe5be50',
 'run_job.py': '56275e9a5abe11f1a7d705b63fdfa962fa54c1aff4dd79c05210701fb772a054',
 'area_jobs.py': 'ABSENT',
 'benchmarks/area_experiment.py': 'ABSENT',
 'benchmarks/stratified_area.py': 'ABSENT',
 'benchmarks/forecast_policy.py': 'c342c6f4b99779a7ea85b26f6893a4b10add03e617b77fb59ee33c2adcfccb16',
 'observatory/net.py': '36637ffa254cc5d8740f8fc5d26b5b118c36e7820a36722e846633b1d69995c1',
 'assessment_validation.py': '03fe31431db8c08dbe8b9cd1e2732c33aa365ebb82e3349bb379394bc5e598b4',
 'observatory/dswx_schema.py': '727ba5285b8b2de6e240c1f079aec039315201fe79ef9e88a7e862349ce5c7bd',
 'observatory/water_transitions.py': '53908cb7d9de28ba4966fc0564c84e45b3728a0ce858a3bd2507d6721982bd69',
 'observatory/engine.py': '18a09d34dc440bd5de79ae731a35fd0ae5ce87b595566cd0b4fbbb828cf458e5',
 'observatory/providers.py': 'a0713b395e52ddd6ff2f41ee5878b192ea421c83e87109fda1736dd2b6bfc1dc',
 'observatory/raster.py': '1914f7a4dea3fd5c9d9d8bd2d5a53cc99641b51dcabbd2bb0e1c19c9e212a81b',
 'observatory/views.py': '1c72d46a79cf77c79a9c35d1ae9ec84b3be8ff69ba3f3ad11fed22c66ecb507a'}
NEW_COMPONENT_HASHES={'api.py': '4baeed99e45d5ec463dd18e8645db15d76a895ce88f1125dd5dc226463f070a8',
 'auth.py': '88833c695667916c11be11c7b57b3769bb86309217e0c69dedd2c6e47ff3182a',
 'config.py': '2a189de18652d19596a766f3a3db77668dbe179976c3349ab03be5ea9d0e1685',
 'store.py': '89cc05357587a4be4c336fc7c6b5831d85bda5e99a51d8c6417bce0b423dd7a9',
 'worker.py': '8b99bd08de561d8f2dbca3526cc9d83000a33577cfad843833d027cf00457ed2',
 'run_job.py': '1b038eec581b793c1c1782f9234cce5d766a848cbe7c47262cbcc58806d9893a',
 'area_jobs.py': 'd0f776889ae616baea4002c98a3aa6a1d24aa7e6c0738c83fd97049688e73ffa',
 'benchmarks/area_experiment.py': '49393948d7a9615bebf7b8bcb9182d9b951a053de54365601c5eda7ba366d866',
 'benchmarks/stratified_area.py': '90774e13ca849840abc29027a53f275a9b157f7837acd72d89cc90cdb0a5c968',
 'benchmarks/forecast_policy.py': 'c342c6f4b99779a7ea85b26f6893a4b10add03e617b77fb59ee33c2adcfccb16',
 'observatory/net.py': '36637ffa254cc5d8740f8fc5d26b5b118c36e7820a36722e846633b1d69995c1',
 'assessment_validation.py': '03fe31431db8c08dbe8b9cd1e2732c33aa365ebb82e3349bb379394bc5e598b4',
 'observatory/dswx_schema.py': '727ba5285b8b2de6e240c1f079aec039315201fe79ef9e88a7e862349ce5c7bd',
 'observatory/water_transitions.py': '53908cb7d9de28ba4966fc0564c84e45b3728a0ce858a3bd2507d6721982bd69',
 'observatory/engine.py': '18a09d34dc440bd5de79ae731a35fd0ae5ce87b595566cd0b4fbbb828cf458e5',
 'observatory/providers.py': 'a0713b395e52ddd6ff2f41ee5878b192ea421c83e87109fda1736dd2b6bfc1dc',
 'observatory/raster.py': '1914f7a4dea3fd5c9d9d8bd2d5a53cc99641b51dcabbd2bb0e1c19c9e212a81b',
 'observatory/views.py': '1c72d46a79cf77c79a9c35d1ae9ec84b3be8ff69ba3f3ad11fed22c66ecb507a'}
REPORT={}
WEB_WAS_ACTIVE=False
os.umask(0o077)

class SourceStateUncertain(RuntimeError):
    """Compensation failed; leave stopped units for manual source inspection."""

def command(*args):return subprocess.check_output(args,text=True).strip()
def pending():
    with sqlite3.connect('file:'+str(DATA/'jobs.sqlite3')+'?mode=ro',uri=True) as db:
        return db.execute("select count(*) from jobs where state in ('queued','running')").fetchone()[0]
def retained():
    with sqlite3.connect('file:'+str(DATA/'jobs.sqlite3')+'?mode=ro',uri=True) as db:
        rows=db.execute('select id,result from jobs where prepared=1').fetchall()
    result={}
    for ident,manifest in rows:
        files={}
        for p in sorted((DATA/'results'/ident).iterdir()):
            if not p.is_file() or p.is_symlink():raise RuntimeError('Unsupported retained artifact')
            files[p.name]=hashlib.sha256(p.read_bytes()).hexdigest()
        result[ident]=dict(manifestHash=hashlib.sha256(manifest.encode()).hexdigest(),files=files)
    if len(result)!=1 or any(len(v['files'])!=9 for v in result.values()):raise RuntimeError('Unexpected prepared study inventory')
    return result

def source_components(root):
    """Hash all named regular files, retaining an explicit missing-file sentinel."""
    root=Path(root)
    result={}
    for name in SOURCE_COMPONENTS:
        path=root/name
        # A symlink (including a dangling one) is never an absent component.
        if any(p.is_symlink() for p in (path,*path.parents) if p==root or root in p.parents):
            raise RuntimeError('Linked source component: '+name)
        if not path.exists():
            result[name]=ABSENT
        elif not path.is_file():
            raise RuntimeError('Non-file source component: '+name)
        else:
            result[name]=hashlib.sha256(path.read_bytes()).hexdigest()
    return result

def source_fingerprint(components):
    if set(components)!=set(SOURCE_COMPONENTS):
        raise RuntimeError('Incomplete source component inventory')
    # Include relative names and missing sentinels, with an unambiguous encoding.
    payload=json.dumps(sorted(components.items()),separators=(',',':')).encode()
    return hashlib.sha256(payload).hexdigest()

def verify_source(root,expected):
    source_fingerprint(expected)
    actual=source_components(root)
    if actual!=expected:
        changed=[name for name in SOURCE_COMPONENTS if actual[name]!=expected[name]]
        raise RuntimeError('Source component mismatch: '+', '.join(changed))
    return source_fingerprint(actual)

def fingerprint_code():
    """Ship these exact helpers to smoke, without importing candidate science here."""
    return ("import hashlib,json\nfrom pathlib import Path\n"
            +"SOURCE_COMPONENTS="+repr(SOURCE_COMPONENTS)+"\nABSENT="+repr(ABSENT)+"\n"
            +inspect.getsource(source_components)+inspect.getsource(source_fingerprint))

def version():
    return command(str(LIVE/'.venv/bin/python'),'-c','from service.observatory.net import METHOD_VERSION;print(METHOD_VERSION)')
def active_health():
    for _ in range(20):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8030/health',timeout=2) as r:
                if r.status==200 and json.load(r).get('status')=='ok':return
        except Exception:pass
        time.sleep(1)
    raise RuntimeError('Science health unavailable')

def start():
    command('systemctl','start','earthsignal-api','earthsignal-worker');active_health()
    if any(command('systemctl','is-active',s)!='active' for s in ('earthsignal-api','earthsignal-worker')):raise RuntimeError('Science unit inactive')
    if WEB_WAS_ACTIVE:
        command('systemctl','start','earthsignal-web')
        for _ in range(20):
            try:
                with urllib.request.urlopen('http://127.0.0.1:3040/api/auth/session',timeout=2) as r:
                    if r.status==200:return
            except Exception:pass
            time.sleep(.5)
        raise RuntimeError('Previously active web service did not recover')

def stop_empty():
    command('systemctl','stop','earthsignal-api')
    if pending():
        command('systemctl','start','earthsignal-api')
        raise RuntimeError('New work appeared; deployment stopped without interrupting it')
    command('systemctl','stop','earthsignal-worker')

def smoke(expected,expected_components):
    expected_code_hash=verify_source(LIVE,expected_components)
    state=DATA/('deployment-smoke-'+VERSION+'-'+uuid.uuid4().hex)
    state.mkdir(mode=0o700);shutil.chown(state,user='earthsignal',group='earthsignal')
    nonce=uuid.uuid4().hex
    env=dict(os.environ,EARTHSIGNAL_DATA_DIR=str(state),EARTHSIGNAL_SMOKE_NONCE=nonce,EARTHSIGNAL_GATEWAY_SECRET='temporary-isolated-test-state-no-gateway-access',EARTHSIGNAL_ASSESSMENT_DOMAINS='',EARTHSIGNAL_SCENARIOS_ENABLED='false')
    code=fingerprint_code()+"""import os,uvicorn
from service.config import Config
from service.store import Store
from service.api import API,create_app
from service.observatory.net import METHOD_VERSION
CODE_HASH=source_fingerprint(source_components(Path('service')))
class SmokeAPI(API):
 def dispatch(self,method,target,headers,body):
  if method=='GET' and target=='/health':return 200,dict(status='ok',methodVersion=METHOD_VERSION,release=os.environ['EARTHSIGNAL_SMOKE_NONCE'],codeHash=CODE_HASH),None
  return super().dispatch(method,target,headers,body)
uvicorn.run(create_app(SmokeAPI(Store(Config.environment()))),host='127.0.0.1',port=8031,workers=1,limit_concurrency=16,backlog=16,log_level='error')
"""
    process=subprocess.Popen(['runuser','-u','earthsignal','--',str(LIVE/'.venv/bin/python'),'-c',code],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    try:
        if version()!=expected:raise RuntimeError('Unexpected code version')
        for _ in range(20):
            if process.poll() is not None:raise RuntimeError('Isolated API failed')
            try:
                with urllib.request.urlopen('http://127.0.0.1:8031/health',timeout=1) as r:
                    response=json.load(r)
                    if r.status==200 and response==dict(status='ok',methodVersion=expected,release=nonce,codeHash=expected_code_hash):return
            except Exception:pass
            time.sleep(.5)
        raise RuntimeError('Isolated health unavailable')
    finally:
        if process.poll() is None:
            os.killpg(process.pid,signal.SIGTERM)
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()

def exchange(left,right):
    """Linux atomic directory exchange; never fall back to an absent live path."""
    libc=ctypes.CDLL(None,use_errno=True)
    renameat2=libc.renameat2
    renameat2.argtypes=(ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint)
    renameat2.restype=ctypes.c_int
    if renameat2(-100,os.fsencode(left),-100,os.fsencode(right),2)!=0:
        error=ctypes.get_errno()
        raise OSError(error,os.strerror(error))

def activate_source():
    exchange(LIVE,NEW)
    try:NEW.rename(OLD)
    except BaseException:
        try:exchange(LIVE,NEW)
        except BaseException as exc:raise SourceStateUncertain('Forward source compensation failed') from exc
        raise

def restore_source():
    exchange(LIVE,OLD)
    try:OLD.rename(NEW)
    except BaseException:
        try:exchange(LIVE,OLD)
        except BaseException as exc:raise SourceStateUncertain('Rollback source compensation failed') from exc
        raise

def recover_failure(error,switched,final_admission):
    if isinstance(error,SourceStateUncertain):
        REPORT['status']='source compensation failed; units remain stopped pending manual inspection'
        return
    if not final_admission:
        if switched:
            command('systemctl','stop','earthsignal-api','earthsignal-worker')
            try:restore_source()
            except SourceStateUncertain:
                REPORT['status']='source compensation failed during recovery; units remain stopped pending manual inspection'
                raise
        start()
    else:
        REPORT['status']='new code retained after final admission; inspect health before further actions'

def main():
    global WEB_WAS_ACTIVE
    if len(PACKAGE_HASH)!=64 or any(c not in '0123456789abcdef' for c in PACKAGE_HASH):
        raise RuntimeError('Root must verify and pin the package SHA-256 before activation')
    os.chdir(ROOT)
    web_state=subprocess.run(['systemctl','is-active','earthsignal-web'],capture_output=True,text=True)
    if web_state.returncode not in (0,3):raise RuntimeError('Web unit state unavailable')
    WEB_WAS_ACTIVE=web_state.returncode==0 and web_state.stdout.strip()=='active'
    if any(p.exists() or p.is_symlink() for p in (OLD,NEW,STAGE,BACKUP)):raise RuntimeError('Release path already exists; inspect rather than replay')
    if pending() or shutil.disk_usage(DATA).free<3*1024**3+64*1024**2:raise RuntimeError('Admission unavailable')
    if hashlib.sha256(PACKAGE.read_bytes()).hexdigest()!=PACKAGE_HASH:raise RuntimeError('Package hash mismatch')
    if LIVE.is_symlink() or not (LIVE/'.venv').is_dir():raise RuntimeError('Unexpected original source')
    old_fingerprint=verify_source(LIVE,OLD_COMPONENT_HASHES)
    if version()!=METHOD_VERSION:raise RuntimeError('Unexpected original method version')
    STAGE.mkdir(mode=0o755)
    with tarfile.open(PACKAGE) as archive:archive.extractall(STAGE,filter='data')
    (STAGE/'service').rename(NEW)
    for p in [NEW,*NEW.rglob('*')]:
        if p.is_symlink():raise RuntimeError('Unexpected package link')
        shutil.chown(p,user='root',group='earthsignal');p.chmod(0o755 if p.is_dir() else 0o644)
    venv=(LIVE/'.venv').resolve(strict=True)
    if venv.is_relative_to(LIVE) or venv.is_relative_to(NEW):raise RuntimeError('Deployment requires a stable external virtual environment')
    (NEW/'.venv').symlink_to(venv)
    new_fingerprint=verify_source(NEW,NEW_COMPONENT_HASHES)
    REPORT.update(oldSourceFingerprint=old_fingerprint,newSourceFingerprint=new_fingerprint)
    before=retained();REPORT['retainedBefore']=before
    switched=False;final_admission=False
    try:
        stop_empty()
        BACKUP.mkdir(parents=True,mode=0o700);BACKUP.chmod(0o700)
        with sqlite3.connect(DATA/'jobs.sqlite3') as db,sqlite3.connect(BACKUP/'jobs.sqlite3') as backup:db.backup(backup)
        (BACKUP/'jobs.sqlite3').chmod(0o600)
        (BACKUP/'retained.json').write_text(json.dumps(before));(BACKUP/'retained.json').chmod(0o600)
        verify_source(LIVE,OLD_COMPONENT_HASHES)
        verify_source(NEW,NEW_COMPONENT_HASHES)
        activate_source();switched=True
        smoke(METHOD_VERSION,NEW_COMPONENT_HASHES)
        restore_source();switched=False
        smoke(METHOD_VERSION,OLD_COMPONENT_HASHES)
        if retained()!=before:raise RuntimeError('Retained artifacts changed during rollback')
        start();REPORT['rollback']='old code and actual supervised units restored successfully'
        stop_empty()
        verify_source(LIVE,OLD_COMPONENT_HASHES)
        verify_source(NEW,NEW_COMPONENT_HASHES)
        activate_source();switched=True
        # This is the last reversible boundary: any subsequent API startup may
        # admit new jobs, snapshots or annotations. Retain new code thereafter.
        final_admission=True
        start()
        smoke(METHOD_VERSION,NEW_COMPONENT_HASHES)
        if verify_source(LIVE,NEW_COMPONENT_HASHES)!=new_fingerprint or version()!=METHOD_VERSION or retained()!=before:raise RuntimeError('Activation integrity unavailable; retain new code pending inspection')
        REPORT.update(status='activated',method=METHOD_VERSION,preparedArtifactsUnchanged=True,databaseRestored=False,sourceRelease=VERSION)
    except Exception as error:
        # Never admit unverified candidate code after failed compensation.
        recover_failure(error,switched,final_admission)
        raise
    finally:
        if BACKUP.is_dir():
            (BACKUP/'activation.json').write_text(json.dumps(REPORT,indent=2));(BACKUP/'activation.json').chmod(0o600)
    print(json.dumps({k:v for k,v in REPORT.items() if k!='retainedBefore'}))

if __name__=='__main__':main()
