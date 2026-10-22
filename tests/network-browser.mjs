import {chromium} from 'playwright';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {startServer} from '../serve.mjs';import {VERSION} from '../model.js';import {poll} from './poll.mjs';
const server=await startServer(),base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:process.platform==='win32'?'chrome':undefined,headless:true}),context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage(),timers=new Set();await fs.mkdir('output/network',{recursive:true});
try{
 await page.goto(base);await page.locator('[data-field="header.orgName"]').waitFor();await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));});
 let routed=false;await context.route('**/*weak-signal=1',async route=>{
  routed=true;
  // Simulate the required ten-second upstream latency, never an assertion delay.
  await new Promise(resolve=>{const entry={resolve,timer:null};entry.timer=setTimeout(()=>{timers.delete(entry);resolve();},10000);timers.add(entry);});
  try{await route.continue();}catch{}
 });
 const started=performance.now();await page.goto(base+`/?release=${VERSION}&weak-signal=1`,{waitUntil:'domcontentloaded'});await page.locator('[data-field="header.orgName"]').waitFor();const elapsedMs=performance.now()-started;
 await poll(page,()=>assert.equal(routed,true));await poll(page,()=>assert.ok(elapsedMs<4000,`弱訊號載入 ${elapsedMs} ms`));await page.screenshot({path:'output/network/weak-signal.png',fullPage:true});console.log(`PASS 十秒網路延遲由三秒快取備援，載入 ${elapsedMs.toFixed(1)} ms（小於 4000 ms）`);
 await context.setOffline(true);await page.goto(base+`/?release=${VERSION}&offline-proof=1`);await page.locator('[data-field="header.orgName"]').waitFor();await page.locator('#statusToggle').click();await page.getByText('離線使用中',{exact:true}).waitFor();await page.screenshot({path:'output/network/offline-release.png',fullPage:true});console.log(`PASS 離線含 ?release=${VERSION} 網址可開啟`);await fs.writeFile('output/network/results.json',JSON.stringify({elapsedMs,upstreamDelayMs:10000,limitMs:4000,routed,offline:true},null,2));
}finally{for(const entry of timers){clearTimeout(entry.timer);entry.resolve();}await context.close();await browser.close();await new Promise(r=>server.close(r));}
