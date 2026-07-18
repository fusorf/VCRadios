// Service Worker — Vice City Radio
// Tous les chemins sont RELATIFS au scope pour fonctionner sous
// https://fusorf.github.io/VCRadios/ (les chemins absolus "/..." pointaient
// sur la racine du domaine et cassaient l'installation).
// Les radios streament directement depuis R2 (Range natif + CDN) et ne sont
// volontairement PAS interceptées ni mises en cache ici.
const CACHE_VERSION = 'v8';
const STATIC_CACHE = 'static-' + CACHE_VERSION;
const IMAGE_CACHE = 'images-cache';

const PRECACHE_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './tracks.js',
  './manifest.json',
  './sfx/static1.mp3',
  './sfx/static2.mp3',
  './sfx/static3.mp3',
  './sfx/static4.mp3',
  './sfx/static5.mp3',
  './sfx/static6.mp3',
  './sfx/static7.mp3',
  './sfx/static8.mp3',
  './sfx/static9.mp3',
  './sfx/static10.mp3',
  './sfx/static11.mp3',
  './sfx/static12.mp3',
  './sfx/ui/hover1.mp3',
  './sfx/ui/hover2.mp3',
  './sfx/ui/select1.mp3',
  './sfx/ui/select2.mp3',
  './sfx/ui/cancel1.mp3',
  './sfx/ui/cancel2.mp3',
  './fonts/Pricedown Bl.otf',
  './fonts/SF Arborcrest Medium.ttf',
  './logos/background.png',
  './logos/marble-pink.png',
  './logos/logoVC.png',
  './logos/Emotion98.3-GTAVC-Logo.webp',
  './logos/RadioEspantoso-GTAVC-Logo.webp',
  './logos/Fever_105.webp',
  './logos/FlashFM.webp',
  './logos/KChat-GTAVC-Logo.webp',
  './logos/ViceCityPublicRadio-GTAVC-Logo.svg',
  './logos/V-Rock-GTAVC-Logo.svg',
  './logos/Wave103-GTAVC-Logo.svg',
  './logos/WildstylePirateRadio.webp'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const keep = [STATIC_CACHE, IMAGE_CACHE];
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(name => !keep.includes(name)).map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

const cacheFirst = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
};

// L'app shell passe par le réseau d'abord (toujours frais et cohérent — un
// mix vieux app.js / nouveau index.html casse tout), cache en secours offline.
const networkFirst = async (request) => {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (e) {
    const cached = await cache.match(request);
    return cached || Response.error();
  }
};

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Cross-origin (radios R2 incluses) : laissé au navigateur, sans interception
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/sfx/')) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
  } else if (event.request.destination === 'image') {
    event.respondWith(cacheFirst(event.request, IMAGE_CACHE));
  } else {
    event.respondWith(networkFirst(event.request));
  }
});
