import {reportDocument} from './report.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {createProject,sampleProject,confirmObservation,isConfirmed} from './model.js';import {normalizeProject,makeBackup,parseBackup} from './store.js';import {reportIssues,resultsReport,rawReport} from './report.js';
test('案件正規化、缺漏選填欄位補預設',()=>{const p=createProject();delete p.header.instrument;delete p.settings.minHeightCm;delete p.pairs[0].photos;const q=normalizeProject(p);assert.equal(q.header.instrument,'');assert.equal(q.settings.minHeightCm,'200');assert.deepEqual(q.pairs[0].photos,[]);});
test('原始字串格式完整保留，匯出／匯入內容一致',async()=>{const p=sampleProject();p.pairs[0].inPlane.A.rounds[0].dxCm='02.3000';const b=await makeBackup(p);assert.deepEqual(parseBackup(JSON.stringify(b)).project,p);});
test('匯出／匯入後，確認快照不因物件欄位排序而失效',async()=>{const p=sampleProject(),q=parseBackup(JSON.stringify(await makeBackup(p))).project;assert.deepEqual(reportIssues(q),[]);assert.equal(isConfirmed(q.pairs[0],q.facades[0]),true);});
test('不同格式、未知 schema、重複測點與錯誤立面引用拒絕',()=>{assert.throws(()=>parseBackup('{}'));for(const mutate of [p=>p.schema=2,p=>p.pairs.push(p.pairs[0]),p=>p.pairs[0].facadeId='missing',p=>p.pairs[0].index=-1,p=>p.pairs[0].inPlane.A.rounds[0].dxCm=2.3]){const p=sampleProject();mutate(p);assert.throws(()=>normalizeProject(p));}});
test('媒體原檔往返、缺少媒體拒絕',async()=>{const p=sampleProject();p.map={mediaId:'map1',width:100,height:100,fileName:'合成示例.png',source:'合成示例',capturedOn:'2026-10-01',approxAddress:'',addedAt:new Date().toISOString()};const b=await makeBackup(p,async()=>new Blob(['abc'],{type:'image/png'}),async blob=>'data:image/png;base64,'+btoa(await blob.text()));const parsed=parseBackup(JSON.stringify(b));assert.equal(await parsed.media[0].blob.text(),'abc');assert.deepEqual(parsed.project,p);b.media=[];assert.throws(()=>parseBackup(JSON.stringify(b)),/缺少/);await assert.rejects(makeBackup(p,async()=>null),/缺漏/);});
test('匯入不得執行 HTML，報告文字會跳脫',()=>{const p=sampleProject();p.header.orgName='<img src=x onerror=alert(1)>';const html=resultsReport(normalizeProject(p));assert.doesNotMatch(html,/<img src=x/);assert.match(html,/&lt;img/);});
test('更正原因必填，保留前後值與時間',()=>{const p=sampleProject(),pair=p.pairs[0],f=p.facades[0];pair.inPlane.A.rounds[0].dxCm='2.4';assert.equal(isConfirmed(pair,f),false);assert.throws(()=>confirmObservation(p,pair,f,''),/原因/);confirmObservation(p,pair,f,'讀尺重查');assert.equal(p.auditLog.length,1);assert.match(p.auditLog[0].before,/2.3/);assert.match(p.auditLog[0].after,/2.4/);assert.match(rawReport(p),/讀尺重查/);assert.equal(isConfirmed(pair,f),true);});
test('草稿／基準異動尚未確認時不可產生正式預覽',()=>{const p=sampleProject();assert.deepEqual(reportIssues(p),[]);p.pairs[0].inPlane.A.hCm='500';assert.match(reportIssues(p).join(),/尚未確認/);const q=createProject();q.pairs[0].mode='C';q.pairs[0].confirmed={snapshot:'old',at:'now'};assert.match(reportIssues(q).join(),/基準/);});
test('預覽範本四值、合成量不在成果表、單數測點保留空白格',()=>{const p=sampleProject(),html=resultsReport(p);for(const n of [212,168,188,179])assert.match(html,new RegExp(`1／${n}`));assert.doesNotMatch(html,/合成參考值/);p.pairs.pop();assert.equal((resultsReport(p).match(/以下空白/g)||[]).length,2);});

test('合成方位包含四象限及四個正方向',async()=>{
 const {bearingText}=await import('./report.js');
 for(const [a,label]of [[38.4,'北偏東 38.4°'],[141.6,'南偏東 38.4°'],[218.4,'南偏西 38.4°'],[321.6,'北偏西 38.4°'],[0,'正北'],[90,'正東'],[180,'正南'],[270,'正西']])assert.equal(bearingText(a),`${label}（方位角 ${a.toFixed(1)}°）`);
 assert.equal(bearingText(null),'方位未定義');
});
test('成果表的門窗使用深灰細線且側立面標示臨路側',()=>{
 const p=sampleProject(),html=reportDocument(p);assert.match(html,/stroke="#444" stroke-width="0.15"/);assert.match(html,/前（臨路側）/);
});
test('方位先捨入再判定正方向，四邊界與跨圈不產生矛盾文字',async()=>{
 const {bearingText}=await import('./report.js');
 for(const [a,direction]of [[359.99,'正北'],[-.01,'正北'],[360,'正北'],[720,'正北'],[89.99,'正東'],[179.99,'正南'],[269.99,'正西']]){
  const rounded=(Math.round(((a%360+360)%360)*10)%3600)/10;assert.equal(bearingText(a),`${direction}（方位角 ${rounded.toFixed(1)}°）`);
 }
 for(const [a,text]of [[.06,'北偏東 0.1°（方位角 0.1°）'],[89.94,'北偏東 89.9°（方位角 89.9°）'],[90.06,'南偏東 89.9°（方位角 90.1°）'],[179.94,'南偏東 0.1°（方位角 179.9°）'],[180.06,'南偏西 0.1°（方位角 180.1°）'],[269.94,'南偏西 89.9°（方位角 269.9°）'],[270.06,'北偏西 89.9°（方位角 270.1°）'],[359.94,'北偏西 0.1°（方位角 359.9°）'],[-.06,'北偏西 0.1°（方位角 359.9°）']])assert.equal(bearingText(a),text);
 for(const a of [0,90,180,270])for(const delta of [-.049,0,.049])assert.match(bearingText(a+delta),/正[北東南西]（/);
 for(const a of [0,90,180,270])assert.equal(bearingText(a-.05),bearingText(a));
 for(const [a,text]of [[.05,'北偏東 0.1°（方位角 0.1°）'],[90.05,'南偏東 89.9°（方位角 90.1°）'],[180.05,'南偏西 0.1°（方位角 180.1°）'],[270.05,'北偏西 89.9°（方位角 270.1°）']])assert.equal(bearingText(a),text);
 for(let tenths=0;tenths<3600;tenths++)assert.doesNotMatch(bearingText(tenths/10+.049),/方位角 360\.0|偏[東西] 0\.0|偏[東西] 90\.0/);
});
