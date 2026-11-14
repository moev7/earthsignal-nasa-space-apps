import { test } from "node:test";
import assert from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RadarAnalysis } from "../features/science/radar-analysis";
import type { useRadarAnalysis } from "../features/science/use-radar-analysis";
import type { AnalysisResult } from "../lib/analysis-contract";

const mockResult: AnalysisResult = {
  schemaVersion: "1.0",
  kind: "radar-analysis",
  jobId: "test-job",
  selection: { polygon: null, thresholdDb: 3 },
  summary: {
    totalPixels: 1000,
    validPixels: 900,
    validPercent: 90,
    pixelAreaM2: 900,
    validAreaKm2: 0.81,
    beforeMedianDb: -10,
    afterMedianDb: -9,
    medianChangeDb: 1,
    p05Db: -2,
    p95Db: 2,
    increasedAreaKm2: 0.1,
    decreasedAreaKm2: 0.1,
    withinThresholdAreaKm2: 0.61
  },
  distributions: {
    before: { edges: [-10, -9], counts: [100] },
    after: { edges: [-10, -9], counts: [100] },
    difference: { edges: [-1, 0], counts: [100] }
  },
  probe: null,
  transect: [],
  insights: ["Analysis complete"],
  provenance: {
    algorithm: "test",
    crs: "EPSG:4326",
    beforeId: "b",
    afterId: "a",
    method: "test",
    units: "dB",
    valueSource: "native-exported-rasters"
  }
};

test("RadarAnalysis renders successful result", () => {
  const mockAnalysis: ReturnType<typeof useRadarAnalysis> = {
    mode: null,
    setMode: () => {},
    point: null,
    setPoint: () => {},
    polygon: [],
    setPolygon: () => {},
    transect: null,
    setTransect: () => {},
    thresholdDb: 3,
    setThresholdDb: () => {},
    status: "success",
    result: mockResult,
    error: null,
    submitSelection: () => {},
    clearSelection: () => {},
    inspectCoordinate: () => {},
    annotations: [],
    annotationsStatus: "idle",
    addAnnotation: async () => true,
    annotationError: null, saving: false, fetchAnnotations: async () => {},
    fetchAnalysis: async () => {},
  };

  const html = renderToStaticMarkup(createElement(RadarAnalysis, { analysis: mockAnalysis }));

  assert.ok(html.includes("Full processed crop"));
  assert.ok(html.includes("0.810 km²"));
  assert.ok(html.includes("Analysis complete"));
  assert.ok(html.includes("Annotations (0)"));
});

test("RadarAnalysis renders error state", () => {
  const mockAnalysis: ReturnType<typeof useRadarAnalysis> = {
    mode: null,
    setMode: () => {},
    point: null,
    setPoint: () => {},
    polygon: [],
    setPolygon: () => {},
    transect: null,
    setTransect: () => {},
    thresholdDb: 3,
    setThresholdDb: () => {},
    status: "error",
    result: null,
    error: "Failed to compute analysis",
    submitSelection: () => {},
    clearSelection: () => {},
    inspectCoordinate: () => {},
    annotations: [],
    annotationsStatus: "idle",
    addAnnotation: async () => true,
    annotationError: null, saving: false, fetchAnnotations: async () => {},
    fetchAnalysis: async () => {},
  };

  const html = renderToStaticMarkup(createElement(RadarAnalysis, { analysis: mockAnalysis }));
  assert.ok(html.includes("Failed to compute analysis"));
});
