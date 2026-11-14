// Native Node server / operator CLI only. Never import this module from client code.
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, openSync } from "node:fs";
import { isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";

// OWASP Password Storage Cheat Sheet, scrypt: N=2^14, r=8, p=5 (16 MiB).
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt
const SCRYPT = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };
export const AUTH_LIMITS = Object.freeze({
  bodyBytes: 4096, passwordBytes: 1024, hashQueue: 4, postConcurrency: 8,
  bodyTimeoutMs: 5000, globalAttempts: 30, globalWindowMs: 60_000,
  usernameAttempts: 5, usernameWindowMs: 15 * 60_000, usernameBuckets: 256,
  sessionsPerUser: 8, sessionsTotal: 4096,
  absoluteMs: 7 * 24 * 60 * 60_000, idleMs: 24 * 60 * 60_000,
});
export type LocalUser = { id: string; username: string };
export type LocalAuthConfig = { dbPath: string; publicOrigin?: string; production?: boolean };
type UserRow = LocalUser & { password_hash: string; enabled: number };
type ProcessState = { hashing: boolean; waiters: Array<() => void>; posts: number; service?: LocalAuth; key?: string };
// Share the resource gate across route modules and development module reloads.
const globalState = globalThis as typeof globalThis & { __earthsignalAuthState?: ProcessState };
const state = globalState.__earthsignalAuthState ??= { hashing: false, waiters: [], posts: 0 };
const DUMMY_SALT = randomBytes(16).toString("hex");
const DUMMY_HASH = randomBytes(64);
class AuthError extends Error {
  readonly status: number;
  constructor(status: number) { super("Authentication request failed"); this.status = status; }
}

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function normalizeUsername(value: string) {
  if (typeof value !== "string" || value.length > 128) throw new AuthError(400);
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) throw new AuthError(400);
  return username;
}
function validPassword(password: unknown): password is string {
  return typeof password === "string" && password.length > 0 && Buffer.byteLength(password) <= AUTH_LIMITS.passwordBytes;
}
async function derive(password: string, salt: string): Promise<Buffer> {
  if (state.hashing) {
    if (state.waiters.length >= AUTH_LIMITS.hashQueue) throw new AuthError(429);
    await new Promise<void>((resolve) => state.waiters.push(resolve));
  } else state.hashing = true;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, SCRYPT, (error, result) => error ? reject(error) : resolve(result));
    });
  } finally {
    const next = state.waiters.shift();
    if (next) next(); else state.hashing = false;
  }
}
async function encodePassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$16384$8$5$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
async function verifyPassword(password: string, encoded?: string) {
  const parts = encoded?.split("$");
  const valid = parts?.length === 6 && parts.slice(0, 4).join("$") === "scrypt$16384$8$5"
    && /^[a-f0-9]{32}$/.test(parts[4]) && /^[a-f0-9]{128}$/.test(parts[5]);
  // Unknown, disabled and malformed accounts still perform one identical-cost KDF.
  const actual = await derive(password, valid ? parts![4] : DUMMY_SALT);
  const expected = valid ? Buffer.from(parts![5], "hex") : DUMMY_HASH;
  const matches = timingSafeEqual(actual, expected);
  return Boolean(valid && matches);
}
/**
 * Temporary open access: until EARTHSIGNAL_OPEN_ACCESS_UNTIL (an ISO date), visitors who are not
 * signed in get a private guest identity. It switches off by itself once the date passes.
 * The guest id is a salted hash of the client address, so each visitor only sees their own jobs
 * and per-owner limits still apply. nginx overwrites X-Forwarded-For with $remote_addr.
 */
export function openAccessGuest(request: Request, now = Date.now()): LocalUser | null {
  const until = Date.parse(process.env.EARTHSIGNAL_OPEN_ACCESS_UNTIL ?? "");
  if (!(until > now)) return null;
  const address = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  if (!address) return null;
  const id = digest(`${process.env.EARTHSIGNAL_GATEWAY_SECRET ?? ""}|open-access-guest|${address}`).slice(0, 16);
  return { id: `guest-${id}`, username: `guest-${id.slice(0, 6)}` };
}
function webOrigin(config: LocalAuthConfig) {
  const value = config.publicOrigin;
  if (!value) throw new AuthError(503);
  let url: URL;
  try { url = new URL(value); } catch { throw new AuthError(503); }
  if (url.origin !== value || url.username || url.password
    || (url.protocol !== "https:" && !(url.protocol === "http:" && !config.production
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new AuthError(503);
  return value;
}
function cookieName(config: LocalAuthConfig) {
  return config.production ? "__Host-earthsignal-session" : "earthsignal-session";
}
function requestToken(request: Request, config: LocalAuthConfig) {
  const raw = request.headers.get("cookie") ?? "";
  if (raw.length > 4096) return null;
  const entries = raw.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${cookieName(config)}=`));
  if (entries.length !== 1) return null;
  const token = entries[0].slice(cookieName(config).length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) && Buffer.from(token, "base64url").toString("base64url") === token ? token : null;
}
function sessionCookie(config: LocalAuthConfig, token: string, clear = false) {
  // MDN __Host- cookies: Secure; Path=/; no Domain. SameSite supplements Origin checks.
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie
  const secure = config.production || webOrigin(config).startsWith("https:");
  return `${cookieName(config)}=${token}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=${clear ? 0 : AUTH_LIMITS.absoluteMs / 1000}`;
}
function json(value: unknown, status = 200, cookie?: string) {
  return Response.json(value, { status, headers: {
    "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff",
    ...(cookie ? { "Set-Cookie": cookie } : {}),
    ...(status === 429 ? { "Retry-After": "60" } : {}),
  } });
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new AuthError(400);
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > AUTH_LIMITS.bodyBytes)) throw new AuthError(413);
  if (!request.body) throw new AuthError(400);
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new AuthError(400)); }, AUTH_LIMITS.bodyTimeoutMs);
  });
  try {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let reads = 0;
    while (true) {
      // A byte limit alone does not bound an adversarial stream of empty chunks.
      if (++reads > AUTH_LIMITS.bodyBytes + 1) { void reader.cancel().catch(() => {}); throw new AuthError(400); }
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > AUTH_LIMITS.bodyBytes) { void reader.cancel().catch(() => {}); throw new AuthError(413); }
      if (chunk.value.byteLength) chunks.push(chunk.value);
    }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AuthError(400);
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(400);
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

export class LocalAuth {
  private readonly db: DatabaseSync;
  readonly config: LocalAuthConfig;
  private readonly now: () => number;
  constructor(config: LocalAuthConfig, now = Date.now) {
    this.config = config;
    this.now = now;
    if (!isAbsolute(config.dbPath) || config.dbPath === ":memory:") throw new AuthError(503);
    // Operator supplies an existing private parent directory. Refuse final-path symlinks.
    const fd = openSync(config.dbPath, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    try {
      if (!fstatSync(fd).isFile()) throw new AuthError(503);
      fchmodSync(fd, 0o600);
    } finally { closeSync(fd); }
    this.db = new DatabaseSync(config.dbPath);
    try {
      this.db.exec(`PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS collaborators (
          id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id, created_at);
        CREATE TABLE IF NOT EXISTS login_buckets (
          bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL
        );`);
    } catch (error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  list(): Array<LocalUser & { enabled: boolean }> {
    return this.db.prepare("SELECT id, username, enabled FROM collaborators ORDER BY username").all()
      .map((row) => ({ id: row.id as string, username: row.username as string, enabled: row.enabled === 1 }));
  }
  async provision(username: string, password: string): Promise<LocalUser> {
    username = normalizeUsername(username);
    if (!validPassword(password) || [...password].length < 15) throw new AuthError(400);
    const encoded = await encodePassword(password);
    const user = { id: randomUUID(), username };
    this.db.prepare("INSERT INTO collaborators(id, username, password_hash) VALUES(?, ?, ?)").run(user.id, username, encoded);
    return user;
  }
  async reset(username: string, password: string) {
    username = normalizeUsername(username);
    if (!validPassword(password) || [...password].length < 15) throw new AuthError(400);
    const encoded = await encodePassword(password);
    this.transaction(() => {
      const user = this.db.prepare("SELECT id FROM collaborators WHERE username=?").get(username);
      if (!user) throw new AuthError(400);
      // Reset also re-enables an explicitly operator-managed account.
      this.db.prepare("UPDATE collaborators SET password_hash=?, enabled=1 WHERE id=?").run(encoded, user.id);
      this.db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
    });
  }
  disable(username: string) {
    username = normalizeUsername(username);
    this.transaction(() => {
      const user = this.db.prepare("SELECT id FROM collaborators WHERE username=?").get(username);
      if (!user) throw new AuthError(400);
      this.db.prepare("UPDATE collaborators SET enabled=0 WHERE id=?").run(user.id);
      this.db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
    });
  }
  private throttle(username: string) {
    const now = this.now();
    return this.transaction(() => {
      this.db.prepare("DELETE FROM login_buckets WHERE expires_at<=?").run(now);
      let allowed = true;
      for (const [bucket, limit, window] of [
        ["global", AUTH_LIMITS.globalAttempts, AUTH_LIMITS.globalWindowMs],
        [`user:${digest(username)}`, AUTH_LIMITS.usernameAttempts, AUTH_LIMITS.usernameWindowMs],
      ] as const) {
        const row = this.db.prepare("SELECT attempts FROM login_buckets WHERE bucket=?").get(bucket);
        if (row) {
          if (Number(row.attempts) >= limit) {
            allowed = false;
            if (bucket === "global") break;
            continue;
          }
          this.db.prepare("UPDATE login_buckets SET attempts=attempts+1 WHERE bucket=?").run(bucket);
        } else {
          const count = this.db.prepare("SELECT COUNT(*) AS n FROM login_buckets WHERE bucket!='global'").get()!;
          if (bucket !== "global" && Number(count.n) >= AUTH_LIMITS.usernameBuckets) { allowed = false; continue; }
          this.db.prepare("INSERT INTO login_buckets VALUES(?, 1, ?)").run(bucket, now + window);
        }
        // Global exhaustion prevents creation of attacker-selected username buckets.
        if (!allowed && bucket === "global") break;
      }
      return allowed;
    });
  }
  async user(request: Request): Promise<LocalUser | null> {
    // A real collaborator session always wins over guest access.
    const collaborator = await this.collaborator(request);
    if (collaborator) return collaborator;
    try {
      if (request.method === "POST" && request.headers.get("origin") !== webOrigin(this.config)) return null;
    } catch { return null; }
    return openAccessGuest(request, this.now());
  }
  private async collaborator(request: Request): Promise<LocalUser | null> {
    try {
      const origin = webOrigin(this.config);
      if (request.method === "POST" && request.headers.get("origin") !== origin) return null;
      const token = requestToken(request, this.config);
      if (!token) return null;
      const now = this.now();
      return this.transaction(() => {
        const row = this.db.prepare(`SELECT c.id, c.username FROM sessions s JOIN collaborators c ON c.id=s.user_id
          WHERE s.token_hash=? AND c.enabled=1 AND s.expires_at>? AND s.last_seen>?`).get(digest(token), now, now - AUTH_LIMITS.idleMs);
        if (!row) {
          this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(token));
          return null;
        }
        this.db.prepare("UPDATE sessions SET last_seen=? WHERE token_hash=?").run(now, digest(token));
        return { id: row.id as string, username: row.username as string };
      });
    } catch { return null; }
  }
  async handle(request: Request, action: "session" | "login" | "logout"): Promise<Response> {
    let admitted = false;
    try {
      const origin = webOrigin(this.config);
      if (action === "session") {
        if (request.method !== "GET") return json({ error: "Request not allowed." }, 405);
        return json({ user: await this.user(request) });
      }
      if (request.method !== "POST") return json({ error: "Request not allowed." }, 405);
      // Exact configured Origin; Host, Forwarded and arbitrary identity headers are never trusted.
      if (request.headers.get("origin") !== origin) throw new AuthError(403);
      if (state.posts >= AUTH_LIMITS.postConcurrency) throw new AuthError(429);
      state.posts++; admitted = true;
      const body = await readBody(request);
      if (action === "logout") {
        if (Object.keys(body).length) throw new AuthError(400);
        const old = requestToken(request, this.config);
        if (old) this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(old));
        return json({ user: null }, 200, sessionCookie(this.config, "", true));
      }
      if (Object.keys(body).some((key) => key !== "username" && key !== "password")
        || typeof body.username !== "string" || !validPassword(body.password)) throw new AuthError(400);
      let username: string;
      try { username = normalizeUsername(body.username); }
      catch { username = ""; }
      if (!this.throttle(username)) throw new AuthError(429);
      const row = this.db.prepare("SELECT id, username, password_hash, enabled FROM collaborators WHERE username=?").get(username) as UserRow | undefined;
      const matches = await verifyPassword(body.password, row?.enabled === 1 ? row.password_hash : undefined);
      if (!matches || !row || row.enabled !== 1) return json({ error: "Sign-in failed. Check your username and password." }, 401);
      const token = randomBytes(32).toString("base64url");
      const user = this.transaction(() => {
        // Re-read after asynchronous hashing: a concurrent operator reset/disable must win.
        const fresh = this.db.prepare("SELECT password_hash, enabled FROM collaborators WHERE id=?").get(row.id);
        if (fresh?.enabled !== 1 || fresh.password_hash !== row.password_hash) throw new AuthError(401);
        const now = this.now();
        this.db.prepare("DELETE FROM sessions WHERE expires_at<=? OR last_seen<=?").run(now, now - AUTH_LIMITS.idleMs);
        const old = requestToken(request, this.config);
        if (old) this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(old));
        // Bound persistent session growth, preserving at most eight sessions per collaborator.
        this.db.prepare(`DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions
          WHERE user_id=? ORDER BY created_at DESC, token_hash DESC LIMIT -1 OFFSET ?)`).run(row.id, AUTH_LIMITS.sessionsPerUser - 1);
        if (Number(this.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()!.n) >= AUTH_LIMITS.sessionsTotal) throw new AuthError(429);
        this.db.prepare("INSERT INTO sessions VALUES(?, ?, ?, ?, ?)").run(digest(token), row.id, now, now + AUTH_LIMITS.absoluteMs, now);
        return { id: row.id, username: row.username };
      });
      return json({ user }, 200, sessionCookie(this.config, token));
    } catch (error) {
      const status = error instanceof AuthError ? error.status : 503;
      const message = status === 401 ? "Sign-in failed. Check your username and password."
        : status === 429 ? "Too many attempts. Try again later."
        : status === 503 ? "Collaborator access is temporarily unavailable." : "Authentication request failed.";
      return json({ error: message }, status);
    } finally { if (admitted) state.posts--; }
  }
}

function configuredService() {
  const config = {
    dbPath: process.env.EARTHSIGNAL_AUTH_DB ?? "",
    publicOrigin: process.env.EARTHSIGNAL_PUBLIC_ORIGIN,
    production: process.env.NODE_ENV === "production",
  };
  webOrigin(config);
  const key = JSON.stringify(config);
  // Deployment configuration changes require restart; never use a stale service with new settings.
  if (state.service && state.key !== key) throw new AuthError(503);
  if (!state.service) { state.service = new LocalAuth(config); state.key = key; }
  return state.service;
}
export async function authenticatedUser(request: Request): Promise<LocalUser | null> {
  try { return await configuredService().user(request); } catch { return null; }
}
export async function authRoute(request: Request, action: "session" | "login" | "logout") {
  try { return await configuredService().handle(request, action); }
  catch { return json({ error: "Collaborator access is temporarily unavailable." }, 503); }
}
