// Core copied from oxsum324/section-properties-calculator, field-survey/annotation.js,
// commit 641e627d731122d7451aaf1b349e761928efcb6e. 複製後獨立演進。
// Callouts, mark groups, target magnifier and bounded history added for tilt survey.
import {clamp,calloutGeometry,arrowPath,validateMarks} from './annotation-geometry.js';
export const NS='http://www.w3.org/2000/svg';
export const node=(tag,attrs={})=>{const el=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);return el;};
export const TONES={red:'#c42e27',blue:'#1d5fbf',black:'#1a1a1a'};
export const loadImage=url=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('此裝置無法預覽此影像格式，請改用 JPEG、PNG 或 WebP。'));img.src=url;});
export function drawMarks(svg,marks,width,height,{stamp='',sunlight=false}={}){
  svg.replaceChildren();svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  marks.forEach((m,index)=>{
    const color=TONES[m.tone]||TONES.red,pts=m.points.map(p=>({x:p.x*width,y:p.y*height})),g=node('g',{'data-mark-index':index});svg.append(g);
    const common={fill:'none',stroke:color,'stroke-width':width/(m.tone==='black'?260:165)*(sunlight?1.5:1),'stroke-linecap':'round','stroke-linejoin':'round'};
    if(m.type==='callout'){
      const {target,start,box,font}=calloutGeometry(m,width,height);
      if(sunlight)g.append(node('path',{d:arrowPath(start,target,width/35),fill:'none',stroke:'#111','stroke-width':width/90}));
      g.append(node('path',{...common,d:arrowPath(start,target,width/35)}),node('rect',{x:box.x,y:box.y,width:box.w,height:box.h,fill:'#fff',stroke:color,'stroke-width':width/300}));
      const t=node('text',{x:box.x+box.w/2,y:box.y+box.h/2,'dominant-baseline':'central','text-anchor':'middle',fill:color,'font-size':font,'font-weight':'bold','font-family':'Arial, sans-serif',textLength:Math.max(1,box.w-width/50),lengthAdjust:'spacingAndGlyphs'});t.textContent=m.text;g.append(t);
    }else if(m.type==='circle')g.append(node('ellipse',{...common,cx:(pts[0].x+pts[1].x)/2,cy:(pts[0].y+pts[1].y)/2,rx:Math.abs(pts[1].x-pts[0].x)/2,ry:Math.abs(pts[1].y-pts[0].y)/2}));
    else if(m.type==='arrow')g.append(node('path',{...common,d:arrowPath(pts[0],pts[1],width/35)}));
    else if(m.type==='pen')g.append(node('polyline',{...common,points:pts.map(p=>`${p.x},${p.y}`).join(' ')}));
    else if(m.type==='text'){const t=node('text',{x:pts[0].x,y:pts[0].y,fill:color,stroke:'#fff','stroke-width':width/500,'paint-order':'stroke','font-size':width/27,'font-weight':'bold','font-family':'Arial, sans-serif'});t.textContent=m.text;g.append(t);}
  });
  if(stamp){const t=node('text',{x:width*.98,y:height*.96,'text-anchor':'end',fill:'#111',stroke:'#fff','stroke-width':width/180,'paint-order':'stroke','font-size':width/26,'font-weight':'bold','font-family':'Arial, sans-serif','data-stamp':'true'});t.textContent=stamp.slice(0,40);svg.append(t);}
}
export function createMagnifier(url,width,height){
  const lens=node('svg',{class:'target-loupe',viewBox:'0 0 128 128','aria-hidden':'true'}),picture=node('image',{href:url,width,height}),cross=node('path',{d:'M 54 64 H 74 M 64 54 V 74',stroke:'#c42e27','stroke-width':2,fill:'none'});lens.append(picture,cross);document.body.append(lens);lens.style.display='none';let timer;
  return {show(event,p,displayWidth){clearTimeout(timer);const update=()=>{const scale=displayWidth/width*2.5;picture.setAttribute('transform',`translate(${64-p.x*width*scale} ${64-p.y*height*scale}) scale(${scale})`);lens.style.left=`${clamp(event.clientX-64,8,innerWidth-136)}px`;lens.style.top=`${Math.max(8,event.clientY-156)}px`;lens.style.display='block';};if(lens.style.display==='block')update();else timer=setTimeout(update,140);},hide(){clearTimeout(timer);lens.style.display='none';},dispose(){clearTimeout(timer);lens.remove();}};
}
export async function createAnnotator(stage,url,initial,onChange,{stamp='',onPending=()=>{},onError=()=>{}}={}){
  const img=await loadImage(url),width=img.naturalWidth,height=img.naturalHeight,svg=node('svg',{'aria-label':'照片標註畫布',class:'annotation-overlay'});
  let marks=structuredClone(initial),mode='callout',text='',tone='red',draft=null,anchor=null,history=[],future=[],active=false,disposed=false;
  validateMarks(marks);stage.replaceChildren(img,svg);stage.classList.add('annotation-stage');const lens=createMagnifier(url,width,height);
  const draw=()=>{if(disposed)return;drawMarks(svg,[...marks,...(draft?[draft]:[])],width,height,{stamp,sunlight:document.documentElement.classList.contains('sunlight')});if(anchor)svg.append(node('circle',{cx:anchor.x*width,cy:anchor.y*height,r:width/150,fill:TONES[tone],stroke:'#fff','stroke-width':width/500}));onPending(Boolean(anchor));};
  const point=e=>{const r=svg.getBoundingClientRect();return {x:clamp((e.clientX-r.left)/r.width),y:clamp((e.clientY-r.top)/r.height)};};
  const checkpoint=()=>{history.push(structuredClone(marks));if(history.length>100)history.shift();future=[];};
  const commit=m=>{if(marks.length>=500){onError(Error('每張照片最多 500 個標註'));return;}checkpoint();marks.push(m);onChange(structuredClone(marks));};
  svg.addEventListener('pointerdown',e=>{
    if(mode==='view')return;e.preventDefault();svg.setPointerCapture(e.pointerId);active=true;const p=point(e);
    if(mode==='erase'){const target=e.target.closest('[data-mark-index]');if(target){checkpoint();marks.splice(+target.dataset.markIndex,1);onChange(structuredClone(marks));draw();}active=false;return;}
    if(['text','callout'].includes(mode)&&!text.trim()){onError(Error('請先輸入標註文字，或選 TP／TB 快捷鍵。'));active=false;return;}
    if(mode==='callout'){lens.show(e,p,svg.getBoundingClientRect().width);return;}
    draft={type:mode,tone,points:mode==='text'?[p]:[p,p],...(['text'].includes(mode)?{text:text.trim().slice(0,80)}:{})};draw();
  });
  svg.addEventListener('pointermove',e=>{if(!active)return;const p=point(e);if(mode==='callout'){lens.show(e,p,svg.getBoundingClientRect().width);return;}if(!draft)return;if(mode==='pen'){if(draft.points.length<1500)draft.points.push(p);}else if(mode!=='text')draft.points[1]=p;draw();});
  svg.addEventListener('pointerup',e=>{lens.hide();if(!active)return;active=false;const p=point(e);if(mode==='callout'){if(!anchor)anchor=p;else{commit({type:'callout',tone,points:[anchor,p],text:text.trim().slice(0,80)});anchor=null;}}else if(draft){if(mode==='circle'&&Math.hypot(draft.points[0].x-p.x,draft.points[0].y-p.y)<.01){draft.points=[{x:clamp(p.x-.03),y:clamp(p.y-.03)},{x:clamp(p.x+.03),y:clamp(p.y+.03)}];}commit(draft);draft=null;}draw();});
  svg.addEventListener('pointercancel',()=>{active=false;draft=null;lens.hide();draw();});document.addEventListener('tilt:displaychange',draw);draw();
  return {get marks(){return structuredClone(marks);},setMode(v){mode=v;svg.style.touchAction=mode==='view'?'pan-y':'none';svg.style.cursor=mode==='view'?'default':'crosshair';anchor=null;draft=null;draw();},setText(v){text=v;anchor=null;draw();},setTone(v){tone=v;draw();},setStamp(v){stamp=v;draw();},undo(){anchor=null;draft=null;if(history.length){future.push(structuredClone(marks));marks=history.pop();onChange(structuredClone(marks));}draw();},redo(){anchor=null;if(future.length){history.push(structuredClone(marks));marks=future.pop();onChange(structuredClone(marks));}draw();},clear(){checkpoint();marks=[];anchor=null;onChange([]);draw();},dispose(){disposed=true;lens.dispose();document.removeEventListener('tilt:displaychange',draw);}};
}
export async function markedImage(blob,marks,{stamp=''}={}){
  validateMarks(marks);const url=URL.createObjectURL(blob);let overlay;
  try{const img=await loadImage(url),scale=Math.min(1,4096/Math.max(img.naturalWidth,img.naturalHeight)),width=Math.round(img.naturalWidth*scale),height=Math.round(img.naturalHeight*scale),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(img,0,0,width,height);const svg=node('svg',{xmlns:NS,width,height});drawMarks(svg,marks,width,height,{stamp});overlay=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));ctx.drawImage(await loadImage(overlay),0,0);return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('標註影像輸出失敗')),'image/jpeg',.94));}finally{URL.revokeObjectURL(url);if(overlay)URL.revokeObjectURL(overlay);}
}
