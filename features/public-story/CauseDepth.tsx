'use client';
import {useState} from 'react';
import {ArrowRight,Plus} from 'lucide-react';
import {SiteLink} from '@/components/site-link';
import {CAUSES} from '@/features/ground-truth/data/causes';
import {StoryPhotography} from './StoryPhotography';
import type {CauseId} from './cause-experiment-model';
import {INDICATOR_VIEWS,MECHANISM_STEPS,type ClueKind,type MechanismStep} from './cause-depth-model';
import './cause-depth.css';

export function MechanismGuide({id,active,onSelect}:{id:CauseId;active:number|null;onSelect:(index:number,step:MechanismStep)=>void}){
 return <div className="es-mechanism-guide"><p>{id==='urban'?'Try the two pathways':'Follow the mechanism'} <span>Each step opens a fresh demonstration.</span></p><ol aria-label="Mechanism demonstration steps">{MECHANISM_STEPS[id].map((step,index)=><li key={step.title}><button type="button" aria-label={`Start a fresh demonstration: ${step.title}`} aria-pressed={active===index} onClick={()=>onSelect(index,step)}>{step.title}</button>{index<2&&(id==='urban'&&index===0?<Plus size={17} aria-hidden="true"/>:<ArrowRight size={17} aria-hidden="true"/>)}</li>)}</ol></div>;
}
export function IndicatorLens({id}:{id:CauseId}){
 const [selected,setSelected]=useState(0);
 const source=CAUSES.find(c=>c.id===id)!;
 const clue=INDICATOR_VIEWS[id][selected];
 return <section className="es-indicator-lens" aria-label="Visual indicators to investigate">
  <header><h5>Look for the clues.</h5><p>Illustrative patterns, not measurements from Tehran or Tokyo.</p></header>
  <div className="es-indicator-layout"><div className="es-indicator-picker" role="group" aria-label="Clues to investigate">{INDICATOR_VIEWS[id].map((item,index)=><button type="button" key={item.label} aria-pressed={selected===index} aria-label={source.indicators[index]} onClick={()=>setSelected(index)}>{item.label}<ArrowRight size={17} aria-hidden="true"/></button>)}</div>
   <figure><ClueDiagram kind={clue.kind} mismatch={id==='geology'} label={source.indicators[selected]}/><figcaption><strong>{source.indicators[selected]}</strong><span aria-live="polite">{clue.reading}</span></figcaption></figure>
  </div>
 </section>;
}
export function CauseCityContext({id}:{id:CauseId}){
 const cause=CAUSES.find(c=>c.id===id)!;
 return <section className="es-cause-city-context" aria-label="Tehran and Tokyo context"><header><h5>Take the idea to a real place.</h5><p>{cause.relevance}</p></header><div className="es-cause-city-pair">
  <article><StoryPhotography subject="tehran"/><h6>Tehran · measured ground motion</h6><p>The connected radar result shows where ground moved. That pattern alone cannot identify its cause.</p><SiteLink href="/explore">Explore Tehran’s evidence <ArrowRight size={17} aria-hidden="true"/></SiteLink></article>
  <article><StoryPhotography subject="tokyo"/><h6>Tokyo · a published response</h6><p>A historical groundwater-management case, rather than a measured breakdown of these five drivers.</p><SiteLink href="/#what-we-can-do">See Tokyo’s response <ArrowRight size={17} aria-hidden="true"/></SiteLink></article>
 </div></section>;
}
const BLUE='#80bdd3',SAND='#b8aa92';
function ClueDiagram({kind,label,mismatch}:{kind:ClueKind;label:string;mismatch:boolean}){
 const time=['level','rain','break','recovery','seasonal'].includes(kind);
 const axes=<g><path d="M90 45 V242 H605" stroke="currentColor" fill="none" opacity=".55"/><text x="90" y="278">Earlier</text><text x="535" y="278">Later</text></g>;
 return <svg viewBox="0 0 680 300" role="img" aria-label={`${label}. Illustrative clue pattern, not measured city data.`} data-clue={kind}>
  {time&&axes}
  {kind==='level'&&<><text x="105" y="35">Groundwater level</text><path d="M100 72 L190 90 L280 115 L370 142 L460 175 L590 215" fill="none" stroke={BLUE} strokeWidth="4"/><text x="310" y="82">A falling level</text></>}
  {kind==='rain'&&<><text x="105" y="35">Rainfall history</text>{[145,163,131,103,77,59,42,28].map((height,i)=><rect key={i} x={110+i*61} y={242-height} width="37" height={height} fill={BLUE}/>)}<path d="M100 118 H595" stroke={SAND} strokeWidth="2" strokeDasharray="6 6"/><text x="330" y="98">Reference rainfall</text></>}
  {kind==='break'&&<><rect x="360" y="48" width="230" height="193" fill={SAND} opacity=".12"/><text x="385" y="77">Dry interval</text><path d="M100 105 L210 112 L320 120 L385 145 L470 190 L590 232" fill="none" stroke={BLUE} strokeWidth="4"/><text x="105" y="35">Ground-motion pattern</text></>}
  {kind==='seasonal'&&<><text x="105" y="35">Compare timing, not just size</text>{[0,1].map(row=><path key={row} d={Array.from({length:81},(_,i)=>`${i?'L':'M'}${100+i*6} ${95+row*115+(row?1:-1)*Math.sin(i/80*Math.PI*6)*22}`).join(' ')} stroke={row?SAND:BLUE} strokeWidth="3" fill="none"/>)}<text x="400" y="62" fill={BLUE}>Water use</text><text x="395" y="170" fill={SAND}>Ground response</text></>}
  {kind==='recovery'&&<><text x="105" y="35">Return of water ≠ return of height</text><path d="M100 80 L220 160 L340 180 L450 110 L590 80" stroke={BLUE} fill="none" strokeWidth="4"/><path d="M100 170 L220 207 L340 225 H590" stroke={SAND} fill="none" strokeWidth="4"/><text x="390" y="62" fill={BLUE}>Water level</text><text x="430" y="207" fill={SAND}>Ground height</text></>}
  {(kind==='bowl'||kind==='load')&&<><path d="M75 105 H610" stroke="currentColor" strokeDasharray="6 6" opacity=".5"/><path d="M75 110 Q200 110 270 173 Q340 238 410 173 Q480 110 610 110" stroke={SAND} strokeWidth="4" fill="none"/><text x="80" y="82">Surrounding ground</text><text x="235" y="270">Local settling pattern</text>{kind==='load'?<><rect x="295" y="45" width="90" height="70" fill={SAND} opacity=".75"/><path d="M340 125 V172 m-8 -10 8 10 8 -10" stroke={BLUE} strokeWidth="3" fill="none"/></>:<><path d="M340 45 V175" stroke={BLUE} strokeWidth="4"/><text x="378" y="53">Area to investigate</text></>}</>}
  {kind==='wells'&&<><text x="95" y="36">{kind==='wells'?'Compare well records':'Read the sediment layers'}</text><rect x="115" y="60" width="160" height="195" fill="#354239"/>{[0,1,2,3].map(i=><rect key={i} x="115" y={77+i*46} width="160" height={i===1?34:17} fill={SAND} opacity={i===1?.8:.4}/>)}<path d="M410 65 V155 M520 65 V252" stroke={BLUE} strokeWidth="6"/><text x="348" y="54">Earlier</text><text x="489" y="54">Deeper</text><text x="335" y="285">{kind==='wells'?'Depth alone is not a diagnosis':'Fine layers among coarse material'}</text></>}
  {kind==='core'&&<><text x="105" y="35">Read the sediment layers</text><path d="M120 70 V255 m-7 -10 7 10 7 -10" stroke="currentColor" strokeWidth="2"/><rect x="180" y="65" width="200" height="195" fill="#354239"/><rect x="180" y="120" width="200" height="75" fill={SAND} opacity=".7"/><path d="M180 85 H380 M180 220 H380 M180 245 H380" stroke={SAND} strokeWidth="5" opacity=".4"/><text x="420" y="95">Sand &amp; gravel</text><text x="420" y="165">Clay &amp; silt</text><text x="420" y="240">Coarser layers</text><text x="180" y="290">Schematic log, not a city borehole.</text></>}
  {kind==='reservoir'&&<><path d="M90 75 L165 245 H515 L590 75" stroke={SAND} strokeWidth="4" fill="none"/><path d="M115 130 H565" stroke="currentColor" strokeDasharray="6 6" opacity=".6"/><path d="M150 210 H530 L515 245 H165Z" fill={BLUE} opacity=".5"/><text x="200" y="112">Earlier water level</text><text x="230" y="195" fill={BLUE}>Lower level</text><text x="125" y="285">Surface water is not groundwater storage.</text></>}
  {kind==='map'&&<><text x="90" y="36">Water use</text><text x="390" y="36">Ground motion</text>{[0,1].map(col=><g key={col}><rect x={75+col*300} y="65" width="220" height="190" fill="#303a35"/>{[0,1,2].map(row=><path key={row} d={`M${80+col*300} ${96+row*58} H${290+col*300}`} stroke={SAND} opacity=".35"/>)}{[30,55,80].map(r=><ellipse key={r} cx={185+col*300+(mismatch&&col?35:0)} cy={160-(mismatch&&col?20:0)} rx={r} ry={r*.75} fill="none" stroke={col?SAND:BLUE} strokeWidth="3"/>)}</g>)}<text x="100" y="285">{mismatch?'Different shapes prompt more questions.':'Matching locations are a clue, not proof.'}</text></>}
  {kind==='runoff'&&<><text x="90" y="40">Follow the rain</text><path d="M70 130 H610" stroke={SAND} strokeWidth="4"/><path d="M395 126 H610" stroke="currentColor" strokeWidth="9"/><path d="M165 65 V235 m-9 -12 9 12 9 -12 M465 65 V105 H590 m-12 -9 12 9 -12 9" stroke={BLUE} strokeWidth="4" fill="none"/><text x="105" y="275">Open: infiltrate</text><text x="382" y="275">Paved: divert</text></>}
 </svg>;
}
