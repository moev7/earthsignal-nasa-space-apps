"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { PublicStudy } from "@/lib/public-study-registry";
import type { PublishedSar } from "@/lib/public-sar-study";
import {
  cellFromImagePoint,
  compareNativeSamples,
  createInvestigationBrief,
  INSPECTION_NEXT_CHECKS,
  inspectionGuidance,
  inspectionInputIssue,
  nativeProbe,
  nativeRowCsv,
  nativeRowProfile,
  profileY,
  type NativeCell,
  type NativeProbe,
  type NextCheckId,
} from "@/lib/sar-inspection";
import "./study-inspection.css";

type Props = {
  study: PublicStudy;
  manifest: PublishedSar;
  values: readonly (number | null)[];
  imageUrl: string;
};
const exact = (value: number | null) =>
  value === null ? "No valid measurement (null)" : String(value);

/** Root owns verified loading and must key this component by study ID + revision. */
export function StudyInspection(props: Props) {
  const issue = useMemo(
    () => inspectionInputIssue(props.study, props.manifest, props.values),
    [props.study, props.manifest, props.values],
  );
  return issue ? (
    <section className="study-inspection" role="alert">
      <h2>Native inspection unavailable</h2>
      <p>{issue}</p>
    </section>
  ) : (
    <VerifiedInspection {...props} />
  );
}

function VerifiedInspection({ study, manifest: m, values, imageUrl }: Props) {
  const id = useId();
  const [cell, setCell] = useState<NativeCell>({ row: 0, column: 0 });
  const [a, setA] = useState<NativeCell | null>(null),
    [b, setB] = useState<NativeCell | null>(null);
  const [note, setNote] = useState("");
  const [nextCheck, setNextCheck] = useState<NextCheckId | "">("");
  const [downloadStatus, setDownloadStatus] = useState("");
  const [imageError, setImageError] = useState(false);
  const downloads = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const active = downloads.current;
    return () => {
      for (const [url, timer] of active) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      active.clear();
    };
  }, []);
  const selected = nativeProbe(m, values, cell);
  const probeA = a && nativeProbe(m, values, a),
    probeB = b && nativeProbe(m, values, b);
  const pinMarkers =
    a && b && a.row === b.row && a.column === b.column
      ? [{ label: "A/B", cell: a }]
      : [
          { label: "A", cell: a },
          { label: "B", cell: b },
        ];
  const comparison = useMemo(
    () => compareNativeSamples(study, m, values, a, b),
    [study, m, values, a, b],
  );
  const profile = useMemo(
    () => nativeRowProfile(m, values, cell.row),
    [m, values, cell.row],
  );
  const guidance = inspectionGuidance(m);
  const check = INSPECTION_NEXT_CHECKS.find((c) => c.id === nextCheck);
  const sourcePixel = /SOURCE_PIXEL_GRID/i.test(m.grid.crs);
  const selectCoordinate = (name: "row" | "column", raw: string) => {
    if (!raw.trim()) return;
    const n = Number(raw),
      limit = name === "row" ? m.grid.height : m.grid.width;
    if (Number.isInteger(n) && n >= 0 && n < limit)
      setCell((current) => ({ ...current, [name]: n }));
  };
  const download = (kind: "brief" | "row") => {
    // A new request releases any prior pending URL; each remaining timer is also released on unmount.
    for (const [url, timer] of downloads.current) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    downloads.current.clear();
    let url: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    try {
      const content =
        kind === "brief"
          ? JSON.stringify(
              createInvestigationBrief(study, m, values, a, b, note, nextCheck),
              null,
              2,
            )
          : nativeRowCsv(m, values, cell.row);
      url = URL.createObjectURL(
        new Blob([content], {
          type:
            kind === "brief"
              ? "application/json;charset=utf-8"
              : "text/csv;charset=utf-8",
        }),
      );
      anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${study.id}-${study.revision}-${kind === "brief" ? "investigation.json" : `row-${cell.row}.csv`}`;
      document.body.appendChild(anchor);
      anchor.click();
      const downloadedUrl = url;
      downloads.current.set(
        url,
        setTimeout(() => {
          URL.revokeObjectURL(downloadedUrl);
          downloads.current.delete(downloadedUrl);
        }, 1000),
      );
      setDownloadStatus(
        `${kind === "brief" ? "Investigation brief" : "Native row CSV"} download requested. Nothing was uploaded; the browser controls saving.`,
      );
    } catch {
      if (url) URL.revokeObjectURL(url);
      setDownloadStatus(
        "Download could not be created. Your selection and note remain here; try again.",
      );
    } finally {
      anchor?.remove();
    }
  };
  const position = (probe: NativeProbe) =>
    probe.nativeCentre
      ? `${probe.nativeCentre.x}, ${probe.nativeCentre.y}`
      : "Withheld: affine centre exceeds finite numeric range";
  const x = (column: number) =>
    20 + (m.grid.width === 1 ? 0.5 : column / (m.grid.width - 1)) * 600;
  const chartDescription = `Native row ${cell.row}: ${profile.valid} valid and ${profile.missing} missing samples. Horizontal axis is zero-based native column, not geographic distance; vertical axis is ${m.quantity} in ${m.unit}. ${profile.thinned ? `Display thinning shows ${profile.displayPoints} original valid samples at at most 512 selected columns; small features may be omitted. No analytical resampling.` : "All valid native samples in this row are shown."} Lines never cross missing samples, including gaps between thinned columns. Use the visible Row and Column inputs to read exact values, or download the full native row CSV.`;
  return (
    <section className="study-inspection" aria-labelledby={`${id}-question`}>
      <header className="study-inspection-intro">
        <h2 id={`${id}-question`}>{guidance.question}</h2>
        <p>
          Choose a place, pin A, then choose another and pin B. Read the numbers
          alongside the original native image.
        </p>
        <p>
          <strong>
            {m.sourceId} · {m.channel} · {m.quantity} ({m.unit})
          </strong>
        </p>
        <ul
          className="study-inspection-acquisitions"
          aria-label="Source acquisitions"
        >
          {m.records.map((r) => (
            <li key={r.id}>
              Acquisition: {r.acquiredAt ?? "Date not supplied"}
              {r.endAt && ` to ${r.endAt}`} · {r.product} · {r.maturity}
            </li>
          ))}
        </ul>
        <p>
          Study maturity: {study.maturity}. Valid support: {m.coverage.valid} of{" "}
          {m.coverage.total} native cells ({m.coverage.fraction * 100}%). Valid
          support is not a confidence score.
        </p>
      </header>

      <figure className="study-inspection-scene">
        <div
          className="study-inspection-image-wrap"
          style={{
            width: `min(100%, ${(65 * m.grid.width) / m.grid.height}vh)`,
          }}
        >
          <Image
            className="study-inspection-image"
            unoptimized
            src={imageUrl}
            width={m.grid.width}
            height={m.grid.height}
            alt={`Original ${m.sourceId} native ${m.quantity} preview, ${m.grid.width} columns by ${m.grid.height} rows. Use the Row and Column controls below for exact values.`}
            onError={() => setImageError(true)}
            onClick={(event) => {
              const chosen = cellFromImagePoint(
                m.grid,
                event.currentTarget.getBoundingClientRect(),
                event.clientX,
                event.clientY,
              );
              if (chosen) setCell(chosen);
            }}
          />
          <span
            className="study-inspection-cursor"
            aria-hidden="true"
            style={{
              left: `${((cell.column + 0.5) / m.grid.width) * 100}%`,
              top: `${((cell.row + 0.5) / m.grid.height) * 100}%`,
            }}
          />
          {pinMarkers.map(
            (pin) =>
              pin.cell && (
                <span
                  key={pin.label}
                  className="study-inspection-pin"
                  aria-hidden="true"
                  style={{
                    left: `${((pin.cell.column + 0.5) / m.grid.width) * 100}%`,
                    top: `${((pin.cell.row + 0.5) / m.grid.height) * 100}%`,
                    transform: `translate(${pin.cell.column < m.grid.width / 2 ? "0" : "-100%"}, ${pin.cell.row < m.grid.height / 2 ? "0" : "-100%"})`,
                  }}
                >
                  {pin.label}
                </span>
              ),
          )}
        </div>
        <figcaption>
          Original verified preview · {m.grid.width} × {m.grid.height} native
          cells. Display stretch only; brightness does not identify water or
          damage. Outlined selection and lettered pins are overlays.
        </figcaption>
        {imageError && (
          <p role="alert">
            The preview could not be displayed. Continue with the native Row and
            Column controls and numeric profile below.
          </p>
        )}
      </figure>

      <section
        className="study-inspection-probe"
        aria-labelledby={`${id}-sample`}
      >
        <h3 id={`${id}-sample`}>Inspect and pin native cells</h3>
        <p id={`${id}-coordinates-help`}>
          Row and column start at zero. Type a number or use the input’s arrow
          keys.{" "}
          {sourcePixel
            ? "Source-pixel centres are not latitude or longitude; this window is not geocoded."
            : "Centres are in the declared native CRS, without geographic conversion."}
        </p>
        <div className="study-inspection-controls">
          <label htmlFor={`${id}-row`}>
            Row
            <input
              id={`${id}-row`}
              type="number"
              min={0}
              max={m.grid.height - 1}
              step={1}
              value={cell.row}
              aria-describedby={`${id}-coordinates-help`}
              onChange={(e) => selectCoordinate("row", e.target.value)}
            />
          </label>
          <label htmlFor={`${id}-column`}>
            Column
            <input
              id={`${id}-column`}
              type="number"
              min={0}
              max={m.grid.width - 1}
              step={1}
              value={cell.column}
              aria-describedby={`${id}-coordinates-help`}
              onChange={(e) => selectCoordinate("column", e.target.value)}
            />
          </label>
          <button type="button" onClick={() => setA({ ...cell })}>
            Pin A
          </button>
          <button type="button" onClick={() => setB({ ...cell })}>
            Pin B
          </button>
          <button
            type="button"
            disabled={!a && !b}
            onClick={() => {
              setA(null);
              setB(null);
            }}
          >
            Clear comparison
          </button>
        </div>
        <output
          className="study-inspection-reading"
          aria-live="polite"
          aria-atomic="true"
        >
          Row {cell.row}, column {cell.column}: {exact(selected.value)}
          {selected.value !== null && ` ${m.unit}`}
        </output>
        <p>Native centre (x, y): {position(selected)}.</p>
        <details>
          <summary>Native CRS and coordinate convention</summary>
          <p>
            <code>{m.grid.crs}</code>
          </p>
          <p>
            Centre = affine transform at (column + 0.5, row + 0.5). Transform:{" "}
            <code>{JSON.stringify(m.grid.transform)}</code>. No geographic
            distance is computed.
          </p>
        </details>
        <dl className="study-inspection-pins" aria-label="Pinned measurements">
          {(
            [
              { label: "A", probe: probeA },
              { label: "B", probe: probeB },
            ] as const
          ).map(({ label, probe }) => (
            <div key={label}>
              <dt>Pin {label}</dt>
              <dd>
                {probe ? (
                  <>
                    Row {probe.row}, column {probe.column}: {exact(probe.value)}
                    {probe.value !== null && ` ${m.unit}`}
                    <br />
                    Native centre: {position(probe)}
                  </>
                ) : (
                  "Not selected"
                )}
              </dd>
            </div>
          ))}
        </dl>
        <div
          className="study-inspection-comparison"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <h3>{comparison.label}</h3>
          <p>
            {comparison.delta === null ? (
              "Contrast withheld."
            ) : (
              <>
                B − A ={" "}
                <strong>
                  {String(comparison.delta)} {comparison.unit}
                </strong>
                .
              </>
            )}{" "}
            {comparison.reason}
          </p>
          {comparison.powerRatio !== null && (
            <p>
              Backscatter power B/A:{" "}
              <strong>{String(comparison.powerRatio)}</strong> (dimensionless).
            </p>
          )}
          <p>{comparison.ratioReason}</p>
        </div>
      </section>

      <section
        className="study-inspection-profile"
        aria-labelledby={`${id}-profile-title`}
      >
        <h3 id={`${id}-profile-title`}>Follow native row {cell.row}</h3>
        <p>
          Read across the selected row in {m.unit}. Change Row or Column above
          for an exact keyboard probe.
        </p>
        <svg
          viewBox="0 0 640 180"
          role="img"
          aria-labelledby={`${id}-profile-label ${id}-profile-description`}
        >
          <title id={`${id}-profile-label`}>
            Native row {cell.row} profile in {m.unit}
          </title>
          <desc id={`${id}-profile-description`}>{chartDescription}</desc>
          <path className="study-inspection-axis" d="M20 20V170H620" />
          {profile.min !== null &&
            profile.max !== null &&
            profile.segments.map((segment, i) => (
              <g key={i}>
                <polyline
                  className="study-inspection-trace"
                  points={segment
                    .map(
                      (p) =>
                        `${x(p.column)},${profileY(p.value!, profile.min!, profile.max!)}`,
                    )
                    .join(" ")}
                />
                {segment.length === 1 && (
                  <circle
                    className="study-inspection-dot"
                    cx={x(segment[0].column)}
                    cy={profileY(segment[0].value!, profile.min!, profile.max!)}
                    r="2.5"
                  />
                )}
              </g>
            ))}
          <path
            className="study-inspection-probe-line"
            d={`M${x(cell.column)} 20V170`}
          />
          {selected.value !== null &&
            profile.min !== null &&
            profile.max !== null && (
              <circle
                className="study-inspection-dot"
                cx={x(cell.column)}
                cy={profileY(selected.value, profile.min, profile.max)}
                r="4"
              />
            )}
        </svg>
        <div className="study-inspection-profile-axis" aria-hidden="true">
          <span>Column 0</span>
          <span>Column {m.grid.width - 1}</span>
        </div>
        <p>
          {profile.valid === 0
            ? "This row has no valid measurements; no trace is drawn."
            : `Full-row range: ${profile.min} to ${profile.max} ${m.unit}.`}{" "}
          {profile.missing} missing samples; lines never cross null gaps.
        </p>
        <p>
          {profile.thinned
            ? `Display thinning: ${profile.displayPoints} original valid samples at at most 512 selected columns. Small features may be omitted; no analytical resampling. The numeric probe and CSV retain every native sample.`
            : "Every valid sample in this row is displayed; no analytical resampling."}
        </p>
        <button type="button" onClick={() => download("row")}>
          Download native row CSV
        </button>
      </section>

      <section
        className="study-inspection-meaning"
        aria-labelledby={`${id}-meaning`}
      >
        <h3 id={`${id}-meaning`}>What is observed, and what remains open</h3>
        <p>{guidance.observed}</p>
        <p>{guidance.notDetermined}</p>
        <p>
          Missing cells have no valid measurement. The published array does not
          supply a per-pixel exclusion reason.
        </p>
        <details>
          <summary>Source support and limitations</summary>
          <p>{study.notice}</p>
          <ul>
            {m.notices.map((notice, index) => (
              <li key={index}>{notice}</li>
            ))}
          </ul>
          <ul>
            {m.records.map((r) => (
              <li key={r.id}>
                {r.product} · {r.maturity}: {r.notice}
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section
        className="study-inspection-brief"
        aria-labelledby={`${id}-brief`}
      >
        <h3 id={`${id}-brief`}>Keep a local investigation brief</h3>
        <p>
          Capture the exact measurements and a question to investigate next.
          Your note is user authored and unverified; it does not change
          scientific evidence.
        </p>
        <label htmlFor={`${id}-note`}>
          My interpretation / hypothesis (unverified)
          <textarea
            id={`${id}-note`}
            rows={4}
            maxLength={4000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What pattern do you notice, and what could you check?"
          />
        </label>
        <label htmlFor={`${id}-check`}>
          Proposed next check
          <select
            id={`${id}-check`}
            value={nextCheck}
            onChange={(e) => setNextCheck(e.target.value as NextCheckId | "")}
          >
            <option value="">Choose a next check (optional)</option>
            {INSPECTION_NEXT_CHECKS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <p>
          {check
            ? `Why: ${check.why}`
            : "No follow-up selected. A downloaded brief can include missing or unselected pins explicitly."}
        </p>
        <p>
          Revision <code>{study.revision}</code> · manifest SHA-256{" "}
          <code>{study.manifestSha256}</code>. The JSON includes original
          unrounded pin values, dates, units, native positions, support, caveats
          and your labelled note. A proposed check is not a completed
          investigation.
        </p>
        <button
          type="button"
          className="study-inspection-download"
          onClick={() => download("brief")}
        >
          Download investigation JSON
        </button>
        <p>
          No upload, automatic saving or cloud analysis. Notes and pins reset
          when you open another study; save a download if you want to keep them.
        </p>
        <p role="status" aria-live="polite">
          {downloadStatus}
        </p>
      </section>
    </section>
  );
}
