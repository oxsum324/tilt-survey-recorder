// Adapted from oxsum324/level-survey-recorder, integrity.js,
// commit 78f2ae02646510290854e89ff1ba901776bce9f5. 複製後獨立演進。
// Field selection and original-media lookup follow the tilt survey data model.
function ordered(value){
 if(Array.isArray(value))return value.map(item=>item===undefined?null:ordered(item));
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,ordered(value[key])]));
 return value;
}
export const canonicalize=value=>JSON.stringify(ordered(value));
export const EXCLUDED_FIELDS=['appVersion','createdAt','updatedAt','lastExportedAt','nextPairIndex','settings.defaultMode'];
export function fingerprintPayload(project,mediaHashes=[]){
 const evidence=structuredClone(project);for(const key of EXCLUDED_FIELDS.filter(k=>!k.includes('.')))delete evidence[key];if(evidence.settings)delete evidence.settings.defaultMode;
 return {project:evidence,mediaHashes:mediaHashes.map(({id,sha256})=>({id,sha256})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)};
}
const hex=buffer=>[...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');
export const sha256Blob=async blob=>hex(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()));
export async function fingerprint(project,mediaHashes=[]){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalize(fingerprintPayload(project,mediaHashes)))));}
export const mediaIds=project=>[...new Set([project.map?.mediaId,...project.pairs.flatMap(p=>p.photos.map(photo=>photo.mediaId))].filter(Boolean))];
export function validateBackupMedia(project,media){
 const required=new Set(mediaIds(project)),ids=new Set();
 for(const item of media){if(ids.has(item.id))throw Error('案件媒體識別重複');if(!required.has(item.id))throw Error('案件含未引用的媒體原檔，無法完整驗證');ids.add(item.id);}
 for(const id of required)if(!ids.has(id))throw Error('案件缺少照片或底圖原檔');
}
export async function projectFingerprint(project,read){
 const ids=mediaIds(project),hashes=[];
 for(const id of ids){const blob=await read(id);if(!blob)throw Error('資料指紋缺少媒體原檔');hashes.push({id,sha256:await sha256Blob(blob)});}
 return fingerprint(project,hashes);
}
export async function verifyFingerprint({project,media,integrity}){
 validateBackupMedia(project,media);
 const blobs=new Map(media.map(m=>[m.id,m.blob])),actual=await projectFingerprint(project,async id=>blobs.get(id));
 return {actual,expected:integrity?.sha256||null,matches:integrity?actual===integrity.sha256:null};
}
