import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePair} from './calc.js';
import {createProject,sampleProject,confirmObservation,isConfirmed,VERSION} from './model.js';
import {rawReport,reportIssues,resultsReport} from './report.js';

function coordinateCase(facing='0'){
 const project=createProject(),pair=project.pairs[0],facade=project.facades[0];
 pair.mode='C';project.settings.showCompass=true;facade.facingDeg=facing;
 facade.baseline={method:'azimuth',azimuthDeg:'90'};
 pair.C.rounds=[{tb:{E:'200',N:'100',Z:'10'},tp:{E:'200.023',N:'100.029',Z:'14.865'}}];
 return {project,pair,facade};
}
function legacySnapshot(pair){
 const value=JSON.parse(pair.confirmed.snapshot);delete value.directionBasis;
 pair.confirmed.snapshot=JSON.stringify(value);
 return pair.confirmed.snapshot;
}
test('C 八方位由採用的基準決定，不採用矛盾的人工外法線',()=>{
 const {project,pair,facade}=coordinateCase('0'),result=calculatePair(pair,facade,project.settings);
 assert.equal(result.inPlane.directionText,'向右傾（向東）');
 assert.equal(result.outPlane.directionText,'向後傾（向北）');
 assert.equal(result.inPlane.denominator,212);assert.equal(result.outPlane.denominator,168);
 facade.facingDeg='180';assert.deepEqual(calculatePair(pair,facade,project.settings),result);
});
test('C 無人工外法線仍可由已定義基準標註八方位',()=>{
 const {project,pair,facade}=coordinateCase('');
 assert.equal(calculatePair(pair,facade,project.settings).inPlane.directionText,'向右傾（向東）');
});
test('新 C 確認不受未採用的人工外法線影響',()=>{
 const {project,pair,facade}=coordinateCase('0');confirmObservation(project,pair,facade);
 const snapshot=pair.confirmed.snapshot;facade.facingDeg='180';
 assert.equal(isConfirmed(pair,facade),true);assert.equal(pair.confirmed.snapshot,snapshot);
});
test('有效 A 外法線變更須重新確認並留下原因，原快照保留於更正軌跡',()=>{
 const project=sampleProject(),pair=project.pairs[0],facade=project.facades[0];
 facade.facingDeg='180';confirmObservation(project,pair,facade,'採用外法線');
 const before=pair.confirmed.snapshot;facade.facingDeg='0';
 assert.equal(isConfirmed(pair,facade),false);assert.throws(()=>confirmObservation(project,pair,facade),/原因/);
 assert.equal(pair.confirmed.snapshot,before);confirmObservation(project,pair,facade,'外法線更正');
 assert.equal(project.auditLog.at(-1).before,before);assert.equal(isConfirmed(pair,facade),true);
});
test('有效 B 外法線亦納入確認，未施測方向不形成外法線相依',()=>{
 const project=createProject(),pair=project.pairs[0],facade=project.facades[0];pair.mode='B';facade.facingDeg='180';
 pair.inPlane.B.rounds=[{tp:{HD:'8.100',VD:'6.215'},tb:{HD:'8.123',VD:'1.350'}}];
 pair.outPlane.status='skipped';pair.outPlane.skipReason='遮蔽';confirmObservation(project,pair,facade);
 facade.facingDeg='0';assert.equal(isConfirmed(pair,facade),false);
 pair.inPlane.status='skipped';pair.inPlane.skipReason='遮蔽';confirmObservation(project,pair,facade,'兩方向未施測');
 facade.facingDeg='180';assert.equal(isConfirmed(pair,facade),true);
});
test('舊 A 空白外法線快照可沿用，加入外法線需確認且不改舊快照',()=>{
 const project=sampleProject(),pair=project.pairs[0],facade=project.facades[0],snapshot=legacySnapshot(pair);
 assert.equal(isConfirmed(pair,facade),true);confirmObservation(project,pair,facade);
 assert.equal(pair.confirmed.snapshot,snapshot);facade.facingDeg='180';assert.equal(isConfirmed(pair,facade),false);
});
test('舊 C 相容八方位可沿用，矛盾八方位需確認，兩者皆不改歷史快照',()=>{
 for(const [facing,expected] of [['',true],['180',true],['0',false]]){
  const {project,pair,facade}=coordinateCase(facing);confirmObservation(project,pair,facade);
  const snapshot=legacySnapshot(pair);assert.equal(isConfirmed(pair,facade),expected,facing);
  assert.equal(pair.confirmed.snapshot,snapshot);
 }
});
test('C 合成偏移非零而整數分母為0時，不宣稱未量得偏移',()=>{
 const {project,pair,facade}=coordinateCase('');pair.C.rounds=[{tb:{E:'0',N:'0',Z:'0'},tp:{E:'0.150',N:'0.150',Z:'0.100'}}];
 confirmObservation(project,pair,facade);const result=calculatePair(pair,facade,project.settings);
 assert.equal(result.inPlane.composite.dxMm,212);assert.equal(result.inPlane.composite.denominator,0);
 const html=rawReport(project);assert.match(html,/整數 1／n 表達不適用/);assert.match(html,/212 mm/);assert.match(html,/H＝100 mm/);
 assert.doesNotMatch(html,/212 mm；未量得偏移|1／0|NaN|Infinity/);assert.deepEqual(reportIssues(project),[]);
});
test('成果及原始讀數表列印採用的計算核心版本',()=>{
 const project=sampleProject();assert.match(resultsReport(project),new RegExp('計算核心 V'+VERSION.replaceAll('.','\\.')));
 assert.match(rawReport(project),new RegExp('計算核心 V'+VERSION.replaceAll('.','\\.')));
});

