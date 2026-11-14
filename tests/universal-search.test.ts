import test from "node:test";
import assert from "node:assert/strict";
import { searchEntries, type SearchEntry } from "../features/science/search-index";

function entry(id: string, overrides: Partial<SearchEntry<{ id: string }>> = {}): SearchEntry<{ id: string }> {
  return { id, title: "Observation", subtitle: "Loaded evidence", group: "Observations", target: { id }, ...overrides };
}
function ids(result: ReturnType<typeof searchEntries>): string[] {
  return result.items.map((item) => item.id);
}

test("searches the full input before limiting, including a hit beyond 100 entries", () => {
  const entries = Array.from({ length: 150 }, (_, i) => entry(`record-${i}`));
  entries[149].title = "Unique late glacier";
  const result = searchEntries(entries, "unique glacier", 1);
  assert.deepEqual(ids(result), ["record-149"]);
  assert.equal(result.total, 1);
  assert.equal(result.error, null);
});

test("all free tokens AND across literal titles, subtitles, keywords, fields and ID", () => {
  const complete = entry("SAMPLE-001", {
    title: "Lake Mead", subtitle: "Descending flood inspection", keywords: ["NISAR"],
    fields: { product: "GCOV", polarization: ["HH", "HV"], maturity: "provisional" },
  });
  const missing = entry("SAMPLE-002", { ...complete, id: "SAMPLE-002", keywords: [] });
  const result = searchEntries([missing, complete], "lake des nisar gcov hv provisional sample");
  assert.deepEqual(ids(result), ["SAMPLE-001"]);
  assert.equal(searchEntries([complete], "lake absent").total, 0);
  assert.equal(searchEntries([complete], "mead flood").total, 1);
  assert.equal(searchEntries([entry("other", { group: "secret group" })], "secret").total, 0);
});

test("flood excludes scattered fuzzy letters and typos but accepts contiguous text", () => {
  const entries = [entry("false", { title: "Field location observation orbital data" }),
    entry("literal", { title: "Floodwater" }), entry("typo", { title: "Flod" })];
  assert.deepEqual(ids(searchEntries(entries, "flood")), ["literal"]);
  assert.equal(searchEntries(entries, "flxod").total, 0);
  assert.equal(searchEntries([entry("split", { title: "flo", subtitle: "od" })], "flood").total, 0);
});

test("exact and prefix IDs outrank metadata/title hits with deterministic input ties", () => {
  const entries = [entry("title", { title: "NISAR_001" }),
    entry("NISAR_001_B"), entry("metadata", { fields: { source: "NISAR_001" } }),
    entry("NISAR_001"), entry("NISAR_001_A")];
  const expected = ["NISAR_001", "NISAR_001_B", "NISAR_001_A", "title", "metadata"];
  assert.deepEqual(ids(searchEntries(entries, "nisar_001")), expected);
  assert.deepEqual(ids(searchEntries(entries, "nisar_001", 2)), expected.slice(0, 2));
  assert.equal(searchEntries(entries, "nisar_001", 2).total, 5);
  assert.deepEqual(ids(searchEntries(entries, "nisar_001")), expected);
  assert.equal(searchEntries([entry("NISAR_A.1+[X]")], "NISAR_A.1+[X]").total, 1);
  assert.equal(searchEntries([entry("NISAR_Ax1+[X]")], "NISAR_A.1+[X]").total, 0);
});

test("structured track/frame compare exact integers rather than 85 matching 850", () => {
  const entries = [entry("850", { fields: { track: "850", frame: "850" } }),
    entry("85", { fields: { track: ["085", "86"], frame: "85" } }),
    entry("missing", { title: "track 85 frame 85" })];
  assert.deepEqual(ids(searchEntries(entries, "TRACK:85 frame:085")), ["85"]);
  assert.deepEqual(ids(searchEntries(entries, "track:86")), ["85"]);
  assert.equal(searchEntries(entries, "track:85 frame:850").total, 0);
  for (const query of ["track:85x", "frame:8.5", "track:-85", "frame:1e2", "track:9007199254740992"]) {
    const result = searchEntries(entries, query);
    assert.ok(result.error, query);
    assert.deepEqual(result.items, []);
    assert.equal(result.total, 0);
  }
});

test("structured fields are exact, case insensitive, OR within arrays and AND across tokens", () => {
  const entries = [entry("both", { fields: { product: "GCOV", polarization: ["HH", "HV"],
    direction: "Descending", maturity: "Provisional", source: "ASF DAAC", kind: "scene", saved: "true" } }),
    entry("prefix", { fields: { product: "GCOV-extra", polarization: "HV" } })];
  assert.deepEqual(ids(searchEntries(entries,
    'product:gcov polarization:hv polarization:hh direction:DESCENDING maturity:provisional source:"asf daac" kind:scene saved:true')),
  ["both"]);
  assert.equal(searchEntries(entries, "product:gco").total, 0);
  assert.equal(searchEntries(entries, "polarization:vv").total, 0);
  assert.equal(searchEntries(entries, "saved:false").total, 0);
});

test("dates require valid exact ISO calendar days including leap-year rules", () => {
  const entries = [entry("day", { fields: { date: ["2024-02-29", "2026-10-13"] } }),
    entry("timestamp", { fields: { date: "2026-10-13T00:00:00Z" } })];
  for (const date of ["2024-02-29", "2026-10-13"]) {
    assert.deepEqual(ids(searchEntries(entries, `date:${date}`)), ["day"]);
  }
  assert.equal(searchEntries(entries, "date:2026-10-14").total, 0);
  for (const date of ["2023-02-29", "1900-02-29", "2026-04-31", "2026-13-01",
    "2026-00-01", "2026-01-00", "2026-1-01", "0000-01-01", "2026-10-13T00:00:00Z"]) {
    const result = searchEntries(entries, `date:${date}`);
    assert.ok(result.error, date);
    assert.deepEqual(result.items, []);
    assert.equal(result.total, 0);
  }
  assert.equal(searchEntries([], "date:2000-02-29").error, null);
});

test("malformed/unknown queries fail explicitly, even with otherwise matching tokens", () => {
  const entries = [entry("match")];
  for (const query of ["match typo:value", "product:", 'source:""', 'source:"   "',
    'source:"ASF', '"unterminated', 'source:"ASF"tail', 'pro"duct', '""', "track: 85", ":value"]) {
    const result = searchEntries(entries, query);
    assert.ok(result.error, query);
    assert.deepEqual(result.items, []);
    assert.equal(result.total, 0);
  }
});

test("quoted phrases preserve contiguous words and allow literal namespaced IDs", () => {
  const entries = [entry("scene:raw-1", { title: "Lake Mead", fields: { source: "Public archive" } }),
    entry("snapshot:raw-1", { title: "Mead Lake", fields: { source: "Public archive extra" } })];
  assert.deepEqual(ids(searchEntries(entries, '"lake mead" source:"public archive"')), ["scene:raw-1"]);
  assert.deepEqual(ids(searchEntries(entries, '"scene:raw-1"')), ["scene:raw-1"]);
  assert.equal(searchEntries(entries, "scene:raw-1").items.length, 0);
  assert.ok(searchEntries(entries, "scene:raw-1").error);
  assert.equal(searchEntries(entries, "raw-1").total, 2);
});

test("Unicode case and composed/decomposed accents normalize in all indexed values", () => {
  const accented = entry("ÉVIDENCE-01", { title: "São Tomé", subtitle: "Cafe\u0301 inspection",
    keywords: ["RÉSUMÉ"], fields: { source: "Données publiques" } });
  assert.deepEqual(ids(searchEntries([accented], 'sao TOME café resume source:"donnees publiques"')),
    ["ÉVIDENCE-01"]);
  assert.deepEqual(ids(searchEntries([accented], "evidence-01")), ["ÉVIDENCE-01"]);
});

test("empty input preserves order, caps deterministically, and retains total without mutation", () => {
  const entries = Array.from({ length: 110 }, (_, i) => entry(`row-${i}`, { keywords: ["hit"] }));
  const before = structuredClone(entries);
  assert.deepEqual(ids(searchEntries(entries, " \n\t ")), entries.slice(0, 40).map((e) => e.id));
  const result = searchEntries(entries, "hit");
  assert.equal(result.items.length, 40);
  assert.equal(result.total, 110);
  assert.equal(result.items[0], entries[0]);
  assert.equal(result.items[0].target, entries[0].target);
  assert.deepEqual(ids(searchEntries(entries, "hit", 3.9)), ["row-0", "row-1", "row-2"]);
  assert.equal(searchEntries(entries, "hit", 0).total, 110);
  assert.deepEqual(searchEntries(entries, "hit", -1).items, []);
  assert.equal(searchEntries(entries, "hit", NaN).items.length, 40);
  assert.equal(searchEntries(entries, "hit", Infinity).items.length, 40);
  assert.deepEqual(entries, before);
  assert.deepEqual(searchEntries([], ""), { items: [], total: 0, error: null });
});
