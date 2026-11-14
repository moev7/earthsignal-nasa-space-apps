"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useCatalog } from "@/features/catalog/use-catalog";
import { useRadarJobs } from "./use-radar-jobs";
import {
  DEFAULT_RECORD_FILTERS,
  DATA_TYPES,
  filterRecords,
  makeRecords,
  scienceQuery,
  type DataType,
} from "./domain";
import type { CatalogQuery, Product } from "@/features/catalog/domain";
const SAVED_KEY = "earthsignal.science.saved.v1";
const SAVED_CHANGED = "earthsignal-science-saved-changed";
let unsavedFallback = "[]";
let failedSave = false;
function savedSnapshot() {
  if (failedSave) return unsavedFallback;
  try { return localStorage.getItem(SAVED_KEY) ?? "[]"; }
  catch { return unsavedFallback; }
}
function subscribeSaved(notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === SAVED_KEY || event.key === null) { failedSave = false; notify(); }
  };
  window.addEventListener("storage", storage);
  window.addEventListener(SAVED_CHANGED, notify);
  return () => { window.removeEventListener("storage", storage); window.removeEventListener(SAVED_CHANGED, notify); };
}
function parseSaved(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) return [...new Set<string>(value)];
  } catch {}
  return [];
}
export function useScience(initialQuery: () => CatalogQuery = scienceQuery, initialComparison: import("@/lib/radar-contract").ChangeRequest | null = null) {
  const catalog = useCatalog(initialQuery);
  const radarJobs = useRadarJobs();
  const [type, setType] = useState<DataType>(initialComparison ? "GCOV" : "connected");
  const [filters, setFilters] = useState(DEFAULT_RECORD_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(
    "opera-water-20230331",
  );
  const [searchSelection, setSearchSelection] = useState<string | null>(null);
  const savedRaw = useSyncExternalStore(subscribeSaved, savedSnapshot, () => "[]");
  const saved = useMemo(() => parseSaved(savedRaw), [savedRaw]);
  const [comparisonDraft, setComparisonDraft] = useState<import("@/lib/radar-contract").ChangeRequest | Partial<import("@/lib/radar-contract").ChangeRequest> | null>(initialComparison);
  const records = useMemo(
    () => makeRecords(catalog.catalog?.scenes ?? [], type, catalog.query, radarJobs.jobs),
    [catalog.catalog, type, catalog.query, radarJobs.jobs],
  );
  const visible = useMemo(
    () => filterRecords(records, filters, saved, catalog.query.region),
    [records, filters, saved, catalog.query.region],
  );
  const searchRecords = useMemo(() => [
    ...(catalog.catalog?.scenes ?? []).map(scene => ({ kind: "scene" as const, id: scene.id, scene })),
    ...radarJobs.jobs.filter(job => job.status === "completed" && job.result).map(job => ({ kind: "radar-change" as const, id: job.id, job })),
  ], [catalog.catalog, radarJobs.jobs]);
  const selected =
    (searchSelection ? searchRecords.find(record => `${record.kind}:${record.id}` === searchSelection) : null) ??
    visible.find((record) => record.id === selectedId) ?? visible[0] ?? null;
  // Remember a filter fallback before commit so clearing the filter preserves it.
  if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  useEffect(() => {
    const clear = () => {
      setSearchSelection(null); setSelectedId(null);
      if (catalog.query.point) catalog.setQuery(scienceQuery());
    };
    window.addEventListener("earthsignal-auth-changed", clear);
    return () => window.removeEventListener("earthsignal-auth-changed", clear);
  }, [catalog.query.point]);
  const chooseType = (next: DataType) => {
    setSearchSelection(null);
    setType(next);
    setFilters(DEFAULT_RECORD_FILTERS);
    setComparisonDraft(null);
    const product = next === "radar-change" ? "GCOV" : DATA_TYPES[next].product;
    if (product)
      catalog.setQuery({ ...catalog.query, product: product as Product });
  };
  const chooseRegion = (region: CatalogQuery["region"]) => {
    setSearchSelection(null);
    setFilters(DEFAULT_RECORD_FILTERS);
    setComparisonDraft(null);
    const { point: _point, ...query } = catalog.query;
    catalog.setQuery({ ...query, region });
  };
  return {
    catalog,
    radarJobs,
    comparisonDraft,
    setComparisonDraft,
    type,
    chooseType,
    chooseRegion,
    records,
    searchRecords,
    visible,
    selected,
    mapRecords: selected && !visible.some(r => r.kind === selected.kind && r.id === selected.id) ? [...visible, selected] : visible,
    select: (id: string | null) => { setSearchSelection(null); setSelectedId(id); },
    selectFromSearch: (id: string, kind: "scene" | "radar-change" | "water") => { setComparisonDraft(null); setSearchSelection(`${kind}:${id}`); setSelectedId(id); },
    selectedOutsideFilters: Boolean(searchSelection && selected && !visible.some(r => r.kind === selected.kind && r.id === selected.id)),
    clearSearchSelection: () => setSearchSelection(null),
    filters,
    setFilters,
    saved,
    toggleSaved: (id: string) => {
      const current = parseSaved(savedSnapshot());
      unsavedFallback = JSON.stringify(current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
      try { localStorage.setItem(SAVED_KEY, unsavedFallback); failedSave = false; } catch { failedSave = true; }
      window.dispatchEvent(new Event(SAVED_CHANGED));
    },
    reset: () => {
      setSearchSelection(null);
      setType("connected");
      setFilters(DEFAULT_RECORD_FILTERS);
      catalog.setQuery(scienceQuery());
    },
  };
}
export type ScienceModel = ReturnType<typeof useScience>;
