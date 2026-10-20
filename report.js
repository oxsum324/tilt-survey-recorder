import {calculatePair} from './calc.js';
import {labels,isConfirmed,modeFor} from './model.js';
import {sketch,buildingParameters,escapeXml as esc} from './sketch.js';
export function bearingText(value){
  if(value===null)return '方位未定義';
  const a=(value%360+360)%360,cardinal={0:'正北',90:'正東',180:'正南',270:'正西'};
  const direction=cardinal[a]||(a<90?`北偏東 ${a.toFixed(1)}°`:a<180?`南偏東 ${(180-a).toFixed(1)}°`:a<270?`南偏西 ${(a-180).toFixed(1)}°`:`北偏西 ${(360-a).toFixed(1)}°`);
  return `${direction}（方位角 ${a.toFixed(1)}°）`;
}
const field=(h,key)=>esc(h[key]||'○○');
const footer='△X、H 為實測值，傾斜率＝△X／H，分母取整數（四捨五入）。圖示傾斜角度經放大，非依比例；立面為參數化示意，非實測立面。';
export const title=(p,name,unit='公分')=>`<header class="sheet-header"><div class="org">${field(p.header,'orgName')}</div><div>鑑定案編號：${field(p.header,'caseNumber')}</div><h2>${name}</h2><div class="sheet-meta"><span>使用儀器：${field(p.header,'instrument')}</span><span>測量日期：${field(p.header,'surveyDate')}</span><span>住戶編號：${field(p.header,'householdNo')}</span><span>單位：${unit}</span></div></header>`;
function time(value){if(!value)return '尚未確認';const date=new Date(value);return Number.isNaN(+date)?esc(value):esc(new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date))+'（臺灣時間）';}
export function reportIssues(project) {
  const problems=[];if(!project.pairs.length)problems.push('尚無測點組');
  for(const pair of project.pairs) {
    const f=project.facades.find(f=>f.id===pair.facadeId),l=labels(pair,project.settings);
    if(!f){problems.push(`測點組 ${pair.index} 缺少立面`);continue;}
    if(!isConfirmed(pair,f))problems.push(`測點組 ${pair.index} 尚未確認讀數或更正原因`);
    const r=calculatePair(pair,f,project.settings);for(const axis of ['inPlane','outPlane'])if(r[axis].status==='error')problems.push(`${l[axis]}：${r[axis].error}`);
    try {buildingParameters(f,pair);}catch(e){problems.push(`測點組 ${pair.index}：${e.message}`);}
  }
  return problems;
}
function cell(project,pair,axis) {
  const f=project.facades.find(f=>f.id===pair.facadeId),r=calculatePair(pair,f,project.settings)[axis],l=labels(pair,project.settings);
  const head=`<div class="cell-heading"><span>編號</span><b>${l[axis]}</b><span>測點　${l.tp}、${l.tb}</span></div>`;
  if(r.status==='skipped')return `<article class="report-cell">${head}<div class="skip-output">未施測：${esc(r.reason)}</div></article>`;
  if(r.status!=='ok')return `<article class="report-cell">${head}<div class="skip-output">讀數尚未完整：${esc(r.error)}</div></article>`;
  return `<article class="report-cell">${head}<div class="value-row">△X＝${r.dxCm} cm</div><div class="value-row">H＝${r.hCm} cm</div><div class="value-row ratio-row">${r.dxMm?`△X／H＝${r.ratioText}（${esc(r.directionText)}）`:r.ratioText}</div><div class="diagram">${sketch(pair,f,r,axis,project.settings).svg}</div>${r.warnings.length?`<div class="cell-note">${r.warnings.map(esc).join('；')}</div>`:''}</article>`;
}
export function resultsReport(project) {
  let pages='';for(let i=0;i<project.pairs.length;i+=2) {
    const pairs=project.pairs.slice(i,i+2);
    const cells=pairs.flatMap(pair=>['inPlane','outPlane'].map(axis=>cell(project,pair,axis)));
    if(pairs.length===1)cells.push('<div class="report-cell empty-cell">以下空白</div>','<div class="report-cell empty-cell">以下空白</div>');
    pages+=`<section class="sheet result-sheet">${title(project,'傾斜測量成果表')}<div class="result-grid">${cells.join('')}</div><footer class="sheet-footer"><div>註：${footer}</div><div>測量人員：${field(project.header,'surveyor')}　地址：${field(project.header,'address')}　${Math.floor(i/2)+1}／${Math.ceil(project.pairs.length/2)} 頁</div></footer></section>`;
  }return pages;
}
function rawDetails(pair,axis) {
  const m=pair[axis],mode=modeFor(pair,axis);if(m.status==='skipped')return `未施測：${esc(m.skipReason)}`;
  if(mode==='C')return '共用本測點組 TP／TB 座標（見下表），不重複輸入';
  if(mode==='A')return m.A.rounds.map((r,i)=>`第 ${i+1} 回：${r.source==='ruler'?`上讀數 ${esc(r.upperCm)}、下讀數 ${esc(r.lowerCm)} cm`:`ΔX ${esc(r.dxCm)} cm`}；方向 ${{left:'向左',right:'向右',front:'向前',back:'向後'}[r.dir]}；H ${esc(pair.sharedH?pair.inPlane.A.hCm:m.A.hCm)} cm`).join('<br>');
  return m.B.rounds.map((r,i)=>`第 ${i+1} 回（${{front:'正前方',rightSide:'右側延伸線',leftSide:'左側延伸線'}[m.B.station]}）：TP HD ${esc(r.tp.HD)}、VD ${esc(r.tp.VD)}；TB HD ${esc(r.tb.HD)}、VD ${esc(r.tb.VD)} m`).join('<br>');
}
export function rawReport(project) {
  let html='';for(const pair of project.pairs) {
    const f=project.facades.find(f=>f.id===pair.facadeId),r=calculatePair(pair,f,project.settings),l=labels(pair,project.settings);
    const rows=['inPlane','outPlane'].map(axis=>{
      const v=r[axis],process=v.status==='ok'?v.rounds.map((round,i)=>`第 ${i+1} 回：d＝${+round.signedMm.toFixed(9)} mm，H＝${+round.hMm.toFixed(9)} mm`).join('<br>')+`<br>平均有號 d＝${+v.signedMm.toFixed(9)} mm；表列 |d|＝${v.dxMm} mm，H＝${v.hMm} mm；${v.dxMm?`${v.hMm} ÷ ${v.dxMm} → ${v.ratioText}`:v.ratioText}；${esc(v.directionText)}${v.differenceMm!==null?`；兩測回較差 ${+v.differenceMm.toFixed(6)} mm`:''}`:v.status==='skipped'?`未施測：${esc(v.reason)}`:esc(v.error);
      return `<tr><th>${l[axis]}<br>模式 ${modeFor(pair,axis)}</th><td>${rawDetails(pair,axis)}</td></tr><tr><th>計算過程</th><td>${process}${v.warnings.length?`<br>${v.warnings.map(esc).join('<br>')}`:''}</td></tr>`;
    }).join('');
    const composite=r.inPlane.composite||r.outPlane.composite;
    const coords=['inPlane','outPlane'].some(axis=>modeFor(pair,axis)==='C')?`<table class="raw-table"><caption>共用座標與立面基準（單位 m，北＝0°，順時針）</caption><tbody>${pair.C.rounds.map((c,i)=>`<tr><th>第 ${i+1} 回</th><td>TP：N ${esc(c.tp.N)}、E ${esc(c.tp.E)}、Z ${esc(c.tp.Z)}<br>TB：N ${esc(c.tb.N)}、E ${esc(c.tb.E)}、Z ${esc(c.tb.Z)}</td></tr>`).join('')}<tr><th>立面基準</th><td>${f.baseline.method==='azimuth'?`由左至右方位角 α＝${esc(f.baseline.azimuthDeg)}°`:`A（左端）：N ${esc(f.baseline.A.N)}、E ${esc(f.baseline.A.E)}<br>B（右端）：N ${esc(f.baseline.B.N)}、E ${esc(f.baseline.B.E)}`}</td></tr>${composite?`<tr><th>合成參考值</th><td>|d|＝${composite.dxMm} mm；${composite.denominator?`1／${composite.denominator}`:'未量得偏移'}；${bearingText(composite.bearingDeg)}（不列入成果表）</td></tr>`:''}</tbody></table>`:'';
    html+=`<section class="sheet raw-sheet">${title(project,'傾斜測量原始讀數表','見各欄')}<h3>測點組 ${pair.index}｜${esc(f.name)}｜${l.tp}、${l.tb}</h3><p>方向基準：觀看者站在立面外、面向立面。立面內正值向右；立面外正值向後。</p><table class="raw-table"><tbody>${rows}</tbody></table>${coords}<p>下測點離地高度：${pair.tbHeightCm===''?'未量測':`${esc(pair.tbHeightCm)} cm`}；現場備註：${esc(pair.note||'無')}</p><p>讀數確認時間：${time(pair.confirmed?.at)}</p><p>表列值取至 1 mm（0.1 cm），分母以表列 H ÷ ΔX 四捨五入。原始小數精度保留至最後捨入；兩回為有號位移平均。</p><p>提示設定（可調整）：較差 ${esc(project.settings.toleranceMm)} mm；小偏移 ${esc(project.settings.minOffsetMm)} mm；短垂距 ${esc(project.settings.minHeightCm)} cm。</p></section>`;
    // Corrections on their own flowing pages; preserve every before/after value.
    for(const log of project.auditLog.filter(a=>a.pairId===pair.id))html+=`<section class="sheet audit-sheet">${title(project,'讀數更正紀錄','見各欄')}<h3>測點組 ${pair.index}｜${time(log.at)}</h3><p>原因：${esc(log.reason)}</p><h4>更正前原始值</h4><pre>${esc(JSON.stringify(JSON.parse(log.before),null,2))}</pre><h4>更正後原始值</h4><pre>${esc(JSON.stringify(JSON.parse(log.after),null,2))}</pre></section>`;
  }return html;
}
export function reportDocument(project,{includeRaw=true}={}) {
  return resultsReport(project)+(includeRaw?rawReport(project):'');
}
