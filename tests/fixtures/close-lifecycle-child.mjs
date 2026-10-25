import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {closeWithEvidence} from '../release/close-with-evidence.mjs';
import {cleanupProfile,applyCleanupResult} from '../release/profile-cleanup.mjs';
const [out,channel]=process.argv.slice(2);await fs.mkdir(out,{recursive:true});
const profile=path.join(os.tmpdir(),'tilt-map-live-close-lifecycle-'+randomUUID());
const context=await chromium.launchPersistentContext(profile,{channel,headless:true});
await context.pages()[0].goto('data:text/html,<title>SYNTHETIC CLOSE LIFECYCLE</title>');
await fs.writeFile(path.join(profile,'synthetic-marker'),'SYNTHETIC');
const browser=context.browser()||context,rawClose=browser.close.bind(browser),order=[];
let calls=0,firstSettled=false,original;
browser.close=async(...args)=>{calls++;if(calls>1)return rawClose(...args);order.push('first-close-entered');const value=await rawClose(...args);
 await new Promise(resolve=>setTimeout(resolve,2250));firstSettled=true;order.push('first-close-settled');return value;};
try{await closeWithEvidence(browser,{out,label:'first'});}catch(error){original=error;}
const record={status:original?'failed':'passed',error:original};
const cleanup=await cleanupProfile({profile,seed:context,closeOwnedBrowser:true,failed:!!original,
 remove:async p=>{order.push('remove');assert.equal(firstSettled,true,'Original first close must settle before removal');await fs.rm(p,{recursive:true,force:true});}});
applyCleanupResult(record,cleanup);let absent=false;try{await fs.lstat(profile);}catch(error){if(error.code==='ENOENT')absent=true;else throw error;}
await fs.writeFile(path.join(out,'observation.json'),JSON.stringify({channel,calls,order,firstSettled,absent,cleanup,
 sameOriginalError:record.error===original,originalError:original?{name:original.name,message:original.message,code:original.code}:null,
 scope:'real persistent browser/profile; injected 2250ms public-close wrapper delay, not a measured Playwright internal delay'},null,2));
// Dispose only the fixture's own isolated directory after recording any failed production cleanup.
if(!absent){await new Promise(resolve=>setTimeout(resolve,2300));await rawClose().catch(()=>{});assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(profile,{recursive:true,force:true});}
if(original||cleanup.status!=='completed')process.exitCode=1;
