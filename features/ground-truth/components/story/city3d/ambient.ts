/** Decorative street life. Routes have geographic provenance; actors/speeds do not. */
import * as THREE from 'three'
import { disposeTree, makeRng } from './shared'

export const AMBIENT_BUDGET = { cars: 72, pedestrians: 80, actors: 152, drawCalls: 4, fps: 30 } as const
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number }
export type Street = { kind: string; line: [number, number][] }
type Segment = { x: number; z: number; dx: number; dz: number; length: number; end: number }
export type AmbientRoute = { kind: string; segments: Segment[]; length: number; pedestrians: boolean; cars: boolean; width: number }
const WIDTH: Record<string, number> = { motorway: 22, trunk: 20, primary: 16, secondary: 13, tertiary: 11, unclassified: 8, residential: 8, living_street: 7, service: 5, pedestrian: 6, footway: 3, path: 3, cycleway: 3 }

/** Liang–Barsky clipping: no connecting invented road through an excluded region. */
function clip(x: number, z: number, dx: number, dz: number, b: Bounds) {
  let lo = 0; let hi = 1
  for (const [p, q] of [[-dx, x - b.minX], [dx, b.maxX - x], [-dz, z - b.minZ], [dz, b.maxZ - z]]) {
    if (p === 0) { if (q < 0) return null; continue }
    const r = q / p
    if (p < 0) lo = Math.max(lo, r)
    else hi = Math.min(hi, r)
    if (lo > hi) return null
  }
  return { x: x + dx * lo, z: z + dz * lo, dx: dx * (hi - lo), dz: dz * (hi - lo) }
}

/** Input coordinates are OSM east/north metres. Each clipped connected run is a route. */
export function streetRoutes(streets: Street[], bounds: Bounds): AmbientRoute[] {
  const routes: AmbientRoute[] = []
  for (const street of streets) {
    if (!street.kind.startsWith('road:')) continue
    const kind = street.kind.slice(5)
    const base = kind.replace(/_link$/, '')
    const pedestrians = !['motorway', 'trunk', 'primary', 'construction', 'proposed'].includes(base)
    const cars = !['pedestrian', 'footway', 'path', 'steps', 'cycleway', 'construction', 'proposed'].includes(base)
    if (!cars && !pedestrians) continue
    let route: AmbientRoute | null = null
    for (let i = 1; i < street.line.length; i++) {
      const [x, north] = street.line[i - 1]; const [nextX, nextNorth] = street.line[i]
      if (![x, north, nextX, nextNorth].every(Number.isFinite)) { route = null; continue }
      const part = clip(x, -north, nextX - x, north - nextNorth, bounds)
      if (!part) { route = null; continue }
      const length = Math.hypot(part.dx, part.dz)
      if (length < 0.01) continue
      const previous = route?.segments.at(-1)
      if (!previous || Math.hypot(previous.x + previous.dx - part.x, previous.z + previous.dz - part.z) > 0.01) {
        route = { kind, segments: [], length: 0, pedestrians, cars, width: WIDTH[base] ?? 7 }
        routes.push(route)
      }
      route!.length += length
      route!.segments.push({ ...part, length, end: route!.length })
    }
  }
  return routes.filter(route => route.length >= 12)
}

type Pose = { x: number; z: number; yaw: number }
/** Ping-pong along a finite polyline. Turns never invent a return road. */
export function routePose(route: AmbientRoute, distance: number, offset: number, bounds: Bounds, out: Pose): Pose {
  const finite = Number.isFinite(distance) ? distance : 0
  const phase = ((finite % (route.length * 2)) + route.length * 2) % (route.length * 2)
  const reverse = phase > route.length
  const along = reverse ? route.length * 2 - phase : phase
  const segment = route.segments.find(segment => along <= segment.end) ?? route.segments[route.segments.length - 1]
  const u = Math.max(0, Math.min(1, (along - (segment.end - segment.length)) / segment.length))
  const lateral = Number.isFinite(offset) ? offset : 0
  out.x = Math.max(bounds.minX, Math.min(bounds.maxX, segment.x + segment.dx * u - segment.dz / segment.length * lateral))
  out.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, segment.z + segment.dz * u + segment.dx / segment.length * lateral))
  out.yaw = Math.atan2(-segment.dz, segment.dx) + (reverse ? Math.PI : 0)
  return out
}

export function createStreetLife(parent: THREE.Group, routes: AmbientRoute[], bounds: Bounds, ground: (x: number, z: number) => number) {
  const root = new THREE.Group()
  root.name = 'illustrative-street-life'
  parent.add(root)
  const rnd = makeRng(31)
  const box = new THREE.BoxGeometry(1, 1, 1)
  const head = new THREE.IcosahedronGeometry(1, 0)
  const painted = new THREE.MeshStandardMaterial({ roughness: 0.75, flatShading: true })
  const dark = new THREE.MeshStandardMaterial({ color: '#26363b', roughness: 0.4 })
  const carRoutes = routes.filter(route => route.cars)
  const walkRoutes = routes.filter(route => route.pedestrians)
  const makeActors = (pool: AmbientRoute[], count: number, walking: boolean) => Array.from({ length: pool.length ? count : 0 }, (_, i) => {
    const route = pool[i % pool.length]
    return { route, distance: rnd() * route.length * 2, speed: walking ? 0.9 + rnd() * 0.7 : 7 + rnd() * 6,
      offset: (i % 2 ? 1 : -1) * (walking ? route.width / 2 + 0.6 : Math.min(2.5, route.width / 4)) }
  })
  const cars = makeActors(carRoutes, AMBIENT_BUDGET.cars, false)
  const people = makeActors(walkRoutes, AMBIENT_BUDGET.pedestrians, true)
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, count: number, name: string) => {
    const result = new THREE.InstancedMesh(geometry, material, count)
    result.name = name
    result.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    // Tiny decorative actors receive the cached city shadows, but do not force
    // the expensive building/ground shadow pass to run on ambient frames.
    result.receiveShadow = true
    // Bounds move with actors; this tiny fixed budget avoids per-frame sphere work.
    result.frustumCulled = false
    root.add(result)
    return result
  }
  const bodies = mesh(box, painted, cars.length, 'street-car-bodies')
  const cabins = mesh(box, dark, cars.length, 'street-car-cabins')
  const walkers = mesh(box, painted, people.length, 'street-pedestrians')
  const heads = mesh(head, painted, people.length, 'street-pedestrian-heads')
  const colour = new THREE.Color()
  const palette = ['#ece5cc', '#343f43', '#787c82', '#5f888d', '#a6a396', '#bec8c1']
  for (const m of [bodies, walkers, heads]) for (let i = 0; i < m.count; i++) m.setColorAt(i, colour.set(m === heads ? '#c6a383' : palette[i % palette.length]))
  const transform = new THREE.Object3D()
  const pose: Pose = { x: 0, z: 0, yaw: 0 }
  let disposed = false
  const write = (m: THREE.InstancedMesh, i: number, y: number, sx: number, sy: number, sz: number) => {
    transform.position.set(pose.x, y, pose.z)
    transform.rotation.set(0, pose.yaw, 0)
    transform.scale.set(sx, sy, sz)
    transform.updateMatrix()
    m.setMatrixAt(i, transform.matrix)
  }
  function step(delta: number) {
    if (disposed) return
    const dt = Number.isFinite(delta) ? Math.max(0, Math.min(0.1, delta)) : 0
    for (const [actors, walking] of [[cars, false], [people, true]] as const) actors.forEach((actor, i) => {
      actor.distance = (actor.distance + dt * actor.speed) % (actor.route.length * 2)
      routePose(actor.route, actor.distance, actor.offset, bounds, pose)
      const sampled = ground(pose.x, pose.z)
      const y = Number.isFinite(sampled) ? sampled : 0
      if (walking) {
        // Deliberately readable silhouettes, not measured person dimensions.
        write(walkers, i, y + 1.2, 0.85, 1.9, 0.7)
        write(heads, i, y + 2.45, 0.42, 0.46, 0.42)
      } else {
        write(bodies, i, y + 0.8, 5.4, 1.3, 2.2)
        write(cabins, i, y + 1.65, 2.7, 0.75, 1.9)
      }
    })
    for (const m of [bodies, cabins, walkers, heads]) m.instanceMatrix.needsUpdate = true
  }
  step(0)
  return { root, actorCount: cars.length + people.length, step,
    dispose() { if (disposed) return; disposed = true; parent.remove(root); disposeTree(root); for (const m of [bodies, cabins, walkers, heads]) m.dispose() },
  }
}
