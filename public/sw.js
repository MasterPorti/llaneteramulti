const CACHE = 'llanta-usada-v1';

const PRECACHE = [
  '/',
  '/ventas',
  '/inventario',
  '/servicios',
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
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Solo manejar GETs de navegación (páginas y assets estáticos)
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Ignorar peticiones a la API / server actions
  if (url.pathname.startsWith('/api') || event.request.headers.get('next-action')) return;

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
