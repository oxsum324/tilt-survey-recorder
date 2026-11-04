// V0.6.0：立面示意模式、依樓層數填入、示意位置點選，以及底圖立面朝向與傾斜方向箭頭。
import {poll,reportReady} from './poll.mjs';
import {fieldControl} from './controls.mjs';
import {chromium} from 'playwright';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {startServer} from '../serve.mjs';import {VERSION} from '../model.js';
const root=fileURLToPath(new URL('../',import.meta.url)),out=path.join(root,'output','elevation-plan');await fs.mkdir(out,{recursive:true});
const server=process.env.TILT_URL?null:await startServer(),base=process.env.TILT_URL||`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.platform==='win32'?'chrome':undefined,headless:true}),context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
const pass=name=>{checks.push(name);process.stdout.write(`PASS ${name}\n`);};
const tab=name=>page.locator(`[data-tab="${name}"]`).click(),action=name=>page.locator(`[data-action="${name}"]`).first().click(),media=(name,value)=>page.locator(`[data-media-action="${name}"]${value===undefined?'':`[data-value="${value}"]`}`).first().click(),dialog=name=>page.locator('#actionDialog').getByRole('button',{name,exact:true}).click(),field=path=>fieldControl(page,path);
async function stored(){return page.evaluate(async()=>{const {loadProject}=await import('./store.js');return loadProject();});}
async function saved(){await page.waitForFunction(()=>document.documentElement.dataset.saveState==='saved');return stored();}
async function clickRel(selector,fx,fy){const target=page.locator(selector).first();await target.scrollIntoViewIfNeeded();const box=await target.boundingBox();await page.mouse.click(box.x+box.width*fx,box.y+box.height*fy);}
try{
  await page.goto(base+`/?release=${VERSION}`);await page.locator('[data-field="header.caseNumber"]').waitFor();
  await poll(page,async()=>assert.match(await page.locator('h1').innerText(),new RegExp(VERSION.replaceAll('.','\\.'))));
  await action('sample');await dialog('直接取代');
  // 1. 立面參數：依樓層數填入與示意模式
  await tab('facades');await page.locator('#quickFloorCount').fill('5');await page.locator('#quickFloorHeight').fill('300');await action('fill-floors');
  let p;await poll(page,async()=>{p=await saved();assert.deepEqual(p.facades[0].building.floorHeightsCm,['360','300','300','300','300']);});
  await poll(page,async()=>assert.equal(await page.locator('.floor-grid input').count(),5));
  await field('facades.0.building.sketchMode').selectOption('schematic');
  await poll(page,async()=>{p=await saved();assert.equal(p.facades[0].building.sketchMode,'schematic');});
  await poll(page,async()=>assert.equal(await page.locator('.floor-grid').count(),0));
  await page.locator('#quickFloorCount').fill('0');await action('fill-floors');await poll(page,async()=>assert.match(await page.locator('#notice').innerText(),/樓層數須為/));
  await poll(page,async()=>assert.equal((await stored()).facades[0].building.floorHeightsCm.length,5));
  pass('依樓層數填入保留 1F、示意模式隱藏逐層樓高、無效層數被拒絕');
  // 2. 測點與讀數：示意位置點選
  await tab('readings');await page.locator('#sketchStage svg').waitFor();
  await poll(page,async()=>assert.match(await page.locator('[data-record-axis="inPlane"]').innerText(),/已確認/));
  await clickRel('#sketchStage [data-sketch-area]',.5,.75);
  await poll(page,async()=>{p=await saved();const m=p.pairs[0].sketchMarks;assert.ok(m&&Math.abs(m.tb-.25)<.06,JSON.stringify(m));});
  await poll(page,async()=>assert.equal(await page.locator('[data-sketch="tp"]').getAttribute('aria-pressed'),'true'));
  await clickRel('#sketchStage [data-sketch-area]',.5,.2);
  await poll(page,async()=>{p=await saved();const m=p.pairs[0].sketchMarks;assert.ok(Math.abs(m.tp-.8)<.06,JSON.stringify(m));assert.ok(m.tp>m.tb);});
  await poll(page,async()=>assert.match(await page.locator('[data-record-axis="inPlane"]').innerText(),/已確認/));
  await page.locator('#sketchStage').screenshot({path:path.join(out,'sketch-editor.png')});
  await page.locator('[data-sketch="tb"]').click();await clickRel('#sketchStage [data-sketch-area]',.5,.05);
  await poll(page,async()=>{p=await saved();const m=p.pairs[0].sketchMarks;assert.ok(m.tp>m.tb&&m.tb<=m.tp-.02,JSON.stringify(m));});
  await page.locator('[data-sketch="clear"]').click();await poll(page,async()=>{p=await saved();assert.equal(p.pairs[0].sketchMarks,null);});
  await clickRel('#sketchStage [data-sketch-area]',.5,.7);await poll(page,async()=>{p=await saved();assert.ok(p.pairs[0].sketchMarks);});
  pass('示意位置點選 TB 後自動切 TP、TP 不低於 TB、清除與重點均保存，確認狀態不變');
  // 3. 成果表示意圖
  await action('preview');await reportReady(page);
  await poll(page,async()=>assert.ok((await page.locator('.result-sheet').first().innerText()).includes('示意模式：樓層等高繪製，不依比例')));
  await poll(page,async()=>assert.equal(await page.locator('.result-sheet [data-sketch-handle]').count(),0));
  await page.locator('.result-sheet .report-cell').first().screenshot({path:path.join(out,'result-cell-schematic.png')});
  pass('成果表示意圖標示不依比例且不含編輯把手');
  // 4. 平面圖：底圖、測點與立面朝向
  const mapImage=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=450;const x=c.getContext('2d');x.fillStyle='#f1f2eb';x.fillRect(0,0,600,450);x.fillStyle='#c5d6cf';x.fillRect(240,150,180,140);return c.toDataURL('image/png').split(',')[1];});
  const mapPath=path.join(out,'synthetic-map.png');await fs.writeFile(mapPath,Buffer.from(mapImage,'base64'));
  await tab('map');await page.locator('#mapImport').setInputFiles(mapPath);await page.locator('#planStage svg').waitFor();
  await page.locator('[data-field="map.source"]').fill('合成配置圖（非真實案件）');await page.locator('[data-field="map.capturedOn"]').fill('2026-11-04');
  await poll(page,async()=>assert.equal(await page.locator('[data-media-action="map-facing"][data-value="north"]').isDisabled(),true));
  await clickRel('#planStage svg',.5,.5);await poll(page,async()=>{p=await saved();assert.ok(p.pairs[0].mapMarker);});
  await poll(page,async()=>assert.equal(await page.locator('#planStage [data-glyph="facing"]').count(),0));
  await media('map-facing','90');await poll(page,async()=>{p=await saved();assert.equal(p.facades[0].planNormalDeg,90);});
  await poll(page,async()=>assert.equal(await page.locator('#planStage [data-glyph="facing"][data-degrees="90"]').count(),1));
  await poll(page,async()=>assert.equal(await page.locator('#planStage [data-tilt="inPlane"][data-direction="right"]').count(),1));
  await poll(page,async()=>assert.equal(await page.locator('#planStage [data-tilt="outPlane"][data-direction="back"]').count(),1));
  await poll(page,async()=>assert.equal(await page.locator('[data-media-action="map-facing"][data-value="90"]').getAttribute('aria-pressed'),'true'));
  await media('map-facing','flip');await poll(page,async()=>assert.equal((await saved()).facades[0].planNormalDeg,270));
  await media('map-facing','ccw');await poll(page,async()=>assert.equal((await saved()).facades[0].planNormalDeg,255));
  await media('map-facing','cw');await media('map-facing','cw');await poll(page,async()=>assert.equal((await saved()).facades[0].planNormalDeg,285));
  await poll(page,async()=>assert.equal(await page.locator('#planStage [data-glyph="facing"][data-degrees="285"]').count(),1));
  await media('map-facing','clear');await poll(page,async()=>assert.equal((await saved()).facades[0].planNormalDeg,null));
  await poll(page,async()=>assert.equal(await page.locator('#planStage [data-glyph="facing"], #planStage [data-tilt]').count(),0));
  await media('map-facing','0');await poll(page,async()=>assert.equal((await saved()).facades[0].planNormalDeg,0));
  await poll(page,async()=>assert.match(await page.locator('[data-record-axis="inPlane"], #facingText').first().innerText(),/0°/));
  await page.locator('#planStage').screenshot({path:path.join(out,'plan-facing.png')});
  pass('底圖立面朝向：8 向、反向、15° 微調與清除即時重繪並保存，傾斜箭頭只在設定朝向後出現');
  // 5. 佈設圖輸出
  await tab('reports');await page.locator('#reportKind').selectOption('map');await reportReady(page);await page.locator('.map-sheet').first().waitFor();
  await poll(page,async()=>assert.equal(await page.locator('.map-sheet [data-glyph="facing"]').count(),1));
  await poll(page,async()=>assert.ok((await page.locator('.map-sheet .media-footer').innerText()).includes('視向')));
  await page.locator('.map-sheet').screenshot({path:path.join(out,'map-sheet.png')});
  pass('佈設圖輸出含視向符號、傾斜箭頭與圖例');
  // 6. 確認狀態與成果不受圖面設定影響
  await tab('readings');await poll(page,async()=>assert.match(await page.locator('[data-record-axis="inPlane"]').innerText(),/已確認/));
  await poll(page,async()=>assert.deepEqual(errors,[]));pass('立面示意與平面朝向全流程無瀏覽器執行錯誤');
  await fs.writeFile(path.join(out,'browser-results.json'),JSON.stringify({base,checks,errors,passed:checks.length},null,2));
}finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
