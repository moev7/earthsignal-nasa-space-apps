import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import { formatRadarDb, moveRadarCell, validSelection } from '../features/public-story/radar-study/controls';
import type { RadarCell } from '../lib/public-radar-study';

test('native selection rejects invalid cells and inverted areas; arrow keys stop at grid edges', () => {
  assert.equal(validSelection({ row: 114, column: 0 }, 94, 114), null);
  assert.equal(validSelection({ row: .5, column: 0 }, 94, 114), null);
  assert.equal(validSelection({ left: 8, right: 7, top: 0, bottom: 2 }, 94, 114), null);
  assert.deepEqual(validSelection({ left: 0, right: 93, top: 0, bottom: 113 }, 94, 114), { left: 0, right: 93, top: 0, bottom: 113 });
  assert.deepEqual(moveRadarCell({ row: 0, column: 0 }, 'ArrowLeft', 94, 114), { row: 0, column: 0 });
  assert.deepEqual(moveRadarCell({ row: 113, column: 93 }, 'ArrowDown', 94, 114), { row: 113, column: 93 });
  assert.equal(moveRadarCell({ row: 0, column: 0 }, 'PageDown', 94, 114), null, 'ordinary scrolling keys are not captured');
  assert.equal(formatRadarDb(null), 'Excluded — no measurement');
  assert.equal(formatRadarDb(0), '0.00 dB', 'valid zero is not masked');
  assert.equal(formatRadarDb(2, true), '+2.00 dB');
});

test('public viewer runs native controls, rejects corrupt files, retries, preserves context and disposes images', async () => {
  const css = registerHooks({ load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: 'export {};', shortCircuit: true } : next(url, context); } });
  const window = new Window({ url: 'http://localhost/explore?study=lake-mead-gcov-2026' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const folder = new URL('../public/data/radar/lake-mead-gcov-2026/', import.meta.url);
  const values = JSON.parse(readFileSync(new URL('values.json', folder), 'utf8')) as { width: number; height: number; beforeDb: (number | null)[]; afterDb: (number | null)[]; differenceDb: (number | null)[] };
  const source = JSON.parse(readFileSync(new URL('manifest.json', folder), 'utf8')).source;
  const firstValidIndex = values.differenceDb.findIndex(value => value !== null);
  const excludedIndex = values.differenceDb.findIndex(value => value === null);
  assert.ok(firstValidIndex >= 0 && excludedIndex >= 0, 'frozen source contains measured and excluded cells');
  const cellAt = (index: number): RadarCell => ({ row: Math.floor(index / values.width), column: index % values.width });
  const valid = cellAt(firstValidIndex), excluded = cellAt(excludedIndex);
  const urls = new Set<string>(), revoked = new Set<string>(); let urlNumber = 0;
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => { const url = `blob:radar-test-${++urlNumber}`; urls.add(url); return url; };
  URL.revokeObjectURL = url => { assert.ok(!revoked.has(url), 'each image URL is disposed once'); revoked.add(url); };
  let release!: () => void;
  const manifestGate = new Promise<void>(resolve => { release = resolve; });
  let corrupt = false;
  const requests: { url: string; method: string; signal?: AbortSignal | null }[] = [];
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, FormData: window.FormData, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input), name = url.split('/').at(-1)!;
      assert.ok(url.startsWith('/data/radar/lake-mead-gcov-2026/'), 'viewer fetches only frozen public study files');
      assert.ok(['manifest.json', 'values.json', 'before.png', 'after.png', 'difference.png', 'excluded.png'].includes(name));
      requests.push({ url, method: init?.method ?? 'GET', signal: init?.signal });
      if (name === 'manifest.json') await manifestGate;
      const bytes = new Uint8Array(readFileSync(new URL(name, folder)));
      if (corrupt && name === 'values.json') bytes[0] = 0;
      return new Response(bytes, { status: 200 });
    },
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { PublicRadarStudy } = await import('../features/public-story/radar-study/PublicRadarStudy');
  const { createRoot } = await import('react-dom/client');
  const host = window.document.createElement('div'); window.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
  const button = (label: string) => Array.from(host.querySelectorAll('button')).find(item => item.textContent === label)!;
  const inspection = () => host.querySelector('[aria-live="polite"]')!.textContent!;
  const stage = () => host.querySelector('.es-radar-study-stage')!;
  const mode = async (label: string) => { await act(async () => button(label).click()); assert.equal(button(label).getAttribute('aria-pressed'), 'true'); };
  const submitCell = async (cell: RadarCell) => {
    const form = host.querySelector('form[aria-label="Inspect a native cell"]')!;
    (form.querySelector('[name="row"]') as unknown as HTMLInputElement).value = String(cell.row + 1);
    (form.querySelector('[name="column"]') as unknown as HTMLInputElement).value = String(cell.column + 1);
    await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  };
  try {
    await act(async () => root.render(React.createElement(PublicRadarStudy)));
    assert.match(host.querySelector('[role="status"]')!.textContent!, /Checking the observations/);
    assert.equal(host.querySelectorAll('img').length, 0, 'unchecked images stay hidden');
    await act(async () => { release(); await flush(); });
    assert.equal(urls.size, 4);
    assert.match(host.textContent!, /26 Jun 2026/); assert.match(host.textContent!, /30 Sept 2026/);
    assert.match(host.textContent!, /Provisional/); assert.match(host.textContent!, /93\.3% common coverage/);
    assert.match(host.textContent!, /do not establish sinking, flooding or damage/);
    assert.match(host.textContent!, /No analysis starts automatically/);
    assert.equal(stage().querySelector('img')!.getAttribute('width'), String(values.width));
    assert.equal(stage().querySelector('img')!.getAttribute('height'), String(values.height));
    assert.equal(button('Compare').getAttribute('aria-pressed'), 'true');
    const slider = host.querySelector('input[type="range"]')! as unknown as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(slider, '75');
      slider.dispatchEvent(new window.Event('input', { bubbles: true }) as unknown as Event);
    });
    assert.equal(host.querySelector('.es-radar-study-before')!.getAttribute('style')!.includes('25%'), true);
    assert.equal(slider.getAttribute('aria-valuetext'), '75% before, 25% after');
    await mode('Before'); assert.equal(stage().querySelector('img')!.getAttribute('src'), 'blob:radar-test-1');
    assert.equal(host.querySelector('input[type="range"]'), null);
    await mode('After'); assert.equal(stage().querySelector('img')!.getAttribute('src'), 'blob:radar-test-2');
    await mode('Difference'); assert.equal(stage().querySelector('img')!.getAttribute('src'), 'blob:radar-test-3');
    assert.match(host.querySelector('.es-radar-study-legend')!.textContent!, /After − before \(dB\)/);
    await mode('Compare'); assert.equal((host.querySelector('input[type="range"]') as unknown as HTMLInputElement).value, '75');
    await submitCell(valid);
    assert.match(inspection(), new RegExp(`Cell ${valid.row + 1}, ${valid.column + 1}`));
    assert.ok(inspection().includes(formatRadarDb(values.differenceDb[firstValidIndex], true)));
    const workspace = () => host.querySelector('a.es-radar-study-primary')!.getAttribute('href')!;
    assert.ok(new URL(workspace(), 'http://localhost').searchParams.get('selection') === `cell:${valid.row},${valid.column}`);
    await submitCell(excluded);
    assert.match(inspection(), /Excluded — no measurement/);
    assert.doesNotMatch(inspection(), /0\.00 dB/);
    await act(async () => stage().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    const next = moveRadarCell(excluded, 'ArrowRight', values.width, values.height)!;
    assert.ok(workspace().includes(encodeURIComponent(`cell:${next.row},${next.column}`)));
    const pageDown = new window.KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true });
    await act(async () => stage().dispatchEvent(pageDown)); assert.equal(pageDown.defaultPrevented, false);
    // Pointer mapping uses the image box itself, with no letterbox or padding.
    Object.defineProperty(stage(), 'getBoundingClientRect', { configurable: true, value: () => ({ left: 10, top: 20, width: 470, height: 570 }) });
    await act(async () => stage().dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 479.9, clientY: 589.9 })));
    assert.ok(workspace().includes(encodeURIComponent('cell:113,93')));
    const areaForm = () => host.querySelector('form[aria-label="Inspect a native area"]')!;
    const areaInput = (name: string, value: number) => { (areaForm().querySelector(`[name="${name}"]`) as unknown as HTMLInputElement).value = String(value); };
    areaInput('top', 2); areaInput('bottom', 1);
    await act(async () => areaForm().dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    assert.match(areaForm().textContent!, /first row and column no greater than the last/);
    assert.ok(workspace().includes(encodeURIComponent('cell:113,93')), 'invalid area keeps the previous valid selection');
    areaInput('top', 1); areaInput('bottom', values.height); areaInput('left', 1); areaInput('right', values.width);
    await act(async () => areaForm().dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    assert.match(inspection(), /Selected area/);
    assert.ok(inspection().includes(source.coverage.commonValidPixels.toLocaleString('en-US')));
    assert.ok(inspection().includes(formatRadarDb(source.stats.medianDb, true)));
    assert.ok(workspace().includes(encodeURIComponent('region:0,0,93,113')));
    assert.ok(host.querySelector('a[href^="/explore?"]')!.getAttribute('href')!.includes(encodeURIComponent('region:0,0,93,113')));
    const leave = host.querySelector('a[href^="/workspace?"]')!;
    // Suppress document navigation in this DOM harness; the component still records
    // the correct public history entry before its real browser navigation.
    const stopNavigation = (event: { preventDefault(): void }) => event.preventDefault();
    host.addEventListener('click', stopNavigation);
    await act(async () => leave.dispatchEvent(new window.MouseEvent('click', {bubbles:true,cancelable:true,button:0})));
    assert.ok(window.location.search.includes(encodeURIComponent('region:0,0,93,113')), 'browser Back restores the inspected area');
    host.removeEventListener('click', stopNavigation);

    areaInput('top', excluded.row + 1); areaInput('bottom', excluded.row + 1); areaInput('left', excluded.column + 1); areaInput('right', excluded.column + 1);
    await act(async () => areaForm().dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    assert.match(inspection(), /0 \/ 1/);
    assert.match(inspection(), /no common valid cells/);
    assert.match(inspection(), /Excluded — no measurement/);
    await act(async () => root.render(React.createElement(PublicRadarStudy, { selection: excluded })));
    assert.match(inspection(), /Excluded — no measurement/, 'new route context is reflected without refetching');
    // A verified file can still fail decoding; retain recovery and dispose on retry.
    await act(async () => stage().querySelector('img')!.dispatchEvent(new window.Event('error')));
    assert.match(host.querySelector('[role="alert"]')!.textContent!, /could not be loaded, verified or decoded/);
    corrupt = true;
    await act(async () => { button('Retry radar study').click(); await flush(); });
    assert.match(host.querySelector('[role="alert"]')!.textContent!, /could not be displayed/);
    assert.equal(revoked.size, 4, 'retry disposes the previous study images');
    assert.equal(urls.size, 4, 'corrupt values never create image URLs');
    corrupt = false;
    await act(async () => { button('Retry radar study').click(); await flush(); });
    assert.ok(stage()); assert.equal(urls.size, 8);
    await act(async () => root.unmount());
    assert.deepEqual(revoked, urls, 'unmount disposes all remaining object URLs');
    assert.ok(requests.every(item => item.method === 'GET'));
    assert.ok(requests.every(item => item.signal?.aborted), 'all load generations are aborted at cleanup');
  } finally {
    await act(async () => root.unmount());
    css.deregister(); await window.happyDOM.close();
    URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
