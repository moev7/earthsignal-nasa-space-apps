import { test } from "node:test";
import assert from "node:assert";
import {
  makeRecords,
  filterRecords,
  type RecordFilters,
  type ScienceRecord,
} from "../features/science/domain";
import type { Scene, CatalogQuery } from "../features/catalog/domain";
import type { ChangeJob } from "../lib/radar-contract";

const mockScene: Scene = {
  id: "test-scene",
  name: "S1A",
  startTime: "2023-04-01T00:00:00Z",
  stopTime: "2023-04-01T00:00:00Z",
  platform: "S1A",
  product: "GCOV",
  direction: "ASCENDING",
  path: 1,
  frame: 1,
  orbit: 1,
  polarization: ["VV"],
  maturity: "provisional",
  processorVersion: "1",
  collection: "1",
  fileBytes: 100,
  fileUrl: "http://example.com/file",
  browseUrl: "http://example.com/browse",
  thumbnailUrl: "http://example.com/thumb",
  qaUrl: null,
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
        [-1, -1],
      ],
    ],
  },
};

const mockJob: ChangeJob = {
  schemaVersion: "1.0",
  id: "job-1",
  status: "completed",
  phase: "done",
  createdAt: "2023-04-01T00:00:00Z",
  updatedAt: "2023-04-01T00:00:00Z",
  beforeId: "test-scene-0",
  afterId: "test-scene",
  bbox: [-115, 35, -114, 37],
  prepared: true,
  result: {
    schemaVersion: "1.0",
    kind: "radar-change",
    title: "Change Map",
    before: {
      id: "test-scene-0",
      acquiredAt: "2023-03-01T00:00:00Z",
      track: 1,
      frame: 1,
      direction: "ASCENDING",
      mode: "SM",
      release: "provisional",
      collection: "NISAR_L2_GCOV_PROVISIONAL_V1",
      url: "https://nisar.asf.earthdatacloud.nasa.gov/test.h5",
    },
    after: {
      id: "test-scene",
      acquiredAt: "2023-04-01T00:00:00Z",
      track: 1,
      frame: 1,
      direction: "ASCENDING",
      mode: "SM",
      release: "provisional",
      collection: "NISAR_L2_GCOV_PROVISIONAL_V1",
      url: "https://nisar.asf.earthdatacloud.nasa.gov/test.h5",
    },
    crop: {
      bbox: [-115, 35, -114, 37],
      crs: "EPSG:4326",
      resolution: [1, 1],
      width: 10,
      height: 10,
      transform: [0, 0, 0, 0, 0, 0],
      imageBounds: [
        [-1, -1],
        [1, 1],
      ],
    },
    stats: { medianDb: 0, p05Db: -5, p95Db: 5, minDb: -10, maxDb: 10 },
    coverage: {
      totalPixels: 100,
      beforeValidPixels: 100,
      afterValidPixels: 100,
      commonValidPixels: 100,
      commonValidPercent: 100,
      validAreaKm2: 1,
    },
    layers: {
      before: "before.png",
      after: "after.png",
      difference: "difference.png",
      excluded: "excluded.png",
    },
    artifacts: ["difference.png"],
    display: {
      backscatterMinDb: -20,
      backscatterMaxDb: 0,
      differenceLimitDb: 5,
    },
    processing: {
      algorithmVersion: "1",
      method: "Test",
      processedAt: "2023-04-01T00:00:00Z",
      beforeSha256: "0",
      afterSha256: "0",
      maskPolicy: "none",
      sourceMetadata: {},
    },
    notice: "None",
  },
  error: null,
};

test("makeRecords with jobs", () => {
  const query: CatalogQuery = {
    region: "mead",
    product: "GCOV",
    start: "2023-01-01",
    end: "2023-05-01",
  };
  const records = makeRecords([mockScene], "radar-change", query, [mockJob]);
  assert.strictEqual(
    records.some((r) => r.kind === "radar-change" && r.id === "job-1"),
    true,
  );
});

test("filterRecords direction filter", () => {
  const query: CatalogQuery = {
    region: "mead",
    product: "GCOV",
    start: "2023-01-01",
    end: "2023-05-01",
  };
  const records = makeRecords([mockScene], "radar-change", query, [mockJob]);
  const filters: RecordFilters = {
    query: "",
    direction: "DESCENDING",
    maturity: "all",
    previewOnly: false,
    savedOnly: false,
  };
  const filtered = filterRecords(records, filters, [], "mead");
  assert.strictEqual(filtered.length, 0);
});

test("filterRecords maturity filter", () => {
  const query: CatalogQuery = {
    region: "mead",
    product: "GCOV",
    start: "2023-01-01",
    end: "2023-05-01",
  };
  const records = makeRecords([mockScene], "radar-change", query, [mockJob]);
  const filters: RecordFilters = {
    query: "",
    direction: "all",
    maturity: "provisional",
    previewOnly: false,
    savedOnly: false,
  };
  const filtered = filterRecords(records, filters, [], "mead");
  assert.strictEqual(filtered.length, 1);
});

test("comparison collection contains completed results only and follows geographic selection", () => {
  const query: CatalogQuery = {
    region: "mead",
    product: "GCOV",
    start: "2023-01-01",
    end: "2023-05-01",
  };
  assert.equal(
    makeRecords([mockScene], "radar-change", query, [
      { ...mockJob, status: "queued", result: null },
    ]).length,
    0,
  );
  assert.equal(
    makeRecords([mockScene], "radar-change", { ...query, region: "tehran" }, [
      mockJob,
    ]).length,
    0,
  );
  assert.equal(
    makeRecords([mockScene], "radar-change", { ...query, region: "global" }, [
      mockJob,
    ]).length,
    1,
  );
});
test("derived previews and source IDs remain searchable without treating release as maturity", async () => {
  const { recordSearchText } = await import("../features/science/domain");
  const record: ScienceRecord = {
    kind: "radar-change",
    id: mockJob.id,
    job: mockJob,
  };
  assert.match(recordSearchText(record, "mead"), /test-scene-0/);
  const filters: RecordFilters = {
    query: "",
    direction: "all",
    maturity: "provisional",
    previewOnly: true,
    savedOnly: false,
  };
  assert.equal(filterRecords([record], filters, [], "mead").length, 1);
});
test("pair advisory rejects known mismatches and reversed dates while exposing unknown science checks", async () => {
  const { pairAdvisory } = await import("../features/science/radar-domain");
  const before = {
    ...mockScene,
    id: "before",
    startTime: "2023-03-01T00:00:00Z",
  };
  const after = {
    ...mockScene,
    id: "after",
    startTime: "2023-04-01T00:00:00Z",
  };
  assert.equal(pairAdvisory(before, after).errors.length, 0);
  assert.ok(
    pairAdvisory(before, { ...after, frame: 2 }).errors.some((s) =>
      s.includes("frame"),
    ),
  );
  assert.ok(
    pairAdvisory(after, before).errors.some((s) => s.includes("precede")),
  );
  assert.ok(
    pairAdvisory({ ...before, path: null }, after).unknown.some((s) =>
      s.includes("track"),
    ),
  );
});
test("completed radar detail renders safely with coverage, provenance and all four layers", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { ScienceDetail } = await import("../features/science/science-detail");
  const model = {
    comparisonDraft: null,
    selected: { kind: "radar-change", id: mockJob.id, job: mockJob },
    saved: [],
    toggleSaved: () => {},
  } as unknown as import("../features/science/use-science").ScienceModel;
  const html = renderToStaticMarkup(createElement(ScienceDetail, { model }));
  for (const value of [
    "Before",
    "After",
    "Difference",
    "Excluded pixels",
    "Common-valid / native window",
    "including padding",
    "does not measure missing observations inside your selected area",
    "Before input SHA-256",
  ]) {
    assert.ok(html.includes(value), value);
  }
});
