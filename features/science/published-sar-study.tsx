"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { SiteLink as Link } from "@/components/site-link";
import { EarthsignalMark } from "@/components/earthsignal-mark";
import { type PublicStudy } from "@/lib/public-study-registry";
import { loadPublishedSar } from "@/lib/public-sar-study";
import "./published-sar-study.css";
type Loaded = Awaited<ReturnType<typeof loadPublishedSar>>;
export function PublishedSarStudy({ study }: { study: PublicStudy }) {
  const [loaded, setLoaded] = useState<(Loaded & { imageUrl: string }) | null>(null);
  const [error, setError] = useState(""); const [retry, setRetry] = useState(0);
  const [row, setRow] = useState(0), [column, setColumn] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); let imageUrl: string | undefined;
    void loadPublishedSar(study, abort.signal).then(data => {
      if (abort.signal.aborted) return;
      imageUrl = URL.createObjectURL(new Blob([new Uint8Array(data.imageBytes)], { type: "image/png" }));
      setLoaded({ ...data, imageUrl });
    }).catch(() => { if (!abort.signal.aborted) setError("This reviewed revision could not be verified. Its measurements are withheld."); });
    return () => { abort.abort(); if (imageUrl) URL.revokeObjectURL(imageUrl); };
  }, [study, retry]);
  const m = loaded?.manifest; const value = loaded?.values[row * (m?.grid.width ?? 1) + column];
  const format = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 5 });
  const base = study.manifestUrl.slice(0, -"manifest.json".length);
  return <main className="published-sar">
    <nav aria-label="Study navigation"><Link href="/"><EarthsignalMark /> Back to the story</Link><Link href="/workspace?view=sar">Advanced tools</Link></nav>
    <header><h1>{study.title}</h1><p>{study.period.start}{study.period.end !== study.period.start && ` to ${study.period.end}`} · {study.sourceId} · {study.unit}</p><p>{study.notice}</p></header>
    {!m && !error && <p role="status">Verifying the published measurements…</p>}
    {error && <div role="alert"><p>{error}</p><button onClick={() => { setLoaded(null); setError(""); setRow(0); setColumn(0); setRetry(v => v + 1); }}>Try this revision again</button></div>}
    {loaded && m && <>
      <div className="published-sar-main">
        <figure><Image unoptimized src={loaded.imageUrl} width={m.grid.width} height={m.grid.height} style={{ maxWidth: `${65 * m.grid.width / m.grid.height}vh`, marginInline: "auto" }} alt={`${m.quantity}, native ${m.grid.width} by ${m.grid.height} samples; transparent samples have no valid measurement.`} onClick={event => { const box = event.currentTarget.getBoundingClientRect(); setColumn(Math.min(m.grid.width - 1, Math.max(0, Math.floor((event.clientX - box.left) / box.width * m.grid.width)))); setRow(Math.min(m.grid.height - 1, Math.max(0, Math.floor((event.clientY - box.top) / box.height * m.grid.height)))); }} />
        <figcaption>Native pixels · {m.grid.width} × {m.grid.height}. Colour stretch helps inspection; read the numeric values for analysis.</figcaption></figure>
        <section aria-labelledby="sample-title"><h2 id="sample-title">Inspect a sample</h2><p>Click the image or choose a zero-based row and column.</p>
          <div className="published-sar-coordinates">{[["Row", row, m.grid.height, setRow], ["Column", column, m.grid.width, setColumn]].map(([label, v, max, set]) => <label key={String(label)}>{String(label)}<input type="number" min={0} max={Number(max) - 1} value={Number(v)} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0 && n < Number(max)) (set as typeof setRow)(n); }} /></label>)}</div>
          <output aria-live="polite">{value == null ? "No valid measurement" : `${format(value)} ${m.unit}`}</output>
          <dl><dt>Quantity</dt><dd>{m.quantity}</dd><dt>Channel</dt><dd>{m.channel}</dd><dt>Valid support</dt><dd>{m.coverage.valid.toLocaleString()} of {m.coverage.total.toLocaleString()} samples</dd><dt>Valid-population median</dt><dd>{format(m.stats.median)} {m.unit}</dd></dl>
        </section>
      </div>
      <section className="published-sar-context"><h2>What this observation can tell you</h2><ul>{m.notices.map(n => <li key={n}>{n}</li>)}</ul></section>
      <details><summary>Original sources, method and downloads</summary><p>Method {m.method}. Processed {m.processedAt}. Reviewed revision <code>{study.revision}</code>.</p><p>Native coordinate system: <code>{m.grid.crs}</code></p><ul>{m.records.map(r => <li key={r.id}><a href={r.referenceUrl}>{r.title}</a> · {r.acquiredAt} · {r.maturity}</li>)}</ul><p>{m.rights.credit}</p><a href={m.rights.url}>{m.rights.license}</a><div className="published-sar-downloads">{["manifest.json", "values.json", "preview.png", "provenance.json"].map(name => <a href={base + name} download key={name}>{name}</a>)}</div></details>
    </>}
  </main>;
}
