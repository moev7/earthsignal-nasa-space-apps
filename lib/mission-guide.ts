import type { MissionId } from "./story-missions";
import type voice from "./echo-voice.json";
export type EchoVoiceCue = keyof typeof voice.cues;
export type MissionMove = {
  label: string;
  instruction: string;
  target: string;
  voice: EchoVoiceCue;
};
export const MISSION_MOVES: Record<MissionId, MissionMove[]> = {
  aquifer: [
    {
      label: "Drain the well",
      instruction: "Pump three times. Watch the street above the thin layer.",
      target: 'button[data-affordance="pump"]',
      voice: "water-draw",
    },
    {
      label: "Bring the water back",
      instruction:
        "Refill the well. Does the street return to its dashed starting line?",
      target: 'button[data-affordance="refill"]',
      voice: "water-return",
    },
  ],
  uneven: [
    {
      label: "Move both ends together",
      instruction:
        "Drop both blocks together. Watch the shared pipe stay level.",
      target: 'button[aria-label="Settle together"]',
      voice: "street-together",
    },
    {
      label: "Make a mismatch",
      instruction: "Make one end sink farther. The connection now has to bend.",
      target: 'button[aria-label="Settle unevenly"]',
      voice: "street-uneven",
    },
    {
      label: "Look at the connection",
      instruction:
        "Inspect the joining pipe. The change is between the two blocks.",
      target: 'button[data-affordance="inspect-join"]',
      voice: "street-inspect",
    },
  ],
  radar: [
    {
      label: "Save the first echo",
      instruction:
        "Capture this visit before moving anything. This is your baseline.",
      target: 'button[data-affordance="capture"]',
      voice: "radar-first",
    },
    {
      label: "Move the ground. Revisit.",
      instruction: "Slide the ground down, then capture the repeat echo.",
      target: 'input[aria-label="Move the ground between visits"]',
      voice: "radar-repeat",
    },
    {
      label: "Reveal the difference",
      instruction:
        "Combine your two visits. Watch the bowl fill with repeating colours.",
      target: 'button[data-affordance="compare"]',
      voice: "radar-compare",
    },
  ],
  evidence: [
    {
      label: "Compare a patch and a gap",
      instruction:
        "Sample a measured patch. Then find a gap. Missing is not zero.",
      target: 'button[data-affordance="sample-patch"]',
      voice: "evidence-probe",
    },
  ],
  tokyo: [
    {
      label: "Change the water route",
      instruction:
        "Connect another supply, or turn down the well. Watch the pipes.",
      target: 'button[data-route-key="supply"]',
      voice: "policy-water",
    },
    {
      label: "Check what changes",
      instruction:
        "Add monitoring. It observes the result; it cannot fix the cause.",
      target: 'button[data-route-key="monitor"]',
      voice: "policy-monitor",
    },
  ],
};
export function missionMove(id: MissionId, mask: number) {
  const steps = MISSION_MOVES[id];
  const index = steps.findIndex((_, i) => !(mask & (1 << i)));
  return {
    step: steps[index < 0 ? steps.length - 1 : index],
    index: index < 0 ? steps.length : index,
    total: steps.length,
    complete: index < 0,
  };
}
export const FOUND_VOICE: Record<MissionId, EchoVoiceCue> = {
  aquifer: "water-found",
  uneven: "street-found",
  radar: "radar-found",
  evidence: "evidence-found",
  tokyo: "policy-found",
};
