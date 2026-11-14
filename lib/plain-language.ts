import type {
  Assessment,
  EvidenceRecord,
  Metric,
  ScenarioResult,
} from "./observatory-contract";
import type { RadarResult } from "./radar-contract";
import type waterStudy from "../public/data/processed-water.json";

/** Presentation rules over recorded measurements; never a new classification or prediction. */
export const INTERPRETATION_VERSION = "plain-language-1.0.0";
export type PlainFinding = {
  found: string;
  meaning: string;
  limits: string;
  next: string;
  support: string;
  metricIds: string[];
  evidenceIds: string[];
  publicBlockId: string;
};
export type PlainResult = {
  schemaVersion: "1.0";
  interpretationVersion: string;
  methodVersion: string;
  domain: Assessment["domain"];
  title: string;
  recordedAt: string;
  timeLabel?: string;
  findings: PlainFinding[];
  metrics: Metric[];
  evidence: EvidenceRecord[];
  quality: Assessment["quality"];
  provenance: Record<string, unknown>;
};
const number = (n: number) =>
  n.toLocaleString("en-US", { maximumSignificantDigits: 6 });
const direction = (v: number, down: string, up: string) =>
  v < 0 ? down : v > 0 ? up : "had a summary difference of zero";
const change = (v: number, unit: string, down: string, up: string) =>
  v === 0
    ? "had a summary difference of zero"
    : `${direction(v, down, up)} by ${absolute(v, unit)}`;
const absolute = (v: number, unit: string) => `${number(Math.abs(v))} ${unit}`;
const dates = (a: string, b: string) => `${a.slice(0, 10)} → ${b.slice(0, 10)}`;
const usable = (m: Metric, a: Assessment) =>
  m.value !== null &&
  Number.isFinite(m.value) &&
  m.evidenceIds.length > 0 &&
  m.evidenceIds.every((id) => a.evidence.some((e) => e.id === id));
const sharedRefs = (a: string[], b: string[]) => a.some((id) => b.includes(id));
const contexts = {
  ndvi: {
    name: "vegetation greenness indicator",
    unit: "index",
    display: "index units",
    block: "vegetation",
    meaning:
      "This can help identify places where vegetation conditions deserve a closer look. Seasonal growth, land management and weather can also change this indicator.",
    limits:
      "This does not confirm deforestation, biodiversity loss or vegetation damage. It measures a reflected-light indicator, not a count of trees or species.",
    next: "Compare the same season across more years, check cloud masks, and examine compatible tree-cover observations or field reports.",
  },
  ndmi: {
    name: "vegetation moisture indicator",
    unit: "index",
    display: "index units",
    block: "vegetation",
    meaning:
      "This can flag a change in vegetation or surface moisture conditions for investigation. The indicator also responds to vegetation structure and season.",
    limits:
      "This does not measure soil-water volume or establish drought, forest loss or damage.",
    next: "Check comparable seasonal observations, rainfall, vegetation type and independent moisture measurements.",
  },
  temperature: {
    name: "ground-surface temperature",
    unit: "K",
    display: "°C of temperature difference",
    block: "surface-heat",
    meaning:
      "A surface-temperature comparison can help identify where ground heating differs between observations and where a closer planning study may be useful.",
    limits:
      "This is surface temperature, not air temperature or a human heat-health assessment. Observation time, clouds and retrieval assumptions matter.",
    next: "Check air temperature, humidity, shade, exposure and comparable observation times before assessing human heat risk.",
  },
  water: {
    name: "mapped open-water footprint",
    unit: "km²",
    display: "km²",
    block: "water-extent",
    meaning:
      "This identifies a change in the area classified as open water within the observed pixels. It can help focus checks of water conditions and nearby assets.",
    limits:
      "This does not establish water depth, retained volume, flood danger or damage. Classified area is not an accuracy-adjusted estimate.",
    next: "Inspect gauges, rainfall, terrain and official flood information; check classification accuracy before estimating affected area.",
  },
} as const;

export function assessmentPlainResult(a: Assessment): PlainResult {
  const findings: PlainFinding[] = [];
  for (const raster of a.rasters ?? []) {
    const c = contexts[raster.id];
    const id =
      raster.id === "water" ? "water-area-change" : `${raster.id}-difference`;
    const m = a.metrics.find(
      (m) =>
        m.id === id &&
        m.unit === c.unit &&
        usable(m, a) &&
        [raster.before.evidenceId, raster.after.evidenceId].every((id) =>
          m.evidenceIds.includes(id),
        ),
    );
    if (!m || m.value === null) continue;
    const comparison =
      raster.id === "water"
        ? "Classified-area change"
        : "Median of matched-pixel differences";
    findings.push({
      found: `The ${c.name} ${change(m.value, c.display, "decreased", "increased")} between ${dates(raster.before.date, raster.after.date)}. ${comparison}; ${m.value === 0 ? "a zero summary does not mean every pixel stayed unchanged" : "individual locations can differ"}.`,
      meaning: c.meaning,
      limits: `${c.limits} ${raster.commonCoveragePercent < 80 ? "Less than 80% common coverage: a whole-area conclusion is withheld." : "This describes the common valid pixels; other pixels and local differences remain unmeasured by this summary."}`,
      next: c.next,
      support: `${number(raster.commonCoveragePercent)}% common coverage · ${raster.validPixels.toLocaleString("en-US")} / ${raster.totalPixels.toLocaleString("en-US")} selected pixels · ${raster.grid.resolution} m recorded grid`,
      metricIds: [m.id],
      evidenceIds: m.evidenceIds,
      publicBlockId: c.block,
    });
  }
  // Latest supported single-date measurement of each quantity; never subtract independent masks.
  for (const [key, c] of Object.entries(contexts)) {
    if (
      findings.some((f) =>
        f.metricIds.includes(
          key === "water" ? "water-area-change" : `${key}-difference`,
        ),
      )
    )
      continue;
    const suffix =
      key === "temperature"
        ? "surface-temperature-median"
        : key === "water"
          ? "water-area"
          : `${key}-median`;
    const candidates = a.metrics
      .filter(
        (m) =>
          new RegExp(
            `^(sentinel|hls|landsat|dswx)-\\d{4}-\\d{2}-\\d{2}-${suffix}$`,
          ).test(m.id) &&
          m.unit === c.unit &&
          usable(m, a),
      )
      .sort((x, y) =>
        y.id
          .slice(y.id.indexOf("-") + 1, y.id.indexOf("-") + 11)
          .localeCompare(
            x.id.slice(x.id.indexOf("-") + 1, x.id.indexOf("-") + 11),
          ),
      );
    const m = candidates[0];
    if (!m || m.value === null) continue;
    const e = a.evidence.find((e) => m.evidenceIds.includes(e.id))!;
    const single =
      key === "temperature"
        ? `${number(m.value - 273.15)} °C (${String(m.value)} K in the source)`
        : `${number(m.value)} ${key === "water" ? "km²" : "dimensionless index units"}`;
    findings.push({
      found: `The ${c.name} was ${single} on ${e.timestamps.observedStart?.slice(0, 10) ?? "an undocumented observation date"}. This is a single-date ${key === "water" ? "classified footprint" : "median over valid pixels"}, not a measured increase or decrease.`,
      meaning:
        key === "water"
          ? "This maps where the product classified open water on this date. It can support inspection of water distribution and future compatible comparisons."
          : key === "ndmi"
            ? "This indicator can help examine vegetation and surface moisture conditions. Vegetation structure and season also affect it."
            : c.meaning,
      limits: `${c.limits} Other dates may have different observed pixels; no matched-pixel change is established here.`,
      next: c.next,
      support: `${e.spatialSupport.description} · ${e.quality.commonCoveragePercent === null ? "Coverage not documented" : `${number(e.quality.commonCoveragePercent)}% acquisition coverage; not common temporal coverage`}`,
      metricIds: [m.id],
      evidenceIds: m.evidenceIds,
      publicBlockId: c.block,
    });
  }
  const series = a.series?.find(
    (s) => s.id === "usgs-discharge" && s.unit === "ft^3/s",
  );
  const gauge = (id: string, unit: string) =>
    a.metrics.find(
      (m) =>
        m.id === id &&
        m.unit === unit &&
        usable(m, a) &&
        (series ? sharedRefs(m.evidenceIds, series.evidenceIds) : true) &&
        m.evidenceIds.some((id) =>
          a.evidence.some(
            (e) =>
              e.id === id && e.sourceId === "usgs-daily" && e.unit === "ft^3/s",
          ),
        ),
    );
  const trend = series?.seasonalTrend;
  const slope = gauge("gauge-seasonal-sen-slope", "ft^3/s/year");
  const endpoint = gauge("gauge-endpoint-change", "ft^3/s");
  const latest = gauge("gauge-last-discharge", "ft^3/s");
  const valid = series?.points
    .filter((p) => p.value !== null && Number.isFinite(p.value))
    .sort((x, y) => x.date.localeCompare(y.date));
  const seasonal =
    slope && trend?.status === "descriptive" && trend.slope === slope.value;
  const selected = seasonal
    ? slope
    : endpoint && valid && valid.length > 1
      ? endpoint
      : latest;
  if (selected && selected.value !== null) {
    const station = a.evidence.find(
      (e) => selected.evidenceIds.includes(e.id) && e.sourceId === "usgs-daily",
    )!;
    const found = seasonal
      ? `Across the same ${trend.commonMonths.length} calendar months in ${trend.years.join(", ")}, the station's water-flow summary ${change(selected.value, "cubic feet per second per year", "decreased", "increased")}. This is a descriptive seasonal slope, not a prediction.`
      : selected.id === "gauge-endpoint-change"
        ? `Water flow at this station ${change(selected.value, "cubic feet per second", "was lower", "was higher")} on ${valid!.at(-1)!.date} compared with ${valid![0].date}. This compares two daily readings; it is not a fitted trend.`
        : `The last recorded daily water flow was ${number(selected.value)} cubic feet per second. ${station.timestamps.observedEnd ? `Observation date: ${station.timestamps.observedEnd.slice(0, 10)}.` : "The observation date is not documented."} “Last recorded” does not mean current.`;
    findings.push({
      found,
      meaning:
        "This is how quickly water passed one measuring station. The change can help focus checks of downstream water availability and river conditions; rainfall, releases, withdrawals and season may contribute.",
      limits:
        "This does not measure lake volume, water retained across an area, or flood danger. It does not identify a cause. Individual seasons can differ, and provisional readings remain flagged in the full history.",
      next: "Compare the same seasons, inspect gauge approval and gaps, and check upstream rainfall and water-release records. Use official warnings and site-specific evidence for safety decisions.",
      support: `${station.title} · point station, not the selected area's average${seasonal ? ` · ${trend.commonMonths.length} common months; ${trend.years.length} supported years` : valid?.length ? ` · ${valid.length} available daily readings; missing dates remain excluded` : ""}`,
      metricIds: [selected.id],
      evidenceIds: selected.evidenceIds,
      publicBlockId: "water-flow",
    });
  }
  const fire = a.metrics.find(
    (m) =>
      m.id === "thermal-detections" && m.unit === "detections" && usable(m, a),
  );
  if (fire && fire.value !== null)
    findings.push({
      found:
        fire.value === 0
          ? "No thermal-anomaly records were returned by the selected feed and filters. This does not establish that no fire occurred."
          : `The selected feed and filters returned ${number(fire.value)} thermal-anomaly records: satellite pixels with an unusual heat signal. These are records, not necessarily separate fires.`,
      meaning:
        "These locations can help focus incident checks. A heat signal may come from vegetation burning or another hot source.",
      limits:
        "This does not draw the exact fire boundary, confirm damage, or establish a safe route. Missing detections and old observations do not show present safety.",
      next: "Check observation times, official incident perimeters and responder information. Compare industrial heat sources and weather context.",
      support: a.evidence
        .filter((e) => fire.evidenceIds.includes(e.id))
        .map(
          (e) =>
            `${e.title}: ${e.timestamps.observedStart ?? "date not supplied"} → ${e.timestamps.observedEnd ?? "date not supplied"}`,
        )
        .join(" · "),
      metricIds: [fire.id],
      evidenceIds: fire.evidenceIds,
      publicBlockId: "fire-detection",
    });
  if (!findings.length)
    findings.push({
      found:
        "A supported plain-language change has not been established from these records. Source discovery or a single image alone does not quantify change.",
      meaning:
        "The available sources can guide the next observation or analysis. Missing measurements are unknown, not zero.",
      limits:
        "Deforestation, dangerous water retention, damage and human heat risk have not been assessed by this summary. Read the quality messages for the specific missing evidence.",
      next: "Inspect the recorded measurements and quality notes, then obtain compatible observations or the missing contextual evidence before drawing a conclusion.",
      support: `Requested period ${dates(a.time.start, a.time.end)} · result ${a.outcome}; this is not a statement of current conditions`,
      metricIds: [],
      evidenceIds: [],
      publicBlockId:
        a.domain === "ecology"
          ? "vegetation"
          : a.domain === "urban"
            ? "surface-heat"
            : a.domain === "fire"
              ? "fire-detection"
              : "water-extent",
    });
  return {
    schemaVersion: "1.0",
    interpretationVersion: INTERPRETATION_VERSION,
    methodVersion: a.methodVersion,
    domain: a.domain,
    title: a.title,
    recordedAt: a.processedAt,
    findings,
    metrics: a.metrics,
    evidence: a.evidence,
    quality: a.quality,
    provenance: {
      area: a.area,
      requestedTime: a.time,
      artifacts: a.artifacts,
      evidenceHashes: a.evidence.map((e) => ({
        id: e.id,
        hashes: e.hashes,
        maskPolicy: e.maskPolicy,
      })),
      rasterSupport: (a.rasters ?? []).map((r) => ({
        id: r.id,
        grid: r.grid,
        hashes: r.hashes,
        notes: r.notes,
      })),
      originalClaimIds: a.claims.map((c) => c.id),
      assumptions: a.claims.map((c) => ({
        id: c.id,
        assumptions: c.assumptions,
        uncertainty: c.uncertainty,
        applicability: c.applicability,
      })),
    },
  };
}

export function radarPlainResult(r: RadarResult): PlainResult {
  const v = r.stats.medianDb;
  return {
    schemaVersion: "1.0",
    interpretationVersion: INTERPRETATION_VERSION,
    methodVersion: r.processing.algorithmVersion,
    domain: "water",
    title: r.title,
    recordedAt: r.processing.processedAt,
    findings: [
      {
        found: `The median matched-pixel radar difference ${change(v, "dB", "was negative (a weaker returned signal)", "was positive (a stronger returned signal)")} between ${dates(r.before.acquiredAt, r.after.acquiredAt)} in the tested patch. Individual locations can differ; a zero median does not establish no change.`,
        meaning:
          "This comparison checks how the surface reflected radar on two dates. It can guide a closer inspection; moisture, vegetation, surface roughness and speckle can affect the signal.",
        limits: "This does not establish deforestation, water loss, flooding or damage, and cannot describe a whole lake from a small patch. The conclusion describes only the common valid pixels. Coverage uses the rectangular native window as its denominator; padding and invalid observations are not distinguished by this percentage, so it does not establish coverage of the selected area.",
        next: "Check compatible optical images, gauges or field observations to distinguish explanations. Inspect excluded pixels and the acquisition metadata.",
        support: `${number(r.coverage.validAreaKm2)} km² common valid area · ${number(r.coverage.commonValidPercent)}% native-window coverage · crop [${r.crop.bbox.join(", ")}] · ${r.crop.crs}`,
        metricIds: ["medianDb"],
        evidenceIds: [r.before.id, r.after.id],
        publicBlockId: "radar",
      },
    ],
    metrics: [
      {
        id: "medianDb",
        label: "Median backscatter difference",
        value: v,
        unit: "dB",
        evidenceIds: [r.before.id, r.after.id],
        description: r.processing.method,
        denominator: `${r.coverage.commonValidPixels} common valid pixels / ${r.coverage.totalPixels} crop pixels`,
      },
    ],
    evidence: [],
    quality: [],
    provenance: {
      before: r.before,
      after: r.after,
      crop: r.crop,
      coverage: r.coverage,
      stats: r.stats,
      processing: r.processing,
    },
  };
}

export function scenarioPlainResult(
  s: ScenarioResult,
  a: Assessment,
): PlainResult {
  const t = s.thresholdSweep;
  const found = t
    ? `The recorded value is ${number(t.recordedValue)} ${t.unit}. The chosen “${t.operator}” condition holds at ${t.cases.filter((c) => c.meets).length} of ${t.cases.length} tested thresholds. These are settings you chose, not chances of a future event.`
    : s.scenarioKind === "options"
      ? "This comparison uses the supplied costs, benefits and preferences to compare alternatives. Unknown effects remain unknown; different preferences can change the comparison."
      : "This compares the recorded planning footprints geometrically. An overlapping area does not establish a hazard, exposure or damage.";
  return {
    schemaVersion: "1.0",
    interpretationVersion: INTERPRETATION_VERSION,
    methodVersion: s.methodVersion,
    domain: a.domain,
    title: `Scenario: ${s.scenarioKind}`,
    recordedAt: a.processedAt,
    timeLabel: "Parent assessment processed",
    findings: [
      {
        found,
        meaning:
          "This is a what-if comparison. It helps you see how a choice depends on the inputs and assumptions, while the original observations stay unchanged.",
        limits:
          "This is not a forecast, probability, proven intervention benefit or safety assessment. The source dates, coverage and missing evidence still limit its use.",
        next: "Check the changed inputs and assumptions below. Compare alternatives and identify what new evidence would change your decision.",
        support: `Scenario linked to assessment ${s.assessmentId} · objectives: ${s.objectives.join(" · ")} · ${t?.denominator ?? "See each output for its population"}`,
        metricIds: s.outputs.map((m) => m.id),
        evidenceIds: [...new Set(s.outputs.flatMap((m) => m.evidenceIds))],
        publicBlockId: "futures",
      },
    ],
    metrics: s.outputs,
    evidence: a.evidence,
    quality: a.quality,
    provenance: {
      assessmentId: s.assessmentId,
      scenarioKind: s.scenarioKind,
      changedInputs: s.changedInputs,
      assumptions: s.assumptions,
      limitations: s.limitations,
      sensitivities: s.sensitivities,
      originalAssessmentProcessedAt: a.processedAt,
    },
  };
}

export function historicalWaterPlainResult(w: typeof waterStudy): PlainResult {
  return {
    schemaVersion: "1.0",
    interpretationVersion: INTERPRETATION_VERSION,
    methodVersion: w.processing.method,
    domain: "water",
    title: w.title,
    recordedAt: w.processing.processedAt,
    findings: [
      {
        found: `The historical regional mosaic classified ${number(w.openWaterClassAreaKm2)} km² as open water (class 1). It is a mapped footprint across the source mosaic, not the area of Lake Mead.`,
        meaning:
          "This shows where the product classified open water in that historical image. It can support inspection of water distribution with its masks and source history.",
        limits:
          "One image does not establish an increase or decrease. This does not measure water depth, retained volume, flood danger, or present conditions. Partially inundated class-2 pixels are a separate footprint, not a fractional water-volume estimate.",
        next: "Compare compatible dates over a recorded boundary and common valid pixels. Check gauges, rainfall and terrain before interpreting water availability or hazards.",
        support: `Filename date ${w.date} · ${w.dateBasis} · whole regional mosaic; no reservoir boundary · ${number(w.includedCoveragePercent)}% included classes 0/1/2`,
        metricIds: ["water-class-1-area"],
        evidenceIds: [w.id],
        publicBlockId: "water-extent",
      },
    ],
    metrics: [
      {
        id: "water-class-1-area",
        label: "Regional class-1 mapped footprint",
        value: w.openWaterClassAreaKm2,
        unit: "km²",
        evidenceIds: [w.id],
        description: w.processing.method,
        denominator: "Whole native source mosaic; no reservoir boundary",
      },
    ],
    evidence: [],
    quality: [],
    provenance: {
      source: w.source,
      processing: w.processing,
      date: w.date,
      dateBasis: w.dateBasis,
      classes: w.classes,
    },
  };
}
