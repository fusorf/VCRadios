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

// Durées codées en dur (les fichiers ne changent jamais) : iOS estime la
// durée d'un MP3 progressivement pendant le chargement, donc s'appuyer sur
// el.duration donnait des positions fausses et instables entre les refresh,
// et des seeks rognés (lecture depuis 0). Avec des constantes, la position
// live est calculable immédiatement, avant toute métadonnée, et identique
// sur tous les appareils.
const stations = [
  { name: "Emotion 98.3", file: "radio/EMOTION.mp3", logo: "logos/Emotion98.3-GTAVC-Logo.webp", duration: 3546.828 },
  { name: "Radio Espantoso", file: "radio/ESPANT.mp3", logo: "logos/RadioEspantoso-GTAVC-Logo.webp", duration: 3698.233 },
  { name: "Fever 105", file: "radio/FEVER.mp3", logo: "logos/Fever_105.webp", duration: 3793.189 },
  { name: "Flash FM", file: "radio/FLASH.mp3", logo: "logos/FlashFM.webp", duration: 3587.840 },
  { name: "K-Chat", file: "radio/KCHAT.mp3", logo: "logos/KChat-GTAVC-Logo.webp", duration: 6235.668 },
  { name: "VCPR", file: "radio/VCPR.mp3", logo: "logos/ViceCityPublicRadio-GTAVC-Logo.svg", duration: 5184.252 },
  { name: "V-Rock", file: "radio/VROCK.mp3", logo: "logos/V-Rock-GTAVC-Logo.svg", duration: 4644.232 },
  { name: "Wave 103", file: "radio/WAVE.mp3", logo: "logos/Wave103-GTAVC-Logo.svg", duration: 3966.772 },
  { name: "Wildstyle", file: "radio/WILD.mp3", logo: "logos/WildstylePirateRadio.webp", duration: 4107.207 }
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

// Décalage de départ par station, DÉTERMINISTE (hash du nom de fichier) :
// identique sur tous les appareils, donc une même station joue exactement la
// même chose partout au même moment, comme une vraie diffusion hertzienne.
const stationOffset = (station) => {
  let h = 0;
  for (let i = 0; i < station.file.length; i++) {
    h = (h * 31 + station.file.charCodeAt(i)) >>> 0;
  }
  return h % 86400;
};
const offsets = stations.map(stationOffset);

// nettoyage des anciens offsets aléatoires par appareil
try { localStorage.removeItem('vcr-offsets'); } catch (e) {}

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
  const elapsed = (Date.now() - EPOCH) / 1000 + offsets[index];
  return mod(elapsed, stations[index].duration);
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
  const delta = Math.abs(el.currentTime - pos);
  const drift = Math.min(delta, stations[index].duration - delta);
  if (drift > tolerance) {
    // posé même avant les métadonnées : devient la "default playback start
    // position", appliquée par le navigateur dès que les données arrivent
    el.currentTime = pos;
    seekIntents[index] = pos;
  }
};

// --- Statics via Web Audio (décodés une fois, déclenchement instantané) ----
// Les fichiers sont téléchargés dès le chargement, mais l'AudioContext n'est
// créé qu'au premier geste : instancié avant interaction, il démarrerait
// "suspended" avec un avertissement console.
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
let staticGain = null;
const staticBuffers = [];
let staticIndex = 0;

const staticFetches = STATIC_SOUNDS.map(url =>
  fetch(url).then(r => r.arrayBuffer()).catch(() => null)
);

// SFX d'interface (menu GTA) : deux variantes par action, tirage aléatoire
const UI_SOUNDS = {
  hover: ['sfx/ui/hover1.mp3', 'sfx/ui/hover2.mp3'],
  select: ['sfx/ui/select1.mp3', 'sfx/ui/select2.mp3'],
  cancel: ['sfx/ui/cancel1.mp3', 'sfx/ui/cancel2.mp3']
};
const uiBuffers = { hover: [], select: [], cancel: [] };
const uiFetches = Object.entries(UI_SOUNDS).flatMap(([kind, urls]) =>
  urls.map(url =>
    fetch(url).then(r => r.arrayBuffer()).then(data => ({ kind, data })).catch(() => null)
  )
);

const initAudioCtx = () => {
  if (audioCtx || !AudioCtx) return;
  audioCtx = new AudioCtx();
  staticGain = audioCtx.createGain();
  staticGain.gain.value = globalVolume;
  staticGain.connect(audioCtx.destination);
  staticFetches.forEach(p => p.then(data => {
    if (data) {
      audioCtx.decodeAudioData(data)
        .then(buffer => staticBuffers.push(buffer))
        .catch(() => {});
    }
  }));
  uiFetches.forEach(p => p.then(item => {
    if (item) {
      audioCtx.decodeAudioData(item.data)
        .then(buffer => uiBuffers[item.kind].push(buffer))
        .catch(() => {});
    }
  }));
};

const playUiSfx = (kind) => {
  if (!audioCtx) return;
  const list = uiBuffers[kind];
  if (list.length === 0) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const source = audioCtx.createBufferSource();
  source.buffer = list[Math.floor(Math.random() * list.length)];
  source.connect(staticGain);
  source.start();
};

// Joue un static et renvoie sa durée en secondes
const playStatic = () => {
  if (!audioCtx || staticBuffers.length === 0) return 0.15;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  staticIndex = (staticIndex + 1) % staticBuffers.length;
  const source = audioCtx.createBufferSource();
  source.buffer = staticBuffers[staticIndex];
  source.connect(staticGain);
  source.start();
  return source.buffer.duration;
};

// --- Contrôle du volume (même système que xeno-series-heardle) -------------
let globalVolume = parseFloat(localStorage.getItem('globalVolume') ?? '1');
if (!isFinite(globalVolume)) globalVolume = 1;

const volumeSelector = document.getElementById('volumeSelector');
const volumeToggle = document.getElementById('volumeToggle');
const volumeMenu = document.getElementById('volumeMenu');
const volumeValue = document.getElementById('volumeValue');
const volumeSlider = document.getElementById('volumeSlider');

const applyVolume = () => {
  players.forEach(el => { el.volume = globalVolume; });
  if (staticGain) staticGain.gain.value = globalVolume;
};

// Icônes SVG roses avec ombre noire (via CSS drop-shadow), assorties au thème
const SPEAKER_PATH = '<path fill="#f966ad" d="M3.5 9v6h3.8l4.9 4.2V4.8L7.3 9Z"/>';
const VOLUME_ICONS = {
  high: `<svg viewBox="0 0 24 24" aria-hidden="true">${SPEAKER_PATH}<path fill="none" stroke="#f966ad" stroke-width="2" stroke-linecap="round" d="M15 9.6a3.4 3.4 0 0 1 0 4.8"/><path fill="none" stroke="#f966ad" stroke-width="2" stroke-linecap="round" d="M17.8 7.2a6.8 6.8 0 0 1 0 9.6"/></svg>`,
  low: `<svg viewBox="0 0 24 24" aria-hidden="true">${SPEAKER_PATH}<path fill="none" stroke="#f966ad" stroke-width="2" stroke-linecap="round" d="M15 9.6a3.4 3.4 0 0 1 0 4.8"/></svg>`,
  muted: `<svg viewBox="0 0 24 24" aria-hidden="true">${SPEAKER_PATH}<path fill="none" stroke="#f966ad" stroke-width="2" stroke-linecap="round" d="M15 9.5 20.5 15M20.5 9.5 15 15"/></svg>`
};

const updateVolumeIcon = () => {
  volumeToggle.innerHTML = globalVolume === 0
    ? VOLUME_ICONS.muted
    : globalVolume < 0.5 ? VOLUME_ICONS.low : VOLUME_ICONS.high;
};

const setGlobalVolume = (val) => {
  globalVolume = Math.max(0, Math.min(1, val));
  try { localStorage.setItem('globalVolume', String(globalVolume)); } catch (e) {}
  applyVolume();
  updateVolumeIcon();
  volumeValue.textContent = Math.round(globalVolume * 100) + '%';
  volumeSlider.value = Math.round(globalVolume * 100);
};

volumeToggle.addEventListener('click', () => {
  volumeMenu.style.display = volumeMenu.style.display === 'none' ? 'flex' : 'none';
});

volumeSlider.addEventListener('input', () => setGlobalVolume(volumeSlider.value / 100));

// Fermeture du menu au clic en dehors
document.addEventListener('click', (event) => {
  if (!volumeSelector.contains(event.target)) volumeMenu.style.display = 'none';
});

// Molette sur le sélecteur
volumeSelector.addEventListener('wheel', (e) => {
  e.preventDefault();
  setGlobalVolume(globalVolume + (e.deltaY < 0 ? 0.05 : -0.05));
}, { passive: false });

setGlobalVolume(globalVolume);

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
  if (!started || pickerOpen()) return;
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

const retargetMaskTo = (points) => {
  maskFrom = maskPoints.map(p => ({ ...p }));
  maskTo = points;
  maskAnimStart = performance.now();
  if (maskRaf === null) maskRaf = requestAnimationFrame(animateMask);
};

const retargetMask = () => retargetMaskTo(randomMaskPoints());

// Referme la fenêtre (retour à l'écran de sélection)
const closeMask = () => retargetMaskTo([
  { x: 50, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 50 }
]);

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
  if (!started || pickerOpen()) return;
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
    if (el.paused) syncToLive(index);
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
  syncToLive(index);
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

// --- Déblocage iOS ---------------------------------------------------------
// Sur iOS, CHAQUE élément audio doit avoir reçu un play() dans un geste
// utilisateur au moins une fois avant de pouvoir être joué programmatiquement
// (le play différé post-static échoue sinon). On bénit donc les 9 lecteurs au
// clic du bouton, avec un silence en data-URI : aucun réseau, aucune
// bufferisation (bénir avec les vraies sources déclenchait ~15 Mo de
// préchargement par élément), puis on restaure la vraie source — le flag
// d'autorisation est porté par l'élément, pas par la source.
const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const blessAllPlayers = () => {
  players.forEach((el, index) => {
    if (index === currentStation) return; // la station courante joue dans le geste
    const realSrc = el.src;
    el.src = SILENT_WAV;
    const p = el.play();
    if (p && p.catch) p.catch(() => {});
    setTimeout(() => {
      el.pause();
      el.src = realSrc;
      el.preload = 'metadata';
      syncToLive(index);
    }, 80);
  });
};

// --- Démarrage -------------------------------------------------------------
// Grille de choix de station : cliquer une tuile lance directement la radio
// choisie, et le clic sert de geste de déblocage audio (AudioContext,
// bénédiction iOS des 9 lecteurs). Le bouton retour rouvre la grille sans
// couper la lecture en cours.
const stationPicker = document.getElementById('stationPicker');
const backButton = document.getElementById('backButton');

const pickerOpen = () => stationPicker.style.display !== 'none';

const startRadio = (index) => {
  started = true;
  currentStation = index;
  try { localStorage.setItem('vcr-station', String(index)); } catch (e) {}

  carouselPos = index;
  carouselTarget = index;
  logoContainer.classList.remove('hidden');
  renderCarousel();
  updateStationTitle();
  updateMediaSessionMetadata();
  retargetMask();

  initAudioCtx();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

  if (IS_IOS) blessAllPlayers();
  playStation(currentStation);
};

const pickStation = (index) => {
  stationPicker.style.display = 'none';
  backButton.style.display = 'flex';
  if (!started) {
    startRadio(index); // crée l'AudioContext dans le geste, avant le sfx
    playUiSfx('select');
    return;
  }
  playUiSfx('select');
  // la radio n'a jamais été coupée : on rouvre la fenêtre, et on ne switche
  // que si une autre station a été choisie
  if (index !== currentStation) {
    carouselPos = index;
    carouselTarget = index;
    renderCarousel();
    setStation(index); // static + switch + masque + titre
  } else {
    retargetMask();
  }
};

backButton.addEventListener('click', () => {
  playUiSfx('cancel');
  backButton.style.display = 'none';
  stationPicker.style.display = 'flex';
  closeMask();
});

// Sons de survol (souris uniquement : au tactile, pointerenter accompagne le
// tap et doublonnerait avec select)
const hoverSfx = (e) => {
  if (e.pointerType === 'mouse') playUiSfx('hover');
};
backButton.addEventListener('pointerenter', hoverSfx);
volumeToggle.addEventListener('pointerenter', hoverSfx);

// Quadrilatère irrégulier pour une tuile : chaque coin est tiré dans son
// propre angle, jusqu'à 14 % vers l'intérieur — même famille de formes que
// le masque plein écran
const randomTilePoly = () => {
  const r = () => (Math.random() * 14).toFixed(1);
  return `polygon(${r()}% ${r()}%, ${100 - r()}% ${r()}%, ${100 - r()}% ${100 - r()}%, ${r()}% ${100 - r()}%)`;
};

const initPicker = () => {
  const grid = stationPicker.querySelector('.picker-grid');
  stations.forEach((station, index) => {
    const tile = document.createElement('button');
    tile.classList.add('picker-tile');
    tile.style.clipPath = randomTilePoly();
    const img = document.createElement('img');
    img.src = station.logo;
    img.alt = station.name;
    tile.appendChild(img);
    // le polygone se re-déforme à chaque survol (morph animé en CSS)
    tile.addEventListener('pointerenter', (e) => {
      tile.style.clipPath = randomTilePoly();
      hoverSfx(e);
    });
    tile.addEventListener('click', () => pickStation(index));
    grid.appendChild(tile);
  });
};

initCarousel();
initPicker();
setupMediaSession();
updateMediaSessionMetadata();

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
      if (index === currentStation && started) {
        syncToLive(index);
        el.play().catch(() => {});
      }
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
  // iOS peut jeter un seek posé avant les métadonnées : on le ré-asserte dès
  // que l'élément est prêt, AVANT le démarrage audible
  el.addEventListener('canplay', () => {
    const intended = seekIntents[index];
    if (index === currentStation && intended !== null
        && Math.abs(el.currentTime - intended) > 2.5) {
      el.currentTime = intended;
    }
  });

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
