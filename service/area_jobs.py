"""Bounded private queue adapter for the unchanged offline area calculator.

Queued input has a wall_seconds + 60 second deadline, enforced at worker
heartbeats/maintenance, admission and signed requests, without retry. A stopped
service cannot erase data on a wall-clock deadline. Terminal transactions retain
only raw SHA-256 and length. secure_delete is defense in depth, not a promise of
physical erasure of SQLite/WAL/backups.
"""
import csv
from dataclasses import dataclass
import hashlib
import io
import json
import os

MAX_BYTES = 2 * 1024**2
KIND = 'area-experiment'
METHOD = 'stratified-srswor-equal-area-v1'
ARTIFACTS = {'input.json', 'result.json', 'areas.csv', 'manifest.json'}
TOTAL_BYTES = 6 * 1024**2
QUEUE_ALLOWANCE = 60
FLAGS = ('scientificallyValidated', 'fieldTruthEstablished', 'mapAccuracyEstimated',
         'referenceErrorQuantified', 'publicDecisionAuthority')


def strict_load(raw):
    from .benchmarks.forecast_policy import _pairs, _constant, _float
    if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_BYTES:
        raise ValueError('Input bound')
    # Bound nesting and parser allocation before constructing untrusted JSON.
    depth = tokens = 0
    quoted = escaped = False
    for byte in raw:
        if quoted:
            if escaped:
                escaped = False
            elif byte == 92:
                escaped = True
            elif byte == 34:
                quoted = False
        elif byte == 34:
            quoted = True
        elif byte in (91, 123):
            depth += 1
            tokens += 1
        elif byte in (93, 125):
            depth -= 1
        elif byte in (44, 58):
            tokens += 1
        if depth > 32 or tokens > 20000:
            raise ValueError('Structure bound')
    return json.loads(raw.decode('utf-8'), object_pairs_hook=_pairs,
                      parse_constant=_constant, parse_float=_float)


def admit(raw):
    value = strict_load(raw)
    if (type(value) is not dict or set(value) != {'schemaVersion','kind','evidenceKind','design','outcomes','context'} or
        type(value['schemaVersion']) is not int or value['schemaVersion'] != 1 or
        value['kind'] != 'stratified-area-experiment' or
        any(type(value[k]) is not dict for k in ('design','outcomes','context'))):
        raise ValueError('Envelope required')
    # Structural admission only; scientific validation belongs to the child.
    for values, maximum in ((value['design'].get('classes'), 8),
                            (value['design'].get('strata'), 64),
                            (value['outcomes'].get('records'), 320)):
        if type(values) is not list or len(values) > maximum:
            raise ValueError('Collection bound')
    return {'inputText': raw.decode('utf-8'), 'inputFileSha256': hashlib.sha256(raw).hexdigest(),
            'inputBytes': len(raw)}


def identity(request):
    return {key: request[key] for key in ('inputFileSha256', 'inputBytes')}


def validate_request(request):
    if type(request) is not dict or set(request) != {'inputText','inputFileSha256','inputBytes'} or type(request['inputText']) is not str:
        raise ValueError('Invalid internal request')
    raw = request['inputText'].encode('utf-8')
    if type(request['inputBytes']) is not int or admit(raw) != request:
        raise ValueError('Changed internal request')


def encoded(value):
    from .benchmarks.forecast_policy import canonical_json
    raw = (canonical_json(value) + '\n').encode('utf-8')
    if len(raw) > MAX_BYTES:
        raise ValueError('Output bound')
    return raw


def csv_bytes(result):
    stream = io.StringIO(newline='')
    writer = csv.writer(stream)
    keys = ('id','proportion','areaM2','proportionSamplingSE','areaSamplingSE_M2')
    writer.writerow(keys)
    for row in result['calculation']['classes']:
        name = row['id']
        # CSV quoting alone does not prevent spreadsheet formula execution.
        if name.lstrip().startswith(('=', '+', '-', '@', '\t', '\r', '\n')):
            name = "'" + name
        writer.writerow([name] + [row[k] for k in keys[1:]])
    raw = stream.getvalue().encode('utf-8')
    if len(raw) > MAX_BYTES:
        raise ValueError('CSV bound')
    return raw


def describe(raw):
    return {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}


def exports(source, request):
    from .benchmarks.area_experiment import experiment, read_pinned
    raw = bounded_read(source)
    if describe(raw) != {'sha256':request['inputFileSha256'], 'bytes':request['inputBytes']}:
        raise ValueError('Changed source')
    strict_load(raw)
    result = experiment(read_pinned(source, request['inputFileSha256']))
    result['inputFileSha256'] = request['inputFileSha256']
    files = {'input.json':raw, 'result.json':encoded(result), 'areas.csv':csv_bytes(result)}
    manifest = {'schemaVersion':'1.0', 'kind':KIND, 'inputFileSha256':request['inputFileSha256'],
                'methodVersion':METHOD, **dict.fromkeys(FLAGS, False),
                'artifacts':{name:describe(data) for name,data in files.items()}}
    files['manifest.json'] = encoded(manifest)
    if sum(map(len, files.values())) > TOTAL_BYTES:
        raise ValueError('Total artifact bound')
    return manifest, files


def validate_manifest(manifest, request):
    if type(manifest) is not dict or set(manifest) != {'schemaVersion','kind','inputFileSha256','methodVersion','artifacts',*FLAGS}:
        raise ValueError('Invalid compact manifest')
    if (manifest['schemaVersion'] != '1.0' or manifest['kind'] != KIND or
        manifest['methodVersion'] != METHOD or manifest['inputFileSha256'] != request['inputFileSha256'] or
        any(manifest[k] is not False for k in FLAGS)):
        raise ValueError('Invalid compact manifest')
    artifacts = manifest['artifacts']
    if type(artifacts) is not dict or set(artifacts) != ARTIFACTS - {'manifest.json'}:
        raise ValueError('Invalid artifact set')
    from .benchmarks.area_experiment import digest
    for entry in artifacts.values():
        if type(entry) is not dict or set(entry) != {'sha256','bytes'} or type(entry['bytes']) is not int or not 0 < entry['bytes'] <= MAX_BYTES:
            raise ValueError('Invalid artifact metadata')
        digest(entry['sha256'])
    if artifacts['input.json'] != {'sha256':request['inputFileSha256'],'bytes':request['inputBytes']}:
        raise ValueError('Invalid input metadata')
    if sum(e['bytes'] for e in artifacts.values()) + len(encoded(manifest)) > TOTAL_BYTES:
        raise ValueError('Total artifact bound')


def bounded_read(path):
    # O_NOFOLLOW plus fstat/read limits avoid following swapped links or an
    # unbounded stream. Only regular finite files are exportable.
    import stat
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        metadata = os.fstat(stream.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_BYTES:
            raise ValueError('File bound')
        raw = stream.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES or len(raw) != metadata.st_size:
        raise ValueError('Changed file size')
    return raw


def run(request, output):
    validate_request(request)
    source = output / 'input.json'
    private_write(source, request['inputText'].encode('utf-8'))
    manifest, files = exports(source, request)
    for name, raw in files.items():
        if name != 'input.json':
            private_write(output / name, raw)
    return manifest


def private_write(path, raw):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(raw)


def verify(stage, request):
    entries = list(stage.iterdir())
    if any(p.name not in ARTIFACTS | {'request.json','error.json'} or not p.is_file() or p.is_symlink() for p in entries):
        raise ValueError('Unexpected artifact')
    # IPC may ASCII-escape the original text, so its envelope has a separate
    # bounded budget. It is deleted before publication.
    if any(p.stat().st_size > (6 * MAX_BYTES + 4096 if p.name == 'request.json' else MAX_BYTES) for p in entries):
        raise ValueError('Artifact bound')
    if request['inputText'].encode('utf-8') != bounded_read(stage / 'input.json'):
        raise ValueError('Changed staged input')
    manifest, files = exports(stage / 'input.json', request)
    for name, raw in files.items():
        if bounded_read(stage / name) != raw:
            raise ValueError('Changed artifact')
    return manifest


@dataclass(frozen=True)
class Download:
    name: str
    data: bytes


def download(root, job, name):
    if job['status'] != 'completed' or name not in ARTIFACTS:
        raise ValueError('Unavailable artifact')
    validate_manifest(job['result'], job['request'])
    directory = root / 'results' / job['id']
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError('Unavailable directory')
    manifest_bytes = bounded_read(directory / 'manifest.json')
    if manifest_bytes != encoded(job['result']):
        raise ValueError('Changed manifest')
    raw = manifest_bytes if name == 'manifest.json' else bounded_read(directory / name)
    if name != 'manifest.json' and describe(raw) != job['result']['artifacts'][name]:
        raise ValueError('Changed artifact')
    return Download(name, raw)
