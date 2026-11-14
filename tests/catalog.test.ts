import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  querySchema,
  buildAsfUrl,
  catalogSchema,
} from "../features/catalog/domain";
import { parseAsfCatalog, publicAsset } from "../features/catalog/asf";
const captured = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/asf-scene.json", import.meta.url),
    "utf8",
  ),
);
const query = {
  region: "sacramento",
  product: "GCOV",
  start: "2026-07-10",
  end: "2026-10-08",
} as const;
test("captured real ASF NISAR response preserves acquisition, footprint, maturity and asset provenance", () => {
  const [scene] = parseAsfCatalog(captured);
  assert.equal(
    scene.id,
    "NISAR_L2_PR_GCOV_032_042_D_069_4005_DHDH_A_20261003T025605_20261003T025639_P05023_N_F_J_001",
  );
  assert.equal(scene.startTime, "2026-10-03T02:56:05Z");
  assert.equal(scene.maturity, "Provisional");
  assert.equal(scene.geometry.type, "Polygon");
  assert.ok(scene.browseUrl?.endsWith("_LATLON.png"));
  assert.equal(scene.fileBytes, 6899630080);
  assert.ok(
    catalogSchema.safeParse({
      schemaVersion: "1.0",
      source: "ASF / NASA Earthdata",
      retrievedAt: new Date().toISOString(),
      query,
      queryUrl: buildAsfUrl(query),
      limit: 24,
      scenes: [scene],
    }).success,
  );
});
test("catalog query encodes the intended sensor, product, point and bounded result count", () => {
  const url = new URL(buildAsfUrl(query));
  assert.equal(url.hostname, "api.daac.asf.alaska.edu");
  assert.equal(url.searchParams.get("dataset"), "NISAR");
  assert.equal(url.searchParams.get("intersectsWith"), "POINT(-121.61 38.12)");
  assert.equal(url.searchParams.get("maxResults"), "24");
  assert.equal(
    new URL(buildAsfUrl({ ...query, product: "RTC" })).searchParams.get(
      "dataset",
    ),
    "OPERA-S1",
  );
});
test("invalid product, impossible dates and reversed windows are rejected", () => {
  for (const invalid of [
    { ...query, product: "ARBITRARY" },
    { ...query, start: "2026-02-30" },
    { ...query, start: "2026-11-01" },
  ])
    assert.equal(querySchema.safeParse(invalid).success, false);
});
test("external, non-HTTPS, private and malformed asset destinations are rejected", () => {
  for (const url of [
    "https://evil.example/data.png",
    "http://nisar.asf.earthdatacloud.nasa.gov/data.png",
    "https://nisar.asf.earthdatacloud.nasa.gov/NISAR-JPL-PRIVATE-DATA/file.json",
    "not-a-url",
  ])
    assert.equal(publicAsset(url), null);
});
test("empty upstream results remain empty, duplicate records are deduplicated, missing optional fields remain unknown", () => {
  assert.deepEqual(
    parseAsfCatalog({ type: "FeatureCollection", features: [] }),
    [],
  );
  assert.equal(
    parseAsfCatalog({
      ...captured,
      features: [...captured.features, ...captured.features],
    }).length,
    1,
  );
  const copy = structuredClone(captured);
  copy.features[0].properties.collectionName = null;
  copy.features[0].properties.polarization = null;
  copy.features[0].properties.mainBandPolarization = null;
  copy.features[0].properties.sideBandPolarization = null;
  const [scene] = parseAsfCatalog(copy);
  assert.equal(scene.maturity, "Not specified in catalog");
  assert.deepEqual(scene.polarization, []);
});
