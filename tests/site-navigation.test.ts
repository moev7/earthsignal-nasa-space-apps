import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import { Window } from 'happy-dom';

test('hydrated public navigation leaves page changes to the browser and retains study URLs', async () => {
  const css = registerHooks({ load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: 'export {};', shortCircuit: true } : next(url, context); } });
  const window = new Window({ url: 'http://localhost/explore' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { PublicFrame } = await import('../features/public-story/PublicShell');
  const { SiteLink } = await import('../components/site-link');
  const { createRoot } = await import('react-dom/client');
  const host = window.document.createElement('div');
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const destination = '/explore?study=lake-mead-gcov-2026&selection=cell%3A32%2C7#radar-study';
  const clicks: { href: string | null; prevented: boolean; ctrl: boolean }[] = [];
  // Observe after React's root handler, then suppress actual document loading in
  // this DOM fixture. The old Link interceptor canceled the click before here.
  window.document.addEventListener('click', event => {
    const anchor = event.target instanceof window.Element ? event.target.closest('a') : null;
    if (anchor) clicks.push({ href: anchor.getAttribute('href'), prevented: event.defaultPrevented, ctrl: event instanceof window.MouseEvent && event.ctrlKey });
    event.preventDefault();
  });
  try {
    // createElement supplies the required child as its third argument.
    const frameProps = { page: 'explore' } as React.ComponentProps<typeof PublicFrame>;
    await act(async () => root.render(React.createElement(PublicFrame, frameProps, React.createElement(SiteLink, { href: destination, target: '_blank', rel: 'noopener' }, 'Return to selected study'))));
    const links = [...host.querySelectorAll('nav[aria-label="Public navigation"] a')];
    assert.deepEqual(links.map(a => a.getAttribute('href')), ['/', '/explore', '/compare', '/workspace']);
    assert.equal(links[1].getAttribute('aria-current'), 'page');
    for (const link of [...links, ...host.querySelectorAll('nav[aria-label="Footer navigation"] a')]) {
      await act(async () => link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
      assert.equal(clicks.at(-1)?.prevented, false, link.getAttribute('href')!);
    }
    const study = host.querySelector('a[target="_blank"]')!;
    assert.equal(study.getAttribute('href'), destination);
    assert.equal(study.getAttribute('rel'), 'noopener');
    await act(async () => study.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true })));
    assert.deepEqual(clicks.at(-1), { href: destination, prevented: false, ctrl: true });
  } finally {
    await act(async () => root.unmount());
    css.deregister();
    await window.happyDOM.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
