import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GaugeSourceQuality } from "../features/decisions/gauge-source-quality";
import type { GaugeQualitySummary } from "../lib/gauge-source-quality";

const summary: GaugeQualitySummary = {
  records: 1460, numericRecords: 1459, nullRecords: 1, missingDays: 5, qualifiedRecords: 151,
  approvalCounts: [{ label: "Approved", records: 1460 }],
  flagCounts: [{ label: "ESTIMATED", records: 144 }, { label: "FORCEINTERPOLATION", records: 7 }],
};

test("source profile keeps overlapping approval/flag totals and missing/null counts distinct", () => {
  // Descriptive render fixture, not newly captured data or scientific lineage.
  const html = renderToStaticMarkup(createElement(GaugeSourceQuality, { summary, basis: "file" }));
  assert.ok(html.includes("From the checked file"));
  assert.ok(html.includes("Snapshot records"));
  assert.ok(html.includes("Without numeric values"));
  assert.ok(html.includes("Calendar days without records"));
  assert.ok(html.includes("151") && html.includes("1,460"));
  assert.ok(html.includes("Approved") && html.includes("ESTIMATED") && html.includes("FORCEINTERPOLATION"));
  assert.ok(html.includes("A record can be approved and flagged"));
  assert.ok(html.includes("do not measure accuracy or establish forecast readiness"));
  assert.equal(html.includes("eligible records"), false);
});

test("label preview is capped but totals preserve all labels and raw text is escaped", () => {
  const labels = Array.from({ length: 12 }, (_, i) => ({ label: i === 0 ? "<img src=x onerror=alert(1)>" : `Raw flag ${i}`, records: 1 }));
  const html = renderToStaticMarkup(createElement(GaugeSourceQuality, { summary: { ...summary, flagCounts: labels }, basis: "embedded" }));
  assert.ok(html.includes("From the embedded receipt"));
  assert.ok(html.includes("Showing 8 of 12 distinct labels"));
  assert.ok(html.includes("Counts cover all records"));
  assert.ok(html.includes("&lt;img"));
  assert.equal(html.includes("<img src="), false);
  assert.equal(html.includes("Raw flag 8"), false);
  assert.equal(html.includes("overflow: auto"), false);
});

test("empty source profile states absence of recorded labels without inventing approval", () => {
  const html = renderToStaticMarkup(createElement(GaugeSourceQuality, { summary: { records: 0, numericRecords: 0, nullRecords: 0, missingDays: 3, qualifiedRecords: 0, approvalCounts: [], flagCounts: [] }, basis: "embedded" }));
  assert.ok(html.includes("No approval labels were recorded"));
  assert.ok(html.includes("No source flags were recorded"));
  assert.equal(html.includes("Unapproved"), false);
  assert.equal(html.includes("Safe"), false);
});
