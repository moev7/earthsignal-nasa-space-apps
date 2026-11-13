"use client";
import { useEffect, useState } from "react";
import { SiteLink as Link } from "@/components/site-link";
import { EarthsignalMark } from "@/components/earthsignal-mark";
import { type PublicStudy } from "@/lib/public-study-registry";
import { loadPublishedSar } from "@/lib/public-sar-study";
import {
  startingPointHref,
  studyStartingPoint,
} from "@/lib/sar-investigations";
import { StudyInspection } from "./study-inspection";
import "./published-sar-study.css";

type Loaded = Awaited<ReturnType<typeof loadPublishedSar>>;
export function PublishedSarStudy({ study }: { study: PublicStudy }) {
  const [loaded, setLoaded] = useState<
    (Loaded & { imageUrl: string; revision: string }) | null
  >(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    let imageUrl: string | undefined;
    void loadPublishedSar(study, abort.signal)
      .then((data) => {
        if (abort.signal.aborted) return;
        imageUrl = URL.createObjectURL(
          new Blob([new Uint8Array(data.imageBytes)], { type: "image/png" }),
        );
        setLoaded({ ...data, imageUrl, revision: study.manifestSha256 });
        setError("");
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError(
            "This reviewed revision could not be verified. Its measurements are withheld.",
          );
      });
    return () => {
      abort.abort();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [study, retry]);
  const current = loaded?.revision === study.manifestSha256 ? loaded : null;
  const m = current?.manifest;
  const base = study.manifestUrl.slice(0, -"manifest.json".length);
  const startingPoint = studyStartingPoint(study);
  return (
    <main className="published-sar">
      <nav aria-label="Study navigation">
        <Link href="/">
          <EarthsignalMark /> Back to the story
        </Link>
        <Link href="/workspace?view=sar#verified-investigations">
          All investigations
        </Link>
      </nav>
      <header className="published-sar-heading">
        <p className="published-sar-eyebrow">Reviewed native observation</p>
        <h1>{study.title}</h1>
        <p>
          {study.period.start}
          {study.period.end !== study.period.start &&
            ` to ${study.period.end}`}{" "}
          · {study.sourceId} · {study.unit} · revision{" "}
          <code>{study.revision}</code>
        </p>
      </header>
      {!current && !error && (
        <p role="status">Verifying the published measurements…</p>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              setLoaded(null);
              setError("");
              setRetry((v) => v + 1);
            }}
          >
            Try this revision again
          </button>
        </div>
      )}
      {current && m && (
        <>
          <StudyInspection
            key={`${study.id}:${study.revision}`}
            study={study}
            manifest={m}
            values={current.values}
            imageUrl={current.imageUrl}
          />
          <section
            className="published-sar-next"
            aria-labelledby="study-next-title"
          >
            <h2 id="study-next-title">Take the question further.</h2>
            <p>
              Prepare another private investigation using editable source and
              method controls. Nothing runs until you select records, review a
              plan and submit it.
            </p>
            <Link
              href={
                startingPoint
                  ? startingPointHref(startingPoint)
                  : "/workspace?view=sar#native-investigation"
              }
            >
              {startingPoint
                ? "Investigate from these example settings"
                : "Prepare your own investigation"}{" "}
              ↗
            </Link>
          </section>
          <details>
            <summary>Original sources, method and downloads</summary>
            <p>
              Method {m.method}. Processed {m.processedAt}. Reviewed revision{" "}
              <code>{study.revision}</code>.
            </p>
            <p>
              Native coordinate system: <code>{m.grid.crs}</code>
            </p>
            <ul>
              {m.records.map((r) => (
                <li key={r.id}>
                  <a href={r.referenceUrl}>{r.title}</a> · {r.acquiredAt} ·{" "}
                  {r.maturity}
                </li>
              ))}
            </ul>
            <p>{m.rights.credit}</p>
            <a href={m.rights.url}>{m.rights.license}</a>
            <div className="published-sar-downloads">
              {[
                "manifest.json",
                "values.json",
                "preview.png",
                "provenance.json",
              ].map((name) => (
                <a href={base + name} download key={name}>
                  {name}
                </a>
              ))}
            </div>
          </details>
        </>
      )}
    </main>
  );
}
