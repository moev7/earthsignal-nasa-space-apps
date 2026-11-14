"use client";
import { publicStudyArea, publicStudySelectionLabel, PUBLIC_RADAR_STUDY, type PublicStudyContext } from "@/lib/public-study-context";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { WorkspaceSelect } from "@/components/ui/workspace-select";
import { displayMeasurement } from "@/lib/display-units";
import {
  Leaf,
  Flame,
  Droplets,
  Building2,
  Download,
  MapPin,
  RefreshCw,
  Orbit,
  Satellite,
  Info,
} from "lucide-react";
import { GeoMap } from "@/features/catalog/geo-map";
import { REGIONS, type CatalogQuery } from "@/features/catalog/domain";
import {
  areaSchema,
  assessmentRequestSchema,
  DOMAINS,
  QUESTIONS,
  QUESTION_LABELS,
  assessmentArtifactUrl,
  type Assessment,
  type AssessmentArea,
  type AssessmentJob,
} from "@/lib/observatory-contract";
import { useAssessments, type Snapshot } from "./use-assessments";
import { draftMatches, sourceSettingsMatch } from "@/lib/assessment-insights";
import { AssessmentOverview } from "./assessment-overview";
import { AssessmentNavigator } from "./assessment-navigator";
import { AssessmentComparison } from "./assessment-comparison";
import { PhotoPlace } from "./photo-place";
import { photoStudyArea, type PhotoPoint } from "@/lib/photo-discovery";
import { StudyRectangleEditor } from "./study-rectangle-editor";
import { EvidenceBrief } from "./evidence-brief";
import { PublicAssistant } from "./public-assistant";
import { ScenarioPanel } from "./scenario-panel";
import { RasterComparison } from "./raster-comparison";
import { HistoryInsights, GaugeEvaluation } from "./history-insights";
import type { ChangeJob } from "@/lib/radar-contract";
import {
  environmentalStory,
  radarAssessmentArea,
} from "@/lib/environmental-story";
import { gaugeForecastTarget } from "@/lib/forecast-benefit";
import { EnvironmentalStory } from "./environmental-story";
import "./decisions.css";
import "./forecast-benefit.css";
import "./environmental-story.css";
import { assessmentSearchEntries, type SearchNavigation, type WorkspaceSearchEntry } from "@/features/science/workspace-search";
import { currentSearchEpoch, focusSearchTarget } from "@/features/science/search-navigation";

const PRESETS = {
  water: {
    label: "Water",
    icon: Droplets,
    question: "Water coverage and flow at measuring stations.",
  },
  fire: {
    label: "Fire",
    icon: Flame,
    question: "Reported fires, hot spots and changes after a fire.",
  },
  ecology: {
    label: "Plants & forests",
    icon: Leaf,
    question: "Changes in vegetation, moisture and recovery.",
  },
  urban: {
    label: "Cities & heat",
    icon: Building2,
    question: "Ground temperature, land cover and places to compare.",
  },
};
const FRIENDLY_QUESTIONS: Record<
  (typeof QUESTIONS)[number],
  { label: string; help: string }
> = {
  change: {
    label: "What has changed?",
    help: "Compare available observations. The result explains which changes were actually measured.",
  },
  seasonal: {
    label: "Is this different from the usual season?",
    help: "Compare with the same time in earlier years, when enough history is available.",
  },
  explain: {
    label: "What might explain the change?",
    help: "Examine possible explanations and the evidence needed to tell them apart.",
  },
  exposure: {
    label: "What places could be affected?",
    help: "Check the available location evidence. Confirming effects needs reliable boundaries and information about nearby places.",
  },
  future: {
    label: "What could happen next?",
    help: "Check whether the available records support a forecast. Missing history or unreliable forecasts are clearly marked.",
  },
  options: {
    label: "Which options could we compare?",
    help: "Explore options under assumptions you choose. Their real-world benefits are not measured by this comparison.",
  },
};
const JOB_LABELS: Record<string, string> = {
  queued: "Waiting to start",
  running: "Checking the data",
  completed: "Ready to read",
  failed: "Could not finish",
  cancelled: "Cancelled",
};

const pilotPlaces = [
  { id: "mead", label: "Lake Mead pilot", point: [-114.75, 36.06] },
  { id: "delta", label: "Sacramento Delta pilot", point: [-121.61, 38.12] },
  {
    id: "paradise",
    label: "Paradise / Camp Fire pilot",
    point: [-121.62, 39.76],
  },
  { id: "phoenix", label: "Phoenix pilot", point: [-112.07, 33.45] },
  ...Object.entries(REGIONS)
    .filter(
      ([id, r]) => !["mead", "sacramento", "global"].includes(id) && r.point,
    )
    .map(([id, r]) => ({
      id,
      label: r.label,
      point: r.point as readonly number[],
    })),
];
export function boxArea(
  w: number,
  s: number,
  e: number,
  n: number,
): AssessmentArea {
  return {
    type: "Polygon",
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  };
}
function near(point: readonly number[]) {
  return boxArea(
    point[0] - 0.015,
    point[1] - 0.015,
    point[0] + 0.015,
    point[1] + 0.015,
  );
}
function bounds(area: AssessmentArea): [[number, number], [number, number]] {
  const ps =
    area.type === "Polygon"
      ? area.coordinates.flat()
      : area.coordinates.flat(2);
  const lats = ps.map((p) => p[1]),
    lons = ps.map((p) => p[0]);
  // An antimeridian AOI is displayed in the closest unwrapped longitude branch.
  const wrapped =
    Math.max(...lons) - Math.min(...lons) > 180
      ? lons.map((v) => (v < 0 ? v + 360 : v))
      : lons;
  return [
    [Math.min(...lats), Math.min(...wrapped)],
    [Math.max(...lats), Math.max(...wrapped)],
  ];
}
function downloadable(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function MeasurementTable({ assessment }: { assessment: Assessment }) {
  const [metric, setMetric] = useState(false);
  return (
    <>
      <label className="check-label">
        <input
          type="checkbox"
          checked={metric}
          onChange={(e) => setMetric(e.target.checked)}
        />
        Display metric units (source quantities and datums stay unchanged in
        exports)
      </label>
      <p id="measurement-table-help" className="measurement-table-help">
        On narrow screens, scroll sideways to inspect every column, including
        the source population and method.
      </p>
      <div
        id="assessment-measurements"
        className="decision-table"
        tabIndex={0}
        role="region"
        aria-label="Measured values and supporting populations"
      >
        <table aria-describedby="measurement-table-help">
          <caption>Measurements and their valid populations</caption>
          <thead>
            <tr>
              <th>Quantity</th>
              <th>Measured value</th>
              <th>Units</th>
              <th>Population / limitations</th>
            </tr>
          </thead>
          <tbody>
            {assessment.metrics.map((m) => {
              const v = displayMeasurement(
                m.value,
                m.unit,
                metric,
                m.id.includes("difference"),
              );
              return (
                <tr key={m.id}>
                  <th scope="row">{m.label}</th>
                  <td>
                    {v.value === null ? (
                      <span>
                        No measured value ·{" "}
                        <a href="#assessment-quality">
                          check quality and limitations
                        </a>
                      </span>
                    ) : (
                      v.value.toLocaleString(undefined, {
                        maximumSignificantDigits: 7,
                      })
                    )}
                  </td>
                  <td>
                    {v.unit}
                    {v.unit !== m.unit && <small>Source: {m.unit}</small>}
                  </td>
                  <td>
                    {m.denominator ?? "See method"} · {m.description}
                    <details>
                      <summary>Evidence</summary>
                      {m.evidenceIds.map((id) => {
                        const e = assessment.evidence.find((e) => e.id === id);
                        return (
                          e && (
                            <a
                              key={id}
                              href={e.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {e.title}
                            </a>
                          )
                        );
                      })}
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
function TemporalEvidence({ assessment, jobId, artifactExpiresAt }: { assessment: Assessment; jobId?: string | null; artifactExpiresAt?: string | null }) {
  const dates = [
    ...new Set([
      ...assessment.evidence
        .map((e) => e.timestamps.observedStart?.slice(0, 10))
        .filter((s): s is string => Boolean(s)),
      ...(assessment.series ?? []).flatMap((s) => s.points.map((p) => p.date)),
    ]),
  ].sort();
  const observedDates = [
    ...new Set([
      ...assessment.evidence
        .map((e) => e.timestamps.observedStart?.slice(0, 10))
        .filter((s): s is string => Boolean(s)),
      ...(assessment.series ?? []).flatMap((s) =>
        s.points.filter((p) => p.value !== null).map((p) => p.date),
      ),
    ]),
  ].sort();
  const [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(false);
  // Playback shows observation availability. It never interpolates unobserved environmental conditions.
  const current = Math.min(index, Math.max(dates.length - 1, 0));
  const change = (i: number) => {
    setIndex(i);
    setPlaying(false);
  };
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setIndex((i) => {
          if (i >= dates.length - 1) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        }),
      1400,
    );
    return () => clearInterval(timer);
  }, [playing, dates.length]);
  return (
    <section id="assessment-timeline" className="temporal-evidence">
      <h3>Observations through time</h3>
      <p>
        Select a date to inspect its exact values and source quality across the
        history charts below. Missing calendar slots stay unobserved; playback
        does not simulate environmental change.
      </p>
      {dates.length > 0 ? (
        <>
          <div className="timeline-dates">
            {dates.length <= 12 ? (
              dates.map((d, i) => (
                <button
                  type="button"
                  aria-pressed={current === i}
                  key={d}
                  onClick={() => change(i)}
                >
                  {d}
                </button>
              ))
            ) : (
              <label>
                Select a dated observation
                <select
                  value={current}
                  onChange={(e) => change(Number(e.target.value))}
                >
                  {dates.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <label>
            Evidence date
            <input
              type="range"
              min={0}
              max={Math.max(dates.length - 1, 0)}
              value={current}
              onChange={(e) => change(Number(e.target.value))}
            />
          </label>
          <p>
            {dates[current]} ·{" "}
            {assessment.evidence
              .filter(
                (e) =>
                  e.timestamps.observedStart?.slice(0, 10) === dates[current],
              )
              .map((e) => e.title)
              .join(" · ")}
          </p>
          <details>
            <summary>Observation gaps</summary>
            {observedDates.slice(1).map((d, i) => {
              const days =
                (Date.parse(d) - Date.parse(observedDates[i])) / 86400000;
              return (
                days > 1 && (
                  <p className="observation-gap" key={d}>
                    {days - 1} intervening days have no dated evidence in this
                    selection ({observedDates[i]} → {d}).
                  </p>
                )
              );
            })}
          </details>
        </>
      ) : (
        <p>
          No dated observation was retrieved. Documentation dates cannot
          substitute for acquisition dates.
        </p>
      )}
      {dates.length > 1 && (
        <button
          type="button"
          aria-pressed={playing}
          onClick={() => {
            if (current === dates.length - 1) setIndex(0);
            setPlaying((v) => !v);
          }}
        >
          {playing ? "Pause evidence playback" : "Play evidence dates"}
        </button>
      )}
      {assessment.series?.map((series) => (
        <HistoryInsights
          key={series.id}
          series={series}
          vintage={assessment.gaugeVintage}
          information={assessment.forecastInformation}
          jobId={jobId}
          artifactExpiresAt={artifactExpiresAt}
          selectedDate={dates[current]}
          onSelectDate={(d) => {
            const i = dates.indexOf(d);
            if (i >= 0) change(i);
          }}
        />
      ))}
      {assessment.forecastEvaluation && (
        <GaugeEvaluation
          evaluation={assessment.forecastEvaluation}
          target={gaugeForecastTarget(assessment)}
        />
      )}
    </section>
  );
}
export function DecisionWorkspace({
  publicStudyContext = null,
  query,
  openScience,
  radarJobs = [],
  investigationSeed,
  searchEpoch = 0,
  onSearchEntries,
  searchNavigation,
  onDiscoverPhoto,
}: {
  publicStudyContext?: PublicStudyContext | null;
  query: CatalogQuery;
  onDiscoverPhoto?: (point: PhotoPoint, start: string, end: string) => void;
  openScience: () => void;
  radarJobs?: ChangeJob[];
  investigationSeed?: { id: string; nonce: number } | null;
  searchEpoch?: number;
  onSearchEntries?: (entries: WorkspaceSearchEntry[], epoch: number) => void;
  searchNavigation?: SearchNavigation | null;
}) {
  const model = useAssessments();
  const [setupStep, setSetupStep] = useState(publicStudyContext ? 1 : 0);
  const { setSelectedId } = model;
  const [radarId, setRadarId] = useState<string | null>(null);
  const appliedSeed = useRef<{ id: string; nonce: number } | null>(null);
  const radar =
    radarJobs.find(
      (job) => job.id === radarId && job.status === "completed" && job.result,
    ) ?? null;
  const [domain, setDomain] = useState<(typeof DOMAINS)[number]>("water"),
    [question, setQuestion] = useState<(typeof QUESTIONS)[number]>("change"),
    [area, setArea] = useState<AssessmentArea>(() =>
      publicStudyContext ? publicStudyArea(publicStudyContext) : near(REGIONS[query.region].point ?? [-114.75, 36.06]),
    );
  const [place, setPlace] = useState(publicStudyContext ? `Lake Mead · ${publicStudySelectionLabel(publicStudyContext.selection)}` : REGIONS[query.region].label as string),
    [start, setStart] = useState(query.start),
    [end, setEnd] = useState(query.end),
    [gauge, setGauge] = useState(""),
    [localError, setLocalError] = useState<string | null>(null),
    [draw, setDraw] = useState(false),
    [vertices, setVertices] = useState<[number, number][]>([]),
    [viewport, setViewport] = useState<[number, number, number, number] | null>(
      null,
    ),
    [json, setJson] = useState(""),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [sourceIds, setSourceIds] = useState<string[]>([]),
    [nameSearch, setNameSearch] = useState(""),
    [searching, setSearching] = useState(false),
    [places, setPlaces] = useState<
      Array<{ name: string; geometry: AssessmentArea }>
    >([]);
  const selected = model.jobs.find((j) => j.id === model.selectedId),
    assessment = snapshot?.manifest ?? selected?.result ?? null;
  const visibleError =
    localError ?? (model.error?.startsWith("Sign in to") ? null : model.error);
  const draftAligned =
    !assessment ||
    (draftMatches(
      { schemaVersion: "1.0", domain, question, area, start, end },
      assessment,
    ) &&
      (snapshot
        ? !sourceIds.length && !gauge
        : sourceSettingsMatch(
            { sourceIds, gaugeId: gauge || undefined },
            selected?.request.options,
          )));
  const dateValid = assessmentRequestSchema.safeParse({
    schemaVersion: "1.0",
    domain,
    question,
    area,
    start,
    end,
  }).success;
  const extent = useMemo(() => bounds(area), [area]);
  const identityEpoch = useRef(0);
  const currentSearchIdentity = useRef(searchEpoch);
  // Publish only committed identities, before pending microtasks or focus frames.
  useLayoutEffect(() => { currentSearchIdentity.current = searchEpoch; }, [searchEpoch]);
  const handledSearch = useRef(0);
  const [searchFocus, setSearchFocus] = useState<{ id: string; nonce: number; epoch: number } | null>(null);
  const registeredEntries = useMemo(() => assessmentSearchEntries(model.jobs, model.snapshots), [model.jobs, model.snapshots]);
  useEffect(() => { onSearchEntries?.(registeredEntries, searchEpoch); }, [onSearchEntries, registeredEntries, searchEpoch]);
  useEffect(() => () => { onSearchEntries?.([], searchEpoch); }, [onSearchEntries, searchEpoch]);
  useEffect(() => {
    if (!searchNavigation || !currentSearchEpoch(searchNavigation.epoch, searchEpoch) || handledSearch.current === searchNavigation.nonce) return;
    const { target, nonce, epoch } = searchNavigation;
    let alive = true;
    const identity = identityEpoch.current;
    queueMicrotask(() => {
      if (!alive || identity !== identityEpoch.current || !currentSearchEpoch(epoch, currentSearchIdentity.current)) return;
      handledSearch.current = nonce;
      if (target.kind === "place-search") {
        setSetupStep(0);
        if (target.query) setNameSearch(target.query);
        setSearchFocus({ id: "place-name", nonce, epoch });
        return;
      }
      const job = target.kind === "assessment" ? model.jobs.find(j => j.id === target.id) : null;
      const savedSnapshot = target.kind === "snapshot" ? model.snapshots.find(s => s.id === target.id) : null;
      if (!job && !savedSnapshot) { setLocalError("This saved result is no longer loaded. Refresh your assessment history and search again."); return; }
      // Viewing evidence is independent of the editable investigation draft.
      setSnapshot(savedSnapshot ?? null);
      setSelectedId(job?.id ?? null);
      setSearchFocus({ id: target.anchor ?? "assessment-brief", nonce, epoch });
    });
    return () => { alive = false; };
  }, [searchNavigation, searchEpoch, model.jobs, model.snapshots, setSelectedId]);
  useEffect(() => {
    if (!searchFocus) return;
    const identity = identityEpoch.current;
    const frame = requestAnimationFrame(() => {
      if (identity === identityEpoch.current && currentSearchEpoch(searchFocus.epoch, currentSearchIdentity.current)) focusSearchTarget(searchFocus.id);
    });
    return () => cancelAnimationFrame(frame);
  }, [searchFocus, assessment]);
  useEffect(() => {
    const identityCounter = identityEpoch;
    const reset = () => {
      identityEpoch.current++;
      setSearchFocus(null);
      setRadarId(null);
      appliedSeed.current = null;
      setSetupStep(publicStudyContext ? 1 : 0);
      setSnapshot(null);
      setPlaces([]);
      setNameSearch("");
      setJson("");
      setGauge("");
      setVertices([]);
      setDraw(false);
      setSourceIds([]);
      setLocalError(null);
      setSearching(false);
      setArea(publicStudyContext ? publicStudyArea(publicStudyContext) : near(REGIONS[query.region].point ?? [-114.75, 36.06]));
      setPlace(publicStudyContext ? `Lake Mead · ${publicStudySelectionLabel(publicStudyContext.selection)}` : REGIONS[query.region].label);
      setStart(publicStudyContext ? PUBLIC_RADAR_STUDY.start : query.start);
      setEnd(publicStudyContext ? PUBLIC_RADAR_STUDY.end : query.end);
    };
    window.addEventListener("earthsignal-auth-changed", reset);
    return () => {
      identityCounter.current++;
      window.removeEventListener("earthsignal-auth-changed", reset);
    };
  }, [query.region, query.start, query.end, publicStudyContext]);
  useEffect(() => {
    const changed: HTMLDetailsElement[] = [];
    const prepare = () => {
      document
        .querySelectorAll<HTMLDetailsElement>(
          ".print-assessment .claim-proof, .print-assessment .quality-disclosure, .print-assessment .analysis-disclosure",
        )
        .forEach((el) => {
          if (!el.open) {
            changed.push(el);
            el.open = true;
          }
        });
    };
    const restore = () => {
      changed.splice(0).forEach((el) => {
        el.open = false;
      });
    };
    window.addEventListener("beforeprint", prepare);
    window.addEventListener("afterprint", restore);
    return () => {
      restore();
      window.removeEventListener("beforeprint", prepare);
      window.removeEventListener("afterprint", restore);
    };
  }, []);
  const chooseArea = (a: AssessmentArea, label: string) => {
    setArea(a);
    setPlace(label);
    setVertices([]);
    setDraw(false);
    setJson(JSON.stringify(a));
    setLocalError(null);
  };
  const applyRadarFootprint = (job: ChangeJob) => {
    if (job.status !== "completed" || !job.result) return;
    setRadarId(job.id);
    setSnapshot(null);
    setSelectedId(null);
    setSetupStep(1);
    chooseArea(
      radarAssessmentArea(job.result.crop.bbox),
      "Selected NISAR footprint",
    );
    setStart(job.result.before.acquiredAt.slice(0, 10));
    setEnd(job.result.after.acquiredAt.slice(0, 10));
    setQuestion("change");
    setSourceIds([]);
    setGauge("");
  };
  useEffect(() => {
    if (
      !investigationSeed ||
      (appliedSeed.current?.id === investigationSeed.id &&
        appliedSeed.current.nonce === investigationSeed.nonce)
    )
      return;
    const job = radarJobs.find(
      (item) =>
        item.id === investigationSeed.id &&
        item.status === "completed" &&
        item.result,
    );
    if (!job) return;
    let alive = true;
    const epoch = identityEpoch.current;
    // Synchronize an external navigation request after render; invalidate on identity or prop changes.
    queueMicrotask(() => {
      if (!alive || identityEpoch.current !== epoch) return;
      appliedSeed.current = investigationSeed;
      setRadarId(job.id);
      setSnapshot(null);
      setSelectedId(null);
      setSetupStep(1);
      const geometry = radarAssessmentArea(job.result!.crop.bbox);
      setArea(geometry);
      setJson(JSON.stringify(geometry));
      setPlace("Selected NISAR footprint");
      setStart(job.result!.before.acquiredAt.slice(0, 10));
      setEnd(job.result!.after.acquiredAt.slice(0, 10));
      setQuestion("change");
      setSourceIds([]);
      setGauge("");
      setVertices([]);
      setDraw(false);
      setLocalError(null);
    });
    return () => {
      alive = false;
    };
  }, [investigationSeed, radarJobs, setSelectedId]);
  const submit = async () => {
    try {
      const request = assessmentRequestSchema.parse({
        schemaVersion: "1.0",
        domain,
        question,
        area,
        start,
        end,
        options: {
          ...(gauge ? { gaugeId: gauge } : {}),
          ...(sourceIds.length ? { sourceIds } : {}),
        },
      });
      setSnapshot(null);
      setLocalError(null);
      await model.submit(request);
    } catch {
      setLocalError(
        "Check the dates and area boundary. The boundary must close without crossing itself. Uploaded areas can have up to 512 points; any holes must sit inside the outer boundary.",
      );
    }
  };
  const parseGeo = (text: string) => {
    const data = JSON.parse(text);
    let geometry = data.type === "Feature" ? data.geometry : data;
    if (data.type === "FeatureCollection") {
      const polygons = data.features.flatMap(
        (f: { geometry: AssessmentArea }) =>
          f.geometry.type === "Polygon"
            ? [f.geometry.coordinates]
            : f.geometry.type === "MultiPolygon"
              ? f.geometry.coordinates
              : [],
      );
      if (
        !polygons.length ||
        polygons.length !==
          data.features.reduce(
            (n: number, f: { geometry: AssessmentArea }) =>
              n +
              (f.geometry.type === "MultiPolygon"
                ? f.geometry.coordinates.length
                : 1),
            0,
          )
      )
        throw new Error();
      geometry = { type: "MultiPolygon", coordinates: polygons };
    }
    chooseArea(areaSchema.parse(geometry), "Your uploaded area");
  };
  const lookUp = async () => {
    const epoch = identityEpoch.current;
    setSearching(true);
    try {
      const r = await fetch(`/api/places?q=${encodeURIComponent(nameSearch)}`, {
        cache: "no-store",
      });
      const d = await r.json();
      if (!r.ok)
        throw new Error(z.object({ error: z.string() }).parse(d).error);
      if (epoch !== identityEpoch.current) return;
      setPlaces(
        z
          .object({
            places: z.array(
              z.object({ name: z.string(), geometry: areaSchema }),
            ),
          })
          .parse(d).places,
      );
      setLocalError(null);
    } catch (e) {
      if (epoch === identityEpoch.current)
        setLocalError(
          e instanceof Error
            ? e.message
            : "Place search is unavailable. Try a saved example or choose an area on the map.",
        );
    } finally {
      if (epoch === identityEpoch.current) setSearching(false);
    }
  };
  const restoreRecorded = () => {
    if (assessment) {
      setDomain(assessment.domain);
      setQuestion(assessment.question);
      setStart(assessment.time.start);
      setEnd(assessment.time.end);
      setSourceIds(
        snapshot ? [] : (selected?.request.options?.sourceIds ?? []),
      );
      setGauge(snapshot ? "" : (selected?.request.options?.gaugeId ?? ""));
      chooseArea(assessment.area, "Recorded assessment area");
    }
  };
  const pickJob = (j: AssessmentJob) => {
    setSetupStep(2);
    setSnapshot(null);
    model.setSelectedId(j.id);
    setSourceIds(j.request.options?.sourceIds ?? []);
    setGauge(j.request.options?.gaugeId ?? "");
    setDomain(j.request.domain);
    setQuestion(j.request.question);
    chooseArea(j.request.area, "Recorded assessment area");
    setStart(j.request.start);
    setEnd(j.request.end);
  };
  return (
    <section
      className="decision-workspace"
      aria-label="Environmental decision workspace"
    >
      <nav className="decision-rail" aria-label="Workspace shortcuts">
        <Orbit className="decision-rail-logo" size={25} />
        <a
          className="decision-rail-button"
          href="#place-setup"
          onClick={() => setSetupStep(0)}
          aria-label="Choose a place"
          title="Choose a place"
        >
          <MapPin size={22} />
        </a>
        <a
          className="decision-rail-button"
          href="#decision-map"
          aria-label="See selected area"
          title="See selected area"
        >
          <Orbit size={22} />
        </a>
        <button
          type="button"
          className="decision-rail-button"
          aria-label="Open scientific explorer"
          title="Scientific explorer"
          onClick={openScience}
        >
          <Satellite size={22} />
        </button>
        <a
          className="decision-rail-footer"
          href={
            assessment || radar
              ? "#environmental-change-story"
              : "#evidence-guide"
          }
          aria-label="Understand the result"
          title="Understand the result"
        >
          <Info size={21} />
        </a>
      </nav>
      <aside className="decision-controls" aria-label="Set up your question">
        <div className="decision-intro">
          <h1>Explore a place</h1>
          <p>
            Choose an area and a question. We’ll help you understand what the
            data says.
          </p>
          <a className="mobile-map-link" href="#decision-map">
            See the selected area ↓
          </a>
        </div>
        <nav className="setup-steps" aria-label="Investigation setup">
          {["Place", "Question", "Dates"].map((label, i) => (
            <button
              type="button"
              key={label}
              aria-current={setupStep === i ? "step" : undefined}
              onClick={() => setSetupStep(i)}
            >
              <span aria-hidden="true">{i + 1}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="setup-body">
          <fieldset
            className="setup-group"
            id="place-setup"
            hidden={setupStep !== 0}
          >
            <legend>
              <span className="setup-number" aria-hidden="true">
                1
              </span>
              Where?
            </legend>
            <div className="place-search">
              <label htmlFor="place-name">
                Find a city or place
                <input
                  id="place-name"
                  value={nameSearch}
                  maxLength={160}
                  onChange={(e) => setNameSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      nameSearch.trim().length >= 3 &&
                      !searching
                    ) {
                      e.preventDefault();
                      void lookUp();
                    }
                  }}
                  placeholder="For example, Phoenix"
                />
              </label>
              <button
                type="button"
                disabled={searching || nameSearch.trim().length < 3}
                onClick={() => void lookUp()}
              >
                {searching ? "Finding…" : "Find"}
              </button>
            </div>
            <div className="place-results" aria-live="polite">
              {places.map((p, i) => (
                <button
                  type="button"
                  key={`${p.name}-${i}`}
                  onClick={() => {
                    chooseArea(p.geometry, p.name);
                    setPlaces([]);
                  }}
                >
                  <MapPin size={15} />
                  {p.name}
                </button>
              ))}
            </div>
            {onDiscoverPhoto && <PhotoPlace initialPoint={[((extent[0][1] + extent[1][1]) / 2 + 540) % 360 - 180, (extent[0][0] + extent[1][0]) / 2]} onDiscover={(point, from, to) => {
              const proposedArea = photoStudyArea(point);
              if (proposedArea) { chooseArea(proposedArea, "Your confirmed photo location"); setStart(from); setEnd(to); }
              else setLocalError("Radar discovery uses your polar location. Place & question assessments currently support latitudes from −85 to 85; your previous assessment area was kept.");
              onDiscoverPhoto(point, from, to);
            }} />}
            <label>
              Or choose an example
              <WorkspaceSelect
                label="Or choose an example"
                placeholder="Choose a place…"
                value=""
                onValueChange={(value) => {
                  const p = pilotPlaces.find((p) => p.id === value);
                  if (p) chooseArea(near(p.point), p.label);
                }}
                options={pilotPlaces.map((p) => ({
                  value: p.id,
                  label: p.label.replace(" pilot", ""),
                }))}
              />
            </label>
            <div className="selected-place" role="status">
              <MapPin size={17} />
              <div>
                <strong>{place}</strong>
                <small>
                  The outlined area on the map is the part we’ll examine.
                </small>
              </div>
            </div>
            <details className="setup-detail">
              <summary>Choose your own area</summary>
              <StudyRectangleEditor
                key={searchEpoch}
                selectionKey={JSON.stringify(area)}
                extent={[extent[0][1], extent[0][0], extent[1][1], extent[1][0]]}
                onApply={(rectangle) => chooseArea(rectangle, "Your coordinate rectangle")}
              />
              <div className="area-actions">
                <button
                  type="button"
                  aria-pressed={draw}
                  onClick={() => {
                    setDraw(!draw);
                    setVertices([]);
                  }}
                >
                  Draw on the map
                </button>
                <button
                  type="button"
                  disabled={!viewport}
                  onClick={() => {
                    if (viewport)
                      try {
                        chooseArea(
                          areaSchema.parse(boxArea(...viewport)),
                          "Area shown on the map",
                        );
                      } catch {
                        setLocalError(
                          "This area crosses a map limit. Move the map or upload a boundary file.",
                        );
                      }
                  }}
                >
                  Use the visible map
                </button>
              </div>
              {draw && (
                <div className="drawing-instructions" role="status">
                  <p>
                    Tap around the area on the map. Choose at least three
                    corners, then finish.
                  </p>
                  <a className="drawing-map-link" href="#decision-map">
                    Go to the map ↓
                  </a>
                  <button
                    type="button"
                    disabled={vertices.length < 3}
                    onClick={() => {
                      try {
                        chooseArea(
                          areaSchema.parse({
                            type: "Polygon",
                            coordinates: [[...vertices, vertices[0]]],
                          }),
                          "Your drawn area",
                        );
                      } catch {
                        setLocalError(
                          "Check your drawing. The boundary must close around an area without crossing itself.",
                        );
                      }
                    }}
                  >
                    Finish drawing ({vertices.length} corners)
                  </button>
                </div>
              )}
              <details>
                <summary>Upload or paste a GeoJSON boundary</summary>
                <p>
                  GeoJSON files stay private. Use a Polygon or MultiPolygon area
                  under 16 KiB, with up to 512 positions and 16 polygons. Holes
                  are supported.
                </p>
                <label>
                  Boundary coordinates (GeoJSON)
                  <textarea
                    value={json || JSON.stringify(area)}
                    onChange={(e) => setJson(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      parseGeo(json || JSON.stringify(area));
                    } catch {
                      setLocalError(
                        "The coordinates do not describe a supported area. Use a closed Polygon or MultiPolygon GeoJSON boundary.",
                      );
                    }
                  }}
                >
                  Use this boundary
                </button>
                <label>
                  Upload a boundary file
                  <input
                    type="file"
                    accept=".geojson,.json,application/geo+json,application/json"
                    onChange={async (e) => {
                      const input = e.target,
                        epoch = identityEpoch.current,
                        f = input.files?.[0];
                      if (!f) return;
                      try {
                        if (f.size > 16384) throw new Error();
                        const text = await f.text();
                        if (epoch !== identityEpoch.current) return;
                        parseGeo(text);
                      } catch {
                        if (epoch === identityEpoch.current)
                          setLocalError(
                            "Choose a valid GeoJSON area file smaller than 16 KiB.",
                          );
                      }
                      input.value = "";
                    }}
                  />
                </label>
              </details>
              <p className="place-attribution">
                Place-name searches use{" "}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenStreetMap
                </a>
                . Search public names; draw or upload private areas here.
              </p>
            </details>
          </fieldset>
          <fieldset className="setup-group" hidden={setupStep !== 1}>
            <legend>
              <span className="setup-number" aria-hidden="true">
                2
              </span>
              What do you want to understand?
            </legend>
            <div
              className="domain-presets"
              role="group"
              aria-label="Choose a topic"
            >
              {DOMAINS.map((d) => {
                const Icon = PRESETS[d].icon;
                return (
                  <button
                    type="button"
                    key={d}
                    aria-pressed={domain === d}
                    onClick={() => {
                      setDomain(d);
                      setSourceIds([]);
                    }}
                  >
                    <Icon size={18} />
                    <span>{PRESETS[d].label}</span>
                  </button>
                );
              })}
            </div>
            <p className="setup-help">{PRESETS[domain].question}</p>
            <label>
              Your question
              <WorkspaceSelect
                label="Your question"
                value={question}
                onValueChange={(value) => setQuestion(value as typeof question)}
                options={QUESTIONS.map((q) => ({
                  value: q,
                  label: FRIENDLY_QUESTIONS[q].label,
                }))}
              />
            </label>
            <p className="question-scope">
              {FRIENDLY_QUESTIONS[question].help}
            </p>
          </fieldset>
          <fieldset className="setup-group" hidden={setupStep !== 2}>
            <legend>
              <span className="setup-number" aria-hidden="true">
                3
              </span>
              Which dates?
            </legend>
            <p className="setup-selection">
              {place} · {PRESETS[domain].label}
              <br />
              {FRIENDLY_QUESTIONS[question].label}
            </p>
            <div className="decision-fields">
              <label>
                Start date
                <input
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                End date
                <input
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            </div>
            <p className="setup-help">
              We’ll use available observations within this period. Gaps will be
              shown in the result.
            </p>
          </fieldset>
          <details
            className="setup-detail nisar-investigation"
            hidden={setupStep !== 2}
          >
            <summary>
              Use an existing radar comparison{radar ? " · selected" : ""}
            </summary>
            <p>
              Radar is a satellite signal that can respond to changes in water,
              vegetation or the ground. A signal change alone does not tell us
              its cause.
            </p>
            <label>
              Choose a measured comparison
              <WorkspaceSelect
                label="Choose a measured comparison"
                placeholder="Choose a completed comparison…"
                value={radar?.id ?? ""}
                onValueChange={(value) => setRadarId(value || null)}
                options={[
                  { value: "", label: "No radar comparison" },
                  ...radarJobs
                    .filter((job) => job.status === "completed" && job.result)
                    .map((job) => ({
                      value: job.id,
                      label: `${job.prepared ? "Shared example" : "Your comparison"} · ${job.result!.before.acquiredAt.slice(0, 10)} → ${job.result!.after.acquiredAt.slice(0, 10)}`,
                    })),
                ]}
              />
            </label>
            {radar?.result ? (
              <>
                <p>
                  {radar.result.coverage.validAreaKm2.toLocaleString(
                    undefined,
                    { maximumSignificantDigits: 4 },
                  )}{" "}
                  km² measured on both dates.{" "}
                  {radar.result.coverage.commonValidPercent.toFixed(1)}% of the
                  comparison area has usable data on both dates.
                </p>
                <button
                  type="button"
                  onClick={() => applyRadarFootprint(radar)}
                >
                  Use this area and these dates
                </button>
                <small>
                  Then explore your question using any available environmental
                  observations.
                </small>
              </>
            ) : (
              <p className="setup-help">
                Only completed measurements appear here. Choosing one does not
                start new processing.
              </p>
            )}
          </details>
          <details className="setup-detail" hidden={setupStep !== 2}>
            <summary>
              Data sources and advanced settings
              {sourceIds.length || gauge
                ? ` · ${[sourceIds.length ? `${sourceIds.length} selected source${sourceIds.length === 1 ? "" : "s"}` : "", gauge ? "station selected" : ""].filter(Boolean).join(" · ")}`
                : ""}
            </summary>
            {domain === "water" && (
              <label>
                Water-flow station ID (optional)
                <input
                  value={gauge}
                  maxLength={64}
                  onChange={(e) => setGauge(e.target.value)}
                  placeholder="USGS station ID"
                />
              </label>
            )}
            <p>
              We choose supported data sources for your topic. Select products
              here if you want to restrict that choice.
            </p>
            {model.sources
              .filter((s) => s.domains.includes(domain))
              .map((s) => (
                <label className="source-choice" key={s.id}>
                  <input
                    type="checkbox"
                    checked={sourceIds.includes(s.id)}
                    onChange={(e) =>
                      setSourceIds((ids) =>
                        e.target.checked
                          ? [...ids, s.id]
                          : ids.filter((id) => id !== s.id),
                      )
                    }
                  />
                  <span>
                    <strong>{s.title}</strong> · {s.status}
                    <small>
                      {s.spatialSupport} · {s.access}
                    </small>
                    <small>{s.limitations.join(" · ")}</small>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      About this product
                    </a>
                  </span>
                </label>
              ))}
          </details>
          {setupStep === 2 && (
            <details className="setup-detail processing-budget">
              <summary>Area size and processing limits</summary>
              <p>
                Large areas may need a smaller selection. Each job allows up to
                1 million image pixels, 20 minutes and 512 MiB transferred. One
                job runs at a time.
              </p>
              <p>
                Missing dates and unavailable sources will be shown. A 30 m grid
                can cover about 900 km² within the pixel cap, before grid and
                coverage checks.
              </p>
            </details>
          )}
          {visibleError && (
            <p className="decision-error" role="alert">
              {visibleError}
            </p>
          )}
        </div>
        <div className="workflow-launch">
          {setupStep > 0 && (
            <button
              className="setup-back"
              type="button"
              onClick={() => setSetupStep((step) => step - 1)}
            >
              Back
            </button>
          )}
          <button
            className="primary-decision"
            type="button"
            disabled={
              draw ||
              (setupStep === 2 &&
                (model.busy ||
                  !dateValid ||
                  !model.enabledDomains.includes(domain)))
            }
            onClick={() =>
              setupStep < 2 ? setSetupStep((step) => step + 1) : void submit()
            }
          >
            {setupStep === 0
              ? "Continue to your question →"
              : setupStep === 1
                ? "Choose the dates →"
                : model.busy
                  ? "Starting…"
                  : "Explore changes"}
          </button>
          <p>
            {draw
              ? "Finish drawing your area to continue."
              : setupStep < 2
                ? "Your selection stays with you as you continue."
                : !dateValid
                  ? "Choose valid start and end dates and a supported area."
                  : model.enabledDomains.includes(domain)
                    ? "Checks real observations for your area and dates. You can cancel while the work is waiting or running."
                    : "Sign in or refresh availability to start. Saved results remain accessible."}
          </p>
        </div>

        <button className="science-return" type="button" onClick={openScience}>
          Open scientific tools →
        </button>
      </aside>
      <aside className="decision-collection" aria-label="Assessment collection">
        <section className="assessment-history">
          <div className="decision-section-title collection-heading">
            <h3>Saved results</h3>
            <button
              type="button"
              onClick={() => void model.refresh()}
              aria-label="Refresh assessment history"
            >
              <RefreshCw size={15} />
            </button>
          </div>
          {model.jobs.length === 0 && (
            <div className="collection-empty">
              <Satellite size={28} />
              <h3>Your results will appear here.</h3>
              <p>
                Choose an area, a question and dates above. Sign in to start a
                new investigation.
              </p>
            </div>
          )}
          {model.jobs.map((j) => (
            <div
              className="assessment-card"
              data-domain={j.request.domain}
              key={j.id}
            >
              <button
                type="button"
                aria-pressed={selected?.id === j.id && !snapshot}
                onClick={() => pickJob(j)}
              >
                <span className="eyebrow">
                  {PRESETS[j.request.domain].label}
                </span>
                <strong>{FRIENDLY_QUESTIONS[j.request.question].label}</strong>
                <small>
                  {j.request.start} → {j.request.end}
                </small>
                <small>{JOB_LABELS[j.status] ?? j.status}</small>
              </button>
              {["queued", "running"].includes(j.status) && (
                <button
                  type="button"
                  disabled={model.busy}
                  onClick={() =>
                    void model.action(`/api/assessments/${j.id}/cancel`)
                  }
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
        </section>
        <details>
          <summary>Saved snapshots ({model.snapshots.length})</summary>
          {model.snapshots.map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => {
                setSnapshot(s);
                setSourceIds([]);
                setGauge("");
                setSetupStep(2);
                setDomain(s.manifest.domain);
                setQuestion(s.manifest.question);
                setStart(s.manifest.time.start);
                setEnd(s.manifest.time.end);
                chooseArea(s.manifest.area, "Saved assessment area");
              }}
            >
              {s.manifest.title}
              <small>{s.createdAt}</small>
            </button>
          ))}
        </details>
      </aside>
      <div
        className="decision-content"
        onClick={(event) => {
          const link = (event.target as HTMLElement).closest("a");
          const href = link?.getAttribute("href");
          if (!href?.startsWith("#") || href.length < 2) return;
          const target = document.getElementById(href.slice(1));
          if (!target) return;
          let parent: Element | null = target;
          while (parent) {
            if (parent instanceof HTMLDetailsElement) parent.open = true;
            parent = parent.parentElement;
          }
          requestAnimationFrame(() => {
            target.scrollIntoView({ block: "start" });
            target.focus({ preventScroll: true });
          });
        }}
      >
        {assessment && (
          <AssessmentNavigator
            assessment={assessment}
            draftAligned={draftAligned}
            restore={restoreRecorded}
          />
        )}
        <div id="decision-map" tabIndex={-1} className="decision-place">
          <div>
            <span className="area-caption">
              {snapshot
                ? "Saved result area"
                : draftAligned && assessment
                  ? "Result area"
                  : "Area to examine"}{" "}
              · {PRESETS[domain].label}
            </span>
            <h2>{place}</h2>
            <p>{FRIENDLY_QUESTIONS[question].label}</p>
          </div>
          <span className="historical-label">
            {start} → {end}
          </span>
        </div>
        {!draftAligned && (
          <section className="draft-mismatch" role="status">
            <strong>You’re editing a new selection.</strong>
            <p>
              Your area, question, dates or source settings differ. The map
              shows your edited area; the result below still uses its original
              settings and dates: {assessment.time.start} →{" "}
              {assessment.time.end}. It has not been recalculated.
            </p>
            <button type="button" onClick={restoreRecorded}>
              Restore recorded selection
            </button>
          </section>
        )}
        <div className="decision-map">
          <GeoMap
            areaLabel="Area to examine"
            color="var(--earth-accent)"
            selectionGeometry={area as GeoJSON.Polygon | GeoJSON.MultiPolygon}
            focusBounds={extent}
            viewKey={JSON.stringify(extent)}
            maxFitZoom={15}
            drawingMode={draw ? "polygon" : null}
            polygon={draw ? vertices : undefined}
            onMapClick={(c) => {
              if (draw && vertices.length < 510) setVertices((v) => [...v, c]);
            }}
            onViewportChange={setViewport}
          />
        </div>
        <EnvironmentalStory
          key={`${assessment?.processedAt ?? ""}:${radar?.id ?? ""}`}
          assessment={assessment}
          radar={radar}
        />
        {selected && !assessment && (
          <section className="assessment-status" aria-live="polite">
            <h2>{JOB_LABELS[selected.status] ?? selected.status}</h2>
            <p>
              {selected.status === "failed"
                ? "The work did not produce a completed result. Check the message below, then adjust your selection or try again."
                : selected.status === "cancelled"
                  ? "This investigation was cancelled. Choose your area and dates to start another."
                  : "Your result will appear here when the data checks are complete."}
            </p>
            {selected.error && <p role="alert">{selected.error.message}</p>}
          </section>
        )}
        {assessment ? (
          <div className="print-assessment">
            <div className="brief-toolbar">
              <button type="button" onClick={() => window.print()}>
                <Download size={16} />
                Print / save PDF
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadable(assessment, "earthsignal-assessment.json")
                }
              >
                Export manifest JSON
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = Date.now();
                  downloadable(
                    {
                      schemaVersion: "1.0",
                      kind: "environmental-investigation",
                      exportedAt: new Date(now).toISOString(),
                      ...environmentalStory(assessment, radar, now),
                    },
                    "earthsignal-investigation.json",
                  );
                }}
              >
                Export investigation
              </button>
              {selected && !snapshot && (
                <button
                  type="button"
                  disabled={model.busy}
                  onClick={() =>
                    void model.action(
                      `/api/assessments/${selected.id}/snapshot`,
                    )
                  }
                >
                  Save immutable snapshot
                </button>
              )}
            </div>
            {snapshot && (
              <p className="snapshot-notice">
                Snapshot saved {snapshot.createdAt}. Artifact expiry:{" "}
                {snapshot.artifactExpiresAt ?? "retained"}. Compact evidence and
                brief remain available; expired files are not restored by saving
                a snapshot. SHA-256 {snapshot.manifestHash}
              </p>
            )}
            <details className="analysis-disclosure">
              <summary>Compare results and inspect the key numbers</summary>
              <AssessmentOverview assessment={assessment} />
              <AssessmentComparison
                key={snapshot?.id ?? selected?.id ?? assessment.processedAt}
                assessment={assessment}
                currentId={snapshot?.sourceJobId ?? selected?.id ?? null}
                jobs={model.jobs}
              />
            </details>
            <EvidenceBrief
              assessment={assessment}
              includePlainLanguage={false}
            />
            <details
              className="analysis-disclosure"
              id="assessment-analysis"
              tabIndex={-1}
            >
              <summary>Explore measurements, maps and history</summary>
              <MeasurementTable assessment={assessment} />
              {Boolean(assessment.rasters?.length) && (
                <div id="assessment-layers" tabIndex={-1}>
                  {selected && !snapshot ? (
                    <RasterComparison
                      key={`raster-${selected.id}`}
                      id={selected.id}
                      views={assessment.rasters!}
                    />
                  ) : (
                    <p>
                      Open the original assessment for measured layers. Snapshot
                      provenance preserves the recorded grids and
                      artifact-expiry status.
                    </p>
                  )}
                </div>
              )}
              <TemporalEvidence
                key={assessment.processedAt}
                assessment={assessment}
                jobId={snapshot?.sourceJobId ?? selected?.id}
                artifactExpiresAt={snapshot?.artifactExpiresAt}
              />
            </details>
            <section id="assessment-options" tabIndex={-1}>
              {selected && !snapshot && model.scenariosEnabled && (
                <ScenarioPanel
                  key={`scenario-${selected.id}`}
                  id={selected.id}
                  assessment={assessment}
                  jobs={model.scenarios}
                  busy={model.busy}
                  submit={(r) => model.action("/api/scenarios", r)}
                  cancel={(id) => model.action(`/api/scenarios/${id}/cancel`)}
                />
              )}
              <p className="scenario-availability">
                {snapshot
                  ? "Open the original assessment to run a new scenario; this snapshot stays immutable."
                  : !model.scenariosEnabled
                    ? "Scenario processing is currently unavailable. Recorded results remain accessible."
                    : ""}
              </p>
            </section>
            <details
              id="assessment-provenance"
              tabIndex={-1}
              className="full-provenance"
            >
              <summary>Complete source records, methods and provenance</summary>
              <pre>{JSON.stringify(assessment, null, 2)}</pre>
            </details>
            {!snapshot && selected && (
              <nav className="artifact-links" aria-label="Assessment exports">
                {assessment.artifacts.map((name) => (
                  <a
                    key={name}
                    href={assessmentArtifactUrl(selected.id, name)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {name}
                  </a>
                ))}
              </nav>
            )}
          </div>
        ) : (
          !selected &&
          !radar && (
            <section className="decision-welcome" id="evidence-guide">
              <h2>What would you like to understand?</h2>
              <p>
                Choose a place, a question and dates to explore this area. Your
                result will explain:
              </p>
              <ul className="welcome-outcomes">
                <li>What changed, where, and when.</li>
                <li>What it could mean — and what we cannot tell yet.</li>
                <li>What to check next before making a decision.</li>
              </ul>
              {model.jobs.some((j) => j.status === "completed" && j.result) && (
                <button
                  type="button"
                  onClick={() => {
                    const job = model.jobs.find(
                      (j) => j.status === "completed" && j.result,
                    );
                    if (job) pickJob(job);
                  }}
                >
                  Read a saved result
                </button>
              )}
              <p className="setup-help">
                A missing observation stays unknown. Satellite measurements
                alone do not confirm damage or danger.
              </p>
            </section>
          )
        )}

        <details className="science-help-disclosure">
          <summary>Help understanding the science</summary>
          <PublicAssistant key={domain} domain={domain} />
        </details>
      </div>
    </section>
  );
}
