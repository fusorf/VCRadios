// ---------------------------------------------------------------------------
// Écoute hors ligne (PWA installée)
// Télécharge les MP3 des stations dans le Cache Storage sous des URLs
// virtuelles same-origin (./offline/KEY.mp3), servies par le service worker
// en réponses 206 Range synthétisées — iOS envoie toujours "Range: bytes=0-"
// sur les <audio> et refuse de lire sans 206 correct. Les blob: URLs en src
// sont volontairement évitées : lecture tronquée / 416 sur iOS (WebKit 238113).
// Chargé après app.js (scripts classiques) : partage son environnement
// lexical global (stations, players, stationUrl, syncToLive, playStation,
// randomTilePoly, morphControl, playUiSfx, hoverSfx, SILENT_WAV...).
// ---------------------------------------------------------------------------

const RADIO_CACHE = 'radio-offline';

// Stockage PAR CHUNKS de 2 Mo (Range fermés, non plafonnés par le Worker),
// sous offline/KEY.mp3.partN, plus un manifeste offline/KEY.mp3.json écrit
// en dernier = station complète. Avantages sur un seul GET de 60-100 Mo :
// reprise là où on s'était arrêté (app en arrière-plan, coupure réseau),
// quota plein détecté au chunk près, jamais plus de 2 Mo en RAM, et le SW
// ne relit que le chunk utile. L'ancien format (fichier entier sous
// offline/KEY.mp3) reste lu pour les téléchargements existants.
const DL_CHUNK = 2 * 1024 * 1024;
const DL_RETRIES = 4;
const WANTED_KEY = 'vcr-dl-wanted';

const OFFLINE_SUPPORTED = 'caches' in window && 'serviceWorker' in navigator;

const isInstalledPwa = () =>
  window.matchMedia('(display-mode: standalone)').matches
  || window.navigator.standalone === true
  || new URLSearchParams(location.search).has('dl');

// Interface visible en PWA installée, et aussi dans un navigateur classique
// hors iOS (desktop/Android : stockage fiable). Cachée uniquement sur iOS
// non installé : stockage purgé après 7 jours d'inactivité, et de toute
// façon séparé de celui de la PWA écran d'accueil. ?dl=1 force partout.
const showOfflineUi = () => isInstalledPwa() || !IS_IOS;

// URL virtuelle same-origin par station (radio/EMOTION.mp3 -> offline/EMOTION.mp3),
// absolue pour des comparaisons fiables avec el.src (getter toujours absolu)
const offlineUrl = (station) => new URL('offline/' + station.file.slice(6), location.href).href;
const chunkUrl = (station, n) => offlineUrl(station) + '.part' + n;
const manifestUrl = (station) => offlineUrl(station) + '.json';
const chunkLen = (n, total) => Math.min(DL_CHUNK, total - n * DL_CHUNK);

// Stations dont l'utilisateur a demandé le téléchargement : la file reprend
// toute seule au relancement de l'app si elle a été interrompue
const loadWanted = () => {
  try { return new Set(JSON.parse(localStorage.getItem(WANTED_KEY) || '[]')); }
  catch (e) { return new Set(); }
};
const saveWanted = (set) => {
  try { localStorage.setItem(WANTED_KEY, JSON.stringify([...set])); } catch (e) {}
};
const setWanted = (index, wanted) => {
  const set = loadWanted();
  if (wanted) set.add(index); else set.delete(index);
  saveWanted(set);
};

// --- État des téléchargements ----------------------------------------------
// status : 'none' | 'queued' | 'downloading' | 'partial' | 'done' | 'error'
// (partial = chunks déjà en cache, reprise au prochain téléchargement)
const dlState = stations.map(() => ({ status: 'none', received: 0, total: 0, size: 0, message: '' }));
// station téléchargée pendant qu'elle jouait en streaming : swap différé à la
// prochaine pause (jamais de changement de src en pleine lecture)
const pendingSwap = stations.map(() => false);
let dlQueue = [];
let dlActive = null;
let dlAbort = null;
let persistAsked = false;

const resetState = (index) => {
  dlState[index] = { status: 'none', received: 0, total: 0, size: 0, message: '' };
};

const fmtMB = (bytes) =>
  (bytes / 1048576).toFixed(1).replace('.', T.decimal) + ' ' + T.mb;

// --- Éléments d'interface --------------------------------------------------
const offlineButton = document.getElementById('offlineButton');
const offlinePanel = document.getElementById('offlinePanel');
const offlineListEl = document.getElementById('offlineList');
const offlineHint = document.getElementById('offlineHint');
const offlineTotal = document.getElementById('offlineTotal');
const offlineDlAll = document.getElementById('offlineDlAll');
const offlinePurgeAll = document.getElementById('offlinePurgeAll');
const offlineClose = document.getElementById('offlineClose');

let panelVisible = false;
let rows = []; // { statusEl, bar, fill } par station ; vide hors PWA

// app.js consulte panelOpen() pour bloquer les flèches clavier du carrousel
window.vcrOffline = { panelOpen: () => panelVisible };

const renderRow = (index) => {
  const row = rows[index];
  if (!row) return;
  const state = dlState[index];
  const pct = state.total ? Math.round(state.received / state.total * 100) : 0;
  if (state.status === 'downloading') {
    row.statusEl.textContent = state.total
      ? `${T.pct(pct)} — ${fmtMB(state.received)} / ${fmtMB(state.total)}`
      : fmtMB(state.received);
    row.bar.style.display = '';
    row.fill.style.width = pct + '%';
  } else if ((state.status === 'partial' || state.status === 'error' || state.status === 'queued')
             && state.received > 0 && state.total) {
    // téléchargement interrompu : ce qui est déjà en cache est conservé
    const label = state.status === 'error' ? state.message
      : state.status === 'queued' ? T.queued : T.paused;
    row.statusEl.textContent = `${label} — ${T.pct(pct)}`;
    row.bar.style.display = '';
    row.fill.style.width = pct + '%';
  } else {
    row.bar.style.display = 'none';
    row.fill.style.width = '0%';
    row.statusEl.textContent =
      state.status === 'done' ? `${T.offlineLabel} — ${fmtMB(state.size)}`
      : state.status === 'error' ? state.message
      : state.status === 'queued' ? T.queued
      : T.streamingOnly;
  }
};

// Rendu de progression throttlé (les chunks réseau arrivent bien plus vite
// que l'écran ne rafraîchit)
const rowDirty = stations.map(() => false);
let renderScheduled = false;
const scheduleRowRender = (index) => {
  rowDirty[index] = true;
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    rowDirty.forEach((dirty, i) => {
      if (dirty) { rowDirty[i] = false; renderRow(i); }
    });
  });
};

const downloading = () => dlActive !== null || dlQueue.length > 0;

const updateControls = () => {
  if (!offlinePanel) return;
  const doneSizes = dlState.filter(s => s.status === 'done');
  const total = doneSizes.reduce((sum, s) => sum + s.size, 0);
  offlineTotal.textContent = doneSizes.length
    ? `${doneSizes.length}/${stations.length} stations — ${fmtMB(total)} ${T.offlineLower}`
    : T.noneDownloaded;
  offlineHint.style.display = downloading() ? '' : 'none';
  const allDone = dlState.every(s => s.status === 'done');
  const anyPartial = dlState.some(s => s.status === 'partial' || (s.status === 'error' && s.received));
  offlineDlAll.style.display = allDone ? 'none' : '';
  offlineDlAll.textContent = downloading() ? T.cancel : anyPartial ? T.resume : T.downloadAll;
  offlinePurgeAll.style.display = doneSizes.length || anyPartial || downloading() ? '' : 'none';
};

// --- Swap des sources ------------------------------------------------------
// Sans SW contrôlant la page (premier chargement, hard-reload), les URLs
// /offline/ prendraient un 404 GitHub Pages : on reste en streaming, et
// applyOfflineSources repasse au 'controllerchange'
const swCanServe = () => !!navigator.serviceWorker.controller;

const swapNow = (index) => {
  const el = players[index];
  if (!swCanServe()) { pendingSwap[index] = false; return; }
  // bénédiction iOS en vol (src = silence data-URI) : el.src sera restauré
  // par le bless, on retentera à la prochaine pause
  if (el.src === SILENT_WAV) { pendingSwap[index] = true; return; }
  // garde le préchargement d'une voisine, sinon rien ne se charge avant lecture
  el.preload = el.preload === 'auto' ? 'auto' : 'none';
  el.src = offlineUrl(stations[index]);
  syncToLive(index); // pose le seekIntent, ré-asserté au canplay par app.js
};

// Retour au streaming réseau (purge ou entrée de cache disparue)
const revertToNetwork = (index) => {
  const el = players[index];
  pendingSwap[index] = false;
  if (el.src !== stationUrl(stations[index])) {
    const wasPlaying = !el.paused;
    el.preload = el.preload === 'auto' ? 'auto' : 'none';
    el.src = stationUrl(stations[index]);
    if (wasPlaying && index === currentStation) playStation(index);
    else syncToLive(index);
  }
};

const applyOfflineSources = () => {
  if (!swCanServe()) return;
  stations.forEach((station, index) => {
    if (dlState[index].status !== 'done') return;
    if (players[index].src === offlineUrl(station)) return;
    if (players[index].paused) swapNow(index);
    else pendingSwap[index] = true;
  });
};

// Bascule IMMÉDIATE (même en pleine lecture) d'une station téléchargée qui
// joue encore en streaming, quand le réseau lâche : sans ça, elle restait
// muette jusqu'à la prochaine pause. Appelé par app.js sur erreur réseau,
// et ici sur 'offline' / blocage du flux sans connexion.
// Renvoie true si la bascule a eu lieu.
const takeOver = (index, wasPlaying) => {
  const el = players[index];
  const station = stations[index];
  if (dlState[index].status !== 'done' || !swCanServe()) return false;
  if (el.src === offlineUrl(station) || el.src === SILENT_WAV) return false;
  pendingSwap[index] = false;
  swapNow(index);
  if (wasPlaying && started && index === currentStation) playStation(index);
  return true;
};

const takeOverAll = () => {
  players.forEach((el, index) => takeOver(index, index === currentStation && !el.paused));
};

// --- Check au démarrage ----------------------------------------------------
// Ne lit que les clés et de petits manifestes JSON : plus aucun corps de
// 60-100 Mo ouvert au lancement (coûteux en mémoire sur WebKit).
const scanStation = async (cache, keys, index) => {
  const station = stations[index];
  const state = dlState[index];
  if (keys.has(manifestUrl(station))) {
    const manifest = await (await cache.match(manifestUrl(station))).json();
    state.status = 'done';
    state.size = state.total = state.received = manifest.size;
    return;
  }
  if (keys.has(offlineUrl(station))) { // ancien format : fichier entier
    const legacy = await cache.match(offlineUrl(station));
    state.status = 'done';
    state.size = Number(legacy.headers.get('Content-Length')) || 0;
    return;
  }
  const prefix = offlineUrl(station) + '.part';
  const parts = [...keys].filter(k => k.startsWith(prefix)).length;
  if (!parts || !keys.has(chunkUrl(station, 0))) return;
  const first = await cache.match(chunkUrl(station, 0));
  const total = Number(first.headers.get('X-Total-Size')) || 0;
  if (!total) return;
  state.status = 'partial';
  state.total = total;
  state.received = Math.min(total, parts * DL_CHUNK);
};

const initOffline = async () => {
  try {
    const cache = await caches.open(RADIO_CACHE);
    const keys = new Set((await cache.keys()).map(r => r.url));
    for (let index = 0; index < stations.length; index++) {
      try { await scanStation(cache, keys, index); } catch (e) {}
    }
  } catch (e) {
    return;
  }
  dlState.forEach((_, index) => renderRow(index));
  applyOfflineSources();
  navigator.serviceWorker.addEventListener('controllerchange', applyOfflineSources);
  updateControls();
  updateAvailability();
  // reprise automatique d'une file interrompue (app fermée en cours de route)
  const wanted = [...loadWanted()].filter(i => dlState[i] && dlState[i].status !== 'done');
  if (wanted.length && navigator.onLine !== false) enqueue(wanted);
};

// --- Téléchargement --------------------------------------------------------
const abortError = () => new DOMException('Aborted', 'AbortError');

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const onAbort = () => { clearTimeout(timer); reject(abortError()); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal.addEventListener('abort', onAbort, { once: true });
});

// Attend que l'app soit au premier plan ET en ligne (iOS coupe les fetch
// d'une PWA en arrière-plan : on reprend au retour, sans compter d'échec)
const usable = () => !document.hidden && navigator.onLine !== false;
const waitUsable = (signal) => new Promise((resolve, reject) => {
  if (usable()) return resolve();
  const cleanup = () => {
    document.removeEventListener('visibilitychange', check);
    window.removeEventListener('online', check);
    signal.removeEventListener('abort', onAbort);
  };
  const check = () => { if (usable()) { cleanup(); resolve(); } };
  const onAbort = () => { cleanup(); reject(abortError()); };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('online', check);
  signal.addEventListener('abort', onAbort);
});

// Un chunk : Range fermé, vérifié (position, taille totale, longueur) puis
// écrit en cache. Renvoie la taille totale du fichier.
const fetchChunk = async (cache, station, n, total, signal) => {
  const start = n * DL_CHUNK;
  const end = (total ? Math.min(total, start + DL_CHUNK) : start + DL_CHUNK) - 1;
  for (let attempt = 0; ; attempt++) {
    try {
      // no-store : ni réutilisation des morceaux du cache HTTP (streaming),
      // ni double stockage
      const resp = await fetch(stationUrl(station), {
        headers: { Range: `bytes=${start}-${end}` },
        cache: 'no-store',
        signal
      });
      if (resp.status !== 206) throw new Error('HTTP ' + resp.status);
      const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(resp.headers.get('Content-Range') || '');
      if (!m) throw new Error('Content-Range');
      const size = Number(m[3]);
      const gotEnd = Number(m[2]);
      if (Number(m[1]) !== start || (total && size !== total)
          || gotEnd !== Math.min(end, size - 1)) throw new Error('range');
      const buf = await resp.arrayBuffer();
      if (buf.byteLength !== gotEnd - start + 1) throw new Error('short');
      await cache.put(chunkUrl(station, n), new Response(buf, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Length': String(buf.byteLength),
          'X-Total-Size': String(size)
        }
      }));
      return size;
    } catch (e) {
      if (e.name === 'AbortError' || e.name === 'QuotaExceededError') throw e;
      if (!usable()) {
        await waitUsable(signal);
        attempt = -1; // interruption subie (arrière-plan, coupure) : pas un échec
        continue;
      }
      if (attempt >= DL_RETRIES) throw e;
      await sleep(1000 * 2 ** attempt, signal);
    }
  }
};

// Refus d'un téléchargement qui ne tiendra pas (quand l'API répond)
const checkSpace = async (bytes) => {
  if (!navigator.storage || !navigator.storage.estimate) return;
  let estimate;
  try { estimate = await navigator.storage.estimate(); } catch (e) { return; }
  const { usage, quota } = estimate;
  if (quota && quota - usage < bytes + 16 * 1024 * 1024) {
    throw new DOMException('Storage full', 'QuotaExceededError');
  }
};

const downloadStation = async (index) => {
  const station = stations[index];
  const state = dlState[index];
  state.status = 'downloading';
  state.message = '';
  renderRow(index);
  updateControls();
  dlAbort = new AbortController();
  const signal = dlAbort.signal;
  try {
    const cache = await caches.open(RADIO_CACHE);
    const have = new Set((await cache.keys()).map(r => r.url));
    let total = 0;
    if (have.has(chunkUrl(station, 0))) {
      const first = await cache.match(chunkUrl(station, 0));
      total = Number(first && first.headers.get('X-Total-Size')) || 0;
    }
    if (!total) {
      // premier chunk : donne la taille totale du fichier
      total = await fetchChunk(cache, station, 0, 0, signal);
      have.add(chunkUrl(station, 0));
    }
    const count = Math.ceil(total / DL_CHUNK);
    state.total = total;
    state.received = 0;
    for (let n = 0; n < count; n++) {
      if (have.has(chunkUrl(station, n))) state.received += chunkLen(n, total);
    }
    renderRow(index);
    await checkSpace(total - state.received);

    for (let n = 0; n < count; n++) {
      if (have.has(chunkUrl(station, n))) continue;
      await fetchChunk(cache, station, n, total, signal);
      // compté APRÈS écriture : 100 % = vraiment stocké
      state.received += chunkLen(n, total);
      scheduleRowRender(index);
    }
    await cache.put(manifestUrl(station), new Response(
      JSON.stringify({ size: total, chunk: DL_CHUNK, count }),
      { headers: { 'Content-Type': 'application/json' } }
    ));
    // un éventuel fichier entier de l'ancien format devient inutile
    try { await cache.delete(offlineUrl(station)); } catch (e) {}
    state.status = 'done';
    state.size = total;
    setWanted(index, false);
    if (players[index].paused) swapNow(index);
    else if (navigator.onLine === false) takeOver(index, true);
    else pendingSwap[index] = true;
    updateAvailability();
  } catch (e) {
    // les chunks déjà écrits sont CONSERVÉS : la prochaine tentative reprend
    if (e.name === 'AbortError') {
      state.status = state.received ? 'partial' : 'none';
    } else if (e.name === 'QuotaExceededError') {
      state.status = 'error';
      state.message = T.storageFull;
      drainQueue(); // inutile d'enchaîner les échecs
    } else {
      state.status = 'error';
      state.message = navigator.onLine ? T.downloadFailed : T.noConnection;
    }
  } finally {
    dlAbort = null;
    renderRow(index);
    updateControls();
  }
};

// Écran maintenu allumé pendant les téléchargements (une PWA iOS en
// arrière-plan ne télécharge plus) — quand l'API existe
let wakeLock = null;
const holdWake = async () => {
  if (wakeLock || document.hidden || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) {}
};
const dropWake = () => {
  if (!wakeLock) return;
  wakeLock.release().catch(() => {});
  wakeLock = null;
};
document.addEventListener('visibilitychange', () => {
  // le verrou saute quand l'app passe en arrière-plan : repris au retour
  if (!document.hidden && downloading()) holdWake();
});

// File séquentielle : une station à la fois (la bande passante reste
// disponible pour la station en cours d'écoute) ; survit à la fermeture
// du panneau
const pumpQueue = async () => {
  if (dlActive !== null) return;
  holdWake();
  while (dlQueue.length) {
    const index = dlQueue.shift();
    if (dlState[index].status !== 'queued') continue;
    dlActive = index;
    await downloadStation(index);
    dlActive = null;
  }
  dropWake();
  updateControls();
};

const drainQueue = () => {
  dlQueue.forEach(index => {
    const state = dlState[index];
    if (state.status !== 'queued') return;
    if (state.received) state.status = 'partial';
    else resetState(index);
    renderRow(index);
  });
  dlQueue = [];
};

const enqueue = (indices) => {
  const set = loadWanted();
  indices.forEach(index => {
    const s = dlState[index].status;
    if (s === 'none' || s === 'error' || s === 'partial') {
      dlState[index].status = 'queued';
      dlState[index].message = '';
      dlQueue.push(index);
      set.add(index);
      renderRow(index);
    }
  });
  saveWanted(set);
  updateControls();
  pumpQueue();
};

const startDownloadAll = () => {
  if (!persistAsked) {
    // demandé dans le geste utilisateur du premier téléchargement. Refusé
    // ou indisponible : rien à faire de plus côté app (le navigateur peut
    // alors évincer le cache sous pression ; l'auto-guérison rebascule en
    // streaming et la station repasse en "à télécharger")
    persistAsked = true;
    try { navigator.storage?.persist?.().catch(() => {}); } catch (e) {}
  }
  enqueue(stations.map((_, index) => index));
};

const cancelAll = () => {
  saveWanted(new Set());
  drainQueue();
  if (dlAbort) dlAbort.abort();
  updateControls();
};

// --- Purge -----------------------------------------------------------------
const purgeAll = async () => {
  cancelAll();
  // le SW garde en mémoire le Blob d'une station de l'ancien format : on lui
  // demande de l'oublier
  try { navigator.serviceWorker.controller?.postMessage({ type: 'radio-purged' }); } catch (e) {}
  for (let index = 0; index < stations.length; index++) {
    if (players[index].src === offlineUrl(stations[index])) revertToNetwork(index);
    pendingSwap[index] = false;
    resetState(index);
    renderRow(index);
  }
  // tout le cache radio d'un coup : chunks, manifestes, téléchargements
  // partiels et ancien format
  try { await caches.delete(RADIO_CACHE); } catch (e) {}
  updateControls();
  updateAvailability();
};

// --- Panneau ---------------------------------------------------------------
// Quadrilatère de la grande tuile-liste : coins tirés jusqu'à 6 % — bien
// marqué, mais moins que les 14 % des petits boutons (les bords obliques
// traversent toute la largeur, le padding CSS doit absorber la coupe max)
const listPoly = () => {
  const r = () => (Math.random() * 6).toFixed(1);
  return `polygon(${r()}% ${r()}%, ${100 - r()}% ${r()}%, ${100 - r()}% ${100 - r()}%, ${r()}% ${100 - r()}%)`;
};

const openPanel = () => {
  panelVisible = true;
  playUiSfx('select');
  offlinePanel.style.display = 'flex';
  offlinePanel.classList.add('appear');
  // nouvelle forme à chaque ouverture, comme le menu volume
  document.getElementById('offlineTile').style.clipPath = listPoly();
  updateControls();
  updateEstimate();
};

const closePanel = () => {
  panelVisible = false;
  playUiSfx('cancel');
  offlinePanel.style.display = 'none';
  offlinePanel.classList.remove('appear');
};

// Espace libre en suffixe du total, quand l'API répond (pas sur tous les iOS)
const updateEstimate = async () => {
  if (!navigator.storage || !navigator.storage.estimate) return;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (!quota) return;
    const free = (quota - usage) / 1073741824;
    offlineTotal.textContent +=
      ` · ${free.toFixed(1).replace('.', T.decimal)} ${T.gb} ${T.free}`;
  } catch (e) {}
};

const initOfflinePanel = () => {
  rows = stations.map((station, index) => {
    const row = document.createElement('div');
    row.classList.add('offline-row');

    const logo = document.createElement('img');
    logo.classList.add('offline-logo');
    logo.src = station.logo;
    logo.alt = station.name;

    const info = document.createElement('div');
    info.classList.add('offline-info');
    const name = document.createElement('span');
    name.classList.add('offline-name');
    name.textContent = station.name;
    const statusEl = document.createElement('span');
    statusEl.classList.add('offline-status');
    const bar = document.createElement('div');
    bar.classList.add('offline-bar');
    bar.style.display = 'none';
    const fill = document.createElement('div');
    fill.classList.add('offline-bar-fill');
    bar.appendChild(fill);
    info.append(name, statusEl, bar);

    row.append(logo, info);
    offlineListEl.appendChild(row);
    return { statusEl, bar, fill };
  });
  dlState.forEach((_, index) => renderRow(index));

  offlineButton.style.display = 'flex';
  offlineButton.style.clipPath = randomTilePoly();
  offlineButton.addEventListener('pointerenter', morphControl);
  offlineButton.addEventListener('click', openPanel);

  offlineClose.style.clipPath = randomTilePoly();
  offlineClose.addEventListener('pointerenter', morphControl);
  offlineClose.addEventListener('click', closePanel);

  [offlineDlAll, offlinePurgeAll].forEach(btn => {
    btn.style.clipPath = randomTilePoly();
    btn.addEventListener('pointerenter', morphControl);
  });

  offlineDlAll.addEventListener('click', () => {
    playUiSfx('select');
    if (downloading()) cancelAll();
    else startDownloadAll();
  });

  // confirmation intégrée (pas de confirm() natif, hors DA)
  let purgeArmed = 0;
  offlinePurgeAll.addEventListener('click', () => {
    if (!purgeArmed) {
      playUiSfx('select');
      offlinePurgeAll.textContent = T.confirm;
      purgeArmed = setTimeout(() => {
        purgeArmed = 0;
        offlinePurgeAll.textContent = T.deleteAll;
      }, 3000);
      return;
    }
    clearTimeout(purgeArmed);
    purgeArmed = 0;
    offlinePurgeAll.textContent = T.deleteAll;
    playUiSfx('cancel');
    purgeAll();
  });

  // fermeture au clic sur le fond noir
  offlinePanel.addEventListener('click', (e) => {
    if (e.target === offlinePanel) closePanel();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelVisible) closePanel();
  });

  updateControls();
};

// --- Branchements sur les players ------------------------------------------
if (OFFLINE_SUPPORTED) {
  players.forEach((el, index) => {
    // swap différé : setStation() passe par stopAll() avant le static, donc
    // tout switch de station applique le swap pendant le static — le play
    // différé repart sur la source offline via le chemin déjà robuste iOS
    el.addEventListener('pause', () => {
      if (pendingSwap[index]) {
        pendingSwap[index] = false;
        swapNow(index);
      }
    });

    // auto-guérison : entrée de cache évincée par l'OS → retour au streaming
    // (l'auto-retry d'app.js relance ensuite la lecture). Si l'entrée est
    // saine mais que le média échoue en boucle (navigateur qui ne route pas
    // les éléments média par le SW), on rebascule aussi, sans purger.
    let mediaErrors = 0;
    el.addEventListener('playing', () => { mediaErrors = 0; });
    el.addEventListener('error', async () => {
      if (!el.src.includes('/offline/')) return;
      let healthy = false;
      try {
        const cache = await caches.open(RADIO_CACHE);
        healthy = !!(await cache.match(manifestUrl(stations[index]))
          || await cache.match(offlineUrl(stations[index])));
      } catch (e) {}
      if (healthy && ++mediaErrors < 3) return; // laisser l'auto-retry d'app.js tenter
      if (!healthy) {
        resetState(index);
        renderRow(index);
        updateControls();
      }
      revertToNetwork(index);
    });
  });

  // flux réseau bloqué alors qu'on est hors ligne : bascule sans attendre
  // l'erreur (qui peut mettre des minutes à venir)
  players.forEach((el, index) => {
    const onStall = () => {
      if (navigator.onLine === false) takeOver(index, !el.paused);
    };
    el.addEventListener('waiting', onStall);
    el.addEventListener('stalled', onStall);
  });
  window.addEventListener('offline', takeOverAll);

  window.vcrOffline.takeOver = takeOver;
  window.vcrOffline.isDownloaded = (index) => dlState[index].status === 'done';

  if (showOfflineUi()) initOfflinePanel();
  // le check tourne même hors PWA : un utilisateur ayant téléchargé en PWA
  // garde le bénéfice s'il ouvre l'URL dans un onglet navigateur
  initOffline();
}
