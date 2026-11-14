import type { Assessment } from "./observatory-contract";
type Series = NonNullable<Assessment['series']>[number];
const DAY=86400000;

/** Display exact observations; insert breaks for unrecorded calendar days. */
export function historyChartPoints(series:Series) {
  const chart:Array<{day:number;date:string;value:number|null}>=[];
  for(const p of series.points) {
    const day=Date.parse(`${p.date}T00:00:00Z`),previous=chart.at(-1);
    if(previous && day-previous.day>DAY)chart.push({day:previous.day+DAY,date:new Date(previous.day+DAY).toISOString().slice(0,10),value:null});
    chart.push({day,date:p.date,value:p.value});
  }
  return chart;
}

/** A thinned descriptive curve, with every observed or calendar gap retained. */
export function rollingChartPoints(series:Series) {
  const raw=historyChartPoints(series);
  const rolling=new Map((series.analysis?.rolling??[]).map(p=>[p.date,p.value]));
  return raw.filter(p=>rolling.has(p.date)||p.value===null).map(p=>({...p,value:p.value===null?null:rolling.get(p.date)??null}));
}
