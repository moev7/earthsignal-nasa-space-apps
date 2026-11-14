"""Offline experimental point issue and score runner; no operational publication."""
import argparse
import json
import sys

from service.benchmarks.forecast_policy import read_object, write_new


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    stages = result.add_subparsers(dest='stage', required=True)
    for stage in ('compute', 'score'):
        command = stages.add_parser(stage)
        command.add_argument('--policy', required=True, help='Frozen policy JSON object')
        command.add_argument('--policy-pin', required=True, help='Independently trusted policyHash')
        command.add_argument('--snapshot', required=True, help='Direct snapshot JSON object')
        command.add_argument('--snapshot-pin', required=True, help='Independently trusted snapshotHash')
        command.add_argument('--at', required=True, help='Issue or score cutoff instant')
        command.add_argument('--output', required=True, help='New private artifact path; must not exist')
        if stage == 'score':
            command.add_argument('--experiment', required=True, help='Computed experiment JSON object')
            command.add_argument('--experiment-pin', required=True,
                                 help='Independently trusted experimentHash')
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        from service.observatory.provisional_issue import (
            compute_provisional_issue, score_provisional_issue,
        )
        policy = read_object(args.policy)
        snapshot = read_object(args.snapshot)
        if args.stage == 'compute':
            value = compute_provisional_issue(
                policy, snapshot, expected_policy_hash=args.policy_pin,
                expected_snapshot_hash=args.snapshot_pin, issue_time=args.at)
            key = 'experimentHash'
        else:
            experiment = read_object(args.experiment)
            value = score_provisional_issue(
                policy, experiment, snapshot, expected_policy_hash=args.policy_pin,
                expected_experiment_hash=args.experiment_pin,
                expected_snapshot_hash=args.snapshot_pin, score_time=args.at)
            key = 'scoreHash'
        write_new(args.output, value)
        print(json.dumps(dict(stage=args.stage, artifactHash=value[key],
                              label=value['label'], operationalPublication=False), sort_keys=True))
        return 0
    except (OSError, ValueError, TypeError, KeyError, OverflowError, RecursionError):
        print('Provisional experiment failed: invalid or inaccessible input, or unavailable output path.',
              file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
