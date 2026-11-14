import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {seasonalSamplingSchema} from '../lib/science-analytics';
import {SeasonalSamplingInsights} from '../features/decisions/seasonal-sampling-insights';

// Known 1 + 12 reading counterexample; no field data or accuracy claim.
const fixture=()=>({methodVersion:'seasonal-sampling-sensitivity-v1',inputHash:'a'.repeat(64),targetDate:'2026-06-01',targetValue:50,
  supported:true,sampleCount:13,yearCount:2,windowDays:30,
  byYear:[{year:2024,count:1,dates:['2024-06-01'],median:0},
    {year:2025,count:12,dates:Array.from({length:12},(_,i)=>`2025-06-${String(i+1).padStart(2,'0')}`),median:100}],
  maxYearSharePercent:1200/13,pooled:{median:100,percentile:100/13,estimand:'Each reading'},
  yearBalanced:{median:50,percentile:50,estimand:'Each year median'},percentileDifferencePoints:50-100/13,
  directionChanges:true,sparseYears:[2024],notes:['Descriptive sensitivity; no detection probability.']});

test('unequal sampling is visible without replacing the original observations',()=>{
  const sampling=seasonalSamplingSchema.parse(fixture());
  const html=renderToStaticMarkup(createElement(SeasonalSamplingInsights,{sampling,unit:'index'}));
  assert.match(html,/Does the way we sampled change the picture/);
  assert.match(html,/The comparison changes with the sampling choice/);
  assert.match(html,/100 index/);assert.match(html,/50 index/);
  assert.match(html,/not event probabilities/);assert.match(html,/few readings/);
  assert.match(html,/<table/);assert.match(html,/2024-06-01/);
});

test('invented support, shares, date years, sparse flags and unsupported values are rejected',()=>{
  for(const change of [(s:ReturnType<typeof fixture>)=>s.sampleCount=100,(s:ReturnType<typeof fixture>)=>s.maxYearSharePercent=99,
    (s:ReturnType<typeof fixture>)=>s.byYear[0].dates=['2023-06-01'],(s:ReturnType<typeof fixture>)=>s.sparseYears=[],
    (s:ReturnType<typeof fixture>)=>s.percentileDifferencePoints=1,(s:ReturnType<typeof fixture>)=>s.supported=false]){
    const s=fixture();change(s);assert.equal(seasonalSamplingSchema.safeParse(s).success,false);
  }
});

test('insufficient support displays counts and withholds comparison numbers',()=>{
  const s=fixture();s.supported=false;s.byYear=s.byYear.slice(0,1);s.sampleCount=1;s.yearCount=1;s.maxYearSharePercent=100;
  Object.assign(s,{pooled:{median:null,percentile:null,estimand:'Each reading'},yearBalanced:{median:null,percentile:null,estimand:'Each year median'},percentileDifferencePoints:null,directionChanges:null});
  const sampling=seasonalSamplingSchema.parse(s);
  const html=renderToStaticMarkup(createElement(SeasonalSamplingInsights,{sampling,unit:'index'}));
  assert.match(html,/too little earlier-season support/);
  assert.doesNotMatch(html,/seasonal middle value is/);
});
