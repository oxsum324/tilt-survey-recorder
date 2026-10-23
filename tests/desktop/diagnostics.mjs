import assert from 'node:assert/strict';

export function monitorContext(context, phase=()=> 'online') {
 const diagnostics={httpErrors:[],consoleErrors:[],pageErrors:[],requestFailures:[],responses:[],consoleWarnings:[]};
 const meta=()=>({at:new Date().toISOString(),phase:phase()});
 context.on('response',r=>{const item={...meta(),url:r.url(),status:r.status(),fromServiceWorker:r.fromServiceWorker()};diagnostics.responses.push(item);if(r.status()>=400)diagnostics.httpErrors.push(item);});
 context.on('requestfailed',r=>diagnostics.requestFailures.push({...meta(),url:r.url(),method:r.method(),resourceType:r.resourceType(),serviceWorker:r.serviceWorker()?.url()||null,error:r.failure()}));
 context.on('console',m=>{const item={...meta(),text:m.text(),location:m.location()};if(m.type()==='error')diagnostics.consoleErrors.push(item);if(m.type()==='warning')diagnostics.consoleWarnings.push(item);});
 context.on('weberror',e=>diagnostics.pageErrors.push({...meta(),message:e.error().message}));
 return diagnostics;
}

export function assertClean(d) {
 for(const key of ['httpErrors','consoleErrors','pageErrors','requestFailures'])assert.deepEqual(d[key],[],key+' must be empty (including offline phase)');
}

// A navigation intentionally made offline exercises sw.js's network-first/cache fallback.
// Require exactly that worker attempt AND a 200 cache response AND verified rendered data.
// Retain every raw event; never exclude failures based on offline phase alone.
export function assertOfflineRecovery(d,{url,workerUrl,readVerified}) {
 assert.equal(readVerified,true,'Offline rendered read must be verified');
 assertClean({...d,requestFailures:[]});
 assert.equal(d.requestFailures.length,1,'Exactly one intentional worker attempt required');
 const f=d.requestFailures[0];
 assert.deepEqual({phase:f.phase,url:f.url,method:f.method,resourceType:f.resourceType,serviceWorker:f.serviceWorker,error:f.error},
  {phase:'offline',url,method:'GET',resourceType:'fetch',serviceWorker:workerUrl,error:{errorText:'net::ERR_INTERNET_DISCONNECTED'}},'Unexpected network failure');
 const responses=d.responses.filter(r=>r.phase==='offline'&&r.url===url&&r.status===200&&r.fromServiceWorker===true);
 assert.equal(responses.length,1,'Require one successful offline cache response');
 return {expectedOfflineFailures:1,unexpectedNetworkFailures:0,cacheResponse:responses[0],readVerified};
}
