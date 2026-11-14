import {
  MAX_SINKING_M,
  RADAR,
  radarSample,
  rangeFromDisplacement,
} from "./radar-interferometry";

export const AUTHORING_NOTICE =
  "Invented game units and four authored drought seasons, not real groundwater pressures, years, a constitutive threshold, or a city forecast. Compaction and supply rules are teaching choices, not calibrated physics.";
export const POLICY_NOTICE =
  "Fictional normalized baseline: 1 settling unit per step for 20 steps. Steps are not calendar years; units are not millimetres. This is not a calibrated policy forecast or a policy probability. Reduced future settling never recovers lost elevation.";

/** All quantities here are invented game units, including the drawdown rule. */
export const DROUGHT_SEASONS = Object.freeze([
  Object.freeze({ demand: 45, recharge: 15 }),
  Object.freeze({ demand: 55, recharge: 10 }),
  Object.freeze({ demand: 60, recharge: 15 }),
  Object.freeze({ demand: 50, recharge: 5 }),
]);
export const ALTERNATE_CAPACITY = 45;
export const AUTHORED_DRAWDOWN_THRESHOLD = 35;

export type SeasonRecord = {
  season: number;
  storage: number;
  compacted: number;
  delivered: number;
  demand: number;
  deficit: number;
};
export type SeasonTrial = SeasonRecord & {
  locked: boolean;
  balancedSeasons: number;
  history: SeasonRecord[];
};

const bounded = (value: number, low: number, high: number, fallback = low) =>
  Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;

/** Season counts completed decisions. Demand is upcoming only at the fresh start. */
export function freshSeasonTrial(): SeasonTrial {
  return {
    season: 0,
    storage: 100,
    compacted: 0,
    delivered: 0,
    demand: DROUGHT_SEASONS[0].demand,
    deficit: 0,
    locked: false,
    balancedSeasons: 0,
    history: [],
  };
}

function finiteRecord(record: SeasonRecord): boolean {
  return (
    Number.isInteger(record.season) &&
    record.season >= 0 &&
    record.season <= 4 &&
    Number.isFinite(record.storage) &&
    record.storage >= 0 &&
    record.storage <= 100 &&
    Number.isFinite(record.compacted) &&
    record.compacted >= 0 &&
    record.compacted <= 1 &&
    Number.isFinite(record.delivered) &&
    record.delivered >= 0 &&
    record.delivered <= 100 &&
    Number.isFinite(record.demand) &&
    record.demand >= 0 &&
    record.demand <= 100 &&
    Number.isFinite(record.deficit) &&
    record.deficit >= 0 &&
    record.deficit <= 100
  );
}

/** Invalid/nonfinite serialized state starts a fresh trial instead of spreading NaN. */
function usableTrial(state: SeasonTrial): SeasonTrial {
  if (
    !finiteRecord(state) ||
    !Number.isInteger(state.balancedSeasons) ||
    state.balancedSeasons < 0 ||
    state.balancedSeasons > state.season ||
    !Array.isArray(state.history) ||
    state.history.length !== state.season ||
    !state.history.every(
      (record, index) => finiteRecord(record) && record.season === index + 1,
    )
  )
    return freshSeasonTrial();
  // Completion is derived from the count, never an independently stale flag.
  return { ...state, locked: state.season === DROUGHT_SEASONS.length };
}

/**
 * pump: requested withdrawal (0..100 units); alternate: use of an independent
 * 45-unit supply (0..100%). Nonfinite controls mean zero; finite ones clamp.
 * Recharge enters during the season, withdrawals happen, then surplus spills
 * above storage 100. Alternate supply serves demand and NEVER refills storage.
 * Undeliverable pumping is not counted; excess delivered supply is not banked.
 *
 * Balanced = demand met, no additional compaction, and ending storage >= starting
 * storage (withdrawal no greater than natural recharge). A full reservoir alone
 * is not success. Compaction records the greatest authored end-season drawdown
 * beyond 35 units; subsequent recharge cannot undo it. This is NOT aquifer physics.
 */
export function advanceSeason(
  state: SeasonTrial,
  pump: number,
  alternate: number,
): SeasonTrial {
  const current = usableTrial(state);
  if (current.locked)
    return {
      ...current,
      history: current.history.map((record) => ({ ...record })),
    };
  const { demand, recharge } = DROUGHT_SEASONS[current.season];
  const withdrawn = Math.min(bounded(pump, 0, 100), current.storage + recharge);
  const supplied = (bounded(alternate, 0, 100) / 100) * ALTERNATE_CAPACITY;
  const storage = Math.min(100, current.storage + recharge - withdrawn);
  const compacted = Math.max(
    current.compacted,
    Math.max(0, 100 - storage - AUTHORED_DRAWDOWN_THRESHOLD) /
      (100 - AUTHORED_DRAWDOWN_THRESHOLD),
  );
  const delivered = Math.min(demand, withdrawn + supplied);
  const deficit = demand - delivered;
  const balanced =
    deficit === 0 &&
    compacted === current.compacted &&
    storage >= current.storage;
  const record: SeasonRecord = {
    season: current.season + 1,
    storage,
    compacted,
    delivered,
    demand,
    deficit,
  };
  return {
    ...record,
    locked: record.season === DROUGHT_SEASONS.length,
    balancedSeasons: current.balancedSeasons + Number(balanced),
    history: [...current.history.map((previous) => ({ ...previous })), record],
  };
}

/** Adjacent IEEE-754 value, not a rounded/quantized displacement or phase. */
function neighbour(value: number, direction: -1 | 1): number {
  if (value === 0) return direction > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  view.setBigUint64(0, bits + BigInt(direction));
  return view.getFloat64(0);
}

/**
 * One vertical phase cycle derived from the existing unit-down LOS projection.
 * Keep the requested base where representable; otherwise search neighbouring
 * floating-point values for exact model equality, never round the phase. An
 * unreachable match falls back to the exact zero/one-cycle pair. Both depths
 * remain inside the existing model's 0..MAX_SINKING_M domain.
 */
export function phaseTwin(baseDownM = 0.03): {
  firstDownM: number;
  secondDownM: number;
  verticalCycleM: number;
} {
  const verticalCycleM =
    RADAR.wavelengthM / (2 * rangeFromDisplacement([0, -1, 0]));
  const base = bounded(baseDownM, 0, MAX_SINKING_M - verticalCycleM, 0.03);
  let below = base,
    above = base;
  for (let attempt = 0; attempt < 128; attempt++) {
    for (const firstDownM of attempt === 0 ? [base] : [below, above]) {
      const secondDownM = firstDownM + verticalCycleM;
      if (firstDownM < 0 || secondDownM > MAX_SINKING_M) continue;
      const first = radarSample(0, 0, firstDownM);
      const second = radarSample(0, 0, secondDownM);
      if (
        second.cycles - first.cycles === 1 &&
        first.wrappedCycles === second.wrappedCycles
      )
        return { firstDownM, secondDownM, verticalCycleM };
    }
    below = neighbour(below, -1);
    above = neighbour(above, 1);
  }
  return { firstDownM: 0, secondDownM: verticalCycleM, verticalCycleM };
}

/** Existing synthetic bowl only: stable edge first, centre last, physical units. */
export function phaseTransect(sinkingM: number): Array<{
  xM: number;
  downMm: number;
  cycles: number;
  wrappedCycles: number;
}> {
  const sinking = bounded(sinkingM, 0, MAX_SINKING_M);
  return Array.from({ length: 121 }, (_, index) => {
    const xM = (RADAR.radiusM * (120 - index)) / 120;
    const sample = radarSample(xM, 0, sinking);
    return {
      xM,
      downMm: sample.downM * 1000,
      cycles: sample.cycles,
      wrappedCycles: sample.wrappedCycles,
    };
  });
}

/**
 * Legacy API names actionYear/year denote dimensionless step coordinates ONLY.
 * 20 intervals plus the initial point; action at step k affects intervals after
 * k. Fractional step choices are allowed. Nonfinite inputs mean no action (20,0).
 * Output is cumulative future settling, so it can flatten but can never recover.
 * See POLICY_NOTICE; do not attach calendar dates, mm or probabilities.
 */
export function policyScenario(
  actionYear: number,
  reduction: number,
): {
  points: Array<{ year: number; baseline: number; acted: number }>;
  baselineTotal: number;
  actedTotal: number;
} {
  const actionStep = bounded(actionYear, 0, 20, 20);
  const fraction = bounded(reduction, 0, 1);
  const points = Array.from({ length: 21 }, (_, step) => ({
    year: step,
    baseline: step,
    acted:
      Math.min(step, actionStep) +
      Math.max(0, step - actionStep) * (1 - fraction),
  }));
  return { points, baselineTotal: 20, actedTotal: points[20].acted };
}
