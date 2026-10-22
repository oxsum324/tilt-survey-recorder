import {chromium} from 'playwright';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {startServer} from '../serve.mjs';import {poll,reportReady} from './poll.mjs';
const server=await startServer(),browser=await chromium.launch({channel:process.platform==='win32'?'chrome':undefined,headless:true}),context=await browser.newContext({viewport:{width:375,height:812}}),page=await context.newPage(),metrics=[];
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('[data-field="header.caseNumber"]').waitFor();await page.evaluate(async()=>{const {sampleProject}=await import('./model.js'),{replaceProject}=await import('./store.js');await replaceProject(sampleProject());});await page.reload();await page.locator('[data-field="header.caseNumber"]').waitFor();
 for(const tab of ['case','facades','readings','photos','map','reports']){
  await page.locator(`[data-tab="${tab}"]`).click();if(tab==='reports')await reportReady(page);await page.evaluate(()=>scrollTo(0,0));
  await poll(page,async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),375));
  await poll(page,async()=>assert.ok(await page.locator('#workspace .card').first().evaluate(e=>e.getBoundingClientRect().top<=150),`${tab} first card`));
  await poll(page,async()=>assert.equal(await page.locator('.sidebar nav').evaluate(nav=>{const a=nav.querySelector('.active').getBoundingClientRect(),r=nav.getBoundingClientRect();return a.left>=r.left&&a.right<=r.right&&a.height>=44;}),true));
  metrics.push({tab,firstCardTop:await page.locator('#workspace .card').first().evaluate(e=>e.getBoundingClientRect().top)});
  if(['case','reports'].includes(tab))for(const action of ['export','import','verify-file'])await poll(page,async()=>assert.equal(await page.locator(`.mobile-case-actions [data-action="${action}"]`).isVisible(),true));
 }
 console.log('PASS 375 px 六頁首卡不超過 150 px、整頁等寬、目前分段可見、案件操作保留');
 await page.locator('#statusToggle').click();for(const id of ['saveStatus','offlineStatus','sunlightButton','wakeButton'])await poll(page,async()=>assert.equal(await page.locator('#'+id).isVisible(),true));await page.locator('#statusToggle').click();await poll(page,async()=>assert.equal(await page.locator('#statusPanel').getAttribute('open'),null));console.log('PASS 狀態面板保留四個原控制項，可展開收回');
 await page.setViewportSize({width:1280,height:900});await page.locator('[data-tab="case"]').click();await poll(page,async()=>assert.equal(await page.locator('#caseSummary').isVisible(),true));await poll(page,async()=>assert.match(await page.locator('#caseSummary').innerText(),/合成示例[\s\S]*2 組[\s\S]*4／4/));
 const desktop=await page.locator('.sidebar').evaluate(e=>{const r=e.getBoundingClientRect(),end=Math.max(...[...e.children].filter(c=>getComputedStyle(c).display!=='none').map(c=>c.getBoundingClientRect().bottom));return{width:r.width,blankRatio:Math.max(0,r.bottom-end)/r.height};});assert.equal(desktop.width,230);assert.ok(desktop.blankRatio<=.4);console.log('PASS 1280 px 桌機側欄 230 px、案件摘要正確、底部空白不超過 40%');
 await fs.mkdir('output/mobile-layout',{recursive:true});await fs.writeFile('output/mobile-layout/results.json',JSON.stringify({mobile:metrics,desktop},null,2));
}finally{await context.close();await browser.close();await new Promise(r=>server.close(r));}
