import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DIMENSIONS, EARTH_CONTEXT, pulseAt, SIGNAL_GROUND, SIGNAL_START } from './spacecraft-model';
import type { CameraAction, SpacecraftPart, SpacecraftScene, SpacecraftState } from './types';

export type SpacecraftTextureLoader = (url: string, ready: (texture: THREE.Texture) => void) => THREE.Texture;

export type SpacecraftRenderer = Pick<THREE.WebGLRenderer, 'setPixelRatio' | 'setClearColor' | 'setSize' | 'render' | 'dispose' | 'forceContextLoss'>;

/** Procedural teaching geometry, not engineering CAD. All rendering is event
 * driven; the component owns the only, explicitly requested finite clock. */
export function createSpacecraftScene(
  canvas: HTMLCanvasElement,
  rendererFactory: (canvas: HTMLCanvasElement) => SpacecraftRenderer = node => new THREE.WebGLRenderer({ canvas: node, antialias: true, alpha: true, powerPreference: 'low-power' }),
  textureLoader: SpacecraftTextureLoader = (url, ready) => new THREE.TextureLoader().load(url, ready, undefined, () => { /* Ocean-colour sphere remains if the optional texture fails. */ }),
): SpacecraftScene {
  const scene = new THREE.Scene();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  let renderer: SpacecraftRenderer | undefined;
  let controls: OrbitControls | undefined;
  let disposed = false;
  const geometry = <T extends THREE.BufferGeometry>(value: T) => { geometries.add(value); return value; };
  const material = <T extends THREE.Material>(value: T) => { materials.add(value); return value; };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controls?.dispose();
    geometries.forEach(value => value.dispose());
    materials.forEach(value => value.dispose());
    textures.forEach(value => value.dispose());
    renderer?.dispose();
    renderer?.forceContextLoss();
    scene.clear();
  };
  try {
    renderer = rendererFactory(canvas);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x0d171b, 1);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1200);
    controls = new OrbitControls(camera, canvas);
    controls.enabled = false;
    // OrbitControls sets touch-action:none in its constructor, even disabled.
    canvas.style.touchAction = 'pan-y';
    canvas.style.pointerEvents = 'none';
    controls.enableDamping = false;
    controls.autoRotate = false;
    controls.enablePan = false;
    controls.minDistance = 12;
    controls.maxDistance = 150;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = Math.PI * 0.49;
    const render = () => { if (!disposed) renderer!.render(scene, camera); };
    controls.addEventListener('change', render);
    scene.add(new THREE.HemisphereLight(0xd5f4ff, 0x66522c, 2.8));
    const sun = new THREE.DirectionalLight(0xfff0cf, 3.3); sun.position.set(-10, 18, 22); scene.add(sun);
    const groups = Object.fromEntries((['reflector', 'arrays', 'boom', 'instruments'] as const).map(id => {
      const group = new THREE.Group(); group.name = `part-${id}`; scene.add(group); return [id, group];
    })) as Record<SpacecraftPart, THREE.Group>;
    const solid = (colour: number, metalness = 0.25) => material(new THREE.MeshStandardMaterial({ color: colour, metalness, roughness: 0.55, side: THREE.DoubleSide }));
    const stroke = (colour: number, opacity = 1) => material(new THREE.LineBasicMaterial({ color: colour, transparent: opacity < 1, opacity }));
    const line = (parent: THREE.Object3D, points: THREE.Vector3[], colour = 0xc7b991, opacity = 1) => {
      const object = new THREE.Line(geometry(new THREE.BufferGeometry().setFromPoints(points)), stroke(colour, opacity)); parent.add(object); return object;
    };
    const mesh = (parent: THREE.Object3D, shape: THREE.BufferGeometry, surface: THREE.Material, position: [number, number, number] = [0, 0, 0]) => {
      const object = new THREE.Mesh(geometry(shape), surface); object.position.set(...position); parent.add(object); return object;
    };
    const rod = (parent: THREE.Object3D, start: THREE.Vector3, end: THREE.Vector3, radius: number, surface: THREE.Material) => {
      const object = mesh(parent, new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 8), surface);
      object.position.copy(start).add(end).multiplyScalar(0.5);
      object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
      return object;
    };
    const gold = solid(0xc79742, 0.65), darkGold = solid(0x9a702d, 0.6), silver = solid(0xb5c5c5, 0.6);
    const bus = mesh(groups.instruments, new THREE.BoxGeometry(2.5, DIMENSIONS.busPayloadLength, 2.3), gold, [3, 4.3, 0]);
    bus.name = 'bus-and-payload';
    // Gold thermal-blanket seams and a pair of schematic radar feed housings.
    for (const y of [2.2, 3.5, 4.8, 6.2]) {
      line(groups.instruments, [new THREE.Vector3(1.72, y, 1.18), new THREE.Vector3(4.28, y, 1.18)], 0xe6c77c);
    }
    for (const [index, y] of [2.5, 4.3].entries()) {
      const feed = mesh(groups.instruments, new THREE.BoxGeometry(0.8, 1, 1.4), silver, [1.45, y, 0.6]);
      feed.name = index === 0 ? 'L-band-housing-schematic' : 'S-band-housing-schematic';
    }
    mesh(groups.instruments, new THREE.BoxGeometry(2.7, 0.22, 2.5), darkGold, [3, 7.15, 0]);

    // Two blue wings with explicit cell rows. Minor dimensions and hinges are
    // deliberately simplified, rather than claimed as exact construction.
    const blue = solid(0x143655, 0.45);
    for (const side of [-1, 1]) {
      const wing = new THREE.Group(); wing.name = `solar-wing-${side < 0 ? 'a' : 'b'}`;
      wing.position.set(3, 5.4, side * (1.6 + DIMENSIONS.arrayLength / 2)); groups.arrays.add(wing);
      mesh(wing, new THREE.BoxGeometry(3.1, 0.12, DIMENSIONS.arrayLength), blue);
      rod(groups.arrays, new THREE.Vector3(3, 5.4, side * 1.05), new THREE.Vector3(3, 5.4, side * 1.8), 0.12, silver);
      const half = DIMENSIONS.arrayLength / 2;
      for (let row = 0; row <= 14; row++) {
        const z = -half + row * DIMENSIONS.arrayLength / 14;
        line(wing, [new THREE.Vector3(-1.55, 0.075, z), new THREE.Vector3(1.55, 0.075, z)], 0x7094ac, 0.7);
      }
      for (let column = 0; column <= 6; column++) {
        const x = -1.55 + column * 3.1 / 6;
        line(wing, [new THREE.Vector3(x, 0.075, -half), new THREE.Vector3(x, 0.075, half)], 0x7094ac, 0.7);
      }
    }
    const boomStart = new THREE.Vector3(2.8, 3.3, -0.6);
    const boomEnd = boomStart.clone().add(new THREE.Vector3(-8.8, -1.8, 0).normalize().multiplyScalar(DIMENSIONS.boomLength));
    const boomRod = rod(groups.boom, boomStart, boomEnd, 0.16, silver); boomRod.name = 'reflector-boom';
    const boomVector = boomEnd.clone().sub(boomStart);
    for (let index = 0; index < 6; index++) {
      const a = boomStart.clone().addScaledVector(boomVector, index / 6), b = boomStart.clone().addScaledVector(boomVector, (index + 1) / 6);
      line(groups.boom, [a.clone().add(new THREE.Vector3(0, 0.22, 0.22)), b.clone().add(new THREE.Vector3(0, -0.22, -0.22))], 0xa9b9b8);
    }
    const dish = groups.reflector; dish.position.set(-6, 1.5, 0); dish.rotation.set(-0.16, 0.16, -0.12);
    const radius = DIMENSIONS.reflectorDiameter / 2;
    const dishPoint = (r: number, angle: number) => new THREE.Vector3(r * Math.cos(angle), r * Math.sin(angle), 0.7 * (r / radius) ** 2);
    // Fine circumferential mesh, radial ribs and a thicker deployable rim.
    for (let ring = 1; ring <= 20; ring++) {
      const r = radius * ring / 20;
      line(dish, Array.from({ length: 97 }, (_, i) => dishPoint(r, i / 96 * Math.PI * 2)), ring === 20 ? 0xe3d5a1 : 0x9a977c, ring === 20 ? 1 : 0.42);
    }
    for (let rib = 0; rib < 48; rib++) {
      line(dish, Array.from({ length: 13 }, (_, i) => dishPoint(radius * i / 12, rib / 48 * Math.PI * 2)), rib % 4 === 0 ? 0xdfcf9b : 0xa09a7d, rib % 4 === 0 ? 1 : 0.45);
    }
    const rim = mesh(dish, new THREE.TorusGeometry(radius, 0.075, 6, 96), darkGold, [0, 0, 0.7]); rim.name = 'reflector-rim';
    mesh(dish, new THREE.SphereGeometry(0.22, 12, 8), gold);
    for (const angle of [0, 2 * Math.PI / 3, 4 * Math.PI / 3]) {
      line(dish, [dishPoint(radius, angle), new THREE.Vector3(0, 0, 1.8)], 0xb8b6a1);
    }

    // A distant, smaller horizon gives the enlarged instrument a clear place
    // in space, without implying a shared physical scale or a live orbit.
    const earthSurface = material(new THREE.MeshStandardMaterial({ color: 0x245778, roughness: 1, metalness: 0 }));
    const earth = mesh(scene, new THREE.SphereGeometry(EARTH_CONTEXT.radius, 48, 32), earthSurface, [...EARTH_CONTEXT.center]);
    earth.name = 'earth-context-globe'; earth.rotation.y = 0.7;
    const earthTexture = textureLoader('/images/story/earth.webp', texture => {
      if (disposed) return;
      texture.colorSpace = THREE.SRGBColorSpace;
      earthSurface.map = texture; earthSurface.color.setHex(0xffffff); earthSurface.needsUpdate = true; render();
    });
    textures.add(earthTexture);
    const target = mesh(scene, new THREE.CircleGeometry(3, 32), material(new THREE.MeshBasicMaterial({ color: 0x8bcec0, side: THREE.DoubleSide, transparent: true, opacity: 0.3, depthTest: false })), [...SIGNAL_GROUND]);
    const groundNormal = new THREE.Vector3(...SIGNAL_GROUND).sub(new THREE.Vector3(...EARTH_CONTEXT.center)).normalize();
    target.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), groundNormal);
    target.name = 'schematic-signal-target'; target.visible = false; target.renderOrder = 2;

    const start = new THREE.Vector3(...SIGNAL_START), ground = new THREE.Vector3(...SIGNAL_GROUND);
    const outbound = line(scene, [start, start], 0xffc272); outbound.name = 'pulse-outbound';
    const returning = line(scene, [ground, ground], 0x8bcec0); returning.name = 'pulse-return';
    const echo = mesh(scene, new THREE.RingGeometry(0.8, 0.9, 48), material(new THREE.MeshBasicMaterial({ color: 0x8bcec0, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.85 })), [...SIGNAL_GROUND]);
    echo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), groundNormal); echo.name = 'pulse-ground-echo';
    const packet = mesh(scene, new THREE.SphereGeometry(0.18, 12, 8), material(new THREE.MeshBasicMaterial({ color: 0xffe6ad, depthTest: false }))); packet.name = 'pulse-packet';
    [outbound, returning, echo, packet].forEach(object => { object.visible = false; object.renderOrder = 3; object.frustumCulled = false; });
    const endpoint = (object: THREE.Line, a: THREE.Vector3, b: THREE.Vector3) => {
      const points = object.geometry.getAttribute('position'); points.setXYZ(0, a.x, a.y, a.z); points.setXYZ(1, b.x, b.y, b.z); points.needsUpdate = true;
    };
    const pulse = (progress: number | null) => {
      if (disposed) return;
      const sample = pulseAt(progress);
      target.visible = progress !== null;
      outbound.visible = progress !== null;
      returning.visible = sample.phase === 'receive';
      echo.visible = sample.phase === 'echo' || sample.phase === 'receive';
      packet.visible = progress !== null;
      endpoint(outbound, start, start.clone().lerp(ground, sample.outbound));
      endpoint(returning, ground, ground.clone().lerp(start, sample.returning));
      echo.scale.setScalar(0.5 + sample.echo * 1.5);
      packet.position.copy(start).lerp(ground, sample.marker);
      scene.userData.pulsePhase = sample.phase;
      render();
    };
    // Cache base colours for reversible selected-part emphasis on the real meshes.
    Object.values(groups).forEach(group => {
      const copies = new Map<THREE.Material, THREE.Material>();
      group.traverse(object => {
        const drawable = object as THREE.Mesh;
        const original = drawable.material as THREE.MeshStandardMaterial | THREE.LineBasicMaterial | undefined;
        if (!original?.color) return;
        if (!copies.has(original)) copies.set(original, material(original.clone()));
        const surface = copies.get(original)! as THREE.MeshStandardMaterial | THREE.LineBasicMaterial;
        drawable.material = surface;
        surface.userData.baseColour = surface.color.getHex();
      });
    });
    let preset: 'overview' | SpacecraftPart = 'overview';
    let custom = false;
    const targets: Record<'overview' | SpacecraftPart, THREE.Vector3> = { overview: new THREE.Vector3(-2, -12, 0), reflector: new THREE.Vector3(-6, 1.5, 0), arrays: new THREE.Vector3(3, 5.4, 0), boom: boomStart.clone().lerp(boomEnd, 0.5), instruments: new THREE.Vector3(3, 4.3, 0) };
    const frame = () => {
      controls!.target.copy(targets[preset]);
      const span = preset === 'overview' ? 60 : preset === 'reflector' ? 16 : preset === 'arrays' ? 19 : 13;
      const vertical = THREE.MathUtils.degToRad(camera.fov);
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
      const distance = Math.min(150, span / (2 * Math.tan(Math.min(vertical, horizontal) / 2)));
      camera.position.copy(controls!.target).add(new THREE.Vector3(0.95, 0.58, 1).normalize().multiplyScalar(distance));
      controls!.update(); render();
    };
    controls.addEventListener('start', () => { custom = true; });
    frame(); pulse(null);
    return {
      update({ selectedPart, interactive, pulse: progress }: SpacecraftState) {
        if (disposed) return;
        controls!.enabled = interactive;
        canvas.style.touchAction = interactive ? 'none' : 'pan-y';
        canvas.style.pointerEvents = interactive ? 'auto' : 'none';
        for (const [id, group] of Object.entries(groups)) {
          const selected = id === selectedPart; group.userData.selected = selected;
          group.traverse(object => {
            const surface = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.LineBasicMaterial | undefined;
            if (!surface?.color) return;
            surface.color.setHex(surface.userData.baseColour);
            if (selected) surface.color.lerp(new THREE.Color(0xc6fff1), 0.42);
            if ('emissive' in surface) { surface.emissive.setHex(selected ? 0x28584e : 0); surface.emissiveIntensity = selected ? 0.4 : 0; }
          });
        }
        pulse(progress);
      },
      pulse,
      resize(width, height) {
        if (disposed || width <= 0 || height <= 0) return;
        renderer!.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
        if (!custom) frame(); else render();
      },
      view(action: CameraAction) {
        if (disposed) return;
        if (action === 'overview' || action in groups) { preset = action as typeof preset; custom = false; frame(); return; }
        custom = true;
        const offset = camera.position.clone().sub(controls!.target);
        if (action === 'left' || action === 'right') offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), action === 'left' ? -Math.PI / 8 : Math.PI / 8);
        else offset.multiplyScalar(action === 'in' ? 0.8 : 1.25).clampLength(12, 150);
        camera.position.copy(controls!.target).add(offset); controls!.update(); render();
      },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
