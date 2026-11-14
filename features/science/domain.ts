import {
  PRODUCTS,
  catalogPoint,
  REGIONS,
  type Scene,
  type CatalogQuery,
} from "@/features/catalog/domain";
import water from "@/public/data/processed-water.json";
import type { ChangeJob } from "@/lib/radar-contract";
export { water };
export const DATA_TYPES = {
  connected: {
    label: "Water & radar",
    caption: "Connected observations",
    color: "#b3f84c",
    product: "GCOV",
  },
  water: {
    label: "Surface water",
    caption: "Processed optical classification",
    color: "#65c9ff",
    product: null,
  },
  GCOV: {
    label: "Radar backscatter",
    caption: "NISAR · GCOV",
    color: "#b3f84c",
    product: "GCOV",
  },
  GUNW: {
    label: "Ground motion",
    caption: "NISAR · GUNW",
    color: "#ff795b",
    product: "GUNW",
  },
  GOFF: {
    label: "Surface movement",
    caption: "NISAR · GOFF",
    color: "#6b9fff",
    product: "GOFF",
  },
  GSLC: {
    label: "Complex radar",
    caption: "NISAR · GSLC",
    color: "#65c6af",
    product: "GSLC",
  },
  RTC: {
    label: "Terrain-corrected radar",
    caption: "OPERA · RTC",
    color: "#ddacff",
    product: "RTC",
  },
  "radar-change": {
    label: "Radar comparison",
    caption: "NISAR · Backscatter difference",
    color: "#ff3366",
    product: null,
  },
} as const;
export type DataType = keyof typeof DATA_TYPES;
export type ScienceRecord =
  { kind: "water"; id: string } | { kind: "scene"; id: string; scene: Scene } | { kind: "radar-change"; id: string; job: ChangeJob };
export type RecordFilters = {
  query: string;
  direction: string;
  maturity: string;
  previewOnly: boolean;
  savedOnly: boolean;
};
export const DEFAULT_RECORD_FILTERS: RecordFilters = {
  query: "",
  direction: "all",
  maturity: "all",
  previewOnly: false,
  savedOnly: false,
};
export function scienceQuery(): CatalogQuery {
  return {
    region: "mead",
    product: "GCOV",
    start: "2023-03-31",
    end: new Date().toISOString().slice(0, 10),
  };
}
export function makeRecords(
  scenes: Scene[],
  type: DataType,
  query: CatalogQuery,
  jobs: ChangeJob[] = [],
): ScienceRecord[] {
  const records: ScienceRecord[] = [];
  if (
    !query.point &&
    (type === "connected" || type === "water") &&
    (query.region === "mead" || query.region === "global") &&
    query.start <= water.date &&
    query.end >= water.date
  )
    records.push({ kind: "water", id: water.id });
  if (type !== "water" && type !== "radar-change")
    records.push(
      ...scenes.map((scene) => ({
        kind: "scene" as const,
        id: scene.id,
        scene,
      })),
    );

  if (type === "connected" || type === "radar-change") {
    for (const job of jobs) {
      if (job.status !== "completed" || !job.result || !(query.point ? jobMatchesPoint(job, query.point) : jobMatchesRegion(job, query.region))) continue;
      const jobDate = job.result.after.acquiredAt.slice(0, 10);
      if (jobDate >= query.start && jobDate <= query.end) {
        records.push({ kind: "radar-change", id: job.id, job });
      }
    }
  }
  return records;
}
export function jobMatchesPoint(job: ChangeJob, value: string) {
  const point = catalogPoint(value);
  if (!point) return false;
  const [west, south, east, north] = job.bbox;
  const [lon, lat] = point;
  return lat >= south && lat <= north && (lon >= west && lon <= east || Math.abs(lon) === 180 && (-lon >= west && -lon <= east));
}
export function jobMatchesRegion(job: ChangeJob, region: CatalogQuery["region"]) {
  const point = REGIONS[region].point;
  const [west, south, east, north] = job.bbox;
  return !point || (point[0] >= west && point[0] <= east && point[1] >= south && point[1] <= north);
}
export function recordTitle(
  record: ScienceRecord,
  region: CatalogQuery["region"],
  point?: string,
) {
  return record.kind === "water" ? water.title : record.kind === "radar-change" ? record.job.result?.title ?? "Radar comparison" : point ? "Your confirmed location" : REGIONS[region].label;
}
export function recordSearchText(
  record: ScienceRecord,
  region: CatalogQuery["region"],
) {
  if (record.kind === "water") return `${water.id} ${water.title} surface water optical OPERA DSWx HLS ${water.date}`;
  if (record.kind === "radar-change") return `${record.id} radar comparison backscatter difference NISAR GCOV ${record.job.status} ${record.job.beforeId} ${record.job.afterId} ${record.job.result?.before.acquiredAt ?? ""} ${record.job.result?.after.acquiredAt ?? ""}`;
  return `${record.id} ${recordTitle(record, region)} ${record.scene.startTime} ${record.scene.product} ${record.scene.platform} ${record.scene.direction} ${record.scene.polarization.join(" ")} ${record.scene.path === null ? "" : `track ${record.scene.path}`} ${record.scene.frame === null ? "" : `frame ${record.scene.frame}`} ${record.scene.maturity}`;
}
export function filterRecords(
  records: ScienceRecord[],
  filters: RecordFilters,
  saved: string[],
  region: CatalogQuery["region"],
) {
  return records.filter((record) => {
    if (
      filters.query.trim() &&
      !recordSearchText(record, region)
        .toLowerCase()
        .includes(filters.query.trim().toLowerCase())
    )
      return false;
    if (filters.savedOnly && !saved.includes(record.id)) return false;
    if (filters.direction !== "all") {
      if (record.kind === "water") return false;
      if (record.kind === "scene" && record.scene.direction !== filters.direction) return false;
      if (record.kind === "radar-change" && record.job.result?.before.direction !== filters.direction) return false;
    }
    if (filters.maturity !== "all") {
      if (record.kind === "water") return false;
      if (record.kind === "scene" && record.scene.maturity.toLowerCase() !== filters.maturity) return false;
      if (record.kind === "radar-change" && (record.job.result?.before.collection.includes("PROVISIONAL") ? "provisional" : "unknown") !== filters.maturity) return false;
    }
    if (filters.previewOnly) {
      if (record.kind === "scene" && !record.scene.browseUrl) return false;
      if (record.kind === "radar-change" && !record.job.result) return false;
      if (record.kind === "water") return false;
    }
    return true;
  });
}
export function recordColor(record: ScienceRecord) {
  return record.kind === "water"
    ? "#65c9ff"
    : record.kind === "radar-change"
    ? "#ff3366"
    : (PRODUCTS[record.scene.product as keyof typeof PRODUCTS]?.color ?? "#b3f84c");
}
