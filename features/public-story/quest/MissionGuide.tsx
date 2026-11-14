"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { MissionId } from "@/lib/story-missions";
import { missionMove } from "@/lib/mission-guide";
const Context = createContext<{
  id: MissionId;
  mask: number;
  earned: boolean;
} | null>(null);
export function MissionGuide({
  id,
  mask,
  earned,
  children,
}: {
  id: MissionId;
  mask: number;
  earned: boolean;
  children: ReactNode;
}) {
  return (
    <Context.Provider value={{ id, mask, earned }}>{children}</Context.Provider>
  );
}
export function useMissionGuide() {
  const c = useContext(Context);
  return c ? { ...c, ...missionMove(c.id, c.mask) } : null;
}
