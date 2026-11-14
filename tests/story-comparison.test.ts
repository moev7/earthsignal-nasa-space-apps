import test from 'node:test';
import assert from 'node:assert/strict';
import { TEHRAN, TOKYO } from '../features/ground-truth/data/cities';
import { pointAtYear, illustrationBand, milestones, latestMilestone } from '../features/public-story/comparison/model';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import { renderToString } from 'react-dom/server';
import { IllustratedPlot } from '../features/public-story/comparison/ComparisonCharts';
test('comparison readings preserve missing years and distinct same-year Tokyo events',()=>{
  assert.equal(pointAtYear(TEHRAN,1962),undefined,'a joined line must not create a Tehran observation in Tokyo’s peak year');
  assert.equal(pointAtYear(TOKYO,1980)?.rateMmPerYear,-35);
  assert.deepEqual(illustrationBand(pointAtYear(TOKYO,1980)!),{low:23,high:47});
  const events=milestones([TEHRAN,TOKYO]);
  const tokyo1962=events.filter(item=>item.city.id==='tokyo'&&item.event.year===1962);
  assert.equal(tokyo1962.length,2);
  assert.notEqual(tokyo1962[0].key,tokyo1962[1].key,'peak and building-water law remain independently selectable');
  for(const event of tokyo1962)assert.equal(latestMilestone(events,1962,event.key)?.key,event.key);
});

test('the comparison plot hydrates its accessible SVG title without replacing server content', async () => {
  const element = React.createElement(IllustratedPlot, { cities: [TEHRAN, TOKYO], selectedYear: 1962, onInspect() {} });
  const html = renderToString(element);
  const window = new Window({ url: 'http://localhost/compare' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const host = window.document.createElement('div');
  host.innerHTML = html;
  const originalSvg = host.querySelector('svg');
  const errors: unknown[] = [];
  const { hydrateRoot } = await import('react-dom/client');
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => { root = hydrateRoot(host as unknown as HTMLElement, element, { onRecoverableError: error => errors.push(error) }); });
    assert.deepEqual(errors, []);
    assert.equal(host.querySelector('svg'), originalSvg, 'the server-rendered chart survives hydration');
    assert.equal(host.querySelector('title')!.textContent, 'Illustrated subsidence histories: Tehran and Tokyo. Synthetic curves, not measurements.');
  } finally {
    await act(async () => root?.unmount());
    await window.happyDOM.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
