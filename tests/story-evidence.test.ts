import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceSceneTime, sceneEvidence, sceneTimeLabel, LEGACY_WORKSPACE_ANCHORS } from '../lib/story-evidence';

test('real observations never label a selected future as measured', () => {
  assert.equal(sceneEvidence('measured', 0), 'measured');
  for (const years of [0.1, 1, 20, 30]) {
    assert.equal(sceneEvidence('measured', years), 'projected');
    assert.match(sceneTimeLabel('measured', years), /if these rates continued/);
  }
  for (const years of [0, 6, 20, 30]) {
    assert.equal(sceneEvidence('simulation', years), 'illustrated');
    assert.match(sceneTimeLabel('simulation', years), /Illustration/);
    assert.doesNotMatch(sceneTimeLabel('simulation', years), /2026|2046|measured/);
  }
});

test('global pause, offscreen state and reduced motion freeze a playing city', () => {
  const active = { playing: true, paused: false, visible: true, reducedMotion: false };
  assert.ok(advanceSceneTime(4, .016, active) > 4);
  for (const gate of [{ playing: false }, { paused: true }, { visible: false }, { reducedMotion: true }]) {
    let years = 4;
    for (let frame = 0; frame < 120; frame++) years = advanceSceneTime(years, .016, { ...active, ...gate });
    assert.equal(years, 4, JSON.stringify(gate));
  }
  assert.equal(advanceSceneTime(29.99, 1, active), 30);
  assert.equal(advanceSceneTime(4, -1, active), 4);
});

test('only old workspace anchors migrate out of the public story', () => {
  assert.ok(LEGACY_WORKSPACE_ANCHORS.has('place-setup'));
  assert.ok(LEGACY_WORKSPACE_ANCHORS.has('decision-map'));
  assert.ok(!LEGACY_WORKSPACE_ANCHORS.has('consequences'));
  assert.ok(!LEGACY_WORKSPACE_ANCHORS.has('sources'));
});
