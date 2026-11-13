"use client";
import { useEffect, useRef, useState } from "react";
import { AquiferCrossSection } from "@/features/ground-truth/components/story/AquiferCrossSection";
import { CityScene } from "@/features/ground-truth/components/story/CityScene";
import { InterferogramConcept } from "@/features/ground-truth/components/story/InterferogramConcept";
import type { RadarModelState } from "@/features/ground-truth/components/story/radar3d/RadarLesson";
import { PhaseInstrument } from "./PhaseInstrument";
import { SoilLens } from "./StoryEvidenceBridge";
import { freshWater, waterCue } from "@/lib/discovery-play";
import { storyWaterPose, waterAt } from "@/lib/story-discovery";
import { useDiscoverySound } from "./DiscoverySound";
import { useSceneViewportFit } from "./useSceneViewportFit";

/** Finite chapter accents on new scroll beats only; no ambient/background clock. */
function useSceneAccent(
  progress: number,
  kind: "water" | "strain" | "capture",
) {
  const host = useRef<HTMLDivElement>(null),
    last = useRef(0),
    active = useRef(false);
  const { enabled, cue, silence } = useDiscoverySound();
  useEffect(() => {
    const node = host.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      const was = active.current;
      active.current = entry.isIntersecting;
      if (was && !entry.isIntersecting) silence();
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (active.current) silence();
    };
  }, [silence]);
  useEffect(() => {
    const beat = Math.min(2, Math.floor(progress * 3));
    if (
      beat !== last.current &&
      active.current &&
      enabled &&
      document.visibilityState !== "hidden"
    )
      cue(kind);
    last.current = beat;
  }, [progress, kind, enabled, cue]);
  return host;
}

export function JourneyWater({ progress }: { progress: number }) {
  const accentRef = useSceneAccent(progress, "water");
  const fitRef = useSceneViewportFit(
    ".ea-cutaway",
    "--water-canvas-height",
    0.29,
    0.38,
  );
  const [manual, setManual] = useState<ReturnType<typeof freshWater> | null>(
    null,
  );
  const pose = manual ?? storyWaterPose(progress);
  const { cue, respond } = useDiscoverySound();
  const change = (value: number) => {
    respond("water", Math.min(1, Math.abs(value - pose.depletion) * 8));
    if (pose.compacted === 0 && value > 0.2) cue("strain", value * 30);
    setManual((old) =>
      waterAt(old ?? { ...pose, pumped: pose.depletion >= 0.75 }, value),
    );
  };
  return (
    <div
      className="ea-water-host"
      ref={(node) => {
        accentRef.current = node;
        fitRef.current = node;
      }}
    >
      <figure
        className="ea-water-scene"
        data-water-level={pose.depletion.toFixed(3)}
        data-compaction={pose.compacted.toFixed(3)}
      >
        <div className="ea-scene-label">
          <span>Below the street</span>
          <small>Illustration</small>
        </div>
        <div className="ea-cutaway">
          <AquiferCrossSection
            exhibition
            compaction={pose.compacted}
            waterLevel={pose.depletion}
            showLabels={false}
            ariaLabel={`Schematic aquifer: ${Math.round((1 - pose.depletion) * 100)}% of illustrative water level; compacted layer ${pose.compacted > 0.4 ? "remains squeezed" : "has open space"}. Not measured depths or time.`}
          />
        </div>
        <figcaption>
          {manual
            ? waterCue(manual)
            : pose.returned
              ? "Water returns. The squeezed layer does not simply spring back."
              : pose.depletion > 0.5
                ? "Less water pressure. Less room between grains. The street settles."
                : "Water lives in the spaces between grains—not an underground lake."}
        </figcaption>
        <div className="ea-water-scrub">
          <label>
            Try it yourself{" "}
            <input
              aria-label="Water remaining in the illustration"
              type="range"
              min="0"
              max="100"
              value={Math.round((1 - pose.depletion) * 100)}
              onChange={(e) => change(1 - Number(e.target.value) / 100)}
              onPointerUp={() => cue("water")}
              onKeyUp={() => cue("water")}
            />
          </label>
          <span>{Math.round((1 - pose.depletion) * 100)}% water</span>
        </div>
        <div className="ea-still-controls">
          <button type="button" onClick={() => change(1)}>
            Draw water
          </button>
          <button type="button" onClick={() => change(0)}>
            Return water
          </button>
          {manual && (
            <button
              type="button"
              className="es-follow-story"
              onClick={() => setManual(null)}
            >
              Follow the story
            </button>
          )}
        </div>
      </figure>
      <details className="ed-details">
        <summary>Look between the grains</summary>
        <SoilLens depletion={pose.depletion} compacted={pose.compacted} />
      </details>
    </div>
  );
}
export function JourneyCity({ progress }: { progress: number }) {
  const accentRef = useSceneAccent(progress, "strain");
  const fitRef = useSceneViewportFit(".es-city-stage", "--city-canvas-height");
  const { cue, silence } = useDiscoverySound();
  return (
    <div
      className="ea-city-scene"
      ref={(node) => {
        accentRef.current = node;
        fitRef.current = node;
      }}
    >
      <div className="ea-scene-label">
        <span>Uneven ground. One street.</span>
        <small>Invented 3D city</small>
      </div>
      <CityScene
        mode="simulation"
        controlledProgress={progress * 0.55}
        onSoundEvent={(event) =>
          event === "collapse" ? cue("collapse") : silence()
        }
        story
        ambient
        exhibition
      />
    </div>
  );
}
export function JourneyRadar({ progress }: { progress: number }) {
  const accentRef = useSceneAccent(progress, "capture");
  const fitRef = useSceneViewportFit(
    ".es-radar-stage",
    "--radar-canvas-height",
  );
  const [manual, setManual] = useState<RadarModelState | null>(null);
  const phaseDetails = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const open = () => {
      if (window.location.hash === "#phase-instrument" && phaseDetails.current) {
        phaseDetails.current.open = true;
        const instruments = phaseDetails.current.closest<HTMLDetailsElement>(".ed-radar-instruments");
        if (instruments) instruments.open = true;
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  const state: RadarModelState = manual ?? {
    sinkingCm: Math.round(
      Math.max(0, Math.min(1, (progress - 0.2) / 0.65)) * 18,
    ),
    observation:
      progress < 0.22 ? "before" : progress < 0.62 ? "after" : "compare",
    selectedSite: "centre",
  };
  return (
    <div
      className="ea-radar-scene"
      ref={(node) => {
        accentRef.current = node;
        fitRef.current = node;
      }}
    >
      <div className="ea-scene-label">
        <span>Two visits. One target.</span>
        <small>Synthetic radar</small>
      </div>
      <InterferogramConcept
        story
        experiment={{
          state,
          change: (patch) => setManual({ ...state, ...patch }),
          reset: () =>
            setManual({
              sinkingCm: 0,
              observation: "compare",
              selectedSite: "centre",
            }),
        }}
        instrumentContent={
            <details ref={phaseDetails} className="ed-details">
              <summary id="phase-instrument">
                Trace the phase &amp; the sinking together
              </summary>
              <PhaseInstrument
                sinkingM={state.observation === "before" ? 0 : state.sinkingCm / 100}
                probeX={state.probeXM ?? 120}
                onProbe={(x) => setManual({ ...state, probeXM: x })}
                onDepth={(depth) =>
                  setManual({
                    ...state,
                    sinkingCm: depth * 100,
                    observation: "compare",
                  })
                }
              />
            </details>
        }
      />
      {manual && (
        <button
          className="es-follow-story"
          type="button"
          onClick={() => setManual(null)}
        >
          Follow the story
        </button>
      )}
    </div>
  );
}
