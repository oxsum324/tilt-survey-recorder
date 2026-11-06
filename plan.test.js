import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {calculatePair} from './calc.js';
import {tiltArrowLength,TILT_ARROW_REFERENCE_DX_MM,TILT_ARROW_REFERENCE_LENGTH,TILT_ARROW_MIN_LENGTH,TILT_ARROW_MAX_LENGTH,TILT_ARROW_START} from './plan.js';
import {sampleProject,confirmObservation} from './model.js';
import {planVectors,tiltVector,facingGlyph,tiltArrows,planSvg,imageBounds,markerAt} from './plan.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} ≠ ${b}`);
const withMap=()=>{const p=sampleProject();p.map={mediaId:'m',fileName:'map.png',source:'合成',capturedOn:'2026-10-01',approxAddress:'',addedAt:new Date().toISOString(),width:800,height:600};const b=imageBounds(800,600);for(const [i,pair] of p.pairs.entries())pair.mapMarker=markerAt(30+i*20,50,b);return p;};
const segment=markup=>{const m=markup.match(/d="M ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+)/);return {x1:+m[1],y1:+m[2],x2:+m[3],y2:+m[4]};};
test('外法線 0° 朝底圖上方，觀測者面向立面時右手為底圖左側',()=>{const v=planVectors(0);near(v.normal.x,0);near(v.normal.y,-1);near(v.right.x,-1);near(v.right.y,0);});
test('外法線 90° 朝右，右手為底圖上方；180° 與 0° 相反',()=>{const v=planVectors(90);near(v.normal.x,1);near(v.normal.y,0);near(v.right.x,0);near(v.right.y,-1);const w=planVectors(180);near(w.normal.y,1);near(w.right.x,1);});
test('傾斜方向向量：前＝外法線、後＝相反、左右互為相反且垂直於法線',()=>{for(const deg of [0,37,90,215]){const n=planVectors(deg).normal,f=tiltVector('front',deg),b=tiltVector('back',deg),l=tiltVector('left',deg),r=tiltVector('right',deg);near(f.x,n.x);near(f.y,n.y);near(b.x,-n.x);near(b.y,-n.y);near(l.x,-r.x);near(l.y,-r.y);near(l.x*n.x+l.y*n.y,0);}assert.equal(tiltVector('none',0),null);});
test('未設定朝向：不畫視向符號與傾斜箭頭，佈設圖與舊版相同',()=>{const p=withMap();assert.equal(facingGlyph({x:10,y:10},p.facades[0]),'');assert.equal(tiltArrows({x:10,y:10},p.pairs[0],p.facades[0],p.settings),'');assert.doesNotMatch(planSvg(p,'data:,'),/data-glyph|data-tilt/);});
test('設定朝向後：每組畫視向符號、左右字樣，已確認組畫實線立面內與虛線立面外箭頭',()=>{const p=withMap();p.facades[0].planNormalDeg=90;const svg=planSvg(p,'data:,');assert.equal((svg.match(/data-glyph="facing"/g)||[]).length,2);assert.match(svg,/>左<\/text>/);assert.match(svg,/>右<\/text>/);assert.equal((svg.match(/data-tilt="inPlane" data-direction="right"/g)||[]).length,2);assert.match(svg,/data-tilt="outPlane" data-direction="back"[^>]*stroke-dasharray/);});
test('向右傾的箭頭沿右手向量；朝向反轉 180° 後箭頭反向',()=>{const p=withMap(),pair=p.pairs[0],f=p.facades[0],point={x:50,y:50};f.planNormalDeg=0;const a=segment(tiltArrows(point,pair,f,p.settings));near(a.y1,a.y2);assert.ok(a.x2<a.x1,'0° 時右手為底圖左側');f.planNormalDeg=180;const b=segment(tiltArrows(point,pair,f,p.settings));assert.ok(b.x2>b.x1);});
test('視向箭頭由外側指向立面，尾端在外法線側',()=>{const f={planNormalDeg:0},g=facingGlyph({x:50,y:50},f),m=g.match(/<path d="M ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+)/);assert.ok(+m[2]<50,'尾端在上方（外法線側）');assert.ok(+m[4]<50&&+m[4]>+m[2],'箭頭朝向測點');assert.match(g,/data-degrees="0"/);});
test('未確認或零偏移的分量不畫傾斜箭頭，視向符號仍畫',()=>{const p=withMap(),f=p.facades[0];f.planNormalDeg=45;const unconfirmed=p.pairs[1];unconfirmed.confirmed=null;assert.equal(tiltArrows({x:1,y:1},unconfirmed,f,p.settings),'');const zero=p.pairs[0];zero.inPlane.A.rounds[0].dxCm='0';confirmObservation(p,zero,f,'測試');const arrows=tiltArrows({x:1,y:1},zero,f,p.settings);assert.doesNotMatch(arrows,/data-tilt="inPlane"/);assert.match(arrows,/data-tilt="outPlane"/);assert.match(facingGlyph({x:1,y:1},f),/data-degrees="45"/);});
test('更改底圖朝向或示意位置不影響讀數確認狀態',async()=>{const {isConfirmed}=await import('./model.js');const p=withMap(),pair=p.pairs[0],f=p.facades[0];assert.equal(isConfirmed(pair,f),true);f.planNormalDeg=135;f.building.sketchMode='schematic';pair.sketchMarks={tb:.2,tp:.7};assert.equal(isConfirmed(pair,f),true);});

test('箭身長度：小值取下限、大值取上限、中間值單調增加',()=>{
  assert.equal(tiltArrowLength(0),TILT_ARROW_MIN_LENGTH);
  assert.equal(tiltArrowLength(1),TILT_ARROW_MIN_LENGTH);
  assert.equal(tiltArrowLength(100),TILT_ARROW_MAX_LENGTH);
  assert.equal(TILT_ARROW_REFERENCE_DX_MM,16);
  near(tiltArrowLength(TILT_ARROW_REFERENCE_DX_MM),TILT_ARROW_REFERENCE_LENGTH);
  const values=[12,16,20].map(tiltArrowLength);
  assert.ok(values[0]<values[1]&&values[1]<values[2]);
  near(tiltArrowLength(-16),tiltArrowLength(16));
});

test('實際箭身依各分量水平偏移量縮放，箭尾位置固定，量測資料不變；改變 H 不改箭長',()=>{
  const p=withMap(),pair=p.pairs[0],f=p.facades[0],point={x:50,y:50};f.planNormalDeg=0;
  const before=structuredClone(p),result=calculatePair(pair,f,p.settings);
  const paths=tiltArrows(point,pair,f,p.settings).match(/<path[^>]+>/g);
  for(const [i,axis] of ['inPlane','outPlane'].entries()){
    const s=segment(paths[i]);near(Math.hypot(s.x1-point.x,s.y1-point.y),TILT_ARROW_START);
    near(Math.hypot(s.x2-s.x1,s.y2-s.y1),tiltArrowLength(result[axis].dxMm));
  }
  assert.deepEqual(p,before);
  pair.inPlane.A.hCm=String(Number(pair.inPlane.A.hCm)*2);confirmObservation(p,pair,f,'測試');
  const changed=calculatePair(pair,f,p.settings);
  assert.equal(changed.inPlane.dxMm,result.inPlane.dxMm);
  near(changed.inPlane.hMm,result.inPlane.hMm*2);
  assert.ok(changed.inPlane.dxMm/changed.inPlane.hMm<result.inPlane.dxMm/result.inPlane.hMm);
  assert.equal(tiltArrows(point,pair,f,p.settings),paths.join(''));
});

test('引線與傾斜箭頭具分類屬性與不同線寬，圖例共用相同線型',()=>{
  const p=withMap();p.facades[0].planNormalDeg=90;
  for(const editor of [false,true]){
    const svg=planSvg(p,'data:,',{editor});
    const callouts=svg.match(/<path class="callout" data-kind="callout"[^>]+>/g);
    const tilts=svg.match(/<path class="tilt" data-kind="tilt" data-tilt="[^"]+" data-direction="[^"]+"[^>]+>/g);
    assert.equal(callouts.length,4);assert.equal(tilts.length,4);
    for(const path of callouts)assert.match(path,/stroke-width=".4"/);
    for(const path of tilts)assert.match(path,/stroke-width="1"/);
    const legend=svg.match(/<g data-legend="tilt"[^]*?<\/g>/)[0];
    for(const label of ['文字框引線','面內傾斜','面外傾斜'])assert.ok(legend.includes(label));
    assert.equal((legend.match(/<path /g)||[]).length,3);
    assert.match(legend,/stroke-width=".4"/);assert.match(legend,/stroke-width="1" stroke-dasharray="2.2 1"/);
    assert.doesNotMatch(legend,/data-handle|data-tilt=/);
    assert.equal((svg.match(/data-handle="point"/g)||[]).length,editor?2:0);
    assert.equal((svg.match(/data-handle="label"/g)||[]).length,editor?4:0);
  }
});

test('有箭頭才有圖例；未確認、零偏移、無測點均不加圖例',()=>{
  const p=withMap();p.facades[0].planNormalDeg=90;
  assert.match(planSvg(p,'data:,'),/data-legend="tilt"/);
  for(const pair of p.pairs)pair.confirmed=null;
  assert.doesNotMatch(planSvg(p,'data:,'),/data-legend|data-kind/);
  for(const pair of p.pairs){for(const axis of ['inPlane','outPlane'])pair[axis].A.rounds[0].dxCm='0';confirmObservation(p,pair,p.facades[0],'測試');}
  assert.doesNotMatch(planSvg(p,'data:,'),/data-legend|data-kind/);
  for(const pair of p.pairs)pair.mapMarker=null;
  assert.doesNotMatch(planSvg(p,'data:,'),/data-legend/);
});

test('圖例位於紙面角落，橫向底圖時放在底圖外留白',()=>{
  const p=withMap();p.facades[0].planNormalDeg=90;
  const svg=planSvg(p,'data:,'),m=svg.match(/data-legend="tilt" transform="translate\((\d+) (\d+)\)"/),x=+m[1],y=+m[2],b=imageBounds(800,600);
  assert.ok(x>=0&&x+39<=180&&y>=0&&y+21<=210);
  assert.ok(y+21<=b.y||y>=b.y+b.h);
});

// 起始 HEAD 9445d870 的完整 SVG 雜湊；固定測點 ID 以比對編輯把手。
test('未設定朝向或無傾斜箭頭時，畫面及輸出 SVG 與起始版本逐字相同',()=>{
  const p=withMap();for(const [i,pair] of p.pairs.entries())pair.id=`pair-${i}`;
  const expected=[
    ['c02403faf8253a950fce99ce24d43a60127819124aa7d99877b9e1edae38c9c5','337acbb5fe708690af24cd3359cb969d612a86df24c0891584def2a99a91cce6'],
    ['b6255c44782504fcc58a46389ead9fa8ac3d380d1b8cb759bee303b6cc013ec5','4e9f85a027747aaa7e743063141bdd5507770de5eb59378ebfa3ee14470afd36']
  ];
  for(const facing of [false,true]){
    if(facing){p.facades[0].planNormalDeg=90;for(const pair of p.pairs)pair.confirmed=null;}
    for(const editor of [false,true])assert.equal(createHash('sha256').update(planSvg(p,'data:,',{editor})).digest('hex'),expected[+facing][+editor]);
  }
});
