'use client';
import {useId,useState} from 'react';
import {Satellite,RotateCcw} from 'lucide-react';
import {MISSIONS} from '@/features/ground-truth/data/satellites';
import {NISAR_BUNDLES,useNisarBundle} from '@/features/ground-truth/data/nisar';
import {useStory} from '@/features/ground-truth/components/story/StoryProvider';
import {MISSION_VIEWS,missionConnection,wavelengthPath,type MissionId,type MissionKind} from './mission-comparison-model';
import './mission-comparison.css';

export default function MissionComparison(){
  const {paused,replayToken}=useStory();
  const result=useNisarBundle(NISAR_BUNDLES.tehran);
  return <MissionComparisonView key={replayToken} paused={paused} connection={result}/>;
}
export function MissionComparisonView({paused,connection}:{paused:boolean;connection:Parameters<typeof missionConnection>[1]}){
  const [primary,setPrimary]=useState<MissionId>('nisar');
  const [compare,setCompare]=useState<MissionId|'none'>('sentinel-1');
  const [changed,setChanged]=useState(false);
  const uid=useId();
  const selected=MISSION_VIEWS[primary];
  const mission=MISSIONS.find(m=>m.id===primary)!;
  const selectedIds:MissionId[]=compare==='none'?[primary]:[primary,compare];
  const pick=(id:MissionId)=>{if(id===compare)setCompare(primary);setPrimary(id);setChanged(false);};
  return <section className="es-mission-lab" data-paused={paused} aria-label="Visual satellite mission comparison">
    <p className="es-mission-invitation">Different signals. Different questions. Choose a mission to see how it works.</p>
    <div className="es-mission-picker" role="group" aria-label="Satellite missions">
      {MISSIONS.map(m=><button type="button" key={m.id} aria-pressed={primary===m.id} onClick={()=>pick(m.id as MissionId)}>{MISSION_VIEWS[m.id as MissionId].name}</button>)}
    </div>
    <div className="es-mission-focus">
      <div className="es-mission-heading"><h4>{selected.name}</h4><span>{mission.agency}</span></div>
      <div className="es-mission-scene-grid">
        <figure className="es-mission-scene"><TechniqueDrawing kind={selected.kind} changed={changed}/><figcaption>Conceptual diagram · not acquired imagery · geometry and changes exaggerated</figcaption></figure>
        <div className="es-mission-controls">
          <h5>{selected.use}</h5>
          <p>{selected.kind==='radar'?'Send a signal. Visit again. Compare the return.':selected.kind==='optical'?'Read the light returning from the surface.':'Watch a pair of satellites respond to changing mass.'}</p>
          <div className="es-mission-scene-actions"><button type="button" onClick={()=>setChanged(!changed)} aria-pressed={changed}>{changed?'Show earlier state':selected.action}</button><button type="button" aria-label="Reset mission diagram" onClick={()=>setChanged(false)}><RotateCcw size={17} aria-hidden="true"/></button></div>
          <p className="es-mission-result" role="status" aria-live="polite" aria-atomic="true">{changed?selected.result:'Try a change in the diagram. This is a mechanism lesson, not a new observation.'}</p>
        </div>
      </div>
    </div>
    <div className="es-mission-compare-control"><label htmlFor={`${uid}-compare`}>Compare {selected.name} with</label><select id={`${uid}-compare`} value={compare} onChange={e=>setCompare(e.target.value as MissionId|'none')}><option value="none">Just this mission</option>{MISSIONS.filter(m=>m.id!==primary).map(m=><option key={m.id} value={m.id}>{MISSION_VIEWS[m.id as MissionId].name}</option>)}</select></div>
    <table className="es-mission-matrix"><caption>Different tools for different parts of the story</caption><thead><tr><th scope="col">Readout</th>{selectedIds.map(id=><th scope="col" key={id}>{MISSION_VIEWS[id].name}</th>)}</tr></thead><tbody>
      <tr><th scope="row">Signal</th>{selectedIds.map(id=><td key={id}><strong>{MISSION_VIEWS[id].signal}</strong><SignalDrawing id={id}/></td>)}</tr>
      <tr><th scope="row">Useful for</th>{selectedIds.map(id=><td key={id}>{MISSION_VIEWS[id].use}</td>)}</tr>
      <tr><th scope="row">Keep in mind</th>{selectedIds.map(id=><td key={id}>{MISSION_VIEWS[id].limit}</td>)}</tr>
    </tbody></table>
    {selectedIds.some(id=>MISSION_VIEWS[id].kind==='radar')&&<p className="es-mission-wave-note">Radar wave spacing uses the same 0–48 cm axis. Wavelengths are approximate. These symbols do not compare image resolution or accuracy.</p>}
    <div className="es-mission-connections" aria-label="Data connected to this public comparison">{selectedIds.map(id=>{const c=missionConnection(id,connection);return <div key={id} data-connection={c.state}><h5>{MISSION_VIEWS[id].name} · in this experience</h5><p>{c.title}</p><p>{c.detail}</p></div>;})}</div>
    <details className="es-mission-records"><summary>Full instruments, techniques &amp; source records</summary><div>{selectedIds.map(id=>{const m=MISSIONS.find(item=>item.id===id)!;return <article key={id}><h5>{MISSION_VIEWS[id].name}</h5><dl><div><dt>Agency and instrument</dt><dd>{m.agency} · {m.sensor}</dd></div><div><dt>Band</dt><dd>{m.band}</dd></div><div><dt>Technique</dt><dd>{m.technique}</dd></div><div><dt>Purpose</dt><dd>{m.purpose}</dd></div><div><dt>Data access and limitations</dt><dd>{id==='nisar'?missionConnection(id,connection).detail:m.availabilityNote}</dd></div></dl>{id==='landsat'&&<p>OLI/OLI-2 collect reflected light; thermal imagery uses TIRS/TIRS-2.</p>}<a href={MISSION_VIEWS[id].source}>Mission and instrument source</a></article>;})}<p>These are mission families referenced in this story, not a live fleet-status inventory. Product access is separate from a dataset being connected here. The technical record retains the original mission descriptions.</p></div></details>
  </section>;
}
const WATER='#80bdd3',EARTH='#b8aa92';
function TechniqueDrawing({kind,changed}:{kind:MissionKind;changed:boolean}){
  const radar=kind==='radar',optical=kind==='optical';
  const description=radar?'Repeated radar paths change when the ground moves.':optical?'A schematic pixel grid changes as land cover changes. No ground-motion rate is produced.':'A satellite pair detects spacing changes as the distribution of mass changes. This is not a city groundwater measurement.';
  return <svg viewBox="0 0 660 320" role="img" aria-label={`${description} ${changed?'Changed state.':'Earlier state.'}`} data-technique={kind}>
    {radar?<>
      <Satellite x="95" y="36" width="50" height="50" strokeWidth="1.5"/>
      <text x="170" y="60">Repeat the same observation</text>
      <path d="M125 86 L405 237 L145 86" stroke="currentColor" fill="none" strokeWidth="2" strokeDasharray="6 6" opacity=".45"/>
      <path className="es-mission-moving" d={`M125 86 L405 ${changed?273:237} L145 86`} stroke={WATER} fill="none" strokeWidth="3"/>
      <path d="M70 237 H590" stroke="currentColor" strokeDasharray="5 7" opacity=".45"/>
      <g className="es-mission-moving" style={{transform:`translateY(${changed?36:0}px)`}}><path d="M70 237 H590 V264 H70Z" fill={EARTH} opacity=".55"/><circle cx="405" cy="237" r="6" fill={WATER}/></g>
      <text x="75" y="210">Same ground target</text><text x="445" y="305" fill={WATER}>{changed?'Longer radar path':'Earlier surface'}</text>
    </>:optical?<>
      <Satellite x="105" y="30" width="50" height="50" strokeWidth="1.5"/><text x="180" y="55">Observe the returning light</text>
      <path d="M130 85 L110 235 H525Z" fill={WATER} opacity=".08"/><path d="M130 85 L110 235 M130 85 L525 235" stroke={WATER} strokeWidth="2"/>
      {Array.from({length:5},(_,r)=>Array.from({length:8},(_,c)=><rect key={`${r}-${c}`} x={115+c*50} y={120+r*29} width="46" height="25" fill={r===2||c===6?WATER:changed&&r<3&&c<5?EARTH:'#67856c'} opacity=".85"/>))}
      <text x="110" y="300">{changed?'Changed land cover':'Land cover, seen as pixels'}</text>
    </>:<>
      <Satellite x="100" y="40" width="45" height="45" strokeWidth="1.5"/><g className="es-mission-moving" style={{transform:`translateX(${changed?28:0}px)`}}><Satellite x="445" y="40" width="45" height="45" strokeWidth="1.5"/></g>
      <path d={`M155 63 H${changed?461:433}`} stroke={WATER} strokeWidth="3" strokeDasharray="6 6"/><text x="175" y="35">Track tiny spacing changes</text>
      <path d="M60 247 Q325 178 590 247" stroke={EARTH} strokeWidth="3" fill="none"/>
      <path d="M85 263 Q325 200 565 263" stroke={EARTH} strokeWidth="2" fill="none" opacity=".5"/>
      {Array.from({length:12},(_,i)=><circle key={i} cx={205+(i%6)*35} cy={235+Math.floor(i/6)*28} r="9" fill={WATER} opacity={changed&&i>3?.1:.85}/>)}
      <text x="92" y="303">Regional mass, including water</text>
    </>}
  </svg>;
}
function SignalDrawing({id}:{id:MissionId}){
  const view=MISSION_VIEWS[id];
  if(view.wavelength)return <><span className="es-mission-wavelength-label">{id==='nisar'?'L-band shown · ':''}≈{view.wavelength} cm</span><svg viewBox="0 0 232 70" role="img" aria-label={`Approximate ${view.wavelength} centimetre radar wavelength on a 0 to 48 centimetre axis${id==='nisar'?'; L-band channel':''}`}><path d="M20 28 H212" stroke="currentColor" opacity=".25"/><path d={wavelengthPath(view.wavelength)} stroke={WATER} fill="none" strokeWidth="2"/><text x="20" y="63">0</text><text x="116" y="63" textAnchor="middle">24</text><text x="212" y="63" textAnchor="end">48 cm</text></svg></>;
  return <svg viewBox="0 0 232 70" role="img" aria-label={view.kind==='optical'?'Optical and infrared bands, shown schematically':'A pair measures changes in spacing; not a radar wavelength'}>{view.kind==='optical'?<><rect x="20" y="14" width="56" height="20" fill="#67856c"/><rect x="82" y="14" width="56" height="20" fill={WATER}/><rect x="144" y="14" width="56" height="20" fill={EARTH}/><text x="20" y="63">Light, not radar</text></>:<><Satellite x="20" y="5" width="32" height="32"/><Satellite x="175" y="5" width="32" height="32"/><path d="M60 22 H165" stroke={WATER} strokeWidth="2" strokeDasharray="5 5"/><text x="20" y="63">Gravity, not radar</text></>}</svg>;
}
