import type { PublishedSar } from "./public-sar-study";
import type { PublicStudy } from "./public-study-registry";

export const MAX_INSPECTION_CELLS = 262144;
export const MAX_PROFILE_POINTS = 512;
export type NativeCell = { row: number; column: number };
export type NativeProbe = NativeCell & {
  value: number | null;
  nativeCentre: { x: number; y: number } | null;
  crs: string;
};

/** Inputs are already verified by the public loader; this also bounds local work. */
export function inspectionInputIssue(
  study: PublicStudy,
  m: PublishedSar,
  values: readonly (number | null)[],
) {
  const { width, height } = m.grid;
  if (
    study.id !== m.id ||
    study.sourceId !== m.sourceId ||
    study.unit !== m.unit
  )
    return "Study identity or units disagree. Return to the verified study loader.";
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > MAX_INSPECTION_CELLS ||
    values.length !== width * height
  )
    return "The native array does not match the bounded study grid.";
  if (
    m.grid.transform.length !== 6 ||
    !m.grid.transform.every(Number.isFinite) ||
    values.some((v) => v !== null && !Number.isFinite(v))
  )
    return "The native measurements or affine coordinates contain non-finite numbers.";
  return null;
}

export function nativeProbe(
  m: PublishedSar,
  values: readonly (number | null)[],
  cell: NativeCell,
): NativeProbe {
  const { row, column } = cell;
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(column) ||
    row < 0 ||
    column < 0 ||
    row >= m.grid.height ||
    column >= m.grid.width
  )
    throw new RangeError("Choose a cell inside the native grid.");
  // GDAL affine order: origin x, column x, row x, origin y, column y, row y.
  const [x0, xc, xr, y0, yc, yr] = m.grid.transform;
  const x = x0 + (column + 0.5) * xc + (row + 0.5) * xr;
  const y = y0 + (column + 0.5) * yc + (row + 0.5) * yr;
  const value = values[row * m.grid.width + column];
  if (value === undefined || (value !== null && !Number.isFinite(value)))
    throw new RangeError("The verified native value is unavailable.");
  return {
    row,
    column,
    value,
    nativeCentre: Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null,
    crs: m.grid.crs,
  };
}

/** The image itself must be borderless with natural aspect ratio, without object-fit letterboxing. */
export function cellFromImagePoint(
  grid: PublishedSar["grid"],
  box: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
): NativeCell | null {
  if (
    ![box.left, box.top, box.width, box.height, x, y].every(Number.isFinite) ||
    box.width <= 0 ||
    box.height <= 0 ||
    x < box.left ||
    y < box.top ||
    x >= box.left + box.width ||
    y >= box.top + box.height
  )
    return null;
  return {
    row: Math.min(
      grid.height - 1,
      Math.floor(((y - box.top) / box.height) * grid.height),
    ),
    column: Math.min(
      grid.width - 1,
      Math.floor(((x - box.left) / box.width) * grid.width),
    ),
  };
}

export function compareNativeSamples(
  study: PublicStudy,
  m: PublishedSar,
  values: readonly (number | null)[],
  a: NativeCell | null,
  b: NativeCell | null,
) {
  const singleAcquisition =
    m.records.length === 1 &&
    ["native-observation", "backscatter-observation"].includes(m.operation);
  const label = singleAcquisition
    ? "Same-acquisition spatial contrast (B − A)"
    : "Spatial contrast of product values (B − A)";
  const withheld = (reason: string) => ({
    label,
    status: "withheld" as const,
    delta: null,
    unit: m.unit,
    powerRatio: null,
    reason,
    ratioReason: reason,
  });
  const issue = inspectionInputIssue(study, m, values);
  if (issue) return withheld(issue);
  if (!a || !b)
    return withheld("Select both A and B to compare two native cells.");
  if (a.row === b.row && a.column === b.column)
    return withheld("A and B are the same cell. Choose distinct cells.");
  const av = nativeProbe(m, values, a).value,
    bv = nativeProbe(m, values, b).value;
  if (av === null || bv === null)
    return withheld(
      "A or B has no valid measurement. Missing is not zero; no per-cell exclusion reason is supplied.",
    );
  const difference = bv - av;
  if (!Number.isFinite(difference))
    return withheld(
      "The difference exceeds finite numeric range. No numeric contrast is reported.",
    );
  const delta = difference === 0 ? 0 : difference;
  let powerRatio: number | null = null;
  let ratioReason =
    "Power ratio applies only to a single calibrated radar backscatter observation in dB, not source units, LOS, offsets or change products.";
  if (
    m.operation === "backscatter-observation" &&
    m.unit === "dB" &&
    m.quantity === "radar backscatter" &&
    study.kind === "radar-backscatter-observation" &&
    m.records.length === 1
  ) {
    const ratio = 10 ** (delta / 10);
    // Subnormal results have already underflowed the normal floating-point range.
    if (Number.isFinite(ratio) && ratio >= 2 ** -1022) {
      powerRatio = ratio;
      ratioReason =
        "B/A backscatter power ratio = 10^((B − A)/10), within this acquisition, channel and reviewed revision.";
    } else
      ratioReason =
        "Power ratio withheld: exponentiation overflows or underflows numeric range; zero and Infinity are not reported as ratios.";
  }
  return {
    label,
    status: "valid" as const,
    delta,
    unit: m.unit,
    powerRatio,
    reason:
      "A measurement-only spatial contrast; it does not establish temporal change, cause, water, damage or hazard.",
    ratioReason,
  };
}

/** Shared measurement explanations; accepts public manifests or private result metadata. */
export function quantityExplanation(
  m: Pick<PublishedSar, "operation" | "unit" | "quantity">,
) {
  if (m.operation === "native-observation" || m.unit === "source units")
    return {
      question:
        "How do the original source magnitudes differ across this acquisition?",
      observed:
        "These are native source magnitudes with calibration withheld. Compare numeric samples within this source window; image brightness is a display stretch.",
      notDetermined:
        "Source magnitudes are not calibrated backscatter in dB. They do not identify a surface type, water, damage, motion or a cross-sensor trend.",
    };
  if (m.operation === "backscatter-observation")
    return {
      question:
        "How much does radar backscatter differ between two places in this acquisition?",
      observed:
        "Backscatter describes the measured radar return for this channel. The dB scale is logarithmic; a spatial contrast compares two places in the same acquisition.",
      notDetermined:
        "Brightness alone does not establish water, damage or material type. A single acquisition does not measure temporal change or identify its cause.",
    };
  if (m.operation === "los-displacement")
    return {
      question:
        "How does the reported line-of-sight displacement vary across this product?",
      observed:
        "The native values describe relative displacement along the radar line of sight in the product's stated reference and sign convention. Compare those values in mm.",
      notDetermined:
        "Line-of-sight displacement alone does not separate vertical and horizontal motion, establish a cause or determine a safety outcome. Review the source reference and sign convention.",
    };
  if (m.operation === "pixel-offset")
    return {
      question: "How does the reported radar offset vary across this product?",
      observed:
        "The native values describe the source product's offset component in meters. Compare the stated component and its source quality support.",
      notDetermined:
        "An offset in meters is not a rate, a full ground-motion vector, a vertical displacement or a hazard assessment. Source matching and quality limitations still apply.",
    };
  if (m.operation === "backscatter-change")
    return {
      question:
        "How does the reported backscatter change differ between two native cells?",
      observed:
        "This product already describes backscatter change between its source acquisitions. B − A compares two spatial values of that change product.",
      notDetermined:
        "This spatial contrast is not a new temporal measurement or a backscatter power ratio. It does not establish the cause of change, water or damage.",
    };
  return {
    question: "How does the reported quantity vary across this native product?",
    observed: `Inspect the declared ${m.quantity} values in ${m.unit}.`,
    notDetermined:
      "Interpretation requires the source product definition and quality support. These values alone do not establish causes or hazards.",
  };
}

export const inspectionGuidance = quantityExplanation;

export const INSPECTION_NEXT_CHECKS = [
  {
    id: "compatible-date",
    label: "Compare a compatible acquisition",
    why: "Check matching quantity, calibration, channel, geometry, reference and quality before comparing dates. Source magnitudes need calibration review first; this brief performs no temporal comparison.",
  },
  {
    id: "source-quality",
    label: "Inspect supporting data and source quality",
    why: "Read source masks, product notices and supporting observations to assess whether a pattern has adequate support. No per-cell exclusion reason or cause is inferred here.",
  },
  {
    id: "geocoding-calibration",
    label: "Review geocoding and calibration",
    why: "Verify the native CRS, affine placement, calibration and source conventions before locating a pattern or comparing products. Source-pixel coordinates are not longitude or latitude.",
  },
] as const;
export type NextCheckId = (typeof INSPECTION_NEXT_CHECKS)[number]["id"];

/** Full bounded row scan; uniformly selected original samples, never interpolation. */
export function nativeRowProfile(
  m: PublishedSar,
  values: readonly (number | null)[],
  row: number,
) {
  const width = m.grid.width;
  if (
    !Number.isInteger(row) ||
    row < 0 ||
    row >= m.grid.height ||
    width < 1 ||
    width * m.grid.height > MAX_INSPECTION_CELLS ||
    values.length !== width * m.grid.height
  )
    throw new RangeError("Profile requires a complete bounded native row.");
  const budget = Math.min(width, MAX_PROFILE_POINTS);
  const selected = new Set(
    Array.from({ length: budget }, (_, i) =>
      budget === 1 ? 0 : Math.floor((i * (width - 1)) / (budget - 1)),
    ),
  );
  const segments: NativeProbe[][] = [];
  let run = -1,
    lastSampledRun = -2,
    inside = false,
    valid = 0,
    missing = 0;
  let min: number | null = null,
    max: number | null = null;
  for (let column = 0; column < width; column++) {
    const value = values[row * width + column];
    if (value === null) {
      missing++;
      inside = false;
      continue;
    }
    if (!Number.isFinite(value)) throw new RangeError("Non-finite row value.");
    valid++;
    min = min === null ? value : Math.min(min, value);
    max = max === null ? value : Math.max(max, value);
    if (!inside) {
      run++;
      inside = true;
    }
    if (selected.has(column)) {
      if (run !== lastSampledRun) segments.push([]);
      segments[segments.length - 1].push(
        nativeProbe(m, values, { row, column }),
      );
      lastSampledRun = run;
    }
  }
  return {
    row,
    width,
    valid,
    missing,
    min,
    max,
    segments,
    displayPoints: segments.reduce((n, s) => n + s.length, 0),
    thinned: width > budget,
  };
}

/** Overflow-safe chart position even when finite native endpoints span > Number.MAX_VALUE. */
export function profileY(value: number, min: number, max: number) {
  const scale = Math.max(Math.abs(min), Math.abs(max));
  if (scale === 0 || min === max) return 90;
  const low = min / scale,
    high = max / scale;
  return 160 - ((value / scale - low) / (high - low)) * 140;
}

export function nativeRowCsv(
  m: PublishedSar,
  values: readonly (number | null)[],
  row: number,
) {
  nativeRowProfile(m, values, row); // Enforce the same full-row bound.
  const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
  const lines = [
    "row,column,value,valid,native_centre_x,native_centre_y,crs,unit",
  ];
  for (let column = 0; column < m.grid.width; column++) {
    const p = nativeProbe(m, values, { row, column });
    lines.push(
      [
        row,
        column,
        p.value === null ? "" : p.value,
        p.value !== null,
        p.nativeCentre?.x ?? "",
        p.nativeCentre?.y ?? "",
        quote(p.crs),
        quote(m.unit),
      ].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

export function createInvestigationBrief(
  study: PublicStudy,
  m: PublishedSar,
  values: readonly (number | null)[],
  a: NativeCell | null,
  b: NativeCell | null,
  note: string,
  nextCheckId: NextCheckId | "",
) {
  const issue = inspectionInputIssue(study, m, values);
  if (issue) throw new Error(issue);
  const pin = (cell: NativeCell | null) => {
    if (!cell) return { status: "not-selected" as const, sample: null };
    const sample = nativeProbe(m, values, cell);
    return {
      status: sample.value === null ? ("missing" as const) : ("valid" as const),
      sample,
    };
  };
  const guidance = inspectionGuidance(m),
    check = INSPECTION_NEXT_CHECKS.find((c) => c.id === nextCheckId);
  return {
    schema: "earthsignal.local-investigation-brief/1",
    evidence: {
      studyId: study.id,
      title: study.title,
      sourceId: m.sourceId,
      revision: study.revision,
      manifestUrl: study.manifestUrl,
      manifestSha256: study.manifestSha256,
      manifestBytes: study.manifestBytes,
      files: m.files,
      method: m.method,
      processedAt: m.processedAt,
      operation: m.operation,
      quantity: m.quantity,
      unit: m.unit,
      channel: m.channel,
      grid: m.grid,
      period: study.period,
      maturity: study.maturity,
      coverage: m.coverage,
      registryCoverageFraction: study.coverageFraction,
      acquisitions: m.records.map((r) => ({
        id: r.id,
        product: r.product,
        acquiredAt: r.acquiredAt,
        endAt: r.endAt,
        maturity: r.maturity,
        notice: r.notice,
        referenceUrl: r.referenceUrl,
      })),
      qualityNotices: m.notices,
      registryNotice: study.notice,
      rights: m.rights,
    },
    pins: { A: pin(a), B: pin(b) },
    contrast: compareNativeSamples(study, m, values, a, b),
    caveats: [
      guidance.observed,
      guidance.notDetermined,
      "Native row and column are zero-based. Native centres use the declared affine and CRS; no geographic conversion or distance is implied.",
      "Missing values are null, not zero. No per-pixel exclusion reason is supplied.",
      "The image stretch and any profile thinning are display-only; original evidence is unchanged.",
      ...m.notices,
    ],
    nextCheck: check
      ? { ...check, status: "proposed; not performed" }
      : { status: "not-selected" },
    interpretation: {
      label: "My interpretation / hypothesis",
      author: "user",
      verification: "unverified",
      text: note,
    },
    persistence: "Local download only; no upload or automatic persistence.",
  };
}
