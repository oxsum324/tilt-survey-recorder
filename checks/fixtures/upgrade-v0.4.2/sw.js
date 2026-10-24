// Service worker lifecycle adapted from oxsum324/level-survey-recorder, sw.js,
// commit 78f2ae02646510290854e89ff1ba901776bce9f5. 複製後獨立演進。
// Versioned shell; all modules load eagerly. Activate the completed cache; a refresh loads the new shell. Case data is unchanged.
const CACHE='tilt-survey-v0.4.2';
const APP_FILES=['./','./index.html','./app.js','./model.js','./integrity.js','./calc.js','./sketch.js','./report.js','./store.js','./style.css','./manifest.webmanifest','./icon.svg','./icon-180.png','./icon-192.png','./icon-512.png','./annotation-geometry.js','./annotation.js','./exif.js','./media.js','./media-ui.js','./plan.js','./media-report.js','./pdf.js','./display.js','./vendor/html2pdf.bundle.min.js','./vendor/html2pdf-LICENSE.txt','./vendor/html2pdf.bundle.min.js.LICENSE.txt'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(APP_FILES.map(url=>new Request(new URL(url,self.registration.scope),{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('tilt-survey-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  const files=APP_FILES.map(file=>new URL(file,self.registration.scope).pathname);
  if(event.request.mode==='navigate')event.respondWith((async()=>{
    const cache=await caches.open(CACHE),controller=new AbortController();let timer;
    const fallback=async()=>await cache.match(event.request,{ignoreSearch:true})||await cache.match('./index.html',{ignoreSearch:true});
    try{
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Navigation timeout'));},3000);});
      return await Promise.race([fetch(event.request,{signal:controller.signal}).then(response=>{if(!response.ok)throw Error('Navigation unavailable');return response;}),timeout]);
    }catch(error){const response=await fallback();if(response)return response;throw error;}finally{clearTimeout(timer);}
  })());
  else if(files.includes(url.pathname))event.respondWith(caches.open(CACHE).then(cache=>cache.match(url.pathname,{ignoreSearch:true})).then(response=>response||fetch(event.request)));
});
