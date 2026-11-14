import test from "node:test";
import assert from "node:assert/strict";
import {
  freshWater,
  waterStep,
  waterCue,
  freshRadar,
  radarStep,
  radarCue,
  freshPlan,
  planResult,
  type RadarAction,
} from "../lib/discovery-play";

test("the pumping/refill surprise preserves lost pore space, saturates and has a true fresh start", () => {
  let state = freshWater();
  for (let n = 0; n < 100; n++) state = waterStep(state, "pump");
  assert.equal(state.depletion, 1);
  assert.equal(state.compacted, 0.8);
  assert.equal(state.returned, false);
  assert.match(waterCue(state), /bring the water back/);
  const compacted = state.compacted;
  for (let n = 0; n < 100; n++) state = waterStep(state, "refill");
  assert.equal(state.depletion, 0);
  assert.equal(state.compacted, compacted);
  assert.equal(state.returned, true);
  assert.match(waterCue(state), /Some space did not/);
  assert.deepEqual(freshWater(), {
    depletion: 0,
    compacted: 0,
    pumped: false,
    returned: false,
  });
  assert.equal(
    waterStep(freshWater(), "refill").returned,
    false,
    "refilling untouched water does not earn a discovery",
  );
});

test("captures are distinct, bounded and synchronous; cold start and retry produce identical feedback", () => {
  const actions: RadarAction[] = [
    { type: "capture" },
    { type: "capture" },
    { type: "ground", value: 18 },
    { type: "capture" },
    { type: "capture" },
    { type: "compare" },
  ];
  const run = () => {
    let state = freshRadar();
    return actions.map((action) => {
      state = radarStep(state, action);
      return { state, cue: radarCue(state) };
    });
  };
  const first = run();
  assert.deepEqual(run(), first);
  assert.equal(
    first[1].state.second,
    null,
    "duplicate click is not a repeat observation",
  );
  assert.equal(first[3].state.second, 18);
  assert.equal(first[3].state.compared, false);
  assert.equal(first[5].state.compared, true);
  assert.match(first[5].cue, /18 cm change/);
  assert.deepEqual(
    radarStep(freshRadar(), { type: "ground", value: 30 }),
    freshRadar(),
    "first reference is captured before changing ground",
  );
  let state = radarStep(freshRadar(), { type: "capture" });
  state = radarStep(state, { type: "ground", value: Infinity });
  assert.equal(state.sinking, 0);
  state = radarStep(state, { type: "ground", value: 500 });
  assert.equal(state.sinking, 30);
  state = radarStep(state, { type: "capture" });
  assert.deepEqual(
    radarStep(state, { type: "ground", value: 5 }),
    state,
    "captured evidence remains frozen until a fresh experiment",
  );
  assert.deepEqual(
    radarStep(freshRadar(), { type: "compare" }),
    freshRadar(),
    "no result without two visits",
  );
});

test("a city response distinguishes acting from measuring and never promises recovered height", () => {
  assert.match(planResult(freshPlan()), /waiting/);
  assert.match(
    planResult({ ...freshPlan(), monitor: true }),
    /monitoring alone does not reduce/,
  );
  assert.match(planResult({ ...freshPlan(), limits: true }), /add monitoring/);
  assert.match(
    planResult({ limits: true, supply: true, monitor: true }),
    /may slow.*does not simply return/,
  );
});
