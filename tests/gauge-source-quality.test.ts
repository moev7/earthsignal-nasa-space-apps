import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { summarizeGaugeQuality, type GaugeSnapshot } from "../lib/gauge-source-quality";

// Base structural fixture fields for count tests; labeled count fixtures NOT newly captured vintages.
type SourceCountFeature = { properties: { time: string; value: string | number | null; approval_status: string; qualifier?: string[] | null } };
const h = "a".repeat(64);
const baseIdentity = {
  station: "USGS-09421500",
  timeSeriesId: "test-ts",
  parameter: "00060" as const,
  statistic: "00003" as const,
  unit: "ft^3/s" as const,
};

function createCountFixture(
  partial: Partial<GaugeSnapshot> & {
    observations: GaugeSnapshot["observations"];
  }
): GaugeSnapshot {
  return {
    policyVersion: "usgs-observation-vintages-v1",
    availabilityBasis: "local-receipt-only",
    identity: partial.identity ?? baseIdentity,
    issueTime: "2026-10-13T00:00:00.000000Z",
    start: "2021-10-02",
    end: "2025-09-30",
    calendarDays: 1460,
    unknownDays: partial.unknownDays ?? 0,
    snapshotHash: h,
    ...partial,
  };
}

test("actual public raw fixture USGS-09421500 counts 1327 Approved and 133 Provisional with 0 flags", () => {
  const filePath = new URL("../examples/gauge-quality-admission/sources/daily_USGS-09421500.json", import.meta.url);
  const rawData: { features: SourceCountFeature[] } = JSON.parse(readFileSync(filePath, "utf8"));
  // Clearly labeled count fixture mapped only to selected fields for counting, NOT newly captured vintage
  const observations: GaugeSnapshot["observations"] = rawData.features.map((f) => ({
    identity: baseIdentity,
    date: f.properties.time,
    value: f.properties.value !== null ? Number(f.properties.value) : null,
    quality: f.properties.approval_status,
    qualifiers: f.properties.qualifier ?? [],
    stationTimeProperties: {},
    revision: 1,
    receivedAt: "2026-10-13T00:00:00.000000Z",
    firstReceivedAt: "2026-10-13T00:00:00.000000Z",
    contentHash: h,
    stationPropertiesHash: h,
    sourceResponseHash: h,
    sourceMetadataHash: h,
    versionHash: h,
  }));

  const snapshot = createCountFixture({
    identity: { ...baseIdentity, station: "USGS-09421500" },
    observations,
    unknownDays: 0,
  });

  const summary = summarizeGaugeQuality(snapshot);
  assert.equal(summary.records, 1460);
  assert.equal(summary.numericRecords, 1460);
  assert.equal(summary.nullRecords, 0);
  assert.equal(summary.missingDays, 0);
  assert.equal(summary.qualifiedRecords, 0);
  assert.deepEqual(summary.approvalCounts, [
    { label: "Approved", records: 1327 },
    { label: "Provisional", records: 133 },
  ]);
  assert.deepEqual(summary.flagCounts, []);
});

test("actual public raw fixture USGS-03339000 counts 1460 Approved with ESTIMATED 144, FORCEINTERPOLATION 7, 151 qualified", () => {
  const filePath = new URL("../examples/gauge-quality-admission/sources/daily_USGS-03339000.json", import.meta.url);
  const rawData: { features: SourceCountFeature[] } = JSON.parse(readFileSync(filePath, "utf8"));
  // Clearly labeled count fixture mapped only to selected fields for counting, NOT newly captured vintage
  const observations: GaugeSnapshot["observations"] = rawData.features.map((f) => ({
    identity: { ...baseIdentity, station: "USGS-03339000" },
    date: f.properties.time,
    value: f.properties.value !== null ? Number(f.properties.value) : null,
    quality: f.properties.approval_status,
    qualifiers: f.properties.qualifier ?? [],
    stationTimeProperties: {},
    revision: 1,
    receivedAt: "2026-10-13T00:00:00.000000Z",
    firstReceivedAt: "2026-10-13T00:00:00.000000Z",
    contentHash: h,
    stationPropertiesHash: h,
    sourceResponseHash: h,
    sourceMetadataHash: h,
    versionHash: h,
  }));

  const snapshot = createCountFixture({
    identity: { ...baseIdentity, station: "USGS-03339000" },
    observations,
    unknownDays: 0,
  });

  const summary = summarizeGaugeQuality(snapshot);
  assert.equal(summary.records, 1460);
  assert.equal(summary.numericRecords, 1460);
  assert.equal(summary.nullRecords, 0);
  assert.equal(summary.missingDays, 0);
  assert.equal(summary.qualifiedRecords, 151);
  assert.deepEqual(summary.approvalCounts, [{ label: "Approved", records: 1460 }]);
  assert.deepEqual(summary.flagCounts, [
    { label: "ESTIMATED", records: 144 },
    { label: "FORCEINTERPOLATION", records: 7 },
  ]);
});

test("missingDays vs nullRecords vs numeric zero records counting", () => {
  const snapshot = createCountFixture({
    unknownDays: 5,
    observations: [
      {
        identity: baseIdentity,
        date: "2025-01-01",
        value: 0, // numeric zero is a valid numeric record
        quality: "Approved",
        qualifiers: [],
        stationTimeProperties: {},
        revision: 1,
        receivedAt: "2026-10-13T00:00:00.000000Z",
        firstReceivedAt: "2026-10-13T00:00:00.000000Z",
        contentHash: h,
        stationPropertiesHash: h,
        sourceResponseHash: h,
        sourceMetadataHash: h,
        versionHash: h,
      },
      {
        identity: baseIdentity,
        date: "2025-01-02",
        value: 42.5,
        quality: "Approved",
        qualifiers: [],
        stationTimeProperties: {},
        revision: 1,
        receivedAt: "2026-10-13T00:00:00.000000Z",
        firstReceivedAt: "2026-10-13T00:00:00.000000Z",
        contentHash: h,
        stationPropertiesHash: h,
        sourceResponseHash: h,
        sourceMetadataHash: h,
        versionHash: h,
      },
      {
        identity: baseIdentity,
        date: "2025-01-03",
        value: null, // explicit null
        quality: "Provisional",
        qualifiers: ["ICE"],
        stationTimeProperties: {},
        revision: 1,
        receivedAt: "2026-10-13T00:00:00.000000Z",
        firstReceivedAt: "2026-10-13T00:00:00.000000Z",
        contentHash: h,
        stationPropertiesHash: h,
        sourceResponseHash: h,
        sourceMetadataHash: h,
        versionHash: h,
      },
    ],
  });

  const summary = summarizeGaugeQuality(snapshot);
  assert.equal(summary.records, 3);
  assert.equal(summary.numericRecords, 2);
  assert.equal(summary.nullRecords, 1);
  assert.equal(summary.missingDays, 5);
  assert.equal(summary.qualifiedRecords, 1);
});

test("overlapping flags and duplicate array token per record", () => {
  const snapshot = createCountFixture({
    observations: [
      {
        identity: baseIdentity,
        date: "2025-01-01",
        value: 10,
        quality: "Approved",
        // Duplicate token within single record's qualifier array
        qualifiers: ["ESTIMATED", "ESTIMATED", "ICE"],
        stationTimeProperties: {},
        revision: 1,
        receivedAt: "2026-10-13T00:00:00.000000Z",
        firstReceivedAt: "2026-10-13T00:00:00.000000Z",
        contentHash: h,
        stationPropertiesHash: h,
        sourceResponseHash: h,
        sourceMetadataHash: h,
        versionHash: h,
      },
      {
        identity: baseIdentity,
        date: "2025-01-02",
        value: 15,
        quality: "Approved",
        qualifiers: ["ICE"],
        stationTimeProperties: {},
        revision: 1,
        receivedAt: "2026-10-13T00:00:00.000000Z",
        firstReceivedAt: "2026-10-13T00:00:00.000000Z",
        contentHash: h,
        stationPropertiesHash: h,
        sourceResponseHash: h,
        sourceMetadataHash: h,
        versionHash: h,
      },
    ],
  });

  const summary = summarizeGaugeQuality(snapshot);
  assert.equal(summary.records, 2);
  assert.equal(summary.qualifiedRecords, 2);
  // ICE appears in 2 records, ESTIMATED appears in 1 record (even though duplicated in array)
  assert.deepEqual(summary.flagCounts, [
    { label: "ICE", records: 2 },
    { label: "ESTIMATED", records: 1 },
  ]);
});

test("unknown mixed approval literal retained without modification", () => {
  const snapshot = createCountFixture({
    observations: [
      {
        identity: baseIdentity,
        date: "2025-01-01",
        value: 10,
        quality: "Custom/Mixed_Status",
        qualifiers: [],
        stationTimeProperties: {},
        revision: 1,
        receivedAt: "2026-10-13T00:00:00.000000Z",
        firstReceivedAt: "2026-10-13T00:00:00.000000Z",
        contentHash: h,
        stationPropertiesHash: h,
        sourceResponseHash: h,
        sourceMetadataHash: h,
        versionHash: h,
      },
      {
        identity: baseIdentity,
        date: "2025-01-02",
        value: 20,
        quality: "provisional", // lowercase retained exactly
        qualifiers: [],
        stationTimeProperties: {},
        revision: 1,
        receivedAt: "2026-10-13T00:00:00.000000Z",
        firstReceivedAt: "2026-10-13T00:00:00.000000Z",
        contentHash: h,
        stationPropertiesHash: h,
        sourceResponseHash: h,
        sourceMetadataHash: h,
        versionHash: h,
      },
    ],
  });

  const summary = summarizeGaugeQuality(snapshot);
  assert.deepEqual(summary.approvalCounts, [
    { label: "Custom/Mixed_Status", records: 1 },
    { label: "provisional", records: 1 },
  ]);
});

test("__proto__ and constructor strings safely counted via Map", () => {
  const snapshot = createCountFixture({
    observations: [
      {
        identity: baseIdentity,
        date: "2025-01-01",
        value: 10,
        quality: "__proto__",
        qualifiers: ["constructor", "__proto__"],
        stationTimeProperties: {},
        revision: 1,
        receivedAt: "2026-10-13T00:00:00.000000Z",
        firstReceivedAt: "2026-10-13T00:00:00.000000Z",
        contentHash: h,
        stationPropertiesHash: h,
        sourceResponseHash: h,
        sourceMetadataHash: h,
        versionHash: h,
      },
      {
        identity: baseIdentity,
        date: "2025-01-02",
        value: 20,
        quality: "constructor",
        qualifiers: ["toString"],
        stationTimeProperties: {},
        revision: 1,
        receivedAt: "2026-10-13T00:00:00.000000Z",
        firstReceivedAt: "2026-10-13T00:00:00.000000Z",
        contentHash: h,
        stationPropertiesHash: h,
        sourceResponseHash: h,
        sourceMetadataHash: h,
        versionHash: h,
      },
    ],
  });

  const summary = summarizeGaugeQuality(snapshot);
  assert.equal(summary.records, 2);
  assert.equal(summary.qualifiedRecords, 2);
  // Safe Map handling does not crash or pollute Object prototype
  assert.deepEqual(summary.approvalCounts, [
    { label: "__proto__", records: 1 },
    { label: "constructor", records: 1 },
  ]);
  assert.deepEqual(summary.flagCounts, [
    { label: "__proto__", records: 1 },
    { label: "constructor", records: 1 },
    { label: "toString", records: 1 },
  ]);
});

test("deterministic tie-breaking by codepoint label when record counts are equal", () => {
  const snapshot = createCountFixture({
    observations: [
      {
        identity: baseIdentity,
        date: "2025-01-01",
        value: 10,
        quality: "Beta",
        qualifiers: ["Zeta", "Alpha"],
        stationTimeProperties: {},
        revision: 1,
        receivedAt: "2026-10-13T00:00:00.000000Z",
        firstReceivedAt: "2026-10-13T00:00:00.000000Z",
        contentHash: h,
        stationPropertiesHash: h,
        sourceResponseHash: h,
        sourceMetadataHash: h,
        versionHash: h,
      },
      {
        identity: baseIdentity,
        date: "2025-01-02",
        value: 20,
        quality: "Alpha",
        qualifiers: ["Beta"],
        stationTimeProperties: {},
        revision: 1,
        receivedAt: "2026-10-13T00:00:00.000000Z",
        firstReceivedAt: "2026-10-13T00:00:00.000000Z",
        contentHash: h,
        stationPropertiesHash: h,
        sourceResponseHash: h,
        sourceMetadataHash: h,
        versionHash: h,
      },
    ],
  });

  const summary = summarizeGaugeQuality(snapshot);
  // Both Beta and Alpha have 1 record; Alpha < Beta in codepoint sort
  assert.deepEqual(summary.approvalCounts, [
    { label: "Alpha", records: 1 },
    { label: "Beta", records: 1 },
  ]);
  // Alpha: 1, Beta: 1, Zeta: 1 -> sorted Alpha, Beta, Zeta
  assert.deepEqual(summary.flagCounts, [
    { label: "Alpha", records: 1 },
    { label: "Beta", records: 1 },
    { label: "Zeta", records: 1 },
  ]);
});

test("source and detached result mutation are independent", () => {
  const snapshot = createCountFixture({
    observations: [
      {
        identity: baseIdentity,
        date: "2025-01-01",
        value: 10,
        quality: "Approved",
        qualifiers: ["ESTIMATED"],
        stationTimeProperties: {},
        revision: 1,
        receivedAt: "2026-10-13T00:00:00.000000Z",
        firstReceivedAt: "2026-10-13T00:00:00.000000Z",
        contentHash: h,
        stationPropertiesHash: h,
        sourceResponseHash: h,
        sourceMetadataHash: h,
        versionHash: h,
      },
    ],
  });

  const snapshotBefore = JSON.stringify(snapshot);
  const summary = summarizeGaugeQuality(snapshot);

  // Mutating summary results does not mutate snapshot or vice versa
  summary.approvalCounts.push({ label: "Mutated", records: 99 });
  summary.flagCounts[0].records = 999;
  snapshot.observations[0].quality = "Altered";

  assert.equal(snapshotBefore, JSON.stringify(createCountFixture({
    observations: [
      {
        identity: baseIdentity,
        date: "2025-01-01",
        value: 10,
        quality: "Approved",
        qualifiers: ["ESTIMATED"],
        stationTimeProperties: {},
        revision: 1,
        receivedAt: "2026-10-13T00:00:00.000000Z",
        firstReceivedAt: "2026-10-13T00:00:00.000000Z",
        contentHash: h,
        stationPropertiesHash: h,
        sourceResponseHash: h,
        sourceMetadataHash: h,
        versionHash: h,
      },
    ],
  })));
});
