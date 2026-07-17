// Service Worker — Vice City Radio
// Tous les chemins sont RELATIFS au scope pour fonctionner sous
// https://fusorf.github.io/VCRadios/ (les chemins absolus "/..." pointaient
// sur la racine du domaine et cassaient l'installation).
const CACHE_VERSION = 'v3';
const STATIC_CACHE = 'static-' + CACHE_VERSION;
const AUDIO_CACHE = 'radio-audio-cache';
const IMAGE_CACHE = 'images-cache';

// Doit rester aligné avec AUDIO_BASE_URL dans app.js (bucket R2 "vicecity")
const AUDIO_BASE_URL = 'https://pub-78e65d92e7574926a519b54ecff12c87.r2.dev';
const AUDIO_ORIGIN = new URL(AUDIO_BASE_URL).origin;

const PRECACHE_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
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
  const keep = [STATIC_CACHE, AUDIO_CACHE, IMAGE_CACHE];
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(name => !keep.includes(name)).map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

// Sert une requête Range depuis la réponse complète en cache. Indispensable :
// un <audio> qui seek envoie des Range, or une réponse 206 est instockable
// dans le Cache API et un match() brut renverrait le fichier entier.
const sliceForRange = async (fullResponse, rangeHeader) => {
  const blob = await fullResponse.blob();
  const size = blob.size;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }
  let start, end;
  if (match[1] === '') {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }
  const sliced = blob.slice(start, end + 1);
  return new Response(sliced, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': fullResponse.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
      'Content-Length': String(sliced.size),
      'Accept-Ranges': 'bytes'
    }
  });
};

const serveRadio = async (request) => {
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(request.url);
  if (!cached) {
    // Pas en cache : passthrough réseau. Le fichier complet n'est mis en cache
    // que via PRELOAD_STATION (fetch sans Range, donc réponse 200 complète).
    return fetch(request);
  }
  const rangeHeader = request.headers.get('range');
  return rangeHeader ? sliceForRange(cached, rangeHeader) : cached;
};

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

  // Radios depuis R2 (cross-origin)
  if (url.origin === AUDIO_ORIGIN) {
    if (url.pathname.includes('/radio/') && url.pathname.endsWith('.mp3')) {
      event.respondWith(serveRadio(event.request));
    }
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/sfx/')) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
  } else if (event.request.destination === 'image') {
    event.respondWith(cacheFirst(event.request, IMAGE_CACHE));
  } else {
    event.respondWith(networkFirst(event.request));
  }
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'PRELOAD_STATION') return;
  const url = data.url;
  const client = event.source;
  const notify = (ok) => {
    if (client) client.postMessage({ type: 'STATION_PRELOADED', url, ok });
  };

  event.waitUntil(
    caches.open(AUDIO_CACHE)
      .then(cache => cache.match(url).then(cached => {
        if (cached) {
          notify(true);
          return;
        }
        // mode cors → réponse lisible, indispensable pour le découpage Range ;
        // nécessite la politique CORS sur le bucket (sinon échec → notify(false),
        // la lecture directe depuis R2 n'est pas affectée)
        return fetch(url, { mode: 'cors' }).then(response => {
          if (response.status === 200) {
            return cache.put(url, response).then(() => notify(true));
          }
          notify(false);
        });
      }))
      .catch(() => notify(false))
  );
});
