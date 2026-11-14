"use client";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  Check,
  ChevronRight,
  Database,
  Download,
  ExternalLink,
  Info,
  Orbit,
  Pause,
  Play,
  Satellite,
  Waves,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { GeoMap, type RasterOverlay } from "@/features/catalog/geo-map";
import {
  PRODUCTS,
  REGIONS,
  formatBytes,
  utcTime,
  type Scene,
  type CatalogQuery,
} from "@/features/catalog/domain";
import { LabeledSlider } from "./snapshot-slider";
import { recordColor, recordTitle, water } from "./domain";
import { RadarComparisonForm } from "./radar-comparison-form";
import { RadarDetail } from "./radar-detail";
import type { ScienceModel } from "./use-science";
import { WaterHistory } from "./water-history";
import { historicalWaterPlainResult } from '@/lib/plain-language';
import { PlainLanguageResult } from '@/features/decisions/plain-language-result';
const AcquisitionChart = lazy(() =>
  import("@/features/catalog/acquisition-chart").then((m) => ({
    default: m.AcquisitionChart,
  })),
);
export function ScienceDetail({ model, onInvestigateRadar }: { model: ScienceModel; onInvestigateRadar?: (id: string) => void }) {
  if (model.comparisonDraft) return <RadarComparisonForm key={model.catalog.query.point ?? model.catalog.query.region} model={model} />;
  if (model.selected?.kind === "radar-change") return <RadarDetail key={model.selected.id} job={model.selected.job} model={model} onInvestigate={onInvestigateRadar} />;
  return <AcquisitionDetail model={model} />;
}
export function useAcquisitionPlayback(query: CatalogQuery, isWater: boolean, scene: Scene | null, timeline: Scene[], index: number, select: (id: string) => void) {
  const [playing, setPlaying] = useState(false);
  const [playbackContext, setPlaybackContext] = useState({ query, isWater });
  if (playbackContext.query !== query || playbackContext.isWater !== isWater) {
    setPlaybackContext({ query, isWater });
    if (playing && (isWater || playbackContext.query !== query)) setPlaying(false);
  }
  useEffect(() => {
    if (!playing || !scene || timeline.length < 2) return;
    const timer = setTimeout(() => {
      if (index >= timeline.length - 1) {
        setPlaying(false);
        return;
      }
      select(timeline[index + 1].id);
    }, 1200);
    return () => clearTimeout(timer);
  }, [playing, scene, timeline, index, select]);
  return { playing, setPlaying };
}

function AcquisitionDetail({ model }: { model: ScienceModel }) {
  const record = model.selected;
  const scene = record?.kind === "scene" ? record.scene : null;
  const isWater = record?.kind === "water";
  const [downloaded, setDownloaded] = useState(false);
  const timeline = useMemo(
    () =>
      model.visible
        .filter((r) => r.kind === "scene")
        .map((r) => r.scene)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [model.visible],
  );
  const index = Math.max(
    0,
    timeline.findIndex((s) => s.id === record?.id),
  );
  const raster = useMemo<RasterOverlay>(
    () => ({
      url: water.imageUrl,
      bounds: water.imageBounds as [[number, number], [number, number]],
    }),
    [],
  );
  const { playing, setPlaying } = useAcquisitionPlayback(model.catalog.query, Boolean(isWater), scene, timeline, index, model.select);
  if (!record)
    return (
      <div className="detail-empty">
        <Orbit size={44} />
        <h1>A new perspective awaits.</h1>
        <p>Adjust your data type or filters to explore an observation.</p>
      </div>
    );
  const color = recordColor(record);
  const title = recordTitle(record, model.catalog.query.region, model.catalog.query.point);
  const exportRecord = () => {
    const payload = isWater
      ? water
      : {
          schemaVersion: "1.0",
          kind: "catalog-acquisition",
          source: model.catalog.catalog?.source,
          retrievedAt: model.catalog.catalog?.retrievedAt,
          queryUrl: model.catalog.catalog?.queryUrl,
          scene,
          notice:
            "Actual acquisition metadata and footprint. No derived environmental change measurement.",
        };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `earthsignal-${record.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 1800);
  };
  return (
    <>
      <div className="detail-heading science-detail-heading">
        <div>
          <span className="eyebrow">
            {isWater
              ? "SURFACE WATER / OPTICAL CLASSIFICATION"
              : `${scene!.platform} / ${scene!.product} / ACQUISITION`}
          </span>
          <h1>{title}</h1>
          <p>
            {isWater
              ? "A water footprint, measured from classified pixels."
              : (PRODUCTS[scene!.product as keyof typeof PRODUCTS]
                  ?.description ??
                "Actual radar acquisition from the public archive.")}
          </p>
        </div>
        <div className="detail-actions">
          {scene?.product === "GCOV" && scene.platform === "NISAR" && <Button variant="outline" onClick={() => { model.chooseType("radar-change"); model.setComparisonDraft({beforeId: scene.id}); }}>Compare</Button>}
          <Button
            variant="outline"
            size="icon"
            aria-label="Save selected observation"
            aria-pressed={model.saved.includes(record.id)}
            onClick={() => model.toggleSaved(record.id)}
          >
            <Bookmark
              size={17}
              fill={model.saved.includes(record.id) ? "currentColor" : "none"}
            />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Export selected real observation"
            onClick={exportRecord}
          >
            {downloaded ? <Check size={17} /> : <Download size={17} />}
          </Button>
        </div>
      </div>
      <div className="science-detail-meta">
        <span className="source-pill">
          <span className="signal-dot" style={{ background: color }} />
          {isWater ? "Processed repository study" : scene!.maturity}
        </span>
        <span>
          {isWater ? "31 Mar 2023 · historical" : utcTime(scene!.startTime)}
        </span>
      </div>
      {isWater&&<PlainLanguageResult key={water.id} result={historicalWaterPlainResult(water)}/>}
      <GeoMap
        scenes={
          isWater
            ? []
            : model.mapRecords
                .filter((r) => r.kind === "scene")
                .map((r) => r.scene)
        }
        selectedId={record.id}
        onSelect={(id) => {
          setPlaying(false);
          if (model.selectedOutsideFilters && id === record.id) return;
          model.select(id);
        }}
        raster={isWater ? raster : undefined}
        color={color}
        focusBounds={
          isWater
            ? [
                [35.75, -115.1],
                [36.55, -114.25],
              ]
            : undefined
        }
      />
      {isWater ? (
        <div className="study-timeline">
          <span>
            <Database size={14} />
            Single historical mosaic
          </span>
          <strong>31 Mar 2023</strong>
          <span className="study-baseline">
            No change estimate from one snapshot
          </span>
        </div>
      ) : (
        <div className="timeline science-timeline">
          <div className="timeline-label">
            <span>
              <Satellite size={13} />
              Acquisition browser
            </span>
            <strong>
              {new Date(scene!.startTime).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
              })}
            </strong>
          </div>
          <div className="timeline-controls">
            <Button
              className="play-button"
              size="icon"
              aria-label={playing ? "Pause acquisitions" : "Play acquisitions"}
              aria-pressed={playing}
              disabled={timeline.length < 2}
              onClick={() => {
                if (!playing && index === timeline.length - 1)
                  model.select(timeline[0].id);
                setPlaying((p) => !p);
              }}
            >
              {playing ? (
                <Pause size={14} fill="currentColor" />
              ) : (
                <Play size={14} fill="currentColor" />
              )}
            </Button>
            {timeline.length > 1 ? (
              <LabeledSlider
                label="Acquisition snapshot"
                max={timeline.length - 1}
                value={index}
                onChange={(i) => {
                  setPlaying(false);
                  model.select(timeline[i].id);
                }}
              />
            ) : (
              <span className="filter-hint">
                One acquisition in this result
              </span>
            )}
            <span className="snapshot-count">
              {index + 1} / {timeline.length}
            </span>
          </div>
          <div className="timeline-dates">
            <span>{timeline[0]?.startTime.slice(0, 10)}</span>
            <span>{timeline.at(-1)?.startTime.slice(0, 10)}</span>
          </div>
        </div>
      )}
      <div className="metrics science-metrics">
        {isWater ? (
          <>
            <div>
              <span>Water class 1</span>
              <strong style={{ color }}>
                {water.openWaterClassAreaKm2.toFixed(1)}
                <small> km²</small>
              </strong>
              <em>Whole-source mosaic</em>
            </div>
            <div>
              <span>Class 2 footprint</span>
              <strong>
                {water.class2AreaKm2.toFixed(1)}
                <small> km²</small>
              </strong>
              <em>Not exact fractional water area</em>
            </div>
            <div>
              <span>Included pixels</span>
              <strong>
                {water.includedCoveragePercent.toFixed(1)}
                <small>%</small>
              </strong>
              <em>Codes 0, 1, 2</em>
            </div>
          </>
        ) : (
          <>
            <div>
              <span>Science file</span>
              <strong style={{ color }}>{formatBytes(scene!.fileBytes)}</strong>
              <em>Full product · not loaded here</em>
            </div>
            <div>
              <span>Track / frame</span>
              <strong>
                {scene!.path ?? "—"}
                <small> / {scene!.frame ?? "—"}</small>
              </strong>
              <em>{scene!.direction.toLowerCase()}</em>
            </div>
            <div>
              <span>Polarization</span>
              <strong className="product-value">
                {scene!.polarization.join(" / ") || "—"}
              </strong>
              <em>
                {scene!.product} · {scene!.platform}
              </em>
            </div>
          </>
        )}
      </div>
      {isWater && (
        <WaterHistory />
      )}
      <div className="insight scientific-insight">
        <div className="insight-heading">
          <span>
            <Orbit size={16} />
            {isWater
              ? "A footprint we can quantify."
              : "The science behind this signal."}
          </span>
          <span className="tiny-tag">{isWater ? "DERIVED" : "CATALOG"}</span>
        </div>
        <p>
          {isWater
            ? "Native 30 m pixels give an auditable area summary. This map zooms into Lake Mead; the totals cover the entire supplied mosaic, including water beyond the lake."
            : "The boundary shows where the sensor observed. Comparing compatible, quality-screened acquisitions could reveal change; a footprint or browse image alone is not a change measurement."}
        </p>
      </div>
      {scene?.browseUrl && (
        <Dialog>
          <DialogTrigger asChild>
            <Button className="radar-preview-trigger" variant="ghost">
              <span>
                {scene.thumbnailUrl && <img src={scene.thumbnailUrl} alt="" />}
                <span>
                  See through the radar
                  <small>Original ASF browse · {scene!.product}</small>
                </span>
              </span>
              <ChevronRight size={17} />
            </Button>
          </DialogTrigger>
          <DialogContent className="radar-dialog">
            <DialogHeader>
              <DialogTitle>Actual radar browse</DialogTitle>
              <DialogDescription>
                {utcTime(scene.startTime)} · {scene.product}. Display colors are
                not quantitative change metrics.
              </DialogDescription>
            </DialogHeader>
            <RadarImage scene={scene} />
            <a
              className="source-link"
              href={scene.browseUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open original image <ExternalLink size={13} />
            </a>
          </DialogContent>
        </Dialog>
      )}
      <Accordion type="multiple" className="science-evidence">
        <AccordionItem value="evidence">
          <AccordionTrigger>
            <span>
              <Database size={16} />
              Evidence & quality
            </span>
            <span className="accordion-summary">
              {isWater ? "30 m · reproducible" : scene!.maturity}
            </span>
          </AccordionTrigger>
          <AccordionContent>
            {isWater ? (
              <WaterEvidence />
            ) : (
              <SceneEvidence scene={scene!} model={model} />
            )}
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="method">
          <AccordionTrigger>
            <span>
              <Orbit size={16} />
              Processing & interpretation
            </span>
            <span className="accordion-summary">
              {isWater ? "Pixel area method" : "Product workflow"}
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="notice">
              <Info size={17} />
              <p>
                {isWater
                  ? water.caveat
                  : scene!.product === "GUNW"
                    ? "Interferometric displacement is along the radar’s line of sight. Reference choice, atmosphere, and coherence affect interpretation; it is not directly vertical sinking."
                    : scene!.product === "GOFF"
                      ? "Offsets need tracking quality and elapsed acquisition intervals before they can support velocity estimates."
                      : "Radar backscatter depends on geometry, moisture, roughness, and vegetation. A change in brightness does not independently establish flooding or deforestation."}
              </p>
            </div>
            <p className="next-copy">
              {isWater
                ? water.processing.method
                : "Scientific raster processing belongs upstream. The NISAR Cookbook and OPERA workflows provide product-specific loading, quality screening, and analysis; nisar-py can produce supported GCOV visualizations."}
            </p>
            <div className="science-resource-links">
              <a
                href={
                  isWater
                    ? water.source.notebook
                    : "https://github.com/ASFOpenSARlab/NISAR_Cookbook"
                }
                target="_blank"
                rel="noreferrer"
              >
                {isWater ? "OPERA processing notebook" : "NISAR Cookbook"}
                <ExternalLink size={12} />
              </a>
              {!isWater && (
                <a
                  href="https://github.com/ASFHyP3/nisar-py"
                  target="_blank"
                  rel="noreferrer"
                >
                  nisar-py
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
        {!isWater && (
          <AccordionItem value="history">
            <AccordionTrigger>
              <span>
                <Satellite size={16} />
                Acquisition context
              </span>
              <span className="accordion-summary">
                {timeline.length} products
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <p className="filter-hint">
                This browser can include different tracks, directions, or
                reprocessed versions. It is not an aligned scientific time
                series.
              </p>
              <Suspense fallback={<p>Loading acquisition summary…</p>}>
                <AcquisitionChart scenes={timeline} />
              </Suspense>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
      <footer className="detail-footer">
        <span>
          {isWater
            ? "OPERA · optical · historical"
            : "ASF / NASA Earthdata · actual acquisition"}
        </span>
        <span>
          {isWater ? "Source commit recorded" : "No derived hazard estimate"}
        </span>
      </footer>
    </>
  );
}
function RadarImage({ scene }: { scene: Scene }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <div className="empty-state">
      Browse unavailable. Open the original archive link to inspect access.
    </div>
  ) : (
    <img
      className="dialog-radar-image"
      src={scene.browseUrl!}
      alt={`${scene.platform} ${scene.product} radar browse`}
      onError={() => setFailed(true)}
    />
  );
}
function SceneEvidence({
  scene,
  model,
}: {
  scene: Scene;
  model: ScienceModel;
}) {
  return (
    <div className="evidence">
      <dl>
        {[
          ["Product ID", scene.id],
          ["Acquired", utcTime(scene.startTime)],
          ["Sensor / product", `${scene.platform} / ${scene.product}`],
          ["Maturity", scene.maturity],
          ["Processing version", scene.processorVersion ?? "Not provided"],
          ["Collection", scene.collection ?? "Not provided"],
          [
            "Retrieved",
            model.catalog.catalog
              ? utcTime(model.catalog.catalog.retrievedAt)
              : "—",
          ],
        ].map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="science-resource-links">
        {model.catalog.catalog && (
          <a
            href={model.catalog.catalog.queryUrl}
            target="_blank"
            rel="noreferrer"
          >
            Exact source query
            <ExternalLink size={12} />
          </a>
        )}
        {scene.qaUrl && (
          <a href={scene.qaUrl} target="_blank" rel="noreferrer">
            Product QA report
            <ExternalLink size={12} />
          </a>
        )}
        {scene.fileUrl && (
          <a href={scene.fileUrl} target="_blank" rel="noreferrer">
            Science file · {formatBytes(scene.fileBytes)}
            <Download size={12} />
          </a>
        )}
      </div>
      <p className="filter-hint">
        Science downloads may require NASA Earthdata sign-in. Catalog results
        are capped at 24; counts describe returned products.
      </p>
    </div>
  );
}
function WaterEvidence() {
  return (
    <div className="evidence">
      <dl>
        {[
          ["Source sensor", water.sensorFamily + " · not NISAR"],
          ["Snapshot date", water.dateBasis],
          ["Maturity", water.maturity],
          [
            "Native geometry",
            `${water.processing.nativeCrs} · 30 × 30 m · 900 m² per pixel`,
          ],
          ["Source commit", water.source.commit],
          ["SHA-256", water.source.sha256],
          [
            "Processing",
            `Rasterio ${water.processing.software.rasterio} · nearest-neighbour display reprojection`,
          ],
        ].map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <table>
        <caption>Actual class totals · entire supplied mosaic</caption>
        <thead>
          <tr>
            <th>Class</th>
            <th>Pixels</th>
            <th>Area (km²)</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(water.classes).map(([code, item]) => (
            <tr key={code}>
              <td>
                {code}
                {!["0", "1", "2"].includes(code) ? " · excluded" : ""}
              </td>
              <td>{item.pixels.toLocaleString("en-US")}</td>
              <td>{item.areaKm2.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="science-resource-links">
        <a href={water.source.url} target="_blank" rel="noreferrer">
          Exact GitHub source
          <ExternalLink size={12} />
        </a>
        <a href={water.rasterUrl} download>
          Source GeoTIFF
          <Download size={12} />
        </a>
        <a href="/data/processed-water.json" download>
          Processing record
          <Download size={12} />
        </a>
      </div>
    </div>
  );
}
