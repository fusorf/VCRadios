// ---------------------------------------------------------------------------
// Vice City Radio
// Un élément <audio> persistant par station (le switch ne recharge jamais de
// src), statics joués via Web Audio (latence ~0), position "live" calculée
// sur une horloge murale commune. Carrousel infini piloté au drag
// (tactile + souris) avec bouclage circulaire dans le sens du geste.
// ---------------------------------------------------------------------------

// Fichiers radio servis depuis Cloudflare R2 (bucket "vicecity"), même
// principe que xeno-series-heardle. Les statics et logos restent locaux.
// URL publique du bucket : R2 → vicecity → Settings → Public access.
const AUDIO_BASE_URL = 'https://pub-78e65d92e7574926a519b54ecff12c87.r2.dev';

const stations = [
  { name: "Emotion 98.3", file: "radio/EMOTION.mp3", logo: "logos/Emotion98.3-GTAVC-Logo.webp" },
  { name: "Radio Espantoso", file: "radio/ESPANT.mp3", logo: "logos/RadioEspantoso-GTAVC-Logo.webp" },
  { name: "Fever 105", file: "radio/FEVER.mp3", logo: "logos/Fever_105.webp" },
  { name: "Flash FM", file: "radio/FLASH.mp3", logo: "logos/FlashFM.webp" },
  { name: "K-Chat", file: "radio/KCHAT.mp3", logo: "logos/KChat-GTAVC-Logo.webp" },
  { name: "VCPR", file: "radio/VCPR.mp3", logo: "logos/ViceCityPublicRadio-GTAVC-Logo.svg" },
  { name: "V-Rock", file: "radio/VROCK.mp3", logo: "logos/V-Rock-GTAVC-Logo.svg" },
  { name: "Wave 103", file: "radio/WAVE.mp3", logo: "logos/Wave103-GTAVC-Logo.svg" },
  { name: "Wildstyle", file: "radio/WILD.mp3", logo: "logos/WildstylePirateRadio.webp" }
];

const STATIC_SOUNDS = [
  "sfx/static1.mp3", "sfx/static2.mp3", "sfx/static3.mp3", "sfx/static4.mp3",
  "sfx/static5.mp3", "sfx/static6.mp3", "sfx/static7.mp3", "sfx/static8.mp3",
  "sfx/static9.mp3", "sfx/static10.mp3", "sfx/static11.mp3", "sfx/static12.mp3"
];

const mod = (n, m) => ((n % m) + m) % m;

const stationUrl = (station) => `${AUDIO_BASE_URL}/${station.file}`;

// --- Modèle radio "en direct" ----------------------------------------------
// Chaque station avance sur une horloge murale depuis EPOCH, plus un décalage
// aléatoire par station persisté en localStorage : la position est donc
// continue entre les switchs, les rechargements et les sessions, comme une
// vraie radio qui émet en permanence.
const EPOCH = Date.UTC(2026, 0, 1);

const loadOffsets = () => {
  try {
    const saved = JSON.parse(localStorage.getItem('vcr-offsets'));
    if (Array.isArray(saved) && saved.length === stations.length) return saved;
  } catch (e) { /* localStorage indisponible ou corrompu */ }
  const fresh = stations.map(() => Math.floor(Math.random() * 86400));
  try { localStorage.setItem('vcr-offsets', JSON.stringify(fresh)); } catch (e) {}
  return fresh;
};
const offsets = loadOffsets();

const loadLastStation = () => {
  const saved = Number(localStorage.getItem('vcr-station'));
  return Number.isInteger(saved) && saved >= 0 && saved < stations.length ? saved : 0;
};

// --- État ------------------------------------------------------------------
let currentStation = loadLastStation();
let audioUnlocked = false;
let pendingSwitch = null;

const container = document.querySelector('.container');

const logoContainer = document.createElement('div');
logoContainer.classList.add('station-carousel');
container.appendChild(logoContainer);

// --- Pool d'éléments audio (un par station, jamais rechargés) --------------
const audioPool = document.createElement('div');
audioPool.style.display = 'none';
document.body.appendChild(audioPool);

const players = stations.map(station => {
  const el = document.createElement('audio');
  el.preload = 'metadata';
  el.loop = true;
  el.src = stationUrl(station);
  audioPool.appendChild(el);
  return el;
});

const livePosition = (index) => {
  const duration = players[index].duration;
  if (!isFinite(duration) || duration <= 0) return null;
  const elapsed = (Date.now() - EPOCH) / 1000 + offsets[index];
  return mod(elapsed, duration);
};

// Recale un lecteur sur sa position "live". Distance circulaire : au moment où
// le fichier boucle, currentTime et la position live sont aux deux extrémités
// du fichier sans être réellement désynchronisés.
const syncToLive = (index, tolerance = 1.5) => {
  const el = players[index];
  const pos = livePosition(index);
  if (pos === null) return false;
  const delta = Math.abs(el.currentTime - pos);
  const drift = Math.min(delta, el.duration - delta);
  if (drift > tolerance) el.currentTime = pos;
  return true;
};

// --- Statics via Web Audio (décodés une fois, déclenchement instantané) ----
// Les fichiers sont téléchargés dès le chargement, mais l'AudioContext n'est
// créé qu'au premier geste : instancié avant interaction, il démarrerait
// "suspended" avec un avertissement console.
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
const staticBuffers = [];
let staticIndex = 0;

const staticFetches = STATIC_SOUNDS.map(url =>
  fetch(url).then(r => r.arrayBuffer()).catch(() => null)
);

const initAudioCtx = () => {
  if (audioCtx || !AudioCtx) return;
  audioCtx = new AudioCtx();
  staticFetches.forEach(p => p.then(data => {
    if (data) {
      audioCtx.decodeAudioData(data)
        .then(buffer => staticBuffers.push(buffer))
        .catch(() => {});
    }
  }));
};

// Joue un static et renvoie sa durée en secondes
const playStatic = () => {
  if (!audioCtx || staticBuffers.length === 0) return 0.15;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  staticIndex = (staticIndex + 1) % staticBuffers.length;
  const source = audioCtx.createBufferSource();
  source.buffer = staticBuffers[staticIndex];
  source.connect(audioCtx.destination);
  source.start();
  return source.buffer.duration;
};

// --- Carrousel infini ------------------------------------------------------
// Position virtuelle non bornée en "unités de station" : 9.0 == 0.0 visuel-
// lement (rendu modulo), donc avancer depuis la dernière station fait entrer
// la première par le même côté, sans jamais rembobiner.
let carouselPos = currentStation;   // position rendue (suit le doigt / l'easing)
let carouselTarget = currentStation; // position visée
let rafId = null;
let dragging = false;
let pages = [];

const initCarousel = () => {
  logoContainer.innerHTML = '';
  pages = stations.map(station => {
    const page = document.createElement('div');
    page.classList.add('station-page');
    const img = document.createElement('img');
    img.src = station.logo;
    img.alt = station.name;
    page.appendChild(img);
    logoContainer.appendChild(page);
    return page;
  });
  renderCarousel();
};

const renderCarousel = () => {
  const base = mod(carouselPos, stations.length);
  pages.forEach((page, index) => {
    let delta = index - base;
    if (delta > stations.length / 2) delta -= stations.length;
    if (delta < -stations.length / 2) delta += stations.length;
    if (Math.abs(delta) > 1.5) {
      page.style.visibility = 'hidden';
    } else {
      page.style.visibility = 'visible';
      const scale = 1 - 0.15 * Math.min(1, Math.abs(delta));
      page.style.transform = `translateX(${delta * 100}%) scale(${scale})`;
    }
  });
};

const animateCarousel = () => {
  const diff = carouselTarget - carouselPos;
  if (!dragging && Math.abs(diff) < 0.001) {
    carouselPos = carouselTarget;
    renderCarousel();
    rafId = null;
    return;
  }
  if (!dragging) carouselPos += diff * 0.18;
  renderCarousel();
  rafId = requestAnimationFrame(animateCarousel);
};

const startCarouselAnim = () => {
  if (rafId === null) rafId = requestAnimationFrame(animateCarousel);
};

// Vise une position (entière) du carrousel et déclenche l'audio si la station
// d'arrivée change
const goTo = (target) => {
  carouselTarget = target;
  startCarouselAnim();
  const index = mod(Math.round(target), stations.length);
  if (index !== currentStation) setStation(index);
};

// Avance d'un cran dans une direction (flèches, media session) : la cible non
// bornée garantit le bouclage dans le même sens
const step = (direction) => {
  goTo(Math.round(carouselTarget) + direction);
};

// --- Drag unifié tactile + souris (Pointer Events) -------------------------
let dragStartX = 0;
let dragStartPos = 0;
let dragLastX = 0;
let dragLastT = 0;
let dragVelocity = 0; // px/ms lissée

container.addEventListener('pointerdown', e => {
  dragging = true;
  container.setPointerCapture(e.pointerId);
  container.classList.add('dragging');
  dragStartX = e.clientX;
  dragStartPos = carouselPos;
  dragLastX = e.clientX;
  dragLastT = performance.now();
  dragVelocity = 0;
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
});

container.addEventListener('pointermove', e => {
  if (!dragging) return;
  const now = performance.now();
  const dt = now - dragLastT;
  if (dt > 0) dragVelocity = dragVelocity * 0.8 + ((e.clientX - dragLastX) / dt) * 0.2;
  dragLastX = e.clientX;
  dragLastT = now;
  carouselPos = dragStartPos + (dragStartX - e.clientX) / container.clientWidth;
  renderCarousel();
});

const endDrag = () => {
  if (!dragging) return;
  dragging = false;
  container.classList.remove('dragging');
  // vélocité en stations/s, positive vers la station suivante
  const flick = -dragVelocity * 1000 / container.clientWidth;
  let target;
  if (Math.abs(flick) > 1.5) {
    target = flick > 0 ? Math.floor(carouselPos) + 1 : Math.ceil(carouselPos) - 1;
  } else {
    target = Math.round(carouselPos);
  }
  goTo(target);
};

container.addEventListener('pointerup', endDrag);
container.addEventListener('pointercancel', endDrag);

// --- Media Session (écran de verrouillage) ---------------------------------
const updateMediaSessionMetadata = () => {
  if (!('mediaSession' in navigator)) return;
  const station = stations[currentStation];
  const isSvg = station.logo.endsWith('.svg');
  navigator.mediaSession.metadata = new MediaMetadata({
    title: station.name,
    artist: 'Vice City Radio',
    album: 'GTA Vice City',
    artwork: [
      isSvg
        ? { src: station.logo, sizes: 'any', type: 'image/svg+xml' }
        : { src: station.logo, type: 'image/webp' }
    ]
  });
};

const setupMediaSession = () => {
  if (!('mediaSession' in navigator)) return;
  // "play" resynchronise sur la position live : une radio n'est jamais en pause
  navigator.mediaSession.setActionHandler('play', () => playStation(currentStation));
  navigator.mediaSession.setActionHandler('pause', () => players[currentStation].pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
  navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
};

// --- Préchargement complet via Service Worker ------------------------------
const canPreloadHeavy = () => {
  const conn = navigator.connection;
  if (!conn) return true;
  return !conn.saveData && !/(^|-)2g$/.test(conn.effectiveType || '');
};

const requestFullPreload = (index) => {
  const station = stations[index];
  if (station.preloaded || !('serviceWorker' in navigator) || !canPreloadHeavy()) return;
  navigator.serviceWorker.ready.then(reg => {
    if (reg.active) {
      reg.active.postMessage({
        type: 'PRELOAD_STATION',
        url: stationUrl(station)
      });
    }
  }).catch(() => {});
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    const data = event.data;
    if (!data || data.type !== 'STATION_PRELOADED' || !data.ok) return;
    const station = stations.find(s => data.url === stationUrl(s));
    if (station) station.preloaded = true;
  });
}

const scheduleFullPreloads = () => {
  const next = mod(currentStation + 1, stations.length);
  const prev = mod(currentStation - 1, stations.length);
  const order = [currentStation, next, prev];
  stations.forEach((_, i) => { if (!order.includes(i)) order.push(i); });
  order.forEach((index, rank) => {
    setTimeout(() => requestFullPreload(index), 2000 + rank * 8000);
  });
  // Filet de sécurité : retente les stations manquées (le SW ignore celles déjà en cache)
  setInterval(() => stations.forEach((_, i) => requestFullPreload(i)), 120000);
};

// --- Lecture ---------------------------------------------------------------
// Prépare les stations adjacentes : le navigateur bufferise autour de leur
// position live, le prochain switch part donc d'une zone déjà chargée.
const warmNeighbors = () => {
  const next = mod(currentStation + 1, stations.length);
  const prev = mod(currentStation - 1, stations.length);
  [next, prev].forEach(index => {
    const el = players[index];
    el.preload = 'auto';
    if (el.paused) syncToLive(index);
  });
  requestFullPreload(next);
  requestFullPreload(prev);
};

const playStation = (index) => {
  const el = players[index];
  if (!syncToLive(index)) {
    el.addEventListener('loadedmetadata', () => {
      if (index === currentStation) syncToLive(index);
    }, { once: true });
  }
  el.play().catch(() => {});
  warmNeighbors();
};

const stopAll = () => {
  players.forEach(el => { if (!el.paused) el.pause(); });
};

const setStation = (index) => {
  currentStation = index;
  try { localStorage.setItem('vcr-station', String(index)); } catch (e) {}

  updateMediaSessionMetadata();

  // Coupure immédiate couverte par le static ; le zapping rapide reste fluide :
  // chaque switch annule le démarrage en attente du précédent (debounce)
  stopAll();
  const staticDuration = playStatic();
  if (pendingSwitch) clearTimeout(pendingSwitch);
  pendingSwitch = setTimeout(() => {
    pendingSwitch = null;
    playStation(currentStation);
  }, Math.max(80, staticDuration * 1000 - 60));
};

// Débloque la lecture programmatique de tous les lecteurs pendant le geste
// utilisateur (requis par iOS : un play() par élément dans le contexte du tap)
const primePlayers = () => {
  players.forEach((el, index) => {
    if (index === currentStation) return;
    el.muted = true;
    const p = el.play();
    if (p && p.then) {
      p.then(() => {
        el.muted = false;
        // ne pas couper la station si l'utilisateur a switché dessus entre-temps
        if (index !== currentStation) el.pause();
      }).catch(() => { el.muted = false; });
    }
  });
};

// --- Démarrage -------------------------------------------------------------
// Page radio directe, sans bouton. L'autoplay avec son étant souvent bloqué
// au premier chargement, on le tente quand même (PWA installée / engagement
// élevé) et sinon la lecture démarre au premier geste, le carrousel étant
// déjà utilisable.
const unlockAudio = () => {
  if (audioUnlocked) return;
  audioUnlocked = true;
  initAudioCtx();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  primePlayers();
  playStation(currentStation);
  scheduleFullPreloads();
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
};

initCarousel();
setupMediaSession();
updateMediaSessionMetadata();

// Ne sonde l'autoplay que s'il a une chance d'aboutir : un play() refusé
// laisse un avertissement console même quand le rejet est intercepté
const autoplayPossible = typeof navigator.getAutoplayPolicy !== 'function'
  || navigator.getAutoplayPolicy('mediaelement') === 'allowed';
if (autoplayPossible) {
  const autoplayProbe = players[currentStation].play();
  if (autoplayProbe && autoplayProbe.then) {
    autoplayProbe.then(() => unlockAudio()).catch(() => { /* attendre un geste */ });
  }
}

document.addEventListener('pointerdown', unlockAudio, true);
document.addEventListener('keydown', unlockAudio, true);

// Resynchronise les stations voisines en pause pour que le prochain switch
// tombe dans une zone déjà bufferisée
setInterval(() => {
  const next = mod(currentStation + 1, stations.length);
  const prev = mod(currentStation - 1, stations.length);
  [next, prev].forEach(index => { if (players[index].paused) syncToLive(index); });
}, 15000);

// Corrige la dérive après une mise en veille de l'onglet ou de l'appareil
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const el = players[currentStation];
  if (!el.paused) syncToLive(currentStation);
});

// Filet de sécurité si loop déraille (vieux iOS) : repart sur la position live
players.forEach((el, index) => {
  el.addEventListener('ended', () => {
    syncToLive(index);
    el.play().catch(() => {});
  });
});

// Un seek vers une zone non "seekable" (pas encore bufferisée, ou serveur sans
// support Range) est rogné par le navigateur : la lecture partirait d'un point
// quasi aléatoire. On vérifie donc la position dès que la lecture démarre puis
// en continu, et on re-seek jusqu'à retomber sur le direct.
players.forEach((el, index) => {
  el.addEventListener('playing', () => {
    if (index === currentStation) syncToLive(index, 3);
  });
});

setInterval(() => {
  const el = players[currentStation];
  if (!el.paused) syncToLive(currentStation, 3);
}, 4000);

// --- Clavier ---------------------------------------------------------------
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'ArrowLeft') step(-1);
});
