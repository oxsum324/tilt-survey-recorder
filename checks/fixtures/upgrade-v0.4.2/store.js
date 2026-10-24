import {projectFingerprint,mediaIds,validateBackupMedia} from './integrity.js';
// IndexedDB transaction / media backup core adapted from:
// oxsum324/level-survey-recorder, store.js, commit 78f2ae02646510290854e89ff1ba901776bce9f5.
// 複製後獨立演進。 Normalization, strict import checks, and completion handlers extended here.
import {validateMarks} from './annotation-geometry.js';
import {createProject,createFacade,createPair,measurement,VERSION} from './model.js';
const DB_NAME='tilt-survey-v1';
const done=transaction=>new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error||Error('本機儲存交易已中止'));transaction.onerror=()=>reject(transaction.error);});
const result=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
async function openDatabase() {
  const request=indexedDB.open(DB_NAME,1);
  request.onupgradeneeded=()=>{for(const name of ['project','media']) if(!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);};
  return result(request);
}
async function operation(name,mode,action) {
  const db=await openDatabase();
  try {const t=db.transaction(name,mode),completion=done(t),r=result(action(t.objectStore(name)));const [value]=await Promise.all([r,completion]);return value;} finally {db.close();}
}
export const loadProject=()=>operation('project','readonly',s=>s.get('current'));
export const saveProject=p=>operation('project','readwrite',s=>s.put(p,'current'));
export const saveMedia=(id,blob)=>operation('media','readwrite',s=>s.put(blob,id));
export const loadMedia=id=>operation('media','readonly',s=>s.get(id));
export async function replaceProject(project,media=[]) {
  const db=await openDatabase();
  try {const t=db.transaction(['project','media'],'readwrite'),completion=done(t);t.objectStore('project').put(project,'current');const s=t.objectStore('media');s.clear();for(const item of media)s.put(item.blob,item.id);await completion;} finally {db.close();}
}
const object=(value)=>value&&typeof value==='object'&&!Array.isArray(value);
function identifier(value){raw(value);if(!/^[A-Za-z0-9_-]{1,100}$/.test(value))throw Error('案件或媒體識別格式無效');return value;}
function raw(value) { if(typeof value!=='string'||value.length>3000) throw Error('案件文字或原始讀數格式無效');return value; }
function mergeMeasurement(value,axis,groupMode,legacyModes) {
  if(!object(value)) throw Error('測線資料結構不完整');
  const fallback=measurement(axis),m={...fallback,...value,A:{...fallback.A,...value.A},B:{...fallback.B,...value.B}};
  for(const mode of ['A','B']) {if(!Array.isArray(m[mode].rounds)||m[mode].rounds.length<1||m[mode].rounds.length>2)throw Error('測回數量無效');}
  // Before V0.4, the group mode took precedence even over a stored direction mode.
  m.mode=(legacyModes&&value.mode!==''||value.mode===undefined)?groupMode:value.mode;if(!['','A','B','C'].includes(m.mode))throw Error('方向作業方式無效');
  raw(m.A.hCm); raw(m.skipReason);
  if(!['measured','skipped'].includes(m.status))throw Error('施測狀態無效');
  if(!['front','rightSide','leftSide'].includes(m.B.station))throw Error('測站位置無效');
  m.A.rounds=m.A.rounds.map(r=>{if(!object(r))throw Error('A 模式讀數結構無效');const a={source:'offset',upperCm:'',lowerCm:'',...r};raw(a.dxCm);raw(a.upperCm);raw(a.lowerCm);if(!['offset','ruler'].includes(a.source)||!['left','right','front','back'].includes(a.dir))throw Error('A 模式方向或讀數來源無效');return a;});
  m.B.rounds.forEach(r=>{for(const pos of ['tp','tb'])for(const key of ['HD','VD'])raw(r?.[pos]?.[key]);});
  return m;
}
export function normalizeProject(value) {
  if(!object(value)||value.schema!==1||!Array.isArray(value.facades)||!Array.isArray(value.pairs)||!value.facades.length||value.facades.length>100||value.pairs.length>200)throw Error('案件資料結構不完整或版本不支援');
  const legacyModes=value.appVersion==null||value.appVersion===''||/^0\.[0-3](?:\.|$)/.test(value.appVersion);
  const fallback=createProject(),p={...fallback,...structuredClone(value),header:{...fallback.header,...value.header},settings:{...fallback.settings,...value.settings}};
  for(const v of Object.values(p.header))raw(v);
  for(const key of ['toleranceMm','minOffsetMm','minHeightCm'])raw(p.settings[key]);
  if(!['A','B','C'].includes(p.settings.defaultMode)||!['prime','TS'].includes(p.settings.labelStyle)||typeof p.settings.showCompass!=='boolean')throw Error('案件設定無效');
  identifier(p.id);if(!p.id)throw Error('案件識別缺漏');
  for(const key of ['createdAt','updatedAt'])if(typeof p[key]!=='string'||Number.isNaN(Date.parse(p[key])))throw Error('案件時間格式無效');
  const facadeIds=new Set();
  p.facades=p.facades.map(f=>{
    if(!object(f))throw Error('立面資料無效');
    const d=createFacade(),facade={...d,...f,baseline:{...d.baseline,...f.baseline,A:{...d.baseline.A,...f.baseline?.A},B:{...d.baseline.B,...f.baseline?.B}},building:{...d.building,...f.building}};
    identifier(facade.id);raw(facade.name);raw(facade.facingDeg);if(facadeIds.has(facade.id)||!facade.id)throw Error('立面識別重複或缺漏');facadeIds.add(facade.id);
    if(!Array.isArray(facade.building.floorHeightsCm)||!facade.building.floorHeightsCm.length||facade.building.floorHeightsCm.length>60)throw Error('樓層參數無效');
    facade.building.floorHeightsCm.forEach(raw);for(const key of ['parapetCm','widthCm','sideShownCm'])raw(facade.building[key]);
    for(const side of ['A','B'])for(const key of ['N','E'])raw(facade.baseline[side][key]);raw(facade.baseline.azimuthDeg);
    if(!['none','twoPoints','azimuth'].includes(facade.baseline.method)||!['shop','house','blank'].includes(facade.building.groundFloorType))throw Error('立面參數選項無效');
    return facade;
  });
  const indexes=new Set(),ids=new Set(),photoIds=new Set();
  p.pairs=p.pairs.map(pair=>{
    if(!object(pair))throw Error('測點組無效');const d=createPair(pair.index,pair.facadeId),q={...d,...pair};
    identifier(q.id);if(!q.id||ids.has(q.id)||!Number.isInteger(q.index)||q.index<1||q.index>999||indexes.has(q.index)||!facadeIds.has(q.facadeId))throw Error('測點識別或立面引用無效');ids.add(q.id);indexes.add(q.index);
    q.mode ||= pair.inPlane?.mode||'A';if(!['A','B','C'].includes(q.mode)||!['left','right','custom'].includes(q.corner)||typeof q.sharedH!=='boolean')throw Error('測點組設定無效');
    raw(q.note);raw(q.tbHeightCm);raw(q.cornerOffsetCm);q.inPlane=mergeMeasurement(q.inPlane,'inPlane',q.mode,legacyModes);q.outPlane=mergeMeasurement(q.outPlane,'outPlane',q.mode,legacyModes);
    if(!Array.isArray(q.C?.rounds)||q.C.rounds.length<1||q.C.rounds.length>2)throw Error('座標測回數無效');for(const r of q.C.rounds)for(const pos of ['tp','tb'])for(const key of ['N','E','Z'])raw(r?.[pos]?.[key]);
    if(!Array.isArray(q.photos)||q.photos.length>500)throw Error('照片參照無效');
    for(const photo of q.photos){if(!object(photo))throw Error('照片資料無效');identifier(photo.id);identifier(photo.mediaId);if(photoIds.has(photo.id))throw Error('照片識別重複');photoIds.add(photo.id);for(const key of ['fileName','description','stampDate','capturedAt','addedAt'])raw(photo[key]);if(!['exif','import'].includes(photo.capturedAtSource)||typeof photo.showStamp!=='boolean'||photo.stampDate.length>40||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(photo.capturedAt)||Number.isNaN(Date.parse(photo.addedAt)))throw Error('照片時間或來源無效');validateMarks(photo.marks);}
    if(q.mapMarker!==null){const m=q.mapMarker;if(!object(m)||!Number.isFinite(m.x)||!Number.isFinite(m.y)||m.x<0||m.x>100||m.y<0||m.y>100)throw Error('底圖測點位置無效');for(const axis of ['inPlane','outPlane'])for(const key of ['dx','dy'])if(!Number.isFinite(m[axis]?.[key])||Math.abs(m[axis][key])>1000)throw Error('底圖標籤位置無效');}

    if(q.confirmed!==null && (!object(q.confirmed)||typeof q.confirmed.snapshot!=='string'||typeof q.confirmed.at!=='string'))throw Error('讀數確認紀錄無效');
    return q;
  });
  if(!Array.isArray(p.auditLog)||p.auditLog.length>10000)throw Error('更正紀錄無效');
  for(const log of p.auditLog) {for(const key of ['at','reason','before','after'])if(typeof log?.[key]!=='string')throw Error('更正紀錄內容無效');try{JSON.parse(log.before);JSON.parse(log.after);}catch{throw Error('更正前後紀錄格式無效');}}
  if(p.map!==null){const m=p.map;if(!object(m))throw Error('底圖資料無效');identifier(m.mediaId);for(const key of ['fileName','source','capturedOn','approxAddress','addedAt'])raw(m[key]);if(!Number.isFinite(m.width)||!Number.isFinite(m.height)||m.width<1||m.height<1||m.width*m.height>100000000||m.capturedOn&&!/^\d{4}-\d{2}-\d{2}$/.test(m.capturedOn)||Number.isNaN(Date.parse(m.addedAt)))throw Error('底圖尺寸或日期無效');}
  if(!p.map&&p.pairs.some(q=>q.mapMarker))throw Error('測點位置缺少對應底圖');
  p.appVersion=VERSION;return p;
}
const blobAsDataUrl=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});
export async function makeBackup(project,read=loadMedia,encode=blobAsDataUrl) {
  const p=normalizeProject(project),media=[];
  for(const id of mediaIds(p)) {const blob=await read(id);if(!blob)throw Error(`媒體 ${id} 缺漏，無法建立完整案件檔`);media.push({id,dataUrl:await encode(blob)});}
  return {format:'tilt-survey-case.v1',exportedAt:new Date().toISOString(),project:p,media,integrity:{algorithm:'SHA-256',sha256:await projectFingerprint(p,read)}};
}
export function parseBackup(contents) {
  if(contents.length>250*1024*1024)throw Error('案件檔超過 250 MB');
  let backup;try{backup=JSON.parse(contents);}catch{throw Error('案件檔不是有效 JSON');}
  if(backup?.format!=='tilt-survey-case.v1'||!Array.isArray(backup.media))throw Error('不是傾斜測量案件檔');
  const project=normalizeProject(backup.project),ids=new Set();
  const media=backup.media.map(item=>{
    if(!item||typeof item.id!=='string'||ids.has(item.id)||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(item.dataUrl))throw Error('案件影像格式無效或識別重複');ids.add(item.id);
    let bytes;try{bytes=Uint8Array.from(atob(item.dataUrl.split(',')[1]),c=>c.charCodeAt(0));}catch{throw Error('案件影像編碼無效');}
    if(bytes.byteLength>60*1024*1024)throw Error('單張影像超過 60 MB');return {id:item.id,blob:new Blob([bytes],{type:item.dataUrl.split(';')[0].slice(5)})};
  });
  validateBackupMedia(project,media);
  if(backup.integrity!==undefined&&(backup.integrity?.algorithm!=='SHA-256'||! /^[a-f0-9]{64}$/.test(backup.integrity.sha256)))throw Error('案件指紋格式無效');
  return {project,media,integrity:backup.integrity||null};
}
