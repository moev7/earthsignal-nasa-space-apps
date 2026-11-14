"""Offline CLI: JSON results to stdout; errors to stderr and exit 2."""

import argparse
import json
import sys

from .evaluator import BenchmarkError, evaluate
from .synthetic import write_fixture


def main(argv=None):
    parser = argparse.ArgumentParser(description="Frozen offline benchmark; no field validation implied")
    commands = parser.add_subparsers(dest="command", required=True)
    fixture = commands.add_parser("synthetic", help="Create NEW synthetic software-check directory")
    fixture.add_argument("directory")
    run = commands.add_parser("evaluate", help="Evaluate pinned local manifest and NPZ inputs")
    run.add_argument("manifest")
    run.add_argument("--manifest-sha256", required=True, help="SHA256 from independently retained preregistration")
    args = parser.parse_args(argv)
    try:
        result = (write_fixture(args.directory) if args.command == "synthetic" else
                  evaluate(args.manifest, expected_manifest_sha256=args.manifest_sha256))
        print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))
        return 0
    except (BenchmarkError, OSError) as exc:
        print(json.dumps({"status": "invalid_no_score", "error": str(exc)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
