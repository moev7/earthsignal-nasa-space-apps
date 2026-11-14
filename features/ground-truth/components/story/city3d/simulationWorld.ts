/**
 * ILLUSTRATIVE simulation: an invented city on invented ground that sinks
 * unevenly. Ported from the standalone "sinking city" artifact. Nothing here is
 * measured; the UI labels this world "Simulation" at all times. The collapse
 * sequence is an illustration only — no engineering standard predicts collapse.
 */
import * as THREE from 'three'

import {
  EXAG,
  FACADE_TONES,
  LIMIT_CRIT,
  LIMIT_SAFE,
  RUNGS,
  T_MAX,
  CATEGORY_COLOUR,
  CATEGORY_LABEL,
  category,
  crackTexture,
  disposeTree,
  facadeTexture,
  makeRng,
  smooth,
} from './shared'
import type { CityWorld, RungState, Stage } from './shared'
import { createStreetLife, streetRoutes, type Street } from './ambient'

export const SIM_NOW = 10
/** Illustration only: no engineering standard sets a collapse limit. */
export const LIMIT_FALL = 1 / 50

const FAULT = { cos: Math.cos(0.5), sin: Math.sin(0.5), offset: 30, width: 22 }
/** Sinking rate in m/yr (negative = down): a broad bowl plus a sharp step where one side drops faster. */
function rate(x: number, z: number) {
  const bowl = -0.12 * Math.exp(-((x - 60) ** 2 + (z + 40) ** 2) / (2 * 170 * 170))
  const d = x * FAULT.cos + z * FAULT.sin - FAULT.offset
  const step = -0.1 * (0.5 + 0.5 * Math.tanh(d / FAULT.width))
  const fade = Math.exp(-(x * x + z * z) / (2 * 360 * 360))
  return bowl + step * fade
}
const settle = (x: number, z: number, t: number) => rate(x, z) * t

const SIZE = 900
const BLOCK = 80
const STREET = 14
const BLOCKS = 8
const CITY = BLOCK * BLOCKS
const HALF = SIZE / 2
const G = 9.81
const FLOOR_H = 3.2

interface Chunk {
  i: number
  b: SimBuilding
  p: THREE.Vector3
  q: THREE.Quaternion
  v: THREE.Vector3
  w: THREE.Vector3
  s: THREE.Vector3
  settled: boolean
  restOff: number
  still: number
  tone: THREE.Color
  trail: number
}

interface SimBuilding {
  id: number
  cx: number
  cz: number
  w: number
  d: number
  h: number
  floors: number
  fi: number
  group: THREE.Group
  wall: THREE.MeshStandardMaterial
  crack: THREE.MeshStandardMaterial
  beta: number
  betaRate: number
  drop: number
  wasCrit: boolean
  collapsed: boolean
  chunks: Chunk[]
  fall: null | {
    theta: number
    omega: number
    axis: THREE.Vector3
    wd: number
    p0: THREE.Vector3
    q0: THREE.Quaternion
    pivot: THREE.Vector3
    breakAt: number
    shed: number
  }
}

export interface SimulationWorld extends CityWorld {
  readonly kind: 'simulation'
  /** Camera shake amplitude from heavy impacts (decays in the viewer). */
  shake: number
  /** Year the fastest-tilting building passes 1 in 50, and a camera framing for it. */
  fallShot(): { year: number; position: THREE.Vector3; target: THREE.Vector3 }
  /** True while a building is still tipping, pieces are falling or dust is in the air. */
  isSettling(): boolean
  /** Rewind support: drop all debris and the "just crossed" memory. */
  clearDebris(): void
  resetCrossings(atTime?: number): void
  summaryAt(t: number): { deepest: number; over1: number; cracked: number; lean: number; damaged: number; falling: number }
}

export function createSimulationWorld(stage: Stage): SimulationWorld {
  const { scene, renderer, camera } = stage
  const rnd = makeRng(11)
  const root = new THREE.Group()
  scene.add(root)

  const tmpM = new THREE.Matrix4()
  const tmpQ = new THREE.Quaternion()
  const tmpS = new THREE.Vector3()
  const tmpV = new THREE.Vector3()
  const tmpV2 = new THREE.Vector3()
  const tmpCol = new THREE.Color()
  const UP = new THREE.Vector3(0, 1, 0)
  const zero = new THREE.Vector3()
  const parks = new Set(['2,5', '5,1', '6,6'])
  const o = -CITY / 2

  let tNow = 6

  /* ---------- Ground ---------- */
  function groundTexture() {
    const px = 2048
    const k = px / SIZE
    const c = document.createElement('canvas')
    c.width = c.height = px
    const g = c.getContext('2d')!
    g.fillStyle = '#a99c86'
    g.fillRect(0, 0, px, px)
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '60,50,40'},${0.03 + rnd() * 0.04})`
      g.fillRect(rnd() * px, rnd() * px, 2 + rnd() * 5, 2 + rnd() * 5)
    }
    const off = (SIZE - CITY) / 2
    g.fillStyle = '#3d3f42'
    for (let i = 0; i <= BLOCKS; i++) {
      const p = (off + i * BLOCK - STREET / 2) * k
      g.fillRect(p, off * k - STREET * k, STREET * k, (CITY + 2 * STREET) * k)
      g.fillRect(off * k - STREET * k, p, (CITY + 2 * STREET) * k, STREET * k)
    }
    g.strokeStyle = 'rgba(235,230,210,0.55)'
    g.lineWidth = 1.5
    g.setLineDash([10, 14])
    for (let i = 0; i <= BLOCKS; i++) {
      const p = (off + i * BLOCK) * k
      g.beginPath()
      g.moveTo(p, off * k - STREET * k)
      g.lineTo(p, (off + CITY + STREET) * k)
      g.stroke()
      g.beginPath()
      g.moveTo(off * k - STREET * k, p)
      g.lineTo((off + CITY + STREET) * k, p)
      g.stroke()
    }
    g.setLineDash([])
    for (let bx = 0; bx < BLOCKS; bx++)
      for (let bz = 0; bz < BLOCKS; bz++) {
        const x = (off + bx * BLOCK + STREET / 2) * k
        const y = (off + bz * BLOCK + STREET / 2) * k
        const w = (BLOCK - STREET) * k
        g.fillStyle = '#cbc2b1'
        g.fillRect(x, y, w, w)
        if (parks.has(bx + ',' + bz)) {
          g.fillStyle = '#6d8650'
          g.fillRect(x + 6, y + 6, w - 12, w - 12)
          for (let i = 0; i < 40; i++) {
            g.fillStyle = `rgba(40,70,30,${0.4 + rnd() * 0.4})`
            g.beginPath()
            g.arc(x + 12 + rnd() * (w - 24), y + 12 + rnd() * (w - 24), 5 + rnd() * 8, 0, Math.PI * 2)
            g.fill()
          }
        }
      }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = renderer.capabilities.getMaxAnisotropy()
    return t
  }

  const groundGeo = new THREE.PlaneGeometry(SIZE, SIZE, 180, 180)
  groundGeo.rotateX(-Math.PI / 2)
  const gPos = groundGeo.attributes.position as THREE.BufferAttribute
  const gColors = new Float32Array(gPos.count * 3).fill(1)
  groundGeo.setAttribute('color', new THREE.BufferAttribute(gColors, 3))
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({ map: groundTexture(), vertexColors: true, roughness: 0.95 }),
  )
  ground.receiveShadow = true
  root.add(ground)
  const outerMat = new THREE.MeshStandardMaterial({ color: '#a39882', roughness: 1 })
  const FAR = 6000
  ;[
    [0, HALF + FAR / 2, FAR * 2, FAR],
    [0, -HALF - FAR / 2, FAR * 2, FAR],
    [HALF + FAR / 2, 0, FAR, SIZE],
    [-HALF - FAR / 2, 0, FAR, SIZE],
  ].forEach(([x, z, w, d]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), outerMat)
    m.rotation.x = -Math.PI / 2
    m.position.set(x, 0, z)
    m.receiveShadow = true
    m.visible = !stage.exhibition
    root.add(m)
  })
  const edgeTaper = (x: number, z: number) => 1 - smooth(360, HALF, Math.max(Math.abs(x), Math.abs(z)))
  const groundY = (x: number, z: number, t: number) => settle(x, z, t) * edgeTaper(x, z) * EXAG

  /* ---------- Buildings ---------- */
  const facades = FACADE_TONES.map((tone) => facadeTexture(tone, rnd))
  const cracks = crackTexture(rnd)
  const roofMat = new THREE.MeshStandardMaterial({ color: '#b7ad9c', roughness: 0.9 })
  const hiddenMat = new THREE.MeshBasicMaterial({ visible: false })
  const parapetMat = new THREE.MeshStandardMaterial({ color: '#9d9384', roughness: 0.9 })
  const plantGeo = new THREE.BoxGeometry(4, 2.8, 3)
  const plantMat = new THREE.MeshStandardMaterial({ color: '#8f969a', roughness: 0.6, metalness: 0.3 })
  const tankGeo = new THREE.CylinderGeometry(1.4, 1.4, 3.2, 14)
  const tankMat = new THREE.MeshStandardMaterial({ color: '#d9dcd8', roughness: 0.4, metalness: 0.5 })

  const buildings: SimBuilding[] = []
  const wallMeshes: THREE.Mesh[] = []
  for (let bx = 0; bx < BLOCKS; bx++)
    for (let bz = 0; bz < BLOCKS; bz++) {
      if (parks.has(bx + ',' + bz)) continue
      for (let lx = 0; lx < 2; lx++)
        for (let lz = 0; lz < 2; lz++) {
          if (rnd() < 0.08) continue
          const lot = (BLOCK - STREET) / 2
          const w = 16 + rnd() * 10
          const d = 16 + rnd() * 10
          const cx = o + bx * BLOCK + STREET / 2 + lx * lot + lot / 2
          const cz = o + bz * BLOCK + STREET / 2 + lz * lot + lot / 2
          const floors = 3 + Math.floor(rnd() ** 1.6 * 12)
          const h = floors * FLOOR_H
          const fi = Math.floor(rnd() * facades.length)
          const tex = facades[fi].clone()
          tex.needsUpdate = true
          tex.repeat.set(Math.max(1, Math.round((w + d) / 2 / 16)), floors / 4)
          const wall = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0.02 })
          const crack = new THREE.MeshStandardMaterial({
            map: cracks,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
          })
          const geo = new THREE.BoxGeometry(w, h, d)
          const body = new THREE.Mesh(geo, [wall, wall, roofMat, roofMat, wall, wall])
          body.position.y = h / 2
          body.castShadow = true
          body.receiveShadow = true
          const skin = new THREE.Mesh(geo, [crack, crack, hiddenMat, hiddenMat, crack, crack])
          skin.position.y = h / 2
          skin.scale.setScalar(1.003)
          const group = new THREE.Group()
          group.position.set(cx, 0, cz)
          group.add(body, skin)
          const parapet = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 1, d + 0.6), parapetMat)
          parapet.position.y = h + 0.5
          parapet.castShadow = true
          group.add(parapet)
          for (let k = 0, n = 1 + Math.floor(rnd() * 3); k < n; k++) {
            const tank = rnd() > 0.5
            const m = new THREE.Mesh(tank ? tankGeo : plantGeo, tank ? tankMat : plantMat)
            const sc = 0.7 + rnd() * 0.8
            m.scale.setScalar(sc)
            m.position.set((rnd() - 0.5) * (w - 6), h + (tank ? 1.6 : 1.4) * sc, (rnd() - 0.5) * (d - 6))
            m.castShadow = true
            group.add(m)
          }
          root.add(group)
          const b: SimBuilding = {
            id: buildings.length,
            cx,
            cz,
            w,
            d,
            h,
            floors,
            fi,
            group,
            wall,
            crack,
            beta: 0,
            betaRate: 0,
            drop: 0,
            wasCrit: false,
            collapsed: false,
            chunks: [],
            fall: null,
          }
          body.userData.id = b.id
          buildings.push(b)
          wallMeshes.push(body)
        }
    }

  /* ---------- Scenery: trees, traffic, ground fissures ---------- */
  const trees: { x: number; z: number; s: number }[] = []
  for (const key of parks) {
    const [bx, bz] = key.split(',').map(Number)
    const x0 = o + bx * BLOCK + STREET / 2 + 5
    const z0 = o + bz * BLOCK + STREET / 2 + 5
    const span = BLOCK - STREET - 10
    for (let i = 0; i < 26; i++) trees.push({ x: x0 + rnd() * span, z: z0 + rnd() * span, s: 0.7 + rnd() * 0.7 })
  }
  const trunkMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.35, 0.5, 4, 6),
    new THREE.MeshStandardMaterial({ color: '#5a4632', roughness: 1 }),
    trees.length,
  )
  const crownMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(3.6, 1),
    new THREE.MeshStandardMaterial({ color: '#4f7040', roughness: 0.95, flatShading: true }),
    trees.length,
  )
  trunkMesh.castShadow = crownMesh.castShadow = true
  crownMesh.receiveShadow = true
  trees.forEach((_, i) => crownMesh.setColorAt(i, tmpCol.setHSL(0.25 + rnd() * 0.06, 0.35, 0.28 + rnd() * 0.1)))
  root.add(trunkMesh, crownMesh)

  const CARS = 90
  const carMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(4.4, 1.5, 2),
    new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.6 }),
    CARS,
  )
  carMesh.castShadow = true
  const carPalette = ['#e8e6e1', '#22262b', '#8c9196', '#a3342b', '#2f5d8a', '#c9b48a']
  const cars = Array.from({ length: CARS }, (_, i) => {
    carMesh.setColorAt(i, tmpCol.set(carPalette[Math.floor(rnd() * carPalette.length)]))
    const dir = rnd() > 0.5 ? 1 : -1
    return {
      alongX: rnd() > 0.5,
      line: o + Math.floor(rnd() * (BLOCKS + 1)) * BLOCK,
      lane: dir * 3,
      dir,
      s: (rnd() - 0.5) * CITY,
      v: 9 + rnd() * 7,
    }
  })
  root.add(carMesh)
  let legacyCars = true
  let ambient: ReturnType<typeof createStreetLife> | null = null
  const ambientBounds = { minX: -CITY / 2 - 8, maxX: CITY / 2 + 8, minZ: -CITY / 2 - 8, maxZ: CITY / 2 + 8 }
  function stepCars(dt: number) {
    const lim = CITY / 2 + 8
    cars.forEach((c, i) => {
      c.s += c.dir * c.v * dt
      if (c.s > lim) c.s -= 2 * lim
      else if (c.s < -lim) c.s += 2 * lim
      const x = c.alongX ? c.s : c.line + c.lane
      const z = c.alongX ? c.line + c.lane : c.s
      tmpM.compose(
        tmpV.set(x, groundY(x, z, tNow) + 0.85, z),
        tmpQ.setFromAxisAngle(UP, c.alongX ? 0 : Math.PI / 2),
        tmpS.set(1, 1, 1),
      )
      carMesh.setMatrixAt(i, tmpM)
    })
    carMesh.instanceMatrix.needsUpdate = true
  }

  function fissureTexture() {
    const px = 2048
    const c = document.createElement('canvas')
    c.width = c.height = px
    const g = c.getContext('2d')!
    const toPx = (x: number, z: number) => [((x + HALF) / SIZE) * px, ((z + HALF) / SIZE) * px]
    g.strokeStyle = 'rgba(28,20,14,0.95)'
    g.lineCap = 'round'
    g.lineJoin = 'round'
    for (let n = 0; n < 3; n++) {
      const off = FAULT.offset + (n - 1) * 9
      g.lineWidth = n === 1 ? 5 : 2.5
      g.beginPath()
      for (let s = -420, first = true; s <= 420; s += 6) {
        const j = (rnd() - 0.5) * 5
        const x = off * FAULT.cos - s * FAULT.sin + j * FAULT.cos
        const z = off * FAULT.sin + s * FAULT.cos + j * FAULT.sin
        const [u, v] = toPx(x, z)
        if (first) {
          g.moveTo(u, v)
          first = false
        } else g.lineTo(u, v)
        if (rnd() > 0.9) {
          g.lineTo(u + (rnd() - 0.5) * 40, v + (rnd() - 0.5) * 40)
          g.moveTo(u, v)
        }
      }
      g.stroke()
    }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }
  const fissureMat = new THREE.MeshStandardMaterial({
    map: fissureTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    roughness: 1,
  })
  const fissures = new THREE.Mesh(groundGeo, fissureMat)
  fissures.receiveShadow = true
  root.add(fissures)

  function updateScenery(t: number) {
    fissureMat.opacity = smooth(2, 9, t)
    trees.forEach((tr, i) => {
      const y = groundY(tr.x, tr.z, t)
      tmpM.compose(tmpV.set(tr.x, y + 2 * tr.s, tr.z), tmpQ.identity(), tmpS.set(tr.s, tr.s, tr.s))
      trunkMesh.setMatrixAt(i, tmpM)
      tmpM.compose(tmpV.set(tr.x, y + 5.6 * tr.s, tr.z), tmpQ.identity(), tmpS.set(tr.s, tr.s * 1.1, tr.s))
      crownMesh.setMatrixAt(i, tmpM)
    })
    trunkMesh.instanceMatrix.needsUpdate = crownMesh.instanceMatrix.needsUpdate = true
  }

  /* ---------- Collapse (illustration) ---------- */
  const tmpQ2 = new THREE.Quaternion()
  const tmpE = new THREE.Euler()
  const qInv = new THREE.Quaternion()
  const localUp = new THREE.Vector3()
  const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
  const DUST_COL = new THREE.Color('#b9b0a2')

  const pile = new Map<string, number>()
  const cellKey = (x: number, z: number) => Math.round(x / 3) + ',' + Math.round(z / 3)
  const pileAt = (x: number, z: number) => pile.get(cellKey(x, z)) || 0
  function addPile(x: number, z: number, r: number, top: number) {
    for (let i = -r; i <= r + 0.01; i += 3)
      for (let j = -r; j <= r + 0.01; j += 3) {
        const k = cellKey(x + i, z + j)
        pile.set(k, Math.max(pile.get(k) || 0, top))
      }
  }

  const bgrid = new Map<string, SimBuilding[]>()
  const blockKey = (x: number, z: number) => Math.floor((x - o) / BLOCK) + ',' + Math.floor((z - o) / BLOCK)
  buildings.forEach((b) => {
    const k = blockKey(b.cx, b.cz)
    if (!bgrid.has(k)) bgrid.set(k, [])
    bgrid.get(k)!.push(b)
  })
  function hitBuildings(c: Chunk, e: number, floorIn: number) {
    let floor = floorIn
    const list = bgrid.get(blockKey(c.p.x, c.p.z))
    if (!list) return floor
    for (const b of list) {
      if (b.collapsed) continue
      const hx = b.w / 2 + 0.4
      const hz = b.d / 2 + 0.4
      const dx = c.p.x - b.cx
      const dz = c.p.z - b.cz
      if (Math.abs(dx) > hx || Math.abs(dz) > hz) continue
      const roof = b.group.position.y + b.h + 1
      if (c.p.y - e > roof - 2) {
        floor = Math.max(floor, roof)
        continue
      }
      if (hx - Math.abs(dx) < hz - Math.abs(dz)) {
        c.p.x = b.cx + Math.sign(dx) * hx
        c.v.x = Math.abs(c.v.x) * Math.sign(dx) * 0.25
      } else {
        c.p.z = b.cz + Math.sign(dz) * hz
        c.v.z = Math.abs(c.v.z) * Math.sign(dz) * 0.25
      }
      c.w.multiplyScalar(0.7)
    }
    return floor
  }

  function chunkTexture(withWindow: boolean) {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')!
    g.fillStyle = '#d6cebf'
    g.fillRect(0, 0, 128, 128)
    for (let i = 0; i < 1400; i++) {
      const v = 110 + rnd() * 120
      g.fillStyle = `rgba(${v},${v - 6},${v - 14},0.35)`
      g.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 3, 1 + rnd() * 3)
    }
    if (withWindow) {
      g.fillStyle = '#262c31'
      g.fillRect(36, 30, 56, 54)
      g.fillStyle = 'rgba(150,180,200,0.22)'
      g.fillRect(38, 32, 22, 50)
    }
    g.strokeStyle = 'rgba(55,46,38,0.75)'
    g.lineWidth = 9
    g.strokeRect(0, 0, 128, 128)
    g.strokeStyle = 'rgba(40,34,28,0.6)'
    g.lineWidth = 1.5
    for (let n = 0; n < 5; n++) {
      g.beginPath()
      let x = rnd() * 128
      let y = 0
      g.moveTo(x, y)
      while (y < 128) {
        x += (rnd() - 0.5) * 22
        y += 8 + rnd() * 12
        g.lineTo(x, y)
      }
      g.stroke()
    }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }
  const MAXC = 4500
  const concreteMat = new THREE.MeshStandardMaterial({ map: chunkTexture(false), roughness: 0.97 })
  const panelMat = new THREE.MeshStandardMaterial({ map: chunkTexture(true), roughness: 0.9 })
  const chunkMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    [concreteMat, concreteMat, concreteMat, concreteMat, panelMat, panelMat],
    MAXC,
  )
  chunkMesh.castShadow = chunkMesh.receiveShadow = true
  chunkMesh.frustumCulled = false
  chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  const freeChunks: number[] = []
  const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0)
  for (let i = MAXC - 1; i >= 0; i--) {
    chunkMesh.setMatrixAt(i, ZERO_M)
    chunkMesh.setColorAt(i, tmpCol.set('#ffffff'))
    freeChunks.push(i)
  }
  root.add(chunkMesh)
  const chunks: Chunk[] = []
  let chunksDirty = false
  function writeChunk(c: Chunk) {
    tmpM.compose(c.p, c.q, c.s)
    chunkMesh.setMatrixAt(c.i, tmpM)
    chunksDirty = true
  }
  function halfHeight(c: Chunk) {
    qInv.copy(c.q).invert()
    localUp.copy(UP).applyQuaternion(qInv)
    return 0.5 * (c.s.x * Math.abs(localUp.x) + c.s.y * Math.abs(localUp.y) + c.s.z * Math.abs(localUp.z))
  }
  function restingTarget(q: THREE.Quaternion, out: THREE.Quaternion) {
    let best = 0
    let bd = -1
    let sign = 1
    for (let k = 0; k < 3; k++) {
      const d = tmpV2.copy(AXES[k]).applyQuaternion(q).y
      if (Math.abs(d) > bd) {
        bd = Math.abs(d)
        best = k
        sign = Math.sign(d) || 1
      }
    }
    tmpV2.copy(AXES[best]).applyQuaternion(q).multiplyScalar(sign)
    return out.setFromUnitVectors(tmpV2, UP).multiply(q)
  }

  /* ---------- Dust ---------- */
  function puffTexture() {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')!
    for (let i = 0; i < 10; i++) {
      const x = 36 + rnd() * 56
      const y = 36 + rnd() * 56
      const r = 20 + rnd() * 22
      const grd = g.createRadialGradient(x, y, 0, x, y, r)
      grd.addColorStop(0, 'rgba(255,255,255,0.5)')
      grd.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grd
      g.fillRect(0, 0, 128, 128)
    }
    g.globalCompositeOperation = 'source-atop'
    const sh = g.createLinearGradient(0, 0, 0, 128)
    sh.addColorStop(0, 'rgb(255,255,255)')
    sh.addColorStop(1, 'rgb(110,110,110)')
    g.fillStyle = sh
    g.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(c)
  }
  const DN = 4000
  const dPos = new Float32Array(DN * 3)
  const dSize = new Float32Array(DN)
  const dAlpha = new Float32Array(DN)
  const dShade = new Float32Array(DN)
  const dVel = new Float32Array(DN * 3)
  const dLife = new Float32Array(DN)
  const dMax = new Float32Array(DN)
  const dS0 = new Float32Array(DN)
  const dGeo = new THREE.BufferGeometry()
  ;(
    [
      ['position', dPos, 3],
      ['size', dSize, 1],
      ['alpha', dAlpha, 1],
      ['shade', dShade, 1],
    ] as const
  ).forEach(([n, arr, k]) => {
    dGeo.setAttribute(n, new THREE.BufferAttribute(arr, k).setUsage(THREE.DynamicDrawUsage))
  })
  const dustMat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: puffTexture() },
      scale: { value: 600 },
      lit: { value: new THREE.Color('#efe3cf') },
      dark: { value: new THREE.Color('#857a6c') },
    },
    vertexShader: `
      attribute float size; attribute float alpha; attribute float shade;
      uniform float scale; varying float vA; varying float vS;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(size * scale / max(1.0, -mv.z), 1024.0);
        vA = alpha; vS = shade;
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform vec3 lit; uniform vec3 dark;
      varying float vA; varying float vS;
      void main() {
        vec4 t = texture2D(map, vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y));
        float a = t.a * vA;
        if (a < 0.004) discard;
        gl_FragColor = vec4(mix(dark, lit, t.r) * vS, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  })
  const dustPts = new THREE.Points(dGeo, dustMat)
  dustPts.frustumCulled = false
  dustPts.renderOrder = 2
  root.add(dustPts)
  let dNext = 0
  let dustAlive = 0
  function emitDust(x: number, y: number, z: number, n: number, spread: number, speed: number, size: number) {
    for (let k = 0; k < n; k++) {
      const i = dNext
      dNext = (dNext + 1) % DN
      const a = rnd() * Math.PI * 2
      const r = rnd() * spread
      const sp = speed * (0.4 + rnd() * 0.8)
      dPos[i * 3] = x + Math.cos(a) * r
      dPos[i * 3 + 1] = y + rnd() * size * 0.4
      dPos[i * 3 + 2] = z + Math.sin(a) * r
      dVel[i * 3] = Math.cos(a) * sp
      dVel[i * 3 + 1] = 0.2 + rnd() * speed * 0.2
      dVel[i * 3 + 2] = Math.sin(a) * sp
      dMax[i] = dLife[i] = 9 + rnd() * 12
      dS0[i] = size * (0.6 + rnd() * 0.8)
      dShade[i] = 0.72 + rnd() * 0.28
    }
    dustAlive = 25
  }
  function stepDust(dt: number) {
    if (dustAlive <= 0) return
    dustAlive -= dt
    const damp = Math.exp(-0.9 * dt)
    for (let i = 0; i < DN; i++) {
      if (dLife[i] <= 0) {
        dAlpha[i] = 0
        continue
      }
      dLife[i] -= dt
      dVel[i * 3] *= damp
      dVel[i * 3 + 2] *= damp
      dVel[i * 3 + 1] = dVel[i * 3 + 1] * damp + 0.12 * dt
      dPos[i * 3] += dVel[i * 3] * dt
      dPos[i * 3 + 1] += dVel[i * 3 + 1] * dt
      dPos[i * 3 + 2] += dVel[i * 3 + 2] * dt
      const k = 1 - dLife[i] / dMax[i]
      dSize[i] = dS0[i] * (1 + 3.2 * Math.sqrt(k))
      const gy = groundY(dPos[i * 3], dPos[i * 3 + 2], tNow) + dSize[i] * 0.16
      if (dPos[i * 3 + 1] < gy) dPos[i * 3 + 1] = gy
      dAlpha[i] = 0.4 * Math.min(1, k * 10) * Math.min(1, (1 - k) * 2.2)
    }
    for (const n of ['position', 'size', 'alpha', 'shade']) dGeo.attributes[n].needsUpdate = true
  }

  /* ---------- Debris ---------- */
  const DEBRIS = 900
  const debrisMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.9, 0.6, 0.7),
    new THREE.MeshStandardMaterial({ color: '#c9bca6', roughness: 1 }),
    DEBRIS,
  )
  debrisMesh.castShadow = true
  debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  root.add(debrisMesh)
  const parts = Array.from({ length: DEBRIS }, () => ({
    alive: false,
    p: new THREE.Vector3(),
    v: new THREE.Vector3(),
    r: new THREE.Euler(),
    w: new THREE.Vector3(),
    life: 0,
  }))
  let nextPart = 0
  function spawnDebris(b: SimBuilding) {
    const base = b.group.position.y
    for (let k = 0; k < 8; k++) {
      const q = parts[nextPart]
      nextPart = (nextPart + 1) % DEBRIS
      const side = Math.floor(rnd() * 4)
      const u = rnd() - 0.5
      const nx = side === 0 ? 1 : side === 1 ? -1 : 0
      const nz = side === 2 ? 1 : side === 3 ? -1 : 0
      q.p.set(b.cx + (nx * b.w) / 2 + (nz ? u * b.w : 0), base + 3 + rnd() * (b.h - 3), b.cz + (nz * b.d) / 2 + (nx ? u * b.d : 0))
      q.v.set(nx * (1.5 + rnd() * 3) + (rnd() - 0.5), 1 + rnd() * 2, nz * (1.5 + rnd() * 3) + (rnd() - 0.5))
      q.w.set(rnd() * 6, rnd() * 6, rnd() * 6)
      q.r.set(rnd() * 3, rnd() * 3, rnd() * 3)
      q.life = 7
      q.alive = true
    }
  }
  function spawnShards(x: number, y: number, z: number, n: number, speed: number) {
    for (let k = 0; k < n; k++) {
      const q = parts[nextPart]
      nextPart = (nextPart + 1) % DEBRIS
      const a = rnd() * Math.PI * 2
      const sp = speed * (0.5 + rnd())
      q.p.set(x, y, z)
      q.v.set(Math.cos(a) * sp, 1 + rnd() * speed, Math.sin(a) * sp)
      q.w.set(rnd() * 8, rnd() * 8, rnd() * 8)
      q.r.set(rnd() * 3, rnd() * 3, rnd() * 3)
      q.life = 4 + rnd() * 3
      q.alive = true
    }
  }
  function stepDebris(dt: number) {
    for (let i = 0; i < DEBRIS; i++) {
      const q = parts[i]
      if (q.alive) {
        q.v.y -= 9.81 * dt
        q.p.addScaledVector(q.v, dt)
        const gy = groundY(q.p.x, q.p.z, tNow) + pileAt(q.p.x, q.p.z) + 0.3
        if (q.p.y < gy) {
          q.p.y = gy
          q.v.y *= -0.25
          q.v.x *= 0.6
          q.v.z *= 0.6
          q.w.multiplyScalar(0.5)
        }
        q.r.x += q.w.x * dt
        q.r.y += q.w.y * dt
        q.r.z += q.w.z * dt
        q.life -= dt
        if (q.life <= 0) q.alive = false
        const s = Math.min(1, Math.max(0, q.life))
        tmpS.set(s, s, s)
        tmpM.compose(q.p, tmpQ.setFromEuler(q.r), tmpS)
      } else {
        tmpM.compose(zero, tmpQ.identity(), tmpS.set(0, 0, 0))
      }
      debrisMesh.setMatrixAt(i, tmpM)
    }
    debrisMesh.instanceMatrix.needsUpdate = true
  }

  /* ---------- Falling buildings ---------- */
  const falling: SimBuilding[] = []
  function collapse(b: SimBuilding, ax: number, az: number) {
    b.collapsed = true
    let dx = -ax
    let dz = -az
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    const wd = Math.abs(dx) * b.w + Math.abs(dz) * b.d
    const p0 = b.group.position.clone()
    b.fall = {
      theta: 0,
      omega: 0.015,
      axis: new THREE.Vector3(dz, 0, -dx),
      wd,
      p0,
      q0: b.group.quaternion.clone(),
      pivot: p0.clone().add(tmpV.set(dx * wd * 0.3, 0, dz * wd * 0.3)),
      breakAt: 0.2 + rnd() * 0.16,
      shed: 0,
    }
    falling.push(b)
    emitDust(p0.x + dx * wd * 0.3, p0.y, p0.z + dz * wd * 0.3, 18, wd * 0.4, 2, 6)
  }
  function stepFalling(dt: number) {
    for (let k = falling.length - 1; k >= 0; k--) {
      const b = falling[k]
      const f = b.fall!
      const I = (b.h * b.h) / 3 + (f.wd * f.wd) / 12
      f.omega += ((G * (b.h / 2) * Math.sin(f.theta + 0.05)) / I) * dt
      f.theta += f.omega * dt
      tmpQ2.setFromAxisAngle(f.axis, f.theta)
      b.group.quaternion.copy(tmpQ2).multiply(f.q0)
      b.group.position.copy(f.p0).sub(f.pivot).applyQuaternion(tmpQ2).add(f.pivot)
      f.shed -= dt
      if (f.shed <= 0) {
        f.shed = 0.12
        const y = b.group.position.y + rnd() * b.h
        spawnShards(b.group.position.x + (rnd() - 0.5) * b.w, y, b.group.position.z + (rnd() - 0.5) * b.d, 2, 1.5)
      }
      if (f.theta >= f.breakAt) {
        fracture(b)
        falling.splice(k, 1)
      }
    }
  }
  function fracture(b: SimBuilding) {
    const f = b.fall!
    b.group.updateMatrixWorld(true)
    b.group.visible = false
    const nx = Math.max(2, Math.round(b.w / 6))
    const nz = Math.max(2, Math.round(b.d / 6))
    const tone = new THREE.Color(FACADE_TONES[b.fi])
    const omegaVec = f.axis.clone().multiplyScalar(f.omega)
    const cw = b.w / nx
    const cd = b.d / nz
    const addPiece = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, yaw: number, fl: number) => {
      if (!freeChunks.length) return
      const i = freeChunks.pop()!
      const p = new THREE.Vector3(lx, ly, lz).applyMatrix4(b.group.matrixWorld)
      const v = new THREE.Vector3().crossVectors(omegaVec, tmpV.copy(p).sub(f.pivot))
      const lower = 1 - fl / b.floors
      v.add(tmpV.set((rnd() - 0.5) * 1.6, (rnd() - 0.6) * 1.2 - lower * 2.5, (rnd() - 0.5) * 1.6))
      const q = b.group.quaternion
        .clone()
        .multiply(tmpQ2.setFromEuler(tmpE.set((rnd() - 0.5) * 0.35, yaw + (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.35)))
      const w = omegaVec.clone().add(tmpV.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(1.4))
      chunkMesh.setColorAt(i, tmpCol.copy(tone).multiplyScalar(0.8 + rnd() * 0.25))
      const c: Chunk = {
        i,
        b,
        p,
        q,
        v,
        w,
        s: new THREE.Vector3(sx, sy, sz),
        settled: false,
        restOff: 0,
        still: 0,
        tone: tone.clone(),
        trail: rnd(),
      }
      chunks.push(c)
      b.chunks.push(c)
      writeChunk(c)
    }
    for (let fl = 0; fl < b.floors; fl++)
      for (let ix = 0; ix < nx; ix++)
        for (let iz = 0; iz < nz; iz++) {
          const x = -b.w / 2 + (ix + 0.5) * cw
          const z = -b.d / 2 + (iz + 0.5) * cd
          if (rnd() < 0.55) addPiece(x, fl * FLOOR_H + 0.3, z, cw * (0.75 + rnd() * 0.4), 0.3 + rnd() * 0.25, cd * (0.75 + rnd() * 0.4), 0, fl)
          const sides: [number, number, number, number][] = []
          if (ix === 0) sides.push([-b.w / 2, z, Math.PI / 2, cd])
          if (ix === nx - 1) sides.push([b.w / 2, z, Math.PI / 2, cd])
          if (iz === 0) sides.push([x, -b.d / 2, 0, cw])
          if (iz === nz - 1) sides.push([x, b.d / 2, 0, cw])
          sides.forEach(([px, pz, yaw, len]) => {
            if (rnd() < 0.7)
              addPiece(px, (fl + 0.5) * FLOOR_H, pz, len * (0.6 + rnd() * 0.45), FLOOR_H * (0.55 + rnd() * 0.45), 0.3 + rnd() * 0.15, yaw, fl)
          })
        }
    if (chunkMesh.instanceColor) chunkMesh.instanceColor.needsUpdate = true
    emitDust(b.group.position.x, b.group.position.y + 2, b.group.position.z, 70, Math.max(b.w, b.d) * 0.6, 5, 10)
  }
  function stepChunks(dt: number) {
    for (const c of chunks) {
      if (c.settled) continue
      c.v.y -= G * dt
      c.p.addScaledVector(c.v, dt)
      const wl = c.w.length()
      if (wl > 1e-4) c.q.premultiply(tmpQ2.setFromAxisAngle(tmpV.copy(c.w).divideScalar(wl), wl * dt)).normalize()
      const e = halfHeight(c)
      let floor = groundY(c.p.x, c.p.z, tNow) + pileAt(c.p.x, c.p.z)
      floor = hitBuildings(c, e, floor)
      const speed = c.v.length()
      c.trail -= dt * speed * 0.08
      if (c.trail <= 0) {
        c.trail = 1
        emitDust(c.p.x, c.p.y, c.p.z, 1, 1, 0.5, 3)
      }
      if (c.p.y - e < floor) {
        const impact = -c.v.y
        c.p.y = floor + e
        if (impact > 2.5) {
          const k = Math.min(1, impact / 22)
          c.v.y = impact * 0.16
          c.v.x *= 0.6
          c.v.z *= 0.6
          c.w.multiplyScalar(0.55).add(tmpV.set(rnd() - 0.5, 0, rnd() - 0.5).multiplyScalar(impact * 0.08))
          if (impact > 6) {
            emitDust(c.p.x, floor, c.p.z, 2 + Math.round(k * 5), Math.max(c.s.x, c.s.z) * 0.6, 3 + k * 8, 5 + k * 8)
            if (rnd() < 0.4) spawnShards(c.p.x, floor + 0.5, c.p.z, 3, 1.5 + k * 5)
            world.shake = Math.min(1.4, world.shake + k * 0.05 * Math.min(1, 320 / camera.position.distanceTo(c.p)))
          }
        } else {
          c.v.y = 0
          const fr = Math.exp(-7 * dt)
          c.v.x *= fr
          c.v.z *= fr
          c.w.multiplyScalar(Math.exp(-6 * dt))
          c.q.slerp(restingTarget(c.q, tmpQ2), Math.min(1, 5 * dt))
          c.p.y = floor + halfHeight(c)
        }
        c.still = c.v.length() + c.w.length() * 1.5 < 0.6 ? c.still + dt : 0
        if (c.still > 0.3) settleChunk(c, floor)
      }
      writeChunk(c)
    }
    if (chunksDirty) {
      chunkMesh.instanceMatrix.needsUpdate = true
      chunksDirty = false
    }
  }
  function settleChunk(c: Chunk, floor: number) {
    c.settled = true
    restingTarget(c.q, c.q)
    c.q.premultiply(tmpQ2.setFromEuler(tmpE.set((rnd() - 0.5) * 0.14, 0, (rnd() - 0.5) * 0.14)))
    const e = halfHeight(c)
    c.p.y = floor + e * 0.92
    c.restOff = c.p.y - groundY(c.p.x, c.p.z, tNow)
    addPile(c.p.x, c.p.z, Math.min(c.s.x, c.s.z) * 0.45, c.restOff + e * 0.8)
    chunkMesh.setColorAt(c.i, tmpCol.copy(c.tone).lerp(DUST_COL, 0.4).multiplyScalar(0.85 + rnd() * 0.15))
    if (chunkMesh.instanceColor) chunkMesh.instanceColor.needsUpdate = true
  }
  function restore(b: SimBuilding) {
    const k = falling.indexOf(b)
    if (k >= 0) falling.splice(k, 1)
    if (b.chunks.length) {
      const gone = new Set(b.chunks)
      b.chunks.forEach((c) => {
        chunkMesh.setMatrixAt(c.i, ZERO_M)
        freeChunks.push(c.i)
      })
      for (let i = chunks.length - 1; i >= 0; i--) if (gone.has(chunks[i])) chunks.splice(i, 1)
      chunkMesh.instanceMatrix.needsUpdate = true
      pile.clear()
      chunks.forEach((c) => {
        if (c.settled) addPile(c.p.x, c.p.z, Math.min(c.s.x, c.s.z) * 0.45, c.restOff + halfHeight(c) * 0.8)
      })
    }
    b.chunks = []
    b.fall = null
    b.collapsed = false
    b.group.visible = true
    b.group.quaternion.identity()
    b.group.position.set(b.cx, b.group.position.y, b.cz)
  }
  function updateRubble(t: number) {
    let any = false
    for (const c of chunks)
      if (c.settled) {
        c.p.y = groundY(c.p.x, c.p.z, t) + c.restOff
        writeChunk(c)
        any = true
      }
    if (any) chunkMesh.instanceMatrix.needsUpdate = true
  }

  /* ---------- Distortion bookkeeping ---------- */
  const corners = (b: SimBuilding, t: number) => {
    const hw = b.w / 2
    const hd = b.d / 2
    return [settle(b.cx + hw, b.cz + hd, t), settle(b.cx + hw, b.cz - hd, t), settle(b.cx - hw, b.cz + hd, t), settle(b.cx - hw, b.cz - hd, t)]
  }
  const betaAt = (b: SimBuilding, t: number) => {
    const [s1, s2, s3, s4] = corners(b, t)
    return Math.max(Math.abs(s1 - s3) / b.w, Math.abs(s2 - s4) / b.w, Math.abs(s1 - s2) / b.d, Math.abs(s3 - s4) / b.d)
  }
  buildings.forEach((b) => (b.betaRate = betaAt(b, 1)))
  const yearFor = (b: SimBuilding, r: number) => (b.betaRate > 0 ? 1 / r / b.betaRate : Infinity)
  const maxRate = Math.max(...buildings.map((b) => b.betaRate))
  const countAt = (r: number, t: number) => buildings.reduce((a, b) => a + (b.betaRate * t >= 1 / r ? 1 : 0), 0)

  /* ---------- World update ---------- */
  const COL = {
    ok: new THREE.Color(CATEGORY_COLOUR.ok),
    warn: new THREE.Color(CATEGORY_COLOUR.warn),
    crit: new THREE.Color(CATEGORY_COLOUR.crit),
    white: new THREE.Color('#ffffff'),
  }
  const SINK_DEEP = new THREE.Color('#3f6fb0')
  const tmpC = new THREE.Color()
  let risk = false

  function update(t: number, forward: boolean, animating: boolean) {
    tNow = t
    for (let i = 0; i < gPos.count; i++) {
      const x = gPos.getX(i)
      const z = gPos.getZ(i)
      const s = settle(x, z, t) * edgeTaper(x, z)
      gPos.setY(i, s * EXAG)
      if (risk) {
        tmpC.copy(COL.white).lerp(SINK_DEEP, Math.min(1, -s / 4))
        gColors[i * 3] = tmpC.r
        gColors[i * 3 + 1] = tmpC.g
        gColors[i * 3 + 2] = tmpC.b
      } else {
        gColors[i * 3] = gColors[i * 3 + 1] = gColors[i * 3 + 2] = 1
      }
    }
    gPos.needsUpdate = true
    groundGeo.attributes.color.needsUpdate = true
    groundGeo.computeVertexNormals()

    for (const b of buildings) {
      const [s1, s2, s3, s4] = corners(b, t)
      const mean = (s1 + s2 + s3 + s4) / 4
      const ax = (s1 + s2 - (s3 + s4)) / (2 * b.w)
      const az = (s1 + s3 - (s2 + s4)) / (2 * b.d)
      b.drop = -mean
      b.beta = Math.max(Math.abs(s1 - s3) / b.w, Math.abs(s2 - s4) / b.w, Math.abs(s1 - s2) / b.d, Math.abs(s3 - s4) / b.d)
      if (b.collapsed && b.beta < LIMIT_FALL) restore(b)
      if (!b.collapsed) {
        b.group.position.y = mean * EXAG
        b.group.rotation.set(Math.atan(-az * EXAG), 0, Math.atan(ax * EXAG))
        if (b.beta >= LIMIT_FALL) collapse(b, ax, az)
      }
      const cat = category(b.beta)
      b.crack.opacity = Math.max(0, Math.min(1, (b.beta - LIMIT_SAFE) / (LIMIT_CRIT - LIMIT_SAFE)))
      b.wall.color.copy(risk ? COL[cat] : COL.white)
      const crit = cat === 'crit'
      if (crit && !b.wasCrit && forward && animating) spawnDebris(b)
      b.wasCrit = crit
    }
    updateRubble(t)
    updateScenery(t)
    if (legacyCars) stepCars(0)
    ambient?.step(0)
  }

  const fmtYear = (y: number) => (y <= T_MAX ? 'year ' + y.toFixed(1) : 'after year ' + T_MAX)

  const world: SimulationWorld = {
    kind: 'simulation',
    buildingCount: buildings.length,
    now: SIM_NOW,
    shake: 0,
    view: {
      position: stage.exhibition ? new THREE.Vector3(650, 680, 900) : new THREE.Vector3(560, 360, 600),
      target: new THREE.Vector3(20, -10, 0),
      from: new THREE.Vector3(-260, 1150, 1250),
    },
    setTime: update,
    setRisk(on) {
      risk = on
      update(tNow, false, false)
    },
    isSettling() {
      return falling.length > 0 || dustAlive > 0 || chunks.some((c) => !c.settled) || parts.some((q) => q.alive)
    },
    step(raw) {
      const n = Math.ceil(raw / 0.02)
      const h = raw / Math.max(1, n)
      for (let i = 0; i < n; i++) {
        stepFalling(h)
        stepChunks(h)
      }
      stepDust(raw)
      stepDebris(raw)
    },
    setAmbient(on) {
      if (on && !ambient) {
        // Retire the original static traffic before allocating the ambient
        // actors: there is never a second hidden 90-car instance allocation.
        root.remove(carMesh)
        carMesh.geometry.dispose()
        ;(carMesh.material as THREE.Material).dispose()
        carMesh.dispose()
        legacyCars = false
        // These are the existing invented grid streets, not extra road geometry.
        const streets: Street[] = []
        for (let i = 0; i <= BLOCKS; i++) {
          const line = o + i * BLOCK
          streets.push({ kind: 'road:residential', line: [[-CITY / 2 - 8, -line], [CITY / 2 + 8, -line]] },
            { kind: 'road:residential', line: [[line, CITY / 2 + 8], [line, -CITY / 2 - 8]] })
        }
        ambient = createStreetLife(root, streetRoutes(streets, ambientBounds), ambientBounds, (x, z) => groundY(x, z, tNow))
      }
      if (legacyCars) carMesh.visible = !on
      if (ambient) ambient.root.visible = on
    },
    stepAmbient(dt) { if (ambient?.root.visible) ambient.step(dt) },
    pick(ray) {
      const hit = ray.intersectObjects(wallMeshes, false).find((h) => h.object.parent?.visible)
      return hit ? (hit.object.userData.id as number) : null
    },
    tip(id, t) {
      const b = buildings[id]
      const beta = betaAt(b, t)
      const cat = category(beta)
      return {
        title: `Building ${b.id + 1} · ${b.floors} floors`,
        pill: { label: CATEGORY_LABEL[cat], colour: CATEGORY_COLOUR[cat] },
        rows: [
          { term: 'Sank', value: `${Math.round(-((corners(b, t).reduce((a, s) => a + s, 0) / 4) * 100))} cm` },
          { term: 'Uneven sinking', value: beta > 1e-6 ? `1 in ${Math.round(1 / beta)}` : 'none' },
          { term: 'First wall cracks', value: fmtYear(yearFor(b, 300)) },
          { term: 'Structural damage', value: fmtYear(yearFor(b, 150)) },
          { term: 'Shown falling', value: fmtYear(yearFor(b, 50)) },
        ],
        note: 'Invented building on invented ground.',
      }
    },
    rungs(t, selected) {
      const sel = selected === null ? null : buildings[selected]
      const fall: RungState = {
        r: 50,
        color: '#781608',
        what: 'Collapse (illustration)',
        why: 'No engineering standard predicts collapse. It depends on how each building is built, and people are normally moved out long before. Here, buildings past 1 in 50 are shown falling so you can see where unchecked damage leads.',
        count: countAt(50, t),
        first: 1 / 50 / maxRate,
        mine: !!sel && sel.collapsed,
      }
      return [
        fall,
        ...RUNGS.map((g) => ({
          r: g.r,
          color: g.color,
          what: g.what,
          why: g.why,
          count: countAt(g.r, t),
          first: 1 / g.r / maxRate,
          mine:
            !!sel &&
            !sel.collapsed &&
            sel.betaRate * t >= 1 / g.r &&
            RUNGS.every((h) => h.r >= g.r || sel.betaRate * t < 1 / h.r),
        })),
      ]
    },
    countAt,
    resize(drawHeight, fovDeg) {
      // Dust sizes are in metres: convert to pixels for this screen and field of view.
      dustMat.uniforms.scale.value = drawHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg / 2)))
    },
    fallShot() {
      const b = buildings.reduce((a, c) => (c.betaRate > a.betaRate ? c : a))
      const hw = b.w / 2
      const hd = b.d / 2
      const ax = (settle(b.cx + hw, b.cz, 1) - settle(b.cx - hw, b.cz, 1)) / b.w
      const az = (settle(b.cx, b.cz + hd, 1) - settle(b.cx, b.cz - hd, 1)) / b.d
      let dx = -ax
      let dz = -az
      const l = Math.hypot(dx, dz) || 1
      dx /= l
      dz /= l
      const year = yearFor(b, 50)
      const baseY = (settle(b.cx, b.cz, Math.max(0, year - 1.2)) || 0) * EXAG
      const target = new THREE.Vector3(b.cx + dx * b.h * 0.3, baseY + b.h * 0.25, b.cz + dz * b.h * 0.3)
      const dist = 170 + b.h * 2.6
      const position = target.clone().add(new THREE.Vector3(-dz * dist - dx * dist * 0.3, dist * 0.62, dx * dist - dz * dist * 0.3))
      return { year, position, target }
    },
    clearDebris() {
      parts.forEach((q) => (q.alive = false))
      stepDebris(0)
      // A seek/replay may render a still without advancing the particle clock.
      // Clear the visible buffer as well as the lifetimes, or old collapse dust
      // remains suspended over a restored city until animation resumes.
      dustAlive = 0
      dNext = 0
      dLife.fill(0)
      dAlpha.fill(0)
      dGeo.attributes.alpha.needsUpdate = true
    },
    resetCrossings(atTime) {
      buildings.forEach((b) => (b.wasCrit = atTime === undefined ? false : category(betaAt(b, atTime)) === 'crit'))
    },
    summaryAt(t) {
      let deepest = 0
      let over1 = 0
      let n = 0
      for (let i = 0; i <= 60; i++)
        for (let j = 0; j <= 60; j++) {
          const x = -CITY / 2 + (i / 60) * CITY
          const z = -CITY / 2 + (j / 60) * CITY
          const s = -settle(x, z, t)
          deepest = Math.max(deepest, s)
          if (s > 1) over1++
          n++
        }
      return { deepest, over1: over1 / n, cracked: countAt(300, t), lean: countAt(250, t), damaged: countAt(150, t), falling: countAt(50, t) }
    },
    dispose() {
      ambient?.dispose()
      scene.remove(root)
      disposeTree(root)
      facades.forEach((f) => f.dispose())
      cracks.dispose()
    },
  }
  update(tNow, false, false)
  return world
}
