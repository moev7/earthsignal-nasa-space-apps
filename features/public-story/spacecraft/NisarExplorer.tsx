'use client';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useStory } from '@/features/ground-truth/components/story/StoryProvider';
import { usePrefersReducedMotion } from '@/features/ground-truth/lib/useTimeline';
import { useVisibleReplay } from '@/features/ground-truth/components/story/useVisibleReplay';
import { HARDWARE_SOURCE, MANUAL_PULSE, PARTS, PULSE_DURATION_MS, PULSE_TEXT, pulseAt } from './spacecraft-model';
import type { CameraAction, PulsePhase, SpacecraftPart, SpacecraftScene, SpacecraftSceneLoader, SpacecraftState } from './types';
import './spacecraft.css';
import { ContextNote } from '../ContextNote';
import { OrbitalScale } from './OrbitalScale';
import { useDiscoverySound } from '../discovery/DiscoverySound';

const loadScene: SpacecraftSceneLoader = () => import('./createSpacecraftScene');
const initial = (): SpacecraftState => ({ selectedPart: 'reflector', interactive: false, pulse: null });

export default function NisarExplorer({ fallback, className = '', sceneLoader = loadScene }: {
  fallback: ReactNode; className?: string; sceneLoader?: SpacecraftSceneLoader;
}) {
  const { paused, replayToken } = useStory();
  const sound=useDiscoverySound(),soundRef=useRef(sound),ownsSound=useRef(false);
  useEffect(()=>{soundRef.current=sound;},[sound]);
  const reduced = usePrefersReducedMotion();
  const id = useId();
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<SpacecraftScene | null>(null);
  const latest = useRef<SpacecraftState>(initial());
  const cameraView = useRef<CameraAction>('overview');
  const generation = useRef(0), raf = useRef<number | null>(null);
  const eligible = useRef(false), surfaceVisible = useRef(false), visibilityEpoch = useRef(0);
  const [mode, setMode] = useState<'hardware' | 'signal' | 'orbit'>('hardware');
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [selected, setSelected] = useState<SpacecraftPart>('reflector');
  const [interactive, setInteractive] = useState(false);
  const [phase, setPhase] = useState<PulsePhase>('idle');
  const lastPhase = useRef<PulsePhase>('idle');
  const [running, setRunning] = useState(false);
  const [visible, setVisible] = useState(false), [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const invalidate = useCallback(() => {
    // Invalidate first: cancelAnimationFrame cannot retract a queued callback.
    generation.current++;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  }, []);
  const cancel = useCallback((publish = true) => {
    invalidate();
    if(ownsSound.current){soundRef.current.silence();ownsSound.current=false;}
    if (publish) setRunning(false);
  }, [invalidate]);
  const setPulse = useCallback((value: number | null) => {
    latest.current.pulse = value;
    const next = pulseAt(value).phase;
    if (next !== lastPhase.current) { lastPhase.current = next; setPhase(next); }
    // Drawing can synchronously report context loss. Publish no state after it.
    scene.current?.pulse(value);
  }, []);
  const reset = useCallback(() => {
    cancel(); setMode('hardware'); latest.current = initial();
    setSelected('reflector'); setInteractive(false); setPulse(null);
    cameraView.current = 'overview'; scene.current?.update(latest.current); scene.current?.view('overview');
  }, [cancel, setPulse]);

  // Layout cleanup closes the permission gate before the next queued frame.
  useLayoutEffect(() => {
    eligible.current = visible && ready && !paused && !reduced && !error;
    if (!eligible.current) cancel();
    return () => { eligible.current = false; cancel(false); };
  }, [visible, ready, paused, reduced, error, cancel]);
  // Even a deferred hidden replay must immediately invalidate an old clock.
  useLayoutEffect(invalidate, [replayToken, invalidate]);
  useVisibleReplay(replayToken, visible, reset);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let intersecting = false, shownBefore = false;
    const ancestors: HTMLElement[] = [];
    for (let parent = node.parentElement; parent; parent = parent.parentElement) ancestors.push(parent);
    const disclosures = ancestors.filter(parent => parent.tagName === 'DETAILS') as HTMLDetailsElement[];
    const sync = () => {
      const shown = intersecting && document.visibilityState !== 'hidden'
        && disclosures.every(details => details.open)
        && ancestors.every(parent => !parent.hidden && parent.getAttribute('aria-hidden') !== 'true');
      if (!shown) {
        eligible.current = false; cancel(); setReady(false);
        latest.current.interactive = false; setInteractive(false);
        // Preserve teardown/rebuild even if hide+show coalesce in one React commit.
        if (shownBefore) { visibilityEpoch.current++; setRetry(value => value + 1); }
      }
      shownBefore = shown; surfaceVisible.current = shown;
      setVisible(shown);
    };
    const observer = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; sync(); }, { threshold: 0.01 }) : null;
    observer?.observe(node);
    if (!observer) { intersecting = true; sync(); }
    const mutations = typeof MutationObserver !== 'undefined' ? new MutationObserver(sync) : null;
    ancestors.forEach(parent => mutations?.observe(parent, { attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'open'] }));
    document.addEventListener('visibilitychange', sync);
    disclosures.forEach(details => details.addEventListener('toggle', sync));
    return () => {
      eligible.current = false; surfaceVisible.current = false; cancel(false);
      observer?.disconnect(); mutations?.disconnect();
      document.removeEventListener('visibilitychange', sync);
      disclosures.forEach(details => details.removeEventListener('toggle', sync));
    };
  }, [cancel]);

  useEffect(() => {
    if (!visible || !canvas.current) return;
    const node = canvas.current;
    let dead = false, active: SpacecraftScene | null = null, resize: ResizeObserver | null = null;
    const epoch = visibilityEpoch.current;
    const valid = () => !dead && surfaceVisible.current && epoch === visibilityEpoch.current;
    const size = () => { const bounds = node.getBoundingClientRect(); active?.resize(bounds.width, bounds.height); };
    const release = () => {
      resize?.disconnect(); resize = null; window.removeEventListener('resize', size);
      const previous = active; active = null;
      if (scene.current === previous) scene.current = null;
      previous?.dispose();
    };
    const lost = (event: Event) => {
      event.preventDefault(); dead = true; eligible.current = false; cancel(); release(); setReady(false);
      setError('The 3D connection was lost. Explore the artist’s concept and manual signal steps below.');
    };
    const restored = () => { setReady(false); setError(null); setRetry(value => value + 1); };
    node.addEventListener('webglcontextlost', lost); node.addEventListener('webglcontextrestored', restored);
    // A loader may throw synchronously, reject, or resolve after teardown.
    Promise.resolve().then(() => valid() ? sceneLoader() : null).then(module => {
      if (!valid() || !module) return;
      const created = module.createSpacecraftScene(node);
      // Constructor-side context loss must not publish a dead renderer.
      if (!valid()) { created.dispose(); return; }
      active = created; scene.current = active;
      active.update(latest.current);
      if (!valid()) return;
      active.view(cameraView.current);
      if (!valid()) return;
      if (typeof ResizeObserver !== 'undefined') { resize = new ResizeObserver(size); resize.observe(node); }
      window.addEventListener('resize', size); size();
      if (!valid()) return;
      setReady(true); setError(null);
    }).catch(() => {
      if (dead) return;
      eligible.current = false; cancel(); release(); setReady(false);
      setError('3D is unavailable on this device. The hardware descriptions, artist’s concept and manual signal steps still work.');
    });
    return () => {
      dead = true; eligible.current = false; cancel(false);
      node.removeEventListener('webglcontextlost', lost); node.removeEventListener('webglcontextrestored', restored); release();
    };
  }, [visible, retry, sceneLoader, cancel]);

  const choose = (part: SpacecraftPart) => {
    cancel(); setMode('hardware'); setPulse(null); latest.current.selectedPart = part; setSelected(part);
    scene.current?.update(latest.current); cameraView.current = part; scene.current?.view(part);
  };
  const view = (action: CameraAction) => { cameraView.current = action; scene.current?.view(action); };
  const signalView = () => { cameraView.current = 'overview'; scene.current?.view('overview'); };
  const step = (next: Exclude<PulsePhase, 'idle'>) => { cancel(); signalView(); setPulse(MANUAL_PULSE[next]); };
  const send = () => {
    setMode('signal'); cancel(); signalView();
    soundRef.current.cue('capture');ownsSound.current=true;
    if (!eligible.current || !scene.current) { setPulse(MANUAL_PULSE.send); return; }
    const token = generation.current;
    let start: number | null = null;
    setRunning(true); setPulse(0);
    const tick = (time: number) => {
      if (token !== generation.current || !eligible.current) return;
      raf.current = null;
      if (start === null) start = time;
      const progress = Math.min(1, Math.max(0, (time - start) / PULSE_DURATION_MS));
      // Guard before all mutation and again before scheduling another callback.
      if (token !== generation.current) return;
      setPulse(progress);
      if (token !== generation.current || !eligible.current) return;
      if (progress < 1) raf.current = requestAnimationFrame(tick);
      else setRunning(false);
    };
    if (token === generation.current && eligible.current) raf.current = requestAnimationFrame(tick);
  };
  const usable = ready && visible && !error;
  const part = PARTS.find(item => item.id === selected)!;
  return <div ref={host} className={`es-spacecraft ${className}`} role="group" aria-label="Explore the NISAR spacecraft">
    <div className="es-spacecraft-heading"><span>NISAR · explore the spacecraft</span><span>Hardware, then a radio echo</span></div>
    <div className="es-spacecraft-modes" role="group" aria-label="Spacecraft exploration mode">
      {([['hardware', 'Inspect hardware'], ['signal', 'Follow an echo'], ['orbit', 'Orbit scale']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => { cancel(); setMode(value); setPulse(null); latest.current.interactive = false; setInteractive(false); scene.current?.update(latest.current); if (value !== 'hardware') signalView(); }}>{label}</button>)}
    </div>
    <div className="es-spacecraft-stage" data-ready={usable} data-mode={mode}>
      <canvas hidden={mode === 'orbit'} key={`${retry}-${visible ? 'visible' : 'hidden'}`} ref={canvas} aria-hidden="true" style={{ visibility: usable ? 'visible' : 'hidden', pointerEvents: usable && interactive ? 'auto' : 'none', touchAction: usable && interactive ? 'none' : 'pan-y' }}/>
      {mode === 'orbit' ? <OrbitalScale/> : error && <div className="es-spacecraft-fallback">{fallback}</div>}
    {!usable && mode !== 'orbit' && <div className="es-spacecraft-status" role="status"><p>{error ?? (visible ? 'Preparing the 3D spacecraft…' : 'The 3D spacecraft loads when in view. Explore the hardware and signal steps below.')}</p>{error && <button type="button" onClick={() => { cancel(); setReady(false); setError(null); setRetry(value => value + 1); }}>Try 3D again</button>}</div>}
    </div>
    <p className="es-spacecraft-scale">{mode === 'orbit' ? 'Orbit to scale · spacecraft enlarged' : mode === 'signal' ? 'Schematic · compressed distance and slowed signal' : 'Schematic · Earth distance and spacecraft size not to scale'}</p>
    <div className="es-spacecraft-stage-actions" aria-label="Spacecraft actions">
      {mode !== 'orbit' && <button type="button" disabled={!usable} aria-pressed={interactive} onClick={() => { latest.current.interactive = !latest.current.interactive; setInteractive(latest.current.interactive); scene.current?.update(latest.current); }}>{interactive ? 'Finish exploring' : 'Rotate view'}</button>}
      {mode !== 'orbit' && <>
        <button type="button" disabled={!usable} aria-label="Zoom spacecraft in" onClick={() => view('in')}>+</button>
        <button type="button" disabled={!usable} aria-label="Zoom spacecraft out" onClick={() => view('out')}>−</button>
        <button type="button" disabled={!usable} onClick={() => view('overview')}>Fit view</button>
      </>}
      {mode === 'signal' && <button type="button" className="es-spacecraft-send" aria-controls={`${id}-signal`} onClick={send}>{running ? 'Restart radar pulse' : 'Send a radar pulse'}</button>}
      {running && <button type="button" onClick={() => cancel()}>Stop pulse</button>}
      <button type="button" onClick={reset}>Reset spacecraft</button>
    </div>
    <div className="es-spacecraft-body">
      <div hidden={mode !== 'hardware'}><div className="es-spacecraft-actions es-spacecraft-parts" role="group" aria-label="Spacecraft hardware">{PARTS.map(item => <button key={item.id} type="button" aria-pressed={selected === item.id} aria-controls={`${id}-hardware`} onClick={() => choose(item.id)}>{item.label}</button>)}</div>
      <div id={`${id}-hardware`} className="es-spacecraft-description" aria-live="polite"><h3>{part.label}</h3><p>{part.explanation}</p><ContextNote label={`${part.label}: facts & source`}><p><strong>{part.fact}</strong></p><a href={HARDWARE_SOURCE}>NASA/JPL quick facts</a></ContextNote></div>
      </div>
      {mode !== 'orbit' && <details className="es-spacecraft-camera"><summary>Camera controls &amp; keyboard alternatives</summary><div className="es-spacecraft-actions" role="group" aria-label="Spacecraft camera">
        {([['left', 'Orbit left'], ['right', 'Orbit right'], ['top', 'Overhead view'], ['in', 'Zoom in'], ['out', 'Zoom out'], ['overview', 'Overview']] as const).map(([action, label]) => <button type="button" key={action} disabled={!usable} onClick={() => view(action)}>{label}</button>)}
      </div>
      <p className="es-spacecraft-hint">Select a part to inspect it instantly. Choose Rotate view to drag or pinch; finish rotating to scroll over the scene. The view buttons also work with a keyboard.</p>
      </details>}
      <div hidden={mode !== 'signal'} className="es-spacecraft-signal" aria-labelledby={`${id}-signal`}>
        <h3 id={`${id}-signal`}>Follow one radar echo</h3>
        <div className="es-spacecraft-steps" role="group" aria-label="Manual signal steps">{([['send', '1 · Send'], ['echo', '2 · Ground echo'], ['receive', '3 · Receive']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={phase === value} onClick={() => step(value)}>{label}</button>)}</div>
        <p className="es-spacecraft-readout" role="status" data-phase={phase}>{PULSE_TEXT[phase]}</p>
        <p className="es-spacecraft-hint">{paused ? 'Story paused · choose a still step.' : reduced ? 'Reduced motion · choose a still step.' : !usable ? 'Manual steps work without 3D.' : 'Press a step to hold the signal still.'}</p>
        <ContextNote label="What can one echo tell us?"><p>This illustrates reflection only. Displacement needs comparison across repeat observations. One short sequence runs per press; manual steps freeze each stage. A canceled pulse stays still until you send another.</p><a href="#radar-model">Explore the repeat-pass radar lesson</a></ContextNote>
      </div>
      <details className="es-spacecraft-sources" onToggle={event => setSourcesOpen(event.currentTarget.open)}><summary>Sources, artist’s concept and context</summary><p>Earth and orbit share one distance scale only in Orbit scale mode; the spacecraft uses an enlarged locator. The close-up compresses the radio path and slows the signal for teaching. Procedural schematic, not engineering CAD, a live orbit, acquired imagery or a performance simulation. Hardware: <a href={HARDWARE_SOURCE}>NASA/JPL NISAR quick facts</a>. Earth texture: <a href="https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/">NASA Blue Marble</a>, NASA GSFC / Reto Stöckli and Robert Simmon, a historical global mosaic for context. Earth and the spacecraft are deliberately shown at different scales. NISAR has both radar bands; the connected Tehran result uses L-band only, with no new S-band data.</p>{sourcesOpen && fallback}</details>
    </div>
  </div>;
}
