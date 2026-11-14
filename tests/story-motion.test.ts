import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { useVisibleReplay } from '../features/ground-truth/components/story/useVisibleReplay';
import { useTimeline, type TimelineControls } from '../features/ground-truth/lib/useTimeline';

test('offscreen replay remains pending, and reduced motion permits still-state seeking without animation', async () => {
  const window = new Window({ url: 'http://localhost/' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const install = (key: string, value: unknown) => { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; }, cancelAnimationFrame: (id: number) => { frames.delete(id); } })) install(key, value);
  let reduced = true;
  const motionListeners = new Set<() => void>();
  window.matchMedia = (() => ({ get matches() { return reduced; }, addEventListener(_type: string, listener: () => void) { motionListeners.add(listener); }, removeEventListener(_type: string, listener: () => void) { motionListeners.delete(listener); } })) as unknown as typeof window.matchMedia;
  const { createRoot } = await import('react-dom/client');
  const container = window.document.createElement('div');
  const root = createRoot(container as unknown as HTMLElement);
  let resets = 0;
  let timeline: TimelineControls;
  const reset = () => { resets++; };
  function Fixture({ token, visible }: { token: number; visible: boolean }) {
    useVisibleReplay(token, visible, reset);
    timeline = useTimeline(1000);
    return React.createElement('output', null, timeline.progress);
  }
  const render = async (token: number, visible: boolean) => { await act(async () => { root.render(React.createElement(Fixture, { token, visible })); }); };
  try {
    await render(0, true);
    assert.equal(timeline!.progress, 1);
    assert.equal(timeline!.playing, false);
    assert.equal(frames.size, 0, 'reduced motion cancels the animation clock');
    await act(async () => { timeline!.seek(.25); });
    assert.equal(timeline!.progress, .25, 'manual still states remain available');
    await render(1, false);
    await render(2, false);
    assert.equal(resets, 0, 'hidden scenes retain the request');
    await render(2, true);
    assert.equal(resets, 1, 'the latest request is applied on return');
    await render(2, true);
    assert.equal(resets, 1, 'the same request is consumed once');
    assert.equal(frames.size, 0);
    await act(async () => { reduced = false; for (const listener of motionListeners) listener(); });
    await act(async () => { timeline!.play(); });
    assert.equal(timeline!.playing, true);
    assert.equal(frames.size, 1, 'motion can resume after an explicit play action');
    await act(async () => { reduced = true; for (const listener of motionListeners) listener(); });
    assert.equal(timeline!.progress, 1, 'enabling reduced motion selects the finished still state');
    assert.equal(timeline!.playing, false);
    assert.equal(frames.size, 0, 'changing the preference cancels the active clock');
    await act(async () => { timeline!.seek(.4); });
    assert.equal(timeline!.progress, .4, 'manual seeking remains usable after the preference changes');
  } finally {
    await act(async () => root.unmount());
    await window.happyDOM.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
