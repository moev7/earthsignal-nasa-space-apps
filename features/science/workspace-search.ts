import { REGIONS, type CatalogQuery } from "@/features/catalog/domain";
import type { Assessment, AssessmentJob } from "@/lib/observatory-contract";
import type { Snapshot } from "@/features/decisions/use-assessments";
import { DATA_TYPES, recordSearchText, recordTitle, type DataType, type ScienceRecord } from "./domain";
import type { SearchEntry } from "./search-index";

export type SearchAnchor = "assessment-brief" | "assessment-measurements" | "assessment-timeline" | "assessment-provenance" | "assessment-quality";
export type DecisionSearchTarget = { kind: "assessment" | "snapshot"; id: string; anchor?: SearchAnchor } | { kind: "place-search"; query?: string };
export type WorkspaceSearchTarget = DecisionSearchTarget
  | { kind: "record"; id: string; recordKind: ScienceRecord["kind"] }
  | { kind: "region"; id: CatalogQuery["region"] }
  | { kind: "type"; id: DataType }
  | { kind: "example" }
  | { kind: "action"; id: "refresh" | "saved" | "reset" | "polygon" | "point" | "transect" | "water-history" };
export type WorkspaceSearchEntry = SearchEntry<WorkspaceSearchTarget>;
export type SearchNavigation = { target: DecisionSearchTarget; nonce: number; epoch: number };

export function searchResultGroups(items: WorkspaceSearchEntry[], query: string) {
  if (query.trim()) return [{ heading: "Search results", items }];
  return [...new Set(items.map(item => item.group))].map(heading => ({ heading, items: items.filter(item => item.group === heading) }));
}

export function observationSearchEntries(records: ScienceRecord[], region: CatalogQuery["region"], saved: string[], point?: string): WorkspaceSearchEntry[] {
  return records.map(record => {
    const scene = record.kind === "scene" ? record.scene : null;
    const result = record.kind === "radar-change" ? record.job.result : null;
    return {
      id: `record:${record.kind}:${record.id}`, title: recordTitle(record, region, point),
      subtitle: scene ? `${scene.product} · ${scene.startTime.slice(0, 10)} · track ${scene.path ?? "—"} · frame ${scene.frame ?? "—"}`
        : result ? `Radar comparison · ${result.before.acquiredAt.slice(0, 10)} → ${result.after.acquiredAt.slice(0, 10)}` : "Historical optical water study · 2023-03-31",
      group: record.kind === "radar-change" ? "Processed comparisons · loaded" : "Observations · loaded catalog",
      keywords: [record.id, recordSearchText(record, region)],
      identifiers: [record.id],
      fields: { kind: record.kind, saved: String(saved.includes(record.id)),
        ...(scene ? { product: scene.product, track: scene.path === null ? [] : String(scene.path), frame: scene.frame === null ? [] : String(scene.frame), direction: scene.direction, polarization: scene.polarization, maturity: scene.maturity, date: scene.startTime.slice(0, 10), source: scene.platform } : {}),
        ...(result ? { product: "GCOV", source: "NISAR", date: [result.before.acquiredAt.slice(0, 10), result.after.acquiredAt.slice(0, 10)] } : {}),
      }, target: { kind: "record", id: record.id, recordKind: record.kind },
    };
  });
}

function resultEntries(kind: "assessment" | "snapshot", id: string, result: Assessment, savedAt?: string): WorkspaceSearchEntry[] {
  const target = (anchor: SearchAnchor): DecisionSearchTarget => ({ kind, id, anchor });
  const fields = { kind, date: [result.time.start, result.time.end], source: result.evidence.map(e => e.sourceId), saved: "true" };
  const context = `${result.time.start} → ${result.time.end} · ${kind === "snapshot" ? "Immutable snapshot" : "Saved assessment"}`;
  const entry = (suffix: string, title: string, subtitle: string, anchor: SearchAnchor, keywords: string[] = [], evidenceIds?: string[]): WorkspaceSearchEntry => ({
    id: `${kind}:${id}:${suffix}`, title, subtitle, group: kind === "snapshot" ? "Saved snapshots · your account" : "Scientific work · your account",
    fields: { ...fields, source: evidenceIds ? result.evidence.filter(e => evidenceIds.includes(e.id)).map(e => e.sourceId) : fields.source },
    identifiers: suffix === "result" ? [id] : [suffix.slice(suffix.indexOf(":") + 1)], keywords: [id, result.title, result.domain, result.question, ...keywords], target: target(anchor),
  });
  return [
    entry("result", result.title, context, "assessment-brief", [result.methodVersion, savedAt ?? ""]),
    ...result.claims.map(c => entry(`claim:${c.id}`, c.text, `${c.type} · ${context}`, "assessment-brief", [c.id, c.type, ...c.evidenceIds], c.evidenceIds)),
    ...result.metrics.map(m => entry(`metric:${m.id}`, m.label, `${m.value ?? "Withheld"} ${m.unit} · ${context}`, "assessment-measurements", [m.id, m.description, m.denominator ?? "", ...m.evidenceIds], m.evidenceIds)),
    ...(result.series ?? []).map(s => entry(`series:${s.id}`, s.label, `History chart · ${s.unit} · ${context}`, "assessment-timeline", [s.id, "chart history timeline", ...s.evidenceIds], s.evidenceIds)),
    ...result.evidence.map(e => entry(`evidence:${e.id}`, e.title, `${e.sourceId} · ${context}`, "assessment-provenance", [e.id, e.methodVersion], [e.id])),
    ...result.quality.map((q, i) => entry(`quality:${i}`, q.message, `${q.dimension} · ${q.status} · ${context}`, "assessment-quality", [q.dimension, q.status])),
  ];
}

// Only manifests already returned by the authenticated owner-scoped endpoints enter this index.
// No private text is persisted, uploaded, inferred, or copied to the geocoder.
export function assessmentSearchEntries(jobs: AssessmentJob[], snapshots: Snapshot[]): WorkspaceSearchEntry[] {
  return [
    ...jobs.flatMap(j => j.result ? resultEntries("assessment", j.id, j.result) : [{
      id: `assessment:${j.id}:status`, title: `${j.request.domain} · ${j.request.question}`,
      subtitle: `${j.status} · ${j.request.start} → ${j.request.end}`, group: "Scientific work · your account",
      keywords: [j.id], fields: { kind: "assessment", saved: "true", date: [j.request.start, j.request.end] },
      target: { kind: "assessment" as const, id: j.id },
    }]),
    ...snapshots.flatMap(s => resultEntries("snapshot", s.id, s.manifest, s.createdAt)),
  ];
}

export function workspaceCommandEntries(selected: ScienceRecord | null): WorkspaceSearchEntry[] {
  const command = (id: string, title: string, subtitle: string, target: WorkspaceSearchTarget, keywords: string[] = []): WorkspaceSearchEntry => ({ id, title, subtitle, target, keywords, group: "Tools & places" });
  return [
    ...Object.entries(REGIONS).map(([id, r]) => command(`region:${id}`, r.label, "Study anchor · changes the explorer region", { kind: "region", id: id as CatalogQuery["region"] })),
    ...Object.entries(DATA_TYPES).map(([id, t]) => command(`type:${id}`, t.label, t.caption, { kind: "type", id: id as DataType })),
    command("place-search", "Find a place worldwide", "Open named-place search · explicit lookup · sign-in required", { kind: "place-search" }, ["location boundary city"]),
    command("example:water", "Lake Mead · processed water", "Historical example · optical OPERA DSWx · 31 Mar 2023", { kind: "example" }, ["water OPERA DSWx HLS 2023"]),
    command("action:refresh", "Refresh public radar catalog", "Fetch the current explorer region, product and dates", { kind: "action", id: "refresh" }),
    command("action:saved", "Show saved observations", "Saved IDs in the current explorer collection", { kind: "action", id: "saved" }),
    command("action:reset", "Reset exploration", "Return to the Lake Mead starting view", { kind: "action", id: "reset" }),
    ...(selected?.kind === "radar-change" ? [
      command("action:polygon", "Analyze selected area", "Draw region in the selected radar comparison", { kind: "action", id: "polygon" }),
      command("action:point", "Inspect pixel", "Selected radar comparison", { kind: "action", id: "point" }),
      command("action:transect", "Draw transect", "Selected radar comparison", { kind: "action", id: "transect" }),
    ] : []),
    ...(selected?.kind === "water" ? [command("action:water-history", "Plot water history", "Historical optical study", { kind: "action", id: "water-history" })] : []),
  ];
}
