"use client";
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import * as THREE from 'three';
import { Pause, Play, RotateCcw, Move, X } from 'lucide-react';
import { advanceSceneTime, sceneEvidence, sceneTimeLabel, type CityMode } from '@/lib/story-evidence';
import { NISAR_BUNDLES, formatPeriod, useNisarFocus } from '@/features/ground-truth/data/nisar';
import { usePrefersReducedMotion } from '@/features/ground-truth/lib/useTimeline';
import { useStory } from '../StoryProvider';
import { useVisibleReplay } from '../useVisibleReplay';
import { EXAG, T_MAX, createStage, type CityWorld, type Stage } from './shared';
import { createSimulationWorld, type SimulationWorld } from './simulationWorld';
import { createMeasuredWorld, type MeasuredWorld } from './measuredWorld';
import { MEASURED_EPOCH, TILT_LIMITS } from './cityIntro';
import { ScenarioDetails } from './ScenarioDetails';
import { AMBIENT_BUDGET } from './ambient';

type Tween = { from: number; to: number; elapsed: number; duration: number; linear?: boolean; intro?: boolean };

/** Length of the opening fast-forward through 30 projected years. */
export const INTRO_MS = 5000;
/** Share of the square's half-diagonal kept in view when the opening frames the whole square. */
export const INTRO_FIT = 0.68;

/** Invalid progress must hold the last valid pose, rather than poison the world. */
export function cityProgressTime(progress: number | undefined): number | null {
  return progress !== undefined && Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) * T_MAX : null;
}

/** Whether an invented collapse is still in motion (worlds without physics never are). */
function isSettling(world: CityWorld | null): boolean {
  if (world?.kind !== 'simulation') return false;
  const simulation = world as SimulationWorld;
  return typeof simulation.isSettling === 'function' && simulation.isSettling();
}

export default function SinkingCity3D({ mode = 'measured', preview = false, controlledProgress, story = false, ambient = false, exhibition = false, manualProgress = false, intro = false, introView = 'landing', onSoundEvent }: { mode?: CityMode; preview?: boolean; controlledProgress?: number; story?: boolean; ambient?: boolean; exhibition?: boolean; manualProgress?: boolean;
  /** Once ready and visible, run 30 projected years in 5 seconds with the shared HUD. */
  intro?: boolean; introView?: 'landing' | 'neighbourhood'; onSoundEvent?: (event: "collapse" | "stop") => void }) {
  const { paused, replayToken } = useStory();
  const reducedMotion = usePrefersReducedMotion();
  const id = useId();
  const [years, setYears] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Preview scenes (the opening) can be dragged from the start; others opt in via "Explore in 3D".
  const [interactive, setInteractive] = useState(preview);
  const [touched, setTouched] = useState(false);
  const [colours, setColours] = useState(true);
  const [cells, setCells] = useState(false);
  const [visible, setVisible] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const [activity, setActivity] = useState(true);
  const ambientEnabled = ambient && activity;
  const [world, setWorld] = useState<CityWorld | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [transitionKey, setTransitionKey] = useState(0);
  const [futureOpen, setFutureOpen] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);
  const [introState, setIntroState] = useState<'idle' | 'running' | 'done'>('idle');
  const introStarted = useRef(false);
  const showIntro = intro && mode === 'measured';
  const followsScroll = mode === 'simulation' && controlledProgress !== undefined;
  const latestScrollTime = useRef<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage | null>(null);
  const currentWorld = useRef<CityWorld | null>(null);
  const time = useRef(0);
  const soundCallback = useRef(onSoundEvent), collapseAt = useRef<number | null>(null);
  useEffect(() => { soundCallback.current = onSoundEvent; }, [onSoundEvent]);
  const animatedPose = useRef(false);
  const tween = useRef<Tween | null>(null);
  const contextLost = useRef(false);
  const state = useRef({ playing, paused, visible, reducedMotion, documentVisible, ambientEnabled });
  const focusState = useNisarFocus(mode === 'measured' ? NISAR_BUNDLES.tehran : null);
  const focus = focusState?.status === 'ready' ? focusState.data : null;
  useEffect(() => { state.current = { playing, paused, visible, reducedMotion, documentVisible, ambientEnabled }; }, [playing, paused, visible, reducedMotion, documentVisible, ambientEnabled]);
  useEffect(() => {
    const changed = () => setDocumentVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  useEffect(() => {
    if (!wrap.current) return;
    const observer = new IntersectionObserver(([entry]) => { setVisible(entry.isIntersecting); if (!entry.isIntersecting && mode === "simulation") soundCallback.current?.("stop"); }, { threshold: 0.05 });
    observer.observe(wrap.current);
    return () => observer.disconnect();
  }, [mode]);
  const applyTime = useCallback((value: number, animate = false, render = true) => {
    if (!Number.isFinite(value)) return;
    const next = Math.max(0, Math.min(T_MAX, value));
    const forward = next > time.current;
    const crossing = currentWorld.current?.kind === "simulation" && animate && forward && collapseAt.current !== null && time.current < collapseAt.current && next >= collapseAt.current;
    if (!animate && currentWorld.current?.kind === "simulation") soundCallback.current?.("stop");
    if (currentWorld.current?.kind === 'simulation' && (next < time.current || (!animate && animatedPose.current))) {
      const simulation = currentWorld.current as SimulationWorld;
      simulation.clearDebris(); simulation.resetCrossings(next);
      // Restore collapsed meshes/chunks before recomputing a backward still.
      // Otherwise a building already past its threshold keeps its later pose.
      if (!animate) { simulation.setTime(0, false, false); simulation.step(0, 0); }
    }
    animatedPose.current = animate;
    time.current = next;
    currentWorld.current?.setTime(next, forward, animate);
    if (crossing && state.current.visible && state.current.documentVisible && !state.current.paused && !state.current.reducedMotion) soundCallback.current?.("collapse");
    stage.current?.invalidateShadows?.();
    if (render && stage.current) stage.current.renderer.render(stage.current.scene, stage.current.camera);
    setYears(next);
  }, []);
  // World and GPU resources have one owner, including mode changes and StrictMode cleanup.
  useEffect(() => {
    if (!canvas.current || (mode === 'measured' && !focus)) return;
    const node = canvas.current;
    let active: Stage | null = null;
    let city: CityWorld | null = null;
    let resize: ResizeObserver | null = null;
    const lost = (event: Event) => { event.preventDefault(); contextLost.current = true; active?.renderer.setAnimationLoop(null); setPlaying(false); setError('The 3D connection was lost. The explanation and measured map remain available.'); };
    const restored = () => { setError(null); setRetry(value => value + 1); };
    node.addEventListener('webglcontextlost', lost);
    node.addEventListener('webglcontextrestored', restored);
    try {
      active = createStage(node, exhibition);
      contextLost.current = false;
      stage.current = active;
      city = mode === 'measured' && focus ? createMeasuredWorld(active, focus.focus, focus.bundle.manifest.layers.vertical_rate.colour.stops) : createSimulationWorld(active);
      currentWorld.current = city;
      collapseAt.current = city.kind === "simulation" ? (city as SimulationWorld).fallShot().year : null;
      active.camera.position.copy(city.view.position);
      active.controls.target.copy(city.view.target);
      active.controls.enabled = false;
      active.controls.enableZoom = true;
      active.controls.update();
      city.setTime(0, false, false);
      city.setRisk(true);
      time.current = 0; animatedPose.current = false; tween.current = null;
      // Publish the newly created external renderer/world to React controls.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setYears(0); setPlaying(false); setInteractive(preview); setSelected(null); setWorld(city); setError(null);
      const size = () => {
        if (!active || !city) return;
        active.resize(node.clientWidth, node.clientHeight);
        city.resize?.(active.renderer.getDrawingBufferSize(new THREE.Vector2()).y, active.camera.fov);
        active.renderer.render(active.scene, active.camera);
      };
      resize = new ResizeObserver(size); resize.observe(node); size();
    } catch { setError('3D is unavailable on this device. The story, scene description and measured map remain available.'); }
    return () => {
      node.removeEventListener('webglcontextlost', lost); node.removeEventListener('webglcontextrestored', restored);
      resize?.disconnect(); active?.renderer.setAnimationLoop(null); city?.dispose(); active?.dispose();
      if (city?.kind === "simulation") soundCallback.current?.("stop");
      collapseAt.current = null; currentWorld.current = null; stage.current = null;
    };
  }, [mode, focus, retry, exhibition, preview]);
  // Explicit chapter buttons are still-state commands, including during pause
  // or reduced motion. A new command takes back time authority from local play.
  useEffect(() => {
    if (!manualProgress || !followsScroll) return;
    tween.current = null;
    let active = true;
    queueMicrotask(() => { if (active) { setPlaying(false); setManualOverride(false); } });
    return () => { active = false; };
  }, [controlledProgress, manualProgress, followsScroll]);
  // Scroll only seeks the existing simulation. Keep the latest valid target while
  // motion is gated, so returning/resuming reconciles without a second clock.
  useEffect(() => {
    if (!followsScroll) { latestScrollTime.current = null; return; }
    const next = cityProgressTime(controlledProgress);
    if (next !== null) latestScrollTime.current = next;
    if (!world || world.kind !== 'simulation' || error || ((paused || reducedMotion) && !manualProgress) || !visible || !documentVisible || manualOverride || latestScrollTime.current === null) return;
    if (latestScrollTime.current !== time.current || animatedPose.current) applyTime(latestScrollTime.current);
  }, [controlledProgress, followsScroll, manualProgress, world, error, paused, reducedMotion, visible, documentVisible, manualOverride, applyTime]);
  const takeManualControl = useCallback(() => {
    if (followsScroll) setManualOverride(true);
    // Inspecting the scene takes time authority from its finite introduction.
    // Ambient street life can continue, but the projected year stays still.
    if (tween.current?.intro) {
      tween.current = null;
      setIntroState('done');
      setTransitionKey(value => value + 1);
    }
  }, [followsScroll]);
  useEffect(() => {
    const controls = stage.current?.controls;
    if (!controls) return;
    controls.addEventListener('start', takeManualControl);
    return () => controls.removeEventListener('start', takeManualControl);
  }, [world, takeManualControl]);
  useEffect(() => { if (stage.current) { stage.current.controls.enabled = interactive; stage.current.controls.enableZoom = !preview; } }, [interactive, world, preview]);
  useEffect(() => { currentWorld.current?.setRisk(colours); if (stage.current) stage.current.renderer.render(stage.current.scene, stage.current.camera); }, [colours, world]);
  useEffect(() => { const city = currentWorld.current; if (city?.kind === 'measured') (city as MeasuredWorld).setCells(cells); if (stage.current) stage.current.renderer.render(stage.current.scene, stage.current.camera); }, [cells, world]);
  useEffect(() => {
    currentWorld.current?.setAmbient?.(ambientEnabled);
    // The first activation retires the simulation's original static cars.
    // Refresh once so their cached shadows cannot remain as ghost traffic.
    stage.current?.invalidateShadows?.();
    if (stage.current && !contextLost.current) stage.current.renderer.render(stage.current.scene, stage.current.camera);
  }, [ambientEnabled, world]);
  useEffect(() => {
    const active = stage.current;
    if (!active || !world || error) return;
    if (!visible || !documentVisible || (!interactive && (paused || reducedMotion || (!playing && !tween.current && !ambientEnabled)))) {
      active.renderer.setAnimationLoop(null);
      if (visible && documentVisible) active.renderer.render(active.scene, active.camera);
      return;
    }
    const clock = new THREE.Clock();
    let accumulated = 0;
    active.renderer.setAnimationLoop(() => {
      const current = state.current;
      if (contextLost.current || !current.visible || !current.documentVisible) { active.renderer.setAnimationLoop(null); return; }
      accumulated += Math.min(clock.getDelta(), 0.1);
      const running = !current.paused && !current.reducedMotion;
      // A collapse keeps moving after the timeline stops: tipping, breaking apart,
      // falling pieces and dust need real seconds, so keep stepping until it settles.
      const settling = running && isSettling(currentWorld.current);
      const scientific = running && (current.playing || Boolean(tween.current) || settling);
      // Ambient frames share this renderer loop, with accumulated elapsed time.
      // No world.setTime/ground remesh/React state update occurs on these frames.
      if (!interactive && !scientific && running && current.ambientEnabled && accumulated < 1 / AMBIENT_BUDGET.fps) return;
      const ambientSeconds = accumulated;
      const seconds = Math.min(accumulated, 0.05);
      accumulated = 0;
      if (running && tween.current) {
        const move = tween.current; move.elapsed += seconds * 1000;
        const k = Math.min(1, move.elapsed / move.duration);
        applyTime(move.from + (move.to - move.from) * (move.linear ? k : 1 - Math.pow(1 - k, 3)), true, false);
        if (k === 1) { tween.current = null; if (move.intro) setIntroState('done'); }
      } else {
        const next = advanceSceneTime(time.current, seconds, current);
        if (next !== time.current) applyTime(next, true, false);
        if (next >= T_MAX && current.playing) setPlaying(false);
      }
      if (scientific) {
        currentWorld.current?.step(seconds, time.current);
        active.invalidateShadows?.();
      }
      if (running && current.ambientEnabled) currentWorld.current?.stepAmbient?.(ambientSeconds);
      active.controls.update(); active.renderer.render(active.scene, active.camera);
      if (!current.playing && !tween.current && !settling && !interactive && !(running && current.ambientEnabled)) active.renderer.setAnimationLoop(null);
    });
    return () => active.renderer.setAnimationLoop(null);
  }, [world, visible, documentVisible, error, applyTime, playing, paused, reducedMotion, interactive, ambientEnabled, transitionKey]);
  // Opening: ground-tilt colours, then a steady 2026 → 2056 fast-forward once the
  // scene is ready and on screen. Story pause and reduced motion are respected.
  // Opening framing: aim at the centre of the measured square (not the buildings'
  // average) and back off until nearly the whole square fits this screen, keeping
  // the neighbourhood view's viewing angle.
  const fitWholeSquare = useCallback(() => {
    const active = stage.current;
    const city = currentWorld.current;
    if (!active || !city || !focus || contextLost.current) return;
    const { east, north } = focus.focus.grid;
    const spacing = focus.focus.spacing_m;
    const width = east.length * spacing;
    const depth = north.length * spacing;
    const target = new THREE.Vector3((east[0] + east[east.length - 1]) / 2, city.view.target.y, -(north[0] + north[north.length - 1]) / 2);
    const direction = (introView === 'neighbourhood' ? new THREE.Vector3(430, 430, -650) : city.view.position.clone().sub(city.view.target)).normalize();
    const vertical = THREE.MathUtils.degToRad(active.camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * active.camera.aspect);
    const fit = introView === 'neighbourhood' ? 0.74 : INTRO_FIT;
    const radius = 0.5 * Math.hypot(width, depth) * fit;
    const distance = Math.min(active.controls.maxDistance, radius / Math.sin(Math.min(vertical, horizontal) / 2));
    active.controls.target.copy(target);
    active.camera.position.copy(target).addScaledVector(direction, distance);
    active.controls.update();
    active.renderer.render(active.scene, active.camera);
  }, [focus, introView]);
  // A new world starts in rate colours; only the opening switches to tilt colours.
  useEffect(() => {
    if (!showIntro || world?.kind !== 'measured') return;
    (world as MeasuredWorld).setColourMode('tilt');
    fitWholeSquare();
  }, [world, showIntro, fitWholeSquare]);
  // Keep the whole square framed when the opening's size changes, until the visitor moves it.
  useEffect(() => {
    const node = canvas.current;
    if (!showIntro || !world || !node || touched) return;
    const observer = new ResizeObserver(() => fitWholeSquare());
    observer.observe(node);
    return () => observer.disconnect();
  }, [showIntro, world, touched, fitWholeSquare]);
  const runIntro = useCallback(() => {
    applyTime(0);
    tween.current = { from: 0, to: T_MAX, elapsed: 0, duration: INTRO_MS, linear: true, intro: true };
    setPlaying(false); setIntroState('running'); setTransitionKey(value => value + 1);
  }, [applyTime]);
  useEffect(() => {
    if (!showIntro || introStarted.current || world?.kind !== 'measured' || error) return;
    if (!visible || !documentVisible || paused || reducedMotion) return;
    introStarted.current = true;
    queueMicrotask(runIntro);
  }, [showIntro, world, error, visible, documentVisible, paused, reducedMotion, runIntro]);
  const reset = useCallback(() => {
    const city = currentWorld.current;
    if (city?.kind === 'simulation') { (city as SimulationWorld).clearDebris(); (city as SimulationWorld).resetCrossings(); }
    tween.current = null; setPlaying(false); setSelected(null); setFutureOpen(false); applyTime(0);
    setIntroState(state => state === 'running' ? 'done' : state);
  }, [applyTime]);
  const replay = useCallback(() => { reset(); setManualOverride(false); }, [reset]);
  useVisibleReplay(replayToken, visible && !preview && Boolean(world), replay);
  const seek = (value: number) => {
    takeManualControl();
    tween.current = null; setPlaying(false);
    setIntroState(state => state === 'running' ? 'done' : state);
    applyTime(value);
  };
  const project = () => { takeManualControl(); setFutureOpen(true); if (reducedMotion) seek(20); else { setPlaying(false); tween.current = { from: time.current, to: 20, elapsed: 0, duration: 4000 }; setTransitionKey(value => value + 1); } };
  const watchFall = () => {
    const city = currentWorld.current; const active = stage.current;
    if (!city || !active || city.kind !== 'simulation') return;
    takeManualControl();
    const simulation = city as SimulationWorld; const shot = simulation.fallShot();
    simulation.clearDebris(); simulation.resetCrossings(Math.max(0, shot.year - 1.2)); applyTime(Math.max(0, shot.year - 1.2));
    active.camera.position.copy(shot.position); active.controls.target.copy(shot.target); active.controls.update();
    setPlaying(false); setSelected(null);
    if (reducedMotion) seek(shot.year + 1.6);
    else tween.current = { from: time.current, to: shot.year + 1.6, elapsed: 0, duration: 4500 };
    setTransitionKey(value => value + 1);
  };
  const down = useRef<{ x: number; y: number } | null>(null);
  const pick = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive || !down.current || !stage.current || !world || Math.hypot(event.clientX - down.current.x, event.clientY - down.current.y) > 6) return;
    const rect = event.currentTarget.getBoundingClientRect(); const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), stage.current.camera);
    setSelected(world.pick(ray));
  };
  const zoom = (factor: number) => { const active = stage.current; if (!active) return; takeManualControl(); active.camera.position.sub(active.controls.target).multiplyScalar(factor).clampLength(120, exhibition ? 3600 : 1600).add(active.controls.target); active.controls.update(); active.renderer.render(active.scene, active.camera); };
  const frameCamera = (overhead: boolean) => {
    const active = stage.current;
    if (!active || !world) return;
    // Clear residual orbit damping before applying an explicit, motion-free preset.
    const damping = active.controls.enableDamping;
    active.controls.enableDamping = false;
    active.controls.update();
    active.controls.target.copy(world.view.target);
    if (overhead) {
      const distance = world.view.position.distanceTo(world.view.target);
      // Geographic north is -z in the measured world. The tiny south offset
      // avoids a singular look-at while keeping north at the top of the view.
      active.camera.position.copy(world.view.target).add(new THREE.Vector3(0, distance, 0.01));
    } else active.camera.position.copy(world.view.position);
    active.controls.update();
    active.controls.enableDamping = damping;
    active.renderer.render(active.scene, active.camera);
  };
  const followStory = () => {
    tween.current = null; setPlaying(false); setInteractive(false); setSelected(null); setManualOverride(false);
    setTransitionKey(value => value + 1);
    frameCamera(false);
    if (currentWorld.current?.kind === 'simulation') {
      const simulation = currentWorld.current as SimulationWorld;
      simulation.clearDebris(); simulation.resetCrossings(latestScrollTime.current ?? time.current);
    }
    if (!paused && !reducedMotion && visible && latestScrollTime.current !== null) applyTime(latestScrollTime.current);
  };
  const loadError = focusState?.status === 'error' ? focusState.message : null;
  const tip = world && selected !== null ? world.tip(selected, years) : null;
  const evidence = sceneEvidence(mode, years);
  const status = evidence === 'illustrated' ? 'Illustration · invented city' : evidence === 'projected' ? 'Projection · if these rates continued' : 'Measured ground motion · provisional';
  const measuredRates = futureOpen && focus ? focus.focus.grid.vertical_rate.flat().filter((value):value is number=>value!==null).sort((a,b)=>a-b) : [];
  const simulationSummary = futureOpen && world?.kind==='simulation' ? (world as SimulationWorld).summaryAt(years) : null;
  const controls = <>
      <div className="es-city-controls">
        {!story && <button type="button" disabled={!world || Boolean(error)} aria-pressed={interactive} onClick={() => { takeManualControl(); setInteractive(value => !value); }}><Move size={17} aria-hidden="true" />{interactive ? 'Finish moving the view' : 'Explore in 3D'}</button>}
        <button type="button" disabled={!world || Boolean(error) || paused || reducedMotion} onClick={() => { takeManualControl(); if (years >= T_MAX) reset(); tween.current = null; setPlaying(value => !value); }} aria-label={playing ? 'Pause this scene' : 'Play this scene'}>{playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}<span>{playing ? 'Pause' : 'Play'}</span></button>
        <button type="button" disabled={!world || Boolean(error)} onClick={() => { takeManualControl(); reset(); }}><RotateCcw size={17} aria-hidden="true" /><span>Reset</span></button>
        <label className="es-city-timeline" htmlFor={`${id}-time`}><span>{sceneTimeLabel(mode, years)}</span><input id={`${id}-time`} aria-label={mode === 'simulation' ? 'Illustration years' : 'Years beyond the measurement period'} type="range" min={0} max={30} step={0.1} value={years} disabled={!world || Boolean(error)} onChange={event => seek(Number(event.target.value))} /></label>
        {(!story || mode === 'simulation') && <button type="button" disabled={!world || Boolean(error) || paused} onClick={project}>{mode==='measured'?'If these rates continued':'Visit illustration year 20'}</button>}
        {!story && mode === 'simulation' && <button type="button" disabled={!world || Boolean(error) || paused} onClick={watchFall}>Watch the collapse illustration</button>}
      </div>
      {futureOpen && <section className="es-city-future" aria-label="Selected future scenario summary"><div><h4>{mode==='measured'?`If these rates continued for ${years.toFixed(1)} years`:`Invented city · illustration year ${years.toFixed(1)}`}</h4><button type="button" aria-label="Close future summary" onClick={()=>setFutureOpen(false)}>Close</button></div>{mode==='measured'&&measuredRates.length>0?<><p>The median ground cell would be {Math.abs(measuredRates[Math.floor(measuredRates.length/2)]*years/1000).toFixed(1)} m {measuredRates[Math.floor(measuredRates.length/2)]<0?'lower':'higher'} relative to the regional reference. The fastest-sinking cell would be {Math.abs(measuredRates[0]*years/1000).toFixed(1)} m lower.</p><p>This extends four months of provisional observations at a fixed rate. Sinking can slow, accelerate or stop. It does not estimate damage to these buildings.</p></>:simulationSummary&&<p>In this invented model, {simulationSummary.cracked} buildings show cracks or worse, {simulationSummary.damaged} show illustrative structural damage and {simulationSummary.falling} are shown falling. These counts describe the teaching simulation.</p>}</section>}
      <p className="es-city-note">{paused ? 'Story animations are paused. Resume in the story controls. ' : ''}{reducedMotion ? 'Reduced motion is on: use the slider to compare still states. ' : ''}{mode === 'measured' ? `${focus ? formatPeriod(focus.bundle.manifest) : 'June–October 2026'}. Four months of provisional observations; future movement assumes these rates continue. This is not a building-damage forecast.` : 'The ground, buildings and rates are invented. Collapse is an exaggerated teaching illustration, not an engineering prediction.'}</p>
      <details className="es-city-options"><summary>View controls and more detail</summary><div className="es-city-option-row">
        <button type="button" disabled={!world || Boolean(error)} onClick={() => zoom(0.8)}>Zoom in</button><button type="button" disabled={!world || Boolean(error)} onClick={() => zoom(1.25)}>Zoom out</button><button type="button" disabled={!world || Boolean(error)} onClick={() => { takeManualControl(); if (showIntro) fitWholeSquare(); else frameCamera(false); }}>Neighbourhood view</button>
        {mode === 'measured' && <button type="button" disabled={!world || Boolean(error)} onClick={() => { takeManualControl(); frameCamera(true); }}>Overhead view · north up</button>}
        <label><input type="checkbox" checked={colours} onChange={event => setColours(event.target.checked)} />{mode === 'measured' ? 'Colour by ground-motion rate' : 'Illustrative damage colours'}</label>
        {mode === 'measured' && <label><input type="checkbox" checked={cells} onChange={event => setCells(event.target.checked)} />Show 80 m measurement cells</label>}
        {ambient && <label><input type="checkbox" checked={activity} onChange={event => setActivity(event.target.checked)} />Illustrative street life</label>}
      </div><p>Choose “Explore in 3D” to drag and orbit. Scrolling stays available outside this mode. Use the zoom buttons and building list as keyboard alternatives.{mode === 'measured' && ' Overhead view puts north at the top; combine it with measurement cells to read the ground pattern.'}</p>
        {mode === 'measured' && focus && <p>OpenStreetMap supplies {focus.focus.buildings.length} footprints, streets and parks. Unmapped buildings are not unaffected. Heights are mostly estimates; roof details are generic. Typical uncertainty ±{Math.round(focus.bundle.manifest.stats.median_sigma)} mm/year per 80 m pixel. Read neighbourhood patterns, not individual buildings. © OpenStreetMap contributors, ODbL.</p>}
        {mode === 'measured' && exhibition && <p>Canopy positions are illustrative within mapped parks.</p>}
        {mode === 'measured' && <p>Wall colours show the measured ground-motion rate: warm colours indicate sinking, cool colours apparent upward motion and grey an unresolved value. These are not damage colours.</p>}
        {mode === 'simulation' && world && <p>{world.buildingCount} invented buildings demonstrate uneven sinking. Colours and collapse are illustrative, without predicting actual damage.</p>}
        {world && <label>Inspect a building<select aria-label="Inspect a building" value={selected ?? ''} onChange={event => setSelected(event.target.value === '' ? null : Number(event.target.value))}><option value="">Choose a building</option>{Array.from({ length: world.buildingCount }, (_, index) => <option key={index} value={index}>Building {index + 1}</option>)}</select></label>}
      </details>
      {world && <ScenarioDetails world={world} mode={mode} years={years} selected={selected} onSeek={seek}/>}
      {tip && <section className="es-city-inspector" aria-label="Selected building information"><div><h4>{tip.title}</h4><button type="button" aria-label="Close building information" onClick={() => setSelected(null)}><X size={18} /></button></div><p>{mode === 'measured' ? 'Ground information only — not a safety assessment.' : 'Invented building in the teaching simulation.'}</p><dl>{tip.rows.map(row => <div key={row.term}><dt>{row.term}</dt><dd>{row.value}</dd></div>)}</dl><p>{tip.note}</p></section>}

  </>;
  return <div className={`es-city ${preview ? 'es-city-preview' : ''} ${exhibition ? 'es-city-exhibition' : ''}`} data-evidence={evidence} data-testid={`city-${mode}`}>
    <div className="es-city-stage" ref={wrap}>
      <canvas ref={canvas} aria-label={mode === 'simulation' ? 'Invented city demonstrating uneven sinking, tilt and illustrative collapse' : 'Mapped Tehran footprints with measured ground-motion rates and optional future extrapolation'} style={{ visibility: !world || error || loadError ? 'hidden' : 'visible', touchAction: interactive && !preview ? 'none' : 'pan-y', pointerEvents: interactive ? 'auto' : 'none', cursor: interactive ? 'grab' : undefined }} onPointerDown={event => { down.current = { x: event.clientX, y: event.clientY }; setTouched(true); }} onPointerUp={pick} />
      {preview && world && !error && !loadError && <div className="es-city-handle">
        <p className={`es-city-hint ${touched ? 'is-faded' : ''}`} aria-hidden={touched}>
          <Move size={15} aria-hidden="true" /> Drag to look around · right-drag or two fingers to move
        </p>
        <div className="es-city-zoom" role="group" aria-label="3D view">
          <button type="button" aria-label="Zoom in" onClick={() => { setTouched(true); zoom(0.75); }}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => { setTouched(true); zoom(1.33); }}>−</button>
          <button type="button" aria-label="Reset view" onClick={() => { setTouched(true); if (showIntro) fitWholeSquare(); else frameCamera(false); }}><RotateCcw size={14} aria-hidden="true" /></button>
        </div>
      </div>}
      {ambient && <p className="es-city-activity-label">Street life is illustrative</p>}
      {showIntro && world && !error && !loadError && <div className="es-city-intro" data-state={introState} aria-live="off">
        <p className="es-city-intro-year"><span>{Math.floor(MEASURED_EPOCH + years)}</span><small>{years < 0.05 ? 'measured' : 'if 2026 rates continue'}</small></p>
        <ul aria-label="Buildings by how far the ground beneath them has tilted">
          {TILT_LIMITS.map(limit => <li key={limit.r} title={`${limit.label} (${limit.meaning})`}><i style={{ background: limit.colour }} aria-hidden="true" /><b>{world.countAt(limit.r, years)}</b><span>{limit.short}</span></li>)}
        </ul>
        <p className="es-city-intro-note">Ground tilt under buildings, not observed damage</p>
        {(introState === 'done' || reducedMotion || paused) && <button type="button" disabled={paused && !reducedMotion} onClick={() => { takeManualControl(); if (reducedMotion) seek(years > 0 ? 0 : T_MAX); else runIntro(); }}>{reducedMotion ? (years > 0 ? 'Back to 2026' : 'Show 2056') : 'Replay 30 years'}</button>}
      </div>}
      {(!world || error || loadError) && <div className="es-city-fallback" role="status"><p>{error || (loadError ? 'The measured neighbourhood could not be verified. No substitute data is shown.' : 'Preparing the neighbourhood…')}</p>{(error || loadError) && <p>{mode === 'measured' ? 'Satellite observations show uneven ground movement across south-west Tehran. Use the verified map for available measurements.' : 'Uneven sinking can tilt and damage structures. This invented city explains the mechanism; it does not diagnose real buildings.'}</p>}{error && <button type="button" onClick={() => { setError(null); setRetry(value => value + 1); }}>Try 3D again</button>}</div>}
    </div>
    <div className="es-city-caption"><strong>{status}</strong><span>{mode === 'measured' ? 'Mapped footprints · heights mostly estimated' : 'Not a prediction for a real city'} · movement ×{EXAG}</span></div>
    {!preview && <>
      {story && <div className="es-city-story-status">
        <p className="es-city-note">{mode === 'measured' && years === 0 ? `${focus ? formatPeriod(focus.bundle.manifest) : 'June–October 2026'} · measurement period` : mode === 'measured' ? `${years.toFixed(1)} years beyond the observations` : sceneTimeLabel(mode, years)}</p>
        <div className="es-city-story-actions"><button type="button" disabled={!world || Boolean(error)} aria-pressed={interactive} onClick={() => { takeManualControl(); setInteractive(value => !value); }}><Move size={17} aria-hidden="true" />{interactive ? 'Finish exploring' : 'Explore in 3D'}</button>
        <button type="button" className="es-city-story-action" aria-label={mode === 'simulation' ? 'Watch the collapse illustration' : undefined} disabled={!world || Boolean(error) || paused} onClick={mode === 'measured' ? () => { if (years > 0) applyTime(0); project(); } : watchFall}>{mode === 'measured' ? years > 0 ? 'Replay projection' : 'If these rates continued' : 'Watch collapse'}</button></div>
      </div>}
      {followsScroll && manualOverride && <button type="button" className="es-city-follow" disabled={!world || Boolean(error)} onClick={followStory}>Follow the story</button>}
      {story ? <details className="es-city-story-controls"><summary>Timeline &amp; view settings</summary>{controls}</details> : controls}
    </>}
  </div>;
}
