import {reportDocument,reportIssues,title} from './report.js';
import {labels} from './model.js';
import {escapeXml as esc} from './sketch.js';
import {markedImage} from './annotation.js';
import {loadMedia} from './store.js';
import {blobDataUrl,stampText} from './media.js';
import {planSvg} from './plan.js';
export function outputIssues(project,{kind='all',includeMap=true}={}){
  const issues=['all','results'].includes(kind)?reportIssues(project):[];
  if(kind==='photos'&&!project.pairs.some(p=>p.photos.length))issues.push('尚無照片，請先拍攝或匯入點位照片');
  if(kind==='map'&&!project.map)issues.push('尚無底圖，請先匯入平面底圖');
  if(project.map&&(kind==='map'||kind==='all'&&includeMap)){
    if(!project.map.source.trim())issues.push('佈設圖缺少底圖來源');
    if(!project.map.capturedOn.trim())issues.push('佈設圖缺少截圖／製圖日期');
    if(!project.pairs.some(p=>p.mapMarker))issues.push('佈設圖尚未標示測點');
  }return issues;
}
async function mediaBlob(key,read){const blob=await read(key);if(!blob)throw Error('照片或底圖原檔缺漏，請由完整案件備份恢復。');return blob;}
export async function photoReport(project,read=loadMedia){
  const photos=project.pairs.flatMap(pair=>pair.photos.map(photo=>({pair,photo})));let html='';
  for(let i=0;i<photos.length;i+=2){const cells=[];for(const {pair,photo} of photos.slice(i,i+2)){
    const l=labels(pair,project.settings),url=await blobDataUrl(await markedImage(await mediaBlob(photo.mediaId,read),photo.marks,{stamp:stampText(photo)}));
    cells.push(`<article class="photo-report-cell"><div class="photo-caption"><b>照片 ${i+cells.length+1}｜${esc(l.inPlane)}／${esc(l.outPlane)}</b><span>${esc(photo.description)}</span></div><div class="report-photo"><img src="${url}" alt="${esc(photo.description)}"></div><div class="photo-provenance">${photo.capturedAtSource==='exif'?'EXIF 拍攝時間（時區未驗證）':'未讀得 EXIF；匯入時間（臺灣時間）'}：${esc(photo.capturedAt.replace('T',' '))}</div></article>`);
  }if(cells.length===1)cells.push('<div class="photo-report-cell empty-cell">以下空白</div>');html+=`<section class="sheet photo-sheet">${title(project,'傾斜測量點位照片','—')}<div class="photo-report-grid">${cells.join('')}</div><footer class="media-footer">地址：${esc(project.header.address||'○○')}　測量人員：${esc(project.header.surveyor||'○○')}<br>標註與日期為輸出圖層，原始影像另存於完整案件檔。${Math.floor(i/2)+1}／${Math.ceil(photos.length/2)} 頁</footer></section>`;}
  return html;
}
export async function mapReport(project,read=loadMedia){
  if(!project.map)return '';const m=project.map,url=await blobDataUrl(await markedImage(await mediaBlob(m.mediaId,read),[]));
  return `<section class="sheet map-sheet">${title(project,'傾斜測量測點佈設圖','—')}<div class="map-report-board">${planSvg(project,url)}</div><footer class="media-footer"><b>● 測點</b>　${project.settings.labelStyle==='TS'?'T：立面內；S：立面外':'T：立面內；T′：立面外'}<br>底圖來源：${esc(m.source)}　截圖／製圖日期：${esc(m.capturedOn)}<br>位置／地址：${esc(m.approxAddress||project.header.address||'○○')}<br>底圖僅供位置示意，非比例尺圖。${project.pairs.filter(p=>p.mapMarker).length}／${project.pairs.length} 組已標位置。</footer></section>`;
}
export async function fullReport(project,{kind='all',includeRaw=true,includePhotos=true,includeMap=true}={},read=loadMedia){
  let html=['all','results'].includes(kind)?reportDocument(project,{includeRaw}):'';
  if(kind==='photos'||kind==='all'&&includePhotos)html+=await photoReport(project,read);
  if(kind==='map'||kind==='all'&&includeMap)html+=await mapReport(project,read);
  return html;
}
