import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  displayPoint,
  surfaceColour,
  radarSample,
  radarSite,
  RADAR_SITES,
  RADAR,
  TOWARD_RADAR,
} from "@/lib/radar-interferometry";
import type {
  CameraAction,
  CameraPreset,
  RadarScene,
  RadarSceneState,
} from "./types";

export type RadarRenderer = Pick<
  THREE.WebGLRenderer,
  | "setPixelRatio"
  | "setClearColor"
  | "render"
  | "setSize"
  | "dispose"
  | "forceContextLoss"
>;

/** One event-driven renderer. No clock, animation frame or damping loop. */
export function createRadarScene(
  canvas: HTMLCanvasElement,
  rendererFactory: (canvas: HTMLCanvasElement) => RadarRenderer = (node) =>
    new THREE.WebGLRenderer({
      canvas: node,
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    }),
): RadarScene {
  const scene = new THREE.Scene();
  let renderer: RadarRenderer | undefined;
  let controls: OrbitControls | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controls?.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material)
        (Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material]
        ).forEach((material) => materials.add(material));
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    renderer?.dispose();
    renderer?.forceContextLoss();
    scene.clear();
  };
  try {
    renderer = rendererFactory(canvas);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x121617, 0);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
    controls = new OrbitControls(camera, canvas);
    controls.enabled = false;
    controls.enableDamping = false;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.rotateSpeed = 0.7;
    controls.zoomSpeed = 0.8;
    canvas.style.touchAction = "pan-y";
    canvas.style.pointerEvents = "none";
    controls.minDistance = 9;
    controls.maxDistance = 60;
    controls.minPolarAngle = 0.08;
    controls.maxPolarAngle = Math.PI * 0.49;
    const pinLabels: THREE.Line[] = [];
    const render = () => {
      if (disposed) return;
      pinLabels.forEach((label) => label.quaternion.copy(camera.quaternion));
      renderer!.render(scene, camera);
    };
    controls.addEventListener("change", render);

    // 80 cells across a 240 m square. Colours use the unexaggerated model.
    const count = 81;
    const positions = new Float32Array(count * count * 3);
    const colours = new Float32Array(positions.length);
    const indices: number[] = [];
    const vertexColour = new THREE.Color();
    for (let row = 0; row < count - 1; row++)
      for (let col = 0; col < count - 1; col++) {
        const a = row * count + col,
          b = a + 1,
          c = a + count,
          d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    geometry.setIndex(indices);
    const surface = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    surface.name = "terrain";
    scene.add(surface);

    const reference = new THREE.GridHelper(8, 16, 0xe6ede9, 0x99aaa4);
    reference.position.y = 0.025;
    for (const material of Array.isArray(reference.material)
      ? reference.material
      : [reference.material]) {
      material.transparent = true;
      material.opacity = 0.28;
      material.depthWrite = false;
    }
    scene.add(reference);
    const outline = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        [
          [-4, 0.025, -4],
          [4, 0.025, -4],
          [4, 0.025, 4],
          [-4, 0.025, 4],
          [-4, 0.025, -4],
        ].map((point) => new THREE.Vector3(...point)),
      ),
      new THREE.LineBasicMaterial({ color: 0x99aaa4 }),
    );
    outline.name = "reference-outline";
    scene.add(outline);
    const profilePositions = new Float32Array(count * 3);
    const profile = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0xf1eee7,
        depthTest: false,
        transparent: true,
        opacity: 0.65,
      }),
    );
    profile.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(profilePositions, 3),
    );
    profile.name = "sample-transect";
    profile.frustumCulled = false;
    profile.renderOrder = 1;
    scene.add(profile);
    // Three numbered pins sit on the exact sampled surface points. Their stems
    // and digit strokes are geometry, so no label textures or extra contexts.
    const digits = [
      [
        [0, 0],
        [0, 0.2],
      ],
      [
        [-0.07, 0.2],
        [0.07, 0.2],
        [0.07, 0.1],
        [-0.07, 0.1],
        [-0.07, 0],
        [0.07, 0],
      ],
      [
        [-0.07, 0.2],
        [0.07, 0.2],
        [0.07, 0.1],
        [-0.04, 0.1],
        [0.07, 0.1],
        [0.07, 0],
        [-0.07, 0],
      ],
    ];
    const pinRing = new THREE.RingGeometry(0.15, 0.21, 20);
    const pins = RADAR_SITES.map((site, index) => {
      const pin = new THREE.Group();
      pin.name = `sample-${site.id}`;
      const material = new THREE.LineBasicMaterial({
        color: 0xf1eee7,
        depthTest: false,
        toneMapped: false,
      });
      const stem = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0.025, 0),
          new THREE.Vector3(0, 0.5, 0),
        ]),
        material,
      );
      const digit = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(
          digits[index].map(([x, y]) => new THREE.Vector3(x * 2, y * 2, 0)),
        ),
        material,
      );
      digit.position.y = 0.6;
      pinLabels.push(digit);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xf1eee7,
        side: THREE.DoubleSide,
        depthTest: false,
        toneMapped: false,
      });
      const ring = new THREE.Mesh(pinRing, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      stem.renderOrder = digit.renderOrder = ring.renderOrder = 4;
      pin.add(stem, digit, ring);
      scene.add(pin);
      return { pin, material, ringMaterial, ring, site };
    });

    const satPosition = new THREE.Vector3(...TOWARD_RADAR).multiplyScalar(8.4);
    const satellite = new THREE.Group();
    satellite.position.copy(satPosition);
    satellite.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.4, 0.5),
        new THREE.MeshBasicMaterial({ color: 0xf1eee7 }),
      ),
    );
    const panelGeometry = new THREE.BoxGeometry(0.85, 0.07, 0.52);
    const panelMaterial = new THREE.MeshBasicMaterial({
      color: 0x8bcec0,
      wireframe: true,
    });
    for (const x of [-0.75, 0.75]) {
      const panel = new THREE.Mesh(panelGeometry, panelMaterial);
      panel.position.x = x;
      satellite.add(panel);
    }
    const antenna = new THREE.Mesh(
      new THREE.ConeGeometry(0.27, 0.3, 12),
      new THREE.MeshBasicMaterial({ color: 0xf0a15c, wireframe: true }),
    );
    antenna.rotation.z = Math.PI;
    antenna.position.y = -0.34;
    satellite.add(antenna);
    scene.add(satellite);
    const ray = (material: THREE.LineBasicMaterial) => {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          satPosition,
          new THREE.Vector3(),
        ]),
        material,
      );
      line.frustumCulled = false;
      scene.add(line);
      return line;
    };
    const beforeRay = ray(
      new THREE.LineDashedMaterial({
        color: 0x8bcec0,
        dashSize: 0.18,
        gapSize: 0.12,
        depthTest: false,
      }),
    );
    const afterRay = ray(
      new THREE.LineBasicMaterial({ color: 0xffc272, depthTest: false }),
    );
    beforeRay.name = "reference-ray";
    afterRay.name = "repeat-ray";
    afterRay.renderOrder = 2;
    beforeRay.renderOrder = 3;
    const targetGeometry = new THREE.SphereGeometry(0.075, 12, 8);
    const beforeTarget = new THREE.Mesh(
      targetGeometry,
      new THREE.MeshBasicMaterial({ color: 0x8bcec0, depthTest: false }),
    );
    const afterTarget = new THREE.Mesh(
      targetGeometry,
      new THREE.MeshBasicMaterial({ color: 0xffc272, depthTest: false }),
    );
    beforeTarget.renderOrder = afterTarget.renderOrder = 4;
    beforeTarget.name = "reference-target";
    afterTarget.name = "repeat-target";
    scene.add(beforeTarget, afterTarget);
    const movement = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3(),
      ]),
      new THREE.LineDashedMaterial({
        color: 0xf1eee7,
        dashSize: 0.07,
        gapSize: 0.05,
        depthTest: false,
      }),
    );
    movement.frustumCulled = false;
    movement.name = "selected-displacement";
    scene.add(movement);
    const setEnd = (
      line: THREE.Line,
      point: THREE.Vector3,
      start = satPosition,
    ) => {
      const attribute = line.geometry.getAttribute("position");
      attribute.setXYZ(0, start.x, start.y, start.z);
      attribute.setXYZ(1, point.x, point.y, point.z);
      attribute.needsUpdate = true;
      line.computeLineDistances();
    };
    const signalDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffc272, depthTest: false }),
    );
    const signalRing = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.24, 40),
      new THREE.MeshBasicMaterial({
        color: 0x8bcec0,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    signalRing.rotation.x = -Math.PI / 2;
    signalDot.name = "illustrated-signal";
    signalRing.name = "illustrated-return";
    signalDot.visible = signalRing.visible = false;
    scene.add(signalDot, signalRing);
    const signalTarget = new THREE.Vector3();
    let activePreset: CameraPreset = "reset";
    const preset = (mode: CameraPreset = "reset") => {
      activePreset = mode;
      controls!.target.set(-0.5, 2.0, 0);
      const distance = 20 / Math.min(1.25, camera.aspect);
      // A near-level look along the transect gives a profile in this same scene.
      const direction =
        mode === "top"
          ? new THREE.Vector3(0, 1, 0.001)
          : mode === "profile"
            ? new THREE.Vector3(0, 0.04, 1)
            : new THREE.Vector3(10, 8, 12);
      camera.position
        .copy(controls!.target)
        .add(direction.normalize().multiplyScalar(distance));
      controls!.update();
      render();
    };
    preset();
    let hasSized = false;
    return {
      update({
        sinkingM,
        observation,
        interactive,
        selectedSite = "centre",
        colourMode = "phase",
        probeXM,
      }: RadarSceneState) {
        if (disposed) return;
        controls!.enabled = interactive;
        canvas.style.touchAction = interactive ? "none" : "pan-y";
        canvas.style.pointerEvents = interactive ? "auto" : "none";
        const shownSinking = observation === "before" ? 0 : sinkingM;
        for (let row = 0; row < count; row++)
          for (let col = 0; col < count; col++) {
            const x = ((col / (count - 1)) * 2 - 1) * RADAR.radiusM;
            const z = ((row / (count - 1)) * 2 - 1) * RADAR.radiusM;
            const sample = radarSample(x, z, shownSinking);
            const index = (row * count + col) * 3;
            positions.set(displayPoint(sample.afterM), index);
            vertexColour.setRGB(
              ...surfaceColour(sample, colourMode),
              THREE.SRGBColorSpace,
            );
            colours.set(
              [vertexColour.r, vertexColour.g, vertexColour.b],
              index,
            );
            if (row === (count - 1) / 2)
              profilePositions.set(displayPoint(sample.afterM), col * 3);
          }
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.color.needsUpdate = true;
        geometry.computeBoundingSphere();
        profile.geometry.attributes.position.needsUpdate = true;
        profile.geometry.computeBoundingSphere();
        for (const { pin, material, ringMaterial, ring, site } of pins) {
          pin.position.set(
            ...displayPoint(radarSample(site.xM, site.zM, shownSinking).afterM),
          );
          const selected = selectedSite === site.id;
          material.color.setHex(selected ? 0xffc272 : 0xf1eee7);
          ringMaterial.color.copy(material.color);
          ring.scale.setScalar(selected ? 1.4 : 1);
          pin.userData.selected = selected;
        }
        reference.visible = observation !== "after";
        beforeRay.visible = beforeTarget.visible = observation !== "after";
        afterRay.visible = afterTarget.visible = observation !== "before";
        const site =
          probeXM !== undefined && Number.isFinite(probeXM)
            ? { xM: Math.max(0, Math.min(120, probeXM)), zM: 0 }
            : radarSite(selectedSite);
        const sample = radarSample(site.xM, site.zM, shownSinking);
        movement.visible = observation === "compare" && sample.downM > 0;
        const start = new THREE.Vector3(...displayPoint(sample.beforeM));
        const end = new THREE.Vector3(...displayPoint(sample.afterM));
        beforeTarget.position.copy(start);
        afterTarget.position.copy(end);
        signalTarget.copy(end);
        setEnd(beforeRay, start);
        setEnd(afterRay, end);
        setEnd(movement, end, start);
        render();
      },
      signal(progress) {
        if (disposed) return;
        signalDot.visible = signalRing.visible =
          progress !== null && progress < 1;
        if (progress !== null) {
          const t = Math.max(0, Math.min(1, progress));
          signalDot.position
            .copy(satPosition)
            .lerp(signalTarget, t < 0.5 ? t * 2 : (1 - t) * 2);
          signalRing.position.copy(signalTarget);
          signalRing.position.y += 0.03;
          signalRing.scale.setScalar(1 + t * 14);
          (signalRing.material as THREE.MeshBasicMaterial).opacity =
            0.7 * (1 - t);
        }
        render();
      },
      resize(width, height) {
        if (disposed || width <= 0 || height <= 0) return;
        renderer!.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        if (!hasSized) {
          hasSized = true;
          preset(activePreset);
        } else render();
      },
      view(action: CameraAction) {
        if (disposed) return;
        if (action === "reset" || action === "top" || action === "profile") {
          preset(action);
          return;
        }
        const offset = camera.position.clone().sub(controls!.target);
        if (action === "left" || action === "right")
          offset.applyAxisAngle(
            new THREE.Vector3(0, 1, 0),
            action === "left" ? -Math.PI / 8 : Math.PI / 8,
          );
        else
          offset
            .multiplyScalar(action === "in" ? 0.8 : 1.25)
            .clampLength(9, 60);
        camera.position.copy(controls!.target).add(offset);
        controls!.update();
        render();
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
