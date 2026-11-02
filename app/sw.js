/* Offline cache for Carve Sim. The app shell and the sample SVGs are cached on install (~0.5 MB); everything else same-origin (the tracer's OpenCV
 * wasm, samples, imported files fetched by URL) is cached the first time it is fetched. Code and pages are
 * network-first (so an update shows up at once when online), the big immutable files cache-first. */
const V = 'carve-sim-showroom-6';
const CORE = ['./', 'index.html', 'css/app.css', 'js/main.js', 'js/viewer.js', 'js/materials.js', 'js/shader.js',
  'js/svg-import.js', 'js/svg-worker.js', 'js/bake-lib.js', 'js/sdf-lib.js', 'vendor/three-lite.min.js', 'samples/index.json', 'samples/old-fisherman.svg',
  'samples/bald-eagle.svg', 'samples/wolf-pocket-levels.svg', 'samples/stag-engrave.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(V).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('carve-sim') && k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  const immutable = /\/(vendor|samples)\//.test(u.pathname);
  e.respondWith((async () => {
    const c = await caches.open(V);
    if (immutable) {
      const hit = await c.match(r, { ignoreSearch: true }); if (hit) return hit;
      const res = await fetch(r); if (res.ok) c.put(r, res.clone()); return res;
    }
    try { const res = await fetch(r); if (res.ok) c.put(r, res.clone()); return res; }
    catch (err) { const hit = await c.match(r, { ignoreSearch: true }); if (hit) return hit; throw err; }
  })());
});
