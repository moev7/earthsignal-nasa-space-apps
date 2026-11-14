/** Optional browser regression, independent of the unit-test runner.
 * node scripts/verify-story-sticky.mjs /absolute/playwright/index.mjs [url] [webkit executable]
 * Uses an already installed official Playwright package; never installs browsers.
 */
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const [modulePath, url = 'http://127.0.0.1:5173/', executablePath] = process.argv.slice(2);
if (!modulePath) throw Error('Supply the absolute path to an installed Playwright index.mjs');
const {webkit, devices} = await import(pathToFileURL(resolve(modulePath)).href);
const browser = await webkit.launch({headless:true, ...(executablePath ? {executablePath:resolve(executablePath)} : {})});
const ids = ['hidden-cause','consequences','from-space'];
const result = {engine:browser.version(), physicalPhone:false, devicePreset:'iPhone 13 Mini', viewport:{width:375,height:635}, chapters:[]};
try {
  const context = await browser.newContext({...devices['iPhone 13 Mini'], viewport:result.viewport, reducedMotion:'no-preference'});
  const page = await context.newPage();
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  for (const id of ids) {
    await page.evaluate(id => {const g=document.querySelector('#'+id+' .es-act-grid');scrollTo(0,g.getBoundingClientRect().top+scrollY+200);},id);
    await page.waitForFunction(id => document.querySelector('#'+id+' .es-story-visual').dataset.pin==='true',id);
    // Let the lazy 3D scene and its controls establish their final geometry.
    await page.waitForTimeout(500);
    const y=await page.evaluate(id=>{const g=document.querySelector('#'+id+' .es-act-grid');return g.getBoundingClientRect().top+scrollY;},id);
    const samples=[];
    for (const d of [180,480,780,480,180,-180]) {
      await page.evaluate(y=>scrollTo(0,y),y+d);
      await page.waitForTimeout(100);
      const sample=await page.evaluate(id=>{const p=document.querySelector('#'+id+' .es-story-visual');return {scroll:scrollY,top:p.getBoundingClientRect().top,height:p.offsetHeight,pin:p.dataset.pin,water:p.querySelector('[data-water-level]')?.dataset.waterLevel,year:p.innerText.match(/Illustration · year[^\n]*/)?.[0],sinking:p.querySelector('.es-radar-slider input')?.value};},id);
      if (d>=0) {assert.equal(sample.pin,'true',id);assert.ok(Math.abs(sample.top-113)<1,`${id}: pinned top ${sample.top}`);}
      else assert.ok(sample.top>=170,`${id}: failed reverse release`);
      samples.push(sample);
    }
    assert.equal(samples[0].water,samples[4].water,`${id}: water reverses without drift`);
    assert.equal(samples[0].year,samples[4].year,`${id}: city reverses without drift`);
    assert.equal(samples[0].sinking,samples[4].sinking,`${id}: radar reverses without drift`);
    result.chapters.push({id,samples});
  }
  await page.evaluate(()=>{const g=document.querySelector('#from-space .es-act-grid');scrollTo(0,g.getBoundingClientRect().top+scrollY+200);});
  await page.waitForTimeout(100);
  result.toolbarSimulation=await page.evaluate(async()=>{
    const panel=document.querySelector('#from-space .es-story-visual');
    const before={height:panel.offsetHeight,canvas:panel.querySelector('.es-radar-stage').offsetHeight};
    const inner=Object.getOwnPropertyDescriptor(window,'innerHeight'), visual=Object.getOwnPropertyDescriptor(visualViewport,'height');
    const samples=[];
    try {for(const height of [724,635,662,724,635]) {
      Object.defineProperty(window,'innerHeight',{configurable:true,value:height});
      Object.defineProperty(visualViewport,'height',{configurable:true,value:height});
      window.dispatchEvent(new Event('resize'));visualViewport.dispatchEvent(new Event('resize'));
      await new Promise(r=>setTimeout(r,60));
      samples.push({height:panel.offsetHeight,canvas:panel.querySelector('.es-radar-stage').offsetHeight,pin:panel.dataset.pin});
    }} finally {
      if(inner) Object.defineProperty(window,'innerHeight',inner);else delete window.innerHeight;
      if(visual) Object.defineProperty(visualViewport,'height',visual);else delete visualViewport.height;
    }
    return {kind:'Synthetic toolbar API sequence, not physical browser chrome',before,samples};
  });
  for (const sample of result.toolbarSimulation.samples) {
    assert.equal(sample.height,result.toolbarSimulation.before.height);
    assert.equal(sample.canvas,result.toolbarSimulation.before.canvas);
    assert.equal(sample.pin,'true');
  }
  result.header=await page.locator('.es-header').evaluate(n=>n.offsetHeight);
  assert.equal(result.header,101);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
  const output='output/playwright';await mkdir(output,{recursive:true});
  await page.screenshot({path:`${output}/sticky-webkit-${result.engine}.png`});
  await page.locator('#from-space .ed-radar-instruments').evaluate(n=>{n.open=true;});
  await page.waitForFunction(()=>document.querySelector('#from-space .es-story-visual').dataset.pin==='false');
  await page.locator('#from-space .ed-radar-instruments').evaluate(n=>{n.open=false;});
  await page.waitForFunction(()=>document.querySelector('#from-space .es-story-visual').dataset.pin==='true');
  await page.setViewportSize({width:812,height:375});
  await page.waitForFunction(()=>[...document.querySelectorAll('.es-story-visual')].every(n=>n.dataset.pin==='false'));
  result.landscape='normal flow';
  await page.setViewportSize(result.viewport);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>[...document.querySelectorAll('.es-story-visual')].every(n=>n.dataset.pin==='false'));
  result.reducedMotion='normal flow';
  await writeFile(`${output}/sticky-webkit-${result.engine}.json`,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({engine:result.engine,physicalPhone:false,chapters:result.chapters.length,toolbar:'stable',landscape:result.landscape,reducedMotion:result.reducedMotion,header:result.header}));
} finally {await browser.close();}
