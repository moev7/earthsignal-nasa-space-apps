import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import React,{act} from 'react';
import {Window} from 'happy-dom';
import {MISSIONS} from '../features/ground-truth/data/satellites';
import type {BundleManifest} from '../features/ground-truth/data/nisar';
import {MISSION_VIEWS,missionConnection,wavelengthPath,type MissionId} from '../features/public-story/mission-comparison-model';
const manifest=JSON.parse(readFileSync(new URL('../public/data/nisar/tehran-sw-2026/manifest.json',import.meta.url),'utf8')) as BundleManifest;
const ready={status:'ready',data:{manifest}} as const;

test('NISAR availability follows verified bundle state and actual source fields, never catalogue commissioning text',()=>{
 assert.equal(missionConnection('nisar',null).state,'loading');
 assert.equal(missionConnection('nisar',{status:'error',message:'checksum failed'}).state,'error');
 const available=missionConnection('nisar',ready);
 assert.match(available.title,/Verified provisional/);assert.ok(available.title.includes(manifest.source.sensor));
 assert.match(available.detail,/18 Jun 2026/);assert.match(available.detail,/21 Oct 2026/);assert.match(available.detail,/No S-band/);
 const changed={...manifest,source:{...manifest.source,product_status:'validated' as const,sensor:'S-band SAR',period:{start:'2027-01-02',end:'2027-02-03'}}};
 const future=missionConnection('nisar',{status:'ready',data:{manifest:changed}});
 assert.match(future.title,/validated.*S-band/);assert.match(future.detail,/2 Jan 2027/);assert.doesNotMatch(future.detail,/No S-band|2026/);
 for(const id of ['sentinel-1','envisat','alos','landsat','grace'] as MissionId[])assert.equal(missionConnection(id,ready).state,'reference');
});

test('radar wavelength graphics use one physical horizontal scale, not an invented resolution ranking',()=>{
 assert.equal(wavelengthPath(0),'');assert.equal(wavelengthPath(NaN),'');
 const long=wavelengthPath(24),short=wavelengthPath(5.6);
 assert.ok(long.startsWith('M20.00 28.00'));assert.ok(short.startsWith('M20.00 28.00'));
 assert.equal(long.split('L').length,193);assert.equal(short.split('L').length,193);
 assert.notEqual(long,short);
 assert.equal(MISSION_VIEWS.landsat.wavelength,undefined);assert.equal(MISSION_VIEWS.grace.wavelength,undefined);
});

test('actual mission UI switches six mechanisms, prevents duplicate comparison, folds full details and updates on verification failure',async()=>{
 const hooks=registerHooks({resolve(specifier,context,next){if(specifier.endsWith('.css'))return{url:'data:text/javascript,export default {}',shortCircuit:true};return next(specifier,context);}});
 let View: typeof import('../features/public-story/MissionComparison').MissionComparisonView;
 try{({MissionComparisonView:View}=await import('../features/public-story/MissionComparison'));}finally{hooks.deregister();}
 const window=new Window({url:'http://localhost/'});const saved=new Map<string,PropertyDescriptor|undefined>();
 for(const[key,value]of Object.entries({window,document:window.document,navigator:window.navigator,IS_REACT_ACT_ENVIRONMENT:true})){
  saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 }
 const {createRoot}=await import('react-dom/client');const host=window.document.createElement('div');window.document.body.append(host);const root=createRoot(host as unknown as HTMLElement);
 const click=async(text:string)=>{const b=Array.from(host.querySelectorAll('button')).find(e=>e.textContent===text)!;assert.ok(b,text);await act(async()=>b.click());};
 try{
  await act(async()=>root.render(React.createElement(View,{paused:false,connection:{status:'loading'}})));
  assert.ok(host.querySelector('[data-connection=loading]'));assert.doesNotMatch(host.textContent,/Verified provisional|commissioning|Not yet available/);
  await act(async()=>root.render(React.createElement(View,{paused:false,connection:ready})));
  assert.ok(host.querySelector('[data-connection=ready]'));assert.equal(host.querySelectorAll('table thead th').length,3);
  for(const m of MISSIONS){const view=MISSION_VIEWS[m.id as MissionId];await click(view.name);
   assert.equal(host.querySelector('svg[data-technique]')!.getAttribute('data-technique'),view.kind);
   assert.equal(host.querySelector('.es-mission-records')!.hasAttribute('open'),false);
   assert.ok(host.querySelector('.es-mission-records')!.textContent.includes(m.purpose));
   assert.ok(host.querySelector('.es-mission-records')!.textContent.includes(m.sensor));
   const headers=Array.from(host.querySelectorAll('table thead th')).map(e=>e.textContent);assert.equal(new Set(headers).size,headers.length);
   const before=host.querySelector('svg[data-technique]')!.innerHTML;
   await click(view.action);assert.notEqual(host.querySelector('svg[data-technique]')!.innerHTML,before);
   assert.ok(host.querySelector('[role=status]')!.textContent.includes(view.result));
   const reset=host.querySelector('button[aria-label="Reset mission diagram"]')!;await act(async()=>reset.dispatchEvent(new window.MouseEvent('click',{bubbles:true})));
   assert.equal(host.querySelector('svg[data-technique]')!.innerHTML,before);
  }
  const select=host.querySelector('select')!;
  await act(async()=>{select.value='none';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.equal(host.querySelectorAll('table thead th').length,2,'single-mission view avoids empty comparison column');
  await click('NISAR');
  await act(async()=>root.render(React.createElement(View,{paused:true,connection:{status:'error',message:'corrupt'}})));
  assert.equal(host.querySelector('.es-mission-lab')!.getAttribute('data-paused'),'true');
  assert.ok(host.querySelector('[data-connection=error]'));assert.doesNotMatch(host.textContent,/Verified provisional/);
 }finally{await act(async()=>root.unmount());await window.happyDOM.close();for(const[key,value]of saved){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}}
});
