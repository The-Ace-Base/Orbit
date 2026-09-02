const CACHE_NAME = 'orbit-v2';

const STATIC_ASSETS = [
  './',
  './index.html',
  './chat.html',
  './root.css',
  './icon.png'
];

self.addEventListener(
  'install',
  event => {
    event.waitUntil(
      caches.open(CACHE_NAME)
        .then(cache =>
          cache.addAll(
            STATIC_ASSETS
          )
        )
        .then(() =>
          self.skipWaiting()
        )
    );
  }
);

self.addEventListener(
  'activate',
  event => {
    event.waitUntil(
      caches.keys()
        .then(keys =>
          Promise.all(
            keys
              .filter(
                key =>
                  key !== CACHE_NAME
              )
              .map(key =>
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
  event => {
    const request =
      event.request;

    if (
      request.method !== 'GET'
    ) {
      return;
    }

    const url =
      new URL(request.url);

    if (
      url.origin !==
      self.location.origin
    ) {
      return;
    }

    event.respondWith(
      fetch(request)
        .then(response => {
          const copy =
            response.clone();

          caches.open(CACHE_NAME)
            .then(cache =>
              cache.put(
                request,
                copy
              )
            );

          return response;
        })
        .catch(() =>
          caches.match(request)
        )
    );
  }
);