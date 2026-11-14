import test from "node:test";
import assert from "node:assert/strict";
import { referenceReviewPage } from "../lib/reference-review-page";

test("anonymous review navigation loads no exercise data and redirects to collaborator sign-in", async () => {
  let loaded = 0;
  const response = await referenceReviewPage(new Request("https://nasa.r8volt.com/reference-review"), null, async () => { loaded++; return "private exercise"; });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/sign-in?continue=reference-review");
  assert.equal(loaded, 0);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("authorized reviewer receives a noncacheable document with no network or frame access", async () => {
  const response = await referenceReviewPage(new Request("https://nasa.r8volt.com/reference-review"), { id: "collaborator" }, async () => "<h1>Development exercise</h1>");
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "<h1>Development exercise</h1>");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.match(response.headers.get("content-type")!, /text\/html/);
  assert.match(response.headers.get("content-security-policy")!, /connect-src 'none'/);
  assert.match(response.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});


test("protected route serves the actual generated module export", async () => {
  const { OPTICAL_REVIEW_HTML } = await import("../lib/reference-review.generated");
  assert.equal(typeof OPTICAL_REVIEW_HTML, "string");
  const response = await referenceReviewPage(new Request("https://nasa.r8volt.com/reference-review"), { id: "fixture" }, async () => OPTICAL_REVIEW_HTML);
  const html = await response.text();
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("Compare two saved reviews"));
  assert.ok(html.includes("optical-review-comparison-v1"));
});


test("anonymous redirect preserves external HTTPS through an HTTP origin proxy", async () => {
  const response = await referenceReviewPage(new Request("http://127.0.0.1:3040/reference-review"), null, async () => { throw Error("must not load"); });
  const target = new URL(response.headers.get("location")!, "https://nasa.r8volt.com/reference-review");
  assert.equal(target.href, "https://nasa.r8volt.com/sign-in?continue=reference-review");
});
