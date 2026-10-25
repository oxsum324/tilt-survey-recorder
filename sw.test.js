import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs/promises';
test('安裝快取的每個請求均跳過 HTTP 舊快取',async()=>{
 const listeners={},requests=[];const self={registration:{scope:'https://example.test/tilt/'},addEventListener:(name,fn)=>listeners[name]=fn,skipWaiting:async()=>{}};
 vm.runInNewContext(await fs.readFile(new URL('./sw.js',import.meta.url),'utf8'),{self,URL,Request,caches:{open:async()=>({addAll:async list=>requests.push(...list)})}});
 let completion;listeners.install({waitUntil:p=>completion=p});await completion;assert.ok(requests.length>=23);assert.ok(requests.every(r=>r.cache==='reload'));assert.ok(requests.every(r=>r.url.startsWith(self.registration.scope)));
});

test('目前版本、圖示與新增模組在發布及快取清單一致',async()=>{
 const {VERSION}=await import('./model.js'),read=async name=>fs.readFile(new URL(name,import.meta.url),'utf8'),pkg=JSON.parse(await read('package.json')),lock=JSON.parse(await read('package-lock.json')),manifest=JSON.parse(await read('manifest.webmanifest')),sw=await read('sw.js'),build=await read('build-site.mjs');
 assert.equal(VERSION,'0.5.0');assert.equal(pkg.version,VERSION);assert.equal(lock.version,VERSION);assert.equal(lock.packages[''].version,VERSION);assert.equal(pkg.devDependencies.playwright,'1.58.2');assert.ok(manifest.start_url.endsWith(VERSION));assert.ok(sw.includes(`tilt-survey-v${VERSION}`));assert.ok((await read('index.html')).includes(`V${VERSION}`));assert.ok((await read('README.md')).includes(`V${VERSION}`));assert.ok((await read(`docs/versions/v${VERSION}.md`)).includes(`V${VERSION}`));
 for(const name of ['integrity.js','icon-180.png','icon-192.png','icon-512.png']){assert.ok(sw.includes(`'./${name}'`));assert.ok(build.includes(`'${name}'`));}
 for(const size of [180,192,512]){const bytes=await fs.readFile(new URL(`icon-${size}.png`,import.meta.url));assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);assert.ok(manifest.icons.some(i=>i.src===`./icon-${size}.png`&&i.sizes===`${size}x${size}`));}
});
