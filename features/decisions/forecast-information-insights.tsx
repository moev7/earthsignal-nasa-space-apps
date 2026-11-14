import type { ForecastInformation } from '@/lib/forecast-information-contract';

export function ForecastInformationInsights({information:r}:{information:ForecastInformation}){
  const c=r.counts;
  const label={future:'Wholly after receipt cutoff',partly_elapsed:'Target had already started',expired:'Target had already ended',withheld:'Timing unresolved'};
  return <section className="forecast-information" aria-label="Station-day timing">
    <h5>Station-day timing</h5>
    <p>Timing only. This does not evaluate forecast skill or the complete forecast publication policy.</p>
    <div className="receipt-counts">
      <div><strong>{c.retainedRecords.toLocaleString()}</strong><span>Complete & recorded</span></div>
      <div><strong>{c.excludedRecords.toLocaleString()}</strong><span>Recorded but excluded</span></div>
      <div><strong>{c.unknownCalendarDays.toLocaleString()}</strong><span>No archived observation</span></div>
    </div>
    <p>{r.latestRetainedDate?<>Latest retained station-day: <strong>{r.latestRetainedDate}</strong>{r.stationTime.properties?.time_zone_abbreviation&&<> · recorded zone code {r.stationTime.properties.time_zone_abbreviation}</>}.</>:<>No completed, finite station-day could be retained at this cutoff.</>}</p>
    {c.excludedRecords>0&&<p>{c.nullWithdrawals} null or withdrawn · {c.incompleteAtIssue} incomplete at receipt · {c.unresolvedStationTime} unresolved station time. Unknown calendar days are counted separately; no values are interpolated.</p>}
    {r.reason==='mixed_station_metadata'&&<p>Retained records have different station time metadata. Target timing is withheld.</p>}
    <ul className="receipt-targets">{r.timingAttempts.map(a=><li key={a.horizonDays}>
      <span className="receipt-horizon">+{a.horizonDays} day{a.horizonDays===1?'':'s'}</span>
      <div><strong>{label[a.status]}</strong>{a.targetInterval&&<small>{a.targetInterval.date} · {a.targetInterval.durationHours===null?'station-day interval unresolved':`${a.targetInterval.durationHours}-hour station-day`}</small>}</div>
      {a.targetInterval?.startUtc&&a.targetInterval.endUtc&&<details><summary>Interval details</summary><p><time>{a.targetInterval.startUtc}</time> → <time>{a.targetInterval.endUtc}</time> UTC. Lead to start: {a.leadStartHours?.toLocaleString(undefined,{maximumFractionDigits:2})} hours from the recorded receipt cutoff.</p></details>}
    </li>)}</ul>
    <details><summary>Timing method and lineage</summary><p>{r.method} · {r.stationTime.ruleVersion}. The cutoff is {r.issueTime}. Station metadata is recorded as received; it does not prove historical configuration.</p><code>Information-set SHA256: {r.informationHash}</code></details>
  </section>;
}
