import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startServer} from '../serve.mjs';
import {poll} from './poll.mjs';
import {withFailureEvidence} from './browser-failure-evidence.mjs';

const server=await startServer(),base=`http://127.0.0.1:${server.address().port}`,records=[];
assert.doesNotMatch(await fs.readFile('style.css','utf8'),/html:has\(body\.readings-active\)/);
const channels=process.platform==='win32'?['chrome','msedge']:[undefined];
try{for(const channel of channels){
 const browser=await chromium.launch({channel,headless:true});
 try{for(const viewport of [{width:1280,height:720},{width:1600,height:900}])for(const bright of [false,true]){
  const context=await browser.newContext({viewport}),name=`${channel}-${viewport.width}-${bright?'sunlight':'normal'}`;
  await context.addInitScript(()=>{
   const NativeObserver=ResizeObserver;
   window.ResizeObserver=class extends NativeObserver{
    constructor(callback){super((entries,observer)=>{
     if(entries.some(e=>e.target.id==='liveResults')){
      window.reviewResultsCallback=callback;window.reviewResultsElement=entries.find(e=>e.target.id==='liveResults').target;
      callback([{target:document.createElement('div')},...entries],observer);
     }else callback(entries,observer);
    });}
   };
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const pass=(label,data)=>{records.push({name,label,status:'pass',data});console.log(`PASS ${name}: ${label}`);};
  try{
   await withFailureEvidence({context,page,name},async()=>{
   await page.goto(base);await page.locator('[data-field="header.caseNumber"]').waitFor();
   await page.evaluate(async()=>{const {sampleProject}=await import('./model.js'),{replaceProject}=await import('./store.js');await replaceProject(sampleProject());});
   await page.reload();await page.locator('[data-tab="readings"]').click();if(bright)await page.locator('#sunlightButton').click();
   await poll(page,async()=>assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('readings-active')&&document.body.classList.contains('readings-active')),true));
   await poll(page,async()=>assert.equal(await page.locator('#liveResults').evaluate(e=>Math.round(parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)*1000)===Math.round((parseFloat(getComputedStyle(e).top)+e.getBoundingClientRect().height+8)*1000)),true));
   pass('HTML 狀態類別取代 has 選擇器，桌機留白不變');
   const height=page.getByRole('textbox',{name:'共用垂距 H（cm）',exact:true});
   await poll(page,async()=>assert.equal(await height.inputValue(),'486.5'));
   await poll(page,async()=>assert.equal(await page.locator('.shared-height-row .field>span').evaluate(e=>e.textContent.replace(/\s/g,'')),'H（cm）'));
   pass('H 完整可存取名稱與短視覺標籤同時保留');
   await poll(page,async()=>assert.equal(await page.evaluate(()=>!!window.reviewResultsCallback),true));
   await page.evaluate(()=>{const other=document.createElement('div');other.style.height='1px';document.body.append(other);window.reviewResultsCallback([{target:document.createElement('div')},{target:window.reviewResultsElement},{target:other}]);other.remove();});
   await poll(page,async()=>assert.equal(await page.locator('#liveResults').evaluate(e=>parseFloat(document.documentElement.style.getPropertyValue('--live-results-height'))===e.getBoundingClientRect().height),true));
   pass('ResizeObserver 跳過斷開首項與無關末項，仍處理中間結果列');
   await page.locator('[data-tab="case"]').click();
   await page.evaluate(()=>window.reviewResultsCallback([{target:window.reviewResultsElement}]));
   await poll(page,async()=>assert.equal(await page.evaluate(()=>!document.documentElement.classList.contains('readings-active')&&!document.body.classList.contains('readings-active')&&document.documentElement.style.getPropertyValue('--live-results-height')===''&&getComputedStyle(document.documentElement).scrollPaddingTop==='auto'),true));
   assert.deepEqual(errors,[]);pass('離開讀數頁後舊觀測回呼不還原留白，無執行例外');
   });
  }finally{await context.close();}
 }}finally{await browser.close();}
}}finally{await new Promise(resolve=>server.close(resolve));await fs.mkdir('output/review-followups',{recursive:true});await fs.writeFile('output/review-followups/results.json',JSON.stringify(records,null,2));}
assert.equal(records.length,channels.length*16);
