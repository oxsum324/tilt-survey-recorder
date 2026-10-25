import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function loadSites(){
 const fixtureRoot=path.resolve('checks/fixtures/upgrade-v0.4.2'),fixture=JSON.parse(await fs.readFile(path.join(fixtureRoot,'manifest.json'),'utf8'));
 assert.equal(fixture.sourceCommit,'4c32e09c8d2960dd062906da035c82d5e8a61172');assert.equal(fixture.files.length,27);
 const old=new Map();for(const f of fixture.files){const b=await fs.readFile(path.join(fixtureRoot,f.name));assert.equal(sha(b),f.sha256);assert.equal(b.length,f.bytes);old.set(f.name,b);}
 const manifest=JSON.parse(await fs.readFile('_site/deploy-manifest.json','utf8')),current=new Map();
 for(const f of manifest.files){const b=await fs.readFile(path.join('_site',f.path));assert.equal(sha(b),f.sha256);current.set(f.path,b);}
 current.set('deploy-manifest.json',Buffer.from(JSON.stringify(manifest)));return {old,current,fixture,manifest};
}
export function cacheRevision(current){
 const entries=[...current].filter(([name])=>!['sw.js','deploy-manifest.json'].includes(name)).sort(([a],[b])=>a<b?-1:a>b?1:0);
 const version=current.get('model.js').toString().match(/VERSION=['"]([0-9.]+)['"]/);
 assert.ok(version,'Runtime model version is required');
 return 'tilt-survey-v'+version[1]+'-'+sha(Buffer.from(entries.map(([name,bytes])=>name+'\0'+sha(bytes)+'\n').join(''))).slice(0,16);
}
export function assertRevisionChanged(old,current){
 const changed=[...old].some(([name,bytes])=>name!=='sw.js'&&sha(bytes)!==sha(current.get(name)));
 if(changed){assert.notEqual(sha(current.get('sw.js')),sha(old.get('sw.js')),'Runtime changed without a changed service worker');
  const key=map=>map.get('sw.js').toString().match(/const CACHE='([^']+)'/)[1];
  assert.notEqual(key(current),key(old),'Runtime changed without a distinct completed-shell cache');}
 assert.equal(current.get('sw.js').toString().match(/const CACHE='([^']+)'/)[1],cacheRevision(current),'Shell cache must identify the current runtime content digest');
}
export async function siteServer(sites,{oldFirst=false,staleWorker=false}={}){
 let current=!oldFirst;
 const types={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
 const server=http.createServer((request,response)=>{
  const name=decodeURIComponent(new URL(request.url,'http://localhost').pathname).slice(1)||'index.html';
  if(name==='favicon.ico'){response.writeHead(204);response.end();return;}
  const map=current?sites.current:sites.old,bytes=current&&staleWorker&&name==='sw.js'?sites.old.get(name):map.get(name);
  if(!bytes){response.writeHead(404);response.end();return;}
  response.writeHead(200,{'Content-Type':types[path.extname(name)]||'application/octet-stream','Cache-Control':'no-store'});response.end(bytes);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}/`,deploy:()=>{current=true;},close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
