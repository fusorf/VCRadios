// Service Worker — Vice City Radio
// Tous les chemins sont RELATIFS au scope pour fonctionner sous
// https://fusorf.github.io/VCRadios/ (les chemins absolus "/..." pointaient
// sur la racine du domaine et cassaient l'installation).
// Les radios streament directement depuis R2 (Range natif + CDN) et ne sont
// volontairement PAS interceptées ni mises en cache ici. Exception : les URLs
// virtuelles same-origin /offline/*.mp3, servies depuis le cache RADIO_CACHE
// rempli par offline.js (téléchargements pour écoute hors ligne).
// Réécrit par scripts/stamp-version.js à chaque build (= numéro de build) :
// chaque release change donc ce fichier, déclenchant la mise à jour du SW
const CACHE_VERSION = '2026.11.13-0016';
const STATIC_CACHE = 'static-' + CACHE_VERSION;
// versionné : un cache d'images éternel servait les images modifiées
// périmées pour toujours
const IMAGE_CACHE = 'images-' + CACHE_VERSION;
// sans version : les stations téléchargées survivent aux bumps du shell
const RADIO_CACHE = 'radio-offline';

const PRECACHE_FILES = [
  './',
  './index.html',
  './style.css',
  './i18n.js',
  './app.js',
  './tracks.js',
  './offline.js',
  './version.js',
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
  './logos/background.webp',
  './logos/marble-pink.webp',
  './logos/logoVC.webp',
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
      // cache: 'reload' : contourne le cache HTTP (GitHub Pages = max-age 600),
      // sinon le précache d'une nouvelle version pouvait capturer d'anciens fichiers
      .then(cache => cache.addAll(PRECACHE_FILES.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const keep = [STATIC_CACHE, IMAGE_CACHE, RADIO_CACHE];
  event.waitUntil((async () => {
    // Navigation preload : la requête de la page part pendant que le SW
    // démarre, au lieu d'attendre son boot (gain de ~50-300 ms au lancement)
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    const names = await caches.keys();
    await Promise.all(names.filter(name => !keep.includes(name)).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

const cacheFirst = async (request, cacheName) => {
  // le précache de la version courante d'abord (toujours à jour), puis le
  // cache d'exécution
  const precached = await (await caches.open(STATIC_CACHE)).match(request);
  if (precached) return precached;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
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
// mix vieux app.js / nouveau index.html casse tout), cache en secours.
// Réseau "lent mais pas coupé" (lie-fi) : sans délai max, le lancement
// attendait l'échec du fetch (des dizaines de secondes). La NAVIGATION bascule
// donc sur le cache après SHELL_TIMEOUT_MS ; pendant les 10 s qui suivent, ses
// sous-ressources viennent aussi du cache (jamais de mélange de versions). Le
// fetch réseau continue en fond et rafraîchit le cache pour le lancement suivant.
const SHELL_TIMEOUT_MS = 3000;
let preferCacheUntil = 0;

const cachedShell = async (request) => {
  const cache = await caches.open(STATIC_CACHE);
  // ignoreSearch : une navigation avec query (?dl=1...) doit retrouver le
  // shell précaché sous "./" ; repli index.html pour toute navigation
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  if (request.mode === 'navigate') return cache.match('./index.html');
  return undefined;
};

const networkFirst = (event) => {
  const request = event.request;
  const isNav = request.mode === 'navigate';
  let putDone = Promise.resolve();

  const network = (async () => {
    const preloaded = isNav ? await event.preloadResponse : undefined;
    const response = preloaded || await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      putDone = caches.open(STATIC_CACHE).then(cache => cache.put(request, copy)).catch(() => {});
    }
    return response;
  })();
  // garde le SW en vie jusqu'à la mise en cache, même si le cache a répondu
  event.waitUntil(network.then(() => putDone, () => {}));

  return (async () => {
    if (Date.now() < preferCacheUntil) {
      const cached = await cachedShell(request);
      if (cached) return cached;
    }
    let timer;
    try {
      if (!isNav) return await network;
      const timeout = new Promise(resolve => { timer = setTimeout(resolve, SHELL_TIMEOUT_MS, 'timeout'); });
      const winner = await Promise.race([network, timeout]);
      if (winner !== 'timeout') return winner;
      const cached = await cachedShell(request);
      if (cached) {
        preferCacheUntil = Date.now() + 10000;
        return cached;
      }
      return await network;
    } catch (e) {
      const cached = await cachedShell(request);
      return cached || Response.error();
    } finally {
      clearTimeout(timer);
    }
  })();
};

// Stations téléchargées : iOS/Safari envoie TOUJOURS "Range: bytes=0-" sur
// les <audio> et refuse de lire sans réponse 206 correcte — on synthétise
// donc les 206 depuis le blob caché (pattern Workbox range-requests).
// Les plages ouvertes (bytes=X-) sont BORNÉES à 2 Mo comme dans le worker R2 :
// ce cap n'est pas une question de mémoire (blob.slice est paresseux) mais de
// comportement WebKit — servir le fichier entier en une seule réponse 206
// fait ignorer/rogner les seeks sur iOS (lecture depuis 0, même symptôme que
// les ranges non bornées du worker avant leur cap). Le Content-Range total
// donne taille et durée, le navigateur enchaîne les chunks au fil de la
// lecture, identique au chemin streaming en ligne.
const RADIO_CHUNK = 2 * 1024 * 1024;

// Blob mémorisé par URL (2 stations max, LRU) : sans ça, chaque requête
// Range (tous les 2 Mo) refaisait cache.match + blob() sur un fichier de
// 60-100 Mo — coûteux sur WebKit. blob.slice reste paresseux.
const blobMemo = new Map();
const BLOB_MEMO_MAX = 2;

const getRadioBlob = (url) => {
  const hit = blobMemo.get(url);
  if (hit) {
    blobMemo.delete(url);
    blobMemo.set(url, hit); // remonte en tête LRU
    return hit;
  }
  const pending = (async () => {
    const cache = await caches.open(RADIO_CACHE);
    // match par URL et pas par Request : un header Range sur la requête peut
    // faire échouer Cache.match selon les navigateurs
    const cached = await cache.match(url);
    return cached ? cached.blob() : null;
  })();
  blobMemo.set(url, pending);
  pending.then(blob => { if (!blob) blobMemo.delete(url); }, () => blobMemo.delete(url));
  while (blobMemo.size > BLOB_MEMO_MAX) blobMemo.delete(blobMemo.keys().next().value);
  return pending;
};

// offline.js prévient lors d'une purge : on oublie les Blobs mémorisés
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'radio-purged') blobMemo.clear();
});

const offlineRadio = async (request) => {
  const blob = await getRadioBlob(request.url);
  if (!blob) return new Response('Gone', { status: 404 });
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
    end = m[2] === ''
      ? Math.min(size - 1, start + RADIO_CHUNK - 1) // plage ouverte : bornée
      : Math.min(Number(m[2]), size - 1);
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
    event.respondWith(networkFirst(event));
  }
});
