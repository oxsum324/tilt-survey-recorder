import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs/promises';
test('安裝快取的每個請求均跳過 HTTP 舊快取',async()=>{
 const listeners={},requests=[];const self={registration:{scope:'https://example.test/tilt/'},addEventListener:(name,fn)=>listeners[name]=fn,skipWaiting:async()=>{}};
 vm.runInNewContext(await fs.readFile(new URL('./sw.js',import.meta.url),'utf8'),{self,URL,Request,caches:{open:async()=>({addAll:async list=>requests.push(...list)})}});
 let completion;listeners.install({waitUntil:p=>completion=p});await completion;assert.ok(requests.length>=23);assert.ok(requests.every(r=>r.cache==='reload'));assert.ok(requests.every(r=>r.url.startsWith(self.registration.scope)));
});
