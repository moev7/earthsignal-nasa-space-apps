"""Validate a private image-review draft against an independently pinned packet.

This emits completion/visibility counts, never accuracy or adjusted area.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

from service.benchmarks.forecast_policy import _constant, _float, _pairs, write_new
from service.benchmarks.reference_review import validate_review


def bounded_json(path, pin=None):
    with Path(path).open('rb') as stream:
        raw = stream.read(1024**2 + 1)
    if len(raw) > 1024**2:
        raise ValueError('File exceeds 1 MiB')
    digest = hashlib.sha256(raw).hexdigest()
    if pin is not None and (not re.fullmatch('[0-9a-f]{64}', pin) or digest != pin):
        raise ValueError('Packet pin mismatch')
    value = json.loads(raw.decode('utf-8'), object_pairs_hook=_pairs,
                       parse_constant=_constant, parse_float=_float)
    return value, digest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--packet', required=True)
    parser.add_argument('--packet-pin', required=True, help='Trusted SHA-256 of exact packet.json bytes')
    parser.add_argument('--review', required=True)
    parser.add_argument('--output', required=True, help='New private summary file; must not exist')
    args = parser.parse_args(argv)
    try:
        packet, packet_digest = bounded_json(args.packet, args.packet_pin)
        review, review_digest = bounded_json(args.review)
        summary = validate_review(packet, review)
        artifact = {'schemaVersion': 1, 'kind': 'optical-review-inspection',
                    'packetFileSha256': packet_digest, 'reviewFileSha256': review_digest,
                    'summary': summary, 'fieldTruthEstablished': False,
                    'accuracyEstimated': False, 'areaAdjusted': False}
        write_new(args.output, artifact)
        # Do not print reviewer alias, notes, raw labels or file paths.
        print(json.dumps({'status': 'validated-development-review-draft',
                          'packetFileSha256': packet_digest, 'reviewFileSha256': review_digest,
                          'accuracyEstimated': False, 'areaAdjusted': False}))
        return 0
    except (OSError, ValueError, TypeError, KeyError, OverflowError, RecursionError, UnicodeError, ImportError):
        print('Review inspection failed: invalid input, changed packet pin, missing native CRS runtime or unavailable output.', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
