import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { setImmediate as nextTurn } from "node:timers/promises";
import React, { act } from "react";
import { renderToString } from "react-dom/server";
import { Window } from "happy-dom";
import { GaugeReceiptDownload } from "../features/decisions/gauge-receipt-download";
import { useAcquisitionPlayback } from "../features/science/science-detail";
import { gaugeVintageSchema } from "../lib/gauge-vintage-contract";
import type { ReferencedVintage } from "../lib/gauge-receipt-download";
import { parseAsfCatalog } from "../features/catalog/asf";
import type { CatalogQuery, Scene } from "../features/catalog/domain";

// Synthetic receipt exercises the existing integrity contract, not scientific lineage.
const hash = "1".repeat(64), receivedAt = "2026-10-13T00:00:00.000000Z";
const identity = { station: "USGS-01646500", timeSeriesId: "synthetic", parameter: "00060", statistic: "00003", unit: "ft^3/s" };
const snapshot = { policyVersion: "usgs-observation-vintages-v1", availabilityBasis: "local-receipt-only", identity, issueTime: receivedAt, start: "2025-01-01", end: "2025-01-02", calendarDays: 2, unknownDays: 1, observations: [{ identity, date: "2025-01-01", value: 100, quality: "Provisional", qualifiers: ["ESTIMATED"], stationTimeProperties: { country_code: "US", time_zone_abbreviation: "EST", uses_daylight_savings: "Y" }, revision: 1, receivedAt, firstReceivedAt: receivedAt, contentHash: hash, stationPropertiesHash: hash, sourceResponseHash: hash, sourceMetadataHash: hash, versionHash: hash }], snapshotHash: hash };
const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
function vintage(): ReferencedVintage {
  const { observations, ...summary } = snapshot;
  return gaugeVintageSchema.parse({ status: "referenced", referenceVersion: "gauge-receipt-reference-v1", receipt: { policyVersion: "usgs-observation-vintages-v1", receivedAt, insertedVersions: 1, unchangedRecords: 0 }, snapshotRef: { ...summary, observationCount: observations.length, qualifiedRecords: 1, withdrawnRecords: 0 }, artifact: { name: "gauge-vintage-snapshot.json", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } }) as ReferencedVintage;
}
async function setup() {
  const window = new Window({ url: "http://localhost/workspace" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) install(key, value);
  const host = window.document.createElement("div");
  const { createRoot, hydrateRoot } = await import("react-dom/client");
  let root: ReturnType<typeof createRoot>;
  return { window, host, install,
    async render(element: React.ReactElement) { await act(async () => { root ??= createRoot(host as unknown as HTMLElement); root.render(element); }); },
    async hydrate(element: React.ReactElement, html: string, errors: unknown[]) { host.innerHTML = html; await act(async () => { root = hydrateRoot(host as unknown as HTMLElement, element, { onRecoverableError: error => errors.push(error) }); }); },
    async close() {
      await act(async () => root?.unmount());
      await window.happyDOM.close();
      for (const [key, original] of originals) {
        if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test("receipt expiry hydrates without drift and hides actions at the deadline without an unrelated render", async t => {
  const now = Date.parse("2026-11-10T00:00:00Z");
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  const receipt = vintage(), expiry = new Date(now + 1000).toISOString();
  const element = React.createElement(GaugeReceiptDownload, { vintage: receipt, jobId: "job", artifactExpiresAt: expiry });
  const html = renderToString(element);
  assert.doesNotMatch(html, /Download received snapshot/, "SSR defers time-dependent actions until the client clock is subscribed");
  const env = await setup();
  const errors: unknown[] = [];
  try {
    await env.hydrate(element, html, errors);
    assert.deepEqual(errors, []);
    assert.match(env.host.textContent, /Download received snapshot/);
    await act(async () => t.mock.timers.tick(1001));
    assert.match(env.host.textContent, /full received snapshot has expired/);
    assert.doesNotMatch(env.host.textContent, /Download received snapshot/);
    assert.equal(env.host.querySelectorAll("button").length, 0);
  } finally { await env.close(); t.mock.timers.reset(); }
});

test("receipt context and auth changes abort protected requests; retries retain integrity checks and expiry blocks a late download", async t => {
  const now = Date.parse("2026-11-10T00:00:00Z");
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  const env = await setup();
  const requests: Array<{ resolve: (response: Response) => void; signal: AbortSignal; url: string; credentials: RequestCredentials | undefined; cache: RequestCache | undefined }> = [];
  env.install("fetch", (url: string, init: RequestInit) => new Promise<Response>(resolve => requests.push({ resolve, signal: init.signal as AbortSignal, url, credentials: init.credentials, cache: init.cache })));
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
  const digests: Promise<ArrayBuffer>[] = [];
  t.mock.method(crypto.subtle, "digest", (...args: Parameters<typeof originalDigest>) => {
    const pending = originalDigest(...args); digests.push(pending); return pending;
  });
  let downloads = 0;
  t.mock.method(URL, "createObjectURL", () => { downloads++; return "blob:synthetic"; });
  const receipt = vintage();
  const element = (jobId: string, expiry = new Date(now + 60_000).toISOString()) => React.createElement(GaugeReceiptDownload, { vintage: receipt, jobId, artifactExpiresAt: expiry });
  const click = async (index = 0) => { await act(async () => env.host.querySelectorAll("button")[index].click()); };
  try {
    await env.render(element("first"));
    await click();
    assert.equal(requests[0].credentials, "same-origin");
    assert.equal(requests[0].cache, "no-store");
    await env.render(element("second"));
    assert.equal(requests[0].signal.aborted, true);
    await act(async () => requests[0].resolve(new Response(bytes)));
    assert.doesNotMatch(env.host.textContent, /Source profile read|Sign in again/);
    await click();
    await act(async () => env.window.dispatchEvent(new env.window.Event("earthsignal-auth-changed")));
    assert.equal(requests[1].signal.aborted, true);
    await act(async () => requests[1].resolve(new Response(bytes)));
    assert.doesNotMatch(env.host.textContent, /Source profile read/);
    await click();
    await act(async () => requests[2].resolve(new Response("denied", { status: 401 })));
    assert.match(env.host.textContent, /Sign in again/);
    await click();
    await act(async () => requests[3].resolve(new Response(bytes)));
    // SHA256 validation uses WebCrypto's asynchronous task queue.
    for (let attempt = 0; attempt < 50 && !env.host.textContent.includes("Source profile read"); attempt++) {
      await act(async () => { await nextTurn(); });
    }
    assert.match(env.host.textContent, /Source profile read from the integrity-checked receipt/);
    await env.render(element("expiring", new Date(now + 1000).toISOString()));
    assert.doesNotMatch(env.host.textContent, /Source profile read/);
    await click(1);
    await act(async () => t.mock.timers.tick(1001));
    const priorDigests = digests.length;
    await act(async () => requests[4].resolve(new Response(bytes)));
    for (let attempt = 0; attempt < 50 && digests.length === priorDigests; attempt++) {
      await act(async () => { await nextTurn(); });
    }
    assert.equal(digests.length, priorDigests + 1, "the late response reached actual integrity validation");
    await act(async () => { await Promise.all(digests); });
    assert.equal(downloads, 0, "a verified response arriving beyond expiry cannot create a download");
    assert.match(env.host.textContent, /full received snapshot has expired/);
    assert.doesNotMatch(env.host.textContent, /Download integrity checked/);
  } finally { await env.close(); t.mock.timers.reset(); }
});

test("acquisition playback advances across scene selection, stops at the end, and stays stopped after query or water changes", async t => {
  const env = await setup();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const [scene] = parseAsfCatalog(JSON.parse(readFileSync(new URL("./fixtures/asf-scene.json", import.meta.url), "utf8")));
  const timeline = [scene, { ...scene, id: "later", startTime: "2026-10-04T02:56:05Z" }];
  const query: CatalogQuery = { region: "sacramento", product: "GCOV", start: "2026-07-10", end: "2026-10-08" };
  let playback!: ReturnType<typeof useAcquisitionPlayback>;
  const selections: string[] = [];
  const select = (id: string) => { selections.push(id); };
  function Fixture({ q, water = false, selected = timeline[0] }: { q: CatalogQuery; water?: boolean; selected?: Scene }) {
    playback = useAcquisitionPlayback(q, water, water ? null : selected, timeline, timeline.findIndex(item => item.id === selected.id), select);
    return null;
  }
  try {
    await env.render(React.createElement(Fixture, { q: query }));
    await act(async () => playback.setPlaying(true));
    await act(async () => t.mock.timers.tick(1200));
    assert.deepEqual(selections, ["later"]);
    await env.render(React.createElement(Fixture, { q: query, selected: timeline[1] }));
    assert.equal(playback.playing, true, "auto-advance must not reset playback on each acquisition");
    await act(async () => t.mock.timers.tick(1200));
    assert.equal(playback.playing, false);
    await act(async () => playback.setPlaying(true));
    const nextQuery = { ...query, point: "51.27,35.48" };
    await env.render(React.createElement(Fixture, { q: nextQuery }));
    assert.equal(playback.playing, false);
    await act(async () => t.mock.timers.tick(1200));
    assert.equal(selections.length, 1);
    await act(async () => playback.setPlaying(true));
    await env.render(React.createElement(Fixture, { q: nextQuery, water: true }));
    assert.equal(playback.playing, false);
    await env.render(React.createElement(Fixture, { q: nextQuery }));
    await act(async () => t.mock.timers.tick(1200));
    assert.equal(playback.playing, false);
    assert.equal(selections.length, 1, "returning from water must not resume an old slideshow");
  } finally { await env.close(); t.mock.timers.reset(); }
});

test("committed search epochs reject old focus frames before passive effects and auth events invalidate queued navigation", { timeout: 10000 }, async () => {
  const { registerHooks } = await import("node:module");
  // Keep this test on search lifecycle behavior, without initializing Leaflet or CSS.
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === "@/features/catalog/geo-map") return { url: "data:text/javascript,export function GeoMap(){return null}", shortCircuit: true };
    if (specifier.endsWith(".css")) return { url: "data:text/javascript,export default {}", shortCircuit: true };
    return nextResolve(specifier, context);
  } });
  let DecisionWorkspace: typeof import("../features/decisions/decision-workspace").DecisionWorkspace;
  try { ({ DecisionWorkspace } = await import("../features/decisions/decision-workspace")); }
  finally { hooks.deregister(); }
  const env = await setup();
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  env.install("HTMLElement", env.window.HTMLElement);
  env.install("HTMLDetailsElement", env.window.HTMLDetailsElement);
  env.install("HTMLFormElement", env.window.HTMLFormElement);
  env.install("Node", env.window.Node);
  env.install("Element", env.window.Element);
  env.install("getComputedStyle", env.window.getComputedStyle.bind(env.window));
  env.install("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  env.install("cancelAnimationFrame", (id: number) => frames.delete(id));
  env.install("fetch", async (input: string) => Response.json(input.endsWith("assessment-snapshots") ? { snapshots: [] } : input.endsWith("sources") ? { sources: [] } : { jobs: [] }));
  env.window.document.body.append(env.host);
  Object.defineProperty(env.window.HTMLElement.prototype, "scrollIntoView", { configurable: true, value() {} });
  const query: CatalogQuery = { region: "sacramento", product: "GCOV", start: "2026-07-10", end: "2026-10-08" };
  type Navigation = import("../features/science/workspace-search").SearchNavigation;
  const navigation = (epoch: number, nonce: number, name: string): Navigation => ({ epoch, nonce, target: { kind: "place-search", query: name } });
  function Fixture({ epoch, search, flush = false }: { epoch: number; search: Navigation; flush?: boolean }) {
    const [authEpoch, setAuthEpoch] = React.useState(0);
    React.useEffect(() => {
      const reset = () => setAuthEpoch(value => value + 1);
      window.addEventListener("earthsignal-auth-changed", reset);
      return () => window.removeEventListener("earthsignal-auth-changed", reset);
    }, []);
    React.useLayoutEffect(() => {
      if (flush) { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); }
    }, [flush]);
    return React.createElement(DecisionWorkspace, { query, searchEpoch: epoch + authEpoch, searchNavigation: search, openScience() {} });
  }
  try {
    const first = navigation(0, 1, "old place");
    await env.render(React.createElement(Fixture, { epoch: 0, search: first }));
    const input = env.host.querySelector("#place-name") as unknown as HTMLInputElement;
    assert.equal(input.value, "old place");
    assert.ok(frames.size > 0);
    await env.render(React.createElement(Fixture, { epoch: 1, search: first, flush: true }));
    assert.notEqual(env.window.document.activeElement, input, "old focus cannot apply in the commit-to-passive-effect gap");
    const microtasks: VoidFunction[] = [];
    const nativeMicrotask = globalThis.queueMicrotask;
    env.install("queueMicrotask", (callback: VoidFunction) => {
      // Hold application navigation, while React's own act flushes remain live.
      if (new Error().stack?.includes("decision-workspace.tsx")) microtasks.push(callback);
      else nativeMicrotask(callback);
    });
    await env.render(React.createElement(Fixture, { epoch: 1, search: navigation(1, 2, "blocked place") }));
    assert.ok(microtasks.length > 0);
    await act(async () => env.window.dispatchEvent(new env.window.Event("earthsignal-auth-changed")));
    assert.equal(input.value, "");
    await act(async () => { microtasks.splice(0).forEach(callback => callback()); });
    assert.equal(input.value, "", "queued pre-auth navigation cannot restore private search context");
    assert.equal(frames.size, 0);
  } finally { await env.close(); }
});
