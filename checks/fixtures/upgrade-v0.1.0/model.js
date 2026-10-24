export const VERSION='0.1.0';
export const id=()=>crypto.randomUUID();
const point=()=>({N:'',E:'',Z:''});
export function measurement(axis) { return {status:'measured',skipReason:'',A:{rounds:[{source:'offset',dxCm:'',upperCm:'',lowerCm:'',dir:axis==='inPlane'?'right':'back'}],hCm:''},B:{station:axis==='inPlane'?'rightSide':'front',rounds:[{tp:{HD:'',VD:''},tb:{HD:'',VD:''}}]},firstEnteredAt:null}; }
export function createFacade(name='立面 1') { return {id:id(),name,facingDeg:'',baseline:{method:'none',A:{N:'',E:''},B:{N:'',E:''},azimuthDeg:''},building:{floorHeightsCm:['360','320','320','320'],parapetCm:'110',widthCm:'450',sideShownCm:'500',groundFloorType:'shop',showOpenings:true}}; }
export function createPair(index,facadeId,mode='A') { return {id:id(),index,facadeId,mode,corner:'right',cornerOffsetCm:'',tbHeightCm:'',note:'',sharedH:true,inPlane:measurement('inPlane'),outPlane:measurement('outPlane'),C:{rounds:[{tp:point(),tb:point()}]},photos:[],mapMarker:null,confirmed:null}; }
export function createProject() {
  const facade=createFacade(),now=new Date().toISOString();
  return {schema:1,id:id(),appVersion:VERSION,createdAt:now,updatedAt:now,lastExportedAt:null,
    header:{orgName:'',caseNumber:'',householdNo:'',address:'',surveyDate:'',surveyor:'',instrument:''},
    settings:{defaultMode:'A',toleranceMm:'3',minOffsetMm:'3',minHeightCm:'200',labelStyle:'prime',showCompass:false},
    facades:[facade],pairs:[createPair(1,facade.id)],map:null,auditLog:[],compareTo:null};
}
export function labels(pair,settings) {return {inPlane:`T${pair.index}`,outPlane:settings.labelStyle==='TS'?`S${pair.index}`:`T${pair.index}′`,tp:`TP${pair.index}`,tb:`TB${pair.index}`};}
function stable(value) { if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value; }
export function observationSnapshot(pair,facade) {
  // Only adopted data are included. Alternative modes remain intact but inactive.
  return JSON.stringify(stable({mode:pair.mode,sharedH:pair.mode==='A'?pair.sharedH:undefined,
    sharedHeight:pair.mode==='A'&&pair.sharedH?pair.inPlane.A.hCm:undefined,
    inPlane:pair.inPlane.status==='skipped'?{status:'skipped',reason:pair.inPlane.skipReason}:{status:'measured',data:adopted(pair.inPlane,pair.mode)},
    outPlane:pair.outPlane.status==='skipped'?{status:'skipped',reason:pair.outPlane.skipReason}:{status:'measured',data:adopted(pair.outPlane,pair.mode)},
    C:pair.mode==='C'?{rounds:pair.C.rounds}:undefined,baseline:pair.mode==='C'?facade.baseline:undefined}));
}
function adopted(m,mode){return mode==='C'?undefined:mode==='A'?{hCm:m.A.hCm,rounds:m.A.rounds}:{station:m.B.station,rounds:m.B.rounds};}
export function isConfirmed(pair,facade) {return pair.confirmed?.snapshot===observationSnapshot(pair,facade);}
export function confirmObservation(project,pair,facade,reason='') {
  const snapshot=observationSnapshot(pair,facade),now=new Date().toISOString();
  if(pair.confirmed&&pair.confirmed.snapshot!==snapshot) {
    if(!reason.trim()) throw Error('已確認讀數更正須填原因');
    project.auditLog.push({id:id(),pairId:pair.id,index:pair.index,at:now,reason,before:pair.confirmed.snapshot,after:snapshot});
  }
  pair.confirmed={snapshot,at:now};
  for(const axis of ['inPlane','outPlane']) pair[axis].firstEnteredAt ||= now;
}
export function sampleProject() {
  const project=createProject(); project.header={...project.header,orgName:'○○市土木技師公會',caseNumber:'合成示例',householdNo:'01',instrument:'示例全站儀',surveyDate:'2026-09-30',surveyor:'合成示例',address:'合成示例（非真實案件）'};
  project.facades[0].name='前側立面（示例）';
  project.pairs.push(createPair(2,project.facades[0].id));
  for(const [i,p] of project.pairs.entries()) {
    p.inPlane.A.hCm=i?'357.9':'486.5';p.outPlane.A.hCm=p.inPlane.A.hCm;
    p.inPlane.A.rounds[0].dxCm=i?'1.9':'2.3';p.outPlane.A.rounds[0].dxCm=i?'2.0':'2.9';p.tbHeightCm='395';
    confirmObservation(project,p,project.facades[0]);
  }
  return project;
}
