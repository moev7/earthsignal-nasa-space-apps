export const MISSION_IDS = [
  "aquifer",
  "uneven",
  "radar",
  "evidence",
  "tokyo",
] as const;
export type MissionId = (typeof MISSION_IDS)[number];

export const MISSION_POINTS = 20;
export const MISSION_STORAGE_KEY = "earthsignal:missions";
const VERSION = 1;
const INITIAL_GENERATION = "initial";

export const MISSIONS: Record<
  MissionId,
  {
    question: string;
    answers: readonly string[];
    correct: number;
    explanation: string;
    badge: string;
  }
> = {
  aquifer: {
    question: "Can refilling always bring the ground back up?",
    answers: [
      "Yes, water always lifts it back.",
      "No, some compaction may remain.",
    ],
    correct: 1,
    explanation:
      "Compacted fine-grained layers may not reopen. Refilling an aquifer does not necessarily reverse that compaction.",
    badge: "Water sleuth",
  },
  uneven: {
    question: "Which puts more strain on a street?",
    answers: [
      "Equal lowering everywhere.",
      "One end sinking farther than the other.",
    ],
    correct: 1,
    explanation:
      "Uneven settling creates differential strain. This invented-city example illustrates a mechanism; it does not diagnose a real building.",
    badge: "Ground detective",
  },
  radar: {
    question:
      "In this synthetic radar lesson, what happens to the ground-motion phase difference when sinking is set to zero?",
    answers: [
      "It becomes zero in the model.",
      "It keeps increasing.",
      "It proves the real ground is stable.",
    ],
    correct: 0,
    explanation:
      "The modelled ground-motion phase difference becomes zero. This scene is synthetic, not a real satellite image or evidence of real-world stability.",
    badge: "Signal reader",
  },
  evidence: {
    question: "What does a future year in Tehran’s 3D scene show?",
    answers: [
      "A measurement from that future year.",
      "A prediction of building collapse.",
      "A conditional view if short-record rates continued.",
    ],
    correct: 2,
    explanation:
      "It shows what continued short-record rates would look like under that condition. It is neither a measured future nor a collapse prediction.",
    badge: "Evidence keeper",
  },
  tokyo: {
    question:
      "Slowing subsidence returns all lost ground height — true or false?",
    answers: [
      "True: slowing restores the lost height.",
      "False: it can slow further loss.",
    ],
    correct: 1,
    explanation:
      "Controls can slow further loss; they do not restore ground height already lost. Tokyo’s historical curve here remains illustrative.",
    badge: "Long-view thinker",
  },
};

export type MissionProgressState = {
  generation: string;
  completed: MissionId[];
  enabled: boolean;
};
export type MissionStorageStatus = "local" | "session" | "newer" | "recovered";
export type MissionSnapshot = {
  progress: MissionProgressState;
  status: MissionStorageStatus;
};
export type MissionStorage = Pick<Storage, "getItem" | "setItem">;

export function emptyMissionProgress(): MissionProgressState {
  return { generation: INITIAL_GENERATION, completed: [], enabled: true };
}

export function missionScore(progress: MissionProgressState): number {
  return (
    MISSION_IDS.filter((id) => progress.completed.includes(id)).length *
    MISSION_POINTS
  );
}

/** Arbitrary answer indices, stored scores and unrecognised IDs cannot earn points. */
export function answerMission(
  progress: MissionProgressState,
  id: MissionId,
  answer: number,
): MissionProgressState {
  if (
    !MISSION_IDS.includes(id) ||
    MISSIONS[id].correct !== answer ||
    progress.completed.includes(id)
  )
    return progress;
  return {
    ...progress,
    completed: MISSION_IDS.filter(
      (key) => key === id || progress.completed.includes(key),
    ),
  };
}

type RecordValue = Record<string, unknown>;
function parseRecord(raw: string | null): RecordValue | null {
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid mission record");
  const record = parsed as RecordValue;
  if (typeof record.version === "number" && record.version > VERSION)
    throw new FutureVersion();
  if (record.version !== VERSION) throw new Error("Invalid mission version");
  return record;
}
class FutureVersion extends Error {}

function validGeneration(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

/** Reads only seven fixed keys. No default writes, key scans or stored point totals. */
export function readMissionProgress(storage: MissionStorage): MissionSnapshot {
  const progress = emptyMissionProgress();
  let recovered = false;
  const read = (key: string): RecordValue | null => {
    // Access failures must reach the caller; malformed JSON can recover independently.
    const raw = storage.getItem(key);
    try {
      return parseRecord(raw);
    } catch (error) {
      if (error instanceof FutureVersion) throw error;
      recovered = true;
      return null;
    }
  };
  try {
    const generation = read(MISSION_STORAGE_KEY);
    if (generation && validGeneration(generation.generation))
      progress.generation = generation.generation;
    else if (generation) recovered = true;
    const preferences = read(`${MISSION_STORAGE_KEY}:preferences`);
    if (preferences && typeof preferences.enabled === "boolean")
      progress.enabled = preferences.enabled;
    else if (preferences) recovered = true;
    for (const id of MISSION_IDS) {
      const receipt = read(`${MISSION_STORAGE_KEY}:${id}`);
      if (receipt && !validGeneration(receipt.generation)) recovered = true;
      if (receipt?.generation === progress.generation)
        progress.completed.push(id);
    }
    return { progress, status: recovered ? "recovered" : "local" };
  } catch (error) {
    return {
      progress: emptyMissionProgress(),
      status: error instanceof FutureVersion ? "newer" : "session",
    };
  }
}

/**
 * Each discovery owns a separate receipt, so concurrent answers never overwrite
 * one another. Only reset writes the generation key. Old receipts remain inert
 * after reset, including late writes from a suspended tab. Preferences are
 * independent of reset and use ordinary last-writer-wins visibility.
 */
export function createMissionStore(
  storage: MissionStorage | null,
  newGeneration = () => globalThis.crypto.randomUUID(),
) {
  let snapshot: MissionSnapshot = storage
    ? readMissionProgress(storage)
    : { progress: emptyMissionProgress(), status: "session" };
  let volatile = snapshot.status === "session" || snapshot.status === "newer";
  const sync = () => {
    if (!storage || volatile) return snapshot;
    const next = readMissionProgress(storage);
    if (next.status === "session" || next.status === "newer") {
      volatile = true;
      snapshot = { ...snapshot, status: next.status };
    } else snapshot = next;
    return snapshot;
  };
  const save = (key: string, record: object) => {
    if (!storage || volatile) return;
    try {
      storage.setItem(key, JSON.stringify({ version: VERSION, ...record }));
    } catch {
      volatile = true;
      snapshot = { ...snapshot, status: "session" };
    }
  };
  return {
    sync,
    answer(id: MissionId, answer: number): MissionSnapshot {
      sync();
      const next = answerMission(snapshot.progress, id, answer);
      if (next !== snapshot.progress) {
        snapshot = { ...snapshot, progress: next };
        save(`${MISSION_STORAGE_KEY}:${id}`, { generation: next.generation });
      }
      return snapshot;
    },
    setEnabled(enabled: boolean): MissionSnapshot {
      sync();
      snapshot = { ...snapshot, progress: { ...snapshot.progress, enabled } };
      save(`${MISSION_STORAGE_KEY}:preferences`, { enabled });
      return snapshot;
    },
    reset(): MissionSnapshot {
      sync();
      let generation: string;
      try {
        generation = newGeneration();
      } catch {
        generation = `reset-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      snapshot = {
        ...snapshot,
        progress: { ...snapshot.progress, generation, completed: [] },
      };
      save(MISSION_STORAGE_KEY, { generation });
      return snapshot;
    },
  };
}
