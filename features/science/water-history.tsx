"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, ArrowDownToLine, ChartNoAxesCombined, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { analyzeHistory, chartHistory, historySchema, type WaterHistoryData } from "@/lib/water-history";
import { WaterSamplingDemo } from "./water-sampling-demo";

function saveFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fmt = (value: number | null | undefined, precision = 2) => value == null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: precision, minimumFractionDigits: precision });
const stamp = (date: string) => Date.parse(`${date}T00:00:00Z`);
const tick = (date: number) => new Date(date).toISOString().slice(0, 10);
const tooltipStyle = { background: "#202724", border: "1px solid #536348", borderRadius: 10, color: "#eef5e8", fontSize: 11 };

export function WaterHistory() {
  const [history, setHistory] = useState<WaterHistoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [cutoff, setCutoff] = useState("");
  const [span, setSpan] = useState("365");
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/data/water-history.json", { signal: abort.signal })
      .then(r => { if (!r.ok) throw new Error("Historical measurements are unavailable."); return r.json(); })
      .then(raw => { const data = historySchema.parse(raw); if (!abort.signal.aborted) { setHistory(data); setCutoff(data.dateRange[1]); } })
      .catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load the historical series."); });
    return () => abort.abort();
  }, [attempt]);
  useEffect(() => {
    const focus = () => { section.current?.scrollIntoView({ behavior: "smooth", block: "start" }); section.current?.focus({ preventScroll: true }); };
    window.addEventListener("earthsignal:water-history", focus);
    return () => window.removeEventListener("earthsignal:water-history", focus);
  }, []);
  const analysis = useMemo(() => history ? analyzeHistory(history.points, cutoff) : null, [history, cutoff]);
  const selected = useMemo(() => history?.points.filter(p => p.date <= cutoff && (span === "all" || stamp(p.date) >= stamp(cutoff) - Number(span) * 86400000)) ?? [], [history, cutoff, span]);
  const plotted = useMemo(() => {
    const observed = chartHistory(selected).map(p => ({ t: stamp(p.date), observed: p.value as number | null }));
    const first = selected[0]?.date;
    for (const date of history?.missingDates ?? []) if (first && date >= first && date <= cutoff) observed.push({ t: stamp(date), observed: null });
    return observed.sort((a,b) => a.t-b.t);
  }, [history, selected, cutoff]);
  const projected = useMemo(() => [
    ...selected.slice(-28).map(p => ({ t: stamp(p.date), observed: p.value })),
    ...(analysis?.forecast ?? []).map(p => ({ t: stamp(p.date), predicted: p.predicted, band: [p.lower, p.upper] })),
  ], [selected, analysis]);
  const exportCsv = () => {
    if (!history || !analysis) return;
    const rows = ["date,kind,elevation_ft,lower_ft,upper_ft,source_sha256,model",
      ...selected.map(p => `${p.date},observed,${p.value},,,${history.source.sha256},`),
      ...analysis.forecast.map(p => `${p.date},predicted,${p.predicted},${p.lower},${p.upper},${history.source.sha256},local-linear-28d-v1`)];
    saveFile(`lake-mead-history-${cutoff}.csv`, rows.join("\n"), "text/csv");
  };
  return <section ref={section} tabIndex={-1} id="water-history" className="water-history" aria-label="Water history and forecast experiments">
    <div className="water-history-heading"><div><span className="eyebrow">OBSERVED · HISTORICAL GAUGE</span><h2><Activity size={19}/> Water over time</h2></div><span className="water-history-chip">Lake Mead</span></div>
    <p className="water-history-intro">Explore reservoir elevation through time. These gauge measurements complement the satellite water map; they measure a different quantity.</p>
    {error ? <div role="alert">{error} <Button variant="outline" size="sm" onClick={() => { setError(null); setAttempt(n => n+1); }}>Retry history</Button></div> : !history || !analysis ? <p role="status">Loading verified observations…</p> : <>
      <div className="water-history-controls">
        <label>Historical cutoff<input aria-label="Historical forecast cutoff" type="date" min={history.dateRange[0]} max={history.dateRange[1]} value={cutoff} onInput={e=>setCutoff(e.currentTarget.value)} onChange={e=>setCutoff(e.target.value)}/></label>
        <label>Chart window<select aria-label="Water history chart window" value={span} onChange={e=>setSpan(e.target.value)}><option value="365">Past year</option><option value="1826">Past 5 years</option><option value="all">All observations</option></select></label>
        <Button variant="outline" size="sm" onClick={exportCsv}><ArrowDownToLine size={14}/> CSV</Button>
      </div>
      <div className="water-history-metrics"><div><strong>{fmt(analysis.latest?.value)}<small> ft</small></strong><span>Observed {analysis.latest?.date}</span></div><div><strong>{fmt(analysis.change30Days)}<small> ft</small></strong><span>30-day change</span></div><div><strong>{selected.length.toLocaleString()}</strong><span>Daily readings in window</span></div></div>
      <div className="water-history-chart" role="img" aria-label={`Observed reservoir elevation in feet, ${selected[0]?.date} to ${analysis.latest?.date}. CSV contains exact readings.`}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{width:400,height:210}}><ComposedChart data={plotted} margin={{top:10,right:16,left:0,bottom:8}}><CartesianGrid stroke="#ffffff0b" vertical={false}/><XAxis dataKey="t" type="number" domain={["dataMin","dataMax"]} tickFormatter={v=>tick(v).slice(0,7)} tick={{fontSize:10,fill:"#9fac95"}} minTickGap={45}/><YAxis domain={["auto","auto"]} width={52} tick={{fontSize:10,fill:"#9fac95"}} tickFormatter={v=>fmt(v,0)}/><Tooltip contentStyle={tooltipStyle} labelFormatter={v=>tick(Number(v))} formatter={v=>[`${fmt(Number(v))} ft`,"Observed"]}/><Line dataKey="observed" type="linear" stroke="#65c9ff" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false}/></ComposedChart></ResponsiveContainer>
      </div>
      <p className="water-history-caption">Observed elevation · ft · {history.dateRange[0]}–{history.dateRange[1]}. Dense chart views retain extrema; exports retain all selected readings. Missing readings stay excluded.</p>
      <WaterSamplingDemo />
      <details className="water-forecast">
        <summary><span><FlaskConical size={17}/> Forecast experiment</span><span className="water-history-chip">{analysis.status === "ready" ? "Validation passed" : "Forecast withheld"}</span></summary>
        <p>Fit the preceding 28 daily observations and project seven days from the selected historical cutoff. This is a retrospective experiment, not a forecast for today.</p>
        {analysis.metrics && <div className="water-history-metrics"><div><strong>{fmt(analysis.metrics.modelMae,3)}<small> ft</small></strong><span>Held-out mean absolute error</span></div><div><strong>{fmt(analysis.metrics.baselineMae,3)}<small> ft</small></strong><span>Persistence baseline error</span></div><div><strong>{fmt(analysis.metrics.bandCoveragePercent,1)}<small>%</small></strong><span>Held-out band coverage</span></div></div>}
        <p role="status" className="water-forecast-status">{analysis.reason}</p>
        {analysis.status === "ready" && <>
          <div className="water-history-chart" role="img" aria-label="Historical seven-day projection with empirical error bands"><ResponsiveContainer width="100%" height="100%" initialDimension={{width:400,height:210}}><ComposedChart data={projected} margin={{top:10,right:16,left:0,bottom:8}}><CartesianGrid stroke="#ffffff0b" vertical={false}/><XAxis dataKey="t" type="number" domain={["dataMin","dataMax"]} tickFormatter={v=>tick(v).slice(5)} tick={{fontSize:10,fill:"#9fac95"}} minTickGap={35}/><YAxis domain={["auto","auto"]} width={52} tick={{fontSize:10,fill:"#9fac95"}} tickFormatter={v=>fmt(v,1)}/><Tooltip contentStyle={tooltipStyle} labelFormatter={v=>tick(Number(v))}/><Area dataKey="band" name="Empirical error band (ft)" fill="#b3f84c" fillOpacity={0.12} stroke="none" isAnimationActive={false}/><Line dataKey="observed" name="Observed (ft)" stroke="#65c9ff" dot={false} isAnimationActive={false}/><Line dataKey="predicted" name="Predicted (ft)" stroke="#b3f84c" strokeDasharray="5 4" dot={{r:3}} isAnimationActive={false}/></ComposedChart></ResponsiveContainer></div>
          <p className="water-history-caption">Blue: observed · Lime dashed: predicted · Shading: empirical error band.</p>
          <details><summary>Exact predicted values</summary><div className="water-history-table"><table><thead><tr><th>Date</th><th>Predicted ft</th><th>Lower ft</th><th>Upper ft</th></tr></thead><tbody>{analysis.forecast.map(p=><tr key={p.date}><td>{p.date}</td><td>{fmt(p.predicted)}</td><td>{fmt(p.lower)}</td><td>{fmt(p.upper)}</td></tr>)}</tbody></table></div></details>
        </>}
        <details><summary><ChartNoAxesCombined size={14}/> Model evidence & learning</summary><p>{analysis.method}. Twenty earlier weekly origins calibrate horizon-specific empirical 90% absolute-error bands; twelve later weekly origins test 84 unseen daily readings. Every fit uses only measurements available at its origin. Persistence predicts the origin&apos;s last measured value. Publication requires ≥10% lower mean absolute error than persistence and ≥75% validation band coverage.</p><p>Reservoir operations and weather can change the trajectory. These time-series fits learn a recent slope, not the physical causes of water change. Error bands do not guarantee future coverage. Model selection uses this historical validation window; prospective performance remains untested.</p><Button size="sm" variant="outline" onClick={()=>saveFile(`lake-mead-model-${cutoff}.json`, JSON.stringify({ ...analysis, source:history.source },null,2),"application/json")}>Export model & validation evidence</Button></details>
      </details>
      <details className="water-history-evidence"><summary>Measurement provenance</summary><p>{history.notice}</p><p>{history.points.length.toLocaleString()} observed readings; {history.missingDates.length} missing source readings; no imputation. Series {history.source.seriesId}, database {history.source.database}.</p><a href={history.source.url} target="_blank" rel="noreferrer">Exact pinned source</a><p className="water-source-hash">SHA-256 {history.source.sha256}</p></details>
    </>}
  </section>;
}
