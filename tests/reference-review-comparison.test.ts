import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
const template = readFileSync(new URL('../examples/optical-reference-development/review-template.html', import.meta.url), 'utf8');
const source = (start: string,end: string) => template.split(`/* ${start} */`)[1].split(`/* ${end} */`)[0];
const reader = source('DRAFT_READER_START','DRAFT_READER_END');
const compare = source('COMPARISON_LOGIC_START','COMPARISON_LOGIC_END');
const helpers = new Function('crypto', reader + compare + '; return {parseDraftJSON,readDraftSafely,loadComparisonInput,comparisonStatus,compareDrafts,aliasKey,canonicalDraft};')(webcrypto);
const buffer = (text: string) => new TextEncoder().encode(text).buffer;
const file = (text: string) => ({size:buffer(text).byteLength,arrayBuffer:async()=>buffer(text)});
const blank = {status:'unreviewed',visibility:'unknown',label:'unknown',reason:'',reviewedAt:null};
const done = (visibility: string,label: string) => ({status:'reviewed',visibility,label,reason:'Image interpretation',reviewedAt:'2026-10-14T00:00:00.000Z'});
const states = [blank,done('unobservable','unknown'),done('unknown','unknown'),done('observable','unknown'),done('observable','water'),done('observable','non_water')];

test('strict draft parser rejects duplicate decoded keys, float schema spellings and deep nesting',()=>{
  for (const text of ['{"schemaVersion":1,"schemaVersion":1}','{"kind":1,"k\\u0069nd":2}','{"schemaVersion":1.0}','{"schemaVersion":1e0}','['.repeat(18)+'1'+']'.repeat(18)]) assert.throws(()=>helpers.parseDraftJSON(text));
  assert.deepEqual(helpers.parseDraftJSON('{"schemaVersion":1,"reason":"a\\\"b,{} : 🌊"}'),{schemaVersion:1,reason:'a"b,{} : 🌊'});
});
test('draft bytes are bounded, UTF-8 validated and BOM is not silently discarded',async()=>{
  await assert.rejects(helpers.readDraftSafely({size:2,arrayBuffer:async()=>new Uint8Array([0xc3,0x28]).buffer},()=>true,()=>true));
  await assert.rejects(helpers.readDraftSafely(file('\ufeff{}'),()=>true,()=>true));
  await assert.rejects(helpers.readDraftSafely({size:1048577,arrayBuffer:async()=>{throw Error('must not read')}},()=>true,()=>true));
  await assert.rejects(helpers.readDraftSafely({size:1,arrayBuffer:async()=>new ArrayBuffer(1048577)},()=>true,()=>true));
});
test('36 valid decision pair oracle keeps every slot and unknowns never become agreement',()=>{
  const counts:Record<string,number> = {};let flags=0;
  const samples=[],left=[],right=[];
  for(let i=0;i<6;i++)for(let j=0;j<6;j++){
    const id=`s${i}-${j}`;samples.push({id,row:i,col:j});
    left.push({sampleId:id,before:states[i],after:states[i]});right.push({sampleId:id,before:states[j],after:states[j]});
    const status=helpers.comparisonStatus(states[i],states[j]);counts[status]=(counts[status]||0)+1;
    if(i===1&&j>=3||j===1&&i>=3)flags++;
  }
  assert.deepEqual(counts,{pending:11,not_observable:9,uncertain:12,same_label:2,different_labels:2});
  const packet={samples,packetHash:'pin',sources:[{id:'before',observedAt:'date-a'},{id:'after',observedAt:'date-b'}],grid:{},source_pins:{}};
  const a={reviewerAlias:'A',reviews:left},b={reviewerAlias:'B',reviews:right};
  const result=helpers.compareDrafts(packet,a,b),swapped=helpers.compareDrafts(packet,b,a);
  assert.equal(result.counts.allSlots,72);assert.equal(result.counts.comparableKnownSlots,8);
  assert.equal(result.flagCounts.knownVisibilityDisagreement,2*flags);
  assert.deepEqual(result.counts,swapped.counts);assert.equal(result.rows[0].observedAt,'date-a');
  assert.equal(result.accuracyEstimated,false);assert.equal(result.fieldTruthEstablished,false);assert.equal(result.adjudicationPerformed,false);
  result.rows[0].left.reason='changed';assert.equal(a.reviews[0].before.reason,'');
  assert.throws(()=>helpers.compareDrafts(packet,a,{...b,reviews:b.reviews.slice(1)}));
});
test('NFC and ASCII-case aliases collide without inventing Unicode identity equivalence',()=>{
  assert.equal(helpers.aliasKey('Cafe\u0301'),helpers.aliasKey('Café'));
  assert.notEqual(helpers.aliasKey('İ'),helpers.aliasKey('i'));
  assert.notEqual(helpers.aliasKey('Σ'),helpers.aliasKey('σ'));
  assert.throws(()=>helpers.compareDrafts({samples:[]},{reviewerAlias:'A',reviews:[]},{reviewerAlias:'a',reviews:[]}));
  assert.equal(helpers.compareDrafts({samples:[]},{reviewerAlias:'A',reviews:[]},{reviewerAlias:'B',reviews:[]}).status,'no-selected-cells');
});
test('comparison reader checks generation after hashing, not just after file reads',async()=>{
  let release!: (value: ArrayBuffer) => void, calls=0,current=true;
  const crypto={subtle:{digest:async()=>{calls++;return new Promise<ArrayBuffer>(r=>{release=r})}}};
  const load=new Function('crypto',reader+compare+';return loadComparisonInput;')(crypto);
  const pending=load(file('{"schemaVersion":1}'),()=>current,()=>true);
  await new Promise(r=>setImmediate(r));current=false;release(new ArrayBuffer(32));
  assert.equal(await pending,null);assert.equal(calls,1);
});
test('review fingerprints hash canonical integers and UTF-8, while byte hashes preserve exact files',async()=>{
  const input={schemaVersion:1,reason:'🌊',reviewerAlias:'نمونه'};
  const loaded=await helpers.loadComparisonInput(file(JSON.stringify(input,null,2)),()=>true,()=>true);
  assert.equal(loaded.reviewHash,Buffer.from(await webcrypto.subtle.digest('SHA-256',buffer(helpers.canonicalDraft(input)))).toString('hex'));
  assert.notEqual(loaded.reviewHash,loaded.fileSha256);
});
test('multilingual review limits count Unicode characters rather than UTF-16 halves',()=>{
  const packet={packetHash:'pin',samples:[{id:'s'}]},data={cells:{s:{before:{supported:true},after:{supported:true}}}};
  const validation=template.slice(template.indexOf('function decisionValid'),template.indexOf('function progress'));
  const text=template.slice(template.indexOf('function exactKeys'),template.indexOf('/* DRAFT_READER_START */'));
  const {validReview,decisionValid}=new Function('packet','data','sides',text+validation+';return {validReview,decisionValid};')(packet,data,['before','after']);
  const d={...done('observable','unknown'),reason:'🌊'.repeat(1000)};
  assert.equal(decisionValid(d),true);assert.equal(decisionValid({...d,reason:'🌊'.repeat(1001)}),false);
  const review={schemaVersion:1,kind:'optical-image-review',packetHash:'pin',reviewerAlias:'🌊'.repeat(64),reviews:[{sampleId:'s',before:d,after:blank}]};
  assert.equal(validReview(review),true);assert.equal(validReview({...review,reviewerAlias:'🌊'.repeat(65)}),false);
});
