import {escapeXml as esc} from './sketch.js';
import {labels} from './model.js';
import {clamp,arrowPath} from './annotation-geometry.js';
import {createMagnifier} from './annotation.js';
export const PAPER={width:180,height:210};
export function imageBounds(width,height){const scale=Math.min(PAPER.width/width,PAPER.height/height);return {x:(PAPER.width-width*scale)/2,y:(PAPER.height-height*scale)/2,w:width*scale,h:height*scale};}
export function markerAt(x,y,bounds){return {x:clamp(x,0,100),y:clamp(y,0,100),inPlane:{dx:12/bounds.w*100,dy:5/bounds.h*100},outPlane:{dx:12/bounds.w*100,dy:-5/bounds.h*100}};}
export function markerGeometry(marker,bounds,axis,text){
  const point={x:bounds.x+marker.x/100*bounds.w,y:bounds.y+marker.y/100*bounds.h},offset=marker[axis],w=Math.max(10,[...text].length*2.4+3),h=6;
  const box={x:clamp(point.x+offset.dx/100*bounds.w-w/2,0,PAPER.width-w),y:clamp(point.y+offset.dy/100*bounds.h-h/2,0,PAPER.height-h),w,h};
  const edges=[{x:box.x,y:box.y+h/2},{x:box.x+w,y:box.y+h/2},{x:box.x+w/2,y:box.y},{x:box.x+w/2,y:box.y+h}],start=edges.reduce((a,b)=>Math.hypot(b.x-point.x,b.y-point.y)<Math.hypot(a.x-point.x,a.y-point.y)?b:a);
  return {point,box,start};
}
export function planSvg(project,url,{editor=false,selectedId=''}={}){
  const b=imageBounds(project.map.width,project.map.height);
  const marks=project.pairs.filter(p=>p.mapMarker).map(p=>{
    const l=labels(p,project.settings),m=p.mapMarker,point=markerGeometry(m,b,'inPlane',l.inPlane).point;
    const labelMarkup=['inPlane','outPlane'].map(axis=>{const {box,start}=markerGeometry(m,b,axis,l[axis]);return `<g${editor?` data-handle="label" data-pair-id="${p.id}" data-axis="${axis}"`:''}><path d="${arrowPath(start,point,2)}" fill="none" stroke="#111" stroke-width=".4"/><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="white" stroke="#111" stroke-width=".3"/><text x="${box.x+box.w/2}" y="${box.y+box.h/2}" dominant-baseline="central" text-anchor="middle" font-size="3.2" font-weight="bold" fill="#111">${esc(l[axis])}</text></g>`;}).join('');
    return labelMarkup+`<g${editor?` data-handle="point" data-pair-id="${p.id}"`:''}><circle cx="${point.x}" cy="${point.y}" r="1.5" fill="#111" stroke="white" stroke-width=".4"/>${editor?`<circle cx="${point.x}" cy="${point.y}" r="5" fill="transparent" stroke="${p.id===selectedId?'#c42e27':'transparent'}" stroke-width=".45"/>`:''}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="plan-svg" viewBox="0 0 180 210" role="img" aria-label="傾斜測點佈設圖"><rect width="180" height="210" fill="white"/><image href="${esc(url)}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" preserveAspectRatio="xMidYMid meet"/>${marks}</svg>`;
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
