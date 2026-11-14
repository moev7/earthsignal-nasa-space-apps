import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { createHash } from "node:crypto";
import { AREA_INPUT_BYTES, forwardAreaRequest, readAreaInput } from "../lib/area-experiment-gateway";
import { readGatewayBody, signGatewayRequest } from "../lib/radar-gateway";
import { checkedAreaResult } from "../lib/area-result";
import { samplingLabHTML, samplingLabPage } from "../lib/sampling-lab-page";
import { SAMPLING_DEMO } from "../lib/sampling-demo.generated";
import { signInDestination } from "../lib/sign-in-destination";

const config = { userId: "fixture-owner", baseUrl: "http://127.0.0.1:8030", secret: "sampling-fixture-secret-32-or-more", publicOrigin: "https://nasa.r8volt.com", allowLocal: true };
const path = "/api/area-experiments";
const sample = JSON.parse(readFileSync(new URL("../examples/stratified-area-demo/result.json", import.meta.url), "utf8"));
const request = (body: string | Uint8Array, url = path, extra: Record<string, string> = {}) => new Request("https://nasa.r8volt.com" + url, { method: "POST", headers: { Origin: config.publicOrigin, "Idempotency-Key": "fixture-key-123", ...extra }, body: typeof body === "string" ? body : new Uint8Array(body).buffer });

test("the protected document has no anonymous exercise payload and a named HTTPS-safe continuation", async () => {
  const anon = await samplingLabPage(null);
  assert.equal(anon.status, 303);
  assert.equal(anon.headers.get("location"), "/sign-in?continue=sampling-lab");
  assert.equal(await anon.text(), "");
  assert.equal(signInDestination("?continue=sampling-lab"), "/sampling-lab");
  assert.equal(signInDestination("?continue=sampling-lab&continue=https://evil.invalid"), "/workspace");
  assert.equal(signInDestination("?continue=/sampling-lab"), "/workspace");
  const page = await samplingLabPage({ id: "owner" });
  assert.match(page.headers.get("content-security-policy")!, /connect-src 'self'/);
  assert.match(page.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  assert.equal(page.headers.get("cache-control"), "private, no-store");
});

test("actual shipped script compiles, carries the exact synthetic pin and presents all three explanation sections", () => {
  const html = samplingLabHTML(), script = html.match(/<script>([\s\S]*)<\/script>/)![1];
  new Script(script);
  const embedded = script.slice(script.indexOf("function checkedAreaResult("), script.indexOf("const $=id"));
  const actual = new Script(embedded+"; checkedAreaResult(fixture)").runInNewContext({fixture: sample});
  assert.equal(actual.calculation.classes[0].areaM2, 52000);
  assert.equal(createHash("sha256").update(SAMPLING_DEMO).digest("hex"), "e5c5746f151619a6d6baba062b300b53f9dd3bb505b3178050461c9b50732dd2");
  for (const text of ["What was counted", "What can be estimated", "What still needs checking", "Try an unfinished review", "never sent to Gemini", "not a confidence interval", "Print a simple brief"]) assert.ok(html.includes(text), text);
  assert.ok(!script.includes("innerHTML"));
  assert.ok(!script.includes("localStorage"));
  assert.ok(!script.includes("/api/assistant"));
});

test("a native exported result retains weighted 13% and sampling error without scientific promotion", () => {
  const r = checkedAreaResult(sample);
  assert.equal(r.calculation.classes[0].proportion, .13);
  assert.equal(r.calculation.classes[0].areaM2, 52000);
  assert.ok(Math.abs(r.calculation.classes[0].areaSamplingSE_M2! - 20123.827196948187) < 1e-8);
  assert.equal(r.calculation.counts.unknown, 0);
  assert.equal(r.calculation.confidenceIntervalsProvided, false);
});

test("display rejects promoted, missing-evidence, mislabeled-area and invalid uncertainty results", () => {
  const changes = [
    (v: typeof sample) => { v.fieldTruthEstablished = true; },
    (v: typeof sample) => { v.calculation.confidenceIntervalsProvided = true; },
    (v: typeof sample) => { v.calculation.counts.unknown = 1; v.calculation.counts.known--; },
    (v: typeof sample) => { v.calculation.classes[0].areaM2 = 12; },
    (v: typeof sample) => { v.calculation.classes[0].areaSamplingSE_M2 = Infinity; },
    (v: typeof sample) => { v.calculation.samplingVarianceStatus = "non-estimable"; },
    (v: typeof sample) => { v.calculation.classOrder.reverse(); },
  ];
  for (const change of changes) { const v = structuredClone(sample); change(v); assert.throws(() => checkedAreaResult(v)); }
});

test("unfinished outcomes and non-estimable sampling errors keep unavailable quantities null", () => {
  const v = JSON.parse(readFileSync(new URL("../examples/stratified-area-demo/unfinished-result.json", import.meta.url), "utf8"));
  assert.equal(checkedAreaResult(v).calculation.classes[0].areaM2, null);
  assert.equal(v.calculation.counts.unknown, 1);
  const single = JSON.parse(readFileSync(new URL("../examples/stratified-area-demo/singleton-result.json", import.meta.url), "utf8"));
  assert.equal(checkedAreaResult(single).calculation.classes[0].areaSamplingSE_M2, null);
  assert.notEqual(single.calculation.classes[0].areaM2, null);
});

test("signed forwarding preserves original Unicode and whitespace, owner and raw digest", async () => {
  const raw = " {\"private\":\"é 汉字\"}\n";
  let called = 0;
  const response = await forwardAreaRequest(request(raw), path, config, async (_url, options) => {
    called++;
    const headers = new Headers(options!.headers);
    assert.equal(options!.body, raw);
    assert.equal(headers.get("X-Earthsignal-User"), config.userId);
    assert.equal(headers.get("Idempotency-Key"), "fixture-key-123");
    assert.equal(headers.get("X-Earthsignal-Signature"), await signGatewayRequest("POST", path, config.userId!, raw, config.secret, headers.get("X-Earthsignal-Timestamp")!, headers.get("X-Earthsignal-Nonce")!));
    return Response.json({ id: "a".repeat(32) }, { status: 202 });
  });
  assert.equal(called, 1); assert.equal(response.status, 202); assert.equal(response.headers.get("vary"), "Cookie");
});

test("new upload boundary is exactly 2 MiB, invalid UTF-8 rejected, old requests still 16 KiB", async () => {
  assert.equal((await readAreaInput(request("x".repeat(AREA_INPUT_BYTES))) as string).length, AREA_INPUT_BYTES);
  assert.equal((await readAreaInput(request("x".repeat(AREA_INPUT_BYTES + 1))) as Response).status, 413);
  assert.equal(((await readAreaInput(request(new Uint8Array([0xc0, 0xaf])))) as Response).status, 400);
  assert.equal(((await readGatewayBody(request("x".repeat(16385)))) as Response).status, 413);
  assert.equal(((await readAreaInput(request("small", path, { "content-length": "2097153" }))) as Response).status, 413);
});

test("authentication, origin, aliases, artifact traversal and methods fail before forwarding", async () => {
  let calls = 0; const fetcher = async () => { calls++; return Response.json({}); };
  assert.equal((await forwardAreaRequest(request(SAMPLING_DEMO), path, { ...config, userId: null }, fetcher)).status, 401);
  assert.equal((await forwardAreaRequest(request(SAMPLING_DEMO, path, { Origin: "https://evil.invalid" }), path, config, fetcher)).status, 403);
  assert.equal((await forwardAreaRequest(request(SAMPLING_DEMO, path + "?large=1"), path, config, fetcher)).status, 400);
  for (const action of ["artifacts/../input.json", "artifacts/secret.json", "cancel?x=1", "brief"]) {
    const target = path + "/" + "a".repeat(32) + "/" + action;
    assert.equal((await forwardAreaRequest(request("{}", target), target, config, fetcher)).status, 400);
  }
  assert.equal((await forwardAreaRequest(request("{}", path + "/" + "a".repeat(32)), path + "/" + "a".repeat(32), config, fetcher)).status, 405);
  assert.equal(calls, 0);
  const get = new Request("https://nasa.r8volt.com" + path, { headers: { "Content-Length": "16385" } });
  assert.equal((await forwardAreaRequest(get, path, config, fetcher)).status, 413);
  assert.equal(calls, 0);
});

test("at most two large upload readers run and their slots are released", async () => {
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  const streaming = () => new Request("https://nasa.r8volt.com" + path, { method: "POST", body: new ReadableStream<Uint8Array>({ start(c) { controllers.push(c); } }), duplex: "half" } as RequestInit);
  const first = readAreaInput(streaming()), second = readAreaInput(streaming());
  assert.equal(((await readAreaInput(request("third"))) as Response).status, 429);
  for (const c of controllers) { c.enqueue(new TextEncoder().encode("{}")); c.close(); }
  assert.deepEqual(await Promise.all([first, second]), ["{}", "{}"]);
  assert.equal(await readAreaInput(request("{}")), "{}");
});

test("upload slots stay reserved while signed submissions await the upstream response", async () => {
  const releases: ((r: Response) => void)[] = [];
  let started!: () => void;
  const bothStarted = new Promise<void>(resolve => { started = resolve; });
  const fetcher = async () => new Promise<Response>(resolve => { releases.push(resolve); if (releases.length === 2) started(); });
  const raw = "{}" + " ".repeat(AREA_INPUT_BYTES - 2);
  const first = forwardAreaRequest(request(raw), path, config, fetcher);
  const second = forwardAreaRequest(request(raw), path, config, fetcher);
  await bothStarted;
  const third = await forwardAreaRequest(request(raw), path, config, fetcher);
  assert.equal(third.status, 429); assert.equal(releases.length, 2);
  for (const release of releases) release(Response.json({}, { status: 202 }));
  assert.deepEqual((await Promise.all([first, second])).map(r => r.status), [202, 202]);
  assert.equal((await forwardAreaRequest(request("{}"), path, config, async () => Response.json({}, { status: 202 }))).status, 202);
});

class ElementFixture {
  hidden = false; value = ""; textContent = ""; onclick?: () => unknown; onchange?: (e: unknown) => unknown;
  classList = { toggle() {} }; style = {}; children: ElementFixture[] = [];
  setAttribute() {} removeAttribute() {} scrollIntoView() {} querySelectorAll() { return []; }
  replaceChildren() { this.children = []; }
  append(...children: ElementFixture[]) { this.children.push(...children); }
}
function documentFixture(fetcher: typeof fetch) {
  const elements = new Map<string, ElementFixture>();
  const events = new Map<string, () => void>();
  const get = (id: string) => { if (!elements.has(id)) elements.set(id, new ElementFixture()); return elements.get(id)!; };
  get("unit").value = "ha"; get("result").hidden = true;
  const script = samplingLabHTML().match(/<script>([\s\S]*)<\/script>/)![1];
  const state = new Script(script + "; ({state:()=>({raw,selected,result,readVersion}),showJob,history})").runInNewContext({
    document: { getElementById: get, createElement: () => new ElementFixture(), visibilityState: "hidden" },
    window: { addEventListener(name: string, handler: () => void) { events.set(name, handler); }, print() {} }, fetch: fetcher, crypto, TextEncoder, TextDecoder, AbortSignal,
    setInterval: () => 1, clearInterval() {},
  });
  return { get, state, events };
}
const settled = () => new Promise<void>(resolve => setImmediate(resolve));

test("actual document ignores an older file completion after a newer file or demo is chosen", async () => {
  const { get, state } = documentFixture(async () => Response.json({ schemaVersion: "1.0", enabled: true, jobs: [] }));
  await settled();
  let release!: (b: ArrayBuffer) => void;
  const a = { size: 100, arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { release = resolve; }) };
  const first = get("file").onchange!({ target: { files: [a] } });
  get("demo").onclick!();
  const older = JSON.parse(SAMPLING_DEMO); older.context.studyId = "older-private-file";
  release(new TextEncoder().encode(JSON.stringify(older)).buffer);
  await first;
  assert.equal(state.state().raw, SAMPLING_DEMO);
  assert.ok(!get("input-summary").children.some(e => e.textContent === "older-private-file"));
});

test("actual document prevents removed job's late result from being rendered", async () => {
  let release!: (r: Response) => void;
  const { get, state } = documentFixture(async url => String(url).endsWith("/result.json")
    ? new Promise<Response>(resolve => { release = resolve; })
    : Response.json({ schemaVersion: "1.0", enabled: true, jobs: [] }));
  await settled();
  const job = { id: "a".repeat(32), status: "completed", request: { inputFileSha256: sample.inputFileSha256 }, result: { inputFileSha256: sample.inputFileSha256 }, expiresAt: "2026-10-21T00:00:00Z" };
  const loading = state.showJob(job);
  await state.history();
  release(Response.json(sample)); await loading;
  assert.equal(state.state().selected, null); assert.equal(state.state().result, null);
  assert.equal(get("result").hidden, true);
});

test("display rejects inconsistent sampling-unit conversions and missing sampling groups", () => {
  for (const change of [
    (v: typeof sample) => { v.calculation.strata = []; },
    (v: typeof sample) => { v.calculation.classes[0].areaSamplingSE_M2 = 0; },
    (v: typeof sample) => { v.calculation.strata[0].weight = .9; },
  ]) { const value = structuredClone(sample); change(value); assert.throws(() => checkedAreaResult(value)); }
});

test("printing expands source dates/provenance and restores the reader's disclosure choice", async () => {
  const { get, events } = documentFixture(async () => Response.json({ schemaVersion: "1.0", enabled: true, jobs: [] }));
  await settled();
  const context = get("context-details") as ElementFixture & { open: boolean };
  context.open = false; events.get("beforeprint")!(); assert.equal(context.open, true);
  events.get("afterprint")!(); assert.equal(context.open, false);
  context.open = true; events.get("beforeprint")!(); events.get("afterprint")!(); assert.equal(context.open, true);
});

test("choosing another input hides the old result, including an in-flight artifact", async () => {
  let release!: (r: Response) => void;
  const { get, state } = documentFixture(async url => String(url).endsWith("/result.json")
    ? new Promise<Response>(resolve => { release = resolve; })
    : Response.json({ schemaVersion: "1.0", enabled: true, jobs: [] }));
  await settled();
  const job = { id: "a".repeat(32), status: "completed", request: { inputFileSha256: sample.inputFileSha256 }, result: { inputFileSha256: sample.inputFileSha256 } };
  const loading = state.showJob(job);
  get("demo").onclick!();
  release(Response.json(sample)); await loading;
  assert.equal(get("job-section").hidden, true);
  assert.equal(get("result").hidden, true);
  assert.equal(state.state().result, null);
  assert.equal(get("messages").textContent, "Input ready to inspect. Nothing has been uploaded.");
});

test("background completion while preparing input cannot reopen an old result; history can", async () => {
  let reads = 0;
  const { get, state } = documentFixture(async url => {
    if (String(url).endsWith("/result.json")) { reads++; return Response.json(sample); }
    return Response.json({ schemaVersion: "1.0", enabled: true, jobs: [] });
  });
  await settled();
  const job = { id: "a".repeat(32), status: "completed", request: { inputFileSha256: sample.inputFileSha256 }, result: { inputFileSha256: sample.inputFileSha256 } };
  await state.showJob(job);
  assert.equal(get("result").hidden, false);
  get("edit-input").onclick!();
  assert.equal(get("result").hidden, true);
  get("demo").onclick!();
  await state.showJob({ ...job, updatedAt: "2026-10-14T00:00:00Z" }, false);
  assert.equal(reads, 1);
  assert.equal(get("job-section").hidden, true);
  assert.equal(get("messages").textContent, "Input ready to inspect. Nothing has been uploaded.");
  await state.showJob(job);
  assert.equal(reads, 2);
  assert.equal(get("result").hidden, false);
  assert.equal(get("input-flow").hidden, true);
});

test("a submission finishing after a newer input is chosen stays in history without stealing focus", async () => {
  let release!: (r: Response) => void;
  let jobs: unknown[] = [];
  const { get, state } = documentFixture(async (_url, options) => options?.method === "POST"
    ? new Promise<Response>(resolve => { release = resolve; })
    : Response.json({ schemaVersion: "1.0", enabled: true, jobs }));
  await settled(); get("demo").onclick!();
  const submitting = get("run").onclick!();
  get("missing").onclick!();
  jobs = [{ id: "a".repeat(32), status: "queued", createdAt: "2026-10-14T00:00:00Z", request: { inputFileSha256: sample.inputFileSha256 } }];
  release(Response.json(jobs[0], { status: 202 })); await submitting;
  assert.equal(state.state().selected, null);
  assert.equal(get("result").hidden, true);
  assert.equal(get("input-flow").hidden, false);
  assert.equal(get("messages").textContent, "Input ready to inspect. Nothing has been uploaded.");
  assert.equal(get("history").children.length, 1);
});
