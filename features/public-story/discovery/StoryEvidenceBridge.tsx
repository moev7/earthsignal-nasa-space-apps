"use client";
import { lazy, Suspense, useState } from "react";
import {
  useNisarBundle,
  NISAR_BUNDLES,
  formatPeriod,
} from "@/features/ground-truth/data/nisar";
import { HumanScale } from "./FieldInstruments";
const Study = lazy(() => import("../radar-study/PublicRadarStudy"));

export function TehranScale() {
  const state = useNisarBundle(NISAR_BUNDLES.tehran);
  if (state?.status !== "ready")
    return (
      <p className="es-caption">
        The neighbourhood reading appears after the observation bundle passes
        its integrity checks.
      </p>
    );
  const m = state.data.manifest,
    r = m.stats.fastest_neighbourhood;
  if (!r) return null;
  return (
    <div className="ex-neighbourhood-reading">
      <p>
        <strong>
          {Math.abs(r.vertical_rate / 10).toFixed(1)} centimetres a year down.
        </strong>{" "}
        A relative rate estimated for one selected neighbourhood—not every
        street in Tehran.
      </p>
      <HumanScale
        value={r.vertical_rate}
        unit="mm/yr"
        label={`${(r.size_m / 1000).toFixed(1)}km neighbourhood aggregate · provisional measured estimate`}
      />
      <details>
        <summary>What this rate describes</summary>
        <p>
          {formatPeriod(m)} · relative short-record rate. The diagram compares
          its millimetres with a ruler; it is not a full year of directly
          observed height loss, a future forecast or a building assessment.
          Seasonal and atmospheric effects matter; consult the measurement
          record.
        </p>
      </details>
    </div>
  );
}
export function RadarEvidenceBridge() {
  const [open, setOpen] = useState(false);
  return (
    <section
      className="ex-radar-bridge"
      aria-label="NISAR's two different ways to notice change"
    >
      <header>
        <small>A SECOND DANCE STEP</small>
        <h3>A moving street. A changing echo. Different clues.</h3>
        <p>
          In Tehran, repeated phase helps estimate ground motion. At Lake Mead,
          two radar brightness records ask a different question: how did the
          surface’s echo change?
        </p>
      </header>
      <div className="ex-two-quantities">
        <div>
          <svg viewBox="0 0 220 70" aria-hidden="true">
            <path
              d="M15 20H205M15 48H85L140 57H205"
              fill="none"
              stroke="var(--earth-accent)"
              strokeWidth="2"
            />
            <path
              d="M115 20V52m-5-7 5 7 5-7"
              fill="none"
              stroke="var(--earth-text)"
            />
          </svg>
          <b>Tehran · GUNW</b>
          <span>Relative ground motion · mm/yr</span>
        </div>
        <div>
          <svg viewBox="0 0 220 70" aria-hidden="true">
            {Array.from({ length: 30 }, (_, i) => (
              <path
                key={i}
                d={`M${15 + i * 6} 35v${Math.sin(i * 2.3) * 24}`}
                stroke="var(--earth-accent)"
                strokeWidth="3"
              />
            ))}
          </svg>
          <b>Lake Mead · GCOV</b>
          <span>HH echo brightness change · dB</span>
        </div>
      </div>
      <details
        className="ed-details"
        onToggle={(e) => setOpen(e.currentTarget.open)}
      >
        <summary>Play the two-date Lake Mead comparison</summary>
        {open && (
          <Suspense fallback={<p role="status">Checking the second record…</p>}>
            <Study />
          </Suspense>
        )}
      </details>
      <p className="ed-evidence">
        These studies use different places, dates and quantities. A changed echo
        can have several explanations; this comparison does not establish lake
        depth, ground sinking or its cause.
      </p>
    </section>
  );
}

export function SoilLens({
  depletion,
  compacted,
}: {
  depletion: number;
  compacted: number;
}) {
  return (
    <div className="ex-soil-lens">
      <svg
        viewBox="0 0 600 145"
        role="img"
        aria-label={`Illustrated pore window: water${Math.round((1 - depletion) * 100)}percent;clayspacingretainscompactionafterrefill`}
      >
        <text x="15" y="20">
          SAND · WATER BETWEEN GRAINS
        </text>
        <text x="320" y="20">
          FINE LAYER · SPACE THAT CAN STAY LOST
        </text>
        <rect x="10" y="30" width="260" height="100" fill="var(--earth-deep)" />
        <rect
          x="10"
          y={30 + depletion * 100}
          width="260"
          height={(1 - depletion) * 100}
          fill="var(--earth-accent)"
          opacity=".3"
        />
        {Array.from({ length: 18 }, (_, i) => (
          <circle
            key={i}
            cx={30 + (i % 6) * 42}
            cy={49 + Math.floor(i / 6) * 30}
            r="11"
            fill="var(--earth-muted)"
          />
        ))}
        {Array.from({ length: 20 }, (_, i) => (
          <rect
            key={i}
            x={320 + (i % 5) * 48}
            y={42 + Math.floor(i / 5) * (25 - compacted * 10)}
            width="35"
            height="5"
            rx="2"
            fill="var(--earth-muted)"
            transform={`rotate(${(1 - compacted) * ((i % 3) - 1) * 8} ${337 + (i % 5) * 48} ${44 + Math.floor(i / 5) * (25 - compacted * 10)})`}
          />
        ))}
        <path d="M300 35V130" stroke="var(--earth-line)" />
      </svg>
      <span>
        {compacted > 0.4
          ? "The blue can return. The crowded platelets stay crowded."
          : "Watch the water and the space separately."}
      </span>
    </div>
  );
}
