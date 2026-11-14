import test from "node:test";
import assert from "node:assert/strict";
import {
  ALTERNATE_CAPACITY,
  AUTHORING_NOTICE,
  AUTHORED_DRAWDOWN_THRESHOLD,
  DROUGHT_SEASONS,
  POLICY_NOTICE,
  advanceSeason,
  freshSeasonTrial,
  phaseTransect,
  phaseTwin,
  policyScenario,
} from "../lib/field-investigation";
import { MAX_SINKING_M, RADAR, TOWARD_RADAR, radarSample } from "../lib/radar-interferometry";

test("authored rules explicitly distinguish game supply and policy units from physical radar units", () => {
  assert.match(AUTHORING_NOTICE, /Invented game units/);
  assert.match(AUTHORING_NOTICE, /not real groundwater pressures, years, a constitutive threshold/);
  assert.match(POLICY_NOTICE, /1 settling unit per step for 20 steps/);
  assert.match(POLICY_NOTICE, /not calendar years/);
  assert.match(POLICY_NOTICE, /not millimetres/);
});

test("season withdrawals conserve resources; alternative supply never becomes stored water", () => {
  for (const pump of [0, 15, 45, 100]) {
    for (const alternate of [0, 30, 100]) {
      let state = freshSeasonTrial();
      for (const { demand, recharge } of DROUGHT_SEASONS) {
        const before = structuredClone(state);
        const next = advanceSeason(state, pump, alternate);
        assert.deepEqual(state, before, "the pure step must not mutate its input");
        const withdrawn = Math.min(pump, state.storage + recharge);
        const spill = Math.max(0, state.storage + recharge - withdrawn - 100);
        assert.equal(next.storage + withdrawn + spill, state.storage + recharge);
        assert.equal(next.delivered, Math.min(demand, withdrawn + alternate / 100 * ALTERNATE_CAPACITY));
        assert.equal(next.delivered + next.deficit, demand);
        assert.equal(next.storage, advanceSeason(state, pump, 0).storage);
        assert.ok(next.compacted >= state.compacted && next.compacted <= 1);
        state = next;
      }
    }
  }
  let dry = freshSeasonTrial();
  for (let i = 0; i < 3; i++) dry = advanceSeason(dry, 100, 0);
  assert.equal(dry.storage, 0);
  assert.equal(dry.delivered, DROUGHT_SEASONS[2].recharge);
  assert.equal(dry.deficit, DROUGHT_SEASONS[2].demand - DROUGHT_SEASONS[2].recharge);
});

test("compaction begins only beyond the authored drawdown and survives recharge", () => {
  assert.equal(advanceSeason(freshSeasonTrial(), 50, 0).compacted, 0);
  assert.ok(advanceSeason(freshSeasonTrial(), 51, 0).compacted > 0);
  let state = advanceSeason(freshSeasonTrial(), 100, 0);
  const compacted = state.compacted;
  assert.equal(compacted, (100 - state.storage - AUTHORED_DRAWDOWN_THRESHOLD) / 65);
  const lowStorage = state.storage;
  for (let i = 0; i < 3; i++) state = advanceSeason(state, 0, 100);
  assert.ok(state.storage > lowStorage);
  assert.equal(state.compacted, compacted);
});

test("no idle, pumping-only or supply-only free success; fresh retry can balance all four seasons", () => {
  for (const [pump, alternate] of [[0, 0], [100, 0], [0, 100]]) {
    let failed = freshSeasonTrial();
    for (let i = 0; i < 4; i++) failed = advanceSeason(failed, pump, alternate);
    assert.ok(failed.balancedSeasons < 4);
  }
  let state = freshSeasonTrial();
  assert.equal(state.balancedSeasons, 0);
  for (const [index, pump] of [0, 10, 15, 5].entries()) {
    state = advanceSeason(state, pump, 100);
    assert.equal(state.deficit, 0);
    assert.equal(state.storage, 100);
    assert.equal(state.compacted, 0);
    assert.equal(state.balancedSeasons, index + 1);
    assert.equal(state.history.length, index + 1);
    assert.deepEqual(state.history[index], {
      season: index + 1, storage: 100, compacted: 0,
      delivered: DROUGHT_SEASONS[index].demand,
      demand: DROUGHT_SEASONS[index].demand, deficit: 0,
    });
  }
  assert.equal(state.locked, true);
  assert.equal(state.season, 4);
  for (let i = 0; i < 12; i++) assert.deepEqual(advanceSeason(state, 100, 0), state);
  assert.deepEqual(advanceSeason({ ...state, locked: false }, 0, 0), state, "stale lock cannot extend the trial");
  const fresh = freshSeasonTrial();
  assert.equal(fresh.season, 0);
  assert.equal(fresh.storage, 100);
  assert.equal(fresh.compacted, 0);
  assert.equal(fresh.locked, false);
  assert.deepEqual(fresh.history, []);
  assert.notEqual(fresh.history, freshSeasonTrial().history);
});

test("meeting demand while mining storage does not count as a balanced season", () => {
  const mined = advanceSeason(freshSeasonTrial(), 45, 0);
  assert.equal(mined.deficit, 0);
  assert.equal(mined.compacted, 0);
  assert.equal(mined.storage, 70);
  assert.equal(mined.balancedSeasons, 0);
});

test("finite controls clamp and nonfinite controls are harmless; corrupt numeric state cannot leak NaN", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(advanceSeason(freshSeasonTrial(), value, value), advanceSeason(freshSeasonTrial(), 0, 0));
    assert.deepEqual(advanceSeason({ ...freshSeasonTrial(), storage: value }, 0, 0), advanceSeason(freshSeasonTrial(), 0, 0));
  }
  assert.deepEqual(advanceSeason(freshSeasonTrial(), -20, -20), advanceSeason(freshSeasonTrial(), 0, 0));
  assert.deepEqual(advanceSeason(freshSeasonTrial(), 300, 300), advanceSeason(freshSeasonTrial(), 100, 100));
  const first = advanceSeason(freshSeasonTrial(), 0, 100);
  const next = advanceSeason(first, 10, 100);
  next.history[0].storage = 0;
  assert.equal(first.history[0].storage, 100, "successive states do not share mutable history records");
});

test("phase twins are exactly equal when wrapped, one unwrapped cycle apart, without quantizing phase", () => {
  const bases = [undefined, 0, 0.001, 0.03, 0.1, 0.12, 0.15, 0.3, -1, 4, NaN, Infinity, -Infinity];
  for (let i = 0; i <= 1000; i++) bases.push(i / 1000 * MAX_SINKING_M);
  for (const base of bases) {
    const twin = phaseTwin(base);
    const first = radarSample(0, 0, twin.firstDownM);
    const second = radarSample(0, 0, twin.secondDownM);
    assert.equal(twin.verticalCycleM, RADAR.wavelengthM / (2 * TOWARD_RADAR[1]));
    assert.equal(first.wrappedCycles, second.wrappedCycles, `exact wrapped match at base ${base}`);
    assert.equal(second.cycles - first.cycles, 1, `exact unwrapped separation at base ${base}`);
    assert.equal(twin.secondDownM, twin.firstDownM + twin.verticalCycleM);
    assert.ok(twin.firstDownM >= 0 && twin.secondDownM <= MAX_SINKING_M);
    if (base !== undefined && Number.isFinite(base) && base >= 0 && base <= MAX_SINKING_M) {
      const clampedBase = Math.min(base, MAX_SINKING_M - twin.verticalCycleM);
      assert.ok(Math.abs(twin.firstDownM - clampedBase) < 1e-14, "only neighbouring floats, not a quantized depth");
    }
  }
  assert.equal(phaseTwin().firstDownM, 0.03);
});

test("transect is 121 finite existing-model samples from stable edge to centre", () => {
  for (const input of [0, 0.03, 0.3, 9, -1, NaN, Infinity, -Infinity]) {
    const samples = phaseTransect(input);
    assert.equal(samples.length, 121);
    assert.deepEqual(samples[0], { xM: 120, downMm: 0, cycles: 0, wrappedCycles: 0 });
    assert.equal(samples[120].xM, 0);
    const sinking = Number.isFinite(input) ? Math.max(0, Math.min(MAX_SINKING_M, input)) : 0;
    samples.forEach((sample, index) => {
      assert.ok(Object.values(sample).every(Number.isFinite));
      const expected = radarSample(sample.xM, 0, sinking);
      assert.equal(sample.downMm, expected.downM * 1000);
      assert.equal(sample.cycles, expected.cycles);
      assert.equal(sample.wrappedCycles, expected.wrappedCycles);
      assert.equal(sample.xM, 120 - index);
      if (index > 0) assert.ok(sample.downMm >= samples[index - 1].downMm);
    });
  }
});

test("policy steps accumulate fictional settling: earlier action reduces totals but cannot recover height", () => {
  for (const reduction of [0, 0.2, 0.7, 1]) {
    let previousTotal = 0;
    for (let step = 0; step <= 20; step++) {
      const result = policyScenario(step, reduction);
      assert.equal(result.points.length, 21, "20 intervals plus the initial point");
      assert.deepEqual(result.points[0], { year: 0, baseline: 0, acted: 0 });
      assert.equal(result.baselineTotal, 20);
      assert.equal(result.actedTotal, result.points[20].acted);
      assert.ok(result.actedTotal >= previousTotal, "later action cannot reduce cumulative settling");
      previousTotal = result.actedTotal;
      result.points.forEach((point, index) => {
        assert.equal(point.year, index);
        assert.equal(point.baseline, index);
        assert.ok(point.acted <= point.baseline && point.acted >= 0);
        if (index > 0) assert.ok(point.acted >= result.points[index - 1].acted);
        if (index <= step) assert.equal(point.acted, point.baseline);
      });
    }
  }
  assert.equal(policyScenario(0, 1).actedTotal, 0);
  assert.equal(policyScenario(20, 1).actedTotal, 20);
  assert.equal(policyScenario(5, 1).actedTotal, 5);
  assert.equal(policyScenario(5.5, 1).actedTotal, 5.5);
  assert.deepEqual(policyScenario(10, 0).points.map(point => point.acted), policyScenario(10, 0).points.map(point => point.baseline));
});

test("policy bounds/nonfinite controls are finite and default conservatively to no action", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(policyScenario(value, 1), policyScenario(20, 1));
    assert.deepEqual(policyScenario(0, value), policyScenario(0, 0));
    assert.ok(policyScenario(value, value).points.every(point => Object.values(point).every(Number.isFinite)));
  }
  assert.deepEqual(policyScenario(-3, 2), policyScenario(0, 1));
  assert.deepEqual(policyScenario(30, -3), policyScenario(20, 0));
});
