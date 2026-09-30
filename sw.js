// Service worker lifecycle adapted from oxsum324/level-survey-recorder, sw.js,
// commit 78f2ae02646510290854e89ff1ba901776bce9f5. 複製後獨立演進。
// Versioned shell; all modules load eagerly. Activate the completed cache; a refresh loads the new shell. Case data is unchanged.
const CACHE='tilt-survey-v0.3.0';
const APP_FILES=['./','./index.html','./app.js','./model.js','./calc.js','./sketch.js','./report.js','./store.js','./style.css','./manifest.webmanifest','./icon.svg','./annotation-geometry.js','./annotation.js','./exif.js','./media.js','./media-ui.js','./plan.js','./media-report.js','./pdf.js','./display.js','./vendor/html2pdf.bundle.min.js','./vendor/html2pdf-LICENSE.txt','./vendor/html2pdf.bundle.min.js.LICENSE.txt'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(APP_FILES)).then(()=>self.skipWaiting())));
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('tilt-survey-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  const files=APP_FILES.map(file=>new URL(file,self.registration.scope).pathname);
  if(event.request.mode==='navigate')event.respondWith(caches.open(CACHE).then(cache=>cache.match('./index.html')).then(response=>response||fetch(event.request)));
  else if(files.includes(url.pathname))event.respondWith(caches.open(CACHE).then(cache=>cache.match(url.pathname,{ignoreSearch:true})).then(response=>response||fetch(event.request)));
});
