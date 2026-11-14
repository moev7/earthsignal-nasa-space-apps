"""Loopback-only HTTP gateway backend. No browser cookies or public identity accepted."""
import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit
from .auth import authenticate, body_limit
from .config import Config
from .store import Store, Problem, ARTIFACTS
from .annotations import Annotations

def capability(config):
    try:
        from .processing import capability as check
        ready, message = check(config.netrc)
    except (ImportError, RuntimeError):
        ready, message = False, 'Scientific runtime unavailable; install the pinned GDAL environment'
    return {'ready': ready, 'message': message, 'maxPixels': config.max_pixels}

class API:
    def __init__(self, store, capability_check=None, algorithm='gcov-hhhh-v3'):
        self.store = store
        self.capability_check = capability_check or (lambda: capability(store.config))
        self.algorithm = algorithm
        self.annotations = Annotations(store)

    def dispatch(self, method, target, headers, body):
        path = urlsplit(target).path
        if path == '/health' and method == 'GET':
            return 200, {'status': 'ok', 'schemaVersion': '1.0'}, None
        user = authenticate(self.store, method, target, headers, body)
        from . import area_jobs
        if path == '/api/area-experiments':
            if method == 'GET':
                return 200, {'schemaVersion':'1.0', 'jobs':self.store.list(user, area_jobs.KIND),
                             'enabled':self.store.config.area_experiments_enabled}, None
            if method == 'POST':
                if target != '/api/area-experiments':
                    raise Problem(400, 'invalid_request', 'Submit to the exact collection path')
                try:
                    request = area_jobs.admit(body)
                except (ValueError, TypeError, KeyError, OverflowError, RecursionError, UnicodeError):
                    raise Problem(400, 'invalid_request', 'Invalid area experiment envelope') from None
                return 202, self.store.submit(user, request, headers.get('Idempotency-Key',''), area_jobs.METHOD, kind=area_jobs.KIND), None
        area_parts = path.split('/')
        if len(area_parts) >= 4 and area_parts[:3] == ['', 'api', 'area-experiments']:
            job_id = unquote(area_parts[3])
            if len(area_parts) == 4 and method == 'GET':
                return 200, self.store.get(user, job_id, area_jobs.KIND), None
            if len(area_parts) == 5 and area_parts[4] == 'cancel' and method == 'POST':
                return 200, self.store.cancel(user, job_id, area_jobs.KIND), None
            if len(area_parts) == 6 and area_parts[4] == 'artifacts' and method == 'GET':
                job = self.store.get(user, job_id, area_jobs.KIND)
                try:
                    artifact = area_jobs.download(self.store.config.root, job, unquote(area_parts[5]))
                except (OSError, ValueError, TypeError, KeyError):
                    raise Problem(404, 'not_found', 'Artifact not found') from None
                return 200, None, artifact
        if path == '/api/sources' and method == 'GET':
            try:
                from .observatory.sources import source_registry
                sources = source_registry()
                if not isinstance(sources, list):
                    raise ValueError()
                # Registry comes only from the engine; private manifests/uploads never enter it.
                return 200, {'schemaVersion': '1.0', 'sources': sources, 'assessmentDomains': list(self.store.config.assessment_domains), 'scenariosEnabled': self.store.config.scenarios_enabled}, None
            except Exception:
                raise Problem(503, 'sources_unavailable', 'Source registry is unavailable') from None
        if path == '/api/assessment-snapshots' and method == 'GET':
            return 200, {'schemaVersion': '1.0', 'snapshots': self.store.snapshots(user)}, None
        parts = path.split('/')
        if len(parts) == 4 and parts[:3] == ['', 'api', 'assessment-snapshots'] and method == 'GET':
            return 200, self.store.snapshots(user, unquote(parts[3])), None
        for collection, kind in (('assessments', 'assessment'), ('scenarios', 'scenario')):
            if path == '/api/' + collection:
                if method == 'GET':
                    return 200, {'schemaVersion': '1.0', 'jobs': self.store.list(user, kind)}, None
                if method == 'POST':
                    try:
                        request = json.loads(body)
                    except (ValueError, UnicodeDecodeError):
                        raise Problem(400, 'invalid_json', 'Invalid JSON request') from None
                    if not isinstance(request,dict):
                        raise Problem(400, 'invalid_json', 'A JSON object is required')
                    if kind == 'assessment' and request.get('domain') not in self.store.config.assessment_domains:
                        raise Problem(503, 'feature_disabled', 'This assessment workflow is awaiting activation; the scientific explorer remains available')
                    if kind == 'scenario' and not self.store.config.scenarios_enabled:
                        raise Problem(503, 'feature_disabled', 'Scenario processing is awaiting activation')
                    from .observatory.net import METHOD_VERSION
                    from .observatory.scenarios import VERSION as SCENARIO_VERSION
                    job = self.store.submit(user, request, headers.get('Idempotency-Key', ''),
                        METHOD_VERSION if kind=='assessment' else SCENARIO_VERSION, kind=kind)
                    return 202, job, None
            if len(parts) >= 4 and parts[:3] == ['', 'api', collection]:
                job_id = unquote(parts[3])
                if len(parts) == 4 and method == 'GET':
                    return 200, self.store.get(user, job_id, kind), None
                if len(parts) == 5 and parts[4] == 'cancel' and method == 'POST':
                    return 200, self.store.cancel(user, job_id, kind), None
                if len(parts) == 5 and kind == 'assessment' and parts[4] == 'snapshot' and method == 'POST':
                    if body not in (b'', b'{}'):
                        raise Problem(400, 'invalid_request', 'Snapshot uses the verified server manifest')
                    return 201, self.store.snapshot(user, job_id), None
                if len(parts) == 5 and kind == 'assessment' and parts[4] == 'brief' and method == 'GET':
                    job = self.store.get(user, job_id, kind)
                    if job['status'] != 'completed':
                        raise Problem(404, 'not_found', 'Brief not found')
                    return 200, job['result']['brief'], None
                if len(parts) == 6 and parts[4] == 'artifacts' and method == 'GET':
                    from .assessment_validation import ARTIFACTS as OBSERVATORY_ARTIFACTS, RASTER_ARTIFACTS, VINTAGE_ARTIFACTS
                    name = unquote(parts[5])
                    job = self.store.get(user, job_id, kind)
                    allowed=OBSERVATORY_ARTIFACTS | ((RASTER_ARTIFACTS|VINTAGE_ARTIFACTS) if kind=='assessment' else set())
                    if job['status'] != 'completed' or name not in allowed or name not in job['result']['artifacts']:
                        raise Problem(404, 'not_found', 'Artifact not found')
                    file = self.store.config.root / 'results' / job['id'] / name
                    if not file.is_file() or file.is_symlink():
                        raise Problem(404, 'not_found', 'Artifact not found')
                    return 200, None, file
        if path == '/api/change-jobs':
            if method == 'GET':
                return 200, {'schemaVersion':'1.0','jobs':self.store.list(user),'capability':self.capability_check()}, None
            if method == 'POST':
                try:
                    request = json.loads(body)
                except (ValueError, UnicodeDecodeError):
                    raise Problem(400, 'invalid_json', 'Invalid JSON request')
                # Existing idempotency records are available even during an activation gate.
                from .store import validate_request
                validate_request(request)
                idem = headers.get('Idempotency-Key', '')
                with self.store.connect() as db:
                    existing = db.execute('SELECT id FROM jobs WHERE owner=? AND idem=?', (user,idem)).fetchone()
                if not existing and not self.capability_check()['ready']:
                    raise Problem(503, 'processing_unavailable', self.capability_check()['message'])
                job = self.store.submit(user, request, idem, self.algorithm)
                return 202, job, None
        parts = path.split('/')
        if len(parts) >= 4 and parts[:3] == ['', 'api', 'change-jobs']:
            job_id = unquote(parts[3])
            if len(parts) == 5 and parts[4] == 'analysis' and method == 'POST':
                from .analysis import analyze, parse_body
                self.store.get(user, job_id)
                return 200, analyze(self.store, user, job_id, parse_body(body)), None
            if len(parts) == 5 and parts[4] == 'annotations':
                if method == 'GET':
                    return 200, {'annotations': self.annotations.list(user, job_id)}, None
                if method == 'POST':
                    from .analysis import parse_body
                    self.store.get(user, job_id)
                    return 201, self.annotations.append(user, job_id, parse_body(body)), None
            if len(parts) == 4 and method == 'GET':
                return 200, self.store.get(user, job_id), None
            if ((len(parts) == 5 and parts[4] == 'cancel' and method == 'POST') or
                (len(parts) == 4 and method == 'DELETE')):
                return 200, self.store.cancel(user, job_id), None
            if len(parts) == 6 and parts[4] == 'artifacts' and method == 'GET':
                name = unquote(parts[5])
                job = self.store.get(user, job_id)
                if job['status'] != 'completed' or name not in ARTIFACTS:
                    raise Problem(404, 'not_found', 'Artifact not found')
                file = self.store.config.root / 'results' / job['id'] / name
                if not file.is_file() or file.is_symlink():
                    raise Problem(404, 'not_found', 'Artifact not found')
                return 200, None, file
        raise Problem(404, 'not_found', 'Endpoint not found')

def handler(api):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        def setup(self):
            super().setup()
            self.connection.settimeout(15)
        def log_message(self, *_):
            pass  # Do not log identities, headers, source URLs or credentials.
        def handle_request(self):
            try:
                if self.headers.get('Transfer-Encoding'):
                    raise Problem(400, 'invalid_body', 'Chunked request bodies are unsupported')
                lengths = self.headers.get_all('Content-Length', [])
                if len(lengths)>1:
                    raise Problem(400, 'invalid_body', 'Ambiguous content length')
                try:
                    length = int(lengths[0]) if lengths else 0
                except ValueError:
                    raise Problem(400, 'invalid_body', 'Invalid content length')
                if length < 0 or length > body_limit(self.command, self.path):
                    raise Problem(413, 'body_too_large', 'Request body exceeds endpoint limit')
                for key in ('X-Earthsignal-User','X-Earthsignal-Timestamp','X-Earthsignal-Nonce','X-Earthsignal-Signature','Idempotency-Key'):
                    if len(self.headers.get_all(key,[]))>1:
                        raise Problem(400,'invalid_headers','Duplicate gateway headers')
                body = self.rfile.read(length)
                if len(body) != length:
                    raise Problem(400,'invalid_body','Incomplete request body')
                status, payload, file = api.dispatch(self.command, self.path, self.headers, body)
                from .area_jobs import Download
                if isinstance(file, Download):
                    self.send_response(status)
                    self.send_header('Content-Type', mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
                    self.send_header('Content-Length', str(len(file.data)))
                    self.send_header('Cache-Control', 'private, no-store')
                    self.send_header('X-Content-Type-Options', 'nosniff')
                    self.end_headers()
                    self.wfile.write(file.data)
                    return
                if file:
                    with file.open('rb') as stream:
                        size = file.stat().st_size
                        self.send_response(status)
                        self.send_header('Content-Type', mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
                        self.send_header('Content-Length',str(size))
                        self.send_header('Cache-Control','private, no-store')
                        self.send_header('X-Content-Type-Options','nosniff')
                        self.end_headers()
                        while chunk := stream.read(65536):
                            self.wfile.write(chunk)
                    return
            except Problem as error:
                status, payload = error.status, {'error': {'code':error.code,'message':error.message}}
                self.close_connection = True
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                self.close_connection = True
                return
            except Exception:
                status, payload = 500, {'error':{'code':'internal_error','message':'Service request failed'}}
                self.close_connection = True
            data = json.dumps(payload,allow_nan=False).encode()
            self.send_response(status)
            self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(data)))
            self.send_header('Cache-Control','private, no-store')
            self.end_headers()
            self.wfile.write(data)
        do_GET = do_POST = do_DELETE = handle_request
    return Handler

def create_app(api):
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse, FileResponse, Response
    from starlette.concurrency import run_in_threadpool
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.api_route('/{route:path}', methods=['GET','POST','DELETE'])
    async def endpoint(request: Request):
        try:
            if request.headers.get('transfer-encoding'):
                raise Problem(400,'invalid_body','Chunked request bodies are unsupported')
            signed_headers = {'x-earthsignal-user','x-earthsignal-timestamp','x-earthsignal-nonce',
                              'x-earthsignal-signature','idempotency-key','content-length'}
            raw_headers = request.scope['headers']
            for key in signed_headers:
                if sum(k.decode('latin1').lower()==key for k,v in raw_headers)>1:
                    raise Problem(400,'invalid_headers','Duplicate gateway headers')
            declared=request.headers.get('content-length')
            target=request.scope.get('raw_path',request.url.path.encode()).decode('ascii')
            query=request.scope.get('query_string',b'')
            if query:
                target+='?'+query.decode('ascii')
            limit=body_limit(request.method,target)
            try:
                length=int(declared) if declared else 0
            except ValueError:
                raise Problem(400,'invalid_body','Invalid content length')
            if not 0 <= length <= limit:
                raise Problem(413,'body_too_large','Request body exceeds endpoint limit')
            body=bytearray()
            async for chunk in request.stream():
                if len(body)+len(chunk)>limit:
                    raise Problem(413,'body_too_large','Request body exceeds endpoint limit')
                body.extend(chunk)
            if len(body)!=length:
                raise Problem(400,'invalid_body','Incomplete request body')
            status,payload,file=await run_in_threadpool(api.dispatch,request.method,target,request.headers,bytes(body))
            from .area_jobs import Download
            if isinstance(file,Download):
                return Response(file.data,status_code=status,media_type=mimetypes.guess_type(file.name)[0] or 'application/octet-stream',
                    headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})
            if file:
                return FileResponse(file,status_code=status,headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})
            return JSONResponse(payload,status_code=status,headers={'Cache-Control':'private, no-store'})
        except Problem as error:
            return JSONResponse({'error':{'code':error.code,'message':error.message}},status_code=error.status,headers={'Cache-Control':'private, no-store'})
        except Exception:
            return JSONResponse({'error':{'code':'internal_error','message':'Service request failed'}},status_code=500,headers={'Cache-Control':'private, no-store'})
    return app

def main():
    config = Config.environment()
    from .processing import ALGORITHM_VERSION
    import uvicorn
    app=create_app(API(Store(config),algorithm=ALGORITHM_VERSION))
    uvicorn.run(app,host='127.0.0.1',port=8030,workers=1,limit_concurrency=16,backlog=16,
                timeout_keep_alive=5,access_log=False,log_level='warning')

if __name__ == '__main__':
    main()
