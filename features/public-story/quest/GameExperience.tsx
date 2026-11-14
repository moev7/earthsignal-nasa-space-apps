"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Compass, Map, RotateCcw, X } from "lucide-react";
import {
  MISSION_IDS,
  MISSIONS,
  missionScore,
  type MissionId,
} from "@/lib/story-missions";
import { CityScene } from "@/features/ground-truth/components/story/CityScene";
import { useStory } from "@/features/ground-truth/components/story/StoryProvider";
import { usePrefersReducedMotion } from "@/features/ground-truth/lib/useTimeline";
import { StoryPhotography } from "../StoryPhotography";
import { Sources } from "../Sources";
import { MissionProgress, useMissions } from "../missions/StoryMissions";
import { ClueIcon } from "./QuestExperience";
import { MissionGuide } from "./MissionGuide";
import { GameActivity, GameObjective, FindingReward } from "./GameObjective";
import { DiscoveryWorld } from "../discovery/DiscoveryWorld";
import {
  SoundSwitch,
  SoundEntrance,
  useDiscoverySound,
} from "../discovery/DiscoverySound";
import { directEcho } from "@/lib/echo-director";
import { FieldNoteArt } from "../discovery/FieldNoteArt";
import { useGame, type GameChapter } from "./GameDirector";
import { CLUES, nextClue } from "./quest-model";
import { EchoPortrait, FieldMap } from "./GameArt";
import "./game.css";
import "../discovery/playable.css";
import "../discovery/discovery.css";

const TITLES: Record<MissionId, string> = {
  aquifer: "Can you bring the street back?",
  uneven: "Bend the connection.",
  radar: "Catch an echo. Change the ground.",
  evidence: "Now ask the real satellite.",
  tokyo: "Write a different ending.",
};
const HOOKS: Record<MissionId, string> = {
  aquifer: "The street moved. What happens when the two ends move differently?",
  uneven: "One street is a start. How could we watch an entire region?",
  radar: "You made a signal. Now see what a real satellite actually recorded.",
  evidence:
    "A measurement cannot write the future. A city can still change course.",
  tokyo:
    "You followed the water, caught the echo and found a way to act. Take that curiosity to your own place.",
};
function GameOpening() {
  const director = useGame()!,
    { progress, setEnabled } = useMissions();
  const first = nextClue(progress.completed) ?? "aquifer";
  return (
    <section
      id="opening"
      className="ed-game-opening"
      aria-labelledby="eg-opening-title"
    >
      <div>
        <h1 id="eg-opening-title" tabIndex={-1} data-game-title="opening">
          The city keeps a secret.
          <br />
          <em>You have the instruments.</em>
        </h1>
        <p>
          A street looks perfectly still. Your job: uncover what is moving,
          catch its echo, and decide what deserves a closer look. Pull a well
          valve. Bend a pipe. Catch a colour that repeats. Every clue you keep
          comes from something you actually tried.
        </p>
        <div className="ed-opening-voice">
          <EchoPortrait />
          <p>
            “I’m Echo. Pull things apart. Try the opposite. I’ll notice what
            your instruments reveal.”
          </p>
        </div>
        <div className="ed-instrument-bar">
          <SoundEntrance
            label={
              progress.completed.length
                ? "Pick up the trail"
                : "Start the investigation"
            }
            onBegin={() => {
              if (!progress.enabled) setEnabled(true);
              director.navigate(CLUES[first].chapter as GameChapter);
            }}
          />
          <SoundSwitch />
        </div>
        <p className="ed-evidence">
          No timer. No wrong-turn penalty. Every station is open.
        </p>
      </div>
      <div className="ed-game-city">
        <CityScene mode="measured" preview ambient exhibition />
        <div className="ep-opening-route">
          <h2>Your five leads</h2>
          <FieldMap compact />
        </div>
      </div>
    </section>
  );
}
function MissionDeck({ id }: { id: MissionId }) {
  const director = useGame()!,
    { progress, ready, answer } = useMissions(),
    { cue } = useDiscoverySound();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [checkpoints, setCheckpoints] = useState(0),
    [reward, setReward] = useState(false);
  const activity = useCallback(
    (mission: MissionId, mask: number) => {
      if (mission === id) setCheckpoints(mask);
    },
    [id],
  );
  const earned = progress.completed.includes(id),
    next = MISSION_IDS[MISSION_IDS.indexOf(id) + 1];
  const collect = useCallback(
    (message: string) => {
      if (!ready) return;
      director.report(id, { correct: true, message });
      if (!progress.completed.includes(id)) {
        answer(id, MISSIONS[id].correct);
        setReward(true);
        cue("found");
      }
    },
    [id, ready, progress.completed, director, answer, cue],
  );
  return (
    <section
      id={CLUES[id].chapter}
      className="ed-mission"
      data-mission={id}
      aria-labelledby="eg-mission-title"
    >
      <header className="ed-mission-heading">
        <h1
          ref={headingRef}
          id="eg-mission-title"
          tabIndex={-1}
          data-game-title={CLUES[id].chapter}
        >
          {TITLES[id]}
        </h1>
      </header>

      <GameObjective id={id} mask={checkpoints} earned={earned} />
      <MissionGuide id={id} mask={checkpoints} earned={earned}>
        <GameActivity.Provider value={activity}>
          <div data-world={id} id={id === "radar" ? "radar-model" : undefined}>
            <DiscoveryWorld
              id={id}
              invitation={false}
              onFinding={ready ? collect : undefined}
            />
          </div>
        </GameActivity.Provider>
      </MissionGuide>
      {reward && (
        <FindingReward
          id={id}
          dismiss={() => {
            setReward(false);
            headingRef.current?.focus({ preventScroll: true });
          }}
          next={() =>
            director.navigate(
              next ? (CLUES[next].chapter as GameChapter) : "case-file",
            )
          }
        />
      )}
      {id === "radar" && (
        <details className="ed-details">
          <summary>Meet the spacecraft that makes this possible</summary>
          <StoryPhotography subject="nisar" />
        </details>
      )}
      <div className="ed-game-next">
        <p>
          {earned && (
            <strong>
              <Check size={16} /> Finding collected
            </strong>
          )}
          {HOOKS[id]}
        </p>
        <button
          type="button"
          className="eg-launch"
          onClick={() =>
            director.navigate(
              next ? (CLUES[next].chapter as GameChapter) : "case-file",
            )
          }
        >
          {next ? "Follow the next lead" : "Open your field report"}
          <ArrowRight size={18} />
        </button>
      </div>
    </section>
  );
}
function EvidenceRoom() {
  const director = useGame()!,
    { progress } = useMissions();
  const [selected, setSelected] = useState<MissionId>("aquifer");
  const [question, setQuestion] = useState(
    "How much water leaves the ground beneath my community?",
  );
  const [postcard, setPostcard] = useState<{
    url: string;
    text: string;
  } | null>(null);
  const postcardUrl = useRef<string | null>(null);
  const releasePostcard = useCallback(() => {
    if (postcardUrl.current) URL.revokeObjectURL(postcardUrl.current);
  }, []);
  useEffect(() => releasePostcard, [releasePostcard]);
  const save = () => {
    const content = [
      "EARTHSIGNAL — MY FIELD POSTCARD",
      "",
      ...MISSION_IDS.filter((id) => progress.completed.includes(id)).map(
        (id) => CLUES[id].finding,
      ),
      "",
      "MY INSTRUMENT READINGS (PUBLIC GAME STATE)",
      ...(director.notes.length
        ? director.notes.flatMap((note) => [
            directEcho(note).stamp,
            ...directEcho(note).lines,
            "",
          ])
        : [
            "No instrument readings kept in this browser session. Earlier badges do not reconstruct missing telemetry.",
          ]),
      "My next question: " + question,
      "",
      "Tehran: provisional NISAR ground-motion estimate, 18 June–21 October 2026. Short-record relative rate; uncertainty applies. Illustrations are not observations. No building-collapse diagnosis or date.",
      "",
      "Explore the record: https://nasa.r8volt.com/explore",
      "NASA challenge: https://www.spaceappschallenge.org/2026/challenges/dancing-with-the-sars/",
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
    );
    if (postcardUrl.current) URL.revokeObjectURL(postcardUrl.current);
    postcardUrl.current = url;
    setPostcard({ url, text: content });
    const link = document.createElement("a");
    link.href = url;
    link.download = "earthsignal-field-postcard.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };
  return (
    <section
      id="case-file"
      className="eg-evidence-room"
      aria-labelledby="eg-evidence-title"
    >
      <header className="ed-mission-heading">
        <h1 id="eg-evidence-title" tabIndex={-1} data-game-title="case-file">
          You caught
          <br />
          <em>the invisible.</em>
        </h1>
        <EchoPortrait mood={progress.completed.length ? "found" : "curious"} />
      </header>
      <p>
        Groundwater, a changing street, a repeat echo, a record with gaps—and a
        city that chose another path.
      </p>
      <section
        className="ex-dossier"
        aria-label="Your field investigation dossier"
        data-complete={progress.completed.length === 5}
      >
        <header>
          <div>
            <small>EARTHSIGNAL / FIELD DOSSIER</small>
            <h2>
              {progress.completed.length === 5
                ? "The invisible has a paper trail."
                : "Your investigation, in evidence."}
            </h2>
          </div>
          <span>{progress.completed.length}/5 findings</span>
        </header>
        <div className="ex-dossier-readings">
          {director.notes.map((note, index) => {
            const reading = directEcho(note);
            return (
              <article key={`${note.kind}:${index}`}>
                <span>{reading.stamp}</span>
                <h3>
                  {note.kind === "ground"
                    ? note.rate === null
                      ? "Tehran / missing evidence"
                      : "Tehran / motion"
                    : note.kind === "backscatter"
                      ? "Lake Mead / echo"
                      : note.kind === "radar"
                        ? "The orbital duet"
                        : note.kind === "season"
                          ? "Four dry seasons"
                          : note.kind === "policy"
                            ? "A different next chapter"
                            : note.kind === "footprint"
                              ? "An outline is not a verdict"
                              : note.kind === "street"
                                ? "A connection under strain"
                                : "Water has a memory"}
                </h3>
                <FieldNoteArt note={note} />
                {reading.lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </article>
            );
          })}
          {!director.notes.length && (
            <p>
              Your instrument readings will appear here as you investigate.
              Earlier badges do not invent readings that were not kept.
            </p>
          )}
        </div>
        <p className="ed-evidence">
          Kept on this device · real records, synthetic radar and authored
          scenarios retain separate labels and units.
        </p>
      </section>
      <div className="ed-report">
        <div
          className="ed-report-stamps"
          role="group"
          aria-label="Your five discoveries"
        >
          {MISSION_IDS.map((id) => (
            <button
              type="button"
              key={id}
              aria-pressed={selected === id}
              onClick={() => setSelected(id)}
            >
              <ClueIcon id={id} size={24} />
              <span>{CLUES[id].title}</span>
              {progress.completed.includes(id) && <Check size={17} />}
            </button>
          ))}
        </div>
        <div className="ed-report-finding">
          <h2>{CLUES[selected].title}</h2>
          <p>
            {progress.completed.includes(selected)
              ? CLUES[selected].finding
              : "This lead is still open. Try its experiment, or keep exploring."}
          </p>
          <button
            type="button"
            onClick={() =>
              director.navigate(CLUES[selected].chapter as GameChapter)
            }
          >
            Revisit this discovery <ArrowRight size={16} />
          </button>
        </div>
        <label className="ed-report-question">
          Your next question
          <textarea
            value={question}
            maxLength={500}
            rows={3}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        <button type="button" className="eg-launch" onClick={save}>
          Save my field postcard <ArrowRight size={17} />
        </button>
        <p className="ed-evidence">
          Your question stays on your device. You can also preview and copy the
          text.
        </p>
        {postcard && (
          <div className="ed-postcard-ready">
            <p role="status">
              Your field postcard is ready.{" "}
              <a href={postcard.url} download="earthsignal-field-postcard.txt">
                Download the text file
              </a>
            </p>
            <details className="ed-details" open>
              <summary>Preview &amp; copy your postcard</summary>
              <textarea
                aria-label="Your complete field postcard"
                rows={12}
                readOnly
                value={postcard.text}
              />
            </details>
          </div>
        )}
      </div>
      <button
        type="button"
        className="eg-launch"
        onClick={() => director.navigate("opening")}
      >
        Return to the field map <Map size={18} />
      </button>
    </section>
  );
}
export function GameExperience() {
  const director = useGame()!,
    { progress } = useMissions(),
    { paused, replayToken } = useStory(),
    reduced = usePrefersReducedMotion();
  const id = MISSION_IDS.find((id) => CLUES[id].chapter === director.chapter);
  const [expandedChapter, setExpandedChapter] = useState<GameChapter | null>(
      null,
    ),
    mapOpen = expandedChapter === director.chapter;
  const mapToggle = useRef<HTMLButtonElement>(null);
  return (
    <div
      className="eg-game es-wrap ea-game"
      data-motion={paused || reduced ? "still" : "active"}
      onKeyDown={(e) => {
        if (e.key === "Escape" && mapOpen) {
          setExpandedChapter(null);
          mapToggle.current?.focus();
        }
      }}
    >
      <div className="eg-status-ribbon">
        <div className="ep-campaign">
          <span>PLAY WITH ECHO</span>
          <strong>
            {missionScore(progress)} <small>points</small>
          </strong>
        </div>
        <nav className="ep-route" aria-label="Investigation trail">
          {MISSION_IDS.map((stop, index) => (
            <button
              key={stop}
              type="button"
              aria-label={`${index + 1}. ${CLUES[stop].title}${progress.completed.includes(stop) ? ", collected" : ""}`}
              aria-current={stop === id ? "step" : undefined}
              data-earned={progress.completed.includes(stop)}
              onClick={() =>
                director.navigate(CLUES[stop].chapter as GameChapter)
              }
            >
              <ClueIcon id={stop} size={18} />
              <span>{index + 1}</span>
              {progress.completed.includes(stop) && <Check size={12} />}
            </button>
          ))}
        </nav>
        <div className="ep-hud-actions">
          <button
            type="button"
            ref={mapToggle}
            aria-expanded={mapOpen}
            aria-controls="eg-all-stations"
            onClick={() =>
              setExpandedChapter(mapOpen ? null : director.chapter)
            }
          >
            {mapOpen ? <X size={16} /> : <Map size={16} />}
            {mapOpen ? "Close map" : "All stations"}
          </button>
          <button type="button" onClick={() => director.navigate("case-file")}>
            <Compass size={16} />
            {progress.completed.length}/5 findings
          </button>
          <SoundSwitch iconOnly />
        </div>
      </div>
      {mapOpen && (
        <div
          id="eg-all-stations"
          className="eg-expanded-map"
          onClick={(e) => {
            if ((e.target as Element).closest("a")) setExpandedChapter(null);
          }}
        >
          <FieldMap compact />
        </div>
      )}
      <div key={`${director.chapter}:${progress.generation}:${replayToken}`}>
        {director.chapter === "opening" ? (
          <GameOpening />
        ) : id ? (
          <MissionDeck id={id} />
        ) : (
          <EvidenceRoom />
        )}
      </div>
      <div className="eg-settings">
        <details>
          <summary>
            <RotateCcw size={15} />
            Progress &amp; game controls
          </summary>
          <MissionProgress compact={false} game />
          <p>
            Replay gives the current experiment a fresh start. Collected
            findings stay. Reset progress clears your collection in this
            browser.
          </p>
        </details>
        <a
          href={`/#${director.chapter === "case-file" ? "what-we-can-do" : director.chapter}`}
        >
          Return to the story <ArrowRight size={16} />
        </a>
      </div>
      <div className="eg-sources">
        <Sources />
      </div>
    </div>
  );
}

import "../discovery/alive.css";
