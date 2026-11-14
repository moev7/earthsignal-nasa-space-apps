"use client";

import { useId, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  GripVertical,
  RotateCcw,
} from "lucide-react";
import {
  MISSIONS,
  MISSION_POINTS,
  MISSION_IDS,
  type MissionId,
} from "@/lib/story-missions";
import { useMissions } from "../missions/StoryMissions";
import { ClueIcon, useQuestReward } from "./QuestExperience";
import {
  CLAIMS,
  CLAIM_TYPES,
  CLUES,
  PLAN_OPTIONS,
  STREETS,
  WATER_EVENTS,
  checkClaims,
  checkPlan,
  checkRadar,
  checkStreet,
  checkWaterOrder,
  streetDifference,
  type RadarInvestigationState,
} from "./quest-model";

import { useGame } from "./GameDirector";

type Verdict = { correct: boolean; message: string };
export function FieldChallenge({
  id,
  radar,
}: {
  id: MissionId;
  radar?: RadarInvestigationState;
}) {
  const { progress } = useMissions();
  if (!progress.enabled) return null;
  return (
    <Challenge key={`${id}:${progress.generation}`} id={id} radar={radar} />
  );
}
function Challenge({
  id,
  radar,
}: {
  id: MissionId;
  radar?: RadarInvestigationState;
}) {
  const { progress, ready, answer } = useMissions();
  const director = useGame();
  const label = useId();
  const clue = CLUES[id],
    earned = progress.completed.includes(id);
  const index = MISSION_IDS.indexOf(id),
    next = MISSION_IDS[index + 1];
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const { setHost: rewardRef, fresh, celebrate, settle } = useQuestReward();
  const submit = (result: Verdict) => {
    setVerdict(result);
    director?.report(id, result);
    if (result.correct && ready && !earned) {
      answer(id, MISSIONS[id].correct);
      celebrate();
    }
  };
  const clear = () => setVerdict(null);
  return (
    <div
      id={`challenge-${id}`}
      className="es-field-challenge"
      ref={rewardRef}
      data-earned={earned}
      aria-labelledby={label}
    >
      <header>
        <span className="es-field-emblem">
          <ClueIcon id={id} size={26} />
        </span>
        <div>
          <p className="es-quest-eyebrow">Your turn · Clue 0{index + 1}</p>
          <h3 id={label}>
            {id === "aquifer"
              ? "Rebuild the chain."
              : id === "uneven"
                ? "Find the biggest difference."
                : id === "radar"
                  ? "Make the signal match."
                  : id === "evidence"
                    ? "Catch the claim that goes too far."
                    : "Change the next chapter."}
          </h3>
        </div>
        <span className="es-field-reward">
          {earned ? (
            <>
              <Check size={15} aria-hidden="true" /> Clue found
            </>
          ) : (
            "Find a clue"
          )}
        </span>
      </header>
      <p className="es-field-kind">{clue.kind}</p>
      <fieldset disabled={!ready} className="es-field-work">
        <legend className="es-visually-hidden">{clue.verb} this clue</legend>
        {id === "aquifer" ? (
          <WaterOrder submit={submit} clear={clear} />
        ) : id === "uneven" ? (
          <StreetCompare submit={submit} clear={clear} />
        ) : id === "radar" ? (
          <RadarTest model={radar} submit={submit} clear={clear} />
        ) : id === "evidence" ? (
          <ClaimSort submit={submit} clear={clear} />
        ) : (
          <ResponsePlan submit={submit} clear={clear} />
        )}
      </fieldset>
      <div
        className="es-quest-feedback"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-correct={verdict?.correct}
      >
        {verdict && (
          <>
            <strong>
              {verdict.correct ? "Connection made. " : "Look closer. "}
            </strong>
            {verdict.message}
          </>
        )}
      </div>
      {earned && (
        <div
          className="es-clue-reveal"
          data-celebrate={fresh}
          onAnimationEnd={settle}
        >
          <span className="es-clue-reveal-icon">
            <ClueIcon id={id} size={30} />
          </span>
          <div>
            <span className="es-quest-eyebrow">
              Added to your case file · {MISSION_POINTS} points once
            </span>
            <h4>{clue.title}</h4>
            <p>{clue.finding}</p>
            <a href="#case-file">
              Inspect your case file <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        </div>
      )}
      <div className="es-field-exit">
        <p>{clue.next}</p>
        <a href={next ? `#${CLUES[next].chapter}` : "#case-file"}>
          {earned ? "Follow the next lead" : "Keep exploring"}{" "}
          <ArrowRight size={17} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
function WaterOrder({
  submit,
  clear,
}: {
  submit: (value: Verdict) => void;
  clear: () => void;
}) {
  const [order, setOrder] = useState<number[]>([2, 0, 3, 1]);
  const move = (position: number, direction: number) => {
    const target = position + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[position], next[target]] = [next[target], next[position]];
    setOrder(next);
    clear();
  };
  return (
    <>
      <p>
        In this simplified pumping example, what happens first? Move the cards
        into a cause → effect chain.
      </p>
      <ol className="es-order-cards">
        {order.map((event, position) => (
          <li key={event}>
            <span className="es-order-number">{position + 1}</span>
            <GripVertical size={17} aria-hidden="true" />
            <span>{WATER_EVENTS[event]}</span>
            <div>
              <button
                type="button"
                disabled={position === 0}
                aria-label={`Move ${WATER_EVENTS[event]} earlier`}
                onClick={() => move(position, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={position === 3}
                aria-label={`Move ${WATER_EVENTS[event]} later`}
                onClick={() => move(position, 1)}
              >
                ↓
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="es-quest-actions">
        <button
          type="button"
          className="es-quest-primary"
          onClick={() => submit(checkWaterOrder(order))}
        >
          Test my chain <ArrowRight size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            setOrder([2, 0, 3, 1]);
            clear();
          }}
        >
          <RotateCcw size={15} aria-hidden="true" /> Mix again
        </button>
      </div>
    </>
  );
}
function StreetCompare({
  submit,
  clear,
}: {
  submit: (value: Verdict) => void;
  clear: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [tested, setTested] = useState(false);
  return (
    <>
      <p>
        Three invented streets, two ends each. Which has the biggest{" "}
        <strong>difference</strong> in lowering?
      </p>
      <div
        className="es-street-cards"
        role="group"
        aria-label="Compare invented street ends"
      >
        {STREETS.map((street, index) => (
          <button
            type="button"
            key={street.name}
            aria-pressed={selected === index}
            onClick={() => {
              setSelected(index);
              setTested(false);
              clear();
            }}
          >
            <span>{street.name}</span>
            <svg viewBox="0 0 160 75" aria-hidden="true">
              <path d="M12 18H148" className="es-street-reference" />
              <path
                d={`M12 ${20 + street.ends[0]}L148 ${20 + street.ends[1]}`}
                className="es-street-line"
              />
              <circle cx="12" cy={20 + street.ends[0]} r="4" />
              <circle cx="148" cy={20 + street.ends[1]} r="4" />
            </svg>
            <span className="es-street-numbers">
              <span>{street.ends[0]} cm ↓</span>
              <span>{street.ends[1]} cm ↓</span>
            </span>
            <span className="es-street-result">
              {tested
                ? `${streetDifference(index)} cm difference`
                : "Compare the two ends"}
            </span>
          </button>
        ))}
      </div>
      <p className="es-field-kind">
        Lowering from the same starting level · illustration, not a damage test.
      </p>
      <button
        type="button"
        className="es-quest-primary"
        onClick={() => {
          setTested(true);
          submit(checkStreet(selected));
        }}
      >
        Compare my street <ArrowRight size={17} aria-hidden="true" />
      </button>
    </>
  );
}
function RadarTest({
  model,
  submit,
  clear,
}: {
  model?: RadarInvestigationState;
  submit: (value: Verdict) => void;
  clear: () => void;
}) {
  const [explanation, setExplanation] = useState<number | null>(null);
  return (
    <>
      <p>
        Use the <strong>same 3D scene</strong>: select Centre and Compare both,
        then bring Centre sinking to 0 cm. Does the reading match?
      </p>
      <a className="es-quest-model-link" href="#radar-model">
        Go to the radar controls <ArrowDown size={16} aria-hidden="true" />
      </a>
      <div className="es-radar-task-state">
        <span>Live model state</span>
        <strong>
          {model
            ? `${model.sinkingCm} cm · ${model.observation === "compare" ? "both visits" : "one visit"} · ${model.selectedSite}`
            : "Open the radar model"}
        </strong>
      </div>
      <p>What can you conclude?</p>
      <div
        className="es-quest-headlines"
        role="group"
        aria-label="Explain the zero radar result"
      >
        {[
          "The ground-motion phase difference is zero in this ideal model.",
          "This proves the real neighbourhood is perfectly stable.",
        ].map((text, index) => (
          <button
            key={text}
            type="button"
            aria-pressed={explanation === index}
            onClick={() => {
              setExplanation(index);
              clear();
            }}
          >
            {text}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="es-quest-primary"
        onClick={() =>
          submit(
            model
              ? checkRadar(model, explanation)
              : {
                  correct: false,
                  message:
                    "Open the scene and use its controls first. The numeric model works even without 3D.",
                },
          )
        }
      >
        Check the signal <ArrowRight size={17} aria-hidden="true" />
      </button>
    </>
  );
}
function ClaimSort({
  submit,
  clear,
}: {
  submit: (value: Verdict) => void;
  clear: () => void;
}) {
  const [answers, setAnswers] = useState<(number | null)[]>([null, null, null]);
  return (
    <>
      <p>
        Three confident-sounding cards. Give each the label its evidence
        actually supports.
      </p>
      <div className="es-claim-cards">
        {CLAIMS.map((claim, index) => (
          <fieldset key={claim.text}>
            <legend>
              <span>0{index + 1}</span>
              {claim.text}
            </legend>
            <div role="group" aria-label={`Classify card ${index + 1}`}>
              {CLAIM_TYPES.map((label, value) => (
                <button
                  type="button"
                  key={label}
                  aria-pressed={answers[index] === value}
                  onClick={() => {
                    setAnswers((previous) =>
                      previous.map((answer, at) =>
                        at === index ? value : answer,
                      ),
                    );
                    clear();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        className="es-quest-primary"
        onClick={() => submit(checkClaims(answers))}
      >
        Check my evidence <ArrowRight size={17} aria-hidden="true" />
      </button>
    </>
  );
}
function ResponsePlan({
  submit,
  clear,
}: {
  submit: (value: Verdict) => void;
  clear: () => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  return (
    <>
      <p>
        Choose <strong>two</strong> actions for the next chapter: one to address
        the cause, one to check what happens.
      </p>
      <div
        className="es-plan-cards"
        role="group"
        aria-label="Choose two response actions"
      >
        {PLAN_OPTIONS.map((option, index) => (
          <button
            key={option.title}
            type="button"
            aria-pressed={selected.includes(index)}
            onClick={() => {
              setSelected((previous) =>
                previous.includes(index)
                  ? previous.filter((value) => value !== index)
                  : [...previous, index],
              );
              clear();
            }}
          >
            <span className="es-plan-check" aria-hidden="true">
              {selected.includes(index) ? <Check size={17} /> : "+"}
            </span>
            <strong>{option.title}</strong>
            {selected.includes(index) && <span>{option.result}</span>}
          </button>
        ))}
      </div>
      <p className="es-field-kind">
        {selected.length} of 2 actions selected · a reasoning task, not a policy
        forecast.
      </p>
      <button
        type="button"
        className="es-quest-primary"
        onClick={() => submit(checkPlan(selected))}
      >
        Test my response <ArrowRight size={17} aria-hidden="true" />
      </button>
    </>
  );
}
