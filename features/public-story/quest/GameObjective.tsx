"use client";
import { createContext, useContext, useEffect } from "react";
import { Check, ArrowRight, X } from "lucide-react";
import type { MissionId } from "@/lib/story-missions";
import { ClueIcon, useQuestReward } from "./QuestExperience";
import { CLUES } from "./quest-model";
import { missionMove } from "@/lib/mission-guide";

export const GAME_OBJECTIVES: Record<
  MissionId,
  { goal: string; steps: string[] }
> = {
  aquifer: {
    goal: "Can you refill the water without getting the street back?",
    steps: ["Draw most water out", "Bring the water back"],
  },
  uneven: {
    goal: "Make the road bend. Is the biggest drop always the problem?",
    steps: [
      "Move both ends together",
      "Try an unequal drop",
      "Inspect the joining pipe",
    ],
  },
  radar: {
    goal: "Catch a change the eye cannot see.",
    steps: [
      "Save the first echo",
      "Move ground & revisit",
      "Combine your echoes",
    ],
  },
  evidence: {
    goal: "Find a measured patch—and a place the record cannot answer.",
    steps: ["Probe a patch and a gap"],
  },
  tokyo: {
    goal: "Reroute the city’s water story. Then check your choice.",
    steps: ["Reduce groundwater use", "Add monitoring"],
  },
};
export const GameActivity = createContext<
  ((id: MissionId, mask: number) => void) | null
>(null);

/** Reports actual model actions, including reversal/reset; reading earns nothing. */
export function useGameCheckpoints(id: MissionId, ...steps: boolean[]) {
  const report = useContext(GameActivity);
  const mask = steps.reduce(
    (bits, done, index) => bits | (done ? 1 << index : 0),
    0,
  );
  useEffect(() => {
    report?.(id, mask);
  }, [report, id, mask]);
}

export function GameObjective({
  id,
  mask,
  earned,
}: {
  id: MissionId;
  mask: number;
  earned: boolean;
}) {
  const objective = GAME_OBJECTIVES[id],
    move = missionMove(id, mask);
  return (
    <aside
      className="ep-objective play-objective"
      aria-label="Your current mission"
    >
      <div>
        <ClueIcon id={id} size={24} />
        <p>
          <small>
            {earned
              ? "Discovery kept · keep experimenting"
              : `NEXT MOVE · ${Math.min(move.index + 1, move.total)} OF ${move.total}`}
          </small>
          <strong>{earned ? objective.goal : move.step.label}</strong>
        </p>
        <span aria-label={`${move.index} of ${move.total} moves tried`}>
          {objective.steps.map((step, i) => (
            <i key={step} data-done={Boolean(mask & (1 << i))} title={step} />
          ))}
        </span>
      </div>
      <details>
        <summary>See the trail</summary>
        <ol aria-label="Live mission checkpoints">
          {objective.steps.map((step, index) => (
            <li key={step} data-done={Boolean(mask & (1 << index))}>
              <span aria-hidden="true">
                {mask & (1 << index) ? <Check size={14} /> : index + 1}
              </span>
              <span>
                {step}
                <em className="ep-screen-reader">
                  {mask & (1 << index) ? ": done" : ": to try"}
                </em>
              </span>
            </li>
          ))}
        </ol>
      </details>
    </aside>
  );
}

export function FindingReward({
  id,
  next,
  dismiss,
}: {
  id: MissionId;
  next: () => void;
  dismiss: () => void;
}) {
  const { setHost: rewardRef, fresh, settle } = useQuestReward(true);
  return (
    <aside
      ref={rewardRef}
      className="ep-reward"
      data-fresh={fresh}
      onAnimationEnd={settle}
      aria-label="New finding collected"
    >
      <button
        type="button"
        className="ep-reward-close"
        aria-label="Dismiss finding"
        onClick={dismiss}
      >
        <X size={17} />
      </button>
      <div className="ep-reward-seal">
        <ClueIcon id={id} size={30} />
      </div>
      <div role="status">
        <small>Finding collected · +20</small>
        <strong>{CLUES[id].title}</strong>
        <p>{CLUES[id].finding}</p>
      </div>
      <button type="button" className="ep-next" onClick={next}>
        Follow the next lead <ArrowRight size={17} />
      </button>
    </aside>
  );
}
