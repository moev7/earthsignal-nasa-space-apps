import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, ChevronDown, ChevronUp, Save, Loader2, AlertCircle } from "lucide-react";
import { DistributionChart, ChangeHistogram, TransectChart } from "./analysis-charts";
import type { useRadarAnalysis } from "./use-radar-analysis";
import { annotationRequestSchema } from "@/lib/analysis-contract";
import { RadarInspection } from "./radar-inspection";
import type { InspectionCandidate } from "@/lib/inspection-contract";

export function RadarAnalysis({ analysis, onInspect }: { analysis: ReturnType<typeof useRadarAnalysis>; onInspect?: (candidate: InspectionCandidate) => void }) {
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [annotationLabel, setAnnotationLabel] = useState<"water-change" | "vegetation-change" | "surface-change" | "artifact" | "uncertain">("water-change");
  const [annotationNote, setAnnotationNote] = useState("");

  const { status, result, error, thresholdDb, setThresholdDb, annotations, addAnnotation, annotationsStatus, annotationError, saving } = analysis;

  if (status === "loading" && !result) {
    return <div className="analysis-panel loading"><Loader2 className="animate-spin" /> Analyzing region...</div>;
  }
  if (status === "error") {
    return <div className="analysis-panel error" role="alert"><AlertCircle /> {error}<Button onClick={analysis.submitSelection}>Retry analysis</Button></div>;
  }
  if (!result) return null;

  const handleExportCSV = () => {
    const rows: unknown[][] = [["record", "field", "value", "units", "longitude", "latitude", "distance_m"]];
    rows.push(["provenance", "jobId", result.jobId], ["provenance", "selection", JSON.stringify(result.selection)]);
    Object.entries(result.provenance).forEach(([k,v]) => rows.push(["provenance", k, v]));
    if (result.inspectionWindows) {
      const { candidates, ...policy } = result.inspectionWindows;
      rows.push(["inspection-policy", "recorded-policy", JSON.stringify(policy)]);
      candidates.forEach((candidate, i) => rows.push(["inspection-window", `rank-${i + 1}`, JSON.stringify(candidate)]));
    }
    Object.entries(result.summary).forEach(([k,v]) => rows.push(["summary", k, v, k.endsWith("Db") ? "dB" : k.endsWith("Km2") ? "km2" : k.endsWith("M2") ? "m2" : ""]));
    Object.entries(result.distributions).forEach(([kind,h]) => h.counts.forEach((count,i) => rows.push(["histogram", kind, count, "pixels", "", "", "", h.edges[i], h.edges[i+1]])));
    const samples = [...(result.probe ? [{...result.probe, distanceM: null}] : []), ...result.transect];
    samples.forEach(p => ["beforeDb", "afterDb", "differenceDb", "valid", "reason"].forEach(k => rows.push(["sample", k, p[k as keyof typeof p], k.endsWith("Db") ? "dB" : "", ...p.coordinate, p.distanceM])));
    rows[0].push("bin_low_db", "bin_high_db");
    const csv = rows.map(row => row.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    downloadFile(csv, `analysis-${result.jobId}.csv`, "text/csv");
  };

  const handleExportJSON = () => {
    const payload = {
      ...result,
      annotations: annotations.map(a => ({
        ...a,
        claim: "Unverified human hypothesis",
        trainingReady: false
      }))
    };
    downloadFile(JSON.stringify(payload, null, 2), `analysis-${result.jobId}.json`, "application/json");
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onAnnotationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (annotationNote.trim().length === 0) return;
    const saved = await addAnnotation({
      label: annotationLabel,
      note: annotationNote,
      polygon: result.selection.polygon
    });
    if (saved) { setAnnotationNote(""); setAnnotationOpen(false); }
  };

  return (
    <div className="analysis-panel">
      <div className="analysis-header">
        <h3>Understand this region</h3>
        <div className="threshold-control">
          <label htmlFor="threshold">Threshold (dB): {thresholdDb.toFixed(1)}</label>
          <input
            id="threshold"
            type="range"
            min="0.1"
            max="30"
            step="0.1"
            value={thresholdDb}
            onChange={(e) => setThresholdDb(parseFloat(e.target.value))}

          />
          <Button size="sm" variant="outline" onClick={analysis.submitSelection}>Apply</Button>
        </div>
      </div>

      <div className="insight-card grounded-insight">
        <h4>{result.selection.polygon ? "Selected region" : "Full processed crop"} · ±{result.selection.thresholdDb} dB threshold</h4>
        <div className="grid-metrics">
          <div>
            <span>Valid Area</span>
            <strong>{result.summary.validAreaKm2.toFixed(3)} km²</strong>
          </div>
          <div>
            <span>Total Pixels</span>
            <strong>{result.summary.totalPixels.toLocaleString()}</strong>
          </div>
          <div>
            <span>Backscatter increased</span>
            <strong>{result.summary.increasedAreaKm2.toFixed(3)} km²</strong>
          </div>
          <div>
            <span>Backscatter decreased</span>
            <strong>{result.summary.decreasedAreaKm2.toFixed(3)} km²</strong>
          </div>
          <div>
            <span>Within ±{result.selection.thresholdDb} dB</span>
            <strong>{result.summary.withinThresholdAreaKm2.toFixed(3)} km²</strong>
          </div>
        </div>
        {result.insights.map((insight, idx) => (
          <p key={idx} className="insight-text">{insight}</p>
        ))}
      </div>

      <RadarInspection inspection={result.inspectionWindows} onInspect={onInspect} />

      {result.probe && (
        <div className="pixel-readout">
          <h4>Pixel Readout at {result.probe.coordinate[1].toFixed(5)}, {result.probe.coordinate[0].toFixed(5)}</h4>
          {result.probe.valid ? (
            <p>Before: {result.probe.beforeDb?.toFixed(2)} dB, After: {result.probe.afterDb?.toFixed(2)} dB, Change: {result.probe.differenceDb?.toFixed(2)} dB</p>
          ) : (
            <p className="invalid-reason">Invalid: {result.probe.reason}</p>
          )}
        </div>
      )}

      {result.transect && result.transect.length > 0 && (
        <div className="chart-section">
          <h4>Transect Profile</h4>
          <TransectChart transect={result.transect} />
        </div>
      )}

      <div className="chart-section">
        <h4>Backscatter Distributions</h4>
        <DistributionChart before={result.distributions.before} after={result.distributions.after} />
      </div>

      <div className="chart-section">
        <h4>Change Histogram</h4>
        <ChangeHistogram difference={result.distributions.difference} />
      </div>

      <div className="annotation-section">
        <Button variant="outline" size="sm" onClick={() => setAnnotationOpen(!annotationOpen)}>
          {annotationOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Annotations ({annotations.length})
        </Button>

        {annotationOpen && (
          <div className="annotation-form-container">
            <form onSubmit={onAnnotationSubmit}>
              <select
                aria-label="Hypothesis label"
                value={annotationLabel}
                onChange={(e) => setAnnotationLabel(annotationRequestSchema.shape.label.parse(e.target.value))}
                className="w-full mb-2 p-2 bg-black border border-gray-700"
              >
                <option value="water-change">Water change</option>
                <option value="vegetation-change">Vegetation change</option>
                <option value="surface-change">Surface change</option>
                <option value="artifact">Artifact</option>
                <option value="uncertain">Uncertain</option>
              </select>
              <textarea
                aria-label="Observation note"
                value={annotationNote}
                onChange={(e) => setAnnotationNote(e.target.value)}
                placeholder="Observation note..."
                className="w-full mb-2 p-2 bg-black border border-gray-700"
                required
                minLength={1}
                maxLength={1000}
              />
              <p className="text-xs text-gray-400 mb-2">Unverified human hypothesis. Not for training claims.</p>
              <Button type="submit" size="sm" disabled={saving || !annotationNote.trim()}>
                <Save size={14} className="mr-2" /> {saving ? "Saving…" : "Save annotation"}
              </Button>
            </form>

            {annotationError && <p role="alert">{annotationError} <Button size="sm" onClick={analysis.fetchAnnotations}>Reload notes</Button></p>}
            {annotationsStatus === "loading" && <p>Loading annotations...</p>}
            {annotations.length > 0 && (
              <ul className="annotation-list mt-4">
                {annotations.map(a => (
                  <li key={a.id} className="border-b border-gray-800 py-2">
                    <span className="font-bold text-xs uppercase text-gray-500">{a.label}</span>
                    <p className="text-sm">{a.note}</p>
                    <small className="text-gray-600">{new Date(a.createdAt).toLocaleString()} (v{a.version})</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <p className="filter-hint">Measurements: native pixels · {result.provenance.crs}. Backscatter change does not identify its cause. Pixel and transect probes use the full crop mask independently of a drawn region.</p>
      <div className="export-actions flex gap-2 mt-6">
        <Button variant="secondary" size="sm" onClick={handleExportCSV}>
          <Download size={14} className="mr-2" /> CSV
        </Button>
        <Button variant="secondary" size="sm" onClick={handleExportJSON}>
          <Download size={14} className="mr-2" /> JSON
        </Button>
      </div>
    </div>
  );
}
