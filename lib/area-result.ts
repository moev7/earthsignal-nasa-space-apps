export type AreaCategory = { id: string; proportion: number | null; areaM2: number | null; proportionSamplingSE: number | null; areaSamplingSE_M2: number | null };
export type AreaResult = {
  schemaVersion: 1; kind: "stratified-area-experiment-result"; private: true;
  evidenceKind: "synthetic-software-check" | "declared-reference-experiment";
  inputFileSha256: string; plainLanguage: string;
  scientificallyValidated: false; fieldTruthEstablished: false; mapAccuracyEstimated: false;
  referenceErrorQuantified: false; publicDecisionAuthority: false;
  context: { studyId: string; stage: string; referenceQuality: string; outcomesFrozenAt: string; sourceEvidence: { id: string; observedAt: string; sha256: string }[] };
  calculation: {
    methodVersion: string; experimental: true; conditionalOnDeclaredDesignAndOutcomes: true;
    N: number; n: number; nominalFrameAreaM2: number; pointEstimateStatus: "available" | "withheld";
    samplingVarianceStatus: "estimable" | "non-estimable" | "withheld";
    counts: { total: number; known: number; unknown: number; knownLabelCounts: Record<string, number> };
    classes: AreaCategory[]; classOrder: string[];
    responseTarget: { definition: string }; pointWithholdingReasons: string[];
    strata: { id: string; N: number; n: number; weight: number; counts: { total: number; known: number; unknown: number; knownLabelCounts: Record<string, number> } }[];
    confidenceIntervalsProvided: false; fieldTruthEstablished: false; referenceErrorQuantified: false; mapAccuracyEstimated: false;
  };
};

/** Display gate. The service independently reproduces the full native artifact. */
export function checkedAreaResult(value: unknown): AreaResult {
  // Standalone by design: the same compiled function is embedded in the protected document.
  const v = value as AreaResult;
  const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  const count = (x: unknown): x is number => finite(x) && Number.isInteger(x) && x >= 0;
  const text = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 4096;
  const refuse = (): never => { throw Error("The result could not be verified for display. Download the inputs and contact the operator."); };
  if (!v || v.schemaVersion !== 1 || v.kind !== "stratified-area-experiment-result" || v.private !== true ||
    !["synthetic-software-check", "declared-reference-experiment"].includes(v.evidenceKind) ||
    !/^[a-f0-9]{64}$/.test(v.inputFileSha256 ?? "") || !text(v.plainLanguage) ||
    [v.scientificallyValidated, v.fieldTruthEstablished, v.mapAccuracyEstimated, v.referenceErrorQuantified, v.publicDecisionAuthority].some(x => x !== false)) refuse();
  const c = v.calculation;
  if (!c || c.methodVersion !== "stratified-srswor-equal-area-v1" || c.experimental !== true || c.conditionalOnDeclaredDesignAndOutcomes !== true ||
    [c.fieldTruthEstablished, c.mapAccuracyEstimated, c.referenceErrorQuantified, c.confidenceIntervalsProvided].some(x => x !== false) ||
    !count(c.N) || c.N < 1 || c.N > 1000000 || !count(c.n) || c.n > 320 || !finite(c.nominalFrameAreaM2) || c.nominalFrameAreaM2 <= 0 ||
    !["available", "withheld"].includes(c.pointEstimateStatus) || !["estimable", "non-estimable", "withheld"].includes(c.samplingVarianceStatus) ||
    !c.counts || !count(c.counts.known) || !count(c.counts.unknown) || c.counts.total !== c.n || c.counts.known + c.counts.unknown !== c.n ||
    !Array.isArray(c.classes) || c.classes.length < 1 || c.classes.length > 8 || !Array.isArray(c.classOrder) ||
    !Array.isArray(c.pointWithholdingReasons) || !text(c.responseTarget?.definition) || !Array.isArray(c.strata) || c.strata.length < 1 || c.strata.length > 64) refuse();
  if ((c.counts.unknown > 0 && c.pointEstimateStatus !== "withheld") || (c.pointEstimateStatus === "withheld" && c.samplingVarianceStatus !== "withheld")) refuse();
  const ids = c.classes.map(k => k.id);
  if (new Set(ids).size !== ids.length || JSON.stringify(ids) !== JSON.stringify(c.classOrder)) refuse();
  for (const k of c.classes) {
    if (!text(k.id)) refuse();
    if (c.pointEstimateStatus === "withheld") { if (k.proportion !== null || k.areaM2 !== null) refuse(); }
    else if (!finite(k.proportion) || k.proportion < 0 || k.proportion > 1 || !finite(k.areaM2) || k.areaM2 < 0 ||
      Math.abs(k.areaM2 - k.proportion * c.nominalFrameAreaM2) > 1e-10 * Math.max(1, k.areaM2)) refuse();
    if (c.samplingVarianceStatus === "estimable") {
      if (!finite(k.proportionSamplingSE) || !finite(k.areaSamplingSE_M2) || k.proportionSamplingSE < 0 || k.areaSamplingSE_M2 < 0 ||
        Math.abs(k.areaSamplingSE_M2 - k.proportionSamplingSE * c.nominalFrameAreaM2) > 1e-10 * Math.max(1e-300, k.areaSamplingSE_M2, k.proportionSamplingSE * c.nominalFrameAreaM2)) refuse();
    } else if (k.proportionSamplingSE !== null || k.areaSamplingSE_M2 !== null) refuse();
  }
  if (c.pointEstimateStatus === "available" && Math.abs(c.classes.reduce((s, k) => s + k.proportion!, 0) - 1) > 1e-10) refuse();
  if (!v.context || !text(v.context.studyId) || !["development", "evaluation"].includes(v.context.stage) ||
    !["unverified", "externally-reviewed"].includes(v.context.referenceQuality) || !text(v.context.outcomesFrozenAt) ||
    !Array.isArray(v.context.sourceEvidence) || v.context.sourceEvidence.length < 1 || v.context.sourceEvidence.length > 16) refuse();
  for (const source of v.context.sourceEvidence) if (!text(source.id) || !text(source.observedAt) || !/^[a-f0-9]{64}$/.test(source.sha256)) refuse();
  for (const s of c.strata) {
    if (!text(s.id) || !count(s.N) || !count(s.n) || s.n > s.N || !finite(s.weight) || s.weight < 0 || s.weight > 1 || !s.counts?.knownLabelCounts ||
      Math.abs(s.weight - s.N / c.N) > 1e-12 || s.counts.total !== s.n || !count(s.counts.known) || !count(s.counts.unknown) || s.counts.known + s.counts.unknown !== s.n) refuse();
    if (c.pointEstimateStatus === "available" && (s.counts.unknown > 0 || (s.N > 0 && s.n === 0))) refuse();
    if (c.samplingVarianceStatus === "estimable" && s.n === 1 && s.N > 1) refuse();
  }
  if (c.strata.reduce((n, s) => n + s.N, 0) !== c.N || c.strata.reduce((n, s) => n + s.n, 0) !== c.n ||
    c.strata.reduce((n, s) => n + s.counts.unknown, 0) !== c.counts.unknown) refuse();
  return v;
}
