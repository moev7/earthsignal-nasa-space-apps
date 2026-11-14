import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import { StoryProvider, useStory } from '../features/ground-truth/components/story/StoryProvider';
import type { LoadedBundle } from '../features/ground-truth/data/nisar';
import type { GroundProfileView } from '../lib/ground-profile';

test('profile animation obeys pause, hidden replay and reduced motion; invalid routes clear the map overlay', async()=>{
  const css=registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export {};',shortCircuit:true}:next(url,context);}});
  const window=new Window({url:'http://localhost/explore'}),saved=new Map<string,PropertyDescriptor|undefined>();
  const frames=new Map<number,FrameRequestCallback>();let nextFrame=0;
  let visible:((entries:{isIntersecting:boolean}[])=>void)|undefined;
  let reduced=false;const motionListeners=new Set<()=>void>();
  window.matchMedia=(()=>({get matches(){return reduced;},addEventListener(_event:string,cb:()=>void){motionListeners.add(cb);},removeEventListener(_event:string,cb:()=>void){motionListeners.delete(cb);}})) as unknown as typeof window.matchMedia;
  class Observer {
    constructor(private callback:(entries:{isIntersecting:boolean;target?:unknown}[])=>void){}
    observe(target:unknown){
      if(target instanceof window.HTMLElement&&target.classList.contains('es-disclosure-body'))visible=this.callback;
      this.callback([{isIntersecting:true,target}]);
    }
    unobserve(){}
    disconnect(){}
  }
  for(const[key,value]of Object.entries({window,document:window.document,navigator:window.navigator,FormData:window.FormData,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(cb:FrameRequestCallback)=>{frames.set(++nextFrame,cb);return nextFrame;},cancelAnimationFrame:(id:number)=>frames.delete(id),IntersectionObserver:Observer})){
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const {GroundProfile}=await import('../features/public-story/GroundProfile');
  const {createRoot}=await import('react-dom/client');
  const host=window.document.createElement('div');const root=createRoot(host as unknown as HTMLElement);
  const folder=new URL('../public/data/nisar/tehran-sw-2026/',import.meta.url);
  const bundle:LoadedBundle={manifest:JSON.parse(readFileSync(new URL('manifest.json',folder),'utf8')),grid:JSON.parse(readFileSync(new URL('vertical_grid.json',folder),'utf8')),imageUrl:'unused-verified-fixture'};
  let story!:ReturnType<typeof useStory>,view:GroundProfileView|null=null;
  function Controls(){story=useStory();return null;}
  const years=()=>host.querySelectorAll('input[type="range"]')[1] as unknown as HTMLInputElement;
  const animate=()=>Array.from(host.querySelectorAll('button')).find(e=>/Animate this assumption|Pause change/.test(e.textContent!))!;
  const tick=async(time:number)=>{await act(async()=>{const [id,cb]=frames.entries().next().value!;frames.delete(id);cb(time);});};
  try{
    await act(async()=>root.render(React.createElement(StoryProvider,null,React.createElement(Controls),React.createElement(GroundProfile,{bundle,onViewChange:value=>{view=value;}}))));
    assert.ok(view);assert.equal(years().value,'0');assert.equal(frames.size,0);
    await act(async()=>animate().click());await tick(0);await tick(7000);
    assert.equal(years().value,'10');
    await act(async()=>story.togglePaused());assert.equal(frames.size,0);assert.equal(years().value,'10');
    await act(async()=>story.togglePaused());assert.equal(frames.size,1);
    await act(async()=>visible?.([{isIntersecting:false}]));assert.equal(frames.size,0);
    await act(async()=>story.replay());assert.equal(years().value,'10','hidden replay stays pending');
    await act(async()=>visible?.([{isIntersecting:true}]));assert.equal(years().value,'0');assert.equal(frames.size,0);
    await act(async()=>{reduced=true;for(const cb of motionListeners)cb();});
    assert.equal(animate().disabled,true);assert.equal(frames.size,0);
    await act(async()=>Array.from(host.querySelectorAll('button')).find(e=>e.textContent==='Return to baseline')!.click());
    assert.equal(years().value,'0','manual still states remain available with reduced motion');
    const form=host.querySelector('form')!;
    const field=(name:string)=>form.querySelector(`[name="${name}"]`)! as unknown as {value:string};
    field('b-lat').value=field('a-lat').value;
    field('b-lng').value=field('a-lng').value;
    await act(async()=>form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
    assert.equal(view,null,'an invalid route must remove the previous map line');
    assert.match(host.textContent!,/No profile is available/);
  }finally{
    await act(async()=>root.unmount());css.deregister();await window.happyDOM.close();
    for(const[key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});
