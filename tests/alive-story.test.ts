import test from "node:test";
import assert from "node:assert/strict";
import { storyWaterPose, waterAt } from "../lib/story-discovery";
import { freshWater } from "../lib/discovery-play";
import { buildStreetInstrument } from "../features/public-story/discovery/createStreetInstrument";

test("the authored water journey drains then returns water while retaining squeezed space; reversal is deterministic", () => {
  const initial = storyWaterPose(0),
    low = storyWaterPose(0.62),
    returned = storyWaterPose(1);
  assert.equal(initial.depletion, 0);
  assert.equal(low.depletion, 1);
  assert.equal(returned.depletion, 0);
  assert.equal(returned.compacted, low.compacted);
  assert.equal(returned.returned, true);
  assert.deepEqual(storyWaterPose(0), initial);
  assert.deepEqual(storyWaterPose(NaN), initial);
  let manual = waterAt(freshWater(), 1);
  manual = waterAt(manual, 0);
  assert.equal(manual.returned, true);
  assert.equal(manual.compacted, 0.8);
  assert.deepEqual(waterAt(manual, NaN), manual);
});

test("actual 3D street joins moving ground endpoints, distinguishes equal movement and disposes every owned geometry/material", () => {
  const model = buildStreetInstrument();
  assert.ok(model.root.children.length > 5);
  model.update(18, 18);
  assert.equal(model.left.position.y, model.right.position.y);
  assert.equal(model.link.rotation.z, 0);
  const result = model.update(4, 18);
  assert.equal(result.difference, 14);
  const endpoint = (side: number) =>
    model.link.position.y +
    side * model.link.scale.x * 0.5 * Math.sin(model.link.rotation.z);
  assert.ok(Math.abs(endpoint(-1) - model.left.position.y) < 1e-8);
  assert.ok(Math.abs(endpoint(1) - model.right.position.y) < 1e-8);
  model.update(NaN, Infinity);
  assert.ok(Number.isFinite(model.left.position.y));
  assert.ok(Number.isFinite(model.link.rotation.z));
  const objects = new Set<{
    addEventListener: (kind: string, fn: () => void) => unknown;
  }>();
  model.root.traverse((node) => {
    const mesh = node as unknown as {
      geometry?: typeof objects extends Set<infer U> ? U : never;
      material?: typeof objects extends Set<infer U> ? U : never;
    };
    if (mesh.geometry) objects.add(mesh.geometry);
    if (mesh.material) objects.add(mesh.material);
  });
  let disposed = 0;
  objects.forEach((object) =>
    object.addEventListener("dispose", () => disposed++),
  );
  model.dispose();
  assert.equal(disposed, objects.size);
  assert.equal(model.root.children.length, 0);
});
