import type { GaugeQualitySummary } from "@/lib/gauge-source-quality";

const PREVIEW_LABELS = 8;

function SourceLabels({ title, labels, records }: { title: string; labels: GaugeQualitySummary["approvalCounts"]; records: number }) {
  return <div className="gauge-quality-labels">
    <h5>{title}</h5>
    {labels.slice(0, PREVIEW_LABELS).map(({ label, records: count }) => <div className="gauge-quality-row" key={label}>
      <div><code>{label}</code><span>{count.toLocaleString()} <small>records</small></span></div>
      <div className="gauge-quality-track" aria-hidden="true"><span style={{ width: `${records ? count / records * 100 : 0}%` }} /></div>
    </div>)}
    {labels.length === 0 && title === "Approval labels" && <p>No approval labels were recorded in this snapshot.</p>}
    {labels.length > PREVIEW_LABELS && <p>Showing {PREVIEW_LABELS} of {labels.length.toLocaleString()} distinct labels. Counts cover all records; the full receipt contains the remaining labels.</p>}
  </div>;
}

/** Descriptive source annotations only; never a scientific admission or confidence score. */
export function GaugeSourceQuality({ summary, basis }: { summary: GaugeQualitySummary; basis: "embedded" | "file" }) {
  const counts = [
    ["Snapshot records", summary.records], ["With numeric values", summary.numericRecords],
    ["Without numeric values", summary.nullRecords], ["Calendar days without records", summary.missingDays],
  ] as const;
  return <section className="gauge-source-quality" aria-label="Received snapshot source profile">
    <header><h4>Source profile</h4><span>{basis === "file" ? "From the checked file" : "From the embedded receipt"}</span></header>
    <dl className="gauge-quality-counts">{counts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value.toLocaleString()}</dd></div>)}</dl>
    <div className="gauge-quality-groups">
      <SourceLabels title="Approval labels" labels={summary.approvalCounts} records={summary.records} />
      <div><SourceLabels title="Source flags" labels={summary.flagCounts} records={summary.records} />
        <p>{summary.qualifiedRecords.toLocaleString()} of {summary.records.toLocaleString()} records carry flags. A record can be approved and flagged, or carry more than one flag.</p>
        {summary.flagCounts.length === 0 && <p>No source flags were recorded in this snapshot.</p>}
      </div>
    </div>
    <p>Labels are shown as stored in this snapshot. Approval and flags do not measure accuracy or establish forecast readiness. Missing days and null values remain separate.</p>
    <a href="https://api.waterdata.usgs.gov/ogcapi/v1/collections/daily/schema" target="_blank" rel="noreferrer">USGS field definitions ↗</a>
  </section>;
}
