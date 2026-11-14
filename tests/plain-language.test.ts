import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { execFileSync } from "node:child_process";
import { stationSeasonalTrendSchema } from "../lib/science-analytics";
import {
  assessmentPlainResult,
  radarPlainResult,
  historicalWaterPlainResult,
  scenarioPlainResult,
} from "../lib/plain-language";
import type {
  Assessment,
  EvidenceRecord,
  Metric,
  RasterView,
  ScenarioResult,
} from "../lib/observatory-contract";
import type { RadarResult } from "../lib/radar-contract";
import {
  PUBLIC_BLOCKS,
  PUBLIC_QUESTIONS,
  publicAssistantContext,
} from "../lib/public-evidence";
import {
  assistantPayload,
  assistantPreviewHash,
  assistantRequestSchema,
} from "../lib/assistant-contract";
import { PlainLanguageResult } from "../features/decisions/plain-language-result";
import water from "../public/data/processed-water.json";

const evidence = (id: string, sourceId = "test"): EvidenceRecord => ({
  id,
  sourceId,
  sourceVersion: "pinned-v1",
  title: `Source ${id}`,
  url: "https://example.org/source",
  geometry: null,
  spatialSupport: {
    resolution: 30,
    unit: "m",
    description: "Bounded test crop",
  },
  timestamps: {
    observedStart: "2023-06-01",
    observedEnd: "2023-06-10",
    publishedAt: null,
    retrievedAt: "2026-10-10T00:00:00Z",
    validThrough: null,
  },
  quantity: "test",
  unit: "index",
  quality: { commonCoveragePercent: 90, notes: [] },
  maskPolicy: "Recorded common mask",
  methodVersion: "test-v1",
  hashes: { input: "abc" },
  public: false,
});
const metric = (
  id: string,
  value: number | null,
  unit = "index",
  refs = ["before", "after"],
): Metric => ({
  id,
  value,
  unit,
  evidenceIds: refs,
  label: id,
  description: "Recorded test measurement",
  denominator: "Common valid population",
});
const base = (): Assessment => ({
  schemaVersion: "1.0",
  kind: "assessment",
  domain: "ecology",
  question: "change",
  title: "Private test result",
  area: {
    type: "Polygon",
    coordinates: [
      [
        [40, 30],
        [41, 30],
        [41, 31],
        [40, 31],
        [40, 30],
      ],
    ],
  },
  time: { start: "2020-01-01", end: "2025-12-31" },
  processedAt: "2026-10-10T00:00:00Z",
  methodVersion: "observatory-test",
  outcome: "partial",
  evidence: [evidence("before"), evidence("after")],
  metrics: [],
  claims: [],
  quality: [],
  brief: { title: "Test", sections: [] },
  artifacts: [],
});
const raster = (id: RasterView["id"], coverage = 90): RasterView => ({
  id,
  quantity: id,
  unit: "index",
  bounds: [
    [30, 40],
    [31, 41],
  ],
  grid: {
    crs: "EPSG:32611",
    resolution: 30,
    transform: [0, 30, 0, 0, 0, -30],
    width: 10,
    height: 10,
    aggregation: {},
    aoiPolicy: "Pixel centres",
  },
  before: {
    date: "2023-06-01T12:00:00Z",
    evidenceId: "before",
    coveragePercent: 90,
  },
  after: {
    date: "2023-06-10T12:00:00Z",
    evidenceId: "after",
    coveragePercent: 90,
  },
  commonCoveragePercent: coverage,
  validPixels: coverage,
  totalPixels: 100,
  scale: { minimum: 0, maximum: 1, differenceLimit: 1 },
  files: {
    before: { raster: "b.tif", preview: "b.png" },
    after: { raster: "a.tif", preview: "a.png" },
    difference: { raster: "d.tif", preview: "d.png" },
    excluded: { raster: "e.tif", preview: "e.png" },
  },
  hashes: {},
  notes: [],
});

test("vegetation change retains native evidence, actual dates, support and attribution limits", () => {
  const a = base();
  a.rasters = [raster("ndvi", 65)];
  a.metrics = [metric("ndvi-difference", -0.2)];
  const before = JSON.stringify(a);
  const p = assessmentPlainResult(a),
    f = p.findings[0];
  assert.match(f.found, /decreased by 0.2 index units/);
  assert.match(f.found, /2023-06-01 → 2023-06-10/);
  assert.doesNotMatch(f.found, /2020/);
  assert.match(f.limits, /does not confirm deforestation/);
  assert.match(f.limits, /whole-area conclusion is withheld/);
  assert.match(f.support, /65 \/ 100/);
  assert.deepEqual(f.evidenceIds, ["before", "after"]);
  assert.deepEqual(f.metricIds, ["ndvi-difference"]);
  assert.equal(JSON.stringify(a), before);
  a.metrics[0].value = 0;
  assert.match(
    assessmentPlainResult(a).findings[0].found,
    /zero summary does not mean every pixel stayed unchanged/,
  );
});
test("water and temperature differences cannot become retention danger or air temperature", () => {
  for (const [id, unit, value, pattern] of [
    [
      "water",
      "km²",
      2,
      /does not establish water depth, retained volume, flood danger/,
    ],
    [
      "temperature",
      "K",
      -3.75,
      /not air temperature or a human heat-health assessment/,
    ],
  ] as const) {
    const a = base();
    a.domain = id === "water" ? "water" : "urban";
    a.rasters = [raster(id)];
    a.metrics = [
      metric(
        id === "water" ? "water-area-change" : "temperature-difference",
        value,
        unit,
      ),
    ];
    const f = assessmentPlainResult(a).findings[0];
    assert.match(f.limits, pattern);
    if (id === "temperature") {
      assert.match(f.found, /3.75 °C of temperature difference/);
      assert.doesNotMatch(f.found, /277|269|273/);
    }
  }
});
test("missing, nonfinite, wrong-unit or unresolved differences do not fabricate interpretations", () => {
  for (const m of [
    metric("ndvi-difference", null),
    metric("ndvi-difference", Infinity),
    metric("ndvi-difference", 0.2, "km²"),
    metric("ndvi-difference", 0.2, "index", ["unknown"]),
  ]) {
    const a = base();
    a.rasters = [raster("ndvi")];
    a.metrics = [m];
    assert.match(
      assessmentPlainResult(a).findings[0].found,
      /has not been established/,
    );
  }
  const a = base();
  a.metrics = [metric("unknown", 0)];
  assert.match(
    assessmentPlainResult(a).findings[0].meaning,
    /unknown, not zero/,
  );
});
test("single-date measurements remain useful without inventing a comparison", () => {
  const a = base();
  a.domain = "urban";
  a.metrics = [
    metric("landsat-2023-06-01-surface-temperature-median", 300, "K", [
      "before",
    ]),
  ];
  const f = assessmentPlainResult(a).findings[0];
  assert.match(f.found, /26.85 °C \(300 K in the source\)/);
  assert.match(f.found, /single-date/);
  assert.match(f.found, /not a measured increase or decrease/);
  a.metrics = [
    metric("hls-2023-06-01-ndvi-median", 0.2, "index", ["before"]),
    metric("hls-2023-06-10-ndvi-median", 0.3, "index", ["after"]),
  ];
  const g = assessmentPlainResult(a).findings[0];
  assert.deepEqual(g.metricIds, ["hls-2023-06-10-ndvi-median"]);
  assert.match(g.limits, /no matched-pixel change is established/);
});
test("station endpoints preserve point/date support and are not fitted trends or flood assessments", () => {
  const a = base();
  a.domain = "water";
  a.evidence = [
    {
      ...evidence("gauge", "usgs-daily"),
      unit: "ft^3/s",
      title: "USGS test station",
    },
  ];
  a.metrics = [metric("gauge-endpoint-change", -5, "ft^3/s", ["gauge"])];
  a.series = [
    {
      id: "usgs-discharge",
      label: "Test",
      unit: "ft^3/s",
      evidenceIds: ["gauge"],
      points: [
        { date: "2023-01-01", value: null, quality: "missing" },
        { date: "2023-01-02", value: 10, quality: "Approved" },
        { date: "2023-01-03", value: 5, quality: "Provisional" },
      ],
    },
  ];
  const f = assessmentPlainResult(a).findings[0];
  assert.match(
    f.found,
    /lower by 5 cubic feet per second on 2023-01-03 compared with 2023-01-02/,
  );
  assert.match(f.found, /not a fitted trend/);
  assert.match(f.support, /point station/);
  assert.match(f.limits, /does not measure lake volume/);
});
test("thermal records include no-detection semantics and do not count fires or infer safety", () => {
  const a = base();
  a.domain = "fire";
  a.metrics = [metric("thermal-detections", 0, "detections")];
  let f = assessmentPlainResult(a).findings[0];
  assert.match(f.found, /does not establish that no fire occurred/);
  assert.match(
    f.limits,
    /Missing detections and old observations do not show present safety/,
  );
  a.metrics[0].value = 5;
  f = assessmentPlainResult(a).findings[0];
  assert.match(f.found, /records, not necessarily separate fires/);
});
test("seasonal station explanation uses only eligible years and a matching recorded slope", () => {
  const trend = stationSeasonalTrendSchema.parse(
    JSON.parse(
      execFileSync(
        "python3",
        [
          "-c",
          "import json; from service.tests.test_seasonal_trend import station_series; from service.observatory.seasonal_trend import seasonal_trend; print(json.dumps(seasonal_trend(station_series())))",
        ],
        { encoding: "utf8" },
      ),
    ),
  );
  const a = base();
  a.domain = "water";
  a.evidence = [{ ...evidence("gauge", "usgs-daily"), unit: "ft^3/s" }];
  a.metrics = [
    metric("gauge-seasonal-sen-slope", trend.slope, "ft^3/s/year", ["gauge"]),
  ];
  a.series = [
    {
      id: "usgs-discharge",
      label: "Test",
      unit: "ft^3/s",
      evidenceIds: ["gauge"],
      points: [],
      seasonalTrend: trend,
    },
  ];
  const f = assessmentPlainResult(a).findings[0];
  assert.match(f.found, new RegExp(trend.years.join(", ")));
  assert.match(f.found, /descriptive seasonal slope, not a prediction/);
  assert.equal(f.publicBlockId, "water-flow");
  a.metrics[0].value = 999;
  assert.match(
    assessmentPlainResult(a).findings[0].found,
    /has not been established/,
  );
});
test("radar summary retains the tested patch, original median and zeros without causal classes", () => {
  const r = {
    title: "Test radar",
    before: { id: "b", acquiredAt: "2026-06-26T00:00:00Z" },
    after: { id: "a", acquiredAt: "2026-09-30T00:00:00Z" },
    stats: { medianDb: -1.461262118 },
    coverage: {
      validAreaKm2: 1.0002,
      commonValidPercent: 93.337066,
      commonValidPixels: 10002,
      totalPixels: 10716,
    },
    crop: { bbox: [-114.75, 36.05, -114.74, 36.06], crs: "EPSG:32611" },
    processing: {
      algorithmVersion: "radar-v1",
      method: "10 log10(after/before)",
      processedAt: "2026-10-10T00:00:00Z",
    },
  } as RadarResult;
  const p = radarPlainResult(r);
  assert.match(p.findings[0].support, /1.0002 km²/);
  assert.match(p.findings[0].found, /2026-06-26 → 2026-09-30/);
  assert.match(p.findings[0].limits, /cannot describe a whole lake/);
  assert.match(p.findings[0].support, /native-window coverage/);
  assert.match(p.findings[0].limits, /padding and invalid observations/);
  r.coverage.commonValidPercent = 70;
  assert.doesNotMatch(radarPlainResult(r).findings[0].limits, /Less than 80%/);
  assert.match(
    radarPlainResult(r).findings[0].limits,
    /does not establish coverage of the selected area/,
  );
  assert.equal(p.metrics[0].value, -1.461262118);
  r.stats.medianDb = 0;
  assert.match(
    radarPlainResult(r).findings[0].found,
    /zero median does not establish no change/,
  );
});
test("pinned historical water retains regional support and filename-date provenance", () => {
  const p = historicalWaterPlainResult(water);
  assert.equal(p.metrics[0].value, 402.7365);
  assert.match(p.findings[0].found, /not the area of Lake Mead/);
  assert.match(p.findings[0].support, /Filename date 2023-03-31/);
  assert.match(
    p.findings[0].limits,
    /One image does not establish an increase or decrease/,
  );
});
test("scenario plain language preserves assumptions and never turns chosen thresholds into probabilities", () => {
  const s = {
    assessmentId: "test",
    scenarioKind: "threshold",
    methodVersion: "scenario-test",
    outputs: [],
    objectives: ["Test"],
    changedInputs: { threshold: 10 },
    assumptions: ["Assumed threshold"],
    limitations: ["Historical"],
    sensitivities: [],
    thresholdSweep: {
      recordedValue: 9,
      unit: "ft",
      operator: "above",
      denominator: "One station-day",
      cases: [{ meets: true }, { meets: false }],
    },
  } as unknown as ScenarioResult;
  const p = scenarioPlainResult(s, base());
  assert.match(p.findings[0].found, /1 of 2 tested thresholds/);
  assert.match(p.findings[0].found, /not chances of a future event/);
  assert.deepEqual(p.provenance.assumptions, ["Assumed threshold"]);
  assert.match(p.findings[0].limits, /not a forecast/);
});
test("each relevant Gemini question stays within the budget and never sends private result contents", async () => {
  const privateResult = assessmentPlainResult(base());
  for (const b of PUBLIC_BLOCKS) {
    const question = PUBLIC_QUESTIONS[b.id],
      ids = publicAssistantContext(
        b.domain === "general" ? "water" : b.domain,
        question,
      );
    assert.ok(ids.includes(b.evidenceId));
    assert.ok(ids.length <= 8);
    assert.equal(new Set(ids).size, ids.length);
    const payload = JSON.stringify(assistantPayload(question, ids));
    assert.doesNotMatch(
      payload,
      /Private test result|coordinates|recordedAt|originalClaimIds/,
    );
  }
  const question = PUBLIC_QUESTIONS.vegetation,
    ids = publicAssistantContext("ecology", question);
  const request = {
    schemaVersion: "1.0",
    publicAIOptIn: true,
    question,
    evidenceIds: ids,
    previewHash: await assistantPreviewHash(question, ids),
  };
  assert.equal(
    assistantRequestSchema.safeParse({ ...request, result: privateResult })
      .success,
    false,
  );
  assert.equal(
    assistantRequestSchema.safeParse({ ...request, publicAIOptIn: false })
      .success,
    false,
  );
});

test("water turnover learning stays first and coverage never grants whole-area validity", () => {
  const question = PUBLIC_QUESTIONS['water-transitions'];
  assert.equal(publicAssistantContext('water', question)[0], 'earthsignal-class1-transitions');
  const block = PUBLIC_BLOCKS.find(b => b.id === 'water-transitions')!;
  assert.match(block.text, /gain-plus-loss/);
  assert.match(block.text, /does not establish dry ground/);
  assert.match(block.limitations.join(' '), /not accuracy-adjusted/);
  const coverage = PUBLIC_BLOCKS.find(b => b.id === 'coverage')!;
  assert.match(coverage.text, /above that level still does not establish representativeness/);
});
test("rendered summary has accessible evidence disclosure, local export and result-adjacent Gemini without replacing technical content", () => {
  const a = base();
  a.rasters = [raster("ndvi")];
  a.metrics = [metric("ndvi-difference", -0.2)];
  const html = renderToStaticMarkup(
    React.createElement(PlainLanguageResult, {
      result: assessmentPlainResult(a),
    }),
  );
  for (const text of [
    "In simple terms",
    "What we found",
    "Why it matters",
    "What this cannot tell us",
    "Useful next check",
    "Why do we say this?",
    "Original value: -0.2",
    "Export this explanation",
    "Ask Gemini about this result",
    "plain-language-1.0.0",
  ])
    assert.ok(html.includes(text), text);
  assert.match(html, /href="https:\/\/example.org\/source"/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Outbound public payload/);
});
