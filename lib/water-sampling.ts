import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().min(0).max(2000);
const fraction = z.number().finite().min(0).max(1).nullable();
const text = z.string().min(1).max(1024);
const utc = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/)
  .refine(s => Number(s.slice(0, 4)) >= 1 && Number.isFinite(Date.parse(s)) &&
    new Date(Date.parse(s)).toISOString().slice(0, 19) === s.slice(0, 19), "Invalid UTC date");
const counts = z.object({ attempted: count, observable: count, water: count, dry: count, unknown: count }).strict();
const observation = z.object({
  siteId: text, supportId: text, quantityId: text, classificationMethodId: text,
  sourceId: text, evidenceIds: z.array(text).min(1).max(32),
  acquisitionTime: utc, state: z.enum(["water", "dry", "unknown"]),
  visibility: z.enum(["observable", "unobservable"]), visibilityReason: text,
}).strict();
const year = z.number().int().min(1).max(9999);
const view = z.object({
  counts, observableUnknown: count,
  selectedSourceIds: z.array(text).max(2000), excludedSourceIds: z.array(text).max(2000),
  yearSummaries: z.array(z.object({
    year, counts, waterFraction: fraction, firstAcquisition: utc.nullable(),
    lastAcquisition: utc.nullable(), sourceIds: z.array(text).max(2000),
  }).strict()).max(200),
  pooledWaterFraction: fraction, equalYearWaterFraction: fraction,
  withheldYears: z.array(year).max(200),
}).strict();
const delta = z.object({
  pooledWaterFractionDelta: z.number().finite().min(-1).max(1).nullable(),
  equalYearWaterFractionDelta: z.number().finite().min(-1).max(1).nullable(),
}).strict();
const artifactSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("water-sampling-sensitivity"),
  sourceFileSha256: hash, artifactHash: hash,
  summary: z.object({
    methodVersion: z.literal("water-sampling-sensitivity-v1"), status: z.literal("descriptive"),
    inputHash: hash, optionsHash: hash,
    options: z.object({
      months: z.array(z.number().int().min(1).max(12)).min(1).max(12),
      exclude: z.object({ start: utc, end: utc }).strict().nullable(),
      timeBasis: z.literal("UTC"), interval: z.literal("[start,end)"),
    }).strict(),
    history: z.object({
      methodVersion: z.literal("recorded-water-history-v1"), status: z.literal("descriptive"),
      inputHash: hash, counts, observations: z.array(observation).max(2000),
      waterFractionAmongObservableAcquisitions: fraction,
    }).passthrough(),
    yearPopulation: z.array(year).max(200),
    views: z.object({ all: view, season: view, withoutBlock: view }).strict(),
    differences: z.object({ seasonVsAll: delta, withoutBlockVsSeason: delta }).strict(),
    exclusion: z.object({ matchedSourceIds: z.array(text).max(2000) }).strict(),
    limitations: z.array(z.string()).min(1).max(30),
  }).strict(),
}).strict();
export type WaterSamplingArtifact = z.infer<typeof artifactSchema>;
export type WaterSamplingObservation = z.infer<typeof observation>;
export type WaterSamplingView = z.infer<typeof view>;
export type WaterSamplingViewName = "all" | "season" | "withoutBlock";

// Compare normalized instants without rounding microseconds at the browser boundary.
function instant(s: string) { return s.slice(0, 19) + (s.includes(".") ? s.slice(20, -1) : "").padEnd(6, "0"); }
function same(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error("The recorded sampling result does not reconcile."); }
function near(a: number | null, b: number | null) {
  if (a === null || b === null) { if (a !== b) throw Error("An unavailable quantity must remain unavailable."); }
  else if (Math.abs(a - b) > 1e-12) throw Error("The recorded sampling arithmetic does not reconcile.");
}
function tally(rows: WaterSamplingObservation[]) {
  return { attempted: rows.length, observable: rows.filter(r => r.visibility === "observable").length,
    water: rows.filter(r => r.state === "water").length, dry: rows.filter(r => r.state === "dry").length,
    unknown: rows.filter(r => r.state === "unknown").length };
}

/** Display only the pinned, synthetic fixtures. This is not an upload API or field verification. */
export function checkedWaterSampling(value: unknown): WaterSamplingArtifact {
  const artifact = artifactSchema.parse(value), s = artifact.summary, rows = s.history.observations;
  const identity = ["siteId", "supportId", "quantityId", "classificationMethodId"] as const;
  const ids = rows.map(r => r.sourceId);
  if (new Set(ids).size !== ids.length) throw Error("Duplicate visit identity.");
  for (let i = 0; i < rows.length; i++) {
    if (i && instant(rows[i].acquisitionTime) <= instant(rows[i - 1].acquisitionTime)) throw Error("Visits must be strictly ordered.");
    if (rows[i].state !== "unknown" && rows[i].visibility !== "observable") throw Error("A definite label needs observable evidence.");
    if (new Set(rows[i].evidenceIds).size !== rows[i].evidenceIds.length) throw Error("Duplicate evidence.");
    for (const key of identity) if (rows[i][key] !== rows[0][key]) throw Error("Recorded support or method changed.");
  }
  same(s.history.counts, tally(rows)); same(s.inputHash, s.history.inputHash);
  near(s.history.waterFractionAmongObservableAcquisitions, s.history.counts.observable ? s.history.counts.water / s.history.counts.observable : null);
  const first = rows.length ? Number(rows[0].acquisitionTime.slice(0, 4)) : 0;
  const last = rows.length ? Number(rows[rows.length - 1].acquisitionTime.slice(0, 4)) : 0;
  if (rows.length && last - first + 1 > 200) throw Error("Recorded span is too large.");
  const years = rows.length ? Array.from({ length: last - first + 1 }, (_, i) => first + i) : [];
  same(s.yearPopulation, years);
  const months = s.options.months;
  if (months.some((m, i) => i > 0 && m <= months[i - 1])) throw Error("Month selection must be distinct and ordered.");
  const block = s.options.exclude;
  if (block && instant(block.start) >= instant(block.end)) throw Error("Empty or reversed date block.");
  const inSeason = (r: WaterSamplingObservation) => months.includes(Number(r.acquisitionTime.slice(5, 7)));
  const inBlock = (r: WaterSamplingObservation) => !!block && instant(r.acquisitionTime) >= instant(block.start) && instant(r.acquisitionTime) < instant(block.end);
  for (const name of ["all", "season", "withoutBlock"] as const) {
    const v = s.views[name];
    const selected = rows.filter(r => name === "all" || (inSeason(r) && (name !== "withoutBlock" || !inBlock(r))));
    const selectedIds = selected.map(r => r.sourceId);
    same(v.selectedSourceIds, selectedIds);
    same(v.excludedSourceIds, rows.filter(r => !selectedIds.includes(r.sourceId)).map(r => r.sourceId));
    const expected = tally(selected);
    same(v.counts, expected); same(v.observableUnknown, expected.observable - expected.water - expected.dry);
    near(v.pooledWaterFraction, expected.observable ? expected.water / expected.observable : null);
    same(v.yearSummaries.map(y => y.year), years);
    for (const y of v.yearSummaries) {
      const yr = selected.filter(r => Number(r.acquisitionTime.slice(0, 4)) === y.year), c = tally(yr);
      same(y.counts, c); same(y.sourceIds, yr.map(r => r.sourceId));
      same(y.firstAcquisition, yr[0]?.acquisitionTime ?? null);
      same(y.lastAcquisition, yr[yr.length - 1]?.acquisitionTime ?? null);
      near(y.waterFraction, c.observable ? c.water / c.observable : null);
    }
    const missing = v.yearSummaries.filter(y => y.waterFraction === null).map(y => y.year);
    same(v.withheldYears, missing);
    near(v.equalYearWaterFraction, years.length && !missing.length ?
      v.yearSummaries.reduce((sum, y) => sum + y.waterFraction!, 0) / years.length : null);
  }
  same(s.exclusion.matchedSourceIds, rows.filter(r => inSeason(r) && inBlock(r)).map(r => r.sourceId));
  for (const [name, left, right] of [
    ["seasonVsAll", "season", "all"], ["withoutBlockVsSeason", "withoutBlock", "season"],
  ] as const) {
    for (const [key, result] of [["pooledWaterFraction", "pooledWaterFractionDelta"], ["equalYearWaterFraction", "equalYearWaterFractionDelta"]] as const) {
      const a = s.views[left][key], b = s.views[right][key];
      near(s.differences[name][result], a === null || b === null ? null : a - b);
    }
  }
  return artifact;
}

export function describeWaterSampling(v: WaterSamplingView) {
  if (!v.counts.observable) return "None of these recorded visits could show the place clearly enough. Water presence stays unknown.";
  const unknown = v.observableUnknown;
  return "Water was recorded on " + v.counts.water + " of " + v.counts.observable +
    " recorded visits where the place could be seen." + (unknown ? " " + unknown + " of those views still had an unclear label; they stay in the total." : "") +
    " This counts recorded views, not how many days water was present.";
}

/** A broken learning fixture must not break the surrounding scientific workspace. */
export function readWaterSamplingExample(text: string): WaterSamplingArtifact | null {
  try { return checkedWaterSampling(JSON.parse(text)); } catch { return null; }
}

export function describeWaterVisit(record: WaterSamplingObservation, included: boolean) {
  if (record.visibility === "unobservable")
    return "The place could not be observed on this recorded visit. It remains unknown and does not enter the observable-view total.";
  if (record.state === "unknown")
    return "The place was visible, but its label was unclear. " + (included ?
      "This visit stays in the observable total and is not counted as water or non-water." :
      "This date comparison excludes the visit, so it is not in the observable total. Its original unclear record is preserved.");
  return "This is one recorded classification at one time. It does not tell us how long that condition lasted.";
}
