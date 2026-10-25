import strictAssert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function basicChecks({page,out,channel,head,appHash,site,version,result={}}) {
  const checks = [], diagnostics = {responses:[],httpErrors:[],consoleErrors:[],pageErrors:[],requestFailures:[]};
  let phase = 'online';
  const assert = (value,message) => {if(!value)throw new Error(message);};
  const check = async(name,fn) => {const data=await fn();checks.push({name,status:'pass',data});};
  const field = key => page.locator(`[data-field="${key}"]`);
  const tab = async name => {await page.locator(`[data-tab="${name}"]`).click();if(name==='reports')await page.waitForFunction(()=>document.querySelector('#reportRoot')?.dataset.ready==='true');};
  page.on('console',msg=>{if(msg.type()==='error')diagnostics.consoleErrors.push(msg.text());});
  page.on('pageerror',error=>diagnostics.pageErrors.push(error.message));
  page.context().on('response',response=>{const r={url:response.url(),status:response.status(),phase};diagnostics.responses.push(r);if(r.status>=400)diagnostics.httpErrors.push(r);});
  page.context().on('requestfailed',request=>diagnostics.requestFailures.push({url:request.url(),method:request.method(),resourceType:request.resourceType(),worker:request.serviceWorker()?.url()||null,error:request.failure(),phase}));
  Object.assign(result,{channel,head,url:site,initialPageUrl:page.url(),startedUtc:new Date().toISOString(),checks,diagnostics,phoneTests:'deferred',realImportTests:'deferred',imagePdfValueReview:'deferred'});
  let originalError;
  try {
    await page.setViewportSize({width:1280,height:900});
    await page.goto(site);await field('header.caseNumber').waitFor();
    assert(!diagnostics.httpErrors.length&&!diagnostics.consoleErrors.length&&!diagnostics.pageErrors.length&&!diagnostics.requestFailures.length,'cold-start diagnostics must be clean before loading the sample');
    await page.locator('[data-action="sample"]').click();await page.locator('#actionDialog').getByRole('button',{name:'直接取代',exact:true}).click();
    await page.getByText('合成示例已載入，可直接預覽成果表。',{exact:true}).waitFor();
    await page.reload();await field('header.caseNumber').waitFor();
    await check('線上 manifest 與實際瀏覽器 app.js 對應 main',async()=>{
      const response=await page.request.get(site+'deploy-manifest.json?release-check='+head);assert(response.status()===200,'manifest HTTP');
      const manifest=await response.json();assert(manifest.commit===head&&manifest.version===version,'manifest identity');
      const actual=await page.evaluate(async()=>{const r=await fetch('./app.js');const data=await r.arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');});
      assert(actual===appHash,'browser app bytes must match main');assert((await page.title()).includes('V'+version),'title');return {commit:manifest.commit,appSha256:actual};
    });
    await check('合成示例四個分母',async()=>{
      const values=await page.evaluate(async()=>{const {loadProject}=await import('./store.js'),{calculatePair}=await import('./calc.js'),p=await loadProject();return p.pairs.flatMap(q=>{const c=calculatePair(q,p.facades.find(f=>f.id===q.facadeId),p.settings);return[c.inPlane.denominator,c.outPlane.denominator];});});
      assert(JSON.stringify(values)==='[212,168,188,179]','sample denominators');return values;
    });
    const caseNumber='發布驗證－合成資料－'+channel;
    await check('表頭編輯與保存完成',async()=>{await tab('case');await field('header.caseNumber').fill(caseNumber);await page.waitForFunction(()=>document.documentElement.dataset.saveState==='saved');return {caseNumber};});
    await check('重新整理保留案件',async()=>{await page.reload();await field('header.caseNumber').waitFor();assert(await field('header.caseNumber').inputValue()===caseNumber,'case persisted');});
    await check('六頁與桌機寬度',async()=>{for(const t of ['case','facades','readings','photos','map','reports']){await tab(t);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),t+' horizontal overflow');}return {width:1280,height:900};});
    await tab('readings');
    await check('即時讀數與方向',async()=>{const t=await page.locator('#liveResults').innerText();for(const s of ['1／212','1／168','向右傾','向後傾'])assert(t.includes(s),'live '+s);assert(await field('pairs.0.inPlane.A.rounds.0.dxCm').inputValue()==='2.3','first dx');return t;});
    const direction=page.locator('[data-reading-axis="inPlane"] .form-disclosure');
    await check('展開偏好保存與重開',async()=>{
      if(!await direction.evaluate(e=>e.open))await direction.locator('summary').click();
      await page.waitForFunction(()=>{const e=document.querySelector('[data-reading-axis="inPlane"] .form-disclosure');return e.open&&JSON.parse(localStorage.getItem('tilt-survey-disclosures'))[e.dataset.uiDisclosure]===true;});
      await page.reload();await field('header.caseNumber').waitFor();await tab('readings');assert(await direction.evaluate(e=>e.open),'open retained');
    });
    await check('收合保存完成再重開',async()=>{
      await direction.locator('summary').click();
      await page.waitForFunction(()=>{const e=document.querySelector('[data-reading-axis="inPlane"] .form-disclosure');return !e.open&&JSON.parse(localStorage.getItem('tilt-survey-disclosures'))[e.dataset.uiDisclosure]===false;});
      await page.reload();await field('header.caseNumber').waitFor();await tab('readings');assert(await direction.getAttribute('open')===null,'closed retained');
    });
    await check('Enter 換欄與結果列遮擋',async()=>{
      await field('pairs.0.inPlane.A.rounds.0.dxCm').click();await page.keyboard.press('Enter');
      const last=field('pairs.0.outPlane.A.rounds.0.dxCm');await page.waitForFunction(()=>{const e=document.querySelector('[data-field="pairs.0.outPlane.A.rounds.0.dxCm"]'),r=e.getBoundingClientRect();return document.activeElement===e&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e&&r.top>=document.querySelector('#liveResults').getBoundingClientRect().bottom+8&&r.bottom<=innerHeight;});
      await page.screenshot({path:out+'/enter-focus.png'});return await last.evaluate(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,resultsBottom:document.querySelector('#liveResults').getBoundingClientRect().bottom}));
    });
    await check('原生 Tab 換欄',async()=>{await page.keyboard.press('Tab');assert(await field('pairs.0.outPlane.A.rounds.0.dir').evaluate(e=>document.activeElement===e),'tab direction');});
    await check('一般與強光切換',async()=>{await page.locator('#sunlightButton').click();assert(await page.evaluate(()=>document.documentElement.classList.contains('sunlight')),'sunlight on');await page.screenshot({path:out+'/sunlight.png'});await page.locator('#sunlightButton').click();assert(!await page.evaluate(()=>document.documentElement.classList.contains('sunlight')),'sunlight off');});
    await check('成果四分母與三頁列印',async()=>{
      await tab('reports');const text=await page.locator('#reportRoot').innerText();for(const n of [212,168,188,179])assert(text.includes('1／'+n),'report denominator '+n);
      const resultSheets=await page.locator('.result-sheet').count(),rawSheets=await page.locator('.raw-sheet').count();assert(resultSheets===1&&rawSheets===2,'three report sheets');
      await page.screenshot({path:out+'/report.png',fullPage:true});await page.emulateMedia({media:'print'});assert(!await page.locator('.sidebar').isVisible(),'print sidebar hidden');await page.pdf({path:out+'/print-preview.pdf',preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});return {resultSheets,rawSheets,imagePdfValuesChecked:false};
    });
    await check('合成案件備份下載',async()=>{
      const pending=page.waitForEvent('download');await page.locator('[data-action="export"]').first().click();const download=await pending;await download.saveAs(out+'/synthetic-case.tiltsurvey');let raw='';const stream=await download.createReadStream();for await(const b of stream)raw+=b.toString('utf8');const data=JSON.parse(raw);assert(data.format==='tilt-survey-case.v1'&&data.project.header.caseNumber===caseNumber&&data.project.pairs.length===2,'backup content');return {filename:download.suggestedFilename(),format:data.format,pairs:2,importExecuted:false};
    });
    await check('離線資源就緒',async()=>{await page.waitForFunction(()=>document.querySelector('#offlineStatus').textContent.includes('離線資源已準備'));await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));});return await page.evaluate(async()=>({caches:await caches.keys(),controller:navigator.serviceWorker.controller.scriptURL}));});
    const offlineUrl=site+'?release='+version+'&pr5='+head+'&live-offline='+channel;
    await check('離線重開仍保留資料與成果',async()=>{
      phase='offline';await page.context().setOffline(true);await page.goto(offlineUrl);await field('header.caseNumber').waitFor();assert(await field('header.caseNumber').inputValue()===caseNumber,'offline case');await tab('readings');assert(await field('pairs.0.inPlane.A.rounds.0.dxCm').inputValue()==='2.3','offline dx');await tab('reports');assert(await page.locator('.result-sheet').count()===1,'offline report');await page.screenshot({path:out+'/offline.png'});
    });
    await check('恢復連線與嚴格診斷',async()=>{
      await page.context().setOffline(false);phase='online';await page.reload();await field('header.caseNumber').waitFor();
      const response=await page.request.get(site+'deploy-manifest.json?recovery='+Date.now());assert(response.status()===200&&(await response.json()).commit===head,'network recovery');
      assert(!diagnostics.httpErrors.length&&!diagnostics.consoleErrors.length&&!diagnostics.pageErrors.length,'unexpected HTTP/console/page errors');
      assert(diagnostics.requestFailures.length===1,'exactly one expected offline worker failure');const f=diagnostics.requestFailures[0];assert(f.phase==='offline'&&f.url===offlineUrl&&f.method==='GET'&&f.resourceType==='fetch'&&f.worker===site+'sw.js'&&f.error.errorText==='net::ERR_INTERNET_DISCONNECTED','offline failure identity');return {unexpectedErrors:0,expectedOfflineFailures:1,responses:diagnostics.responses.length};
    });
    result.status='passed';result.passed=checks.length;result.browserVersion=page.context().browser().version();
  }catch(error){originalError=error;result.status='failed';result.error={name:error.name,message:error.message,stack:error.stack};await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});throw error;}
  finally{result.finalPageUrl=page.url();result.endedUtc=new Date().toISOString();try{await fs.writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2));}catch(storageError){console.error('Release result storage failure: '+storageError.stack);if(!originalError)throw storageError;}}
  return result;
}

export function assertBasicCloseCompleted(result) {
  const attempt = result.teardownAttempts?.find(item => item.name === 'browser-close');
  strictAssert.equal(attempt?.status, 'saved', 'Basic browser close receipt must be saved');
  strictAssert.equal(attempt?.value?.status, 'closed', 'An expected action failure cannot hide failed browser cleanup');
  strictAssert.equal(attempt?.value?.diagnostic?.nativeStatus, 'completed', 'The first native close must have completed');
  strictAssert.deepEqual(result.teardownErrors, []);
}
