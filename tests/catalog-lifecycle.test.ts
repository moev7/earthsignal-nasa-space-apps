import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { Window } from "happy-dom";
import { useCatalog } from "../features/catalog/use-catalog";
import { useScience, type ScienceModel } from "../features/science/use-science";
import { useScienceTools } from "../features/science/webmcp";
import { parseAsfCatalog } from "../features/catalog/asf";
import { buildAsfUrl, type CatalogQuery, type Catalog } from "../features/catalog/domain";

const query: CatalogQuery = { region: "sacramento", product: "GCOV", start: "2026-07-10", end: "2026-10-08" };
const [captured] = parseAsfCatalog(JSON.parse(readFileSync(new URL("./fixtures/asf-scene.json", import.meta.url), "utf8")));
const scenes = [captured, { ...captured, id: "second-acquisition", startTime: "2026-10-04T02:56:05Z" }];
function catalog(q: CatalogQuery): Catalog {
  return { schemaVersion: "1.0", source: "ASF / NASA Earthdata", retrievedAt: "2026-10-08T00:00:00Z", query: q, queryUrl: buildAsfUrl(q), limit: 24, scenes };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function setup() {
  const window = new Window({ url: "http://localhost/workspace" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, localStorage: window.localStorage, Event: window.Event, IS_REACT_ACT_ENVIRONMENT: true })) install(key, value);
  const { createRoot } = await import("react-dom/client");
  const host = window.document.createElement("div");
  const root = createRoot(host as unknown as HTMLElement);
  return { window, root, install, async close() {
    await act(async () => root.unmount());
    await window.happyDOM.close();
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key);
    }
  } };
}

test("catalog retries and query changes hide prior successes/errors immediately and reject stale or mismatched responses", async () => {
  const env = await setup();
  const requests: Array<ReturnType<typeof deferred<Response>> & { signal: AbortSignal }> = [];
  env.install("fetch", (_input: unknown, init: RequestInit) => {
    const pending = { ...deferred<Response>(), signal: init.signal as AbortSignal };
    requests.push(pending);
    return pending.promise;
  });
  let model!: ReturnType<typeof useCatalog>;
  function Fixture() { model = useCatalog(() => query); return null; }
  const ready = async (index: number, q: CatalogQuery) => { await act(async () => requests[index].resolve(Response.json(catalog(q)))); };
  try {
    await act(async () => env.root.render(React.createElement(Fixture)));
    assert.equal(model.status, "loading");
    await ready(0, query);
    assert.equal(model.status, "ready");
    await act(async () => model.select(scenes[1].id));
    assert.equal(model.selected?.id, scenes[1].id);
    await act(async () => model.retry());
    assert.equal(model.catalog, null);
    assert.equal(model.status, "loading");
    assert.equal(model.error, "");
    const next = { ...query, point: "51.27,35.48" };
    await act(async () => model.setQuery(next));
    assert.equal(requests[1].signal.aborted, true);
    await ready(1, query); // A transport may still deliver after abort.
    assert.equal(model.catalog, null);
    assert.equal(model.status, "loading");
    await act(async () => requests[2].reject(new Error("upstream unavailable")));
    assert.equal(model.status, "error");
    assert.equal(model.error, "upstream unavailable");
    await act(async () => model.retry());
    assert.equal(model.status, "loading");
    assert.equal(model.error, "");
    await ready(3, query); // Valid schema, wrong point identity.
    assert.equal(model.catalog, null);
    assert.equal(model.status, "loading");
    await act(async () => model.retry());
    await ready(4, next);
    assert.equal(model.status, "ready");
    assert.equal(model.selected?.id, scenes[0].id);
    await act(async () => model.setQuery(query));
    assert.equal(model.catalog, null, "returning to an earlier query cannot resurrect its old completion");
    assert.equal(model.status, "loading");
    await ready(5, query);
    await act(async () => model.setQuery(next));
    await act(async () => model.setQuery(query));
    assert.equal(model.catalog, null, "reusing the exact earlier query object still requires a new completion");
    assert.equal(model.status, "loading");
    await ready(7, query);
    await act(async () => { model.setDraft({ ...query }); });
    await act(async () => model.search());
    assert.equal(model.status, "loading", "resubmitting identical criteria still starts a fresh request");
  } finally { await env.close(); }
});

test("science saved choices persist without mount overwrite; filter fallback, search selection and committed tools stay coherent", async t => {
  const env = await setup();
  const key = "earthsignal.science.saved.v1";
  env.window.localStorage.setItem(key, JSON.stringify([scenes[1].id, scenes[1].id]));
  env.install("fetch", async (input: string) => {
    if (!input.startsWith("/api/scenes?")) return Response.json({ error: "Sign in" }, { status: 401 });
    const q = Object.fromEntries(new URL(input, "http://localhost").searchParams) as CatalogQuery;
    return Response.json(catalog(q));
  });
  type Tool = { name: string; execute(input: unknown): unknown };
  const tools = new Map<string, Tool>();
  Object.assign(env.window.document, { modelContext: { registerTool(tool: Tool) { tools.set(tool.name, tool); } } });
  let model!: ScienceModel;
  function Fixture() { model = useScience(); useScienceTools(model); return null; }
  try {
    await act(async () => env.root.render(React.createElement(Fixture)));
    assert.deepEqual(model.saved, [scenes[1].id]);
    assert.equal(env.window.localStorage.getItem(key), JSON.stringify([scenes[1].id, scenes[1].id]), "mount must not erase saved choices before reading them");
    await act(async () => model.setFilters(filters => ({ ...filters, savedOnly: true })));
    assert.equal(model.selected?.id, scenes[1].id);
    await act(async () => model.setFilters(filters => ({ ...filters, savedOnly: false })));
    assert.equal(model.selected?.id, scenes[1].id, "clearing filters preserves the fallback chosen while filtered");
    await act(async () => model.toggleSaved(scenes[0].id));
    assert.deepEqual(JSON.parse(env.window.localStorage.getItem(key)!), [scenes[1].id, scenes[0].id]);
    await act(async () => model.setFilters(filters => ({ ...filters, query: "no-such-scene" })));
    await act(async () => model.selectFromSearch(scenes[0].id, "scene"));
    assert.equal(model.selected?.id, scenes[0].id);
    assert.equal(model.selectedOutsideFilters, true);
    assert.ok(model.mapRecords.some(record => record.id === scenes[0].id));
    assert.deepEqual(tools.get("list_real_earth_observations")!.execute({}), [], "registered tools see the committed filter, not their mount model");
    await assert.rejects(async () => tools.get("select_real_earth_observation")!.execute({ id: scenes[0].id }), /not visible/);
    await act(async () => {
      env.window.localStorage.clear();
      env.window.dispatchEvent(new env.window.StorageEvent("storage"));
    });
    assert.deepEqual(model.saved, [], "cross-tab storage removal clears saved filters");
    const deniedWrite = t.mock.method(env.window.localStorage, "setItem", () => { throw new Error("Quota exceeded"); });
    await act(async () => model.toggleSaved(scenes[0].id));
    assert.deepEqual(model.saved, [scenes[0].id], "write failures preserve the usable in-memory choice");
    assert.equal(env.window.localStorage.getItem(key), null);
    deniedWrite.mock.restore();
    await act(async () => model.toggleSaved(scenes[1].id));
    assert.deepEqual(JSON.parse(env.window.localStorage.getItem(key)!), [scenes[0].id, scenes[1].id], "a later successful write preserves both choices");
    await act(async () => model.catalog.setQuery({ ...model.catalog.query, point: "51.27,35.48" }));
    await act(async () => env.window.dispatchEvent(new env.window.Event("earthsignal-auth-changed")));
    assert.equal(model.catalog.query.point, undefined, "auth changes discard confirmed private point context");
    assert.equal(model.selectedOutsideFilters, false);
  } finally { await env.close(); }
});
