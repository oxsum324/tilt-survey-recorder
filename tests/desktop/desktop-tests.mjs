import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {assertVisible} from './visibility.mjs';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {monitorContext,assertClean,assertOfflineRecovery} from './diagnostics.mjs';
const execute=promisify(execFile),root=path.dirname(fileURLToPath(import.meta.url));
const expected=JSON.parse(await fs.readFile(path.join(root,'expected.json'),'utf8'));
const normal=text=>text.replace(/\s/g,'');
const repo=process.cwd(),out=process.env.TILT_DESKTOP_EVIDENCE_DIR;assert.ok(out,'Set a fresh evidence directory');await fs.mkdir(out,{recursive:true});assert.deepEqual(await fs.readdir(out),[],'Never overwrite a prior test run');
const {chromium}=await import(pathToFileURL(path.join(repo,'node_modules/playwright/index.mjs')).href);
const {poll,reportReady}=await import(pathToFileURL(path.join(repo,'tests/poll.mjs')).href);
const {revealControl}=await import(pathToFileURL(path.join(repo,'tests/controls.mjs')).href);
const url=process.env.TILT_TEST_URL,head=process.env.TILT_TEST_HEAD,all=[];assert.ok(url&&head,'Use the local staged-site runner');
const manifestUrl=new URL('deploy-manifest.json?desktop-test='+Date.now(),url),manifestResponse=await fetch(manifestUrl,{cache:'no-store'});assert.equal(manifestResponse.status,200);const manifest=await manifestResponse.json();assert.equal(manifest.commit,head);assert.equal(manifest.version,'0.4.2');await fs.writeFile(path.join(out,'deploy-manifest.json'),JSON.stringify({url:manifestUrl.href,status:manifestResponse.status,manifest},null,2));
for(const channel of ['chrome','msedge']){
 const browser=await chromium.launch({channel,headless:true});
 try{for(const viewport of [{width:1280,height:720},{width:1600,height:900}])for(const bright of [false,true]){
  const name=`${channel}-${viewport.width}-${bright?'sunlight':'normal'}`,dir=path.join(out,name);await fs.mkdir(dir,{recursive:true});
  const context=await browser.newContext({viewport,acceptDownloads:true});let phase='online';const diagnostics=monitorContext(context,()=>phase),page=await context.newPage(),errors=diagnostics.pageErrors,requests=diagnostics.requestFailures;
  const result={name,channel,browserVersion:browser.version(),viewport,bright,head,url,startedUtc:new Date().toISOString(),checks:[],errors,requests,diagnostics};
  const field=p=>page.locator(`[data-field="${p}"]`),first=()=>field('pairs.0.inPlane.A.rounds.0.dxCm'),last=()=>field('pairs.0.outPlane.A.rounds.0.dxCm');
  const tab=async t=>{await page.locator(`[data-tab="${t}"]`).click();if(t==='reports')await reportReady(page);await page.evaluate(()=>scrollTo(0,0));};
  const seed=async()=>{await page.evaluate(async()=>{const {sampleProject}=await import('./model.js'),{replaceProject}=await import('./store.js');localStorage.removeItem('tilt-survey-disclosures');await replaceProject(sampleProject());});await page.reload();await field('header.caseNumber').waitFor();await tab('readings');};
  const uncovered=async locator=>{await poll(page,async()=>assert.equal(await locator.evaluate(e=>{const r=e.getBoundingClientRect();return document.activeElement===e&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e&&r.top>=document.querySelector('#liveResults').getBoundingClientRect().bottom+8&&r.bottom<=innerHeight;}),true));};
  const geometry=()=>last().evaluate(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,resultsBottom:document.querySelector('#liveResults').getBoundingClientRect().bottom,scrollPaddingTop:getComputedStyle(document.documentElement).scrollPaddingTop,focused:document.activeElement===e}));
  const check=async(label,fn)=>{try{const data=await fn();result.checks.push({label,status:'pass',data});console.log(`PASS ${name}: ${label}`);}catch(error){result.checks.push({label,status:'fail',error:error.message});await page.screenshot({path:path.join(dir,`failure-${result.checks.length}.png`),fullPage:false}).catch(()=>{});console.log(`FAIL ${name}: ${label}: ${error.message}`);}};
  try{
   await page.goto(url);await field('header.caseNumber').waitFor();await seed();
   if(bright)await page.locator('#sunlightButton').click();
   await check('版本與六頁桌機版面',async()=>{
    await poll(page,async()=>assert.equal(await page.evaluate(async()=>(await import('./model.js')).VERSION),'0.4.2'));
    await poll(page,async()=>assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('sunlight')),bright));
    for(const t of ['case','facades','readings','photos','map','reports']){await tab(t);await poll(page,async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true));}
    await tab('readings');await page.screenshot({path:path.join(dir,'readings.png'),fullPage:false});return {viewport};
   });
   await check('H 標籤同列與示例結果',async()=>{
    await poll(page,async()=>assert.equal(await page.locator('.shared-height-row .field>span').evaluate(e=>e.textContent.replace(/\s/g,'')),'H（cm）'));
    await poll(page,async()=>assert.equal(await page.locator('.shared-height-row').evaluate(e=>{const a=e.querySelector('.check-field').getBoundingClientRect(),b=e.querySelector('.field').getBoundingClientRect();return a.left<b.left&&a.top<b.bottom&&b.top<a.bottom;}),true));
    await poll(page,async()=>assert.deepEqual(await page.evaluate(async()=>{const {loadProject}=await import('./store.js'),{calculatePair}=await import('./calc.js'),p=await loadProject();return p.pairs.flatMap(q=>{const r=calculatePair(q,p.facades.find(f=>f.id===q.facadeId),p.settings);return [r.inPlane.denominator,r.outPlane.denominator];});}),[212,168,188,179]));return {denominators:[212,168,188,179]};
   });
   await check('四測點畫面數值逐項核對',async()=>{
    const rows=[];
    for(let pair=0;pair<2;pair++){
     await page.locator('.pair-list button[data-pair]').nth(pair).click();
     for(const box of await page.locator('#liveResults .result-box').all())for(const selector of ['p','strong','b','.result-values'])await poll(page,()=>assertVisible(box.locator(selector)));
     await poll(page,()=>assertVisible(field(`pairs.${pair}.inPlane.A.hCm`)));
     for(const axis of ['inPlane','outPlane'])await poll(page,()=>assertVisible(field(`pairs.${pair}.${axis}.A.rounds.0.dxCm`)));
     const want=expected.slice(pair*2,pair*2+2).map(e=>({label:e.label,ratio:e.ratio,direction:e.direction,values:normal(`△X ${e.dx} cm H ${e.height} cm`)}));
     let actual;
     await poll(page,async()=>{actual=await page.locator('#liveResults .result-box').evaluateAll(nodes=>nodes.map(e=>({label:e.querySelector('p').textContent.split('｜')[0],ratio:e.querySelector('strong').textContent,direction:e.querySelector('b').textContent,values:e.querySelector('.result-values').textContent.replace(/\s/g,'')})));assert.deepEqual(actual,want);});
     await poll(page,async()=>assert.equal(await field(`pairs.${pair}.inPlane.A.hCm`).inputValue(),expected[pair*2].height));
     for(const [axis,k] of [['inPlane',0],['outPlane',1]])await poll(page,async()=>assert.equal(await field(`pairs.${pair}.${axis}.A.rounds.0.dxCm`).inputValue(),expected[pair*2+k].dx));
     rows.push(...actual);await page.screenshot({path:path.join(dir,`screen-values-pair-${pair+1}.png`),fullPage:false});
    }
    await page.locator('.pair-list button[data-pair]').first().click();
    await fs.writeFile(path.join(dir,'live-screen-values.json'),JSON.stringify(rows,null,2));return {matchedPoints:4,rows};
   });
   await check('Enter 與 Tab 換欄',async()=>{await first().click();await page.keyboard.press('Enter');await uncovered(last());const enter=await geometry();await page.screenshot({path:path.join(dir,'enter-focus.png'),fullPage:false});await page.keyboard.press('Tab');await uncovered(field('pairs.0.outPlane.A.rounds.0.dir'));return {enter,tabTarget:await page.evaluate(()=>document.activeElement.dataset.field)};});
   await check('遮擋位置 Tab 與結果列高度更新',async()=>{
    const rounds=page.locator('[data-rounds="0|outPlane|A"]');await revealControl(rounds);await rounds.selectOption('2');await page.locator('[data-reading-axis="inPlane"] details').evaluate(e=>e.open=false);
    await poll(page,async()=>assert.equal(await page.locator('#liveResults').evaluate(e=>Math.round(parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)*1000)===Math.round((parseFloat(getComputedStyle(e).top)+e.getBoundingClientRect().height+8)*1000)),true));
    await last().evaluate(e=>scrollTo(0,scrollY+e.getBoundingClientRect().top-parseFloat(getComputedStyle(document.querySelector('#liveResults')).top)-20));
    await poll(page,async()=>assert.equal(await last().evaluate(e=>{const r=e.getBoundingClientRect();return document.querySelector('#liveResults').contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true));
    await page.locator('[data-reading-axis="inPlane"] details>summary').evaluate(e=>e.focus({preventScroll:true}));await page.keyboard.press('Tab');await uncovered(last());const focus=await geometry();await page.screenshot({path:path.join(dir,'tab-focus.png'),fullPage:false});
    const before=await page.locator('#liveResults').evaluate(e=>e.getBoundingClientRect().height);await first().fill('');
    await poll(page,async()=>assert.ok(await page.locator('#liveResults').evaluate(e=>e.getBoundingClientRect().height)<before));
    await poll(page,async()=>assert.equal(await page.locator('#liveResults').evaluate(e=>Math.round(parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)*1000)===Math.round((parseFloat(getComputedStyle(e).top)+e.getBoundingClientRect().height+8)*1000)),true));
    return {focus,before,after:await page.locator('#liveResults').evaluate(e=>e.getBoundingClientRect().height)};
   });
   await check('結果列增高後 Enter 與遮擋位置 Tab',async()=>{
    const before=await page.locator('#liveResults').evaluate(e=>e.getBoundingClientRect().height);
    await first().fill('2.3');
    await poll(page,async()=>assert.ok(await page.locator('#liveResults').evaluate(e=>e.getBoundingClientRect().height)>before));
    await poll(page,async()=>assert.equal(await page.locator('#liveResults').evaluate(e=>Math.round(parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)*1000)===Math.round((parseFloat(getComputedStyle(e).top)+e.getBoundingClientRect().height+8)*1000)),true));
    const after=await page.locator('#liveResults').evaluate(e=>e.getBoundingClientRect().height);
    await first().click();await page.keyboard.press('Enter');await uncovered(last());const enter=await geometry();
    await page.screenshot({path:path.join(dir,'height-increase-enter.png'),fullPage:false});
    await page.keyboard.press('Tab');await uncovered(field('pairs.0.outPlane.A.rounds.0.dir'));
    await last().evaluate(e=>scrollTo(0,scrollY+e.getBoundingClientRect().top-parseFloat(getComputedStyle(document.querySelector('#liveResults')).top)-20));
    await poll(page,async()=>assert.equal(await last().evaluate(e=>{const r=e.getBoundingClientRect();return document.querySelector('#liveResults').contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true));
    await page.locator('[data-reading-axis="inPlane"] details>summary').evaluate(e=>e.focus({preventScroll:true}));await page.keyboard.press('Tab');await uncovered(last());const tab=await geometry();
    await page.screenshot({path:path.join(dir,'height-increase-tab.png'),fullPage:false});return {before,after,enter,tab,tabTarget:await page.evaluate(()=>document.activeElement.dataset.field)};
   });
   await check('讀數保存與重開',async()=>{await first().fill('2.4');await page.waitForFunction(()=>document.documentElement.dataset.saveState==='saved');await page.reload();await field('header.caseNumber').waitFor();await tab('readings');await poll(page,async()=>assert.equal(await first().inputValue(),'2.4'));await seed();return {savedValue:'2.4',sampleRestored:true};});
   await check('離線重開',async()=>{await page.waitForFunction(()=>document.querySelector('#offlineStatus').textContent.includes('離線資源已準備'));await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));});phase='offline';await context.setOffline(true);await page.goto(url+'&desktop-offline='+name);await field('header.caseNumber').waitFor();await tab('readings');await poll(page,async()=>assert.equal(await first().inputValue(),'2.3'));await context.setOffline(false);phase='online';return {offlineReopen:true};});
   await context.setOffline(false);phase='online';
   await check('成果與列印規則',async()=>{await tab('reports');await poll(page,async()=>assert.equal(await page.locator('.result-sheet').count(),1));const wanted=expected.map(e=>({label:e.label,rows:[`△X＝${e.dx} cm`,`H＝${e.height} cm`,`△X／H＝${e.ratio}（${e.direction}）`].map(normal)}));let cells;
    await poll(page,async()=>{cells=await page.locator('.result-sheet .report-cell').evaluateAll(nodes=>nodes.map(e=>({label:e.querySelector('.cell-heading b').textContent,rows:[...e.querySelectorAll('.value-row')].map(r=>r.textContent.replace(/\s/g,''))})));assert.deepEqual(cells,wanted);});
    for(const cell of await page.locator('.result-sheet .report-cell').all()){await poll(page,()=>assertVisible(cell.locator('.cell-heading b')));for(const value of await cell.locator('.value-row').all())await poll(page,()=>assertVisible(value));}
    const fingerprint=(await page.locator('.full-fingerprint').textContent()).match(/[a-f0-9]{64}/)[0];
    await fs.writeFile(path.join(dir,'screen-values.json'),JSON.stringify({cells,fingerprint},null,2));
    await page.emulateMedia({media:'print'});await poll(page,async()=>assert.equal(await page.locator('.sidebar').isVisible(),false));await poll(page,async()=>assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollPaddingTop),'auto'));await page.pdf({path:path.join(dir,'print-preview.pdf'),preferCSSPageSize:true,printBackground:true});const pdfCheck=await execute(process.env.TILT_TEST_PYTHON||'python',[path.join(root,'pdf-check.py'),path.join(dir,'print-preview.pdf')],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});await fs.writeFile(path.join(dir,'pdf-check.log'),pdfCheck.stdout+pdfCheck.stderr);assert.equal(JSON.parse(pdfCheck.stdout).status,'pass');await page.emulateMedia({media:'screen'});await poll(page,async()=>assert.deepEqual(errors,[]));return {printPreview:true,pageErrors:errors};});
  }catch(error){result.setupError=error.message;console.log(`FAIL ${name}: setup: ${error.message}`);}
  finally{result.endedUtc=new Date().toISOString();all.push(result);await fs.writeFile(path.join(dir,'results.json'),JSON.stringify(result,null,2));await context.close();
   await check('HTTP、主控台、執行零錯誤與離線回復嚴格斷言',async()=>{assert.ok(diagnostics.responses.length>0,'Response monitor must observe traffic');const recovery=assertOfflineRecovery(diagnostics,{url:url+'&desktop-offline='+name,workerUrl:new URL('sw.js',url).href,readVerified:result.checks.some(c=>c.label==='離線重開'&&c.status==='pass')});return {...recovery,httpErrors:diagnostics.httpErrors.length,consoleErrors:diagnostics.consoleErrors.length,pageErrors:diagnostics.pageErrors.length,requestFailures:diagnostics.requestFailures.length,observedResponses:diagnostics.responses.length,consoleWarnings:diagnostics.consoleWarnings.length};});
   await fs.writeFile(path.join(dir,'results.json'),JSON.stringify(result,null,2));await fs.writeFile(path.join(out,'desktop-results.json'),JSON.stringify({head,url,phoneTests:'deferred by user',realImportTests:'deferred by user',scenarios:all},null,2));}
 }}finally{await browser.close();}
}
const files=[];for(const folder of all.map(r=>r.name))for(const name of await fs.readdir(path.join(out,folder)))if(name.endsWith('.png')||name.endsWith('.pdf')){const data=await fs.readFile(path.join(out,folder,name));files.push({file:folder+'/'+name,sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length});}
await fs.writeFile(path.join(out,'artifacts-sha256.json'),JSON.stringify(files,null,2));
assert.equal(all.length,8,'All 8 matrix scenarios required');assert.equal(new Set(all.map(r=>r.name)).size,8);
const failed=all.filter(r=>r.setupError||r.checks.length!==10||r.checks.some(c=>c.status==='fail')).length;
console.log(JSON.stringify({scenarios:all.length,passedChecks:all.flatMap(r=>r.checks).filter(c=>c.status==='pass').length,failedScenarios:failed,phoneTests:'deferred',realImportTests:'deferred'}));if(failed)process.exitCode=1;
