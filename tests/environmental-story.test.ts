import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  Assessment,
  EvidenceRecord,
  Metric,
  RasterView,
} from "../lib/observatory-contract";
import type { ChangeJob, RadarBbox, RadarResult } from "../lib/radar-contract";
import {
  environmentalStory,
  radarAssessmentArea,
} from "../lib/environmental-story";
import { EnvironmentalStory } from "../features/decisions/environmental-story";

const bbox: RadarBbox = [40, 30, 41, 31];
const source = (id: string, date: string): EvidenceRecord => ({
  id,
  sourceId: "hls-ndvi-ndmi",
  sourceVersion: "2.0",
  title: id,
  url: "https://example.org/source",
  geometry: radarAssessmentArea(bbox),
  spatialSupport: {
    resolution: 30,
    unit: "m",
    description: "Selected-area grid",
  },
  timestamps: {
    observedStart: date,
    observedEnd: date,
    publishedAt: null,
    retrievedAt: "2026-10-10T00:00:00Z",
    validThrough: null,
  },
  quantity: "quality-masked NDVI/NDMI",
  unit: "index",
  quality: { commonCoveragePercent: id === "before" ? 95 : 93, notes: ["Clouds excluded"] },
  maskPolicy: "Intersection of QA, finite science data and exact polygon",
  methodVersion: "test-v1",
  hashes: { input: "abc" },
  public: false,
});
const metric = (id = "ndvi-difference", unit = "index"): Metric => ({
  id,
  label: id,
  unit,
  value: -0.2,
  evidenceIds: ["before", "after"],
  description: "Median of pixelwise after-minus-before differences",
  denominator: "90 common-valid selected-area pixel centres",
});
function raster(id: RasterView["id"] = "ndvi"): RasterView {
  return {
    id,
    quantity: id,
    unit:
      id === "temperature"
        ? "K"
        : id === "water"
          ? "class-1 indicator (0/1)"
          : "index",
    bounds: [
      [30, 40],
      [31, 41],
    ],
    grid: {
      crs: "EPSG:32637",
      resolution: 30,
      transform: [0, 30, 0, 0, 0, -30],
      width: 10,
      height: 10,
      aggregation: { red: 1 },
      aoiPolicy: "Pixel centres; holes excluded",
    },
    before: {
      date: "2026-06-03T10:00:00Z",
      evidenceId: "before",
      coveragePercent: 95,
    },
    after: {
      date: "2026-06-28T10:00:00Z",
      evidenceId: "after",
      coveragePercent: 93,
    },
    commonCoveragePercent: 90,
    validPixels: 90,
    totalPixels: 100,
    scale: { minimum: -1, maximum: 1, differenceLimit: 0.5 },
    files: {
      before: { raster: "before.tif", preview: "before.png" },
      after: { raster: "after.tif", preview: "after.png" },
      difference: { raster: "difference.tif", preview: "difference.png" },
      excluded: { raster: "excluded.tif", preview: "excluded.png" },
    },
    hashes: { mask: "common-mask-hash" },
    notes: [
      "Excluded codes: 0 common-valid; 1 invalid before; 2 invalid after; 3 invalid both; 255 outside the recorded area.",
    ],
  };
}
function assessment(): Assessment {
  return {
    schemaVersion: "1.0",
    kind: "assessment",
    domain: "ecology",
    question: "change",
    title: "Test",
    area: radarAssessmentArea(bbox),
    time: { start: "2026-06-01", end: "2026-06-30" },
    processedAt: "2026-10-10T00:00:00Z",
    methodVersion: "test-v1",
    outcome: "partial",
    evidence: [
      source("before", "2026-06-03T10:00:00Z"),
      source("after", "2026-06-28T10:00:00Z"),
    ],
    metrics: [metric()],
    claims: [],
    quality: [
      {
        dimension: "attribution",
        status: "withheld",
        message: "No causal attribution",
      },
    ],
    brief: { title: "Test", sections: [] },
    artifacts: [],
    rasters: [raster()],
  };
}
function radar(): ChangeJob {
  const acquisition = (id: string, acquiredAt: string) => ({
    id,
    acquiredAt,
    track: 1,
    frame: 1,
    direction: "Ascending",
    mode: "test",
    release: "test",
    collection: "NISAR",
    url: "https://example.org/radar",
  });
  const result: RadarResult = {
    schemaVersion: "1.0",
    kind: "radar-change",
    title: "Radar test",
    before: acquisition("b", "2026-06-01T23:00:00Z"),
    after: acquisition("a", "2026-06-30T01:00:00Z"),
    crop: {
      bbox: [...bbox],
      crs: "EPSG:32637",
      resolution: [10, 10],
      width: 10,
      height: 10,
      transform: [0, 10, 0, 0, 0, -10],
      imageBounds: [
        [30, 40],
        [31, 41],
      ],
    },
    stats: { medianDb: -1.5, p05Db: -2, p95Db: 1, minDb: -4, maxDb: 4 },
    coverage: {
      totalPixels: 100,
      beforeValidPixels: 99,
      afterValidPixels: 95,
      commonValidPixels: 90,
      commonValidPercent: 90,
      validAreaKm2: 0.009,
    },
    layers: {
      before: "before.png",
      after: "after.png",
      difference: "difference.png",
      excluded: "excluded.png",
    },
    artifacts: [],
    display: {
      backscatterMinDb: -30,
      backscatterMaxDb: 0,
      differenceLimitDb: 5,
    },
    processing: {
      algorithmVersion: "radar-v1",
      method: "10 log10(after/before)",
      processedAt: "2026-10-10T00:00:00Z",
      beforeSha256: "b-hash",
      afterSha256: "a-hash",
      maskPolicy: "common finite positive pixels",
      sourceMetadata: {},
    },
    notice: "No causal classification",
  };
  return {
    schemaVersion: "1.0",
    id: "selected",
    status: "completed",
    phase: "complete",
    createdAt: "2026-10-10T00:00:00Z",
    updatedAt: "2026-10-10T00:00:00Z",
    beforeId: "b",
    afterId: "a",
    bbox: [...bbox],
    prepared: false,
    result,
    error: null,
  };
}

test("valid source-bound pair keeps native values and populations separate from radar", () => {
  const a = assessment(),
    r = radar(),
    before = JSON.stringify([a, r]);
  const story = environmentalStory(a, r);
  assert.equal(story.alignment.status, "comparable-context");
  assert.equal(story.indicators[0].status, "paired");
  assert.equal(story.indicators[0].radarRelationship, "comparable-context");
  assert.equal(story.indicators[0].metric?.value, -0.2);
  assert.equal(story.indicators[0].raster?.validPixels, 90);
  assert.match(story.indicators[0].finding!.found, /matched-pixel differences/);
  assert.match(story.limits.join(" "), /not causal corroboration/);
  assert.equal(
    JSON.stringify([a, r]),
    before,
    "pure function does not mutate inputs",
  );
});
test("rectangle equality ignores starting corner and winding but rejects crossed order", () => {
  for (const ring of [
    [
      [41, 31],
      [41, 30],
      [40, 30],
      [40, 31],
      [41, 31],
    ],
    [
      [41, 30],
      [41, 31],
      [40, 31],
      [40, 30],
      [41, 30],
    ],
  ]) {
    const a = assessment();
    a.area = { type: "Polygon", coordinates: [ring as [number, number][]] };
    assert.equal(
      environmentalStory(a, radar()).alignment.status,
      "comparable-context",
    );
  }
  const a = assessment();
  a.area = {
    type: "Polygon",
    coordinates: [
      [
        [40, 30],
        [41, 31],
        [41, 30],
        [40, 31],
        [40, 30],
      ],
    ],
  };
  assert.equal(
    environmentalStory(a, radar()).alignment.status,
    "separate-context",
  );
});
test("same envelope with holes, an inset vertex or multipolygon is separate context", () => {
  const a = assessment();
  if (a.area.type === "Polygon")
    a.area.coordinates.push([
      [40.2, 30.2],
      [40.4, 30.2],
      [40.4, 30.4],
      [40.2, 30.2],
    ]);
  assert.equal(
    environmentalStory(a, radar()).alignment.status,
    "separate-context",
  );
  const multi = assessment();
  multi.area = {
    type: "MultiPolygon",
    coordinates: [
      (radarAssessmentArea(bbox) as { coordinates: [number, number][][] })
        .coordinates,
    ],
  };
  assert.equal(
    environmentalStory(multi, radar()).alignment.status,
    "separate-context",
  );
  const inset = assessment();
  inset.area = {
    type: "Polygon",
    coordinates: [
      [
        [40, 30],
        [41, 30],
        [40.8, 30.8],
        [40, 31],
        [40, 30],
      ],
    ],
  };
  assert.equal(
    environmentalStory(inset, radar()).alignment.status,
    "separate-context",
  );
});
test("coordinate tolerance is 1e-9 and requested window must match acquisition days exactly", () => {
  const a = assessment();
  a.area = radarAssessmentArea([40 + 5e-10, 30, 41, 31]);
  assert.equal(
    environmentalStory(a, radar()).alignment.status,
    "comparable-context",
  );
  a.area = radarAssessmentArea([40 + 2e-9, 30, 41, 31]);
  assert.equal(
    environmentalStory(a, radar()).alignment.status,
    "separate-context",
  );
  a.area = radarAssessmentArea(bbox);
  a.time.start = "2026-05-31";
  assert.equal(
    environmentalStory(a, radar()).alignment.status,
    "separate-context",
  );
});
test("7-day optical convention uses calendar days, with beyond7 retained as separate context", () => {
  const a = assessment();
  a.rasters![0].before.date = "2026-06-08T23:59:00Z";
  a.evidence[0].timestamps.observedStart = a.rasters![0].before.date;
  assert.equal(
    environmentalStory(a, radar()).indicators[0].radarRelationship,
    "comparable-context",
  );
  a.rasters![0].before.date = "2026-06-09T00:00:00Z";
  a.evidence[0].timestamps.observedStart = a.rasters![0].before.date;
  const indicator = environmentalStory(a, radar()).indicators[0];
  assert.equal(indicator.status, "paired");
  assert.equal(indicator.radarRelationship, "separate-context");
  assert.match(indicator.reasons.join(" "), /more than 7 calendar days/);
});
test("missing or ambiguous references, reordered dates, and source date mismatch withhold paired wording", () => {
  for (const mutate of [
    (a: Assessment) => {
      a.evidence.pop();
    },
    (a: Assessment) => {
      a.evidence.push({ ...a.evidence[0] });
    },
    (a: Assessment) => {
      a.metrics[0].evidenceIds = ["before"];
    },
    (a: Assessment) => {
      a.rasters![0].before.date = "2026-06-29T00:00:00Z";
    },
    (a: Assessment) => {
      a.evidence[0].timestamps.observedStart = "2026-06-02";
    },
    (a: Assessment) => {
      a.metrics[0].unit = "percent";
    },
    (a: Assessment) => {
      a.rasters![0].commonCoveragePercent = 99;
    },
  ]) {
    const a = assessment();
    mutate(a);
    const indicator = environmentalStory(a, radar()).indicators[0];
    assert.equal(indicator.status, "withheld");
    assert.equal(indicator.finding, null);
    assert.ok(indicator.reasons.length > 0);
  }
});
test("low common coverage preserves measured subset and withholds whole-area interpretation", () => {
  const a = assessment();
  a.rasters![0].validPixels = 40;
  a.rasters![0].commonCoveragePercent = 40;
  a.rasters![0].before.coveragePercent = 45;
  a.rasters![0].after.coveragePercent = 50;
  a.evidence[0].quality.commonCoveragePercent = 45;
  a.evidence[1].quality.commonCoveragePercent = 50;
  const indicator = environmentalStory(a, radar()).indicators[0];
  assert.equal(indicator.status, "paired");
  assert.match(
    indicator.reasons.join(" "),
    /whole-area interpretation withheld/,
  );
  assert.match(indicator.finding!.limits, /Less than 80%/);
  assert.equal(indicator.metric!.value, -0.2);
});
test("source quantity, units, method and masks must support the native paired indicator", () => {
  for(const mutate of [
    (a: Assessment) => { for(const e of a.evidence){e.quantity="daily mean discharge";e.unit="ft^3/s";} },
    (a: Assessment) => { a.evidence[1].maskPolicy="Different cloud mask"; },
    (a: Assessment) => { a.evidence[1].methodVersion="different-method"; },
  ]) {
    const a=assessment();mutate(a);
    const indicator=environmentalStory(a,radar()).indicators[0];
    assert.equal(indicator.status,"withheld");assert.equal(indicator.finding,null);
  }
});
test("impossible mask intersections and disjoint crop support cannot receive paired wording", () => {
  for(const mutate of [
    (a: Assessment) => { a.rasters![0].before.coveragePercent=10;a.rasters![0].after.coveragePercent=20; },
    (a: Assessment) => { a.rasters![0].before.coveragePercent=100;a.rasters![0].after.coveragePercent=100; },
    (a: Assessment) => { a.evidence[0].geometry=radarAssessmentArea([0,0,1,1]); },
    (a: Assessment) => { a.rasters![0].bounds=[[0,0],[1,1]]; },
  ]) {
    const a=assessment();mutate(a);
    const story=environmentalStory(a,radar());
    assert.equal(story.indicators[0].status,"withheld");
    assert.equal(story.alignment.status,"boundary-window-matched");
  }
});
test("matching selections do not imply matching environmental measurements", () => {
  const a=assessment();a.metrics=[];a.rasters=[];a.evidence=[];
  assert.equal(environmentalStory(a,radar()).alignment.status,"boundary-window-matched");
  const distant=assessment();distant.rasters![0].before.date="2026-06-15T00:00:00Z";distant.evidence[0].timestamps.observedStart=distant.rasters![0].before.date;
  assert.equal(environmentalStory(distant,radar()).alignment.status,"boundary-window-matched");
});
test("all four native metric IDs and distinct water raster units are supported without remapping", () => {
  for (const [id, metricId, unit] of [
    ["ndvi", "ndvi-difference", "index"],
    ["ndmi", "ndmi-difference", "index"],
    ["temperature", "temperature-difference", "K"],
    ["water", "water-area-change", "km²"],
  ] as const) {
    const a = assessment();
    a.rasters = [raster(id)];
    a.metrics = [metric(metricId, unit)];
    if(id === "temperature" || id === "water") for (const e of a.evidence) {
      e.sourceId = id === "temperature" ? "landsat-pc-lst" : "opera-dswx-hls";
      e.quantity = id === "temperature" ? "quality-masked surface temperature" : "quality-masked classified water footprint";
      e.unit = id === "temperature" ? "K" : "km2";
    }
    const indicator = environmentalStory(a, radar()).indicators[0];
    assert.equal(indicator.status, "paired");
    assert.equal(indicator.metric?.unit, unit);
    if (id === "water")
      assert.equal(indicator.raster?.unit, "class-1 indicator (0/1)");
  }
});
test("standalone single-date assessments remain useful without inferred change", () => {
  const a = assessment();
  a.rasters = [];
  a.metrics = [
    {
      ...metric("hls-2026-06-03-ndvi-median"),
      value: 0.4,
      evidenceIds: ["before"],
    },
  ];
  const story = environmentalStory(a, null);
  assert.equal(story.alignment.status, "standalone");
  assert.equal(story.radar, null);
  assert.equal(story.indicators[0].status, "single-date");
  assert.match(
    story.indicators[0].finding!.found,
    /not a measured increase or decrease/,
  );
  assert.equal(story.followUp[0].title, "Monitor vegetation");
});
test("selected radar job state, identity and crop mismatches fail closed", () => {
  for (const mutate of [
    (r: ChangeJob) => {
      r.status = "running";
    },
    (r: ChangeJob) => {
      r.beforeId = "other";
    },
    (r: ChangeJob) => {
      r.bbox = [40.1, 30, 41, 31];
    },
  ]) {
    const r = radar();
    mutate(r);
    const story = environmentalStory(assessment(), r);
    assert.equal(story.alignment.status, "withheld");
    assert.equal(story.radar, null);
  }
  assert.equal(
    environmentalStory(null, radar()).alignment.status,
    "awaiting-assessment",
  );
  assert.equal(environmentalStory(null, null).forecast.status, "not-evaluated");
});
test("gauge forecast is the recorded experiment and its radar relationship stays unknown", () => {
  const a = assessment();
  a.domain = "water";
  a.evidence.push({
    ...source("gauge", "2026-10-09"),
    sourceId: "usgs-daily",
    unit: "ft^3/s",
    quantity: "daily mean discharge",
    title: "Station A",
    geometry: null,
  });
  a.series = [
    {
      id: "usgs-discharge",
      label: "Station A",
      unit: "ft^3/s",
      evidenceIds: ["gauge"],
      points: [],
    },
  ];
  const validation = {
    methodVersion: "forecast-v1",
    trainingStart: "2022-01-01",
    trainingEnd: "2025-01-01",
    testStart: "2025-01-02",
    testEnd: "2026-01-01",
    origins: 52,
    mae: 1,
    intervalCoverage: 0.9,
    intervalWidth: 4,
    applicability: ["Station A only"],
    limitations: ["Temporal dependence"],
  };
  a.forecastEvaluation = {
    seriesId: "usgs-discharge",
    methodVersion: "forecast-v1",
    status: "experimental",
    selectionHash: null,
    sourceInputHash: null,
    folds: null,
    forecasts: [
      {
        schemaVersion: "1.0",
        target: "Station A",
        issueTime: "2026-10-10T00:00:00Z",
        horizonDays: 7,
        model: "existing",
        modelVersion: "v1",
        distribution: { point: 3, lower: 1, upper: 5, unit: "ft^3/s" },
        baselines: [{ model: "persistence", mae: 2 }],
        validation: {...validation},
        validThrough: "2026-10-17T00:00:00Z",
      },
    ],
    validation: [{...validation,model:"existing",horizonDays:7,baselinePerformance:[{model:"persistence",mae:2}],improvementFraction:.5,calibrationOrigins:36}],
    withheld: [],
    notes: ["Experimental"],
  };
  const story = environmentalStory(a, radar(), Date.parse("2026-10-10T12:00:00Z"));
  assert.equal(story.forecast.status, "experimental-available");
  assert.equal(story.forecast.target, "Station A");
  assert.equal(story.forecast.evaluation, a.forecastEvaluation);
  assert.match(story.forecast.relationship, /relationship.*unknown/);
  assert.match(story.forecast.relationship, /not a NISAR prediction/);
  a.forecastEvaluation.forecasts[0].validation.applicability=["Another population"];
  assert.equal(environmentalStory(a,radar(),Date.parse("2026-10-10T12:00:00Z")).forecast.status,"unresolved");
  a.forecastEvaluation.forecasts[0].validation.applicability=validation.applicability;
  const f=a.forecastEvaluation.forecasts[0];
  f.issueTime="2020-01-01T00:00:00Z";f.validThrough="2020-01-04T00:00:00Z";
  assert.equal(environmentalStory(a,radar(),Date.parse("2026-10-10T12:00:00Z")).forecast.status,"no-current-estimate");
  const expiredHtml=renderToStaticMarkup(React.createElement(EnvironmentalStory,{assessment:a,radar:radar()}));
  assert.match(expiredHtml,/Expired estimate/);assert.doesNotMatch(expiredHtml,/experimental available/);
  f.issueTime="2300-01-01T00:00:00Z";f.validThrough="2300-01-04T00:00:00Z";
  assert.equal(environmentalStory(a,radar(),Date.parse("2026-10-10T12:00:00Z")).forecast.status,"no-current-estimate");
  a.forecastEvaluation.forecasts[0].target = "Station B";
  assert.equal(environmentalStory(a, radar()).forecast.status, "unresolved");
  a.forecastEvaluation.forecasts[0].target = "Station A";
  a.forecastEvaluation.forecasts[0].distribution.unit = "km²";
  assert.equal(environmentalStory(a, radar()).forecast.status, "unresolved");
  a.forecastEvaluation.forecasts[0].distribution.unit = "ft^3/s";
  a.forecastEvaluation.forecasts = [];
  a.forecastEvaluation.withheld = ["Stale history"];
  assert.equal(environmentalStory(a, radar()).forecast.status, "withheld");
  a.series[0].evidenceIds = ["missing"];
  assert.equal(environmentalStory(a, radar()).forecast.status, "unresolved");
});
test("presentation exposes accessible local anchors and progressive scientific provenance", () => {
  const html = renderToStaticMarkup(
    React.createElement(EnvironmentalStory, {
      assessment: assessment(),
      radar: radar(),
    }),
  );
  for (const expected of [
    'href="#assessment-timeline"',
    'href="#assessment-measurements"',
    "<summary>",
    "Original metric ndvi-difference: -0.2 index",
    "90 / 100 selected-area pixels",
    "Source version 2.0",
    "Clouds excluded",
    "common-mask-hash",
    "beforeSha256",
    "not a NISAR prediction",
    "7 calendar days",
    "Original assessment and selected radar provenance",
  ])
    assert.ok(html.includes(expected), expected);
  assert.match(html, /Export explanation/);
  assert.match(html, /aria-expanded="false">Ask Gemini about the science/);
  assert.doesNotMatch(html, /<form|Outbound public payload/);
});

// A selection is not a finding: empty setup must not look like a completed assessment.
test('empty setup renders no result story or interpretation', () => {
  const html = renderToStaticMarkup(React.createElement(EnvironmentalStory, {assessment:null, radar:null}));
  assert.equal(html, '');
});
