"""Offline frozen-policy runner; no network, service activation or skill claim."""
import argparse
import json
import math
import os
from pathlib import Path
import sys
import tempfile

from service.observatory.vintages import canonical_json

MAX_FILE_BYTES = 20 * 1024**2


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON field')
        result[key] = value
    return result


def _constant(_):
    raise ValueError('Nonfinite JSON value')


def _float(text):
    value = float(text)
    if not math.isfinite(value):
        raise ValueError('Nonfinite JSON value')
    return value


def read_object(path):
    with Path(path).open('rb') as stream:
        raw = stream.read(MAX_FILE_BYTES + 1)
    if len(raw) > MAX_FILE_BYTES:
        raise ValueError('Input exceeds offline file limit')
    value = json.loads(raw, object_pairs_hook=_pairs, parse_constant=_constant,
                       parse_float=_float)
    if type(value) is not dict:
        raise ValueError('Expected a JSON object')
    return value


def write_new(path, value):
    """Publish a complete private artifact; never replace an existing path."""
    raw = (canonical_json(value) + '\n').encode('utf-8')
    if len(raw) > MAX_FILE_BYTES:
        raise ValueError('Output exceeds offline file limit')
    destination = Path(path)
    descriptor, temporary = tempfile.mkstemp(prefix='.forecast-policy-', dir=destination.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        # Same directory/filesystem; link is atomic and rejects existing files,
        # directories and symlinks. The temporary file already has mode0600.
        os.link(temporary, destination)
    finally:
        os.unlink(temporary)


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    stages = result.add_subparsers(dest='stage', required=True)
    for stage in ('freeze', 'issue', 'score'):
        command = stages.add_parser(stage)
        command.add_argument('--snapshot', required=True, help='Direct JSON snapshot object')
        command.add_argument('--snapshot-pin', required=True, help='Independently trusted snapshotHash')
        command.add_argument('--at', required=True, help='Snapshot issue instant for this phase')
        command.add_argument('--output', required=True, help='New private artifact path; must not exist')
        if stage != 'freeze':
            command.add_argument('--policy', required=True)
            command.add_argument('--policy-pin', required=True)
        if stage == 'score':
            command.add_argument('--issued', required=True)
            command.add_argument('--issue-pin', required=True)
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        from service.observatory.forecast_policy import freeze_policy, issue_policy, score_issue
        snapshot = read_object(args.snapshot)
        if args.stage == 'freeze':
            value = freeze_policy(snapshot, expected_snapshot_hash=args.snapshot_pin, freeze_time=args.at)
            key = 'policyHash'
        elif args.stage == 'issue':
            value = issue_policy(read_object(args.policy), snapshot,
                                 expected_policy_hash=args.policy_pin,
                                 expected_snapshot_hash=args.snapshot_pin, issue_time=args.at)
            key = 'issueHash'
        else:
            value = score_issue(read_object(args.policy), read_object(args.issued), snapshot,
                                expected_policy_hash=args.policy_pin, expected_issue_hash=args.issue_pin,
                                expected_snapshot_hash=args.snapshot_pin, score_time=args.at)
            key = 'scoreHash'
        write_new(args.output, value)
        print(json.dumps(dict(stage=args.stage, artifactHash=value[key]), sort_keys=True))
        return 0
    except (OSError, ValueError, TypeError, KeyError, OverflowError, RecursionError):
        print('Forecast experiment failed: invalid or inaccessible input, unsupported policy, or unavailable output path.',
              file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
