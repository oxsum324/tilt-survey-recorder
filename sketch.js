import {labels} from './model.js';
export const escapeXml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=(value,min,max,name)=>{if(typeof value!=='string'||!value.trim()||!/^\d+(\.\d*)?$/.test(value)||!Number.isFinite(+value)||+value<min||+value>max)throw Error(`${name}參數無效`);return +value;};
export function buildingParameters(facade,pair) {
  const b=facade.building,floors=b.floorHeightsCm.map(v=>finite(v,1,10000,'樓高'));
  const width=finite(b.widthCm,1,100000,'立面寬'),side=finite(b.sideShownCm,1,100000,'側立面長度'),parapet=finite(b.parapetCm,0,5000,'女兒牆');
  const tb=pair.tbHeightCm===''?null:finite(pair.tbHeightCm,0,100000,'TB 離地高度');
  const offset=pair.corner==='custom'?finite(pair.cornerOffsetCm,0,width,'測線位置'):null;
  return {floors,width,side,parapet,tb,offset,total:floors.reduce((a,b)=>a+b,0)+parapet};
}
export function sketchGeometry(pair,facade,result,axis,settings={}) {
  const p=buildingParameters(facade,pair),h=Number(result.hCm),tb=p.tb??p.total*0.17,tp=tb+h;
  const bounds=Math.max(p.total,tp),side=axis==='outPlane',left=pair.corner==='left';
  const physicalWidth=side?p.side:p.width;
  const omitted=[];let cumulative=0;
  if(p.floors.length>6) {
    for(let i=0;i<p.floors.length;i++) {
      const bottom=cumulative,top=bottom+p.floors[i];cumulative=top;
      const nearMeasurement=top>=tb-(p.floors[i]||320)&&bottom<=tp+(p.floors[i]||320);
      if(i>0&&i<p.floors.length-1&&!nearMeasurement)omitted.push([bottom,top]);
    }
  }
  const compress=z=>{let y=z;for(const [a,b]of omitted)y-=Math.max(0,Math.min(z,b)-a)*0.94;return y;};
  const effective=compress(bounds),scale=Math.min(64/effective,23/physicalWidth),ground=72;
  const y=z=>ground-compress(z)*scale;
  const width=physicalWidth*scale;
  const x0=side?(left?12:19):(left?21:12),x1=x0+width;
  const x=side?(left?x1:x0):pair.corner==='custom'?x0+p.offset*scale:left?x0:x1;
  const outward=side?!left:left,dimensionX=outward?5:43,labelX=outward?12:35;
  const sign=result.direction==='right'||result.direction==='back'?1:-1;
  const screenSign=axis==='outPlane'&&left?-sign:sign;
  const tiltTb={x:69,y:64},tiltTp={x:69+(result.dxMm===0?0:screenSign*8.16),y:16};
  return {parameters:p,scale,ground,x0,x1,pointX:x,dimensionX,labelX,outward,side,left,omitted,compressed:omitted.length>0,
    tb:{x,y:y(tb)},tp:{x,y:y(tp)},floorY:z=>y(z),roofY:y(p.total),h,actualTb:tb,tiltTb,tiltTp,labels:labels(pair,settings)};
}
export function sketch(pair,facade,result,axis,settings={}) {
  if(result.status!=='ok')return {svg:'',texts:[],geometry:null};
  const g=sketchGeometry(pair,facade,result,axis,settings),parts=[],texts=[];
  const line=(x1,y1,x2,y2,w=.18,extra='')=>parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#111" stroke-width="${w}" ${extra}/>`);
  const text=(x,y,value,size=2.3,anchor='middle',rotate=false,bold=false)=>{
    const width=[...String(value)].reduce((sum,c)=>sum+(/[\u2e80-\uffff]/.test(c)?size:size*.56),0);
    const box=rotate?{x:x-size*.8,y:y-width/2,w:size,h:width}:{x:x-(anchor==='middle'?width/2:anchor==='end'?width:0),y:y-size*.82,w:width,h:size};
    texts.push({value,...box});
    parts.push(`<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" ${rotate?`transform="rotate(-90 ${x} ${y})"`:''} ${bold?'font-weight="700"':''}>${escapeXml(value)}</text>`);
  };
  const circle=(p)=>parts.push(`<circle cx="${p.x}" cy="${p.y}" r=".75" fill="#111"/>`);
  const tick=(x,y)=>line(x-.8,y+.8,x+.8,y-.8,.26);
  const dimension=(x,y1,y2,value)=>{line(x,y1,x,y2);tick(x,y1);tick(x,y2);text(x-1,(y1+y2)/2,value,2.3,'middle',true);};
  const rect=(x,y,w,h,lw=.15)=>parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#111" stroke-width="${lw}"/>`);
  line(48,4,48,84,.1,'stroke-dasharray=".8 .8"');
  line(9,g.ground,46,g.ground,.45);for(let x=9;x<45;x+=1.5)line(x,g.ground+1.4,x+1.4,g.ground,.12);
  text(9,g.ground-1,'GL',1.9,'end');
  rect(g.x0,g.roofY,g.x1-g.x0,g.ground-g.roofY,.45);
  let cumulative=0;
  g.parameters.floors.forEach((h,i)=>{
    cumulative+=h;const y=g.floorY(cumulative),isOmitted=g.omitted.some(([a,b])=>cumulative>a&&cumulative<=b);
    if(!isOmitted) {
      line(g.x0,y,g.x1,y,.18);
      text(g.side?(g.left?g.x0-1:g.x1+1):(g.left?g.x1+1:g.x0-1),y+.6,i===g.parameters.floors.length-1?'RFL':`${i+2}FL`,1.9,g.side?(g.left?'end':'start'):(g.left?'start':'end'));
      if(!g.side&&facade.building.showOpenings&&i>0) {
        const lower=cumulative-h,windowHeight=Math.min(150,h*.45),sill=Math.min(90,h*.25),wy=g.floorY(lower+sill+windowHeight),wh=(windowHeight*g.scale);
        rect(g.x0+(g.x1-g.x0)*.22,wy,(g.x1-g.x0)*.56,wh);line((g.x0+g.x1)/2,wy,(g.x0+g.x1)/2,wy+wh,.15);
        line(g.x0+(g.x1-g.x0)*.2,wy+wh,g.x0+(g.x1-g.x0)*.8,wy+wh,.15);
      }
    }
  });
  if(!g.side&&facade.building.showOpenings&&facade.building.groundFloorType!=='blank') {
    const w=g.x1-g.x0,doorH=Math.min(250,g.parameters.floors[0]*.8)*g.scale,doorW=w*.18;
    rect(g.x0+w*.08,g.ground-doorH,doorW,doorH);
    const shop=facade.building.groundFloorType==='shop',h=shop?doorH:doorH*.5,top=g.ground-doorH;
    rect(g.x0+w*.38,top,w*.52,h);if(shop)for(let y=top+1.4;y<g.ground;y+=1.4)line(g.x0+w*.38,y,g.x0+w*.9,y,.12);
  }
  if(g.side) {
    const edge=g.left?g.x0:g.x1,mid=(g.roofY+g.ground)/2;
    parts.push(`<path d="M${edge} ${mid-3} l1.5 1.5 l-3 1.5 l1.5 1.5" fill="white" stroke="#111" stroke-width=".3"/>`);
    text((g.x0+g.x1)/2,g.roofY-2,g.left?'後 ← 前':'前 → 後',2.1);
  }
  if(g.compressed) {
    for(const [a,b]of g.omitted.filter((v,i,all)=>i===0||all[i-1][1]!==v[0])) {
      const y=g.floorY((a+b)/2);parts.push(`<path data-break="floor" d="M${g.x0} ${y} l${(g.x1-g.x0)*.35} -1 l${(g.x1-g.x0)*.3} 2 l${(g.x1-g.x0)*.35} -1" fill="none" stroke="#111" stroke-width=".3"/>`);
    }
  }
  line(g.tb.x,g.tb.y,g.tp.x,g.tp.y,.8);circle(g.tb);circle(g.tp);
  const tpLabelY=g.tp.y-2,tbLabelY=g.tb.y+4;
  line(g.tp.x,g.tp.y,g.labelX,tpLabelY,.13);line(g.tb.x,g.tb.y,g.labelX,tbLabelY-.6,.13);
  text(g.labelX,tpLabelY,g.labels.tp,2.4,g.outward?'end':'start',false,true);text(g.labelX,tbLabelY,g.labels.tb,2.4,g.outward?'end':'start',false,true);
  line(g.tb.x,g.tb.y,g.dimensionX,g.tb.y,.13);line(g.tp.x,g.tp.y,g.dimensionX,g.tp.y,.13);
  dimension(g.dimensionX,g.tb.y,g.tp.y,result.hCm);
  if(g.parameters.tb!==null&&g.parameters.tb>0) {line(g.x0,g.ground,g.dimensionX,g.ground,.13);dimension(g.dimensionX,g.ground,g.tb.y,pair.tbHeightCm);}
  if(g.parameters.tb===null)text(24,77,'TB 離地高度未量測，位置示意',1.65);
  if(g.compressed)text(24,79.5,'中間樓層省略，尺寸以標註為準',1.65);
  text(24,83,g.side?`側立面示意（${g.left?'左':'右'}側視，僅繪前段）`:'正立面示意（面向立面）',1.9);
  line(g.tiltTb.x,11,g.tiltTb.x,68,.18,'stroke-dasharray="1 1"');
  line(g.tiltTb.x,g.tiltTb.y,g.tiltTp.x,g.tiltTp.y,.55);circle(g.tiltTb);circle(g.tiltTp);
  text(g.tiltTb.x+2,g.tiltTb.y+1,g.labels.tb,2.4,'start',false,true);text(g.tiltTp.x+2,g.tiltTp.y+1,g.labels.tp,2.4,'start',false,true);
  line(g.tiltTb.x,9,g.tiltTp.x,9);tick(g.tiltTb.x,9);if(result.dxMm!==0)tick(g.tiltTp.x,9);
  line(g.tiltTb.x,9,g.tiltTb.x,16,.13);line(g.tiltTp.x,9,g.tiltTp.x,16,.13);text(71,6,`△X＝${result.dxCm}`,2.3);
  dimension(55,g.tiltTb.y,g.tiltTp.y,`H＝${result.hCm}`);line(55,16,g.tiltTp.x,16,.13);line(55,64,g.tiltTb.x,64,.13);
  text(69,69,'鉛垂線',1.9);
  const leftWord=axis==='inPlane'?'左':g.left?'後':'前',rightWord=axis==='inPlane'?'右':g.left?'前':'後';
  text(52,76,leftWord,2.2);text(90,76,rightWord,2.2);
  if(result.dxMm) {const sign=g.tiltTp.x>g.tiltTb.x?1:-1;line(67,75,67+sign*8,75,.3);line(67+sign*8,75,67+sign*6.8,73.9,.3);line(67+sign*8,75,67+sign*6.8,76.1,.3);}
  text(71,82,'傾斜示意（角度放大，非依比例）',1.9);
  return {svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 93 87" role="img" aria-label="${escapeXml(g.labels[axis])}立面與傾斜示意" font-family="Noto Sans TC,Microsoft JhengHei,PingFang TC,sans-serif" fill="#111"><rect width="93" height="87" fill="white"/>${parts.join('')}</svg>`,texts,geometry:g};
}
