import test from 'node:test';
import assert from 'node:assert/strict';
import { RADAR, RADAR_SITES, MAX_SINKING_M, SATELLITE_M, TOWARD_RADAR, bowlWeight, depthColour, displayPoint, phaseColour, phaseFromRange, radarSample, radarSite, rangeFromDisplacement, surfaceColour } from '../lib/radar-interferometry';
const near = (actual: number, expected: number, epsilon = 1e-12) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);

test('zero movement is uniformly zero phase everywhere, including the far side', () => {
  for (const x of [-120, -60, 0, 60, 120]) for (const z of [-120, 0, 120]) {
    const sample = radarSample(x, z, 0);
    assert.equal(sample.deltaRangeM, 0);
    assert.equal(sample.cycles, 0);
    assert.equal(sample.radians, 0);
    assert.equal(sample.wrappedCycles, 0);
    assert.deepEqual(phaseColour(sample.cycles), phaseColour(0));
  }
  assert.equal(rangeFromDisplacement([0, 0, 0]), 0);
});
test('positive-away convention projects vertical and horizontal movement onto the same LOS', () => {
  const sample = radarSample(0, 0, 0.18);
  near(sample.deltaRangeM, 0.14744736797201852);
  near(sample.cycles, 1.2287280664334876);
  near(sample.radians, 4 * Math.PI * sample.deltaRangeM / 0.24);
  assert.ok(rangeFromDisplacement([0, 0.1, 0]) < 0, 'uplift shortens range');
  assert.ok(rangeFromDisplacement([0.1, 0, 0]) > 0, 'horizontal displacement away from this radar lengthens range');
  assert.equal(rangeFromDisplacement([0, 0, 12]), 0, 'cross-look displacement is invisible in the far field');
  near(Math.hypot(...TOWARD_RADAR), 1);
  near(SATELLITE_M[0] / SATELLITE_M[1], -Math.tan(35 * Math.PI / 180));
});
test('half-wavelength LOS displacement wraps one full phase cycle, not 12 cm vertical', () => {
  const full = phaseFromRange(RADAR.wavelengthM / 2);
  assert.equal(full.cycles, 1);
  near(full.radians, 2 * Math.PI);
  assert.equal(full.wrappedCycles, 0);
  assert.deepEqual(phaseColour(full.cycles), phaseColour(0));
  near(phaseFromRange(-0.03).wrappedCycles, 0.75);
  const verticalFull = (RADAR.wavelengthM / 2) / Math.cos(35 * Math.PI / 180);
  near(radarSample(0, 0, verticalFull).cycles, 1);
  assert.ok(radarSample(0, 0, 0.12).cycles < 1);
  assert.throws(() => phaseFromRange(1, 0), RangeError);
});
test('invented bowl is smooth, symmetric and fixed at its reference edge', () => {
  assert.equal(bowlWeight(0, 0), 1);
  assert.equal(bowlWeight(120, 0), 0);
  assert.equal(bowlWeight(180, 0), 0);
  assert.equal(bowlWeight(30, 40), bowlWeight(-40, 30));
  assert.ok(bowlWeight(60, 0) < bowlWeight(30, 0));
  const epsilon = 0.001;
  assert.ok(Math.abs((bowlWeight(epsilon, 0) - bowlWeight(0, 0)) / epsilon) < 1e-6);
  assert.ok(Math.abs((bowlWeight(120, 0) - bowlWeight(120 - epsilon, 0)) / epsilon) < 1e-6);
  assert.equal(radarSample(120, 0, 0.3).cycles, 0);
});
test('display exaggeration affects shape alone and cyclic colours remain continuous', () => {
  const sample = radarSample(0, 0, 0.18);
  const physical = structuredClone(sample);
  const realScale = displayPoint(sample.afterM, 1);
  const exaggerated = displayPoint(sample.afterM, 240);
  near(exaggerated[1], realScale[1] * 240);
  assert.deepEqual(sample, physical);
  near(sample.cycles, 1.2287280664334876);
  for (const cycles of [-1, 0, 0.2, 0.8, 1.4, 3]) {
    const a = phaseColour(cycles), b = phaseColour(cycles + 1);
    a.forEach((value, i) => near(value, b[i]));
    assert.ok(a.every(value => value >= 0 && value <= 1));
  }
});

test('fixed sample sites share the unexaggerated LOS projection at centre, slope and stable edge', () => {
  assert.deepEqual(RADAR_SITES.map(site => [site.label, site.xM, site.zM]), [['Centre', 0, 0], ['Slope', 60, 0], ['Stable edge', 120, 0]]);
  const expectedDown = [0.18, 0.0759375, 0];
  RADAR_SITES.forEach((site, i) => {
    assert.equal(radarSite(site.id), site);
    const sample = radarSample(site.xM, site.zM, 0.18);
    near(sample.downM, expectedDown[i]);
    near(sample.deltaRangeM, expectedDown[i] * Math.cos(35 * Math.PI / 180));
    near(sample.cycles, 2 * expectedDown[i] * Math.cos(35 * Math.PI / 180) / RADAR.wavelengthM);
    for (const mode of ['phase', 'depth'] as const) {
      assert.deepEqual(surfaceColour(radarSample(site.xM, site.zM, 0), mode), surfaceColour(radarSample(0, 0, 0), mode));
      assert.deepEqual(surfaceColour(sample, mode), mode === 'phase' ? phaseColour(sample.cycles) : depthColour(sample.downM));
    }
  });
});

test('depth uses a continuous fixed 0–30 cm ramp, whereas phase wraps', () => {
  assert.equal(MAX_SINKING_M, 0.3);
  assert.deepEqual(depthColour(-0.1), depthColour(0));
  assert.deepEqual(depthColour(0.4), depthColour(0.3));
  const endpoints = [depthColour(0), depthColour(0.3)];
  assert.notDeepEqual(endpoints[0], endpoints[1]);
  depthColour(0.15).forEach((channel, i) => assert.ok(channel < endpoints[0][i] && channel > endpoints[1][i]));
  const fullCycleDown = 0.12 / Math.cos(35 * Math.PI / 180);
  const zero = radarSample(0, 0, 0), wrapped = radarSample(0, 0, fullCycleDown);
  assert.deepEqual(surfaceColour(wrapped, 'phase'), surfaceColour(zero, 'phase'));
  assert.notDeepEqual(surfaceColour(wrapped, 'depth'), surfaceColour(zero, 'depth'));
  // Same local depth produced by different peaks must retain the same colour.
  const slope = radarSample(60, 0, 0.3), centre = radarSample(0, 0, slope.downM);
  assert.deepEqual(surfaceColour(slope, 'depth'), surfaceColour(centre, 'depth'));
  for (const down of [0, 0.01, 0.15, 0.299, 0.3]) assert.ok(depthColour(down).every(channel => channel >= 0 && channel <= 1));
});
