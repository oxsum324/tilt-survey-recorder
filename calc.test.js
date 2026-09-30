import test from 'node:test';import assert from 'node:assert/strict';
import {calculatePair,calculateDirection,compass,decimalMm,halfUp} from './calc.js';
import {createPair,createFacade} from './model.js';
const setup=()=>{const f=createFacade(),p=createPair(1,f.id);p.inPlane.A.hCm='486.5';return {p,f};};
function A(dx,h='486.5',axis='inPlane',direction='right') {const {p,f}=setup();p.inPlane.A.hCm=h;p[axis].A.rounds[0]={source:'offset',dxCm:dx,dir:direction};return calculateDirection(p,axis,f);}
function B(station,tpHD,tbHD,tpVD='6.215',tbVD='1.350') {const {p,f}=setup();p.mode='B';const axis=station==='front'?'outPlane':'inPlane';p[axis].B={station,rounds:[{tp:{HD:tpHD,VD:tpVD},tb:{HD:tbHD,VD:tbVD}}]};return {p,f,axis,result:calculateDirection(p,axis,f)};}
function C(){const {p,f}=setup();p.mode='C';f.baseline={method:'azimuth',azimuthDeg:'90'};p.C.rounds=[{tb:{N:'100.000',E:'200.000',Z:'10.000'},tp:{N:'100.029',E:'200.023',Z:'14.865'}}];return {p,f};}
test('規格 #1 A：2.3、486.5 → 1／212 向右傾',()=>{const r=A('2.3');assert.equal(r.denominator,212);assert.equal(r.dxCm,'2.3');assert.equal(r.hCm,'486.5');assert.equal(r.direction,'right');});
test('規格 #2 A：2.9 → 1／168 向後傾',()=>{const r=A('2.9','486.5','outPlane','back');assert.equal(r.denominator,168);assert.equal(r.direction,'back');});
test('規格 #3 A：T2、T2′範本',()=>{assert.equal(A('1.9','357.9').denominator,188);assert.equal(A('2.0','357.9','outPlane','back').denominator,179);});
test('規格 #4 分母 220.5 half-up → 221',()=>assert.equal(A('2.0','441.0').denominator,221));
test('規格 #5 零偏移不產生 Infinity／NaN 或方向',()=>{const r=A('0.0');assert.match(r.ratioText,/未量得偏移/);assert.equal(r.denominator,null);assert.equal(r.directionText,'');assert.doesNotMatch(JSON.stringify(r),/Infinity|NaN/);});
test('規格 #6 兩測回平均 23.5 mm → 24 mm → 1／203',()=>{const {p,f}=setup();p.inPlane.A.rounds=[{dxCm:'2.2',dir:'right'},{dxCm:'2.5',dir:'right'}];const r=calculateDirection(p,'inPlane',f);assert.equal(r.dxCm,'2.4');assert.equal(r.denominator,203);assert.equal(r.differenceMm,3);assert.equal(r.warnings.length,0);assert.match(calculateDirection(p,'inPlane',f,{toleranceMm:'2'}).warnings[0],/超過/);});
test('規格 #7 B 正前方 → 向後、168',()=>{const r=B('front','12.374','12.345').result;assert.equal(r.direction,'back');assert.equal(r.denominator,168);assert.equal(r.hCm,'486.5');});
test('規格 #8 B 右側 → 向右、212',()=>{const r=B('rightSide','8.100','8.123').result;assert.equal(r.direction,'right');assert.equal(r.denominator,212);});
test('規格 #9 B 左側 d<0 → 向右、188',()=>{const r=B('leftSide','5.000','4.981','4.929').result;assert.equal(r.direction,'right');assert.equal(r.denominator,188);});
test('規格 #10 H≤0 阻擋',()=>{assert.equal(B('front','12','12','1','1').result.status,'error');assert.equal(B('front','12','12','-1','1').result.status,'error');});
test('規格 #11 C 方位角兩向與合成',()=>{const {p,f}=C(),r=calculatePair(p,f);assert.equal(r.inPlane.denominator,212);assert.equal(r.outPlane.denominator,168);assert.equal(r.inPlane.direction,'right');assert.equal(r.outPlane.direction,'back');assert.equal(r.inPlane.composite.dxMm,37);assert.equal(r.inPlane.composite.denominator,131);assert.ok(Math.abs(r.inPlane.composite.bearingDeg-38.4)<.1);});
test('規格 #12 C 兩點法保留投影前次毫米精度',()=>{const {p,f}=C();f.baseline={method:'twoPoints',A:{N:'50.000',E:'50.000'},B:{N:'58.660',E:'55.000'}};p.C.rounds[0].tp={N:'100.034419',E:'199.986386',Z:'14.865'};const r=calculatePair(p,f);assert.ok(Math.abs(r.inPlane.signedMm-23)<.01);assert.ok(Math.abs(r.outPlane.signedMm-29)<.01);assert.equal(r.inPlane.denominator,212);assert.equal(r.outPlane.denominator,168);});
test('規格 #13 基準點重合阻擋',()=>{const {p,f}=C();f.baseline={method:'twoPoints',A:{N:'50',E:'50'},B:{N:'50',E:'50'}};assert.match(calculatePair(p,f).inPlane.error,/重合/);});
test('規格 #14 C E 負方向 → 向左、212',()=>{const {p,f}=C();p.C.rounds[0].tp.E='199.977';const r=calculatePair(p,f);assert.equal(r.inPlane.direction,'left');assert.equal(r.inPlane.denominator,212);});
test('規格 #15 朝南立面向右＝東、向後＝北',()=>{assert.equal(compass('right','180'),'東');assert.equal(compass('back','180'),'北');const {p,f}=setup();p.inPlane.A.rounds[0].dxCm='2.3';f.facingDeg='180';assert.equal(calculatePair(p,f,{showCompass:true}).inPlane.directionText,'向右傾（向東）');});
test('half-up 邊界、負值先取絕對值',()=>{assert.equal(A('0.05').dxMm,1);assert.equal(A('0.049999999').dxMm,0);assert.equal(A('2.35','486.5','inPlane','left').dxMm,24);assert.equal(halfUp(-23.5),24);});
test('缺漏、非字串、逗點、無限與超出精度阻擋',()=>{for(const x of ['',null,2.3,'NaN','Infinity','1,000','1e3','0.0000000001']){assert.equal(A(x).status,'error',String(x));}assert.throws(()=>decimalMm('1000000000000'));});
test('偏移負值、零垂距、捨入後零垂距阻擋',()=>{assert.equal(A('-2.3').status,'error');assert.equal(A('2.3','0').status,'error');assert.equal(A('0.1','0.04').status,'error');});
test('零分母不輸出 1／0',()=>assert.equal(A('1000','100').status,'error'));
test('有號平均：左右相反抵銷，較差仍為 46 mm',()=>{const {p,f}=setup();p.inPlane.A.rounds=[{dxCm:'2.3',dir:'right'},{dxCm:'2.3',dir:'left'}];const r=calculatePair(p,f).inPlane;assert.equal(r.dxMm,0);assert.equal(r.differenceMm,46);});
test('兩測回向左平均以絕對值 half-up',()=>{const {p,f}=setup();p.inPlane.A.rounds=[{dxCm:'2.2',dir:'left'},{dxCm:'2.5',dir:'left'}];const r=calculatePair(p,f).inPlane;assert.equal(r.dxMm,24);assert.equal(r.direction,'left');});
test('鋼尺上、下讀數差，方向由使用者指定',()=>{const {p,f}=setup();p.inPlane.A.rounds=[{source:'ruler',upperCm:'14.800',lowerCm:'17.100',dir:'right'}];assert.equal(calculatePair(p,f).inPlane.dxCm,'2.3');});
test('短垂距、小偏移提示不阻擋',()=>{const r=A('0.1','100');assert.equal(r.status,'ok');assert.equal(r.warnings.length,2);});
test('未施測原因必填',()=>{const {p,f}=setup();p.inPlane.status='skipped';assert.equal(calculatePair(p,f).inPlane.status,'error');p.inPlane.skipReason='遮擋';assert.equal(calculatePair(p,f).inPlane.reason,'遮擋');});
test('模式 B 負高差允許，HD 負值與測站不符阻擋',()=>{assert.equal(B('front','12.374','12.345','1.000','-3.865').result.hCm,'486.5');assert.equal(B('front','-1','12').result.status,'error');const {p,f}=setup();p.mode='B';p.inPlane.B.station='front';assert.match(calculatePair(p,f).inPlane.error,/不一致/);});
test('模式 C 未設基準阻擋；座標負值與大座標微小差可精確相減',()=>{const {p,f}=C();f.baseline.method='none';assert.equal(calculatePair(p,f).inPlane.status,'error');f.baseline={method:'azimuth',azimuthDeg:'90'};p.C.rounds[0]={tp:{N:'-999999.971',E:'999999.023',Z:'14.865'},tb:{N:'-1000000.000',E:'999999.000',Z:'10.000'}};const r=calculatePair(p,f);assert.equal(r.inPlane.dxMm,23);assert.equal(r.outPlane.dxMm,29);});
test('共用／分向 H 不混用',()=>{const {p,f}=setup();p.outPlane.A.hCm='357.9';p.outPlane.A.rounds[0].dxCm='2.0';assert.equal(calculatePair(p,f).outPlane.hCm,'486.5');p.sharedH=false;assert.equal(calculatePair(p,f).outPlane.hCm,'357.9');});
test('B 兩回 H 不同，未定義策略先阻擋',()=>{const {p,f,axis}=B('rightSide','8.100','8.123');p[axis].B.rounds.push({tp:{HD:'8.100',VD:'6.216'},tb:{HD:'8.123',VD:'1.350'}});assert.match(calculateDirection(p,axis,f).error,/垂距 H 不同/);});
test('設定值不可無效或為負數',()=>{const {p,f}=setup();p.inPlane.A.rounds[0].dxCm='2.3';assert.equal(calculatePair(p,f,{toleranceMm:''}).inPlane.status,'error');assert.equal(calculatePair(p,f,{minOffsetMm:'-1'}).inPlane.status,'error');assert.throws(()=>compass('right','360'));});
