import test from 'node:test';
import assert from 'node:assert/strict';
import { atlasEvidence, type AtlasLayer } from '../lib/atlas-view';
test('atlas evidence follows the selected layer rather than borrowing a measured label',()=>{
  for(const layer of ['subsidence','buildings'] as AtlasLayer[]){assert.equal(atlasEvidence(layer,'measured','ready'),'measured');assert.equal(atlasEvidence(layer,'measured','error'),'error');assert.equal(atlasEvidence(layer,'measured','loading'),'loading');}
  for(const layer of ['observations','groundwater','agriculture'] as AtlasLayer[])assert.equal(atlasEvidence(layer,'measured','ready'),'illustrated');
  assert.equal(atlasEvidence('buildings','demo',null),'unavailable');
  assert.equal(atlasEvidence('subsidence','demo',null),'illustrated');
  for(const state of ['processing','unavailable','error'] as const)assert.equal(atlasEvidence('subsidence',state,null),state);
});
