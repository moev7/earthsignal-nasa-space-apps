"use client";
import { useState } from "react";
import type { PlainResult } from "@/lib/plain-language";
import { PUBLIC_BLOCKS } from "@/lib/public-evidence";
import { PublicAssistant } from "./public-assistant";

export function PlainLanguageResult({ result }: { result: PlainResult }) {
  const [assistant, setAssistant] = useState<number | null>(null);
  const exportBrief = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            ...result,
            publicReferences: PUBLIC_BLOCKS.filter((b) =>
              result.findings.some((f) => f.publicBlockId === b.id),
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
  return (
    <section className="plain-language-result" aria-label="In simple terms">
      <div className="plain-title">
        <div>
          <span className="eyebrow">THE RECORDED RESULT, EXPLAINED</span>
          <h2>In simple terms</h2>
        </div>
        <button className="plain-export" type="button" onClick={exportBrief}>
          Export this explanation
        </button>
      </div>
      {result.findings.map((f, index) => (
        <article className="plain-finding" key={`${f.publicBlockId}-${index}`}>
          <p className="plain-support">{f.support}</p>
          <div className="plain-grid">
            {(
              [
                ["What we found", f.found, "Derived"],
                ["Why it matters", f.meaning, "Possible explanation"],
                ["What this cannot tell us", f.limits, "Evidence limits"],
                ["Useful next check", f.next, "Option to examine"],
              ] as const
            ).map(([title, text, label]) => (
              <section key={title}>
                <span className="claim-tag">{label}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </section>
            ))}
          </div>
          <details className="claim-proof plain-proof">
            <summary>Why do we say this?</summary>
            <p>
              Wording {result.interpretationVersion} · Measurement method{" "}
              {result.methodVersion} · {result.timeLabel ?? "Result processed"}{" "}
              {result.recordedAt}. Wording is generated from recorded data; it
              does not modify the original scientific result.
            </p>
            {f.metricIds.map((id) => {
              const m = result.metrics.find((m) => m.id === id);
              return m ? (
                <div key={id}>
                  <strong>{m.label}</strong>
                  <p>
                    Original value: {String(m.value)} {m.unit}. {m.description}
                  </p>
                  <p>
                    Population:{" "}
                    {m.denominator ??
                      "Not documented; inspect the original provenance"}
                    .
                  </p>
                </div>
              ) : null;
            })}
            {f.evidenceIds.map((id) => {
              const e = result.evidence.find((e) => e.id === id);
              return e ? (
                <div key={id}>
                  <a target="_blank" rel="noreferrer" href={e.url}>
                    {e.title}
                  </a>
                  <p>
                    {e.sourceVersion} · {e.spatialSupport.description} · Masks:{" "}
                    {e.maskPolicy}
                  </p>
                  <p>
                    Observed {e.timestamps.observedStart ?? "not documented"} →{" "}
                    {e.timestamps.observedEnd ?? "not documented"}; published{" "}
                    {e.timestamps.publishedAt ?? "not supplied"}; retrieved{" "}
                    {e.timestamps.retrievedAt}; valid through{" "}
                    {e.timestamps.validThrough ?? "not supplied"}.
                  </p>
                  <p>{e.quality.notes.join(" · ")}</p>
                </div>
              ) : null;
            })}
            {PUBLIC_BLOCKS.filter((b) => b.id === f.publicBlockId).map((b) => (
              <div key={b.id}>
                <a href={b.url} target="_blank" rel="noreferrer">
                  Interpretation context: {b.sourceTitle}
                </a>
                <p>{b.limitations.join(" · ")}</p>
              </div>
            ))}
            <details>
              <summary>
                Recorded source references, geometry, hashes and assumptions
              </summary>
              <pre>{JSON.stringify(result.provenance, null, 2)}</pre>
            </details>
          </details>
          <button
            className="plain-gemini"
            type="button"
            aria-expanded={assistant === index}
            onClick={() => setAssistant(assistant === index ? null : index)}
          >
            {assistant === index
              ? "Close Gemini explanation"
              : "Ask Gemini about this result"}
          </button>
          {assistant === index && (
            <PublicAssistant
              key={`${result.recordedAt}-${f.publicBlockId}-${index}`}
              domain={result.domain}
              initialBlockId={f.publicBlockId}
              resultContext
            />
          )}
        </article>
      ))}
      {result.quality.some((q) => q.status !== "supported") && (
        <details className="claim-proof">
          <summary>What is missing or uncertain in this result?</summary>
          <ul>
            {result.quality
              .filter((q) => q.status !== "supported")
              .map((q, i) => (
                <li key={i}>
                  {q.dimension}: {q.message}
                </li>
              ))}
          </ul>
        </details>
      )}
      <p className="plain-footnote">
        Historical dates remain historical. No danger assessment or forecast is
        implied by this explanation. Full measurements, maps and scientific
        methods remain available below.
      </p>
    </section>
  );
}
