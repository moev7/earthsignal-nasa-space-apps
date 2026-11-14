"use client";
import { useState } from "react";
import type { InspectionCandidate, InspectionWindows } from "@/lib/inspection-contract";

export function RadarInspection({ inspection, onInspect }: {
  inspection?: InspectionWindows;
  onInspect?: (candidate: InspectionCandidate) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const candidates = inspection?.candidates.slice(0, showAll ? undefined : 3) ?? [];
  return <section className="radar-inspection" aria-label="Radar inspection locations">
    <h4>Where to inspect next</h4>
    {!inspection ? <p>Inspection locations are unavailable for this analysis. The recorded measurements and pixel tools remain available.</p> : <>
      <p>Look more closely at native image windows with pixels beyond the recorded ±{inspection.thresholdDb} dB cutoff. This is an unvalidated inspection aid. A stronger radar difference does not establish water change, damage or danger.</p>
      <p>{inspection.validPixels.toLocaleString()} of {inspection.selectedPixels.toLocaleString()} selected pixels are usable on both dates; {inspection.unknownPixels.toLocaleString()} remain unknown.</p>
      {inspection.status === "withheld_no_valid_support" ? <p role="status">No usable pixels in this selection. Inspection locations are withheld; this is not evidence of no change.</p> : inspection.status === "no_threshold_candidates" ? <p role="status">No usable pixels exceed this cutoff. Changes below the cutoff and changes in unknown areas remain unresolved.</p> : <>
        <p>Showing {candidates.length} of {inspection.candidateWindows.toLocaleString()} candidate windows{inspection.omittedWindows ? `; ${inspection.omittedWindows.toLocaleString()} are omitted from this bounded list` : ""}. Order: most pixels beyond the cutoff, then strongest absolute difference, then native grid order.</p>
        <ol className="inspection-candidates">
          {candidates.map((candidate, index) => {
            const { representative: point, window: window } = candidate;
            return <li key={`${window.rowStart}:${window.columnStart}`}>
              <h5>Window {index + 1} · {(candidate.increasedPixels + candidate.decreasedPixels).toLocaleString()} pixels beyond the cutoff</h5>
              <dl>
                <div><dt>Brighter / fainter</dt><dd>{candidate.increasedPixels.toLocaleString()} / {candidate.decreasedPixels.toLocaleString()} pixels</dd></div>
                <div><dt>Area beyond the cutoff</dt><dd>{candidate.exceededAreaKm2.toLocaleString(undefined, { maximumSignificantDigits: 5 })} km² of nominal projected cell footprints</dd></div>
                <div><dt>Usable support</dt><dd>{candidate.validPixels.toLocaleString()} / {candidate.selectedPixels.toLocaleString()} selected pixels ({candidate.validPercent.toFixed(1)}%); {candidate.unknownPixels.toLocaleString()} unknown</dd></div>
                <div><dt>Representative pixel</dt><dd>Row {point.row}, column {point.column} · {point.differenceDb > 0 ? "+" : ""}{point.differenceDb.toFixed(3)} dB</dd></div>
                <div><dt>Location (latitude, longitude)</dt><dd>{point.coordinate ? `${point.coordinate[1].toFixed(6)}, ${point.coordinate[0].toFixed(6)} (rounded for display)` : "Coordinate transformation unavailable"}</dd></div>
              </dl>
              {onInspect && <button type="button" disabled={!point.coordinate} onClick={() => onInspect(candidate)}>Locate and inspect window {index + 1}</button>}
            </li>;
          })}
        </ol>
        {inspection.candidates.length > 3 && <button className="inspection-expand" type="button" aria-expanded={showAll} onClick={() => setShowAll(previous => !previous)}>{showAll ? "Show first 3 windows" : `Show ${inspection.candidates.length - 3} more loaded windows`}</button>}
      </>}
      <p><strong>What to check next:</strong> compare before, after and excluded-pixel layers at each location. Look for shoreline or vegetation patterns and acquisition artifacts, then seek compatible, dated independent observations before assigning a cause.</p>
      <details><summary>How locations are chosen</summary>
        <p>Windows contain up to {inspection.blockSizePixels} × {inspection.blockSizePixels} native cells, anchored at the crop origin. They are browsing groups, not detected objects or measured event boundaries. Within each window, the representative is the usable selected pixel with the largest absolute difference; ties use native row and column order.</p>
        <p>Only pixels inside the recorded selection and usable on both dates contribute. The list uses the recorded cutoff, not an unapplied slider setting. It does not estimate significance, confidence, field accuracy or inspection benefit. Full policy, window counts, exact coordinates and source context are included in the analysis exports.</p>
        <ul>{inspection.limitations.map((text, i) => <li key={i}>{text}</li>)}</ul>
      </details>
    </>}
  </section>;
}
