import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {loadSites,siteServer,sha,assertRevisionChanged} from './site.mjs';
import {monitorContext,assertOfflineRecovery} from '../desktop/diagnostics.mjs';
import {withFailureEvidence,closeAfterEvidence} from '../browser-failure-evidence.mjs';
import {assertSvgMapVisible,injectSvgMapFault} from './svg-map.mjs';
import {syntheticImages} from './synthetic-images.mjs';
const [out,channel,mode]=process.argv.slice(2);await fs.mkdir(out,{recursive:true});
const sites=await loadSites();assertRevisionChanged(sites.old,sites.current);
const server=await siteServer(sites,{oldFirst:true,staleWorker:mode==='stale'});
const browser=await chromium.launch({channel,headless:true}),context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
let phase='online';const diagnostics=monitorContext(context,()=>phase),page=await context.newPage(),checks=[];
const record={channel,mode,head:sites.manifest.commit,fixtureCommit:sites.fixture.sourceCommit,startedUtc:new Date().toISOString(),checks,diagnostics,status:'running'};
const save=()=>fs.writeFile(path.join(out,'results.json'),JSON.stringify(record,null,2));
const pass=(name,data)=>checks.push({name,status:'pass',data});
const field=key=>page.locator(`[data-field="${key}"]`),tab=async name=>page.locator(`[data-tab="${name}"]`).click();
const snapshot=()=>page.evaluate(async()=>{
 const {loadProject,loadMedia}=await import('./store.js'),{mediaIds,sha256Blob,projectFingerprint}=await import('./integrity.js'),project=await loadProject(),media=[];
 for(const id of mediaIds(project)){const blob=await loadMedia(id);media.push({id,type:blob.type,bytes:blob.size,sha256:await sha256Blob(blob)});}
 return {project,media,fingerprint:await projectFingerprint(project,loadMedia)};
});
const runtime=()=>page.evaluate(async()=>{const result={};for(const name of ['app.js','style.css']){const r=await fetch('./'+name);result[name]=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await r.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');}return result;});
try{
 await save();
 await withFailureEvidence({context,page,root:path.join(out,'diagnostics'),name:'upgrade'},async()=>{
  // Both monitorContext and this guard/trace are active before the first navigation.
  await page.goto(server.url);await field('header.caseNumber').waitFor();
  await page.locator('[data-action="sample"]').click();await page.locator('#actionDialog').getByRole('button',{name:'直接取代',exact:true}).click();
  await page.getByText('合成示例已載入，可直接預覽成果表。',{exact:true}).waitFor();
  await field('header.caseNumber').fill('舊V0.4.2升級－合成－'+channel);
  await page.waitForFunction(()=>document.documentElement.dataset.saveState==='saved');
   const images=await page.evaluate(syntheticImages);
  await fs.writeFile(path.join(out,'source-photo.png'),Buffer.from(images.photo,'base64'));await fs.writeFile(path.join(out,'source-map.png'),Buffer.from(images.map,'base64'));
  await tab('photos');await page.locator('#photoImport').setInputFiles({name:'synthetic-photo.png',mimeType:'image/png',buffer:Buffer.from(images.photo,'base64')});
  await page.locator('#annotationStage svg').waitFor();await page.waitForFunction(()=>document.documentElement.dataset.saveState==='saved');
  await tab('map');await page.locator('#mapImport').setInputFiles({name:'synthetic-map.png',mimeType:'image/png',buffer:Buffer.from(images.map,'base64')});
  await page.locator('#planStage svg').waitFor();await field('map.source').fill('合成底圖，非使用者實檔');
  await page.waitForFunction(()=>document.documentElement.dataset.saveState==='saved');
  await tab('case');await field('header.caseNumber').waitFor();
  await page.waitForFunction(()=>document.querySelector('#offlineStatus').textContent.includes('離線資源已準備'));
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
  const before=await snapshot(),oldRuntime=await runtime();assert.equal(before.media.length,2);assert.equal(before.project.pairs.length,2);
  const sources=[{id:before.project.pairs[0].photos[0].mediaId,file:'source-photo.png',sha256:sha(Buffer.from(images.photo,'base64'))},
   {id:before.project.map.mediaId,file:'source-map.png',sha256:sha(Buffer.from(images.map,'base64'))}];
  for(const source of sources)assert.equal(before.media.find(m=>m.id===source.id).sha256,source.sha256);
  await fs.writeFile(path.join(out,'media-sources.json'),JSON.stringify(sources,null,2));
  assert.equal(oldRuntime['app.js'],sha(sites.old.get('app.js')));assert.equal(oldRuntime['style.css'],sha(sites.old.get('style.css')));
  await fs.writeFile(path.join(out,'before.json'),JSON.stringify(before,null,2));await page.screenshot({path:path.join(out,'before.png')});
  pass('pinned-old-v042-with-case-photo-map',{oldRuntime,media:before.media,fingerprint:before.fingerprint});
  const timeOrigin=await page.evaluate(()=>performance.timeOrigin);await server.deploy();
  await page.evaluate(async()=>await(await navigator.serviceWorker.getRegistration()).update());
  if(mode!=='stale'){
   await page.locator('#updateButton').waitFor({state:'visible'});
   assert.equal(await page.evaluate(()=>performance.timeOrigin),timeOrigin,'Update must not silently reload an edited case');
   await Promise.all([page.waitForEvent('load'),page.locator('#updateButton').click()]);
  }else await page.reload();
  await field('header.caseNumber').waitFor();
  const actual=await runtime();
  // The unchanged-worker mutant must fail this exact release invariant, not a timeout.
  assert.equal(actual['app.js'],sha(sites.current.get('app.js')),'runtime app.js must match new deployment');
  assert.equal(actual['style.css'],sha(sites.current.get('style.css')),'runtime style.css must match new deployment');
  const after=await snapshot();assert.deepEqual(after,before,'Entire project, confirmation/audit fields and both media blobs must survive');
  await fs.writeFile(path.join(out,'after.json'),JSON.stringify(after,null,2));
  pass('upgrade-loads-new-runtime-and-retains-all-evidence',{actual,fingerprint:after.fingerprint,media:after.media});
  const keys=await page.evaluate(()=>caches.keys()),key=sites.current.get('sw.js').toString().match(/const CACHE='([^']+)'/)[1];
  assert.ok(keys.includes(key));assert.ok(!keys.includes('tilt-survey-v0.4.2'));
  pass('new-complete-shell-active-old-cache-retired',{keys});
  phase='offline';const offlineUrl=server.url+'?upgrade-offline='+channel;
  await context.setOffline(true);await page.goto(offlineUrl);await field('header.caseNumber').waitFor();
  const offline=await snapshot();assert.deepEqual(offline,before);await fs.writeFile(path.join(out,'offline.json'),JSON.stringify(offline,null,2));
  await tab('photos');await page.locator('#annotationStage img').waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('#annotationStage img')].every(i=>i.complete&&i.naturalWidth>0));
  await tab('map');await page.locator('#planStage svg').waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('#planStage img')].every(i=>i.complete&&i.naturalWidth>0));
  await injectSvgMapFault(page,mode);
  record.svgMap=await assertSvgMapVisible(page,out,{mediaId:before.project.map.mediaId,sha256:sources[1].sha256,width:before.project.map.width,height:before.project.map.height});
  await page.screenshot({path:path.join(out,'offline-map.png')});await context.setOffline(false);phase='online';
  pass('offline-project-photo-and-map-retained',{fingerprint:offline.fingerprint});
  pass('strict-startup-through-offline-diagnostics',assertOfflineRecovery(diagnostics,{url:offlineUrl,workerUrl:server.url+'sw.js',readVerified:true}));
 });
 record.status='passed';record.browserVersion=browser.version();
}catch(error){record.status='failed';record.error={name:error.name,message:error.message,stack:error.stack};console.error(error.stack);process.exitCode=1;}
finally{
 await context.setOffline(false).catch(()=>{});await closeAfterEvidence(context);await closeAfterEvidence(browser);await server.close();
 record.endedUtc=new Date().toISOString();await save();
}
