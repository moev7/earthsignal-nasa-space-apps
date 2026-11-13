"use client";
import { useState } from "react";
import { useDiscoverySound } from "./DiscoverySound";

/** Invented pads and 20 m joining strip, not the measured560m building estimator. */
export function ConnectionGauge({
  left,
  right,
  onFound,
  compact = false,
}: {
  left: number;
  right: number;
  onFound: () => void;
  compact?: boolean;
}) {
  const [at, setAt] = useState(15),
    { respond } = useDiscoverySound();
  const mismatch = Math.abs(left - right),
    onJoin = at >= 40 && at <= 60;
  const slope = onJoin ? mismatch / 100 / 20 : 0;
  const move = (v: number) => {
    setAt(v);
    respond("strain", onJoin ? mismatch / 30 : 0);
    if (v >= 40 && v <= 60 && mismatch > 0) onFound();
  };
  return (
    <section
      className={`ex-gauge${compact ? " play-gauge" : ""}`}
      aria-label="Move the utility inspection gauge"
    >
      <header>
        <small>FOLLOW THE CONNECTION · INVENTED GEOMETRY</small>
        <h3>Where would you look closer?</h3>
        <p>
          Slide the inspection window across both pads and the joining pipe. A
          deep, level pad and a bending connection tell different stories.
        </p>
      </header>
      <svg
        viewBox={compact ? "0 0 600 140" : "0 0 600 160"}
        role="img"
        aria-label={`West pad${left}cm down,east${right}cm down,20m connectingstrip,localtilt${slope.toPrecision(3)}`}
      >
        <path d="M25 35H575" stroke="var(--earth-line)" strokeDasharray="4 4" />
        <path
          d={`M25 ${40 + left * 2}H240L360 ${40 + right * 2}H575`}
          fill="none"
          stroke="var(--earth-muted)"
          strokeWidth="10"
        />
        <path
          d={`M25 ${60 + left * 2}H240L360 ${60 + right * 2}H575`}
          fill="none"
          stroke="var(--earth-accent)"
          strokeWidth="4"
        />
        <rect
          x={25 + at * 5 - 30}
          y="20"
          width="60"
          height="115"
          fill="var(--earth-accent)"
          fillOpacity=".08"
          stroke="var(--earth-text)"
          strokeDasharray="4 3"
        />
        {!compact && (
          <>
            <text x="25" y="155">WEST PAD</text>
            <text x="250" y="155">20m JOIN</text>
            <text x="485" y="155">EAST PAD</text>
          </>
        )}
      </svg>
      {compact && (
        <div className="play-gauge-key" aria-hidden="true">
          <span>West pad</span><span>20 m join</span><span>East pad</span>
        </div>
      )}
      <label>
        Inspection window{" "}
        <output>
          {onJoin ? "At the connection" : at < 40 ? "West pad" : "East pad"}
        </output>
        <input
          data-affordance="pipe-gauge"
          aria-label="Slide utility inspection window"
          type="range"
          min="0"
          max="100"
          value={at}
          onChange={(e) => move(Number(e.target.value))}
        />
      </label>
      <div className="ed-actions">
        <button type="button" onClick={() => move(15)}>
          Inspect west
        </button>
        <button
          type="button"
          data-affordance="inspect-join"
          onClick={() => move(50)}
        >
          Inspect the connection
        </button>
        <button type="button" onClick={() => move(85)}>
          Inspect east
        </button>
      </div>
      <p className="ex-live-caption" role="status">
        {slope > 0
          ? `${mismatch} cm across the invented 20 m join ≈ 1 in ${Math.round(1 / slope)} ground tilt. This is geometry, not a diagnosis of the pipe or buildings.`
          : "Here the pad stays locally level. Move to the connection to find the difference."}
      </p>
      <details>
        <summary>Why this is not a building safety gauge</summary>
        <p>
          These pads, centimetres and 20 m span are invented teaching inputs.
          The measured map’s560m local ground estimator uses a different method
          with uncertainty. Bjerrum ground-tilt reference levels cannot diagnose
          structural safety or predict collapse.
        </p>
      </details>
    </section>
  );
}
