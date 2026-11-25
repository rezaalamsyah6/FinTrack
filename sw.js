// Service worker: menyimpan file aplikasi agar tetap bisa dibuka tanpa internet.
// Naikkan nomor versi setiap kali file aplikasi diubah.
const CACHE = 'keuangan-v6';
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'dashboard.js', 'config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', SUPABASE_JS,
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Hanya file aplikasi yang di-cache. Permintaan ke database Supabase tidak disentuh.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isApp = url.origin === location.origin || e.request.url === SUPABASE_JS;
  if (e.request.method !== 'GET' || !isApp) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
