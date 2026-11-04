import {sketch} from './sketch.js';
import {calculatePair} from './calc.js';
// 示意模式立面上以點選／拖曳決定 TB、TP 的相對高度（0＝地面、1＝屋頂）。只改 pair.sketchMarks，不改讀數。
export function createSketchEditor(stage,pair,facade,settings,onChange){
  let target='tb',svg,geometry,dragging=false,fromHandle=false;
  const draw=()=>{const out=sketch(pair,facade,calculatePair(pair,facade,settings).inPlane,'inPlane',settings,{editor:true});stage.innerHTML=out.svg;svg=stage.firstElementChild;geometry=out.geometry;};
  const point=e=>{const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;return p.matrixTransform(svg.getScreenCTM().inverse());};
  const place=p=>{const g=geometry,rel=Math.max(0,Math.min(1,(g.ground-p.y)/(g.ground-g.roofY))),marks={...g.marks};
    if(target==='tb')marks.tb=Math.min(rel,marks.tp-.02);else marks.tp=Math.max(rel,marks.tb+.02);
    pair.sketchMarks={tb:Math.round(marks.tb*1000)/1000,tp:Math.round(marks.tp*1000)/1000};draw();};
  stage.addEventListener('pointerdown',e=>{e.preventDefault();const handle=e.target.closest('[data-sketch-handle]');fromHandle=!!handle;if(handle)target=handle.dataset.sketchHandle;dragging=true;stage.setPointerCapture(e.pointerId);place(point(e));});
  stage.addEventListener('pointermove',e=>{if(dragging)place(point(e));});
  const finish=()=>{if(!dragging)return;dragging=false;if(!fromHandle&&target==='tb')target='tp';onChange(target);};
  stage.addEventListener('pointerup',finish);stage.addEventListener('pointercancel',finish);
  draw();
  return {draw,target:()=>target,setTarget(v){target=v;},clear(){pair.sketchMarks=null;draw();onChange(target);}};
}
