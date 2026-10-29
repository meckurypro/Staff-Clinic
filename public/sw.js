// Caches the app shell and the hashed build files so the app opens on a weak connection.
// Patient data is never cached: every request to Supabase goes straight to the network.
const V = 'clinic-v1'
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(['/', '/favicon.svg', '/manifest.webmanifest'])).then(() => self.skipWaiting())) })
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url)
  if (r.method !== 'GET' || u.origin !== location.origin) return
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then(res => { const copy = res.clone(); caches.open(V).then(c => c.put('/', copy)); return res }).catch(() => caches.match('/')))
  } else if (u.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => { const copy = res.clone(); caches.open(V).then(c => c.put(r, copy)); return res })))
  }
})
