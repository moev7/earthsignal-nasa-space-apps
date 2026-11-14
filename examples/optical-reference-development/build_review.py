"""Build a prediction-hidden development review from pinned optical inputs.

No network, radar reads, reference labels or accuracy estimates. The sampler's
audit is private and separate from the shareable, prediction-hidden HTML.
"""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image

from service.verify_optical_reference import ROOT, RECEIPT_SHA256, ITEMS_SHA256, verify


def pinned(path, digest, limit):
    with path.open('rb') as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit or hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError('Frozen input changed or exceeded its limit')
    return raw


def build(output, seed, per_stratum):
    from service.benchmarks.reference_review import make_packet
    verify(ROOT)
    receipt = json.loads(pinned(ROOT / 'receipt.json', RECEIPT_SHA256, 128 * 1024))
    metadata = json.loads(pinned(ROOT / 'source-items.json', ITEMS_SHA256, 128 * 1024))
    items = {row['side']: row['item'] for row in metadata}
    scenes = {}
    display = {}
    records = {row['side']: row for row in receipt['results']}
    for side in ('before', 'after'):
        record = records[side]
        raw = pinned(ROOT / (side + '.npz'), record['archiveHash'], 2 * 1024**2)
        with np.load(io.BytesIO(raw), allow_pickle=False) as arrays:
            scenes[side] = {'scl': arrays['scl'].copy(), 'aoi': arrays['scl_aoi'].copy()}
            grid = record['bands']['red']
            channels = []
            valid = np.ones(arrays['red'].shape, dtype=bool)
            for name in ('red', 'green', 'blue'):
                band = record['bands'][name]
                if (band['shape'], band['transform'], band['crs']) != (grid['shape'], grid['transform'], grid['crs']):
                    raise ValueError('RGB grids differ; display harmonization is unsupported')
                values = arrays[name]
                spec = items[side]['assets'][name]['raster:bands'][0]
                valid &= np.isfinite(values) & (values != spec['nodata'])
                reflectance = values.astype(float) * spec['scale'] + spec['offset']
                channels.append((np.clip(reflectance / .3, 0, 1) * 255).astype(np.uint8))
            rgba = np.concatenate((np.stack(channels, axis=-1), (valid.astype(np.uint8) * 255)[:, :, None]), axis=-1)
            stream = io.BytesIO()
            Image.fromarray(rgba).save(stream, format='PNG')
            display[side] = {'image': 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode(),
                             'shape': grid['shape'], 'transform': grid['transform'], '_valid': valid}
    before, after = records['before'], records['after']
    band = before['bands']['scl']
    if not np.array_equal(scenes['before']['aoi'], scenes['after']['aoi']):
        raise ValueError('Optical area differs')
    packet, audit = make_packet(scenes['before']['scl'], scenes['after']['scl'], scenes['before']['aoi'],
        grid={'crs': band['crs'], 'transform': band['transform'], 'shape': band['shape']},
        sources=[{'id': records[side]['itemId'], 'observedAt': records[side]['observedAt']} for side in ('before', 'after')],
        source_pins={'receipt': RECEIPT_SHA256, 'metadata': ITEMS_SHA256,
                     'beforeArchive': before['archiveHash'], 'afterArchive': after['archiveHash']},
        seed=seed, per_stratum=per_stratum)
    cells = {}
    t = band['transform']
    for sample in packet['samples']:
        cells[sample['id']] = {}
        for side in ('before', 'after'):
            rgb = display[side]
            rt = rgb['transform']
            if rt[1] != 10 or rt[5] != -10 or rt[2] or rt[4]:
                raise ValueError('Unsupported native RGB grid')
            x = (t[0] + sample['col'] * t[1] - rt[0]) / rt[1]
            y = (t[3] + sample['row'] * t[5] - rt[3]) / rt[5]
            if x != int(x) or y != int(y):
                raise ValueError('Selected cell and RGB display grids are not integer aligned')
            x, y = int(x), int(y)
            height, width = rgb['shape']
            supported = x >= 0 and y >= 0 and x + 2 <= width and y + 2 <= height
            supported = bool(supported and rgb['_valid'][y:y+2, x:x+2].all())
            cells[sample['id']][side] = {'x': x, 'y': y, 'width': 2, 'height': 2, 'supported': supported}
    for rgb in display.values():
        del rgb['_valid']
    view = {'packet': packet, 'display': display, 'cells': cells}
    payload = json.dumps(view, separators=(',', ':'), allow_nan=False).replace('<', '\\u003c').replace('&', '\\u0026')
    template = Path(__file__).with_name('review-template.html').read_text()
    html = template.replace('/*__FROZEN_REVIEW_DATA__*/', payload)
    if '/*__FROZEN_REVIEW_DATA__*/' in html or len(html.encode()) > 2 * 1024**2:
        raise ValueError('Invalid or oversized review view')
    output.mkdir(mode=0o700, exist_ok=False)
    for name, content in (('index.html', html), ('packet.json', json.dumps(packet, indent=2)), ('sampling-audit.json', json.dumps(audit, indent=2))):
        path = output / name
        with path.open('x') as stream:
            stream.write(content)
        path.chmod(0o600)
    print(json.dumps({'packetHash': packet['packetHash'], 'sampledCells': len(packet['samples']),
                      'reviewLabelsCreated': 0, 'nativeRadarChanged': False,
                      'htmlBytes': len(html.encode()), 'htmlSha256': hashlib.sha256(html.encode()).hexdigest()}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='New private directory; must not exist')
    parser.add_argument('--seed', type=int, required=True)
    parser.add_argument('--per-stratum', type=int, required=True)
    args = parser.parse_args()
    build(args.output, args.seed, args.per_stratum)
