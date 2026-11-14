import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import { TOKYO } from '../features/ground-truth/data/cities';

test('Tokyo’s short story view keeps both turning points and the complete event controls', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('.css')) return { url:'data:text/javascript,export default {}',shortCircuit:true };
    return next(specifier, context);
  } });
  let TokyoStory: typeof import('../features/public-story/comparison/TokyoStory').TokyoStory;
  try { ({TokyoStory} = await import('../features/public-story/comparison/TokyoStory')); } finally { hooks.deregister(); }
  const window = new Window({ url:'http://localhost/' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key,value] of Object.entries({window,document:window.document,navigator:window.navigator,IS_REACT_ACT_ENVIRONMENT:true})) {
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const {createRoot} = await import('react-dom/client');
  const host=window.document.createElement('div');window.document.body.append(host);
  const root=createRoot(host as unknown as HTMLElement);
  try {
    await act(async()=>root.render(React.createElement<{story?:boolean}>(TokyoStory,{story:true})));
    const details=host.querySelector('.ec-tokyo-full-controls')!;
    assert.equal(details.hasAttribute('open'),false,'the long history starts folded');
    assert.match(host.querySelector('.ec-tokyo-brief')!.textContent,/1962.*Peak/);
    const preset=Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='1980 · after controls')!;
    await act(async()=>preset.click());
    assert.match(host.querySelector('.ec-tokyo-brief')!.textContent,/1980.*arrested/);
    assert.equal(preset.getAttribute('aria-pressed'),'true');
    await act(async()=>details.querySelector('summary')!.click());
    assert.equal(details.hasAttribute('open'),true);
    const select=host.querySelector('select[aria-label="Tokyo historical event"]')!;
    assert.equal(select.querySelectorAll('option').length,TOKYO.timeline.length,'no event was discarded');
    const sameYear=TOKYO.timeline.map((event,index)=>({event,index})).filter(item=>item.event.year===1962);
    assert.equal(sameYear.length,2);
    for(const {index,event} of sameYear){
      await act(async()=>{(select as unknown as HTMLSelectElement).value=String(index);select.dispatchEvent(new window.Event('change',{bubbles:true}));});
      assert.match(host.querySelector('.ec-tokyo-brief')!.textContent,/1962/);
      assert.ok(host.querySelector('.ec-tokyo-brief')!.textContent.includes(event.title),'same-year peak and law remain distinct');
    }
    assert.match(host.querySelector('figcaption')!.textContent,/not a measured Tokyo time series/);
    assert.ok(host.querySelector('input[type=range]'),'the full manual timeline remains available');
  } finally {
    await act(async()=>root.unmount());await window.happyDOM.close();
    for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});
