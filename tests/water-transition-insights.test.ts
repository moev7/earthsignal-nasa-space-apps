import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rasterViewSchema, waterTransitionAccountingSchema, type WaterTransitionAccounting } from '../lib/observatory-contract';
import { WaterTransitionInsights } from '../features/decisions/water-transition-insights';

function accounting():WaterTransitionAccounting {
  return {methodVersion:'class1-common-pixel-transition-v1',classDefinition:'mapped-class1-indicator',
    totalPixels:5,validPixels:4,pixelAreaKm2:.0009,
    counts:{gain:1,loss:1,persistentClass1:1,nonClass1Both:1,unknown:1},
    areasKm2:{gain:.0009,loss:.0009,persistentClass1:.0009,nonClass1Both:.0009,unknown:.0009},
    netChangeKm2:0,turnoverKm2:.0018,
    hashes:{grid:'a'.repeat(64),areaMask:'b'.repeat(64),commonMask:'c'.repeat(64),beforeIndicator:'d'.repeat(64),afterIndicator:'e'.repeat(64),categories:'f'.repeat(64)}};
}

function view(){
  const files=Object.fromEntries(['before','after','difference','excluded','transition'].map(layer=>[layer,{raster:`water-${layer}.tif`,preview:`water-${layer}.png`}]));
  return {id:'water',quantity:'Synthetic class-1 indicator',unit:'class-1 indicator (0/1)',bounds:[[36,-115],[36.01,-114.99]],
    grid:{crs:'Producer-asserted native metre grid',resolution:30,transform:[0,30,0,60,0,-30],width:3,height:2,aggregation:{water:1},aoiPolicy:'Synthetic selected centres'},
    before:{date:'2026-01-01T00:00:00Z',evidenceId:'e-before',coveragePercent:100},after:{date:'2026-01-03T00:00:00Z',evidenceId:'e-after',coveragePercent:80},
    commonCoveragePercent:80,validPixels:4,totalPixels:5,scale:{minimum:0,maximum:1,differenceLimit:1},files,
    hashes:Object.fromEntries(Object.values(files).flatMap(pair=>Object.values(pair).map(name=>[name,'a'.repeat(64)]))),notes:[],transitionAccounting:accounting()};
}

test('accounting rejects incompatible totals, model claims, nonfinite values and tampered areas',()=>{
  assert.ok(waterTransitionAccountingSchema.safeParse(accounting()).success);
  const invalid=[{...accounting(),validPixels:5},{...accounting(),counts:{...accounting().counts,unknown:0}},
    {...accounting(),counts:{...accounting().counts,gain:true}},
    {...accounting(),netChangeKm2:1},{...accounting(),turnoverKm2:0},
    {...accounting(),areasKm2:{...accounting().areasKm2,unknown:1}},
    {...accounting(),fieldAccuracy:1},{...accounting(),methodVersion:'validated-water-v1'},
    {...accounting(),pixelAreaKm2:Infinity},{...accounting(),pixelAreaKm2:1e308},
    {...accounting(),hashes:{...accounting().hashes,commonMask:'not-a-hash'}}];
  for(const r of invalid)assert.equal(waterTransitionAccountingSchema.safeParse(r).success,false);
});

test('transition map and accounting must join the water view, grid and exact artifact names',()=>{
  assert.ok(rasterViewSchema.safeParse(view()).success);
  const withoutReport={...view()};delete (withoutReport as Partial<typeof withoutReport>).transitionAccounting;
  assert.equal(rasterViewSchema.safeParse(withoutReport).success,false);
  const withoutTransition={...view(),files:{...view().files}};delete withoutTransition.files.transition;
  assert.equal(rasterViewSchema.safeParse(withoutTransition).success,false);
  const legacy={...withoutReport,files:withoutTransition.files};
  assert.ok(rasterViewSchema.safeParse(legacy).success);
  assert.equal(rasterViewSchema.safeParse({...view(),id:'ndvi'}).success,false);
  assert.equal(rasterViewSchema.safeParse({...view(),totalPixels:6}).success,false);
  assert.equal(rasterViewSchema.safeParse({...view(),grid:{...view().grid,resolution:60}}).success,false);
  assert.equal(rasterViewSchema.safeParse({...view(),files:{...view().files,transition:{raster:'../private.tif',preview:'water-transition.png'}}}).success,false);
  assert.equal(rasterViewSchema.safeParse({...view(),hashes:{}}).success,false);
});

test('render separates turnover, whole-area unknowns and endpoints from continuity',()=>{
  const html=renderToStaticMarkup(createElement(WaterTransitionInsights,{report:accounting(),before:'2026-01-01T00:00:00Z',after:'2026-01-03T00:00:00Z'}));
  for(const phrase of ['Newly mapped as open water','No longer mapped as open water','Total area that changed category','The total is unchanged','Could not compare','Not mapped as open water on either date','does not mean dry ground','does not establish continuous water','spatial turnover is gains plus losses','2026-01-01','2026-01-03'])assert.ok(html.includes(phrase),phrase);
  assert.ok(html.includes('4 comparable / 5 selected-area pixels'));
  assert.equal((html.match(/width:20%/g)||[]).length,5);
  assert.ok(html.includes('0.0009'));
  assert.ok(!html.includes('Forecast'));
});

test('zero comparable support never renders a zero-change result even when called directly',()=>{
  const report={...accounting(),validPixels:0};
  assert.equal(waterTransitionAccountingSchema.safeParse(report).success,false);
  const html=renderToStaticMarkup(createElement(WaterTransitionInsights,{report,before:'2026-01-01T00:00:00Z',after:'2026-01-03T00:00:00Z'}));
  assert.ok(html.includes('No comparison available'));
  assert.ok(html.includes('cannot measure gains, losses or no change'));
  assert.ok(!html.includes('Net mapped change'));
  assert.ok(!html.includes('km²'));
});
