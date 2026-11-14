import type { GaugeVintage } from '@/lib/gauge-vintage-contract';
import type { ForecastInformation } from '@/lib/forecast-information-contract';
import { ForecastInformationInsights } from './forecast-information-insights';
import { GaugeReceiptDownload } from './gauge-receipt-download';
import { summarizeGaugeQuality } from '@/lib/gauge-source-quality';
import { GaugeSourceQuality } from './gauge-source-quality';

export function GaugeVintageInsights({vintage,information,jobId,artifactExpiresAt}:{vintage:GaugeVintage;information?:ForecastInformation;jobId?:string|null;artifactExpiresAt?:string|null}) {
  if(vintage.status==='unavailable')return <details className="gauge-vintage"><summary>Was this data saved as we received it?</summary><p>We could not save this retrieval in the observation archive. The measurements remain available, but we cannot use this attempt as proof of what was available at an earlier forecast time.</p><p>Archive reason: {vintage.reason.replaceAll('_',' ')}.</p></details>;
  if(vintage.status==='referenced') {
    const s=vintage.snapshotRef;
    return <details className="gauge-vintage"><summary>Saved receipt · full snapshot stored separately</summary>
      <p>This retrieval was recorded on <time dateTime={s.issueTime}>{s.issueTime.slice(0,10)} at {s.issueTime.slice(11,19)} UTC</time>. Later corrections remain separate.</p>
      <p>{s.observationCount.toLocaleString()} recorded station-days; {s.unknownDays.toLocaleString()} days have no archived reading at this cutoff. {s.qualifiedRecords} days carry source flags; {s.withdrawnRecords} recorded values are unavailable.</p>
      <p>Receipt time does not establish earlier upstream availability. This record does not establish predictive accuracy.</p>
      {information&&<ForecastInformationInsights information={information}/>}
      <GaugeReceiptDownload key={`${jobId??''}:${vintage.artifact.sha256}`} vintage={vintage} jobId={jobId} artifactExpiresAt={artifactExpiresAt}/>
    </details>;
  }
  const s=vintage.snapshot;
  const qualified=s.observations.filter(r=>r.qualifiers.length>0);
  const withdrawn=s.observations.filter(r=>r.value===null).length;
  return <details className="gauge-vintage"><summary>Saved as we received it</summary>
    <p>This copy was received on <time dateTime={s.issueTime}>{s.issueTime.slice(0,10)} at {s.issueTime.slice(11,19)} UTC</time>. Later corrections can be kept separately without rewriting this copy.</p>
    <p>It contains {s.observations.length.toLocaleString()} recorded station-days; {s.unknownDays.toLocaleString()} days in the selected period have no archived observation at this cutoff. {withdrawn>0?`${withdrawn} recorded days have invalid or conflicting values; these remain unavailable.`:''}</p>
    <p><strong>We did not establish that these readings were available before their recorded receipt.</strong> Retrospective forecast tests may include later revisions. This archive does not establish predictive accuracy.</p>
    {qualified.length>0&&<p>{qualified.length} days carry source qualifiers, separate from approval status. Exact raw flags remain in the exported manifest.</p>}
    <GaugeSourceQuality summary={summarizeGaugeQuality(s)} basis="embedded" />
    {information&&<ForecastInformationInsights information={information}/>}
    <details><summary>Receipt and reproduction details</summary><p>{s.identity.station} · daily mean discharge · {s.identity.unit}. {vintage.receipt.insertedVersions} new versions and {vintage.receipt.unchangedRecords} unchanged records in this retrieval.</p><p>The full observation snapshot, source hashes, quality, station time metadata and first receipt times are included in the protected assessment manifest.</p><code>Snapshot SHA256: {s.snapshotHash}</code></details>
  </details>;
}
