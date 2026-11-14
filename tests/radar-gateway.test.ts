import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizedUser,
  forwardRadarRequest,
  signGatewayRequest,
} from "../lib/radar-gateway";
const config = {
  baseUrl: "https://nasa.r8volt.com",
  secret: "test-secret-only",
  userId: "alice",
  publicOrigin: "https://earth.test",
};
const auth = {
  origin: "https://earth.test",
  "oai-authenticated-user-id": "alice",
  "oai-authenticated-user-email": "alice@example.test",
};
test("gateway ignores forged browser identity without a verified session", async () => {
  const result = authorizedUser(
    new Request("https://earth.test/api/change-jobs", { headers: auth }),
    { ...config, userId: null },
  );
  assert.ok(result instanceof Response);
  assert.equal(result.status, 401);
});
test("HMAC includes ordered body, user and path with fixed cross-language vector", async () => {
  const signature = await signGatewayRequest(
    "POST",
    "/api/change-jobs",
    "alice",
    "{}",
    "test-secret-only",
    "1700000000",
    "nonce",
  );
  const { createHmac, createHash } = await import("node:crypto");
  const expected = createHmac("sha256", config.secret)
    .update(
      [
        "POST",
        "/api/change-jobs",
        "alice",
        "1700000000",
        "nonce",
        createHash("sha256").update("{}").digest("hex"),
      ].join("\n"),
    )
    .digest("hex");
  assert.equal(signature, expected);
  assert.notEqual(
    await signGatewayRequest(
      "POST",
      "/api/change-jobs",
      "bob",
      "{}",
      config.secret,
      "1700000000",
      "nonce",
    ),
    signature,
  );
});
test("gateway forwards only signed identity and keeps responses private", async () => {
  let called = false;
  const fetcher: typeof fetch = async (_url, init) => {
    called = true;
    const h = new Headers(init?.headers);
    assert.equal(h.get("X-Earthsignal-User"), "alice");
    assert.match(h.get("X-Earthsignal-Signature")!, /^[a-f0-9]{64}$/);
    assert.equal(h.get("oai-authenticated-user-email"), null);
    return Response.json({ jobs: [] });
  };
  const response = await forwardRadarRequest(
    new Request("https://earth.test/api/change-jobs", { headers: auth }),
    "/api/change-jobs",
    config,
    fetcher,
  );
  assert.ok(called);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
test("gateway rejects cross-site submission, invalid crop, missing key and traversal", async () => {
  const fetcher: typeof fetch = async () => {
    throw new Error("must not fetch");
  };
  const valid = JSON.stringify({
    beforeId: "before",
    afterId: "after",
    bbox: [-115, 35, -114, 36],
  });
  const cases = [
    ["/api/change-jobs", { ...auth, origin: "https://evil.test" }, valid, 403],
    ["/api/change-jobs", auth, valid, 400],
    [
      "/api/change-jobs",
      { ...auth, "Idempotency-Key": "test-key-123" },
      JSON.stringify({
        beforeId: "before",
        afterId: "after",
        bbox: [2, 2, 1, 1],
      }),
      400,
    ],
    ["/api/change-jobs/a/artifacts/../../etc", auth, "", 400],
  ] as const;
  for (const [path, headers, body, status] of cases) {
    const response = await forwardRadarRequest(
      new Request("https://earth.test/api/change-jobs", {
        method: "POST",
        headers,
        body,
      }),
      path,
      config,
      fetcher,
    );
    assert.equal(response.status, status);
  }
});
test("gateway bounds streamed request bodies and handles broken reads before forwarding", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json({});
  };
  for (const [body, expected] of [
    [
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(16385));
          controller.close();
        },
      }),
      413,
    ],
    [
      new ReadableStream({
        start(controller) {
          controller.error(new Error("disconnected"));
        },
      }),
      400,
    ],
  ] as const) {
    const request = new Request("https://earth.test/api/change-jobs", {
      method: "POST",
      headers: { ...auth, "Idempotency-Key": "bounded-test" },
      body,
      duplex: "half",
    } as RequestInit);
    assert.equal(
      (await forwardRadarRequest(request, "/api/change-jobs", config, fetcher))
        .status,
      expected,
    );
  }
  assert.equal(calls, 0);
});

test("gateway interrupts stalled bodies, bounds concurrent reads and releases admission", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json({});
  };
  const make = (signal: AbortSignal) =>
    new Request("https://earth.test/api/change-jobs", {
      method: "POST",
      headers: { ...auth, "Idempotency-Key": "interrupt-test" },
      signal,
      body: new ReadableStream(),
      duplex: "half",
    } as RequestInit);
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(
    (
      await forwardRadarRequest(
        make(aborted.signal),
        "/api/change-jobs",
        config,
        fetcher,
      )
    ).status,
    400,
  );
  const controllers = Array.from({ length: 8 }, () => new AbortController());
  const pending = controllers.map((c) =>
    forwardRadarRequest(make(c.signal), "/api/change-jobs", config, fetcher),
  );
  assert.equal(
    (
      await forwardRadarRequest(
        make(new AbortController().signal),
        "/api/change-jobs",
        config,
        fetcher,
      )
    ).status,
    429,
  );
  controllers.forEach((c) => c.abort());
  assert.ok((await Promise.all(pending)).every((r) => r.status === 400));
  assert.equal(calls, 0);
  const response = await forwardRadarRequest(
    new Request("https://earth.test/api/change-jobs", {
      method: "POST",
      headers: { ...auth, "Idempotency-Key": "read-again" },
      body: JSON.stringify({
        beforeId: "before",
        afterId: "after",
        bbox: [0, 0, 1, 1],
      }),
    }),
    "/api/change-jobs",
    config,
    fetcher,
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});
test("gateway bounds empty stream chunks instead of retaining them", async () => {
  const body = new ReadableStream({
    start(c) {
      for (let i = 0; i < 1025; i++) c.enqueue(new Uint8Array());
      c.close();
    },
  });
  const r = await forwardRadarRequest(
    new Request("https://earth.test/api/change-jobs", {
      method: "POST",
      headers: auth,
      body,
      duplex: "half",
    } as RequestInit),
    "/api/change-jobs",
    config,
    async () => {
      throw new Error("must not fetch");
    },
  );
  assert.equal(r.status, 400);
});
