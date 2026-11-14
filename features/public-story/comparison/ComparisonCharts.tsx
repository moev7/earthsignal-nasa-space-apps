"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { TEHRAN, TOKYO } from "@/features/ground-truth/data/cities";
import type { CaseCity } from "@/features/ground-truth/data/types";
import {
  CITY_COLORS,
  EVENT_META,
  illustrationBand,
  latestMilestone,
  milestones,
  nearestYear,
  pointAtYear,
  trendYears,
} from "./model";

const BOTH_CITIES = [TEHRAN, TOKYO];

export function IllustratedPlot({
  cities,
  selectedYear,
  onInspect,
  showBand = true,
  compact = false,
  years = trendYears(cities),
}: {
  cities: CaseCity[];
  selectedYear: number;
  onInspect: (year: number) => void;
  showBand?: boolean;
  compact?: boolean;
  years?: number[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const id = useId();
  useEffect(() => {
    if (!container.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, Math.round(entry.contentRect.width))),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const height = compact ? 265 : 350;
  const left = 48;
  const right = width - 18;
  const top = 52;
  const bottom = height - 36;
  const minYear = years[0] ?? 1900;
  const maxYear = years.at(-1) ?? 2023;
  const x = (year: number) =>
    left + ((year - minYear) / Math.max(1, maxYear - minYear)) * (right - left);
  const y = (rate: number) => bottom - (rate / 300) * (bottom - top);
  const inspect = (event: PointerEvent<SVGSVGElement>) => {
    if (!years.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const chartX = ((event.clientX - bounds.left) / bounds.width) * width;
    onInspect(
      nearestYear(
        years,
        minYear + ((chartX - left) / (right - left)) * (maxYear - minYear),
      ),
    );
  };
  const ticks =
    width < 500
      ? [minYear, Math.round((minYear + maxYear) / 2), maxYear]
      : [minYear, 1940, 1980, 2000, maxYear].filter(
          (year, index, list) =>
            year >= minYear && year <= maxYear && list.indexOf(year) === index,
        );

  return (
    <div className="ec-plot" ref={container}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={`${id}-title ${id}-description`}
        onPointerDown={inspect}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse") inspect(event);
        }}
      >
        <title id={`${id}-title`}>
          {`Illustrated subsidence histories: ${cities.map((city) => city.name).join(" and ")}. Synthetic curves, not measurements.`}
        </title>
        <desc id={`${id}-description`}>
          Higher means a larger illustrative sinking-rate magnitude, in
          millimetres per year. Shaded bands are illustrative too. Lines join
          the original demonstration points; they do not supply observations
          between them. Use the controls below for keyboard or touch point
          inspection.
        </desc>
        <text x={left} y={19} className="ec-axis-title">
          Illustrated sinking rate · mm/year
        </text>
        {[0, 100, 200, 300].map((rate) => (
          <g key={rate}>
            <line
              x1={left}
              x2={right}
              y1={y(rate)}
              y2={y(rate)}
              className="ec-grid-line"
            />
            <text
              x={left - 10}
              y={y(rate) + 4}
              textAnchor="end"
              className="ec-axis-label"
            >
              {rate}
            </text>
          </g>
        ))}
        {ticks.map((year, index) => (
          <text
            key={year}
            x={x(year)}
            y={height - 9}
            textAnchor={
              index === 0
                ? "start"
                : index === ticks.length - 1
                  ? "end"
                  : "middle"
            }
            className="ec-axis-label"
          >
            {year}
          </text>
        ))}
        {cities.some((city) => city.id === "tokyo") &&
          [1956, 1962].map((year, index) => (
            <g key={year}>
              <line
                x1={x(year)}
                x2={x(year)}
                y1={top}
                y2={bottom}
                className="ec-policy-line"
              />
              {width > 500 && (
                <text
                  x={x(year) + (index ? 5 : -5)}
                  y={top - 10}
                  textAnchor={index ? "start" : "end"}
                  className="ec-policy-label"
                >
                  {year} law
                </text>
              )}
            </g>
          ))}
        {cities.map((city) => {
          const upper = city.trend.map(
            (point) => `${x(point.year)},${y(illustrationBand(point).high)}`,
          );
          const lower = [...city.trend]
            .reverse()
            .map(
              (point) => `${x(point.year)},${y(illustrationBand(point).low)}`,
            );
          return (
            <g key={city.id} style={{ color: CITY_COLORS[city.id] }}>
              {showBand && (
                <polygon
                  points={[...upper, ...lower].join(" ")}
                  fill="currentColor"
                  opacity=".13"
                />
              )}
              <polyline
                points={city.trend
                  .map(
                    (point) =>
                      `${x(point.year)},${y(Math.abs(point.rateMmPerYear))}`,
                  )
                  .join(" ")}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              {city.trend.map((point) => (
                <circle
                  key={point.year}
                  cx={x(point.year)}
                  cy={y(Math.abs(point.rateMmPerYear))}
                  r={selectedYear === point.year ? 5 : 2.5}
                  fill="var(--es-deep)"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              ))}
            </g>
          );
        })}
        {cities.length > 0 && (
          <line
            x1={x(selectedYear)}
            x2={x(selectedYear)}
            y1={top}
            y2={bottom}
            className="ec-inspection-line"
          />
        )}
        <text
          x={right}
          y={top + 17}
          textAnchor="end"
          className="ec-plot-notice"
        >
          ILLUSTRATION · NOT MEASURED
        </text>
      </svg>
    </div>
  );
}

export function PointReading({ city, year }: { city: CaseCity; year: number }) {
  const point = pointAtYear(city, year);
  return (
    <div className="ec-point-reading">
      <span className="ec-city-key" style={{ color: CITY_COLORS[city.id] }}>
        {city.name}
      </span>
      {point ? (
        <>
          <strong>
            {Math.abs(point.rateMmPerYear)} <span>mm/year</span>
          </strong>
          <small>
            Illustrated magnitude · band ±{point.uncertainty} mm/year
          </small>
        </>
      ) : (
        <>
          <strong className="ec-no-point">
            No illustrated point in {year}
          </strong>
          <small>
            No reading is interpolated. This says nothing about actual ground
            motion.
          </small>
        </>
      )}
    </div>
  );
}

export function TrendExplorer() {
  const id = useId();
  const years = trendYears(BOTH_CITIES);
  const [year, setYear] = useState(1962);
  const [visible, setVisible] = useState<CaseCity["id"][]>(["tehran", "tokyo"]);
  const [showBand, setShowBand] = useState(true);
  const cities = BOTH_CITIES.filter((city) => visible.includes(city.id));
  const index = years.indexOf(year);
  return (
    <figure className="ec-trend" aria-labelledby={`${id}-title`}>
      <div className="ec-figure-heading">
        <h3 id={`${id}-title`}>Two histories, drawn to explain.</h3>
        <span>Illustrative curves &amp; bands · not measured</span>
      </div>
      <div
        className="ec-series-controls"
        role="group"
        aria-label="Visible illustrated city series"
      >
        {BOTH_CITIES.map((city) => (
          <button
            type="button"
            key={city.id}
            aria-pressed={visible.includes(city.id)}
            onClick={() =>
              setVisible((current) =>
                current.includes(city.id)
                  ? current.filter((value) => value !== city.id)
                  : [...current, city.id],
              )
            }
          >
            <i
              style={{ background: CITY_COLORS[city.id] }}
              aria-hidden="true"
            />
            {city.name}
            <span>{visible.includes(city.id) ? "shown" : "hidden"}</span>
          </button>
        ))}
        <label>
          <input
            type="checkbox"
            checked={showBand}
            onChange={(event) => setShowBand(event.target.checked)}
          />
          Illustrative bands
        </label>
      </div>
      <IllustratedPlot
        cities={cities}
        selectedYear={year}
        onInspect={setYear}
        showBand={showBand}
        years={years}
      />
      {!cities.length && (
        <p className="ec-empty">
          Both series are hidden. Show a city above to inspect its illustration.
        </p>
      )}
      <div className="ec-point-controls">
        <div className="ec-range-label">
          <label htmlFor={`${id}-year`}>Inspect an illustrated point</label>
          <output htmlFor={`${id}-year`}>{year}</output>
        </div>
        <input
          id={`${id}-year`}
          type="range"
          min={0}
          max={years.length - 1}
          step={1}
          value={index}
          aria-valuetext={`${year}, illustrated year, not an acquisition`}
          onChange={(event) => setYear(years[Number(event.target.value)])}
        />
        <div className="ec-control-row">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => setYear(years[index - 1])}
          >
            Previous point
          </button>
          <label className="ec-select-label">
            Year
            <select
              aria-label="Illustrated chart year"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            >
              {years.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={index === years.length - 1}
            onClick={() => setYear(years[index + 1])}
          >
            Next point
          </button>
        </div>
      </div>
      <div className="ec-point-readings" aria-live="polite" aria-atomic="true">
        {cities.map((city) => (
          <PointReading key={city.id} city={city} year={year} />
        ))}
      </div>
      <figcaption>
        The lines and ± bands are synthetic. Higher values mean faster sinking
        in the illustration. Tokyo’s historical peak and Tehran’s satellite era
        are different records. Dashed lines mark the 1956 and 1962 water laws,
        not proof of their effect on a plotted point.
      </figcaption>
    </figure>
  );
}

export function MilestoneTimeline({
  cities = BOTH_CITIES,
}: {
  cities?: CaseCity[];
}) {
  const id = useId();
  const entries = milestones(cities);
  const minYear = entries[0].event.year;
  const maxYear = entries.at(-1)!.event.year;
  const [year, setYear] = useState(maxYear);
  const [selectedKey, setSelectedKey] = useState(entries.at(-1)!.key);
  const selected = entries.find((entry) => entry.key === selectedKey)!;
  const selectedIndex = entries.indexOf(selected);
  const select = (key: string) => {
    const entry = entries.find((item) => item.key === key)!;
    setSelectedKey(key);
    setYear(entry.event.year);
  };
  const scrub = (nextYear: number) => {
    setYear(nextYear);
    const entry = latestMilestone(entries, nextYear, selectedKey);
    if (entry) setSelectedKey(entry.key);
  };
  return (
    <div className="ec-timeline">
      <div className="ec-event-key" aria-label="Milestone types">
        {Object.entries(EVENT_META).map(([key, meta]) => (
          <span key={key}>
            <i style={{ background: meta.color }} aria-hidden="true" />
            {meta.label}
          </span>
        ))}
      </div>
      <div className="ec-timeline-tracks">
        {cities.map((city) => (
          <div className="ec-timeline-track" key={city.id}>
            <div className="ec-track-heading">
              <strong style={{ color: CITY_COLORS[city.id] }}>
                {city.name}
              </strong>
              <span>{city.timeline.length} milestones</span>
            </div>
            <div className="ec-marker-track">
              <div
                className="ec-track-progress"
                style={{
                  width: `${((year - minYear) / (maxYear - minYear)) * 100}%`,
                }}
              />
              {entries
                .filter((entry) => entry.city.id === city.id)
                .map((entry, index) => (
                  <button
                    key={entry.key}
                    type="button"
                    className={`ec-event-marker${entry.event.year > year ? " ec-unreached" : ""}`}
                    style={{
                      left: `${((entry.event.year - minYear) / (maxYear - minYear)) * 100}%`,
                      top: 12 + (index % 4) * 44,
                      color: EVENT_META[entry.event.kind].color,
                    }}
                    aria-label={`${city.name} ${entry.event.year}, ${EVENT_META[entry.event.kind].label}: ${entry.event.title}`}
                    aria-pressed={selectedKey === entry.key}
                    onClick={() => select(entry.key)}
                  >
                    <i aria-hidden="true" />
                    <span>{entry.event.year}</span>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="ec-range-label">
        <label htmlFor={`${id}-scrub`}>
          Move through the historical milestones
        </label>
        <output htmlFor={`${id}-scrub`}>{year}</output>
      </div>
      <input
        id={`${id}-scrub`}
        type="range"
        min={minYear}
        max={maxYear}
        value={year}
        onChange={(event) => scrub(Number(event.target.value))}
        aria-describedby={`${id}-scrub-help`}
      />
      <p id={`${id}-scrub-help`} className="ec-help">
        {minYear}–{maxYear} · Scrubbing reveals the latest milestone at or
        before the selected year. Choose a marker or event to inspect another.
      </p>
      <div className="ec-control-row ec-event-select">
        <button
          type="button"
          disabled={selectedIndex === 0}
          onClick={() => select(entries[selectedIndex - 1].key)}
        >
          Previous event
        </button>
        <label className="ec-select-label">
          Milestone
          <select
            aria-label="Select a historical milestone"
            value={selectedKey}
            onChange={(event) => select(event.target.value)}
          >
            {entries.map((entry) => (
              <option value={entry.key} key={entry.key}>
                {entry.event.year} · {entry.city.name} · {entry.event.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={selectedIndex === entries.length - 1}
          onClick={() => select(entries[selectedIndex + 1].key)}
        >
          Next event
        </button>
      </div>
      <article
        className="ec-event-detail"
        aria-live="polite"
        aria-atomic="true"
      >
        <p
          className="ec-event-meta"
          style={{ color: EVENT_META[selected.event.kind].color }}
        >
          {selected.city.name} · {selected.event.year} ·{" "}
          {EVENT_META[selected.event.kind].label}
        </p>
        <h3>{selected.event.title}</h3>
        <p>{selected.event.detail}</p>
      </article>
      <p className="ec-help">
        Educational historical summaries, not acquisition dates. Early Tokyo
        levelling and Tehran satellite radar have different coverage and
        uncertainties. A shared time axis does not make them equivalent
        measurements.
      </p>
    </div>
  );
}
