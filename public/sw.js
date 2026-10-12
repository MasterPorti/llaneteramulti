const CACHE = 'llanta-usada-postgresql-v2';

const PRECACHE = [
  '/images/logo.jpeg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('llanta-usada-') && k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Solo manejar GETs de navegación (páginas y assets estáticos)
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Los datos operativos siempre provienen del servidor PostgreSQL. No mostrar
  // páginas antiguas del almacén JSON ni guardar clientes/ventas como fallback.
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/images/') || event.request.headers.get('next-action')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Guardar en caché si es válida
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
