import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const root = path.resolve(process.argv[2] ?? 'dist/standalone');
const registry = JSON.parse(await readFile(path.join(root, 'public/data/challenge/studies.json'), 'utf8'));
if (registry.schemaVersion !== '1.0' || registry.studies.length < 2) throw new Error('Unexpected reviewed public-study registry');
for (const study of registry.studies) {
  if (!/^\/data\/(?:(?:nisar|radar)\/[a-z0-9-]+|sar\/[a-z0-9-]+\/[a-f0-9]{16})\/manifest\.json$/.test(study.manifestUrl)) throw new Error('Unsafe registry path');
  const raw = await readFile(path.join(root, 'public', study.manifestUrl.slice(1)));
  const sha = createHash('sha256').update(raw).digest('hex');
  if (sha !== study.manifestSha256 || raw.length !== study.manifestBytes || !sha.startsWith(study.revision)) throw new Error('Published manifest differs from its reviewed registry revision');
  const original = JSON.parse(raw);
  if (!isDeepStrictEqual(study.files, original.files)) throw new Error('Registry artifact table differs from published manifest');
  for (const [name, expected] of Object.entries(study.files)) {
    if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)?$/.test(name) || name.split('/').some(p => p === '.' || p === '..')) throw new Error('Unsafe public artifact path');
    const bytes = await readFile(path.join(root, 'public', path.dirname(study.manifestUrl).slice(1), name));
    if (bytes.length !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error(`Public study integrity failed: ${study.id}/${name}`);
  }
}
const bundle = path.join(root, 'public/data/nisar/tehran-sw-2026');
const manifest = JSON.parse(await readFile(path.join(bundle, 'manifest.json'), 'utf8'));
if (manifest.schema !== 'earthsignal.result-bundle/1' || manifest.provenance !== 'measured') throw new Error('The public release must contain the measured result bundle.');
for (const [name, expected] of Object.entries(manifest.files)) {
  // Flat names or plain subfolders (e.g. frames/x.png); never absolute or escaping the bundle.
  if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?$/.test(name) || name.split('/').some((part) => part === '..' || part === '.')) throw new Error('Unexpected bundle file path');
  const bytes = await readFile(path.join(bundle, name));
  if (bytes.length !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error(`Public bundle integrity failed: ${name}`);
}
const radar = path.join(root, 'public/data/radar/lake-mead-gcov-2026');
const radarManifest = JSON.parse(await readFile(path.join(radar, 'manifest.json'), 'utf8'));
const radarFiles = ['values.json','before.png','after.png','difference.png','excluded.png','before.tif','after.tif','difference.tif','validity.tif','verification.json'];
if (radarManifest.schema !== 'earthsignal.radar-study/1' || radarManifest.id !== 'lake-mead-gcov-2026' || radarManifest.provenance !== 'measured' || radarManifest.units !== 'dB' || Object.keys(radarManifest.files).length !== radarFiles.length) throw new Error('The public release must contain the frozen measured radar study.');
for (const name of radarFiles) {
  const expected = radarManifest.files[name];
  const bytes = await readFile(path.join(radar, name));
  if (!expected || bytes.length !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error(`Public radar study integrity failed: ${name}`);
}
await stat(path.join(root, 'public/fonts/manrope-latin-variable.woff2'));
await stat(path.join(root, 'public/fonts/Manrope-OFL.txt'));
const displayFont = await readFile(path.join(root, 'public/fonts/barlow-condensed-latin-600.woff2'));
if (displayFont.subarray(0, 4).toString() !== 'wOF2') throw new Error('The story display font must be a local WOFF2.');
await stat(path.join(root, 'public/fonts/BarlowCondensed-OFL.txt'));
let photoBytes = 0;
for (const name of ['nisar', 'tehran', 'tokyo', 'earth']) {
  const bytes = await readFile(path.join(root, `public/images/story/${name}.webp`));
  if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP') throw new Error(`Story image is not a local WebP: ${name}`);
  photoBytes += bytes.length;
}
if (photoBytes > 700_000) throw new Error('Story images exceed the 700 kB delivery budget.');
const audioManifest = JSON.parse(await readFile(new URL('../docs/internal/story-audio-sources.json', import.meta.url), 'utf8'));
let audioBytes = 0;
for (const asset of audioManifest.assets) {
  if (!/^\/audio\/story\/[a-z-]+\.mp3$/.test(asset.src)) throw new Error('Unexpected story audio path');
  const bytes = await readFile(path.join(root, 'public', asset.src));
  if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`Story audio integrity failed: ${asset.src}`);
  if (!asset.sources.length || asset.sources.some(id => !audioManifest.sources.some(source => source.id === id && source.license === 'CC0 1.0'))) throw new Error('Story audio needs verified source licences');
  audioBytes += bytes.length;
}
if (audioBytes > 1_200_000) throw new Error('Story audio exceeds its lazy-loaded 1.2 MB budget.');
console.log(`Story soundscape verified: ${audioManifest.assets.length} local recordings (${audioBytes} bytes), loaded after sound consent.`);
console.log(`Public release verified: ${Object.keys(manifest.files).length} measured ground-motion files, ${radarFiles.length} radar-study files, two local licensed fonts and four story images (${photoBytes} bytes).`);
