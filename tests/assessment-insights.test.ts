import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { assessmentOverview, compareAssessments, draftMatches, sourceSettingsMatch } from '../lib/assessment-insights';
import { AssessmentOverview } from '../features/decisions/assessment-overview';
import type { Assessment } from '../lib/observatory-contract';
const fixture = (): Assessment => ({schemaVersion:'1.0',kind:'assessment',domain:'urban',question:'change',area:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]},time:{start:'2025-01-01',end:'2025-01-10'},processedAt:'2026-10-09T00:00:00Z',methodVersion:'v1',title:'Actual test contract',outcome:'partial',evidence:[{id:'e',sourceId:'landsat',sourceVersion:'c2',title:'Source',url:'https://example.org/source',geometry:null,spatialSupport:{resolution:30,unit:'m',description:'Native crop'},timestamps:{observedStart:'2025-01-01T00:00:00Z',observedEnd:'2025-01-10T00:00:00Z',publishedAt:null,retrievedAt:'2026-10-09T00:00:00Z',validThrough:null},quantity:'surface temperature',unit:'K',quality:{commonCoveragePercent:95,notes:[]},maskPolicy:'qa-v1',methodVersion:'native-v1',hashes:{sha256:'test'},public:false}],claims:[{id:'c',type:'Derived',text:'Measured summary',evidenceIds:['e'],methodVersion:'v1',assumptions:[],uncertainty:['No causal inference'],applicability:[],counterevidence:[]}],metrics:[{id:'temperature',label:'Temperature',value:300,unit:'K',evidenceIds:['e'],description:'Native median',denominator:'Common valid pixels'}],quality:[{dimension:'measurement',status:'supported',message:'Native values'},{dimension:'coverage',status:'supported',message:'Common population'},{dimension:'attribution',status:'withheld',message:'Cause not established'}],brief:{title:'Brief',sections:[]},artifacts:[]});
test('reported comparison retains units, evidence and negative/zero differences without a causal claim',()=>{
 const a=fixture(),b=fixture();b.metrics[0].value=296;b.time.end='2025-02-10';
 const comparison=compareAssessments(a,b);assert.equal(comparison.comparable,true);assert.equal(comparison.rows[0].delta,-4);assert.deepEqual(comparison.rows[0].evidenceIds,{reference:['e'],current:['e']});
 b.metrics[0].value=300;assert.equal(compareAssessments(a,b).rows[0].delta,0);
});
test('different geometry/domain/method/population/source and missing evidence withhold differences',()=>{
 for(const mutate of [(r:Assessment)=>{r.area.coordinates[0][1][0]=2},(r:Assessment)=>{r.domain='water'},(r:Assessment)=>{r.methodVersion='v2'},(r:Assessment)=>{r.metrics[0].denominator='All pixels'},(r:Assessment)=>{r.evidence[0].maskPolicy='other'},(r:Assessment)=>{r.evidence[0].sourceVersion='c3'},(r:Assessment)=>{r.metrics[0].value=null},(r:Assessment)=>{r.metrics[0].evidenceIds=[]},(r:Assessment)=>{r.quality[0].status='withheld'},(r:Assessment)=>{r.evidence[0].quality.commonCoveragePercent=40},(r:Assessment)=>{r.quality=[]}]){
  const a=fixture(),b=fixture();mutate(b);const result=compareAssessments(a,b);assert.equal(result.comparable,false);assert.equal(result.rows[0].delta,null);
 }
});
test('draft context comparison detects changed place, question and dates',()=>{
 const a=fixture();const request={schemaVersion:'1.0' as const,domain:a.domain,question:a.question,area:a.area,start:a.time.start,end:a.time.end};
 assert.equal(draftMatches(request,a),true);assert.equal(draftMatches({...request,end:'2025-02-01'},a),false);assert.equal(draftMatches({...request,question:'future'},a),false);
});
test('overview presents recorded quality separately and excludes ungrounded metrics',()=>{
 const a=fixture();a.metrics.push({...a.metrics[0],id:'bad',value:999,evidenceIds:[]});
 const view=assessmentOverview(a);assert.equal(view.metrics.length,1);assert.equal(view.limitations.length,1);
 const html=renderToStaticMarkup(createElement(AssessmentOverview,{assessment:a}));assert.ok(html.includes('Useful evidence, with gaps'));assert.ok(html.includes('withheld'));assert.ok(!html.includes('999'));assert.ok(html.includes('2025-01-10'));
});

test('source and gauge edits cannot silently retain the saved-result match',()=>{
 assert.equal(sourceSettingsMatch(undefined,{sourceIds:[]}),true);
 assert.equal(sourceSettingsMatch({sourceIds:['hls','landsat'],gaugeId:'094'} ,{sourceIds:['landsat','hls'],gaugeId:'094'}),true);
 assert.equal(sourceSettingsMatch({sourceIds:['hls']},{sourceIds:['landsat']}),false);
 assert.equal(sourceSettingsMatch({gaugeId:'094'},{gaugeId:'095'}),false);
 assert.equal(sourceSettingsMatch(undefined,{gaugeId:'094'}),false);
});
