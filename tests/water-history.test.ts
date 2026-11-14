import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeHistory, chartHistory, historySchema } from "../lib/water-history";
const data = (n: number, value: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), value: value(i) }));
test("chronological backtest and forecast recover a known linear signal", () => {
  const p = data(400, i => 100 + i * 0.1), a = analyzeHistory(p, p.at(-1)!.date);
  assert.equal(a.status, "ready"); assert.equal(a.validation.length, 84);
  assert.ok(a.metrics!.modelMae < 1e-10); assert.ok(a.metrics!.baselineMae > 0.3);
  assert.ok(Math.abs(a.forecast[6].predicted - 140.6) < 1e-9);
});
test("future observations cannot change model selection, intervals or fitted values", () => {
  const p = data(420, i => 100 + i * .1), cutoff = p[399].date;
  const before = analyzeHistory(p, cutoff);
  const altered = p.map((v, i) => i > 399 ? { ...v, value: -1e6 } : v);
  assert.deepEqual(analyzeHistory(altered, cutoff), before);
});
test("short histories, gaps, duplicates, unobserved dates and no skill withhold prediction", () => {
  const p = data(400, i => 100 + i * .1), last = p.at(-1)!.date;
  for (const input of [p.slice(-100), p.filter((_, i) => i !== 300), [...p, p[300]], data(400, () => 100)]) assert.equal(analyzeHistory(input, last).status, "withheld");
  assert.equal(analyzeHistory(p, "2022-01-01").status, "withheld");
});
test("pinned history is sorted unique observed data and chart reduction retains extrema", () => {
  const h = historySchema.parse(JSON.parse(readFileSync('public/data/water-history.json','utf8')));
  assert.ok(h.points.length > 10000); assert.equal(h.source.blobSha, "f1839d5db7628b2be521175e982c9468e68fa226");
  assert.ok(h.points.every((p, i) => !i || p.date > h.points[i-1].date));
  const sampled = chartHistory(h.points);
  assert.equal(Math.min(...sampled.map(p=>p.value)), Math.min(...h.points.map(p=>p.value)));
  assert.equal(Math.max(...sampled.map(p=>p.value)), Math.max(...h.points.map(p=>p.value)));
});
