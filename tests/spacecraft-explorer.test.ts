import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import * as THREE from 'three';
import { createSpacecraftScene, type SpacecraftRenderer } from '../features/public-story/spacecraft/createSpacecraftScene';
import { DIMENSIONS, EARTH_CONTEXT, MANUAL_PULSE, PARTS, PULSE_DURATION_MS, PULSE_TEXT, pulseAt, SIGNAL_GROUND, SIGNAL_START } from '../features/public-story/spacecraft/spacecraft-model';
import type { SpacecraftScene, SpacecraftSceneLoader, SpacecraftState } from '../features/public-story/spacecraft/types';

// The callback archive deliberately permits delivery AFTER cancelAnimationFrame.
// Cancellation must survive a browser having already queued a frame for dispatch.
test('actual explorer: hardware, finite clock, still steps and adversarial lifecycle', async () => {
  const css = registerHooks({ load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: 'export {};', shortCircuit: true } : next(url, context); } });
  const window = new Window({ url: 'http://localhost/' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const intersections = new Set<(entries: { isIntersecting: boolean }[]) => void>();
  const resizes = new Set<() => void>();
  const motions = new Set<() => void>();
  let reduced = false, hidden = false, requests = 0;
  const pending = new Map<number, FrameRequestCallback>(), archive = new Map<number, FrameRequestCallback>();
  const mq = { get matches() { return reduced; }, addEventListener: (_: string, cb: () => void) => motions.add(cb), removeEventListener: (_: string, cb: () => void) => motions.delete(cb) };
  Object.defineProperty(window, 'matchMedia', { value: () => mq });
  Object.defineProperty(window.document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (callback: FrameRequestCallback) => { const key = ++requests; pending.set(key, callback); archive.set(key, callback); return key; },
    cancelAnimationFrame: (key: number) => pending.delete(key),
    IntersectionObserver: class { constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {} observe() { intersections.add(this.cb); } disconnect() { intersections.delete(this.cb); } },
    ResizeObserver: class { constructor(private cb: () => void) {} observe() { resizes.add(this.cb); } disconnect() { resizes.delete(this.cb); } },
  })) { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
  const { default: NisarExplorer } = await import('../features/public-story/spacecraft/NisarExplorer');
  const { StoryProvider, useStory } = await import('../features/ground-truth/components/story/StoryProvider');
  const { createRoot } = await import('react-dom/client');
  function Playback() {
    const story = useStory();
    return React.createElement('div', null, React.createElement('button', { onClick: story.togglePaused }, 'Global pause'), React.createElement('button', { onClick: story.replay }, 'Global replay'));
  }
  const host = window.document.createElement('div'), disclosure = window.document.createElement('details');
  disclosure.open = true; const summary = window.document.createElement('summary'); summary.textContent = 'Spacecraft'; disclosure.append(summary, host); window.document.body.append(disclosure);
  const root = createRoot(host as unknown as HTMLElement);
  let made = 0, disposed = 0, fail = false, deferred = false, loseOnDraw = false, loseOnInitialView = false;
  let current: SpacecraftState | undefined;
  const pulses: (number | null)[] = [], views: string[] = [];
  const deferredLoads: ((module: Awaited<ReturnType<SpacecraftSceneLoader>>) => void)[] = [];
  const sceneModule: Awaited<ReturnType<SpacecraftSceneLoader>> = { createSpacecraftScene() {
    if (fail) throw new Error('GPU unavailable fixture');
    made++;
    let dead = false;
    const adapter: SpacecraftScene = {
      update(state) { assert.equal(dead, false); current = { ...state }; },
      pulse(value) { assert.equal(dead, false); pulses.push(value); if (current) current.pulse = value; if (loseOnDraw) { loseOnDraw = false; host.querySelector('canvas')!.dispatchEvent(new window.Event('webglcontextlost', { cancelable: true })); } },
      view(action) { assert.equal(dead, false); views.push(action); if (loseOnInitialView) { loseOnInitialView = false; host.querySelector('canvas')!.dispatchEvent(new window.Event('webglcontextlost', { cancelable: true })); } }, resize() { assert.equal(dead, false); },
      dispose() { assert.equal(dead, false, 'exactly-once disposal'); dead = true; disposed++; },
    };
    return adapter;
  } };
  const loader: SpacecraftSceneLoader = () => deferred ? new Promise(resolve => deferredLoads.push(resolve)) : Promise.resolve(sceneModule);
  const fallback = React.createElement('figure', { 'data-artist-concept': true }, React.createElement('p', null, 'Original NASA/JPL-Caltech artist’s concept'), React.createElement('a', { href: 'https://science.nasa.gov/photojournal/nisar-in-orbit-over-northeastern-india-artists-concept/' }, 'Original source'), React.createElement('a', { href: 'https://www.nasa.gov/nasa-brand-center/images-and-media/' }, 'NASA Media Usage Guidelines'));
  const render = () => act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(StoryProvider, null, React.createElement(Playback), React.createElement(NisarExplorer, { sceneLoader: loader, fallback })))));
  const button = (label: string) => { const found = Array.from(host.querySelectorAll('button')).find(node => node.textContent === label); assert.ok(found, label); return found; };
  const click = async (label: string) => {
    if (PARTS.some(part => part.label === label)) await act(async () => button('Inspect hardware').click());
    await act(async () => button(label).click());
  };
  const visibility = (visible: boolean) => act(async () => { for (const callback of intersections) callback([{ isIntersecting: visible }]); });
  const frame = async (time: number, key = [...pending.keys()][0]) => { assert.ok(key, 'scheduled frame'); const callback = archive.get(key)!; pending.delete(key); await act(async () => callback(time)); };
  const readout = () => host.querySelector('.es-spacecraft-readout')!;
  const assertPhase = (progress: number | null) => {
    assert.equal(readout().getAttribute('data-phase'), pulseAt(progress).phase);
    assert.equal(readout().textContent, PULSE_TEXT[pulseAt(progress).phase]);
    if (made > disposed) assert.equal(current!.pulse, progress);
  };
  const start = async () => { await click('Follow an echo'); await click('Send a radar pulse'); assert.equal(pending.size, 1); return [...pending.keys()][0]; };
  const assertStale = async (key: number) => {
    const before = { text: readout().textContent, pulses: pulses.length, requests, selected: current?.selectedPart, pending: pending.size };
    await frame(999999, key);
    assert.deepEqual({ text: readout().textContent, pulses: pulses.length, requests, selected: current?.selectedPart, pending: pending.size }, before, 'canceled queued frame cannot mutate or reschedule');
  };
  try {
    await render(); assert.equal(made, 0); assert.equal(requests, 0);
    const flowChildren = () => [...host.querySelector('.es-spacecraft')!.children].map(node => node.className);
    const originalFlow = flowChildren();
    assert.ok(host.querySelector('.es-spacecraft-status')!.closest('.es-spacecraft-stage'), 'loading status is inside the fixed stage, never inserted into scrolling document flow');
    assert.equal(host.querySelectorAll('.es-spacecraft-send').length, 0, 'hardware mode shows its own controls');
    await click('Follow an echo');
    assert.equal(host.querySelectorAll('.es-spacecraft-send').length, 1);
    assert.ok(button('Send a radar pulse').closest('.es-spacecraft-stage-actions'), 'the signal has one adjacent toolbar trigger');
    assert.equal(host.querySelectorAll('[data-artist-concept]').length, 0, 'loading uses the stable stage, not a photo that flashes on scroll');
    await click('2 · Ground echo'); assertPhase(MANUAL_PULSE.echo); assert.equal(requests, 0, 'manual fallback needs no RAF');
    assert.equal(intersections.size, 1); assert.equal(disclosure.open, true); assert.equal(window.document.visibilityState, 'visible');
    await visibility(true); assert.equal(made - disposed, 1, host.textContent!); assertPhase(MANUAL_PULSE.echo);
    assert.equal(requests, 0, 'no autoplay or idle clock');
    assert.equal(host.querySelectorAll('canvas').length, 1);
    assert.deepEqual(flowChildren(),originalFlow,'ready does not add/remove normal-flow section children');
    assert.equal(host.querySelector('canvas')!.style.touchAction, 'pan-y');
    assert.equal(host.querySelector('canvas')!.style.pointerEvents, 'none');
    assert.equal(host.querySelectorAll('[data-artist-concept]').length, 0, 'no hidden photo layer beneath the live canvas');
    const sources = host.querySelector('.es-spacecraft-sources') as typeof disclosure;
    await act(async () => { sources.open = true; sources.dispatchEvent(new window.Event('toggle')); });
    assert.ok(host.querySelector('.es-spacecraft-sources [data-artist-concept]'), 'original concept loads only when its source drawer is opened');
    await act(async () => { sources.open = false; sources.dispatchEvent(new window.Event('toggle')); });
    assert.equal(host.querySelectorAll('[data-artist-concept]').length, 0, 'closing sources removes its photo from the render tree');
    for (const part of PARTS) {
      await click(part.label); assert.equal(current!.selectedPart, part.id); assert.equal(views.at(-1), part.id);
      assert.equal(button(part.label).getAttribute('aria-pressed'), 'true');
      assert.match(host.querySelector('.es-spacecraft-description')!.textContent!, new RegExp(part.fact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.equal(host.querySelector('.es-spacecraft-description a')!.getAttribute('href'), 'https://www.jpl.nasa.gov/press-kits/nisar/quick-facts/');
    }
    await click('Rotate view'); assert.equal(current!.interactive, true); assert.equal(host.querySelector('canvas')!.style.touchAction, 'none');
    await click('Finish exploring'); assert.equal(current!.interactive, false); assert.equal(host.querySelector('canvas')!.style.touchAction, 'pan-y');
    (host.querySelector('.es-spacecraft-camera') as unknown as {open:boolean}).open = true;
    const beforeViews = views.length;
    for (const label of ['Orbit left', 'Orbit right', 'Zoom in', 'Zoom out', 'Overview']) await click(label);
    assert.deepEqual(views.slice(beforeViews), ['left', 'right', 'in', 'out', 'overview']); assert.equal(requests, 0);
    await click('Reflector'); assert.equal(views.at(-1), 'reflector');
    await start(); assertPhase(0); assert.equal(views.at(-1), 'overview', 'Send reframes full ground path after part inspection');
    await frame(100); assertPhase(0); assert.equal(pending.size, 1);
    await frame(1060); assertPhase(0.4);
    assert.equal(host.querySelector('.es-spacecraft-stage')!.getAttribute('data-mode'), 'signal');
    await frame(1660); assertPhase(0.65);
    await frame(100 + PULSE_DURATION_MS); assertPhase(1); assert.equal(pending.size, 0); assert.ok(button('Send a radar pulse'));
    const modeKey = await start();
    await click('Orbit scale');
    assert.equal(host.querySelector('canvas')!.hidden, true);
    assert.equal(host.querySelectorAll('.es-orbital-scale').length, 1);
    assert.equal(host.querySelectorAll('.es-spacecraft-fallback').length, 0, 'no photo behind the distance diagram');
    assert.equal(pending.size, 0);
    await assertStale(modeKey);
    await click('Inspect hardware');
    assert.equal(host.querySelector('canvas')!.hidden, false);
    assert.equal(host.querySelectorAll('.es-orbital-scale').length, 0);
    assert.equal(current!.interactive, false, 'switching modes restores normal page scrolling');
    // Restart consumes the old generation, even when its frame was queued.
    let key = await start(); await click('Restart radar pulse'); assert.equal(pending.size, 1); await assertStale(key);
    key = [...pending.keys()][0]; await click('Stop pulse'); assert.equal(pending.size, 0); await assertStale(key);
    key = await start(); await click('Boom'); await click('2 · Ground echo'); assertPhase(MANUAL_PULSE.echo); assert.equal(current!.selectedPart, 'boom'); assert.equal(views.at(-1), 'overview', 'manual echo reframes path while preserving selection'); await assertStale(key);
    key = await start(); await click('Solar arrays'); assert.equal(current!.selectedPart, 'arrays'); await assertStale(key);
    key = await start(); await click('Reset spacecraft'); assertPhase(null); assert.equal(current!.selectedPart, 'reflector'); assert.equal(views.at(-1), 'overview'); await assertStale(key);
    key = await start(); await click('Global pause'); await assertStale(key); assert.equal(pending.size, 0);
    const atPause = requests; await click('Send a radar pulse'); assertPhase(MANUAL_PULSE.send); assert.equal(requests, atPause, 'paused explicit send is a still');
    await click('3 · Receive'); assertPhase(MANUAL_PULSE.receive);
    await click('Global pause'); assert.equal(requests, atPause, 'unpause never resumes');
    key = await start(); await act(async () => { reduced = true; motions.forEach(callback => callback()); }); await assertStale(key);
    const atReduced = requests;
    for (const [phase, label] of [['send', '1 · Send'], ['echo', '2 · Ground echo'], ['receive', '3 · Receive']] as const) { await click(label); assertPhase(MANUAL_PULSE[phase]); }
    await click('Send a radar pulse'); assertPhase(MANUAL_PULSE.send); assert.equal(requests, atReduced, 'reduced motion uses zero RAF');
    await act(async () => { reduced = false; motions.forEach(callback => callback()); }); assert.equal(requests, atReduced);
    key = await start(); const oldCanvas = host.querySelector('canvas'); await visibility(false); assert.deepEqual(flowChildren(),originalFlow,'leaving the scene cannot shift its own visibility boundary'); assert.equal(made, disposed); assert.equal(resizes.size, 0); assert.equal(host.querySelectorAll('[data-artist-concept]').length, 0, 'scrolling offscreen never swaps the model for its concept photo'); await assertStale(key);
    await visibility(true); assert.deepEqual(flowChildren(),originalFlow); assert.notEqual(host.querySelector('canvas'), oldCanvas); assert.equal(made - disposed, 1); assert.equal(pending.size, 0);
    // Coalesced observer edges still invalidate/rebuild, even when React commits
    // only the final visible=true rather than an intermediate hidden render.
    key = await start(); const coalescedCanvas = host.querySelector('canvas');
    await act(async () => { for (const callback of intersections) { callback([{ isIntersecting: false }]); callback([{ isIntersecting: true }]); } });
    assert.equal(made - disposed, 1); assert.notEqual(host.querySelector('canvas'), coalescedCanvas); assert.equal(button('Rotate view').disabled, false); await assertStale(key);
    await click('Boom'); await click('2 · Ground echo'); await click('Rotate view');
    await visibility(false); const savedMade = made;
    assert.equal(button('Rotate view').getAttribute('aria-pressed'),'false','leaving the scene exits touch capture');
    await click('Global replay');
    assert.equal(button('Boom').getAttribute('aria-pressed'), 'true', 'hidden replay defers visible reset');
    await visibility(true); assert.equal(made, savedMade + 1); assert.equal(current!.selectedPart, 'reflector'); assert.equal(current!.interactive, false); assertPhase(null); assert.equal(views.at(-1), 'overview');
    key = await start(); await act(async () => { hidden = true; window.document.dispatchEvent(new window.Event('visibilitychange')); }); assert.equal(made, disposed); await assertStale(key);
    await act(async () => { hidden = false; window.document.dispatchEvent(new window.Event('visibilitychange')); }); assert.equal(made - disposed, 1); assert.equal(pending.size, 0);
    key = await start(); await act(async () => { disclosure.open = false; disclosure.dispatchEvent(new window.Event('toggle')); }); assert.equal(made, disposed); await assertStale(key);
    await act(async () => { disclosure.open = true; disclosure.dispatchEvent(new window.Event('toggle')); }); assert.equal(made - disposed, 1);
    // A hidden/closed ancestor cancels before a queued frame can be delivered.
    key = await start(); await act(async () => { disclosure.hidden = true; await new Promise(resolve => setTimeout(resolve, 0)); }); assert.equal(made, disposed); await assertStale(key);
    await act(async () => { disclosure.hidden = false; await new Promise(resolve => setTimeout(resolve, 0)); }); assert.equal(made - disposed, 1);
    key = await start(); const lostCanvas = host.querySelector('canvas')!; const lost = new window.Event('webglcontextlost', { cancelable: true });
    await act(async () => lostCanvas.dispatchEvent(lost)); assert.equal(lost.defaultPrevented, true); assert.equal(made, disposed); await assertStale(key);
    assert.ok(host.querySelector('.es-spacecraft-fallback [data-artist-concept]')); assert.match(host.textContent!, /connection was lost/);
    await click('Radar instruments'); await click('3 · Receive'); assertPhase(1);
    await act(async () => lostCanvas.dispatchEvent(new window.Event('webglcontextrestored')));
    assert.notEqual(host.querySelector('canvas'), lostCanvas); assert.equal(made - disposed, 1); assert.equal(current!.selectedPart, 'instruments'); assertPhase(1); assert.equal(views.at(-1), 'overview');
    key = await start(); await click('Global replay'); assertPhase(null); await assertStale(key);
    // Context loss during the render itself must not schedule the next frame.
    await start(); await frame(0); key = [...pending.keys()][0]; const duringDraw = host.querySelector('canvas')!; loseOnDraw = true;
    await frame(960, key); assert.equal(made, disposed); assert.equal(pending.size, 0); assertPhase(0.4); await assertStale(key);
    await act(async () => duringDraw.dispatchEvent(new window.Event('webglcontextrestored'))); assert.equal(made - disposed, 1); assertPhase(0.4);
    // A draw failure at initial Send cannot schedule a frame either.
    const beforeInitialLoss = requests; const initialLossCanvas = host.querySelector('canvas')!; loseOnDraw = true; await click('Send a radar pulse');
    assert.equal(made, disposed); assert.equal(requests, beforeInitialLoss); assert.equal(pending.size, 0); assertPhase(0);
    await act(async () => initialLossCanvas.dispatchEvent(new window.Event('webglcontextrestored'))); assert.equal(made - disposed, 1);
    // Loss while the module is pending cannot allocate, even if it resolves.
    await visibility(false); deferred = true; await visibility(true); assert.ok(deferredLoads.length);
    const pendingCanvas = host.querySelector('canvas')!; const beforePending = made;
    await act(async () => pendingCanvas.dispatchEvent(new window.Event('webglcontextlost', { cancelable: true })));
    await act(async () => deferredLoads.shift()!(sceneModule)); assert.equal(made, beforePending);
    deferred = false; loseOnInitialView = true; await click('Try 3D again'); assert.equal(made, disposed); assert.match(host.textContent!, /connection was lost/); assert.equal(resizes.size, 0, 'initial view loss cannot publish ready or attach resize observer');
    fail = true; await click('Try 3D again'); assert.match(host.textContent!, /3D is unavailable/); assert.equal(made, disposed);
    await click('1 · Send'); assertPhase(MANUAL_PULSE.send); assert.ok(host.querySelector('[data-artist-concept]'));
    fail = false; await click('Try 3D again'); assert.equal(made - disposed, 1); assertPhase(MANUAL_PULSE.send);
    // Stale async modules after a visibility generation must remain inert.
    await visibility(false); deferred = true; await visibility(true); const oldLoad = deferredLoads.shift()!; await visibility(false);
    await act(async () => oldLoad(sceneModule)); assert.equal(made, disposed);
    await visibility(true); const sameTurnLoad = deferredLoads.shift()!; const beforeSameTurn = made;
    await act(async () => { for (const callback of intersections) callback([{ isIntersecting: false }]); sameTurnLoad(sceneModule); });
    assert.equal(made, beforeSameTurn, 'hidden notification invalidates module before React effect teardown');
    deferred = false; await visibility(true);
    key = await start(); const beforeUnmount = { pulses: pulses.length, requests };
    await act(async () => root.unmount()); assert.equal(made, disposed); assert.equal(resizes.size, 0); assert.equal(intersections.size, 0); assert.equal(motions.size, 0);
    await frame(999999, key); assert.deepEqual({ pulses: pulses.length, requests }, beforeUnmount); assert.equal(pending.size, 0);
    // A pending load after full unmount also cannot construct.
    const another = createRoot(host as unknown as HTMLElement); deferred = true;
    await act(async () => another.render(React.createElement(StoryProvider, null, React.createElement(NisarExplorer, { sceneLoader: loader, fallback }))));
    await visibility(true); const finalLoad = deferredLoads.shift()!;
    await act(async () => another.unmount()); const beforeFinal = made;
    await act(async () => finalLoad(sceneModule)); assert.equal(made, beforeFinal); assert.equal(intersections.size, 0);
  } finally {
    await act(async () => root.unmount()); css.deregister(); await window.happyDOM.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

test('real Three geometry, highlights, signal parity, event-only cameras and resource disposal', async () => {
  const window = new Window({ url: 'http://localhost/' });
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const savedRaf = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  let frameRequests = 0;
  const requestFrame = () => ++frameRequests;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: requestFrame });
  Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: requestFrame });
  const canvas = window.document.createElement('canvas') as unknown as HTMLCanvasElement;
  let scene: THREE.Scene | undefined, camera: THREE.PerspectiveCamera | undefined, draws = 0, disposed = 0, losses = 0;
  const renderer: SpacecraftRenderer = { setPixelRatio(value) { assert.ok(value <= 2); }, setClearColor() {}, setSize() {}, render(s, c) { scene = s as THREE.Scene; camera = c as THREE.PerspectiveCamera; draws++; }, dispose() { disposed++; }, forceContextLoss() { losses++; } };
  let actual: SpacecraftScene | undefined;
  const earthTexture = new THREE.Texture(); let textureDisposes = 0, finishTexture: (() => void) | undefined;
  earthTexture.addEventListener('dispose', () => textureDisposes++);
  try {
    actual = createSpacecraftScene(canvas, () => renderer, (url, ready) => { assert.equal(url, '/images/story/earth.webp'); finishTexture = () => ready(earthTexture); return earthTexture; }); actual.resize(800, 450);
    assert.equal(canvas.style.touchAction, 'pan-y', 'disabled OrbitControls must undo constructor touch-action:none');
    assert.equal(canvas.style.pointerEvents, 'none');
    const geometries = new Map<THREE.BufferGeometry, number>(), materials = new Map<THREE.Material, number>();
    scene!.traverse(object => { const drawable = object as THREE.Mesh;
      if (drawable.geometry && !geometries.has(drawable.geometry)) { const g = drawable.geometry; geometries.set(g, 0); g.addEventListener('dispose', () => geometries.set(g, geometries.get(g)! + 1)); }
      if (drawable.material) for (const m of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) if (!materials.has(m)) { materials.set(m, 0); m.addEventListener('dispose', () => materials.set(m, materials.get(m)! + 1)); }
    });
    assert.ok(geometries.size > 100, 'mesh reflector, segmented wings, grid and ribs exist');
    const dish = scene!.getObjectByName('reflector-rim') as THREE.Mesh<THREE.TorusGeometry>;
    assert.equal(dish.geometry.parameters.radius * 2, DIMENSIONS.reflectorDiameter);
    const bus = scene!.getObjectByName('bus-and-payload') as THREE.Mesh<THREE.BoxGeometry>;
    assert.equal(bus.geometry.parameters.height, DIMENSIONS.busPayloadLength);
    const boom = scene!.getObjectByName('reflector-boom') as THREE.Mesh<THREE.CylinderGeometry>;
    assert.equal(boom.geometry.parameters.height, DIMENSIONS.boomLength);
    const globe = scene!.getObjectByName('earth-context-globe') as THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
    assert.ok(globe, 'Earth remains part of the teaching scene');
    const craftBounds = new THREE.Box3();
    for (const part of PARTS) craftBounds.union(new THREE.Box3().setFromObject(scene!.getObjectByName(`part-${part.id}`)!));
    assert.ok(craftBounds.distanceToPoint(globe.position) - EARTH_CONTEXT.radius > 2.5 * DIMENSIONS.reflectorDiameter, 'clear space separates the enlarged spacecraft and Earth');
    assert.ok(Math.abs(new THREE.Vector3(...SIGNAL_GROUND).distanceTo(globe.position) - EARTH_CONTEXT.radius) < 1e-6, 'the echo lands on Earth rather than in empty space');
    finishTexture!(); assert.equal(globe.material.map, earthTexture);
    assert.ok(scene!.getObjectByName('schematic-signal-target'));
    assert.ok(scene!.getObjectByName('solar-wing-a')); assert.ok(scene!.getObjectByName('solar-wing-b'));
    for (const part of PARTS) {
      actual.update({ selectedPart: part.id, interactive: false, pulse: null });
      for (const other of PARTS) {
        const group = scene!.getObjectByName(`part-${other.id}`)!; assert.equal(group.userData.selected, other.id === part.id);
        group.traverse(object => {
          const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.LineBasicMaterial | undefined;
          if (!material?.color) return;
          const base = new THREE.Color(material.userData.baseColour);
          if (other.id === part.id) base.lerp(new THREE.Color(0xc6fff1), 0.42);
          assert.ok(base.equals(material.color), 'selected hardware has reversible, independent material emphasis');
          if ('emissive' in material) { assert.equal(material.emissive.getHex(), other.id === part.id ? 0x28584e : 0); assert.equal(material.emissiveIntensity, other.id === part.id ? 0.4 : 0); }
        });
      }
      actual.view(part.id); assert.ok(camera!.position.distanceTo(new THREE.Vector3(3, 4.3, 0)) > 5);
    }
    const vector = (actual: THREE.Vector3, expected: THREE.Vector3) => assert.ok(actual.distanceTo(expected) < 1e-5, `${actual.toArray()} != ${expected.toArray()}`);
    const outbound = scene!.getObjectByName('pulse-outbound') as THREE.Line;
    const returning = scene!.getObjectByName('pulse-return') as THREE.Line;
    const echo = scene!.getObjectByName('pulse-ground-echo')!;
    const packet = scene!.getObjectByName('pulse-packet')!;
    for (const p of [null, 0, MANUAL_PULSE.send, 0.4, MANUAL_PULSE.echo, 0.65, 0.8, MANUAL_PULSE.receive]) {
      actual.pulse(p); const sample = pulseAt(p);
      assert.equal(scene!.userData.pulsePhase, sample.phase);
      assert.equal(outbound.visible, p !== null); assert.equal(returning.visible, sample.phase === 'receive'); assert.equal(echo.visible, sample.phase === 'echo' || sample.phase === 'receive');
      const start = new THREE.Vector3(...SIGNAL_START), ground = new THREE.Vector3(...SIGNAL_GROUND);
      vector(new THREE.Vector3().fromBufferAttribute(outbound.geometry.getAttribute('position'), 1), start.clone().lerp(ground, sample.outbound));
      vector(new THREE.Vector3().fromBufferAttribute(returning.geometry.getAttribute('position'), 1), ground.clone().lerp(start, sample.returning));
      vector(packet.position, start.clone().lerp(ground, sample.marker));
      assert.equal(echo.scale.x, 0.5 + sample.echo * 1.5);
    }
    actual.view('overview'); const before = camera!.position.clone(); actual.view('in'); assert.ok(camera!.position.length() < before.length());
    actual.view('right'); assert.equal(camera!.position.equals(before), false); actual.view('overview');
    // Portrait framing expands distance rather than cropping the spacecraft.
    const landscape = camera!.position.length(); actual.resize(320, 450); assert.ok(camera!.position.length() > landscape);
    assert.ok(Number.isFinite(camera!.projectionMatrix.elements[0]));
    for (const [width, height] of [[800, 450], [320, 450], [320, 350]]) {
      actual.view('overview'); actual.resize(width, height); scene!.updateMatrixWorld(true); camera!.updateMatrixWorld(true);
      let screenLeft = Infinity, screenRight = -Infinity, craftBottom = Infinity;
      for (const name of ['reflector-rim', 'bus-and-payload', 'solar-wing-a', 'solar-wing-b']) {
        const bounds = new THREE.Box3().setFromObject(scene!.getObjectByName(name)!);
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
          const projected = new THREE.Vector3(x, y, z).project(camera!);
          craftBottom = Math.min(craftBottom, projected.y); screenLeft = Math.min(screenLeft, projected.x); screenRight = Math.max(screenRight, projected.x);
          assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && Math.abs(projected.z) < 1, `${name} stays framed at ${width}x${height}`);
        }
      }
      assert.ok(screenRight - screenLeft < 1.3, `spacecraft occupies less than 65% of overview width at ${width}x${height}`);
      let earthTop = -Infinity, earthVisible = false;
      const globePositions = globe.geometry.getAttribute('position');
      for (let index = 0; index < globePositions.count; index++) {
        const point = globe.localToWorld(new THREE.Vector3().fromBufferAttribute(globePositions, index)).project(camera!);
        earthTop = Math.max(earthTop, point.y);
        if (Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && Math.abs(point.z) < 1) earthVisible = true;
      }
      assert.ok(earthVisible, `Earth is in view at ${width}x${height}`);
      assert.ok(craftBottom - earthTop > 0.08, `a visible gap separates hardware and horizon at ${width}x${height}`);
      const groundPoint = new THREE.Vector3(...SIGNAL_GROUND).project(camera!);
      assert.ok(Math.abs(groundPoint.x) < 1 && Math.abs(groundPoint.y) < 1, 'ground echo remains in overview');
    }
    actual.update({ selectedPart: 'arrays', interactive: true, pulse: null }); assert.equal(canvas.style.touchAction, 'none'); assert.equal(canvas.style.pointerEvents, 'auto'); actual.view('left'); actual.view('out');
    // Exercise actual OrbitControls input, not a mocked camera callback.
    Object.defineProperty(canvas, 'clientHeight', { value: 450 });
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    const drag = (button: number) => {
      for (const [type, x, y] of [['pointerdown', 100, 100], ['pointermove', 190, 145], ['pointerup', 190, 145]] as const)
        canvas.dispatchEvent(new window.PointerEvent(type, { pointerId: 1, pointerType: 'mouse', button, buttons: type === 'pointerup' ? 0 : 1 << button, clientX: x, clientY: y, bubbles: true }) as unknown as Event);
    };
    const orbitStart = camera!.position.clone(); drag(0);
    assert.ok(camera!.position.distanceTo(orbitStart) > 1, 'left drag freely orbits');
    const rotated = camera!.position.clone();
    actual.update({ selectedPart: 'boom', interactive: true, pulse: 0.2 });
    actual.resize(800, 450);
    vector(camera!.position, rotated);
    const facing = camera!.quaternion.clone(); drag(2);
    assert.ok(camera!.position.distanceTo(rotated) > 0.1, 'right drag pans like the city');
    assert.ok(camera!.quaternion.angleTo(facing) < 1e-6, 'panning keeps the viewing angle');
    actual.view('top'); assert.ok(Number.isFinite(camera!.position.y));
    actual.view('overview');
    actual.update({ selectedPart: 'arrays', interactive: false, pulse: null }); assert.equal(canvas.style.touchAction, 'pan-y'); assert.equal(canvas.style.pointerEvents, 'none');
    const collectGeometry = () => { const values = new Set<THREE.BufferGeometry>(); scene!.traverse(object => { const geometry = (object as THREE.Mesh).geometry; if (geometry) values.add(geometry); }); return values; };
    const beforeGeometry = collectGeometry(); actual.pulse(0.7); actual.pulse(1); assert.deepEqual(collectGeometry(), beforeGeometry, 'ticks reuse the same geometry objects');
    assert.equal(frameRequests, 0, 'real scene and interactive OrbitControls never request an idle RAF');
    actual.dispose(); actual.dispose(); assert.equal(textureDisposes, 1); const afterDisposeDraws = draws; finishTexture!(); assert.equal(draws, afterDisposeDraws, 'a late image callback cannot resurrect a disposed renderer'); assert.equal(disposed, 1); assert.equal(losses, 1);
    assert.ok([...geometries.values(), ...materials.values()].every(count => count === 1), 'every attached geometry/material disposed exactly once');
    const beforeDead = draws; actual.pulse(0); actual.update({ selectedPart: 'boom', interactive: false, pulse: 0.2 }); actual.view('overview'); actual.resize(100, 100); assert.equal(draws, beforeDead);
    // Failure after renderer construction cleans resources and context too.
    let partialDisposes = 0, partialLosses = 0;
    assert.throws(() => createSpacecraftScene(canvas, () => ({ ...renderer, setPixelRatio() { throw new Error('partial constructor'); }, dispose() { partialDisposes++; }, forceContextLoss() { partialLosses++; } })), /partial constructor/);
    assert.equal(partialDisposes, 1); assert.equal(partialLosses, 1);
    let failedScene: THREE.Scene | undefined;
    const releasedGeometry = new Set<THREE.BufferGeometry>();
    const originalDispose = THREE.BufferGeometry.prototype.dispose;
    THREE.BufferGeometry.prototype.dispose = function () { assert.equal(releasedGeometry.has(this), false); releasedGeometry.add(this); originalDispose.call(this); };
    try {
      assert.throws(() => createSpacecraftScene(canvas, () => ({ ...renderer, render(s) { failedScene = s as THREE.Scene; throw new Error('first render failed'); } }), () => new THREE.Texture()), /first render failed/);
      assert.ok(failedScene); assert.ok(releasedGeometry.size > 100, 'late partial construction disposes built geometry');
    } finally { THREE.BufferGeometry.prototype.dispose = originalDispose; }
  } finally {
    actual?.dispose(); await window.happyDOM.close();
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (savedRaf) Object.defineProperty(globalThis, 'requestAnimationFrame', savedRaf); else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  }
});
