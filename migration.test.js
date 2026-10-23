import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {calculatePair} from './calc.js';
import {normalizeProject,parseBackup,makeBackup} from './store.js';
import {createPair,sampleProject,confirmObservation,isConfirmed,observationSnapshot} from './model.js';
import {rawReport} from './report.js';
const fixtureRoot=new URL('./checks/fixtures/migration/',import.meta.url);
const readFixture=async(version,name)=>{
 const fixture=JSON.parse(await fs.readFile(new URL(`v${version}.json`,fixtureRoot),'utf8'));
 const value=fixture.cases.find(c=>c.name===name);assert.ok(value,`Missing frozen fixture ${version}/${name}`);
 return {...value,ref:fixture.source.ref};
};
test('固定歷史 fixture 五版本、35 案件與 96 方向均有來源與完整雜湊',async()=>{
 const manifest=JSON.parse(await fs.readFile(new URL('manifest.json',fixtureRoot),'utf8'));
 assert.deepEqual(manifest.fixtures.map(f=>f.version).sort(),['0.1.0','0.2.0','0.3.0','0.4.0','0.4.1']);
 assert.equal(manifest.fixtures.reduce((n,f)=>n+f.cases,0),35);assert.equal(manifest.fixtures.reduce((n,f)=>n+f.pairs*2,0),96);
 for(const record of manifest.fixtures){const bytes=await fs.readFile(new URL(record.file,fixtureRoot));assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);const fixture=JSON.parse(bytes);assert.equal(fixture.synthetic,true);assert.deepEqual(fixture.source,record.source);assert.match(record.source.modelSha256,/^[a-f0-9]{64}$/);assert.match(record.source.calcSha256,/^[a-f0-9]{64}$/);assert.equal(fixture.cases.length,record.cases);}
});
for(const version of ['0.1.0','0.3.0'])test(`V${version} 案件讀取遷移逐點完全保留成果、原始字串與確認快照`,async()=>{
 const {project:p,expectedResults,ref}=await readFixture(version,'base');
 const contents=JSON.stringify({format:'tilt-survey-case.v1',project:p,media:[]}),q=parseBackup(contents).project,receipt=[];
 assert.equal(q.schema,1);assert.equal(p.pairs.length,6);
 for(let i=0;i<p.pairs.length;i++){
  const before=expectedResults[i],after=calculatePair(q.pairs[i],q.facades[0],q.settings);
  assert.deepEqual(after,before,`STOP P8: V${version} point ${i+1}`);
  assert.equal(q.pairs[i].confirmed.snapshot,p.pairs[i].confirmed.snapshot);assert.equal(isConfirmed(q.pairs[i],q.facades[0]),true);
  for(const axis of ['inPlane','outPlane']){assert.equal(q.pairs[i][axis].mode,p.pairs[i].mode);assert.deepEqual(q.pairs[i][axis].A,p.pairs[i][axis].A);assert.deepEqual(q.pairs[i][axis].B,p.pairs[i][axis].B);receipt.push({point:i+1,axis,before,after,equal:true});}
 }
 assert.deepEqual(parseBackup(JSON.stringify(await makeBackup(q))).project,q);
 await fs.mkdir('output/migration',{recursive:true});await fs.writeFile(`output/migration/v${version}.tiltsurvey`,contents);await fs.writeFile(`output/migration/v${version}-results.json`,JSON.stringify({version,ref,directions:receipt.length,equal:true,receipt},null,2));
});
test('T 採 A、T′ 採 B 可獨立計算與列出原始讀數，確認更正仍受控',()=>{
 const p=sampleProject(),pair=p.pairs[0],f=p.facades[0];pair.inPlane.mode='A';pair.outPlane.mode='B';pair.outPlane.B.rounds=[{tp:{HD:'12.374',VD:'6.215'},tb:{HD:'12.345',VD:'1.350'}}];
 const r=calculatePair(pair,f,p.settings);assert.equal(r.inPlane.denominator,212);assert.equal(r.outPlane.denominator,168);assert.equal(r.inPlane.dxMm,23);assert.equal(r.outPlane.dxMm,29);assert.equal(isConfirmed(pair,f),false);assert.throws(()=>confirmObservation(p,pair,f),/原因/);confirmObservation(p,pair,f,'分向方式更正（合成）');assert.equal(isConfirmed(pair,f),true);assert.match(rawReport(p),/T1<br>模式 A/);assert.match(rawReport(p),/T1′<br>模式 B/);
 const q=normalizeProject(p);assert.equal(q.pairs[0].inPlane.mode,'A');assert.equal(q.pairs[0].outPlane.mode,'B');assert.equal(isConfirmed(q.pairs[0],q.facades[0]),true);
});
test('單向 C 共用座標，另一向保留 A，預設沿用測點組',()=>{
 const p=sampleProject(),pair=p.pairs[0],f=p.facades[0];f.baseline={...f.baseline,method:'azimuth',azimuthDeg:'90'};pair.outPlane.mode='C';pair.C.rounds=[{tp:{N:'100.029',E:'200.023',Z:'14.865'},tb:{N:'100.000',E:'200.000',Z:'10.000'}}];const r=calculatePair(pair,f);assert.equal(r.inPlane.denominator,212);assert.equal(r.outPlane.denominator,168);assert.match(rawReport(p),/北偏東 38.4°/);const inherited=createPair(1,f.id,'B');assert.equal(inherited.inPlane.mode,'');assert.equal(inherited.outPlane.mode,'');
});
test('無效方向方式拒絕，改預設但實際方向不變不影響讀數確認',()=>{const p=sampleProject(),pair=p.pairs[0];pair.inPlane.mode='A';pair.outPlane.mode='A';const before=observationSnapshot(pair,p.facades[0]);pair.mode='C';assert.equal(observationSnapshot(pair,p.facades[0]),before);pair.outPlane.mode='invalid';assert.throws(()=>normalizeProject(p),/方向作業方式/);});

for(const version of ['0.1.0','0.3.0'])test(`V${version} 殘留方向方式不取代組設定，所有成果與確認沿用舊引擎`,async()=>{
 const receipt=[];let ref;
 for(const group of ['A','B','C'])for(const stale of ['','A','B','C','invalid']){
  const fixture=await readFixture(version,`stale-${group}-${stale||'empty'}`),p=fixture.project,pair=p.pairs[0];ref=fixture.ref;
  assert.equal(pair.mode,group);assert.equal(pair.inPlane.mode,stale);assert.equal(pair.outPlane.mode,stale);
  const before=fixture.expectedResults[0],q=parseBackup(JSON.stringify({format:'tilt-survey-case.v1',project:p,media:[]})).project,after=calculatePair(q.pairs[0],q.facades[0],q.settings);
  assert.deepEqual(after,before);assert.equal(isConfirmed(q.pairs[0],q.facades[0]),true);assert.deepEqual(q.pairs[0].confirmed,pair.confirmed);
  for(const axis of ['inPlane','outPlane']){assert.equal(q.pairs[0][axis].mode,stale===''?'':group);assert.equal(q.pairs[0][axis].mode||q.pairs[0].mode,group);assert.deepEqual(q.pairs[0][axis].A,pair[axis].A);assert.deepEqual(q.pairs[0][axis].B,pair[axis].B);}
  assert.deepEqual(parseBackup(JSON.stringify(await makeBackup(q))).project,q);receipt.push({group,stale,before,after,confirmed:true});
 }
 assert.equal(receipt.length,15);
 await fs.mkdir('output/migration',{recursive:true});await fs.writeFile(`output/migration/v${version}-stale-modes.json`,JSON.stringify({version,ref,cases:receipt.length,directions:receipt.length*2,receipt},null,2));
});
test('無版本舊檔沿用組設定，當版混合與沿用設定往返不變',async()=>{
 const legacy=sampleProject();delete legacy.appVersion;legacy.pairs[0].inPlane.mode='B';assert.equal(normalizeProject(legacy).pairs[0].inPlane.mode,'A');
 for(const mode of ['','A','B','C']){const p=sampleProject();p.pairs[0].inPlane.mode=mode;p.pairs[0].outPlane.mode='B';const q=parseBackup(JSON.stringify(await makeBackup(p))).project;assert.equal(q.pairs[0].inPlane.mode,mode);assert.equal(q.pairs[0].outPlane.mode,'B');}
});
test('實際 V0.4.0 分向案件與 V0.2 結構相容檔可讀取，成果與確認不變',async()=>{
 const {project:p,expectedResults}=await readFixture('0.4.0','mixed');
 const q=parseBackup(JSON.stringify({format:'tilt-survey-case.v1',project:p,media:[]})).project;for(let i=0;i<p.pairs.length;i++){assert.deepEqual(calculatePair(q.pairs[i],q.facades[0],q.settings),expectedResults[i]);assert.deepEqual(q.pairs[i].confirmed,p.pairs[i].confirmed);assert.equal(isConfirmed(q.pairs[i],q.facades[0]),true);}assert.equal(q.pairs[0].outPlane.mode,'B');
 const v2=await readFixture('0.2.0','legacy-structure'),restored=parseBackup(JSON.stringify({format:'tilt-survey-case.v1',project:v2.project,media:[]})).project;
 assert.equal(isConfirmed(restored.pairs[0],restored.facades[0]),true);assert.equal(calculatePair(restored.pairs[0],restored.facades[0]).inPlane.denominator,212);
 for(let i=0;i<restored.pairs.length;i++)assert.deepEqual(calculatePair(restored.pairs[i],restored.facades[0],restored.settings),v2.expectedResults[i]);
});
test('實際 V0.4.1 案件保留混合方式、原始字串、成果與確認並可往返',async()=>{
 const {project:p,expectedResults,ref}=await readFixture('0.4.1','mixed');
 const contents=JSON.stringify({format:'tilt-survey-case.v1',project:p,media:[]}),q=parseBackup(contents).project;
 assert.equal(q.schema,1);assert.deepEqual(q.pairs,p.pairs);assert.deepEqual(q.facades,p.facades);assert.deepEqual(q.header,p.header);
 for(let i=0;i<p.pairs.length;i++){assert.deepEqual(calculatePair(q.pairs[i],q.facades[0],q.settings),expectedResults[i]);assert.equal(isConfirmed(q.pairs[i],q.facades[0]),true);}
 assert.deepEqual(parseBackup(JSON.stringify(await makeBackup(q))).project,q);
 await fs.mkdir('output/migration',{recursive:true});await fs.writeFile('output/migration/v0.4.1.tiltsurvey',contents);await fs.writeFile('output/migration/v0.4.1-results.json',JSON.stringify({version:'0.4.1',ref,pairs:q.pairs.length,equal:true,confirmed:true,roundtrip:true},null,2));
});
