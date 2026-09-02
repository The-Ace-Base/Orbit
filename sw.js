const CACHE_NAME = 'orbit-v2';

const APP_SHELL = [
  './',
  './index.html',
  './chat.html',
  './index.js',
  './chat.js',
  './matrix.js',
  './unicode.js',
  './root.css'
];

self.addEventListener(
  'install',
  (event) => {
    event.waitUntil(
      caches
        .open(CACHE_NAME)
        .then((cache) =>
          cache.addAll(APP_SHELL)
        )
        .then(() =>
          self.skipWaiting()
        )
    );
  }
);

self.addEventListener(
  'activate',
  (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter(
                (key) =>
                  key !== CACHE_NAME
              )
              .map((key) =>
                caches.delete(key)
              )
          )
        )
        .then(() =>
          self.clients.claim()
        )
    );
  }
);

self.addEventListener(
  'fetch',
  (event) => {
    const request =
      event.request;

    if (
      request.method !== 'GET' ||
      !request.url.startsWith(
        self.location.origin
      )
    ) {
      return;
    }

    event.respondWith(
      caches.match(request)
        .then((cached) => {
          if (cached) {
            return cached;
          }

          return fetch(request)
            .then((response) => {
              if (
                !response ||
                response.status !== 200
              ) {
                return response;
              }

              const clone =
                response.clone();

              caches.open(
                CACHE_NAME
              ).then((cache) => {
                cache.put(
                  request,
                  clone
                );
              });

              return response;
            });
        })
    );
  }
);