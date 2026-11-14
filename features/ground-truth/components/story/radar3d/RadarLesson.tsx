"use client";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEPTH_STOPS,
  MAX_SINKING_M,
  PHASE_STOPS,
  RADAR,
  RADAR_SITES,
  phaseColour,
  radarSample,
  radarSite,
  surfaceColour,
  type RadarColourMode,
  type RadarSiteId,
} from "@/lib/radar-interferometry";
import { useVisibleReplay } from "../useVisibleReplay";
import type {
  CameraAction,
  CameraPreset,
  Observation,
  RadarScene,
  RadarSceneLoader,
} from "./types";
import { useOptionalStory } from "../StoryProvider";
import { usePrefersReducedMotion } from "../../../lib/useTimeline";
import { useChapterPlayback } from "@/features/public-story/quest/useChapterPlayback";
import "./radar-lesson.css";

const loadScene: RadarSceneLoader = () => import("./createRadarScene");
const OBSERVATIONS: [Observation, string][] = [
  ["before", "Before · t₁"],
  ["after", "After · t₂"],
  ["compare", "Compare both"],
];
export type RadarModelState = {
  sinkingCm: number;
  observation: Observation;
  selectedSite: RadarSiteId;
  probeXM?: number;
};

export type RadarExperimentControl = {
  state: RadarModelState;
  change: (patch: Partial<RadarModelState>) => void;
  locked?: boolean;
  reset?: () => void;
  pulseToken?: number;
};

export function RadarLesson({
  className,
  ariaLabel,
  replayToken = 0,
  sceneLoader = loadScene,
  story = false,
  onModelChange,
  children,
  experiment,
}: {
  story?: boolean;
  className?: string;
  ariaLabel?: string;
  replayToken?: number;
  sceneLoader?: RadarSceneLoader;
  onModelChange?: (state: RadarModelState) => void;
  experiment?: RadarExperimentControl;
  children?: ReactNode;
}) {
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<RadarScene | null>(null);
  const [localSinking, setLocalSinking] = useState(18);
  const sinkingCm = experiment?.state.sinkingCm ?? localSinking;
  const setSinkingCm = (value: number) =>
    experiment
      ? experiment.change({ sinkingCm: value })
      : setLocalSinking(value);
  const [localObservation, setLocalObservation] =
    useState<Observation>("compare");
  const observation = experiment?.state.observation ?? localObservation;
  const setObservation = (value: Observation) =>
    experiment
      ? experiment.change({ observation: value })
      : setLocalObservation(value);
  const [interactive, setInteractive] = useState(false);
  const [localSite, setLocalSite] = useState<RadarSiteId>("centre");
  const selectedSite = experiment?.state.selectedSite ?? localSite;
  const setSelectedSite = (value: RadarSiteId) =>
    experiment
      ? experiment.change({ selectedSite: value })
      : setLocalSite(value);
  const probeXM = experiment?.state.probeXM;
  const [colourMode, setColourMode] = useState<RadarColourMode>("phase");
  const [cameraPreset, setCameraPreset] = useState<CameraPreset | "custom">(
    "reset",
  );
  const latestPreset = useRef<CameraPreset>("reset");
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const latest = useRef({
    sinkingM: 0.18,
    observation,
    interactive,
    selectedSite,
    colourMode,
    probeXM,
  });
  useEffect(() => {
    onModelChange?.({
      sinkingCm,
      observation,
      selectedSite,
      ...(probeXM !== undefined ? { probeXM } : {}),
    });
  }, [sinkingCm, observation, selectedSite, probeXM, onModelChange]);
  useEffect(() => {
    latest.current = {
      sinkingM: sinkingCm / 100,
      observation,
      interactive,
      selectedSite,
      colourMode,
      probeXM,
    };
    scene.current?.update(latest.current);
  }, [sinkingCm, observation, interactive, selectedSite, colourMode, probeXM]);

  // Closing a disclosure releases its GPU immediately, even before intersection
  // delivery. Returning rebuilds only this scene; the numeric model stays live.
  useEffect(() => {
    if (!host.current) return;
    let intersecting = false;
    const disclosures: HTMLDetailsElement[] = [];
    for (
      let parent = host.current.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (parent.tagName === "DETAILS")
        disclosures.push(parent as HTMLDetailsElement);
    }
    const sync = () => {
      const shown =
        intersecting &&
        document.visibilityState !== "hidden" &&
        disclosures.every((details) => details.open);
      if (!shown) setReady(false);
      setVisible(shown);
    };
    const observer =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            ([entry]) => {
              intersecting = entry.isIntersecting;
              sync();
            },
            { threshold: 0.01 },
          )
        : null;
    observer?.observe(host.current);
    // Older browsers without this observer initialize on disclosure visibility.
    if (!observer) {
      intersecting = true;
      sync();
    }
    document.addEventListener("visibilitychange", sync);
    disclosures.forEach((details) => details.addEventListener("toggle", sync));
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      disclosures.forEach((details) =>
        details.removeEventListener("toggle", sync),
      );
    };
  }, []);

  useEffect(() => {
    if (!visible || !canvas.current) return;
    const node = canvas.current;
    let dead = false;
    let active: RadarScene | null = null;
    let resize: ResizeObserver | null = null;
    const release = () => {
      resize?.disconnect();
      resize = null;
      active?.dispose();
      active = null;
      scene.current = null;
    };
    const lost = (event: Event) => {
      event.preventDefault();
      setReady(false);
      setError(
        "The 3D connection was lost. The slider, observations and readings still work.",
      );
      // A pending module load must not construct a scene after context loss.
      dead = true;
      release();
    };
    const restored = () => {
      setError(null);
      setRetry((value) => value + 1);
    };
    node.addEventListener("webglcontextlost", lost);
    node.addEventListener("webglcontextrestored", restored);
    const size = () => {
      const bounds = node.getBoundingClientRect();
      active?.resize(bounds.width, bounds.height);
    };
    sceneLoader()
      .then((module) => {
        if (dead) return;
        active = module.createRadarScene(node);
        scene.current = active;
        active.update(latest.current);
        if (typeof ResizeObserver !== "undefined") {
          resize = new ResizeObserver(size);
          resize.observe(node);
        }
        window.addEventListener("resize", size);
        size();
        active.view(latestPreset.current);
        setReady(true);
        setError(null);
      })
      .catch(() => {
        if (dead) return;
        release();
        setReady(false);
        setError(
          "3D is unavailable on this device. Use the slider and readings to explore the same lesson.",
        );
      });
    return () => {
      dead = true;
      node.removeEventListener("webglcontextlost", lost);
      node.removeEventListener("webglcontextrestored", restored);
      window.removeEventListener("resize", size);
      release();
    };
  }, [visible, retry, sceneLoader]);

  const reset = useCallback(() => {
    if (experiment?.reset) experiment.reset();
    else if (experiment)
      experiment.change({
        sinkingCm: 0,
        observation: "compare",
        selectedSite: "centre",
      });
    else {
      setLocalSinking(0);
      setLocalObservation("compare");
      setLocalSite("centre");
    }
    setInteractive(false);
    setColourMode("phase");
    setCameraPreset("reset");
    latestPreset.current = "reset";
    scene.current?.view("reset");
  }, [experiment]);
  useVisibleReplay(replayToken, visible, reset);
  const shownCm = observation === "before" ? 0 : sinkingCm;
  const site =
    probeXM !== undefined
      ? { label: "Your target", xM: probeXM, zM: 0 }
      : radarSite(selectedSite);
  const sample = radarSample(site.xM, site.zM, shownCm / 100);
  const colour = phaseColour(sample.cycles).map((value) =>
    Math.round(value * 255),
  );
  const surfaceRgb = surfaceColour(sample, colourMode).map((value) =>
    Math.round(value * 255),
  );
  const view = (action: CameraAction) => {
    const preset =
      action === "reset" || action === "top" || action === "profile";
    setCameraPreset(preset ? action : "custom");
    latestPreset.current = preset ? action : "reset";
    scene.current?.view(action);
  };
  const discovery =
    observation === "before" || sinkingCm === 0
      ? "Start with 18 cm of sinking, then follow the pins from centre to edge."
      : selectedSite === "edge"
        ? "The edge stays still. Compare its zero reading with the centre, even when phase hues match."
        : colourMode === "depth"
          ? "Follow the pale-to-deep ramp from edge to centre. Its 0–30 cm scale never changes."
          : selectedSite === "slope"
            ? "The slope sinks less than the centre. Switch to depth to separate movement from repeating phase hues."
            : "Raise centre sinking past 15 cm. The phase hue circles back; depth keeps increasing.";
  const usable = ready && visible && !error;
  const paused = useOptionalStory()?.paused ?? false,
    reduced = usePrefersReducedMotion();
  const {
    play: playPulse,
    playing: pulsePlaying,
    progress: pulseProgress,
  } = useChapterPlayback({
    enabled: usable,
    paused,
    reduced,
    visible,
    element: host,
  });
  const lastPulse = useRef(experiment?.pulseToken ?? 0);
  useEffect(() => {
    const token = experiment?.pulseToken ?? 0;
    if (token !== lastPulse.current) {
      lastPulse.current = token;
      if (token > 0 && usable) playPulse();
    }
  }, [experiment?.pulseToken, usable, playPulse]);
  useEffect(() => {
    scene.current?.signal?.(pulsePlaying ? pulseProgress : null);
  }, [pulseProgress, pulsePlaying]);
  return (
    <div
      ref={host}
      className={`es-radar-lesson ${className ?? ""}`}
      role="group"
      aria-label={ariaLabel ?? "Interactive repeat-pass radar and phase lesson"}
    >
      {!story && (
        <div className="es-radar-heading">
          <span>SYNTHETIC RADAR LAB</span>
          <span>Two times · one orbit position</span>
        </div>
      )}
      <div className="es-radar-scene-note">
        <strong>
          {cameraPreset === "profile"
            ? "Profile view · same 3D scene"
            : "t₁ + t₂ · same satellite position"}
        </strong>
        <span>Radar path schematic · distance compressed · sinking ×240</span>
        <span>
          Selected: {site.label} ·{" "}
          {colourMode === "phase" ? "wrapped phase" : "vertical sinking depth"}
        </span>
      </div>
      <div className="es-radar-stage">
        {/* A released/lost WebGL context must rebuild on a fresh canvas node. */}
        <canvas
          key={`${retry}-${visible ? "visible" : "hidden"}`}
          ref={canvas}
          aria-hidden="true"
          style={{
            pointerEvents: interactive && usable ? "auto" : "none",
            touchAction: interactive && usable ? "none" : "pan-y",
            visibility: usable ? "visible" : "hidden",
          }}
        />
        {experiment && (
          <button
            type="button"
            className="es-radar-quick-explore"
            aria-label={
              interactive ? "Finish orbiting the scene" : "Orbit the 3D scene"
            }
            aria-pressed={interactive}
            disabled={!usable}
            onClick={() => setInteractive(!interactive)}
          >
            {interactive ? "Finish exploring" : "Explore in 3D"}
          </button>
        )}
        {!usable && (
          <div className="es-radar-fallback" role="status">
            <strong>
              {error
                ? "Explore through the readings"
                : "A repeat visit reveals movement"}
            </strong>
            <p>
              {error ??
                (visible
                  ? "Preparing the 3D scene…"
                  : "The interactive scene loads when in view. The instrument controls remain available.")}
            </p>
            {error && (
              <button
                type="button"
                onClick={() => {
                  setReady(false);
                  setError(null);
                  setRetry((value) => value + 1);
                }}
              >
                Try 3D again
              </button>
            )}
          </div>
        )}
      </div>
      <div className="es-radar-ray-key" aria-hidden="true">
        <span>┄ t₁ reference ray</span>
        <span>━ t₂ repeat ray</span>
        <span>1 Centre · 2 Slope · 3 Stable edge</span>
      </div>
      <div className="es-radar-body">
        {children}
        <details
          className="ed-radar-instruments"
          open={experiment ? undefined : true}
        >
          <summary hidden={!experiment}>
            Instrument controls, readings &amp; model
          </summary>
          <div className="es-radar-explore-tools">
            <div>
              <span id={`${id}-samples`}>Sample the ground</span>
              <div
                className="es-radar-actions"
                role="group"
                aria-labelledby={`${id}-samples`}
              >
                {RADAR_SITES.map((site, index) => (
                  <button
                    key={site.id}
                    type="button"
                    aria-pressed={selectedSite === site.id}
                    onClick={() => setSelectedSite(site.id)}
                  >
                    <span aria-hidden="true">{index + 1} · </span>
                    {site.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span id={`${id}-colours`}>Surface colour</span>
              <div
                className="es-radar-actions"
                role="group"
                aria-labelledby={`${id}-colours`}
              >
                <button
                  type="button"
                  aria-pressed={colourMode === "phase"}
                  onClick={() => setColourMode("phase")}
                >
                  Wrapped phase
                </button>
                <button
                  type="button"
                  aria-pressed={colourMode === "depth"}
                  onClick={() => setColourMode("depth")}
                >
                  Sinking depth
                </button>
              </div>
            </div>
          </div>
          <div
            className="es-radar-observations"
            role="group"
            aria-label="Radar observation"
          >
            {OBSERVATIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={observation === value}
                onClick={() => setObservation(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="es-radar-description">
            {observation === "before"
              ? "t₁: the ground is flat. There is no movement relative to the reference observation."
              : observation === "after"
                ? `t₂: the bowl has sunk. Surface colours show ${colourMode === "phase" ? "wrapped phase difference from t₁" : "vertical sinking on a fixed 0–30 cm scale"}.`
                : "The wireframe marks t₁. The coloured bowl marks t₂. Both rays start at the same orbit position and follow your selected ground site."}
          </p>
          <label className="es-radar-slider" htmlFor={`${id}-sinking`}>
            <span>
              Centre sinking <strong>{Number(sinkingCm.toFixed(2))} cm</strong>
            </span>
            <input
              id={`${id}-sinking`}
              type="range"
              min={0}
              max={MAX_SINKING_M * 100}
              step={experiment?.locked && probeXM !== undefined ? "any" : 1}
              disabled={experiment?.locked}
              value={sinkingCm}
              aria-valuetext={`${sinkingCm} centimetres of vertical sinking at the centre`}
              onChange={(event) => setSinkingCm(Number(event.target.value))}
            />
            <span className="es-radar-slider-ends">
              <span>0 · no sinking</span>
              <span>30 cm</span>
            </span>
          </label>
          <div className="es-radar-actions">
            <button
              type="button"
              disabled={!usable}
              aria-pressed={interactive}
              onClick={() => setInteractive((value) => !value)}
            >
              {interactive ? "Finish exploring" : "Explore in 3D"}
            </button>
            <button
              type="button"
              disabled={!usable}
              aria-pressed={cameraPreset === "profile"}
              onClick={() =>
                view(cameraPreset === "profile" ? "reset" : "profile")
              }
            >
              Profile view
            </button>
            <button type="button" onClick={reset}>
              Reset / No sinking
            </button>
            <button
              type="button"
              disabled={experiment?.locked}
              onClick={() => {
                setSinkingCm(18);
                setObservation("compare");
              }}
            >
              Show 18 cm example
            </button>
          </div>
          <p className="es-radar-discovery">{discovery}</p>
          <dl
            className="es-radar-readings"
            aria-label={`Unexaggerated ${site.label.toLowerCase()} readings`}
          >
            <div>
              <dt>
                Local sinking · {site.label} ·{" "}
                {observation === "before" ? "t₁" : "t₂"}
              </dt>
              <dd>
                {(sample.downM * 100).toFixed(2)} <small>cm</small>
              </dd>
            </div>
            <div>
              <dt>Range change · away (+)</dt>
              <dd>
                +{(sample.deltaRangeM * 100).toFixed(2)} <small>cm</small>
              </dd>
            </div>
            <div>
              <dt>Total phase difference</dt>
              <dd>
                {sample.cycles.toFixed(2)} <small>cycles</small>
              </dd>
            </div>
            <div>
              <dt>Wrapped phase · {site.label}</dt>
              <dd>
                <span
                  className="es-radar-swatch"
                  aria-hidden="true"
                  style={{ backgroundColor: `rgb(${colour.join(",")})` }}
                />
                {(sample.wrappedCycles * 360).toFixed(0)}
                <small>°</small>
              </dd>
            </div>
          </dl>
          <div className="es-radar-phase-key" data-colour-mode={colourMode}>
            <span>
              {colourMode === "phase"
                ? "Wrapped phase · cyclic, repeats every full cycle"
                : "Vertical sinking depth · continuous, fixed scale"}
            </span>
            <div
              aria-hidden="true"
              style={{
                background: `linear-gradient(90deg, ${(colourMode === "phase" ? PHASE_STOPS : DEPTH_STOPS).join(",")})`,
              }}
            />
            <span className="es-radar-slider-ends">
              {colourMode === "phase" ? (
                <>
                  <span>0°</span>
                  <span>180°</span>
                  <span>360° = 0°</span>
                </>
              ) : (
                <>
                  <span>0 cm</span>
                  <span>15 cm</span>
                  <span>30 cm</span>
                </>
              )}
            </span>
            <p className="es-radar-selected-colour">
              <span
                className="es-radar-swatch"
                aria-hidden="true"
                style={{ backgroundColor: `rgb(${surfaceRgb.join(",")})` }}
              />
              {site.label}:{" "}
              {colourMode === "phase"
                ? `${(sample.wrappedCycles * 360).toFixed(0)}° wrapped phase`
                : `${(sample.downM * 100).toFixed(2)} cm vertical sinking`}
            </p>
          </div>
          <RadarTechnicalDetails story={story}>
            <p className="es-radar-explanation">
              One full phase colour cycle = 12 cm of{" "}
              <strong>line-of-sight range change</strong>. At 35° from vertical,
              that takes about 14.65 cm of vertical sinking. Zero movement gives
              one uniform phase colour; the unmoving outer edge stays at zero.
              Matching phase colours can differ by whole cycles. Depth colours
              show vertical sinking without wrapping.
            </p>
            <details className="es-radar-view">
              <summary>Move the view and read the model</summary>
              <div
                className="es-radar-actions"
                role="group"
                aria-label="3D camera controls"
              >
                <button
                  type="button"
                  disabled={!usable}
                  onClick={() => view("left")}
                >
                  Orbit left
                </button>
                <button
                  type="button"
                  disabled={!usable}
                  onClick={() => view("right")}
                >
                  Orbit right
                </button>
                <button
                  type="button"
                  disabled={!usable}
                  onClick={() => view("in")}
                >
                  Zoom in
                </button>
                <button
                  type="button"
                  disabled={!usable}
                  onClick={() => view("out")}
                >
                  Zoom out
                </button>
                <button
                  type="button"
                  disabled={!usable}
                  onClick={() => view("top")}
                >
                  Top view
                </button>
                <button
                  type="button"
                  disabled={!usable}
                  onClick={() => view("reset")}
                >
                  Reset view
                </button>
              </div>
              <p>
                Enable “Explore in 3D” to drag or pinch on the scene. Finish
                exploring to scroll over it. The buttons provide keyboard
                alternatives. Every change is a still state; nothing plays
                automatically.
              </p>
              <p>
                Fixed far-field approximation: ΔR = sinking × cos(35°), phase =
                4πΔR / λ, cycles = 2ΔR / λ. Positive means increasing range,
                away from radar; acquired products may use another sign
                convention. λ = {RADAR.wavelengthM} m (approximate L-band). Both
                observations use one ideal orbit position at 700 km altitude.
                The satellite distance is compressed and vertical movement is
                exaggerated ×240 for display only.
              </p>
            </details>
            <p className="es-radar-sources">
              Synthetic teaching scene, not acquired imagery or a measurement of
              Tehran. No atmosphere, noise or topographic phase is modelled.
              Principles:{" "}
              <a href="https://science.nasa.gov/mission/nisar/interferometry/">
                NASA NISAR interferometry
              </a>{" "}
              ·{" "}
              <a href="https://hyp3-docs.asf.alaska.edu/guides/insar_product_guide/">
                ASF InSAR product guide
              </a>
              .
            </p>
          </RadarTechnicalDetails>
        </details>
      </div>
    </div>
  );
}

function RadarTechnicalDetails({
  story,
  children,
}: {
  story: boolean;
  children: ReactNode;
}) {
  return story ? (
    <details className="es-radar-story-details">
      <summary>Read the model and full view controls</summary>
      <div>{children}</div>
    </details>
  ) : (
    <>{children}</>
  );
}
