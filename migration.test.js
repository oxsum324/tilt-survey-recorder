import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import fs from 'node:fs/promises';import {calculatePair} from './calc.js';import {normalizeProject,parseBackup,makeBackup} from './store.js';import {createPair,sampleProject,confirmObservation,isConfirmed,observationSnapshot} from './model.js';import {rawReport} from './report.js';
const load=async(ref,file)=>import('data:text/javascript;base64,'+execFileSync('git',['show',`${ref}:${file}`]).toString('base64'));
for(const [version,ref]of [['0.1.0','b6b3eeec40daeacd2d344ba442d45c19b1e1b7dc'],['0.3.0','3f83c6deba226c7473974055ebcf6f7de0363b76']])test(`V${version} 案件讀取遷移逐點完全保留成果、原始字串與確認快照`,async()=>{
 const old=await load(ref,'model.js'),calc=await load(ref,'calc.js'),p=old.sampleProject(),f=p.facades[0];f.baseline={...f.baseline,method:'azimuth',azimuthDeg:'90'};
 const b=old.createPair(3,f.id,'B');b.inPlane.B.rounds=[{tp:{HD:'8.100',VD:'6.215'},tb:{HD:'8.123',VD:'1.350'}}];b.outPlane.B.rounds=[{tp:{HD:'12.374',VD:'6.215'},tb:{HD:'12.345',VD:'1.350'}}];p.pairs.push(b);
 const c=old.createPair(4,f.id,'C');c.C.rounds=[{tp:{N:'100.029',E:'200.023',Z:'14.865'},tb:{N:'100.000',E:'200.000',Z:'10.000'}}];p.pairs.push(c);
 const averaged=structuredClone(p.pairs[0]);averaged.id=crypto.randomUUID();averaged.index=5;averaged.inPlane.A.rounds=[{...averaged.inPlane.A.rounds[0],dxCm:'02.2000',dir:'right'},{...averaged.inPlane.A.rounds[0],dxCm:'2.5',dir:'right'}];averaged.outPlane.A.rounds=[{...averaged.outPlane.A.rounds[0],dxCm:'2.2',dir:'front'},{...averaged.outPlane.A.rounds[0],dxCm:'2.5',dir:'front'}];p.pairs.push(averaged);
 const individual=structuredClone(p.pairs[1]);individual.id=crypto.randomUUID();individual.index=6;individual.sharedH=false;individual.outPlane.A.hCm='441.0';individual.inPlane.A.rounds[0].dxCm='0.0';p.pairs.push(individual);
 for(const pair of p.pairs){pair.confirmed=null;old.confirmObservation(p,pair,f);}
 const contents=JSON.stringify({format:'tilt-survey-case.v1',project:p,media:[]}),q=parseBackup(contents).project,receipt=[];
 assert.equal(q.schema,1);
 for(let i=0;i<p.pairs.length;i++){
  const before=calc.calculatePair(p.pairs[i],f,p.settings),after=calculatePair(q.pairs[i],q.facades[0],q.settings);
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

for(const [version,ref]of [['0.1.0','b6b3eeec40daeacd2d344ba442d45c19b1e1b7dc'],['0.3.0','3f83c6deba226c7473974055ebcf6f7de0363b76']])test(`V${version} 殘留方向方式不取代組設定，所有成果與確認沿用舊引擎`,async()=>{
 const old=await load(ref,'model.js'),calc=await load(ref,'calc.js'),receipt=[];
 for(const group of ['A','B','C'])for(const stale of ['','A','B','C','invalid']){
  const p=old.sampleProject(),pair=p.pairs[0],f=p.facades[0];p.pairs=[pair];pair.mode=group;f.baseline.method='azimuth';f.baseline.azimuthDeg='90';
  pair.inPlane.mode=stale;pair.outPlane.mode=stale;
  pair.inPlane.B.rounds=[{tp:{HD:'8.100',VD:'6.215'},tb:{HD:'8.146',VD:'1.350'}}];pair.outPlane.B.rounds=[{tp:{HD:'12.374',VD:'6.215'},tb:{HD:'12.345',VD:'1.350'}}];
  pair.C.rounds=[{tp:{N:'100.029',E:'200.023',Z:'14.865'},tb:{N:'100.000',E:'200.000',Z:'10.000'}}];pair.confirmed=null;old.confirmObservation(p,pair,f);
  const before=calc.calculatePair(pair,f,p.settings),q=parseBackup(JSON.stringify({format:'tilt-survey-case.v1',project:p,media:[]})).project,after=calculatePair(q.pairs[0],q.facades[0],q.settings);
  assert.deepEqual(after,before);assert.equal(isConfirmed(q.pairs[0],q.facades[0]),true);assert.deepEqual(q.pairs[0].confirmed,pair.confirmed);
  for(const axis of ['inPlane','outPlane']){assert.equal(q.pairs[0][axis].mode,group);assert.deepEqual(q.pairs[0][axis].A,pair[axis].A);assert.deepEqual(q.pairs[0][axis].B,pair[axis].B);}
  assert.deepEqual(parseBackup(JSON.stringify(await makeBackup(q))).project,q);receipt.push({group,stale,before,after,confirmed:true});
 }
 await fs.mkdir('output/migration',{recursive:true});await fs.writeFile(`output/migration/v${version}-stale-modes.json`,JSON.stringify({version,ref,cases:receipt.length,directions:receipt.length*2,receipt},null,2));
});
test('無版本舊檔沿用組設定，當版混合與沿用設定往返不變',async()=>{
 const legacy=sampleProject();delete legacy.appVersion;legacy.pairs[0].inPlane.mode='B';assert.equal(normalizeProject(legacy).pairs[0].inPlane.mode,'A');
 for(const mode of ['','A','B','C']){const p=sampleProject();p.pairs[0].inPlane.mode=mode;p.pairs[0].outPlane.mode='B';const q=parseBackup(JSON.stringify(await makeBackup(p))).project;assert.equal(q.pairs[0].inPlane.mode,mode);assert.equal(q.pairs[0].outPlane.mode,'B');}
});
