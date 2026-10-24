import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {startServer} from '../serve.mjs';
import {installDisclosureProbe,disclosureCheckpoint,waitForDisclosureSaved,adoptSyntheticProject} from './disclosure-state.mjs';

const root=path.resolve(process.env.TILT_DISCLOSURE_REGRESSION_ROOT||path.join('output/playwright/disclosure-regressions',new Date().toISOString().replace(/[:.]/g,'-')));
await fs.mkdir(path.dirname(root),{recursive:true});await fs.mkdir(root);
const channels=process.platform==='win32'?['chrome','msedge']:['chromium'],cases=[];
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const save=()=>fs.writeFile(path.join(root,'results.json'),JSON.stringify({scope:'synthetic regression; execution provenance is the outer CI command receipt',cases},null,2));
const passed=async(name,observations)=>{cases.push({name,status:'pass',channels,observations});await save();};
const fixture=async(channel,action)=>{
  let requests=0;
  const server=http.createServer((req,res)=>{
    if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
    requests++;res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});
    res.end(`<title>Held disclosure save</title><details data-ui-disclosure="direction:fixture:inPlane"><summary>Direction</summary><p>Settings</p></details><script>
      const key='tilt-survey-disclosures',id='direction:fixture:inPlane',details=document.querySelector('details');
      if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({[id]:true}));
      document.addEventListener('toggle',event=>{if(event.target===details){const value=details.open;window.pendingState=value;window.releaseSave=()=>localStorage.setItem(key,JSON.stringify({[id]:value}));}},true);
      details.open=JSON.parse(localStorage.getItem(key))[id]===true;
    </script>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:channel==='chromium'?undefined:channel,headless:true}),context=await browser.newContext(),page=await context.newPage();
  try {
    await installDisclosureProbe(page);await page.goto(`http://127.0.0.1:${server.address().port}`);
    await action(page,()=>requests);
  } finally {await context.close();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
};

test('collapse waits for held persistence before reload; original closed state survives reload',async()=>{
  const observations=[];
  for(const channel of channels)await fixture(channel,async(page,requests)=>{
    const direction=page.locator('details');await page.waitForFunction(()=>window.pendingState===true);
    await disclosureCheckpoint(page,'before-collapse-click');await direction.locator('summary').click();
    await page.waitForFunction(()=>window.pendingState===false);
    const before=await page.evaluate(()=>({open:document.querySelector('details').open,saved:JSON.parse(localStorage.getItem('tilt-survey-disclosures'))['direction:fixture:inPlane']}));
    assert.deepEqual(before,{open:false,saved:true});
    let complete=false;
    const wait=waitForDisclosureSaved(page,direction,false).then(()=>{complete=true;});
    // Hold the save across rendered frames, not a fixed sleep; no reload may precede release.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(complete,false);assert.equal(requests(),1);
    await page.evaluate(()=>window.releaseSave());await wait;assert.equal(complete,true);
    await disclosureCheckpoint(page,'before-collapse-reload');await page.reload();
    assert.equal(await direction.getAttribute('open'),null);await waitForDisclosureSaved(page,direction,false);
    const journal=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('tilt-test-disclosure-journal')));
    assert.ok(journal.some(e=>e.type==='pagehide'));assert.ok(journal.some(e=>e.type==='toggle'&&e.open===false));
    observations.push({channel,before,after:{open:false,saved:false},requestCount:requests(),journal});
  });
  await passed('held-save-before-reload',observations);
});

test('a lost persistence write still fails rather than accepting a closed DOM alone',async()=>{
  const observations=[];
  for(const channel of channels)await fixture(channel,async page=>{
    await page.waitForFunction(()=>window.pendingState===true);const direction=page.locator('details');
    await direction.locator('summary').click();await page.waitForFunction(()=>window.pendingState===false);
    await assert.rejects(waitForDisclosureSaved(page,direction,false,250),error=>error.code==='ERR_ASSERTION'&&error.actual===true&&error.expected===false);
    observations.push({channel,domClosed:await direction.getAttribute('open')===null,saved:await page.evaluate(()=>JSON.parse(localStorage.getItem('tilt-survey-disclosures'))['direction:fixture:inPlane'])});
    assert.equal(observations.at(-1).domClosed,true);assert.equal(observations.at(-1).saved,true);
  });
  await passed('lost-save-rejected',observations);
});

test('real application assertion failure saves disclosure state, event order and live attachments before cleanup',async()=>{
  const observations=[];
  for(const channel of channels){
    const outRoot=path.join(root,channel),chunks=[];
    const child=spawn(process.execPath,['tests/fixtures/disclosure-failure-child.mjs',outRoot,channel],{stdio:['ignore','pipe','pipe']});
    for(const stream of [child.stdout,child.stderr])stream.on('data',b=>chunks.push(b));
    let watchdogTriggered=false;
    const watchdog=setTimeout(()=>{watchdogTriggered=true;if(process.platform==='win32')spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});else child.kill('SIGKILL');},30000);
    const completion=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(exitCode,signal)=>resolve({exitCode,signal,watchdogTriggered}));}).finally(()=>clearTimeout(watchdog));
    await fs.writeFile(path.join(root,`${channel}-child.log`),Buffer.concat(chunks));
    await fs.writeFile(path.join(root,`${channel}-child.json`),JSON.stringify(completion,null,2));
    assert.deepEqual(completion,{exitCode:1,signal:null,watchdogTriggered:false});
    const out=path.join(outRoot,'disclosure-save-failure'),record=await read(path.join(out,'failure.json')),state=await read(path.join(out,'page-state.json'));
    assert.equal(record.status,'failed');assert.equal(record.originalError.name,'AssertionError');assert.deepEqual(record.captureErrors,[]);
    assert.equal(record.pageClosedAtFailure,false);assert.ok(record.artifactAttempts.every(a=>a.status==='saved'));
    assert.equal((await read(path.join(out,'child-observation.json'))).sameOriginalError,true);
    const target=state.disclosures.find(e=>e.key.includes(':inPlane'));
    assert.equal(target.open,false);assert.equal(JSON.parse(state.disclosureStorage.preferences)[target.key],true);
    const journal=state.disclosureStorage.journal;
    for(const type of ['click','toggle','preference-saved','pagehide','before-collapse-click','after-collapse-click','fixture-write-held'])assert.ok(journal.some(e=>e.type===type),type);
    assert.ok(journal.findIndex(e=>e.type==='before-collapse-click')<journal.findIndex(e=>e.type==='fixture-write-held'));
    const events=await read(path.join(out,'events.json'));assert.ok(events.some(e=>e.type==='console'&&e.text.includes('fixture-write-held')));
    assert.match(await fs.readFile(path.join(out,'page.html'),'utf8'),/data-ui-disclosure/);
    assert.equal((await fs.readFile(path.join(out,'trace.zip'))).subarray(0,2).toString(),'PK');
    assert.deepEqual([...(await fs.readFile(path.join(out,'screenshot.png'))).subarray(0,8)],[137,80,78,71,13,10,26,10]);
    for(const a of await read(path.join(out,'sha256.json'))){const bytes=await fs.readFile(path.join(out,a.file));assert.equal(sha(bytes),a.sha256);assert.equal(bytes.length,a.bytes);}
    observations.push({channel,...completion,sameOriginalError:true,key:target.key,domOpen:target.open,saved:true,journalEvents:journal.length});
  }
  await passed('real-app-failure-captured',observations);
});

test('synthetic fixture adoption replaces the live model before the old page can save on reload',async()=>{
  const observations=[];
  for(const channel of channels){
    const server=await startServer(),browser=await chromium.launch({channel:channel==='chromium'?undefined:channel,headless:true});
    const context=await browser.newContext(),page=await context.newPage();
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('[data-field="header.caseNumber"]').waitFor();
      const initial=await page.evaluate(async()=>{const {sampleProject}=await import('./model.js');return sampleProject();});
      await adoptSyntheticProject(page,initial);await page.locator('[data-tab="readings"]').click();
      const edited=await page.evaluate(()=>{const input=document.querySelector('[data-field="pairs.0.inPlane.A.rounds.0.dxCm"]');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));return{value:input.value,state:document.documentElement.dataset.saveState};});
      assert.deepEqual(edited,{value:'',state:'pending'});
      const next=await page.evaluate(async()=>{const {sampleProject,createPair,confirmObservation}=await import('./model.js');const p=sampleProject(),q=createPair(3,p.facades[0].id);q.inPlane.A.hCm=q.outPlane.A.hCm='441.0';q.inPlane.A.rounds[0].dxCm=q.outPlane.A.rounds[0].dxCm='2.0';p.pairs.push(q);confirmObservation(p,q,p.facades[0]);return p;});
      await adoptSyntheticProject(page,next);await page.reload();await page.locator('[data-field="header.caseNumber"]').waitFor();
      const state=await page.evaluate(async()=>{const {loadProject}=await import('./store.js'),{calculatePair}=await import('./calc.js');const p=await loadProject();return{id:p.id,count:p.pairs.length,dx:p.pairs[0].inPlane.A.rounds[0].dxCm,denominator:calculatePair(p.pairs[0],p.facades[0],p.settings).inPlane.denominator};});
      assert.deepEqual(state,{id:next.id,count:3,dx:'2.3',denominator:212});
      observations.push({channel,oldId:initial.id,edited,...state});
    } finally {await context.close();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }
  await passed('fixture-adoption-survives-old-save',observations);
});
