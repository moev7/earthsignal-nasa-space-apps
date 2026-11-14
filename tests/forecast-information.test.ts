import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { forecastInformationSchema, type ForecastInformation } from '../lib/forecast-information-contract';
import { ForecastInformationInsights } from '../features/decisions/forecast-information-insights';

// The pinned example is a real retrieval; boundary mutations below are schema fixtures only.
const example: ForecastInformation=JSON.parse(fs.readFileSync(new URL('../examples/gauge-vintage-receipt/forecast-information.json',import.meta.url),'utf8'));
test('real receipt timing remains retrospective and keeps every target attempt',()=>{
 const r=forecastInformationSchema.parse(example);
 assert.equal(r.counts.retainedRecords,3);
 assert.equal(r.latestRetainedDate,'2025-06-03');
 assert.ok(r.timingAttempts.every(a=>a.status==='expired'&&!a.timingEligible));
 const html=renderToStaticMarkup(createElement(ForecastInformationInsights,{information:r}));
 assert.match(html,/Timing only/);assert.match(html,/does not evaluate forecast skill/);
 assert.match(html,/Target had already ended/);assert.match(html,/No archived observation/);
 assert.doesNotMatch(html,/forecast-ready|Validated forecast|Prediction:/i);
});
test('schema rejects reconciled-count, target status, issue cutoff and horizon corruption',()=>{
 for(const change of [
  (r:ForecastInformation)=>r.counts.retainedRecords++,
  (r:ForecastInformation)=>r.timingAttempts[0].timingEligible=true,
  (r:ForecastInformation)=>r.timingAttempts[0].status='future',
  (r:ForecastInformation)=>r.issueTime='2026-10-12T13:51:34.485317Z',
  (r:ForecastInformation)=>r.timingAttempts.push(r.timingAttempts[0]),
  (r:ForecastInformation)=>r.timingAttempts[0].targetInterval!.durationHours=25,
  (r:ForecastInformation)=>{r.timingAttempts[0].observationCutoff=null;r.timingAttempts[0].lagHours=null;},
  (r:ForecastInformation)=>r.timingAttempts[0].horizonDays=2,
  (r:ForecastInformation)=>r.timingAttempts[0].reason='target_already_started',
  (r:ForecastInformation)=>r.stationTime.properties=null,
 ]){const r=structuredClone(example);change(r);assert.equal(forecastInformationSchema.safeParse(r).success,false);}
});
test('one microsecond before a target start differs from exactly at that start',()=>{
 const r=structuredClone(example),a=r.timingAttempts[1];
 r.issueTime='2025-06-06T06:59:59.999999Z';
 a.status='future';a.reason='whole_target_after_issue';a.timingEligible=true;
 a.lagHours=172799.999999/3600;a.leadStartHours=0.000001/3600;a.leadEndHours=86400.000001/3600;
 r.timingAttempts=[a];
 assert.equal(forecastInformationSchema.safeParse(r).success,true);
 r.issueTime='2025-06-06T07:00:00.000000Z';
 a.lagHours=48;a.leadStartHours=0;a.leadEndHours=24;
 assert.equal(forecastInformationSchema.safeParse(r).success,false);
 a.status='partly_elapsed';a.reason='target_already_started';a.timingEligible=false;
 assert.equal(forecastInformationSchema.safeParse(r).success,true);
});
test('lead arithmetic follows backend datetime seconds before hours without rounding the cutoff',()=>{
 const r=structuredClone(example),a=r.timingAttempts[0];
 r.issueTime='2026-10-12T13:51:34.119677Z';r.start='2026-10-09';r.end=r.latestRetainedDate='2026-10-11';
 a.horizonDays=4;a.status='future';a.reason='whole_target_after_issue';a.timingEligible=true;
 a.observationCutoff={date:'2026-10-11',start:'2026-10-11T00:00:00-07:00',end:'2026-10-12T00:00:00-07:00',startUtc:'2026-10-11T07:00:00Z',endUtc:'2026-10-12T07:00:00Z',durationHours:24};
 a.targetInterval={date:'2026-10-15',start:'2026-10-15T00:00:00-07:00',end:'2026-10-16T00:00:00-07:00',startUtc:'2026-10-15T07:00:00Z',endUtc:'2026-10-16T07:00:00Z',durationHours:24};
 // These constants come from Python timedelta.total_seconds()/3600.
 a.lagHours=6.859477688055555;a.leadStartHours=65.14052231194444;a.leadEndHours=89.14052231194445;
 r.timingAttempts=[a];assert.equal(forecastInformationSchema.safeParse(r).success,true);
});
