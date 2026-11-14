"use client";
import { useState } from "react";
import { ArrowDownToLine, Droplets, EyeOff, CircleHelp, Minus } from "lucide-react";
import { WATER_SAMPLING_DEMOS } from "@/lib/water-sampling-demo.generated";
import { readWaterSamplingExample, describeWaterSampling, describeWaterVisit, type WaterSamplingObservation, type WaterSamplingViewName } from "@/lib/water-sampling";

const examples = WATER_SAMPLING_DEMOS.map(demo => ({ ...demo, artifact: readWaterSamplingExample(demo.resultText) }));
const percent = (n: number | null) => n === null ? "Unavailable" : (n * 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "%";
const date = (s: string) => s.slice(0, 10) + " UTC";
function label(r: WaterSamplingObservation) {
  return r.visibility === "unobservable" ? "Could not observe" : r.state === "unknown" ? "Unclear label" :
    r.state === "water" ? "Water recorded" : "Non-water recorded";
}
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Public, made-up learning examples. Never receives a user's area, results or files. */
export function WaterSamplingDemo({ initialCase = 0, initialView = "all" }: { initialCase?: number; initialView?: WaterSamplingViewName }) {
  const [caseIndex, setCaseIndex] = useState(initialCase);
  const [viewName, setViewName] = useState<WaterSamplingViewName>(initialView);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const demo = examples[caseIndex];
  if (!demo?.artifact) return <details className="water-sampling-demo">
    <summary>Why satellite observation dates matter — try an example</summary>
    <p role="alert">This learning example could not be checked. Its findings are withheld; the historical gauge readings and other scientific tools remain available.</p>
  </details>;
  const s = demo.artifact.summary, view = s.views[viewName];
  const rows = s.history.observations, selected = rows.find(r => r.sourceId === selectedId) ?? rows[0];
  const block = s.options.exclude;
  function chooseCase(index: number) { setCaseIndex(index); setViewName("all"); setSelectedId(null); }
  return <details className="water-sampling-demo">
    <summary>Why satellite observation dates matter — try an example</summary>
    <div className="water-sampling-content">
      <h3>Images are visits, not continuous watching</h3>
      <p className="water-sampling-notice"><strong>Made-up examples.</strong> These fictional records describe one map cell. They are not Lake Mead measurements, satellite detections or forecasts. The gauge chart above measures water-surface elevation, a different quantity.</p>
      <div className="water-sampling-cases" role="group" aria-label="Choose a made-up example">
        {examples.map((e, i) => <button key={e.id} type="button" aria-pressed={i === caseIndex} onClick={() => chooseCase(i)}>{e.title}</button>)}
      </div>
      <p>{demo.description} Click a date to inspect exactly what was recorded.</p>
      <section aria-label="The observation count, explained" className="water-sampling-reading">
        <h4>What the visits tell us</h4><p role="status">{describeWaterSampling(view)}</p>
        <p>{view.counts.unknown} of {view.counts.attempted} included visits have an unknown classification; {view.counts.attempted - view.counts.observable} could not be observed. Unknown does not mean dry.</p>
      </section>
      <ol className="water-sampling-visits" aria-label="Every supplied visit, in date order">
        {rows.map((r, i) => {
          const included = view.selectedSourceIds.includes(r.sourceId);
          const Icon = r.visibility === "unobservable" ? EyeOff : r.state === "unknown" ? CircleHelp : r.state === "water" ? Droplets : Minus;
          const gap = i ? (Date.parse(r.acquisitionTime) - Date.parse(rows[i - 1].acquisitionTime)) / 86400000 : 0;
          return <li key={r.sourceId}>
            {gap > 1 && <p className="water-sampling-gap">{gap.toLocaleString()} days between these recorded visits. What happened between them is unresolved.</p>}
            <button type="button" className={"water-sampling-visit state-" + r.state + (included ? "" : " excluded")} aria-pressed={selected?.sourceId === r.sourceId} onClick={() => setSelectedId(r.sourceId)}>
              <span className="water-sampling-date">{date(r.acquisitionTime)}</span>
              <span><Icon size={15} aria-hidden="true"/>{label(r)}</span>
              {!included && <small>Excluded from this comparison</small>}
            </button>
          </li>;
        })}
      </ol>
      {selected && <div className="water-sampling-selected" aria-live="polite">
        <h4>{date(selected.acquisitionTime)} · {label(selected)}</h4>
        <p>{describeWaterVisit(selected, view.selectedSourceIds.includes(selected.sourceId))}</p>
        <p>{view.selectedSourceIds.includes(selected.sourceId) ? "Included in this comparison." : "Excluded by the selected date comparison; the original record is still preserved."}</p>
        <details><summary>Inspect this record</summary><dl>
          <dt>Full recorded time</dt><dd>{selected.acquisitionTime}</dd>
          <dt>Source identity</dt><dd>{selected.sourceId}</dd>
          <dt>Visibility reason</dt><dd>{selected.visibilityReason}</dd>
          <dt>Evidence</dt><dd>{selected.evidenceIds.join(", ")}</dd>
          <dt>Classification method</dt><dd>{selected.classificationMethodId}</dd>
          <dt>Recorded spatial support</dt><dd>{selected.supportId}</dd>
          <dt>Class definition identity</dt><dd>{selected.quantityId}</dd>
        </dl><p>These are supplied identities, not independent verification of geometry, masks, labels or environmental conditions.</p></details>
      </div>}
      <details className="water-sampling-analysis">
        <summary>How does the summary depend on when we looked?</summary>
        <p>Try leaving out the marked dates. This changes which records enter the calculation; it does not change what happened in the fictional place.</p>
        <div className="water-sampling-cases" role="group" aria-label="Choose date comparison">
          <button type="button" aria-pressed={viewName === "all"} onClick={() => setViewName("all")}>All recorded visits</button>
          <button type="button" aria-pressed={viewName === "season"} onClick={() => setViewName("season")}>Chosen months only</button>
          <button type="button" disabled={!block} aria-pressed={viewName === "withoutBlock"} onClick={() => setViewName("withoutBlock")}>Leave out marked dates</button>
        </div>
        <p>Chosen UTC months: {s.options.months.join(", ")}. {block ? "Marked interval: " + block.start + " up to, but not including, " + block.end + "." : "This example has no marked interval."}</p>
        <div className="water-sampling-table"><table><caption>Two different ways to summarize the same included visits</caption><thead><tr><th>Summary</th><th>Value</th><th>What gets equal weight</th></tr></thead><tbody>
          <tr><th scope="row">Every observable visit</th><td>{percent(view.pooledWaterFraction)}</td><td>Each observable visit, including unclear labels</td></tr>
          <tr><th scope="row">Every calendar year</th><td>{percent(view.equalYearWaterFraction)}</td><td>Each year’s water-detection fraction</td></tr>
        </tbody></table></div>
        <p>{view.withheldYears.length ? "The equal-year value is unavailable: no observable visits remain in " + view.withheldYears.join(", ") + ". Those years have not been quietly removed." :
          "Giving years equal weight asks a different question. It does not correct all sampling bias or recover unobserved days."}</p>
        <p>Neither percentage measures the share of days wet, a hazard, water volume or an ecological trend. A percentage based entirely on unclear labels would mean no positive detection, not evidence of absence.</p>
        <div className="water-sampling-table"><table><caption>Evidence retained in each UTC calendar year</caption><thead><tr><th>Year</th><th>Water</th><th>Observable</th><th>All unknown</th><th>Detection fraction</th></tr></thead><tbody>
          {view.yearSummaries.map(y => <tr key={y.year}><th scope="row">{y.year}</th><td>{y.counts.water}</td><td>{y.counts.observable}</td><td>{y.counts.unknown}</td><td>{percent(y.waterFraction)}</td></tr>)}
        </tbody></table></div>
        <p>“All unknown” includes unclear labels and visits where the place could not be seen. Only unclear labels on observable views enter the fraction’s denominator.</p>
      </details>
      <details className="water-sampling-provenance">
        <summary>Reproduce the example and inspect the method</summary>
        <p>The native calculation preserves every original record. The display checks its counts, date filters, year population, fractions and differences before showing them. Supplied classifications still need independent validation.</p>
        <p>Method {s.methodVersion}; original history {s.history.methodVersion}. This is an Earthsignal sensitivity diagnostic, not the JRC occurrence or recurrence product.</p>
        <p><a href="https://storage.googleapis.com/global-surface-water/downloads_ancillary/DataUsersGuidev2.pdf" target="_blank" rel="noreferrer">JRC explains seasonal observation weighting</a> · <a href="https://github.com/meowtappeparlechat/earthsignal/blob/main/docs/water-sampling-sensitivity.md" target="_blank" rel="noreferrer">Earthsignal method and offline reproduction</a></p>
        <dl><dt>Exact input SHA-256</dt><dd>{demo.inputSha256}</dd><dt>Exact result-file SHA-256</dt><dd>{demo.resultSha256}</dd><dt>Normalized observation hash</dt><dd>{s.inputHash}</dd><dt>Options hash</dt><dd>{s.optionsHash}</dd></dl>
        <div className="water-sampling-cases">
          <button type="button" onClick={() => download("earthsignal-synthetic-" + demo.id + "-input.json", demo.inputText)}><ArrowDownToLine size={15} aria-hidden="true"/>Example input JSON</button>
          <button type="button" onClick={() => download("earthsignal-synthetic-" + demo.id + "-result.json", demo.resultText)}><ArrowDownToLine size={15} aria-hidden="true"/>Full native result JSON</button>
        </div>
      </details>
    </div>
  </details>;
}
