/* costLAB service worker: cache the app shell, stay out of the way of tiles. */
const CACHE = 'costlab-shell-v1'
const PRECACHE = ['./', './manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  // Never intercept range requests — PMTiles depends on them.
  if (req.headers.has('range')) return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.endsWith('.pmtiles')) return

  // meta.json + navigations: network-first (fresh data), cache fallback.
  if (url.pathname.endsWith('/data/meta.json') || req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
          return res
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./'))),
    )
    return
  }

  // Hashed build assets: cache-first (immutable).
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
            return res
          }),
      ),
    )
  }
})
