const CACHE='notas-pro-v8-reminders';
const FILES=['./','./index.html','./style.css','./app.js','./config.js','./manifest.webmanifest','./icon.svg'];
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
self.addEventListener('push',event=>{
  let payload={};try{payload=event.data?.json()||{};}catch{}
  const id=/^[0-9a-f-]{36}$/i.test(payload.id||'')?payload.id:'';
  event.waitUntil(self.registration.showNotification('Notas Exclusivas Pro',{
    body:'Tem um lembrete. Toque para consultar.',
    tag:`notas-reminder-${id}-${payload.revision||''}`,
    icon:new URL('./icon.svg',self.location).href,
    data:{id},requireInteraction:true
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();const url=new URL('./',self.location);url.searchParams.set('reminder',event.notification.data?.id||'1');
  // A new main app view avoids replacing unsaved text in an existing editor.
  event.waitUntil(self.clients.openWindow(url.href));
});
