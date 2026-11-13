"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { SiteLink as Link } from "@/components/site-link";
import { SAR_SOURCES, CHALLENGE_RESOURCES, SOURCE_READINESS, OFFICIAL_CHALLENGE_RESOURCES } from "@/lib/challenge-resources";
import { PUBLIC_STUDIES } from "@/lib/public-study-registry";
import {
  sarJobSchema,
  sarPlanSchema,
  sarSearchResultSchema,
  sarSearchSchema,
  sarStudyRequestSchema,
  type SarSourceId,
  type SarRecord,
  type SarJob,
  type SarPlan,
} from "@/lib/sar-contract";
import { z } from "zod";
import "./sar-workbench.css";

const PRESETS: Record<
  SarSourceId,
  { bbox: string; start: string; end: string }
> = {
  nisar: {
    bbox: "51.285,35.605,51.295,35.615",
    start: "2026-10-21",
    end: "2026-11-13",
  },
  "radarsat-1": {
    bbox: "-97.501,75.999,-97.499,76.001",
    start: "1996-03-01",
    end: "1996-03-10",
  },
  rcm: {
    bbox: "-99.91,49.61,-99.90,49.62",
    start: "2025-02-20",
    end: "2025-03-05",
  },
  uavsar: {
    bbox: "-80.521,8.249,-80.519,8.251",
    start: "2026-05-01",
    end: "2026-05-10",
  },
  saocom: {
    bbox: "-64.201,-31.401,-64.199,-31.399",
    start: "2026-01-01",
    end: "2026-11-13",
  },
};
type Values = {
  width: number;
  height: number;
  values: (number | null)[];
  unit: string;
};
const valuesSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  values: z.array(z.number().finite().nullable()).max(262144),
  unit: z.enum(["dB", "mm", "meters", "source units"]),
});
const SOURCE_CHANNELS: Record<SarSourceId, string[]> = {
  nisar: ["HH", "HV", "VV", "VH"],
  "radarsat-1": ["HH"],
  rcm: ["HH", "HV", "VV", "VH", "CH", "CV", "RR", "RL"],
  saocom: ["HH", "HV", "VV", "VH"],
  uavsar: ["HH", "HV", "VV"],
};
function numbers(value: string) {
  return value.split(",").map((v) => (v.trim() ? Number(v.trim()) : NaN));
}
class ServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function failure(response: Response) {
  const body = z
    .object({ error: z.union([z.string(), z.object({ message: z.string() })]) })
    .safeParse(await response.json().catch(() => null));
  return new ServiceError(
    response.status === 401
      ? "Sign in using Collaborator access to search and process native source data. Published studies below remain open."
      : body.success
        ? typeof body.data.error === "string"
          ? body.data.error
          : body.data.error.message
        : "The science service could not complete this request.",
    response.status,
  );
}
async function verifiedArtifact(
  job: SarJob,
  name: string,
  signal: AbortSignal,
) {
  const expected = job.result?.artifacts[name];
  if (!expected || expected.bytes > 8 * 1024 * 1024)
    throw Error("Artifact is missing or exceeds its native-data budget.");
  const response = await fetch(`/api/sar-studies/${job.id}/artifacts/${name}`, {
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw await failure(response);
  const reader = response.body?.getReader();
  if (!reader) throw Error("The result artifact is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > expected.bytes)
        throw Error("Artifact exceeds its reviewed byte count.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (size !== expected.bytes || hash !== expected.sha256)
    throw Error("Native artifact integrity check failed.");
  return bytes;
}

function NativeResult({
  job,
  onAuthExpired,
}: {
  job: SarJob;
  onAuthExpired: () => void;
}) {
  const [loaded, setLoaded] = useState<{
    id: string;
    manifest: SarJob["result"];
    image: string;
    valuesUrl: string;
    data: Values;
  } | null>(null);
  const [error, setError] = useState("");
  const [cell, setCell] = useState({ row: 0, col: 0 });
  useEffect(() => {
    const abort = new AbortController();
    let url = "",
      valuesUrl = "",
      active = true;
    Promise.all([
      verifiedArtifact(job, "preview.png", abort.signal),
      verifiedArtifact(job, "values.json", abort.signal),
    ])
      .then(([png, json]) => {
        const data = valuesSchema.parse(
          JSON.parse(new TextDecoder().decode(json)),
        );
        const grid = job.result!.grid;
        if (
          data.values.length !== data.width * data.height ||
          data.width !== grid.width ||
          data.height !== grid.height ||
          data.unit !== job.result!.unit
        )
          throw Error("Native values disagree with the result grid or units.");
        if (!active) return;
        url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
        valuesUrl = URL.createObjectURL(
          new Blob([json], { type: "application/json" }),
        );
        setCell({ row: 0, col: 0 });
        setLoaded({
          id: job.id,
          manifest: job.result,
          image: url,
          valuesUrl,
          data,
        });
        setError("");
      })
      .catch((e) => {
        if (
          active &&
          !abort.signal.aborted &&
          e instanceof ServiceError &&
          e.status === 401
        ) {
          onAuthExpired();
          return;
        }
        if (active && !abort.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Native result could not be verified.",
          );
      });
    return () => {
      active = false;
      abort.abort();
      if (url) URL.revokeObjectURL(url);
      if (valuesUrl) URL.revokeObjectURL(valuesUrl);
    };
  }, [job, onAuthExpired]);
  const current =
      loaded?.id === job.id && loaded.manifest === job.result ? loaded : null,
    m = job.result;
  if (!m) return null;
  const value =
    current?.data.values[cell.row * current.data.width + cell.col] ?? null;
  return (
    <section className="sar-result" aria-label="Verified native result">
      <div className="sar-result-heading">
        <div>
          <span className="sar-kicker">
            Private analytical result ·{" "}
            {current
              ? "hash checked"
              : error
                ? "verification failed"
                : "verifying artifacts"}
          </span>
          <h3>{m.quantity}</h3>
        </div>
        <span>{m.unit}</span>
      </div>
      <dl className="sar-readings">
        <div>
          <dt>Native coverage</dt>
          <dd>{(100 * m.coverage.fraction).toFixed(1)}%</dd>
        </div>
        <div>
          <dt>Median of valid pixels</dt>
          <dd>
            {m.stats.median?.toFixed(3) ?? "Unknown"} {m.unit}
          </dd>
        </div>
        <div>
          <dt>Native grid</dt>
          <dd>
            {m.grid.width} × {m.grid.height}
          </dd>
        </div>
      </dl>
      {error && (
        <p role="alert" className="sar-message">
          {error}
        </p>
      )}
      {!current && !error && (
        <p role="status">Verifying native values and preview…</p>
      )}
      {current && (
        <div className="sar-result-layout">
          <div
            className="sar-raster"
            style={{ maxWidth: `${65 * current.data.width / current.data.height}vh`, width: "100%" }}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              setCell({
                col: Math.min(
                  current.data.width - 1,
                  Math.max(
                    0,
                    Math.floor(
                      ((event.clientX - box.left) / box.width) *
                        current.data.width,
                    ),
                  ),
                ),
                row: Math.min(
                  current.data.height - 1,
                  Math.max(
                    0,
                    Math.floor(
                      ((event.clientY - box.top) / box.height) *
                        current.data.height,
                    ),
                  ),
                ),
              });
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.image}
              width={current.data.width}
              height={current.data.height}
              alt={`Native ${m.quantity} preview. Transparent pixels have no valid observation. Use row and column controls for keyboard sampling.`}
            />
            <span
              className="sar-probe"
              aria-hidden="true"
              style={{
                left: `${(100 * (cell.col + 0.5)) / current.data.width}%`,
                top: `${(100 * (cell.row + 0.5)) / current.data.height}%`,
              }}
            />
          </div>
          <fieldset className="sar-probe-controls">
            <legend>Inspect a native pixel</legend>
            <p>
              Tap the raster or choose a row and column. Missing values stay
              unknown.
            </p>
            <label>
              Row
              <input
                type="number"
                min={0}
                max={current.data.height - 1}
                value={cell.row}
                onChange={(e) =>
                  setCell((c) => ({
                    ...c,
                    row: Math.max(
                      0,
                      Math.min(
                        current.data.height - 1,
                        Math.floor(Number(e.target.value) || 0),
                      ),
                    ),
                  }))
                }
              />
            </label>
            <label>
              Column
              <input
                type="number"
                min={0}
                max={current.data.width - 1}
                value={cell.col}
                onChange={(e) =>
                  setCell((c) => ({
                    ...c,
                    col: Math.max(
                      0,
                      Math.min(
                        current.data.width - 1,
                        Math.floor(Number(e.target.value) || 0),
                      ),
                    ),
                  }))
                }
              />
            </label>
            <output aria-live="polite">
              {value === null
                ? "Unknown · no valid observation"
                : `${value.toFixed(4)} ${m.unit}`}
            </output>
          </fieldset>
        </div>
      )}
      <p className="sar-note">
        The preview uses a display stretch. Numerical sampling uses the original
        native cells. Completion does not authorize public publication or
        establish a cause.
      </p>
      <details>
        <summary>Method, geometry and source evidence</summary>
        <p>
          {SAR_SOURCES.find((s) => s.id === m.sourceId)?.name} · {m.channel} ·{" "}
          {m.method} · {m.grid.crs}
        </p>
        <p>
          Processed {m.processedAt}. Native affine transform:{" "}
          {m.grid.transform.join(", ")}.
        </p>
        <ul className="sar-source-evidence">
          {m.records.map((record, index) => (
            <li key={record.id}>
              <strong>
                {m.records.length === 2
                  ? `${index === 0 ? "Before" : "After"}: `
                  : ""}
                {record.title}
              </strong>
              <span>
                {record.acquiredAt ?? "Acquisition time unknown"}
                {record.endAt ? ` — ${record.endAt}` : ""} · {record.product} ·{" "}
                {record.collection ?? "Collection unknown"}
              </span>
              <span>
                {record.id} · {record.maturity}
              </span>
              <p>{record.notice}</p>
              {/^https?:\/\//.test(record.referenceUrl) && (
                <a href={record.referenceUrl} target="_blank" rel="noreferrer">
                  Original record & metadata ↗
                </a>
              )}
            </li>
          ))}
        </ul>
        {m.notices.map((n) => (
          <p key={n}>{n}</p>
        ))}
        <div className="sar-actions">
          <a
            download="manifest.json"
            href={`/api/sar-studies/${job.id}/artifacts/manifest.json`}
          >
            Result manifest
          </a>
          <a
            download="provenance.json"
            href={`/api/sar-studies/${job.id}/artifacts/provenance.json`}
          >
            Source & processing provenance
          </a>
          {current && (
            <>
              <a download="values.json" href={current.valuesUrl}>
                Verified native values & missing cells
              </a>
              <a download="preview.png" href={current.image}>
                Verified preview image
              </a>
            </>
          )}
        </div>
      </details>
    </section>
  );
}

export function SarWorkbench() {
  const [sourceId, setSource] = useState<SarSourceId>("nisar"),
    [area, setArea] = useState(PRESETS.nisar.bbox),
    [start, setStart] = useState(PRESETS.nisar.start),
    [end, setEnd] = useState(PRESETS.nisar.end);
  const [pixelWindow, setPixelWindow] = useState("3700,5600,128,128");
  const [product, setProduct] = useState("GCOV"),
    [channel, setChannel] = useState("HH"),
    [operation, setOperation] = useState("backscatter-observation");
  const [component, setComponent] = useState("slant-range"), [layer, setLayer] = useState(1);
  const [records, setRecords] = useState<SarRecord[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [jobs, setJobs] = useState<SarJob[]>([]),
    [activeId, setActiveId] = useState<string | null>(null);
  const [plan, setPlan] = useState<{
      value: SarPlan;
      fingerprint: string;
    } | null>(null),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState("");
  const epoch = useRef(0),
    controllers = useRef(new Set<AbortController>()),
    submitKey = useRef<{ fingerprint: string; key: string } | null>(null),
    performing = useRef(false);
  const requestInput = {
    schemaVersion: "1.0",
    sourceId,
    operation,
    recordIds: selected,
    bbox: numbers(area),
    channel,
    ...(operation === "pixel-offset" ? { component, layer } : {}),
    ...(operation === "native-observation"
      ? { pixelWindow: numbers(pixelWindow) }
      : {}),
  };
  const parsed = sarStudyRequestSchema.safeParse(requestInput),
    fingerprint = JSON.stringify(requestInput);
  const currentPlan = plan?.fingerprint === fingerprint ? plan.value : null;
  const selectedRecords = selected.map((id) =>
    records.find((r) => r.id === id),
  );
  const selectionValid =
    parsed.success &&
    selectedRecords.every(
      (r) =>
        r &&
        r.sourceId === sourceId &&
        (!r.channels.length || r.channels.includes(channel)),
    );
  const clearPrivate = useCallback((message: string) => {
    epoch.current++;
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    performing.current = false;
    submitKey.current = null;
    setJobs([]);
    setActiveId(null);
    setRecords([]);
    setSelected([]);
    setPlan(null);
    setBusy("");
    setMessage(message);
  }, []);
  const authExpired = useCallback(
    () =>
      clearPrivate(
        "Your session expired. Sign in using Collaborator access, then refresh history. Published studies remain open.",
      ),
    [clearPrivate],
  );
  function invalidate() {
    epoch.current++;
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    performing.current = false;
    setPlan(null);
    setBusy("");
    setMessage("");
  }
  async function perform(
    label: string,
    path: string,
    payload: unknown,
    apply: (body: unknown) => void,
    key?: string,
  ) {
    if (performing.current) return;
    performing.current = true;
    const generation = epoch.current,
      abort = new AbortController();
    controllers.current.add(abort);
    setBusy(label);
    setMessage("");
    try {
      const response = await fetch(path, {
        method: payload === undefined ? "GET" : "POST",
        signal: abort.signal,
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      if (!response.ok) throw await failure(response);
      const data: unknown = await response.json();
      if (generation === epoch.current && !abort.signal.aborted) apply(data);
    } catch (e) {
      if (
        generation === epoch.current &&
        !abort.signal.aborted &&
        e instanceof ServiceError &&
        e.status === 401
      ) {
        authExpired();
        return;
      }
      if (generation === epoch.current && !abort.signal.aborted)
        setMessage(
          e instanceof Error ? e.message : "The science request failed.",
        );
    } finally {
      controllers.current.delete(abort);
      if (generation === epoch.current) {
        performing.current = false;
        setBusy("");
      }
    }
  }
  useEffect(() => {
    let mounted = true;
    const pending = controllers.current;
    const cancel = () => {
      epoch.current++;
      pending.forEach((c) => c.abort());
      pending.clear();
    };
    const abort = new AbortController();
    const generation = epoch.current;
    controllers.current.add(abort);
    fetch("/api/sar-studies", { signal: abort.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw await failure(r);
        const data = z
          .object({ jobs: z.array(sarJobSchema) })
          .parse(await r.json());
        if (mounted && generation === epoch.current) setJobs(data.jobs);
      })
      .catch((e) => {
        if (!mounted || generation !== epoch.current || abort.signal.aborted)
          return;
        if (e instanceof ServiceError && e.status === 401) authExpired();
        else
          setMessage(
            e instanceof Error
              ? e.message
              : "Study history could not be loaded.",
          );
      })
      .finally(() => pending.delete(abort));
    const auth = () =>
      clearPrivate(
        "Account changed. Refresh your study history to load this account's results.",
      );
    window.addEventListener("earthsignal-auth-changed", auth);
    return () => {
      mounted = false;
      cancel();
      window.removeEventListener("earthsignal-auth-changed", auth);
    };
  }, [authExpired, clearPrivate]);
  const source = SAR_SOURCES.find((s) => s.id === sourceId)!;
  const active = jobs.find((j) => j.id === activeId);
  function chooseSource(id: SarSourceId) {
    invalidate();
    const p = PRESETS[id];
    setSource(id);
    setArea(p.bbox);
    setStart(p.start);
    setEnd(p.end);
    setProduct("GCOV");
    setChannel(id === "rcm" ? "RR" : "HH");
    setOperation(
      id === "radarsat-1" ? "native-observation" : "backscatter-observation",
    );
    setRecords([]);
    setSelected([]);
    setActiveId(null);
  }
  function edit(action: () => void, clearRecords = false) {
    invalidate();
    action();
    if (clearRecords) {
      setRecords([]);
      setSelected([]);
    }
  }
  function updateJob(body: unknown) {
    const j = sarJobSchema.parse(body);
    setJobs((previous) => [j, ...previous.filter((x) => x.id !== j.id)]);
    setActiveId(j.id);
  }
  return (
    <section className="sar-workbench" aria-labelledby="sar-title">
      <header className="sar-intro">
        <div>
          <span className="sar-kicker">
            Advanced tools · Dancing with the SARs
          </span>
          <h1 id="sar-title">
            From a source record
            <br />
            to evidence you can inspect.
          </h1>
          <p>
            Discover original radar observations, check what a method can
            support, then run a bounded native-grid study. Broader science lives
            here; the main story follows Tehran and Tokyo.
          </p>
        </div>
        <Link href="/">Return to the Tehran & Tokyo story ↗</Link>
      </header>
      <nav className="sar-source-tabs" aria-label="Radar data source">
        {SAR_SOURCES.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={s.id === sourceId}
            onClick={() => chooseSource(s.id)}
          >
            <strong>{s.name}</strong>
            <span>{s.band}</span>
          </button>
        ))}
      </nav>
      <div className="sar-source-context">
        <h2>{source.name}</h2>
        <p>{source.description}</p>
        <p className="sar-note">{source.access}</p>
        <a href={source.url} target="_blank" rel="noreferrer">
          Original source & access guidance ↗
        </a>
      </div>
      <div className="sar-workspace-grid">
        <section className="sar-step">
          <span className="sar-kicker">01 · Find observations</span>
          <h2>Choose a place and dates.</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              invalidate();
              setRecords([]);
              setSelected([]);
              const q = sarSearchSchema.safeParse({
                sourceId,
                bbox: numbers(area),
                start,
                end,
                product,
              });
              if (!q.success) {
                setMessage(q.error.issues[0]?.message ?? "Check your search.");
                return;
              }
              void perform(
                "search",
                "/api/sar-studies/search",
                q.data,
                (body) => {
                  const result = sarSearchResultSchema.parse(body);
                  if (
                    result.sourceId !== sourceId ||
                    result.records.some((r) => r.sourceId !== sourceId) ||
                    new Set(result.records.map((r) => r.id)).size !==
                      result.records.length
                  )
                    throw Error(
                      "Archive response does not match the selected source or contains duplicate records. Search again.",
                    );
                  setRecords(result.records);
                  setMessage(
                    result.notice +
                      (result.status === "ready" && !result.records.length
                        ? " No records returned. This is not evidence of no change."
                        : "") +
                      (!result.complete
                        ? " Results may be incomplete; narrow the place or date range to refine discovery."
                        : ""),
                  );
                },
              );
            }}
          >
            <label>
              Crop · west, south, east, north
              <input
                value={area}
                onChange={(e) => edit(() => setArea(e.target.value), true)}
                spellCheck={false}
              />
            </label>
            <p className="sar-note">
              Decimal longitude/latitude. Native processing is limited to 0.2°
              per side and 262,144 pixels; an archive footprint is not
              valid-pixel coverage.
            </p>
            <div className="sar-field-pair">
              <label>
                From
                <input
                  type="date"
                  value={start}
                  onChange={(e) => edit(() => setStart(e.target.value), true)}
                />
              </label>
              <label>
                Through
                <input
                  type="date"
                  value={end}
                  onChange={(e) => edit(() => setEnd(e.target.value), true)}
                />
              </label>
            </div>
            {sourceId === "nisar" && (
              <label>
                Native product
                <select
                  value={product}
                  onChange={(e) =>
                    edit(() => {
                      setProduct(e.target.value);
                      setOperation(
                        e.target.value === "GUNW"
                          ? "los-displacement"
                          : e.target.value === "GOFF" ? "pixel-offset" : "backscatter-observation",
                      );
                    }, true)
                  }
                >
                  <option>GCOV</option>
                  <option>GUNW</option>
                  <option>GOFF</option>
                  <option>GSLC</option>
                </select>
              </label>
            )}
            <button className="sar-primary" disabled={!!busy} type="submit">
              {busy === "search"
                ? "Searching the archive…"
                : "Search original records"}
            </button>
          </form>
          {records.length > 0 && (
            <fieldset className="sar-records">
              <legend>
                Select an acquisition
                {operation === "backscatter-change"
                  ? " pair · before, then after"
                  : ""}
              </legend>
              <p>
                Up to 24 records. Selection order sets before/after; previews
                and missing metadata cannot substitute for native analysis.
              </p>
              {records.map((r) => (
                <label key={r.id} className="sar-record">
                  <input
                    type="checkbox"
                    checked={selected.includes(r.id)}
                    onChange={() =>
                      edit(() =>
                        setSelected((s) =>
                          s.includes(r.id)
                            ? s.filter((x) => x !== r.id)
                            : operation === "backscatter-change"
                              ? [...s.slice(-1), r.id]
                              : [r.id],
                        ),
                      )
                    }
                  />
                  <span>
                    <strong>{r.title}</strong>
                    <span>
                      {r.acquiredAt ?? "Acquisition time unknown"} ·{" "}
                      {r.maturity}
                    </span>
                    <span>
                      {r.product} ·{" "}
                      {r.channels.join(" / ") || "Channels not listed"} ·{" "}
                      {r.scienceAssets} original asset link
                      {r.scienceAssets === 1 ? "" : "s"}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </section>
        <section className="sar-step">
          <span className="sar-kicker">02 · Check, then process</span>
          <h2>Keep the physics attached.</h2>
          <label>
            Operation
            <select
              value={operation}
              onChange={(e) =>
                edit(() => {
                  setOperation(e.target.value);
                  setSelected([]);
                })
              }
            >
              {!(sourceId === "nisar" && ["GUNW", "GOFF"].includes(product)) && (
                <option value="backscatter-observation">
                  Calibrated backscatter · one acquisition
                </option>
              )}
              {!(sourceId === "nisar" && ["GUNW", "GOFF", "GSLC"].includes(product)) && (
                <option value="backscatter-change">
                  Backscatter difference · two acquisitions
                </option>
              )}
              {sourceId === "nisar" && product === "GUNW" && (
                <option value="los-displacement">
                  Relative LOS displacement · one GUNW pair
                </option>
              )}
              {sourceId === "nisar" && product === "GOFF" && (
                <option value="pixel-offset">Native pixel offset · one GOFF pair</option>
              )}
              {sourceId === "radarsat-1" && (
                <option value="native-observation">
                  Inspect native magnitude · calibration withheld
                </option>
              )}
            </select>
          </label>
          {operation === "pixel-offset" && <div className="sar-fields">
            <label>Offset component<select value={component} onChange={e => edit(() => setComponent(e.target.value))}>
              <option value="slant-range">Slant range</option><option value="along-track">Along track</option>
            </select></label>
            <label>Matching layer<select value={layer} onChange={e => edit(() => setLayer(Number(e.target.value)))}>
              {[1,2,3].map(n => <option key={n} value={n}>Layer {n}</option>)}
            </select></label>
          </div>}
          {operation === "native-observation" && (
            <label>
              Native pixel window · column, row, width, height
              <input
                value={pixelWindow}
                onChange={(e) => edit(() => setPixelWindow(e.target.value))}
              />
              <span className="sar-note">
                Zero-based image pixels. This window is independent of the
                geographic search box. GCP-only imagery is not geocoded, and
                magnitude has no calibrated dB interpretation.
              </span>
            </label>
          )}
          <label>
            Channel
            <select
              value={channel}
              onChange={(e) => edit(() => setChannel(e.target.value))}
            >
              {SOURCE_CHANNELS[sourceId].map((c) => (
                <option
                  key={c}
                  value={c}
                  disabled={selectedRecords.some(
                    (r) =>
                      r && r.channels.length > 0 && !r.channels.includes(c),
                  )}
                >
                  {c}
                </option>
              ))}
            </select>
          </label>
          <p className="sar-note">
            HH/HV/VV and compact-polarization products are different
            observations. Source masks and calibration must support the selected
            channel. Catalog-only product support does not enable a processor.
          </p>
          <div className="sar-actions">
            <button
              type="button"
              disabled={!!busy || !selectionValid}
              onClick={() => {
                if (parsed.success)
                  void perform(
                    "plan",
                    "/api/sar-studies/plan",
                    parsed.data,
                    (body) => {
                      const value = sarPlanSchema.parse(body);
                      if (
                        JSON.stringify(value.request) !==
                          JSON.stringify(parsed.data) ||
                        (value.ready && value.gates.length)
                      )
                        throw Error(
                          "The returned plan does not match this selection or has unresolved gates. Inspect it again.",
                        );
                      setPlan({
                        value,
                        fingerprint,
                      });
                    },
                  );
              }}
            >
              Inspect processing plan
            </button>
            <button
              className="sar-primary"
              type="button"
              disabled={!!busy || !selectionValid || !currentPlan?.ready}
              onClick={() => {
                if (!parsed.success || !selectionValid || !currentPlan?.ready)
                  return;
                if (submitKey.current?.fingerprint !== fingerprint)
                  submitKey.current = { fingerprint, key: crypto.randomUUID() };
                void perform(
                  "submit",
                  "/api/sar-studies",
                  parsed.data,
                  (body) => {
                    updateJob(body);
                    setMessage(
                      "Study queued. Use Refresh status below to follow the existing bounded science worker.",
                    );
                  },
                  submitKey.current.key,
                );
              }}
            >
              {busy === "submit" ? "Submitting…" : "Run native study"}
            </button>
          </div>
          {!selectionValid && (
            <p className="sar-note">
              {parsed.success
                ? "The selected record does not list this channel. Choose a matching channel or acquisition."
                : selected.length === 0 ? "Choose an original acquisition above to inspect its processing plan." : (parsed.error.issues[0]?.message ??
                  "Select the required records and a small crop before inspecting the plan.")}
            </p>
          )}
          {currentPlan && (
            <aside className="sar-plan" aria-label="Processing plan">
              <h3>
                {currentPlan.ready
                  ? "Ready to submit for native verification"
                  : "Processing is withheld"}
              </h3>
              <p>
                {currentPlan.quantity} · {currentPlan.unit}
              </p>
              {currentPlan.gates.map((g) => (
                <p className="sar-message" key={g}>
                  {g}
                </p>
              ))}
              {currentPlan.notices.map((n) => (
                <p key={n}>{n}</p>
              ))}
              <p>
                Budget: {currentPlan.limits.maxPixels.toLocaleString()} pixels ·{" "}
                {Math.round(currentPlan.limits.maxTransferBytes / 1024 ** 2)}{" "}
                MiB · {currentPlan.limits.maxSeconds} seconds.
              </p>
            </aside>
          )}
          <aside className="sar-principle">
            <strong>One result, one physical meaning.</strong>
            <p>
              Backscatter change uses dB. A GUNW pair describes relative motion
              along the radar line of sight in mm. GOFF reports a native component offset in metres, with residual outliers possible. Neither diagnoses structural
              safety, and neither turns missing observations into zero.
            </p>
          </aside>
        </section>
      </div>
      {message && (
        <p role="status" className="sar-message">
          {message}
        </p>
      )}
      {busy && (
        <p role="status" className="sar-note">
          {
            (
              {
                search: "Searching source metadata…",
                plan: "Checking source, access and processing limits…",
                submit: "Submitting study…",
                history: "Loading study history…",
                status: "Refreshing study status…",
                cancel: "Requesting cancellation…",
              } as Record<string, string>
            )[busy]
          }
        </p>
      )}
      <section className="sar-history">
        <div className="sar-result-heading">
          <div>
            <span className="sar-kicker">03 · Inspect your evidence</span>
            <h2>Study history</h2>
          </div>
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              void perform("history", "/api/sar-studies", undefined, (body) =>
                setJobs(
                  z.object({ jobs: z.array(sarJobSchema) }).parse(body).jobs,
                ),
              )
            }
          >
            Refresh history
          </button>
        </div>
        <p className="sar-note">
          Private to the signed-in collaborator. No background polling, hidden
          downloads or automatic publication.
        </p>
        {!jobs.length && (
          <p>
            No studies loaded. Search and inspect a plan, or sign in and refresh
            your history.
          </p>
        )}
        {jobs.length > 0 && (
          <div className="sar-job-list">
            {jobs.map((j) => (
              <button
                type="button"
                key={j.id}
                aria-pressed={activeId === j.id}
                onClick={() => {
                  invalidate();
                  setActiveId(j.id);
                }}
              >
                <strong>
                  {SAR_SOURCES.find((s) => s.id === j.request.sourceId)?.name} ·{" "}
                  {j.request.operation.replaceAll("-", " ")}
                </strong>
                <span>
                  {j.status} · {j.createdAt.slice(0, 10)}
                </span>
              </button>
            ))}
          </div>
        )}
        {active && (
          <div className="sar-active-job">
            <p>{active.phase}</p>
            {active.error && (
              <p role="alert" className="sar-message">
                {active.error.message} <span>({active.error.code})</span>
              </p>
            )}
            <div className="sar-actions">
              <button
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void perform(
                    "status",
                    `/api/sar-studies/${active.id}`,
                    undefined,
                    updateJob,
                  )
                }
              >
                Refresh status
              </button>
              {["queued", "running"].includes(active.status) && (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() =>
                    void perform(
                      "cancel",
                      `/api/sar-studies/${active.id}/cancel`,
                      {},
                      updateJob,
                    )
                  }
                >
                  Cancel study
                </button>
              )}
            </div>
            {active.status === "completed" && active.result && (
              <NativeResult
                key={active.id}
                job={active}
                onAuthExpired={authExpired}
              />
            )}
          </div>
        )}
      </section>
      <section className="sar-published">
        <span className="sar-kicker">Reviewed public evidence</span>
        <h2>Start with a verified study.</h2>
        <div className="sar-published-grid">
          {PUBLIC_STUDIES.map((s) => (
            <article key={`${s.id}:${s.revision}`}>
              <h3>{s.title}</h3>
              <p>
                {s.period.start} — {s.period.end} · {s.maturity}
              </p>
              <p>{s.notice}</p>
              <p>
                {(s.coverageFraction * 100).toFixed(1)}% valid coverage ·{" "}
                {s.unit}
              </p>
              <div className="sar-actions">
                <a href={s.href}>Explore this study ↗</a>
                <a href={`/api/public-studies/${s.id}?revision=${s.revision}`}>
                  Pinned evidence revision
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>
      <details className="sar-resources">
        <summary>Source readiness · checked {SOURCE_READINESS.checkedOn}</summary>
        <p>{SOURCE_READINESS.notice}</p>
        <div className="sar-resource-grid">{SOURCE_READINESS.sources.map(s => <article key={s.sourceId}>
          <h3>{SAR_SOURCES.find(source => source.id === s.sourceId)?.name}</h3>
          <p>{s.exampleVerified ? "Source values independently verified" : "Original-source numerical verification pending"}</p>
          <p>{s.detail}</p>
          <p><strong>Current limit:</strong> {s.gate}</p>
          <p>{s.nextAction}</p>
          {s.operations.length > 0 && <ul>{s.operations.map(op => <li key={op}>{op}</li>)}</ul>}
        </article>)}</div>
      </details>
      <details className="sar-resources">
        <summary>
          All 14 challenge resources · data, methods and interpretation
        </summary>
        <p>
          Every resource has a role. Methods and educational references are not
          independent measurements. Source access and processing gates remain
          visible.
        </p>
        <div className="sar-resource-grid">
          {CHALLENGE_RESOURCES.map((r) => (
            <article key={r.id}>
              <span className="sar-kicker">{r.kind}</span>
              <h3>
                <a href={OFFICIAL_CHALLENGE_RESOURCES.resources.find(original => original.id === r.id)?.challengeUrl ?? r.url} target="_blank" rel="noreferrer">
                  {r.title} ↗
                </a>
              </h3>
              <p>{r.use}</p>
            </article>
          ))}
        </div>
      </details>
    </section>
  );
}
