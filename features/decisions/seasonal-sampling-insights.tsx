"use client";
import { useState } from 'react';
import type { SeasonalSampling } from '@/lib/science-analytics';

const value=(n:number|null)=>n===null?'Unavailable':n.toLocaleString(undefined,{maximumSignificantDigits:4});

export function SeasonalSamplingInsights({sampling:s,unit}:{sampling:SeasonalSampling;unit:string}) {
  const [page,setPage]=useState(0),size=12;
  if(!s.yearCount)return null;
  const pages=Math.ceil(s.byYear.length/size),current=Math.min(page,pages-1);
  return <details className="seasonal-sampling">
    <summary>Does the way we sampled change the picture?</summary>
    <p>Earlier years were not necessarily observed equally often. The most sampled year supplies {value(s.maxYearSharePercent)}% of the readings used here.</p>
    {s.supported?<>
      <p>Using every reading, the seasonal middle value is <strong>{value(s.pooled.median)} {unit}</strong>. Giving each year&apos;s middle value equal weight, it is <strong>{value(s.yearBalanced.median)} {unit}</strong>.</p>
      {s.directionChanges&&<p role="note"><strong>The comparison changes with the sampling choice.</strong> The latest reading&apos;s position above, below or at the middle value differs. Inspect the observations before describing this as unusual.</p>}
      <p>Neither approach proves which years are representative. A year with few readings stays poorly observed, even when it gets equal weight.</p>
    </>:<p>There is too little earlier-season support for the two comparisons. Counts and dates below remain available.</p>}
    {pages>1&&<div className="table-pagination"><button type="button" disabled={current===0} onClick={()=>setPage(current-1)}>Previous years</button><span>Page {current+1} of {pages}</span><button type="button" disabled={current>=pages-1} onClick={()=>setPage(current+1)}>Next years</button></div>}
    <div className="decision-table"><table><caption>Earlier-season readings by year · ±30 calendar days from {s.targetDate}</caption><thead><tr><th>Year</th><th>Readings</th><th>Middle value ({unit})</th><th>Recorded dates</th></tr></thead><tbody>{s.byYear.slice(current*size,(current+1)*size).map(y=><tr key={y.year}><th scope="row">{y.year}</th><td>{y.count}{s.sparseYears.includes(y.year)?' · few readings':''}</td><td>{value(y.median)}</td><td><details><summary>{y.dates.length} dates</summary>{y.dates.join(', ')}</details></td></tr>)}</tbody></table></div>
    <details><summary>How this check works</summary><p>Latest recorded value: {value(s.targetValue)} {unit} on {s.targetDate}. Its sample percentile is {value(s.pooled.percentile)} using all readings and {value(s.yearBalanced.percentile)} using year medians. These describe different samples; they are not event probabilities.</p><ul>{s.notes.map(n=><li key={n}>{n}</li>)}</ul><p>{s.methodVersion}</p><code>Raw history SHA256: {s.inputHash}</code></details>
  </details>;
}
