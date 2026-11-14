import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {Window} from 'happy-dom';
import {useScience,type ScienceModel} from '../features/science/use-science';
import {publicStudyCatalogQuery,publicStudyRadarRequest,PUBLIC_RADAR_STUDY} from '../lib/public-study-context';
import {changeRequestSchema} from '../lib/radar-contract';
import {readFileSync} from 'node:fs';

test('public context hydrates the actual scientific model without submitting processing',async()=>{
 const window=new Window({url:'http://localhost/workspace'}),saved=new Map<string,PropertyDescriptor|undefined>();
 const install=(key:string,value:unknown)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
 for(const [key,value]of Object.entries({window,document:window.document,navigator:window.navigator,localStorage:window.localStorage,Event:window.Event,IS_REACT_ACT_ENVIRONMENT:true}))install(key,value);
 const requests:{url:string;method:string}[]=[];
 install('fetch',async(input:string,init?:RequestInit)=>{requests.push({url:String(input),method:init?.method??'GET'});return Response.json({error:'Sign in'},{status:401});});
 const {createRoot}=await import('react-dom/client');const root=createRoot(window.document.createElement('div') as unknown as HTMLElement);
 const context={id:PUBLIC_RADAR_STUDY.id,selection:{row:57,column:48}};
 const request=publicStudyRadarRequest(context),original=JSON.parse(readFileSync(new URL('../examples/native-radar-development/manifest.json',import.meta.url),'utf8'));
 assert.equal(request.beforeId,original.before.id);assert.equal(request.afterId,original.after.id);changeRequestSchema.parse(request);
 let model!:ScienceModel;
 function Fixture(){model=useScience(publicStudyCatalogQuery,request);return null;}
 try{
  await act(async()=>{root.render(React.createElement(Fixture));});
  assert.deepEqual(model.catalog.query,publicStudyCatalogQuery());assert.deepEqual(model.comparisonDraft,request);assert.equal(model.type,'GCOV');
  assert.ok(requests.some(r=>r.url.startsWith('/api/scenes?')));
  assert.ok(requests.every(r=>r.method==='GET'),'navigation hydrates only read requests');
  assert.ok(requests.every(r=>!r.url.includes('/artifacts/')),'public identity never becomes private artifact ID');
 }finally{
  await act(async()=>root.unmount());await window.happyDOM.close();
  for(const [key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
 }
});
