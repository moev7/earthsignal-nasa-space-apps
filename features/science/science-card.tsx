"use client";
import { Bookmark, Satellite, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes, type CatalogQuery } from "@/features/catalog/domain";
import { recordColor, recordTitle, water, type ScienceRecord } from "./domain";
export function ScienceCard({
  record,
  region,
  point,
  selected,
  saved,
  onSelect,
  onSave,
}: {
  record: ScienceRecord;
  region: CatalogQuery["region"];
  point?: string;
  selected: boolean;
  saved: boolean;
  onSelect: () => void;
  onSave: () => void;
}) {
  const isWater = record.kind === "water";
  const isChange = record.kind === "radar-change";
  const scene = record.kind === "scene" ? record.scene : null;
  const color = recordColor(record);
  const date = isWater ? water.date : isChange ? (record.job.result?.after.acquiredAt ?? record.job.createdAt) : scene!.startTime;
  const dateLabel = new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <article
      className={`observation-card science-card ${selected ? "selected" : ""}`}
      style={{ "--signal": color } as React.CSSProperties}
    >
      <button
        className="card-select"
        aria-label={`Inspect ${recordTitle(record, region, point)} ${isWater ? "water study" : isChange ? "radar comparison " + record.job.status + " " + dateLabel : scene!.product + " " + dateLabel}`}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <div className="card-top">
          <span>
            {isWater ? <Waves size={16} /> : isChange ? <Satellite size={16} /> : <Satellite size={16} />}{" "}
            {isWater ? "Surface water" : isChange ? "Radar comparison" : scene!.platform + " · " + scene!.product}
          </span>
          <span className="card-sample">{isWater || isChange ? "DERIVED" : "REAL"}</span>
        </div>
        <h3>{recordTitle(record, region, point)}</h3>
        <p>
          {dateLabel}{" "}
          {scene ? `· ${scene.direction.toLowerCase()}` : isChange ? (record.job.result ? `· ${record.job.result.before.direction.toLowerCase()}` : `· ${record.job.status}`)  : "· historical"}
        </p>
        {scene?.thumbnailUrl ? (
          <img
            className="science-card-image"
            src={scene.thumbnailUrl}
            alt=""
            loading="lazy"
          />
        ) : isWater ? (
          <img className="science-water-image" src={water.imageUrl} alt="" />
        ) : null}
        <svg
          className="card-contours"
          viewBox="0 0 230 80"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M0 65C30 0 67 88 102 24S181 69 230 4M0 77C31 10 64 103 108 38S183 88 230 18M0 52C25-10 70 70 98 12S176 54 230-8"
            stroke="currentColor"
          />
        </svg>
        <div className="card-value">
          <strong>
            {isWater ? water.openWaterClassAreaKm2.toFixed(1) : isChange ? (record.job.result?.stats.medianDb.toFixed(2) ?? "—") : formatBytes(scene!.fileBytes)}
            {isWater && <small>km²</small>}{isChange && <small>dB</small>}
          </strong>
          <span>
            {isWater ? "Water class 1 · entire source mosaic" : isChange ? "Median backscatter difference" : `Track ${scene!.path ?? "—"} / Frame ${scene!.frame ?? "—"}`}
          </span>
        </div>
      </button>
      <Button
        className="card-save"
        variant="ghost"
        size="icon"
        aria-label={`${saved ? "Unsave" : "Save"} ${isWater ? "water study" : record.id}`}
        aria-pressed={saved}
        onClick={onSave}
      >
        <Bookmark size={17} fill={saved ? "currentColor" : "none"} />
      </Button>
    </article>
  );
}
