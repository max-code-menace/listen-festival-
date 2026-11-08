'use strict';
// Service worker du Plan Listen : l'appli s'ouvre sans réseau (foule, 4G saturée, mode avion).
// - L'appli (HTML, JS, CSS, Leaflet, icônes) : réseau d'abord avec 3 s de patience, sinon la copie gardée.
// - Tuiles de la carte, polices, itinéraires à pied : la copie gardée d'abord, sinon le réseau.
// - L'API (/api/…) et le flux en direct ne passent jamais par ici : le site gère lui-même le hors ligne.
// Changer VERSION à chaque modification de la liste SHELL.

const VERSION = 'v2';
const SHELL_CACHE = 'l26-shell-' + VERSION;
const TILES_CACHE = 'l26-tiles';     // partagé avec app.js (téléchargement de la carte hors ligne)
const ROUTES_CACHE = 'l26-routes';
const FONTS_CACHE = 'l26-fonts';
const SHELL = [
  '/', '/style.css', '/data.js', '/core.js', '/app.js', '/routes.json', '/manifest.webmanifest',
  '/vendor/leaflet/leaflet.css', '/vendor/leaflet/leaflet.js',
  '/vendor/leaflet/images/marker-icon.png', '/vendor/leaflet/images/marker-icon-2x.png', '/vendor/leaflet/images/marker-shadow.png',
  '/vendor/leaflet/images/layers.png', '/vendor/leaflet/images/layers-2x.png',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
];
const MAX_ROUTES = 300;   // itinéraires gardés (les plus anciens partent)
const MAX_TILES = 4000;   // tuiles gardées en naviguant (le téléchargement de la zone en fait environ 170)

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL_CACHE);
    await c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, TILES_CACHE, ROUTES_CACHE, FONTS_CACHE]);
    for (const k of await caches.keys()) if (k.startsWith('l26-') && !keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(name, max) {
  const c = await caches.open(name), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

// La copie gardée d'abord ; sinon le réseau, et on garde la réponse si elle est bonne
async function cacheFirst(req, name, max) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    await c.put(req, res.clone());
    if (max) trim(name, max).catch(() => {});
  }
  return res;
}

// Le réseau d'abord, mais pas plus de 3 s : dans une foule, une requête peut pendre une minute
async function networkFirst(req, key) {
  const c = await caches.open(SHELL_CACHE);
  const net = fetch(req).then(res => { if (res.ok) c.put(key, res.clone()); return res; });
  const timeout = new Promise(r => setTimeout(r, 3000, null));
  try {
    const fast = await Promise.race([net, timeout]);
    if (fast) return fast;
  } catch (e) { /* hors ligne : on prend la copie */ }
  const hit = await c.match(key, { ignoreSearch: true });
  if (hit) { net.catch(() => {}); return hit; }
  return net; // pas de copie : on attend le réseau jusqu'au bout
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/') || url.pathname === '/healthz' || url.pathname === '/sw.js') return;
    if (req.mode === 'navigate') return e.respondWith(networkFirst(req, '/'));
    if (url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/icons/')) return e.respondWith(cacheFirst(req, SHELL_CACHE));
    return e.respondWith(networkFirst(req, url.pathname));
  }
  if (url.hostname === 'tile.openstreetmap.org') return e.respondWith(cacheFirst(req, TILES_CACHE, MAX_TILES));
  if (url.hostname === 'routing.openstreetmap.de') return e.respondWith(cacheFirst(req, ROUTES_CACHE, MAX_ROUTES));
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') return e.respondWith(cacheFirst(req, FONTS_CACHE));
});
