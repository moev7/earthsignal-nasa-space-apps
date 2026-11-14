import type { WaterTransitionAccounting } from '@/lib/observatory-contract';

export const WATER_TRANSITION_CATEGORIES = [
  {key:'gain',label:'Newly mapped as open water',color:'#a6eb66'},
  {key:'loss',label:'No longer mapped as open water',color:'#f3996f'},
  {key:'persistentClass1',label:'Open water on both dates',color:'#56b2d8'},
  {key:'nonClass1Both',label:'Not mapped as open water on either date',color:'#535e60'},
  {key:'unknown',label:'Could not compare',color:'#a0a3aa'},
] as const;

const area=(value:number)=>value.toLocaleString(undefined,{maximumSignificantDigits:4});

export function WaterTransitionInsights({report,before,after}:{report:WaterTransitionAccounting;before:string;after:string}) {
  const c=report.counts;
  if(report.validPixels===0)return <section className="water-transition-insights" aria-label="Mapped open-water changes unavailable"><h4>No comparison available</h4><p>There are no map cells that can be compared on both dates. We cannot measure gains, losses or no change from these observations. Try another pair of dates or inspect the source coverage.</p></section>;
  return <section className="water-transition-insights" aria-label="Mapped open-water changes">
    <div className="water-transition-heading"><h4>Where mapped open water changed</h4><span className="claim-tag">Derived</span></div>
    <p>{before.slice(0,10)} → {after.slice(0,10)}. These two observations show which places were mapped as open water, and which could not be compared.</p>
    <div className="water-transition-metrics">
      <div><strong>{area(report.areasKm2.gain)} <small>km²</small></strong><span>Newly mapped open water</span></div>
      <div><strong>{area(report.areasKm2.loss)} <small>km²</small></strong><span>No longer mapped open water</span></div>
      <div><strong>{area(report.netChangeKm2)} <small>km²</small></strong><span>Net mapped change</span></div>
      <div><strong>{area(report.turnoverKm2)} <small>km²</small></strong><span>Total area that changed category</span></div>
    </div>
    {c.gain>0&&c.gain===c.loss&&<p className="water-transition-offset">The newly mapped and no-longer-mapped areas are equal. The total is unchanged, but the places mapped as open water changed.</p>}
    <div className="water-transition-bar" role="img" aria-label={`Selected-area pixels: ${WATER_TRANSITION_CATEGORIES.map(x=>`${x.label} ${c[x.key]}`).join(', ')}.`}>
      {WATER_TRANSITION_CATEGORIES.map(x=><span key={x.key} style={{width:`${100*c[x.key]/report.totalPixels}%`,background:x.color}}/>)}
    </div>
    <dl className="water-transition-counts">{WATER_TRANSITION_CATEGORIES.map(x=><div key={x.key}><dt><i style={{background:x.color}} aria-hidden="true"/>{x.label}</dt><dd>{c[x.key].toLocaleString()} {c[x.key]===1?'map cell':'map cells'} <span>· {area(report.areasKm2[x.key])} km²</span></dd></div>)}</dl>
    <p className="water-transition-support">{report.validPixels.toLocaleString()} comparable / {report.totalPixels.toLocaleString()} selected-area pixels. Each pixel is one small map cell. Grey cells could not be compared; they are not counted as gains or losses.</p>
    <p className="water-transition-caveat">Open water means the source product’s class 1. Other classes can contain partial water: “not mapped as open water” does not mean dry ground. Open water on both dates does not establish continuous water between observations. These maps alone do not tell us why a change happened, how deep the water is, or whether there is danger.</p>
    <details><summary>How this was calculated</summary><p>Both dates use the same native grid and common valid pixels. On that common population, the mapped class-1 footprint is {area((c.loss+c.persistentClass1)*report.pixelAreaKm2)} → {area((c.gain+c.persistentClass1)*report.pixelAreaKm2)} km². Net change is gains minus losses; spatial turnover is gains plus losses. These are mapped areas, not independently validated environmental change.</p><p>Native pixel footprint {area(report.pixelAreaKm2)} km². Method {report.methodVersion}. Source-reported times: {before} → {after}.</p><pre>{JSON.stringify(report.hashes,null,2)}</pre></details>
  </section>;
}
