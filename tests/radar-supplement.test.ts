import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

test('deeper radar explanation adds profiles and mission context without a second playable lab',async()=>{
  const css=registerHooks({resolve(specifier,context,next){
    return specifier.endsWith('.css')?{url:'data:text/javascript,export default {}',shortCircuit:true}:next(specifier,context);
  }});
  try{
    const {default:LearningLab}=await import('../features/public-story/LearningLab');
    const {StoryProvider}=await import('../features/ground-truth/components/story/StoryProvider');
    const html=renderToStaticMarkup(React.createElement(StoryProvider,null,React.createElement(LearningLab,{topic:'radar'})));
    assert.match(html,/Compare satellite missions and techniques/);
    assert.match(html,/Illustrated deformation profile/);
    assert.match(html,/not extracted from the connected NISAR raster/);
    assert.match(html,/Read the illustrated profile values/);
    assert.doesNotMatch(html,/es-radar-lesson|<canvas|Open the full radar experiment|Interactive repeat-pass radar lesson/);
  }finally{css.deregister();}
});
