import { authorizedUser, readGatewayBody, signGatewayRequest, type GatewayConfig } from "./radar-gateway";
import { assessmentRequestSchema, scenarioRequestSchema } from "./observatory-contract";

const fail = (status: number, code: string, error: string) => Response.json({ code, error }, { status, headers: { "Cache-Control": "private, no-store" } });
export async function forwardObservatoryRequest(request: Request, path: string, config: GatewayConfig, fetcher: typeof fetch = fetch) {
  const user = authorizedUser(request, config);
  if (user instanceof Response) return user;
  let base: URL;
  try {
    base = new URL(config.baseUrl);
    if (!config.secret || base.username || base.password || base.search || base.hash ||
      (base.protocol !== "https:" && !(config.allowLocal && base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)))) throw new Error();
  } catch { return fail(503, "PROCESSING_NOT_CONFIGURED", "Assessment processing needs a service connection."); }
  const collection = /^\/api\/(assessments|scenarios)$/.exec(path);
  const item = /^\/api\/(assessments|scenarios)\/([a-zA-Z0-9_-]{1,100})(?:\/(cancel|brief|snapshot|artifacts\/[a-zA-Z0-9_.-]+))?$/.exec(path);
  const snapshots = /^\/api\/assessment-snapshots(?:\/[a-zA-Z0-9_-]{1,100})?$/.test(path);
  const readOnly = path === "/api/sources" || snapshots;
  if (!(collection || item || readOnly)) return fail(400, "INVALID_REQUEST", "Invalid assessment endpoint.");
  if (!['GET', 'POST'].includes(request.method) || (request.method === "POST" && (readOnly || (item && !['cancel', 'snapshot'].includes(item[3])))) ||
    (request.method === "GET" && item && ['cancel', 'snapshot'].includes(item[3]))) return fail(405, "INVALID_REQUEST", "Unsupported request method.");
  let body = "";
  if (request.method === "POST") {
    if (request.headers.get("origin") !== config.publicOrigin || request.headers.get("sec-fetch-site") === "cross-site") return fail(403, "INVALID_ORIGIN", "Submit assessments from Earthsignal.");
    const value = await readGatewayBody(request);
    if (value instanceof Response) return value;
    try {
      const parsed = JSON.parse(value || "{}");
      if (collection) body = JSON.stringify((collection[1] === "assessments" ? assessmentRequestSchema : scenarioRequestSchema).parse(parsed));
      else if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length === 0) body = "{}";
      else throw new Error();
    } catch { return fail(400, "INVALID_REQUEST", "Check your area, dates and assessment inputs."); }
  }
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomUUID();
  const headers = new Headers({ "X-Earthsignal-User": user, "X-Earthsignal-Timestamp": timestamp, "X-Earthsignal-Nonce": nonce,
    "X-Earthsignal-Signature": await signGatewayRequest(request.method, path, user, body, config.secret, timestamp, nonce), Accept: "application/json",
    "User-Agent": "Earthsignal-Gateway/1.0 (+https://nasa.r8volt.com)" });
  if (request.method === "POST") headers.set("Content-Type", "application/json");
  if (collection && request.method === "POST") {
    const key = request.headers.get("Idempotency-Key");
    if (!key || !/^[a-zA-Z0-9_-]{8,100}$/.test(key)) return fail(400, "INVALID_REQUEST", "A valid idempotency key is required.");
    headers.set("Idempotency-Key", key);
  }
  try {
    const upstream = await fetcher(new URL(path, base), { method: request.method, headers, body: request.method === "POST" ? body : undefined,
      redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
    const out = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" });
    for (const h of ['content-type', 'content-disposition', 'content-length', 'retry-after']) { const v = upstream.headers.get(h); if (v) out.set(h, v); }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch { return fail(503, "PROCESSING_UNAVAILABLE", "The assessment service is temporarily unavailable. Your analytical workspace is still available."); }
}
