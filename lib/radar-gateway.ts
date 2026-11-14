import { changeRequestSchema } from "./radar-contract";
import { analysisRequestSchema, annotationRequestSchema } from "./analysis-contract";

export type GatewayConfig = {
  baseUrl: string;
  secret: string;
  userId: string | null;
  publicOrigin: string;
  allowLocal?: boolean;
};
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export async function signGatewayRequest(
  method: string,
  path: string,
  user: string,
  body: string,
  secret: string,
  timestamp: string,
  nonce: string,
) {
  const digest = hex(
    await crypto.subtle.digest("SHA-256", encoder.encode(body)),
  );
  const canonical = [
    method.toUpperCase(),
    path,
    user,
    timestamp,
    nonce,
    digest,
  ].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(canonical)));
}
const fail = (status: number, message: string, code: string) =>
  Response.json(
    { error: message, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
export function authorizedUser(
  request: Request,
  config: GatewayConfig,
): string | Response {
  const user = config.userId;
  if (!user)
    return fail(
      401,
      "Sign in to access radar processing and your results.",
      "SIGN_IN_REQUIRED",
    );
  if (user.length > 200 || /[\r\n]/.test(user))
    return fail(403, "Invalid collaborator identity.", "ACCESS_DENIED");
  return user;
}
const bodyGate = globalThis as typeof globalThis & {
  __earthsignalBodyReaders?: number;
};
export async function readGatewayBody(request: Request): Promise<string | Response> {
  if (request.signal.aborted)
    return fail(400, "Request was interrupted.", "INVALID_REQUEST");
  if ((bodyGate.__earthsignalBodyReaders ?? 0) >= 8)
    return fail(
      429,
      "Too many requests in progress. Try again shortly.",
      "REQUEST_LIMIT",
    );
  bodyGate.__earthsignalBodyReaders =
    (bodyGate.__earthsignalBodyReaders ?? 0) + 1;
  const reader = request.body?.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interrupt: (() => void) | undefined;
  try {
    if (!reader) return "";
    const interrupted = new Promise<never>((_, reject) => {
      interrupt = () => {
        void reader.cancel().catch(() => {});
        reject(new Error("interrupted"));
      };
      request.signal.addEventListener("abort", interrupt, { once: true });
      timer = setTimeout(interrupt, 5000);
    });
    const chunks: Uint8Array[] = [];
    let count = 0,
      reads = 0;
    while (true) {
      const part = await Promise.race([reader.read(), interrupted]);
      if (part.done) break;
      if (++reads > 1024)
        return fail(400, "Invalid request stream.", "INVALID_REQUEST");
      count += part.value.byteLength;
      if (count > 16384)
        return fail(
          413,
          "Processing requests must be smaller than 16 KB.",
          "REQUEST_TOO_LARGE",
        );
      if (part.value.byteLength) chunks.push(part.value);
    }
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return fail(
      400,
      "The processing request body could not be read.",
      "INVALID_REQUEST",
    );
  } finally {
    clearTimeout(timer);
    if (interrupt) request.signal.removeEventListener("abort", interrupt);
    if (reader) {
      void reader.cancel().catch(() => {});
      try {
        reader.releaseLock();
      } catch {}
    }
    bodyGate.__earthsignalBodyReaders!--;
  }
}
export async function forwardRadarRequest(
  request: Request,
  path: string,
  config: GatewayConfig,
  fetcher: typeof fetch = fetch,
) {
  const user = authorizedUser(request, config);
  if (user instanceof Response) return user;
  if (!config.secret || !config.baseUrl)
    return fail(
      503,
      "Radar processing is not connected yet. Catalog exploration remains available.",
      "PROCESSING_NOT_CONFIGURED",
    );
  let base: URL;
  try {
    base = new URL(config.baseUrl);
    if (
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      (base.protocol !== "https:" &&
        !(
          config.allowLocal &&
          base.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(base.hostname)
        ))
    )
      throw new Error();
  } catch {
    return fail(
      503,
      "The processing service connection needs configuration.",
      "PROCESSING_NOT_CONFIGURED",
    );
  }
  if (
    !/^\/api\/change-jobs(?:\/[a-zA-Z0-9_-]+(?:\/cancel|\/analysis|\/annotations|\/artifacts\/[a-zA-Z0-9_.-]+)?)?$/.test(
      path,
    )
  )
    return fail(400, "Invalid processing request.", "INVALID_REQUEST");
  if (request.method !== "GET" && request.method !== "POST")
    return fail(405, "Unsupported request method.", "INVALID_REQUEST");
  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    if (origin !== config.publicOrigin)
      return fail(
        403,
        "Submit processing requests from Earthsignal.",
        "INVALID_ORIGIN",
      );
    if (request.headers.get("sec-fetch-site") === "cross-site")
      return fail(
        403,
        "Submit processing requests from Earthsignal.",
        "INVALID_ORIGIN",
      );
  }
  let body = "";
  if (request.method === "POST") {
    const read = await readGatewayBody(request);
    if (read instanceof Response) return read;
    body = read;
    if (path === "/api/change-jobs") {
      try {
        body = JSON.stringify(changeRequestSchema.parse(JSON.parse(body)));
      } catch {
        return fail(
          400,
          "Select two different acquisitions and a valid crop.",
          "INVALID_REQUEST",
        );
      }
    } else if (path.endsWith("/analysis") || path.endsWith("/annotations")) {
      try {
        const schema = path.endsWith("/analysis") ? analysisRequestSchema : annotationRequestSchema;
        body = JSON.stringify(schema.parse(JSON.parse(body)));
      } catch {
        return fail(400, "Check the analysis selection and input values.", "INVALID_REQUEST");
      }
    } else if (body.trim() && body.trim() !== "{}")
      return fail(
        400,
        "Cancellation does not accept additional input.",
        "INVALID_REQUEST",
      );
  }
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const signature = await signGatewayRequest(
    request.method,
    path,
    user,
    body,
    config.secret,
    timestamp,
    nonce,
  );
  const headers = new Headers({
    "X-Earthsignal-User": user,
    "X-Earthsignal-Timestamp": timestamp,
    "X-Earthsignal-Nonce": nonce,
    "X-Earthsignal-Signature": signature,
    Accept: "application/json",
    "User-Agent": "Earthsignal-Gateway/1.0 (+https://nasa.r8volt.com)",
  });
  if (request.method === "POST")
    headers.set("Content-Type", "application/json");
  if (path === "/api/change-jobs" && request.method === "POST") {
    const key = request.headers.get("Idempotency-Key");
    if (!key || !/^[a-zA-Z0-9_-]{8,100}$/.test(key))
      return fail(
        400,
        "A valid idempotency key is required.",
        "INVALID_REQUEST",
      );
    headers.set("Idempotency-Key", key);
  }
  try {
    const upstream = await fetcher(new URL(path, base), {
      method: request.method,
      headers,
      body: request.method === "POST" ? body : undefined,
      redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
    });
    const responseHeaders = new Headers({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    for (const key of [
      "content-type",
      "content-disposition",
      "content-length",
      "retry-after",
    ]) {
      const value = upstream.headers.get(key);
      if (value) responseHeaders.set(key, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return fail(
      503,
      "The processing service is temporarily unavailable. Your request can be retried.",
      "PROCESSING_UNAVAILABLE",
    );
  }
}
