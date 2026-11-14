"""Isolated processing child; errors are sanitized at the IPC boundary."""
import json
import sys
from pathlib import Path
from .config import Config
from .identity import valid_owner

def file_size_limit(config, kind=None, scoped=False):
    """Published artifacts stay capped separately by Worker.publish.

    The shared SQLite ledger has a larger bounded write envelope; its WAL must
    not kill an otherwise valid assessment at the 8 MiB export-file boundary.
    """
    if kind=='assessment' and scoped and config.gauge_vintages_enabled:
        from .observatory.vintages import MAX_BYTES
        return max(config.artifact_bytes,MAX_BYTES)
    return config.artifact_bytes


def main():
    import resource
    request_path, output = Path(sys.argv[1]), Path(sys.argv[2])
    safe_errors = ()
    try:
        with request_path.open('rb') as stream:
            raw=stream.read(12 * 1024**2 + 4097)
        if len(raw)>12 * 1024**2 + 4096:raise ValueError('IPC request exceeds bound')
        request = json.loads(raw)
        if isinstance(request, dict) and request.get('kind') == 'area-experiment':
            from .area_jobs import run, MAX_BYTES
            if set(request) != {'kind','request','owner'} or not valid_owner(request['owner']):
                raise ValueError('Invalid area envelope')
            resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_BYTES,MAX_BYTES))
            run(request['request'], output)
            return 0
        config = Config.environment()
        if len(raw)>config.artifact_bytes:raise ValueError('IPC request exceeds bound')
        if isinstance(request, dict) and request.get('kind') in ('assessment', 'scenario'):
            from .assessment_validation import (validate_assessment_request, validate_scenario_request,
                validate_assessment_manifest, validate_scenario_manifest)
            from .observatory.engine import run_assessment, run_scenario
            if request['kind'] == 'assessment':
                if set(request) not in ({'kind', 'request'}, {'kind', 'request', 'owner'}):
                    raise ValueError('Invalid assessment envelope')
                validate_assessment_request(request['request'])
                owner=request.get('owner')
                if owner is not None and not valid_owner(owner):
                    raise ValueError('Invalid assessment owner')
                limit=file_size_limit(config,'assessment',owner is not None)
                resource.setrlimit(resource.RLIMIT_FSIZE,(limit,limit))
                manifest = run_assessment(request['request'], config, output, **({'owner':owner} if owner is not None else {}))
                referenced_snapshot=None
                if manifest.get('gaugeVintage',{}).get('status')=='referenced':
                    from .observatory.vintage_reference import load_reference
                    referenced_snapshot=load_reference(output,manifest['gaugeVintage'],max_bytes=config.artifact_bytes)
                validate_assessment_manifest(manifest, request['request'],referenced_snapshot=referenced_snapshot)
            else:
                if set(request) != {'kind', 'request', 'parent'}:
                    raise ValueError('Invalid scenario envelope')
                validate_scenario_request(request['request'])
                resource.setrlimit(resource.RLIMIT_FSIZE,(config.artifact_bytes,config.artifact_bytes))
                manifest = run_scenario(request['request'], request['parent'], config, output)
                validate_scenario_manifest(manifest, request['request'], request['parent'])
        else:
            from .processing import process_job, ProcessingError
            from .range_reader import RangeError
            safe_errors = (ProcessingError, RangeError)
            resource.setrlimit(resource.RLIMIT_FSIZE,(config.artifact_bytes,config.artifact_bytes))
            manifest = process_job(request, output, config.netrc,
                max_pixels=config.max_pixels,max_transfer_bytes=config.transfer_bytes)
        (output / 'manifest.json').write_text(json.dumps(manifest, allow_nan=False))
    except Exception as error:
        # Never stringify arbitrary HTTP/GDAL exceptions: these can contain auth URLs.
        import re
        code = getattr(error, 'code', 'processing_failed')
        code = code.lower() if isinstance(code,str) and re.fullmatch(r'[A-Za-z0-9_]{1,64}',code) else 'processing_failed'
        message = str(error)[:512] if isinstance(error, safe_errors) else 'Processing could not produce a verified compatible crop'
        (output / 'error.json').write_text(json.dumps({'code':code,'message':message}))
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
