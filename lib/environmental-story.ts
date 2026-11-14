import type {
  Assessment,
  AssessmentArea,
  EvidenceRecord,
  Metric,
  RasterView,
} from "./observatory-contract";
import type { ChangeJob, RadarBbox } from "./radar-contract";
import { forecastMatchesEvaluation } from "./forecast-benefit";
import {
  assessmentPlainResult,
  radarPlainResult,
  type PlainFinding,
} from "./plain-language";

export const ENVIRONMENTAL_STORY_VERSION = "environmental-story-1.0.0";
/** Calendar-day proximity is a workflow convention, never evidence of physical equivalence. */
export const OPTICAL_ENDPOINT_DAYS = 7;
const COORDINATE_TOLERANCE = 1e-9;
type Position = [number, number];
const samePosition = (a: Position, b: Position) =>
  a.every((v, i) => Math.abs(v - b[i]) <= COORDINATE_TOLERANCE);

export function radarAssessmentArea(bbox: RadarBbox): AssessmentArea {
  const [w, s, e, n] = bbox;
  return {
    type: "Polygon",
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  };
}

/** Compare the actual boundary, not its envelope. Reject holes, multipolygons and crossed rings. */
function sameRectangle(area: AssessmentArea, bbox: RadarBbox): boolean {
  if (area.type !== "Polygon" || area.coordinates.length !== 1) return false;
  const ring = area.coordinates[0];
  if (ring.length !== 5 || !samePosition(ring[0], ring[4])) return false;
  const expected = radarAssessmentArea(bbox).coordinates[0] as Position[];
  return [1, -1].some((direction) =>
    [0, 1, 2, 3].some((start) =>
      ring
        .slice(0, 4)
        .every((p, i) =>
          samePosition(p, expected[(start + direction * i + 4) % 4]),
        ),
    ),
  );
}

function calendarDay(value: string): string | null {
  const date = value.slice(0, 10);
  const time = Date.parse(`${date}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === date
    ? date
    : null;
}
const dayDistance = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) /
  86400000;
const native = {
  ndvi: {
    metricId: "ndvi-difference",
    metricUnit: "index",
    rasterUnit: "index",
    sourceIds: ["sentinel-2-indices", "hls-ndvi-ndmi"], sourceUnit: "index", sourceQuantity: "quality-masked NDVI/NDMI",
  },
  ndmi: {
    metricId: "ndmi-difference",
    metricUnit: "index",
    rasterUnit: "index",
    sourceIds: ["sentinel-2-indices", "hls-ndvi-ndmi"], sourceUnit: "index", sourceQuantity: "quality-masked NDVI/NDMI",
  },
  temperature: {
    metricId: "temperature-difference",
    metricUnit: "K",
    rasterUnit: "K",
    sourceIds: ["landsat-pc-lst"], sourceUnit: "K", sourceQuantity: "quality-masked surface temperature",
  },
  water: {
    metricId: "water-area-change",
    metricUnit: "km²",
    rasterUnit: "class-1 indicator (0/1)",
    sourceIds: ["opera-dswx-hls"], sourceUnit: "km2", sourceQuantity: "quality-masked classified water footprint",
  },
} as const;
export type StoryIndicator = {
  id: string;
  status: "paired" | "single-date" | "context" | "withheld";
  finding: PlainFinding | null;
  metric: Metric | null;
  raster: RasterView | null;
  evidence: EvidenceRecord[];
  radarRelationship: "comparable-context" | "separate-context" | "not-selected";
  reasons: string[];
};
export type EnvironmentalStoryView = {
  version: string;
  title: string;
  alignment: {
    status:
      | "standalone"
      | "awaiting-assessment"
      | "withheld"
      | "separate-context"
      | "boundary-window-matched"
      | "comparable-context";
    reasons: string[];
  };
  radar: ReturnType<typeof radarPlainResult> | null;
  indicators: StoryIndicator[];
  limits: string[];
  followUp: { title: string; text: string }[];
  forecast: {
    status:
      "not-evaluated" | "unresolved" | "withheld" | "experimental-available" | "no-current-estimate";
    target: string | null;
    evidence: EvidenceRecord[];
    evaluation: Assessment["forecastEvaluation"] | null;
    message: string;
    relationship: string;
  };
  provenance: { assessment: Assessment | null; radar: ChangeJob | null };
};

const followUps: Record<
  Assessment["domain"],
  EnvironmentalStoryView["followUp"]
> = {
  ecology: [
    {
      title: "Monitor vegetation",
      text: "Repeat compatible greenness and moisture measurements for the same season and common valid pixels. Record excluded clouds and missing dates.",
    },
    {
      title: "Inspect locally",
      text: "Check vegetation type, management history and field observations where indicator differences deserve investigation.",
    },
    {
      title: "Test a hypothesis",
      text: "Compare rainfall and seasonal growth against the observed dates before attributing a vegetation response. No intervention benefit is measured here.",
    },
  ],
  water: [
    {
      title: "Monitor water conditions",
      text: "Repeat the classified open-water footprint and inspect gauge approval, daily gaps and upstream rainfall or release records.",
    },
    {
      title: "Inspect the setting",
      text: "Check terrain, water-level measurements and site observations. Mapped footprint and station discharge do not measure retained water volume.",
    },
    {
      title: "Test a hypothesis",
      text: "Examine timing of rainfall, releases and withdrawals using site-specific evidence. Record assumptions before comparing management options; their benefits are unmeasured.",
    },
  ],
  urban: [
    {
      title: "Monitor surface conditions",
      text: "Repeat ground-surface temperature measurements at comparable observation times, seasons and valid pixel coverage.",
    },
    {
      title: "Inspect exposure",
      text: "Collect local air temperature, humidity, shade and use patterns before assessing conditions for people.",
    },
    {
      title: "Test a hypothesis",
      text: "Compare documented surface materials and shade with local observations. A cooling intervention needs its own before/after design and comparison baseline to measure benefit.",
    },
  ],
  fire: [
    {
      title: "Monitor observations",
      text: "Inspect thermal record dates, feed coverage and repeat observations. A missing detection remains unknown.",
    },
    {
      title: "Inspect locally",
      text: "Compare source records with official incident information, documented perimeters and local observations before interpreting effects.",
    },
    {
      title: "Test a hypothesis",
      text: "Check alternative hot sources and observation conditions. Record assumptions for follow-up; recovery or intervention benefit is not measured here.",
    },
  ],
};

function pairProblems(
  a: Assessment,
  raster: RasterView,
  metric: Metric | null,
): string[] {
  const problems: string[] = [];
  const spec = native[raster.id];
  const before = calendarDay(raster.before.date),
    after = calendarDay(raster.after.date);
  if (!before || !after || before >= after)
    problems.push(
      "Paired observation dates must be ordered and on different calendar days.",
    );
  else if (before < a.time.start || after > a.time.end)
    problems.push(
      "Paired observations fall outside the recorded assessment window.",
    );
  const refs = [raster.before.evidenceId, raster.after.evidenceId];
  const sources = refs.map((id) => a.evidence.filter((e) => e.id === id));
  if (refs[0] === refs[1] || sources.some((es) => es.length !== 1))
    problems.push(
      "Distinct before/after evidence references must resolve uniquely.",
    );
  else {
    const [b, e] = sources.map(records => records[0]);
    if (![b,e].every(record => (spec.sourceIds as readonly string[]).includes(record.sourceId) && record.unit === spec.sourceUnit && record.quantity === spec.sourceQuantity))
      problems.push("Source family, quantity and units do not establish this native environmental indicator.");
    if (!b.methodVersion || b.methodVersion !== e.methodVersion || !b.maskPolicy || b.maskPolicy !== e.maskPolicy)
      problems.push("Before/after processing methods or mask policies differ or are unspecified.");
    if (b.quality.commonCoveragePercent === null || e.quality.commonCoveragePercent === null || Math.abs(b.quality.commonCoveragePercent-raster.before.coveragePercent)>1e-6 || Math.abs(e.quality.commonCoveragePercent-raster.after.coveragePercent)>1e-6)
      problems.push("Acquisition coverage does not reconcile with its native crop evidence record.");
    if (![b,e].every(record => record.geometry && sameSelectedArea(record.geometry,a.area)))
      problems.push("Native selected-area crop evidence does not resolve the assessment geometry. A raw source footprint cannot substitute for measured crop support.");
    if (
      sources[0][0].sourceId !== sources[1][0].sourceId ||
      sources[0][0].sourceVersion !== sources[1][0].sourceVersion
    )
      problems.push(
        "Before/after source families or versions differ; compatible pairing is not established.",
      );
    if (
      calendarDay(sources[0][0].timestamps.observedStart ?? "") !== before ||
      calendarDay(sources[1][0].timestamps.observedStart ?? "") !== after
    )
      problems.push(
        "Raster dates do not match their source observation dates.",
      );
  }
  if (
    !metric ||
    metric.value === null ||
    !Number.isFinite(metric.value) ||
    metric.unit !== spec.metricUnit ||
    raster.unit !== spec.rasterUnit ||
    !refs.every((id) => metric.evidenceIds.includes(id)) ||
    !metric.evidenceIds.length ||
    metric.evidenceIds.some(
      (id) => a.evidence.filter((e) => e.id === id).length !== 1,
    )
  )
    problems.push(
      "A finite native metric with the correct units and resolved paired source references is required.",
    );
  if (
    !(raster.validPixels > 0 && raster.validPixels <= raster.totalPixels) ||
    Math.abs(
      raster.commonCoveragePercent -
        (100 * raster.validPixels) / raster.totalPixels,
    ) > 1e-6
  )
    problems.push(
      "The common valid pixel population and coverage do not reconcile.",
    );
  const common = raster.commonCoveragePercent;
  if (common > Math.min(raster.before.coveragePercent,raster.after.coveragePercent)+1e-6 || common < Math.max(0,raster.before.coveragePercent+raster.after.coveragePercent-100)-1e-6)
    problems.push("Common coverage is inconsistent with the intersection of the two acquisition masks.");
  const [[south,west],[north,east]] = raster.bounds;
  const positions = a.area.type === "Polygon" ? a.area.coordinates.flat() : a.area.coordinates.flat(2);
  if (!(south<north && west<east && east-west<=180) || !positions.every(([lon,lat]) => lat >= south-COORDINATE_TOLERANCE && lat <= north+COORDINATE_TOLERANCE && [lon,lon+360,lon-360].some(x=>x>=west-COORDINATE_TOLERANCE&&x<=east+COORDINATE_TOLERANCE)))
    problems.push("The exported raster bounds do not contain the selected-area crop support.");
  return problems;
}

/** Native crop records carry the exact selected AOI; unrelated raw footprints fail closed. */
function sameSelectedArea(a: AssessmentArea,b: AssessmentArea): boolean {
  if(a.type!==b.type)return false;
  const ap=a.type==="Polygon"?[a.coordinates]:a.coordinates, bp=b.type==="Polygon"?[b.coordinates]:b.coordinates;
  return ap.length===bp.length && ap.every((polygon,i)=>polygon.length===bp[i].length && polygon.every((ring,j)=>{
    const other=bp[i][j],n=ring.length-1;
    if(ring.length!==other.length || !samePosition(ring[0],ring[n]) || !samePosition(other[0],other[n]))return false;
    return [1,-1].some(direction=>Array.from({length:n},(_,k)=>k).some(start=>ring.slice(0,n).every((p,k)=>samePosition(p,other[(start+direction*k+n)%n]))));
  }));
}

export function environmentalStory(
  assessment: Assessment | null,
  radar: ChangeJob | null,
  now = Date.now(),
): EnvironmentalStoryView {
  const ready = radar?.status === "completed" && radar.result !== null;
  const r = ready ? radar!.result! : null;
  const radarDays = r
    ? [calendarDay(r.before.acquiredAt), calendarDay(r.after.acquiredAt)]
    : null;
  const alignment: EnvironmentalStoryView["alignment"] = {
    status: radar ? "withheld" : "standalone",
    reasons: [],
  };
  if (radar && !r)
    alignment.reasons.push(
      `The explicitly selected radar job is ${radar.status}; no completed radar measurements are available.`,
    );
  if (r && radar) {
    if (
      radar.beforeId !== r.before.id ||
      radar.afterId !== r.after.id ||
      !sameRectangle(radarAssessmentArea(r.crop.bbox), radar.bbox)
    )
      alignment.reasons.push(
        "Selected radar job identity or crop does not match its result; comparison withheld.",
      );
    if (!radarDays?.[0] || !radarDays[1] || radarDays[0] >= radarDays[1])
      alignment.reasons.push(
        "Radar acquisition calendar dates must be valid and ordered.",
      );
    if (alignment.reasons.length === 0) {
      if (!assessment) alignment.status = "awaiting-assessment";
      else {
        if (!sameRectangle(assessment.area, r.crop.bbox))
          alignment.reasons.push(
            "The actual assessment polygon is not the same radar rectangle. Matching bounding boxes alone are insufficient; holes and multipolygons remain separate context.",
          );
        if (
          assessment.time.start !== radarDays![0] ||
          assessment.time.end !== radarDays![1]
        )
          alignment.reasons.push(
            "The assessment window does not exactly equal the radar acquisition calendar dates.",
          );
        alignment.status = alignment.reasons.length
          ? "separate-context"
          : "comparable-context";
      }
    }
  }
  const indicators: StoryIndicator[] = [];
  if (assessment) {
    const plain = assessmentPlainResult(assessment);
    const pairedIds = new Set<string>();
    for (const raster of assessment.rasters ?? []) {
      const id = native[raster.id].metricId;
      pairedIds.add(id);
      const matches = assessment.metrics.filter((m) => m.id === id);
      const metric = matches.length === 1 ? matches[0] : null;
      const reasons = pairProblems(assessment, raster, metric);
      const finding = reasons.length
        ? null
        : (plain.findings.find((f) => f.metricIds.includes(id)) ?? null);
      if (!finding && !reasons.length)
        reasons.push(
          "A supported explanation for this native paired metric is unavailable.",
        );
      let relationship: StoryIndicator["radarRelationship"] = radar
        ? "separate-context"
        : "not-selected";
      if (finding && alignment.status === "comparable-context" && radarDays) {
        const b = calendarDay(raster.before.date)!,
          e = calendarDay(raster.after.date)!;
        if (
          dayDistance(b, radarDays[0]!) <= OPTICAL_ENDPOINT_DAYS &&
          dayDistance(e, radarDays[1]!) <= OPTICAL_ENDPOINT_DAYS
        )
          relationship = "comparable-context";
        else
          reasons.push(
            "Optical endpoints are more than 7 calendar days from a radar endpoint; retained as separate context.",
          );
      }
      if (finding && raster.commonCoveragePercent < 80)
        reasons.push(
          "Less than 80% common coverage: whole-area interpretation withheld. This presentation convention does not establish representativeness above 80%.",
        );
      indicators.push({
        id: raster.id,
        status: finding ? "paired" : "withheld",
        finding,
        metric,
        raster,
        evidence: assessment.evidence.filter(
          (e) =>
            metric?.evidenceIds.includes(e.id) ||
            [raster.before.evidenceId, raster.after.evidenceId].includes(e.id),
        ),
        radarRelationship: relationship,
        reasons,
      });
    }
    for (const finding of plain.findings) {
      if (finding.metricIds.some((id) => pairedIds.has(id))) continue;
      indicators.push({
        id: finding.metricIds[0] ?? "unavailable",
        status: !finding.metricIds.length
          ? "withheld"
          : /^(sentinel|hls|landsat|dswx)-\d{4}-\d{2}-\d{2}-/.test(
                finding.metricIds[0],
              )
            ? "single-date"
            : "context",
        finding,
        metric:
          assessment.metrics.find((m) => finding.metricIds.includes(m.id)) ??
          null,
        raster: null,
        evidence: assessment.evidence.filter((e) =>
          finding.evidenceIds.includes(e.id),
        ),
        radarRelationship: radar ? "separate-context" : "not-selected",
        reasons: [],
      });
    }
  }
  const evaluation = assessment?.forecastEvaluation ?? null;
  if (alignment.status === "comparable-context" && !indicators.some(indicator => indicator.status === "paired" && indicator.radarRelationship === "comparable-context")) {
    alignment.status = "boundary-window-matched";
    alignment.reasons.push("The boundary and requested window match, but no compatible paired environmental measurement relates to the radar endpoints.");
  }
  const gaugeSeries = assessment?.series?.find(
    (s) => s.id === evaluation?.seriesId && s.unit === "ft^3/s",
  );
  const gaugeEvidence =
    assessment?.evidence.filter((e) =>
      gaugeSeries?.evidenceIds.includes(e.id),
    ) ?? [];
  const gaugeResolved = Boolean(
    gaugeSeries?.evidenceIds.length === 1 &&
    gaugeEvidence.length === 1 &&
    gaugeEvidence.every(
      (e) => e.sourceId === "usgs-daily" && e.unit === "ft^3/s" && e.quantity === "daily mean discharge",
    ) &&
    evaluation?.forecasts.every(
      (f) =>
        forecastMatchesEvaluation(f,evaluation,{label:gaugeSeries.label,unit:"ft^3/s"}),
    ),
  );
  const forecast: EnvironmentalStoryView["forecast"] = {
    status: !evaluation
      ? "not-evaluated"
      : !gaugeResolved
        ? "unresolved"
        : evaluation.forecasts.length
          ? evaluation.forecasts.some(f=>Date.parse(f.issueTime)<=now&&Date.parse(f.validThrough)>now) ? "experimental-available" : "no-current-estimate"
          : "withheld",
    target: gaugeResolved ? gaugeSeries!.label : null,
    evidence: gaugeEvidence,
    evaluation,
    message: !evaluation
      ? "No USGS discharge forecast evaluation is recorded in this assessment."
      : !gaugeResolved
        ? "Forecast source references or discharge target are unresolved; forecast interpretation withheld."
        : evaluation.forecasts.length
          ? evaluation.forecasts.some(f=>Date.parse(f.issueTime)<=now&&Date.parse(f.validThrough)>now) ? "Current experimental station-discharge estimates are recorded. They apply only to their recorded target, units, horizon and validity dates." : "Recorded forecasts exist, but none are current at this inspection time. Future-issued or expired estimates remain recorded estimates, not available predictions."
          : "The existing USGS discharge experiment withheld forecasts. Inspect the recorded validation and withholding reasons.",
    relationship:
      "Geographic and hydrologic relationship between the gauge and the selected radar patch is unknown. This is not a NISAR prediction, environmental hazard forecast or model promotion.",
  };
  return {
    version: ENVIRONMENTAL_STORY_VERSION,
    title: "What the observations can help you investigate",
    alignment,
    radar: r && alignment.status !== "withheld" ? radarPlainResult(r) : null,
    indicators,
    forecast,
    limits: [
      "Nearby dates and a shared area provide comparison context, not causal corroboration. Sensor masks, support and measurement populations remain separate; confidence is never merged.",
      "A two-date difference is not a seasonal anomaly. No compatible seasonal baseline is inferred from this pairing.",
      "Historical observations do not describe present conditions. Missing evidence remains unknown, not zero.",
      ...(assessment?.quality
        .filter((q) => q.status !== "supported")
        .map((q) => `${q.dimension} (${q.status}): ${q.message}`) ?? []),
    ],
    followUp: assessment
      ? followUps[assessment.domain]
      : [
          {
            title: "Start with the evidence",
            text: "Choose a completed radar comparison explicitly, inspect its footprint and dates, then investigate compatible environmental measurements. No analysis job is started by this story.",
          },
        ],
    provenance: { assessment, radar },
  };
}
