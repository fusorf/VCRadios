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

// --- État des téléchargements ----------------------------------------------
// status : 'none' | 'queued' | 'downloading' | 'done' | 'error'
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
  if (state.status === 'downloading') {
    const pct = state.total ? Math.round(state.received / state.total * 100) : 0;
    row.statusEl.textContent = state.total
      ? `${T.pct(pct)} — ${fmtMB(state.received)} / ${fmtMB(state.total)}`
      : fmtMB(state.received);
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
  offlineDlAll.style.display = allDone ? 'none' : '';
  offlineDlAll.textContent = downloading() ? T.cancel : T.downloadAll;
  offlinePurgeAll.style.display = doneSizes.length || downloading() ? '' : 'none';
};

// --- Swap des sources ------------------------------------------------------
const swapNow = (index) => {
  const el = players[index];
  // bénédiction iOS en vol (src = silence data-URI) : el.src sera restauré
  // par le bless, on retentera à la prochaine pause
  if (el.src === SILENT_WAV) { pendingSwap[index] = true; return; }
  el.src = offlineUrl(stations[index]);
  el.preload = 'metadata';
  syncToLive(index); // pose le seekIntent, ré-asserté au canplay par app.js
};

// Retour au streaming réseau (purge ou entrée de cache disparue)
const revertToNetwork = (index) => {
  const el = players[index];
  pendingSwap[index] = false;
  if (el.src !== stationUrl(stations[index])) {
    const wasPlaying = !el.paused;
    el.src = stationUrl(stations[index]);
    el.preload = 'metadata';
    if (wasPlaying && index === currentStation) playStation(index);
    else syncToLive(index);
  }
};

const applyOfflineSources = () => {
  stations.forEach((station, index) => {
    if (dlState[index].status !== 'done') return;
    if (players[index].paused) swapNow(index);
    else pendingSwap[index] = true;
  });
};

// --- Check au démarrage ----------------------------------------------------
const initOffline = async () => {
  let cache;
  try { cache = await caches.open(RADIO_CACHE); } catch (e) { return; }
  await Promise.all(stations.map(async (station, index) => {
    // match par chaîne URL, jamais par Request : un header Range sur la
    // requête fait échouer Cache.match selon les navigateurs
    const hit = await cache.match(offlineUrl(station));
    if (hit) {
      dlState[index].status = 'done';
      dlState[index].size = Number(hit.headers.get('Content-Length')) || 0;
      renderRow(index);
    }
  }));
  // sans SW contrôlant la page (premier chargement, hard-reload), les URLs
  // /offline/ prendraient un 404 GitHub Pages : rester en streaming
  if (navigator.serviceWorker.controller) applyOfflineSources();
  else navigator.serviceWorker.ready.then(() => {
    if (navigator.serviceWorker.controller) applyOfflineSources();
  });
  updateControls();
};

// --- Téléchargement --------------------------------------------------------
const downloadStation = async (index) => {
  const station = stations[index];
  const state = dlState[index];
  state.status = 'downloading';
  state.received = 0;
  state.total = 0;
  renderRow(index);
  updateControls();
  dlAbort = new AbortController();
  const cache = await caches.open(RADIO_CACHE);
  try {
    // GET sans Range : le worker renvoie un 200 complet, Content-Length est
    // CORS-safelisted donc lisible sans Expose-Headers
    const resp = await fetch(stationUrl(station), { signal: dlAbort.signal });
    if (resp.status !== 200 || !resp.body) throw new Error('HTTP ' + resp.status);
    const total = Number(resp.headers.get('Content-Length')) || 0;
    state.total = total;

    // tee() : une branche pour la progression, l'autre streamée vers le cache
    // (aucune accumulation en RAM — K-Chat fait ~100 Mo)
    const [progressBody, storeBody] = resp.body.tee();
    const putPromise = cache.put(offlineUrl(station), new Response(storeBody, {
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(total) }
    }));
    putPromise.catch(() => {}); // le reader peut jeter en premier (abort)

    const reader = progressBody.getReader();
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      state.received = received;
      scheduleRowRender(index);
    }
    await putPromise; // rejette sur flux cassé ou QuotaExceededError
    if (total && received !== total) {
      await cache.delete(offlineUrl(station));
      throw new Error('incomplet');
    }
    state.status = 'done';
    state.size = received;
    if (players[index].paused) swapNow(index);
    else pendingSwap[index] = true;
  } catch (e) {
    try { await cache.delete(offlineUrl(station)); } catch (_) {}
    if (e.name === 'AbortError') {
      resetState(index);
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

// File séquentielle : une station à la fois (la bande passante reste
// disponible pour la station en cours d'écoute) ; survit à la fermeture
// du panneau
const pumpQueue = async () => {
  if (dlActive !== null) return;
  while (dlQueue.length) {
    const index = dlQueue.shift();
    if (dlState[index].status !== 'queued') continue;
    dlActive = index;
    await downloadStation(index);
    dlActive = null;
  }
  updateControls();
};

const drainQueue = () => {
  dlQueue.forEach(index => {
    if (dlState[index].status === 'queued') { resetState(index); renderRow(index); }
  });
  dlQueue = [];
};

const startDownloadAll = () => {
  if (!persistAsked) {
    // demandé dans le geste utilisateur du premier téléchargement
    persistAsked = true;
    try { navigator.storage?.persist?.().catch(() => {}); } catch (e) {}
  }
  stations.forEach((_, index) => {
    const s = dlState[index].status;
    if (s === 'none' || s === 'error') {
      dlState[index].status = 'queued';
      dlState[index].message = '';
      dlQueue.push(index);
      renderRow(index);
    }
  });
  updateControls();
  pumpQueue();
};

const cancelAll = () => {
  drainQueue();
  if (dlAbort) dlAbort.abort();
  updateControls();
};

// --- Purge -----------------------------------------------------------------
const purgeAll = async () => {
  cancelAll();
  let cache;
  try { cache = await caches.open(RADIO_CACHE); } catch (e) { return; }
  for (let index = 0; index < stations.length; index++) {
    if (players[index].src === offlineUrl(stations[index])) revertToNetwork(index);
    pendingSwap[index] = false;
    try { await cache.delete(offlineUrl(stations[index])); } catch (e) {}
    resetState(index);
    renderRow(index);
  }
  updateControls();
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
        healthy = !!(await cache.match(offlineUrl(stations[index])));
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

  if (showOfflineUi()) initOfflinePanel();
  // le check tourne même hors PWA : un utilisateur ayant téléchargé en PWA
  // garde le bénéfice s'il ouvre l'URL dans un onglet navigateur
  initOffline();
}
