const CACHE = 'coastfire-v74';
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
  // Never cache or intercept the AI endpoint — it's a POST to a serverless
  // function and every response is unique to that question.
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
