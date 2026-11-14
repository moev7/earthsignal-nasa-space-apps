import test from "node:test";
import assert from "node:assert/strict";
import {
  MISSION_IDS,
  MISSIONS,
  MISSION_STORAGE_KEY,
  answerMission,
  createMissionStore,
  emptyMissionProgress,
  missionScore,
  readMissionProgress,
} from "../lib/story-missions";

function memory() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test("discoveries require a correct answer once; arbitrary scores and repeated answers earn nothing", () => {
  let p = emptyMissionProgress();
  for (const id of MISSION_IDS) {
    assert.equal(answerMission(p, id, 99), p);
    p = answerMission(p, id, MISSIONS[id].correct);
    assert.equal(answerMission(p, id, MISSIONS[id].correct), p);
  }
  assert.equal(missionScore(p), 100);
  assert.equal(p.completed.length, 5);
  assert.equal(
    missionScore({ ...p, completed: [...p.completed, ...p.completed] }),
    100,
  );
});
test("local progress is read without default writes, merges tabs, and reset invalidates old receipts", () => {
  const storage = memory(),
    a = createMissionStore(storage, () => "reset-1"),
    b = createMissionStore(storage);
  assert.equal(storage.values.size, 0);
  a.answer("aquifer", 1);
  b.answer("uneven", 1);
  assert.deepEqual(a.sync().progress.completed, ["aquifer", "uneven"]);
  assert.deepEqual(b.sync().progress.completed, ["aquifer", "uneven"]);
  a.reset();
  assert.equal(missionScore(b.sync().progress), 0);
  storage.setItem(
    MISSION_STORAGE_KEY + ":radar",
    JSON.stringify({ version: 1, generation: "initial" }),
  );
  assert.equal(
    missionScore(a.sync().progress),
    0,
    "old tab receipts cannot resurrect before-reset progress",
  );
  b.answer("radar", 0);
  assert.deepEqual(a.sync().progress.completed, ["radar"]);
  a.setEnabled(false);
  assert.equal(b.sync().progress.enabled, false);
  assert.equal(
    missionScore(b.sync().progress),
    20,
    "hiding questions retains discoveries",
  );
});
test("corrupt, blocked, quota-limited and newer storage leave the story usable", () => {
  const storage = memory();
  storage.setItem(MISSION_STORAGE_KEY, "broken");
  assert.equal(readMissionProgress(storage).status, "recovered");
  storage.setItem(
    MISSION_STORAGE_KEY,
    JSON.stringify({ version: 99, generation: "future", score: 999 }),
  );
  const future = storage.getItem(MISSION_STORAGE_KEY),
    a = createMissionStore(storage);
  assert.equal(a.sync().status, "newer");
  assert.equal(missionScore(a.answer("aquifer", 1).progress), 20);
  a.reset();
  assert.equal(
    storage.getItem(MISSION_STORAGE_KEY),
    future,
    "unknown newer data is not overwritten",
  );
  const denied = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  const b = createMissionStore(denied);
  assert.equal(b.sync().status, "session");
  assert.equal(missionScore(b.answer("aquifer", 1).progress), 20);
  const quota = {
    getItem: () => null,
    setItem() {
      throw new Error("quota");
    },
  };
  const c = createMissionStore(quota);
  assert.equal(c.answer("aquifer", 1).status, "session");
  assert.equal(missionScore(c.answer("uneven", 1).progress), 40);
});
