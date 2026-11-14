"""Describe differences between two private interpretations; never adjudicate."""
import argparse
import json
import sys

from inspect_review import bounded_json
from service.benchmarks.forecast_policy import canonical_json, write_new
from service.benchmarks.review_comparison import compare_reviews


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--packet', required=True)
    parser.add_argument('--packet-pin', required=True)
    parser.add_argument('--left', required=True)
    parser.add_argument('--right', required=True)
    parser.add_argument('--output', required=True, help='New private artifact; must not exist')
    args = parser.parse_args(argv)
    try:
        packet, packet_pin = bounded_json(args.packet, args.packet_pin)
        left, left_pin = bounded_json(args.left)
        right, right_pin = bounded_json(args.right)
        report = compare_reviews(packet, left, right)
        artifact = {'schemaVersion': 1, 'kind': 'optical-review-comparison-inspection',
                    'packetFileSha256': packet_pin, 'leftFileSha256': left_pin,
                    'rightFileSha256': right_pin, 'comparison': report}
        # Bound exactly the ASCII-escaped canonical bytes (including newline)
        # used by write_new, rather than a smaller alternate UTF-8 encoding.
        if len((canonical_json(artifact) + '\n').encode('utf-8')) > 4 * 1024**2:
            raise ValueError('Comparison artifact exceeds limit')
        write_new(args.output, artifact)
        print(json.dumps({'status': 'descriptive-development-comparison',
                          'packetFileSha256': packet_pin, 'leftFileSha256': left_pin,
                          'rightFileSha256': right_pin, 'accuracyEstimated': False,
                          'fieldTruthEstablished': False, 'adjudicationPerformed': False}))
        return 0
    except (OSError, ValueError, TypeError, KeyError, OverflowError, RecursionError, UnicodeError, ImportError):
        print('Comparison failed: invalid or mismatched inputs, missing native CRS runtime or unavailable output.', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
