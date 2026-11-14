"use client";
import { Bar, BarChart, Cell, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Assessment } from '@/lib/observatory-contract';
type Trend=NonNullable<NonNullable<Assessment['series']>[number]['seasonalTrend']>;
const month=(n:number)=>new Date(Date.UTC(2000,n-1,1)).toLocaleString(undefined,{month:'short',timeZone:'UTC'});
const fmt=(n:number)=>n.toLocaleString(undefined,{maximumSignificantDigits:6});

export function SeasonalTrendInsights({trend}:{trend:Trend}) {
  return <section className="seasonal-trend" aria-label="Season-matched station analysis">
    <span className="eyebrow">DERIVED · DESCRIPTIVE ANALYSIS</span><h4>How has the same season changed?</h4>
    {trend.status==='withheld'?<><strong>Season-matched slope withheld</strong><p>{trend.reason}</p></>:<>
      <p>Matching the same calendar months across {trend.years.join(', ')} gives <strong>{fmt(trend.slope!)} {trend.unit}</strong>. This describes recorded monthly medians at this station; it does not project future flow.</p>
      <div className="monthly-slope-chart" role="img" aria-label="Descriptive slope for each common month; exact slopes and pair counts appear below.">
        <ResponsiveContainer width="100%" height={185}><BarChart data={trend.byMonth.map(m=>({...m,label:month(m.month)}))} margin={{left:4,right:8,top:8,bottom:8}}>
          <CartesianGrid stroke="#ffffff0b" vertical={false}/><XAxis dataKey="label" stroke="#929b8d" tick={{fontSize:10}}/><YAxis width={58} stroke="#929b8d" tick={{fontSize:10}}/>
          <ReferenceLine y={0} stroke="#b7bdb1"/><Tooltip content={({active,payload,label})=>active&&typeof payload?.[0]?.value==='number'?<div role="tooltip" style={{width:220,boxSizing:'border-box',padding:10,background:'#222426',color:'#e5e9df',border:'1px solid #50574b',fontSize:12,whiteSpace:'normal'}}><strong>{label}</strong><p>Descriptive slope<br/>{fmt(payload[0].value)} {trend.unit}</p></div>:null}/>
          <Bar dataKey="slope" name={`Descriptive slope (${trend.unit})`} isAnimationActive={false}>{trend.byMonth.map(m=><Cell key={m.month} fill={m.slope<0?'#bba0e8':'#b3f84c'}/>)}</Bar>
        </BarChart></ResponsiveContainer>
      </div>
      <div className="trend-sensitivity"><strong>Does one year change the result?</strong><p>Omitting each year in turn: {fmt(trend.sensitivityRange!.minimum)} → {fmt(trend.sensitivityRange!.maximum)} {trend.unit}. {trend.signStable?'The sign stays the same for these omissions.':'The sign changes for at least one omission; inspect the individual years.'} This is a sensitivity range, not a confidence interval or probability.</p></div>
      <details><summary>Exact monthly slopes and year sensitivity</summary><div className="decision-table"><table><caption>Same-month slopes · {trend.unit}</caption><thead><tr><th>Month</th><th>Median pair slope</th><th>Year pairs</th></tr></thead><tbody>{trend.byMonth.map(m=><tr key={m.month}><th scope="row">{month(m.month)}</th><td>{String(m.slope)}</td><td>{m.pairCount}</td></tr>)}</tbody></table><table><caption>Leave-one-year-out · same common months</caption><thead><tr><th>Omitted year</th><th>Recalculated slope ({trend.unit})</th></tr></thead><tbody>{trend.leaveYearOut.map(v=><tr key={v.omittedYear}><th scope="row">{v.omittedYear}</th><td>{String(v.slope)}</td></tr>)}</tbody></table></div></details>
    </>}
    <details><summary>Which months and observations qualify?</summary><p>{trend.reason}</p><div className="decision-table"><table><caption>Calendar-month coverage and exclusions</caption><thead><tr><th>Month</th><th>Approved / calendar days</th><th>Longest excluded run</th><th>Included in slope</th><th>Median (ft³/s)</th></tr></thead><tbody>{trend.months.map(m=><tr key={`${m.year}-${m.month}`}><th scope="row">{m.year}-{String(m.month).padStart(2,'0')}</th><td>{m.approvedDays} / {m.calendarDays}</td><td>{m.longestExcludedRun} recorded days</td><td>{trend.status==='descriptive'&&trend.years.includes(m.year)&&trend.commonMonths.includes(m.month)?'Yes':!m.complete?'No · partial month':!m.eligible?'No · insufficient approved days':'No · outside common seasons'}</td><td>{m.median===null?'Withheld':String(m.median)}</td></tr>)}</tbody></table></div></details>
    <details><summary>Method, limitations and reproducibility</summary><p>{trend.methodVersion} · {trend.pairCount} correlated same-month/year pairs. Pair count is not independent sample size.</p><ul>{trend.notes.map(n=><li key={n}>{n}</li>)}</ul>{trend.references.map(url=><a key={url} href={url} target="_blank" rel="noreferrer">USGS statistical methods · seasonal slopes</a>)}<p><code>Input SHA256: {trend.inputHash}</code></p></details>
  </section>;
}
