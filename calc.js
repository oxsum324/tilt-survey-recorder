// Original implementation. Raw decimal strings are converted to exact rational mm;
// round only final table values. C projections retain sub-mm coordinate precision.
export const DEFAULT_SETTINGS = {defaultMode:'A', toleranceMm:'3', minOffsetMm:'3', minHeightCm:'200', labelStyle:'prime', showCompass:false};
const add = (a,b) => ({n:a.n*b.d+b.n*a.d,d:a.d*b.d});
const negate = a => ({n:-a.n,d:a.d});
const subtract = (a,b) => add(a,negate(b));
const average = values => { const sum=values.reduce(add,{n:0n,d:1n}); return {n:sum.n,d:sum.d*BigInt(values.length)}; };
const number = a => Number(a.n)/Number(a.d);
const abs = a => ({n:a.n<0n?-a.n:a.n,d:a.d});
const round = a => Number((2n*abs(a).n+a.d)/(2n*a.d));
export function decimalMm(value, unit='cm') {
  if(typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) throw Error('必填讀數缺漏或格式無效');
  const s=value.trim(), negative=s.startsWith('-'), clean=s.replace(/^[+-]/,''), [whole,fraction='']=clean.split('.');
  if(fraction.length>9 || (whole||'').length>12) throw Error('讀數超出支援精度或範圍（最多九位小數）');
  const n=BigInt((whole||'0')+fraction)*(negative?-1n:1n)*BigInt(unit==='m'?1000:unit==='cm'?10:1);
  const result={n,d:10n**BigInt(fraction.length)};
  if(Math.abs(number(result))>1e12) throw Error('讀數超出支援範圍');
  return result;
}
export function halfUp(value) { return Math.floor(Math.abs(value)+0.5+1e-10); }
export function compass(direction, facingDeg) {
  const f=number(decimalMm(facingDeg,'mm'));
  if(f<0||f>=360) throw Error('立面朝向須為 0 至小於 360 度');
  const angle=(f+({front:0,back:180,right:-90,left:90}[direction])+360)%360;
  return cardinalDirection(angle);
}
const cardinalDirection=angle=>['北','東北','東','東南','南','西南','西','西北'][Math.floor((((angle%360)+360)%360+22.5)/45)%8];
export const directionText = direction => ({left:'向左傾',right:'向右傾',front:'向前傾',back:'向後傾'}[direction]||'');
function checks(settings) {
  const s={...DEFAULT_SETTINGS,...settings};
  for(const key of ['toleranceMm','minOffsetMm','minHeightCm']) if(number(decimalMm(s[key],'mm'))<0) throw Error('提示設定值不得為負值');
  return s;
}
function finish(ds,hs,axis,settings,facade,details) {
  hs.forEach(h=>{if(number(h)<=0) throw Error('垂距 H 必須大於 0');});
  // V0.1: different B/C heights are unresolved in the supplied specification.
  if(hs.length===2 && subtract(hs[0],hs[1]).n!==0n) throw Error('兩測回垂距 H 不同；本版須確認一致後才產生成果');
  const d=average(ds),h=average(hs),dxMm=round(d),hMm=round(h);
  if(hMm<=0) throw Error('表列垂距 H 捨入後必須大於 0 mm');
  const denominator=dxMm?Number((2n*BigInt(hMm)+BigInt(dxMm))/(2n*BigInt(dxMm))):null;
  if(denominator===0) throw Error('偏移量相對垂距過大，1／n 的整數分母為 0；請核對讀數');
  const signedMm=number(d), direction=signedMm===0?null:axis==='inPlane'?(signedMm>0?'right':'left'):(signedMm>0?'back':'front');
  const differenceMm=ds.length===2?number(abs(subtract(ds[0],ds[1]))):null;
  const warnings=[];
  if(differenceMm!==null&&differenceMm>Number(settings.toleranceMm)+1e-9) warnings.push(`兩測回較差 ${+differenceMm.toFixed(6)} mm，超過設定值 ${settings.toleranceMm} mm`);
  if(hMm<Number(settings.minHeightCm)*10) warnings.push('量測垂距較短，讀數誤差對傾斜率影響較大');
  if(dxMm<Number(settings.minOffsetMm)) warnings.push('偏移量小於設定之量測誤差值，傾斜率僅供參考');
  if(dxMm===0&&signedMm!==0) warnings.push('表列偏移量捨入為 0.0 cm；原始值仍保留於原始讀數表');
  const bearing=settings.showCompass&&direction&&(details.mode==='C'||facade.facingDeg!=='')?`（向${details.mode==='C'?baselineCompass(direction,facade.baseline):compass(direction,facade.facingDeg)}）`:'';
  return {status:'ok',dxMm,hMm,signedMm,dxCm:(dxMm/10).toFixed(1),hCm:(hMm/10).toFixed(1),denominator,direction,
    directionText:dxMm===0?'':directionText(direction)+bearing,ratioText:dxMm===0?'未量得偏移（ΔX＝0.0 cm）':`1／${denominator}`,differenceMm,warnings,
    rounds:ds.map((d,i)=>({signedMm:number(d),hMm:number(hs[i])})),...details};
}
export function baselineVectors(baseline) {
  let e,n;
  if(baseline?.method==='twoPoints') {
    e=number(subtract(decimalMm(baseline.B?.E,'m'),decimalMm(baseline.A?.E,'m')));
    n=number(subtract(decimalMm(baseline.B?.N,'m'),decimalMm(baseline.A?.N,'m')));
  } else if(baseline?.method==='azimuth') {
    const angle=number(decimalMm(baseline.azimuthDeg,'mm'));
    if(angle<0||angle>=360) throw Error('基準方位角須為 0 至小於 360 度');
    e=Math.sin(angle*Math.PI/180);n=Math.cos(angle*Math.PI/180);
  } else throw Error('模式 C 尚未定義立面基準');
  const length=Math.hypot(e,n);
  if(!length) throw Error('立面基準無效：A 與 B 重合');
  const u=[e/length,n/length]; return {u,v:[-u[1],u[0]]};
}
export function baselineCompass(direction,baseline) {
  const {u,v}=baselineVectors(baseline),unit=['left','right'].includes(direction)?u:v,sign=['left','front'].includes(direction)?-1:1;
  return cardinalDirection(Math.atan2(sign*unit[0],sign*unit[1])*180/Math.PI);
}
function projected(value) { return decimalMm(value.toFixed(9),'mm'); }
export function calculatePair(pair,facade,settings={}) {
  return {inPlane:calculateDirection(pair,'inPlane',facade,settings),outPlane:calculateDirection(pair,'outPlane',facade,settings)};
}
export function calculateDirection(pair,axis,facade={},settings={}) {
  try {
    const s=checks(settings),m=pair[axis];
    if(!m) throw Error('測線資料缺漏');
    if(m.status==='skipped') {
      if(!m.skipReason?.trim()) throw Error('未施測須填原因');
      return {status:'skipped',reason:m.skipReason,warnings:[]};
    }
    const mode=m.mode||pair.mode,ds=[],hs=[];
    const rounds=mode==='C'?pair.C?.rounds:m[mode]?.rounds;
    if(!Array.isArray(rounds)||rounds.length<1||rounds.length>2) throw Error('每方向須有 1 至 2 測回');
    let composite=null;
    for(const r of rounds) {
      if(mode==='A') {
        let dx=r.source==='ruler'?abs(subtract(decimalMm(r.upperCm),decimalMm(r.lowerCm))):decimalMm(r.dxCm);
        if(number(dx)<0) throw Error('偏移量 ΔX 不得為負值，請以方向選項表示');
        const directions=axis==='inPlane'?['left','right']:['front','back'];
        if(!directions.includes(r.dir)) throw Error('請選擇此分量的傾斜方向');
        ds.push(['left','front'].includes(r.dir)?negate(dx):dx);
        hs.push(decimalMm(pair.sharedH?pair.inPlane.A.hCm:m.A.hCm));
      } else if(mode==='B') {
        const station=m.B.station;
        if(axis==='inPlane'&&!['rightSide','leftSide'].includes(station) || axis==='outPlane'&&station!=='front') throw Error('測站位置與待測分量不一致');
        const tpHD=decimalMm(r.tp?.HD,'m'),tbHD=decimalMm(r.tb?.HD,'m');
        if(number(tpHD)<0||number(tbHD)<0) throw Error('水平距 HD 不得為負值');
        const d=subtract(tbHD,tpHD);
        ds.push(station==='front'||station==='leftSide'?negate(d):d);
        hs.push(subtract(decimalMm(r.tp?.VD,'m'),decimalMm(r.tb?.VD,'m')));
      } else if(mode==='C') {
        const {u,v}=baselineVectors(facade.baseline);
        const e=number(subtract(decimalMm(r.tp?.E,'m'),decimalMm(r.tb?.E,'m')));
        const n=number(subtract(decimalMm(r.tp?.N,'m'),decimalMm(r.tb?.N,'m')));
        const unit=axis==='inPlane'?u:v; ds.push(projected(e*unit[0]+n*unit[1]));
        hs.push(subtract(decimalMm(r.tp?.Z,'m'),decimalMm(r.tb?.Z,'m')));
      } else throw Error('未知作業方式');
    }
    if(mode==='C') {
      const es=rounds.map(r=>subtract(decimalMm(r.tp.E,'m'),decimalMm(r.tb.E,'m')));
      const ns=rounds.map(r=>subtract(decimalMm(r.tp.N,'m'),decimalMm(r.tb.N,'m')));
      const e=number(average(es)),n=number(average(ns)),dxMm=halfUp(Math.hypot(e,n));
      const hMm=round(average(hs));
      composite={dxMm,hMm,denominator:dxMm?Math.floor(hMm/dxMm+0.5):null,bearingDeg:dxMm?(Math.atan2(e,n)*180/Math.PI+360)%360:null};
    }
    return finish(ds,hs,axis,s,facade,{mode,composite});
  } catch(e) { return {status:'error',error:e.message,warnings:[]}; }
}
