import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sarSearchSchema, sarStudyRequestSchema } from "../lib/sar-contract";
import {
  CHALLENGE_RESOURCES,
  MAIN_EXPERIENCE,
  SAR_SOURCES,
} from "../lib/challenge-resources";
import {
  PUBLIC_STUDIES,
  publicStudy,
  publicStudyRegistrySchema,
  verifyPublicManifest,
} from "../lib/public-study-registry";
import { forwardSarRequest } from "../lib/sar-gateway";
import { signGatewayRequest } from "../lib/radar-gateway";
const request = {
  schemaVersion: "1.0",
  sourceId: "radarsat-1",
  operation: "native-observation",
  recordIds: ["record-1"],
  bbox: [51.25, 35.5, 51.26, 35.51],
  channel: "HH",
  pixelWindow: [3700, 5600, 128, 128],
};
test("all challenge resources remain in Advanced tools while the main experience stays Tehran/Tokyo", () => {
  assert.equal(CHALLENGE_RESOURCES.length, 14);
  assert.equal(new Set(CHALLENGE_RESOURCES.map((x) => x.id)).size, 14);
  assert.equal(SAR_SOURCES.length, 5);
  assert.match(MAIN_EXPERIENCE.focus, /Tehran.*Tokyo/);
  assert.equal(MAIN_EXPERIENCE.processingHref, "/workspace?view=sar");
  assert.ok(
    CHALLENGE_RESOURCES.some(
      (r) => r.source === "saocom" && r.kind === "access",
    ),
  );
});
test("requests preserve products, quantities, exact IDs, dates and bounded crops", () => {
  assert.deepEqual(sarStudyRequestSchema.parse(request), request);
  for (const changed of [
    { ...request, bbox: [51, 35, 52, 36] },
    { ...request, fileUrl: "https://evil.test/file.tif" },
    { ...request, recordIds: ["../other"] },
    { ...request, operation: "los-displacement" },
    {
      ...request,
      operation: "backscatter-change",
      recordIds: ["same", "same"],
    },
  ])
    assert.equal(sarStudyRequestSchema.safeParse(changed).success, false);
  const q = {
    sourceId: "rcm",
    bbox: [0, 0, 1, 1],
    start: "2026-01-01",
    end: "2026-11-13",
    product: "GCOV",
  };
  assert.equal(sarSearchSchema.safeParse(q).success, true);
  assert.equal(
    sarSearchSchema.safeParse({ ...q, start: "2026-02-30" }).success,
    false,
  );
  assert.equal(
    sarSearchSchema.safeParse({ ...q, start: "2020-01-01" }).success,
    false,
  );
});
test("public revisions anchor original manifests, not private jobs or mutable hash tables", async () => {
  assert.ok(PUBLIC_STUDIES.some(s => s.id === "tehran-sw-2026"));
  assert.ok(PUBLIC_STUDIES.some(s => s.id === "lake-mead-gcov-2026"));
  for (const s of PUBLIC_STUDIES) {
    const bytes = await readFile(
      new URL(`../public${s.manifestUrl}`, import.meta.url),
    );
    await verifyPublicManifest(s, bytes);
    await assert.rejects(
      verifyPublicManifest(s, new TextEncoder().encode("{}")),
      /reviewed revision/,
    );
    assert.equal(
      publicStudy(s.id, s.revision)?.manifestSha256,
      s.manifestSha256,
    );
    assert.equal(publicStudy(s.id, "unknown"), null);
    assert.equal(publicStudy(s.id, ""), null);
  }
  const bad = structuredClone({
    schemaVersion: "1.0",
    studies: PUBLIC_STUDIES,
  });
  bad.studies[0].unit = "mm/year";
  assert.equal(publicStudyRegistrySchema.safeParse(bad).success, false);
});
test("the SAR gateway retains auth, Origin, idempotency, path and signed-body boundaries", async () => {
  const cfg = {
    baseUrl: "http://127.0.0.1:8000",
    secret: "s".repeat(32),
    userId: "alice",
    publicOrigin: "https://earthsignal.test",
    allowLocal: true,
  };
  let forwarded = 0;
  const fetcher: typeof fetch = async (_url, options) => {
    forwarded++;
    const h = new Headers(options!.headers),
      body = String(options!.body ?? "");
    assert.equal(h.get("X-Earthsignal-User"), "alice");
    assert.equal(
      h.get("X-Earthsignal-Signature"),
      await signGatewayRequest(
        "POST",
        "/api/sar-studies",
        "alice",
        body,
        cfg.secret,
        h.get("X-Earthsignal-Timestamp")!,
        h.get("X-Earthsignal-Nonce")!,
      ),
    );
    assert.deepEqual(JSON.parse(body), request);
    return Response.json({ status: "queued" }, { status: 202 });
  };
  const post = (origin = cfg.publicOrigin, key = "unique-key-1") =>
    new Request(`${cfg.publicOrigin}/api/sar-studies`, {
      method: "POST",
      headers: { Origin: origin, "Idempotency-Key": key },
      body: JSON.stringify(request),
    });
  assert.equal(
    (
      await forwardSarRequest(
        post(),
        "/api/sar-studies",
        { ...cfg, userId: null },
        fetcher,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await forwardSarRequest(
        post("https://evil.test"),
        "/api/sar-studies",
        cfg,
        fetcher,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await forwardSarRequest(
        post(cfg.publicOrigin, "x"),
        "/api/sar-studies",
        cfg,
        fetcher,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await forwardSarRequest(
        post(),
        "/api/sar-studies/../../files",
        cfg,
        fetcher,
      )
    ).status,
    400,
  );
  assert.equal(forwarded, 0);
  const result = await forwardSarRequest(
    post(),
    "/api/sar-studies",
    cfg,
    fetcher,
  );
  assert.equal(result.status, 202);
  assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  assert.equal(forwarded, 1);
});
