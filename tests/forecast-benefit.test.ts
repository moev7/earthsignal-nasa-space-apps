import { test } from "node:test";
import assert from "node:assert/strict";
import { forecastBenefits, gaugeForecastTarget } from "../lib/forecast-benefit";
import type { Assessment } from "../lib/observatory-contract";
import { gaugeEvaluationSchema } from "../lib/science-analytics";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GaugeEvaluation } from "../features/decisions/history-insights";

const station={label:"Station discharge",unit:"ft^3/s" as const};
const fixture = () => gaugeEvaluationSchema.parse({seriesId:"usgs-discharge",methodVersion:"gauge-selection-calibration-holdout-v3",status:"experimental",selectionHash:null,sourceInputHash:null,folds:null,withheld:[],notes:[],
  forecasts:[{schemaVersion:"1.0",target:"Station discharge",issueTime:"2026-10-09T00:00:00Z",validThrough:"2026-10-12T00:00:00Z",horizonDays:3,model:"local-trend",modelVersion:"v3",distribution:{point:5,lower:1,upper:9,unit:"ft^3/s"},baselines:[],validation:{methodVersion:"v3",trainingStart:"2022-01-01",trainingEnd:"2023-12-31",testStart:"2025-01-01",testEnd:"2025-12-31",origins:52,mae:8,intervalCoverage:.9,intervalWidth:8,applicability:[],limitations:[]}}],
  validation:[{methodVersion:"v3",trainingStart:"2022-01-01",trainingEnd:"2023-12-31",testStart:"2025-01-01",testEnd:"2025-12-31",origins:52,mae:8,intervalCoverage:.9,intervalWidth:8,applicability:[],limitations:[],model:"local-trend",horizonDays:3,baselinePerformance:[{model:"persistence",mae:10},{model:"seasonal-naive",mae:20}],improvementFraction:.99,calibrationOrigins:36}]});

test("model value uses measured error against the best baseline, not a supplied improvement label", () => {
  const benefit = forecastBenefits(fixture(), Date.parse("2026-10-10T00:00:00Z"),station)[0];
  assert.ok(Math.abs(benefit.reductionPercent! - 20) < 1e-12);
  assert.equal(benefit.current,true);
  assert.equal(benefit.targets,52);
  const worse = fixture(); worse.validation[0].mae=15;
  assert.equal(forecastBenefits(worse,Date.now(),station)[0].reductionPercent,-50);
});
test("perfect or absent baselines do not produce infinite or invented relative benefit", () => {
  const e=fixture(); e.validation[0].baselinePerformance[0].mae=0;
  assert.equal(forecastBenefits(e,Date.now(),station)[0].reductionPercent,null);
  e.validation[0].baselinePerformance=[];
  assert.equal(forecastBenefits(e,Date.now(),station)[0].reductionPercent,null);
});
test("future-issued, expired and withheld estimates cannot be labelled current", () => {
  const e=fixture();
  assert.equal(forecastBenefits(e,Date.parse("2026-10-08T00:00:00Z"),station)[0].current,false);
  assert.equal(forecastBenefits(e,Date.parse("2026-10-12T00:00:00Z"),station)[0].current,false);
  e.forecasts=[];
  assert.equal(forecastBenefits(e,Date.parse("2026-10-10T00:00:00Z"),station)[0].current,false);
});
test("an estimate must belong to the scored model and exact held-out evaluation", () => {
  const now=Date.parse("2026-10-10T00:00:00Z"),e=fixture();
  e.forecasts[0].model="persistence";
  assert.equal(forecastBenefits(e,now,station)[0].current,false);
  e.forecasts[0].model="local-trend";e.forecasts[0].validation.origins=51;
  assert.equal(forecastBenefits(e,now,station)[0].current,false);
  e.forecasts[0].validation.origins=52;e.forecasts[0].validation.testEnd="2025-12-30";
  assert.equal(forecastBenefits(e,now,station)[0].current,false);
});
test("another station, quantity, applicability or unresolved source cannot be called current", () => {
  const now=Date.parse("2026-10-10T00:00:00Z");
  for(const mutate of [
    (e: ReturnType<typeof fixture>)=>{e.forecasts[0].target="Station B";},
    (e: ReturnType<typeof fixture>)=>{e.forecasts[0].distribution.unit="km²";},
    (e: ReturnType<typeof fixture>)=>{e.forecasts[0].validation.applicability=["Another population"];},
  ]) {const e=fixture();mutate(e);assert.equal(forecastBenefits(e,now,station)[0].current,false);}
  assert.equal(forecastBenefits(fixture(),now)[0].current,false);
  const a={series:[{id:"usgs-discharge",label:station.label,unit:station.unit,evidenceIds:["gauge"]}],evidence:[{id:"gauge",sourceId:"usgs-daily",quantity:"daily mean discharge",unit:station.unit}]} as Assessment;
  assert.deepEqual(gaugeForecastTarget(a),station);
  a.evidence[0].quantity="mapped open-water footprint";
  assert.equal(gaugeForecastTarget(a),null);
  a.evidence[0].quantity="daily mean discharge";a.evidence[0].unit="km²";
  assert.equal(gaugeForecastTarget(a),null);
});
test("forecast cards and model comparison share the same evaluation identity guard", () => {
  const e=fixture();e.forecasts[0].validation.applicability=["Another population"];e.forecasts[0].validation.limitations=["Different scope"];
  const html=renderToStaticMarkup(React.createElement(GaugeEvaluation,{evaluation:e,target:station}));
  assert.match(html,/Target or evaluation unresolved/);
  assert.doesNotMatch(html,/Current estimate available/);
});
