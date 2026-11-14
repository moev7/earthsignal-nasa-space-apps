import test from "node:test";
import assert from "node:assert/strict";
import {
  storyBeatIndex,
  storySceneCanPin,
  storySceneProgress,
  storyScrollProgress,
} from "../lib/story-scroll";

test("normal scrolling reverses exactly and deep links/resize produce bounded chapter poses", () => {
  assert.equal(storyScrollProgress(140, 2100, 700, 140), 0);
  assert.equal(storyScrollProgress(-560, 2100, 700, 140), 0.5);
  assert.equal(storyScrollProgress(-1260, 2100, 700, 140), 1);
  assert.equal(
    storyScrollProgress(140, 2100, 700, 140),
    0,
    "returning to the start restores the initial pose",
  );
  assert.equal(storyScrollProgress(500, 2100, 700, 140), 0);
  assert.equal(storyScrollProgress(-9000, 2100, 700, 140), 1);
  const resized = storyScrollProgress(-560, 2100, 900, 140);
  assert.ok(resized >= 0 && resized <= 1);
  assert.equal(storyScrollProgress(NaN, 2100, 700, 140), 0);
  assert.deepEqual(
    [0, 0.5, 1].map((p) => storyBeatIndex(p, 3)),
    [0, 1, 2],
  );
});
test("pause and reduced motion keep the displayed pose while reading continues; explicit resume reconciles", () => {
  assert.equal(storySceneProgress(0.9, 0.25, true, false), 0.25);
  assert.equal(storySceneProgress(0.9, 0.25, false, true), 0.25);
  assert.equal(storySceneProgress(0.9, 0.25, false, false), 0.9);
  assert.equal(
    storyBeatIndex(0.9, 3),
    2,
    "the reader can reach later text without playing motion",
  );
});

test("scene pinning reserves reading space across mobile chrome, enlarged text and orientation changes", () => {
  assert.equal(storySceneCanPin(380, 760, 112, false), true);
  assert.equal(
    storySceneCanPin(380, 620, 112, false),
    true,
    "compact portrait keeps128px for reading instead of requiring the desktop144px reserve",
  );
  assert.equal(
    storySceneCanPin(446, 635, 113, false),
    true,
    "iPhone mini portrait fits with two readable lines",
  );
  assert.equal(
    storySceneCanPin(500, 635, 113, false),
    false,
    "an actually oversized mini portrait visual still releases",
  );
  assert.equal(
    storySceneCanPin(580, 760, 112, false),
    false,
    "expanded controls or text zoom release the scene",
  );
  assert.equal(
    storySceneCanPin(220, 390, 112, false),
    false,
    "landscape phone remains ordinary flow",
  );
  assert.equal(storySceneCanPin(380, 760, 112, true), false);
  assert.equal(storySceneCanPin(0, 760, 112, false), false);
  assert.equal(storySceneCanPin(NaN, 760, 112, false), false);
});
