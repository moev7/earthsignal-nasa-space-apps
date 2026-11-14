"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createMissionStore,
  emptyMissionProgress,
  MISSION_IDS,
  MISSION_POINTS,
  MISSION_STORAGE_KEY,
  MISSIONS,
  missionScore,
  type MissionId,
  type MissionSnapshot,
  type MissionStorage,
} from "@/lib/story-missions";
import "./missions.css";

type MissionContextValue = MissionSnapshot & {
  ready: boolean;
  answer: (id: MissionId, answer: number) => void;
  setEnabled: (enabled: boolean) => void;
  reset: () => void;
};
const MissionContext = createContext<MissionContextValue | null>(null);

export function useMissions() {
  const context = useContext(MissionContext);
  if (!context) throw new Error("Mission components need a MissionProvider");
  return context;
}

export function MissionProvider({ children }: { children: ReactNode }) {
  // Server and first client render agree. Reading and writing browser storage
  // happens only after mount; hydration never writes empty default progress.
  const [snapshot, setSnapshot] = useState<MissionSnapshot>({
    progress: emptyMissionProgress(),
    status: "local",
  });
  const [ready, setReady] = useState(false);
  const store = useRef<ReturnType<typeof createMissionStore> | null>(null);
  useEffect(() => {
    let storage: MissionStorage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      /* Continue with this tab's memory. */
    }
    const current = createMissionStore(storage);
    store.current = current;
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setSnapshot(current.sync());
        setReady(true);
      }
    });
    const sync = () => setSnapshot(current.sync());
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== storage) return;
      if (
        event.key === null ||
        event.key === MISSION_STORAGE_KEY ||
        event.key.startsWith(`${MISSION_STORAGE_KEY}:`)
      )
        sync();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      store.current = null;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  const value: MissionContextValue = {
    ...snapshot,
    ready,
    answer: (id, answer) => {
      if (store.current) setSnapshot(store.current.answer(id, answer));
    },
    setEnabled: (enabled) => {
      if (store.current) setSnapshot(store.current.setEnabled(enabled));
    },
    reset: () => {
      if (store.current) setSnapshot(store.current.reset());
    },
  };
  return (
    <MissionContext.Provider value={value}>{children}</MissionContext.Provider>
  );
}

export function Mission({ id }: { id: MissionId }) {
  const { progress, ready, answer } = useMissions();
  const labelId = useId();
  const feedbackId = useId();
  const [attempt, setAttempt] = useState<{
    generation: string;
    answer: number;
  } | null>(null);
  const mission = MISSIONS[id];
  const completed = progress.completed.includes(id);
  const currentAttempt =
    attempt?.generation === progress.generation ? attempt.answer : null;
  const correct = currentAttempt === mission.correct;
  if (!progress.enabled) return null;
  return (
    <details className="es-missions-question">
      <summary>
        <span id={labelId}>{mission.question}</span>
        <span className="es-missions-reward">
          {completed
            ? `${mission.badge} earned`
            : `Optional · +${MISSION_POINTS} points`}
        </span>
      </summary>
      <div className="es-missions-question-body">
        <p className="es-missions-note">
          Choose an answer. Retry freely; there is no penalty.
        </p>
        <div
          className="es-missions-answers"
          role="group"
          aria-labelledby={labelId}
          aria-describedby={feedbackId}
        >
          {mission.answers.map((label, index) => (
            <button
              type="button"
              key={label}
              disabled={!ready}
              aria-pressed={currentAttempt === index}
              onClick={() => {
                setAttempt({ generation: progress.generation, answer: index });
                answer(id, index);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p
          id={feedbackId}
          className="es-missions-feedback"
          aria-live="polite"
          aria-atomic="true"
        >
          {currentAttempt !== null && (
            <>
              {correct
                ? `${mission.badge} earned. ${MISSION_POINTS} points, once per discovery. `
                : "Try again; no points lost. "}
              {mission.explanation}
            </>
          )}
          {currentAttempt === null && completed && (
            <>Discovery earned. {mission.explanation}</>
          )}
        </p>
      </div>
    </details>
  );
}

export function MissionProgress({
  compact = true,
  game = false,
}: {
  compact?: boolean;
  game?: boolean;
}) {
  const { progress, status, ready, setEnabled, reset } = useMissions();
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState("");
  const resetButton = useRef<HTMLButtonElement>(null);
  const resetId = useId();
  const storageText = !ready
    ? "Reading local progress…"
    : status === "session"
      ? "Browser storage is unavailable. Progress lasts only in this tab until you reload."
      : status === "newer"
        ? "A newer progress format is stored. It is preserved; these answers last only in this tab until you reload."
        : status === "recovered"
          ? "Some saved progress could not be read. Valid discoveries are kept; answer again or reset progress."
          : "Progress stays in this browser. No account needed.";
  return (
    <details
      className={`es-missions-progress${compact ? " es-missions-compact" : ""}`}
    >
      <summary
        aria-label={`Your discoveries: ${progress.completed.length} of ${MISSION_IDS.length}, ${missionScore(progress)} points`}
      >
        <span>
          {compact
            ? `${progress.completed.length}/${MISSION_IDS.length} clues · ${missionScore(progress)} pts`
            : `${progress.completed.length}/${MISSION_IDS.length} discoveries, ${missionScore(progress)} points`}
        </span>
      </summary>
      <div className="es-missions-progress-body">
        <p className="es-missions-note">
          Five optional challenges. Each discovery earns {MISSION_POINTS}{" "}
          points, up to 100. The story is always open.
        </p>
        <ul className="es-missions-checklist" aria-label="Discovery badges">
          {MISSION_IDS.map((id) => (
            <li key={id}>
              <span>{MISSIONS[id].badge}</span>
              <span>
                {progress.completed.includes(id) ? "Earned" : "Not yet"}
              </span>
            </li>
          ))}
        </ul>
        <div className="es-missions-actions">
          {!game && (
            <button
              type="button"
              disabled={!ready}
              aria-pressed={progress.enabled}
              onClick={() => {
                setEnabled(!progress.enabled);
                setMessage("");
              }}
            >
              {progress.enabled ? "Hide missions" : "Show missions"}
            </button>
          )}
          <button
            type="button"
            ref={resetButton}
            disabled={!ready}
            aria-expanded={confirmReset}
            aria-controls={resetId}
            onClick={() => setConfirmReset(!confirmReset)}
          >
            Reset progress
          </button>
        </div>
        {!game && (
          <p className="es-missions-note">
            Hiding questions keeps your discoveries.
          </p>
        )}
        {confirmReset && (
          <div id={resetId} className="es-missions-reset">
            <p>Reset mission points and badges in this browser?</p>
            <div className="es-missions-actions">
              <button
                type="button"
                onClick={() => {
                  reset();
                  setConfirmReset(false);
                  setMessage(
                    "Mission progress reset. You can discover all five again.",
                  );
                  resetButton.current?.focus();
                }}
              >
                Yes, reset progress
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmReset(false);
                  resetButton.current?.focus();
                }}
              >
                Keep progress
              </button>
            </div>
          </div>
        )}
        <p className="es-missions-storage" role="status">
          {storageText}
          {message && ` ${message}`}
        </p>
      </div>
    </details>
  );
}
