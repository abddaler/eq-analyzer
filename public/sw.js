/*
 * Offline shell for the installed PWA.
 *
 * Hand written rather than generated: the app is a single static bundle with
 * hashed asset names, so "cache everything same-origin, serve from cache,
 * refresh in the background" is both correct and about twenty lines.
 */
const CACHE = 'eq-scope-v2';

/*
 * Paths are resolved against the worker's own location, not against the
 * origin root: the same file has to work at https://host/ and at
 * https://host/eq-analyzer/.
 */
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icon-192.png'].map(
  (path) => new URL(path, self.location).pathname,
);
const SHELL_URL = new URL('./index.html', self.location).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // One missing file must not prevent the worker from installing at all.
      .then((cache) => Promise.all(SHELL.map((path) => cache.add(path).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network first so a deployed update is picked up, falling back
  // to the cached shell when there is no signal in the venue.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(SHELL_URL, copy));
          return response;
        })
        .catch(() => caches.match(SHELL_URL).then((r) => r ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});
