import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import { renderToString } from 'react-dom/server';
import { Window } from 'happy-dom';
const cityFixture = new URL('../features/public-story/__test-secondary-city.ts', import.meta.url).href;
const css = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/PublicPages.tsx') && specifier === '@/features/ground-truth/components/story/CityScene') return { url: cityFixture, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === cityFixture) return { format: 'module', source: 'export function CityScene() { return "Secondary city fixture"; }', shortCircuit: true };
    return url.endsWith('.css') ? { format: 'module', source: 'export {};', shortCircuit: true } : next(url, context);
  },
});
after(() => css.deregister());
const { PublicStory } = await import('../features/public-story/PublicStory');

test('public scroll narrative keeps a short default reading path and optional chapter explanations', async (t) => {
  const window = new Window();
  try {
    const host = window.document.createElement('div');
    host.innerHTML = renderToString(React.createElement(PublicStory));
    const beats = [...host.querySelectorAll('.es-story-beat')];
    assert.equal(beats.length, 9);
    const words = beats.flatMap(x => [...x.querySelectorAll('h3,p')].map(node => node.textContent)).join(' ').trim().split(/\s+/).length;
    t.diagnostic(`${words} words in the nine primary story beats`);
    assert.ok(words <= 190, `${words} words in nine primary beats exceeds the public reading budget`);
    const chapters = [...host.querySelectorAll('.es-scroll-act')];
    assert.equal(chapters.length, 3);
    for (const chapter of chapters) {
      const notes = chapter.querySelector('.es-act-heading dialog');
      assert.ok(notes, 'each chapter has one named place for supporting explanation');
      assert.equal(notes.hasAttribute('open'), false);
      assert.match(chapter.querySelector('.es-story-evidence')!.textContent!, /Illustration|Invented|Synthetic/);
      assert.equal(chapter.querySelector('.es-story-evidence')!.closest('dialog'), null);
    }
    const source = host.querySelector('#sources > details')!;
    assert.ok(source);
    assert.equal(source.hasAttribute('open'), false);
    assert.ok(source.querySelector('a[href*="manifest.json"]'), 'the full source record remains available');
  } finally { await window.happyDOM.close(); }
});


test('public secondary views start closed, mount on demand and retain the opened view', async () => {
  const window = new Window({ url: 'http://localhost/explore' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { ExploreExtras } = await import('../features/public-story/PublicPages');
  const { createRoot } = await import('react-dom/client');
  const host = window.document.createElement('div'); window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const toggle = async (open: boolean) => {
    const details = host.querySelector('details')!;
    await act(async () => { details.open = open; details.dispatchEvent(new window.Event('toggle')); });
  };
  try {
    await act(async () => root.render(React.createElement(ExploreExtras)));
    assert.equal(host.querySelectorAll('details').length, 2);
    assert.equal(host.querySelectorAll('details[open]').length, 0);
    assert.equal(host.querySelector('.es-scene-block'), null, 'secondary 3D does not mount with the primary map');
    await toggle(true);
    const scene = host.querySelector('.es-scene-block');
    assert.ok(scene);
    await toggle(false);
    assert.equal(host.querySelector('.es-scene-block'), scene, 'closing retains the existing view rather than resetting controls');
    await toggle(true);
    assert.equal(host.querySelector('.es-scene-block'), scene);
  } finally {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

test('public comparison and purpose pages keep supporting reading optional', async () => {
  const { CityComparison } = await import('../features/public-story/comparison/CityComparison');
  const { PublicAbout } = await import('../features/public-story/PublicPages');
  const window = new Window();
  try {
    const host = window.document.createElement('div');
    host.innerHTML = renderToString(React.createElement(CityComparison));
    assert.equal(host.querySelectorAll('.ec-optional-section').length, 2);
    assert.equal(host.querySelectorAll('.ec-optional-section[open]').length, 0);
    assert.equal(host.querySelector('.ec-trend')!.closest('details'), null, 'the main visual comparison stays available');
    assert.ok(host.querySelector('.ec-profiles')!.closest('details'), 'long city context is optional');
    assert.ok(host.querySelector('table')!.closest('details'), 'the full evidence table is optional');
    host.innerHTML = renderToString(React.createElement(PublicAbout));
    assert.equal(host.querySelectorAll('.es-about-body>details').length, 4);
    assert.equal(host.querySelectorAll('.es-about-body>details[open]').length, 0);
    assert.match(host.textContent!, /not an official NASA, ISRO/);
  } finally { await window.happyDOM.close(); }
});
