import test from "node:test";
import assert from "node:assert/strict";
import {
  checkClaims,
  checkPlan,
  checkRadar,
  checkStreet,
  checkWaterOrder,
  investigatorRank,
  nextClue,
} from "../features/public-story/quest/quest-model";

test("the five investigation tasks distinguish reasoning, near misses and unsupported real-world leaps", () => {
  assert.equal(checkWaterOrder([0, 1, 2, 3]).correct, true);
  for (const value of [
    [0, 1, 3, 2],
    [1, 0, 2, 3],
    [0, 0, 2, 3],
    [],
    [0, 1, 2, NaN],
  ])
    assert.equal(checkWaterOrder(value).correct, false);
  assert.match(checkWaterOrder([0, 2, 1, 3]).message, /pressure.*before/);
  assert.equal(checkStreet(1).correct, true);
  assert.match(checkStreet(2).message, /2 cm/);
  assert.match(checkStreet(0).message, /0 cm/);
  for (const value of [null, -1, 0.5, NaN, 9])
    assert.equal(checkStreet(value).correct, false);
  const model = {
    sinkingCm: 0,
    observation: "compare",
    selectedSite: "centre",
  };
  assert.equal(checkRadar(model, 0).correct, true);
  assert.equal(
    checkRadar(model, 1).correct,
    false,
    "synthetic zero cannot prove real stability",
  );
  assert.equal(
    checkRadar({ ...model, selectedSite: "edge", sinkingCm: 18 }, 0).correct,
    false,
    "stable edge is not zero centre sinking",
  );
  for (const sinkingCm of [1, 0.001, NaN, -1])
    assert.equal(checkRadar({ ...model, sinkingCm }, 0).correct, false);
  assert.equal(
    checkRadar({ ...model, observation: "before" }, 0).correct,
    false,
    "one visit is insufficient",
  );
  assert.equal(checkClaims([0, 1, 2]).correct, true);
  for (const value of [
    [0, 1, 0],
    [null, 1, 2],
    [0, 1],
    [0, 1, 2, 3],
  ])
    assert.equal(checkClaims(value).correct, false);
  assert.match(checkClaims([1, 1, 2]).message, /Provisional.*measured/);
  assert.equal(checkPlan([1, 0]).correct, true);
  assert.match(checkPlan([0]).message, /monitoring/);
  assert.match(checkPlan([1]).message, /withdrawal/);
  for (const value of [[], [0, 1, 2], [0, 1, 3], [0, 0], [-1, 0], [0, 0.5]])
    assert.equal(checkPlan(value).correct, false);
  assert.equal(nextClue(["aquifer", "radar"]), "uneven");
  assert.equal(
    nextClue(["aquifer", "uneven", "radar", "evidence", "tokyo"]),
    undefined,
  );
  assert.equal(investigatorRank(0), "New investigator");
  assert.equal(investigatorRank(5), "Signal detective");
});
