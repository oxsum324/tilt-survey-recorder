import {VERSION} from '../model.js';
import {fieldControl} from './controls.mjs';
import {poll,reportReady} from './poll.mjs';
import {chromium} from 'playwright';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {startServer} from '../serve.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),output=path.join(root,'output','playwright');await fs.mkdir(output,{recursive:true});
const server=process.env.TILT_URL?null:await startServer(),base=process.env.TILT_URL||`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.platform==='win32'?'chrome':undefined,headless:true});
const context=await browser.newContext({viewport:{width:1280,height:1000},acceptDownloads:true});const page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
const pass=name=>{checks.push(name);process.stdout.write(`PASS ${name}\n`);};
const field=path=>fieldControl(page,path);
const action=name=>page.locator(`[data-action="${name}"]`).first().click();
const tab=name=>page.locator(`[data-tab="${name}"]`).click();
const confirmDialog=text=>page.locator('#actionDialog').getByRole('button',{name:text,exact:true}).click();
async function enter(values){for(const [key,value]of Object.entries(values))await field(key).fill(value);}
async function preview(){await tab('reports');await reportReady(page);await page.locator('.result-sheet').first().waitFor();}
try {
  await page.goto(base+`/?release=${VERSION}`);await field('header.orgName').waitFor();
  await enter({'header.orgName':'合成測量示例','header.caseNumber':'合成示例 A','header.householdNo':'01','header.address':'非真實地址（測試）','header.surveyDate':'115年09月30日','header.surveyor':'合成示例','header.instrument':'示例儀器'});
  await tab('readings');await enter({'pairs.0.inPlane.A.hCm':'486.5','pairs.0.inPlane.A.rounds.0.dxCm':'2.3','pairs.0.outPlane.A.rounds.0.dxCm':'2.9','pairs.0.tbHeightCm':'395'});
  await poll(page,async()=>assert.match(await page.locator('#liveResults').innerText(),/1／212/));await poll(page,async()=>assert.match(await page.locator('#liveResults').innerText(),/1／168/));await action('confirm');await preview();await poll(page,async()=>assert.equal(await page.locator('.result-sheet').count(),1));await poll(page,async()=>assert.match(await page.locator('#reportRoot').innerText(),/1／212/));pass('建案 → 模式 A → 確認 → 範本數值預覽');
  await tab('readings');await field('pairs.0.inPlane.A.rounds.0.dxCm').fill('2.4');await tab('reports');await poll(page,async()=>assert.equal(await page.locator('.result-sheet').count(),0));await poll(page,async()=>assert.match(await page.locator('#reportWarnings').innerText(),/尚未確認/));await tab('readings');await action('confirm');await confirmDialog('保存更正');await poll(page,async()=>assert.match(await page.locator('#notice').innerText(),/原因/));await action('confirm');await page.locator('#dialogReason').fill('重新檢查尺讀數（合成測試）');await confirmDialog('保存更正');await preview();await poll(page,async()=>assert.match(await page.locator('#reportRoot').innerText(),/重新檢查/));pass('已確認讀數更正必填原因，預覽保留原值與新值');
  await tab('case');await action('sample');await confirmDialog('直接取代');await preview();const report=page.locator('.result-sheet').first();for(const n of [212,168,188,179])await poll(page,async()=>assert.match(await report.innerText(),new RegExp(`1／${n}`)));await report.screenshot({path:path.join(output,'result-preview.png')});
  await page.emulateMedia({media:'print'});await poll(page,async()=>assert.equal(await page.locator('.sidebar').isVisible(),false));await page.pdf({path:path.join(output,'print-preview.pdf'),preferCSSPageSize:true,printBackground:true});await report.screenshot({path:path.join(output,'print-preview.png')});await page.emulateMedia({media:'screen'});pass('成果表與列印版：四個範本分母一致、向量 SVG');
  const svgProblems=await page.locator('.result-sheet svg').evaluateAll(svgs=>svgs.flatMap((svg,k)=>{
    const boxes=Array.from(svg.querySelectorAll('text')).map(el=>{const box=el.getBBox(),matrix=svg.getCTM().inverse().multiply(el.getCTM());const corners=[[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y);return {text:el.textContent,x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};});
    const issues=[];for(const b of boxes)if(b.x<-.05||b.y<-.05||b.x+b.w>93.05||b.y+b.h>87.05)issues.push({svg:k,bounds:b});
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>.05&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>.05)issues.push({svg:k,overlap:[a.text,b.text]});}
    return issues;
  }));await poll(page,async()=>assert.deepEqual(svgProblems,[]));pass('瀏覽器實際字型的 SVG 文字不重疊、不出框');
  for(const width of [320,390,768,1280]){
    await page.setViewportSize({width,height:900});for(const name of ['case','facades','readings','reports']){await tab(name);if(name==='reports')await reportReady(page);await poll(page,async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px ${name} 水平捲動`));}
    await tab('readings');await page.screenshot({path:path.join(output,`mobile-${width}.png`),fullPage:true});
  }pass('320／390／768／1280 px 四個分區均無水平捲動');await page.setViewportSize({width:1280,height:1000});
  await tab('readings');await action('add-pair');await field('pairs.2.mode').selectOption('B');
  await enter({'pairs.2.inPlane.B.rounds.0.tp.HD':'8.100','pairs.2.inPlane.B.rounds.0.tb.HD':'8.123','pairs.2.inPlane.B.rounds.0.tp.VD':'6.215','pairs.2.inPlane.B.rounds.0.tb.VD':'1.350','pairs.2.outPlane.B.rounds.0.tp.HD':'12.374','pairs.2.outPlane.B.rounds.0.tb.HD':'12.345','pairs.2.outPlane.B.rounds.0.tp.VD':'6.215','pairs.2.outPlane.B.rounds.0.tb.VD':'1.350'});await action('confirm');await poll(page,async()=>assert.match(await page.locator('#liveResults').innerText(),/1／212/));await poll(page,async()=>assert.match(await page.locator('#liveResults').innerText(),/向後傾/));pass('模式 B 正前／右側測站計算、即時結果');
  await tab('facades');await field('facades.0.baseline.method').selectOption('azimuth');await field('facades.0.baseline.azimuthDeg').fill('90');await tab('readings');await action('add-pair');await field('pairs.3.mode').selectOption('C');
  await enter({'pairs.3.C.rounds.0.tb.N':'100.000','pairs.3.C.rounds.0.tb.E':'200.000','pairs.3.C.rounds.0.tb.Z':'10.000','pairs.3.C.rounds.0.tp.N':'100.029','pairs.3.C.rounds.0.tp.E':'200.023','pairs.3.C.rounds.0.tp.Z':'14.865'});
  await action('confirm');await preview();await poll(page,async()=>assert.equal(await page.locator('.result-sheet').count(),2));await poll(page,async()=>assert.match(await page.locator('.raw-sheet').last().innerText(),/1／131/));await poll(page,async()=>assert.doesNotMatch(await page.locator('.result-sheet').last().innerText(),/1／131/));pass('模式 C 共用座標得兩向，合成值僅在原始表，4 組分 2 頁');
  await tab('readings');await field('pairs.3.mode').selectOption('A');await confirmDialog('切換並保留原讀數');await field('pairs.3.mode').selectOption('C');await confirmDialog('切換並保留原讀數');await poll(page,async()=>assert.equal(await field('pairs.3.C.rounds.0.tp.E').inputValue(),'200.023'));pass('切換模式保留既有座標');
  const downloadPromise=page.waitForEvent('download');await action('export');const download=await downloadPromise;const backup=path.join(output,'synthetic-case.tiltsurvey');await download.saveAs(backup);const exported=JSON.parse(await fs.readFile(backup,'utf8'));await poll(page,async()=>assert.equal(exported.format,'tilt-survey-case.v1'));await poll(page,async()=>assert.equal(exported.project.pairs[3].C.rounds[0].tp.N,'100.029'));await poll(page,async()=>assert.match(await page.locator('#saveStatus').innerText(),/已匯出/));
  await page.locator('#importFile').setInputFiles(backup);await confirmDialog('直接取代');await preview();await poll(page,async()=>assert.equal(await page.locator('.result-sheet').count(),2));pass('完整案件檔下載／再匯入，原始字串與成果一致');
  await page.reload();await page.locator('[data-tab="readings"]').waitFor();await tab('readings');await poll(page,async()=>assert.equal(await page.locator('.pair-list button[data-pair]').count(),4));pass('IndexedDB 本機保存，重新整理後 4 組資料仍存在');
  await page.evaluate(async()=>{await navigator.serviceWorker.ready; if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
  await context.setOffline(true);await page.goto(base+`/?release=${VERSION}&offline-test=1`);await tab('readings');await poll(page,async()=>assert.equal(await page.locator('.pair-list button[data-pair]').count(),4));await preview();await poll(page,async()=>assert.equal(await page.locator('.result-sheet').count(),2));await context.setOffline(false);pass('離線以含 query 的網址重開，案件與成果仍可讀取');
  await poll(page,async()=>assert.deepEqual(errors,[]));pass('全流程無瀏覽器執行錯誤');
  await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify({base,checks,errors,total:checks.length,passed:checks.length},null,2));
}finally{await context.close();await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
