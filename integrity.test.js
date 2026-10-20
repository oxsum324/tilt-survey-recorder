import test from 'node:test';import assert from 'node:assert/strict';import {canonicalize,fingerprint,projectFingerprint,verifyFingerprint,sha256Blob,EXCLUDED_FIELDS} from './integrity.js';import {sampleProject} from './model.js';import {makeBackup,parseBackup} from './store.js';import {fullReport} from './media-report.js';
const reverse=value=>Array.isArray(value)?value.map(reverse):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reverse(v)])):value;
test('鍵序不同時 canonicalize 與指紋相同',async()=>{const p=sampleProject();assert.equal(canonicalize(p),canonicalize(reverse(p)));assert.equal(await fingerprint(p),await fingerprint(reverse(p)));});
test('改一筆讀數會改變指紋',async()=>{const p=sampleProject(),before=await fingerprint(p);p.pairs[0].inPlane.A.rounds[0].dxCm='2.4';assert.notEqual(await fingerprint(p),before);});
test('每個排除欄位個別變更不改變指紋',async()=>{const p=sampleProject(),before=await fingerprint(p);for(const key of EXCLUDED_FIELDS){const q=structuredClone(p);if(key.includes('.'))q.settings.defaultMode='C';else q[key]='excluded-change';assert.equal(await fingerprint(q),before,key);}});
test('媒體排序穩定，媒體雜湊變動影響指紋',async()=>{const p=sampleProject(),hashes=[{id:'b',sha256:'b'},{id:'a',sha256:'a'}];assert.equal(await fingerprint(p,hashes),await fingerprint(p,[...hashes].reverse()));assert.notEqual(await fingerprint(p,hashes),await fingerprint(p,[{id:'a',sha256:'changed'},hashes[0]]));});
test('原檔 bytes 納入，缺少原檔阻擋，SHA-256 標準向量正確',async()=>{assert.equal(await sha256Blob(new Blob(['abc'])),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');const p=sampleProject();p.pairs[0].photos=[{mediaId:'original'}];assert.notEqual(await projectFingerprint(p,async()=>new Blob(['a'])),await projectFingerprint(p,async()=>new Blob(['b'])));await assert.rejects(()=>projectFingerprint(p,async()=>null),/缺少/);});
test('案件檔附完整指紋，記憶體驗證與竄改偵測不變更案件',async()=>{const p=sampleProject(),before=structuredClone(p),backup=await makeBackup(p);assert.equal((await verifyFingerprint(parseBackup(JSON.stringify(backup)))).matches,true);backup.project.pairs[0].inPlane.A.rounds[0].dxCm='9.9';assert.equal((await verifyFingerprint(parseBackup(JSON.stringify(backup)))).matches,false);delete backup.integrity;assert.equal((await verifyFingerprint(parseBackup(JSON.stringify(backup)))).matches,null);assert.deepEqual(p,before);});
test('成果與原始表頁尾列短指紋，附件末頁列完整指紋且不增加頁數',async()=>{const p=sampleProject(),digest=await fingerprint(p),html=await fullReport(p,{includePhotos:false,includeMap:false});assert.equal((html.match(/<section class="sheet /g)||[]).length,3);assert.equal((html.match(/資料指紋 SHA-256：/g)||[]).length,3);assert.ok(html.includes(digest));assert.equal((html.match(/完整 SHA-256：/g)||[]).length,1);});
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('案件檔拒絕未引用、重複與缺漏媒體，直接驗證亦不可略過檢查',async()=>{
 const p=sampleProject(),backup=await makeBackup(p),before=structuredClone(p);backup.media.push({id:'extra-original',dataUrl:png});
 assert.throws(()=>parseBackup(JSON.stringify(backup)),/未引用/);delete backup.integrity;assert.throws(()=>parseBackup(JSON.stringify(backup)),/未引用/);
 await assert.rejects(()=>verifyFingerprint({project:p,media:[{id:'extra-original',blob:new Blob(['a'])}],integrity:null}),/未引用/);
 p.map={mediaId:'original',fileName:'synthetic.png',source:'import',capturedOn:'',approxAddress:'',addedAt:p.createdAt,width:1,height:1};
 const good=await makeBackup(p,async()=>new Blob(['a']),async()=>png),parsed=parseBackup(JSON.stringify(good));
 await assert.rejects(()=>verifyFingerprint({...parsed,media:[...parsed.media,...parsed.media]}),/重複/);await assert.rejects(()=>verifyFingerprint({...parsed,media:[]}),/缺少/);
 assert.throws(()=>parseBackup(JSON.stringify({...good,media:[]})),/缺少/);assert.throws(()=>parseBackup(JSON.stringify({...good,media:[...good.media,...good.media]})),/重複/);assert.deepEqual(before.pairs,p.pairs);
});
test('案件檔中每個合法媒體的實際 bytes 皆影響驗證',async()=>{
 const p=sampleProject();p.map={mediaId:'original',fileName:'synthetic.png',source:'import',capturedOn:'',approxAddress:'',addedAt:p.createdAt,width:1,height:1};
 const bytes=Uint8Array.from(atob(png.split(',')[1]),c=>c.charCodeAt(0)),backup=await makeBackup(p,async()=>new Blob([bytes],{type:'image/png'}),async()=>png);
 assert.equal((await verifyFingerprint(parseBackup(JSON.stringify(backup)))).matches,true);
 bytes[bytes.length-1]^=1;backup.media[0].dataUrl='data:image/png;base64,'+Buffer.from(bytes).toString('base64');assert.equal((await verifyFingerprint(parseBackup(JSON.stringify(backup)))).matches,false);
});
