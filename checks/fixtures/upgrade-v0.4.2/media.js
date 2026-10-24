import {id} from './model.js';
import {loadImage} from './annotation.js';
import {captureTime} from './exif.js';
export async function inspectImage(file){
  if(file.size>60*1024*1024)throw Error('單張影像最多 60 MB');
  const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());
  const type=bytes[0]===255&&bytes[1]===216?'image/jpeg':bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71?'image/png':String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'?'image/webp':null;
  if(!type)throw Error('目前支援 JPEG、PNG、WebP。HEIC／其他格式請先轉存為 JPEG。');
  const blob=file.type===type?file:new Blob([file],{type}),url=URL.createObjectURL(blob);
  try{const img=await loadImage(url);if(img.naturalWidth*img.naturalHeight>100000000)throw Error('影像超過 1 億像素，請先縮小後匯入');return {blob,width:img.naturalWidth,height:img.naturalHeight};}finally{URL.revokeObjectURL(url);}
}
export async function photoRecord(file,pair){const addedAt=new Date().toISOString(),time=await captureTime(file,addedAt);return {id:id(),mediaId:id(),fileName:file.name||'相機照片',description:`傾斜測量／點位：T${pair.index}`,addedAt,...time,stampDate:time.capturedAt.slice(0,10).replaceAll('-','/'),showStamp:true,marks:[]};}
export const stampText=photo=>photo.showStamp?photo.stampDate:'';
export const blobDataUrl=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
export function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name.replace(/[<>:"/\\|?*]/g,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export async function previewUrl(blob){const original=URL.createObjectURL(blob);try{const img=await loadImage(original);if(Math.max(img.naturalWidth,img.naturalHeight)<=4096)return original;const scale=4096/Math.max(img.naturalWidth,img.naturalHeight),c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*scale);c.height=Math.round(img.naturalHeight*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);const small=await new Promise(r=>c.toBlob(r,'image/jpeg',.92));if(!small)throw Error('預覽產生失敗');URL.revokeObjectURL(original);return URL.createObjectURL(small);}catch(e){URL.revokeObjectURL(original);throw e;}}
