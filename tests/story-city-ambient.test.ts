import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { AMBIENT_BUDGET, createStreetLife, routePose, streetRoutes } from '../features/ground-truth/components/story/city3d/ambient'
import { createMeasuredWorld } from '../features/ground-truth/components/story/city3d/measuredWorld'
import { createSimulationWorld } from '../features/ground-truth/components/story/city3d/simulationWorld'
import type { Stage } from '../features/ground-truth/components/story/city3d/shared'
import type { FocusArea } from '../features/ground-truth/data/nisar'

const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }
const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
function actors(root: THREE.Object3D) {
  const list: THREE.InstancedMesh[] = []
  root.traverse(object => { if (object instanceof THREE.InstancedMesh && object.name.startsWith('street-')) list.push(object) })
  return list
}
function buffers(meshes: THREE.InstancedMesh[]) {
  const geometries = new Set(meshes.map(mesh => mesh.geometry))
  return meshes.reduce((sum, mesh) => sum + mesh.instanceMatrix.array.byteLength + (mesh.instanceColor?.array.byteLength ?? 0), 0)
    + [...geometries].reduce((sum, geo) => sum + Object.values(geo.attributes).reduce((s, attr) => s + attr.array.byteLength, 0) + (geo.index?.array.byteLength ?? 0), 0)
}

test('finite OSM route clipping preserves polylines, excludes motorway pedestrians and bounds every sample', () => {
  const routes = streetRoutes([
    { kind: 'road:residential', line: [[-200, 40], [0, 0], [200, -40]] },
    { kind: 'road:motorway', line: [[-90, 20], [90, 20]] },
    { kind: 'road:trunk_link', line: [[-90, 10], [90, 10]] },
    { kind: 'road:footway', line: [[-90, -20], [90, -20]] },
    { kind: 'road:service', line: [[NaN, 0], [1, 1], [1, 1]] },
    { kind: 'green', line: [[-90, 0], [90, 0]] },
  ], bounds)
  assert.equal(routes.length, 4)
  assert.equal(routes[0].segments.length, 2, 'bend is retained rather than replacing the road with a chord')
  assert.equal(routes[1].pedestrians, false); assert.equal(routes[2].pedestrians, false)
  assert.equal(routes[3].cars, false)
  const pose = { x: 0, z: 0, yaw: 0 }
  for (const route of routes) for (const d of [-1e9, -20, 0, 90, 1e9, NaN, Infinity]) {
    routePose(route, d, 6, bounds, pose)
    assert.ok(Object.values(pose).every(Number.isFinite))
    assert.ok(pose.x >= bounds.minX && pose.x <= bounds.maxX && pose.z >= bounds.minZ && pose.z <= bounds.maxZ)
  }
  const split = streetRoutes([{ kind: 'road:service', line: [[-90, 0], [200, 0], [200, -50], [70, -50]] }], bounds)
  assert.equal(split.length, 2, 'leaving/re-entering the cutout creates separate runs, never a fictional connector')
})

test('real instance positions advance on ambient delta, cap actor/buffer budgets, and release all owned resources', () => {
  const parent = new THREE.Group()
  const layer = createStreetLife(parent, streetRoutes([{ kind: 'road:residential', line: [[-90, 0], [0, -10], [90, 0]] }], bounds), bounds, () => -3)
  const meshes = actors(parent)
  assert.equal(layer.actorCount, 152); assert.ok(layer.actorCount <= 200)
  assert.equal(meshes.length, AMBIENT_BUDGET.drawCalls)
  assert.equal(new Set(meshes.map(mesh => mesh.geometry)).size, 2)
  assert.equal(new Set(meshes.map(mesh => mesh.material)).size, 2)
  assert.equal(buffers(meshes), 25000, 'geometry + matrices + instance colours; no added texture buffers')
  assert.ok(meshes.every(mesh => !mesh.castShadow && mesh.receiveShadow), 'ambient frames reuse static city shadows')
  const before = meshes.map(mesh => Array.from(mesh.instanceMatrix.array))
  layer.step(0.1)
  for (let i = 0; i < meshes.length; i++) assert.notDeepEqual(Array.from(meshes[i].instanceMatrix.array), before[i])
  for (let frame = 0; frame < 100; frame++) layer.step(frame % 2 ? 1e10 : NaN)
  for (const mesh of meshes) for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix)
    assert.ok(position.toArray().every(Number.isFinite))
    assert.ok(position.x >= -100 && position.x <= 100 && position.z >= -100 && position.z <= 100)
  }
  const held = Array.from(meshes[0].instanceMatrix.array)
  layer.step(NaN); assert.deepEqual(Array.from(meshes[0].instanceMatrix.array), held)
  const geometries = new Set(meshes.map(mesh => mesh.geometry))
  const materials = new Set(meshes.map(mesh => mesh.material as THREE.Material))
  let geometryDisposals = 0; let materialDisposals = 0; let instanceDisposals = 0
  for (const geo of geometries) geo.addEventListener('dispose', () => geometryDisposals++)
  for (const material of materials) material.addEventListener('dispose', () => materialDisposals++)
  for (const mesh of meshes) mesh.addEventListener('dispose', () => instanceDisposals++)
  layer.dispose(); layer.dispose(); layer.step(1)
  assert.equal(parent.children.length, 0)
  assert.equal(geometryDisposals, 2); assert.equal(materialDisposals, 2); assert.equal(instanceDisposals, 4)
})

test('actual measured and invented worlds keep ambient actors independent of scientific geometry and timeline', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const noop = () => {}
  const gradient = { addColorStop: noop }
  const context = new Proxy({}, { get: (_target, key) => String(key).startsWith('create') ? () => gradient : noop, set: () => true })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } })
  const area = JSON.parse(readFileSync(new URL('../public/data/nisar/tehran-sw-2026/focus.json', import.meta.url), 'utf8')) as FocusArea
  const stops = [{ value: -350, colour: '#c23d17' }, { value: 0, colour: '#ffffff' }, { value: 350, colour: '#22508f' }]
  try {
    for (const kind of ['measured', 'simulation'] as const) {
      const scene = new THREE.Scene()
      const sun = new THREE.DirectionalLight()
      const camera = new THREE.PerspectiveCamera()
      camera.position.set(560, 360, 600)
      const stage = { scene, sun, camera, exhibition: true, renderer: { capabilities: { getMaxAnisotropy: () => 1 } } } as unknown as Stage
      const world = kind === 'measured' ? createMeasuredWorld(stage, area, stops) : createSimulationWorld(stage)
      try {
        world.setTime(5, true, false)
        const tip = world.tip(0, 5)
        const ground = (scene.children[0] as THREE.Group).children.find(object => (object as THREE.Mesh).geometry instanceof THREE.PlaneGeometry) as THREE.Mesh
        const groundPos = ground.geometry.attributes.position as THREE.BufferAttribute
        const groundVersion = groundPos.version
        const poses: number[][] = []
        scene.traverse(object => { if (object instanceof THREE.Mesh && object.userData.id !== undefined) poses.push(object.parent!.position.toArray()) })
        world.setAmbient!(true)
        const meshes = actors(scene)
        assert.equal(meshes.length, 4)
        const before = Array.from(meshes[0].instanceMatrix.array)
        for (let frame = 0; frame < 15; frame++) world.stepAmbient!(1 / 30)
        assert.notDeepEqual(Array.from(meshes[0].instanceMatrix.array), before)
        assert.equal(groundPos.version, groundVersion, 'ambient does not remesh measured/invented ground')
        assert.deepEqual(world.tip(0, 5), tip)
        const afterPoses: number[][] = []
        scene.traverse(object => { if (object instanceof THREE.Mesh && object.userData.id !== undefined) afterPoses.push(object.parent!.position.toArray()) })
        assert.deepEqual(afterPoses, poses, 'no building movement from street life')
        const held = Array.from(meshes[0].instanceMatrix.array)
        world.setAmbient!(false); world.stepAmbient!(0.1)
        assert.deepEqual(Array.from(meshes[0].instanceMatrix.array), held)
        world.setAmbient!(true)
        assert.equal(actors(scene)[0], meshes[0], 'toggle reuses the same layer/world')
        world.setTime(10, true, false)
        assert.ok(groundPos.version > groundVersion, 'explicit scientific seek still updates ground')
        if (kind === 'simulation') {
          const oldTraffic: THREE.InstancedMesh[] = []
          scene.traverse(object => { if (object instanceof THREE.InstancedMesh && object.count === 90) oldTraffic.push(object) })
          assert.equal(oldTraffic.length, 0, 'original traffic allocation is retired, never doubled or retained invisibly')
        } else {
          const canopies = scene.getObjectByName('illustrative-canopies-in-mapped-parks')!
          assert.ok(canopies)
          const trees = canopies.children as THREE.InstancedMesh[]
          assert.ok(trees[0].count <= 96)
          const inPark = (x: number, z: number) => (area.context ?? []).filter(item => item.kind === 'green').some(park => {
            let inside = false
            for (let i = 0, j = park.line.length - 1; i < park.line.length; j = i++) {
              const [xi, ni] = park.line[i]; const [xj, nj] = park.line[j]
              if ((-ni > z) !== (-nj > z) && x < (xj - xi) * (z + ni) / (ni - nj) + xi) inside = !inside
            }
            return inside
          })
          for (let i = 0; i < trees[0].count; i++) {
            trees[0].getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix)
            assert.ok(inPark(position.x, position.z), 'every illustrative canopy position lies inside a mapped green polygon')
          }
          t.diagnostic(`measured canopy budget: ${trees[0].count} trees, 2 meshes, ${buffers(trees)} geometry/instance bytes`)
          const measuredBounds = { minX: area.grid.east[0] - 40, maxX: area.grid.east.at(-1)! + 40, minZ: -area.grid.north[0] - 40, maxZ: -area.grid.north.at(-1)! + 40 }
          assert.ok(streetRoutes(area.context ?? [], measuredBounds).length > 0, 'actual supplied OSM polylines provide the paths')
        }
      } finally { world.dispose(); assert.equal(scene.children.length, 0) }
    }
  } finally { if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document') }
})
