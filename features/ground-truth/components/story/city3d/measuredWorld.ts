/**
 * MEASURED world: one 1.2 km neighbourhood of south-west Tehran built from the
 * NISAR result bundle's focus area — real OpenStreetMap footprints standing on
 * ground shaped by the measured 80 m vertical rate.
 *
 * Honesty rules for this world:
 *  - Every building tilts by its own MEASURED ground tilt and direction; future
 *    years are a straight-line projection of the measured rate and say so.
 *  - Nothing collapses and no debris or dust exists here: no measurement or
 *    standard predicts collapse.
 *  - Unmeasured 80 m cells are hatched. The surface is continued across them only
 *    so it stays whole; buildings there are rated "not measured".
 *  - Streets, parks and water are real OpenStreetMap features. Buildings are
 *    mapped footprints. Street actors are illustrative, on mapped street paths;
 *    canopy positions are illustrative within mapped parks. Neither is measured.
 *    Parapets and rooftop tanks are generic detail.
 */
import * as THREE from 'three'
import { TILT_LIMITS, tiltLevel, type WallColourMode } from './cityIntro'

import type { FocusArea, FocusBuilding } from '@/features/ground-truth/data/nisar'
import {
  CATEGORY_COLOUR,
  EXAG,
  FACADE_TONES,
  RUNGS,
  crackTexture,
  disposeTree,
  facadeTexture,
  makeRng,
} from './shared'
import type { CityWorld, RungState, Stage } from './shared'
import { createStreetLife, streetRoutes } from './ambient'
import { parkCanopies } from './landscape'

/** Drawn street widths in metres by OSM highway class (matches the backend's ROAD_WIDTHS). */
const ROAD_WIDTH: Record<string, number> = {
  motorway: 22,
  trunk: 20,
  primary: 16,
  secondary: 13,
  tertiary: 11,
  unclassified: 8,
  residential: 8,
  living_street: 7,
  service: 5,
  pedestrian: 6,
}

export { MEASURED_EPOCH } from './cityIntro'

interface MeasuredBuilding {
  id: number
  data: FocusBuilding
  cx: number
  cz: number
  group: THREE.Group
  wall: THREE.MeshStandardMaterial
  crack: THREE.MeshStandardMaterial
  /** Tilt per year if it is significant, else 0. */
  tiltRate: number
  dir: THREE.Vector3
  significant: boolean
}

export interface MeasuredWorld extends CityWorld {
  readonly kind: 'measured'
  /** Buildings whose tilt is not significant or not measured. */
  readonly uncertainCount: number
  readonly cellCount: { measured: number; total: number }
  /** Show the raw 80 m measurement cells instead of the street map. */
  setCells(on: boolean): void
  /**
   * 'rate' (default): walls show the measured sinking rate.
   * 'tilt': walls show which engineering limit the measured ground tilt beneath each
   * building has reached by the shown year (1 in 500 / 300 / 150), with a short glow
   * when it crosses one. Ground tilt only: never cracks, damage or collapse.
   */
  setColourMode(mode: WallColourMode): void
}

export type { WallColourMode } from './cityIntro'
export { TILT_LIMITS, tiltLevel } from './cityIntro'

type Stop = { value: number; colour: string }

export function createMeasuredWorld(stage: Stage, area: FocusArea, stops: Stop[]): MeasuredWorld {
  const { scene, sun } = stage
  const rnd = makeRng(7)
  const root = new THREE.Group()
  scene.add(root)
  const prevShadow = { ...sun.shadow.camera }
  // The square is larger than the simulated city: push the haze back so its far edge stays readable.
  const fog = scene.fog as THREE.Fog | null
  const prevFog = fog ? { near: fog.near, far: fog.far } : null
  if (fog && !stage.exhibition) {
    fog.near = 1800
    fog.far = 4200
  }
  Object.assign(sun.shadow.camera, { left: -760, right: 760, top: 760, bottom: -760 })
  sun.shadow.camera.updateProjectionMatrix()

  /* ---------- The measured field (mm/yr), with gaps marked ---------- */
  const east = area.grid.east
  const north = area.grid.north // north to south
  const rows = north.length
  const cols = east.length
  const spacing = area.spacing_m
  const raw = area.grid.vertical_rate
  const measured = raw.map((r) => r.map((v) => v !== null))
  const filled = raw.map((r) => r.map((v) => (v === null ? NaN : v)))
  // Continue the surface across gaps from the nearest measured cells (display only; gaps stay hatched).
  for (let pass = 0; pass < rows + cols; pass++) {
    let changed = false
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        if (!Number.isNaN(filled[i][j])) continue
        let s = 0
        let n = 0
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const v = filled[i + di]?.[j + dj]
          if (v !== undefined && !Number.isNaN(v)) {
            s += v
            n++
          }
        }
        if (n) {
          filled[i][j] = s / n
          changed = true
        }
      }
    if (!changed) break
  }
  const x0 = east[0]
  const zN = -north[0] // three z of the northern row (z = -north)
  /** Bilinear vertical rate in m/yr at a three.js (x, z) point. */
  function rateAt(x: number, z: number) {
    const fj = Math.max(0, Math.min(cols - 1, (x - x0) / spacing))
    const fi = Math.max(0, Math.min(rows - 1, (z - zN) / spacing))
    const j = Math.min(cols - 2, Math.floor(fj))
    const i = Math.min(rows - 2, Math.floor(fi))
    const u = fj - j
    const v = fi - i
    const a = filled[i][j] * (1 - u) + filled[i][j + 1] * u
    const b = filled[i + 1][j] * (1 - u) + filled[i + 1][j + 1] * u
    return (a * (1 - v) + b * v) / 1000
  }
  let tNow = 0
  const groundY = (x: number, z: number, t: number) => rateAt(x, z) * t * EXAG

  /* ---------- Ground: the measured square as a cut-out slab ---------- */
  const W = cols * spacing
  const D = rows * spacing
  const cxw = x0 - spacing / 2 + W / 2
  const czw = zN - spacing / 2 + D / 2
  const SEG = 8
  const groundGeo = new THREE.PlaneGeometry(W, D, cols * SEG, rows * SEG)
  groundGeo.rotateX(-Math.PI / 2)
  groundGeo.translate(cxw, 0, czw)
  const gPos = groundGeo.attributes.position as THREE.BufferAttribute

  const CELL = 32
  function cellTexture(mode: 'plain' | 'rate') {
    const c = document.createElement('canvas')
    c.width = cols * CELL
    c.height = rows * CELL
    const g = c.getContext('2d')!
    const ramp = (mm: number) => {
      const lim = Math.max(...stops.map((s) => Math.abs(s.value)))
      const v = Math.max(-lim, Math.min(lim, mm))
      for (let k = 0; k < stops.length - 1; k++) {
        if (v <= stops[k + 1].value) {
          const f = (v - stops[k].value) / (stops[k + 1].value - stops[k].value)
          return new THREE.Color(stops[k].colour).lerp(new THREE.Color(stops[k + 1].colour), f).getStyle()
        }
      }
      return stops[stops.length - 1].colour
    }
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const x = j * CELL
        const y = i * CELL
        const v = raw[i][j]
        g.fillStyle = mode === 'rate' && v !== null ? ramp(v) : '#b9ad97'
        g.fillRect(x, y, CELL, CELL)
        if (v === null) {
          g.fillStyle = '#8c8577'
          g.fillRect(x, y, CELL, CELL)
          g.strokeStyle = 'rgba(40,36,30,0.55)'
          g.lineWidth = 2
          for (let k = -CELL; k < CELL; k += 8) {
            g.beginPath()
            g.moveTo(x + k, y + CELL)
            g.lineTo(x + k + CELL, y)
            g.stroke()
          }
        }
        g.strokeStyle = 'rgba(60,52,42,0.28)'
        g.lineWidth = 1
        g.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1)
      }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    return t
  }
  const plainTex = cellTexture('plain')
  const rateTex = cellTexture('rate')

  /** The real street map of the square (OpenStreetMap), drawn like the simulation's city. */
  function cityTexture() {
    const px = 2048
    const k = px / Math.max(W, D)
    const c = document.createElement('canvas')
    c.width = Math.round(W * k)
    c.height = Math.round(D * k)
    const g = c.getContext('2d')!
    const u = (e: number) => (e - (cxw - W / 2)) * k
    const v = (n: number) => (-n - (czw - D / 2)) * k
    g.fillStyle = '#b9ad97'
    g.fillRect(0, 0, c.width, c.height)
    for (let i = 0; i < 12000; i++) {
      g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '60,50,40'},${0.03 + rnd() * 0.05})`
      g.fillRect(rnd() * c.width, rnd() * c.height, 2 + rnd() * 5, 2 + rnd() * 5)
    }
    const ctx = area.context ?? []
    const path = (line: [number, number][], close = false) => {
      g.beginPath()
      line.forEach(([e, n], i) => (i ? g.lineTo(u(e), v(n)) : g.moveTo(u(e), v(n))))
      if (close) g.closePath()
    }
    for (const item of ctx) {
      if (item.kind !== 'green' && item.kind !== 'water') continue
      path(item.line, true)
      g.fillStyle = item.kind === 'green' ? '#6d8650' : '#6f93a8'
      g.fill()
      if (item.kind === 'green') {
        g.save()
        g.clip()
        const xs = item.line.map((p) => u(p[0]))
        const ys = item.line.map((p) => v(p[1]))
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
        const n = Math.min(400, Math.round(((x1 - x0) * (y1 - y0)) / 220))
        for (let i = 0; i < n; i++) {
          g.fillStyle = `rgba(40,70,30,${0.35 + rnd() * 0.4})`
          g.beginPath()
          g.arc(x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0), 3 + rnd() * 6, 0, Math.PI * 2)
          g.fill()
        }
        g.restore()
      }
    }
    const roads = ctx
      .filter((i) => i.kind.startsWith('road:'))
      .map((i) => ({ ...i, w: ROAD_WIDTH[i.kind.slice(5)] ?? 7 }))
      .sort((a, b) => a.w - b.w)
    g.lineCap = 'round'
    g.lineJoin = 'round'
    for (const pass of ['casing', 'asphalt', 'marking'] as const)
      for (const rd of roads) {
        if (pass === 'marking' && rd.w < 11) continue
        path(rd.line)
        if (pass === 'casing') {
          g.strokeStyle = '#cbc2b1' // pavement edge
          g.lineWidth = (rd.w + 4) * k
          g.setLineDash([])
        } else if (pass === 'asphalt') {
          g.strokeStyle = '#3d3f42'
          g.lineWidth = rd.w * k
          g.setLineDash([])
        } else {
          g.strokeStyle = 'rgba(235,230,210,0.55)'
          g.lineWidth = 1.5
          g.setLineDash([10, 14])
        }
        g.stroke()
      }
    g.setLineDash([])
    // Unmeasured 80 m cells stay visible, faintly hatched.
    g.strokeStyle = 'rgba(40,36,30,0.35)'
    g.lineWidth = 2
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        if (raw[i][j] !== null) continue
        const x = j * spacing * k
        const y = i * spacing * k
        const sz = spacing * k
        g.save()
        g.beginPath()
        g.rect(x, y, sz, sz)
        g.clip()
        for (let q = -sz; q < sz; q += 10) {
          g.beginPath()
          g.moveTo(x + q, y + sz)
          g.lineTo(x + q + sz, y)
          g.stroke()
        }
        g.restore()
      }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = stage.renderer.capabilities.getMaxAnisotropy()
    return t
  }
  const cityTex = cityTexture()
  const gColors = new Float32Array(gPos.count * 3).fill(1)
  groundGeo.setAttribute('color', new THREE.BufferAttribute(gColors, 3))
  const groundMat = new THREE.MeshStandardMaterial({ map: cityTex, vertexColors: true, roughness: 0.95 })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.receiveShadow = true
  root.add(ground)

  // Skirts: the four cut faces of the slab, down to a fixed base.
  const BASE = -60
  const skirtMat = new THREE.MeshStandardMaterial({ color: '#6e6253', roughness: 1, side: THREE.DoubleSide })
  const edgeN = cols * SEG
  const edgeM = rows * SEG
  const skirts = [
    { n: edgeN, at: (k: number) => [cxw - W / 2 + (k / edgeN) * W, czw - D / 2] },
    { n: edgeN, at: (k: number) => [cxw - W / 2 + (k / edgeN) * W, czw + D / 2] },
    { n: edgeM, at: (k: number) => [cxw - W / 2, czw - D / 2 + (k / edgeM) * D] },
    { n: edgeM, at: (k: number) => [cxw + W / 2, czw - D / 2 + (k / edgeM) * D] },
  ].map((s) => {
    const pos = new Float32Array((s.n + 1) * 2 * 3)
    const idx: number[] = []
    for (let k = 0; k < s.n; k++) {
      const a = k * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setIndex(idx)
    const mesh = new THREE.Mesh(geo, skirtMat)
    root.add(mesh)
    return { ...s, geo, pos }
  })
  const plinthBase = new THREE.Mesh(new THREE.PlaneGeometry(W, D), skirtMat)
  plinthBase.rotation.x = Math.PI / 2
  plinthBase.position.set(cxw, BASE, czw)
  root.add(plinthBase)
  const floorPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000),
    new THREE.MeshStandardMaterial({ color: '#cbbfa8', roughness: 1 }),
  )
  floorPlane.rotation.x = -Math.PI / 2
  floorPlane.position.y = BASE - 0.5
  floorPlane.receiveShadow = true
  root.add(floorPlane)
  floorPlane.visible = !stage.exhibition
  const bounds = { minX: cxw - W / 2, maxX: cxw + W / 2, minZ: czw - D / 2, maxZ: czw + D / 2 }
  let ambient: ReturnType<typeof createStreetLife> | null = null
  const canopies = stage.exhibition ? parkCanopies(root, area.context ?? [], bounds, (x, z) => groundY(x, z, tNow)) : null

  /* ---------- Buildings from real footprints ---------- */
  const facades = FACADE_TONES.map((tone) => facadeTexture(tone, rnd))
  const cracks = crackTexture(rnd)
  const roofMat = new THREE.MeshStandardMaterial({ color: '#b7ad9c', roughness: 0.9 })
  const parapetMat = new THREE.MeshStandardMaterial({ color: '#9d9384', roughness: 0.9 })
  const plantGeo = new THREE.BoxGeometry(3, 2.4, 2.4)
  const plantMat = new THREE.MeshStandardMaterial({ color: '#8f969a', roughness: 0.6, metalness: 0.3 })
  const tankGeo = new THREE.CylinderGeometry(1.1, 1.1, 2.6, 14)
  const tankMat = new THREE.MeshStandardMaterial({ color: '#d9dcd8', roughness: 0.4, metalness: 0.5 })
  const buildings: MeasuredBuilding[] = []
  const wallMeshes: THREE.Mesh[] = []
  area.buildings.forEach((data) => {
    const ring = data.ring.slice(0, -1)
    if (ring.length < 3) return
    const cxE = ring.reduce((a, p) => a + p[0], 0) / ring.length
    const cyN = ring.reduce((a, p) => a + p[1], 0) / ring.length
    const shape = new THREE.Shape(ring.map(([e, n]) => new THREE.Vector2(e - cxE, n - cyN)))
    const geo = new THREE.ExtrudeGeometry(shape, { depth: data.height_m, bevelEnabled: false })
    geo.rotateX(-Math.PI / 2) // extrusion becomes +y; shape y (north) becomes -z
    const tex = facades[Math.floor(rnd() * facades.length)].clone()
    tex.needsUpdate = true
    tex.repeat.set(1 / 16, 1 / 12.8)
    const wall = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0.02 })
    const crackTex = cracks.clone()
    crackTex.needsUpdate = true
    crackTex.repeat.set(1 / 24, 1 / 24)
    const crack = new THREE.MeshStandardMaterial({
      map: crackTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
    const body = new THREE.Mesh(geo, [roofMat, wall])
    body.castShadow = true
    body.receiveShadow = true
    const skin = new THREE.Mesh(geo, [new THREE.MeshBasicMaterial({ visible: false }), crack])
    skin.scale.setScalar(1.003)
    const group = new THREE.Group()
    group.add(body, skin)
    // Parapet and rooftop plant, as on the simulated buildings (generic detail, not mapped data).
    const lip = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: false })
    lip.rotateX(-Math.PI / 2)
    const parapet = new THREE.Mesh(lip, parapetMat)
    parapet.position.y = data.height_m
    parapet.scale.set(1.01, 1, 1.01)
    parapet.castShadow = true
    group.add(parapet)
    const xs = ring.map((p) => p[0] - cxE)
    const ys = ring.map((p) => p[1] - cyN)
    const reach = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 4
    if (reach > 2.5)
      for (let k = 0, n = 1 + Math.floor(rnd() * 2); k < n; k++) {
        const tank = rnd() > 0.5
        const m = new THREE.Mesh(tank ? tankGeo : plantGeo, tank ? tankMat : plantMat)
        m.position.set((rnd() - 0.5) * reach, data.height_m + 1.3, (rnd() - 0.5) * reach)
        m.castShadow = true
        group.add(m)
      }
    const cz = -cyN
    group.position.set(cxE, 0, cz)
    root.add(group)
    const significant = data.category === 'high' || data.category === 'elevated' || data.category === 'low'
    const bearing = THREE.MathUtils.degToRad(data.tilt_toward_deg ?? 0)
    const b: MeasuredBuilding = {
      id: buildings.length,
      data,
      cx: cxE,
      cz,
      group,
      wall,
      crack,
      tiltRate: significant ? (data.ground_tilt_per_year ?? 0) : 0,
      // Downhill direction in three.js axes: east = +x, north = -z.
      dir: new THREE.Vector3(Math.sin(bearing), 0, -Math.cos(bearing)),
      significant,
    }
    body.userData.id = b.id
    buildings.push(b)
    wallMeshes.push(body)
  })
  // Frame the camera on where the mapped buildings actually are.
  const focusTarget = buildings.length
    ? new THREE.Vector3(
        buildings.reduce((a, b) => a + b.cx, 0) / buildings.length,
        -20,
        buildings.reduce((a, b) => a + b.cz, 0) / buildings.length,
      )
    : new THREE.Vector3(0, -20, 0)
  const rated = buildings.filter((b) => b.significant)
  const maxRate = Math.max(1e-12, ...rated.map((b) => b.tiltRate))
  const countAt = (r: number, t: number) => rated.reduce((a, b) => a + (b.tiltRate * t >= 1 / r ? 1 : 0), 0)
  const firstYear = (r: number) => 1 / r / maxRate

  /* ---------- Update ---------- */
  const COL = {
    ok: new THREE.Color(CATEGORY_COLOUR.ok),
    warn: new THREE.Color(CATEGORY_COLOUR.warn),
    crit: new THREE.Color(CATEGORY_COLOUR.crit),
    grey: new THREE.Color('#9aa1ab'),
    white: new THREE.Color('#ffffff'),
    black: new THREE.Color('#000000'),
  }
  const SINK_DEEP = new THREE.Color('#3f6fb0')
  const tint = new THREE.Color()
  let risk = false
  let colourMode: WallColourMode = 'rate'
  const LIMIT_COL = TILT_LIMITS.map((l) => new THREE.Color(l.colour))
  const BELOW_LIMITS = new THREE.Color('#f4f1ea')
  const tmpQ = new THREE.Quaternion()
  const axis = new THREE.Vector3()
  const UP = new THREE.Vector3(0, 1, 0)

  function update(t: number) {
    tNow = t
    for (let i = 0; i < gPos.count; i++) {
      const x = gPos.getX(i)
      const z = gPos.getZ(i)
      const s = rateAt(x, z) * t // metres, relative to the area median
      gPos.setY(i, s * EXAG)
      if (risk) tint.copy(COL.white).lerp(SINK_DEEP, Math.max(0, Math.min(1, -s / 4)))
      else tint.copy(COL.white)
      gColors[i * 3] = tint.r
      gColors[i * 3 + 1] = tint.g
      gColors[i * 3 + 2] = tint.b
    }
    gPos.needsUpdate = true
    groundGeo.attributes.color.needsUpdate = true
    groundGeo.computeVertexNormals()
    for (const s of skirts) {
      for (let k = 0; k <= s.n; k++) {
        const [x, z] = s.at(k)
        const top = k * 6
        s.pos[top] = s.pos[top + 3] = x
        s.pos[top + 2] = s.pos[top + 5] = z
        s.pos[top + 1] = groundY(x, z, t)
        s.pos[top + 4] = BASE
      }
      s.geo.attributes.position.needsUpdate = true
      s.geo.computeVertexNormals()
      s.geo.computeBoundingSphere()
    }
    for (const b of buildings) {
      b.group.position.y = groundY(b.cx, b.cz, t) - 0.3
      const beta = b.tiltRate * t
      axis.crossVectors(UP, b.dir).normalize() // rotating UP about UP×dir leans the top toward dir
      b.group.quaternion.copy(tmpQ.setFromAxisAngle(axis, Math.atan(beta * EXAG)))
      // Ground observations do not diagnose cracks in a real structure.
      b.crack.opacity = 0
      if (risk && colourMode === 'tilt') {
        // Colour by the ground-tilt limit reached at this projected year; glow briefly on crossing.
        const { level, since } = b.significant ? tiltLevel(b.tiltRate, t) : { level: -1, since: Infinity }
        b.wall.color.copy(!b.significant ? COL.grey : level < 0 ? BELOW_LIMITS : LIMIT_COL[level])
        const glow = level < 0 ? 0 : Math.max(0, 1 - since / 1.2)
        b.wall.emissive.copy(level < 0 ? COL.black : LIMIT_COL[level]).multiplyScalar(glow * 0.55)
        continue
      }
      b.wall.emissive.copy(COL.black)
      const rate = b.data.vertical_mm_per_year
      const mix = Math.min(1, Math.abs(rate ?? 0) / 350)
      b.wall.color.copy(!risk ? COL.white : rate === undefined ? COL.grey : new THREE.Color('#f4f1ea').lerp(new THREE.Color(rate < 0 ? '#c23d17' : '#22508f'), mix))
    }
    ambient?.step(0)
    canopies?.refresh()
  }

  const world: MeasuredWorld = {
    kind: 'measured',
    buildingCount: buildings.length,
    uncertainCount: buildings.length - rated.length,
    cellCount: { measured: measured.flat().filter(Boolean).length, total: rows * cols },
    now: 0,
    view: {
      position: focusTarget.clone().add(stage.exhibition ? new THREE.Vector3(320, 430, 650) : new THREE.Vector3(150, 300, 430)),
      target: focusTarget,
      from: new THREE.Vector3(-300, 1400, 1500),
    },
    setTime: (t) => update(t),
    setRisk(on) {
      risk = on
      update(tNow)
    },
    setColourMode(mode) {
      colourMode = mode
      update(tNow)
    },
    setCells(on) {
      groundMat.map = on ? rateTex : cityTex
      groundMat.vertexColors = !on
      groundMat.needsUpdate = true
    },
    step() {},
    setAmbient(on) {
      if (on && !ambient) ambient = createStreetLife(root, streetRoutes(area.context ?? [], bounds), bounds, (x, z) => groundY(x, z, tNow))
      if (ambient) ambient.root.visible = on
    },
    stepAmbient(dt) { if (ambient?.root.visible) ambient.step(dt) },
    pick(ray) {
      const hit = ray.intersectObjects(wallMeshes, false)[0]
      return hit ? (hit.object.userData.id as number) : null
    },
    tip(id, t) {
      const b = buildings[id]
      const d = b.data
      const beta = b.tiltRate * t
      return {
        title: `Mapped building ${id + 1}`,
        pill: { label: 'Ground motion · not a building assessment', colour: '#c6d4bd' },
        rows: [
          { term: 'Ground-motion rate', value: d.vertical_mm_per_year === undefined ? 'Not measured' : `${Math.abs(Math.round(d.vertical_mm_per_year))} mm/year ${d.vertical_mm_per_year < 0 ? 'down' : 'up'}` },
          { term: 'Ground tilt per year', value: d.ground_tilt_per_year ? `${d.ground_tilt_per_year.toPrecision(3)} radians/year` : 'Not resolved' },
          { term: 'Tilt uncertainty', value: d.ground_tilt_sigma_per_year ? `${d.ground_tilt_sigma_per_year.toPrecision(3)} radians/year` : 'Not provided' },
          { term: 'Conditional tilt', value: t > 0 && b.significant ? `${beta.toPrecision(3)} radians after ${t.toFixed(1)} years` : 'No future extrapolation selected' },
          { term: 'Building height', value: `${d.height_m} m${d.height_source === 'default' ? ' (estimated)' : ''}` },
        ],
        note: 'Ground measurements use 80 m radar pixels. The future shape assumes the same rate continues. No damage or structural safety is inferred for this building.',
      }
    },
    rungs(t, selected) {
      const sel = selected === null ? null : buildings[selected]
      return RUNGS.map((g): RungState => ({
        r: g.r,
        color: g.color,
        what: g.what,
        why: g.why,
        count: countAt(g.r, t),
        first: firstYear(g.r),
        mine:
          !!sel &&
          sel.significant &&
          sel.tiltRate * t >= 1 / g.r &&
          RUNGS.every((h) => h.r >= g.r || sel.tiltRate * t < 1 / h.r),
      }))
    },
    countAt,
    dispose() {
      ambient?.dispose()
      canopies?.dispose()
      scene.remove(root)
      disposeTree(root)
      facades.forEach((f) => f.dispose())
      cracks.dispose()
      plainTex.dispose()
      rateTex.dispose()
      cityTex.dispose()
      Object.assign(sun.shadow.camera, {
        left: prevShadow.left,
        right: prevShadow.right,
        top: prevShadow.top,
        bottom: prevShadow.bottom,
      })
      sun.shadow.camera.updateProjectionMatrix()
      if (fog && prevFog) {
        fog.near = prevFog.near
        fog.far = prevFog.far
      }
    },
  }
  update(0)
  return world
}
