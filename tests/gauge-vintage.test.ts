import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { gaugeVintageSchema } from '../lib/gauge-vintage-contract';
import { GaugeVintageInsights } from '../features/decisions/gauge-vintage-insights';

// Schema/UI fixture only; these are not environmental or availability findings.
const h='a'.repeat(64),identity={station:'USGS-09421500',timeSeriesId:'fixture',parameter:'00060',statistic:'00003',unit:'ft^3/s'};
const received='2026-10-09T00:00:00.000000Z';
function fixture(){return {status:'captured',receipt:{policyVersion:'usgs-observation-vintages-v1',receivedAt:received,insertedVersions:1,unchangedRecords:0},snapshot:{policyVersion:'usgs-observation-vintages-v1',availabilityBasis:'local-receipt-only',identity,issueTime:received,start:'2025-06-01',end:'2025-06-03',calendarDays:3,unknownDays:2,observations:[{identity,date:'2025-06-01',value:100,quality:'Provisional',qualifiers:['Estimated'],stationTimeProperties:{country_code:'US',time_zone_abbreviation:'PST',uses_daylight_savings:'Y'},revision:1,receivedAt:received,firstReceivedAt:received,contentHash:h,stationPropertiesHash:h,sourceResponseHash:h,sourceMetadataHash:h,versionHash:h}],snapshotHash:h}};}

test('availability display separates local receipt from past knowledge and skill',()=>{
 const v=gaugeVintageSchema.parse(fixture());
 const html=renderToStaticMarkup(createElement(GaugeVintageInsights,{vintage:v}));
 assert.match(html,/Saved as we received it/);
 assert.match(html,/Later corrections can be kept separately/);
 assert.match(html,/did not establish/);
 assert.match(html,/Retrospective forecast tests may include later revisions/);
 assert.doesNotMatch(html,/still use currently revised data/);
 assert.match(html,/does not establish predictive accuracy/);
 assert.match(html,/separate from approval status/);
 assert.match(html,/2 days/);
});
test('schema rejects population, identity, future-receipt and private identity additions',()=>{
 for(const change of [(v:ReturnType<typeof fixture>)=>v.snapshot.unknownDays=0,(v:ReturnType<typeof fixture>)=>v.snapshot.observations[0].identity={...identity,station:'USGS-12345678'},(v:ReturnType<typeof fixture>)=>v.snapshot.observations[0].receivedAt='2026-10-10T00:00:00.000000Z',(v:ReturnType<typeof fixture>)=>Object.assign(v,{owner:'alice'})]){
  const v=fixture();change(v);assert.equal(gaugeVintageSchema.safeParse(v).success,false);
 }
});
test('archive failure keeps an honest explanation without implying the measurements failed',()=>{
 const v=gaugeVintageSchema.parse({status:'unavailable',reason:'storage_limit'});
 const html=renderToStaticMarkup(createElement(GaugeVintageInsights,{vintage:v}));
 assert.match(html,/measurements remain available/);assert.match(html,/cannot use this attempt as proof/);
 assert.equal(gaugeVintageSchema.safeParse({status:'unavailable',reason:'https://private.example'}).success,false);
});
