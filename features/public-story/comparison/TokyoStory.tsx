"use client";

import { SiteLink as Link } from "@/components/site-link";
import { useId, useState } from "react";
import { TOKYO } from "@/features/ground-truth/data/cities";
import { SOURCES } from "@/features/ground-truth/data/satellites";
import { JAPAN_POLICY_SOURCE, JICA_GROUNDWATER_SOURCE } from "../Sources";
import { IllustratedPlot, PointReading } from "./ComparisonCharts";
import { nearestYear, trendYears } from "./model";
import "./comparison.css";

const TOKYO_ONLY = [TOKYO];
const YEARS = [
  ...new Set([
    ...trendYears(TOKYO_ONLY),
    ...TOKYO.timeline.map((event) => event.year),
  ]),
].sort((a, b) => a - b);

/** Manual historical exploration: no animation, measured hydrograph or invented imagery. */
export function TokyoStory({ story = false }: { story?: boolean } = {}) {
  const id = useId();
  const [year, setYear] = useState(1962);
  const index = YEARS.indexOf(year);
  const [eventIndex, setEventIndex] = useState(2);
  const sortedEvents = TOKYO.timeline
    .map((event, sourceIndex) => ({ event, sourceIndex }))
    .sort((a, b) => a.event.year - b.event.year);
  const selectedEvent = TOKYO.timeline[eventIndex];
  const inspect = (nextYear: number) => {
    setYear(nextYear);
    const latest = sortedEvents
      .filter((item) => item.event.year <= nextYear)
      .at(-1);
    if (latest) setEventIndex(latest.sourceIndex);
  };
  const selectEvent = (sourceIndex: number) => {
    setEventIndex(sourceIndex);
    setYear(TOKYO.timeline[sourceIndex].year);
  };
  const inspection = <>
          <div className="ec-range-label">
            <label htmlFor={`${id}-year`}>
              Explore Tokyo’s illustrated timeline
            </label>
            <output htmlFor={`${id}-year`}>{year}</output>
          </div>
          <input
            id={`${id}-year`}
            type="range"
            min={0}
            max={YEARS.length - 1}
            value={index}
            aria-valuetext={`${year}, historical illustration, not an acquisition`}
            onChange={(event) => inspect(YEARS[Number(event.target.value)])}
          />
          <div
            className="ec-tokyo-readout"
            aria-live="polite"
            aria-atomic="true"
          >
            <PointReading city={TOKYO} year={year} />
            <div className="ec-tokyo-event">
              <p className="ec-event-meta">
                Historical milestone · {selectedEvent.year}
              </p>
              <h4>{selectedEvent.title}</h4>
              <p>{selectedEvent.detail}</p>
            </div>
          </div>
          <label className="ec-select-label">
            Choose a historical event
            <select
              aria-label="Tokyo historical event"
              value={eventIndex}
              onChange={(event) => selectEvent(Number(event.target.value))}
            >
              {sortedEvents.map(({ event, sourceIndex }) => (
                <option key={sourceIndex} value={sourceIndex}>
                  {event.year} · {event.title}
                </option>
              ))}
            </select>
          </label><p className="es-caption">The curve illustrates history; it does not estimate the effect of either water law or a present-day rate.</p></>;
  return (
    <section className="ec-tokyo-story" aria-labelledby={story ? undefined : `${id}-title`} aria-label={story ? 'Tokyo illustrated history and water management' : undefined}>
      {!story && <div className="ec-tokyo-intro">
        <h3 id={`${id}-title`}>A turning point beneath Tokyo.</h3>
        <p>
          Groundwater controls and alternative water supplies changed the city’s
          subsidence story. Move between the historical peak and the later
          illustration; slowing the sinking does not restore the ground already
          lost.
        </p>
      </div>}
      <figure className="ec-tokyo-figure">
        <div className="ec-figure-heading">
          {story ? <h3>Follow the illustrated history</h3> : <h4>Follow the illustrated history</h4>}
          <span>Synthetic curve &amp; band · not measured</span>
        </div>
        <IllustratedPlot
          cities={TOKYO_ONLY}
          selectedYear={year}
          onInspect={(nextYear) => inspect(nearestYear(YEARS, nextYear))}
          compact
          years={YEARS}
        />
        <div className="ec-tokyo-controls">
          <div
            className="ec-tokyo-presets"
            role="group"
            aria-label="Tokyo historical turning points"
          >
            <button
              type="button"
              aria-pressed={year === 1962 && eventIndex === 2}
              onClick={() => selectEvent(2)}
            >
              1962 · historical peak
            </button>
            <button
              type="button"
              aria-pressed={year === 1980}
              onClick={() => selectEvent(6)}
            >
              1980 · after controls
            </button>
          </div>
          {story ? <>
            <p className="ec-tokyo-brief"><strong>{year}</strong> · {selectedEvent.title}</p>
            <details className="ec-tokyo-full-controls"><summary>Explore every year &amp; historical event</summary><div>{inspection}</div></details>
          </> : inspection}
        </div>
        <figcaption>{story ? 'Illustrated history, not a measured Tokyo time series. Slower sinking does not restore lost height.' : <>Illustration, not a measured Tokyo time series or groundwater record. The dashed lines mark the 1956 and 1962 water laws; the curve does not estimate their effect or a present-day rate.</>}</figcaption>
      </figure>
      <details className="ec-disclosure">
        <summary>
          What changed, what remained &amp; where this comes from
        </summary>
        <div className="ec-disclosure-body">
          <p>{TOKYO.groundwater.summary}</p>
          {story && <p>Tokyo’s experience supports sustained water management and monitoring. Different geology, demand and enforcement mean Tehran’s response has to be evaluated on its own evidence.</p>}
          <ul>
            {TOKYO.evidenceAfterIntervention.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>
            {SOURCES.tokyoTrend.limitations} {SOURCES.tokyoTrend.confidence}
          </p>
          <p className="ec-references">
            <a href={JAPAN_POLICY_SOURCE}>Japan Ministry of the Environment</a>{" "}
            ·{" "}
            <a href={JICA_GROUNDWATER_SOURCE}>
              JICA groundwater-management history
            </a>
          </p>
        </div>
      </details>
      {!story && <p className="ec-tokyo-conclusion">
        Tokyo’s experience supports sustained water management and monitoring.
        Different geology, demand and enforcement mean Tehran’s response has to
        be evaluated on its own evidence.
      </p>}
      <Link href="/compare" className="es-action">
        Explore Tehran and Tokyo side by side
      </Link>
    </section>
  );
}
