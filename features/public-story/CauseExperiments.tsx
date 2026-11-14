'use client';

import { useId, useReducer, useState, type ReactNode } from 'react';
import { RotateCcw, Sprout } from 'lucide-react';
import { CAUSES } from '@/features/ground-truth/data/causes';
import { useStory } from '@/features/ground-truth/components/story/StoryProvider';
import { CAUSE_IDS, experimentReading, experimentReducer, initialExperiments, type CauseId, type Experiment } from './cause-experiment-model';
import {MechanismGuide,IndicatorLens,CauseCityContext} from './CauseDepth';
import {MECHANISM_STEPS} from './cause-depth-model';
import './cause-experiments.css';

const LABELS = ['Groundwater', 'Irrigation', 'Drought', 'Clay & sand', 'Urban growth'];
const INVITATIONS: Record<CauseId, string> = {
  groundwater: 'Draw the water down. Then let it return. Does the ground follow?',
  irrigation: 'Grow the irrigated area. Then change where its water comes from.',
  drought: 'Keep pumping steady. What changes when less rain arrives?',
  geology: 'Lower the pressure in both materials. Watch the spaces between grains.',
  urban: 'Try added weight and paving separately. They act in different ways.',
};
const LOSS = ['Water held', 'Water drawn down'];

/** No autoplay or GPU: every change comes from a visitor's explicit control. */
export default function CauseExperiments() {
  const { paused, replayToken } = useStory();
  return <CauseLab key={replayToken} paused={paused} />;
}
function CauseLab({ paused }: { paused: boolean }) {
  const [id, setId] = useState<CauseId>('groundwater');
  const [states, dispatch] = useReducer(experimentReducer, undefined, initialExperiments);
  const [selectedStep,setSelectedStep] = useState<{id:CauseId;index:number}|null>(null);
  const uid = useId();
  const cause = CAUSES.find(c => c.id === id)!;
  const state = states[id];
  const activeStep=selectedStep?.id===id?selectedStep.index:null;
  const reading = activeStep===null?experimentReading(id,state):MECHANISM_STEPS[id][activeStep].detail;
  const amount = (value: number) => {setSelectedStep(null);dispatch({ id, type: 'amount', value });};
  return <section className="es-cause-lab" aria-labelledby={`${uid}-title`} data-paused={paused}>
    <h3 id={`${uid}-title`}>Explore the forces behind subsidence</h3>
    <div className="es-cause-selector" role="group" aria-label="Subsidence mechanisms">
      {CAUSE_IDS.map((key, index) => <button type="button" key={key} aria-label={CAUSES[index].title} aria-pressed={id === key} onClick={() => setId(key)}>{LABELS[index]}</button>)}
    </div>
    <article aria-labelledby={`${uid}-cause`} className="es-cause-experiment">
      <div className="es-cause-intro"><h4 id={`${uid}-cause`}>{cause.title}</h4><p>{INVITATIONS[id]}</p></div>
      <MechanismGuide id={id} active={activeStep} onSelect={(index,step)=>{setSelectedStep({id,index});dispatch({id,type:'snapshot',value:step.snapshot});}}/>
      <div className="es-cause-stage">
        <figure className="es-cause-drawing">
          <MechanismDrawing id={id} state={state} reading={reading} focus={activeStep}/>
          <figcaption>Illustrative experiment · not measured · shapes exaggerated{(id==='irrigation'||id==='drought'||id==='urban')&&<span>Separate scenarios, not a recovery timeline.</span>}</figcaption>
        </figure>
        <div className="es-cause-console">
          {id === 'groundwater' && <>
            <Range label="Draw down the water" value={state.amount} ends={LOSS} onChange={amount}/>
            <div className="es-cause-presets"><button type="button" onClick={() => amount(1)}>Pump water</button><button type="button" onClick={() => amount(0)}>Let water return</button></div>
          </>}
          {id === 'irrigation' && <>
            <Range label="Irrigated area" value={state.amount} ends={['No extra fields', 'More fields']} onChange={amount}/>
            <div className="es-cause-presets" role="group" aria-label="Irrigation water supply">
              <button type="button" aria-pressed={!state.alternative} onClick={() => {setSelectedStep(null);dispatch({id,type:'alternative',value:false});}}>Groundwater</button>
              <button type="button" aria-pressed={state.alternative} onClick={() => {setSelectedStep(null);dispatch({id,type:'alternative',value:true});}}>Surface water</button>
            </div>
            <p className="es-cause-assumption">For this comparison, surface water meets the selected irrigation demand. Availability varies by place.</p>
          </>}
          {id === 'drought' && <>
            <Range label="Make the weather drier" value={state.amount} ends={['More rain', 'Less rain']} onChange={amount}/>
            <p className="es-cause-fixed">Pumping stays the same.</p>
          </>}
          {id === 'geology' && <>
            <Range label="Lower the water pressure" value={state.amount} ends={['Pressure held', 'Pressure falls']} onChange={amount}/>
            <button type="button" onClick={() => amount(0)}>Return the water</button>
          </>}
          {id === 'urban' && <>
            <Range label="Added building load" value={state.amount} ends={['No added load', 'Heavier load']} onChange={amount}/>
            <Range label="Paved surface" value={state.second} ends={['Open ground', 'More paving']} onChange={value => {setSelectedStep(null);dispatch({id,type:'second',value});}}/>
          </>}
          <p className="es-cause-result" role="status" aria-live="polite" aria-atomic="true">{reading}</p>
          <button type="button" className="es-cause-reset" onClick={() => {setSelectedStep(null);dispatch({id,type:'reset'});}}><RotateCcw size={16} aria-hidden="true"/>Reset experiment</button>
        </div>
      </div>
      <IndicatorLens key={id} id={id}/>
      <CauseCityContext id={id}/>
      <details className="es-cause-science"><summary>Source notes &amp; full explanation</summary><div>
        <p>{cause.short}</p><p>{cause.explanation}</p><p>{cause.mechanism}</p>
        <ul>{cause.indicators.map(item => <li key={item}>{item}</li>)}</ul><p>{cause.relevance}</p>
        <p>These controls explain relationships, not their size or speed. Compressibility, past stresses, geology, water supplies and drainage vary. Refilling does not necessarily reverse inelastic compaction. Reset starts the drawing again; it does not describe restoring real ground.</p>
        <p><a href="https://www.usgs.gov/centers/land-subsidence-in-california/science/aquifer-compaction-due-groundwater-pumping">USGS: aquifer compaction</a> · <a href="https://pubs.usgs.gov/circ/circ1186/html/gw_storage.html">USGS: groundwater storage and sediment response</a></p>
      </div></details>
    </article>
  </section>;
}
function Range({ label, value, ends, onChange }: { label: string; value: number; ends: string[]; onChange: (value: number) => void }) {
  const id = useId();
  return <div className="es-cause-range"><label htmlFor={id}>{label}</label><input id={id} type="range" min="0" max="100" value={Math.round(value*100)} aria-valuetext={`${Math.round(value*100)} on an illustrative control from ${ends[0].toLowerCase()} to ${ends[1].toLowerCase()}; not a measurement`} onChange={e => onChange(Number(e.target.value)/100)}/><div aria-hidden="true"><span>{ends[0]}</span><span>{ends[1]}</span></div></div>;
}
const WATER = '#80bdd3', EARTH = '#b8aa92', PALE = '#e9e8df';
function Flow({ d, active = true, strength = 1 }: { d: string; active?: boolean; strength?: number }) {
  const marker = useId();
  return <g><defs><marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1 L9 5 L1 9" fill="none" stroke={WATER} strokeWidth="2"/></marker></defs><path className="es-cause-moving" d={d} fill="none" stroke={WATER} strokeWidth="3" strokeDasharray="8 8" markerEnd={`url(#${marker})`} opacity={active?.15+.85*strength:.15}/></g>;
}
function Rain({ dryness=0, x=90, width=270 }: {dryness?:number;x?:number;width?:number}) {
  return <g>{Array.from({length:9},(_,i)=><path key={i} d={`M${x+i*width/9} 76 l-7 19`} stroke={WATER} strokeWidth="3" opacity={i/9<1-dryness?1:.12}/>)}<text x={x} y="55">{dryness>.6?'Less rain':'Rain'}</text></g>;
}
function Aquifer({ loss, compact, children }: { loss: number; compact: number; children?: ReactNode }) {
  const surface = 166 + compact*28;
  return <g>
    <rect x="48" y={surface} width="600" height={365-surface} fill="#303a35"/>
    <rect x="48" y={220+loss*95} width="600" height={145-loss*95} fill={WATER} opacity=".17"/>
    <path d="M48 166 H648" stroke={PALE} strokeDasharray="5 6" opacity=".6"/>
    <path d={`M48 ${surface} H648`} stroke={EARTH} strokeWidth="4"/>
    <rect x="48" y={258+compact*27} width="600" height={62-compact*27} fill={EARTH} opacity=".24"/>
    {Array.from({length:3},(_,r)=>Array.from({length:22},(_,c)=><ellipse key={`${r}-${c}`} cx={65+c*27} cy={270+compact*24+r*(18-compact*8)} rx="9" ry="3.5" fill={EARTH}/>))}
    <path d={`M48 ${220+loss*95} H648`} stroke={WATER} strokeWidth="2"/>
    <text x="58" y="390">Dashed line: original surface</text><text x="58" y="348" fill={WATER}>Water level</text>
    <text x="420" y="348">Clay &amp; silt layer</text>
    {children}
  </g>;
}
function Well({ active, ground=166 }: {active:boolean;ground?:number}) {
  return <g><path d={`M540 342 V125 H598 V${ground}`} stroke={PALE} strokeWidth="9" fill="none"/><path d="M540 337 V125 H598" stroke={active?WATER:'#56635e'} strokeWidth="4" fill="none"/><text x="505" y="100">Well</text>{active&&<><Flow d="M549 260 V156"/><path d="M543 163 l6 -10 6 10" stroke={WATER} fill="none" strokeWidth="2"/></>}</g>;
}
function MechanismDrawing({id,state,reading,focus}:{id:CauseId;state:Experiment;reading:string;focus:number|null}) {
  const {amount,peak,alternative,second}=state;
  const targets:Record<CauseId,number[][]>={
    groundwater:[[50,218+amount*95,590,45],[180,80,260,90],[50,258+peak*27,590,62-peak*27]],
    irrigation:[[80,110,385,85],[515,112,100,245],[50,258+amount*.65*27,590,62-amount*.65*27]],
    drought:[[75,50,300,95],[50,215+amount*80,585,45],[50,258+amount*.65*27,590,62-amount*.65*27]],
    geology:[[48,90,610,270],[385,95,280,265],[385,160,280,190]],
    urban:[[190,85,170,170],[410,100,265,205],[190,85,485,220]],
  };
  const target=focus===null?null:targets[id][focus];
  return <svg viewBox="0 0 700 400" role="img" aria-label={`${CAUSES.find(c=>c.id===id)!.title}. ${reading}`} data-mechanism={id}>
    {id==='groundwater'&&<>
      <Aquifer loss={amount} compact={peak}/><Well active={amount>.05} ground={166+peak*28}/>
      <g className="es-cause-moving" style={{transform:`translateY(${peak*28}px)`}}><path d="M320 112 V155 m-8 -10 8 10 8 -10" stroke={EARTH} strokeWidth="3" fill="none"/><text x="352" y="134">{peak>.05?'Surface settles':'Ground surface'}</text></g>
    </>}
    {id==='irrigation'&&<>
      <Aquifer loss={alternative?0:amount*.8} compact={alternative?0:amount*.65}/><Well active={!alternative&&amount>.05}/>
      <g className="es-cause-moving" style={{transform:`translateY(${alternative?0:amount*.65*28}px)`}}>{Array.from({length:8},(_,i)=><g key={i} opacity={i/8<amount?1:.13}><rect x={85+i*47} y="140" width="37" height="26" fill="#527b62"/>
        <Sprout x={91+i*47} y={111} width="25" height="25" color={PALE}/></g>)}</g>
      <text x="85" y="72">Irrigated fields</text>
      {alternative?<><path d="M48 94 H72 V156 H455" stroke={WATER} strokeWidth="5" fill="none"/><text x="300" y="45" fill={WATER}>Surface supply</text><Flow d="M57 94 V156 H455" active={amount>.05}/></>:<Flow d="M598 155 H85" active={amount>.05}/>}
    </>}
    {id==='drought'&&<>
      <Aquifer loss={amount*.85} compact={amount*.65}/><Rain dryness={amount}/><Well active/>
      {Array.from({length:5},(_,i)=><Flow key={i} d={`M${95+i*48} 110 V205`} active={i/5<1-amount}/>)}
      <text x="410" y="55">Same pumping</text>
    </>}
    {id==='geology'&&<>
      {[false,true].map((fine,index)=>{const compression=fine?peak:amount*.28;const x=55+index*335;return <g key={index}>
        <text x={x} y="55">{fine?'Fine clay & silt':'Coarse sand & gravel'}</text>
        <rect x={x} y="100" width="260" height="252" fill={WATER} opacity={.18-amount*.1}/>
        <path d={`M${x} 100 H${x+260}`} stroke={PALE} strokeDasharray="5 6" opacity=".6"/>
        <g className="es-cause-moving" style={{transform:`translateY(${compression*70}px) scaleY(${1-compression*.28})`,transformOrigin:`${x}px 100px`}}>
          <path d={`M${x} 100 H${x+260}`} stroke={EARTH} strokeWidth="4"/>
          {Array.from({length:6},(_,r)=>Array.from({length:6},(_,c)=><ellipse key={`${r}-${c}`} cx={x+23+c*43} cy={128+r*37} rx={fine?17:12} ry={fine?5:12} fill={EARTH}/>))}
        </g>
        <text x={x} y="385">{fine?(peak>.05?'More loss can remain':'Fine, flatter grains'):'Coarse grains, larger pores'}</text>
      </g>;})}
      <text x="210" y="29" fill={WATER}>Same water-pressure change</text>
    </>}
    {id==='urban'&&<>
      <path d="M48 180 H648 V360 H48Z" fill="#303a35"/>
      <path d={`M48 180 H185 Q275 ${180+amount*82} 365 180 H648`} stroke={EARTH} fill="none" strokeWidth="4"/>
      <path d="M48 180 H648" stroke={PALE} strokeDasharray="5 6" opacity=".4"/>
      <g className="es-cause-moving" style={{transform:`translateY(${amount*32}px)`}}><rect x="215" y={180-amount*65} width="115" height={amount*65} fill={EARTH}/><path d={`M272 ${100-amount*25} v32 m-8 -10 8 10 8 -10`} stroke={PALE} strokeWidth="3" fill="none"/></g>
      <text x="215" y="55">Added load</text><Rain x={420} width={200}/>
      <path d={`M415 176 H${415+second*225}`} stroke={PALE} strokeWidth="10"/>
      <Flow d="M451 112 V286" strength={1-second}/><Flow d="M576 112 V163 H665" strength={second}/>
      <text x="65" y="335">Local compression</text><text x="425" y="320" fill={WATER}>Infiltration</text><text x="560" y="220" fill={WATER}>Runoff</text>
    </>}
    {target&&<rect className="es-cause-focus" data-focus={focus} x={target[0]} y={target[1]} width={target[2]} height={target[3]} rx="4"/>}
    {id==='groundwater'&&focus===1&&<g stroke={EARTH} strokeWidth="3" fill="none">{[220,280,380].map(x=><path key={x} d={`M${x} 95 V145 m-7 -10 7 10 7 -10`}/>)}</g>}
  </svg>;
}
