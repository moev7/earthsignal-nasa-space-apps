"use client";
import { useState } from "react";
import { phaseTwin, phaseTransect } from "@/lib/field-investigation";
import { phaseColour, radarSample, RADAR } from "@/lib/radar-interferometry";
import { directEcho } from "@/lib/echo-director";
import { useFieldTelemetry } from "../quest/GameDirector";
import { useDiscoverySound } from "./DiscoverySound";

/** A section through the SAME synthetic bowl; never samples or interpolates real rasters. */
export function PhaseInstrument({
  sinkingM,
  probeX = 120,
  onProbe,
  onDepth,
  onSolved,
  challenge = false,
}: {
  sinkingM: number;
  probeX?: number;
  onProbe?: (x: number) => void;
  onDepth?: (depth: number) => void;
  onSolved?: () => void;
  challenge?: boolean;
}) {
  const [localX, setLocalX] = useState(120),
    [twins, setTwins] = useState(0),
    [walk, setWalk] = useState(0);
  const x = onProbe ? probeX : localX,
    twin = phaseTwin(),
    samples = phaseTransect(sinkingM),
    sample = radarSample(x, 0, sinkingM);
  const [touched, setTouched] = useState(false);
  const { respond } = useDiscoverySound();
  useFieldTelemetry(touched ? { kind: "radar", xM: x, zM: 0, sinkingM } : null);
  const echo = directEcho({ kind: "radar", xM: x, zM: 0, sinkingM });
  const drop = (sample.downM / 0.3) * 115,
    los = (sample.deltaRangeM / 0.3) * 115;
  const projectionX = 60 + los * Math.sin((RADAR.incidenceDeg * Math.PI) / 180),
    projectionY = 20 + los * Math.cos((RADAR.incidenceDeg * Math.PI) / 180);
  const move = (value: number) => {
    const next = Math.max(0, Math.min(120, Math.round(value)));
    onProbe?.(next);
    setLocalX(next);
    setTouched(true);
    const mark = walk | (next >= 118 ? 1 : next <= 2 ? 4 : 2);
    setWalk(mark);
    if (challenge && twins === 3 && mark === 7) onSolved?.();
    respond(
      "phase",
      radarSample(next, 0, sinkingM).downM / 0.3,
      radarSample(next, 0, sinkingM).wrappedCycles,
    );
  };
  const choose = (deep: boolean) => {
    const mask = twins | (deep ? 2 : 1);
    setTwins(mask);
    setTouched(true);
    onDepth?.(deep ? twin.secondDownM : twin.firstDownM);
    if (challenge && mask === 3 && walk === 7) onSolved?.();
  };
  const col = phaseColour(sample.wrappedCycles).map((v) => Math.round(v * 255));
  const path = (kind: "phase" | "depth") =>
    samples
      .map(
        (s, i) =>
          `${i ? "L" : "M"}${40 + i * 4.33} ${kind === "phase" ? 44 + (1 - s.wrappedCycles) * 65 : 150 + (s.downMm / 300) * 65}`,
      )
      .join(" ");
  const wave = (offset: number) =>
    Array.from(
      { length: 121 },
      (_, i) =>
        `${i ? "L" : "M"}${(20 + i * 4.66).toFixed(3)} ${(30 + 12 * Math.sin((i / 120) * Math.PI * 12 + offset)).toFixed(3)}`,
    ).join(" ");
  return (
    <section className="ex-phase" aria-label="Orbital duet phase instrument">
      <header>
        <div>
          <small>ORBITAL DUET · SYNTHETIC</small>
          <h3>One colour can hide a whole turn.</h3>
        </div>
        <svg
          viewBox="0 0 70 70"
          role="img"
          aria-label={`Phase clock ${sample.wrappedCycles.toFixed(3)} cycles`}
        >
          <circle
            cx="35"
            cy="35"
            r="29"
            fill="none"
            stroke="var(--earth-line)"
          />
          <path
            d="M35 10V35"
            stroke={`rgb(${col.join(",")})`}
            strokeWidth="3"
            transform={`rotate(${sample.wrappedCycles * 360} 35 35)`}
          />
          <circle cx="35" cy="35" r="4" fill="var(--earth-text)" />
        </svg>
      </header>
      {challenge && (
        <div className="ex-twins">
          <p>
            Two bowls. Their centre colours match exactly. Try both, then walk
            the probe from the stable edge to the centre.
          </p>
          <div className="ed-actions">
            <button
              type="button"
              data-affordance="twin-shallow"
              onClick={() => choose(false)}
            >
              Lift shallow bowl · {(twin.firstDownM * 1000).toFixed(1)} mm
            </button>
            <button
              type="button"
              data-affordance="twin-deep"
              onClick={() => choose(true)}
            >
              Lift deeper bowl · {(twin.secondDownM * 1000).toFixed(1)} mm
            </button>
          </div>
          <small>
            Same wrapped centre phase ·{" "}
            {((twin.secondDownM - twin.firstDownM) * 1000).toFixed(1)} mm more
            vertical sinking in the deeper bowl.
          </small>
        </div>
      )}
      <svg
        className="ex-wave"
        viewBox="0 0 600 60"
        role="img"
        aria-label="Pass one and pass two phase waveforms, illustrative not recorded"
      >
        <path
          d={wave(0)}
          fill="none"
          stroke="var(--earth-muted)"
          strokeDasharray="4 5"
        />
        <path
          d={wave(sample.cycles * 2 * Math.PI)}
          fill="none"
          stroke="var(--earth-accent)"
          strokeWidth="2"
        />
        <text x="22" y="58">
          Pass 1 · reference
        </text>
        <text x="360" y="58">
          Pass 2 · repeat
        </text>
      </svg>
      <svg
        className="ex-transect"
        viewBox="0 0 600 245"
        role="img"
        aria-label="Linked synthetic section: wrapped phase resets each cycle; vertical sinking stays continuous"
      >
        <text x="40" y="23">
          Wrapped phase · 0–1 cycles
        </text>
        <path d="M40 110H560M40 150H560" stroke="var(--earth-line)" />
        <path
          d={path("phase")}
          fill="none"
          stroke="var(--earth-accent)"
          strokeWidth="2"
        />
        <text x="40" y="142">
          Vertical sinking · 0–300 mm ↓
        </text>
        <path
          d={path("depth")}
          fill="none"
          stroke="var(--earth-text)"
          strokeWidth="2"
        />
        <path
          d={`M${40 + (120 - x) * 4.33} 35V218`}
          stroke="var(--earth-muted)"
          strokeDasharray="3 4"
        />
        <text x="40" y="240">
          A · stable reference · 120 m
        </text>
        <text x="405" y="240">
          B · centre · 0 m
        </text>
      </svg>
      <label>
        Walk the target probe <output>{x} m from centre</output>
        <input
          data-affordance="transect"
          aria-label="Walk radar probe from stable edge to centre"
          type="range"
          min="0"
          max="120"
          step="1"
          value={120 - x}
          onChange={(e) => move(120 - Number(e.target.value))}
        />
      </label>
      <div className="ed-actions">
        <button type="button" onClick={() => move(120)}>
          Reference edge
        </button>
        <button type="button" onClick={() => move(60)}>
          Cross the slope
        </button>
        <button type="button" onClick={() => move(0)}>
          Target centre
        </button>
      </div>
      <div className="ex-phase-numbers">
        <span>
          <b>{(sample.downM * 1000).toFixed(1)} mm</b>vertical sinking
        </span>
        <span>
          <b>+{(sample.deltaRangeM * 1000).toFixed(1)} mm</b>LOS range
        </span>
        <span>
          <b>{sample.cycles.toFixed(3)}</b>total cycles
        </span>
        <span>
          <b>{sample.wrappedCycles.toFixed(3)}</b>wrapped cycles
        </span>
      </div>
      <p className="ex-live-caption" role="status">
        {echo.text}
      </p>
      <details>
        <summary>The 35° triangle &amp; the limits of this trick</summary>
        <div className="ex-triangle">
          <svg
            viewBox="0 0 300 160"
            role="img"
            aria-label={`Vertical sinking ${(sample.downM * 1000).toFixed(1)} mm projects to ${(sample.deltaRangeM * 1000).toFixed(1)} mm LOS at 35 degrees`}
          >
            <path
              d="M60 20V135M60 20L126 114"
              fill="none"
              stroke="var(--earth-line)"
              strokeDasharray="3 4"
            />
            <path
              d={`M60 20V${20 + drop}L${projectionX} ${projectionY}Z`}
              fill="none"
              stroke="var(--earth-accent)"
              strokeWidth="2"
            />
            <text x="74" y="50">
              35°
            </text>
            <text x="151" y="90">
              ΔR = down × cos35°
            </text>
            <text x="60" y="157">
              λ/2 = {RADAR.wavelengthM * 500} mm LOS per turn
            </text>
          </svg>
          <p>
            One turn is 120 mm of line-of-sight range change, about{" "}
            {(twin.verticalCycleM * 1000).toFixed(1)} mm vertically at 35°. The
            section has a known still edge and a smooth, noise-free bowl. Real
            unwrapping needs connected valid observations and additional checks;
            a transect across a gap cannot recover missing evidence.
          </p>
        </div>
      </details>
    </section>
  );
}
