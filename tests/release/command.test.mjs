import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {runCaptured} from './command.mjs';
const root=path.resolve(process.env.TILT_RELEASE_OUTPUT_ROOT||'output/playwright/release-regressions',`runner-${randomUUID()}`);
await fs.mkdir(root,{recursive:true});const cases=[];
const save=async name=>{cases.push({name,status:'pass'});await fs.writeFile(path.join(root,'results.json'),JSON.stringify({cases},null,2));};
test('missing executable is nonzero and has stderr and a failed receipt',async()=>{
 const r=await runCaptured({root,name:'missing',executable:path.join(root,'missing-executable.exe')});
 assert.equal(r.exitCode,1);assert.notEqual(r.rawExitCode,0);assert.match(r.error.message,/ENOENT/);assert.match(await fs.readFile(path.join(root,'missing/stderr.log'),'utf8'),/ENOENT/);
 await save('missing-executable');
});
test('native assertion failure keeps actual stderr and a nonzero exit',async()=>{
 const r=await runCaptured({root,name:'assertion',executable:process.execPath,args:['--input-type=module','-e',"import assert from 'node:assert/strict';assert.equal(1,2,'original assertion');"]});
 assert.equal(r.rawExitCode,1);assert.equal(r.exitCode,1);assert.match(await fs.readFile(path.join(root,'assertion/stderr.log'),'utf8'),/original assertion/);
 await save('native-assertion-stderr');
});
test('native exit zero with failed semantic JSON must still be rejected',async()=>{
 const resultFile=path.join(root,'failed-result.json');await fs.writeFile(resultFile,JSON.stringify({status:'failed',checks:[]}));
 const r=await runCaptured({root,name:'false-zero',executable:process.execPath,args:['-e','process.exitCode=0'],resultFile,expectedChecks:16});
 assert.equal(r.rawExitCode,0);assert.equal(r.exitCode,1);assert.match(await fs.readFile(path.join(root,'false-zero/stderr.log'),'utf8'),/zero native exit/);
 await save('failed-json-rejects-native-zero');
});
