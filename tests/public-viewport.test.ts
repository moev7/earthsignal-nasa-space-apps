import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import { NISAR_ALTITUDE_KM, ORBIT_RADIUS_RATIO } from '../features/public-story/spacecraft/OrbitalScale';

test('the real public header measures actual height without resizing scenes when browser bars move, and cleans up', async () => {
  const css = registerHooks({ load(url, context, next) { return url.endsWith('.css') ? {format:'module',source:'export {};',shortCircuit:true} : next(url,context); } });
  const window = new Window({url:'http://localhost/'}), saved = new Map<string, PropertyDescriptor|undefined>();
  const observers = new Set<()=>void>(), viewportListeners = new Set<()=>void>();
  const viewport = {height:760, addEventListener(_type:string, cb:()=>void){viewportListeners.add(cb);},removeEventListener(_type:string,cb:()=>void){viewportListeners.delete(cb);}};
  Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
  for (const [key,value] of Object.entries({window,document:window.document,navigator:window.navigator,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:():number=>1,cancelAnimationFrame:()=>{},ResizeObserver:class{constructor(private cb:()=>void){}observe(){observers.add(this.cb);}disconnect(){observers.delete(this.cb);}}})) {
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const {PublicFrame} = await import('../features/public-story/PublicShell');
  const {createRoot} = await import('react-dom/client');
  const host=window.document.createElement('div');window.document.body.append(host);
  const root=createRoot(host as unknown as HTMLElement);
  try {
    const props = {page:'story' as const, children:React.createElement('section',{id:'opening'},'Opening')};
    await act(async()=>root.render(React.createElement(PublicFrame,props)));
    const header=host.querySelector('.es-header')!, surface=host.querySelector('.es-public')!;
    let height=104;
    Object.defineProperty(header,'getBoundingClientRect',{value:()=>({height})});
    await act(async()=>observers.forEach(cb=>cb()));
    assert.equal(surface.getAttribute('style')?.includes('--es-header-height: 104px'),true);
    assert.equal(viewportListeners.size,0,'browser-bar movement does not rewrite scene-size variables');
    assert.equal(surface.getAttribute('style')?.includes('--es-viewport-height:'),false,'scene height stays on stable CSS svh while browser bars move');
    height=176;viewport.height=540;
    await act(async()=>{observers.forEach(cb=>cb());viewportListeners.forEach(cb=>cb());});
    assert.equal(surface.getAttribute('style')?.includes('--es-header-height: 176px'),true,'text enlargement is measured');
    assert.equal(surface.getAttribute('style')?.includes('--es-viewport-height:'),false,'text reflow updates header height while scene sizing stays on CSS svh');
    assert.ok(host.querySelector('.es-contents nav .es-story-mode-link'),'mode switch stays in contents rather than squeezing the current chapter');
    assert.equal(host.querySelector('.es-chapter-bar > .es-story-header-progress'),null);
    await act(async()=>root.unmount());
    assert.equal(observers.size,0);assert.equal(viewportListeners.size,0);
  } finally {
    await act(async()=>root.unmount());css.deregister();await window.happyDOM.close();
    for(const[key,value]of saved){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}
  }
});

test('the orbital distance diagram retains a physical Earth to orbit ratio',()=>{
  assert.equal(NISAR_ALTITUDE_KM,747);
  assert.ok(Math.abs(ORBIT_RADIUS_RATIO-1.11725)<.00001);
});
