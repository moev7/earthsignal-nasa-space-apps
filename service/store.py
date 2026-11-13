"""SQLite transactions own admission, replay protection and publication state."""
import hashlib
import json
import math
import shutil
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from .assessment_validation import (validate_assessment_request, validate_scenario_request,
    validate_assessment_manifest)

STATES = ('queued', 'running', 'completed', 'failed', 'cancelled')
ARTIFACTS = {'manifest.json', 'before.png', 'after.png', 'difference.png', 'excluded.png',
             'before.tif', 'after.tif', 'difference.tif', 'validity.tif'}

class Problem(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message
        super().__init__(message)

def iso(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace('+00:00', 'Z')

def validate_request(request):
    if not isinstance(request, dict) or set(request) != {'beforeId', 'afterId', 'bbox'}:
        raise Problem(400, 'invalid_request', 'Expected beforeId, afterId and bbox')
    for k in ('beforeId', 'afterId'):
        v = request[k]
        if not isinstance(v, str) or not 1 <= len(v) <= 220 or any(ord(c) < 32 for c in v):
            raise Problem(400, 'invalid_request', 'Invalid acquisition ID')
    bbox = request['bbox']
    if (not isinstance(bbox, list) or len(bbox) != 4 or
        any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in bbox) or
        not (-180 <= bbox[0] < bbox[2] <= 180 and -90 <= bbox[1] < bbox[3] <= 90) or
        request['beforeId'] == request['afterId']):
        raise Problem(400, 'invalid_request', 'Select distinct acquisitions and a valid non-empty bbox')
    return request

def cache_key(request, algorithm):
    return hashlib.sha256(json.dumps([request['beforeId'], request['afterId'], request['bbox'], algorithm],
        separators=(',', ':'), allow_nan=False).encode()).hexdigest()

class Store:
    def __init__(self, config, clock=time.time):
        self.config, self.clock = config, clock
        config.root.mkdir(parents=True, exist_ok=True)
        for name in ('results', 'staging'):
            (config.root / name).mkdir(exist_ok=True)
        for path in (config.root, config.root / 'results', config.root / 'staging'):
            path.chmod(0o700)
        with self.connect() as db:
            db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS jobs (
              id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL,
              request TEXT NOT NULL, cache TEXT NOT NULL, idem TEXT NOT NULL,
              created REAL NOT NULL, updated REAL NOT NULL, phase TEXT NOT NULL,
              prepared INTEGER NOT NULL DEFAULT 0, result TEXT, error TEXT,
              lease REAL, expires REAL, selection TEXT, UNIQUE(owner, idem));
            CREATE INDEX IF NOT EXISTS jobs_fifo ON jobs(state,created);
            CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(owner,created);
            CREATE TABLE IF NOT EXISTS nonces (user TEXT NOT NULL, nonce TEXT NOT NULL,
              expires REAL NOT NULL, PRIMARY KEY(user,nonce));
            ''')
            if 'kind' not in {r['name'] for r in db.execute('PRAGMA table_info(jobs)')}:
                db.execute("ALTER TABLE jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'radar'")
            db.execute('''CREATE TABLE IF NOT EXISTS assessment_snapshots (
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, source_job TEXT NOT NULL,
                created REAL NOT NULL, manifest_hash TEXT NOT NULL,
                artifact_expires REAL, manifest TEXT NOT NULL,
                UNIQUE(owner, source_job, manifest_hash))''')
            if 'selection' not in {r['name'] for r in db.execute('PRAGMA table_info(jobs)')}:
                db.execute('ALTER TABLE jobs ADD COLUMN selection TEXT')
        self._private_database_files()

    def _private_database_files(self):
        for name in ('jobs.sqlite3', 'jobs.sqlite3-wal', 'jobs.sqlite3-shm'):
            path = self.config.root / name
            try:
                path.chmod(0o600)
            except FileNotFoundError:
                # SQLite may remove idle WAL/SHM files when the last other
                # connection closes. Their database inherits mode0600.
                pass

    def _open_connection(self):
        db = sqlite3.connect(self.config.root / 'jobs.sqlite3', timeout=15)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA busy_timeout=15000')
        db.execute('PRAGMA secure_delete=ON')
        self._private_database_files()
        return db

    @contextmanager
    def connect(self):
        db = self._open_connection()
        try:
            with db:
                yield db
        finally:
            db.close()

    @contextmanager
    def transaction(self):
        db = self._open_connection()
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def nonce(self, user, nonce, signed_at):
        now = self.clock()
        with self.transaction() as db:
            self._expire_area_queue(db)
            db.execute('DELETE FROM nonces WHERE expires < ?', (now,))
            try:
                # Retain until this timestamp can no longer pass freshness, plus margin.
                db.execute('INSERT INTO nonces VALUES(?,?,?)', (user, nonce, signed_at + 121))
            except sqlite3.IntegrityError:
                raise Problem(401, 'replay', 'Gateway signature was already used')

    def disk_ready(self, additional=0):
        total = sum(p.stat().st_size for p in self.config.root.rglob('*') if p.is_file())
        # Physical DB/WAL bytes are already in total. Reserve future copies and
        # scratch for every outstanding area job; subtract materialized input
        # once and existing staging bytes instead of counting them twice. The
        # original 96 MiB admission reservation is never weakened.
        with self.connect() as db:
            active = db.execute("SELECT id,length(CAST(request AS BLOB)) AS input_size FROM jobs WHERE kind='area-experiment' AND state IN ('queued','running')").fetchall()
        reserved = 0
        for row in active:
            stage = self.config.root / 'staging' / row['id']
            materialized = sum(p.stat().st_size for p in stage.rglob('*') if p.is_file()) if stage.is_dir() else 0
            reserved += max(0, self.config.job_reservation_bytes - row['input_size'] - materialized)
        additional += reserved
        return total + additional < self.config.storage_bytes and shutil.disk_usage(self.config.root).free >= self.config.reserve_bytes + additional

    def _compact(self, db, job_id):
        """Called in the same transaction as every terminal state transition."""
        row = db.execute("SELECT request FROM jobs WHERE id=? AND kind='area-experiment'", (job_id,)).fetchone()
        if row:
            from .area_jobs import identity
            request = json.dumps(identity(json.loads(row['request'])), sort_keys=True, separators=(',', ':'))
            db.execute('UPDATE jobs SET request=? WHERE id=?', (request, job_id))

    def _expire_area_queue(self, db):
        from .area_jobs import QUEUE_ALLOWANCE
        now = self.clock()
        rows = db.execute("SELECT id FROM jobs WHERE kind='area-experiment' AND state='queued' AND created<=?",
                          (now - self.config.wall_seconds - QUEUE_ALLOWANCE,)).fetchall()
        for row in rows:
            db.execute("UPDATE jobs SET state='failed',phase='Expired in queue',updated=?,expires=?,error=? WHERE id=?",
                       (now, now+self.config.expiry_seconds, json.dumps(dict(code='queue_expired', message='Queued input retention expired; submit a new job')), row['id']))
            self._compact(db, row['id'])

    def submit(self, owner, request, idem, algorithm, selection=None, kind='radar'):
        try:
            if kind == 'radar':
                validate_request(request)
            elif kind == 'assessment':
                validate_assessment_request(request)
            elif kind == 'scenario':
                validate_scenario_request(request)
            elif kind == 'area-experiment':
                from .area_jobs import validate_request as validate_area_request
                validate_area_request(request)
            elif kind == 'sar-study':
                from .sar.jobs import validate_request as validate_sar_request
                validate_sar_request(request)
            else:
                raise ValueError()
        except (ValueError, TypeError, KeyError, OverflowError, RecursionError, UnicodeError):
            raise Problem(400, 'invalid_request', 'Invalid observatory request') from None
        if kind != 'radar' and selection is not None:
            raise Problem(400, 'invalid_request', 'Selection metadata is radar-only')
        if not isinstance(idem, str) or not 1 <= len(idem) <= 128 or any(ord(c) < 33 or ord(c) > 126 for c in idem):
            raise Problem(400, 'idempotency_required', 'Supply a printable Idempotency-Key of 1–128 characters')
        now, encoded = self.clock(), json.dumps(request, sort_keys=True, separators=(',', ':'))
        selected = json.dumps(selection,allow_nan=False) if selection else None
        if selected and len(selected.encode()) > 16384:
            raise Problem(400,'selection_limit','Selection rationale exceeds 16 KB')
        with self.transaction() as db:
            self._expire_area_queue(db)
            old = db.execute('SELECT * FROM jobs WHERE owner=? AND idem=?', (owner, idem)).fetchone()
            if old:
                if kind == 'area-experiment' and old['kind'] == kind:
                    from .area_jobs import identity
                    same = identity(json.loads(old['request'])) == identity(request)
                else:
                    same = old['request'] == encoded
                if not same or old['kind'] != kind:
                    raise Problem(409, 'idempotency_conflict', 'Key already identifies another request')
                if kind != 'radar' and old['expires'] is not None and old['expires'] <= now:
                    raise Problem(404, 'not_found', 'Job not found')
                return self.wire(old)
            if kind == 'area-experiment' and not self.config.area_experiments_enabled:
                raise Problem(503, 'feature_disabled', 'Area experiment submissions are disabled')
            if kind == 'scenario':
                parent = self.scenario_parent(db, owner, request['assessmentId'])
                if request['kind'] == 'threshold':
                    metric = next((m for m in parent['metrics'] if m['id'] == request['inputs']['metricId']), None)
                    if metric is None or metric['value'] is None:
                        raise Problem(400, 'invalid_metric', 'Select an available parent metric')
            if db.execute("SELECT count(*) FROM jobs WHERE state IN ('queued','running') AND owner=?", (owner,)).fetchone()[0] >= self.config.owner_outstanding:
                raise Problem(429, 'owner_limit', f'Outstanding job limit: {self.config.owner_outstanding}')
            if db.execute('SELECT count(*) FROM jobs WHERE owner=? AND created>?', (owner, now - 86400)).fetchone()[0] >= self.config.owner_daily:
                raise Problem(429, 'daily_limit', f'Submission limit: {self.config.owner_daily} per rolling 24 hours')
            if db.execute("SELECT count(*) FROM jobs WHERE state='queued'").fetchone()[0] >= self.config.queue_limit:
                raise Problem(429, 'queue_full', 'Processing queue is full')
            if not self.disk_ready(self.config.job_reservation_bytes):
                raise Problem(503, 'storage_limit', 'Processing storage is unavailable')
            job_id = uuid.uuid4().hex
            stable_request = request
            if kind == 'area-experiment':
                from .area_jobs import identity
                stable_request = identity(request)
            key = cache_key(request, algorithm) if kind == 'radar' else hashlib.sha256(json.dumps([kind, owner, stable_request, algorithm], sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
            db.execute('INSERT INTO jobs(id,owner,state,request,cache,idem,created,updated,phase,selection,kind) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                       (job_id, owner, 'queued', encoded, key, idem, now, now, 'Waiting for worker', selected, kind))
            return self.wire(db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone())

    def wire(self, row):
        request = json.loads(row['request'])
        if row['kind'] == 'area-experiment':
            from .area_jobs import identity
            return dict(schemaVersion='1.0', kind=row['kind'], id=row['id'], status=row['state'], phase=row['phase'],
                createdAt=iso(row['created']), updatedAt=iso(row['updated']), expiresAt=iso(row['expires']) if row['expires'] is not None else None,
                request=identity(request), result=json.loads(row['result']) if row['result'] else None,
                error=json.loads(row['error']) if row['error'] else None)
        if row['kind'] != 'radar':
            return dict(schemaVersion='1.0', kind=row['kind'], id=row['id'], status=row['state'], phase=row['phase'],
                createdAt=iso(row['created']), updatedAt=iso(row['updated']), request=request,
                result=json.loads(row['result']) if row['result'] else None,
                error=json.loads(row['error']) if row['error'] else None)
        return dict(schemaVersion='1.0', id=row['id'], status=row['state'], phase=row['phase'],
                    createdAt=iso(row['created']), updatedAt=iso(row['updated']), **request,
                    prepared=bool(row['prepared']), result=json.loads(row['result']) if row['result'] else None,
                    error=json.loads(row['error']) if row['error'] else None)

    def visible_row(self, db, owner, job_id, kind='radar'):
        row = db.execute("SELECT * FROM jobs WHERE id=? AND kind=? AND (owner=? OR (prepared=1 AND kind='radar'))", (job_id, kind, owner)).fetchone()
        if not row or (row['expires'] is not None and row['expires'] <= self.clock() and not row['prepared']):
            raise Problem(404, 'not_found', 'Job not found')
        return row

    def get(self, owner, job_id, kind='radar'):
        with self.connect() as db:
            return self.wire(self.visible_row(db, owner, job_id, kind))

    def list(self, owner, kind='radar'):
        with self.connect() as db:
            return [self.wire(row) for row in db.execute("SELECT * FROM jobs WHERE kind=? AND (owner=? OR (prepared=1 AND kind='radar')) AND (expires IS NULL OR expires>? OR prepared=1) ORDER BY created DESC LIMIT 100", (kind, owner, self.clock()))]

    def cancel(self, owner, job_id, kind='radar'):
        with self.transaction() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=? AND owner=? AND kind=? AND (expires IS NULL OR expires>?)', (job_id, owner, kind, self.clock())).fetchone()
            if not row:
                raise Problem(404, 'not_found', 'Job not found')
            if row['state'] in ('queued', 'running'):
                db.execute("UPDATE jobs SET state='cancelled',phase='Cancelled',updated=?,lease=NULL,expires=? WHERE id=?", (self.clock(), self.clock()+self.config.expiry_seconds, job_id))
                self._compact(db, job_id)
            return self.wire(db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone())

    def claim(self):
        with self.transaction() as db:
            self._expire_area_queue(db)
            if db.execute("SELECT 1 FROM jobs WHERE state='running'").fetchone():
                return None
            row = db.execute("SELECT * FROM jobs WHERE state='queued' ORDER BY created,id LIMIT 1").fetchone()
            if row and not self.disk_ready(0 if row['kind'] == 'area-experiment' else self.config.job_reservation_bytes):
                db.execute("UPDATE jobs SET state='failed',phase='Failed',updated=?,expires=?,error=? WHERE id=?", (self.clock(),self.clock()+self.config.expiry_seconds,json.dumps(dict(code='storage_limit',message='Storage reservation unavailable')),row['id']))
                self._compact(db, row['id'])
                return None
            if row:
                db.execute("UPDATE jobs SET state='running',updated=?,lease=?,phase=? WHERE id=?", (self.clock(), self.clock()+self.config.lease_seconds, 'Inspecting source products' if row['kind'] == 'radar' else 'Preparing evidence assessment' if row['kind'] == 'assessment' else 'Calculating conditional area experiment' if row['kind'] == 'area-experiment' else 'Evaluating conditional scenario', row['id']))
                return dict(db.execute('SELECT * FROM jobs WHERE id=?', (row['id'],)).fetchone())

    def heartbeat(self, job_id, phase='Processing native crop'):
        with self.transaction() as db:
            self._expire_area_queue(db)
            return db.execute("UPDATE jobs SET updated=?,lease=?,phase=? WHERE id=? AND state='running'", (self.clock(), self.clock()+self.config.lease_seconds, phase, job_id)).rowcount == 1

    def fail(self, job_id, code, message):
        with self.transaction() as db:
            row = db.execute('SELECT kind FROM jobs WHERE id=?', (job_id,)).fetchone()
            if row and row['kind'] == 'area-experiment':
                code = code if code in ('storage_limit','time_limit','interrupted','processing_failed') else 'processing_failed'
                message = 'Area experiment processing failed; private input is not included in errors'
            db.execute("UPDATE jobs SET state='failed',phase='Failed',error=?,updated=?,lease=NULL,expires=? WHERE id=? AND state='running'", (json.dumps(dict(code=code, message=message)), self.clock(), self.clock()+self.config.expiry_seconds, job_id))
            terminal = db.execute('SELECT state FROM jobs WHERE id=?', (job_id,)).fetchone()
            if terminal and terminal['state'] in ('failed','cancelled','completed'):
                self._compact(db, job_id)

    def complete(self, job_id, manifest):
        with self.transaction() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not row or row['state'] != 'running':
                return False
            if row['kind'] == 'area-experiment':
                from .area_jobs import validate_manifest
                validate_manifest(manifest, json.loads(row['request']))
            if row['kind'] == 'sar-study' and (manifest.get('kind') != 'sar-study' or manifest.get('published') is not False):
                raise ValueError('SAR result must be a private verified study')
            changed = db.execute("UPDATE jobs SET state='completed',phase='Completed',result=?,updated=?,lease=NULL,expires=? WHERE id=? AND state='running'", (json.dumps(manifest, allow_nan=False), self.clock(), self.clock()+self.config.expiry_seconds, job_id)).rowcount == 1
            if changed:
                self._compact(db, job_id)
            return changed

    def cache(self, key):
        with self.connect() as db:
            return db.execute("SELECT * FROM jobs WHERE cache=? AND state='completed' AND (expires>? OR prepared=1) ORDER BY created LIMIT 1", (key, self.clock())).fetchone()

    def pin(self, job_id):
        with self.transaction() as db:
            if db.execute("UPDATE jobs SET prepared=1,expires=NULL WHERE id=? AND state='completed' AND kind='radar'", (job_id,)).rowcount != 1:
                raise Problem(409, 'not_completed', 'Only successful studies may be pinned')

    def recover(self, restart=False):
        """Called only under worker flock; stale/restarted jobs never auto-retry."""
        with self.transaction() as db:
            self._expire_area_queue(db)
            rows = db.execute("SELECT id FROM jobs WHERE state='running' AND (? OR lease IS NULL OR lease<?)", (restart, self.clock())).fetchall()
            for row in rows:
                db.execute("UPDATE jobs SET state='failed',phase='Interrupted',error=?,lease=NULL,updated=?,expires=? WHERE id=?", (json.dumps(dict(code='interrupted', message='Worker interrupted; submit a new job')), self.clock(), self.clock()+self.config.expiry_seconds, row['id']))
                self._compact(db, row['id'])
        for row in rows:
            for folder in ('staging', 'results'):
                shutil.rmtree(self.config.root / folder / row['id'], ignore_errors=True)
        return len(rows)

    def cleanup(self):
        with self.transaction() as db:
            self._expire_area_queue(db)
            expired = [r['id'] for r in db.execute('SELECT id FROM jobs WHERE prepared=0 AND expires<=?', (self.clock(),))]
            db.executemany('DELETE FROM jobs WHERE id=?', ((i,) for i in expired))
            keep = {r['id']: r['state'] for r in db.execute('SELECT id,state FROM jobs')}
        for folder in ('staging', 'results'):
            for path in (self.config.root / folder).iterdir():
                if path.is_dir() and (path.name not in keep or
                    (folder == 'staging' and keep[path.name] != 'running') or
                    (folder == 'results' and keep[path.name] != 'completed')):
                    shutil.rmtree(path)

    def scenario_parent(self, db, owner, job_id):
        row = self.visible_row(db, owner, job_id, 'assessment')
        if row['owner'] != owner or row['state'] != 'completed':
            raise Problem(409, 'parent_not_completed', 'Scenario requires an owned completed assessment')
        try:
            parent = json.loads(row['result'])
            # Only the verified completed database path may replay immutable
            # archived methods. New worker publication keeps the strict default.
            validate_assessment_manifest(parent, json.loads(row['request']),allow_archived=True)
        except (ValueError, TypeError, KeyError, OverflowError):
            raise Problem(409, 'invalid_parent', 'Assessment has no verified manifest') from None
        return parent

    def parent_for_job(self, row):
        with self.connect() as db:
            return self.scenario_parent(db, row['owner'], json.loads(row['request'])['assessmentId'])

    def snapshot(self, owner, job_id):
        with self.transaction() as db:
            row = self.visible_row(db, owner, job_id, 'assessment')
            if row['state'] != 'completed':
                raise Problem(409, 'not_completed', 'Only completed assessments may be saved')
            manifest = self.scenario_parent(db, owner, job_id)
            encoded = json.dumps(manifest, sort_keys=True, separators=(',', ':'), allow_nan=False)
            digest = hashlib.sha256(encoded.encode()).hexdigest()
            old = db.execute('SELECT * FROM assessment_snapshots WHERE owner=? AND source_job=? AND manifest_hash=?', (owner, job_id, digest)).fetchone()
            if old:
                return self.snapshot_wire(old)
            if db.execute('SELECT count(*) FROM assessment_snapshots WHERE owner=?', (owner,)).fetchone()[0] >= 100:
                raise Problem(429, 'snapshot_limit', 'Saved assessment limit: 100')
            if not self.disk_ready(len(encoded.encode()) + 8192):
                raise Problem(503, 'storage_limit', 'Snapshot storage is unavailable')
            snapshot_id = uuid.uuid4().hex
            db.execute('INSERT INTO assessment_snapshots VALUES(?,?,?,?,?,?,?)', (snapshot_id, owner, job_id, self.clock(), digest, row['expires'], encoded))
            return self.snapshot_wire(db.execute('SELECT * FROM assessment_snapshots WHERE id=?', (snapshot_id,)).fetchone())

    def snapshot_wire(self, row):
        return dict(schemaVersion='1.0', id=row['id'], sourceJobId=row['source_job'],
            createdAt=iso(row['created']), manifestHash=row['manifest_hash'],
            artifactExpiresAt=iso(row['artifact_expires']) if row['artifact_expires'] is not None else None,
            manifest=json.loads(row['manifest']))

    def snapshots(self, owner, snapshot_id=None):
        with self.connect() as db:
            if snapshot_id is not None:
                row = db.execute('SELECT * FROM assessment_snapshots WHERE id=? AND owner=?', (snapshot_id, owner)).fetchone()
                if not row:
                    raise Problem(404, 'not_found', 'Snapshot not found')
                return self.snapshot_wire(row)
            return [self.snapshot_wire(row) for row in db.execute('SELECT * FROM assessment_snapshots WHERE owner=? ORDER BY created DESC,id DESC LIMIT 100', (owner,))]
