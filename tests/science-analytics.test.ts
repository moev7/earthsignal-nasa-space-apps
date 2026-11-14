import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { historyChartPoints, rollingChartPoints } from '../lib/history-chart';
import { historyAnalysisSchema, forecastSchema } from '../lib/science-analytics';
import { HistoryInsights, GaugeEvaluation } from '../features/decisions/history-insights';
import type { Assessment } from '../lib/observatory-contract';
import { analyzeHistory } from '../lib/water-history';

test('history charts insert calendar breaks and retain missing derived targets',()=>{
  const series={id:'x',label:'Observed index',unit:'index',evidenceIds:[],points:[{date:'2025-01-01',value:1,quality:'observed'},{date:'2025-01-04',value:2,quality:'observed'},{date:'2025-01-05',value:null,quality:'missing'}]};
  assert.deepEqual(historyChartPoints(series).map(p=>[p.date,p.value]),[['2025-01-01',1],['2025-01-02',null],['2025-01-04',2],['2025-01-05',null]]);
  const enhanced={...series,analysis:{rolling:[{date:'2025-01-01',value:null},{date:'2025-01-04',value:1.5}]} as NonNullable<NonNullable<Assessment['series']>[number]['analysis']>};
  assert.deepEqual(rollingChartPoints(enhanced).map(p=>[p.date,p.value]),[['2025-01-01',null],['2025-01-02',null],['2025-01-04',1.5],['2025-01-05',null]]);
});

test('history contracts reject fake seasonal support and inconsistent populations',()=>{
  const base={methodVersion:'history-descriptive-v1',inputHash:'a'.repeat(64),observedCount:1,calendarDays:1,missingDays:0,maxGapDays:0,firstDate:'2025-01-01',lastDate:'2025-01-01',latest:2,endpointDifference:null,spread:{median:2,p05:2,p95:2},histogram:[{lower:1,upper:3,count:1}],rolling:[{date:'2025-01-01',value:null}],rollingWindowDays:28,seasonal:{supported:false,sampleCount:0,distinctYearCount:0,median:null,mad:null,percentile:null,reason:'More history'},notes:[]};
  assert.equal(historyAnalysisSchema.safeParse(base).success,true);
  assert.equal(historyAnalysisSchema.safeParse({...base,observedCount:2}).success,false);
  assert.equal(historyAnalysisSchema.safeParse({...base,seasonal:{...base.seasonal,supported:true,sampleCount:12,distinctYearCount:1,median:1,mad:0,percentile:100}}).success,false);
});

test('integrated histories expose exact source tables and explicit missing context',()=>{
  const series={id:'x',label:'River flow',unit:'ft^3/s',evidenceIds:[],points:[{date:'2025-01-01',value:0,quality:'provisional'},{date:'2025-01-02',value:null,quality:'missing'}]};
  const html=renderToStaticMarkup(React.createElement(HistoryInsights,{series}));
  assert.match(html,/River flow/);assert.match(html,/Exact observations and source quality/);assert.match(html,/provisional/);assert.match(html,/Not observed/);
  const e={seriesId:'usgs-discharge' as const,methodVersion:'fixture',status:'experimental' as const,selectionHash:null,sourceInputHash:null,folds:null,forecasts:[],withheld:['No current data'],validation:[],notes:[]};
  const evaluation=renderToStaticMarkup(React.createElement(GaugeEvaluation,{evaluation:e}));
  assert.match(evaluation,/Current predictions withheld/);assert.match(evaluation,/No current data/);assert.match(evaluation,/retrospective gate/);
});

test('forecast contract rejects already-expired issue targets and reversed intervals',()=>{
  const v={methodVersion:'x',trainingStart:'2021-01-01',trainingEnd:'2022-12-31',testStart:'2025-01-01',testEnd:'2025-12-31',origins:50,mae:1,intervalCoverage:.9,intervalWidth:2,applicability:[],limitations:[]};
  const f={schemaVersion:'1.0',target:'Gauge',issueTime:'2026-10-10T12:00:00Z',horizonDays:1,model:'persistence',modelVersion:'fixture',distribution:{point:5,lower:4,upper:6,unit:'ft^3/s'},baselines:[],validation:v,validThrough:'2026-10-11T00:00:00Z'};
  assert.equal(forecastSchema.safeParse(f).success,true);
  assert.equal(forecastSchema.safeParse({...f,validThrough:'2026-10-10T00:00:00Z'}).success,false);
  assert.equal(forecastSchema.safeParse({...f,distribution:{...f.distribution,lower:8}}).success,false);
});

test('retrospective water experiment rejects impossible and duplicate historical dates',()=>{
  assert.match(analyzeHistory([{date:'2025-02-30',value:1}],'2025-03-05').reason,/real, distinct/);
  assert.match(analyzeHistory([{date:'2025-01-01',value:1},{date:'2025-01-01',value:2}],'2025-01-01').reason,/Duplicates/);
});
