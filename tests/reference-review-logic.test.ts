import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Exercise the actual shipped inline reader, rather than a rewritten model of it.
const template = readFileSync(new URL("../examples/optical-reference-development/review-template.html", import.meta.url), "utf8");
const readerSource = template.split("/* DRAFT_READER_START */")[1].split("/* DRAFT_READER_END */")[0];
const readDraft = new Function(`${readerSource}; return readDraftSafely;`)() as (file: { size: number; arrayBuffer(): Promise<ArrayBuffer> }, current: () => boolean, validate: (value: unknown) => boolean) => Promise<unknown>;
function bytes(text: string) { return new TextEncoder().encode(text).buffer; }
function deferred() { let resolve!: (value: ArrayBuffer) => void; const promise = new Promise<ArrayBuffer>(r => { resolve = r; }); return { promise, resolve }; }

test("edits made while a draft is reading withhold the imported snapshot", async () => {
  const pending = deferred(); let current = true; let validations = 0;
  const result = readDraft({ size: 100, arrayBuffer: () => pending.promise }, () => current, () => { validations++; return true; });
  current = false; pending.resolve(bytes('{"draft":"old"}'));
  assert.equal(await result, null); assert.equal(validations, 0);
});

test("overlapping imports cannot apply the older file or parse stale malformed data", async () => {
  const older = deferred(), newer = deferred(); let generation = 1;
  const first = readDraft({ size: 100, arrayBuffer: () => older.promise }, () => generation === 1, () => true);
  generation = 2;
  const second = readDraft({ size: 100, arrayBuffer: () => newer.promise }, () => generation === 2, () => true);
  newer.resolve(bytes('{"draft":"new"}')); assert.deepEqual(await second, { draft: "new" });
  older.resolve(bytes('invalid stale JSON')); assert.equal(await first, null);
});

test("current imports still reject malformed or invalid review data", async () => {
  await assert.rejects(readDraft({ size: 6, arrayBuffer: async () => bytes("broken") }, () => true, () => true));
  await assert.rejects(readDraft({ size: 2, arrayBuffer: async () => bytes("{}") }, () => true, () => false));
});

const textFunctions = template.split("function exactKeys")[1].split("/* DRAFT_READER_START */")[0];
const printable = new Function(`function exactKeys${textFunctions}; return printable;`)() as (text: string) => boolean;
test("review text agrees with Python printability for separators, formatting characters and surrogates", () => {
  for (const value of ["a\u00a0b", "a\u200bb", "a\ud800b", "a\nb", "a\u2028b", "a\x7fb"]) assert.equal(printable(value), false, JSON.stringify(value));
  for (const value of ["Plain text", "مخلوط آب و خشکی", "café", "🌊"]) assert.equal(printable(value), true);
});

test("exporting current answers does not invalidate a pending replacement, while actual answer edits do", () => {
  let click!: () => void;
  const alias = { value: "first-reviewer" }, review = { reviewerAlias: "", packetHash: "fixed", reviews: [{ before: { reason: "initial" } }] };
  const context = vm.createContext({ review, index: 0, $: (id: string) => id === "alias" ? alias : { addEventListener: (_: string, fn: () => void) => { click = fn; } },
    hasUnsaved: () => false, validReview: () => true, notice() {}, Blob,
    URL: { createObjectURL: () => "" }, document: { createElement: () => ({ click() {} }) }, setTimeout() {} });
  vm.runInContext(template.match(/^function stateStamp\(\).*$/m)![0] + "\n" + template.match(/^\$\('export'\)\.addEventListener.*$/m)![0], context);
  const before = vm.runInContext("stateStamp()", context);
  click(); assert.equal(vm.runInContext("stateStamp()", context), before);
  review.reviews[0].before.reason = "new recorded answer";
  assert.notEqual(vm.runInContext("stateStamp()", context), before);
});
