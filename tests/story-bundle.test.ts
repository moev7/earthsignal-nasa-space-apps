import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadBundle } from '../features/ground-truth/data/nisar';

test('a reviewed measured bundle rejects corrupted files and manifests, then recovers', async () => {
  const original = globalThis.fetch;
  const root = new URL('../public/data/nisar/tehran-sw-2026/', import.meta.url);
  let mode: 'corrupt-values' | 'valid' | 'missing' | 'changed-manifest' = 'corrupt-values';
  globalThis.fetch = async input => {
    const name = String(input).split('/').pop()!;
    if (mode === 'missing') return new Response(null, {status: 404});
    const raw = await readFile(new URL(name, root));
    if (name === 'manifest.json' && mode === 'changed-manifest') return new Response(raw.toString().replace('measured', 'invented'));
    if (name !== 'manifest.json' && mode === 'corrupt-values') { const changed = new Uint8Array(raw); changed[0] ^= 1; return new Response(changed); }
    return new Response(raw);
  };
  try {
    await assert.rejects(loadBundle('tehran-sw-2026'), /checksum/);
    mode = 'missing';
    await assert.rejects(loadBundle('tehran-sw-2026'), /HTTP 404/);
    mode = 'changed-manifest';
    await assert.rejects(loadBundle('tehran-sw-2026'), /reviewed revision/);
    mode = 'valid';
    const valid = await loadBundle('tehran-sw-2026');
    assert.ok(valid.grid.vertical_rate.length > 1);
    URL.revokeObjectURL(valid.imageUrl);
  } finally { globalThis.fetch = original; }
});
