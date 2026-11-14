import { authorizedUser, readGatewayBody, signGatewayRequest, type GatewayConfig } from "./radar-gateway";

export const AREA_INPUT_BYTES = 2 * 1024 * 1024;
const fail = (status: number, code: string, error: string) => Response.json({ code, error }, { status, headers: { "Cache-Control": "private, no-store" } });
// Separate admission prevents large uploads from exhausting the web service.
let reading = 0;
export async function readAreaInput(request: Request): Promise<string | Response> {
  if (reading >= 2) return fail(429, "UPLOAD_LIMIT", "Two files are already being read. Try again shortly.");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > AREA_INPUT_BYTES))
    return fail(413, "INPUT_TOO_LARGE", "Choose an experiment JSON file no larger than 2 MiB.");
  if (request.signal.aborted) return fail(400, "INVALID_INPUT", "The upload was interrupted. Choose the file again.");
  reading++;
  const reader = request.body?.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    if (!reader) return fail(400, "INVALID_INPUT", "Choose an experiment JSON file first.");
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => { void reader.cancel().catch(() => {}); reject(Error("interrupted")); };
      request.signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(abort, 10000);
    });
    const parts: Uint8Array[] = [];
    let bytes = 0, reads = 0;
    while (true) {
      const part = await Promise.race([reader.read(), interrupted]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > AREA_INPUT_BYTES) return fail(413, "INPUT_TOO_LARGE", "Choose an experiment JSON file no larger than 2 MiB.");
      if (++reads > 4096) return fail(400, "INVALID_INPUT", "The upload could not be read. Choose the file again.");
      if (part.value.byteLength) parts.push(part.value);
    }
    const raw = new Uint8Array(bytes);
    let offset = 0;
    for (const part of parts) { raw.set(part, offset); offset += part.byteLength; }
    // Retain exact valid UTF-8 bytes, including any BOM. Never normalize signed input.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  } catch { return fail(400, "INVALID_INPUT", "The file must be readable UTF-8 JSON. Choose the file again."); }
  finally {
    clearTimeout(timer);
    if (abort) request.signal.removeEventListener("abort", abort);
    if (reader) { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch {} }
    reading--;
  }
}

let forwarding = 0;
export async function forwardAreaRequest(request: Request, path: string, config: GatewayConfig, fetcher: typeof fetch = fetch) {
  const user = authorizedUser(request, config);
  if (user instanceof Response) return user;
  const upload = request.method === "POST" && path === "/api/area-experiments";
  if (upload && forwarding >= 2) return fail(429, "UPLOAD_LIMIT", "Two experiments are already being submitted. Refresh history and try again shortly.");
  if (upload) forwarding++;
  try { return await forwardBoundedAreaRequest(request, path, config, fetcher); }
  finally { if (upload) forwarding--; }
}
async function forwardBoundedAreaRequest(request: Request, path: string, config: GatewayConfig, fetcher: typeof fetch) {
  const user = authorizedUser(request, config);
  if (user instanceof Response) return user;
  const collection = path === "/api/area-experiments";
  const item = /^\/api\/area-experiments\/([a-f0-9]{32})(?:\/(cancel|artifacts\/(?:input\.json|result\.json|areas\.csv|manifest\.json)))?$/.exec(path);
  if ((!collection && !item) || new URL(request.url).search) return fail(400, "INVALID_REQUEST", "Use a supported sampling experiment endpoint.");
  if (!['GET', 'POST'].includes(request.method) || (request.method === "POST" && !collection && item?.[2] !== "cancel") ||
    (request.method === "GET" && item?.[2] === "cancel")) return fail(405, "INVALID_REQUEST", "Unsupported request method.");
  // The reverse proxy permits larger bodies on this collection. Read requests
  // and cancellation still retain the ordinary bound, including declared bytes.
  if (!(collection && request.method === "POST")) {
    const length = request.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > 16384))
      return fail(413, "INPUT_TOO_LARGE", "This endpoint accepts at most 16 KiB.");
  }
  let base: URL;
  try {
    base = new URL(config.baseUrl);
    if (config.secret.length < 32 || base.username || base.password || base.search || base.hash ||
      (base.protocol !== "https:" && !(config.allowLocal && base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)))) throw Error();
  } catch { return fail(503, "PROCESSING_NOT_CONFIGURED", "Sampling experiments need a service connection."); }
  let body = "";
  if (request.method === "POST") {
    if (request.headers.get("origin") !== config.publicOrigin || request.headers.get("sec-fetch-site") === "cross-site")
      return fail(403, "INVALID_ORIGIN", "Submit the experiment from Earthsignal.");
    const value = await (collection ? readAreaInput(request) : readGatewayBody(request));
    if (value instanceof Response) return value;
    if (!collection && value !== "" && value !== "{}") return fail(400, "INVALID_REQUEST", "Cancellation takes no experiment input.");
    body = collection ? value : "{}";
  }
  const headers = new Headers({ Accept: "application/json", "X-Earthsignal-User": user });
  if (collection && request.method === "POST") {
    const key = request.headers.get("Idempotency-Key");
    if (!key || !/^[a-zA-Z0-9_-]{8,100}$/.test(key)) return fail(400, "INVALID_REQUEST", "An idempotency key is required.");
    headers.set("Idempotency-Key", key);
  }
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomUUID();
  headers.set("X-Earthsignal-Timestamp", timestamp);
  headers.set("X-Earthsignal-Nonce", nonce);
  headers.set("X-Earthsignal-Signature", await signGatewayRequest(request.method, path, user, body, config.secret, timestamp, nonce));
  if (request.method === "POST") headers.set("Content-Type", "application/json");
  try {
    const upstream = await fetcher(new URL(path, base), { method: request.method, headers, body: request.method === "POST" ? body : undefined,
      redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
    const out = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" });
    for (const name of ['content-type', 'content-disposition', 'content-length', 'retry-after']) { const v = upstream.headers.get(name); if (v) out.set(name, v); }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch { return fail(503, "PROCESSING_UNAVAILABLE", "The service is unavailable. Refresh history before retrying the same submission."); }
}
