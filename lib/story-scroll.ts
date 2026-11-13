/** Geometry for ordinary, reversible scrolling; never intercepts wheel or touch. */
export function storyReadingClearance(viewportHeight: number): number {
  // A compact phone still needs two readable lines below the visual. Keeping
  // a desktop-sized 144px reserve on an iPhone mini disabled otherwise useful pinning.
  return Math.min(144, Math.max(64, (viewportHeight - 500) / 2));
}

/** CSS small viewport excludes the retracting browser bars and stays stable during scrolling. */
export function storyViewportHeight(): number {
  const small = document
    .querySelector(".es-viewport-probe")
    ?.getBoundingClientRect().height;
  return small && Number.isFinite(small) ? small : window.innerHeight;
}

export function storySceneCanPin(
  stageHeight: number,
  viewportHeight: number,
  inset: number,
  reduced: boolean,
  clearance = storyReadingClearance(viewportHeight),
): boolean {
  // Leave room to actually read the next beat. Expanded controls, text zoom,
  // browser chrome and a landscape keyboard must never trap a tall scene.
  return (
    !reduced &&
    [stageHeight, viewportHeight, inset].every(Number.isFinite) &&
    stageHeight > 0 &&
    viewportHeight - inset - stageHeight >= clearance
  );
}

export function storyScrollProgress(
  top: number,
  height: number,
  stageHeight: number,
  inset: number,
): number {
  if (![top, height, stageHeight, inset].every(Number.isFinite)) return 0;
  const travel = Math.max(1, height - stageHeight);
  return Math.max(0, Math.min(1, (inset - top) / travel));
}

export function storyBeatIndex(progress: number, count: number): number {
  if (!Number.isFinite(progress) || !Number.isInteger(count) || count < 2)
    return 0;
  return Math.round(Math.max(0, Math.min(1, progress)) * (count - 1));
}

export function storySceneProgress(
  scroll: number,
  previous: number,
  paused: boolean,
  reduced: boolean,
): number {
  // Reduced motion retains a still; the scene's explicit controls remain available.
  return paused || reduced ? previous : Math.max(0, Math.min(1, scroll));
}

/** Expanded reading material must not count as permanent scene chrome. Only
 * outermost open disclosures count, so nested details are never subtracted twice. */
export function storyClosedHeight(panel: HTMLElement): number {
  let extra = 0;
  for (const details of panel.querySelectorAll<HTMLDetailsElement>(
    "details[open]",
  )) {
    if (details.parentElement?.closest("details[open]")) continue;
    const summary = details.querySelector<HTMLElement>(":scope > summary");
    if (summary && !summary.hidden)
      extra += Math.max(
        0,
        details.getBoundingClientRect().height -
          summary.getBoundingClientRect().height,
      );
  }
  return Math.max(
    0,
    (panel.offsetHeight || panel.getBoundingClientRect().height) - extra,
  );
}
