"use client";
import { useState } from "react";
import {
  advanceSeason,
  ALTERNATE_CAPACITY,
  AUTHORING_NOTICE,
  DROUGHT_SEASONS,
  freshSeasonTrial,
  policyScenario,
  POLICY_NOTICE,
  type SeasonTrial,
} from "@/lib/field-investigation";
import { useDiscoverySound } from "./DiscoverySound";
import { directEcho } from "@/lib/echo-director";
import { useFieldTelemetry } from "../quest/GameDirector";

export function SeasonalControls({
  state,
  change,
}: {
  state: SeasonTrial | null;
  change: (state: SeasonTrial) => void;
}) {
  const trial = state ?? freshSeasonTrial();
  const [pump, setPump] = useState(45),
    [alternate, setAlternate] = useState(0);
  const { respond, cue } = useDiscoverySound();
  const next = DROUGHT_SEASONS[Math.min(3, trial.season)],
    other = (alternate / 100) * ALTERNATE_CAPACITY;
  useFieldTelemetry(
    state
      ? {
          kind: "season",
          season: trial.season,
          storage: trial.storage,
          compacted: trial.compacted,
          deficit: trial.deficit,
          balanced: trial.balancedSeasons,
        }
      : null,
  );
  return (
    <section
      className="ex-season"
      aria-label="Four dry seasons water challenge"
    >
      <header>
        <small>NOW KEEP THE TAPS RUNNING</small>
        <h3>Four dry seasons. One reserve.</h3>
        <p>
          Give the city water without leaving less underground. Another supply
          can carry part of the demand.
        </p>
      </header>
      <div className="ex-season-dials">
        <span>
          Demand <b>{trial.locked ? "Complete" : next.demand}</b>
          <small>game units</small>
        </span>
        <span>
          Natural refill <b>{trial.locked ? "—" : next.recharge}</b>
          <small>game units</small>
        </span>
        <span>
          Reserve <b>{trial.storage.toFixed(0)}/100</b>
          <small>game units</small>
        </span>
      </div>
      <div className="ex-season-valves">
        <label>
          Well valve <output>{pump} units</output>
          <input
            data-affordance="season"
            aria-label="Seasonal pumping units"
            type="range"
            min="0"
            max="100"
            value={pump}
            disabled={trial.locked}
            onChange={(e) => {
              setPump(Number(e.target.value));
              respond("water", Number(e.target.value) / 100);
            }}
          />
        </label>
        <label>
          Other supply{" "}
          <output>
            {other.toFixed(0)} / {ALTERNATE_CAPACITY} units
          </output>
          <input
            aria-label="Alternative water supply valve"
            type="range"
            min="0"
            max="100"
            value={alternate}
            disabled={trial.locked}
            onChange={(e) => {
              setAlternate(Number(e.target.value));
              respond("water", Number(e.target.value) / 100);
            }}
          />
        </label>
      </div>
      <svg
        className="ex-supply-route"
        viewBox="0 0 600 80"
        role="img"
        aria-label={`Well request${pump}units,other supply${other.toFixed(0)}units; demand${next.demand}gameunits`}
      >
        <path
          d="M40 25H280L300 60H560"
          stroke="var(--earth-accent)"
          strokeWidth={2 + other / 5}
          fill="none"
        />
        <path
          d="M40 60H560"
          stroke="var(--earth-muted)"
          strokeWidth={2 + pump / 10}
          fill="none"
        />
        <text x="40" y="15">
          OTHER SUPPLY
        </text>
        <text x="420" y="20">
          CITY DEMAND
        </text>
      </svg>
      <div className="ed-actions">
        <button
          type="button"
          disabled={trial.locked}
          onClick={() => {
            const result = advanceSeason(trial, pump, alternate);
            change(result);
            if (result.compacted > trial.compacted)
              cue("strain", result.compacted * 30);
            else cue("water", pump);
          }}
        >
          Run dry season {Math.min(4, trial.season + 1)} →
        </button>
        <button type="button" onClick={() => change(freshSeasonTrial())}>
          Try a fresh water plan
        </button>
      </div>
      <ol className="ex-season-ledger" aria-label="Your seasonal results">
        {DROUGHT_SEASONS.map((_, i) => {
          const record = trial.history[i];
          return (
            <li key={i} data-filled={!!record}>
              <small>SEASON {i + 1}</small>
              <b>
                {record
                  ? record.deficit > 0
                    ? `${record.deficit.toFixed(0)} short`
                    : "Taps supplied"
                  : "Waiting"}
              </b>
              <span>
                {record
                  ? `${record.storage.toFixed(0)} reserve · ${record.compacted > 0 ? "pore space lost" : "no compaction"}`
                  : "Turn the valves"}
              </span>
            </li>
          );
        })}
      </ol>
      <p role="status" className="ex-live-caption">
        {
          directEcho({
            kind: "season",
            season: trial.season,
            storage: trial.storage,
            compacted: trial.compacted,
            deficit: trial.deficit,
            balanced: trial.balancedSeasons,
          }).text
        }
      </p>
      <details>
        <summary>The game rules</summary>
        <p>
          {AUTHORING_NOTICE} A balanced season meets demand, keeps the reserve
          from falling and adds no compaction. Look at each season’s demand and
          natural refill before turning the valves. Connect the other supply,
          then use the well for the remaining demand.
        </p>
      </details>
    </section>
  );
}

export function PolicyInstrument({ onCompared }: { onCompared?: () => void }) {
  const [step, setStep] = useState(10),
    [seen, setSeen] = useState(0),
    [touched, setTouched] = useState(false),
    [reduction, setReduction] = useState(0.6);
  const result = policyScenario(step, reduction),
    { respond } = useDiscoverySound();
  useFieldTelemetry(
    touched
      ? {
          kind: "policy",
          actionStep: step,
          reduction,
          total: result.actedTotal,
        }
      : null,
  );
  const move = (value: number) => {
    setTouched(true);
    setStep(value);
    const mask = seen | (value <= 5 ? 1 : value >= 15 ? 2 : 0);
    setSeen(mask);
    if (mask === 3) onCompared?.();
    respond("water", 1 - value / 20);
  };
  const line = (which: "acted" | "baseline") =>
    result.points
      .map((p, i) => `${i ? "L" : "M"}${35 + i * 26} ${35 + p[which] * 7}`)
      .join(" ");
  return (
    <section className="ex-policy" aria-label="Policy timing sandbox">
      <header>
        <small>WRITE THE NEXT CHAPTER · SCENARIO</small>
        <h3>You cannot lift the past. You can bend the next line.</h3>
        <p>
          Drag the intervention earlier, then later. The gap is what delay costs
          under these invented assumptions.
        </p>
      </header>
      <svg
        viewBox="0 0 600 220"
        role="img"
        aria-label={`Authored scenario, actionstep${step},cumulative settling${result.actedTotal.toFixed(1)}gameunits; baseline20`}
      >
        <path d="M35 25V180H560" fill="none" stroke="var(--earth-line)" />
        <path
          d={line("baseline")}
          fill="none"
          stroke="var(--earth-muted)"
          strokeDasharray="5 5"
        />
        <path
          d={line("acted")}
          fill="none"
          stroke="var(--earth-accent)"
          strokeWidth="3"
        />
        <path
          d={`M${35 + step * 26} 25V180`}
          stroke="var(--earth-text)"
          strokeDasharray="3 4"
        />
        <text x="38" y="15">
          Cumulative future settling ↓ · game units
        </text>
        <text x="35" y="205">
          Step 0
        </text>
        <text x="489" y="205">
          Step 20
        </text>
      </svg>
      <label>
        When to act <output>Step {step}</output>
        <input
          data-affordance="policy"
          aria-label="Policy action step"
          type="range"
          min="0"
          max="20"
          value={step}
          onChange={(e) => move(Number(e.target.value))}
        />
      </label>
      <div className="ed-actions">
        <button type="button" onClick={() => move(3)}>
          Act early
        </button>
        <button type="button" onClick={() => move(17)}>
          Wait longer
        </button>
      </div>
      <label>
        Assume less future settling{" "}
        <output>{Math.round(reduction * 100)}%</output>
        <input
          aria-label="Assumed scenario reduction"
          type="range"
          min="0"
          max="100"
          value={Math.round(reduction * 100)}
          onChange={(e) => {
            setTouched(true);
            setReduction(Number(e.target.value) / 100);
          }}
        />
      </label>
      <div className="ex-policy-comparison">
        <span>
          Same old path <b>20 units</b>
        </span>
        <span>
          Your assumed path <b>{result.actedTotal.toFixed(1)} units</b>
        </span>
      </div>
      <p className="ex-live-caption">
        {seen === 3
          ? "You compared early and late action. The curve can flatten; the height already lost stays lost."
          : "Move the intervention to both ends. Keep an eye on the space between the lines."}
      </p>
      <details>
        <summary>Assumptions, not a prediction</summary>
        <p>
          {POLICY_NOTICE} The percentage is your assumption, not an estimate of
          what a water law will achieve. Tokyo’s historical events are explored
          separately below.
        </p>
      </details>
    </section>
  );
}

export function HumanScale({
  value,
  unit,
  label,
}: {
  value: number;
  unit: "mm/yr" | "mm LOS";
  label: string;
}) {
  const length = Math.min(1, Math.abs(value) / 350);
  return (
    <figure className="ex-human-scale">
      <svg
        viewBox="0 0 400 55"
        role="img"
        aria-label={`${Math.abs(value).toFixed(1)}${unit},shownagainst350mmreference,diagramnotlife-size`}
      >
        <path d="M20 30H370" stroke="var(--earth-line)" />
        {Array.from({ length: 36 }, (_, i) => (
          <path
            key={i}
            d={`M${20 + i * 10} 25V${i % 5 === 0 ? 40 : 34}`}
            stroke="var(--earth-muted)"
          />
        ))}
        <path
          d={`M20 15H${20 + 350 * length}`}
          stroke="var(--earth-accent)"
          strokeWidth="6"
        />
        <text x="20" y="54">
          0
        </text>
        <text x="330" y="54">
          350 mm
        </text>
      </svg>
      <figcaption>
        <strong>
          {Math.abs(value).toFixed(1)} {unit}
        </strong>{" "}
        · {label}
        <small>
          Comparison diagram · not life-size
          {unit === "mm/yr" ? " · a rate, not one year directly observed" : ""}
        </small>
      </figcaption>
    </figure>
  );
}
