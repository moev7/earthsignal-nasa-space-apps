import test from "node:test";
import assert from "node:assert/strict";
import { loadPublishedSar } from "../lib/public-sar-study";
import type { PublicStudy } from "../lib/public-study-registry";
const raw = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const hash = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
test("published source samples remain revision-pinned, masked and source-specific; tampering with any checked artifact withholds the study", async () => {
  const values = raw({
      width: 2,
      height: 1,
      values: [4, null],
      unit: "source units",
    }),
    image = new Uint8Array([137, 80, 78, 71]),
    provenance = raw({});
  const files: Record<string, { bytes: number; sha256: string }> = {};
  for (const [name, data] of Object.entries({
    "values.json": values,
    "preview.png": image,
    "provenance.json": provenance,
  }))
    files[name] = { bytes: data.length, sha256: await hash(data) };
  const m = raw({
    schema: "earthsignal.sar-public-study/1",
    id: "test-study",
    title: "Native samples",
    sourceId: "radarsat-1",
    operation: "native-observation",
    channel: "HH",
    quantity: "native source magnitude (calibration withheld)",
    unit: "source units",
    grid: {
      width: 2,
      height: 1,
      crs: "SOURCE_PIXEL_GRID (not geocoded)",
      transform: [0, 1, 0, 0, 0, 1],
    },
    coverage: { total: 2, valid: 1, fraction: 0.5 },
    stats: { min: 4, median: 4, max: 4 },
    records: [
      {
        id: "source",
        sourceId: "radarsat-1",
        title: "Source",
        product: "SLC",
        acquiredAt: "1996-03-04",
        endAt: null,
        collection: "Radarsat-1-L1-COG",
        maturity: "source-defined",
        channels: ["HH"],
        bbox: null,
        scienceAssets: 1,
        referenceUrl: "https://registry.opendata.aws/radarsat-1/",
        notice: "Native source values",
      },
    ],
    notices: [],
    rights: {
      license: "OGL",
      url: "https://open.canada.ca/en/open-government-licence-canada",
      credit: "Government of Canada",
    },
    method: "native-sar-study-2",
    processedAt: "2026-11-13",
    files,
  });
  const digest = await hash(m),
    url = `/data/sar/test-study/${digest.slice(0, 16)}/manifest.json`;
  const study = {
    id: "test-study",
    title: "Native samples",
    kind: "native-observation",
    unit: "source units",
    sourceId: "radarsat-1",
    revision: digest.slice(0, 16),
    manifestUrl: url,
    manifestSha256: digest,
    manifestBytes: m.length,
    period: { start: "1996-03-04", end: "1996-03-04" },
    maturity: "source-defined",
    coverageFraction: 0.5,
    href: "/studies/test-study",
    notice: "Source values",
    files,
  } as PublicStudy;
  const data: Record<string, Uint8Array> = {
    "manifest.json": m,
    "values.json": values,
    "preview.png": image,
  };
  const fetcher: typeof fetch = async (path, opts) => {
    assert.equal(opts?.credentials, "omit");
    return new Response(new Uint8Array(data[String(path).split("/").at(-1)!]));
  };
  const result = await loadPublishedSar(
    study,
    new AbortController().signal,
    fetcher,
  );
  assert.deepEqual(result.values, [4, null]);
  assert.equal(result.manifest.unit, "source units");
  data["values.json"] = raw({
    width: 2,
    height: 1,
    values: [4, 0],
    unit: "source units",
  });
  await assert.rejects(
    loadPublishedSar(study, new AbortController().signal, fetcher),
    /reviewed revision/,
  );
  data["values.json"] = values;
  data["manifest.json"] = raw({});
  await assert.rejects(
    loadPublishedSar(study, new AbortController().signal, fetcher),
    /reviewed revision/,
  );
});

test("all shipped native observations retain their scientific quantity and reproduce displayed statistics", async () => {
  const { readFile } = await import("node:fs/promises");
  const { PUBLIC_STUDIES } = await import("../lib/public-study-registry");
  for (const study of PUBLIC_STUDIES.filter((s) =>
    s.manifestUrl.startsWith("/data/sar/"),
  )) {
    const fetcher: typeof fetch = async (input) =>
      new Response(
        new Uint8Array(
          await readFile(new URL("../public" + String(input), import.meta.url)),
        ),
      );
    const loaded = await loadPublishedSar(
      study,
      new AbortController().signal,
      fetcher,
    );
    assert.equal(
      loaded.manifest.coverage.valid,
      loaded.values.filter((v) => v !== null).length,
    );
    await assert.rejects(
      loadPublishedSar(
        { ...study, kind: "los-displacement" },
        new AbortController().signal,
        fetcher,
      ),
      /quantity/,
    );
  }
});
