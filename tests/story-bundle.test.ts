import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadBundle, type BundleId } from '../features/ground-truth/data/nisar';

test('a corrupted or missing measured bundle never becomes substitute data, and can recover', async () => {
  const original = globalThis.fetch;
  const grid = JSON.stringify({ rows: 1, cols: 1, vertical_rate: [-100], vertical_sigma: [10] });
  const image = new Uint8Array([137, 80, 78, 71]);
  const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
  const manifest = { schema: 'earthsignal.result-bundle/1', provenance: 'measured', source: { granules: ['fixture'] }, caveats: [{ id: 'test', text: 'Synthetic test fixture' }], values: { file: 'grid.json' }, layers: { vertical_rate: { file: 'rate.png' } }, files: { 'grid.json': { sha256: hash(grid) }, 'rate.png': { sha256: hash(image) } } };
  let corrupt = true;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith('/manifest.json')) return Response.json(manifest);
    if (url.endsWith('/grid.json')) return new Response(corrupt ? 'corrupt bytes' : grid);
    if (url.endsWith('/rate.png')) return new Response(image);
    return new Response(null, { status: 404 });
  };
  try {
    const id = 'test-integrity' as BundleId;
    await assert.rejects(loadBundle(id), /checksum/);
    corrupt = false;
    const valid = await loadBundle(id);
    assert.equal(valid.grid.vertical_rate[0], -100);
    URL.revokeObjectURL(valid.imageUrl);
    globalThis.fetch = async () => new Response(null, { status: 404 });
    await assert.rejects(loadBundle('test-missing' as BundleId), /HTTP 404/);
    globalThis.fetch = async () => Response.json({ ...manifest, provenance: 'demo' });
    await assert.rejects(loadBundle('test-demo' as BundleId), /provenance/);
    globalThis.fetch = async () => Response.json({ ...manifest, schema: 'future/99' });
    await assert.rejects(loadBundle('test-schema' as BundleId), /Unsupported bundle schema/);
  } finally { globalThis.fetch = original; }
});
