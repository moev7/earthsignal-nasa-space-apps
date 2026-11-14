export type EvidenceKind = "measured" | "projected" | "illustrated" | "published";
export type CityMode = "measured" | "simulation";
export function sceneEvidence(mode: CityMode, years: number): EvidenceKind {
  return mode === "simulation" ? "illustrated" : years > 0 ? "projected" : "measured";
}
export function sceneTimeLabel(mode: CityMode, years: number): string {
  if (mode === "simulation") return `Illustration · year ${years.toFixed(1)}`;
  return years === 0 ? "June–October 2026 · measurement period" : `${years.toFixed(1)} years later · if these rates continued`;
}
export function advanceSceneTime(years: number, seconds: number, state: { playing: boolean; paused: boolean; visible: boolean; reducedMotion: boolean }): number {
  if (!state.playing || state.paused || !state.visible || state.reducedMotion) return years;
  return Math.min(30, years + Math.max(0, Math.min(seconds, 0.05)) * 1.5);
}
export const LEGACY_WORKSPACE_ANCHORS = new Set(["place-setup", "decision-map", "evidence-guide"]);
export const LEGACY_STORY_ANCHORS: Record<string, string> = { 'how-it-happens': 'hidden-cause', evidence: 'sources', 'before-after': 'hidden-cause', causes: 'hidden-cause' };
