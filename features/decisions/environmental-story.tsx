"use client";
import { useEffect, useState } from "react";
import type { Assessment, EvidenceRecord } from "@/lib/observatory-contract";
import type { ChangeJob } from "@/lib/radar-contract";
import { environmentalStory } from "@/lib/environmental-story";
import { assessmentPlainResult, type PlainFinding } from "@/lib/plain-language";
import { PUBLIC_BLOCKS } from "@/lib/public-evidence";
import { PublicAssistant } from "./public-assistant";

function SourceRecord({ evidence: e }: { evidence: EvidenceRecord }) {
  return (
    <div className="environmental-story-source">
      <a href={e.url} target="_blank" rel="noreferrer">
        {e.title}
      </a>
      <p>
        {e.sourceId} · Source version {e.sourceVersion} · Method{" "}
        {e.methodVersion}
      </p>
      <p>
        Support: {e.spatialSupport.description} · Resolution{" "}
        {e.spatialSupport.resolution ?? "not recorded"} {e.spatialSupport.unit}{" "}
        · Quantity {e.quantity} ({e.unit})
      </p>
      <p>
        Observed {e.timestamps.observedStart ?? "not recorded"} →{" "}
        {e.timestamps.observedEnd ?? "not recorded"}; published{" "}
        {e.timestamps.publishedAt ?? "not recorded"}; retrieved{" "}
        {e.timestamps.retrievedAt}; valid through{" "}
        {e.timestamps.validThrough ?? "not supplied"}.
      </p>
      <p>
        Mask: {e.maskPolicy} · Recorded source coverage{" "}
        {e.quality.commonCoveragePercent === null
          ? "unknown"
          : `${e.quality.commonCoveragePercent}%`}
        .
      </p>
      {e.quality.notes.length > 0 && (
        <ul>
          {e.quality.notes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Wording only; original measurements and technical wording remain in exports. */
function everyday(text: string) {
  return text
    .replaceAll(
      "Median of matched-pixel differences",
      "Typical change at locations measured on both dates",
    )
    .replaceAll(
      "median matched-pixel radar difference",
      "typical change in the returned radar signal",
    )
    .replaceAll(
      "common valid pixels",
      "locations with usable measurements on both dates",
    )
    .replaceAll("common coverage", "coverage measured on both dates")
    .replaceAll(
      "a whole-area conclusion is withheld",
      "we cannot draw a conclusion about the entire area",
    )
    .replaceAll("cloud masks", "filters that remove cloudy observations")
    .replaceAll("acquisition metadata", "satellite recording conditions")
    .replaceAll("speckle", "grainy noise in radar images")
    .replaceAll(
      "descriptive seasonal slope",
      "summary of the year-to-year change for the same months",
    );
}

function FindingExplanation({ finding }: { finding: PlainFinding }) {
  return (
    <div className="environmental-story-explanation">
      <h4>What this means</h4>
      <p>{everyday(finding.meaning)}</p>
      <h4>What we cannot tell</h4>
      <p>{everyday(finding.limits)}</p>
      <h4>What to check next</h4>
      <p>{everyday(finding.next)}</p>
    </div>
  );
}

const indicatorLabels: Record<string, string> = {
  ndvi: "Vegetation greenness",
  ndmi: "Vegetation moisture",
  temperature: "Ground-surface temperature",
  water: "Mapped open water",
};
const findingLabels: Record<string, string> = {
  vegetation: "Vegetation observations",
  "surface-heat": "Ground-surface temperature",
  "water-extent": "Mapped open water",
  "water-flow": "Water flow at a station",
  "fire-detection": "Satellite heat observations",
};
const indicatorStatus = {
  paired: "Two-date comparison",
  "single-date": "One observation date",
  context: "Supporting observation",
  withheld: "Evidence is incomplete",
};
const forecastStatus = {
  "not-evaluated": "Not evaluated",
  unresolved: "Source or target needs checking",
  withheld: "No estimate released",
  "experimental-available": "Current experimental estimate",
  "no-current-estimate": "No current estimate",
};

/** Presentational only: receives the coordinator's explicitly selected radar job. */
export function EnvironmentalStory({
  assessment,
  radar,
}: {
  assessment: Assessment | null;
  radar: ChangeJob | null;
}) {
  const [assistant, setAssistant] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const story = environmentalStory(assessment, radar, clock);
  if (!assessment && !radar) return null;
  const publicScience = (finding: PlainFinding, id: string) => {
    const block = PUBLIC_BLOCKS.find((b) => b.id === finding.publicBlockId);
    const scienceDomain =
      block?.domain && block.domain !== "general"
        ? block.domain
        : (assessment?.domain ?? "water");
    return (
      <div className="story-science-help">
        <button
          type="button"
          aria-expanded={assistant === id}
          onClick={() => setAssistant(assistant === id ? null : id)}
        >
          {assistant === id
            ? "Close science help"
            : "Ask Gemini about the science"}
        </button>
        {assistant === id && (
          <PublicAssistant
            domain={scienceDomain}
            initialBlockId={finding.publicBlockId}
            resultContext
          />
        )}
      </div>
    );
  };
  const exportExplanation = () => {
    const result = assessment ? assessmentPlainResult(assessment) : story.radar;
    if (!result) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            ...result,
            publicReferences: PUBLIC_BLOCKS.filter((block) =>
              result.findings.some((f) => f.publicBlockId === block.id),
            ),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = "earthsignal-plain-language.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const showForecast =
    Boolean(story.forecast.evaluation) || assessment?.domain === "water";

  return (
    <section
      id="environmental-change-story"
      tabIndex={-1}
      className="environmental-story"
      aria-labelledby="environmental-story-title"
    >
      <header className="environmental-story-header">
        <div className="story-title-row">
          <h2 id="environmental-story-title">In simple terms</h2>
          <button
            type="button"
            disabled={!assessment && !story.radar}
            onClick={exportExplanation}
          >
            Export explanation
          </button>
        </div>
        <p className="environmental-story-intro">
          {assessment
            ? `Observations for ${assessment.time.start} to ${assessment.time.end}. Historical measurements do not describe present conditions.`
            : "Your selected radar comparison. Environmental measurements have not been supplied for its area and dates."}
        </p>
      </header>

      {story.indicators.length > 0 && (
        <div className="environmental-story-indicators">
          {story.indicators.map((indicator, index) => (
            <article
              className="environmental-story-indicator"
              key={`${indicator.id}-${index}`}
            >
              <div className="environmental-story-card-top">
                <h3>
                  {(indicator.raster && indicatorLabels[indicator.raster.id]) ||
                    (indicator.finding &&
                      findingLabels[indicator.finding.publicBlockId]) ||
                    "Environmental observations"}
                </h3>
                <span
                  className="environmental-story-status"
                  data-status={indicator.status}
                >
                  {indicatorStatus[indicator.status]}
                </span>
              </div>
              {indicator.finding ? (
                <>
                  <p className="environmental-story-finding">
                    {everyday(indicator.finding.found)}
                  </p>
                  <p className="environmental-story-support">
                    {indicator.raster
                      ? `${indicator.raster.commonCoveragePercent}% of the sampled locations in your selected area could be compared on both dates.`
                      : indicator.finding.support}
                  </p>
                  <FindingExplanation finding={indicator.finding} />
                  {publicScience(indicator.finding, `indicator-${index}`)}
                </>
              ) : (
                <>
                  <p className="environmental-story-finding">
                    A reliable change comparison is not available from these
                    records.
                  </p>
                  <h4>What this means</h4>
                  <p>
                    The recorded measurements remain available to inspect. This
                    paired interpretation is withheld.
                  </p>
                  <h4>What we cannot tell</h4>
                  <p>
                    These records do not establish a change. Missing evidence is
                    unknown, not zero.
                  </p>
                  <h4>What to check next</h4>
                  <p>
                    Inspect the recorded measurements and resolve the evidence
                    gaps below before drawing a change conclusion.
                  </p>
                </>
              )}
              {indicator.reasons.length > 0 && (
                <ul className="environmental-story-reasons">
                  {indicator.reasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              )}
              <details>
                <summary>Why do we say this? Measurements and sources</summary>
                <p>
                  Original comparison coverage:{" "}
                  {indicator.finding?.support ?? "Not documented"}. Radar
                  relationship:{" "}
                  {indicator.radarRelationship === "not-selected"
                    ? "No radar comparison selected."
                    : indicator.radarRelationship === "comparable-context"
                      ? "Compatible comparison context; this does not establish a cause."
                      : "Separate context; do not combine measurement populations."}
                </p>
                {indicator.metric && (
                  <div>
                    <p>
                      Original metric {indicator.metric.id}:{" "}
                      {indicator.metric.value === null
                        ? "unavailable"
                        : String(indicator.metric.value)}{" "}
                      {indicator.metric.unit}.
                    </p>
                    <p>{indicator.metric.description}</p>
                    <p>
                      Population:{" "}
                      {indicator.metric.denominator ??
                        "not documented; inspect source provenance"}
                      .
                    </p>
                  </div>
                )}
                {indicator.raster && (
                  <>
                    <p>
                      Paired dates {indicator.raster.before.date} →{" "}
                      {indicator.raster.after.date} · Before coverage{" "}
                      {indicator.raster.before.coveragePercent}% · After
                      coverage {indicator.raster.after.coveragePercent}% ·
                      Common coverage {indicator.raster.commonCoveragePercent}%.
                    </p>
                    <p>
                      {indicator.raster.validPixels} /{" "}
                      {indicator.raster.totalPixels} selected-area pixels · Grid{" "}
                      {indicator.raster.grid.crs},{" "}
                      {indicator.raster.grid.resolution} m · Area policy:{" "}
                      {indicator.raster.grid.aoiPolicy}. Raster quantity{" "}
                      {indicator.raster.quantity}, unit {indicator.raster.unit}.
                    </p>
                    <ul>
                      {indicator.raster.notes.map((note, i) => (
                        <li key={i}>{note}</li>
                      ))}
                    </ul>
                  </>
                )}
                {indicator.evidence.map((e) => (
                  <SourceRecord key={e.id} evidence={e} />
                ))}
                {!indicator.evidence.length && (
                  <p>
                    No resolved source record is available for this
                    interpretation.
                  </p>
                )}
              </details>
            </article>
          ))}
        </div>
      )}

      {story.radar ? (
        <article className="environmental-story-radar">
          <h3>What the radar measured</h3>
          <p className="environmental-story-support">{radar!.result!.title}</p>
          {story.alignment.status === "separate-context" && (
            <p className="environmental-story-reasons">
              This radar comparison covers a different area or dates from the
              environmental result. Read the two separately.
            </p>
          )}
          {story.radar.findings.map((finding, i) => (
            <div key={i}>
              <p className="environmental-story-finding">
                {everyday(finding.found)}
              </p>
              <p className="environmental-story-support">
                {radar?.result
                  ? `${radar.result.coverage.validAreaKm2.toLocaleString(undefined, { maximumSignificantDigits: 6 })} km² measured on both dates · ${radar.result.coverage.commonValidPercent.toLocaleString(undefined, { maximumSignificantDigits: 4 })}% usable coverage.`
                  : finding.support}
              </p>
              <FindingExplanation finding={finding} />
              <p className="environmental-story-support">
                dB (decibels) compares signal strength. A negative difference
                means a weaker returned signal; it does not identify the cause.
              </p>
              {publicScience(finding, `radar-${i}`)}
            </div>
          ))}
          <details>
            <summary>Why do we say this? Radar sources and method</summary>
            <p>{story.radar.findings[0]?.support}</p>
            {[radar!.result!.before, radar!.result!.after].map((source, i) => (
              <div
                className="environmental-story-source"
                key={`${source.id}-${i}`}
              >
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.id}
                </a>
                <p>
                  Acquired {source.acquiredAt} · {source.collection} · Release{" "}
                  {source.release} · Track {source.track} / frame {source.frame}{" "}
                  · {source.direction} · {source.mode}
                </p>
              </div>
            ))}
            <p>
              Method {radar!.result!.processing.algorithmVersion}:{" "}
              {radar!.result!.processing.method}. Mask:{" "}
              {radar!.result!.processing.maskPolicy}. Processed{" "}
              {radar!.result!.processing.processedAt}.
            </p>
            <p>{radar!.result!.notice}</p>
          </details>
        </article>
      ) : (
        radar && (
          <section
            className="environmental-story-radar"
            aria-label="Radar evidence status"
          >
            <h3>Radar measurements are not ready to interpret</h3>
            <p>
              The selected comparison has no eligible completed radar
              measurements to show here.
            </p>
            <h4>What we cannot tell</h4>
            <p>No radar change conclusion is available from this selection.</p>
            <h4>What to check next</h4>
            <p>
              Check the selected job&apos;s status, source dates and recorded area
              before using its result.
            </p>
            <ul>
              {story.alignment.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </section>
        )
      )}

      <details className="environmental-story-alignment">
        <summary>How the observations can be compared</summary>
        {story.alignment.status === "standalone" && (
          <p>
            No radar comparison is selected. These assessment measurements
            remain useful on their own.
          </p>
        )}
        {story.alignment.status === "awaiting-assessment" && (
          <p>
            A completed radar comparison is selected. Environmental measurements
            have not been supplied for its area and dates.
          </p>
        )}
        {story.alignment.status === "comparable-context" && (
          <p>
            The actual assessment boundary matches the radar rectangle, with
            exactly the same requested calendar window. Each optical pair must
            also be within 7 calendar days of the radar endpoints. Seven days is
            a workflow convention, not proof of physical equivalence.
          </p>
        )}
        {story.alignment.status === "boundary-window-matched" && (
          <p>
            The selected boundary and calendar window align. Compatible
            environmental measurements are still needed before relating an
            indicator to the radar comparison.
          </p>
        )}
        {story.alignment.status === "separate-context" && (
          <p>
            The observations describe different areas or dates. Read them
            separately; their measurements do not establish a combined
            conclusion.
          </p>
        )}
        {story.alignment.reasons.length > 0 && (
          <ul>
            {story.alignment.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        )}
      </details>

      {showForecast && (
        <details className="environmental-story-forecast">
          <summary>Station water-flow forecasts</summary>
          <h3>USGS station discharge</h3>
          <p>
            <strong>{forecastStatus[story.forecast.status]}</strong>
            {story.forecast.target ? ` · ${story.forecast.target}` : ""}
          </p>
          <p>{story.forecast.message}</p>
          <p>{story.forecast.relationship}</p>
          {story.forecast.evaluation && (
            <>
              <p>
                Evaluation {story.forecast.evaluation.methodVersion} ·{" "}
                {story.forecast.evaluation.status}. Forecast availability is the
                recorded engine decision; this story does not train, score or
                promote a model. Issue and expiry dates remain as recorded.
              </p>
              {story.forecast.evaluation.withheld.length > 0 && (
                <ul>
                  {story.forecast.evaluation.withheld.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              )}
              {story.forecast.status !== "unresolved" &&
                story.forecast.evaluation.forecasts.map((f, i) => (
                  <div className="environmental-story-source" key={i}>
                    <p>
                      {f.target} · {f.model} ({f.modelVersion}) ·{" "}
                      {f.horizonDays}-day horizon · Issued {f.issueTime} · Valid
                      through {f.validThrough}.
                    </p>
                    <p>
                      {Date.parse(f.issueTime) > clock
                        ? "Not yet issued"
                        : Date.parse(f.validThrough) <= clock
                          ? "Expired estimate"
                          : "Current experimental estimate"}
                      . Recorded point {f.distribution.point}{" "}
                      {f.distribution.unit}; interval {f.distribution.lower} →{" "}
                      {f.distribution.upper} {f.distribution.unit}.
                    </p>
                  </div>
                ))}
              {story.forecast.evidence.map((e) => (
                <SourceRecord key={e.id} evidence={e} />
              ))}
              <details>
                <summary>
                  Recorded validation folds, baseline performance and
                  limitations
                </summary>
                <pre>
                  {JSON.stringify(
                    {
                      methodVersion: story.forecast.evaluation.methodVersion,
                      status: story.forecast.evaluation.status,
                      folds: story.forecast.evaluation.folds,
                      validation: story.forecast.evaluation.validation,
                      withheld: story.forecast.evaluation.withheld,
                      notes: story.forecast.evaluation.notes,
                      selectionHash: story.forecast.evaluation.selectionHash,
                      sourceInputHash:
                        story.forecast.evaluation.sourceInputHash,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </>
          )}
        </details>
      )}

      {assessment && (
        <details className="environmental-story-follow-up">
          <summary>More ways to investigate</summary>
          {story.followUp.map((step) => (
            <div key={step.title}>
              <h4>{step.title}</h4>
              <p>{step.text}</p>
            </div>
          ))}
        </details>
      )}
      <details className="environmental-story-limits">
        <summary>Interpretation limits and original records</summary>
        <ul>
          {story.limits.map((limit, i) => (
            <li key={i}>{limit}</li>
          ))}
        </ul>
        {!assessment &&
          story.followUp.map((step) => (
            <div key={step.title}>
              <h4>{step.title}</h4>
              <p>{step.text}</p>
            </div>
          ))}
        {!showForecast && (
          <>
            <p>{story.forecast.message}</p>
            <p>{story.forecast.relationship}</p>
          </>
        )}
        <p>
          Wording {story.version}. Original geometry, dates, masks, hashes,
          baseline assumptions, claims and uncertainty remain below.
        </p>
        <details>
          <summary>Original assessment and selected radar provenance</summary>
          <p>
            Original records are retained for audit, including withheld or
            expired estimates. They are not presented as usable current
            predictions.
          </p>
          <pre>{JSON.stringify(story.provenance, null, 2)}</pre>
        </details>
      </details>
      {assessment && (
        <nav aria-label="Inspect environmental evidence">
          <a href="#assessment-measurements">Inspect recorded measurements</a>
          <a href="#assessment-timeline">Explore observation dates</a>
        </nav>
      )}
    </section>
  );
}
