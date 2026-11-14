import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  loadPublicRadarStudy,
  publicRadarManifestSchema,
  validateRadarValues,
  radarCellAt,
  radarPoint,
  radarRegionStats,
  RADAR_STUDY_BASE,
  type RadarStudy,
} from "../lib/public-radar-study";
const base = new URL(
  "../public/data/radar/lake-mead-gcov-2026/",
  import.meta.url,
);
async function frozen() {
  const manifest = publicRadarManifestSchema.parse(
    JSON.parse(await readFile(new URL("manifest.json", base), "utf8")),
  );
  return {
    manifest,
    values: validateRadarValues(
      JSON.parse(await readFile(new URL("values.json", base), "utf8")),
      manifest,
    ),
    images: { before: "", after: "", difference: "", excluded: "" },
    dispose() {},
  } satisfies RadarStudy;
}

test("real frozen cells retain arithmetic, masking and independent region statistics", async () => {
  const s = await frozen(),
    v = s.values;
  const valid = v.differenceDb.findIndex((n) => n !== null),
    invalid = v.differenceDb.findIndex((n) => n === null);
  const cell = (i: number) => ({
    row: Math.floor(i / v.width),
    column: i % v.width,
  });
  const p = radarPoint(s, cell(valid))!;
  assert.ok(Math.abs(p.afterDb! - p.beforeDb! - p.differenceDb!) < 1e-5);
  assert.equal(radarPoint(s, cell(invalid))!.differenceDb, null);
  assert.equal(radarPoint(s, { row: 114, column: 0 }), null);
  const r = radarRegionStats(s, { left: 0, top: 0, right: 93, bottom: 113 });
  const sorted = v.differenceDb
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  assert.equal(r.valid, 10002);
  assert.equal(r.total, 10716);
  assert.equal(r.areaKm2, 1.0002);
  assert.equal(r.medianDb, (sorted[5000] + sorted[5001]) / 2);
  assert.ok(Math.abs(r.medianDb - s.manifest.source.stats.medianDb) < 1e-6);
  const bad = structuredClone(v);
  bad.beforeDb[invalid] = 0;
  assert.throws(() => validateRadarValues(bad, s.manifest), /masks/);
  const badDifference = structuredClone(v);
  badDifference.differenceDb[valid]! += 1;
  assert.throws(
    () => validateRadarValues(badDifference, s.manifest),
    /disagree/,
  );
});
test("asymmetric grid catches transposition and inclusive last-edge errors", async () => {
  const s = await frozen();
  s.values = {
    width: 94,
    height: 114,
    beforeDb: [],
    afterDb: [],
    differenceDb: Array.from(
      { length: 94 * 114 },
      (_, i) => Math.floor(i / 94) * 1000 + (i % 94),
    ),
  };
  assert.deepEqual(radarCellAt(1, 1, 94, 114), { row: 113, column: 93 });
  assert.deepEqual(radarCellAt(0.1, 0.5, 94, 114), { row: 57, column: 9 });
  const r = radarRegionStats(s, { left: 84, top: 102, right: 93, bottom: 113 });
  assert.equal(r.valid, 120);
  assert.equal(r.minDb, 102084);
  assert.equal(r.maxDb, 113093);
  s.values.differenceDb[113 * 94 + 93] = null;
  assert.equal(
    radarRegionStats(s, { left: 93, top: 113, right: 93, bottom: 113 }).valid,
    0,
  );
  assert.equal(
    radarRegionStats(s, { left: 93, top: 113, right: 93, bottom: 113 })
      .medianDb,
    null,
  );
  assert.throws(
    () => radarRegionStats(s, { left: 94, top: 0, right: 94, bottom: 1 }),
    /inside/,
  );
  assert.equal(radarCellAt(-0.001, 0.5, 94, 114), null);
});
test("public loading checks bytes before rendering and never requests protected jobs", async () => {
  const previous = globalThis.fetch,
    requests: string[] = [];
  let corrupt = false,
    missing = false;
  globalThis.fetch = async (input) => {
    const u = String(input);
    requests.push(u);
    assert.ok(u.startsWith(RADAR_STUDY_BASE), u);
    if (missing) return new Response(null, { status: 404 });
    const name = u.slice(RADAR_STUDY_BASE.length);
    const bytes = await readFile(new URL(name, base));
    return new Response(corrupt && name === "values.json" ? "{}" : bytes);
  };
  try {
    corrupt = true;
    await assert.rejects(loadPublicRadarStudy(), /integrity/);
    corrupt = false;
    const study = await loadPublicRadarStudy();
    assert.ok(study.images.before.startsWith("blob:"));
    study.dispose();
    study.dispose();
    missing = true;
    await assert.rejects(loadPublicRadarStudy(), /could not be loaded/);
    assert.ok(requests.length > 0);
  } finally {
    globalThis.fetch = previous;
  }
});
