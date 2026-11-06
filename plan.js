import {escapeXml as esc} from './sketch.js';
import {labels,isConfirmed} from './model.js';
import {calculatePair} from './calc.js';
import {clamp,arrowPath} from './annotation-geometry.js';
import {createMagnifier} from './annotation.js';
export const PAPER={width:180,height:210};
// 圖面辨識建議值，非規範門檻；長度為 180×210 紙面座標單位。
export const TILT_ARROW_REFERENCE_RATIO=1/200;
export const TILT_ARROW_REFERENCE_LENGTH=7.3;
export const TILT_ARROW_MIN_LENGTH=4;
export const TILT_ARROW_MAX_LENGTH=14;
export const TILT_ARROW_START=2.2;
export function tiltArrowLength(value){
  return clamp(Math.abs(value)/TILT_ARROW_REFERENCE_RATIO*TILT_ARROW_REFERENCE_LENGTH,TILT_ARROW_MIN_LENGTH,TILT_ARROW_MAX_LENGTH);
}
const CALLOUT_STYLE='fill="none" stroke="#111" stroke-width=".4"';
const tiltStyle=axis=>`fill="none" stroke="#111" stroke-width="1"${axis==='outPlane'?' stroke-dasharray="2.2 1"':''}`;
export function imageBounds(width,height){const scale=Math.min(PAPER.width/width,PAPER.height/height);return {x:(PAPER.width-width*scale)/2,y:(PAPER.height-height*scale)/2,w:width*scale,h:height*scale};}
export function markerAt(x,y,bounds){return {x:clamp(x,0,100),y:clamp(y,0,100),inPlane:{dx:12/bounds.w*100,dy:5/bounds.h*100},outPlane:{dx:12/bounds.w*100,dy:-5/bounds.h*100}};}
export function markerGeometry(marker,bounds,axis,text){
  const point={x:bounds.x+marker.x/100*bounds.w,y:bounds.y+marker.y/100*bounds.h},offset=marker[axis],w=Math.max(10,[...text].length*2.4+3),h=6;
  const box={x:clamp(point.x+offset.dx/100*bounds.w-w/2,0,PAPER.width-w),y:clamp(point.y+offset.dy/100*bounds.h-h/2,0,PAPER.height-h),w,h};
  const edges=[{x:box.x,y:box.y+h/2},{x:box.x+w,y:box.y+h/2},{x:box.x+w/2,y:box.y},{x:box.x+w/2,y:box.y+h}],start=edges.reduce((a,b)=>Math.hypot(b.x-point.x,b.y-point.y)<Math.hypot(a.x-point.x,a.y-point.y)?b:a);
  return {point,box,start};
}
// 底圖上的立面朝向：planNormalDeg 為外法線在底圖上的方向，0＝底圖上方，順時針；觀測者站在外法線側面向立面。
export function planVectors(deg){const a=deg*Math.PI/180,normal={x:Math.sin(a),y:-Math.cos(a)};return {normal,right:{x:normal.y,y:-normal.x}};}
export function tiltVector(direction,deg){const {normal,right}=planVectors(deg);return {left:{x:-right.x,y:-right.y},right,front:normal,back:{x:-normal.x,y:-normal.y}}[direction]||null;}
const at=(p,v,k)=>({x:p.x+v.x*k,y:p.y+v.y*k});
export function facingGlyph(point,facade){
  if(facade?.planNormalDeg==null)return '';
  const {normal,right}=planVectors(facade.planNormalDeg),a=at(point,right,-4.5),c=at(point,right,4.5),tail=at(point,normal,7.5),head=at(point,normal,2.4),L=at(at(point,right,-6.4),normal,2.6),R=at(at(point,right,6.4),normal,2.6);
  const letter=(q,t)=>`<text x="${q.x}" y="${q.y}" dominant-baseline="central" text-anchor="middle" font-size="2.4" fill="#111" stroke="white" stroke-width=".5" paint-order="stroke">${t}</text>`;
  return `<g data-glyph="facing" data-degrees="${facade.planNormalDeg}"><line x1="${a.x}" y1="${a.y}" x2="${c.x}" y2="${c.y}" stroke="#111" stroke-width=".55"/><path d="${arrowPath(tail,head,1.6)}" fill="none" stroke="#111" stroke-width=".4"/>${letter(L,'左')}${letter(R,'右')}</g>`;
}
export function tiltArrows(point,pair,facade,settings){
  if(facade?.planNormalDeg==null||!isConfirmed(pair,facade))return '';
  const result=calculatePair(pair,facade,settings);
  return ['inPlane','outPlane'].map(axis=>{const r=result[axis];if(r.status!=='ok'||!r.dxMm||!r.direction)return '';const v=tiltVector(r.direction,facade.planNormalDeg);
    return `<path class="tilt" data-kind="tilt" data-tilt="${axis}" data-direction="${r.direction}" d="${arrowPath(at(point,v,TILT_ARROW_START),at(point,v,TILT_ARROW_START+tiltArrowLength(r.dxMm/r.hMm)),2.2)}" ${tiltStyle(axis)}/>`;}).join('');
}
// 優先選底圖外留白，再比較角落與測點、文字框、引線的重疊面積。
function tiltLegend(bounds,occupied){
  const w=39,h=21,pad=3;
  const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
  const corners=[{x:PAPER.width-w-pad,y:PAPER.height-h-pad},{x:pad,y:PAPER.height-h-pad},{x:PAPER.width-w-pad,y:pad},{x:pad,y:pad}].map(p=>({...p,w,h}));
  const score=p=>occupied.reduce((sum,b)=>sum+overlap(p,b),0)*1000+overlap(p,bounds);
  const box=corners.reduce((a,b)=>score(b)<score(a)?b:a);
  const rows=[['callout','文字框引線'],['inPlane','面內傾斜'],['outPlane','面外傾斜']].map(([kind,text],i)=>{
    const y=5+i*5.5,style=kind==='callout'?CALLOUT_STYLE:tiltStyle(kind);
    return `<path d="${arrowPath({x:2,y},{x:12,y},kind==='callout'?2:2.2)}" ${style}/><text x="15" y="${y}" dominant-baseline="central" font-size="3" fill="#111">${text}</text>`;
  }).join('');
  return `<g data-legend="tilt" transform="translate(${box.x} ${box.y})" pointer-events="none"><rect width="${w}" height="${h}" rx="1" fill="white" stroke="#111" stroke-width=".3"/>${rows}</g>`;
}
export function planSvg(project,url,{editor=false,selectedId=''}={}){
  const b=imageBounds(project.map.width,project.map.height),occupied=[];
  const arrows=new Map(project.pairs.filter(p=>p.mapMarker).map(p=>{
    const point=markerGeometry(p.mapMarker,b,'inPlane','').point,facade=project.facades.find(f=>f.id===p.facadeId);
    return [p.id,tiltArrows(point,p,facade,project.settings)];
  }));
  const hasTilt=[...arrows.values()].some(Boolean);
  const marks=project.pairs.filter(p=>p.mapMarker).map(p=>{
    const l=labels(p,project.settings),m=p.mapMarker,point=markerGeometry(m,b,'inPlane',l.inPlane).point,facade=project.facades.find(f=>f.id===p.facadeId);
    const glyph=facingGlyph(point,facade)+arrows.get(p.id);
    const radius=TILT_ARROW_START+TILT_ARROW_MAX_LENGTH+2;
    occupied.push({x:point.x-radius,y:point.y-radius,w:radius*2,h:radius*2});
    const labelMarkup=['inPlane','outPlane'].map(axis=>{const {box,start}=markerGeometry(m,b,axis,l[axis]);
      occupied.push(box,{x:Math.min(start.x,point.x),y:Math.min(start.y,point.y),w:Math.abs(start.x-point.x),h:Math.abs(start.y-point.y)});return `<g${editor?` data-handle="label" data-pair-id="${p.id}" data-axis="${axis}"`:''}><path${hasTilt?' class="callout" data-kind="callout"':''} d="${arrowPath(start,point,2)}" ${CALLOUT_STYLE}/><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="white" stroke="#111" stroke-width=".3"/><text x="${box.x+box.w/2}" y="${box.y+box.h/2}" dominant-baseline="central" text-anchor="middle" font-size="3.2" font-weight="bold" fill="#111">${esc(l[axis])}</text></g>`;}).join('');
    return glyph+labelMarkup+`<g${editor?` data-handle="point" data-pair-id="${p.id}"`:''}><circle cx="${point.x}" cy="${point.y}" r="1.5" fill="#111" stroke="white" stroke-width=".4"/>${editor?`<circle cx="${point.x}" cy="${point.y}" r="5" fill="transparent" stroke="${p.id===selectedId?'#c42e27':'transparent'}" stroke-width=".45"/>`:''}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="plan-svg" viewBox="0 0 180 210" role="img" aria-label="傾斜測點佈設圖"><rect width="180" height="210" fill="white"/><image href="${esc(url)}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" preserveAspectRatio="xMidYMid meet"/>${marks}${hasTilt?tiltLegend(b,occupied):''}</svg>`;
}
export function createPlanEditor(stage,project,url,getSelected,onChange,onSelect){
  const b=imageBounds(project.map.width,project.map.height),lens=createMagnifier(url,project.map.width,project.map.height);let zoom=1,pan={x:0,y:0},mode='place',drag=null,lastSvg;
  const draw=()=>{stage.innerHTML=planSvg(project,url,{editor:true,selectedId:getSelected()});lastSvg=stage.firstElementChild;lastSvg.setAttribute('viewBox',`${pan.x} ${pan.y} ${180/zoom} ${210/zoom}`);};
  const point=e=>{const p=lastSvg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;return p.matrixTransform(lastSvg.getScreenCTM().inverse());};
  const normalized=p=>({x:clamp((p.x-b.x)/b.w),y:clamp((p.y-b.y)/b.h)});
  const clampPan=()=>{pan.x=clamp(pan.x,0,180-180/zoom);pan.y=clamp(pan.y,0,210-210/zoom);};
  stage.addEventListener('pointerdown',e=>{e.preventDefault();const p=point(e),handle=e.target.closest('[data-handle]');stage.setPointerCapture(e.pointerId);
    if(handle){const pair=project.pairs.find(p=>p.id===handle.dataset.pairId);onSelect(pair.id);drag={kind:handle.dataset.handle,pair,axis:handle.dataset.axis,start:p,original:structuredClone(pair.mapMarker)};if(drag.kind==='point')lens.show(e,normalized(p),lastSvg.getBoundingClientRect().width*b.w/180*zoom);}
    else if(mode==='pan')drag={kind:'pan',start:p,client:{x:e.clientX,y:e.clientY},original:{...pan}};
    else if(p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h){const pair=project.pairs.find(p=>p.id===getSelected());if(!pair)return;drag={kind:'place',pair,start:p};const n=normalized(p);lens.show(e,n,lastSvg.getBoundingClientRect().width*b.w/180*zoom);}
  });
  stage.addEventListener('pointermove',e=>{if(!drag)return;const p=point(e),n=normalized(p);if(drag.kind==='place'){lens.show(e,n,lastSvg.getBoundingClientRect().width*b.w/180*zoom);return;}
    if(drag.kind==='pan'){const rect=lastSvg.getBoundingClientRect();pan={x:drag.original.x+(drag.client.x-e.clientX)/rect.width*180/zoom,y:drag.original.y+(drag.client.y-e.clientY)/rect.height*210/zoom};clampPan();}
    else if(drag.kind==='point'){drag.pair.mapMarker.x=n.x*100;drag.pair.mapMarker.y=n.y*100;lens.show(e,n,lastSvg.getBoundingClientRect().width*b.w/180*zoom);}
    else if(drag.kind==='label'){const m=drag.pair.mapMarker;m[drag.axis]={dx:drag.original[drag.axis].dx+(p.x-drag.start.x)/b.w*100,dy:drag.original[drag.axis].dy+(p.y-drag.start.y)/b.h*100};}
    draw();
  });
  stage.addEventListener('pointerup',e=>{lens.hide();if(!drag)return;if(drag.kind==='place'){const n=normalized(point(e));drag.pair.mapMarker=markerAt(n.x*100,n.y*100,b);}if(drag.kind!=='pan')onChange();drag=null;draw();});
  stage.addEventListener('pointercancel',()=>{lens.hide();if(drag?.original&&drag.pair)drag.pair.mapMarker=drag.original;drag=null;draw();});draw();
  return {setMode(v){mode=v;},zoomBy(factor){const center={x:pan.x+90/zoom,y:pan.y+105/zoom};zoom=clamp(zoom*factor,1,6);pan={x:center.x-90/zoom,y:center.y-105/zoom};clampPan();draw();},reset(){zoom=1;pan={x:0,y:0};draw();},draw,dispose(){lens.dispose();}};
}
