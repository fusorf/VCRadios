// ---------------------------------------------------------------------------
// Vice City Radio
// Un élément <audio> persistant par station (le switch ne recharge jamais de
// src), statics joués via Web Audio (latence ~0), position "live" calculée
// sur une horloge murale commune. Carrousel infini piloté au drag
// (tactile + souris) avec bouclage circulaire dans le sens du geste.
// ---------------------------------------------------------------------------

// Fichiers radio servis depuis le bucket R2 "vicecity" via le Worker proxy
// (worker/index.js) : l'URL publique de dev pub-*.r2.dev est rate-limitée
// par Cloudflare et lâchait des requêtes aléatoirement.
const AUDIO_BASE_URL = 'https://vcradios-audio.fusorf.workers.dev';

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
let started = false;
let pendingSwitch = null;

const container = document.querySelector('.container');

const logoContainer = document.createElement('div');
logoContainer.classList.add('station-carousel', 'hidden');
container.appendChild(logoContainer);

// --- Pool d'éléments audio (un par station, jamais rechargés) --------------
const audioPool = document.createElement('div');
audioPool.style.display = 'none';
document.body.appendChild(audioPool);

const players = stations.map(station => {
  const el = document.createElement('audio');
  // métadonnées chargées pour les 9 stations (quelques centaines de Ko au
  // total) : sans durée connue, un switch vers une station "froide" partirait
  // du début du fichier au lieu de sa position live
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

// Cible du dernier seek demandé par élément. WebKit (iOS) peut ignorer
// silencieusement un seek posé sur un élément en pause (le getter currentTime
// renvoie pourtant la nouvelle valeur) et reprendre la lecture à l'ancienne
// position interne : on vérifie donc au 'playing' que la lecture a bien
// démarré à la cible demandée.
const seekIntents = stations.map(() => null);

// Recale un lecteur sur sa position "live". Distance circulaire : au moment où
// le fichier boucle, currentTime et la position live sont aux deux extrémités
// du fichier sans être réellement désynchronisés.
const syncToLive = (index, tolerance = 1.5) => {
  const el = players[index];
  const pos = livePosition(index);
  if (pos === null) return false;
  const delta = Math.abs(el.currentTime - pos);
  const drift = Math.min(delta, el.duration - delta);
  if (drift > tolerance) {
    el.currentTime = pos;
    seekIntents[index] = pos;
  }
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
  if (!started) return;
  goTo(Math.round(carouselTarget) + direction);
};

// --- Masque polygonal ------------------------------------------------------
// Quadrilatère irrégulier : un point aléatoire par quart d'écran (ni trop
// près du bord, ni trop près du centre), en coordonnées viewBox 0-100.
// Le chemin evenodd = rectangle plein écran noir percé du quadrilatère.
// À chaque changement de station, nouveaux points et interpolation.
const maskPath = document.getElementById('maskPath');
const stationTitle = document.getElementById('stationTitle');

const rand = (a, b) => a + Math.random() * (b - a);

const randomMaskPoints = () => [
  { x: rand(6, 28), y: rand(10, 32) }, // haut gauche
  { x: rand(72, 94), y: rand(10, 32) }, // haut droit
  { x: rand(72, 94), y: rand(68, 90) }, // bas droit
  { x: rand(6, 28), y: rand(68, 90) }  // bas gauche
];

// Masque fermé (les 4 points au centre) avant le lancement
let maskPoints = [{ x: 50, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 50 }];
let maskFrom = maskPoints;
let maskTo = maskPoints;
let maskAnimStart = 0;
let maskRaf = null;
const MASK_DURATION = 700;

const renderMask = (pts) => {
  const quad = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ');
  maskPath.setAttribute('d', `M0 0 H100 V100 H0 Z ${quad} Z`);
};

const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const animateMask = (now) => {
  const t = Math.min(1, (now - maskAnimStart) / MASK_DURATION);
  const e = easeInOutCubic(t);
  maskPoints = maskFrom.map((p, i) => ({
    x: p.x + (maskTo[i].x - p.x) * e,
    y: p.y + (maskTo[i].y - p.y) * e
  }));
  renderMask(maskPoints);
  maskRaf = t < 1 ? requestAnimationFrame(animateMask) : null;
};

const retargetMask = () => {
  maskFrom = maskPoints.map(p => ({ ...p }));
  maskTo = randomMaskPoints();
  maskAnimStart = performance.now();
  if (maskRaf === null) maskRaf = requestAnimationFrame(animateMask);
};

renderMask(maskPoints);

const updateStationTitle = () => {
  stationTitle.textContent = stations[currentStation].name;
};

// --- Drag unifié tactile + souris (Pointer Events) -------------------------
let dragStartX = 0;
let dragStartPos = 0;
let dragLastX = 0;
let dragLastT = 0;
let dragVelocity = 0; // px/ms lissée

container.addEventListener('pointerdown', e => {
  if (!started) return;
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

// --- Lecture ---------------------------------------------------------------
// Prépare les stations adjacentes : le navigateur bufferise autour de leur
// position live, le prochain switch part donc d'une zone déjà chargée.
// Différé de 3 s après chaque lecture pour laisser toute la bande passante
// au démarrage de la station courante.
const warmNeighbors = () => {
  const next = mod(currentStation + 1, stations.length);
  const prev = mod(currentStation - 1, stations.length);
  [next, prev].forEach(index => {
    const el = players[index];
    el.preload = 'auto';
    if (el.paused && !syncToLive(index)) {
      // métadonnées pas encore là : se recaler dès qu'elles arrivent, sinon
      // le buffering se ferait au début du fichier au lieu de la zone live
      el.addEventListener('loadedmetadata', () => {
        if (el.paused) syncToLive(index);
      }, { once: true });
    }
  });
};

let warmTimer = null;
const scheduleWarm = () => {
  if (warmTimer) clearTimeout(warmTimer);
  warmTimer = setTimeout(() => {
    warmTimer = null;
    warmNeighbors();
  }, 3000);
};

const playStation = (index) => {
  const el = players[index];
  if (!syncToLive(index)) {
    el.addEventListener('loadedmetadata', () => {
      if (index === currentStation) syncToLive(index);
    }, { once: true });
  }
  el.play().catch(() => {
    // play() refusé (ex : switch déclenché par un pointercancel, donc hors
    // activation utilisateur) : retente au prochain geste
    const retry = () => {
      document.removeEventListener('pointerup', retry, true);
      document.removeEventListener('keydown', retry, true);
      if (index === currentStation) playStation(index);
    };
    document.addEventListener('pointerup', retry, true);
    document.addEventListener('keydown', retry, true);
  });
  scheduleWarm();
};

const stopAll = () => {
  players.forEach(el => { if (!el.paused) el.pause(); });
};

const setStation = (index) => {
  currentStation = index;
  try { localStorage.setItem('vcr-station', String(index)); } catch (e) {}

  updateMediaSessionMetadata();
  updateStationTitle();
  retargetMask();

  // Coupure immédiate, static seul, puis la nouvelle station démarre à la fin
  // du static. Le seek pendant le static remplit le buffer au bon endroit.
  // PAS de play()+pause() de "bénédiction" ici : la course play→pause→play
  // peut laisser l'élément en pause (le pause interne se résout après le play
  // final sur un pipeline lent — silence aléatoire constaté sur iOS). Le play
  // différé reste autorisé : WebKit propage l'activation utilisateur à
  // travers un setTimeout court, et le retry-au-geste couvre le reste.
  stopAll();
  const staticDuration = playStatic();
  syncToLive(currentStation);

  if (pendingSwitch) clearTimeout(pendingSwitch);
  pendingSwitch = setTimeout(() => {
    pendingSwitch = null;
    if (index === currentStation) playStation(index);
  }, Math.max(80, staticDuration * 1000 - 60));
};

// --- Démarrage -------------------------------------------------------------
initCarousel();
setupMediaSession();
updateMediaSessionMetadata();

const playButton = document.getElementById('playButton');

playButton.addEventListener('click', () => {
  if (started) return;
  started = true;
  playButton.style.display = 'none';
  logoContainer.classList.remove('hidden');
  updateStationTitle();
  retargetMask();

  initAudioCtx();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

  // Pas de bénédiction de masse des 9 lecteurs : même mis en pause aussitôt,
  // un élément "play()é" continue de bufferiser agressivement (~15 Mo chacun,
  // soit >100 Mo qui asphyxient le démarrage). Chaque station est bénie dans
  // le geste de son propre switch (setStation), avec retry au geste suivant
  // si un play() est refusé.
  playStation(currentStation);
});

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
  if (!el.paused) syncToLive(currentStation, 10);
});

// Filet de sécurité si loop déraille (vieux iOS) : repart sur la position live
players.forEach((el, index) => {
  el.addEventListener('ended', () => {
    syncToLive(index);
    el.play().catch(() => {});
  });
});

// Auto-guérison : une erreur réseau (rate limit r2.dev, coupure…) laisse
// l'élément mort jusqu'à un reload. On le réinitialise avec un backoff
// exponentiel et on relance la lecture si c'est la station courante.
const retryDelays = players.map(() => 0);
players.forEach((el, index) => {
  el.addEventListener('playing', () => { retryDelays[index] = 0; });
  el.addEventListener('error', () => {
    retryDelays[index] = Math.min(15000, retryDelays[index] ? retryDelays[index] * 2 : 1500);
    setTimeout(() => {
      el.load();
      el.addEventListener('loadedmetadata', () => {
        if (index === currentStation && started) {
          syncToLive(index);
          el.play().catch(() => {});
        }
      }, { once: true });
    }, retryDelays[index]);
  });
});

// Vérification au démarrage réel de la lecture. Deux cas distincts :
// - la lecture démarre À LA CIBLE du dernier seek (même après un long
//   buffering, currentTime n'a pas bougé de la cible) → seek appliqué, on ne
//   touche à rien : re-seeker sur simple retard de buffering jette le buffer
//   et peut empêcher indéfiniment le démarrage ;
// - la lecture démarre LOIN de la cible → le moteur a ignoré le seek posé en
//   pause (WebKit/iOS) et a repris à l'ancienne position → on recale, cette
//   fois en cours de lecture où les seeks fonctionnent partout.
players.forEach((el, index) => {
  el.addEventListener('playing', () => {
    if (index !== currentStation) return;
    const intended = seekIntents[index];
    seekIntents[index] = null;
    if (intended !== null && Math.abs(el.currentTime - intended) > 2.5) {
      syncToLive(index);
    } else {
      // pas de seek en attente : simple garde-fou contre les grosses dérives
      syncToLive(index, 10);
    }
  });
});

setInterval(() => {
  const el = players[currentStation];
  // jamais pendant un seek/buffering en cours : on relancerait la roue
  if (!el.paused && !el.seeking && el.readyState >= 3) {
    syncToLive(currentStation, 10);
  }
}, 4000);

// --- Clavier ---------------------------------------------------------------
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'ArrowLeft') step(-1);
});
