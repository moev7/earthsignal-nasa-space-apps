/** Authored poses for a reversible explanation, never a groundwater forecast. */
export function storyWaterPose(progress: number) {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const drawn = Math.min(1, p / 0.62);
  return {
    depletion: p < 0.62 ? drawn : Math.max(0, 1 - (p - 0.62) / 0.38),
    compacted: Math.max(0, drawn - 0.2),
    returned: p > 0.9,
  };
}
export function waterAt(
  state: {
    depletion: number;
    compacted: number;
    pumped: boolean;
    returned: boolean;
  },
  value: number,
) {
  const depletion = Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : state.depletion;
  const pumped = state.pumped || depletion >= 0.75;
  return {
    depletion,
    compacted: Math.max(state.compacted, depletion - 0.2),
    pumped,
    returned: state.returned || (pumped && depletion <= 0.25),
  };
}
