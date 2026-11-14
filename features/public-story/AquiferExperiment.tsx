"use client";
import { useState } from "react";
import { AquiferCrossSection } from "@/features/ground-truth/components/story/AquiferCrossSection";

export function AquiferExperiment({
  progress,
  scrollDriven,
}: {
  progress: number;
  scrollDriven: boolean;
}) {
  const [override, setOverride] = useState<{
    value: number;
    at: number;
  } | null>(null);
  const manual =
    override && (scrollDriven || override.at === progress)
      ? override.value
      : null;
  const setManual = (value: number | null) =>
    setOverride(value === null ? null : { value, at: progress });
  const value = manual ?? progress;
  const state =
    value < 0.15
      ? "Water fills the spaces between grains."
      : value < 0.65
        ? "Water pressure falls. Fine layers squeeze together."
        : "The layers are thinner. The surface has settled.";
  return (
    <figure
      className="es-aquifer-object"
      aria-label="Interactive aquifer compaction schematic"
    >
      <div className="es-aquifer-object-view">
        <AquiferCrossSection
          exhibition
          compaction={value}
          waterLevel={value}
          showLabels={false}
          ariaLabel={`Schematic aquifer at ${Math.round(value * 100)}% of the illustrative change. ${state} Not measured depths or elapsed years.`}
        />
      </div>
      <figcaption>{state}</figcaption>
      <div className="es-aquifer-key">
        <span>
          <i className="es-key-soil" />
          Fine sediments
        </span>
        <span>
          <i className="es-key-water" />
          Groundwater
        </span>
        <span>
          <i className="es-key-reference" />
          Original surface
        </span>
      </div>
      <details className="es-water-controls" open={!scrollDriven}>
        <summary>Your experiment: change the water</summary>
        <div>
          <label htmlFor="aquifer-progress">
            Move through the illustrative change
          </label>
          <input
            id="aquifer-progress"
            type="range"
            min="0"
            max="100"
            value={Math.round(value * 100)}
            onChange={(event) => setManual(Number(event.target.value) / 100)}
            aria-valuetext={`${Math.round(value * 100)}% through the schematic, not elapsed years`}
          />
          <div className="es-water-presets">
            <button
              type="button"
              onClick={() => setManual(0)}
              aria-pressed={value === 0}
            >
              Water held
            </button>
            <button
              type="button"
              onClick={() => setManual(0.5)}
              aria-pressed={value === 0.5}
            >
              Pumping
            </button>
            <button
              type="button"
              onClick={() => setManual(1)}
              aria-pressed={value === 1}
            >
              Compacted
            </button>
          </div>
        </div>
      </details>
      {manual !== null && (
        <button
          type="button"
          className="es-follow-story"
          onClick={() => setManual(null)}
        >
          Follow the story
        </button>
      )}
    </figure>
  );
}
