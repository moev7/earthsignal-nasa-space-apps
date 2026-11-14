import test from "node:test";
import assert from "node:assert/strict";
import { buildAsfUrl, catalogPoint, querySchema, catalogSchema, catalogQueryKey } from "../features/catalog/domain";
import { photoCatalogQuery, photoDateErrors, photoStudyArea } from "../lib/photo-discovery";
import { areaSchema } from "../lib/observatory-contract";
import { makeRecords, jobMatchesPoint } from "../features/science/domain";
import type { ChangeJob } from "../lib/radar-contract";
import { GET } from "../app/api/scenes/route";

test("photo date recovery identifies missing, impossible and reversed dates without rejecting a single-day search", () => {
  assert.deepEqual(photoDateErrors("2026-06-17", "2026-10-17"), {});
  assert.deepEqual(photoDateErrors("2026-10-17", "2026-10-17"), {});
  assert.deepEqual(photoDateErrors("2024-02-29", "2024-02-29"), {});
  assert.deepEqual(photoDateErrors("", "2026-10-17"), { start: "Choose a valid start date." });
  assert.deepEqual(photoDateErrors("2026-06-17", ""), { end: "Choose a valid end date." });
  assert.deepEqual(photoDateErrors("2026-02-30", "2026-10-17"), { start: "Choose a valid start date." });
  assert.deepEqual(photoDateErrors("2026-06-17", "2026-06-31"), { end: "Choose a valid end date." });
  assert.deepEqual(photoDateErrors("2026-06-17", "2026-02-30"), { end: "Choose a valid end date." });
  assert.deepEqual(photoDateErrors("2026-13-01", "2026-10-17"), { start: "Choose a valid start date." });
  assert.equal(photoDateErrors("2026-10-18", "2026-10-17").end, "Choose an end date on or after the start date.");
});

test("confirmed point overrides a preset, retains exact sign/order and encodes only a point", () => {
  for (const [longitude, latitude] of [[-114.75, 36.05], [0, 0], [180, 90], [-180, -90], [0.000001, -0.5], [0.00000001, -0.0000000002]]) {
    const query = photoCatalogQuery({ longitude, latitude }, "2026-06-17", "2026-10-17");
    assert.ok(querySchema.safeParse(query).success);
    const url = new URL(buildAsfUrl({ ...query, region: "mead" }));
    assert.equal(url.searchParams.get("intersectsWith"), `POINT(${query.point?.replace(",", " ")})`);
    assert.equal(url.searchParams.get("maxResults"), "24");
    assert.equal(url.searchParams.get("dataset"), "NISAR");
    assert.equal(url.searchParams.get("processingLevel"), "GCOV");
  }
});

test("arbitrary point requests reject malformed, partial, nonfinite and out-of-world values", () => {
  const base = photoCatalogQuery({ longitude: 0, latitude: 0 }, "2026-06-17", "2026-10-17");
  for (const point of ["", "0", "0,0,0", "NaN,0", "Infinity,0", "0,91", "-181,0", "0x10,0", "1e2,0", "1 2,0", "0,0) OR 1=1", "POINT(0 0)", "0,0\n", ",0"]) {
    assert.equal(catalogPoint(point), null, point);
    assert.equal(querySchema.safeParse({ ...base, point }).success, false, point);
  }
});

test("default study area contains the confirmed point, clips edges without wrapping and refuses unsupported polar assessments", () => {
  for (const [longitude, latitude] of [[0, 0], [180, 85], [-180, -85], [-114.75, 36.05]]) {
    const area = photoStudyArea({ longitude, latitude });
    assert.ok(area);
    assert.equal(areaSchema.safeParse(area).success, true);
    const ring = area.coordinates[0] as number[][];
    assert.ok(ring[0][0] <= longitude && ring[1][0] >= longitude);
    assert.ok(ring[0][1] <= latitude && ring[2][1] >= latitude);
  }
  for (const point of [{ longitude: 180.1, latitude: 0 }, { longitude: 0, latitude: 85.1 }, { longitude: NaN, latitude: 0 }]) assert.equal(photoStudyArea(point), null);
});

test("point discovery gateway is bounded, private/no-store and preserves real empty vs failed states", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  try {
    globalThis.fetch = async input => { urls.push(String(input)); return Response.json({ type: "FeatureCollection", features: [] }); };
    const requestUrl = "http://localhost/api/scenes?region=global&product=GCOV&start=2026-06-17&end=2026-10-17&point=-114.75%2C36.05";
    const response = await GET(new Request(requestUrl));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = catalogSchema.parse(await response.json());
    assert.deepEqual(body.scenes, []);
    assert.equal(body.query.point, "-114.75,36.05");
    assert.equal(new URL(urls[0]).searchParams.get("intersectsWith"), "POINT(-114.75 36.05)");
    assert.equal(urls.length, 1);
    const bad = await GET(new Request(requestUrl.replace("-114.75%2C36.05", "0%2C91")));
    assert.equal(bad.status, 400); assert.equal(urls.length, 1);
    globalThis.fetch = async () => { throw new Error("offline"); };
    const failed = await GET(new Request(requestUrl));
    assert.equal(failed.status, 503);
    assert.equal(failed.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(Object.keys(await failed.json() as Record<string, unknown>), ["error"]);
  } finally { globalThis.fetch = originalFetch; }
});


test("a photo point never includes the unrelated historical water study or worldwide jobs", () => {
  const query = photoCatalogQuery({ longitude: 51.27, latitude: 35.48 }, "2023-01-01", "2026-10-17");
  assert.deepEqual(makeRecords([], "connected", query), []);
  const job = { bbox: [-114.76, 36.04, -114.74, 36.06] } as ChangeJob;
  assert.equal(jobMatchesPoint(job, query.point!), false);
  assert.equal(jobMatchesPoint(job, "-114.75,36.05"), true);
  assert.equal(jobMatchesPoint({ bbox: [-180, 10, -179.99, 10.01] } as ChangeJob, "180,10"), true);
});


test("catalog query identity survives schema key ordering and distinguishes every point/date", () => {
  const input = photoCatalogQuery({ longitude: -114.75, latitude: 36.05 }, "2026-06-17", "2026-10-17");
  const parsed = querySchema.parse(input);
  assert.notEqual(JSON.stringify(input), JSON.stringify(parsed));
  assert.equal(catalogQueryKey(input), catalogQueryKey(parsed));
  for (const other of [{ ...input, point: "0,0" }, { ...input, point: undefined }, { ...input, start: "2026-06-18" }, { ...input, end: "2026-10-16" }]) assert.notEqual(catalogQueryKey(input), catalogQueryKey(other));
});
