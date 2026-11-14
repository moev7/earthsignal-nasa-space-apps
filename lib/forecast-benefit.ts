import type { Assessment } from "./observatory-contract";

type Evaluation = NonNullable<Assessment["forecastEvaluation"]>;
type Forecast = Evaluation["forecasts"][number];
export type StationTarget = { label: string; unit: "ft^3/s" };
const identityFields = ["methodVersion","trainingStart","trainingEnd","testStart","testEnd","origins","mae","intervalCoverage","intervalWidth"] as const;
/** One predicate for every presentation of a recorded forecast's evaluation identity. */
export function forecastMatchesEvaluation(forecast: Forecast, evaluation: Evaluation, target: StationTarget | null): boolean {
  if (!target || forecast.target!==target.label || forecast.distribution.unit!==target.unit) return false;
  const matches=evaluation.validation.filter(v=>v.horizonDays===forecast.horizonDays && v.model===forecast.model);
  if(matches.length!==1)return false;
  const validation=matches[0];
  return identityFields.every(key=>forecast.validation[key]===validation[key]) && JSON.stringify(forecast.validation.applicability)===JSON.stringify(validation.applicability) && JSON.stringify(forecast.validation.limitations)===JSON.stringify(validation.limitations);
}
export function gaugeForecastTarget(assessment: Assessment): StationTarget | null {
  const series = assessment.series?.find(s=>s.id==="usgs-discharge");
  if (!series || series.unit!=="ft^3/s" || !series.label || series.evidenceIds.length!==1) return null;
  const records=assessment.evidence.filter(e=>e.id===series.evidenceIds[0]);
  if (records.length!==1 || records[0].sourceId!=="usgs-daily" || records[0].quantity!=="daily mean discharge" || records[0].unit!=="ft^3/s") return null;
  return {label:series.label,unit:"ft^3/s"};
}
export function forecastBenefits(evaluation: Evaluation, now: number, target: StationTarget | null = null) {
  return evaluation.validation.map(validation => {
    const baselines = validation.baselinePerformance;
    const best = baselines.length ? Math.min(...baselines.map(b => b.mae)) : null;
    // Relative reduction has no defined denominator when a baseline is perfect.
    const reductionPercent = best !== null && best > 0 ? 100 * (1 - validation.mae / best) : null;
    const forecast = evaluation.forecasts.find(f => f.horizonDays===validation.horizonDays && f.model===validation.model && forecastMatchesEvaluation(f,evaluation,target));
    const current = Boolean(forecast && Date.parse(forecast.issueTime) <= now && Date.parse(forecast.validThrough) > now);
    return {
      horizonDays: validation.horizonDays, model: validation.model,
      mae: validation.mae, baselines, reductionPercent, current,
      coveragePercent: 100 * validation.intervalCoverage,
      targets: validation.origins, testStart: validation.testStart, testEnd: validation.testEnd,
    };
  });
}
