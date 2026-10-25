import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {sampleProject,createProject} from '../model.js';
const source=await fs.readFile(new URL('../store.js',import.meta.url),'utf8');
const core=source.slice(source.indexOf("const DB_NAME="),source.indexOf('const object=')).replace(/\bexport /g,'');
const install=core+';return {loadProject,saveProject,replaceProject,saveMedia,loadMedia};';
let browser,temp,url;
before(async()=>{
 temp=await fs.mkdtemp(path.join(os.tmpdir(),'tilt-storage-regression-'));
 const file=path.join(temp,'storage.html');await fs.writeFile(file,'<!doctype html><meta charset="utf-8"><title>Synthetic storage regression</title>');
 url=pathToFileURL(file).href;browser=await chromium.launch({channel:process.platform==='win32'?'chrome':undefined,headless:true});
});
after(async()=>{await browser?.close();if(temp){await fs.rm(path.join(temp,'storage.html'),{force:true});await fs.rmdir(temp);}});
async function fixture(run){const context=await browser.newContext();try{const pages=[];for(let i=0;i<2;i++){const page=await context.newPage();await page.goto(url);await page.evaluate(code=>globalThis.store=new Function(code)(),install);pages.push(page);}await run(...pages);}finally{await context.close();}}
async function seed(page,p=sampleProject(),media=[]){await page.evaluate(async({p,media})=>{await store.replaceProject(p,media.map(m=>({id:m.id,blob:new Blob([m.text],{type:'image/png'})})),await store.loadProject());},{p,media});return p;}
test('stale same-case writes are rejected even after a separate read',()=>fixture(async(a,b)=>{
 await seed(a);for(const page of [a,b])await page.evaluate(async()=>globalThis.loaded=await store.loadProject());
 await a.evaluate(async()=>{loaded.header.caseNumber='newer-first-tab';await store.saveProject(loaded);});
 await b.evaluate(()=>store.loadProject());
 await assert.rejects(b.evaluate(async()=>{loaded.header.address='stale-second-tab';await store.saveProject(loaded);}),/其他分頁|較新|版本|重新載入/);
 assert.equal((await a.evaluate(()=>store.loadProject())).header.caseNumber,'newer-first-tab');
}));
test('concurrent writers with the same revision have exactly one winner',()=>fixture(async(a,b)=>{
 await seed(a);for(const page of [a,b])await page.evaluate(async()=>globalThis.loaded=await store.loadProject());
 const outcomes=await Promise.allSettled([a.evaluate(async()=>{loaded.header.caseNumber='writer-a';await store.saveProject(loaded);}),b.evaluate(async()=>{loaded.header.caseNumber='writer-b';await store.saveProject(loaded);})]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);
 assert.match((await a.evaluate(()=>store.loadProject())).header.caseNumber,/^writer-[ab]$/);
}));
test('stale replacement writes cannot restore old project and old media stay exportable',()=>fixture(async(a,b)=>{
 const old=await seed(a,sampleProject(),[{id:'old-media',text:'old-original'}]);
 await b.evaluate(async()=>globalThis.loaded=await store.loadProject());
 const next=createProject();await seed(a,next,[{id:'new-media',text:'new-original'}]);
 await assert.rejects(b.evaluate(()=>store.saveProject(loaded)),/其他分頁|較新|版本|重新載入/);
 const state=await a.evaluate(async()=>({id:(await store.loadProject()).id,old:await(await store.loadMedia('old-media'))?.text(),new:await(await store.loadMedia('new-media'))?.text()}));
 assert.equal(state.id,next.id);assert.notEqual(state.id,old.id);assert.equal(state.old,'old-original');assert.equal(state.new,'new-original');
}));
test('untracked project cannot overwrite an existing current project',()=>fixture(async(a)=>{
 const p=await seed(a),next=createProject();
 await assert.rejects(a.evaluate(p=>store.saveProject(p),next),/其他分頁|較新|版本|重新載入/);
 assert.equal((await a.evaluate(()=>store.loadProject())).id,p.id);
}));
test('media IDs are immutable and identical replacement media remain valid',()=>fixture(async(a)=>{
 await seed(a,sampleProject(),[{id:'shared-media',text:'original-bytes'}]);
 await assert.rejects(a.evaluate(()=>store.saveMedia('shared-media',new Blob(['changed-bytes'],{type:'image/png'}))),/媒體|原檔|識別/);
 const next=createProject();
 await assert.rejects(a.evaluate(async p=>store.replaceProject(p,[{id:'shared-media',blob:new Blob(['changed-bytes'],{type:'image/png'})}],await store.loadProject()),next),/媒體|原檔|識別/);
 assert.equal(await a.evaluate(async()=>await(await store.loadMedia('shared-media')).text()),'original-bytes');
 await seed(a,next,[{id:'shared-media',text:'original-bytes'}]);assert.equal((await a.evaluate(()=>store.loadProject())).id,next.id);
}));
test('database upgrade preserves legacy current data and blocks old version writers',()=>fixture(async(a)=>{
 const legacy=sampleProject();
 await a.evaluate(p=>new Promise((resolve,reject)=>{const request=indexedDB.open('tilt-survey-v1',1);request.onupgradeneeded=()=>{request.result.createObjectStore('project');request.result.createObjectStore('media');};request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,t=db.transaction('project','readwrite');t.objectStore('project').put(p,'current');t.oncomplete=()=>{db.close();resolve();};t.onerror=()=>reject(t.error);};}),legacy);
 await a.evaluate(async()=>{globalThis.loaded=await store.loadProject();await store.saveProject(loaded);});
 assert.equal((await a.evaluate(()=>store.loadProject())).id,legacy.id);
 const failure=await a.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('tilt-survey-v1',1);r.onerror=()=>resolve(r.error.name);r.onsuccess=()=>{r.result.close();resolve(null);};}));
 assert.equal(failure,'VersionError');
}));

