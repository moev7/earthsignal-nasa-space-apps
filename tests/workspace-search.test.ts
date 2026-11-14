import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assessmentJobSchema } from "../lib/observatory-contract";
import { parseAsfCatalog } from "../features/catalog/asf";
import { observationSearchEntries, assessmentSearchEntries, workspaceCommandEntries, searchResultGroups } from "../features/science/workspace-search";
import { searchEntries } from "../features/science/search-index";
import { searchShortcut } from "../features/science/search-navigation";

const job = assessmentJobSchema.parse(JSON.parse(fs.readFileSync(new URL("./fixtures/search-assessment.json", import.meta.url), "utf8")));
const scenes = parseAsfCatalog(JSON.parse(fs.readFileSync(new URL("./fixtures/asf-scene.json", import.meta.url), "utf8")));
const snapshot = { id: job.id, sourceJobId: job.id, createdAt: job.createdAt, artifactExpiresAt: null, manifestHash: "test", manifest: job.result! };

test("actual track/frame/date fields are searchable independently of observation title", () => {
  const scene = { ...scenes[0], path: 85, frame: 70 };
  const entries = observationSearchEntries([{ kind: "scene", id: scene.id, scene }], "mead", []);
  assert.equal(searchEntries(entries, "track 85 frame 70").total, 1);
  assert.equal(searchEntries(entries, "track:85 frame:70").total, 1);
  assert.equal(searchEntries(entries, "track:850").total, 0);
  assert.equal(searchEntries(entries, "flood").total, 0);
  assert.equal(searchEntries(entries, "saved:true").total, 0);
});

test("raw scientific IDs rank before incidental mentions despite namespaced entry IDs", () => {
  const scene = scenes[0];
  const entries = observationSearchEntries([{ kind: "scene", id: scene.id, scene }], "mead", []);
  const mention = { ...entries[0], id: "mention", identifiers: [], title: `An incidental ${scene.id}`, target: { kind: "region" as const, id: "mead" as const } };
  assert.equal(searchEntries([mention, ...entries], scene.id).items[0].id, entries[0].id);
});

test("saved assessments index actual claims, metrics, history and evidence with qualified labels", () => {
  const entries = assessmentSearchEntries([job], []);
  assert.equal(entries.length, 6);
  const claim = searchEntries(entries, "flood").items[0];
  assert.ok(claim.subtitle.startsWith("Possible explanation"));
  assert.deepEqual(claim.target, { kind: "assessment", id: job.id, anchor: "assessment-brief" });
  const metric = searchEntries(entries, "discharge").items.find(e => e.id.includes("metric:"))!;
  assert.ok(metric.subtitle.startsWith("Withheld ft3/s"));
  assert.equal(searchEntries(entries, "history chart").items[0].target.kind, "assessment");
  assert.equal(searchEntries(entries, "source:usgs-daily").total, 6);
  assert.equal(searchEntries(entries, "date:2025-01-10").total, 6);
});

test("jobs and immutable snapshots with identical raw IDs retain distinct targets", () => {
  const entries = assessmentSearchEntries([job], [snapshot]);
  assert.equal(new Set(entries.map(e => e.id)).size, entries.length);
  assert.equal(searchEntries(entries, "kind:snapshot").total, 6);
  assert.equal(searchEntries(entries, "kind:assessment").total, 6);
  assert.equal(searchEntries(entries, "kind:snapshot history").items[0].target.kind, "snapshot");
});

test("source filters use each measurement's linked evidence instead of unrelated assessment sources", () => {
  const mixed = structuredClone(job);
  mixed.result!.evidence.push({ ...mixed.result!.evidence[0], id: "thermal", sourceId: "landsat" });
  mixed.result!.metrics.push({ ...mixed.result!.metrics[0], id: "temperature", label: "Temperature", evidenceIds: ["thermal"] });
  const entries = assessmentSearchEntries([mixed], []);
  assert.equal(searchEntries(entries, "temperature source:usgs-daily").total, 0);
  assert.equal(searchEntries(entries, "temperature source:landsat").total, 1);
});

test("render grouping preserves exact evidence matches ahead of incidental matches across result kinds", () => {
  const entries = assessmentSearchEntries([job], [{ ...snapshot, id: "different-snapshot" }]);
  const ranked = searchEntries(entries, "gauge-evidence").items;
  const rendered = searchResultGroups(ranked, "gauge-evidence").flatMap(group => group.items);
  assert.deepEqual(rendered.map(e => e.id), ranked.map(e => e.id));
  assert.ok(rendered[0].id.endsWith("evidence:gauge-evidence"));
  assert.ok(rendered[1].id.endsWith("evidence:gauge-evidence"));
});

test("replacement index has no cross-call cache or invented items when account data clears", () => {
  const original = JSON.stringify(job);
  assert.equal(searchEntries(assessmentSearchEntries([job], []), "owner A").total, 6);
  assert.equal(searchEntries(assessmentSearchEntries([], []), "owner A").total, 0);
  assert.equal(JSON.stringify(job), original);
  const pending = { ...job, result: null, status: "queued" as const };
  assert.equal(assessmentSearchEntries([pending], []).length, 1);
});

test("commands label the historical example and explicit place lookup independently of evidence", () => {
  const commands = workspaceCommandEntries(null);
  assert.ok(commands.find(e => e.target.kind === "example")?.subtitle.includes("Historical example"));
  assert.ok(commands.find(e => e.target.kind === "place-search")?.subtitle.includes("explicit lookup"));
  assert.equal(searchEntries(commands, "flood").total, 0);
});

test("search shortcuts ignore IME, key repeats, handled events and typing slash", () => {
  const key = { key: "k", ctrlKey: true, metaKey: false, altKey: false, repeat: false, isComposing: false, defaultPrevented: false };
  assert.equal(searchShortcut(key, true), "toggle");
  for (const property of ["repeat", "isComposing", "defaultPrevented", "altKey"] as const) assert.equal(searchShortcut({ ...key, [property]: true }, false), null);
  assert.equal(searchShortcut({ ...key, key: "/", ctrlKey: false }, false), "open");
  assert.equal(searchShortcut({ ...key, key: "/", ctrlKey: false }, true), null);
});
