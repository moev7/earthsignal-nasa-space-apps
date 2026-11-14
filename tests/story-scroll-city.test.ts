import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import * as THREE from 'three';
import { StoryProvider, useStory } from '../features/ground-truth/components/story/StoryProvider';

type CityComponent = typeof import('../features/ground-truth/components/story/city3d/SinkingCity3D').default;
type CityProps = React.ComponentProps<CityComponent>;

function rendererFixture() {
  const worlds: ReturnType<typeof makeWorld>[] = [];
  const stages: ReturnType<typeof makeStage>[] = [];
  const ready = { status: 'ready', data: { focus: { buildings: [], grid: { vertical_rate: [[-100, -20]] } }, bundle: { manifest: { layers: { vertical_rate: { colour: { stops: [] } } }, stats: { median_sigma: 10 } } } } };
  function makeWorld(kind: 'simulation' | 'measured') {
    const world = {
      kind, buildingCount: 1, now: 0,
      times: [] as Array<{ time: number; forward: boolean; animate: boolean }>,
      ambientToggles: [] as boolean[], ambientSteps: [] as number[], physicsSteps: 0,
      crossings: [] as Array<number | undefined>, debrisClears: 0, disposed: false,
      view: { position: new THREE.Vector3(560, 360, 600), target: new THREE.Vector3(20, -10, 0), from: new THREE.Vector3() },
      setTime(time: number, forward: boolean, animate: boolean) { world.times.push({ time, forward, animate }); },
      setRisk() {}, setCells() {}, step() { world.physicsSteps++; }, resize() {}, pick() { return null; },
      setAmbient(on: boolean) { world.ambientToggles.push(on); }, stepAmbient(delta: number) { world.ambientSteps.push(delta); },
      tip() { return { title: 'Fixture', rows: [] }; }, rungs() { return []; }, countAt() { return 0; },
      clearDebris() { assert.equal(kind, 'simulation'); world.debrisClears++; },
      resetCrossings(time?: number) { assert.equal(kind, 'simulation'); world.crossings.push(time); },
      fallShot() { assert.equal(kind, 'simulation'); return { year: 10, position: new THREE.Vector3(1, 2, 3), target: new THREE.Vector3(4, 5, 6) }; },
      summaryAt() { return { cracked: 0, damaged: 0, falling: 0 }; },
      dispose() { world.disposed = true; },
    };
    return world;
  }
  function makeStage() {
    const starts = new Set<() => void>();
    const stage = {
      scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), disposed: false, renders: 0, shadowInvalidations: 0,
      loop: null as (() => void) | null,
      controls: { target: new THREE.Vector3(), enabled: false, enableZoom: true, enableDamping: true, update() {},
        addEventListener(_event: string, listener: () => void) { starts.add(listener); },
        removeEventListener(_event: string, listener: () => void) { starts.delete(listener); },
      },
      starts,
      renderer: { render() { stage.renders++; }, setAnimationLoop(loop: (() => void) | null) { stage.loop = loop; }, getDrawingBufferSize(out: THREE.Vector2) { return out.set(800, 600); } },
      resize() {}, invalidateShadows() { stage.shadowInvalidations++; }, dispose() { stage.disposed = true; },
    };
    return stage;
  }
  return { worlds, stages, ready,
    makeWorld(kind: 'simulation' | 'measured') { const world = makeWorld(kind); worlds.push(world); return world; },
    makeStage() { const stage = makeStage(); stages.push(stage); return stage; },
  };
}

// Use the real React controls, provider, visibility/replay and motion hooks. Only
// GPU construction and data loading are replaced, so tests need no browser/network.
test('city scroll authority and story presentation', async t => {
  let frameDelta = .05;
  t.mock.method(THREE.Clock.prototype, 'getDelta', () => frameDelta);
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    const stub = (code: string) => ({ url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true });
    if (specifier === './shared' && context.parentURL?.includes('/city3d/SinkingCity3D.tsx')) return stub('export const EXAG=6,T_MAX=30;export function createStage(){return globalThis.__storyCityFixture.makeStage()}');
    if (specifier === './simulationWorld' && context.parentURL?.includes('/city3d/SinkingCity3D.tsx')) return stub('export function createSimulationWorld(){return globalThis.__storyCityFixture.makeWorld("simulation")}');
    if (specifier === './measuredWorld' && context.parentURL?.includes('/city3d/SinkingCity3D.tsx')) return stub('export function createMeasuredWorld(){return globalThis.__storyCityFixture.makeWorld("measured")}');
    if (specifier === '@/features/ground-truth/data/nisar') return stub('export const NISAR_BUNDLES={tehran:{}};export function useNisarFocus(bundle){return bundle?globalThis.__storyCityFixture.ready:null}export function formatPeriod(){return "18 Jun–21 Oct 2026"}');
    if (specifier.endsWith('.css')) return stub('export default {}');
    return nextResolve(specifier, context);
  } });
  let City: CityComponent;
  let CityScene: typeof import('../features/ground-truth/components/story/CityScene').CityScene;
  let cityProgressTime: typeof import('../features/ground-truth/components/story/city3d/SinkingCity3D').cityProgressTime;
  try {
    ({ default: City, cityProgressTime } = await import('../features/ground-truth/components/story/city3d/SinkingCity3D'));
    ({ CityScene } = await import('../features/ground-truth/components/story/CityScene'));
  } finally { hooks.deregister(); }

  async function setup(initial: CityProps = {}, wrapper = false) {
    const window = new Window({ url: 'http://localhost/' });
    const originals = new Map<string, PropertyDescriptor | undefined>();
    const install = (key: string, value: unknown) => { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
    const fixture = rendererFixture();
    let visible = true;
    const visibility = new Set<(entries: { isIntersecting: boolean }[]) => void>();
    const motion = new Set<() => void>();
    let reduced = false;
    let resizeDisconnects = 0;
    for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, HTMLCanvasElement: window.HTMLCanvasElement, IS_REACT_ACT_ENVIRONMENT: true, __storyCityFixture: fixture })) install(key, value);
    install('IntersectionObserver', class {
      constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
      observe() { visibility.add(this.callback); this.callback([{ isIntersecting: visible }]); }
      disconnect() { visibility.delete(this.callback); }
    });
    install('ResizeObserver', class { observe() {} disconnect() { resizeDisconnects++; } });
    window.matchMedia = (() => ({ get matches() { return reduced; }, addEventListener(_type: string, callback: () => void) { motion.add(callback); }, removeEventListener(_type: string, callback: () => void) { motion.delete(callback); } })) as unknown as typeof window.matchMedia;
    const { createRoot } = await import('react-dom/client');
    const host = window.document.createElement('div');
    window.document.body.appendChild(host);
    const root = createRoot(host as unknown as HTMLElement);
    let controls!: ReturnType<typeof useStory>;
    let props = initial;
    function Fixture() { controls = useStory(); return wrapper ? React.createElement(CityScene, { mode: 'simulation', ...props }) : React.createElement(City, props); }
    const render = async (next = props) => { props = next; await act(async () => root.render(React.createElement(StoryProvider, null, React.createElement(Fixture)))); };
    await render();
    const button = (label: string) => {
      const result = Array.from(host.querySelectorAll('button')).find(node => node.textContent === label || node.getAttribute('aria-label') === label);
      assert.ok(result, `button ${label} exists`); return result;
    };
    return {
      fixture, host, window, button, render,
      get year() { return Number(host.querySelector('input[type="range"]')?.getAttribute('value')); },
      get world() { return fixture.worlds.at(-1)!; }, get stage() { return fixture.stages.at(-1)!; },
      async click(label: string) { await act(async () => button(label).click()); },
      async pause() { await act(async () => controls.togglePaused()); },
      async replay() { await act(async () => controls.replay()); },
      async visible(value: boolean) { await act(async () => { visible = value; for (const callback of visibility) callback([{ isIntersecting: value }]); }); },
      async reduced(value: boolean) { await act(async () => { reduced = value; for (const callback of motion) callback(); }); },
      async hidden(value: boolean) { await act(async () => { Object.defineProperty(window.document, 'visibilityState', { configurable: true, value: value ? 'hidden' : 'visible' }); window.document.dispatchEvent(new window.Event('visibilitychange')); }); },
      async seek(value: number) {
        const input = host.querySelector('input[type="range"]')!;
        const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
        await act(async () => { setValue.call(input, String(value)); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
      },
      async close() {
        await act(async () => root.unmount());
        assert.ok(fixture.worlds.every(world => world.disposed), 'all worlds disposed');
        assert.ok(fixture.stages.every(stage => stage.disposed && stage.loop === null && stage.starts.size === 0), 'loops and control listeners released');
        assert.equal(visibility.size, 0); assert.equal(motion.size, 0);
        assert.equal(resizeDisconnects, fixture.stages.length);
        await window.happyDOM.close();
        for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
      },
    };
  }

  await t.test('finite clamped progress seeks an existing world statically and reverses to zero', async () => {
    assert.deepEqual([undefined, NaN, Infinity, -Infinity].map(cityProgressTime), [null, null, null, null]);
    assert.deepEqual([-1, 0, .5, 1, 2].map(cityProgressTime), [0, 0, 15, 30, 30]);
    const env = await setup({ mode: 'simulation', controlledProgress: NaN });
    try {
      assert.equal(env.year, 0);
      await env.render({ mode: 'simulation', controlledProgress: .9 }); assert.equal(env.year, 27);
      await env.render({ mode: 'simulation', controlledProgress: .2 }); assert.equal(env.year, 6);
      assert.ok(env.world.debrisClears > 0); assert.equal(env.world.crossings.at(-1), 6);
      assert.deepEqual(env.world.times.slice(-2).map(call => call.time), [0, 6], 'restore collapsed poses before an earlier still');
      await env.render({ mode: 'simulation', controlledProgress: 0 }); assert.equal(env.year, 0);
      assert.deepEqual(env.world.times.at(-1), { time: 0, forward: false, animate: false });
      await env.render({ mode: 'simulation', controlledProgress: Infinity }); assert.equal(env.year, 0);
      await env.render({ mode: 'simulation', controlledProgress: 2 }); assert.equal(env.year, 30);
      assert.equal(env.fixture.worlds.length, 1); assert.equal(env.fixture.stages.length, 1);
      assert.equal(env.stage.loop, null, 'scroll creates no animation clock');
      assert.ok(env.world.times.every(call => !call.animate));
    } finally { await env.close(); }
  });

  await t.test('pause, reduced motion and offscreen changes hold and reconcile the latest pose', async () => {
    const env = await setup({ mode: 'simulation', controlledProgress: .1 });
    try {
      await env.pause(); await env.render({ mode: 'simulation', controlledProgress: .4 }); assert.equal(env.year, 3);
      await env.pause(); assert.equal(env.year, 12);
      await env.reduced(true); await env.render({ mode: 'simulation', controlledProgress: .6 }); assert.equal(env.year, 12);
      await env.reduced(false); assert.equal(env.year, 18);
      await env.visible(false); await env.render({ mode: 'simulation', controlledProgress: .8 }); assert.equal(env.year, 18);
      await env.visible(true); assert.equal(env.year, 24);
      assert.equal(env.stage.loop, null); assert.equal(env.fixture.worlds.length, 1);
    } finally { await env.close(); }
  });

  await t.test('manual seeks remain available during reduced motion and Follow respects pause gates', async () => {
    const env = await setup({ mode: 'simulation', controlledProgress: .3 });
    try {
      await env.reduced(true); await env.seek(7); assert.equal(env.year, 7);
      assert.ok(env.button('Follow the story'));
      await env.render({ mode: 'simulation', controlledProgress: .7 }); assert.equal(env.year, 7);
      await env.click('Follow the story'); assert.equal(env.year, 7);
      await env.reduced(false); assert.equal(env.year, 21);
      await env.seek(2); await env.pause();
      await env.render({ mode: 'simulation', controlledProgress: .9 });
      await env.click('Follow the story'); assert.equal(env.year, 2);
      await env.pause(); assert.equal(env.year, 27);
    } finally { await env.close(); }
  });

  await t.test('play, reset, project, collapse and camera actions retain authority across viewport changes', async () => {
    const env = await setup({ mode: 'simulation', controlledProgress: .2, story: true });
    try {
      for (const action of ['Play this scene', 'Reset', 'Visit illustration year 20', 'Watch the collapse illustration', 'Explore in 3D', 'Zoom in', 'Neighbourhood view']) {
        await env.click(action);
        assert.ok(env.button('Follow the story'), action);
        const animated = ['Play this scene', 'Visit illustration year 20', 'Watch the collapse illustration'].includes(action);
        if (animated) {
          assert.ok(env.stage.loop, `${action} retains its existing animated experience`);
          await act(async () => env.stage.loop!());
          assert.equal(env.world.times.at(-1)?.animate, true);
        }
        const held = env.year;
        await env.visible(false); await env.render({ mode: 'simulation', controlledProgress: .8, story: true }); await env.visible(true);
        assert.equal(env.year, held, `${action} is not overwritten on returning`);
        const beforeFollow = env.world.times.length;
        await env.click('Follow the story'); assert.equal(env.year, 24);
        if (animated) assert.deepEqual(env.world.times.slice(beforeFollow).map(call => call.time), [0, 24], 'a manual animation returns to a deterministic story still');
        assert.equal(env.stage.loop, null, 'Follow cancels both tween/play and orbit loop');
        assert.deepEqual(env.stage.camera.position.toArray(), env.world.view.position.toArray());
        assert.deepEqual(env.stage.controls.target.toArray(), env.world.view.target.toArray());
        assert.equal(env.stage.controls.enabled, false);
        await env.render({ mode: 'simulation', controlledProgress: .2, story: true });
      }
      await act(async () => { for (const start of env.stage.starts) start(); });
      assert.ok(env.button('Follow the story'), 'native orbit start also takes authority');
      await env.click('Follow the story');
      assert.equal(env.fixture.worlds.length, 1);
    } finally { await env.close(); }
  });

  await t.test('offscreen replay stays pending; context restoration disposes and rebuilds only on retry', async () => {
    const env = await setup({ mode: 'simulation', controlledProgress: .5 });
    try {
      await env.seek(4); await env.visible(false);
      await env.replay(); await env.replay(); assert.equal(env.year, 4);
      await env.render({ mode: 'simulation', controlledProgress: 0 }); await env.visible(true);
      assert.equal(env.year, 0); assert.equal(env.host.querySelector('.es-city-follow'), null);
      await env.click('Play this scene'); assert.ok(env.stage.loop);
      const previous = env.stage;
      await act(async () => env.host.querySelector('canvas')!.dispatchEvent(new env.window.Event('webglcontextlost', { cancelable: true })));
      assert.equal(previous.loop, null); assert.match(env.host.textContent, /3D connection was lost/);
      await act(async () => env.host.querySelector('canvas')!.dispatchEvent(new env.window.Event('webglcontextrestored')));
      assert.equal(env.fixture.stages.length, 2); assert.equal(previous.disposed, true);
      assert.equal(env.fixture.worlds[0].disposed, true);
      assert.doesNotMatch(env.host.textContent, /3D connection was lost/);
    } finally { await env.close(); }
  });

  await t.test('story disclosure retains controls with one primary action and visible provenance/relative years', async () => {
    const env = await setup({ mode: 'simulation', controlledProgress: .5, story: true }, true);
    try {
      assert.equal(env.year, 15, 'CityScene forwards controlledProgress');
      const disclosure = env.host.querySelector('details.es-city-story-controls')!;
      assert.ok(disclosure); assert.equal(disclosure.querySelector('summary')?.textContent, 'Timeline & view settings');
      assert.equal(disclosure.hasAttribute('open'), false);
      assert.ok(disclosure.querySelector('.es-city-controls input[type="range"]'));
      assert.ok(disclosure.querySelector('.es-city-scenario'), 'existing threshold exploration retained');
      assert.ok(disclosure.querySelector('select[aria-label="Inspect a building"]'));
      const primary = env.button('Watch the collapse illustration');
      assert.equal(primary.closest('.es-city-story-controls'), null);
      assert.equal(Array.from(env.host.querySelectorAll('button')).filter(button => button.textContent === primary.textContent).length, 1);
      assert.match(env.host.querySelector('.es-city-story-status')!.textContent, /Illustration.*year 15/);
      assert.match(env.host.querySelector('.es-city-caption')!.textContent, /Illustration.*invented city.*Not a prediction/);
      assert.equal(env.button('Explore in 3D').closest('details'), null, 'touch interaction is available beside the canvas');
      assert.equal(env.host.querySelector('.es-city-caption')!.closest('.es-city-stage'), null, 'provenance does not cover the model');
      assert.equal([...env.host.querySelectorAll('button')].filter(button => button.textContent === 'Explore in 3D').length, 1);
      await env.click('Explore in 3D'); assert.equal(env.button('Follow the story').closest('details'), null);
    } finally { await env.close(); }
  });

  await t.test('explicit chapter commands seek still simulation states during pause/reduced motion and cancel local play', async () => {
    const props = { mode: 'simulation' as const, controlledProgress: .2, manualProgress: true, story: true };
    const env = await setup(props, true);
    try {
      assert.equal(env.year, 6, 'CityScene forwards manualProgress');
      await env.pause();
      await env.render({ ...props, controlledProgress: .5 });
      assert.equal(env.year, 15); assert.equal(env.stage.loop, null);
      await env.reduced(true);
      await env.render({ ...props, controlledProgress: .8 });
      assert.equal(env.year, 24); assert.equal(env.stage.loop, null);
      await env.pause(); await env.reduced(false);
      await env.click('Play this scene'); assert.ok(env.stage.loop);
      await env.render({ ...props, controlledProgress: .1 });
      assert.equal(env.year, 3); assert.equal(env.stage.loop, null);
      assert.equal(env.world.times.at(-1)?.animate, false, 'chapter controls never run collapse physics');
    } finally { await env.close(); }
  });

  await t.test('measured mode ignores external progress and keeps the explicit conditional future', async () => {
    const env = await setup({ mode: 'measured', controlledProgress: .8, story: true });
    try {
      assert.equal(env.year, 0);
      await env.render({ mode: 'measured', controlledProgress: 1, story: true }); assert.equal(env.year, 0);
      assert.equal(env.host.querySelector('.es-city-follow'), null);
      const primary = env.button('If these rates continued'); assert.equal(primary.closest('details'), null);
      assert.match(env.host.querySelector('.es-city-story-status')!.textContent, /18 Jun–21 Oct 2026.*measurement period/);
      assert.match(env.host.querySelector('.es-city-caption')!.textContent, /Measured ground motion.*provisional/);
      await env.reduced(true); await env.click('If these rates continued'); assert.equal(env.year, 20);
      await env.render({ mode: 'measured', controlledProgress: 0, story: true }); assert.equal(env.year, 20);
      assert.match(env.host.textContent, /does not estimate damage/);
      assert.equal(env.world.debrisClears, 0); assert.equal(env.world.crossings.length, 0);
      assert.equal(env.host.querySelector('.es-city-follow'), null);
    } finally { await env.close(); }
  });

  await t.test('no-prop standalone scene retains its controls, manual playback and reset', async () => {
    const env = await setup({ mode: 'simulation' });
    try {
      assert.equal(env.year, 0); assert.equal(env.stage.loop, null);
      assert.equal(env.host.querySelector('.es-city-story-controls'), null);
      assert.equal(env.host.querySelector('.es-city-story-status'), null);
      assert.equal(env.host.querySelector('.es-city-follow'), null);
      assert.ok(env.button('Watch the collapse illustration'));
      assert.ok(env.button('Visit illustration year 20'));
      await env.click('Play this scene'); assert.ok(env.stage.loop);
      await env.click('Pause this scene'); assert.equal(env.stage.loop, null);
      await env.seek(8); assert.equal(env.year, 8);
      await env.click('Reset'); assert.equal(env.year, 0);
      assert.equal(env.host.querySelector('.es-city-follow'), null);
    } finally { await env.close(); }
    const measured = await setup();
    try {
      assert.equal(measured.world.kind, 'measured', 'the no-prop default remains measured');
      assert.equal(measured.host.querySelector('.es-city-story-controls'), null);
      assert.ok(measured.button('Overhead view · north up'));
      assert.ok(measured.button('If these rates continued'));
      assert.match(measured.host.textContent, /Show 80 m measurement cells/);
      assert.match(measured.host.textContent, /Colour by ground-motion rate/);
    } finally { await measured.close(); }
  });

  await t.test('recorded collapse sound follows an actual animated threshold crossing, never static seeks or measured projections', async () => {
    const sounds: string[] = [];
    const env = await setup({ mode: 'simulation', story: true, onSoundEvent: event => sounds.push(event) });
    try {
      await env.seek(20); assert.equal(sounds.filter(x => x === 'collapse').length, 0);
      await env.click('Watch the collapse illustration');
      for (let i = 0; i < 110 && env.stage.loop; i++) await act(async () => env.stage.loop?.());
      assert.equal(sounds.filter(x => x === 'collapse').length, 1);
      await env.seek(0); assert.equal(sounds.at(-1), 'stop');
      await env.click('Watch the collapse illustration');
      for (let i = 0; i < 110 && env.stage.loop; i++) await act(async () => env.stage.loop?.());
      assert.equal(sounds.filter(x => x === 'collapse').length, 2, 'a genuine replay gets a fresh physical-event cue');
      await env.visible(false); assert.equal(sounds.at(-1), 'stop');
    } finally { await env.close(); }
    const measured = await setup({ mode: 'measured', story: true, onSoundEvent: event => sounds.push(event) });
    try {
      const before = sounds.filter(x => x === 'collapse').length;
      await measured.seek(30); assert.equal(sounds.filter(x => x === 'collapse').length, before);
    } finally { await measured.close(); }
  });

  await t.test('ambient shares a capped renderer loop, respects every motion gate, preserves manual controls and never ticks scientific time', async () => {
    frameDelta = 1 / 60;
    const props = { mode: 'simulation' as const, controlledProgress: .2, ambient: true, exhibition: true };
    const env = await setup(props, true);
    try {
      assert.equal(env.year, 6);
      assert.ok(env.host.querySelector('.es-city-exhibition'), 'CityScene forwards exhibition');
      assert.match(env.host.textContent, /Street life is illustrative/);
      assert.equal(env.world.ambientToggles.at(-1), true, 'CityScene forwards ambient, enabled by default');
      const times = env.world.times.length; const renders = env.stage.renders; const shadows = env.stage.shadowInvalidations;
      for (let frame = 0; frame < 6; frame++) await act(async () => env.stage.loop!());
      assert.equal(env.world.ambientSteps.length, 3, '60 Hz callbacks produce 30 Hz ambient frames');
      assert.ok(env.world.ambientSteps.every(delta => Math.abs(delta - 1 / 30) < 1e-8));
      assert.equal(env.stage.renders - renders, 3);
      assert.equal(env.stage.shadowInvalidations, shadows, 'ambient reuses cached static shadows');
      assert.equal(env.world.times.length, times); assert.equal(env.year, 6); assert.equal(env.world.physicsSteps, 0);
      await env.pause(); assert.equal(env.stage.loop, null);
      await env.click('Explore in 3D'); assert.ok(env.stage.loop); assert.equal(env.stage.controls.enabled, true);
      await act(async () => env.stage.loop!()); assert.equal(env.world.ambientSteps.length, 3);
      await env.click('Zoom in'); assert.equal(env.world.times.length, times, 'camera controls remain usable during global pause');
      await env.click('Finish moving the view'); assert.equal(env.stage.loop, null);
      await env.pause(); assert.ok(env.stage.loop);
      await env.reduced(true); assert.equal(env.stage.loop, null);
      await env.click('Explore in 3D'); assert.ok(env.stage.loop);
      await act(async () => env.stage.loop!()); assert.equal(env.world.ambientSteps.length, 3);
      await env.click('Finish moving the view'); await env.reduced(false); assert.ok(env.stage.loop);
      await env.hidden(true); assert.equal(env.stage.loop, null);
      await env.hidden(false); assert.ok(env.stage.loop);
      await env.visible(false); assert.equal(env.stage.loop, null);
      await env.visible(true); assert.ok(env.stage.loop);
      const activity = Array.from(env.host.querySelectorAll('label')).find(label => label.textContent === 'Illustrative street life')!.querySelector('input')!;
      await act(async () => activity.click());
      assert.equal(env.world.ambientToggles.at(-1), false); assert.equal(env.stage.loop, null);
      assert.match(env.host.textContent, /Street life is illustrative/, 'honesty label persists with activity off');
      await act(async () => activity.click()); assert.ok(env.stage.loop);
      await env.render({ ...props, ambient: false }); assert.equal(env.stage.loop, null);
      await env.render(props); assert.ok(env.stage.loop);
      assert.equal(env.fixture.worlds.length, 1); assert.equal(env.fixture.stages.length, 1);
      assert.equal(env.world.times.length, times); assert.equal(env.world.physicsSteps, 0);
      const lostLoop = env.stage.loop as unknown as () => void; const previous = env.stage;
      await act(async () => env.host.querySelector('canvas')!.dispatchEvent(new env.window.Event('webglcontextlost', { cancelable: true })));
      assert.equal(previous.loop, null);
      await act(async () => lostLoop()); assert.equal(env.world.ambientSteps.length, 3, 'even an already-queued callback stops at context loss');
      await act(async () => env.host.querySelector('canvas')!.dispatchEvent(new env.window.Event('webglcontextrestored')));
      assert.equal(env.fixture.stages.length, 2); assert.ok(previous.disposed); assert.ok(env.stage.loop);
    } finally { frameDelta = .05; await env.close(); }
  });
});
