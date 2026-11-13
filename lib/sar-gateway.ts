import {
  authorizedUser,
  readGatewayBody,
  signGatewayRequest,
  type GatewayConfig,
} from "./radar-gateway";
import { sarSearchSchema, sarStudyRequestSchema } from "./sar-contract";

const fail = (status: number, code: string, error: string) =>
  Response.json(
    { error, code },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
export async function forwardSarRequest(
  request: Request,
  path: string,
  config: GatewayConfig,
  fetcher: typeof fetch = fetch,
) {
  const user = authorizedUser(request, config);
  if (user instanceof Response) return user;
  const collection = path === "/api/sar-studies",
    search = path === "/api/sar-studies/search",
    plan = path === "/api/sar-studies/plan";
  const item =
    /^\/api\/sar-studies\/([a-f0-9]{32})(?:\/(cancel|artifacts\/(?:manifest\.json|values\.json|preview\.png|provenance\.json)))?$/.exec(
      path,
    );
  if ((!collection && !search && !plan && !item) || new URL(request.url).search)
    return fail(400, "INVALID_REQUEST", "Use a supported exact SAR endpoint.");
  if (
    !["GET", "POST"].includes(request.method) ||
    (request.method === "GET" && (search || plan || item?.[2] === "cancel")) ||
    (request.method === "POST" && item && item[2] !== "cancel")
  )
    return fail(405, "INVALID_REQUEST", "Unsupported SAR request method.");
  let base: URL;
  try {
    base = new URL(config.baseUrl);
    if (
      config.secret.length < 32 ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      (base.protocol !== "https:" &&
        !(
          config.allowLocal &&
          base.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(base.hostname)
        ))
    )
      throw Error();
  } catch {
    return fail(
      503,
      "PROCESSING_NOT_CONFIGURED",
      "The SAR science service is not connected.",
    );
  }
  let body = "";
  if (request.method === "POST") {
    if (
      request.headers.get("origin") !== config.publicOrigin ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return fail(
        403,
        "INVALID_ORIGIN",
        "Submit SAR requests from Earthsignal.",
      );
    const raw = await readGatewayBody(request);
    if (raw instanceof Response) return raw;
    try {
      if (item?.[2] === "cancel") {
        if (raw !== "" && raw !== "{}") throw Error();
        body = "{}";
      } else
        body = JSON.stringify(
          (search ? sarSearchSchema : sarStudyRequestSchema).parse(
            JSON.parse(raw),
          ),
        );
    } catch {
      return fail(
        400,
        "INVALID_REQUEST",
        "Check the source, records, dates and crop.",
      );
    }
  }
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Earthsignal-User": user,
  });
  if (collection && request.method === "POST") {
    const key = request.headers.get("Idempotency-Key");
    if (!key || !/^[A-Za-z0-9_-]{8,100}$/.test(key))
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "A valid idempotency key is required.",
      );
    headers.set("Idempotency-Key", key);
  }
  const timestamp = String(Math.floor(Date.now() / 1000)),
    nonce = crypto.randomUUID();
  headers.set("X-Earthsignal-Timestamp", timestamp);
  headers.set("X-Earthsignal-Nonce", nonce);
  headers.set(
    "X-Earthsignal-Signature",
    await signGatewayRequest(
      request.method,
      path,
      user,
      body,
      config.secret,
      timestamp,
      nonce,
    ),
  );
  try {
    const upstream = await fetcher(new URL(path, base), {
      method: request.method,
      headers,
      body: request.method === "POST" ? body : undefined,
      redirect: "error",
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(search || plan ? 45000 : 15000),
      ]),
    });
    const out = new Headers({
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    });
    for (const h of [
      "content-type",
      "content-length",
      "content-disposition",
      "retry-after",
    ]) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: out,
    });
  } catch {
    return fail(
      503,
      "PROCESSING_UNAVAILABLE",
      "The SAR service is unavailable. Existing published studies remain accessible.",
    );
  }
}
