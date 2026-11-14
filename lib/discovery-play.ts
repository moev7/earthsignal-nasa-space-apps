/** Small illustrative experiments. No dates, rates or building diagnoses are inferred. */
export type WaterPlay = {
  depletion: number;
  compacted: number;
  pumped: boolean;
  returned: boolean;
};
export const freshWater = (): WaterPlay => ({
  depletion: 0,
  compacted: 0,
  pumped: false,
  returned: false,
});
export function waterStep(
  state: WaterPlay,
  action: "pump" | "refill",
): WaterPlay {
  const depletion = Math.max(
    0,
    Math.min(1, state.depletion + (action === "pump" ? 0.25 : -0.35)),
  );
  // Authored teaching progression, not a calibrated constitutive/groundwater model.
  const compacted = Math.max(state.compacted, Math.max(0, depletion - 0.2));
  const pumped = state.pumped || depletion >= 0.75;
  return {
    depletion,
    compacted,
    pumped,
    returned:
      state.returned || (pumped && action === "refill" && depletion <= 0.25),
  };
}
export function waterCue(s: WaterPlay) {
  return s.returned
    ? "The water came back. Some space did not. That is the twist."
    : s.depletion >= 0.75
      ? "Now bring the water back. Will the street rise with it?"
      : s.depletion > 0
        ? "Watch the thin layer squeeze as water pressure falls."
        : "Take water out. Keep your eye on the street, not just the blue.";
}
export type RadarPlay = {
  sinking: number;
  first: number | null;
  second: number | null;
  compared: boolean;
};
export const freshRadar = (): RadarPlay => ({
  sinking: 0,
  first: null,
  second: null,
  compared: false,
});
export type RadarAction =
  { type: "ground"; value: number } | { type: "capture" } | { type: "compare" };
export function radarStep(s: RadarPlay, action: RadarAction): RadarPlay {
  if (action.type === "ground")
    return s.first === null || s.second !== null
      ? s
      : {
          ...s,
          sinking: Math.max(
            0,
            Math.min(
              30,
              Math.round(Number.isFinite(action.value) ? action.value : 0),
            ),
          ),
        };
  if (action.type === "compare")
    return s.first !== null && s.second !== null ? { ...s, compared: true } : s;
  if (s.first === null) return { ...s, first: s.sinking };
  // The second visit requires an explicit changed ground state, not two rapid clicks.
  if (s.second === null && s.sinking !== s.first)
    return { ...s, second: s.sinking };
  return s;
}
export function radarCue(s: RadarPlay) {
  return s.compared
    ? `Two visits, one target. Your ${Math.abs(s.second! - s.first!)} cm change leaves a different echo. Colours repeat; they are not a safety score.`
    : s.second !== null
      ? "Both visits are in. Put them together to reveal the difference."
      : s.first !== null
        ? "First echo saved. Move the ground, then take the repeat visit."
        : "A single visit cannot show change. Save an echo to start.";
}
export type CityPlan = { limits: boolean; supply: boolean; monitor: boolean };
export const freshPlan = (): CityPlan => ({
  limits: false,
  supply: false,
  monitor: false,
});
export function planResult(p: CityPlan) {
  const cause = p.limits || p.supply;
  return !cause && !p.monitor
    ? "The city is still waiting for a change."
    : !cause
      ? "You can see the change, but monitoring alone does not reduce withdrawal."
      : !p.monitor
        ? "You addressed withdrawal. Now add monitoring to find out what happens."
        : "You acted on groundwater use and chose a way to check. Further sinking may slow; lost height does not simply return.";
}
