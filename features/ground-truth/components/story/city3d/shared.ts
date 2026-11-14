/**
 * Shared pieces of the 3D "sinking city" views: engineering limits, the
 * renderer/camera stage, procedural textures and the interface both worlds
 * (illustrative simulation and measured Tehran) implement.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/** Vertical exaggeration used for display in both worlds. */
export const EXAG = 6
export const T_MAX = 30

/** Bjerrum (1963) angular-distortion limits, worst first, in plain words. */
export const RUNGS = [
  { r: 150, color: '#ff6a3d', tick: 'Damage', what: 'Structural damage expected', why: 'Big cracks through brick walls. Beams and columns can be damaged. Engineers would need to check the building.' },
  { r: 250, color: '#ff9a3d', tick: '', what: 'The lean becomes visible', why: 'Tall, stiff buildings visibly tilt.' },
  { r: 300, color: '#ffbf47', tick: 'Cracks', what: 'First cracks in walls', why: 'Cracks open in walls and infill. Doors and windows can start to stick.' },
  { r: 500, color: '#a9d6ff', tick: '', what: 'Safe limit passed', why: 'Below this, buildings that must not crack are considered safe.' },
  { r: 750, color: '#d6ebff', tick: '', what: 'Sensitive machinery affected', why: 'Lifts and settlement-sensitive equipment can start to have trouble.' },
] as const

export const LIMIT_SAFE = 1 / 500
export const LIMIT_WARN = 1 / 300
export const LIMIT_CRIT = 1 / 150

export type Category = 'ok' | 'warn' | 'crit'
export const category = (beta: number): Category => (beta >= LIMIT_CRIT ? 'crit' : beta >= LIMIT_WARN ? 'warn' : 'ok')
export const CATEGORY_COLOUR: Record<Category, string> = { ok: '#a9d6ff', warn: '#ffbf47', crit: '#ff6a3d' }
export const CATEGORY_LABEL: Record<Category, string> = {
  ok: 'No cracks expected',
  warn: 'Cracks in walls likely',
  crit: 'Structural damage likely',
}

export const smooth = (a: number, b: number, v: number) => {
  const k = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return k * k * (3 - 2 * k)
}

/** Deterministic Park–Miller generator so every visit builds the same city. */
export function makeRng(seed = 11) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

export interface TipRow {
  term: string
  value: string
}

/** What the UI shows for a clicked building. */
export interface BuildingTip {
  title: string
  pill: { label: string; colour: string }
  rows: TipRow[]
  note?: string
}

export interface RungState {
  r: number
  color: string
  what: string
  why: string
  count: number
  /** First year any building in this world reaches the rung (Infinity if never). */
  first: number
  /** Whether the selected building is currently at this rung. */
  mine: boolean
}

/** One world rendered by the stage. */
export interface CityWorld {
  readonly kind: 'simulation' | 'measured'
  readonly buildingCount: number
  /** Years after this are a projection at the same rate. */
  readonly now: number
  setTime(t: number, forward: boolean, animating: boolean): void
  setRisk(on: boolean): void
  step(dt: number, t: number): void
  /** Decorative clock only: never changes the scientific time/ground mesh. */
  setAmbient?(on: boolean): void
  stepAmbient?(dt: number): void
  pick(ray: THREE.Raycaster): number | null
  tip(id: number, t: number): BuildingTip
  rungs(t: number, selected: number | null): RungState[]
  /** Buildings at or past 1 in r at year t (drives the chart). */
  countAt(r: number, t: number): number
  /** Called when the drawing buffer or field of view changes. */
  resize?(drawHeight: number, fovDeg: number): void
  /** Default camera framing. */
  view: { position: THREE.Vector3; target: THREE.Vector3; from: THREE.Vector3 }
  dispose(): void
}

/* ------------------------------------------------------------------ */
/*  Stage: renderer, sky, lights, camera, controls                     */
/* ------------------------------------------------------------------ */

export interface Stage {
  readonly exhibition?: boolean
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  sun: THREE.DirectionalLight
  invalidateShadows?(): void
  resize(width: number, height: number): void
  dispose(): void
}

export function createStage(canvas: HTMLCanvasElement, exhibition = false): Stage {
  // Fail before THREE installs context listeners when WebGL is unavailable.
  const context = canvas.getContext('webgl2', { antialias: true, alpha: false })
  if (!context) throw new Error('WebGL 2 is unavailable')
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, exhibition ? 1.5 : 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  // Ground/buildings/canopies stay still between explicit scientific poses.
  renderer.shadowMap.autoUpdate = false
  renderer.shadowMap.needsUpdate = true

  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(new THREE.Color(exhibition ? '#191c1d' : '#e8d9c4'), exhibition ? 4500 : 900, exhibition ? 7000 : 2300)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = env
  pmrem.dispose()

  // Late-afternoon sky: deep blue overhead, warm haze at the horizon.
  const c = document.createElement('canvas')
  c.width = 2
  c.height = 256
  const g = c.getContext('2d')!
  const grd = g.createLinearGradient(0, 0, 0, 256)
  grd.addColorStop(0, '#4f7fb3')
  grd.addColorStop(0.5, '#a9c2d8')
  grd.addColorStop(0.85, '#ecd6b8')
  grd.addColorStop(1, '#f1dcc0')
  g.fillStyle = grd
  g.fillRect(0, 0, 2, 256)
  const sky = new THREE.CanvasTexture(c)
  sky.colorSpace = THREE.SRGBColorSpace
  scene.background = exhibition ? new THREE.Color('#191c1d') : sky

  const camera = new THREE.PerspectiveCamera(38, 1, 1, 6000)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.maxPolarAngle = 1.42
  controls.minDistance = 120
  controls.maxDistance = exhibition ? 3600 : 1600

  scene.add(new THREE.HemisphereLight('#cfe0ff', '#8b7b62', 0.45))
  const sun = new THREE.DirectionalLight('#ffd6a3', 2.9)
  sun.position.set(-560, 380, 260)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -520, right: 520, top: 520, bottom: -520, near: 50, far: 1600 })
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.8
  if (exhibition) {
    renderer.toneMappingExposure = 0.95
    scene.environmentIntensity = 0.65
    sun.intensity = 2.1
    sun.position.set(-700, 430, 350)
    sun.shadow.camera.far = 2200
    sun.shadow.normalBias = 0.45
    sun.shadow.radius = 3
    scene.add(new THREE.HemisphereLight('#e2e8e1', '#464d40', 0.2))
  }
  scene.add(sun)

  return {
    exhibition,
    renderer,
    scene,
    camera,
    controls,
    sun,
    invalidateShadows() { renderer.shadowMap.needsUpdate = true },
    resize(width, height) {
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(1, height)
      camera.fov = exhibition ? (width < 600 ? 32 : 28) : (width < 600 ? 50 : 38)
      camera.updateProjectionMatrix()
    },
    dispose() {
      controls.dispose()
      sky.dispose()
      env.dispose()
      renderer.dispose()
    },
  }
}

/* ------------------------------------------------------------------ */
/*  Procedural textures                                                */
/* ------------------------------------------------------------------ */

export const FACADE_TONES = ['#e7dfcf', '#d8cdb8', '#efe9dd', '#cdbfa6', '#e2d6c2']

/** 4 x 4 window grid: 256 px = 4 floors (12.8 m) tall and about 16 m wide. */
export function facadeTexture(tone: string, rnd: () => number) {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = tone
  g.fillRect(0, 0, 256, 256)
  for (let r = 0; r < 4; r++)
    for (let q = 0; q < 4; q++) {
      const x = q * 64 + 14
      const y = r * 64 + 16
      const lit = rnd() > 0.82
      const grd = g.createLinearGradient(x, y, x + 36, y + 34)
      grd.addColorStop(0, lit ? '#f3dfae' : '#3f5363')
      grd.addColorStop(1, lit ? '#d9bd84' : '#1f2b35')
      g.fillStyle = grd
      g.fillRect(x, y, 36, 34)
      g.fillStyle = 'rgba(0,0,0,0.25)'
      g.fillRect(x - 2, y + 34, 40, 3)
    }
  g.fillStyle = 'rgba(0,0,0,0.12)'
  for (let r = 1; r < 4; r++) g.fillRect(0, r * 64 - 2, 256, 2)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  return t
}

/** Stair-step diagonal cracks, as in masonry. */
export function crackTexture(rnd: () => number) {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const g = c.getContext('2d')!
  g.strokeStyle = 'rgba(30,24,20,0.95)'
  g.lineCap = 'round'
  for (let n = 0; n < 7; n++) {
    let x = 40 + rnd() * 430
    let y = 20 + rnd() * 120
    g.lineWidth = 1.5 + rnd() * 2.5
    g.beginPath()
    g.moveTo(x, y)
    const dir = rnd() > 0.5 ? 1 : -1
    for (let s = 0; s < 22; s++) {
      x += dir * (6 + rnd() * 14)
      y += 8 + rnd() * 16
      g.lineTo(x, y)
      if (rnd() > 0.85) {
        g.moveTo(x, y)
        g.lineTo(x + dir * 18, y + 10)
        g.moveTo(x, y)
      }
    }
    g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/** Dispose every geometry, material and texture under an object. */
export function disposeTree(root: THREE.Object3D) {
  const seen = new Set<unknown>()
  const disposeTexture = (v: unknown) => {
    if (v instanceof THREE.Texture && !seen.has(v)) {
      seen.add(v)
      v.dispose()
    }
  }
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.geometry && !seen.has(mesh.geometry)) {
      seen.add(mesh.geometry)
      mesh.geometry.dispose()
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const m of mats) {
      if (seen.has(m)) continue
      seen.add(m)
      Object.values(m).forEach(disposeTexture)
      if (m instanceof THREE.ShaderMaterial) Object.values(m.uniforms).forEach((u) => disposeTexture(u.value))
      m.dispose()
    }
  })
}
