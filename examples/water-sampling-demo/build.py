"""Reconstruct explicitly synthetic fixtures; default mode checks, never overwrites."""
import argparse
import hashlib
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from service.benchmarks.forecast_policy import write_new
from service.observatory.vintages import canonical_hash, canonical_json
from service.observatory.water_sampling import analyze_water_sampling


def observation(source, time, state='water', visibility='observable'):
    return dict(siteId='synthetic-tutorial-site', supportId='synthetic-fixed-support-v1',
                quantityId='synthetic-open-water-presence-v1', classificationMethodId='synthetic-tutorial-v1',
                sourceId=source, evidenceIds=['synthetic-evidence-'+source], acquisitionTime=time,
                state=state, visibility=visibility, visibilityReason='Synthetic illustration; no field observation')


def fixtures():
    cases = dict(
        density=dict(observations=[observation('water-2024', '2024-04-01T00:00:00Z')] + [
            observation(f'dry-2025-{day:02}', f'2025-04-{day:02}T00:00:00Z', 'dry') for day in range(1, 13)],
            options=dict(months=[4], exclude=dict(start='2025-04-04T00:00:00Z', end='2025-04-12T00:00:00Z'))),
        unknown=dict(observations=[observation('water-2024', '2024-04-01T00:00:00Z'),
            observation('observable-unknown-2024', '2024-04-02T00:00:00Z', 'unknown'),
            observation('dry-2025', '2025-04-01T00:00:00Z', 'dry'),
            observation('unobservable-unknown-2025', '2025-04-02T00:00:00Z', 'unknown', 'unobservable')],
            options=dict(months=[4], exclude=dict(start='2024-04-01T00:00:00Z', end='2024-04-03T00:00:00Z'))),
        **{'missing-year': dict(observations=[observation('water-2024', '2024-04-01T00:00:00Z'),
            observation('dry-2026', '2026-04-01T00:00:00Z', 'dry')], options=dict(months=[4], exclude=None))})
    outputs, pins = {}, {}
    for name, data in cases.items():
        envelope = dict(schemaVersion=1, **data)
        raw = (canonical_json(envelope)+'\n').encode('utf-8')
        pin = hashlib.sha256(raw).hexdigest()
        artifact = dict(schemaVersion=1, kind='water-sampling-sensitivity', sourceFileSha256=pin,
                        summary=analyze_water_sampling(data['observations'], **data['options']))
        artifact['artifactHash'] = canonical_hash(artifact)
        result_raw = (canonical_json(artifact)+'\n').encode('utf-8')
        input_name, result_name = f'{name}-input.json', f'{name}-result.json'
        outputs[input_name], outputs[result_name] = envelope, artifact
        pins[name] = dict(input=input_name, result=result_name, inputSha256=pin,
                          resultSha256=hashlib.sha256(result_raw).hexdigest(), artifactHash=artifact['artifactHash'])
    outputs['metadata.json'] = dict(schemaVersion=1, synthetic=True,
        description='Deterministic invented tutorial records. No field, sensor, accuracy, causal or hydroperiod evidence.',
        fixtures=pins)
    return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, help='Write new files here; existing files are never replaced')
    args = parser.parse_args()
    values = fixtures()
    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        for name, value in values.items():
            write_new(args.output_dir / name, value)
    else:
        directory = Path(__file__).resolve().parent
        for name, value in values.items():
            if (directory / name).read_bytes() != (canonical_json(value)+'\n').encode('utf-8'):
                raise SystemExit(f'Fixture differs: {name}')
    print('Synthetic fixtures: 3 cases, 7 JSON files verified' if not args.output_dir else 'Synthetic fixtures: 7 new JSON files written')


if __name__ == '__main__':
    main()
