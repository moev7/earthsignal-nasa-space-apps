import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inspectionWindowsSchema, type InspectionWindows } from "../lib/inspection-contract";
import { RadarInspection } from "../features/science/radar-inspection";
import { readFileSync } from "node:fs";
import { analysisResultSchema } from "../lib/analysis-contract";

function fixture(): InspectionWindows {
  return {
    schemaVersion: "native-inspection-windows-v1", blockSizePixels: 32, limit: 12, thresholdDb: 3,
    selectedPixels: 4, validPixels: 3, unknownPixels: 1,
    candidateWindows: 1, returnedWindows: 1, omittedWindows: 0, status: "candidates",
    ranking: "exceeded-pixel-count_then_peak-absolute-db_then_native-order",
    candidates: [{
      window: { rowStart: 0, rowEndExclusive: 2, columnStart: 0, columnEndExclusive: 2 },
      selectedPixels: 4, validPixels: 3, unknownPixels: 1, increasedPixels: 1, decreasedPixels: 1, withinThresholdPixels: 1,
      exceededAreaKm2: .0002, validPercent: 75,
      representative: { row: 0, column: 1, differenceDb: -5, coordinate: [-114.75, 36.05], coordinateStatus: "available" },
    }], limitations: ["Unvalidated browsing aid; no event classes."],
  };
}

test("real pinned native inspection receipt passes the web contract without losing source-context fields", () => {
  const receipt = JSON.parse(readFileSync(new URL("../examples/native-radar-development/inspection-receipt.json", import.meta.url), "utf8"));
  const inspection = inspectionWindowsSchema.parse(receipt.inspectionWindows);
  assert.equal(inspection.candidateWindows, 12);
  assert.equal(inspection.validPixels, 10002);
  assert.equal(inspection.candidates.reduce((n, c) => n + c.increasedPixels, 0), 698);
  assert.equal(inspection.candidates.reduce((n, c) => n + c.decreasedPixels, 0), 3156);
  const html = renderToStaticMarkup(createElement(RadarInspection, { inspection, onInspect: () => {} }));
  assert.equal((html.match(/Locate and inspect window/g) ?? []).length, 3);
  assert.match(html, /Show 9 more loaded windows/);
  const analysis = { schemaVersion: "1.0", kind: "radar-analysis", jobId: "development-test", selection: { polygon: null, thresholdDb: 3 }, summary: receipt.summary, distributions: { before: { edges: [], counts: [] }, after: { edges: [], counts: [] }, difference: { edges: [], counts: [] } }, probe: null, transect: [], insights: [], inspectionWindows: inspection, provenance: { algorithm: "native-radar-analysis-v2", crs: receipt.source.crs, beforeId: receipt.source.beforeId, afterId: receipt.source.afterId, method: "Development contract fixture; source identities retained", units: "dB", valueSource: "native-exported-rasters" } };
  assert.equal(analysisResultSchema.safeParse(analysis).success, true);
  assert.equal(analysisResultSchema.safeParse({ ...analysis, selection: { polygon: null, thresholdDb: 4 } }).success, false);
  assert.equal(analysisResultSchema.safeParse({ ...analysis, summary: { ...analysis.summary, pixelAreaM2: 900 } }).success, false);
  assert.equal(analysisResultSchema.safeParse({ ...analysis, summary: { ...analysis.summary, increasedAreaKm2: 0, decreasedAreaKm2: 0, withinThresholdAreaKm2: analysis.summary.validAreaKm2 } }).success, false);
  assert.equal(analysisResultSchema.safeParse({ ...analysis, inspectionWindows: undefined }).success, true);
});

test("inspection contracts reconcile native populations, coordinates and bounded output", () => {
  assert.equal(inspectionWindowsSchema.safeParse(fixture()).success, true);
  const invalid: Array<(f: InspectionWindows) => void> = [
    f => { f.unknownPixels = 0; }, f => { f.returnedWindows = 0; }, f => { f.omittedWindows = 1; },
    f => { f.status = "no_threshold_candidates"; }, f => { f.candidates[0].validPercent = 100; },
    f => { f.candidates[0].withinThresholdPixels = 0; }, f => { f.candidates[0].representative.coordinateStatus = "unavailable"; },
    f => { f.candidates[0].representative.row = 2; }, f => { f.candidates[0].representative.differenceDb = 3; },
    f => { f.candidates[0].window.rowStart = 1; }, f => { f.candidates[0].window.rowEndExclusive = 33; },
    f => { f.candidates[0].increasedPixels = 2; f.candidates[0].decreasedPixels = 0; },
    f => { f.selectedPixels = f.validPixels = 10; f.unknownPixels = 0; },
  ];
  invalid.forEach(mutate => { const value = fixture(); mutate(value); assert.equal(inspectionWindowsSchema.safeParse(value).success, false); });
});

test("inspection contract rejects duplicate windows and reversed ranking rather than silently sorting", () => {
  const value = fixture();
  value.selectedPixels = 8; value.validPixels = 6; value.unknownPixels = 2;
  value.candidateWindows = value.returnedWindows = 2;
  value.candidates.push(structuredClone(value.candidates[0]));
  assert.equal(inspectionWindowsSchema.safeParse(value).success, false);
  const second = value.candidates[1];
  second.window.rowStart = 32; second.window.rowEndExclusive = 34; second.representative.row = 32;
  second.representative.differenceDb = -8;
  assert.equal(inspectionWindowsSchema.safeParse(value).success, false);
  second.representative.differenceDb = -4;
  assert.equal(inspectionWindowsSchema.safeParse(value).success, true);
});

test("no support and no threshold excursions keep distinct meanings", () => {
  const value = fixture(); value.candidates = []; value.candidateWindows = value.returnedWindows = 0;
  value.status = "no_threshold_candidates";
  assert.equal(inspectionWindowsSchema.safeParse(value).success, true);
  let html = renderToStaticMarkup(createElement(RadarInspection, { inspection: value }));
  assert.match(html, /Changes below the cutoff and changes in unknown areas remain unresolved/);
  value.status = "withheld_no_valid_support"; value.validPixels = 0; value.unknownPixels = 4;
  assert.equal(inspectionWindowsSchema.safeParse(value).success, true);
  html = renderToStaticMarkup(createElement(RadarInspection, { inspection: value }));
  assert.match(html, /not evidence of no change/);
  assert.doesNotMatch(html, /Locate and inspect/);
});

test("inspection UI exposes ranking, selected support, exact-cell identity and interpretation limits", () => {
  const html = renderToStaticMarkup(createElement(RadarInspection, { inspection: fixture(), onInspect: () => {} }));
  for (const text of ["Where to inspect next", "1 remain unknown", "Row 0, column 1", "-5.000 dB", "Locate and inspect window 1", "unvalidated inspection aid", "not establish water change", "before assigning a cause", "not detected objects"]) assert.ok(html.includes(text), text);
  const noCoordinate = fixture(); noCoordinate.candidates[0].representative.coordinate = null; noCoordinate.candidates[0].representative.coordinateStatus = "unavailable";
  const unavailable = renderToStaticMarkup(createElement(RadarInspection, { inspection: noCoordinate, onInspect: () => {} }));
  assert.match(unavailable, /Coordinate transformation unavailable/);
  assert.match(unavailable, /disabled=""/);
  const oldService = renderToStaticMarkup(createElement(RadarInspection));
  assert.match(oldService, /Inspection locations are unavailable for this analysis/);
});
