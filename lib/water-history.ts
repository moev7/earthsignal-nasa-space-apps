import { z } from "zod";

const DAY = 86_400_000;
export const historySchema = z.object({
  schemaVersion: z.literal("1.0"), id: z.literal("lake-mead-observed-elevation"), title: z.string(),
  quantity: z.string(), unit: z.literal("ft"), status: z.literal("historical-observed"),
  dateRange: z.tuple([z.string(), z.string()]), notice: z.string(),
  missingDates: z.array(z.string()),
  source: z.object({ url: z.string().url(), commit: z.string(), blobSha: z.string(), sha256: z.string(), seriesId: z.string(), database: z.string(), queryDate: z.string(), sourceLabel: z.string() }),
  points: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), value: z.number().finite().positive().max(2000) })).min(1).max(30000),
});
export type WaterHistoryData = z.infer<typeof historySchema>;
export type HistoryPoint = WaterHistoryData["points"][number];
export const FORECAST_METHOD = "Retrospective local linear experiment · 28 observed days · 7-day horizon · v2";
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;
const dateAt = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
function fit(points: HistoryPoint[]) {
  const x = points.map(p => day(p.date) - day(points[0].date)), y = points.map(p => p.value);
  const mx = mean(x), my = mean(y);
  const slope = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / x.reduce((s, v) => s + (v - mx) ** 2, 0);
  return { slope, predict: (date: string) => my + slope * (day(date) - day(points[0].date) - mx) };
}
export type ForecastPoint = { date: string; predicted: number; lower: number; upper: number };
export type ValidationPoint = ForecastPoint & { actual: number; baseline: number };
export type HistoryAnalysis = {
  method: string; status: "ready" | "withheld"; reason: string; cutoff: string;
  forecast: ForecastPoint[]; validation: ValidationPoint[];
  metrics: null | { modelMae: number; baselineMae: number; improvementPercent: number; bandCoveragePercent: number; validationCount: number; calibrationOrigins: number; slopeFtPerDay: number };
  latest: HistoryPoint | null; change7Days: number | null; change30Days: number | null;
};

/** Future values never enter training, calibration, selection, or forecast bands. */
export function analyzeHistory(all: HistoryPoint[], cutoff: string): HistoryAnalysis {
  const selected = all.filter(p => p.date <= cutoff).sort((a, b) => a.date.localeCompare(b.date));
  const latest = selected.at(-1) ?? null;
  const base: HistoryAnalysis = { method: FORECAST_METHOD, status: "withheld", reason: "At least 365 consecutive observed days are required.", cutoff, forecast: [], validation: [], metrics: null, latest, change7Days: null, change30Days: null };
  if (!latest) return base;
  if(selected.some((p,i)=>!Number.isFinite(p.value) || !Number.isFinite(day(p.date)) || dateAt(day(p.date))!==p.date || (i>0 && p.date===selected[i-1].date)))
    return {...base,reason:"Historical dates must be real, distinct days with finite measurements. Duplicates are not substituted."};
  const previous = (n: number) => selected.find(p => p.date === dateAt(day(latest.date) - n));
  base.change7Days = previous(7) ? latest.value - previous(7)!.value : null;
  base.change30Days = previous(30) ? latest.value - previous(30)!.value : null;
  if (latest.date !== cutoff) return { ...base, reason: "No observed measurement at the selected cutoff. Choose an observed date." };
  const series = selected.slice(-365);
  if (series.length < 365 || series.some((p, i) => !Number.isFinite(p.value) || !Number.isFinite(day(p.date)) || (i > 0 && day(p.date) - day(series[i - 1].date) !== 1))) return base;

  // 20 earlier, non-overlapping weekly origins calibrate bands; 12 later origins validate.
  const errors: number[][] = Array.from({ length: 7 }, () => []);
  const origins = Array.from({ length: 32 }, (_, i) => series.length - 1 - (32 - i) * 7);
  for (const origin of origins.slice(0, 20)) {
    const model = fit(series.slice(origin - 27, origin + 1));
    for (let h = 1; h <= 7; h++) errors[h - 1].push(Math.abs(model.predict(series[origin + h].date) - series[origin + h].value));
  }
  const radii = errors.map(values => values.sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil((values.length + 1) * 0.9) - 1)]);
  const validation: ValidationPoint[] = [];
  for (const origin of origins.slice(20)) {
    const model = fit(series.slice(origin - 27, origin + 1));
    for (let h = 1; h <= 7; h++) {
      const actual = series[origin + h], predicted = model.predict(actual.date), radius = radii[h - 1];
      validation.push({ date: actual.date, predicted, lower: predicted - radius, upper: predicted + radius, actual: actual.value, baseline: series[origin].value });
    }
  }
  const modelMae = mean(validation.map(p => Math.abs(p.actual - p.predicted)));
  const baselineMae = mean(validation.map(p => Math.abs(p.actual - p.baseline)));
  const improvementPercent = baselineMae > 1e-10 ? 100 * (1 - modelMae / baselineMae) : 0;
  const bandCoveragePercent = 100 * validation.filter(p => p.actual >= p.lower - 1e-9 && p.actual <= p.upper + 1e-9).length / validation.length;
  const model = fit(series.slice(-28));
  base.validation = validation;
  base.metrics = { modelMae, baselineMae, improvementPercent, bandCoveragePercent, validationCount: validation.length, calibrationOrigins: 20, slopeFtPerDay: model.slope };
  if (improvementPercent < 10 || bandCoveragePercent < 80) return { ...base, reason: "Retrospective estimate withheld: the model must improve on persistence MAE by at least 10% and its empirical bands must cover at least 80% of held-out observations." };
  const forecast = Array.from({ length: 7 }, (_, i) => {
    const date = dateAt(day(latest.date) + i + 1), predicted = model.predict(date), radius = radii[i];
    return { date, predicted, lower: predicted - radius, upper: predicted + radius };
  });
  return { ...base, status: "ready", reason: "Passed retrospective product gates. The same held-out period determines eligibility; prospective release-policy validation remains unperformed. Empirical 90% bands do not guarantee future coverage.", forecast };
}

/** Preserve extrema and final observations when reducing chart density. */
export function chartHistory(points: HistoryPoint[], maximum = 240): HistoryPoint[] {
  if (points.length <= maximum) return points;
  const size = Math.ceil(points.length / Math.floor(maximum / 2));
  const result = new Map<string, HistoryPoint>();
  for (let i = 0; i < points.length; i += size) {
    const bucket = points.slice(i, i + size);
    const low = bucket.reduce((a, b) => a.value < b.value ? a : b);
    const high = bucket.reduce((a, b) => a.value > b.value ? a : b);
    result.set(low.date, low); result.set(high.date, high);
  }
  result.set(points[0].date, points[0]); result.set(points.at(-1)!.date, points.at(-1)!);
  return [...result.values()].sort((a, b) => a.date.localeCompare(b.date));
}
