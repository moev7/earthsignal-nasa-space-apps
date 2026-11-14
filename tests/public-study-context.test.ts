import test from "node:test";
import assert from "node:assert/strict";
import {
  publicStudyExploreHref,
  publicStudyWorkspaceHref,
  readPublicStudyContext,
  publicStudySignInHref,
  publicStudyArea,
  publicStudyCatalogQuery,
} from "../lib/public-study-context";
import { areaSchema } from "../lib/observatory-contract";
import { signInDestination } from "../lib/sign-in-destination";

test("public study selection and dates survive workspace/sign-in and return links", () => {
  for (const selection of [
    null,
    { row: 32, column: 7 },
    { left: 1, top: 2, right: 3, bottom: 6 },
  ]) {
    const href = publicStudyWorkspaceHref(selection),
      q = href.split("?")[1];
    const context = readPublicStudyContext(new URLSearchParams(q));
    assert.deepEqual(context, { id: "lake-mead-gcov-2026", selection });
    assert.equal(
      signInDestination(publicStudySignInHref(context!).split("?")[1]),
      href,
    );
    assert.equal(publicStudyExploreHref(selection).split("?")[1], q);
  }
  assert.deepEqual(publicStudyCatalogQuery(), {
    region: "mead",
    product: "GCOV",
    start: "2026-06-26",
    end: "2026-09-30",
  });
});
test("context rejects untrusted identities, duplicate fields, fractional or outside cells and inverted regions", () => {
  for (const q of [
    "study=private-job",
    "study=lake-mead-gcov-2026&study=lake-mead-gcov-2026",
    "study=lake-mead-gcov-2026&selection=cell:114,0",
    "study=lake-mead-gcov-2026&selection=cell:1,94",
    "study=lake-mead-gcov-2026&selection=cell:-1,0",
    "study=lake-mead-gcov-2026&selection=cell:1.1,0",
    "study=lake-mead-gcov-2026&selection=region:4,0,3,1",
    "study=lake-mead-gcov-2026&selection=cell:0,0&selection=cell:1,1",
  ]) {
    assert.equal(readPublicStudyContext(new URLSearchParams(q)), null, q);
    assert.equal(
      signInDestination("?continue=workspace-study&" + q),
      "/workspace",
      q,
    );
  }
  assert.equal(
    signInDestination(
      "?continue=workspace-study&study=lake-mead-gcov-2026&continue=https://evil.example",
    ),
    "/workspace",
  );
});
test("native UTM cell boundaries are converted, with north at the top and closed polygons", () => {
  const a = publicStudyArea({
    id: "lake-mead-gcov-2026",
    selection: { row: 0, column: 0 },
  }).coordinates[0];
  assert.deepEqual(a[0], a[4]);
  assert.ok(Math.abs(a[0][0] - -114.75009999315306) < 1e-8);
  assert.ok(Math.abs(a[0][1] - 36.06021603945918) < 1e-8);
  assert.ok(a[0][1] > a[3][1]);
  assert.ok(a[0][0] < a[1][0]);
  const b = publicStudyArea({
    id: "lake-mead-gcov-2026",
    selection: { left: 0, top: 0, right: 0, bottom: 0 },
  });
  assert.deepEqual(b.coordinates[0], a);
});

test("native region corners match independent Rasterio EPSG32611 to WGS84 transform", () => {
  const a = publicStudyArea({
    id: "lake-mead-gcov-2026",
    selection: { left: 0, top: 0, right: 93, bottom: 113 },
  }).coordinates[0];
  assert.ok(Math.abs(a[2][0] - -114.73996431494743) < 1e-8);
  assert.ok(Math.abs(a[2][1] - 36.0497496787597) < 1e-8);
});

test("every retained public selection becomes a valid unsubmitted assessment geometry", () => {
  for (const selection of [
    null,
    { row: 0, column: 0 },
    { row: 113, column: 93 },
    { left: 12, top: 18, right: 25, bottom: 34 },
  ]) {
    const geometry = publicStudyArea({ id: "lake-mead-gcov-2026", selection });
    assert.deepEqual(areaSchema.parse(geometry), geometry);
  }
});
