const CACHE='notas-pro-v31-simple-note-layout';
const FILES=['./','./index.html','./style.css','./app.js','./vendor/supabase-js-v2.js','./spell-worker.js','./config.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('notas-pro-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  // Never cache account/API responses or external pages.
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(new URL('./',self.location).pathname))return;
  if(!event.request.mode.includes('navigate')&&!FILES.some(f=>new URL(f,self.location).pathname===url.pathname))return;
  const cacheKey=event.request.mode==='navigate'?new URL('./index.html',self.location).href:event.request;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(cacheKey,copy)));}return response;
  }).catch(async()=>await caches.match(cacheKey)||Response.error()));
});















