"use client";
import { useEffect, useRef } from "react";
import type { Assessment } from "@/lib/observatory-contract";
import { QUESTION_LABELS } from "@/lib/observatory-contract";

/** The recorded result stays identified while the investigation draft is edited. */
export function AssessmentNavigator({
  assessment,
  draftAligned,
  restore,
}: {
  assessment: Assessment;
  draftAligned: boolean;
  restore: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = ref.current,
      content = bar?.closest<HTMLElement>(".decision-content");
    if (!bar || !content) return;
    const update = () =>
      content.style.setProperty(
        "--assessment-nav-offset",
        `${Math.ceil(bar.getBoundingClientRect().height) + 24}px`,
      );
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(bar);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      content.style.removeProperty("--assessment-nav-offset");
    };
  }, []);
  return (
    <div ref={ref} className="assessment-navigator">
      <div className="recorded-context">
        <div>
          <span className="area-caption">
            Saved result · {assessment.domain}
          </span>
          <strong>{QUESTION_LABELS[assessment.question]}</strong>
          <small>
            {assessment.time.start} → {assessment.time.end}
          </small>
        </div>
        {!draftAligned && (
          <div className="recorded-draft-status" role="status">
            <span>
              Draft changed. This evidence keeps its recorded area and dates.
            </span>
            <button type="button" onClick={restore}>
              Restore result selection
            </button>
          </div>
        )}
      </div>
      <nav aria-label="Navigate recorded assessment">
        <a href="#environmental-change-story">In simple terms</a>
        <a href="#decision-map">Area</a>
        <a href="#assessment-analysis">Measurements & history</a>
        <a href="#assessment-options">Compare options</a>
        <a href="#assessment-provenance">Sources & exports</a>
      </nav>
    </div>
  );
}
