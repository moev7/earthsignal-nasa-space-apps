"use client";
import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CityMode } from '@/lib/story-evidence';
import './city3d/city.css';
const City = lazy(() => import('./city3d/SinkingCity3D'));
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="es-scene-placeholder" role="status">The interactive scene could not load. The story, measured map and scene descriptions remain available. Reload the page to try again.</div> : this.props.children; }
}
export function CityScene({ mode, preview = false, controlledProgress, story = false, ambient = false, exhibition = false, manualProgress = false, intro = false, introView = 'landing', onSoundEvent }: { mode: CityMode; preview?: boolean; controlledProgress?: number; story?: boolean; ambient?: boolean; exhibition?: boolean; manualProgress?: boolean; intro?: boolean; introView?: 'landing' | 'neighbourhood'; onSoundEvent?: (event: "collapse" | "stop") => void }) {
  const element = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!element.current) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setReady(true); observer.disconnect(); } }, { rootMargin: '240px' });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const fallback = <div className="es-scene-placeholder" role="status">{mode === 'measured' ? 'A real neighbourhood in south-west Tehran. Mapped buildings; satellite-measured ground motion.' : 'An invented city demonstrates uneven sinking, tilt and illustrative collapse.'}</div>;
  return <div ref={element} className={`es-scene ${preview ? 'es-scene-preview' : ''}`}><SceneBoundary>{ready ? <Suspense fallback={fallback}><City mode={mode} preview={preview} controlledProgress={controlledProgress} story={story} ambient={ambient} exhibition={exhibition} manualProgress={manualProgress} intro={intro} introView={introView} onSoundEvent={onSoundEvent} /></Suspense> : fallback}</SceneBoundary></div>;
}
