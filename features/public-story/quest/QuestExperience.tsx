"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  Droplets,
  Fingerprint,
  Radio,
  ScanLine,
  Search,
  ShieldCheck,
  Waves,
} from "lucide-react";
import { MISSION_IDS, type MissionId } from "@/lib/story-missions";
import { useStory } from "@/features/ground-truth/components/story/StoryProvider";
import { usePrefersReducedMotion } from "@/features/ground-truth/lib/useTimeline";
import { useMissions } from "../missions/StoryMissions";
import { CLUES, investigatorRank, nextClue } from "./quest-model";
import "./quest.css";
import { useGame } from "./GameDirector";

const ICONS = {
  aquifer: Droplets,
  uneven: Waves,
  radar: Radio,
  evidence: ScanLine,
  tokyo: ShieldCheck,
};
export function ClueIcon({ id, size = 20 }: { id: MissionId; size?: number }) {
  const Icon = ICONS[id];
  return <Icon size={size} aria-hidden="true" />;
}

/** A single interaction-triggered CSS reward. No timer, render loop or resume. */
export function useQuestReward(initial = false) {
  const { paused } = useStory();
  const reduced = usePrefersReducedMotion();
  const [fresh, setFresh] = useState(initial);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let active = true;
    if (paused || reduced)
      queueMicrotask(() => {
        if (active) setFresh(false);
      });
    const stop = () => {
      if (document.visibilityState === "hidden") setFresh(false);
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            if (!entry.isIntersecting) setFresh(false);
          });
    if (host) observer?.observe(host);
    document.addEventListener("visibilitychange", stop);
    stop();
    return () => {
      active = false;
      observer?.disconnect();
      document.removeEventListener("visibilitychange", stop);
    };
  }, [paused, reduced, host]);
  return {
    setHost,
    fresh: fresh && !paused && !reduced,
    celebrate: () => {
      if (!paused && !reduced && document.visibilityState !== "hidden")
        setFresh(true);
    },
    settle: () => setFresh(false),
  };
}

export function QuestTrail({ current }: { current?: string }) {
  const director = useGame();
  const { progress } = useMissions();
  return (
    <nav className="es-quest-trail" aria-label="Five-clue investigation">
      <span className="es-quest-trail-title">
        <Fingerprint size={17} aria-hidden="true" />
        <span>The case</span>
      </span>
      <ol>
        {MISSION_IDS.map((id, index) => {
          const earned = progress.completed.includes(id),
            clue = CLUES[id];
          return (
            <li key={id}>
              <a
                href={`#${clue.chapter}`}
                onClick={director ? (event) => { event.preventDefault(); director.navigate(CLUES[id].chapter as import("./GameDirector").GameChapter); } : undefined}
                aria-current={current === clue.chapter ? "location" : undefined}
                aria-label={`Clue ${index + 1}: ${clue.title}. ${earned ? "Found" : "Explore"}`}
                data-earned={earned}
              >
                <span className="es-quest-node">
                  {earned ? <Check size={15} aria-hidden="true" /> : index + 1}
                </span>
                <span className="es-quest-node-label">{clue.verb}</span>
              </a>
            </li>
          );
        })}
      </ol>
      {director && director.chapter !== "opening" && director.chapter !== "case-file" && <button className="es-quest-echo-link" type="button" onClick={() => { const guide = document.querySelector<HTMLElement>(".ed-echo"); guide?.focus({ preventScroll: true }); guide?.scrollIntoView({ block: "center", behavior: "instant" }); }}>Ask Echo</button>}
      <a
        className="es-quest-file-link"
        href="#case-file"
        onClick={director ? (event) => { event.preventDefault(); director.navigate("case-file"); } : undefined}
        aria-label={`Open case file, ${progress.completed.length} of 5 clues found`}
      >
        {progress.completed.length}/5 <span>clues</span>
        <ArrowRight size={15} aria-hidden="true" />
      </a>
    </nav>
  );
}

export function CaseOpening({
  children,
}: {
  children: (revealed: boolean) => ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const { setHost: rewardRef, fresh, celebrate, settle } = useQuestReward();
  return (
    <div
      className="es-case-opening"
      ref={rewardRef}
      data-revealed={revealed}
      data-scan={fresh}
      onAnimationEnd={settle}
    >
      <div className="es-case-brief">
        <p className="es-quest-eyebrow">
          <Fingerprint size={17} aria-hidden="true" /> Case 01 · The sinking
          city
        </p>
        <h1 id="opening-title">
          Something
          <br />
          is moving.
          <br />
          <span>Find out why.</span>
        </h1>
        <p>
          A city looks still. The ground tells another story. You’re the
          investigator.
        </p>
        <button
          type="button"
          className="es-quest-primary es-case-start"
          aria-expanded={revealed}
          aria-controls="opening-clue"
          onClick={() => {
            setRevealed(true);
            celebrate();
          }}
        >
          <Search size={19} aria-hidden="true" />
          {revealed ? "Reveal the pattern again" : "Reveal the hidden pattern"}
        </button>
        <div id="opening-clue" className="es-case-reveal" hidden={!revealed}>
          <p className="es-quest-eyebrow">Your first lead</p>
          <p>
            Uneven ground motion. A satellite can help spot it—but the signal
            alone can’t tell us the cause.
          </p>
          <a className="es-case-next" href="#hidden-cause">
            Follow the water <ArrowDown size={18} aria-hidden="true" />
          </a>
        </div>
        <p className="es-case-promise">
          Five clues. Five things to try. One case to explain.
          <br />
          <span>Explore in any order. No timer. No account.</span>
        </p>
      </div>
      <div className="es-case-scene">
        {children(revealed)}
        <div className="es-case-sweep" aria-hidden="true" />
        <span className="es-case-scene-tag">
          <Radio size={16} aria-hidden="true" /> {revealed ? 'Lead found: look below the surface' : 'Movement colours hidden · reveal the pattern'}
        </span>
      </div>
    </div>
  );
}

export function ChapterBridge({
  from,
  to,
  children,
}: {
  from: string;
  to: string;
  children: ReactNode;
}) {
  return (
    <div className="es-case-bridge es-wrap">
      <div className="es-case-thread" aria-hidden="true">
        <span />
        <ArrowDown size={18} />
      </div>
      <div>
        <span className="es-quest-eyebrow">{from}</span>
        <p>{children}</p>
        <a href={`#${to}`}>
          Follow the next lead <ArrowRight size={16} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

export function ChapterTag({ id }: { id: MissionId }) {
  const { progress } = useMissions();
  const index = MISSION_IDS.indexOf(id);
  return (
    <div className="es-chapter-tag">
      <span>
        <ClueIcon id={id} /> Clue 0{index + 1} · {CLUES[id].title}
      </span>
      <span>
        {progress.completed.includes(id)
          ? "✓ Finding saved"
          : "Your next experiment"}
      </span>
    </div>
  );
}

export function CaseFile() {
  const { progress } = useMissions();
  return <CaseFileContent key={progress.generation} />;
}
function CaseFileContent() {
  const { progress } = useMissions();
  const count = progress.completed.length,
    next = nextClue(progress.completed);
  const [headline, setHeadline] = useState<number | null>(null);
  const [filed, setFiled] = useState(false);
  const { setHost: rewardRef, fresh, celebrate, settle } = useQuestReward();
  return (
    <section
      id="case-file"
      className="es-case-file"
      aria-labelledby="case-file-title"
      tabIndex={-1}
      ref={rewardRef}
    >
      <header>
        <div>
          <p className="es-quest-eyebrow">
            <Fingerprint size={18} aria-hidden="true" /> Your investigation
          </p>
          <h2 id="case-file-title">Connect the clues.</h2>
          <p>
            You don’t need every clue to read the file. Each finding makes your
            explanation stronger.
          </p>
        </div>
        <div className="es-case-rank">
          <Fingerprint size={36} aria-hidden="true" />
          <strong>{investigatorRank(count)}</strong>
          <span>{count} of 5 clues found</span>
        </div>
      </header>
      <ol className="es-case-findings">
        {MISSION_IDS.map((id, index) => {
          const earned = progress.completed.includes(id);
          return (
            <li key={id} data-earned={earned}>
              <span className="es-case-finding-icon">
                <ClueIcon id={id} size={25} />
              </span>
              <div>
                <span className="es-quest-eyebrow">
                  0{index + 1} · {CLUES[id].kind}
                </span>
                <h3>{CLUES[id].title}</h3>
                <p>
                  {earned
                    ? CLUES[id].finding
                    : "A lead to investigate. Open this chapter and try its challenge."}
                </p>
                <a href={`#${CLUES[id].chapter}`}>
                  {earned ? "Revisit this finding" : "Explore this lead"}{" "}
                  <ArrowRight size={15} aria-hidden="true" />
                </a>
              </div>
              <span
                className="es-case-finding-mark"
                aria-label={earned ? "Found" : "Not found"}
              >
                {earned ? <Check size={20} aria-hidden="true" /> : "…"}
              </span>
            </li>
          );
        })}
      </ol>
      <div key={progress.generation} className="es-case-conclusion">
        <h3>What headline would you send?</h3>
        <p>
          A good investigator leaves room for what the evidence cannot tell us.
        </p>
        <CaseHeadline
          key={progress.generation}
          choice={headline}
          setChoice={setHeadline}
          filed={filed}
          setFiled={setFiled}
          celebrate={celebrate}
        />
      </div>
      {filed && (
        <div
          className="es-case-stamp"
          data-celebrate={fresh}
          onAnimationEnd={settle}
          role="status"
        >
          <ShieldCheck size={28} aria-hidden="true" />
          <div>
            <strong>Case explained. Questions still open.</strong>
            <p>
              Your reasoning matters more than a score. To check the real cause,
              compare groundwater records, ground monitoring and qualified local
              investigation.
            </p>
          </div>
        </div>
      )}
      {next && (
        <a className="es-case-next" href={`#${CLUES[next].chapter}`}>
          Next uncollected clue: {CLUES[next].title}{" "}
          <ArrowRight size={17} aria-hidden="true" />
        </a>
      )}
    </section>
  );
}
function CaseHeadline({
  choice,
  setChoice,
  filed,
  setFiled,
  celebrate,
}: {
  choice: number | null;
  setChoice: (value: number) => void;
  filed: boolean;
  setFiled: (value: boolean) => void;
  celebrate: () => void;
}) {
  const [feedback, setFeedback] = useState("");
  return (
    <>
      <div
        className="es-quest-headlines"
        role="group"
        aria-label="Choose your case headline"
      >
        {[
          "The satellite predicts which building falls next.",
          "A ground-motion clue worth investigating—water use and repeat monitoring can help explain it.",
          "Refill the aquifer and all the lost ground comes back.",
        ].map((text, index) => (
          <button
            key={text}
            type="button"
            aria-pressed={choice === index}
            onClick={() => {
              setChoice(index);
              setFeedback("");
              setFiled(false);
            }}
          >
            {text}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="es-quest-primary"
        onClick={() => {
          if (choice === 1) {
            setFiled(true);
            if (!filed) celebrate();
            setFeedback("");
          } else
            setFeedback(
              choice === null
                ? "Choose a headline first."
                : choice === 0
                  ? "The signal concerns ground motion. It cannot diagnose a building or predict its collapse. Try a headline that respects that limit."
                  : "Some compacted layers may not reopen. Try a headline that leaves room for lasting change.",
            );
        }}
      >
        File your explanation <ArrowRight size={17} aria-hidden="true" />
      </button>
      <p className="es-quest-feedback" role="status">
        {feedback}
      </p>
    </>
  );
}
