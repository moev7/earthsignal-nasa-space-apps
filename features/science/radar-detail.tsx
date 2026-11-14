import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { GeoMap } from "@/features/catalog/geo-map";
import { artifactUrl, type ChangeJob } from "@/lib/radar-contract";
import type { ScienceModel } from "./use-science";
import { useRadarAnalysis } from "./use-radar-analysis";
import { RadarAnalysis } from "./radar-analysis";
import { Crosshair, Pentagon, Ruler, X } from "lucide-react";
import { radarPlainResult } from '@/lib/plain-language';
import { PlainLanguageResult } from '@/features/decisions/plain-language-result';
import type { InspectionCandidate } from "@/lib/inspection-contract";

export function RadarHistory({ model }: { model: ScienceModel }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const action = async (job: ChangeJob, cancel: boolean) => {
    setBusy(job.id);
    setError(null);
    try {
      if (cancel) await model.radarJobs.cancelJob(job.id);
      else
        await model.radarJobs.submitJob({
          beforeId: job.beforeId,
          afterId: job.afterId,
          bbox: job.bbox,
        });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Job request failed.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="radar-history" aria-label="Processing job history">
      <div className="section-heading">
        <h3>Processing history</h3>
        <Button size="sm" variant="ghost" onClick={model.radarJobs.refresh}>
          Refresh
        </Button>
      </div>
      <p role="status">
        {model.radarJobs.error ??
          model.radarJobs.capability?.message ??
          "Checking processing access…"}
      </p>
      {error && <p role="alert">{error}</p>}
      {!model.radarJobs.jobs.length && model.radarJobs.status === "ready" && (
        <p>
          No processing jobs yet. The prepared study will appear after real data
          is verified.
        </p>
      )}
      <ul>
        {model.radarJobs.jobs.map((job) => (
          <li key={job.id}>
            <strong>
              {job.prepared ? "Prepared study" : "Your comparison"} ·{" "}
              {job.status}
            </strong>
            <span>
              {new Date(job.createdAt).toLocaleString()} · {job.phase}
            </span>
            <small>
              {job.beforeId} → {job.afterId}
            </small>
            {job.error && (
              <p role="alert">
                {job.error.code}: {job.error.message}
              </p>
            )}
            {(job.status === "queued" || job.status === "running") &&
              !job.prepared && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy === job.id}
                  onClick={() => action(job, true)}
                >
                  Cancel job
                </Button>
              )}
            {(job.status === "failed" || job.status === "cancelled") &&
              !job.prepared && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    !!busy ||
                    model.radarJobs.submitting ||
                    !model.radarJobs.capability?.ready
                  }
                  onClick={() => action(job, false)}
                >
                  Submit again
                </Button>
              )}
            {job.result && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    model.chooseType("radar-change");
                    model.catalog.setQuery({
                      ...model.catalog.query,
                      region: "global",
                      product: "GCOV",
                      start: job.result!.before.acquiredAt.slice(0, 10),
                      end: job.result!.after.acquiredAt.slice(0, 10),
                    });
                    model.select(job.id);
                  }}
                >
                  View result
                </Button>
                <a
                  href={artifactUrl(job.id, "manifest.json")}
                  target="_blank"
                  rel="noreferrer"
                >
                  Result provenance
                </a>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RadarDetail({
  job,
  model,
  onInvestigate,
}: {
  job: ChangeJob;
  model: ScienceModel;
  onInvestigate?: (id: string) => void;
}) {
  const [layer, setLayer] = useState<
    "before" | "after" | "difference" | "excluded"
  >("difference");
  const analysis = useRadarAnalysis(job.id);
  const inspectionMap = useRef<HTMLDivElement>(null);
  const [inspectionFocus, setInspectionFocus] = useState<{ coordinate: [number, number]; nonce: number } | null>(null);
  const inspect = (candidate: InspectionCandidate) => {
    const coordinate = candidate.representative.coordinate;
    if (!coordinate) return;
    setTransectClick(null);
    setInspectionFocus(previous => ({ coordinate, nonce: (previous?.nonce ?? 0) + 1 }));
    analysis.inspectCoordinate(coordinate);
    requestAnimationFrame(() => { inspectionMap.current?.focus({ preventScroll: true }); inspectionMap.current?.scrollIntoView({ block: "start" }); });
  };
  useEffect(() => {
    const clear = () => setInspectionFocus(null);
    window.addEventListener("earthsignal-auth-changed", clear);
    return () => window.removeEventListener("earthsignal-auth-changed", clear);
  }, []);

  const [transectClick, setTransectClick] = useState<[number, number] | null>(null);
  const chooseMode = (mode: "point" | "polygon" | "transect" | null) => {
    setTransectClick(null);
    analysis.setMode(mode);
    analysis.setPoint(null); analysis.setPolygon([]); analysis.setTransect(null);
  };
  const wrappedMapClick = (coord: [number, number]) => {
    if (analysis.mode === "point") {
      analysis.setPoint(coord); analysis.setMode(null);
      void analysis.fetchAnalysis({ thresholdDb: analysis.thresholdDb, point: coord });
    } else if (analysis.mode === "transect") {
      if (!transectClick) setTransectClick(coord);
      else {
        const line: [[number, number], [number, number]] = [transectClick, coord];
        analysis.setTransect(line); setTransectClick(null); analysis.setMode(null);
        void analysis.fetchAnalysis({ thresholdDb: analysis.thresholdDb, transect: line });
      }
    } else if (analysis.mode === "polygon" && analysis.polygon.length < 64) {
      analysis.setPolygon([...analysis.polygon, coord]);
    }
  };
  useEffect(() => {
    const handleMode = (e: Event) => {
      const mode = (e as CustomEvent).detail;
      if (["point", "polygon", "transect"].includes(mode)) chooseMode(mode);
    };
    window.addEventListener("earthsignal:radar-analysis-mode", handleMode);
    return () => window.removeEventListener("earthsignal:radar-analysis-mode", handleMode);
  });

  const result = job.result;
  if (!result)
    return (
      <p role="status">
        {job.status} · {job.phase}
      </p>
    );
  const { stats, coverage, display, crop, processing } = result;
  const legend =
    layer === "difference" ? (
      <>
        <span style={{ background: "#254af5" }} />−
        {display.differenceLimitDb.toFixed(1)}{" "}
        <span style={{ background: "#f5f5f5" }} />0{" "}
        <span style={{ background: "#f54a3f" }} />+
        {display.differenceLimitDb.toFixed(1)} dB
      </>
    ) : layer === "excluded" ? (
      <>
        <span style={{ background: "#f59e0b" }} />
        Excluded from common-valid intersection
      </>
    ) : (
      <>
        <span style={{ background: "#000" }} />
        {display.backscatterMinDb.toFixed(1)}{" "}
        <span style={{ background: "#fff" }} />
        {display.backscatterMaxDb.toFixed(1)} dB γ⁰
      </>
    );
  return (
    <>
      <div className="detail-heading science-detail-heading">
        <div>
          <span className="eyebrow">NISAR / GCOV / BACKSCATTER DIFFERENCE</span>
          <h1>{result.title}</h1>
          <p>
            {result.before.acquiredAt.slice(0, 10)} →{" "}
            {result.after.acquiredAt.slice(0, 10)} · Frequency A · HH (HHHH)
          </p>
        </div>
        <Button
          variant="outline"
          aria-pressed={model.saved.includes(job.id)}
          onClick={() => model.toggleSaved(job.id)}
        >
          Save
        </Button>
      </div>
      <PlainLanguageResult key={job.id} result={radarPlainResult(result)}/>
      {onInvestigate && <Button className="radar-investigate" onClick={() => onInvestigate(job.id)}>Investigate environmental context →</Button>}
      <div className="radar-layer-controls" aria-label="Radar display layer">
        <div className="layer-group">
          {(["before", "after", "difference", "excluded"] as const).map(
            (name) => (
              <Button
                key={name}
                variant={layer === name ? "default" : "outline"}
                size="sm"
                aria-pressed={layer === name}
                onClick={() => setLayer(name)}
              >
                {name === "excluded"
                  ? "Excluded pixels"
                  : name[0].toUpperCase() + name.slice(1)}
              </Button>
            ),
          )}
        </div>
        <div className="toolstrip">
          <Button
            variant={analysis.mode === "point" ? "default" : "outline"}
            size="sm"
            onClick={() => chooseMode(analysis.mode === "point" ? null : "point")}
          >
            <Crosshair size={14} /> Inspect pixel
          </Button>
          <Button
            variant={analysis.mode === "polygon" ? "default" : "outline"}
            size="sm"
            onClick={() => chooseMode(analysis.mode === "polygon" ? null : "polygon")}
          >
            <Pentagon size={14} /> Draw region
          </Button>
          {analysis.mode === "polygon" && (
            <Button
              variant="default"
              size="sm"
              disabled={analysis.polygon.length < 3}
              onClick={() => {
                analysis.setMode(null);
                analysis.submitSelection();
              }}
            >
              Finish region
            </Button>
          )}
          <Button
            variant={analysis.mode === "transect" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setTransectClick(null);
              chooseMode(analysis.mode === "transect" ? null : "transect");
            }}
          >
            <Ruler size={14} /> Draw transect
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!analysis.point && analysis.polygon.length === 0 && !analysis.transect && analysis.thresholdDb === 3}
            onClick={() => {
              setTransectClick(null);
              setInspectionFocus(null);
              analysis.setThresholdDb(3);
              analysis.clearSelection();
            }}
          >
            <X size={14} /> Reset
          </Button>
        </div>
      </div>
      <div className="radar-inspection-map" ref={inspectionMap} tabIndex={-1} aria-label="Radar inspection map">
      <GeoMap
        viewKey={inspectionFocus ? `${job.id}:inspection:${inspectionFocus.nonce}` : job.id}
        focusBounds={inspectionFocus ? [[inspectionFocus.coordinate[1], inspectionFocus.coordinate[0]], [inspectionFocus.coordinate[1], inspectionFocus.coordinate[0]]] : undefined}
        raster={{
          url: artifactUrl(job.id, result.layers[layer]),
          bounds: crop.imageBounds,
          label:
            layer === "difference"
              ? "After − before · dB"
              : layer === "excluded"
                ? "Excluded pixels"
                : `${layer} · gamma-zero dB`,
          ariaLabel: `Georeferenced radar ${layer} map`,
          legend,
        }}
        color="#ff3366"
        drawingMode={analysis.mode}
        maxFitZoom={17}
        point={transectClick ?? analysis.point}
        polygon={analysis.polygon}
        transect={analysis.transect}
        onMapClick={wrappedMapClick}
      />
      </div>
      <p className="filter-hint">
        Before and after use the same brightness scale. Difference uses a
        symmetric scale centred at zero. Preview pixels are display
        reprojections; measurements use the native grid.
      </p>

      <RadarAnalysis analysis={analysis} onInspect={inspect} />

      <div className="science-metrics">
        <div>
          <strong>
            {stats.medianDb.toFixed(3)}
            <small> dB</small>
          </strong>
          <span>Median backscatter difference</span>
        </div>
        <div>
          <strong>
            {coverage.commonValidPercent.toFixed(1)}
            <small>%</small>
          </strong>
          <span>Common-valid / native window</span>
        </div>
        <div>
          <strong>
            {coverage.validAreaKm2.toFixed(3)}
            <small> km²</small>
          </strong>
          <span>Native valid pixel area</span>
        </div>
      </div>
      <p className="filter-hint">
        Coverage counts the rectangular native window, including padding. It
        does not measure missing observations inside your selected area.
        Areas are nominal projected pixel areas.
      </p>
      <div className="notice">
        <p>{result.notice}</p>
      </div>
      <section
        className="evidence radar-evidence"
        aria-label="Coverage and provenance"
      >
        <h3>Coverage and provenance</h3>
        <dl>
          {[
            [
              "Difference percentiles",
              `P05 ${stats.p05Db.toFixed(3)} dB · P95 ${stats.p95Db.toFixed(3)} dB`,
            ],
            [
              "Native crop",
              `${crop.width} × ${crop.height} · ${crop.crs} · ${crop.resolution.join(" × ")} m`,
            ],
            ["Crop W/S/E/N", crop.bbox.join(", ")],
            [
              "Before valid",
              `${coverage.beforeValidPixels.toLocaleString()} / ${coverage.totalPixels.toLocaleString()} (${((100 * coverage.beforeValidPixels) / coverage.totalPixels).toFixed(1)}%)`,
            ],
            [
              "After valid",
              `${coverage.afterValidPixels.toLocaleString()} / ${coverage.totalPixels.toLocaleString()} (${((100 * coverage.afterValidPixels) / coverage.totalPixels).toFixed(1)}%)`,
            ],
            [
              "Common valid",
              `${coverage.commonValidPixels.toLocaleString()} / ${coverage.totalPixels.toLocaleString()}`,
            ],
            ["Before source", result.before.id],
            ["After source", result.after.id],
            [
              "Acquisition context",
              `Track ${result.before.track} · frame ${result.before.frame} · ${result.before.direction} · ${result.before.mode}`,
            ],
            [
              "Processing release",
              `${result.before.release} · ${result.before.collection}`,
            ],
            ["Masks", processing.maskPolicy],
            ["Method", processing.method],
            ["Algorithm", processing.algorithmVersion],
            ["Before input SHA-256", processing.beforeSha256],
            ["After input SHA-256", processing.afterSha256],
            ["Processed", processing.processedAt],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="science-resource-links">
          {result.artifacts.map((name) => (
            <a
              key={name}
              href={artifactUrl(job.id, name)}
              target="_blank"
              rel="noreferrer"
            >
              {name.endsWith(".tif")
                ? "GeoTIFF"
                : name === "manifest.json"
                  ? "Provenance"
                  : "Preview"}{" "}
              · {name}
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
