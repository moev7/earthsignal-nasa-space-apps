"use client";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { ContextNote } from "../ContextNote";
import { RotateCcw } from "lucide-react";
import {
  NISAR_BUNDLES,
  seriesAt,
  useNisarTimeSeries,
  type LoadedTimeSeries,
} from "@/features/ground-truth/data/nisar";
import { usePrefersReducedMotion } from "@/features/ground-truth/lib/useTimeline";
import "./timelapse.css";

const mercator = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const unmercator = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function TimeLapse({ title }: { title?: string }) {
  const [attempt, setAttempt] = useState(0);
  return <TimeLapseResult key={attempt} title={title} retry={() => setAttempt((a) => a + 1)} />;
}

function TimeLapseResult({ retry, title }: { retry: () => void; title?: string }) {
  const result = useNisarTimeSeries(NISAR_BUNDLES.tehran);
  if (!result || result.status === "loading")
    return <div className="es-data-message" role="status"><p>Checking every NISAR acquisition…</p></div>;
  if (result.status === "error")
    return (
      <div className="es-data-message" role="alert">
        <p>The time-lapse could not be verified: {result.message}</p>
        <button type="button" className="es-action" onClick={retry}>
          <RotateCcw size={16} aria-hidden="true" /> Try again
        </button>
      </div>
    );
  return <Player data={result.data} title={title} />;
}

function Player({ data, title }: { data: LoadedTimeSeries; title?: string }) {
  const { bundle, series, frames, meta } = data;
  const m = bundle.manifest;
  const [west, south, east, north] = m.bbox_lonlat;
  const aspect = ((east - west) * Math.PI) / 180 / (mercator(north) - mercator(south));
  const reduced = usePrefersReducedMotion();
  const last = frames.length - 1;
  const [index, setIndex] = useState(reduced ? last : 0);
  const track = useRef<HTMLDivElement>(null);
  const fastest = m.stats.fastest_neighbourhood;
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(
    fastest ? { lat: fastest.lat, lng: fastest.lon } : null,
  );
  const id = useId();

  // Scroll drives time: the figure stays pinned while the page scrolls through the tall track,
  // and each equal share of that distance is one NISAR acquisition.
  useEffect(() => {
    if (reduced || !track.current) return;
    const el = track.current;
    let frame = 0;
    const update = () => {
      frame = 0;
      // Pin just below the site header, whatever its height at this width.
      const header = document.querySelector(".es-header")?.getBoundingClientRect().bottom ?? 0;
      el.style.setProperty("--sa-pin-top", `${Math.max(0, Math.round(header)) + 12}px`);
      const r = el.getBoundingClientRect();
      const travel = r.height - window.innerHeight;
      const p = travel > 0 ? Math.min(1, Math.max(0, -r.top / travel)) : 1;
      setIndex(Math.round(p * last));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [reduced, last]);

  const pick = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    setPoint({
      lng: west + fx * (east - west),
      lat: unmercator(mercator(north) - fy * (mercator(north) - mercator(south))),
    });
  };
  const marker = point && {
    left: `${((point.lng - west) / (east - west)) * 100}%`,
    top: `${((mercator(north) - mercator(point.lat)) / (mercator(north) - mercator(south))) * 100}%`,
  };
  const values = point ? seriesAt(series, point.lat, point.lng) : null;
  const limit = meta.colour.limit_mm;
  const ramp = `linear-gradient(90deg, ${meta.colour.stops.map((s) => s.colour).join(", ")})`;

  return (
    <div ref={track} className={reduced ? "sa-track" : "sa-track is-scrolling"} style={{ ["--sa-steps" as string]: frames.length }}>
      <div className="sa-sticky">
        {title && <h3>{title}</h3>}
        <figure className="sa-timelapse" aria-labelledby={`${id}-t`}>
          <div className="sa-timelapse-map">
            <div
              className="sa-frame"
              style={{ aspectRatio: aspect }}
              onClick={pick}
              role="img"
              aria-label={`Cumulative vertical ground motion over Tehran on ${series.dates[index]}. Warm colours are sinking. Click a place to chart it.`}
            >
              {frames.map((src, k) => (
                // Object URLs come from the hash-verifying loader.
                // eslint-disable-next-line @next/next/no-img-element
                <img key={src} src={src} alt="" style={{ opacity: k === index ? 1 : 0 }} draggable={false} />
              ))}
              {marker && <span className="sa-marker" style={marker} aria-hidden="true" />}
              <p className="sa-date"><strong>{shortDate(series.dates[index])}</strong> {series.dates[index].slice(0, 4)}</p>
            </div>
            <div className="sa-controls">
              <input
                type="range" min={0} max={last} value={index}
                aria-label="Acquisition date" aria-valuetext={series.dates[index]}
                onChange={(e) => setIndex(Number(e.target.value))}
              />
              <span className="sa-scale" aria-label={`Colour scale from ${limit} millimetres down to ${limit} millimetres up`}>
                <i style={{ background: ramp }} /><small>{limit} mm down</small><small>up</small>
              </span>
            </div>
          </div>
          <Chart dates={series.dates} values={values} index={index} />
          <figcaption id={`${id}-t`}>
            Provisional NISAR · relative motion · gaps are unmeasured.
          </figcaption>
          <ContextNote label="How to read this time-lapse"><p>{series.dates.length} acquisitions, {shortDate(series.dates[0])} to {shortDate(series.dates[last])} {series.dates[last].slice(0, 4)}. Motion is cumulative since the first pass, relative to the area’s median. The frames and profile come from a frozen, provisional NISAR study; missing measurements stay unknown. Use the date slider for still frames, or select a different place on the map.</p></ContextNote>
        </figure>
      </div>
    </div>
  );
}

function Chart({ dates, values, index }: { dates: string[]; values: (number | null)[] | null; index: number }) {
  const W = 320, H = 170, P = { l: 40, r: 12, t: 26, b: 22 };
  if (!values || !values.some((v, k) => k > 0 && v !== null))
    return <div className="sa-chart sa-chart-empty"><p>No measurement here. Pick a coloured place.</p></div>;
  const t0 = Date.parse(dates[0]);
  const span = Date.parse(dates.at(-1)!) - t0;
  const nums = values.filter((v): v is number => v !== null);
  const lo = Math.min(-20, ...nums), hi = Math.max(10, ...nums);
  const x = (d: string) => P.l + ((Date.parse(d) - t0) / span) * (W - P.l - P.r);
  const y = (v: number) => P.t + ((hi - v) / (hi - lo)) * (H - P.t - P.b);
  const pts = values.flatMap((v, k) => (v === null ? [] : [[x(dates[k]), y(v)] as [number, number]]));
  const shown = values.slice(0, index + 1);
  const sofar = [...shown].reverse().find((v) => v !== null) ?? 0;
  const days = Math.round((Date.parse(dates[index]) - t0) / 86_400_000);
  const current = values[index];
  const done = pts.slice(0, values.slice(0, index + 1).filter((v) => v !== null).length);
  return (
    <div className="sa-chart">
      <p className="sa-chart-head">
        <strong>{sofar < 0 ? `${Math.abs(sofar)} mm down` : `${sofar} mm up`}</strong> after {days} days at this place
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Cumulative ground motion here: ${values.map((v, k) => `${dates[k]} ${v ?? "not measured"} mm`).join(", ")}`}>
        <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} className="sa-zero" />
        <text x={P.l - 6} y={y(0) + 4} textAnchor="end">0</text>
        <text x={P.l - 6} y={y(lo) + 4} textAnchor="end">{Math.round(lo)}</text>
        <text x={P.l} y={H - 6}>{shortDate(dates[0])}</text>
        <text x={W - P.r} y={H - 6} textAnchor="end">{shortDate(dates.at(-1)!)}</text>
        <polyline points={pts.map((p) => p.join(",")).join(" ")} className="sa-line sa-line-ahead" />
        <polyline points={done.map((p) => p.join(",")).join(" ")} className="sa-line" />
        {done.map(([px, py], k) => <circle key={k} cx={px} cy={py} r={2.5} className="sa-dot" />)}
        {current !== null && <circle cx={x(dates[index])} cy={y(current)} r={5.5} className="sa-now" />}
        <text x={P.l} y={14} className="sa-unit">mm, cumulative</text>
      </svg>
    </div>
  );
}
