"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { ContextNote } from "../ContextNote";
import { ArrowUp, RotateCcw } from "lucide-react";
import {
  loadPublicRadarStudy,
  radarCellAt,
  radarPoint,
  radarRegionStats,
  RADAR_STUDY_BASE,
  type RadarCell,
  type RadarRegion,
  type RadarStudy,
} from "@/lib/public-radar-study";
import {
  publicStudyExploreHref,
  publicStudyWorkspaceHref,
} from "@/lib/public-study-context";
import {
  formatRadarDb,
  moveRadarCell,
  selectionRegion,
  validSelection,
  type RadarMode,
  type RadarSelection,
} from "./controls";
import "./radar-study.css";
import { FieldPartner } from "../discovery/FieldPartner";
import { directEcho } from "@/lib/echo-director";
import { useFieldTelemetry } from "../quest/GameDirector";

export type RadarInspection = {
  row: number;
  column: number;
  differenceDb: number | null;
};
type Props = {
  selection?: RadarCell | RadarRegion | null;
  onInspect?: (point: RadarInspection) => void;
  initialMode?: RadarMode;
};
type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; study: RadarStudy };
const MODES: { value: RadarMode; label: string }[] = [
  { value: "compare", label: "Compare" },
  { value: "before", label: "Before" },
  { value: "after", label: "After" },
  { value: "difference", label: "Difference" },
];
const date = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
const count = (value: number) => value.toLocaleString("en-US");

export function PublicRadarStudy({ selection, onInspect, initialMode }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let loaded: RadarStudy | undefined;
    loadPublicRadarStudy(controller.signal)
      .then((study) => {
        if (!active) {
          study.dispose();
          return;
        }
        loaded = study;
        setState({ status: "ready", study });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
      controller.abort();
      loaded?.dispose();
    };
  }, [attempt]);
  const retry = () => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  };
  return (
    <section
      className="es-radar-study"
      aria-label="Lake Mead measured radar study"
    >
      <div className="es-radar-study-heading">
        <p>Lake Mead, Nevada · Measured NISAR GCOV · Provisional</p>
      </div>
      {state.status === "loading" ? (
        <div className="es-radar-study-message" role="status">
          <h3>Checking the observations…</h3>
          <p>
            The native images and values appear after their integrity checks.
          </p>
        </div>
      ) : state.status === "error" ? (
        <LoadError retry={retry} />
      ) : (
        <VerifiedStudy
          key={`${attempt}-${JSON.stringify(selection ?? null)}`}
          study={state.study}
          selection={selection}
          retry={retry}
          onInspect={onInspect}
          initialMode={initialMode}
        />
      )}
    </section>
  );
}

function LoadError({ retry }: { retry: () => void }) {
  return (
    <div className="es-radar-study-message" role="alert">
      <h3>The radar study could not be displayed.</h3>
      <p>
        A file could not be loaded, verified or decoded. Reload the checked
        study to try again.
      </p>
      <button type="button" onClick={retry}>
        <RotateCcw size={18} aria-hidden="true" />
        Retry radar study
      </button>
      <p>
        These observations measure backscatter in dB. They do not establish
        flooding, damage or ground movement.
      </p>
    </div>
  );
}

function VerifiedStudy({
  study,
  selection,
  retry,
  onInspect,
  initialMode,
}: {
  study: RadarStudy;
  selection?: RadarSelection | null;
  retry: () => void;
  onInspect?: (point: RadarInspection) => void;
  initialMode?: RadarMode;
}) {
  const { source } = study.manifest;
  const { width, height } = study.values;
  const [mode, setMode] = useState<RadarMode>(initialMode ?? "compare");
  const [swipe, setSwipe] = useState(50);
  const [selected, setSelected] = useState<RadarSelection | null>(() =>
    validSelection(selection, width, height),
  );
  const [imageError, setImageError] = useState(false);
  const id = useId();
  const cell = selected && "row" in selected ? selected : null;
  const region = selected ? selectionRegion(selected) : null;
  const point = cell ? radarPoint(study, cell) : null;
  const regionStats =
    selected && !("row" in selected) ? radarRegionStats(study, selected) : null;
  const before = date(source.before.acquiredAt),
    after = date(source.after.acquiredAt);
  const failImage = () => setImageError(true);
  const telemetry =
    cell && point
      ? {
          kind: "backscatter" as const,
          ...cell,
          differenceDb: point.differenceDb,
        }
      : null;
  useFieldTelemetry(telemetry);
  const selectedRow = cell?.row,
    selectedColumn = cell?.column,
    selectedDifference = point?.differenceDb;
  useEffect(() => {
    if (
      selectedRow !== undefined &&
      selectedColumn !== undefined &&
      selectedDifference !== undefined &&
      !imageError
    )
      onInspect?.({
        row: selectedRow,
        column: selectedColumn,
        differenceDb: selectedDifference,
      });
  }, [selectedRow, selectedColumn, selectedDifference, imageError, onInspect]);
  if (imageError) return <LoadError retry={retry} />;
  return (
    <>
      <p className="ex-study-hook">
        <strong>{source.stats.medianDb.toFixed(3)} dB</strong> · median HH echo
        change across this checked crop. A weaker echo is a clue to investigate,
        not a measurement of water depth.
      </p>
      <div className="es-radar-study-dates">
        <span>
          Before <time dateTime={source.before.acquiredAt}>{before}</time>
        </span>
        <span>
          After <time dateTime={source.after.acquiredAt}>{after}</time>
        </span>
      </div>
      <div
        className="es-radar-study-modes"
        role="group"
        aria-label="Radar display mode"
      >
        {MODES.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={mode === item.value}
            onClick={() => setMode(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="es-radar-study-layout">
        <figure className="es-radar-study-figure">
          <div
            className="es-radar-study-stage"
            style={{ aspectRatio: `${width} / ${height}` }}
            tabIndex={0}
            role="group"
            aria-label="Native radar grid, select a measurement cell"
            aria-describedby={`${id}-grid-help`}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (!bounds.width || !bounds.height) return;
              const next = radarCellAt(
                (event.clientX - bounds.left) / bounds.width,
                (event.clientY - bounds.top) / bounds.height,
                width,
                height,
              );
              if (next) setSelected(next);
            }}
            onKeyDown={(event) => {
              const origin =
                cell ??
                (region
                  ? { row: region.top, column: region.left }
                  : {
                      row: Math.floor(height / 2),
                      column: Math.floor(width / 2),
                    });
              const next = moveRadarCell(origin, event.key, width, height);
              if (next) {
                event.preventDefault();
                setSelected(next);
              }
            }}
          >
            {/* Verified Blob URLs only; nearest-neighbour enlargement preserves native cells. */}
            {/* eslint-disable @next/next/no-img-element */}
            <img
              src={mode === "compare" ? study.images.after : study.images[mode]}
              width={width}
              height={height}
              draggable={false}
              alt={
                mode === "compare"
                  ? `After image, ${after}; use the comparison slider to reveal the before image.`
                  : `${mode === "difference" ? "HH backscatter difference, after minus before" : `${mode === "before" ? before : after} HH backscatter`}. Native ${width} by ${height} cell crop near Lake Mead.`
              }
              onError={failImage}
            />
            {mode === "compare" && (
              <img
                className="es-radar-study-before"
                src={study.images.before}
                width={width}
                height={height}
                draggable={false}
                alt=""
                aria-hidden="true"
                style={{ clipPath: `inset(0 ${100 - swipe}% 0 0)` }}
                onError={failImage}
              />
            )}
            <img
              className="es-radar-study-excluded"
              src={study.images.excluded}
              width={width}
              height={height}
              draggable={false}
              alt=""
              aria-hidden="true"
              onError={failImage}
            />
            {/* eslint-enable @next/next/no-img-element */}
            {mode === "compare" && (
              <span
                className="es-radar-study-divider"
                aria-hidden="true"
                style={{ left: `${swipe}%` }}
              />
            )}
            {region && (
              <span
                className={`es-radar-study-selection${cell ? " es-radar-study-cell" : ""}`}
                aria-hidden="true"
                style={{
                  left: `${(region.left / width) * 100}%`,
                  top: `${(region.top / height) * 100}%`,
                  width: `${((region.right - region.left + 1) / width) * 100}%`,
                  height: `${((region.bottom - region.top + 1) / height) * 100}%`,
                }}
              />
            )}
            <span className="es-radar-study-north" aria-hidden="true">
              <ArrowUp size={16} />
              Grid north
            </span>
            <span className="es-radar-study-image-label" aria-hidden="true">
              {mode === "compare"
                ? "Before / After"
                : MODES.find((item) => item.value === mode)?.label}
            </span>
          </div>
          {mode === "compare" && (
            <div className="es-radar-study-swipe">
              <label htmlFor={`${id}-swipe`}>
                Reveal before image <output>{swipe}%</output>
              </label>
              <input
                id={`${id}-swipe`}
                type="range"
                min={0}
                max={100}
                step={1}
                value={swipe}
                aria-valuetext={`${swipe}% before, ${100 - swipe}% after`}
                onChange={(event) => setSwipe(Number(event.target.value))}
              />
              <div>
                <span>{before}</span>
                <span>{after}</span>
              </div>
            </div>
          )}
          <RadarLegend mode={mode} study={study} />
          <figcaption id={`${id}-grid-help`}>
            Select a cell to inspect it. Arrow keys also work on the image.
          </figcaption>
        </figure>
        <div className="es-radar-study-reading">
          <div className="es-radar-study-intro">
            <h3>What changed in the radar return?</h3>
            <p>
              Slide between dates. Choose Difference to reveal the change.
            </p>
            <p>
              <strong>Backscatter change, in dB.</strong> Not ground motion or water depth.
            </p>
          </div>
          <p className="es-radar-study-coverage">
            <strong>
              {source.coverage.commonValidPercent.toFixed(1)}% common coverage
            </strong>
            <br />Orange cells are excluded, not zero change.
          </p>
          <ContextNote label="Coverage &amp; interpretation">
            <p>Native {source.crop.resolution[0]} m grid · {width} × {height} cells · enlarged without interpolation. Scroll normally on touch screens.</p>
            <p>{count(source.coverage.commonValidPixels)} of {count(source.coverage.totalPixels)} native cells · {source.coverage.validAreaKm2.toFixed(4)} km² valid area.</p>
            <p>Speckle, moisture, vegetation, roughness and acquisition conditions can change the signal. These two observations do not establish sinking, flooding or damage.</p>
          </ContextNote>
          <div
            className="es-radar-study-inspection"
            aria-live="polite"
            aria-atomic="true"
          >
            <h3>
              {cell
                ? `Cell ${cell.row + 1}, ${cell.column + 1}`
                : regionStats
                  ? "Selected area"
                  : "Look closer"}
            </h3>
            {point ? (
              <>
                <p className="es-radar-study-caption">
                  Native row {cell!.row + 1}, column {cell!.column + 1} · one{" "}
                  {source.crop.resolution[0]} m cell
                </p>
                <dl>
                  <div>
                    <dt>Before</dt>
                    <dd>{formatRadarDb(point.beforeDb)}</dd>
                  </div>
                  <div>
                    <dt>After</dt>
                    <dd>{formatRadarDb(point.afterDb)}</dd>
                  </div>
                  <div>
                    <dt>After − before</dt>
                    <dd>{formatRadarDb(point.differenceDb, true)}</dd>
                  </div>
                </dl>
                {point.differenceDb === null && (
                  <p>
                    This cell is outside the common validity mask. No change can
                    be measured here.
                  </p>
                )}
              </>
            ) : regionStats ? (
              <>
                <p>
                  Rows {region!.top + 1}–{region!.bottom + 1}, columns{" "}
                  {region!.left + 1}–{region!.right + 1}
                </p>
                <dl>
                  <div>
                    <dt>Valid / selected cells</dt>
                    <dd>
                      {count(regionStats.valid)} / {count(regionStats.total)}
                    </dd>
                  </div>
                  <div>
                    <dt>Median change</dt>
                    <dd>{formatRadarDb(regionStats.medianDb, true)}</dd>
                  </div>
                  <div>
                    <dt>Minimum / maximum</dt>
                    <dd>
                      {formatRadarDb(regionStats.minDb, true)} /{" "}
                      {formatRadarDb(regionStats.maxDb, true)}
                    </dd>
                  </div>
                  <div>
                    <dt>Valid area</dt>
                    <dd>{regionStats.areaKm2.toFixed(4)} km²</dd>
                  </div>
                </dl>
                {regionStats.valid === 0 && (
                  <p>
                    This area has no common valid cells. No change can be
                    measured here.
                  </p>
                )}
              </>
            ) : (
              <p>
                Select a cell in the image, or use the native row and column
                controls below. An area selection summarizes only its common
                valid cells.
              </p>
            )}
          </div>
          {telemetry && (
            <FieldPartner
              found={false}
              hint="Select Difference and probe neighbouring cells. Their unit remains dB; the ground-motion record is a separate study."
              reading={directEcho(telemetry)}
            >
              <></>
            </FieldPartner>
          )}
          <details className="es-radar-study-disclosure">
            <summary>Choose a cell or an area by number</summary>
            <div>
              <p>
                Rows run top to bottom; columns run left to right. Display
                numbers start at 1. Area boundaries include both end cells.
              </p>
              <SelectionForm
                key={`cell-${JSON.stringify(selected)}`}
                kind="cell"
                width={width}
                height={height}
                selection={selected}
                onSelect={setSelected}
              />
              <SelectionForm
                key={`region-${JSON.stringify(selected)}`}
                kind="region"
                width={width}
                height={height}
                selection={selected}
                onSelect={setSelected}
              />
              {selected && (
                <button type="button" onClick={() => setSelected(null)}>
                  Clear selection
                </button>
              )}
            </div>
          </details>
          <div className="es-radar-study-handoff">
            <a
              className="es-radar-study-primary"
              href={publicStudyWorkspaceHref(selected)}
              onClick={(event) => {
                if (
                  event.button === 0 &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.shiftKey &&
                  !event.altKey
                ) {
                  // Browser Back should restore the selected study, not its initial empty view.
                  window.history.replaceState(
                    window.history.state,
                    "",
                    publicStudyExploreHref(selected),
                  );
                }
              }}
            >
              Investigate this {selected ? "selection" : "study"}
            </a>
            <p>
              Open a draft in advanced tools with this public study and
              selection. No analysis starts automatically.
            </p>
            <a href={publicStudyExploreHref(selected)}>
              Link to this {selected ? "selection" : "study"}
            </a>
          </div>
        </div>
      </div>
      <details className="es-radar-study-disclosure es-radar-study-method">
        <summary>Source, measurement method &amp; limits</summary>
        <div>
          <p>
            NISAR L-band GCOV, HH polarization · provisional collection ·
            NASA/JPL-Caltech and ISRO · ASF DAAC. Grid: {source.crop.crs}. The
            preview uses the original scientific colour scales on the native
            crop; it is not a geographic basemap.
          </p>
          <dl>
            <div>
              <dt>Dates (UTC)</dt>
              <dd>
                {before} → {after}
              </dd>
            </div>
            <div>
              <dt>Method</dt>
              <dd>
                10 log₁₀(after gamma0 / before gamma0), on the common valid
                native pixels.
              </dd>
            </div>
            <div>
              <dt>Whole-study median change</dt>
              <dd>{formatRadarDb(source.stats.medianDb, true)}</dd>
            </div>
            <div>
              <dt>Whole-study 5th–95th percentiles</dt>
              <dd>
                {formatRadarDb(source.stats.p05Db, true)} to{" "}
                {formatRadarDb(source.stats.p95Db, true)}
              </dd>
            </div>
            <div>
              <dt>Mask policy</dt>
              <dd>{source.processing.maskPolicy}</dd>
            </div>
          </dl>
          <p>{study.manifest.presentation.notice}</p>
          <p>
            GCOV backscatter (dB) and GUNW ground motion (mm/year) are different
            quantities. This crop has no displacement or flood classification.
            Provisional calibration can change; no uncertainty estimate is
            supplied for these differences.
          </p>
          <div className="es-radar-study-source-links">
            <a href={`${RADAR_STUDY_BASE}manifest.json`}>
              Public source manifest
            </a>
            <a href={`${RADAR_STUDY_BASE}verification.json`}>
              Verification receipt
            </a>
            <a href={`${RADAR_STUDY_BASE}difference.tif`}>
              Native difference GeoTIFF
            </a>
            <a href={`${RADAR_STUDY_BASE}validity.tif`}>
              Native validity GeoTIFF
            </a>
          </div>
        </div>
      </details>
    </>
  );
}

function RadarLegend({ mode, study }: { mode: RadarMode; study: RadarStudy }) {
  const { display } = study.manifest.source;
  const difference = mode === "difference";
  return (
    <div
      className="es-radar-study-legend"
      aria-label={
        difference
          ? "After minus before backscatter scale in decibels"
          : "Shared before and after backscatter scale in decibels"
      }
    >
      <div
        className={`es-radar-study-ramp${difference ? " es-radar-study-ramp-difference" : ""}`}
      />
      <div className="es-radar-study-legend-labels">
        <span>
          {formatRadarDb(
            difference ? -display.differenceLimitDb : display.backscatterMinDb,
          )}
        </span>
        {difference && <span>0</span>}
        <span>
          {formatRadarDb(
            difference ? display.differenceLimitDb : display.backscatterMaxDb,
            difference,
          )}
        </span>
      </div>
      <p>
        {difference
          ? "After − before (dB). Blue: weaker return · Red: stronger return. Colours clip at the scale ends; inspection shows the measured values."
          : "Darker: weaker return · Lighter: stronger return. Both dates share this display stretch."}{" "}
        <span className="es-radar-study-excluded-key" /> Orange: excluded.
      </p>
    </div>
  );
}

function SelectionForm({
  kind,
  width,
  height,
  selection,
  onSelect,
}: {
  kind: "cell" | "region";
  width: number;
  height: number;
  selection: RadarSelection | null;
  onSelect: (selection: RadarSelection) => void;
}) {
  const id = useId(),
    [error, setError] = useState("");
  const bounds = selection
    ? selectionRegion(selection)
    : { left: 0, top: 0, right: width - 1, bottom: height - 1 };
  const fields =
    kind === "cell"
      ? [
          { name: "row", label: "Row", value: bounds.top, max: height },
          { name: "column", label: "Column", value: bounds.left, max: width },
        ]
      : [
          { name: "top", label: "First row", value: bounds.top, max: height },
          {
            name: "bottom",
            label: "Last row",
            value: bounds.bottom,
            max: height,
          },
          {
            name: "left",
            label: "First column",
            value: bounds.left,
            max: width,
          },
          {
            name: "right",
            label: "Last column",
            value: bounds.right,
            max: width,
          },
        ];
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      value = (name: string) => Number(form.get(name)) - 1;
    const next =
      kind === "cell"
        ? { row: value("row"), column: value("column") }
        : {
            top: value("top"),
            bottom: value("bottom"),
            left: value("left"),
            right: value("right"),
          };
    if (!validSelection(next, width, height)) {
      setError(
        "Choose whole cells inside the grid, with the first row and column no greater than the last.",
      );
      return;
    }
    setError("");
    onSelect(next);
  };
  return (
    <form
      className="es-radar-study-selection-form"
      aria-label={
        kind === "cell" ? "Inspect a native cell" : "Inspect a native area"
      }
      onSubmit={submit}
    >
      <fieldset>
        <legend>{kind === "cell" ? "One cell" : "An area"}</legend>
        <div>
          {fields.map((field) => (
            <label key={field.name} htmlFor={`${id}-${field.name}`}>
              {field.label}
              <input
                id={`${id}-${field.name}`}
                name={field.name}
                type="number"
                required
                min={1}
                max={field.max}
                step={1}
                defaultValue={field.value + 1}
                aria-describedby={error ? `${id}-error` : undefined}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <button type="submit">Inspect {kind === "cell" ? "cell" : "area"}</button>
      {error && (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export default PublicRadarStudy;
