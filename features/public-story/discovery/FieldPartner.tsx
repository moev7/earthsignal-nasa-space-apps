"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Eye,
  EyeOff,
  Sparkles,
  AudioLines,
  Square,
} from "lucide-react";
import { EchoPortrait } from "../quest/GameArt";
import { useOptionalStory } from "@/features/ground-truth/components/story/StoryProvider";
import { usePrefersReducedMotion } from "@/features/ground-truth/lib/useTimeline";
import { useMissionGuide } from "../quest/MissionGuide";
import { FOUND_VOICE } from "@/lib/mission-guide";
import catalog from "@/lib/echo-voice.json";
import { useDiscoverySound } from "./DiscoverySound";
import type { EchoReading } from "@/lib/echo-director";

/** Authored model-state feedback, not an AI chat or a repeated idle hint loop. */
export function FieldPartner({
  children,
  hint,
  found,
  reading,
}: {
  children?: ReactNode;
  hint: string;
  found: boolean;
  reading?: EchoReading;
}) {
  const missionGuide = useMissionGuide();
  const guide =
    reading &&
    (reading.id.startsWith("backscatter") || reading.id.startsWith("footprint"))
      ? null
      : missionGuide;
  const { speak, stopVoice, voiceState } = useDiscoverySound();
  const voiceCue = guide
    ? guide.complete || found
      ? FOUND_VOICE[guide.id]
      : guide.step.voice
    : null;
  const targetSelector =
    guide && !guide.complete && !found
      ? guide.id === "evidence" && reading?.id === "ground-measured"
        ? '[data-affordance="find-gap"]'
        : guide.step.target
      : reading?.target;
  const reactionKey = `${guide?.id ?? "reading"}:${guide?.index ?? 0}:${reading?.id ?? String(children)}`;
  const host = useRef<HTMLElement>(null),
    show = useRef<HTMLButtonElement>(null),
    hide = useRef<HTMLButtonElement>(null);
  const [quiet, setQuiet] = useState(false),
    [help, setHelp] = useState(false),
    [nudge, setNudge] = useState(false),
    [visible, setVisible] = useState(false);
  const paused = useOptionalStory()?.paused ?? true,
    reduced = usePrefersReducedMotion();
  const offered = useRef(new Set<string>()),
    highlight = useRef<HTMLElement | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHighlight = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    highlight.current?.removeAttribute("data-coach-focus");
    highlight.current = null;
  };
  useEffect(() => {
    const node = host.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (
      quiet ||
      paused ||
      reduced ||
      !visible ||
      found ||
      offered.current.has(reactionKey) ||
      document.visibilityState === "hidden"
    )
      return;
    const world = host.current?.closest(
      "[data-discovery],.es-radar-study,.es-atlas",
    );
    const key = reactionKey;
    let idle: ReturnType<typeof setTimeout>;
    let idleEpoch = 0;
    const offer = () => {
      if (document.visibilityState === "hidden" || offered.current.has(key))
        return;
      offered.current.add(key);
      setNudge(true);
      const target = world?.querySelector<HTMLElement>(
        targetSelector || 'input[type="range"]',
      );
      if (target && !paused && !reduced) {
        clearHighlight();
        target.setAttribute("data-coach-focus", "true");
        highlight.current = target;
        timer.current = setTimeout(clearHighlight, 1400);
      }
    };
    const arm = () => {
      clearTimeout(idle);
      const ticket = ++idleEpoch;
      idle = setTimeout(() => {
        if (ticket === idleEpoch) offer();
      }, 12000);
    };
    const interacted = () => {
      setNudge(false);
      clearHighlight();
      arm();
    };
    world?.addEventListener("pointerdown", interacted);
    world?.addEventListener("keydown", interacted);
    arm();
    const hidden = () => {
      if (document.visibilityState === "hidden") {
        idleEpoch++;
        clearTimeout(idle);
        clearHighlight();
        setNudge(false);
      } else arm();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      idleEpoch++;
      clearTimeout(idle);
      world?.removeEventListener("pointerdown", interacted);
      world?.removeEventListener("keydown", interacted);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [
    quiet,
    paused,
    reduced,
    visible,
    found,
    reading?.id,
    targetSelector,
    children,
    reactionKey,
  ]);
  useEffect(() => {
    if (paused || reduced || !visible) clearHighlight();
    return clearHighlight;
  }, [paused, reduced, visible]);
  useEffect(() => {
    stopVoice();
  }, [voiceCue, reading?.id, stopVoice]);
  useEffect(() => {
    if (!visible || quiet || paused) stopVoice();
  }, [visible, quiet, paused, stopVoice]);
  useEffect(() => () => stopVoice(), [stopVoice]);
  const point = () => {
    setHelp(true);
    setNudge(false);
    offered.current.add(reactionKey);
    clearHighlight();
    const world = host.current?.closest(
        "[data-discovery],.es-radar-study,.es-atlas",
      ),
      id = world?.getAttribute("data-discovery");
    const candidates =
      id === "aquifer"
        ? ['[data-affordance="water"]']
        : id === "uneven"
          ? ['input[aria-label="West block sinking"]']
          : id === "radar"
            ? [
                '[data-affordance="capture"]:not(:disabled)',
                'input[aria-label="Move the ground between visits"]:not(:disabled)',
                '[data-affordance="compare"]:not(:disabled)',
                'input[aria-label="Combine the saved echoes"]',
              ]
            : id === "evidence"
              ? [".ed-map-image", '[data-affordance="ground-map"]']
              : world?.querySelector(
                    '[data-route-key="limits"][aria-pressed="true"], [data-route-key="supply"][aria-pressed="true"]',
                  )
                ? ['[data-route-key="monitor"]', '[data-affordance="route"]']
                : ['[data-route-key="limits"]'];
    const readyRepeat =
      guide?.id === "radar" && guide.index === 1
        ? world?.querySelector<HTMLElement>(
            '[data-affordance="capture"]:not(:disabled)',
          )
        : null;
    const target =
      readyRepeat ??
      (targetSelector
        ? world?.querySelector<HTMLElement>(targetSelector)
        : null) ??
      candidates
        .map((selector) => world?.querySelector<HTMLElement>(selector))
        .find(Boolean);
    if (target) {
      for (
        let ancestor = target.parentElement;
        ancestor && ancestor !== world;
        ancestor = ancestor.parentElement
      ) {
        if (ancestor.tagName === "DETAILS")
          (ancestor as HTMLDetailsElement).open = true;
      }
    }
    target?.focus({ preventScroll: true });
    if (target) {
      target.scrollIntoView({ block: "nearest", behavior: "instant" });
      if (!paused && !reduced) {
        target.setAttribute("data-coach-focus", "true");
        highlight.current = target;
        timer.current = setTimeout(clearHighlight, 1400);
      }
    }
  };
  return (
    <aside
      ref={host}
      className={`ed-echo ea-partner${quiet ? " ea-partner-quiet" : ""}`}
      aria-label="Echo, your field partner"
      data-found={found}
      data-expanded={help}
      data-reaction={reading?.id}
    >
      {quiet ? (
        <button
          ref={show}
          type="button"
          onClick={() => {
            setQuiet(false);
            queueMicrotask(() => hide.current?.focus());
          }}
        >
          <EchoPortrait />
          <span>Bring Echo back</span>
          <Eye size={16} />
        </button>
      ) : (
        <>
          <EchoPortrait
            mood={found ? "found" : help ? "thinking" : "curious"}
          />
          <div>
            <span className="ea-partner-eyebrow">
              {found ? "Echo · discovery made" : "Echo · your field partner"}
            </span>
            {reading && (
              <small className="ex-echo-stamp">{reading.stamp}</small>
            )}
            <p
              key={typeof children === "string" ? children : undefined}
              role="status"
              aria-atomic="true"
            >
              {guide && !guide.complete && !found
                ? guide.id === "evidence" && reading?.id === "ground-measured"
                  ? "That patch has a reading. Now choose Find gap. Is missing the same as zero?"
                  : guide.step.instruction
                : guide && (found || guide.complete)
                  ? catalog.cues[FOUND_VOICE[guide.id]]
                  : (reading?.text ?? children)}
            </p>
            {help && <p className="ed-hint">{hint}</p>}
            {guide && reading && help && (
              <p className="play-observed">{reading.text}</p>
            )}
            {voiceCue &&
              (voiceState === "speaking" || voiceState === "loading") && (
                <p className="play-voice-caption">{catalog.cues[voiceCue]}</p>
              )}
            {voiceState === "unavailable" && (
              <small role="status">
                Voice is unavailable here. You can still read every clue.
              </small>
            )}
            {nudge && (
              <p className="ea-partner-offer">Need a nudge? Try “Show me”.</p>
            )}
            <div className="ea-partner-actions">
              <button type="button" onClick={point}>
                <Sparkles size={15} />
                {help ? "Point it out" : "Show me"}
                <ArrowUpRight size={14} />
              </button>
              <button
                type="button"
                aria-expanded={help}
                aria-label={help ? "Less" : "A little more"}
                title={help ? "Less context" : "Why does this happen?"}
                onClick={() => setHelp(!help)}
              >
                <span aria-hidden="true">{help ? "−" : "?"}</span>
              </button>
              {voiceCue && (
                <button
                  type="button"
                  aria-label={
                    voiceState === "speaking" || voiceState === "loading"
                      ? "Stop Echo voice"
                      : "Listen to Echo"
                  }
                  title="Kokoro neural voice · generated on our server"
                  onClick={() =>
                    voiceState === "speaking" || voiceState === "loading"
                      ? stopVoice()
                      : speak(voiceCue)
                  }
                >
                  {voiceState === "speaking" || voiceState === "loading" ? (
                    <Square size={16} />
                  ) : (
                    <AudioLines size={16} />
                  )}
                  <span>
                    {voiceState === "loading"
                      ? "Preparing"
                      : voiceState === "speaking"
                        ? "Stop"
                        : "Listen"}
                  </span>
                </button>
              )}
              <button
                ref={hide}
                type="button"
                aria-label="Quiet Echo"
                onClick={() => {
                  clearHighlight();
                  setQuiet(true);
                  queueMicrotask(() => show.current?.focus());
                }}
              >
                <EyeOff size={16} />
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
