import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseAsfCatalog } from "../features/catalog/asf";
import {
  DEFAULT_RECORD_FILTERS,
  makeRecords,
  filterRecords,
  scienceQuery,
  water,
} from "../features/science/domain";
const captured = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/asf-scene.json", import.meta.url),
    "utf8",
  ),
);
const scenes = parseAsfCatalog(captured);
const query = { ...scienceQuery(), end: "2026-10-08" };
test("real water study and live acquisitions share a discriminated collection", () => {
  const records = makeRecords(scenes, "connected", query);
  assert.deepEqual(
    records.map((r) => r.kind),
    ["water", "scene"],
  );
  assert.equal(records[0].id, water.id);
});
test("type, location and dates never substitute unrelated historical water data", () => {
  assert.equal(
    makeRecords(scenes, "water", { ...query, region: "tehran" }).length,
    0,
  );
  assert.equal(
    makeRecords(scenes, "water", { ...query, start: "2026-01-01" }).length,
    0,
  );
  assert.equal(
    makeRecords(scenes, "GCOV", query).some((r) => r.kind === "water"),
    false,
  );
  assert.deepEqual(makeRecords([], "GUNW", query), []);
});
test("radar scientific filters exclude the optical study and respect actual metadata", () => {
  const records = makeRecords(scenes, "connected", query);
  const result = filterRecords(
    records,
    {
      ...DEFAULT_RECORD_FILTERS,
      direction: "DESCENDING",
      maturity: "provisional",
      previewOnly: true,
    },
    [],
    query.region,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "scene");
  assert.equal(
    filterRecords(
      records,
      { ...DEFAULT_RECORD_FILTERS, direction: "ASCENDING" },
      [],
      query.region,
    ).length,
    0,
  );
});
test("universal record search and saved filtering use IDs and actual sensor fields", () => {
  const records = makeRecords(scenes, "connected", query);
  assert.equal(
    filterRecords(
      records,
      { ...DEFAULT_RECORD_FILTERS, query: "nisar" },
      [],
      query.region,
    ).length,
    1,
  );
  assert.equal(
    filterRecords(
      records,
      { ...DEFAULT_RECORD_FILTERS, query: "OPTICAL" },
      [],
      query.region,
    )[0].kind,
    "water",
  );
  assert.equal(
    filterRecords(
      records,
      { ...DEFAULT_RECORD_FILTERS, savedOnly: true },
      [water.id],
      query.region,
    )[0].id,
    water.id,
  );
  assert.equal(
    filterRecords(
      records,
      { ...DEFAULT_RECORD_FILTERS, savedOnly: true },
      [],
      query.region,
    ).length,
    0,
  );
});
