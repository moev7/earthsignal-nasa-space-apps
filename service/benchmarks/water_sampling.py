"""Offline runner for pinned recorded-water sampling sensitivity; no network."""
import argparse
import hashlib
import json
import sys

from service.benchmarks.forecast_policy import MAX_FILE_BYTES, _constant, _float, _pairs, write_new
from service.benchmarks.water_history import _PIN
from service.observatory.vintages import canonical_hash


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument('--input', required=True, help='Exact UTF-8 input envelope JSON')
    result.add_argument('--input-pin', required=True, help='Independently trusted raw-byte SHA-256')
    result.add_argument('--output', required=True, help='New private artifact path; must not exist')
    return result


def read_pinned(path, pin):
    if not isinstance(pin, str) or not _PIN.fullmatch(pin):
        raise ValueError('Invalid input pin')
    with open(path, 'rb') as stream:
        raw = stream.read(MAX_FILE_BYTES + 1)
    if len(raw) > MAX_FILE_BYTES:
        raise ValueError('Input exceeds offline file limit')
    if hashlib.sha256(raw).hexdigest() != pin:
        raise ValueError('Input pin mismatch')
    value = json.loads(raw.decode('utf-8'), object_pairs_hook=_pairs,
                       parse_constant=_constant, parse_float=_float)
    if type(value) is not dict or set(value) != {'schemaVersion', 'observations', 'options'}:
        raise ValueError('Invalid input envelope')
    if type(value['schemaVersion']) is not int or value['schemaVersion'] != 1:
        raise ValueError('Unsupported input schema')
    if type(value['observations']) is not list:
        raise ValueError('Invalid observations collection')
    options = value['options']
    if type(options) is not dict or set(options) != {'months', 'exclude'}:
        raise ValueError('Invalid options envelope')
    return value


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        from service.observatory.water_sampling import analyze_water_sampling
        value = read_pinned(args.input, args.input_pin)
        summary = analyze_water_sampling(value['observations'], **value['options'])
        artifact = dict(schemaVersion=1, kind='water-sampling-sensitivity',
                        sourceFileSha256=args.input_pin, summary=summary)
        artifact['artifactHash'] = canonical_hash(artifact)
        write_new(args.output, artifact)
        print(json.dumps(dict(artifactHash=artifact['artifactHash'],
                              methodVersion=summary['methodVersion'], **summary['history']['counts']),
                         sort_keys=True))
        return 0
    except (OSError, ValueError, TypeError, KeyError, OverflowError, RecursionError, UnicodeError):
        print('Water sampling failed: invalid or inaccessible input, or unavailable output path.',
              file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
