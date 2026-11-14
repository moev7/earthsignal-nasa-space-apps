import type { Assessment, AssessmentRequest, Metric } from "./observatory-contract";

export function draftMatches(request: AssessmentRequest, result: Assessment): boolean {
  return request.domain === result.domain && request.question === result.question && request.start === result.time.start && request.end === result.time.end && JSON.stringify(request.area) === JSON.stringify(result.area);
}
/** Compare the source controls exposed by the workspace; source selection order is immaterial. */
export function sourceSettingsMatch(draft: AssessmentRequest["options"], recorded: AssessmentRequest["options"]): boolean {
  const sources = (options: AssessmentRequest["options"]) => [...new Set(options?.sourceIds ?? [])].sort();
  return (draft?.gaugeId ?? "") === (recorded?.gaugeId ?? "") && JSON.stringify(sources(draft)) === JSON.stringify(sources(recorded));
}

function semantics(result: Assessment, metric: Metric) {
  const records = metric.evidenceIds.map(id => result.evidence.find(e => e.id === id));
  if (!records.length || records.some(e => !e)) return null;
  return JSON.stringify(records.map(e => ({ source: e!.sourceId, version: e!.sourceVersion, quantity: e!.quantity, unit: e!.unit, support: e!.spatialSupport, mask: e!.maskPolicy, method: e!.methodVersion })).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
export function compareAssessments(reference: Assessment, current: Assessment) {
  const reasons: string[] = [];
  if (reference.domain !== current.domain || reference.question !== current.question) reasons.push("Choose the same domain and question.");
  if (JSON.stringify(reference.area) !== JSON.stringify(current.area)) reasons.push("Recorded area boundaries differ. Use the exact same boundary for a comparison.");
  if (reference.methodVersion !== current.methodVersion) reasons.push("Assessment methods differ.");
  if ([reference,current].some(r => r.outcome === "unavailable")) reasons.push("One assessment has unavailable evidence.");
  if ([reference,current].some(r => r.quality.some(q => q.dimension === "measurement" && ["withheld","unknown"].includes(q.status)))) reasons.push("Measurement quality is withheld or unknown.");
  if ([reference,current].some(r => r.quality.some(q => q.dimension === "coverage" && ["withheld","unknown"].includes(q.status)))) reasons.push("Coverage is withheld or unknown.");
  if ([reference,current].some(r => (r.rasters ?? []).some(v => v.commonCoveragePercent < 80) || r.evidence.some(e => e.quality.commonCoveragePercent !== null && e.quality.commonCoveragePercent < 80))) reasons.push("Common valid coverage is below the 80% interpretation gate.");
  if ([reference,current].some(r => ["measurement","coverage"].some(d => !r.quality.some(q => q.dimension === d)))) reasons.push("Recorded measurement or coverage quality is missing.");
  const rows = current.metrics.map(metric => {
    const before = reference.metrics.find(m => m.id === metric.id);
    let reason: string | null = null;
    if (!before) reason = "No matching quantity in reference.";
    else if (metric.value === null || before.value === null) reason = "A measured value is missing.";
    else if (metric.unit !== before.unit || metric.denominator !== before.denominator || metric.description !== before.description) reason = "Units, population or measurement definition differ.";
    else if (!semantics(current,metric) || semantics(current,metric) !== semantics(reference,before)) reason = "Source version, quantity, spatial support or mask method differs.";
    else if (reasons.length) reason = "Assessment compatibility checks did not pass.";
    const delta = !reason && before && before.value !== null && metric.value !== null ? metric.value - before.value : null;
    return { id: metric.id, label: metric.label, unit: metric.unit, reference: before?.value ?? null, current: metric.value, delta: delta !== null && Number.isFinite(delta) ? delta : null, reason, evidenceIds: { reference: before?.evidenceIds ?? [], current: metric.evidenceIds } };
  });
  return { reasons, rows, comparable: rows.some(r => r.delta !== null) };
}
export function assessmentOverview(result: Assessment) {
  return {
    metrics: result.metrics.filter(m => m.value !== null && m.evidenceIds.length && m.evidenceIds.every(id => result.evidence.some(e => e.id === id))).slice(0,3),
    observed: result.claims.filter(c => c.type === "Observed" || c.type === "Derived").length,
    limitations: result.quality.filter(q => q.status !== "supported"),
    dates: [...new Set(result.evidence.flatMap(e => [e.timestamps.observedStart?.slice(0,10), e.timestamps.observedEnd?.slice(0,10)]).filter((d): d is string => Boolean(d)))].sort(),
  };
}
