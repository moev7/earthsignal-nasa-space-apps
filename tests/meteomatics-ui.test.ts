import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HistoryInsights } from '../features/decisions/history-insights';
import type { Assessment } from '../lib/observatory-contract';

type Series = NonNullable<Assessment['series']>[number];
const series: Series = {
  id: 'meteomatics-precipitation', label: 'Daily precipitation · ERA5 reanalysis estimate',
  unit: 'mm', evidenceIds: ['weather'], points: [
    { date: '2025-06-01', value: 0, quality: 'Model estimate · completed UTC day' },
    { date: '2025-06-02', value: null, quality: 'Unavailable from provider' },
  ],
};

test('weather history identifies model estimates and preserves zero versus missing', () => {
  const html = renderToStaticMarkup(createElement(HistoryInsights, { series, selectedDate: '2025-06-02' }));
  assert.match(html, /MODELLED WEATHER HISTORY/);
  assert.match(html, /not station measurements or an average across your area/);
  assert.match(html, /completed UTC day/);
  assert.match(html, /does not establish what caused/);
  assert.match(html, /Exact estimates and source quality/);
  assert.match(html, /Not available for this series/);
  assert.match(html, /<td>0<\/td>/);
  assert.match(html, /<td>Not available<\/td>/);
  assert.doesNotMatch(html, /Exact observations|recorded measurements stay fixed|Not observed/);
});

test('weather date inspection retains estimate terminology', () => {
  const html = renderToStaticMarkup(createElement(HistoryInsights, { series, onSelectDate: () => {} }));
  assert.match(html, /2025-06-02 · not available/);
  assert.match(html, /Model estimates/);
});

test('weather statistics and methods consistently describe estimates', () => {
  const analysis: NonNullable<Series['analysis']> = {
    methodVersion:'history-descriptive-v1', inputHash:'a'.repeat(64), observedCount:1,
    calendarDays:2, missingDays:1, maxGapDays:0, firstDate:'2025-06-01', lastDate:'2025-06-01',
    latest:0, endpointDifference:null, spread:{median:0,p05:0,p95:0},
    histogram:[{lower:-0.5,upper:0.5,count:1}], rolling:[], rollingWindowDays:28,
    seasonal:{supported:false,sampleCount:0,distinctYearCount:0,median:null,mad:null,percentile:null,reason:'More history needed'}, notes:[],
  };
  const html = renderToStaticMarkup(createElement(HistoryInsights, { series:{...series,analysis} }));
  for (const text of ['Last available estimate','Days without estimates','Middle 90% of model estimates','Histogram of model estimates','Last minus first model estimate']) assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/Last observed|Unobserved days|Distribution of observed|Histogram of recorded|first recorded summary/);
});

test('existing observation histories retain their established labels', () => {
  const html = renderToStaticMarkup(createElement(HistoryInsights, {
    series: { ...series, id: 'usgs-discharge', label: 'River flow' },
  }));
  assert.match(html, /RECORDED HISTORY/);
  assert.match(html, /Exact observations and source quality/);
  assert.match(html, /<td>Not observed<\/td>/);
  assert.doesNotMatch(html, /MODELLED WEATHER HISTORY|ERA5 reanalysis estimates supplied/);
});
