import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {monitorContext,assertClean,assertOfflineRecovery} from './diagnostics.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const {chromium}=await import(pathToFileURL(path.join(process.cwd(),'node_modules/playwright/index.mjs')).href);
const {poll}=await import(pathToFileURL(path.join(process.cwd(),'tests/poll.mjs')).href);
const results=[];
for(const channel of ['chrome','msedge']){const browser=await chromium.launch({channel,headless:true});
try{for(const key of ['httpErrors','consoleErrors','pageErrors','requestFailures']){
 const context=await browser.newContext(),d=monitorContext(context,()=> 'isolated-injected-fault');
 await context.route('https://diagnostic.invalid/**',r=>r.request().url().endsWith('/abort')?r.abort('connectionfailed'):r.fulfill({status:r.request().url().endsWith('/500')?500:200,contentType:'text/html',body:'<!doctype html><title>diagnostic selftest</title>'}));
 const page=await context.newPage();await page.goto('https://diagnostic.invalid/index');
 if(key==='httpErrors')await page.evaluate(()=>fetch('/500'));
 if(key==='consoleErrors')await page.evaluate(()=>console.error('INJECTED console failure'));
 if(key==='pageErrors')await page.evaluate(()=>setTimeout(()=>{throw Error('INJECTED runtime failure')},0));
 if(key==='requestFailures')await page.evaluate(()=>fetch('/abort').catch(()=>{}));
 await poll(page,()=>assert.ok(d[key].length>0));
 const isolated={httpErrors:[],consoleErrors:[],pageErrors:[],requestFailures:[],[key]:d[key]};
 assert.throws(()=>assertClean(isolated),new RegExp(key));
 results.push({channel,browserVersion:browser.version(),key,detected:d[key],rejected:true});await context.close();
}}finally{await browser.close();}}
assert.equal(results.length,8);
const offlineUrl='https://example.invalid/?intentional-offline',workerUrl='https://example.invalid/sw.js',base={httpErrors:[],consoleErrors:[],pageErrors:[],requestFailures:[{phase:'offline',url:offlineUrl,method:'GET',resourceType:'fetch',serviceWorker:workerUrl,error:{errorText:'net::ERR_INTERNET_DISCONNECTED'}}],responses:[{phase:'offline',url:offlineUrl,status:200,fromServiceWorker:true}]};
assertOfflineRecovery(base,{url:offlineUrl,workerUrl,readVerified:true});
const guards=[];
for(const [key,value] of [['phase','online'],['url','https://example.invalid/other'],['method','POST'],['resourceType','document'],['serviceWorker',null],['error',{errorText:'net::ERR_FAILED'}]]){
 const d=structuredClone(base);d.requestFailures[0][key]=value;assert.throws(()=>assertOfflineRecovery(d,{url:offlineUrl,workerUrl,readVerified:true}));guards.push({mutation:key,rejected:true});
}
for(const key of ['missing-cache-response','unverified-read']){const d=structuredClone(base);if(key==='missing-cache-response')d.responses=[];assert.throws(()=>assertOfflineRecovery(d,{url:offlineUrl,workerUrl,readVerified:key!=='unverified-read'}));guards.push({mutation:key,rejected:true});}
await fs.writeFile(path.join(process.env.TILT_DESKTOP_RUN_DIR,'diagnostic-selftest.json'),JSON.stringify({purpose:'Isolated injected faults; excluded from real-site scenario counts',checks:results,offlineRecoveryGuards:guards},null,2));
console.log(JSON.stringify({negativeControls:8,rejected:8,offlineRecoveryGuards:guards.length,status:'pass'}));
