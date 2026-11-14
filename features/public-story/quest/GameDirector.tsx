"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { MissionId } from "@/lib/story-missions";
import { useMissions } from "../missions/StoryMissions";
import { useStory } from "@/features/ground-truth/components/story/StoryProvider";
import {
  fieldNotesSchema,
  upsertFieldNote,
  type EchoTelemetry,
} from "@/lib/echo-director";

export const GAME_CHAPTERS = [
  "opening",
  "hidden-cause",
  "consequences",
  "from-space",
  "observations",
  "what-we-can-do",
  "case-file",
] as const;
export type GameChapter = (typeof GAME_CHAPTERS)[number];
export function gameChapter(hash: string): GameChapter | null {
  const value = hash.replace(/^#/, "");
  if (value === "radar-model") return "from-space";
  return GAME_CHAPTERS.includes(value as GameChapter)
    ? (value as GameChapter)
    : null;
}
type Attempt = {
  id: MissionId;
  correct: boolean;
  message: string;
  epoch: string;
  serial: number;
};
type Director = {
  notes: EchoTelemetry[];
  record: (note: EchoTelemetry) => void;
  chapter: GameChapter;
  navigate: (chapter: GameChapter) => void;
  attempt: Attempt | null;
  report: (
    id: MissionId,
    result: { correct: boolean; message: string },
  ) => void;
};
const Context = createContext<Director | null>(null);
export const useGame = () => useContext(Context);

/** UI and browser navigation use the same source; history events never write history. */
export function GameDirector({ children }: { children: ReactNode }) {
  const [chapter, setChapter] = useState<GameChapter>("opening");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const focus = useRef(false),
    serial = useRef(0);
  const { progress, ready } = useMissions(),
    { replayToken } = useStory();
  const [notebook, setNotebook] = useState<{
    generation: string;
    notes: EchoTelemetry[];
  }>({ generation: "", notes: [] });
  const generation = progress.generation;
  useEffect(() => {
    if (!ready) return;
    let active = true;
    let stored: ReturnType<typeof fieldNotesSchema.safeParse>;
    try {
      stored = fieldNotesSchema.safeParse(
        JSON.parse(
          window.localStorage.getItem("earthsignal:field-notes:v1") ?? "null",
        ),
      );
    } catch {
      stored = fieldNotesSchema.safeParse(null);
    }
    const notes =
      stored.success && stored.data.generation === generation
        ? stored.data.notes
        : [];
    queueMicrotask(() => {
      if (active)
        setNotebook((old) =>
          old.generation === generation ? old : { generation, notes },
        );
    });
    return () => {
      active = false;
    };
  }, [generation, ready]);
  useEffect(() => {
    if (notebook.generation !== generation) return;
    try {
      window.localStorage.setItem(
        "earthsignal:field-notes:v1",
        JSON.stringify(notebook),
      );
    } catch {}
  }, [notebook, generation]);
  const record = useCallback(
    (note: EchoTelemetry) =>
      setNotebook((old) => {
        const previous = old.generation === generation ? old.notes : [];
        const notes = upsertFieldNote(previous, note);
        return notes === previous && old.generation === generation
          ? old
          : { generation, notes };
      }),
    [generation],
  );
  const epoch = `${progress.generation}:${replayToken}`;
  const navigate = useCallback((next: GameChapter) => {
    focus.current = true;
    if (window.location.hash !== `#${next}`)
      window.history.pushState(null, "", `#${next}`);
    setAttempt(null);
    setChapter(next);
    // Selecting the current station should still return to its objective.
    if (next === gameChapter(window.location.hash)) {
      const target = document.querySelector<HTMLElement>(
        `[data-game-title="${next}"]`,
      );
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, []);
  useEffect(() => {
    let active = true;
    const read = (moveFocus: boolean) => {
      const next = gameChapter(window.location.hash || "#opening");
      if (next) {
        focus.current = moveFocus;
        setAttempt(null);
        setChapter(next);
      }
    };
    queueMicrotask(() => {
      if (active) read(false);
    });
    const changed = () => read(true);
    window.addEventListener("hashchange", changed);
    window.addEventListener("popstate", changed);
    return () => {
      active = false;
      window.removeEventListener("hashchange", changed);
      window.removeEventListener("popstate", changed);
    };
  }, []);
  useEffect(() => {
    if (!focus.current) return;
    const target = document.querySelector<HTMLElement>(
      `[data-game-title="${chapter}"]`,
    );
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "start", behavior: "instant" });
    focus.current = false;
  }, [chapter]);
  const report = (
    id: MissionId,
    result: { correct: boolean; message: string },
  ) => setAttempt({ id, ...result, epoch, serial: ++serial.current });
  return (
    <Context.Provider
      value={{
        notes: notebook.generation === generation ? notebook.notes : [],
        record,
        chapter,
        navigate,
        attempt: attempt?.epoch === epoch ? attempt : null,
        report,
      }}
    >
      {children}
    </Context.Provider>
  );
}

/** Shared story instruments can report locally when an optional game owns them. */
export function useFieldTelemetry(note: EchoTelemetry | null) {
  const record = useGame()?.record;
  const signature = JSON.stringify(note);
  useEffect(() => {
    if (record && signature !== "null")
      record(JSON.parse(signature) as EchoTelemetry);
  }, [record, signature]);
}
