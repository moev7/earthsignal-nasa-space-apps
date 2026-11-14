import type { Assessment } from "@/lib/observatory-contract";
import { forecastBenefits, type StationTarget } from "@/lib/forecast-benefit";

const fmt = (n: number) => n.toLocaleString(undefined, { maximumSignificantDigits: 4 });
export function ForecastBenefit({ evaluation, now, target }: { evaluation: NonNullable<Assessment["forecastEvaluation"]>; now: number; target: StationTarget | null }) {
  const benefits = forecastBenefits(evaluation, now, target);
  if (!benefits.length) return null;
  if (!target) return <p>Forecast comparison withheld: the recorded USGS station target and discharge units could not be resolved from the source evidence.</p>;
  return <section className="forecast-benefit" aria-label="Forecast value compared with simple baselines">
    <span className="eyebrow">DOES THE MODEL ADD VALUE?</span>
    <h4>Compare the forecast with simpler choices.</h4>
    <p>USGS station discharge · ft³/s. Lower mean absolute error (MAE) is better on the same test targets. This comparison supports monitoring; it does not predict flooding, lake volume or NISAR pixels.</p>
    <div className="forecast-benefit-grid">{benefits.map(b => {
      const rows = [{model:b.model,mae:b.mae}, ...b.baselines];
      const maximum = Math.max(...rows.map(row => row.mae));
      return <article key={b.horizonDays}>
        <div className="forecast-benefit-heading"><strong>{b.horizonDays}-day horizon</strong><span>{b.current ? "Current estimate available" : "No current estimate"}</span></div>
        <p className="forecast-benefit-reduction">{b.reductionPercent === null ? "Relative improvement undefined" : b.reductionPercent > 0 ? `${fmt(b.reductionPercent)}% less error` : b.reductionPercent < 0 ? `${fmt(-b.reductionPercent)}% more error` : "Same error"}<small>{b.reductionPercent === 0 ? "as" : "compared with"} the best recorded simple baseline</small></p>
        <dl className="forecast-error-bars">{rows.map((row,i) => <div key={`${row.model}-${i}`}><dt>{i === 0 ? "Selected" : "Baseline"} · {row.model}</dt><dd><span className="forecast-error-track" aria-hidden="true"><span data-selected={i===0} style={{width:`${maximum > 0 ? 100*row.mae/maximum : 0}%`}}/></span><strong>{fmt(row.mae)} <small>ft³/s MAE</small></strong></dd></div>)}</dl>
        <p>{fmt(b.coveragePercent)}% observed band coverage · {b.targets} test targets.</p>
        <small>{b.testStart} → {b.testEnd}. Retrospective evidence; a future estimate also needs freshness and release gates.</small>
      </article>;
    })}</div>
    <p>Practical use: decide whether a model merits continued station monitoring. Operational thresholds and the station’s hydrologic relationship to your study area require separate evidence.</p>
  </section>;
}
