import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalAuth } from "../lib/local-auth";
import { assistantRoute, AssistantQuota } from "../lib/assistant-server";
import { assistantPreviewHash } from "../lib/assistant-contract";

test("authenticated assistant distinguishes provider failures without retries or leaking provider text", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "earthsignal-assistant-route-"));
  const origin = "https://earthsignal.test";
  const dbPath = join(directory, "auth.sqlite3");
  const env = {
    EARTHSIGNAL_AUTH_DB: dbPath,
    EARTHSIGNAL_PUBLIC_ORIGIN: origin,
    EARTHSIGNAL_ASSISTANT_DB: join(directory, "assistant.sqlite3"),
    EARTHSIGNAL_GEMINI_API_KEY: "test-only-key-never-transmitted",
    EARTHSIGNAL_GEMINI_FREE_TIER: "true",
    EARTHSIGNAL_ASSISTANT_USER_DAILY: "5",
    EARTHSIGNAL_ASSISTANT_GLOBAL_DAILY: "20",
  };
  const previous = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  const service = new LocalAuth({ dbPath, publicOrigin: origin, production: process.env.NODE_ENV === "production" });
  const globals = globalThis as typeof globalThis & {
    __earthsignalAuthState?: { service?: LocalAuth };
    __earthsignalAssistant?: { quota?: AssistantQuota };
  };
  t.after(() => {
    service.close(); globals.__earthsignalAuthState?.service?.close(); globals.__earthsignalAssistant?.quota?.close();
    for (const k of Object.keys(env)) { if (previous[k] === undefined) delete process.env[k]; else process.env[k] = previous[k]; }
    rmSync(directory, { recursive: true, force: true });
  });
  const password = "isolated fixture password";
  await service.provision("test-user", password);
  const login = await service.handle(new Request(`${origin}/api/auth/login`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ username: "test-user", password }),
  }), "login");
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const question = "What is a thermal anomaly?", evidenceIds = ["nasa-firms"];
  const body = { schemaVersion: "1.0", publicAIOptIn: true, question, evidenceIds, previewHash: await assistantPreviewHash(question, evidenceIds) };
  let providerStatus = 503, calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ error: { message: "untrusted provider text with secret-like data" } }, { status: providerStatus });
  });
  const request = () => new Request(`${origin}/api/assistant`, { method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await assistantRoute(new Request(`${origin}/api/assistant`))).status, 401);
  assert.equal(calls, 0);
  for (const [http, status, code] of [
    [503, 503, "ASSISTANT_PROVIDER_UNAVAILABLE"],
    [401, 503, "ASSISTANT_CONFIGURATION_ERROR"],
    [429, 429, "ASSISTANT_PROVIDER_LIMIT"],
    [200, 503, "ASSISTANT_WITHHELD"],
  ] as const) {
    providerStatus = http;
    const before: number = calls;
    const response = await assistantRoute(request());
    const value = await response.json() as { code?: unknown; blocks?: unknown };
    assert.equal(response.status, status);
    assert.equal(value.code, code);
    assert.equal(calls, before + 1);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.ok(!JSON.stringify(value).includes("secret-like"));
    assert.ok(!JSON.stringify(value).includes(env.EARTHSIGNAL_GEMINI_API_KEY));
    assert.equal(value.blocks, undefined);
  }
});
