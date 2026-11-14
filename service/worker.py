import fcntl
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from .config import Config
from .store import Store, ARTIFACTS

class Worker:
    def __init__(self, store):
        self.store = store
        self.stopping = False

    def lock(self):
        self.lock_file = (self.store.config.root / 'worker.lock').open('a')
        fcntl.flock(self.lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def halt(self, *_):
        self.stopping = True

    @staticmethod
    def terminate(process):
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()

    def publish(self, row, stage):
        from .assessment_validation import (ARTIFACTS as OBSERVATORY_ARTIFACTS, RASTER_ARTIFACTS, VINTAGE_ARTIFACTS,
            validate_assessment_manifest, validate_scenario_manifest, validate_brief)
        kind = row.get('kind', 'radar')
        if kind == 'area-experiment':
            from .area_jobs import verify
            manifest = verify(stage, json.loads(row['request']))
            return self._commit_publication(row, stage, manifest)
        artifacts = ARTIFACTS if kind == 'radar' else OBSERVATORY_ARTIFACTS
        # Bound every file before parsing, reject unexpected names and symlinks.
        allowed = artifacts | (RASTER_ARTIFACTS|VINTAGE_ARTIFACTS if kind=='assessment' else set()) | {'request.json', 'error.json'}
        if any(p.name not in allowed or not p.is_file() or p.is_symlink() or p.stat().st_size > self.store.config.artifact_bytes for p in stage.iterdir()):
            raise ValueError('Artifact storage bounds exceeded')
        for name in artifacts:
            if not (stage/name).is_file() or (stage/name).is_symlink():
                raise ValueError('Incomplete artifact set')
        manifest = json.loads((stage / 'manifest.json').read_text())
        request = json.loads(row['request'])
        if kind == 'radar':
            from .manifest import validate_manifest
            if row.get('selection'):
                manifest['processing']['sourceMetadata']['selectionRationale'] = {**json.loads(row['selection']),
                    'verification':'Successful native crop with verified compatibility, mask and nonempty common validity'}
                (stage/'manifest.json').write_text(json.dumps(manifest,allow_nan=False))
            validate_manifest(manifest, request)
            if manifest['crop']['width']*manifest['crop']['height'] > self.store.config.max_pixels:
                raise ValueError('Configured crop pixel limit exceeded')
        else:
            if kind == 'assessment':
                referenced_snapshot=None
                if manifest.get('gaugeVintage',{}).get('status')=='referenced':
                    from .observatory.vintage_reference import load_reference
                    referenced_snapshot=load_reference(stage,manifest['gaugeVintage'],max_bytes=self.store.config.artifact_bytes)
                validate_assessment_manifest(manifest, request,referenced_snapshot=referenced_snapshot)
                artifacts=set(manifest['artifacts'])
                for name in artifacts:
                    if not (stage/name).is_file():raise ValueError('Incomplete raster artifacts')
                if any(p.name not in artifacts|{'request.json','error.json'} for p in stage.iterdir()):raise ValueError('Unreferenced artifact')
                if manifest.get('rasters'):
                    from .observatory.views import verify_exports
                    for view in manifest['rasters']:verify_exports(view,stage)
                evidence, area, brief = manifest['evidence'], manifest['area'], manifest['brief']
            elif kind == 'scenario':
                parent = self.store.parent_for_job(row)
                validate_scenario_manifest(manifest, request, parent)
                evidence, area = parent['evidence'], parent['area']
                brief = json.loads((stage/'brief.json').read_text())
                validate_brief(brief, {c['id'] for c in manifest['claims']})
            else:
                raise ValueError('Unknown job kind')
            if (json.loads((stage/'evidence.json').read_text()) != evidence or
                json.loads((stage/'area.geojson').read_text()) != area or
                json.loads((stage/'brief.json').read_text()) != brief):
                raise ValueError('Inconsistent artifact set')
            # The CSV is a rendering of manifest metrics, never a second evidence channel.
            import csv
            with (stage/'metrics.csv').open(newline='') as stream:
                reader = csv.DictReader(stream)
                columns = reader.fieldnames
                if (not columns or len(columns) != len(set(columns)) or
                    not {'id', 'unit', 'value'} <= set(columns) <= {'id', 'label', 'value', 'unit', 'description', 'denominator', 'evidenceIds'}):
                    raise ValueError('Inconsistent metrics artifact')
                table = list(reader)
            metrics = manifest['metrics'] if kind == 'assessment' else manifest['outputs']
            if len(table) != len(metrics):
                raise ValueError('Inconsistent metrics artifact')
            for rendered, metric in zip(table, metrics):
                if rendered.get('id') != metric['id'] or rendered.get('unit') != metric['unit']:
                    raise ValueError('Inconsistent metrics artifact')
                if None in rendered:
                    raise ValueError('Inconsistent metrics artifact')
                for key in ('label', 'description', 'denominator'):
                    if key in rendered and rendered[key] != (metric[key] if metric[key] is not None else ''):
                        raise ValueError('Inconsistent metrics artifact')
                if 'evidenceIds' in rendered:
                    if rendered['evidenceIds'] not in (json.dumps(metric['evidenceIds']), json.dumps(metric['evidenceIds'], separators=(',', ':')), ';'.join(metric['evidenceIds'])):
                        raise ValueError('Inconsistent metrics artifact')
                value = rendered.get('value')
                if metric['value'] is None:
                    if value not in ('', 'null'):
                        raise ValueError('Inconsistent metrics artifact')
                elif value is None or float(value) != metric['value']:
                    raise ValueError('Inconsistent metrics artifact')
        return self._commit_publication(row, stage, manifest)

    def _commit_publication(self, row, stage, manifest):
        if sum(p.stat().st_size for p in stage.iterdir()) > self.store.config.job_reservation_bytes:
            raise ValueError('Job storage reservation exceeded')
        # Remove IPC request/error files; never publish incomplete or private staging.
        for name in ('request.json','error.json'):
            (stage/name).unlink(missing_ok=True)
        output = self.store.config.root / 'results' / row['id']
        # Same filesystem rename; API requires committed completed state too.
        for artifact in stage.iterdir():
            if row.get('kind') == 'area-experiment':
                artifact.chmod(0o600)
            with artifact.open('rb') as stream:
                os.fsync(stream.fileno())
        directory = os.open(stage, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        os.rename(stage, output)
        directory = os.open(output.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        if not self.store.complete(row['id'], manifest):
            shutil.rmtree(output, ignore_errors=True)
            return False
        return True

    def run_one(self):
        self.store.recover()
        self.store.cleanup()
        row = self.store.claim()
        if not row:
            return False
        stage = self.store.config.root / 'staging' / row['id']
        stage.mkdir(mode=0o700)
        process = None
        try:
            cached = self.store.cache(row['cache']) if row['kind'] == 'radar' else None
            if cached:
                source = self.store.config.root / 'results' / cached['id']
                size = sum((source/name).stat().st_size for name in ARTIFACTS)
                used = sum(p.stat().st_size for p in self.store.config.root.rglob('*') if p.is_file())
                if used + size > self.store.config.storage_bytes or shutil.disk_usage(stage).free - size < self.store.config.reserve_bytes:
                    self.store.fail(row['id'],'storage_limit','Cache copy exceeds storage budget')
                    return True
                for name in ARTIFACTS:
                    shutil.copyfile(source/name, stage/name)
                self.publish(row, stage)
                return True
            envelope = row['request']
            if row['kind'] != 'radar':
                envelope = json.dumps(dict(kind=row['kind'], request=json.loads(row['request']),
                    **({'parent': self.store.parent_for_job(row)} if row['kind'] == 'scenario' else {'owner': row['owner']})), allow_nan=False)
            if row['kind'] == 'area-experiment':
                from .area_jobs import private_write
                private_write(stage / 'request.json', envelope.encode())
            else:
                (stage / 'request.json').write_text(envelope)
            environment = dict(os.environ, GDAL_CACHEMAX='32', GDAL_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1',
                               OMP_NUM_THREADS='1', EARTHSIGNAL_DATA_DIR=str(self.store.config.root),
                               EARTHSIGNAL_NETRC=str(self.store.config.netrc),
                               EARTHSIGNAL_GAUGE_VINTAGES_ENABLED=str(self.store.config.gauge_vintages_enabled).lower(),
                               EARTHSIGNAL_STORAGE_BYTES=str(self.store.config.storage_bytes),
                               EARTHSIGNAL_RESERVE_BYTES=str(self.store.config.reserve_bytes))
            # Backend secrets are unnecessary in the processing subprocess.
            environment.pop('EARTHSIGNAL_GATEWAY_SECRET',None)
            # run_job config uses a placeholder only to satisfy Config validation; never a real key.
            environment['EARTHSIGNAL_GATEWAY_SECRET']='isolated-science-process-no-gateway-access'
            process = subprocess.Popen([sys.executable,'-m','service.run_job',str(stage/'request.json'),str(stage)],
                cwd=str(__import__('pathlib').Path(__file__).resolve().parent.parent), env=environment,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            start = time.monotonic()
            while process.poll() is None:
                phase = 'Calculating conditional area experiment' if row['kind'] == 'area-experiment' else 'Processing native crop'
                if self.stopping or not self.store.heartbeat(row['id'], phase):
                    self.terminate(process)
                    self.store.fail(row['id'],'interrupted','Worker stopped')
                    return True
                if time.monotonic()-start > self.store.config.wall_seconds:
                    self.terminate(process)
                    self.store.fail(row['id'],'time_limit','Configured processing time limit exceeded')
                    return True
                if not self.store.disk_ready():
                    self.terminate(process)
                    self.store.fail(row['id'],'storage_limit','Processing storage limit reached')
                    return True
                time.sleep(1)
            if not self.store.heartbeat(row['id'], 'Verifying area experiment exports' if row['kind'] == 'area-experiment' else 'Processing native crop'):
                return True
            if process.returncode != 0:
                error = json.loads((stage/'error.json').read_text()) if (stage/'error.json').is_file() else {}
                self.store.fail(row['id'],error.get('code','processing_failed') if row['kind'] == 'radar' else 'processing_failed',
                    error.get('message','Processing could not produce a verified compatible crop') if row['kind'] == 'radar' else 'Assessment processing or publication failed')
            else:
                if not self.store.disk_ready():
                    self.store.fail(row['id'],'storage_limit','Processing storage limit reached')
                else:
                    self.publish(row, stage)
        except Exception:
            self.store.fail(row['id'],'processing_failed','Verified processing or publication failed')
        finally:
            if process:
                self.terminate(process)
            shutil.rmtree(stage, ignore_errors=True)
        return True

    def run(self):
        self.lock()
        self.store.recover(restart=True)
        self.store.cleanup()
        signal.signal(signal.SIGTERM,self.halt)
        signal.signal(signal.SIGINT,self.halt)
        while not self.stopping:
            if not self.run_one():
                time.sleep(1)

def main():
    Worker(Store(Config.environment())).run()

if __name__ == '__main__':
    main()
