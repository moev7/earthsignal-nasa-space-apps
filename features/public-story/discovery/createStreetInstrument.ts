import * as T from "three";

/** Two authored ground pads, not a structural or geotechnical model. */
export function buildStreetInstrument() {
  const root = new T.Group(),
    left = new T.Group(),
    right = new T.Group();
  const resources = new Set<T.BufferGeometry | T.Material>();
  const material = (colour: number, metalness = 0) => {
    const m = new T.MeshStandardMaterial({
      color: colour,
      roughness: 0.72,
      metalness,
    });
    resources.add(m);
    return m;
  };
  const road = material(0x394747),
    earth = material(0x88775b),
    clay = material(0x716a69),
    water = material(0x286b77),
    building = material(0xd9d2b9),
    roof = material(0x61716b),
    glow = material(0x8bcec0),
    amber = material(0xe7b66e),
    dark = material(0x152323);
  const box = (
    group: T.Group,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    m: T.Material,
  ) => {
    const geometry = new T.BoxGeometry(w, h, d);
    resources.add(geometry);
    const mesh = new T.Mesh(geometry, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  for (const [i, pad] of [left, right].entries()) {
    pad.position.x = i === 0 ? -4.2 : 4.2;
    box(pad, 0, -1.9, 0, 7.6, 1.1, 7, water);
    box(pad, 0, -1.08, 0, 7.6, 0.55, 7, clay);
    box(pad, 0, -0.48, 0, 7.6, 0.65, 7, earth);
    box(pad, 0, 0, 0, 7.65, 0.22, 2.2, road);
    for (let j = 0; j < 4; j++)
      box(pad, -3 + j * 1.7, 0.13, 0, 0.8, 0.03, 0.07, building);
    for (let j = 0; j < 3; j++) {
      const x = -2.6 + j * 2.4,
        h = 1.4 + (j % 2) * 1.5;
      box(pad, x, h / 2, 2.3, 1.6, h, 1.45, building);
      box(pad, x, h + 0.08, 2.3, 1.7, 0.18, 1.55, roof);
      for (let k = 0; k < Math.floor(h / 0.55); k++)
        box(pad, x, 0.4 + k * 0.55, 1.56, 0.9, 0.22, 0.025, dark);
      box(pad, x, 0.25, -2.1, 1.8, 0.48, 1.2, roof);
      box(pad, x, 0.55, -2.1, 1.9, 0.13, 1.3, glow);
    }
    // Inspection post stays attached to the moving ground.
    box(pad, 0, 0.6, -3, 0.09, 1.2, 0.09, glow);
    box(pad, 0, 1.25, -3, 0.65, 0.2, 0.3, glow);
    root.add(pad);
  }
  const link = box(root, 0, 0, 0, 1, 0.18, 2.2, road),
    pipe = box(root, 0, -0.48, -2.8, 1, 0.12, 0.12, amber);
  // Fixed reference posts make equal and unequal motion legible without colour.
  for (const x of [-8.4, 8.4]) box(root, x, -1.3, -3, 0.06, 4.4, 0.06, glow);
  box(root, 0, 0.55, -3, 16.8, 0.025, 0.025, glow);
  const update = (a: number, b: number) => {
    const aa = Number.isFinite(a) ? Math.max(0, Math.min(30, a)) : 0,
      bb = Number.isFinite(b) ? Math.max(0, Math.min(30, b)) : 0;
    const y1 = -aa * 0.07,
      y2 = -bb * 0.07;
    left.position.y = y1;
    right.position.y = y2;
    const dx = 2,
      dy = y2 - y1;
    for (const [object, offset] of [
      [link, 0],
      [pipe, -0.48],
    ] as const) {
      object.position.y = (y1 + y2) / 2 + offset;
      object.scale.x = Math.hypot(dx, dy);
      object.rotation.z = Math.atan2(dy, dx);
    }
    return { left: y1, right: y2, difference: Math.abs(aa - bb) };
  };
  return {
    root,
    left,
    right,
    link,
    pipe,
    update,
    dispose: () => {
      resources.forEach((r) => r.dispose());
      root.clear();
    },
  };
}

export function createStreetInstrument(canvas: HTMLCanvasElement) {
  const renderer = new T.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setClearColor(0x121617, 0);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  const scene = new T.Scene(),
    model = buildStreetInstrument();
  scene.add(model.root);
  scene.add(new T.HemisphereLight(0xd8f5ec, 0x54422f, 2.3));
  const light = new T.DirectionalLight(0xffead1, 3.3);
  light.position.set(-5, 15, 8);
  scene.add(light);
  const fill = new T.DirectionalLight(0x7bc6d8, 1.2);
  fill.position.set(5, 5, -8);
  scene.add(fill);
  const camera = new T.OrthographicCamera(-12, 12, 8, -8, 0.1, 150);
  camera.position.set(17, 15, 20);
  camera.lookAt(0, -0.5, 0);
  const render = () => renderer.render(scene, camera);
  return {
    update: (a: number, b: number) => {
      model.update(a, b);
      render();
    },
    resize: (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      const aspect = width / height,
        span = 20;
      camera.left = -span / 2;
      camera.right = span / 2;
      camera.top = span / (2 * aspect);
      camera.bottom = -span / (2 * aspect);
      camera.updateProjectionMatrix();
      render();
    },
    view: (top: boolean) => {
      camera.position.set(top ? 0 : 17, top ? 27 : 15, top ? 0.01 : 20);
      camera.lookAt(0, -0.5, 0);
      render();
    },
    dispose: () => {
      model.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      scene.clear();
    },
  };
}
