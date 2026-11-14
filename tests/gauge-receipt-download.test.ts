import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { gaugeVintageSchema } from "../lib/gauge-vintage-contract";
import { verifyReceiptResponse, verifyReceiptSnapshot, type ReferencedVintage } from "../lib/gauge-receipt-download";
import { GaugeVintageInsights } from "../features/decisions/gauge-vintage-insights";

// Synthetic client-contract fixture; hashes here are not actual scientific lineage.
const h = "1".repeat(64), at = "2026-10-13T00:00:00.000000Z";
const identity = { station: "USGS-01646500", timeSeriesId: "synthetic", parameter: "00060", statistic: "00003", unit: "ft^3/s" };
const snapshot = { policyVersion: "usgs-observation-vintages-v1", availabilityBasis: "local-receipt-only", identity, issueTime: at, start: "2025-01-01", end: "2025-01-02", calendarDays: 2, unknownDays: 1, observations: [{ identity, date: "2025-01-01", value: 100, quality: "Provisional", qualifiers: ["ESTIMATED"], stationTimeProperties: { country_code: "US", time_zone_abbreviation: "EST", uses_daylight_savings: "Y" }, revision: 1, receivedAt: at, firstReceivedAt: at, contentHash: h, stationPropertiesHash: h, sourceResponseHash: h, sourceMetadataHash: h, versionHash: h }], snapshotHash: h };
const text = JSON.stringify(snapshot), bytes = new TextEncoder().encode(text);
const { observations: _rows, ...summary } = snapshot;
const fixture = (): ReferencedVintage => gaugeVintageSchema.parse({ status: "referenced", referenceVersion: "gauge-receipt-reference-v1", receipt: { policyVersion: "usgs-observation-vintages-v1", receivedAt: at, insertedVersions: 1, unchangedRecords: 0 }, snapshotRef: { ...summary, observationCount: 1, qualifiedRecords: 1, withdrawnRecords: 0 }, artifact: { name: "gauge-vintage-snapshot.json", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } }) as ReferencedVintage;

test("explicit receipt response requires matching exact bytes and full saved metadata", async () => {
  const reference = fixture(), before = JSON.stringify(reference);
  assert.deepEqual(await verifyReceiptResponse(new Response(bytes), reference), bytes);
  assert.equal(JSON.stringify(reference), before);
  const altered = fixture(); altered.snapshotRef.qualifiedRecords = 0;
  await assert.rejects(verifyReceiptResponse(new Response(bytes), altered), /contents do not match/);
});

test("inspection exposes the full parsed snapshot only after exact bytes and saved metadata checks", async () => {
  const reference = fixture(), before = JSON.stringify(reference);
  const checked = await verifyReceiptSnapshot(new Response(bytes), reference);
  assert.deepEqual(checked.bytes, bytes);
  assert.deepEqual(checked.snapshot, snapshot);
  checked.snapshot.observations[0].quality = "changed locally";
  assert.equal(JSON.stringify(reference), before);
  const altered = fixture(); altered.snapshotRef.qualifiedRecords = 0;
  await assert.rejects(verifyReceiptSnapshot(new Response(bytes), altered), /contents do not match/);
  const corrupted = bytes.slice(); corrupted[0] ^= 1;
  await assert.rejects(verifyReceiptSnapshot(new Response(corrupted), fixture()), /integrity check failed/);
  await assert.rejects(verifyReceiptSnapshot(new Response("denied", { status: 401 }), fixture()), /Sign in again/);
});

test("corrupt, incomplete and over-bound responses cannot produce a checked download", async () => {
  const corrupted = bytes.slice(); corrupted[corrupted.length - 1] ^= 1;
  await assert.rejects(verifyReceiptResponse(new Response(corrupted), fixture()), /integrity check failed/);
  await assert.rejects(verifyReceiptResponse(new Response(bytes.slice(0, -1)), fixture()), /incomplete/);
  await assert.rejects(verifyReceiptResponse(new Response(new Uint8Array(bytes.length + 1)), fixture()), /size does not match/);
});

test("expired and unauthorized files remain unavailable without replacing receipt data", async () => {
  await assert.rejects(verifyReceiptResponse(new Response("not found", { status: 404 }), fixture()), /summary cannot replace/);
  await assert.rejects(verifyReceiptResponse(new Response("secret details", { status: 401 }), fixture()), /Sign in again/);
});

test("cancellation prevents validation completion even when valid bytes were returned", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(verifyReceiptResponse(new Response(bytes), fixture(), controller.signal), { name: "AbortError" });
});

test("matching byte hash alone cannot validate malformed or mismatched snapshot contents", async () => {
  for (const update of [(value: typeof snapshot) => { value.identity.station = "USGS-03339000"; }, (value: typeof snapshot) => { value.snapshotHash = "2".repeat(64); }]) {
    const altered = structuredClone(snapshot); update(altered);
    const body = JSON.stringify(altered), reference = fixture();
    reference.artifact.bytes = new TextEncoder().encode(body).length;
    reference.artifact.sha256 = createHash("sha256").update(body).digest("hex");
    await assert.rejects(verifyReceiptResponse(new Response(body), reference), /contents do not match/);
  }
  const invalid = text.replace('"value":100', '"value":1e400'), reference = fixture();
  reference.artifact.bytes = new TextEncoder().encode(invalid).length;
  reference.artifact.sha256 = createHash("sha256").update(invalid).digest("hex");
  await assert.rejects(verifyReceiptResponse(new Response(invalid), reference), /contents do not match/);
});

test("reference type rejects impossible counts, paths, unsafe file sizes and altered receipt cutoffs", () => {
  for (const mutate of [(value: ReferencedVintage) => { value.snapshotRef.qualifiedRecords = 2; }, (value: ReferencedVintage) => { value.artifact.bytes = 8 * 1024 * 1024 + 1; }, (value: ReferencedVintage) => { value.receipt.receivedAt = "2026-10-12T00:00:00.000000Z"; }]) {
    const invalid = fixture(); mutate(invalid); assert.equal(gaugeVintageSchema.safeParse(invalid).success, false);
  }
  assert.equal(gaugeVintageSchema.safeParse({ ...fixture(), artifact: { ...fixture().artifact, name: "../private.json" } }).success, false);
});

test("referenced receipt wording preserves history while refusing reproduction claims for missing files", () => {
  const markup = renderToStaticMarkup(createElement(GaugeVintageInsights, { vintage: fixture(), jobId: "source-job", artifactExpiresAt: "2020-01-01T00:00:00Z" }));
  assert.ok(markup.includes("1 recorded station-days"));
  assert.ok(markup.includes("full received snapshot has expired"));
  assert.ok(markup.includes("full reproduction requires the original file"));
  assert.equal(markup.includes("Download received snapshot"), false);
  assert.equal(markup.includes("Receipt verified"), false);
  const legacy = gaugeVintageSchema.parse({ status: "captured", receipt: fixture().receipt, snapshot });
  const oldMarkup = renderToStaticMarkup(createElement(GaugeVintageInsights, { vintage: legacy }));
  assert.ok(oldMarkup.includes("Saved as we received it"));
  assert.ok(oldMarkup.includes("included in the protected assessment manifest"));
});

test("embedded and referenced receipt headers must match assessment dates and precise processing cutoff", async () => {
  const { readFileSync } = await import('node:fs');
  const { assessmentResultSchema } = await import('../lib/observatory-contract');
  const captured = JSON.parse(readFileSync(new URL('../examples/gauge-vintage-receipt/capture.json', import.meta.url), 'utf8'))[0];
  const information = JSON.parse(readFileSync(new URL('../examples/gauge-vintage-receipt/forecast-information.json', import.meta.url), 'utf8'));
  const { observations, ...header } = captured.snapshot;
  // Reference metadata only: this test does not claim the placeholder artifact exists.
  const referenced = { status: 'referenced', referenceVersion: 'gauge-receipt-reference-v1', receipt: captured.receipt, snapshotRef: { ...header, observationCount: observations.length, qualifiedRecords: 0, withdrawnRecords: 0 }, artifact: { name: 'gauge-vintage-snapshot.json', bytes: 1, sha256: h } };
  for (const vintage of [captured, referenced]) {
    const result = { schemaVersion: '1.0', kind: 'assessment', domain: 'water', question: 'change', area: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, time: { start: header.start, end: header.end }, processedAt: header.issueTime, methodVersion: 'observatory-1.6.0', title: 'Boundary fixture', outcome: 'partial', evidence: [], claims: [], metrics: [], quality: [], brief: { title: 'Fixture', sections: [] }, artifacts: vintage.status === 'referenced' ? ['gauge-vintage-snapshot.json'] : [], gaugeVintage: vintage, forecastInformation: information };
    assert.equal(assessmentResultSchema.safeParse(result).success, true);
    assert.equal(assessmentResultSchema.safeParse({ ...result, time: { start: '2020-01-01', end: '2020-01-02' } }).success, false);
    assert.equal(assessmentResultSchema.safeParse({ ...result, processedAt: '2020-01-01T00:00:00Z' }).success, false);
    const issueMicros = header.issueTime.match(/\.(\d{6})Z$/)[1];
    const earlier = header.issueTime.replace(/\.(\d{6})Z$/, `.${String(Number(issueMicros) - 1).padStart(6, '0')}Z`);
    assert.equal(assessmentResultSchema.safeParse({ ...result, processedAt: earlier }).success, false);
    assert.equal(assessmentResultSchema.safeParse({ ...result, processedAt: header.issueTime.replace('Z', '+00:00') }).success, true);
    assert.doesNotThrow(() => assessmentResultSchema.safeParse({ ...result, processedAt: 'not-a-time' }));
    assert.equal(assessmentResultSchema.safeParse({ ...result, processedAt: 'not-a-time' }).success, false);
  }
});
