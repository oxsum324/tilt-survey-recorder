import {poll,reportReady} from './poll.mjs';
// Mocked platform states verify lifecycle and honest labels; they do not certify a physical device.
import {chromium} from 'playwright';import assert from 'node:assert/strict';import {startServer} from '../serve.mjs';
const server=await startServer(),base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:process.platform==='win32'?'chrome':undefined,headless:true});
try{
  const context=await browser.newContext();await context.addInitScript(()=>{
    window.__wake={requests:0,releases:0,deny:false,visible:true};Object.defineProperty(document,'visibilityState',{get:()=>window.__wake.visible?'visible':'hidden'});
    Object.defineProperty(navigator,'wakeLock',{value:{async request(){window.__wake.requests++;if(window.__wake.deny)throw Error('denied');const lock=new EventTarget();lock.released=false;lock.release=async()=>{if(!lock.released){lock.released=true;window.__wake.releases++;lock.dispatchEvent(new Event('release'));}};return lock;}}});
  });const page=await context.newPage();await page.goto(base);await page.getByRole('button',{name:'螢幕常亮：已啟用',exact:true}).waitFor();await poll(page,async()=>assert.equal(await page.evaluate(()=>window.__wake.requests),1));
  await page.evaluate(()=>{window.__wake.visible=false;document.dispatchEvent(new Event('visibilitychange'));});await page.getByRole('button',{name:'螢幕常亮：已暫停',exact:true}).waitFor();await poll(page,async()=>assert.equal(await page.evaluate(()=>window.__wake.releases),1));
  await page.evaluate(()=>{window.__wake.visible=true;document.dispatchEvent(new Event('visibilitychange'));});await page.getByRole('button',{name:'螢幕常亮：已啟用',exact:true}).waitFor();await poll(page,async()=>assert.equal(await page.evaluate(()=>window.__wake.requests),2));process.stdout.write('PASS 常亮預設申請、隱藏釋放、返回重申請（模擬平台）\n');
  await page.locator('#wakeButton').click();await page.getByRole('button',{name:'螢幕常亮：已關閉',exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'螢幕常亮：已關閉',exact:true}).waitFor();await poll(page,async()=>assert.equal(await page.evaluate(()=>window.__wake.requests),0));process.stdout.write('PASS 關閉常亮偏好保留，不自動重申請（模擬平台）\n');
  await page.evaluate(()=>window.__wake.deny=true);await page.locator('#wakeButton').click();await page.getByRole('button',{name:'螢幕常亮：已暫停',exact:true}).waitFor();process.stdout.write('PASS 常亮申請拒絕顯示已暫停（模擬平台）\n');await context.close();
  const unsupported=await browser.newContext();await unsupported.addInitScript(()=>{delete Object.getPrototypeOf(navigator).wakeLock;});const p=await unsupported.newPage();await p.goto(base);await p.getByRole('button',{name:'螢幕常亮：不支援',exact:true}).waitFor();await unsupported.close();process.stdout.write('PASS 不支援常亮顯示實際狀態（模擬平台）\n');
}finally{await browser.close();await new Promise(r=>server.close(r));}
