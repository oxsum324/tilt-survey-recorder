import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import * as closeApi from './browser-failure-evidence.mjs';
import * as basicApi from './release/basic-checks.mjs';
import {cleanupProfile,applyCleanupResult} from './release/profile-cleanup.mjs';
import {finalizeStaged} from './release/staged-finalize.mjs';
import {runCaptured} from './release/command.mjs';
import {executionOrigin} from './execution-origin.mjs';
const root=path.resolve(process.env.TILT_CLOSE_LIFECYCLE_ROOT||'output/playwright/close-lifecycle','run-'+randomUUID());
await fs.mkdir(path.join(root,'commands'),{recursive:true});const cases=[];
const profile=()=>path.join(os.tmpdir(),'tilt-map-live-close-unit-'+randomUUID());
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const passed=async(name,data)=>{cases.push({name,status:'pass',data});await fs.writeFile(path.join(root,'results.json'),JSON.stringify({...executionOrigin(),cases},null,2));};

test('pending first close is shared by cleanup before removal',async()=>{
 const p=profile();await fs.mkdir(p);await fs.writeFile(path.join(p,'marker'),'SYNTHETIC');
 let calls=0,settled=false,finish;const order=[],first=new Promise(resolve=>{finish=()=>{settled=true;order.push('settled');resolve();};});
 const browser={close(){calls++;return calls===1?first:Promise.resolve();}};let original;
 try{await closeApi.closeAfterEvidence(browser,5);}catch(error){original=error;}
 const timer=setTimeout(finish,40);
 try{
  const cleanup=await cleanupProfile({profile:p,context:{browser:()=>browser},closeOwnedBrowser:true,
   remove:async value=>{order.push('remove');assert.equal(settled,true,'First operation must complete before profile removal');await fs.rm(value,{recursive:true,force:true});}});
  const record={status:'failed',error:original};applyCleanupResult(record,cleanup);
  await fs.writeFile(path.join(root,'shared-observation.json'),JSON.stringify({calls,settled,order,cleanup,sameOriginalError:record.error===original},null,2));
  assert.equal(calls,1);assert.equal(cleanup.status,'completed');assert.deepEqual(order,['settled','remove']);
  assert.equal(cleanup.verification.absent,true);assert.equal(record.error,original);
  await assert.rejects(fs.lstat(p),{code:'ENOENT'});await passed('shared-first-close-before-removal',{calls,order,cleanup,originalErrorPreserved:true});
 }finally{clearTimeout(timer);if(!settled)finish();await first;assert.ok(path.resolve(p).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(p,{recursive:true,force:true});}
});

test('all close callers receive the identical first promise',async()=>{
 let calls=0,finish;const browser={close(){calls++;return new Promise(resolve=>{finish=resolve;});}};
 const a=closeApi.closeOnce(browser),b=closeApi.closeOnce(browser);assert.equal(a,b);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 finish();await a;assert.equal(closeApi.closeOnce(browser),a);await passed('identical-close-promise',{calls,identical:true});
});

for(const mode of ['unresponsive','rejected'])test(mode+' close prevents removal and absence claim',async()=>{
 const p=profile();await fs.mkdir(p);let removed=false,inspected=false;
 const browser={close:mode==='rejected'?()=>Promise.reject(Object.assign(Error('ORIGINAL CLOSE REJECTION'),{code:'CLOSE'})):()=>new Promise(()=>{})};
 try{
  const result=await cleanupProfile({profile:p,context:{browser:()=>browser},closeOwnedBrowser:true,timeoutMs:40,
   remove:async()=>{removed=true;},inspect:async()=>{inspected=true;}});
  assert.equal(result.status,'failed');assert.equal(removed,false);assert.equal(inspected,false);assert.equal(result.verification.absent,null);
  assert.ok(result.stages.filter(s=>s.name.startsWith('profile-')).every(s=>s.status==='skipped'&&s.reason==='close-not-completed'));
  const original=Error('ORIGINAL ACTION');const record={status:'failed',error:original};applyCleanupResult(record,result);assert.equal(record.error,original);
  await passed('close-'+mode+'-no-delete',{result,removed,inspected,originalErrorPreserved:true});
 }finally{assert.ok(path.resolve(p).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(p,{recursive:true,force:true});}
});

for(const status of ['failed','closed'])test('expected action failure requires '+status+' close to be independently checked',async()=>{
 const name='expected-action-'+status,out=path.join(root,name);await fs.mkdir(out);const original=Error('ORIGINAL EXPECTED ACTION');const record={status:'failed',error:original,checks:[]};let serverClosed=false;
 const result=await finalizeStaged({record,originalError:original,browser:{},out,server:{close:async()=>{serverClosed=true;}},
  close:async()=>({status,diagnostic:{nativeStatus:status==='closed'?'completed':'running'},error:status==='failed'?{name:'CaptureTimeoutError',message:'INJECTED CLOSE TIMEOUT'}:undefined}),stderr:()=>{}});
 const saved=await read(path.join(out,'results.json'));assert.equal(result.error,original);assert.equal(serverClosed,true);assert.equal(saved.error.message,original.message);assert.equal(saved.status,'failed');
 if(status==='failed')assert.throws(()=>basicApi.assertBasicCloseCompleted(saved));else assert.doesNotThrow(()=>basicApi.assertBasicCloseCompleted(saved));
 await passed('expected-action-'+status,{result:saved,serverClosed,originalErrorPreserved:true,closeAccepted:status==='closed'});
});

for(const channel of ['chrome','msedge'])test(channel+' real persistent profile waits for delayed first close',async()=>{
 const out=path.join(root,channel),ex=await runCaptured({root:path.join(root,'commands'),name:channel,executable:process.execPath,args:['tests/fixtures/close-lifecycle-child.mjs',out,channel]});
 assert.equal(ex.rawExitCode,1);assert.equal(ex.exitCode,1);assert.equal(ex.signal,null);assert.equal(ex.watchdogTriggered,false);
 const d=await read(path.join(out,'observation.json'));assert.equal(d.calls,1);assert.equal(d.firstSettled,true);assert.equal(d.absent,true);
 assert.equal(d.cleanup.status,'completed');assert.equal(d.cleanup.timeoutMs,10000);assert.equal(d.cleanup.verification.absent,true);assert.equal(d.sameOriginalError,true);
 assert.equal(d.originalError.name,'CaptureTimeoutError');assert.match(d.originalError.message,/deadline 2000ms/);assert.deepEqual(d.order,['first-close-entered','first-close-settled','remove']);
 await passed(channel+'-real-close-lifecycle',d);
});

test.after(async()=>{const entries=[];const walk=async dir=>{for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else{const b=await fs.readFile(p);entries.push({file:path.relative(root,p).replaceAll('\\','/'),bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}}};await walk(root);await fs.writeFile(path.join(root,'sha256.json'),JSON.stringify(entries,null,2));console.log(JSON.stringify({closeLifecycleCases:cases.length,evidence:root}));});
