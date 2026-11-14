import { MISSION_IDS, type MissionId } from "@/lib/story-missions";

export const CLUES: Record<
  MissionId,
  {
    title: string;
    verb: string;
    chapter: string;
    kind: string;
    finding: string;
    next: string;
  }
> = {
  aquifer: {
    title: "Missing space",
    verb: "Rebuild",
    chapter: "hidden-cause",
    kind: "Mechanism · simplified",
    finding:
      "Falling water pressure can squeeze fine layers. Some lost space may not reopen.",
    next: "Now follow that missing space up to the street.",
  },
  uneven: {
    title: "The tilted street",
    verb: "Compare",
    chapter: "consequences",
    kind: "Invented street experiment",
    finding:
      "The difference between two places matters—not just how far either one sinks.",
    next: "But how could we spot movement across a whole neighbourhood?",
  },
  radar: {
    title: "A change in the echo",
    verb: "Test",
    chapter: "from-space",
    kind: "Synthetic radar experiment",
    finding:
      "Two visits to the same target can reveal a changed radar echo. Real observations need more checks.",
    next: "You can read a model. Now separate it from a real observation.",
  },
  evidence: {
    title: "The reality check",
    verb: "Sort",
    chapter: "observations",
    kind: "Provisional observations + scenario",
    finding:
      "Measured patches carry estimates and uncertainty. Gaps are missing evidence, not zero motion; future views remain conditional.",
    next: "The signal is a clue, not the ending. What could change the story?",
  },
  tokyo: {
    title: "A different ending",
    verb: "Choose",
    chapter: "what-we-can-do",
    kind: "Historical context · illustrative curve",
    finding:
      "Control withdrawal and keep monitoring. Slowing further loss does not lift all lost ground back up.",
    next: "Bring your findings together. What can you say—and what still needs checking?",
  },
};
export const nextClue = (completed: readonly MissionId[]) =>
  MISSION_IDS.find((id) => !completed.includes(id));
export const investigatorRank = (count: number) =>
  count >= 5
    ? "Signal detective"
    : count >= 3
      ? "Evidence tracker"
      : count >= 1
        ? "Clue finder"
        : "New investigator";

export const WATER_EVENTS = [
  "Pumping removes groundwater",
  "Water pressure falls",
  "Fine layers compact",
  "The surface settles",
] as const;
export function checkWaterOrder(order: readonly number[]) {
  if (
    order.length !== 4 ||
    new Set(order).size !== 4 ||
    order.some((value) => !Number.isInteger(value) || value < 0 || value > 3)
  )
    return {
      correct: false,
      message: "Use each event once to build the four-step chain.",
    };
  const first = order.findIndex((value, index) => value !== index);
  return first < 0
    ? {
        correct: true,
        message:
          "Chain connected. Pumping lowers pressure; fine layers can squeeze and the surface can settle. Refilling does not always reopen those spaces.",
      }
    : {
        correct: false,
        message:
          first === 0
            ? "Start with the action that removes water. Then follow what changes below ground."
            : first === 1
              ? "Water pressure changes before the fine layers squeeze. Look at the spaces between grains."
              : "The fine layers change first; the surface above follows. Swap the last two events.",
      };
}
export const STREETS = [
  { name: "Street A", ends: [12, 12] },
  { name: "Street B", ends: [4, 14] },
  { name: "Street C", ends: [25, 27] },
] as const;
export const streetDifference = (index: number) =>
  Number.isInteger(index) && index >= 0 && index < STREETS.length
    ? Math.abs(STREETS[index].ends[1] - STREETS[index].ends[0])
    : null;
export function checkStreet(index: number | null) {
  const difference = index === null ? null : streetDifference(index);
  if (difference === null)
    return {
      correct: false,
      message: "Pick a street to compare its two ends.",
    };
  return index === 1
    ? {
        correct: true,
        message:
          "Street B changes by 10 cm from one end to the other. Street C sinks farther overall, but its ends differ by only 2 cm. Uneven settling can strain what spans it.",
      }
    : {
        correct: false,
        message:
          index === 0
            ? "Both ends of A lower by 12 cm: the difference is 0 cm. Look for unequal movement."
            : "C has the biggest total lowering, but its ends differ by only 2 cm. Compare the gap, not the largest number.",
      };
}
export type RadarInvestigationState = {
  sinkingCm: number;
  observation: string;
  selectedSite: string;
};
export function checkRadar(
  model: RadarInvestigationState,
  explanation: number | null,
) {
  if (model.observation !== "compare" || model.selectedSite !== "centre")
    return {
      correct: false,
      message:
        "Select Compare both and Centre in the scene. One visit—or the stable edge—cannot test the moving centre.",
    };
  if (model.sinkingCm !== 0)
    return {
      correct: false,
      message:
        "The centre still moves in the model. Set Centre sinking to exactly 0 cm, then compare the reading.",
    };
  if (explanation !== 0)
    return {
      correct: false,
      message:
        explanation === null
          ? "The model is at zero. Choose what that result lets you conclude."
          : "A synthetic experiment cannot prove real ground is stable. Keep your conclusion inside this model.",
    };
  return {
    correct: true,
    message:
      "Signal decoded. Both visits match, so the modelled ground-motion phase difference is zero. Atmosphere, noise and other real radar effects are absent here.",
  };
}
export const CLAIM_TYPES = [
  "Measured estimate",
  "Conditional scenario",
  "Unsupported claim",
] as const;
export const CLAIMS = [
  {
    text: "June–October 2026 observations estimate uneven ground motion in the selected Tehran area.",
    correct: 0,
    hint: "This refers to a recorded observation period. Provisional and uncertain can still mean measured.",
  },
  {
    text: "If those short-record rates continued, the future 3D scene would show growing height differences.",
    correct: 1,
    hint: "“If those rates continued” is a condition, not a measurement from the future.",
  },
  {
    text: "The satellite proves this particular building will collapse in 2030.",
    correct: 2,
    hint: "Ground-motion estimates cannot diagnose a particular building or give its collapse date.",
  },
] as const;
export function checkClaims(answers: readonly (number | null)[]) {
  const wrong = CLAIMS.findIndex(
    (claim, index) => answers[index] !== claim.correct,
  );
  return wrong === -1 && answers.length === 3
    ? {
        correct: true,
        message:
          "Evidence sorted. A measurement, a conditional future and an unsupported leap belong in different boxes—even when all three sound convincing.",
      }
    : {
        correct: false,
        message:
          wrong >= 0
            ? `Card ${wrong + 1}: ${CLAIMS[wrong].hint}`
            : "Classify each of the three cards.",
      };
}
export const PLAN_OPTIONS = [
  {
    title: "Limit total groundwater withdrawal",
    result: "Can reduce the pressure driving further compaction.",
    correct: true,
  },
  {
    title: "Keep measuring water levels and ground motion",
    result: "Shows whether conditions and ground movement change.",
    correct: true,
  },
  {
    title: "Refill and promise all lost height will return",
    result: "Some compacted layers may not reopen.",
    correct: false,
  },
  {
    title: "Repaint cracks and stop taking measurements",
    result: "Changes appearances while leaving the cause unchecked.",
    correct: false,
  },
] as const;
export function checkPlan(selected: readonly number[]) {
  if (
    new Set(selected).size !== selected.length ||
    selected.some(
      (index) =>
        !Number.isInteger(index) || index < 0 || index >= PLAN_OPTIONS.length,
    )
  )
    return {
      correct: false,
      message: "Choose two different actions from the board.",
    };
  if (selected.includes(2))
    return {
      correct: false,
      message:
        "Refilling can help water pressure, but promising all lost height back goes beyond the evidence. Some compaction remains.",
    };
  if (selected.includes(3))
    return {
      correct: false,
      message:
        "Repainting cannot control groundwater withdrawal. Without monitoring, you cannot check what happens next.",
    };
  if (selected.length !== 2)
    return {
      correct: false,
      message: selected.includes(0)
        ? "A control needs a way to check its effect. Add repeat monitoring."
        : selected.includes(1)
          ? "Monitoring tells you what is happening. Add an action that addresses withdrawal."
          : "Choose two actions: one to address the cause and one to check what changes.",
    };
  return {
    correct: true,
    message:
      "A plan with a feedback loop: control withdrawal, then keep checking. Tokyo shows that a different course is possible; restoring lost ground height is another matter.",
  };
}
