import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSimulationWorld } from '../features/ground-truth/components/story/city3d/simulationWorld';
import type { Stage } from '../features/ground-truth/components/story/city3d/shared';

test('rewinding the real simulation clears visible collapse particles without a running clock', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  // Texture drawing is irrelevant to the world/particle state; no GPU is needed.
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const context = new Proxy({}, {
    get: (_target, key) => String(key).startsWith('create') ? () => gradient : key === 'measureText' ? () => ({ width: 40 }) : noop,
    set: () => true,
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(560, 360, 600);
  const world = createSimulationWorld({ scene, camera, renderer: { capabilities: { getMaxAnisotropy: () => 1 } } } as unknown as Stage);
  try {
    let dust!: THREE.Points<THREE.BufferGeometry>;
    let debris!: THREE.InstancedMesh;
    scene.traverse(object => {
      if (object instanceof THREE.Points && object.geometry.attributes.alpha) dust = object;
      if (object instanceof THREE.InstancedMesh && object.count === 900) debris = object;
    });
    assert.ok(dust); assert.ok(debris);
    world.setTime(0, false, false);
    world.setTime(30, true, true);
    for (let frame = 0; frame < 600; frame++) world.step(1 / 60, 30);
    const alpha = dust.geometry.attributes.alpha;
    assert.ok(alpha instanceof THREE.BufferAttribute);
    assert.ok(Array.from(alpha.array).some(value => value > 0), 'the real collapse emitted visible dust');
    const version = alpha.version;
    world.clearDebris();
    assert.ok(Array.from(alpha.array).every(value => value === 0), 'rewind clears the visible GPU attribute before another frame');
    assert.ok(alpha.version > version, 'the cleared buffer will be uploaded');
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < debris.count; index++) {
      debris.getMatrixAt(index, matrix);
      assert.equal(matrix.determinant(), 0, 'dead debris is hidden immediately');
    }
    world.setTime(0, false, false);
    world.step(0, 0);
    assert.ok(Array.from(alpha.array).every(value => value === 0), 'no stale dust returns when the clock is stopped');
  } finally {
    world.dispose();
    assert.equal(scene.children.length, 0);
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
