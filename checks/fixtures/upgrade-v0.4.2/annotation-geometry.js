export const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,v));
export function validateMarks(marks){
  if(!Array.isArray(marks)||marks.length>500)throw Error('每張照片最多 500 個標註');
  for(const m of marks){
    if(!['callout','circle','arrow','pen','text'].includes(m?.type)||!['red','blue','black'].includes(m.tone)||!Array.isArray(m.points)||m.points.length<1||m.points.length>1500)throw Error('照片標註格式無效');
    if(['callout','circle','arrow'].includes(m.type)&&m.points.length!==2)throw Error('標註座標數量無效');
    for(const p of m.points)if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1)throw Error('標註位置超出照片');
    if(['text','callout'].includes(m.type)&&(typeof m.text!=='string'||!m.text.trim()||m.text.length>80))throw Error('標註文字須為 1 至 80 字');
  }return marks;
}
export function calloutGeometry(mark,width,height){
  const target={x:mark.points[0].x*width,y:mark.points[0].y*height},anchor=mark.points[1],font=width/22,pad=width/100;
  const textWidth=[...mark.text].reduce((sum,c)=>sum+(/[\u2e80-\uffff]/.test(c)?1:.65)*font,0),w=Math.min(width,textWidth+pad*2),h=font*1.35+pad*2;
  const box={x:clamp(anchor.x*width-w/2,0,width-w),y:clamp(anchor.y*height-h/2,0,height-h),w,h};
  const edges=[{x:box.x,y:box.y+h/2},{x:box.x+w,y:box.y+h/2},{x:box.x+w/2,y:box.y},{x:box.x+w/2,y:box.y+h}];
  const start=edges.reduce((a,b)=>Math.hypot(b.x-target.x,b.y-target.y)<Math.hypot(a.x-target.x,a.y-target.y)?b:a);
  return {target,start,box,font,pad};
}
export function arrowPath(a,b,size){const angle=Math.atan2(b.y-a.y,b.x-a.x);return `M ${a.x} ${a.y} L ${b.x} ${b.y} M ${b.x-size*Math.cos(angle-.48)} ${b.y-size*Math.sin(angle-.48)} L ${b.x} ${b.y} L ${b.x-size*Math.cos(angle+.48)} ${b.y-size*Math.sin(angle+.48)}`;}
