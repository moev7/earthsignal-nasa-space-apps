import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groundProfile, defaultGroundLine, groundOffset } from '../lib/ground-profile';
import { gridLookup, type ValueGrid } from '../features/ground-truth/data/nisar';

const grid:ValueGrid={west:0,north:2,dlon:1,dlat:1,cols:3,rows:2,vertical_rate:[-100,null,0,100,200,300],vertical_sigma:[20,30,0,10,20,30]};
test('transect intersects each cell once, preserves missing support and signs, and reverses exactly',()=>{
  const line={start:{lat:1.5,lng:.1},end:{lat:1.5,lng:2.9}};
  const segments=groundProfile(grid,line);
  assert.deepEqual(segments.map(s=>s.cell),[0,1,2]);
  assert.deepEqual(segments.map(s=>[s.rate,s.sigma]),[[-100,20],[null,null],[0,0]]);
  assert.equal(segments[0].from,0);assert.equal(segments.at(-1)!.to,1);
  const reverse=groundProfile(grid,{start:line.end,end:line.start});
  assert.deepEqual(reverse.map(s=>s.rate),[0,null,-100]);
  assert.equal(groundOffset(-100,5),-.5);assert.equal(groundOffset(100,5),.5);
  assert.equal(groundOffset(0,5),0);assert.equal(groundOffset(null,0),null);
  assert.equal(groundOffset(-100,0),0);assert.equal(groundOffset(-100,-1),null);
});
test('grid corners, outside bounds, missing error and invalid routes do not create measurements',()=>{
  const diagonal=groundProfile(grid,{start:{lat:1.9,lng:.1},end:{lat:.1,lng:1.9}});
  assert.deepEqual(diagonal.map(s=>s.cell),[0,4],'a corner crossing must not duplicate a neighbouring cell');
  const outside=groundProfile(grid,{start:{lat:1.5,lng:-1},end:{lat:1.5,lng:4}});
  assert.deepEqual(outside.map(s=>s.cell),[null,0,1,2,null]);
  const errors={...grid,vertical_sigma:[null,30,0,10,20,30]};
  assert.equal(groundProfile(errors,{start:{lat:1.5,lng:.1},end:{lat:1.5,lng:.9}})[0].sigma,null);
  for(const line of [{start:{lat:1,lng:1},end:{lat:1,lng:1}},{start:{lat:91,lng:1},end:{lat:1,lng:1}},{start:{lat:NaN,lng:1},end:{lat:1,lng:1}}])assert.deepEqual(groundProfile(grid,line),[]);
});
test('frozen Tehran profile reads existing block medians and pixel-error summaries unchanged',()=>{
  const source:ValueGrid=JSON.parse(readFileSync(new URL('../public/data/nisar/tehran-sw-2026/vertical_grid.json',import.meta.url),'utf8'));
  const before=JSON.stringify(source),segments=groundProfile(source,defaultGroundLine(source));
  assert.ok(segments.some(s=>s.rate!==null));assert.ok(segments.some(s=>s.rate===null));
  assert.equal(new Set(segments.map(s=>s.cell)).size,segments.length);
  assert.ok(segments.length<=source.cols+source.rows+1);
  for(const s of segments){const hit=gridLookup(source,s.point.lat,s.point.lng);assert.equal(s.rate,hit?.rate??null);assert.equal(s.sigma,hit?.sigma??null);}
  assert.equal(JSON.stringify(source),before);
});
