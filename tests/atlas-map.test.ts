import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { TEHRAN, TOKYO } from '../features/ground-truth/data/cities';
import type { AtlasBasemap } from '../lib/atlas-view';

test('changing the basemap detaches Leaflet map listeners before changing city', async () => {
  const window = new Window({ url: 'http://localhost/' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, Element: window.Element, SVGElement: window.SVGElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  // Use real Leaflet with an SVG renderer; the DOM fixture has no canvas engine.
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: undefined });
  Object.defineProperty(window.SVGSVGElement.prototype, 'createSVGRect', { configurable: true, value: () => ({}) });
  const { createRoot } = await import('react-dom/client');
  const { default: AtlasMap } = await import('../features/public-story/AtlasMap');
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  const render = async (city: typeof TEHRAN, basemap: AtlasBasemap) => {
    await act(async () => { root.render(React.createElement(AtlasMap, { city, basemap, layer: 'groundwater', opacity: .8, bundle: null, buildings: null, renderData: true, onSelect() {} })); });
  };
  try {
    await render(TOKYO, 'satellite');
    // Let the lazy Leaflet import finish before exercising its event lifecycle.
    for (let i = 0; i < 20 && !host.querySelector('.leaflet-pane'); i++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    }
    assert.ok(host.querySelector('.leaflet-pane'), 'Leaflet initialized');
    await render(TOKYO, 'none');
    await render(TEHRAN, 'none');
    assert.match(host.querySelector('[role="region"]')!.getAttribute('aria-label')!, /Tehran/);
    await render(TEHRAN, 'streets');
    await render(TEHRAN, 'satellite');
    await render(TOKYO, 'satellite');
    assert.match(host.querySelector('[role="region"]')!.getAttribute('aria-label')!, /Tokyo/);
    assert.equal(host.querySelector('[role="alert"]'), null);
  } finally {
    await act(async () => root.unmount());
    await window.happyDOM.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
