const CACHE = 'coastfire-v76';
const LOCAL = [
  './', './index.html', './manifest.json', './icon.svg',
  './about.html', './privacy.html', './terms.html',
  './blog/what-is-coastfire.html',
  './blog/coastfire-vs-baristafire.html',
  './blog/coastfire-at-30-vs-40.html',
  './blog/my-coastfire-journey.html',
  './blog/5-coastfire-mistakes.html',
  './blog/4-percent-rule-coastfire.html',
  './blog/roth-ira-coastfire.html',
  './blog/healthspan-coastfire.html'
];
const CDN   = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      c.addAll(LOCAL).then(() => c.add(CDN).catch(() => {}))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never cache or intercept the AI endpoint. It's a POST to a serverless
  // function and every response is unique to that question.
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  const isDocument = e.request.mode === 'navigate' ||
                     e.request.destination === 'document';

  if (isDocument) {
    // Network-first for pages. Cache-first used to mean a returning visitor
    // kept getting yesterday's index.html until the cache name changed, which
    // is how the calculator once got stuck on "Calculating…" against a build
    // that had already been fixed. The cache is now a genuine offline
    // fallback rather than the primary source of the page.
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(e.request).then(r => r || caches.match('./index.html'))
        )
    );
    return;
  }

  // Static assets: cache-first is fine, and keeps the app usable offline.
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
