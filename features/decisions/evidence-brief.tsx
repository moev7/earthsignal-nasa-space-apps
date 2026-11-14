"use client";
import {
  type Assessment,
  type Claim,
  type EvidenceRecord,
} from "@/lib/observatory-contract";
import { assessmentPlainResult } from "@/lib/plain-language";
import { PlainLanguageResult } from "./plain-language-result";
export function ClaimView({
  claim,
  evidence,
}: {
  claim: Claim;
  evidence: EvidenceRecord[];
}) {
  return (
    <article className="claim-line">
      <span
        className={`claim-tag claim-${claim.type.toLowerCase().replaceAll(" ", "-")}`}
      >
        {claim.type}
      </span>
      <p>{claim.text}</p>
      <details className="claim-proof">
        <summary>Why do we say this?</summary>
        <dl>
          <dt>Method / rule</dt>
          <dd>{claim.methodVersion}</dd>
          <dt>Applies to</dt>
          <dd>
            {claim.applicability.join(" · ") ||
              "Only the recorded selection and dates"}
          </dd>
        </dl>
        {(
          [
            ["Assumptions", claim.assumptions],
            ["Uncertainty", claim.uncertainty],
            ["Counterevidence", claim.counterevidence],
          ] as const
        ).map(([title, items]) =>
          items.length ? (
            <div key={title}>
              <strong>{title}</strong>
              <ul>
                {items.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
        {claim.evidenceIds.map((id) => {
          const e = evidence.find((v) => v.id === id);
          return e ? (
            <div className="claim-source" key={id}>
              <a href={e.url} target="_blank" rel="noreferrer">
                {e.title}
              </a>
              <p>
                {e.quantity} · {e.unit} · {e.sourceVersion}
              </p>
              <p>
                Observation {e.timestamps.observedStart ?? "not specified"} →{" "}
                {e.timestamps.observedEnd ?? "not specified"}; published{" "}
                {e.timestamps.publishedAt ?? "not supplied"}; retrieved{" "}
                {e.timestamps.retrievedAt}; valid through{" "}
                {e.timestamps.validThrough ?? "not supplied"}.
              </p>
              <p>
                {e.spatialSupport.description} · masks: {e.maskPolicy}
              </p>
              <p>{e.quality.notes.join(" · ")}</p>
              <code>{JSON.stringify(e.hashes)}</code>
            </div>
          ) : (
            <p key={id}>
              Supporting evidence is unavailable; this claim must not be used.
            </p>
          );
        })}
      </details>
    </article>
  );
}
export function EvidenceBrief({
  assessment,
  includePlainLanguage = true,
}: {
  assessment: Assessment;
  includePlainLanguage?: boolean;
}) {
  return (
    <details
      id="assessment-brief"
      className="evidence-brief analysis-disclosure"
    >
      <summary>Full scientific explanation and evidence</summary>
      <div className="decision-section-title">
        <h2>{assessment.brief.title}</h2>
        <span className="outcome-tag">{assessment.outcome}</span>
      </div>
      <p className="brief-context">
        {assessment.domain} · {assessment.time.start} → {assessment.time.end} ·
        Processed {new Date(assessment.processedAt).toLocaleString()}
      </p>
      {includePlainLanguage && (
        <PlainLanguageResult
          key={assessment.processedAt}
          result={assessmentPlainResult(assessment)}
        />
      )}
      <div className="brief-sections">
        {assessment.brief.sections.map((s) => (
          <section key={s.id}>
            <h3>{s.title}</h3>
            {s.claimIds.map((id) => {
              const c = assessment.claims.find((c) => c.id === id);
              return c ? (
                <ClaimView key={id} claim={c} evidence={assessment.evidence} />
              ) : null;
            })}
          </section>
        ))}
      </div>
      <details id="assessment-quality" className="quality-disclosure">
        <summary>Quality, uncertainty and applicability</summary>
        <dl>
          {assessment.quality.map((q, i) => (
            <div key={`${q.dimension}-${i}`}>
              <dt>
                {q.dimension} · {q.status}
              </dt>
              <dd>{q.message}</dd>
            </div>
          ))}
        </dl>
        <p>
          These indicators describe different questions. They are not combined
          into a confidence percentage.
        </p>
      </details>
    </details>
  );
}
