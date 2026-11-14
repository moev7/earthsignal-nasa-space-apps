import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import * as THREE from 'three';
import { createRadarScene, type RadarRenderer } from '../features/ground-truth/components/story/radar3d/createRadarScene';
import type { RadarScene, RadarSceneLoader, RadarSceneState } from '../features/ground-truth/components/story/radar3d/types';
import { displayPoint, phaseColour, radarSample, radarSite, RADAR_SITES, surfaceColour } from '../lib/radar-interferometry';

test('radar scene, HTML controls and lifecycle obey the shared model without a GPU loop', async () => {
  const css = registerHooks({ load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: 'export {};', shortCircuit: true } : next(url, context); } });
  const window = new Window({ url: 'http://localhost/' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const intersections = new Set<(entries: { isIntersecting: boolean }[]) => void>();
  const resizes = new Set<() => void>();
  let frameRequests = 0;
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: () => { frameRequests++; return frameRequests; }, cancelAnimationFrame: () => {},
    IntersectionObserver: class { constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {} observe() { intersections.add(this.cb); } disconnect() { intersections.delete(this.cb); } },
    ResizeObserver: class { constructor(private cb: () => void) {} observe() { resizes.add(this.cb); } disconnect() { resizes.delete(this.cb); } },
  })) { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
  const { RadarLesson } = await import('../features/ground-truth/components/story/radar3d/RadarLesson');
  const { createRoot } = await import('react-dom/client');
  const host = window.document.createElement('div');
  const disclosure = window.document.createElement('details');
  disclosure.open = true;
  const summary = window.document.createElement('summary'); summary.textContent = 'Radar'; disclosure.append(summary);
  disclosure.append(host); window.document.body.append(disclosure);
  const root = createRoot(host as unknown as HTMLElement);
  let made = 0, released = 0, fail = false, deferred = false;
  let resolveLoad: ((module: Awaited<ReturnType<RadarSceneLoader>>) => void) | undefined;
  let current: RadarSceneState | undefined;
  const views: string[] = [];
  const sceneModule: Awaited<ReturnType<RadarSceneLoader>> = { createRadarScene() {
    if (fail) throw new Error('fixture creation failure');
    made++;
    let disposed = false;
    const adapter: RadarScene = {
      update(state) { assert.equal(disposed, false); current = state; }, resize() {}, view(action) { views.push(action); },
      dispose() { assert.equal(disposed, false, 'dispose exactly once'); disposed = true; released++; },
    };
    return adapter;
  } };
  const loader: RadarSceneLoader = async () => deferred ? new Promise(resolve => { resolveLoad = resolve; }) : sceneModule;
  const render = async (token = 0, story = false) => act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(RadarLesson, { sceneLoader: loader, replayToken: token, story }))); });
  const button = (label: string) => { const found = Array.from(host.querySelectorAll('button')).find(node => node.textContent?.replace(/^\d · /, '') === label); assert.ok(found, label); return found; };
  const click = async (label: string) => act(async () => { button(label).click(); });
  const visibility = async (visible: boolean) => act(async () => { for (const callback of intersections) callback([{ isIntersecting: visible }]); });
  const phaseText = () => host.querySelector('dl')!.textContent!;
  const assertReadings = (state = current!) => {
    const site = radarSite(state.selectedSite ?? 'centre');
    const sample = radarSample(site.xM, site.zM, state.observation === 'before' ? 0 : state.sinkingM);
    const readings = host.querySelectorAll('dl dd');
    assert.equal(readings[0].textContent, `${(sample.downM * 100).toFixed(2)} cm`);
    assert.equal(readings[1].textContent, `+${(sample.deltaRangeM * 100).toFixed(2)} cm`);
    assert.equal(readings[2].textContent, `${sample.cycles.toFixed(2)} cycles`);
    assert.equal(readings[3].textContent, `${(sample.wrappedCycles * 360).toFixed(0)}°`);
    assert.equal(host.querySelector('dl')!.getAttribute('aria-label'), `Unexaggerated ${site.label.toLowerCase()} readings`);
    const rgb = (values: number[]) => `rgb(${values.map(value => Math.round(value * 255)).join(', ')})`;
    assert.equal((readings[3].querySelector('.es-radar-swatch') as unknown as HTMLElement).style.backgroundColor, rgb(phaseColour(sample.cycles)));
    assert.equal((host.querySelector('.es-radar-selected-colour .es-radar-swatch') as unknown as HTMLElement).style.backgroundColor, rgb(surfaceColour(sample, state.colourMode ?? 'phase')));
  };
  try {
    await render();
    assert.equal(made, 0, 'strict mount remains lazy while offscreen');
    assert.match(host.textContent!, /not acquired imagery/);
    await visibility(true);
    assert.equal(made, 1, 'one live context'); assert.equal(current!.sinkingM, 0.18);
    assert.match(phaseText(), /14.74/); assert.match(phaseText(), /1.23/);
    assertReadings();
    await click('Profile view'); assert.equal(button('Profile view').getAttribute('aria-pressed'), 'true');
    const viewsAfterProfile = views.length;
    await click('Sinking depth');
    assert.equal(current!.colourMode, 'depth');
    assert.match(host.querySelector('.es-radar-phase-key')!.textContent!, /continuous, fixed scale.*0 cm15 cm30 cm/);
    for (const { id, label } of RADAR_SITES) {
      await click(label); assert.equal(current!.selectedSite, id); assert.equal(button(label).getAttribute('aria-pressed'), 'true');
      assert.equal(current!.sinkingM, 0.18); assert.equal(current!.observation, 'compare'); assert.equal(current!.colourMode, 'depth');
      assertReadings();
    }
    assert.match(phaseText(), /Local sinking · Stable edge · t₂0.00 cm/);
    assert.match(host.querySelector('.es-radar-discovery')!.textContent!, /edge stays still/);
    await click('Slope');
    await click('Wrapped phase'); assertReadings();
    assert.match(phaseText(), /7.59/); assert.match(phaseText(), /6.22/); assert.match(phaseText(), /0.52/);
    assert.match(host.querySelector('.es-radar-phase-key')!.textContent!, /cyclic.*360° = 0°/);
    await click('Before · t₁'); assertReadings(); assert.equal(current!.selectedSite, 'slope');
    await click('Centre'); assertReadings();
    await click('Compare both'); assertReadings();
    assert.equal(views.length, viewsAfterProfile, 'sample, colour and observation changes preserve camera');
    assert.equal(button('Profile view').getAttribute('aria-pressed'), 'true');
    assert.equal(made, 1, 'new controls use the one renderer');
    await click('Before · t₁'); assert.equal(current!.observation, 'before'); assert.match(phaseText(), /\+0.00/);
    await click('After · t₂'); assert.equal(current!.observation, 'after'); assert.match(phaseText(), /14.74/);
    const slider = host.querySelector('input')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(slider, '30'); slider.dispatchEvent(new window.Event('input', { bubbles: true })); slider.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    assert.equal(current!.sinkingM, 0.3); assert.match(phaseText(), /24.57/);
    await click('Explore in 3D'); assert.equal(current!.interactive, true);
    assert.equal(host.querySelector('canvas')!.style.touchAction, 'none');
    await click('Finish exploring'); assert.equal(host.querySelector('canvas')!.style.touchAction, 'pan-y');
    const priorViews = views.length;
    for (const label of ['Orbit left', 'Orbit right', 'Zoom in', 'Zoom out', 'Top view', 'Reset view']) await click(label);
    assert.deepEqual(views.slice(priorViews), ['left', 'right', 'in', 'out', 'top', 'reset']);
    await click('Slope'); await click('Sinking depth'); await click('Profile view');
    await click('Reset / No sinking'); assert.equal(current!.sinkingM, 0); assert.equal(current!.observation, 'compare');
    assert.equal(current!.selectedSite, 'centre'); assert.equal(current!.colourMode, 'phase'); assert.equal(current!.interactive, false);
    assert.equal(button('Profile view').getAttribute('aria-pressed'), 'false'); assertReadings();
    assert.match(phaseText(), /\+0.00/); assert.match(phaseText(), /0.00/);
    await click('Show 18 cm example');
    await click('Stable edge'); await click('Sinking depth'); await click('Profile view');
    const beforeHidden = host.querySelector('canvas');
    await visibility(false); assert.equal(released, 1); assert.equal(resizes.size, 0);
    await render(1); assert.equal((host.querySelector('input')!).value, '18', 'hidden replay is pending');
    deferred = true;
    await visibility(true);
    assert.notEqual(host.querySelector('canvas'), beforeHidden, 'visibility reentry uses a fresh canvas');
    assert.equal(host.querySelector('canvas')!.style.visibility, 'hidden', 'reentry waits for a fresh scene');
    assert.equal(button('Explore in 3D').disabled, true);
    await act(async () => resolveLoad!(sceneModule)); deferred = false;
    assert.equal(current!.sinkingM, 0, 'visible replay resets model'); assert.equal(made - released, 1);
    assert.equal(current!.selectedSite, 'centre'); assert.equal(current!.colourMode, 'phase');
    assert.equal(button('Profile view').getAttribute('aria-pressed'), 'false'); assertReadings();
    await click('Slope'); await click('Sinking depth'); await click('Profile view');
    await act(async () => { disclosure.open = false; disclosure.dispatchEvent(new window.Event('toggle')); });
    assert.equal(made, released, 'closed parent disclosure releases context');
    await act(async () => { disclosure.open = true; disclosure.dispatchEvent(new window.Event('toggle')); });
    assert.equal(made - released, 1);
    assert.equal(current!.selectedSite, 'slope'); assert.equal(current!.colourMode, 'depth');
    assert.equal(views.at(-1), 'profile', 'visibility reconstruction keeps the selected preset');
    let hidden = false;
    Object.defineProperty(window.document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
    await act(async () => { hidden = true; window.document.dispatchEvent(new window.Event('visibilitychange')); });
    assert.equal(made, released, 'hidden document releases context');
    await act(async () => { hidden = false; window.document.dispatchEvent(new window.Event('visibilitychange')); });
    const canvas = host.querySelector('canvas')!;
    const lost = new window.Event('webglcontextlost', { cancelable: true });
    await act(async () => { canvas.dispatchEvent(lost); });
    assert.equal(lost.defaultPrevented, true); assert.equal(made, released); assert.match(host.textContent!, /connection was lost/);
    await click('Show 18 cm example'); assert.match(phaseText(), /6.22/, 'fallback controls remain live'); assertReadings({ ...current!, sinkingM: 0.18 });
    await act(async () => { canvas.dispatchEvent(new window.Event('webglcontextrestored')); });
    assert.equal(made - released, 1, 'restoration rebuilds once');
    assert.notEqual(host.querySelector('canvas'), canvas, 'restoration uses a fresh canvas');
    await act(async () => { host.querySelector('canvas')!.dispatchEvent(new window.Event('webglcontextlost', { cancelable: true })); });
    fail = true; await click('Try 3D again'); assert.match(host.textContent!, /3D is unavailable/);
    await click('Reset / No sinking'); assert.match(phaseText(), /\+0.00/);
    const failedCanvas = host.querySelector('canvas');
    fail = false; await click('Try 3D again'); assert.equal(made - released, 1);
    assert.notEqual(host.querySelector('canvas'), failedCanvas, 'manual retry uses a fresh canvas');
    const beforeStory = made;
    await render(1, true);
    const technical = host.querySelector('details.es-radar-story-details')!;
    assert.ok(technical);
    assert.equal(technical.hasAttribute('open'), false, 'story keeps formulas and source notes behind a labelled disclosure');
    assert.equal(technical.querySelector('dl'), null, 'selected sample readings stay visible outside disclosure');
    assert.ok(technical.querySelector('.es-radar-sources'));
    assert.match(phaseText(), /0.00 cycles/); assertReadings();
    await click('Show 18 cm example');
    assert.match(phaseText(), /1.23 cycles/); assertReadings();
    await click('Slope'); await click('Sinking depth'); assertReadings();
    assert.equal(host.querySelectorAll('canvas').length, 1);
    assert.equal(made, beforeStory, 'presentation changes do not recreate the scientific renderer');
    await act(async () => root.unmount()); assert.equal(made, released); assert.equal(resizes.size, 0); assert.equal(intersections.size, 0);

    // Exercise the real Three scene, geometries and OrbitControls with only the
    // GPU boundary replaced. Verify colour/shape/ray linkage and disposal.
    const node = window.document.createElement('canvas') as unknown as HTMLCanvasElement;
    let lastScene: THREE.Scene | undefined, lastCamera: THREE.Camera | undefined, draws = 0, disposedRenderer = 0, contextReleases = 0;
    const renderer: RadarRenderer = { setPixelRatio(value) { assert.ok(value <= 2); }, setClearColor() {}, setSize() {}, render(scene, camera) { lastScene = scene as THREE.Scene; lastCamera = camera; draws++; }, dispose() { disposedRenderer++; }, forceContextLoss() { contextReleases++; } };
    const actual = createRadarScene(node, () => renderer);
    actual.resize(800, 420);
    actual.update({ sinkingM: 0.18, observation: 'compare', interactive: false });
    const objects: THREE.Object3D[] = []; lastScene!.traverse(object => objects.push(object));
    const surface = lastScene!.getObjectByName('terrain') as THREE.Mesh;
    assert.ok(surface);
    const index = 40 * 81 + 40;
    const position = surface.geometry.getAttribute('position'), colour = surface.geometry.getAttribute('color');
    assert.ok(Math.abs(position.getY(index) - displayPoint(radarSample(0, 0, 0.18).afterM)[1]) < 1e-6);
    const linearColour = new THREE.Color().setRGB(...phaseColour(radarSample(0, 0, 0.18).cycles), THREE.SRGBColorSpace);
    const expectedColour = [linearColour.r, linearColour.g, linearColour.b];
    [colour.getX(index), colour.getY(index), colour.getZ(index)].forEach((value, i) => assert.ok(Math.abs(value - expectedColour[i]) < 1e-6));
    const rays = ['reference-ray', 'repeat-ray', 'selected-displacement'].map(name => lastScene!.getObjectByName(name) as THREE.Line);
    assert.ok(rays.every(ray => ray instanceof THREE.Line));
    assert.equal(rays[0].geometry.getAttribute('position').getX(0), rays[1].geometry.getAttribute('position').getX(0), 'same satellite x');
    assert.equal(rays[0].geometry.getAttribute('position').getY(0), rays[1].geometry.getAttribute('position').getY(0), 'same satellite altitude');
    assert.ok(rays[1].geometry.getAttribute('position').getY(1) < rays[0].geometry.getAttribute('position').getY(1));
    const vectorNear = (actual: THREE.Vector3, expected: readonly number[]) => expected.forEach((value, i) => assert.ok(Math.abs(actual.getComponent(i) - value) < 1e-6));
    const targets = ['reference-target', 'repeat-target'].map(name => lastScene!.getObjectByName(name)!);
    const profile = lastScene!.getObjectByName('sample-transect') as THREE.Line;
    assert.ok(lastScene!.getObjectByName('reference-outline'));
    actual.view('profile');
    const profileCamera = lastCamera!.position.clone();
    assert.ok(profileCamera.z > 10); assert.ok(profileCamera.y < 3, 'near-level profile preset');
    for (const colourMode of ['phase', 'depth'] as const) for (const observation of ['before', 'after', 'compare'] as const) for (const [siteIndex, site] of RADAR_SITES.entries()) {
      actual.update({ sinkingM: 0.18, observation, interactive: false, selectedSite: site.id, colourMode });
      assert.ok(lastCamera!.position.equals(profileCamera), 'ordinary changes preserve camera');
      const shownSinking = observation === 'before' ? 0 : 0.18;
      const selected = radarSample(site.xM, site.zM, shownSinking);
      vectorNear(targets[0].position, displayPoint(selected.beforeM));
      vectorNear(targets[1].position, displayPoint(selected.afterM));
      vectorNear(new THREE.Vector3().fromBufferAttribute(rays[0].geometry.getAttribute('position'), 1), displayPoint(selected.beforeM));
      vectorNear(new THREE.Vector3().fromBufferAttribute(rays[1].geometry.getAttribute('position'), 1), displayPoint(selected.afterM));
      assert.equal(rays[0].visible, observation !== 'after'); assert.equal(rays[1].visible, observation !== 'before');
      assert.equal(rays[2].visible, observation === 'compare' && selected.downM > 0);
      // Every named pin, terrain vertex and transect point uses the same model,
      // including stable edge and before-mode invariants in both palettes.
      for (const [pinIndex, pinSite] of RADAR_SITES.entries()) {
        const pin = lastScene!.getObjectByName(`sample-${pinSite.id}`)!;
        const sample = radarSample(pinSite.xM, pinSite.zM, shownSinking);
        const expectedPoint = displayPoint(sample.afterM);
        const column = 40 + pinSite.xM / 3;
        const vertex = 40 * 81 + column;
        vectorNear(pin.position, expectedPoint);
        vectorNear(new THREE.Vector3().fromBufferAttribute(position, vertex), expectedPoint);
        vectorNear(new THREE.Vector3().fromBufferAttribute(profile.geometry.getAttribute('position'), column), expectedPoint);
        assert.equal(pin.userData.selected, pinIndex === siteIndex);
        const expected = new THREE.Color().setRGB(...surfaceColour(sample, colourMode), THREE.SRGBColorSpace);
        vectorNear(new THREE.Vector3().fromBufferAttribute(colour, vertex), [expected.r, expected.g, expected.b]);
      }
    }
    actual.update({ sinkingM: 0, observation: 'compare', interactive: true });
    for (let i = 0; i < position.count; i++) { assert.equal(position.getY(i), 0); assert.equal(colour.getX(i), colour.getX(0)); assert.equal(colour.getY(i), colour.getY(0)); assert.equal(colour.getZ(i), colour.getZ(0)); }
    const beforeZoom = lastCamera!.position.length(); actual.view('in'); assert.ok(lastCamera!.position.length() < beforeZoom);
    actual.view('left'); actual.view('top'); actual.view('reset');
    const geometryDisposes = new Map<THREE.BufferGeometry, number>(), materialDisposes = new Map<THREE.Material, number>();
    objects.forEach(object => { const mesh = object as THREE.Mesh;
      if (mesh.geometry && !geometryDisposes.has(mesh.geometry)) { const g = mesh.geometry; geometryDisposes.set(g, 0); g.addEventListener('dispose', () => geometryDisposes.set(g, geometryDisposes.get(g)! + 1)); }
      if (mesh.material) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (!materialDisposes.has(m)) { materialDisposes.set(m, 0); m.addEventListener('dispose', () => materialDisposes.set(m, materialDisposes.get(m)! + 1)); }
    });
    actual.dispose(); actual.dispose();
    assert.equal(disposedRenderer, 1); assert.equal(contextReleases, 1);
    assert.ok([...geometryDisposes.values(), ...materialDisposes.values()].every(count => count === 1));
    // Async initialization cannot publish or allocate after unmount.
    const pendingHost = window.document.createElement('div'); window.document.body.append(pendingHost);
    const pendingRoot = createRoot(pendingHost as unknown as HTMLElement);
    let pendingMade = 0, finishPending: ((module: Awaited<ReturnType<RadarSceneLoader>>) => void) | undefined;
    const pendingLoader: RadarSceneLoader = () => new Promise(resolve => { finishPending = resolve; });
    await act(async () => pendingRoot.render(React.createElement(RadarLesson, { sceneLoader: pendingLoader })));
    await visibility(true);
    await act(async () => pendingRoot.unmount());
    await act(async () => finishPending!({ createRadarScene() { pendingMade++; throw new Error('must not create after unmount'); } }));
    assert.equal(pendingMade, 0); assert.equal(intersections.size, 0);
    const atRest = draws; actual.view('in'); actual.resize(400, 400); actual.update({ sinkingM: 0.3, observation: 'after', interactive: false }); assert.equal(draws, atRest);
    assert.equal(frameRequests, 0, 'no animation frames requested, including interactive camera mode');
  } finally {
    await act(async () => root.unmount()); css.deregister(); await window.happyDOM.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
