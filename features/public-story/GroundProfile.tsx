'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { SiteLink as Link } from '@/components/site-link';
import { useStory } from '@/features/ground-truth/components/story/StoryProvider';
import { useVisibleReplay } from '@/features/ground-truth/components/story/useVisibleReplay';
import { usePrefersReducedMotion, useTimeline } from '@/features/ground-truth/lib/useTimeline';
import { formatPeriod, formatVertical, type LoadedBundle } from '@/features/ground-truth/data/nisar';
import { defaultGroundLine, groundLineKm, groundOffset, groundProfile, type GroundLine, type GroundProfileView, type GroundSegment } from '@/lib/ground-profile';
import './ground-profile.css';

export function GroundProfile({ bundle, onViewChange }: { bundle: LoadedBundle; onViewChange: (view: GroundProfileView | null) => void }) {
  const [line, setLine] = useState<GroundLine>(()=>defaultGroundLine(bundle.grid));
  const [index, setIndex] = useState(0);
  const segments = useMemo(()=>groundProfile(bundle.grid,line),[bundle.grid,line]);
  const selected = segments[Math.min(index,segments.length-1)];
  const km = groundLineKm(line);
  const id = useId();
  useEffect(()=>{ onViewChange(selected?{line,point:selected.point}:null); },[line,selected,onViewChange]);
  const changeLine = (next: GroundLine) => { setLine(next); setIndex(0); };
  const describe = (s: GroundSegment) => `${(((s.from+s.to)/2)*km).toFixed(1)} kilometres from A. ${s.rate===null?'No measurement':formatVertical(s.rate)}.`;
  return <div className="es-ground-profile">
    <h4>A line through the sinking bowl</h4>
    <p>Follow A to B on the map. Each step represents a {bundle.manifest.values.cell_m} m display-grid cell; gaps have no measurement.</p>
    <ProfilePlot segments={segments} km={km} selected={index} onSelect={setIndex}/>
    {selected ? <>
      <label htmlFor={`${id}-cell`}>Move along the line</label>
      <input id={`${id}-cell`} type="range" min={0} max={segments.length-1} step={1} value={Math.min(index,segments.length-1)} aria-valuetext={describe(selected)} onChange={event=>setIndex(Number(event.target.value))}/>
      <div className="es-profile-reading" aria-live="polite"><strong>{selected.rate===null?'No measurement here':formatVertical(selected.rate)}</strong><span>{(((selected.from+selected.to)/2)*km).toFixed(1)} km from A · {selected.point.lat.toFixed(4)}° N, {selected.point.lng.toFixed(4)}° E</span><span>{selected.sigma===null?'Source-pixel uncertainty unavailable':`Typical source-pixel error here: ±${Math.round(selected.sigma)} mm/year (one standard error).`}</span></div>
    </> : <p role="status">The endpoints must be different valid coordinates. No profile is available for this line.</p>}
    <p className="es-caption">{formatPeriod(bundle.manifest)} · {bundle.manifest.source.product_status}, relative rates. Shading carries source-pixel error; it is not a confidence band for the difference between places.</p>
    <details className="es-disclosure"><summary>If these rates continued…</summary><FutureProfile segments={segments} km={km}/></details>
    <details className="es-disclosure"><summary>Choose a different line or read the method</summary><div className="es-disclosure-body">
      <form onSubmit={event=>{event.preventDefault();const values=new FormData(event.currentTarget);changeLine({start:{lat:Number(values.get('a-lat')),lng:Number(values.get('a-lng'))},end:{lat:Number(values.get('b-lat')),lng:Number(values.get('b-lng'))}});}}>
        <div className="es-profile-endpoints">{(['start','end'] as const).map((end,i)=><fieldset key={`${end}-${line[end].lat}-${line[end].lng}`}><legend>Endpoint {i===0?'A':'B'}</legend><label>Latitude<input name={`${i===0?'a':'b'}-lat`} type="number" min={-90} max={90} step="any" required defaultValue={line[end].lat}/></label><label>Longitude<input name={`${i===0?'a':'b'}-lng`} type="number" min={-180} max={180} step="any" required defaultValue={line[end].lng}/></label></fieldset>)}</div>
        <button type="submit" className="es-action">Read this line</button>{' '}<button type="button" className="es-action" onClick={()=>changeLine(defaultGroundLine(bundle.grid))}>Reset line</button>
      </form>
      <p>This is a spatial profile, not a history. The {bundle.manifest.values.cell_m} m display grid contains {bundle.manifest.values.method}. Values and error summaries are read unchanged; they are not smoothed, averaged along the line or treated as independent samples. Outside-grid positions and missing values stay unavailable.</p>
      <p>The error summary is the median source-pixel standard error, not the standard error of a cell median. Spatial covariance and future model error are not supplied. A zero rate is the regional reference, not proof of stable ground. Distance is an approximate spherical distance.</p>
      <Link href="/explore#explore-city-title">Explore the measured neighbourhood in 3D →</Link>{' · '}<Link href="/workspace">Open the full investigation tools →</Link>
    </div></details>
  </div>;
}

function ProfilePlot({segments,km,selected,onSelect,years}:{segments:GroundSegment[];km:number;selected?:number;onSelect?:(index:number)=>void;years?:number}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width,setWidth] = useState(760);
  const id = useId();
  useEffect(()=>{if(!ref.current||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(([entry])=>setWidth(Math.max(260,Math.round(entry.contentRect.width))));observer.observe(ref.current);return()=>observer.disconnect();},[]);
  const future = years!==undefined;
  const limitRate = Math.max(100,...segments.filter(s=>s.rate!==null).map(s=>Math.abs(s.rate!)+(future?0:s.sigma??0)));
  // Keep a fixed future scale while the time slider moves, including year zero.
  const limit = future ? Math.ceil(limitRate*20/1000) : Math.ceil(limitRate/100)*100;
  const left=48,right=width-14,top=24,bottom=226;
  const x=(t:number)=>left+t*(right-left), y=(value:number)=>top+(limit-value)/(2*limit)*(bottom-top);
  return <div ref={ref} className="es-profile-plot"><svg viewBox={`0 0 ${width} 270`} role="img" aria-labelledby={`${id}-title ${id}-desc`} onPointerDown={onSelect?event=>{const bounds=event.currentTarget.getBoundingClientRect();const t=Math.max(0,Math.min(1,((event.clientX-bounds.left)*width/bounds.width-left)/(right-left)));const i=segments.findIndex(s=>t>=s.from&&t<=s.to);if(i>=0)onSelect(i);}:undefined}>
    <title id={`${id}-title`}>{future?'Conditional movement from a flat reference, not terrain or a forecast':'Measured vertical-rate profile along A to B, positive upward'}</title>
    <desc id={`${id}-desc`}>Each step is one frozen display-grid cell. Blank hatched spans have no measurements. The slider and text reading provide a keyboard alternative.</desc>
    <defs><pattern id={`${id}-gap`} width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 8L8 0" stroke="#77847f" strokeWidth="1"/></pattern></defs>
    {[-limit,0,limit].map(value=><g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} className="es-profile-grid"/><text x={left-7} y={y(value)+4} textAnchor="end">{value}</text></g>)}
    <text x={left} y={14}>{future?'Offset (m)':'Rate (mm/year)'}</text>
    {segments.map((s,i)=>s.rate===null?<rect key={i} x={x(s.from)} y={top} width={Math.max(.5,x(s.to)-x(s.from))} height={bottom-top} fill={`url(#${id}-gap)`} opacity=".23"/>:<g key={i}>
      {!future&&s.sigma!==null&&<rect x={x(s.from)} y={y(s.rate+s.sigma)} width={Math.max(.5,x(s.to)-x(s.from))} height={y(s.rate-s.sigma)-y(s.rate+s.sigma)} fill="#8bcec0" opacity=".17"/>}
      <line x1={x(s.from)} x2={x(s.to)} y1={y(future?groundOffset(s.rate,years!)!:s.rate)} y2={y(future?groundOffset(s.rate,years!)!:s.rate)} stroke={future?'#f6c667':i===selected?'#f1eee7':'#8bcec0'} strokeWidth={i===selected?4:2} strokeDasharray={future?'4 2':undefined}/>
    </g>)}
    {selected!==undefined&&segments[selected]&&<line x1={x((segments[selected].from+segments[selected].to)/2)} x2={x((segments[selected].from+segments[selected].to)/2)} y1={top} y2={bottom} stroke="#f1eee7" strokeDasharray="3 4"/>}
    <text x={left} y={249}>A · 0 km</text><text x={right} y={249} textAnchor="end">B · {km.toFixed(1)} km</text><text x={left} y={266}>Up ↑ · Down ↓ · gaps are unmeasured</text>
  </svg></div>;
}

function FutureProfile({segments,km}:{segments:GroundSegment[];km:number}) {
  const ref=useRef<HTMLDivElement>(null);
  const [visible,setVisible]=useState(false),[started,setStarted]=useState(false);
  const {paused,replayToken}=useStory();
  const reduced=usePrefersReducedMotion();
  useEffect(()=>{if(!ref.current)return;const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting));observer.observe(ref.current);return()=>observer.disconnect();},[]);
  const timeline=useTimeline(14000,{enabled:visible&&!paused,autoplay:false});
  const years=started?Math.round(timeline.progress*200)/10:0;
  const id=useId();
  const seek=(value:number)=>{setStarted(true);timeline.pause();timeline.seek(value/20);};
  useVisibleReplay(replayToken,visible,()=>seek(0));
  return <div ref={ref} className="es-disclosure-body"><h4>One assumption, made visible</h4><p><strong>Conditional movement after {years.toFixed(1)} years.</strong> This holds the short-record rates fixed. It is not a measured history, terrain elevation or a prediction of building damage.</p>
    <ProfilePlot segments={segments} km={km} years={years}/>
    <label htmlFor={`${id}-years`}>Years after the observation baseline</label><input id={`${id}-years`} type="range" min={0} max={20} step={.1} value={years} onChange={e=>seek(Number(e.target.value))}/>
    <div className="es-profile-actions"><button type="button" className="es-action" disabled={paused||reduced} onClick={()=>{setStarted(true);if(timeline.playing)timeline.pause();else if(timeline.done)timeline.replay();else timeline.play();}}>{timeline.playing?'Pause change':'Animate this assumption'}</button><button type="button" className="es-action" onClick={()=>seek(0)}>Return to baseline</button></div>
    <p className="es-caption">A flat reference makes differences in movement visible; it does not reconstruct the shape of the land. Missing cells stay missing, even at year zero. No future uncertainty band has been estimated. {reduced?'Reduced motion: compare still states with the slider.':paused?'Story animations are paused in the header.':''}</p>
  </div>;
}
