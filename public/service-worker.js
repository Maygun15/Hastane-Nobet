// service-worker.js — Cache-First offline desteği
// Strateji:
//   /api/*         → Network-Only  (canlı veri)
//   /assets/*      → Cache-First   (hash'li build çıktıları — değişmez)
//   diğer GET'ler  → Stale-While-Revalidate (kabuk HTML, görseller)

const CACHE_NAME = 'hastane-nobet-v1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
];

// ── Kurulum: uygulama kabuğunu önceden önbellekle ──────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(SHELL_ASSETS).catch(() => {
        // Shell varlıkları erişilemezse install'u engelleme (offline install)
      })
    )
  );
  self.skipWaiting();
});

// ── Aktivasyon: eski önbellekleri temizle ──────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  return self.clients.claim();
});

// ── Fetch: istek stratejisi ────────────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Sadece same-origin GET isteklerini yakala
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // API: her zaman ağdan al, önbelleğe yazma
  if (url.pathname.startsWith('/api/')) return;

  // /assets/ (Vite hash'li JS/CSS): Cache-First
  // Bu dosyalar içerik hash'li olduğundan güncellenmez; önbellekte varsa direkt dön
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // HTML / kabuk / görsel: Stale-While-Revalidate
  // Önbellekteki versiyonu anında döndür, arka planda güncelle
  e.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cached) => {
        const networkPromise = fetch(request)
          .then((res) => {
            if (res && res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => null);

        // Önbellekte varsa hemen ver; yoksa ağı bekle
        return cached || networkPromise;
      })
    )
  );
});
