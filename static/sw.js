const CACHE_NAME = 'todo-app-v1';
const CORE = [
  '/', '/offline.html', '/static/styles.css', '/static/app.js', '/static/auth.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE)).then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  // bypass API requests
  if(url.pathname.startsWith('/api/')){
    return event.respondWith(fetch(req).catch(()=>caches.match('/offline.html')));
  }
  // navigation -> network first then fallback to cache/offline
  if(req.mode === 'navigate'){
    event.respondWith(fetch(req).then(r=>{ return r }).catch(()=> caches.match('/offline.html')));
    return;
  }
  // static assets -> cache first
  event.respondWith(caches.match(req).then(cached=> cached || fetch(req).then(res=>{ if(res && res.status===200) { const copy = res.clone(); caches.open(CACHE_NAME).then(c=>c.put(req, copy)); } return res; }).catch(()=>caches.match(req))));
});
