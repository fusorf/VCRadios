// Service Worker — Vice City Radio
// Tous les chemins sont RELATIFS au scope pour fonctionner sous
// https://fusorf.github.io/VCRadios/ (les chemins absolus "/..." pointaient
// sur la racine du domaine et cassaient l'installation).
// Les radios streament directement depuis R2 (Range natif + CDN) et ne sont
// volontairement PAS interceptées ni mises en cache ici. Exception : les URLs
// virtuelles same-origin /offline/*.mp3, servies depuis le cache RADIO_CACHE
// rempli par offline.js (téléchargements pour écoute hors ligne).
const CACHE_VERSION = 'v10';
const STATIC_CACHE = 'static-' + CACHE_VERSION;
const IMAGE_CACHE = 'images-cache';
// sans version : les stations téléchargées survivent aux bumps du shell
const RADIO_CACHE = 'radio-offline';

const PRECACHE_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './tracks.js',
  './offline.js',
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
  './logos/WildstylePirateRadio.webp',
  './logos/notif/EMOTION.png',
  './logos/notif/ESPANT.png',
  './logos/notif/FEVER.png',
  './logos/notif/FLASH.png',
  './logos/notif/KCHAT.png',
  './logos/notif/VCPR.png',
  './logos/notif/VROCK.png',
  './logos/notif/WAVE.png',
  './logos/notif/WILD.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const keep = [STATIC_CACHE, IMAGE_CACHE, RADIO_CACHE];
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
  // repli sur tous les caches : les logos vivent dans le précache statique,
  // et le memory-cache de WebKit peut court-circuiter le SW au premier
  // chargement, laissant images-cache vide
  const cached = await cache.match(request) || await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (e) {
    return Response.error();
  }
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
    // ignoreSearch : une navigation avec query (?dl=1...) doit retrouver le
    // shell précaché sous "./" ; repli index.html pour toute navigation
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return Response.error();
  }
};

// Stations téléchargées : iOS/Safari envoie TOUJOURS "Range: bytes=0-" sur
// les <audio> et refuse de lire sans réponse 206 correcte — on synthétise
// donc les 206 depuis le blob caché (pattern Workbox range-requests).
// blob.slice est paresseux (adossé au disque) : servir jusqu'à la fin du
// fichier ne copie rien en mémoire, pas besoin de borner comme le worker R2.
const offlineRadio = async (request) => {
  const cache = await caches.open(RADIO_CACHE);
  // match par URL et pas par Request : un header Range sur la requête peut
  // faire échouer Cache.match selon les navigateurs
  const cached = await cache.match(request.url);
  if (!cached) return new Response('Gone', { status: 404 });

  const blob = await cached.blob();
  const size = blob.size;
  const rangeHeader = request.headers.get('range');

  if (!rangeHeader) {
    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes'
      }
    });
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m || (m[1] === '' && m[2] === '')) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }
  let start, end;
  if (m[1] === '') {
    // suffixe : les N derniers octets
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }
  const slice = blob.slice(start, end + 1, 'audio/mpeg');
  return new Response(slice, {
    status: 206,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(slice.size),
      'Accept-Ranges': 'bytes'
    }
  });
};

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Cross-origin (radios R2 streamées incluses) : laissé au navigateur
  if (url.origin !== self.location.origin) return;

  // avant les autres branches : /offline/*.mp3 ne doit jamais tomber dans
  // networkFirst (404 GitHub Pages)
  if (url.pathname.includes('/offline/') && url.pathname.endsWith('.mp3')) {
    event.respondWith(offlineRadio(event.request));
  } else if (url.pathname.includes('/sfx/')) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
  } else if (event.request.destination === 'image') {
    event.respondWith(cacheFirst(event.request, IMAGE_CACHE));
  } else {
    event.respondWith(networkFirst(event.request));
  }
});
