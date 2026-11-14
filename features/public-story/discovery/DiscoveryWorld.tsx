"use client";
import {
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowRight, Check, Droplets, Radar, RotateCcw } from "lucide-react";
import type { MissionId } from "@/lib/story-missions";
import {
  freshPlan,
  freshRadar,
  freshWater,
  radarCue,
  radarStep,
  waterStep,
} from "@/lib/discovery-play";
import { AquiferCrossSection } from "@/features/ground-truth/components/story/AquiferCrossSection";
import { CityScene } from "@/features/ground-truth/components/story/CityScene";
import { InterferogramConcept } from "@/features/ground-truth/components/story/InterferogramConcept";
import type { RadarModelState } from "@/features/ground-truth/components/story/radar3d/RadarLesson";
import {
  NISAR_BUNDLES,
  formatPeriod,
  formatVertical,
  gridLookup,
  rampGradient,
  useNisarBundle,
  type LoadedBundle,
} from "@/features/ground-truth/data/nisar";
import { radarSample } from "@/lib/radar-interferometry";
import { ContextNote } from "../ContextNote";
import { TokyoStory } from "../comparison/TokyoStory";
import { StoryPhotography } from "../StoryPhotography";
import { useDiscoverySound } from "./DiscoverySound";
import { StreetInstrument } from "./StreetInstrument";
import { FieldPartner } from "./FieldPartner";
import { GameActivity, useGameCheckpoints } from "../quest/GameObjective";
import { waterAt } from "@/lib/story-discovery";
import { directEcho, type EchoTelemetry } from "@/lib/echo-director";
import { useGame, useFieldTelemetry } from "../quest/GameDirector";
import type { SeasonTrial } from "@/lib/field-investigation";
import {
  SeasonalControls,
  PolicyInstrument,
  HumanScale,
} from "./FieldInstruments";
import { PhaseInstrument } from "./PhaseInstrument";
import { SoilLens } from "./StoryEvidenceBridge";
import { ConnectionGauge } from "./ConnectionGauge";
import { PolicyCity } from "./PolicyCity";
import { FootprintAudit } from "./FootprintAudit";
import type { RadarInspection } from "../radar-study/PublicRadarStudy";
import "./exhibition.css";
import "./discovery.css";
import "./playable.css";

const RealRadar = lazy(() => import("../radar-study/PublicRadarStudy"));
type Found = (message: string) => void;
const GOALS: Record<MissionId, string> = {
  aquifer: "Take water out. Bring it back. Find what stays changed.",
  uneven: "Make the street sink together, then make one end sink farther.",
  radar: "Save two echoes of a ground target, then reveal their difference.",
  evidence: "Explore a measured patch and a gap in the satellite record.",
  tokyo: "Give the city a way to use less groundwater—and check the result.",
};
function useFinding(done: boolean, message: string, onFinding?: Found) {
  const sent = useRef(false);
  useEffect(() => {
    if (done && !sent.current && onFinding) {
      sent.current = true;
      onFinding(message);
    }
  }, [done, message, onFinding]);
}
export function DiscoveryWorld({
  id,
  onFinding,
  invitation = true,
  radarOnly = false,
}: {
  id: MissionId;
  onFinding?: Found;
  invitation?: boolean;
  /** Evidence only: show just the radar images, without the view switch. */
  radarOnly?: boolean;
}) {
  const { silence } = useDiscoverySound();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Story chapters remain mounted as the reader scrolls. Invalidate pending
    // audio on viewport exit as well as on game navigation/unmount.
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            if (!entry.isIntersecting) silence();
          });
    if (host.current) observer?.observe(host.current);
    return () => {
      observer?.disconnect();
      silence();
    };
  }, [silence]);
  return (
    <div className="ed-world" data-discovery={id} ref={host}>
      {invitation && <p className="ed-invitation">{GOALS[id]}</p>}
      {id === "aquifer" ? (
        <WaterPlay onFinding={onFinding} />
      ) : id === "uneven" ? (
        <StreetPlay onFinding={onFinding} />
      ) : id === "radar" ? (
        <RadarPlay onFinding={onFinding} />
      ) : id === "evidence" ? (
        <EvidencePlay onFinding={onFinding} radarOnly={radarOnly} />
      ) : (
        <TokyoPlay onFinding={onFinding} />
      )}
    </div>
  );
}
function Echo({
  children,
  hint,
  found = false,
  telemetry,
}: {
  children: ReactNode;
  hint: string;
  found?: boolean;
  telemetry?: EchoTelemetry;
}) {
  return (
    <FieldPartner
      hint={hint}
      found={found}
      reading={telemetry ? directEcho(telemetry) : undefined}
    >
      {children}
    </FieldPartner>
  );
}
function Restart({ reset }: { reset: () => void }) {
  return (
    <button
      type="button"
      className="ed-retry"
      aria-label="Fresh experiment"
      title="Fresh experiment"
      onClick={reset}
    >
      <RotateCcw size={16} />
      <span>Fresh experiment</span>
    </button>
  );
}

function WaterPlay({ onFinding }: { onFinding?: Found }) {
  const [state, setState] = useState(freshWater),
    [trial, setTrial] = useState<SeasonTrial | null>(null);
  const { cue, respond } = useDiscoverySound(),
    game = useGame(),
    done = state.returned;
  const shown = trial
    ? { compacted: trial.compacted, depletion: 1 - trial.storage / 100 }
    : state;
  useFieldTelemetry(
    state.depletion > 0 || state.returned
      ? {
          kind: "water",
          depletion: state.depletion,
          compacted: state.compacted,
          returned: state.returned,
        }
      : null,
  );
  useGameCheckpoints("aquifer", state.pumped, state.returned);
  useFinding(
    done,
    "Returning water may not reopen compacted pore space.",
    onFinding,
  );
  const change = (action: "pump" | "refill") => {
    setState((old) => waterStep(old, action));
    setTrial(null);
    cue("water");
  };
  return (
    <>
      <div className="play-stage play-water">
        <div className="play-visual">
          <div className="play-scene-heading">
            <span>THE WELL BENEATH YOUR STREET</span>
            <small>Illustration</small>
          </div>
          <figure className="ed-aquifer" data-returned={done}>
            <AquiferCrossSection
              exhibition
              compaction={shown.compacted}
              waterLevel={shown.depletion}
              showLabels={false}
              ariaLabel={`Illustrative aquifer: ${Math.round((1 - shown.depletion) * 100)} percent water remaining; compacted fine layers ${shown.compacted ? "remain thinner" : "not yet squeezed"}. Not measured depths or time.`}
            />
            <figcaption>Dashed line = where the street began</figcaption>
          </figure>
          <div className="play-water-meter">
            <span>Water underground</span>
            <meter min="0" max="100" value={(1 - shown.depletion) * 100} />
            <b>{Math.round((1 - shown.depletion) * 100)}%</b>
          </div>
        </div>
        <div className="play-dock">
          <div className="play-control-title">
            <small>YOUR WELL</small>
            <h3>
              {done
                ? "Water back. Street lower."
                : state.pumped
                  ? "Can you undo it?"
                  : "Pull the water out."}
            </h3>
          </div>
          <div className="ed-actions play-primary-actions">
            <button
              type="button"
              data-affordance="pump"
              onClick={() => change("pump")}
              disabled={state.depletion >= 1}
            >
              <Droplets size={20} />
              Pump water
            </button>
            <button
              type="button"
              data-affordance="refill"
              onClick={() => change("refill")}
              disabled={state.depletion <= 0}
            >
              Refill
            </button>
          </div>
          <div className="ea-water-control">
            <label>
              <span>
                Water remaining{" "}
                <b>{Math.round((1 - state.depletion) * 100)}%</b>
              </span>
              <input
                data-affordance="water"
                aria-label="Water remaining in your experiment"
                type="range"
                min="0"
                max="100"
                value={Math.round((1 - state.depletion) * 100)}
                onChange={(e) => {
                  setTrial(null);
                  setState((old) =>
                    waterAt(old, 1 - Number(e.target.value) / 100),
                  );
                  respond(
                    "water",
                    Math.abs(
                      Number(e.target.value) / 100 - (1 - state.depletion),
                    ),
                  );
                }}
              />
            </label>
          </div>
          <Echo
            found={done}
            telemetry={{
              kind: "water",
              depletion: state.depletion,
              compacted: state.compacted,
              returned: state.returned,
            }}
            hint="Pump three times, then refill twice. Compare the street to its dashed starting line."
          >
            {
              directEcho({
                kind: "water",
                depletion: state.depletion,
                compacted: state.compacted,
                returned: state.returned,
              }).text
            }
          </Echo>
          <Restart
            reset={() => {
              setState(freshWater());
              setTrial(null);
            }}
          />
        </div>
      </div>
      <details className="ed-details play-bonus">
        <summary>Look inside the squeezed layer</summary>
        <SoilLens depletion={shown.depletion} compacted={shown.compacted} />
      </details>
      {game && (
        <details className="ed-details play-bonus">
          <summary>
            Extra challenge: keep a city supplied through four dry seasons
          </summary>
          <SeasonalControls state={trial} change={setTrial} />
        </details>
      )}
      <ContextNote label="About this aquifer model"><p>Illustration · no elapsed years, measured pressure or calibrated compaction law.</p></ContextNote>
    </>
  );
}

function StreetPlay({ onFinding }: { onFinding?: Found }) {
  const [left, setLeft] = useState(0),
    [right, setRight] = useState(0),
    [tested, setTested] = useState<string[]>([]),
    [city, setCity] = useState(false),
    [crossed, setCrossed] = useState(false);
  const { cue, respond, silence } = useDiscoverySound();
  const difference = Math.abs(left - right),
    done = tested.includes("together") && tested.includes("uneven") && crossed;
  useFieldTelemetry(
    left > 0 || right > 0
      ? { kind: "street", westCm: left, eastCm: right }
      : null,
  );
  useGameCheckpoints(
    "uneven",
    tested.includes("together"),
    tested.includes("uneven"),
    crossed,
  );
  useFinding(
    done,
    "A connection responds to the difference between its two ends.",
    onFinding,
  );
  const setEnds = (a: number, b: number) => {
    setLeft(a);
    setRight(b);
    if (a > 0 || b > 0)
      setTested((list) => [
        ...new Set([...list, a === b ? "together" : "uneven"]),
      ]);
    respond("strain", Math.abs(a - b) / 30);
  };
  return (
    <>
      <div className="play-stage play-street">
        <div className="play-visual">
          <StreetInstrument left={left} right={right} change={setEnds} />
        </div>
        <div className="play-dock">
          <div className="play-control-title">
            <small>Illustrated street · one pipe, two ends</small>
            <h3>
              {difference
                ? "The join is doing the bending."
                : "A big drop can stay level."}
            </h3>
          </div>
          <div
            className="ed-actions play-primary-actions"
            role="group"
            aria-label="Compare ground movement"
          >
            <button
              type="button"
              aria-label="Settle together"
              aria-pressed={tested.includes("together") && left === right}
              onClick={() => {
                setEnds(18, 18);
                cue("strain", 0);
              }}
            >
              Move together{" "}
              {tested.includes("together") && <Check size={16} />}
            </button>
            <button
              type="button"
              aria-label="Settle unevenly"
              aria-pressed={tested.includes("uneven") && left !== right}
              onClick={() => {
                setEnds(4, 18);
                cue("strain", 14);
              }}
            >
              Move unevenly {tested.includes("uneven") && <Check size={16} />}
            </button>
          </div>
          <ConnectionGauge
            compact
            left={left}
            right={right}
            onFound={() => setCrossed(true)}
          />
          <Echo
            found={done}
            telemetry={{ kind: "street", westCm: left, eastCm: right }}
            hint="Try an equal drop, then a mismatch. Inspect the connection in between."
          >
            {difference
              ? "Watch the short join between the blocks."
              : "Both blocks can move down without bending the pipe."}
          </Echo>
          <Restart
            reset={() => {
              setEnds(0, 0);
              setTested([]);
              setCrossed(false);
            }}
          />
        </div>
      </div>
      <details
        className="ed-details play-bonus"
        onToggle={(e) => setCity(e.currentTarget.open)}
      >
        <summary>
          Zoom out: explore the whole 3D city and collapse illustration
        </summary>
        {city && (
          <div className="ed-city-world">
            <CityScene
              mode="simulation"
              onSoundEvent={(event) =>
                event === "collapse" ? cue("collapse") : silence()
              }
              story
              exhibition
              ambient
              manualProgress
            />
            <p className="ed-evidence">
              Invented city · illustrative collapse, not a forecast. Material
              foley follows the illustration.
            </p>
          </div>
        )}
      </details>
      <ContextNote label="About this street experiment"><p>Invented geometry · teaching inputs, never engineering safety limits.</p></ContextNote>
    </>
  );
}

function RadarPlay({ onFinding }: { onFinding?: Found }) {
  const [state, setState] = useState(freshRadar),
    [site, setSite] = useState<RadarModelState["selectedSite"]>("centre"),
    [manualView, setManualView] = useState<
      RadarModelState["observation"] | null
    >(null),
    [depth, setDepth] = useState<number | null>(null),
    [probe, setProbe] = useState(120),
    [unwrapped, setUnwrapped] = useState(false),
    [pulse, setPulse] = useState(0);
  const { cue } = useDiscoverySound(),
    done = state.compared;
  useGameCheckpoints(
    "radar",
    state.first !== null,
    state.second !== null,
    state.compared,
  );
  useFinding(
    done,
    "Comparing repeat radar observations reveals a change in the echo.",
    onFinding,
  );
  const observation =
    manualView ??
    (state.compared ? "compare" : state.first === null ? "before" : "after");
  const change = useCallback((patch: Partial<RadarModelState>) => {
    if (patch.sinkingCm !== undefined)
      setState((old) =>
        radarStep(old, { type: "ground", value: patch.sinkingCm! }),
      );
    if (patch.selectedSite) setSite(patch.selectedSite);
    if (patch.observation) setManualView(patch.observation);
  }, []);
  const capture = () => {
    setManualView(null);
    setState((old) => radarStep(old, { type: "capture" }));
    setPulse((v) => v + 1);
    cue("capture");
  };
  const reset = () => {
    setState(freshRadar());
    setSite("centre");
    setManualView(null);
    setDepth(null);
    setProbe(120);
    setUnwrapped(false);
    setPulse(0);
  };
  const shownDepth =
    depth ??
    (state.compared
      ? Math.abs(state.second! - state.first!) / 100
      : state.sinking / 100);
  useFieldTelemetry(
    state.compared
      ? {
          kind: "radar",
          xM: depth !== null ? probe : 0,
          zM: 0,
          sinkingM: observation === "before" ? 0 : shownDepth,
        }
      : null,
  );
  const sample = radarSample(0, 0, shownDepth);
  return (
    <>
      <div className="play-stage play-radar" data-pulse={pulse}>
        <div className="play-visual">
          <div className="play-scene-heading">
            <span>ORBITAL DUET</span>
            <small>Synthetic radar</small>
          </div>
          <InterferogramConcept
            story
            experiment={{
              state: {
                sinkingCm: shownDepth * 100,
                probeXM: depth !== null ? probe : undefined,
                observation,
                selectedSite: site,
              },
              change,
              locked: state.first === null || state.second !== null,
              reset,
              pulseToken: pulse,
            }}
          />
        </div>
        <div className="play-dock">
          <div className="play-control-title">
            <small>
              {state.compared
                ? "THE HIDDEN CHANGE"
                : state.first === null
                  ? "VISIT ONE"
                  : "VISIT TWO"}
            </small>
            <h3>
              {state.compared
                ? "You caught a change."
                : state.first === null
                  ? "Save a baseline."
                  : state.second === null
                    ? "Move. Then revisit."
                    : "Let the echoes meet."}
            </h3>
          </div>
          <div className="ed-pass-strip" aria-label="Your two radar visits">
            <span data-saved={state.first !== null}>
              <Radar size={16} />
              First visit{" "}
              <b>{state.first === null ? "Waiting" : `${state.first} cm`}</b>
            </span>
            <ArrowRight size={18} />
            <span data-saved={state.second !== null}>
              <Radar size={16} />
              Repeat visit{" "}
              <b>{state.second === null ? "Waiting" : `${state.second} cm`}</b>
            </span>
          </div>
          <div className="ed-radar-console">
            {state.first !== null && state.second === null && (
              <label className="ed-slider">
                Move the ground <output>{state.sinking} cm down</output>
                <input
                  aria-label="Move the ground between visits"
                  type="range"
                  min="0"
                  max="30"
                  value={state.sinking}
                  onChange={(e) =>
                    setState((old) =>
                      radarStep(old, {
                        type: "ground",
                        value: Number(e.target.value),
                      }),
                    )
                  }
                />
                <small>Drag right. Then capture the repeat visit.</small>
              </label>
            )}
            <div className="ed-actions play-primary-actions">
              {state.second === null && (
                <button
                  type="button"
                  onClick={capture}
                  data-affordance="capture"
                  disabled={
                    state.first !== null && state.sinking === state.first
                  }
                >
                  {state.first === null
                    ? "Capture first echo"
                    : "Capture repeat echo"}
                  <Radar size={18} />
                </button>
              )}
              {state.second !== null && !state.compared && (
                <button
                  type="button"
                  data-affordance="compare"
                  onClick={() => {
                    setManualView(null);
                    setState((old) => radarStep(old, { type: "compare" }));
                    setPulse((v) => v + 1);
                    cue("found");
                  }}
                >
                  Reveal the difference
                </button>
              )}
            </div>
          </div>
          {state.compared && (
            <div className="play-radar-result">
              <b>{sample.cycles.toFixed(2)} phase cycles</b>
              <span>
                at the bowl centre · colours repeat, movement keeps adding up
              </span>
            </div>
          )}
          <Echo
            found={done}
            telemetry={
              state.compared
                ? {
                    kind: "radar",
                    xM: probe,
                    zM: 0,
                    sinkingM: observation === "before" ? 0 : shownDepth,
                  }
                : undefined
            }
            hint={
              state.first === null
                ? "Capture the first echo. No ground movement yet."
                : state.second === null
                  ? "Move the ground slider above zero, then capture the repeat echo."
                  : "Reveal the difference. Both visits are saved and stay fixed."
            }
          >
            {radarCue(state)}
          </Echo>
          <Restart reset={reset} />
        </div>
      </div>
      {state.compared && (
        <details className="ed-details play-bonus">
          <summary>
            {unwrapped ? "✓ " : ""}Extra challenge: two depths, one colour. Can
            you break the tie?
          </summary>
          <PhaseInstrument
            sinkingM={observation === "before" ? 0 : shownDepth}
            probeX={probe}
            onProbe={setProbe}
            onDepth={(v) => {
              setDepth(v);
              setManualView("compare");
            }}
            challenge
            onSolved={() => setUnwrapped(true)}
          />
        </details>
      )}
      <ContextNote label="About this radar experiment"><p>Synthetic repeat-pass experiment · same-orbit geometry · not an acquired image.</p></ContextNote>
    </>
  );
}

function EvidencePlay({ onFinding, radarOnly = false }: { onFinding?: Found; radarOnly?: boolean }) {
  const activity = useContext(GameActivity);
  const [view, setView] = useState<"map" | "city" | "radar" | "footprints">(
    radarOnly ? "radar" : activity ? "map" : "city",
  );
  const [proofs, setProofs] = useState({
    ground: false,
    footprint: false,
    radar: false,
  });
  const record = useGame()?.record;
  const mark = useCallback(
    (key: keyof typeof proofs) =>
      setProofs((old) => (old[key] ? old : { ...old, [key]: true })),
    [],
  );
  const inspectRadar = useCallback(
    (point: RadarInspection) => {
      record?.({ kind: "backscatter", ...point });
      if (point.differenceDb !== null) mark("radar");
    },
    [record, mark],
  );
  const done = proofs.ground;
  useGameCheckpoints("evidence", proofs.ground, proofs.footprint, proofs.radar);
  useFinding(
    done,
    "A missing satellite measurement is not evidence of zero movement.",
    onFinding,
  );
  return (
    <>
      {!radarOnly && <div
        className="ed-view-switch"
        role="group"
        aria-label="Explore real observations"
      >
        {(
          [
            ["map", "Ground map"],
            ["city", "3D city"],
            ["radar", "Radar images"],
            ["footprints", "Inspect footprints"],
          ] as const
        ).map(([value, text]) => (
          <button
            type="button"
            key={value}
            data-affordance={value === "map" ? "ground-map" : undefined}
            aria-pressed={view === value}
            onClick={() => setView(value)}
          >
            {text}
          </button>
        ))}
      </div>}
      {view === "map" ? (
        <GameActivity.Provider value={null}>
          <CheckedMap onFinding={() => mark("ground")} />
        </GameActivity.Provider>
      ) : view === "footprints" ? (
        <FootprintAudit onProof={() => mark("footprint")} />
      ) : view === "city" ? (
        <>
          <CityScene mode="measured" story exhibition ambient />
          <Echo hint="The 3D view gives this record a place. Open Ground map to sample a measured pixel and compare it with a gap.">
            This is a real mapped neighbourhood. The motion is exaggerated so
            you can see it; the buildings are not being diagnosed.
          </Echo>

        </>
      ) : (
        <>
          <p className="ed-invitation">
            Another kind of change: slide between two real radar visits to Lake
            Mead.
          </p>
          <Suspense
            fallback={<p role="status">Opening the checked radar images…</p>}
          >
            <RealRadar onInspect={inspectRadar} />
          </Suspense>


        </>
      )}
      {activity && (
        <details
          className="ex-truth-audit play-bonus"
          aria-label="Three claims to investigate"
        >
          <summary>Extra investigations: three claims to test</summary>
          <ol>
            <li data-proved={proofs.ground}>
              <span>{proofs.ground ? "Evidence kept" : "Open claim"}</span>{" "}
              “That blank patch must be stable.”{" "}
              <small>Inspect a measured patch and a gap.</small>
            </li>
            <li data-proved={proofs.footprint}>
              <span>{proofs.footprint ? "Evidence kept" : "Open claim"}</span>{" "}
              “This uncertain ground tilt proves the building is unsafe.”{" "}
              <small>Inspect a footprint with tilt below2σ.</small>
            </li>
            <li data-proved={proofs.radar}>
              <span>{proofs.radar ? "Evidence kept" : "Open claim"}</span> “A dB
              change tells us how many metres the lake fell.”{" "}
              <small>Probe a real Lake Mead pixel and read its unit.</small>
            </li>
          </ol>
        </details>
      )}
    </>
  );
}
function CheckedMap({ onFinding }: { onFinding?: Found }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <CheckedMapAttempt
      key={attempt}
      onFinding={onFinding}
      retry={() => setAttempt((a) => a + 1)}
    />
  );
}
function CheckedMapAttempt({
  onFinding,
  retry,
}: {
  onFinding?: Found;
  retry: () => void;
}) {
  const result = useNisarBundle(NISAR_BUNDLES.tehran);
  if (!result || result.status === "loading")
    return (
      <p className="ed-loading" role="status">
        Checking the satellite record before showing its measurements…
      </p>
    );
  if (result.status === "error")
    return (
      <div role="alert">
        <p>
          The observation bundle could not be verified. No invented observations
          have been substituted.
        </p>
        <button type="button" onClick={retry}>
          Retry the checked map
        </button>
      </div>
    );
  return <EvidenceMap bundle={result.data} onFinding={onFinding} />;
}
export function EvidenceMap({
  bundle,
  onFinding,
}: {
  bundle: LoadedBundle;
  onFinding?: Found;
}) {
  const { manifest: m, grid, imageUrl } = bundle;
  const [selected, setSelected] = useState<{ lat: number; lng: number } | null>(
      null,
    ),
    [seen, setSeen] = useState<string[]>([]),
    [imageError, setImageError] = useState(false),
    [kept, setKept] = useState<{
      lat: number;
      lng: number;
      rate: number;
      sigma: number | null;
    } | null>(null);
  const { cue } = useDiscoverySound();
  const [west, south, east, north] = m.bbox_lonlat,
    merc = (lat: number) =>
      Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const aspect = ((east - west) * Math.PI) / 180 / (merc(north) - merc(south));
  const reading = selected
      ? gridLookup(grid, selected.lat, selected.lng)
      : null,
    done = seen.includes("measured") && seen.includes("gap");
  useGameCheckpoints(
    "evidence",
    seen.includes("measured"),
    seen.includes("gap"),
  );
  useFinding(
    done,
    "A blank satellite pixel is missing evidence, not proof of stable ground.",
    onFinding,
  );
  const inspect = (lat: number, lng: number) => {
    setSelected({ lat, lng });
    const cell = gridLookup(grid, lat, lng);
    setSeen((s) => [
      ...new Set([...s, cell?.rate != null ? "measured" : "gap"]),
    ]);
    cue("capture");
  };
  const find = (measured: boolean) => {
    const neighbourhood = m.stats.fastest_neighbourhood;
    if (
      measured &&
      neighbourhood &&
      gridLookup(grid, neighbourhood.lat, neighbourhood.lon)?.rate != null
    ) {
      inspect(neighbourhood.lat, neighbourhood.lon);
      return;
    }
    const index = grid.vertical_rate.findIndex((v) =>
      measured ? v !== null && Number.isFinite(v) : v === null,
    );
    if (index >= 0)
      inspect(
        grid.north - (Math.floor(index / grid.cols) + 0.5) * grid.dlat,
        grid.west + ((index % grid.cols) + 0.5) * grid.dlon,
      );
  };
  useFieldTelemetry(
    selected
      ? {
          kind: "ground",
          ...selected,
          rate: reading?.rate ?? null,
          sigma: reading?.sigma ?? null,
        }
      : null,
  );
  const pin = selected
    ? {
        left: `${((selected.lng - west) / (east - west)) * 100}%`,
        top: `${((merc(north) - merc(selected.lat)) / (merc(north) - merc(south))) * 100}%`,
      }
    : null;
  if (imageError)
    return (
      <div role="alert">
        <p>
          The verified map image could not be displayed. The full measured
          explorer has a text and grid reading alternative.
        </p>
        <a href="/explore">Open the measured explorer</a>
      </div>
    );
  const companion = (
    <Echo
      found={done}
      telemetry={
        selected
          ? {
              kind: "ground",
              ...selected,
              rate: reading?.rate ?? null,
              sigma: reading?.sigma ?? null,
            }
          : undefined
      }
      hint="Select a coloured patch, then compare a gap. You can also use the two sampling buttons or arrow keys."
    >
      {!selected
        ? "This time the record is real. Pick a patch and see what the satellite can tell us."
        : reading?.rate != null
          ? directEcho({
              kind: "ground",
              ...selected,
              rate: reading.rate,
              sigma: reading.sigma,
            }).text
          : "The satellite did not give us a usable value here. Missing is not zero."}
    </Echo>
  );
  const controls = (
    <div className="ed-instrument-bar">
      <div className="ed-actions">
        <button
          type="button"
          data-affordance="sample-patch"
          onClick={() => find(true)}
        >
          Sample patch
        </button>
        <button
          type="button"
          data-affordance="find-gap"
          onClick={() => find(false)}
        >
          Find gap
        </button>
        <button
          type="button"
          disabled={!selected || reading?.rate == null}
          onClick={() => {
            if (selected && reading?.rate != null)
              setKept({
                ...selected,
                rate: reading.rate,
                sigma: reading.sigma,
              });
          }}
        >
          Pin this reading
        </button>
      </div>
      <output className="ed-reading" aria-live="polite">
        {!selected ? (
          "Tap any patch"
        ) : reading?.rate != null ? (
          <>
            <strong>{formatVertical(reading.rate)}</strong>
            {reading.sigma !== null && (
              <span>±{Math.round(reading.sigma)} mm/year</span>
            )}
          </>
        ) : (
          <strong>No measurement here</strong>
        )}
      </output>
    </div>
  );
  const map = (
    <figure className="ed-evidence-map">
      <div
        className="ed-map-image"
        role="group"
        tabIndex={0}
        aria-label="Tehran measured ground-motion map. Tap to inspect; use arrow keys to move a sampling point."
        style={{
          aspectRatio: aspect,
          width: `min(100%, calc((var(--play-height, 420px) - 72px) * ${aspect}))`,
        }}
        onClick={(e) => {
          const b = e.currentTarget.getBoundingClientRect();
          if (!b.width || !b.height) return;
          const x = Math.max(
              0,
              Math.min(0.999, (e.clientX - b.left) / b.width),
            ),
            y = Math.max(0, Math.min(0.999, (e.clientY - b.top) / b.height));
          inspect(
            (2 *
              Math.atan(
                Math.exp(merc(north) + (merc(south) - merc(north)) * y),
              ) *
              180) /
              Math.PI -
              90,
            west + (east - west) * x,
          );
        }}
        onKeyDown={(e) => {
          const directions: Record<string, [number, number]> = {
            ArrowLeft: [0, -1],
            ArrowRight: [0, 1],
            ArrowUp: [1, 0],
            ArrowDown: [-1, 0],
          };
          const d = directions[e.key];
          if (!d) return;
          e.preventDefault();
          inspect(
            Math.max(
              south + grid.dlat / 2,
              Math.min(
                north - grid.dlat / 2,
                (selected?.lat ?? (south + north) / 2) + d[0] * grid.dlat,
              ),
            ),
            Math.max(
              west + grid.dlon / 2,
              Math.min(
                east - grid.dlon / 2,
                (selected?.lng ?? (west + east) / 2) + d[1] * grid.dlon,
              ),
            ),
          );
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Verified radar-derived Tehran ground-motion map. Warm regions show relative sinking; transparent gaps have no measurement."
          onError={() => setImageError(true)}
        />
        {kept && (
          <span
            className="ed-map-pin ea-kept-pin"
            style={{
              left: `${((kept.lng - west) / (east - west)) * 100}%`,
              top: `${((merc(north) - merc(kept.lat)) / (merc(north) - merc(south))) * 100}%`,
            }}
            aria-hidden="true"
          >
            A
          </span>
        )}
        {pin && <span className="ed-map-pin" style={pin} aria-hidden="true" />}
      </div>
      <figcaption>
        Measured · {formatPeriod(m)} · {m.source.product_status} NISAR L-band
      </figcaption>
    </figure>
  );
  return (
    <>
      <div className="play-stage play-map">
        <div className="play-visual">
          <div className="play-scene-heading">
            <span>ASK THE SATELLITE</span>
            <small>Measured · Tehran</small>
          </div>
          {map}
        </div>
        <div className="play-dock">
          <div className="play-control-title">
            <small>REAL DATA. REAL GAPS.</small>
            <h3>
              {!selected
                ? "What can this patch tell us?"
                : reading?.rate != null
                  ? "A measurement. With uncertainty."
                  : "No answer is still a clue."}
            </h3>
          </div>
          {controls}
          {companion}
        </div>
      </div>

      {kept && (
        <div
          className="ea-point-comparison"
          aria-label="Compare your two inspected locations"
        >
          <div>
            <span>Pinned point A</span>
            <strong>{formatVertical(kept.rate)}</strong>
            <small>
              {kept.sigma === null
                ? "Uncertainty not supplied"
                : `±${Math.round(kept.sigma)} mm/year`}
            </small>
          </div>
          <div>
            <span>Current point B</span>
            <strong>
              {reading?.rate != null
                ? formatVertical(reading.rate)
                : "No measurement"}
            </strong>
            <small>
              {reading?.sigma != null
                ? `±${Math.round(reading.sigma)} mm/year`
                : "A gap cannot stand in for zero"}
            </small>
          </div>
          <p>
            Two local estimates, not a continuous ground profile. Their
            uncertainties and the short observation period still apply.
          </p>
          <button type="button" onClick={() => setKept(null)}>
            Clear pinned point
          </button>
        </div>
      )}
      {reading?.rate != null && (
        <HumanScale
          value={reading.rate}
          unit="mm/yr"
          label={`${reading.rate < 0 ? "Downward" : reading.rate > 0 ? "Upward" : "Zero"} relative ground-motion rate at your selected patch`}
        />
      )}
      <div className="ed-map-key">
        <i style={{ background: rampGradient(m) }} />
        <span>
          {m.layers.vertical_rate.colour.limit_mm_per_year} mm/year down
        </span>
        <span>0</span>
        <span>
          {m.layers.vertical_rate.colour.limit_mm_per_year} mm/year up
        </span>
      </div>

      <p className="ed-evidence">Relative rate · gaps are unmeasured · not a building assessment</p>
      <ContextNote label="About these ground readings"><p>The short record is expressed as a yearly rate, not an absolute height change. Typical pixel uncertainty ±{Math.round(m.stats.median_sigma)} mm/year. Individual inspected values retain their own uncertainty.</p></ContextNote>
    </>
  );
}

function TokyoPlay({ onFinding }: { onFinding?: Found }) {
  const [plan, setPlan] = useState(freshPlan),
    [ran, setRan] = useState(false),
    { cue } = useDiscoverySound();
  const done = ran && (plan.limits || plan.supply) && plan.monitor;
  useGameCheckpoints(
    "tokyo",
    ran && (plan.limits || plan.supply),
    ran && plan.monitor,
  );
  useFinding(
    done,
    "Act on groundwater withdrawal and use repeat monitoring to check what changes.",
    onFinding,
  );
  return (
    <>
      <div className="play-policy">
        <PolicyCity
          plan={plan}
          onChange={(key) => {
            setPlan((old) => ({ ...old, [key]: !old[key] }));
            setRan(true);
            cue(key === "monitor" ? "capture" : "water");
          }}
        >
          <Echo
            found={done}
            hint="Connect another water route or limit the well. Then turn on monitoring to check what changes."
          >
            {done
              ? "You changed a cause and added a way to check the result. Lost height does not reset."
              : plan.monitor
                ? "Monitoring tells us what changes. It does not turn down a well."
                : "Which route could take some pressure off this well?"}
          </Echo>
          <Restart
            reset={() => {
              setPlan(freshPlan());
              setRan(false);
            }}
          />
        </PolicyCity>
      </div>
      <details className="ed-details play-bonus">
        <summary>Extra challenge: change when the city acts</summary>
        <PolicyInstrument />
      </details>
      <details className="ed-details">
        <summary>Tokyo changed course. See the real story.</summary>
        <p>This response is illustrated: no policy effect or recovery rate is estimated for Tehran.</p>
        <StoryPhotography subject="tokyo" />
        <TokyoStory story />
      </details>
      <p className="ed-evidence">
        Illustrated response · not a forecast for Tehran.
      </p>
    </>
  );
}
