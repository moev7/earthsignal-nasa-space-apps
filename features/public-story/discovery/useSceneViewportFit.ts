"use client";
import { useEffect, useRef } from "react";
import { storyReadingClearance, storyViewportHeight } from "@/lib/story-scroll";

/** Leave reading clearance after *all* caption/control chrome. */
export function sceneCanvasBudget(
  viewport: number,
  header: number,
  chrome: number,
  preferred: number,
) {
  if (![viewport, header, chrome, preferred].every(Number.isFinite)) return 160;
  return Math.max(
    160,
    Math.min(
      preferred,
      viewport - header - 12 - storyReadingClearance(viewport) - chrome - 8,
    ),
  );
}

export function useSceneViewportFit(
  stageSelector: string,
  heightProperty: string,
  smallRatio = 0.45,
  largeRatio = smallRatio,
) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let frame = 0;
    const fit = () => {
      frame = 0;
      const stage = node.querySelector<HTMLElement>(stageSelector);
      const panel = node.closest<HTMLElement>(".es-story-visual");
      if (!stage || !panel) return;
      const viewport = storyViewportHeight();
      const header =
        document.querySelector(".es-header")?.getBoundingClientRect().height ??
        116;
      const chrome = Math.max(
        0,
        panel.getBoundingClientRect().height -
          stage.getBoundingClientRect().height,
      );
      const budget = Math.floor(
        sceneCanvasBudget(
          viewport,
          header,
          chrome,
          Math.min(
            440,
            viewport * (window.innerWidth <= 760 ? smallRatio : largeRatio),
          ),
        ),
      );
      // No state/flow rule depends on data-pin. A stable chrome measurement
      // gives one stable size, rather than pin/unpin changing its own budget.
      const next = `${budget}px`;
      if (node.style.getPropertyValue(heightProperty) !== next)
        node.style.setProperty(heightProperty, next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(fit);
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    observer?.observe(node);
    const panel = node.closest(".es-story-visual");
    if (panel) observer?.observe(panel);
    const header = document.querySelector(".es-header");
    if (header) observer?.observe(header);
    const viewportProbe = document.querySelector(".es-viewport-probe");
    if (viewportProbe) observer?.observe(viewportProbe);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    node.addEventListener("toggle", schedule, true);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      node.removeEventListener("toggle", schedule, true);
    };
  }, [stageSelector, heightProperty, smallRatio, largeRatio]);
  return host;
}
