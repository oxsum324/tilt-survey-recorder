import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {assertVisible} from './visibility.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),results=[];
const {chromium}=await import(pathToFileURL(path.join(process.cwd(),'node_modules/playwright/index.mjs')).href);
for(const channel of ['chrome','msedge']){
 const browser=await chromium.launch({channel,headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<div id="parent"><span id="value">1／212</span></div>');const value=page.locator('#value');
  await assertVisible(value);
  for(const kind of ['display-none','visibility-hidden','opacity-zero','ancestor-opacity-zero']){
   await page.evaluate(kind=>{const target=document.querySelector(kind==='ancestor-opacity-zero'?'#parent':'#value');target.style.cssText=kind==='display-none'?'display:none':kind==='visibility-hidden'?'visibility:hidden':'opacity:0';},kind);
   await assert.rejects(()=>assertVisible(value));results.push({channel,browserVersion:browser.version(),mutation:kind,rejected:true});
   await page.evaluate(()=>{document.querySelector('#parent').style.cssText='';document.querySelector('#value').style.cssText='';});await assertVisible(value);
  }
 }finally{await browser.close();}
}
assert.equal(results.length,8);await fs.writeFile(path.join(process.env.TILT_DESKTOP_RUN_DIR,'visibility-selftest.json'),JSON.stringify({positiveBrowsers:2,negativeControls:results},null,2));console.log(JSON.stringify({positiveBrowsers:2,rejectedMutations:8,status:'pass'}));
