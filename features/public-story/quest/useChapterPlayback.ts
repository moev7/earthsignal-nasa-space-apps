"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/** One requested, bounded chapter transition. Cancellation is authoritative even
 * for a callback already dequeued by the browser. No clock runs while idle. */
export function useChapterPlayback({
  enabled,
  paused,
  reduced,
  visible,
  element,
}: {
  enabled: boolean;
  paused: boolean;
  reduced: boolean;
  visible: boolean;
  element: RefObject<HTMLElement | null>;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const frame = useRef<number | null>(null),
    generation = useRef(0),
    permitted = useRef(false);
  const invalidate = useCallback(() => {
    generation.current++;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  const stop = useCallback(() => {
    invalidate();
    setPlaying(false);
  }, [invalidate]);
  const clear = useCallback(() => {
    stop();
    setProgress(null);
  }, [stop]);
  useLayoutEffect(() => {
    permitted.current = enabled && visible && !paused && !reduced;
    let active = true;
    if (!permitted.current) {
      invalidate();
      queueMicrotask(() => {
        if (active) setPlaying(false);
      });
    }
    return () => {
      active = false;
      permitted.current = false;
      invalidate();
    };
  }, [enabled, visible, paused, reduced, invalidate]);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") stop();
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            if (!entry.isIntersecting) stop();
          });
    if (element.current) observer?.observe(element.current);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", hidden);
      invalidate();
    };
  }, [element, stop, invalidate]);
  const play = useCallback(() => {
    invalidate();
    if (!permitted.current || document.visibilityState === "hidden") return;
    const token = generation.current;
    let start: number | null = null,
      last = -Infinity;
    setPlaying(true);
    setProgress(0);
    const tick = (time: number) => {
      if (token !== generation.current || !permitted.current) return;
      frame.current = null;
      const bounds = element.current?.getBoundingClientRect();
      if (
        document.visibilityState === "hidden" ||
        !bounds ||
        bounds.bottom <= 0 ||
        bounds.top >= window.innerHeight
      ) {
        stop();
        return;
      }
      if (start === null) start = time;
      const next = Math.min(1, Math.max(0, (time - start) / 2200));
      if (next === 1 || time - last >= 1000 / 30) {
        last = time;
        setProgress(next);
      }
      if (token !== generation.current || !permitted.current) return;
      if (next < 1) frame.current = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    frame.current = requestAnimationFrame(tick);
  }, [element, invalidate, stop]);
  return { progress, playing, play, stop, clear };
}
