import type { Assessment } from "@/lib/observatory-contract";
import { assessmentOverview } from "@/lib/assessment-insights";
export function AssessmentOverview({ assessment }: { assessment: Assessment }) {
  const view = assessmentOverview(assessment);
  return <section className="assessment-overview" aria-label="Assessment at a glance">
    <div className="decision-section-title"><div><span className="eyebrow">YOUR EVIDENCE / AT A GLANCE</span><h2>{assessment.outcome === "complete" ? "Evidence ready to explore" : assessment.outcome === "partial" ? "Useful evidence, with gaps" : "Evidence unavailable"}</h2></div><span className="outcome-tag">{assessment.outcome}</span></div>
    <p>{view.observed} observed or derived claims · {assessment.evidence.length} source records. Recorded period {assessment.time.start} → {assessment.time.end}.</p>
    <div className="overview-metrics">{view.metrics.map(m=><a key={m.id} href="#assessment-measurements"><span>{m.label}</span><span>{[...new Set(m.evidenceIds.flatMap(id=>{const e=assessment.evidence.find(e=>e.id===id);return [e?.timestamps.observedStart?.slice(0,10),e?.timestamps.observedEnd?.slice(0,10)].filter(Boolean)}))].sort().join(" → ") || "Observation date unspecified"}</span><strong>{m.value!.toLocaleString(undefined,{maximumSignificantDigits:6})}<small> {m.unit}</small></strong><span>{m.denominator ?? "Population defined in evidence"}</span></a>)}</div>
    <div className="quality-strip">{assessment.quality.map((q,i)=><a key={`${q.dimension}-${i}`} href="#assessment-quality" onClick={()=>{const disclosure=document.getElementById("assessment-quality");if(disclosure instanceof HTMLDetailsElement)disclosure.open=true;}} data-status={q.status}><span>{q.dimension}</span><strong>{q.status}</strong></a>)}</div>
    {view.limitations.length > 0 && <details><summary>{view.limitations.length} limits to check before interpreting</summary><ul>{view.limitations.map((q,i)=><li key={i}><strong>{q.dimension}:</strong> {q.message}</li>)}</ul></details>}
    <nav className="overview-links" aria-label="Explore assessment evidence"><a href="#assessment-brief">Read the brief</a><a href="#assessment-measurements">Inspect measurements</a><a href="#assessment-timeline">Explore dates</a></nav>
  </section>;
}
