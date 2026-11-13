import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PUBLIC_STUDIES, type PublicStudy } from "../lib/public-study-registry";
import { publishedSarSchema, type PublishedSar } from "../lib/public-sar-study";
import {
  cellFromImagePoint,
  compareNativeSamples,
  createInvestigationBrief,
  inspectionGuidance,
  inspectionInputIssue,
  nativeProbe,
  nativeRowCsv,
  nativeRowProfile,
  profileY,
  quantityExplanation,
} from "../lib/sar-inspection";

const study = PUBLIC_STUDIES.find(
  (s) => s.id === "tehran-validated-gcov-20261028",
)!;
assert.ok(study, "reviewed public source fixture exists");
const manifest = publishedSarSchema.parse(
  JSON.parse(
    readFileSync(
      new URL(`../public${study.manifestUrl}`, import.meta.url),
      "utf8",
    ),
  ),
);
function fixture(
  overrides: Partial<PublishedSar> = {},
  studyOverrides: Partial<PublicStudy> = {},
) {
  return {
    study: { ...study, ...studyOverrides },
    m: {
      ...manifest,
      grid: {
        width: 4,
        height: 1,
        crs: "SOURCE_PIXEL_GRID (not geocoded)",
        transform: [3700, 1, 0, 5600, 0, 1],
      },
      ...overrides,
    },
    values: [0, 10, null, -10],
  };
}
const a = { row: 0, column: 0 },
  b = { row: 0, column: 1 };

test("10 dB yields power 10; zero is valid, reverse contrast is reciprocal, and same/missing cells are withheld", () => {
  const f = fixture();
  const forward = compareNativeSamples(f.study, f.m, f.values, a, b);
  assert.equal(forward.delta, 10);
  assert.equal(forward.powerRatio, 10);
  assert.match(forward.label, /Same-acquisition spatial contrast/);
  const reverse = compareNativeSamples(f.study, f.m, f.values, b, a);
  assert.equal(reverse.delta, -10);
  assert.equal(reverse.powerRatio, 0.1);
  const zero = compareNativeSamples(f.study, f.m, [0, 0, null, 0], a, b);
  assert.equal(zero.delta, 0);
  assert.equal(zero.powerRatio, 1);
  assert.equal(Object.is(zero.delta, -0), false);
  assert.equal(
    compareNativeSamples(f.study, f.m, f.values, a, a).status,
    "withheld",
  );
  assert.equal(
    compareNativeSamples(f.study, f.m, f.values, a, null).status,
    "withheld",
  );
  const missing = compareNativeSamples(f.study, f.m, f.values, a, {
    row: 0,
    column: 2,
  });
  assert.equal(missing.delta, null);
  assert.equal(missing.powerRatio, null);
  assert.match(missing.reason, /Missing is not zero/);
});

test("power ratio requires exact calibrated quantity/operation/kind/unit and one acquisition in this study", () => {
  const cases: [Partial<PublishedSar>, Partial<PublicStudy>][] = [
    [
      {
        operation: "native-observation",
        unit: "source units",
        quantity: "native source magnitude (calibration withheld)",
      },
      { kind: "native-observation", unit: "source units" },
    ],
    [
      { operation: "los-displacement", unit: "mm" },
      { kind: "los-displacement", unit: "mm" },
    ],
    [
      { operation: "pixel-offset", unit: "meters" },
      { kind: "pixel-offset", unit: "meters" },
    ],
    [{ operation: "backscatter-change" }, { kind: "radar-backscatter-change" }],
    [{ quantity: "radar backscatter (uncalibrated)" }, {}],
    [{}, { kind: "radar-backscatter-change" }],
    [
      {
        records: [
          ...manifest.records,
          { ...manifest.records[0], id: "second" },
        ],
      },
      {},
    ],
  ];
  for (const [m, s] of cases) {
    const f = fixture(m, s),
      result = compareNativeSamples(f.study, f.m, f.values, a, b);
    assert.equal(
      result.delta,
      10,
      `${f.m.operation} still has a spatial native-unit difference`,
    );
    assert.equal(result.powerRatio, null);
  }
  const f = fixture();
  assert.equal(
    compareNativeSamples({ ...f.study, id: "other-study" }, f.m, f.values, a, b)
      .delta,
    null,
  );
  assert.equal(
    compareNativeSamples(f.study, { ...f.m, unit: "mm" }, f.values, a, b)
      .status,
    "withheld",
  );
});

test("extreme finite contrasts do not export Infinity or a false zero ratio", () => {
  const f = fixture();
  for (const values of [
    [0, 4000, null, 0],
    [4000, 0, null, 0],
    [0, -3200, null, 0],
  ]) {
    const c = compareNativeSamples(f.study, f.m, values, a, b);
    assert.equal(c.status, "valid");
    assert.equal(c.powerRatio, null);
    assert.match(c.ratioReason, /overflows or underflows/);
  }
  const c = compareNativeSamples(
    f.study,
    f.m,
    [-Number.MAX_VALUE, Number.MAX_VALUE, null, 0],
    a,
    b,
  );
  assert.equal(c.delta, null);
  assert.equal(c.status, "withheld");
  assert.equal(
    inspectionInputIssue(f.study, f.m, [0, Infinity, null, 0])?.includes(
      "non-finite",
    ),
    true,
  );
  for (const [value, expected] of [
    [-Number.MAX_VALUE, 160],
    [0, 90],
    [Number.MAX_VALUE, 20],
  ])
    assert.equal(
      profileY(value, -Number.MAX_VALUE, Number.MAX_VALUE),
      expected,
    );
  assert.equal(profileY(0, 0, 0), 90);
});

test("native centre uses full rotated affine at half-pixel and never relabels source coordinates as geographic", () => {
  const f = fixture();
  assert.deepEqual(nativeProbe(f.m, f.values, a).nativeCentre, {
    x: 3700.5,
    y: 5600.5,
  });
  assert.equal(nativeProbe(f.m, f.values, a).value, 0);
  assert.equal(nativeProbe(f.m, f.values, { row: 0, column: 2 }).value, null);
  assert.match(nativeProbe(f.m, f.values, a).crs, /SOURCE_PIXEL_GRID/);
  const m = {
    ...f.m,
    grid: { ...f.m.grid, height: 2, transform: [100, 20, 3, 200, 4, -20] },
  };
  assert.deepEqual(
    nativeProbe(m, [0, 1, 2, 3, 4, 5, 6, 7], { row: 1, column: 2 })
      .nativeCentre,
    { x: 154.5, y: 180 },
  );
  assert.throws(
    () => nativeProbe(f.m, f.values, { row: 0, column: -1 }),
    /inside/,
  );
  assert.throws(
    () => nativeProbe(f.m, f.values, { row: 0.5, column: 1 }),
    /inside/,
  );
  const overflow = {
    ...f.m,
    grid: {
      ...f.m.grid,
      transform: [Number.MAX_VALUE, Number.MAX_VALUE, 0, 0, 0, 1],
    },
  };
  assert.equal(nativeProbe(overflow, f.values, b).nativeCentre, null);
});

test("image hit testing uses the image rectangle, rejecting padding and outside clicks", () => {
  const f = fixture({ grid: { ...manifest.grid, width: 4, height: 2 } });
  const box = { left: 80, top: 120, width: 200, height: 100 };
  assert.deepEqual(cellFromImagePoint(f.m.grid, box, 80, 120), a);
  assert.deepEqual(cellFromImagePoint(f.m.grid, box, 179.9, 170), {
    row: 1,
    column: 1,
  });
  assert.deepEqual(cellFromImagePoint(f.m.grid, box, 279.9, 219.9), {
    row: 1,
    column: 3,
  });
  for (const point of [
    [79, 140],
    [100, 119],
    [280, 150],
    [150, 220],
    [NaN, 130],
  ])
    assert.equal(cellFromImagePoint(f.m.grid, box, point[0], point[1]), null);
  assert.equal(
    cellFromImagePoint(f.m.grid, { ...box, width: 0 }, 80, 120),
    null,
  );
});

test("profile scans the full bounded native row, preserves zero and null gaps including unsampled gaps, and has a 512-point budget", () => {
  const f = fixture();
  const small = nativeRowProfile(f.m, f.values, 0);
  assert.deepEqual(
    small.segments.map((s) => s.map((p) => p.value)),
    [[0, 10], [-10]],
  );
  assert.equal(small.min, -10);
  assert.equal(small.max, 10);
  assert.equal(small.missing, 1);
  assert.equal(small.thinned, false);
  const width = 262144;
  const m = { ...f.m, grid: { ...f.m.grid, width } };
  const values: (number | null)[] = Array(width).fill(0);
  values[3] = null;
  values[101] = 123.45678901234567; // Neither must be a sampled column.
  const p = nativeRowProfile(m, values, 0);
  assert.ok(p.displayPoints <= 512);
  assert.equal(p.thinned, true);
  assert.equal(p.valid, width - 1);
  assert.equal(p.missing, 1);
  assert.equal(p.max, values[101]);
  assert.ok(
    p.segments.length >= 2,
    "a null at an unsampled column still breaks the line",
  );
  for (const segment of p.segments) {
    for (const probe of segment)
      assert.equal(probe.value, values[probe.column]);
    assert.ok(
      !segment.some((s) => s.column < 3) || !segment.some((s) => s.column > 3),
    );
  }
  const empty = nativeRowProfile(f.m, [null, null, null, null], 0);
  assert.equal(empty.min, null);
  assert.equal(empty.displayPoints, 0);
  assert.throws(
    () =>
      nativeRowProfile(
        { ...m, grid: { ...m.grid, width: width + 1 } },
        [...values, 0],
        0,
      ),
    /bounded/,
  );
});

test("brief and full-row CSV retain exact provenance, original values/nulls, explicit unselected pins and unverified notes", () => {
  const f = fixture();
  const exactValue = 0.12345678901234566;
  const values = [exactValue, 10, null, -10];
  const note =
    "My hypothesis, not a measurement: <script>no execution</script>";
  const brief = JSON.parse(
    JSON.stringify(
      createInvestigationBrief(
        f.study,
        f.m,
        values,
        a,
        { row: 0, column: 2 },
        note,
        "geocoding-calibration",
      ),
    ),
  );
  assert.equal(brief.evidence.manifestSha256, study.manifestSha256);
  assert.equal(brief.evidence.revision, study.revision);
  assert.deepEqual(brief.evidence.files, manifest.files);
  assert.deepEqual(brief.evidence.coverage, manifest.coverage);
  assert.deepEqual(
    brief.evidence.acquisitions[0].acquiredAt,
    manifest.records[0].acquiredAt,
  );
  assert.equal(brief.pins.A.sample.value, exactValue);
  assert.equal(brief.pins.A.sample.crs, f.m.grid.crs);
  assert.deepEqual(brief.pins.A.sample.nativeCentre, { x: 3700.5, y: 5600.5 });
  assert.equal(brief.pins.B.sample.value, null);
  assert.equal(brief.pins.B.status, "missing");
  assert.equal(brief.contrast.delta, null);
  assert.equal(brief.interpretation.text, note);
  assert.equal(brief.interpretation.author, "user");
  assert.equal(brief.interpretation.verification, "unverified");
  assert.equal(brief.nextCheck.status, "proposed; not performed");
  const unselected = createInvestigationBrief(
    f.study,
    f.m,
    values,
    null,
    null,
    "",
    "",
  );
  assert.deepEqual(unselected.pins.A, { status: "not-selected", sample: null });
  assert.deepEqual(unselected.nextCheck, { status: "not-selected" });
  const csv = nativeRowCsv(f.m, values, 0);
  assert.match(csv, /0,0,0\.12345678901234566,true,3700\.5,5600\.5/);
  assert.match(csv, /0,2,,false,3702\.5,5600\.5/);
  assert.equal(csv.trim().split("\r\n").length, 5);
  const raw = fixture(
    { operation: "native-observation", unit: "source units" },
    { kind: "native-observation", unit: "source units" },
  );
  assert.match(
    inspectionGuidance(raw.m).notDetermined,
    /not calibrated backscatter/,
  );
  assert.match(
    inspectionGuidance({ ...f.m, operation: "backscatter-change" }).observed,
    /already describes/,
  );
  assert.match(
    inspectionGuidance({ ...f.m, operation: "los-displacement" }).notDetermined,
    /vertical and horizontal/,
  );
});

test("shared quantity explanations need only operation/unit/quantity and retain relative LOS and offset-versus-rate limits", () => {
  const los = quantityExplanation({
    operation: "los-displacement",
    unit: "mm",
    quantity: "relative LOS displacement",
  });
  assert.match(los.observed, /relative displacement/);
  assert.match(los.notDetermined, /vertical and horizontal/);
  const offset = quantityExplanation({
    operation: "pixel-offset",
    unit: "meters",
    quantity: "slant-range offset",
  });
  assert.match(offset.observed, /offset component in meters/);
  assert.match(offset.notDetermined, /not a rate/);
});
