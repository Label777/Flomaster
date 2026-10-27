/*
 * Service worker для хостингов, где нельзя задать заголовки (GitHub Pages).
 * Добавляет к ответам того же origin COOP/COEP/CORP, чтобы страница стала
 * cross-origin isolated (как при деплое через Caddy). Регистрируется только
 * в сборке с VITE_COI_SW=1 (см. src/coi.ts). Собственная реализация, MIT.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Запросы only-if-cached вне same-origin падают с TypeError — не трогаем их.
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req).then((res) => {
      if (res.status === 0 || res.type === 'opaque') return res;
      const headers = new Headers(res.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      headers.set('Cross-Origin-Resource-Policy', 'same-origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }),
  );
});
