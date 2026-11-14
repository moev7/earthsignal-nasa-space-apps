import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { gaugeEvaluationSchema, stationSeasonalTrendSchema } from '../lib/science-analytics';
import { SeasonalTrendInsights } from '../features/decisions/seasonal-trend-insights';
import { AssessmentNavigator } from '../features/decisions/assessment-navigator';
import { HistoryInsights } from '../features/decisions/history-insights';
import type { Assessment } from '../lib/observatory-contract';

test('native seasonal result crosses the versioned web boundary and retains exact support',()=>{
  const raw=JSON.parse(execFileSync('python3',['-c','import json; from service.tests.test_seasonal_trend import station_series; from service.observatory.seasonal_trend import seasonal_trend; print(json.dumps(seasonal_trend(station_series())))'],{encoding:'utf8'}));
  const trend=stationSeasonalTrendSchema.parse(raw);
  assert.equal(trend.slope,5);assert.equal(trend.pairCount,36);
  const html=renderToStaticMarkup(React.createElement(SeasonalTrendInsights,{trend}));
  assert.match(html,/Does one year change the result/);assert.match(html,/not a confidence interval or probability/);
  assert.match(html,/Approved \/ calendar days/);assert.match(html,/station-seasonal-sen-v1/);
  assert.equal(stationSeasonalTrendSchema.safeParse({...raw,sensitivityRange:{minimum:999,maximum:999}}).success,false);
  assert.equal(stationSeasonalTrendSchema.safeParse({...raw,commonMonths:[1,2,3,4,5]}).success,false);
  const bad=structuredClone(raw);bad.months[0].approvedDays=0;
  assert.equal(stationSeasonalTrendSchema.safeParse(bad).success,false);
});

test('recorded context and navigation persist while the draft differs',()=>{
  const assessment={domain:'water',question:'change',time:{start:'2023-01-01',end:'2025-12-31'},rasters:[]} as unknown as Assessment;
  const html=renderToStaticMarkup(React.createElement(AssessmentNavigator,{assessment,draftAligned:false,restore:()=>{}}));
  for(const target of ['environmental-change-story','decision-map','assessment-analysis','assessment-options','assessment-provenance'])assert.match(html,new RegExp(`href="#${target}"`));
  assert.match(html,/Saved result/);assert.match(html,/2023-01-01/);assert.match(html,/Draft changed/);assert.match(html,/Restore result selection/);
  assert.doesNotMatch(html,/href="#assessment-layers"/);
});

test('linked date inspection preserves missingness, exact quantities and source quality',()=>{
  const series={id:'x',label:'Source flow',unit:'ft^3/s',evidenceIds:[],points:[{date:'2025-01-01',value:300.00004,quality:'Approved'},{date:'2025-01-02',value:null,quality:'missing'}]};
  const observed=renderToStaticMarkup(React.createElement(HistoryInsights,{series,selectedDate:'2025-01-01',onSelectDate:()=>{}}));
  assert.match(observed,/300.00004 ft\^3\/s/);assert.match(observed,/Approved/);assert.match(observed,/Inspect a recorded date/);
  const missing=renderToStaticMarkup(React.createElement(HistoryInsights,{series,selectedDate:'2025-01-02',onSelectDate:()=>{}}));
  assert.match(missing,/Not observed for this series/);assert.match(missing,/recorded measurements stay fixed/);
});

test('forecast diagnostics reconcile evaluated populations and preserve archived contracts',()=>{
  const diagnostics={methodVersion:'forecast-interval-diagnostics-v1',nominalCoverage:.9,boundaryTolerance:1e-10,
    intervalScore:5,belowCount:2,withinCount:46,aboveCount:4,longestMissRun:3,negativePredictionCount:0,
    calibrationOrigins:36,calibrationRank:34,baselineScores:[{model:'persistence',intervalScore:8,intervalCoverage:.8,intervalWidth:2},{model:'seasonal-naive',intervalScore:9,intervalCoverage:.9,intervalWidth:3}]};
  const record={seriesId:'usgs-discharge',methodVersion:'gauge-selection-calibration-holdout-v3',status:'experimental',selectionHash:null,sourceInputHash:null,folds:null,forecasts:[],withheld:[],notes:[],
    validation:[{methodVersion:'gauge-selection-calibration-holdout-v3',trainingStart:'2022-01-01',trainingEnd:'2023-12-31',testStart:'2025-01-01',testEnd:'2025-12-31',origins:52,mae:1,intervalCoverage:46/52,intervalWidth:2,applicability:[],limitations:[],model:'local-trend',horizonDays:1,baselinePerformance:[],improvementFraction:.2,calibrationOrigins:36,intervalDiagnostics:diagnostics}]};
  assert.equal(gaugeEvaluationSchema.safeParse(record).success,true);
  for(const patch of [{withinCount:45},{calibrationRank:33},{longestMissRun:7},{baselineScores:[diagnostics.baselineScores[0],diagnostics.baselineScores[0]]}]){
    const bad=structuredClone(record);Object.assign(bad.validation[0].intervalDiagnostics,patch);
    assert.equal(gaugeEvaluationSchema.safeParse(bad).success,false);
  }
  const archived=structuredClone(record) as unknown as {validation:{intervalDiagnostics?:unknown}[]};delete archived.validation[0].intervalDiagnostics;
  assert.equal(gaugeEvaluationSchema.safeParse(archived).success,true);
});
