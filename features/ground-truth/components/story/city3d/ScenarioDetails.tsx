import { useId, useMemo } from 'react';
import type { CityMode } from '@/lib/story-evidence';
import type { CityWorld } from './shared';

/** Original threshold exploration, separated from any diagnosis of real buildings. */
export function ScenarioDetails({world,mode,years,selected,onSeek}:{world:CityWorld;mode:CityMode;years:number;selected:number|null;onSeek:(year:number)=>void}) {
  const id=useId();
  const ratios=mode==='simulation'?[500,300,150,50]:[500,300,150];
  const colours=['#8bcec0','#f6c667','#ff905d','#cf654f'];
  const rungs=world.rungs(years,selected);
  const N=Math.max(1,world.buildingCount);
  const paths=useMemo(()=> (mode==='simulation'?[500,300,150,50]:[500,300,150]).map(r=>Array.from({length:61},(_,i)=>`${i===0?'M':'L'}${40+i*8},${175-world.countAt(r,i/2)/Math.max(1,world.buildingCount)*145}`).join(' ')),[world,mode]);
  return <details className="es-city-options es-city-scenario"><summary>{mode==='simulation'?'Explore the invented city’s thresholds and future':'Explore conditional ground-tilt thresholds'}</summary><div>
    <h4>{mode==='simulation'?'How the invented model changes':'If the estimated ground-tilt rates continued'}</h4>
    <p>{mode==='simulation'?'These thresholds drive the invented city’s cracks, tilt and collapse animation. Real buildings differ.':'The counts describe extrapolated ground tilt beneath mapped footprints. They do not count damaged buildings. Uncertainty, foundations and structural response prevent that inference.'} “1 in 300” means a 1 cm height difference over 3 m.</p>
    <figure><svg viewBox="0 0 560 210" role="img" aria-label={mode==='simulation'?'Illustrative model threshold counts over 30 relative years':'Conditional ground-tilt threshold counts over 30 years if short-record rates continued'} onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();onSeek(Math.max(0,Math.min(30,((event.clientX-rect.left)/rect.width*560-40)/480*30)));}}>
      {[0,10,20,30].map(year=><g key={year}><line x1={40+year*16} x2={40+year*16} y1="22" y2="175" stroke="#404948"/><text x={40+year*16} y="198" fill="#b5bcb8" fontSize="13" textAnchor="middle">{year}</text></g>)}
      <text x="4" y="29" fill="#b5bcb8" fontSize="12">{N}</text><text x="20" y="178" fill="#b5bcb8" fontSize="12">0</text>
      {paths.map((path,index)=><path key={ratios[index]} d={path} fill="none" stroke={colours[index]} strokeWidth="2.5"/>)}
      <line x1={40+years*16} x2={40+years*16} y1="22" y2="175" stroke="#f1eee7" strokeWidth="2"/>
    </svg><figcaption>Horizontal: {mode==='simulation'?'relative simulation years':'years beyond the observation baseline'}. Vertical: footprint count. Select a year on the chart, or use the slider below.</figcaption></figure>
    <label htmlFor={`${id}-seek`}>Inspect year {years.toFixed(1)}<input id={`${id}-seek`} type="range" min="0" max="30" step=".1" value={years} onChange={event=>onSeek(Number(event.target.value))}/></label>
    <div className="es-city-threshold-scroll"><table><caption>{mode==='simulation'?'Illustrative model counts':'Conditional ground-tilt exceedances — not damage predictions'}</caption><thead><tr><th>Threshold</th><th>Footprints at year {years.toFixed(1)}</th><th>First crossing in this model</th></tr></thead><tbody>{ratios.map((ratio,index)=>{const rung=rungs.find(item=>item.r===ratio);return <tr key={ratio}><th scope="row"><span style={{color:colours[index]}}>1 in {ratio}</span>{rung?.mine?' · selected footprint':''}{ratio===50?' · illustrated collapse':''}</th><td>{world.countAt(ratio,years)}</td><td>{rung&&Number.isFinite(rung.first)&&rung.first<=30?`After ${rung.first.toFixed(1)} years`:'Not within 30 years'}</td></tr>;})}</tbody></table></div>
    <p>Reference threshold context: Bjerrum (1963), as used by the original teaching model. No standard used here predicts a collapse date. The model keeps its rates fixed; real rates can change, and ground tilt is not a measured building response.</p>
  </div></details>;
}
