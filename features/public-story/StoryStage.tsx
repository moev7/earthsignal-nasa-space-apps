"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { useStory } from "@/features/ground-truth/components/story/StoryProvider";
import { usePrefersReducedMotion } from "@/features/ground-truth/lib/useTimeline";
import { useVisibleReplay } from "@/features/ground-truth/components/story/useVisibleReplay";
import { useChapterPlayback } from "./quest/useChapterPlayback";
import {
  storyBeatIndex,
  storySceneProgress,
  storyScrollProgress,
  storySceneCanPin,
  storyViewportHeight,
} from "@/lib/story-scroll";

export type StoryBeat = { title: string; body: ReactNode; label?: string };
export type StoryStageState = {
  progress: number;
  reducedMotion: boolean;
  paused: boolean;
};

export function SceneHelp({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <details className="es-scene-help">
      <summary aria-label={label}>
        <CircleHelp size={20} aria-hidden="true" />
        <span>{label}</span>
      </summary>
      <div>{children}</div>
    </details>
  );
}

export function StoryStage({
  id,
  title,
  description,
  evidence,
  beats,
  visual,
  appendix,
  stepped = false,
  kicker,
  challenge,
  animate = true,
}: {
  id: string;
  title: ReactNode;
  description: string;
  evidence: ReactNode;
  beats: StoryBeat[];
  visual: (state: StoryStageState) => ReactNode;
  appendix?: ReactNode;
  stepped?: boolean;
  kicker?: ReactNode;
  challenge?: ReactNode;
  animate?: boolean;
}) {
  const { paused, replayToken } = useStory();
  const reducedMotion = usePrefersReducedMotion();
  const grid = useRef<HTMLDivElement>(null),
    stage = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ progress: 0, beat: 0, visible: false });
  const [manualBeat, setManualBeat] = useState<number | null>(null);
  const [canPin, setCanPin] = useState(false);
  const playback = useChapterPlayback({
    enabled: stepped && animate,
    paused,
    reduced: reducedMotion,
    visible: state.visible,
    element: grid,
  });
  const activeBeat = stepped
    ? playback.progress === null
      ? (manualBeat ?? 0)
      : storyBeatIndex(playback.progress, beats.length)
    : state.beat;
  const sceneProgress = stepped
    ? (playback.progress ?? activeBeat / Math.max(1, beats.length - 1))
    : state.progress;
  const chooseBeat = (index: number) => {
    playback.clear();
    setManualBeat(index);
  };
  useEffect(() => {
    let frame = 0;
    const observedGrid = grid.current;
    const measure = () => {
      frame = 0;
      if (
        !grid.current ||
        !stage.current ||
        document.visibilityState === "hidden"
      )
        return;
      const bounds = grid.current.getBoundingClientRect();
      const headerHeight =
        document.querySelector(".es-header")?.getBoundingClientRect().height ??
        0;
      const inset =
        headerHeight > 0
          ? headerHeight + 12
          : Number.parseFloat(getComputedStyle(stage.current).top) || 120;
      const viewportHeight = storyViewportHeight();
      setCanPin(
        !stepped &&
          !stage.current.querySelector("details[open]") &&
          storySceneCanPin(
            stage.current.offsetHeight,
            viewportHeight,
            inset,
            reducedMotion,
          ),
      );
      const raw = storyScrollProgress(
        bounds.top,
        bounds.height,
        stage.current.offsetHeight,
        inset,
      );
      const visible = bounds.bottom > inset && bounds.top < window.innerHeight;
      setState((previous) => {
        const progress = stepped
          ? previous.progress
          : storySceneProgress(raw, previous.progress, paused, reducedMotion);
        const beat = stepped
          ? previous.beat
          : storyBeatIndex(raw, beats.length);
        return progress === previous.progress &&
          beat === previous.beat &&
          visible === previous.visible
          ? previous
          : { progress, beat, visible };
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    if (grid.current) observer?.observe(grid.current);
    if (stage.current) observer?.observe(stage.current);
    const header = document.querySelector(".es-header");
    if (header) observer?.observe(header);
    const viewportProbe = document.querySelector(".es-viewport-probe");
    if (viewportProbe) observer?.observe(viewportProbe);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    observedGrid?.addEventListener("toggle", schedule, true);
    window.addEventListener("hashchange", schedule);
    window.addEventListener("popstate", schedule);
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      observedGrid?.removeEventListener("toggle", schedule, true);
      window.removeEventListener("hashchange", schedule);
      window.removeEventListener("popstate", schedule);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [paused, reducedMotion, beats.length, stepped]);
  useVisibleReplay(replayToken, state.visible, () => {
    setState((previous) => ({ ...previous, progress: 0, beat: 0 }));
    setManualBeat(null);
    playback.clear();
    // Replaying changes the pose, never the reader's scroll position.
  });
  return (
    <section
      id={id}
      className={`es-scroll-act es-wrap${stepped ? " es-quest-stage" : ""}`}
      data-manual={
        manualBeat !== null || playback.progress !== null || undefined
      }
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
    >
      {kicker}
      <header className="es-act-heading">
        <h2 id={`${id}-title`}>{title}</h2>
        <p>{description}</p>
      </header>
      <div className="es-act-grid" ref={grid}>
        <div className="es-story-visual" ref={stage} data-pin={canPin}>
          <div className="es-story-object" key={replayToken}>
            {visual({ progress: sceneProgress, reducedMotion, paused })}
          </div>
          {stepped && animate && (
            <div className="es-chapter-playback">
              <button
                type="button"
                disabled={paused || reducedMotion || !state.visible}
                onClick={playback.play}
              >
                {playback.playing ? "Restart the change" : "Watch the change"}{" "}
                <span aria-hidden="true">▶</span>
              </button>
              {playback.playing && (
                <button type="button" onClick={playback.stop}>
                  Stop here
                </button>
              )}
              <span>One short illustration · or use the scene buttons</span>
            </div>
          )}
          {(paused || reducedMotion) && (
            <p className="es-story-motion-note">
              {reducedMotion
                ? "Reduced motion: explore the still states with the scene controls."
                : "Motion paused. You can keep reading or use the manual controls."}
            </p>
          )}
        </div>
        <div className="es-story-beats">
          {stepped && (
            <div
              className="es-beat-buttons"
              role="group"
              aria-label={`Scenes in ${id}`}
            >
              {beats.map((beat, index) => (
                <button
                  type="button"
                  key={beat.title}
                  aria-pressed={activeBeat === index}
                  aria-controls={`${id}-beat-${index}`}
                  onClick={() => chooseBeat(index)}
                >
                  0{index + 1} ·{" "}
                  {beat.label ??
                    (index === 0
                      ? "Before"
                      : index === beats.length - 1
                        ? "After"
                        : "Change")}
                </button>
              ))}
            </div>
          )}
          {beats.map((beat, index) => (
            <article
              key={beat.title}
              className="es-story-beat"
              id={`${id}-beat-${index}`}
              hidden={stepped && activeBeat !== index}
              data-current={activeBeat === index || undefined}
            >
              <div className="es-beat-marker" aria-hidden="true" />
              <h3>{beat.title}</h3>
              {beat.body}
            </article>
          ))}
          {stepped && (
            <div className="es-beat-navigation">
              <button
                type="button"
                disabled={activeBeat === 0}
                onClick={() => chooseBeat(activeBeat - 1)}
              >
                ← Back
              </button>
              <span>
                Scene {activeBeat + 1} of {beats.length}
              </span>
              <button
                type="button"
                disabled={activeBeat === beats.length - 1}
                onClick={() => chooseBeat(activeBeat + 1)}
              >
                What happens next? →
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="es-story-evidence">{evidence}</div>
      {challenge}
      {appendix && <div className="es-act-appendix">{appendix}</div>}
    </section>
  );
}
