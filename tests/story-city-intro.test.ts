import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { TILT_LIMITS, createMeasuredWorld, tiltLevel } from '../features/ground-truth/components/story/city3d/measuredWorld'
import type { Stage } from '../features/ground-truth/components/story/city3d/shared'
import type { FocusArea } from '../features/ground-truth/data/nisar'

test('tilt level follows the measured rate: crossing years are 1/(N x rate)', () => {
  const rate = 1 / 4000 // 1 in 4000 per year
  assert.deepEqual(tiltLevel(rate, 0), { level: -1, since: Infinity })
  assert.equal(tiltLevel(rate, 7.9).level, -1, '1 in 500 needs 8 years')
  const at8 = tiltLevel(rate, 8)
  assert.equal(at8.level, 0)
  assert.ok(Math.abs(at8.since) < 1e-9)
  assert.equal(tiltLevel(rate, 13.4).level, 1, '1 in 300 after 13.3 years')
  assert.equal(tiltLevel(rate, 26.7).level, 2, '1 in 150 after 26.7 years')
  assert.equal(tiltLevel(0, 30).level, -1, 'no significant tilt never reaches a limit')
  assert.equal(tiltLevel(Number.NaN, 30).level, -1)
})

test('real Tehran walls show ground-tilt limits in tilt mode and rates otherwise; never cracks', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const noop = () => {}
  const gradient = { addColorStop: noop }
  const context = new Proxy({}, { get: (_target, key) => String(key).startsWith('create') ? () => gradient : noop, set: () => true })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } })
  const area = JSON.parse(readFileSync(new URL('../public/data/nisar/tehran-sw-2026/focus.json', import.meta.url), 'utf8')) as FocusArea
  const stops = [{ value: -350, colour: '#c23d17' }, { value: 0, colour: '#ffffff' }, { value: 350, colour: '#22508f' }]
  try {
    const scene = new THREE.Scene()
    const stage = { scene, sun: new THREE.DirectionalLight(), camera: new THREE.PerspectiveCamera(), exhibition: true, renderer: { capabilities: { getMaxAnisotropy: () => 1 } } } as unknown as Stage
    const world = createMeasuredWorld(stage, area, stops)
    try {
      const walls: THREE.MeshStandardMaterial[] = []
      const cracks: THREE.MeshStandardMaterial[] = []
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh) || !Array.isArray(object.material)) return
        if (object.userData.id !== undefined) walls[object.userData.id] = object.material[1] as THREE.MeshStandardMaterial
        else if ((object.material[1] as THREE.MeshStandardMaterial)?.transparent) cracks.push(object.material[1] as THREE.MeshStandardMaterial)
      })
      assert.equal(walls.length, world.buildingCount)
      const hex = (c: THREE.Color) => '#' + c.getHexString()
      world.setRisk(true)
      world.setColourMode('tilt')
      world.setTime(0, false, false)
      const colours0 = new Set(walls.map(w => hex(w.color)))
      assert.ok(!TILT_LIMITS.some(l => colours0.has(l.colour)), 'nothing has reached a limit in 2026')

      world.setTime(30, true, true)
      const counted = TILT_LIMITS.map(l => walls.filter(w => hex(w.color) === l.colour).length)
      // Wall colours show the highest limit reached; countAt counts "at or past", so they nest.
      assert.equal(counted[2], world.countAt(150, 30))
      assert.equal(counted[1] + counted[2], world.countAt(300, 30))
      assert.equal(counted[0] + counted[1] + counted[2], world.countAt(500, 30))
      assert.ok(world.countAt(300, 30) > 0, 'the high-rated square reaches the cracking limit within 30 years')
      assert.ok(cracks.every(c => c.opacity === 0), 'ground observations never draw cracks on real buildings')

      world.setColourMode('rate')
      assert.ok(walls.every(w => w.emissive.getHex() === 0), 'rate mode clears the crossing glow')
      assert.ok(!walls.some(w => hex(w.color) === TILT_LIMITS[2].colour), 'rate colours are back')
    } finally {
      world.dispose()
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original)
    else delete (globalThis as { document?: unknown }).document
  }
})
