import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {registerHooks} from 'node:module';
import {Window} from 'happy-dom';
import {CAUSE_IDS,experimentReducer,initialExperiments,experimentReading} from '../features/public-story/cause-experiment-model';
import {CAUSES} from '../features/ground-truth/data/causes';
import {MECHANISM_STEPS,INDICATOR_VIEWS} from '../features/public-story/cause-depth-model';

test('manual experiments retain peak compaction, isolate causes, clamp controls and reset only the selected experiment',()=>{
  let state=initialExperiments();
  for(const id of ['groundwater','geology'] as const){
    state=experimentReducer(state,{id,type:'amount',value:1});
    state=experimentReducer(state,{id,type:'amount',value:0});
    assert.equal(state[id].amount,0);assert.equal(state[id].peak,1);
    assert.match(experimentReading(id,state[id]),/remain|stays/);
  }
  state=experimentReducer(state,{id:'irrigation',type:'amount',value:.8});
  state=experimentReducer(state,{id:'irrigation',type:'alternative',value:true});
  assert.match(experimentReading('irrigation',state.irrigation),/Surface water/);
  state=experimentReducer(state,{id:'groundwater',type:'reset'});
  assert.equal(state.groundwater.peak,0);assert.equal(state.geology.peak,1);assert.equal(state.irrigation.amount,.8);
  for(const value of [NaN,Infinity,-2,9]){
    state=experimentReducer(state,{id:'urban',type:'second',value});
    assert.ok(Number.isFinite(state.urban.second)&&state.urban.second>=0&&state.urban.second<=1);
  }
  state=experimentReducer(state,{id:'urban',type:'amount',value:1});
  state=experimentReducer(state,{id:'urban',type:'second',value:0});
  assert.match(experimentReading('urban',state.urban),/separate from groundwater/);
});

test('all five actual experiments expose distinct drawings, retained scientific detail, refill/reset and global replay',async()=>{
  const hooks=registerHooks({resolve(specifier,context,next){if(specifier.endsWith('.css'))return{url:'data:text/javascript,export default {}',shortCircuit:true};return next(specifier,context);}});
  let CauseExperiments: typeof import('../features/public-story/CauseExperiments').default;
  let StoryProvider: typeof import('../features/ground-truth/components/story/StoryProvider').StoryProvider;
  let useStory: typeof import('../features/ground-truth/components/story/StoryProvider').useStory;
  try{
    ({default:CauseExperiments}=await import('../features/public-story/CauseExperiments'));
    ({StoryProvider,useStory}=await import('../features/ground-truth/components/story/StoryProvider'));
  }finally{hooks.deregister();}
  const window=new Window({url:'http://localhost/'});
  const saved=new Map<string,PropertyDescriptor|undefined>();
  for(const [key,value] of Object.entries({window,document:window.document,navigator:window.navigator,IS_REACT_ACT_ENVIRONMENT:true})){
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const {createRoot}=await import('react-dom/client');
  const host=window.document.createElement('div');window.document.body.append(host);const root=createRoot(host as unknown as HTMLElement);
  function Harness(){const story=useStory();return React.createElement(React.Fragment,null,React.createElement('button',{onClick:story.togglePaused},'Global pause'),React.createElement('button',{onClick:story.replay},'Global replay'),React.createElement(CauseExperiments));}
  const click=async(text:string)=>{const button=Array.from(host.querySelectorAll('button')).find(e=>e.textContent===text)!;assert.ok(button,text);await act(async()=>button.click());};
  try{
    await act(async()=>root.render(React.createElement(StoryProvider,null,React.createElement(Harness))));
    for(const [index,id] of CAUSE_IDS.entries()){
      const selector=Array.from(host.querySelectorAll('button')).find(button=>button.getAttribute('aria-label')===CAUSES[index].title)!;
      await act(async()=>selector.click());
      assert.equal(selector.getAttribute('aria-pressed'),'true');
      assert.equal(host.querySelector('svg[data-mechanism]')!.getAttribute('data-mechanism'),id);
      const input=host.querySelector('input[type=range]')!;
      const before=host.querySelector('svg[data-mechanism]')!.innerHTML;
      const setValue=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!;
      await act(async()=>{setValue.call(input,'80');input.dispatchEvent(new window.Event('input',{bubbles:true}));});
      assert.notEqual(host.querySelector('svg[data-mechanism]')!.innerHTML,before,'range updates actual geometry for '+id);
      assert.ok(host.querySelector('svg[role=img]')!.getAttribute('aria-label')!.length>40);
      const detail=host.querySelector('.es-cause-science')!;
      assert.equal(detail.hasAttribute('open'),false);
      assert.ok(detail.textContent.includes(CAUSES[index].explanation),'original scientific explanation retained');
      for(const indicator of CAUSES[index].indicators)assert.ok(detail.textContent.includes(indicator));
      assert.match(host.querySelector('figcaption')!.textContent,/not measured/);
      for(const [stepIndex,step] of MECHANISM_STEPS[id].entries()){
        const button=Array.from(host.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='Start a fresh demonstration: '+step.title)!;
        await act(async()=>button.click());
        assert.equal(button.getAttribute('aria-pressed'),'true');
        assert.equal(host.querySelector('[data-focus]')!.getAttribute('data-focus'),String(stepIndex));
        assert.equal((host.querySelector('input[type=range]') as unknown as HTMLInputElement).value,String(Math.round(step.snapshot.amount*100)));
        assert.ok(host.querySelector('[role=status]')!.textContent.includes(step.detail));
      }
      await act(async()=>{setValue.call(input,'40');input.dispatchEvent(new window.Event('input',{bubbles:true}));});
      assert.equal(host.querySelector('[data-focus]'),null,'manual controls leave the guided explanation for '+id);
      assert.equal(host.querySelector('[role=status]')!.textContent,experimentReading(id,{
        ...MECHANISM_STEPS[id][2].snapshot,amount:.4,peak:Math.max(.4,MECHANISM_STEPS[id][2].snapshot.peak),
      }));
      for(const [clueIndex,clue] of INDICATOR_VIEWS[id].entries()){
        const button=Array.from(host.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===CAUSES[index].indicators[clueIndex])!;
        await act(async()=>button.click());
        assert.equal(host.querySelector('svg[data-clue]')!.getAttribute('data-clue'),clue.kind);
        assert.equal(host.querySelector('svg[data-clue]')!.closest('details'),null,'clue explanation is visible, not nested in source notes');
        assert.match(host.querySelector('svg[data-clue]')!.getAttribute('aria-label')!,/not measured city data/);
        assert.ok(host.querySelector('.es-indicator-lens figcaption')!.textContent.includes(clue.reading));
      }
      assert.equal(host.querySelectorAll('.es-cause-city-pair img').length,2);
      assert.equal(host.querySelector('.es-cause-city-context')!.closest('details'),null,'city context is part of the lesson');
      assert.ok(host.querySelector('a[href="/explore"]'));
      assert.ok(host.querySelector('a[href="/#what-we-can-do"]'));
    }
    await act(async()=>Array.from(host.querySelectorAll('button')).find(button=>button.getAttribute('aria-label')===CAUSES[1].title)!.click());
    await click('Wells supply it');await click('Surface water');
    assert.equal((host.querySelector('input[type=range]') as unknown as HTMLInputElement).value,'60','changing supply preserves the selected irrigation demand');
    assert.equal(host.querySelector('[data-focus]'),null);
    assert.match(host.querySelector('[role=status]')!.textContent,/Surface water supplies this irrigation demand/);
    assert.match(host.querySelector('svg[data-mechanism]')!.textContent,/Surface supply/);
    await act(async()=>Array.from(host.querySelector('[aria-label="Irrigation water supply"]')!.querySelectorAll('button')).find(button=>button.textContent==='Groundwater')!.click());
    assert.match(host.querySelector('[role=status]')!.textContent,/More irrigated land draws more water from the well/);
    await act(async()=>Array.from(host.querySelectorAll('button')).find(button=>button.getAttribute('aria-label')==='Excessive groundwater extraction')!.click());
    await click('Pump water');assert.match(host.querySelector('[role=status]')!.textContent,/pressure falls/);
    const moved=host.querySelector('svg[data-mechanism]')!.innerHTML;
    await click('Let water return');assert.match(host.querySelector('[role=status]')!.textContent,/remain lost/);
    assert.notEqual(host.querySelector('svg[data-mechanism]')!.innerHTML,moved);
    await click('Global pause');assert.equal(host.querySelector('.es-cause-lab')!.getAttribute('data-paused'),'true');
    await click('Reset experiment');assert.match(host.querySelector('[role=status]')!.textContent,/Start pumping/);
    await click('Pump water');await click('Global replay');
    assert.match(host.querySelector('[role=status]')!.textContent,/Start pumping/);
    assert.equal(host.querySelector('.es-cause-lab')!.getAttribute('data-paused'),'false');
  }finally{await act(async()=>root.unmount());await window.happyDOM.close();for(const[key,value]of saved){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}}
});


test('fresh teaching snapshots are isolated from manual recovery and preserve intentional fine-layer compaction',()=>{
 let state=initialExperiments();
 state=experimentReducer(state,{id:'geology',type:'snapshot',value:MECHANISM_STEPS.geology[2].snapshot});
 assert.equal(state.geology.amount,0);assert.equal(state.geology.peak,1);
 state=experimentReducer(state,{id:'geology',type:'amount',value:0});assert.equal(state.geology.peak,1);
 state=experimentReducer(state,{id:'urban',type:'snapshot',value:MECHANISM_STEPS.urban[1].snapshot});
 assert.equal(state.urban.amount,0);assert.equal(state.urban.second,1,'paving is independent of added load');assert.equal(state.geology.peak,1);
 state=experimentReducer(state,{id:'groundwater',type:'snapshot',value:{amount:8,peak:-2,second:Infinity,alternative:false}});
 assert.equal(state.groundwater.amount,1);assert.equal(state.groundwater.peak,1);assert.equal(state.groundwater.second,0);
});
