import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startServer} from '../serve.mjs';
import {poll,reportReady} from './poll.mjs';
import {revealControl,fieldControl} from './controls.mjs';
const server=await startServer(),browser=await chromium.launch({channel:process.platform==='win32'?'chrome':undefined,headless:true});
const context=await browser.newContext({viewport:{width:375,height:812},acceptDownloads:true}),page=await context.newPage();
const metrics={dataCardSelector:'#workspace > section.card',mobile:[],sunlight:[]},tabs=['case','facades','readings','photos','map','reports'];
const field=path=>fieldControl(page,path),tab=async name=>{await page.locator(`[data-tab="${name}"]`).click();if(name==='reports')await reportReady(page);await page.evaluate(()=>scrollTo(0,0));};
const seed=async(old=false)=>{await page.evaluate(async old=>{const {sampleProject}=await import('./model.js'),{replaceProject}=await import('./store.js'),p=sampleProject();if(old){p.updatedAt='2000-01-01T00:00:00.000Z';p.lastExportedAt=p.updatedAt;}await replaceProject(p);},old);await page.reload();await page.locator('[data-field="header.caseNumber"]').waitFor();};
const sunlight=async()=>{await page.locator('#statusToggle').click();await page.locator('#sunlightButton').click();await page.locator('#statusToggle').click();};
const dataCard=()=>page.locator(metrics.dataCardSelector).first();
const pairOffset=()=>page.evaluate(()=>document.querySelector('[data-field="pairs.0.inPlane.A.rounds.0.dxCm"]').getBoundingClientRect().top-document.querySelector('[data-pair-card]').getBoundingClientRect().top);
const snapshot=()=>page.evaluate(async()=>{const {loadProject}=await import('./store.js'),{calculatePair}=await import('./calc.js'),p=await loadProject();return {project:p,results:p.pairs.map(q=>calculatePair(q,p.facades.find(f=>f.id===q.facadeId),p.settings))};});
const desktopGeometry=()=>page.locator('.sidebar').evaluate(e=>{const r=e.getBoundingClientRect(),end=Math.max(...[...e.children].filter(c=>getComputedStyle(c).display!=='none').map(c=>c.getBoundingClientRect().bottom));return {width:r.width,blankRatio:Math.max(0,r.bottom-end)/r.height};});
await context.addInitScript(()=>{window.shareOutcome='cancel';Object.defineProperty(navigator,'canShare',{value:()=>true});Object.defineProperty(navigator,'share',{value:async()=>{if(window.shareOutcome==='cancel')throw new DOMException('cancel','AbortError');}});});
try{
 await fs.mkdir('output/mobile-layout',{recursive:true});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('[data-field="header.caseNumber"]').waitFor();await seed();
 for(const name of tabs){
  await tab(name);
  await poll(page,async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),375));
  await poll(page,async()=>assert.ok(await dataCard().evaluate(e=>e.getBoundingClientRect().top<=150),`${name} first data card`));
  await poll(page,async()=>assert.equal(await page.locator('.sidebar nav').evaluate(nav=>{const a=nav.querySelector('.active').getBoundingClientRect(),r=nav.getBoundingClientRect();return a.left>=r.left&&a.right<=r.right&&a.height>=44;}),true));
  metrics.mobile.push({tab:name,firstCardTop:await dataCard().evaluate(e=>e.getBoundingClientRect().top)});
  if(['case','reports'].includes(name))for(const action of ['export','import','verify-file'])await poll(page,async()=>assert.equal(await page.locator(`.mobile-case-actions [data-action="${action}"]`).isVisible(),true));
 }
 console.log('PASS 375 px 六頁第一張資料輸入卡均不超過 150 px、整頁等寬、導覽與備份操作保留');
 await poll(page,async()=>assert.deepEqual(await page.evaluate(()=>Object.fromEntries(['ink','muted','accent','paper','line','bg'].map(k=>[k,getComputedStyle(document.documentElement).getPropertyValue('--'+k).trim()]))),{ink:'#17343b',muted:'#5d7275',accent:'#176268',paper:'#fff',line:'#d4e0dd',bg:'#f3f6f5'}));
 await sunlight();
 for(const name of tabs){
  await tab(name);
  await poll(page,async()=>assert.ok(await dataCard().evaluate(e=>e.getBoundingClientRect().top<=150),`sunlight ${name}`));
  await poll(page,async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),375));
  await poll(page,async()=>assert.equal(await page.locator('.sidebar nav button').evaluateAll(buttons=>buttons.length===6&&buttons.every(b=>b.getBoundingClientRect().height>=48)),true));
  await poll(page,async()=>assert.equal(await page.locator('.sidebar nav .active').evaluate(button=>[...button.querySelectorAll('span')].filter(e=>e.getClientRects().length).every(e=>getComputedStyle(e).color==='rgb(255, 255, 255)')),true));
  metrics.sunlight.push({tab:name,firstCardTop:await dataCard().evaluate(e=>e.getBoundingClientRect().top),navHeights:await page.locator('.sidebar nav button').evaluateAll(bs=>bs.map(b=>b.getBoundingClientRect().height))});
 }
 await page.setViewportSize({width:1280,height:900});await poll(page,async()=>assert.equal(await page.locator('.sidebar nav .active .nav-full').evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)'));
 await page.setViewportSize({width:375,height:812});await sunlight();
 console.log('PASS 色票對齊，強光六頁資料卡、等寬、六顆 48 px 導覽及手機／桌機文字對比通過');
 await poll(page,async()=>assert.equal(await page.locator('.section-heading h2').evaluate(e=>getComputedStyle(e).fontSize),'20px'));
 await poll(page,async()=>assert.equal(await page.locator('.brand p').innerText(),'弘一工程 · 鑑定現場工具'));
 console.log('PASS 手機標題為 20 px，品牌副標與指定文案一致');
 await tab('readings');const summary=page.locator('#resultSummaryButton');
 await poll(page,async()=>assert.ok(await summary.evaluate(e=>e.getBoundingClientRect().height<=56)));
 await poll(page,async()=>assert.match(await summary.innerText(),/T1 1／212[\s\S]*T1′ 1／168/));
 await summary.click();await poll(page,async()=>assert.equal(await page.locator('#liveResultPanels').isVisible(),true));await summary.click();await poll(page,async()=>assert.equal(await page.locator('#liveResultPanels').isVisible(),false));
 const rounds=page.locator('[data-rounds="0|inPlane|A"]');await revealControl(rounds);await rounds.evaluate(e=>e.scrollIntoView({block:'center'}));
 await poll(page,async()=>assert.equal(await rounds.evaluate(e=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;}),true));
 await page.screenshot({path:'output/mobile-layout/round-fields-375.png',fullPage:false});
 await poll(page,async()=>assert.ok(await page.locator('#main').evaluate(e=>parseFloat(getComputedStyle(e).paddingBottom)>=56)));
 metrics.results={height:await summary.evaluate(e=>e.getBoundingClientRect().height),selectCenterUncovered:true,paddingBottom:await page.locator('#main').evaluate(e=>getComputedStyle(e).paddingBottom)};
 console.log('PASS 375 px 底部摘要不超過 56 px、完整結果可收放、測回數中心未遮擋');
 await page.locator('#statusToggle').click();for(const id of ['saveStatus','offlineStatus','sunlightButton','wakeButton'])await poll(page,async()=>assert.equal(await page.locator('#'+id).isVisible(),true));await page.locator('#statusToggle').click();await poll(page,async()=>assert.equal(await page.locator('#statusPanel').getAttribute('open'),null));
 console.log('PASS 狀態面板保留四個原控制項，可展開收回');
 await page.setViewportSize({width:1280,height:900});await tab('case');
 await poll(page,async()=>assert.equal(await page.locator('#caseSummary').isVisible(),true));await poll(page,async()=>assert.match(await page.locator('#caseSummary').innerText(),/合成示例[\s\S]*2 組[\s\S]*4／4/));
 await poll(page,async()=>assert.equal((await desktopGeometry()).width,230));await poll(page,async()=>assert.ok((await desktopGeometry()).blankRatio<=.4));metrics.desktop=await desktopGeometry();
 console.log('PASS 1280 px 桌機側欄 230 px、案件摘要正確、底部空白不超過 40%');
 await tab('readings');await poll(page,async()=>assert.ok(await page.locator('#liveResults').evaluate(e=>parseFloat(getComputedStyle(e).top)>document.querySelector('.app-header').getBoundingClientRect().height)));
 console.log('PASS 桌機即時結果維持 sticky，偏移量在表頭高度以下');
 await page.setViewportSize({width:375,height:812});
 await page.evaluate(async()=>{localStorage.removeItem('tilt-survey-disclosures');const {sampleProject,createPair,confirmObservation}=await import('./model.js'),{replaceProject}=await import('./store.js'),p=sampleProject(),q=createPair(3,p.facades[0].id);q.inPlane.A.hCm=q.outPlane.A.hCm='441.0';q.inPlane.A.rounds[0].dxCm=q.outPlane.A.rounds[0].dxCm='2.0';p.pairs.push(q);confirmObservation(p,q,p.facades[0]);await replaceProject(p);});
 await page.reload();await tab('readings');const before=await snapshot();
 await poll(page,async()=>assert.ok(await pairOffset()<=420,`group to first number ${await pairOffset()}`));metrics.pairToFirstNumber=await pairOffset();
 for(const [index,axis,expected]of [[0,'inPlane',212],[0,'outPlane',168],[1,'inPlane',188],[1,'outPlane',179],[2,'inPlane',221]])await poll(page,async()=>assert.equal((await snapshot()).results[index][axis].denominator,expected));
 const direction=page.locator('[data-reading-axis="inPlane"] .form-disclosure');await poll(page,async()=>assert.equal(await direction.getAttribute('open'),null));await direction.locator('summary').click();
 await poll(page,async()=>assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem('tilt-survey-disclosures'))[key],`direction:${before.project.pairs[0].id}:inPlane`),true));
 await poll(page,async()=>assert.notEqual(await page.locator('[data-pair-card] .form-disclosure').getAttribute('open'),null));await poll(page,async()=>assert.match(await page.locator('[data-pair-card] summary').innerText(),/TB 395 cm/));
 await page.reload();await tab('readings');await poll(page,async()=>assert.notEqual(await direction.getAttribute('open'),null));await poll(page,async()=>assert.deepEqual(await snapshot(),before));await direction.locator('summary').click();await page.reload();await tab('readings');await poll(page,async()=>assert.equal(await direction.getAttribute('open'),null));await poll(page,async()=>assert.deepEqual(await snapshot(),before));
 console.log('PASS 375 px 首數字欄位不超過 420 px，摺疊偏好重開保留且規格 #1～#4 與模型完全不變');
 const first=page.locator('[data-field="pairs.0.inPlane.A.rounds.0.dxCm"]'),last=page.locator('[data-field="pairs.0.outPlane.A.rounds.0.dxCm"]');
 await poll(page,async()=>assert.equal(await first.getAttribute('enterkeyhint'),'next'));await first.press('Enter');await poll(page,async()=>assert.equal(await last.evaluate(e=>document.activeElement===e),true));await poll(page,async()=>assert.equal(await last.getAttribute('enterkeyhint'),'done'));await last.press('Enter');await poll(page,async()=>assert.equal(await last.evaluate(e=>document.activeElement===e),false));
 console.log('PASS 讀數鍵盤 next 僅移到可見欄位，最後欄位 done 可收鍵盤');
 await revealControl(rounds);await rounds.selectOption('2');await poll(page,async()=>assert.notEqual(await direction.getAttribute('open'),null));await field('pairs.0.inPlane.status').selectOption('skipped');await poll(page,async()=>assert.notEqual(await direction.getAttribute('open'),null));await poll(page,async()=>assert.match(await direction.locator('summary').innerText(),/未施測[\s\S]*2 測回/));
 console.log('PASS 兩測回與未施測自動展開，摘要顯示實際狀態');

 await seed();await tab('readings');metrics.customOffsets={};
 await field('pairs.0.corner').selectOption('custom');await field('pairs.0.cornerOffsetCm').fill('125');await field('pairs.0.note').fill('角位置已現場確認');await page.waitForFunction(()=>document.documentElement.dataset.saveState==='saved');const custom=await snapshot();
 for(const bright of [false,true]){
  if(bright)await sunlight();await page.evaluate(()=>scrollTo(0,0));
  await poll(page,async()=>assert.notEqual(await page.locator('[data-pair-card] details').getAttribute('open'),null));
  await poll(page,async()=>assert.equal(await field('pairs.0.cornerOffsetCm').inputValue(),'125'));await poll(page,async()=>assert.equal(await field('pairs.0.note').inputValue(),'角位置已現場確認'));
  await poll(page,async()=>assert.ok(await pairOffset()<=420,`custom corner ${bright?'sunlight':'normal'} offset ${await pairOffset()}`));
  await poll(page,async()=>assert.deepEqual(await snapshot(),custom));metrics.customOffsets[bright?'sunlight':'normal']=await pairOffset();
  await page.screenshot({path:`output/mobile-layout/custom-${bright?'sunlight':'normal'}-375.png`,fullPage:true});
 }
 await sunlight();console.log('PASS 自訂角偏距、TB 與備註全部保留且展開，一般／強光距首個讀數均不超過 420 px');
 for(const [name,path]of [['case','header.caseNumber'],['readings','pairs.0.inPlane.A.rounds.0.dxCm'],['readings','pairs.0.note']]){
  await tab(name);await field(path).focus();
  for(const options of [{isComposing:true},{keyCode:229},{}]){
   if(!options.isComposing&&!options.keyCode&&path.endsWith('dxCm'))continue;
   const result=await field(path).evaluate((el,options)=>{const event=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true,...options});el.dispatchEvent(event);return {prevented:event.defaultPrevented,sameFocus:document.activeElement===el};},options);
   await poll(page,async()=>assert.deepEqual(result,{prevented:false,sameFocus:true}));
  }
 }
 console.log('PASS 中文組字 Enter／229 不攔截不換欄，案件與備註文字欄不套用讀數換欄');

 await seed(true);await tab('case');await poll(page,async()=>assert.equal(await page.locator('#lastExportActionTime').getAttribute('datetime'),null));await poll(page,async()=>assert.match(await page.locator('#lastExportActionTime').textContent(),/未記錄/));
 const started=Date.now(),downloaded=page.waitForEvent('download');await page.locator('.mobile-case-actions [data-action="export"]').click();const download=await downloaded,backup=JSON.parse(await fs.readFile(await download.path(),'utf8'));await page.waitForFunction(()=>document.documentElement.dataset.saveState==='saved');
 const exportTime=await page.locator('#lastExportActionTime').getAttribute('datetime'),ended=Date.now();
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'output/mobile-layout/export-time-1280.png',fullPage:true});await page.setViewportSize({width:375,height:812});
 await poll(page,async()=>assert.ok(Date.parse(exportTime)>=started&&Date.parse(exportTime)<=ended));await poll(page,async()=>assert.equal(backup.project.updatedAt,'2000-01-01T00:00:00.000Z'));await poll(page,async()=>assert.equal(backup.project.lastExportedAt,backup.project.updatedAt));await poll(page,async()=>assert.deepEqual(Object.keys(backup.project),Object.keys((await snapshot()).project)));
 await poll(page,async()=>assert.equal(JSON.stringify(backup).includes('tilt-survey-exported-at'),false));await page.reload();await page.locator('[data-field="header.caseNumber"]').waitFor();await poll(page,async()=>assert.equal(await page.locator('#lastExportActionTime').getAttribute('datetime'),exportTime));
 await page.locator('#shareCaseButton').click();await page.getByRole('button',{name:'分享已準備的案件檔',exact:true}).waitFor();await page.locator('#shareCaseButton').click();await poll(page,async()=>assert.match(await page.locator('#notice').textContent(),/已取消分享/));await poll(page,async()=>assert.equal(await page.locator('#lastExportActionTime').getAttribute('datetime'),exportTime));
 await page.evaluate(()=>window.shareOutcome='success');const shareStarted=Date.now();await page.locator('#shareCaseButton').click();await poll(page,async()=>assert.match(await page.locator('#notice').textContent(),/已交由系統分享/));await poll(page,async()=>assert.ok(Date.parse(await page.locator('#lastExportActionTime').getAttribute('datetime'))>=shareStarted));
 metrics.exportAction={started,ended,exportedAt:exportTime,dataVersion:backup.project.updatedAt,localOnly:true,cancelPreservesTime:true,shareRecordsTime:true};
 const other=await page.evaluate(async()=>{const {sampleProject}=await import('./model.js'),p=sampleProject();p.updatedAt=p.lastExportedAt='2000-01-01T00:00:00.000Z';return {format:'tilt-survey-case.v1',project:p,media:[]};});
 await page.locator('#importFile').setInputFiles({name:'different-case.tiltsurvey',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(other))});await page.locator('#actionDialog').getByRole('button',{name:'直接取代',exact:true}).click();await poll(page,async()=>assert.equal(await page.locator('#lastExportActionTime').getAttribute('datetime'),null));
 console.log('PASS 舊資料匯出顯示實際本機時間、重開保留、不進案件檔；取消分享與其他案件不借用時間');
 for(const name of ['facades','readings','photos','map']){
  await tab(name);const picker=page.locator('.page-selector');await picker.locator('summary').click();const choices=page.locator(name==='facades'?'[data-facade]':'[data-pair]');await poll(page,async()=>assert.equal(await choices.first().isVisible(),true));
  await page.locator('#statusToggle').click();await poll(page,async()=>assert.equal(await page.locator('#sunlightButton').evaluate(e=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;}),true));await page.locator('#statusToggle').click();
  await choices.nth(name==='facades'?0:1).click();await poll(page,async()=>assert.equal(await picker.getAttribute('open'),null));
  if(name!=='facades')await poll(page,async()=>assert.match(await picker.locator('summary').textContent(),/測點組 2/));
 }
 await page.setViewportSize({width:1280,height:900});await poll(page,async()=>assert.equal(await page.locator('.page-selector').count(),0));await poll(page,async()=>assert.equal(await page.locator('.pair-list').isVisible(),true));await poll(page,async()=>assert.equal(await page.locator('.pair-list').evaluate(e=>e.parentElement.id),'workspace'));
 console.log('PASS 四頁標題選單保留切換操作，桌機還原原選擇列表，量測不納入選擇卡');
 await fs.writeFile('output/mobile-layout/results.json',JSON.stringify(metrics,null,2));
}finally{await context.close();await browser.close();await new Promise(r=>server.close(r));}
