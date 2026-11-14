import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { AUTH_LIMITS, LocalAuth, authenticatedUser, authRoute } from "../lib/local-auth";

const ORIGIN = "https://earthsignal.test";
const PASSWORD = "independent local test password";
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "earthsignal-auth-test-"));
  const dbPath = join(directory, "auth.sqlite");
  let clock = 1_900_000_000_000;
  const config = { dbPath, publicOrigin: ORIGIN, production: true };
  const service = new LocalAuth(config, () => clock);
  const db = new DatabaseSync(dbPath);
  t.after(() => { db.close(); service.close(); rmSync(directory, { recursive: true, force: true }); });
  return { service, db, dbPath, config, now: () => clock, advance: (ms: number) => { clock += ms; } };
}
function post(action: string, body: unknown = {}, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/auth/${action}`, {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
}
function login(username = "alice", password = PASSWORD, headers: Record<string, string> = {}) {
  return post("login", { username, password }, headers);
}
function cookie(response: Response) {
  const value = response.headers.get("set-cookie");
  assert.ok(value);
  return value.split(";")[0];
}
function session(cookieValue?: string, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/auth/session`, { headers: { ...(cookieValue ? { Cookie: cookieValue } : {}), ...headers } });
}
function count(db: DatabaseSync, table: "sessions" | "login_buckets") {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
}

test("operator normalization, opaque stable ID, unique accounts, WAL and private file", async (t) => {
  const { service, db, dbPath } = fixture(t);
  const user = await service.provision(" Alice ", PASSWORD);
  assert.equal(user.username, "alice");
  assert.match(user.id, /^[a-f0-9-]{36}$/);
  assert.notEqual(user.id, user.username);
  await assert.rejects(service.provision("ALICE", PASSWORD));
  await assert.rejects(service.provision("a", PASSWORD));
  await assert.rejects(service.provision("bob", "too short"));
  assert.equal(db.prepare("PRAGMA journal_mode").get()!.journal_mode, "wal");
  assert.equal(statSync(dbPath).mode & 0o777, 0o600);
  assert.equal(statSync(`${dbPath}-wal`).mode & 0o777, 0o600);
  assert.equal(statSync(`${dbPath}-shm`).mode & 0o777, 0o600);
  const encoded = db.prepare("SELECT password_hash FROM collaborators").get()!.password_hash as string;
  assert.match(encoded, /^scrypt\$16384\$8\$5\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.ok(!encoded.includes(PASSWORD));
  await service.reset("alice", "another independent local password");
  assert.deepEqual(service.list(), [{ ...user, enabled: true }]);
});

test("spoofed identity and forwarding headers cannot authenticate", async (t) => {
  const { service } = fixture(t);
  await service.provision("alice", PASSWORD);
  const spoof = session(undefined, {
    "oai-authenticated-user-id": "alice", "oai-authenticated-user-email": "alice@example.test",
    "X-Earthsignal-User": "alice", "X-Authenticated-User": "alice",
    "X-Forwarded-User": "alice", "X-Forwarded-For": "127.0.0.1", "Forwarded": "for=127.0.0.1;host=earthsignal.test;proto=https",
  });
  assert.equal(await service.user(spoof), null);
  assert.deepEqual(await (await service.handle(spoof, "session")).json(), { user: null });
});

test("sessions store SHA256 only, minimal identity, host cookie and no-store", async (t) => {
  const { service, db } = fixture(t);
  const user = await service.provision("alice", PASSWORD);
  const response = await service.handle(login(" ALICE "), "login");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user });
  const cookieValue = cookie(response);
  const token = cookieValue.split("=")[1];
  assert.equal(Buffer.from(token, "base64url").length, 32);
  const setCookie = response.headers.get("set-cookie")!;
  assert.ok(setCookie.startsWith("__Host-earthsignal-session="));
  for (const attribute of ["Secure", "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=604800"]) assert.ok(setCookie.includes(attribute));
  assert.ok(!setCookie.includes("Domain="));
  const row = db.prepare("SELECT * FROM sessions").get()!;
  assert.equal(row.token_hash, createHash("sha256").update(token).digest("hex"));
  assert.ok(!JSON.stringify(row).includes(token));
  const current = await service.handle(session(cookieValue), "session");
  assert.deepEqual(await current.json(), { user });
  assert.equal(current.headers.get("cache-control"), "private, no-store");
  assert.equal(await service.user(session(`${cookieValue}; ${cookieValue}`)), null);
  assert.equal(await service.user(session("__Host-earthsignal-session=bad")), null);
});

test("unknown, wrong, disabled and invalid username receive identical failure", async (t) => {
  const { service } = fixture(t);
  await service.provision("alice", PASSWORD);
  await service.provision("invalid-username", PASSWORD);
  await service.provision("disabled", PASSWORD);
  service.disable("disabled");
  let expected: unknown;
  for (const [username, password] of [["alice", "wrong password"], ["missing", PASSWORD], ["disabled", PASSWORD], ["???", PASSWORD]]) {
    const response = await service.handle(login(username, password), "login");
    assert.equal(response.status, 401);
    const body = await response.json();
    if (!expected) expected = body;
    assert.deepEqual(body, expected);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("login and logout require exact configured Origin, independent of Host/Forwarded", async (t) => {
  const { service, db } = fixture(t);
  await service.provision("alice", PASSWORD);
  const cookieValue = cookie(await service.handle(login(), "login"));
  for (const action of ["login", "logout"] as const) {
    for (const origin of [undefined, "null", "https://evil.test", `${ORIGIN}/`, "https://earthsignal.test:443", "https://earthsignal.test.evil.test"]) {
      const request = post(action, action === "login" ? { username: "alice", password: PASSWORD } : {}, {
        Cookie: cookieValue, Host: "earthsignal.test", "X-Forwarded-Host": "earthsignal.test", "X-Forwarded-Proto": "https",
      });
      if (origin === undefined) request.headers.delete("Origin"); else request.headers.set("Origin", origin);
      const response = await service.handle(request, action);
      assert.equal(response.status, 403, `${action}: ${origin}`);
      assert.equal(response.headers.get("set-cookie"), null);
    }
  }
  assert.equal(count(db, "sessions"), 1);
  assert.equal(count(db, "login_buckets"), 2);
  assert.ok(await service.user(session(cookieValue)));
  for (const origin of [undefined, "null", "https://evil.test"]) {
    const request = post("other-protected-action", {}, { Cookie: cookieValue });
    if (origin === undefined) request.headers.delete("Origin"); else request.headers.set("Origin", origin);
    assert.equal(await service.user(request), null);
  }
  assert.ok(await service.user(post("other-protected-action", {}, { Cookie: cookieValue })));
});

test("successful login rotates presented token; logout revokes and clears it", async (t) => {
  const { service, db } = fixture(t);
  await service.provision("alice", PASSWORD);
  const first = cookie(await service.handle(login(), "login"));
  const second = cookie(await service.handle(login("alice", PASSWORD, { Cookie: first }), "login"));
  assert.notEqual(first, second);
  assert.equal(await service.user(session(first)), null);
  assert.ok(await service.user(session(second)));
  assert.equal(count(db, "sessions"), 1);
  const logout = await service.handle(post("logout", {}, { Cookie: second }), "logout");
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/);
  assert.deepEqual(await logout.json(), { user: null });
  assert.equal(await service.user(session(second)), null);
  assert.equal(count(db, "sessions"), 0);
});

test("sessions survive reopening the persistent DB", async (t) => {
  const { service, config, now } = fixture(t);
  const user = await service.provision("alice", PASSWORD);
  const value = cookie(await service.handle(login(), "login"));
  const reopened = new LocalAuth(config, now);
  try { assert.deepEqual(await reopened.user(session(value)), user); }
  finally { reopened.close(); }
});

test("idle expiry is 24h; activity cannot extend absolute seven-day expiry", async (t) => {
  const { service, advance } = fixture(t);
  await service.provision("alice", PASSWORD);
  const idle = cookie(await service.handle(login(), "login"));
  advance(AUTH_LIMITS.idleMs);
  assert.equal(await service.user(session(idle)), null);
  const absolute = cookie(await service.handle(login(), "login"));
  for (let i = 0; i < 13; i++) { advance(AUTH_LIMITS.idleMs / 2); assert.ok(await service.user(session(absolute))); }
  advance(AUTH_LIMITS.idleMs / 2);
  assert.equal(await service.user(session(absolute)), null);
});

test("operator reset and disable revoke all sessions immediately, keeping ID", async (t) => {
  const { service, db } = fixture(t);
  const user = await service.provision("alice", PASSWORD);
  const first = cookie(await service.handle(login(), "login"));
  const second = cookie(await service.handle(login(), "login"));
  await service.reset("alice", "new distinct operator password");
  assert.equal(count(db, "sessions"), 0);
  assert.equal(await service.user(session(first)), null);
  assert.equal(await service.user(session(second)), null);
  assert.equal((await service.handle(login(), "login")).status, 401);
  const newCookie = cookie(await service.handle(login("alice", "new distinct operator password"), "login"));
  assert.deepEqual(await service.user(session(newCookie)), user);
  service.disable("alice");
  assert.equal(await service.user(session(newCookie)), null);
  assert.equal(count(db, "sessions"), 0);
  assert.deepEqual(service.list(), [{ ...user, enabled: false }]);
});

test("reset during an in-flight password check cannot create a stale session", async (t) => {
  const { service, db } = fixture(t);
  await service.provision("alice", PASSWORD);
  const pending = service.handle(login(), "login");
  // Body parsing yields before the asynchronous KDF; let the check start, then mutate credentials.
  await new Promise((resolve) => setImmediate(resolve));
  db.prepare("UPDATE collaborators SET password_hash='reset-by-operator' WHERE username='alice'").run();
  assert.equal((await pending).status, 401);
  assert.equal(count(db, "sessions"), 0);
});

test("JSON body limit applies to advertised and streamed size, malformed and broken streams", async (t) => {
  const { service, db } = fixture(t);
  const advertised = login(); advertised.headers.set("Content-Length", "4097");
  assert.equal((await service.handle(advertised, "login")).status, 413);
  const bodyRequest = (body: BodyInit, contentType = "application/json") => new Request(`${ORIGIN}/api/auth/login`, {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": contentType }, body, duplex: "half",
  } as RequestInit & { duplex: "half" });
  for (const action of ["login", "logout"] as const) {
    const oversized = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(4097)); controller.close(); } });
    assert.equal((await service.handle(bodyRequest(oversized), action)).status, 413);
    assert.equal((await service.handle(bodyRequest("not JSON"), action)).status, 400);
    assert.equal((await service.handle(bodyRequest("{}", "text/plain"), action)).status, 400);
  }
  const broken = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("private stream details")); } });
  const result = await service.handle(bodyRequest(broken), "login");
  assert.equal(result.status, 400);
  assert.ok(!(await result.text()).includes("private stream"));
  const emptyChunks = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array()); } });
  assert.equal((await service.handle(bodyRequest(emptyChunks), "login")).status, 400);
  assert.equal((await service.handle(login("alice", "x".repeat(1025)), "login")).status, 400);
  assert.equal((await service.handle(post("logout", { extra: true }), "logout")).status, 400);
  assert.equal(count(db, "login_buckets"), 0);
});

test("per-username throttling is normalized and cannot be evaded by forwarding headers", async (t) => {
  const { service, db, advance } = fixture(t);
  for (let i = 0; i < AUTH_LIMITS.usernameAttempts; i++) {
    assert.equal((await service.handle(login(i % 2 ? " Alice " : "ALICE", "wrong", { "X-Forwarded-For": `192.0.2.${i}` }), "login")).status, 401);
  }
  const rejected = await service.handle(login("alice", "wrong", { "X-Forwarded-For": "8.8.8.8" }), "login");
  assert.equal(rejected.status, 429);
  assert.equal(rejected.headers.get("retry-after"), "60");
  assert.equal(count(db, "login_buckets"), 2);
  advance(AUTH_LIMITS.usernameWindowMs);
  assert.equal((await service.handle(login("alice", "wrong"), "login")).status, 401);
});

test("slow body readers are bounded globally and time out before hashing", async (t) => {
  const { service, db } = fixture(t);
  const requests = Array.from({ length: AUTH_LIMITS.postConcurrency + 1 }, () => {
    const request = new Request(`${ORIGIN}/api/auth/login`, {
      method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: new ReadableStream<Uint8Array>({}), duplex: "half",
    } as RequestInit & { duplex: "half" });
    return service.handle(request, "login");
  });
  const responses = await Promise.all(requests);
  assert.equal(responses.filter((response) => response.status === 400).length, AUTH_LIMITS.postConcurrency);
  assert.equal(responses.filter((response) => response.status === 429).length, 1);
  assert.equal(count(db, "login_buckets"), 0);
});

test("global throttle persists across DB connections and arbitrary username buckets stay bounded", async (t) => {
  const { service, db, config, now, advance } = fixture(t);
  db.prepare("INSERT INTO login_buckets VALUES('global', ?, ?)").run(AUTH_LIMITS.globalAttempts, now() + AUTH_LIMITS.globalWindowMs);
  const reopened = new LocalAuth(config, now);
  try {
    const rejection = await reopened.handle(login("new-username", "wrong"), "login");
    assert.equal(rejection.status, 429);
    assert.equal(count(db, "login_buckets"), 1);
  } finally { reopened.close(); }
  advance(AUTH_LIMITS.globalWindowMs);
  for (let i = 0; i < AUTH_LIMITS.usernameBuckets; i++) {
    db.prepare("INSERT INTO login_buckets VALUES(?, 1, ?)").run(`user:seed-${i}`, now() + AUTH_LIMITS.usernameWindowMs);
  }
  assert.equal((await service.handle(login("new-username", "wrong"), "login")).status, 429);
  assert.equal(count(db, "login_buckets"), AUTH_LIMITS.usernameBuckets + 1);
  advance(AUTH_LIMITS.usernameWindowMs);
  assert.equal((await service.handle(login("new-username", "wrong"), "login")).status, 401);
  assert.equal(count(db, "login_buckets"), 2);
});

test("parallel password work admits one hash plus four waiters and rejects overflow", async (t) => {
  const { service } = fixture(t);
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => service.handle(login(`unknown-${i}`, "wrong"), "login")));
  assert.equal(responses.filter((response) => response.status === 401).length, AUTH_LIMITS.hashQueue + 1);
  assert.equal(responses.filter((response) => response.status === 429).length, 12 - AUTH_LIMITS.hashQueue - 1);
});

test("successful sessions are persistently bounded without extending absolute lifetime", async (t) => {
  const { service, db, now, advance } = fixture(t);
  const user = await service.provision("alice", PASSWORD);
  for (let i = 0; i < AUTH_LIMITS.sessionsPerUser; i++) {
    db.prepare("INSERT INTO sessions VALUES(?, ?, ?, ?, ?)").run(`old-${i}`, user.id, now(), now() + AUTH_LIMITS.absoluteMs, now());
  }
  advance(1000);
  const response = await service.handle(login(), "login");
  assert.equal(response.status, 200);
  assert.equal(count(db, "sessions"), AUTH_LIMITS.sessionsPerUser);
  const newest = db.prepare("SELECT expires_at FROM sessions ORDER BY created_at DESC LIMIT 1").get()!;
  assert.equal(newest.expires_at, now() + AUTH_LIMITS.absoluteMs);
});

test("invalid or missing configuration fails closed without crashing session/public callers", async (t) => {
  assert.throws(() => new LocalAuth({ dbPath: "relative.sqlite", publicOrigin: ORIGIN }));
  const { dbPath } = fixture(t);
  for (const publicOrigin of [undefined, `${ORIGIN}/`, "https://name:pass@earthsignal.test", "http://earthsignal.test", "null"]) {
    const invalid = new LocalAuth({ dbPath, publicOrigin, production: true });
    try {
      assert.equal(await invalid.user(session()), null);
      assert.equal((await invalid.handle(login(), "login")).status, 503);
      assert.equal((await invalid.handle(session(), "session")).status, 503);
    } finally { invalid.close(); }
  }
  const previous = process.env.EARTHSIGNAL_AUTH_DB;
  process.env.EARTHSIGNAL_AUTH_DB = "relative.sqlite";
  try {
    assert.equal(await authenticatedUser(session(undefined, { "X-Earthsignal-User": "alice" })), null);
    assert.equal((await authRoute(session(), "session")).status, 503);
  } finally {
    if (previous === undefined) delete process.env.EARTHSIGNAL_AUTH_DB; else process.env.EARTHSIGNAL_AUTH_DB = previous;
  }
});

test("operator CLI reads stdin, lists safe identity, resets/disables and rejects password argv", (t) => {
  const { dbPath } = fixture(t);
  const run = (args: string[], input?: string) => spawnSync(process.execPath, ["scripts/collaborator.mjs", ...args], {
    cwd: process.cwd(), env: { ...process.env, EARTHSIGNAL_AUTH_DB: dbPath }, input, encoding: "utf8",
  });
  const create = run(["provision", "alice", "--stdin"], `${PASSWORD}\n`);
  assert.equal(create.status, 0, create.stderr);
  assert.equal(JSON.parse(create.stdout).username, "alice");
  assert.ok(!`${create.stdout}${create.stderr}`.includes(PASSWORD));
  const list = run(["list"]);
  assert.equal(list.status, 0, list.stderr);
  assert.equal(JSON.parse(list.stdout)[0].enabled, true);
  assert.ok(!list.stdout.includes("password_hash"));
  assert.equal(run(["reset", "alice", "--stdin"], "new CLI independent password\n").status, 0);
  assert.equal(run(["disable", "alice"]).status, 0);
  assert.equal(JSON.parse(run(["list"]).stdout)[0].enabled, false);
  const bad = run(["provision", "bob", PASSWORD]);
  assert.equal(bad.status, 1);
  assert.ok(!`${bad.stdout}${bad.stderr}`.includes(PASSWORD));
  const multiline = run(["provision", "bob", "--stdin"], `${PASSWORD}\n${PASSWORD}\n`);
  assert.equal(multiline.status, 1);
});
