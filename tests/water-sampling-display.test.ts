import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { checkedWaterSampling, describeWaterSampling, describeWaterVisit, readWaterSamplingExample } from "../lib/water-sampling";
import { WATER_SAMPLING_DEMOS } from "../lib/water-sampling-demo.generated";
import { WaterSamplingDemo } from "../features/science/water-sampling-demo";

const raw = (index = 0) => JSON.parse(WATER_SAMPLING_DEMOS[index].resultText);
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
test("bundled examples preserve exact input/result pins and reproduce with the native method", () => {
  for (const demo of WATER_SAMPLING_DEMOS) {
    assert.equal(digest(demo.inputText), demo.inputSha256);
    assert.equal(digest(demo.resultText), demo.resultSha256);
    assert.equal(readFileSync("examples/water-sampling-demo/" + demo.id + "-result.json", "utf8"), demo.resultText);
    const native = JSON.parse(execFileSync("python3", ["-c",
      "import json,sys; from service.observatory.water_sampling import analyze_water_sampling; v=json.load(sys.stdin); print(json.dumps(analyze_water_sampling(v['observations'], **v['options'])))"],
      { input: demo.inputText, encoding: "utf8" }));
    assert.deepEqual(checkedWaterSampling(JSON.parse(demo.resultText)).summary, native);
  }
});
test("uneven visits yield different estimands without turning fractions into duration", () => {
  const s = checkedWaterSampling(raw()).summary;
  assert.equal(s.views.all.pooledWaterFraction, 1 / 13);
  assert.equal(s.views.all.equalYearWaterFraction, .5);
  assert.equal(s.views.withoutBlock.pooledWaterFraction, .2);
  assert.equal(s.views.withoutBlock.equalYearWaterFraction, .5);
  assert.equal(s.exclusion.matchedSourceIds.length, 8);
  assert.match(describeWaterSampling(s.views.all), /1 of 13/);
  assert.match(describeWaterSampling(s.views.all), /not how many days/);
});
test("observable ambiguous labels stay in the denominator and missing years stay withheld", () => {
  const s = checkedWaterSampling(raw(1)).summary;
  assert.equal(s.views.all.counts.observable, 3);
  assert.equal(s.views.all.observableUnknown, 1);
  assert.equal(s.views.all.pooledWaterFraction, 1 / 3);
  assert.equal(s.views.all.equalYearWaterFraction, .25);
  assert.equal(s.views.withoutBlock.equalYearWaterFraction, null);
  assert.deepEqual(s.views.withoutBlock.withheldYears, [2024]);
  assert.match(describeWaterSampling(s.views.all), /unclear label; they stay in the total/);
  const missing = checkedWaterSampling(raw(2)).summary;
  assert.deepEqual(missing.yearPopulation, [2024, 2025, 2026]);
  assert.equal(missing.views.all.equalYearWaterFraction, null);
  assert.deepEqual(missing.views.all.withheldYears, [2025]);
});
test("altered source partitions, counts, fractions, year populations and promoted claims are withheld", () => {
  const alterations = [
    (a: ReturnType<typeof raw>) => { a.summary.views.all.counts.observable--; },
    (a: ReturnType<typeof raw>) => { a.summary.views.all.pooledWaterFraction = .5; },
    (a: ReturnType<typeof raw>) => { a.summary.views.all.equalYearWaterFraction = 1 / 13; },
    (a: ReturnType<typeof raw>) => { a.summary.views.withoutBlock.excludedSourceIds = []; },
    (a: ReturnType<typeof raw>) => { a.summary.views.season.yearSummaries[0].sourceIds = []; },
    (a: ReturnType<typeof raw>) => { a.summary.yearPopulation = [2025]; },
    (a: ReturnType<typeof raw>) => { a.summary.options.exclude.end = a.summary.options.exclude.start; },
    (a: ReturnType<typeof raw>) => { a.summary.differences.withoutBlockVsSeason.pooledWaterFractionDelta = 0; },
    (a: ReturnType<typeof raw>) => { a.summary.exclusion.matchedSourceIds = []; },
    (a: ReturnType<typeof raw>) => { a.summary.scientificallyValidated = true; },
  ];
  for (const alter of alterations) { const a = raw(); alter(a); assert.throws(() => checkedWaterSampling(a)); }
});
test("a missing calendar year cannot be silently omitted or assigned a zero fraction", () => {
  for (const change of [
    (a: ReturnType<typeof raw>) => { a.summary.views.all.withheldYears = []; },
    (a: ReturnType<typeof raw>) => { a.summary.views.all.equalYearWaterFraction = .5; },
    (a: ReturnType<typeof raw>) => { a.summary.views.all.yearSummaries[1].waterFraction = 0; },
  ]) { const a = raw(2); change(a); assert.throws(() => checkedWaterSampling(a)); }
});
test("display rejects duplicated visits, invalid dates, shifted identities and hidden visibility", () => {
  for (const change of [
    (a: ReturnType<typeof raw>) => { a.summary.history.observations[1].sourceId = a.summary.history.observations[0].sourceId; },
    (a: ReturnType<typeof raw>) => { a.summary.history.observations[1].acquisitionTime = "2025-02-30T00:00:00Z"; },
    (a: ReturnType<typeof raw>) => { a.summary.history.observations[1].supportId = "different-mask"; },
    (a: ReturnType<typeof raw>) => { a.summary.history.observations[1].visibility = "unobservable"; },
  ]) { const a = raw(); change(a); assert.throws(() => checkedWaterSampling(a)); }
});
test("tutorial shows traceable visits first, with weighting details and synthetic boundaries", () => {
  const html = renderToStaticMarkup(React.createElement(WaterSamplingDemo));
  for (const phrase of ["Made-up examples", "not Lake Mead measurements", "What the visits tell us",
    "1 of 13", "7.69%", "50%", "2024-04-01 UTC", "2025-04-12 UTC", "365 days",
    "not the JRC occurrence or recurrence product", "Full native result JSON"]) assert.ok(html.includes(phrase), phrase);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /Every supplied visit, in date order/);
  assert.match(html, /What happened between them is unresolved/);
});
test("selected date comparison preserves excluded original visits and withheld years", () => {
  const html = renderToStaticMarkup(React.createElement(WaterSamplingDemo, { initialCase: 1, initialView: "withoutBlock" }));
  assert.match(html, /0 of 1/);
  assert.match(html, /Excluded from this comparison/);
  assert.match(html, /no observable visits remain in 2024/);
  assert.match(html, /Those years have not been quietly removed/);
  assert.match(html, /Unclear label/);
  assert.match(html, /Could not observe/);
});
test("tutorial source has no upload, account, assistant or network request", () => {
  const source = readFileSync("features/science/water-sampling-demo.tsx", "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|localStorage|\/api\/assistant|type="file"|dangerouslySetInnerHTML/);
});
test("an unavailable tutorial withholds its claims without replacing the scientific workspace", () => {
  const html = renderToStaticMarkup(React.createElement(WaterSamplingDemo, { initialCase: 99 }));
  assert.match(html, /could not be checked/);
  assert.match(html, /historical gauge readings and other scientific tools remain available/);
  assert.doesNotMatch(html, /7.69%|50%|What the visits tell us/);
});
test("malformed learning fixtures produce an unavailable result rather than plausible findings", () => {
  assert.equal(readWaterSamplingExample("{"), null);
  const altered = raw(); altered.summary.views.all.pooledWaterFraction = .9;
  assert.equal(readWaterSamplingExample(JSON.stringify(altered)), null);
  assert.equal(readWaterSamplingExample(WATER_SAMPLING_DEMOS[0].resultText)!.summary.views.all.pooledWaterFraction, 1 / 13);
});
test("the display preserves native microsecond ordering and a half-open exclusion boundary", () => {
  const input = JSON.parse(WATER_SAMPLING_DEMOS[0].inputText);
  input.observations = input.observations.slice(0, 3);
  input.observations.forEach((r: { acquisitionTime: string }, i: number) => {
    r.acquisitionTime = "2025-04-01T00:00:00.00000" + (i + 1) + "Z";
  });
  input.options.exclude = { start: input.observations[1].acquisitionTime, end: input.observations[2].acquisitionTime };
  const artifact = JSON.parse(execFileSync("python3", ["-c",
    "import json,sys,hashlib; from service.observatory.water_sampling import analyze_water_sampling; from service.observatory.vintages import canonical_hash; raw=sys.stdin.buffer.read(); v=json.loads(raw); a=dict(schemaVersion=1,kind='water-sampling-sensitivity',sourceFileSha256=hashlib.sha256(raw).hexdigest(),summary=analyze_water_sampling(v['observations'], **v['options'])); a['artifactHash']=canonical_hash(a); print(json.dumps(a))"],
    { input: JSON.stringify(input), encoding: "utf8" }));
  const s = checkedWaterSampling(artifact).summary;
  assert.deepEqual(s.exclusion.matchedSourceIds, [input.observations[1].sourceId]);
  assert.deepEqual(s.views.withoutBlock.selectedSourceIds, [input.observations[0].sourceId, input.observations[2].sourceId]);
  assert.equal(s.views.withoutBlock.pooledWaterFraction, .5);
});
test("an excluded ambiguous visit is not described as remaining in the current denominator", () => {
  const row = checkedWaterSampling(raw(1)).summary.history.observations[1];
  assert.match(describeWaterVisit(row, true), /stays in the observable total/);
  assert.match(describeWaterVisit(row, false), /not in the observable total/);
  assert.doesNotMatch(describeWaterVisit(row, false), /stays in the observable total/);
  assert.match(describeWaterVisit(row, false), /original unclear record is preserved/);
});
