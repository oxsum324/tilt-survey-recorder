import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {runCaptured} from './command.mjs';
import {loadSites,assertRevisionChanged} from './site.mjs';
import {runMapNegative} from './map-negative.mjs';
const root=path.resolve(process.env.TILT_RELEASE_OUTPUT_ROOT||'output/playwright/release-regressions',`release-${randomUUID()}`);
await fs.mkdir(root,{recursive:true});await fs.mkdir(path.join(root,'commands'));
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cases=[];
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const save=()=>fs.writeFile(path.join(root,'results.json'),JSON.stringify({head,scope:'staged deployment simulation; not published Pages',cases},null,2));
const pass=async(name,data)=>{cases.push({name,status:'pass',data});await save();console.log('PASS release regression: '+name);};
try{
 const sites=await loadSites();assert.equal(sites.manifest.commit,head);assertRevisionChanged(sites.old,sites.current);
 const sameWorker=new Map(sites.current);sameWorker.set('sw.js',sites.old.get('sw.js'));
 assert.throws(()=>assertRevisionChanged(sites.old,sameWorker),/without a changed service worker/);
 const sameCache=new Map(sites.current);sameCache.set('sw.js',Buffer.from(sites.current.get('sw.js').toString().replace(/const CACHE='[^']+'/,"const CACHE='tilt-survey-v0.4.2'")));
 assert.throws(()=>assertRevisionChanged(sites.old,sameCache),/without a distinct completed-shell cache/);
 const runtimeDrift=new Map(sites.current);runtimeDrift.set('app.js',Buffer.concat([runtimeDrift.get('app.js'),Buffer.from('\n// synthetic runtime drift')]));
 assert.throws(()=>assertRevisionChanged(sites.old,runtimeDrift),/current runtime content digest/);
 await pass('release-drift-rejects-unchanged-worker-and-cache',{fixtureCommit:sites.fixture.sourceCommit,negativeControls:3});
 for(const channel of ['chrome','msedge'])for(const mode of ['upgrade','stale','basic','initial-console']){
  const name=channel+'-'+mode,out=path.join(root,name),basic=['basic','initial-console'].includes(mode);
  const execution=await runCaptured({root:path.join(root,'commands'),name,executable:process.execPath,
   args:[basic?'tests/release/basic-child.mjs':'tests/release/upgrade-child.mjs',out,channel,mode],
   resultFile:mode==='basic'||mode==='upgrade'?path.join(out,'results.json'):null,
   expectedChecks:mode==='basic'?16:mode==='upgrade'?5:null});
  assert.equal(execution.watchdogTriggered,false);assert.equal(execution.signal,null);
  const negative=['stale','initial-console'].includes(mode);assert.equal(execution.rawExitCode,negative?1:0);assert.equal(execution.exitCode,negative?1:0);
  const result=await read(path.join(out,'results.json'));assert.equal(result.status,negative?'failed':'passed');
  if(negative){
   const scenario=basic?'basic':'upgrade',folder=path.join(out,'diagnostics',scenario),record=await read(path.join(folder,'failure.json'));
   assert.deepEqual(record.captureErrors,[]);assert.equal(record.pageClosedAtFailure,false);assert.equal(record.artifactAttempts.length,4);assert.ok(record.artifactAttempts.every(a=>a.status==='saved'));
   const stderr=await fs.readFile(path.join(root,'commands',name,'stderr.log'),'utf8');
   assert.match(stderr,mode==='stale'?/runtime app.js must match new deployment/:/cold-start diagnostics/);
   assert.equal(record.originalError.name,mode==='stale'?'AssertionError':'Error');
   if(mode==='initial-console'){
    assert.equal(result.checks.length,0);assert.ok(result.diagnostics.consoleErrors.includes('injected-first-navigation-console-error'));
    const events=await read(path.join(folder,'events.json'));assert.ok(events.some(e=>e.type==='console'&&e.text==='injected-first-navigation-console-error'));
   }
  }
  if(basic){assert.ok(result.url.startsWith('http://127.0.0.1:'));assert.ok(result.finalPageUrl.startsWith(result.url));}
  await pass(name,{rawExitCode:execution.rawExitCode,exitCode:execution.exitCode,expectedFailure:negative,checks:result.checks.length});
 }
 assert.equal(cases.length,9);
 for(const channel of ['chrome','msedge'])for(const mode of ['map-missing','map-corrupt']){
  const proof=await runMapNegative({root,channel,mode});await pass(proof.name,proof.data);
 }
 assert.equal(cases.length,13);
}catch(error){cases.push({name:'suite-failure',status:'fail',error:{name:error.name,message:error.message,stack:error.stack}});await save();throw error;}
finally{
 const files=[];const walk=async dir=>{for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else{const b=await fs.readFile(p);files.push({file:path.relative(root,p).replaceAll('\\','/'),bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}}};
 await walk(root);await fs.writeFile(path.join(root,'sha256.json'),JSON.stringify(files,null,2));
}
console.log(JSON.stringify({head,releaseCases:13,originalReleaseCases:9,freshBasicChecks:32,expectedFailingBrowserChildren:8,evidence:root}));
