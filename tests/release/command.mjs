import fs from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// Native logs exist before spawn, including missing executables and semantic failures.
export async function runCaptured({root,name,executable,args=[],cwd=process.cwd(),env=process.env,
  resultFile=null,expectedChecks=null,timeoutMs=120000}) {
  const out=path.join(root,name);await fs.mkdir(out,{recursive:false});
  const stdout=path.join(out,'stdout.log'),stderr=path.join(out,'stderr.log'),receipt=path.join(out,'execution.json');
  await fs.writeFile(stdout,'',{flag:'wx'});await fs.writeFile(stderr,'',{flag:'wx'});
  const record={name,executable,args,cwd,startedUtc:new Date().toISOString(),status:'running',rawExitCode:null,
    exitCode:null,signal:null,watchdogTriggered:false,error:null};
  const save=()=>fs.writeFile(receipt,JSON.stringify(record,null,2));await save();
  try {
    const child=spawn(executable,args,{cwd,env,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',bytes=>appendFileSync(stdout,bytes));child.stderr.on('data',bytes=>appendFileSync(stderr,bytes));
    let timer;
    const completion=await new Promise(resolve=>{
      child.once('error',error=>{record.error={name:error.name,message:error.message,stack:error.stack};appendFileSync(stderr,error.stack+'\n');});
      child.once('close',(code,signal)=>resolve({code,signal}));
      timer=setTimeout(()=>{record.watchdogTriggered=true;
        appendFileSync(stderr,'Release regression watchdog exceeded; this is a failed test\n');
        if(process.platform==='win32')spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});
        else child.kill('SIGKILL');
      },timeoutMs);
    }).finally(()=>clearTimeout(timer));
    record.rawExitCode=completion.code;record.signal=completion.signal;
    record.exitCode=record.error||record.watchdogTriggered||completion.signal||completion.code!==0?1:0;
    if(record.exitCode===0&&resultFile){
      try {
        const result=JSON.parse(await fs.readFile(resultFile,'utf8'));
        assert.equal(result.status,'passed','A zero native exit cannot override failed result JSON');
        if(expectedChecks!==null){assert.equal(result.checks.length,expectedChecks);assert.ok(result.checks.every(c=>c.status==='pass'));}
      }catch(error){record.exitCode=1;record.semanticError={name:error.name,message:error.message};appendFileSync(stderr,error.stack+'\n');}
    }
  }catch(error){record.exitCode=1;record.error={name:error.name,message:error.message,stack:error.stack};appendFileSync(stderr,error.stack+'\n');}
  finally {
    record.endedUtc=new Date().toISOString();record.status=record.exitCode===0?'success':'failure';
    record.stdoutSha256=createHash('sha256').update(await fs.readFile(stdout)).digest('hex');
    record.stderrSha256=createHash('sha256').update(await fs.readFile(stderr)).digest('hex');await save();
  }
  return record;
}
