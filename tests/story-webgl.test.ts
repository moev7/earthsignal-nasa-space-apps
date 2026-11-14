import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import React, { act } from 'react';

test('unavailable WebGL and a lost context leave a usable description and retry', async () => {
  const window = new Window({ url: 'http://localhost/' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, HTMLCanvasElement: window.HTMLCanvasElement, IS_REACT_ACT_ENVIRONMENT: true })) install(key, value);
  install('IntersectionObserver', class { constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {} observe() { this.callback([{ isIntersecting: true }]); } disconnect() {} unobserve() {} });
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', { configurable: true, value() { throw new Error('WebGL disabled by fixture'); } });
  const originalError = console.error;
  console.error = (...args: unknown[]) => { if (!String(args[0]).includes('THREE.WebGLRenderer')) originalError(...args); };
  const { createRoot } = await import('react-dom/client');
  const { StoryProvider } = await import('../features/ground-truth/components/story/StoryProvider');
  const { default: City } = await import('../features/ground-truth/components/story/city3d/SinkingCity3D');
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  try {
    await act(async () => { root.render(React.createElement(StoryProvider, null, React.createElement(City, { mode: 'simulation' }))); });
    assert.match(container.textContent, /3D is unavailable on this device/);
    assert.match(container.textContent, /exaggerated teaching illustration/);
    const retry = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Try 3D again');
    assert.ok(retry, 'an explicit retry is available');
    await act(async () => { retry.click(); });
    assert.match(container.textContent, /3D is unavailable/);
    await act(async () => { container.querySelector('canvas')!.dispatchEvent(new window.Event('webglcontextlost', { cancelable: true })); });
    assert.match(container.textContent, /3D connection was lost/);
    assert.match(container.textContent, /measured map remain available/);
    await act(async () => { container.querySelector('canvas')!.dispatchEvent(new window.Event('webglcontextrestored')); });
    assert.match(container.textContent, /3D is unavailable/);
  } finally {
    await act(async () => root.unmount());
    console.error = originalError;
    await window.happyDOM.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
