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
  // Rien n'est chargé tant qu'une station n'est pas jouée ou préparée
  // (voisines) : les durées étant codées en dur, les métadonnées ne servent
  // plus à rien, et preload="metadata" coûtait une requête "bytes=0-" (2 Mo
  // côté Safari/Firefox) par station au chargement — ~18 Mo en concurrence
  // avec le démarrage de la station choisie. Le seek posé avant chargement
  // devient la "default playback start position", ré-assertée au canplay.
  el.preload = 'none';
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
// iOS : par défaut Web Audio est en catégorie "ambient", donc RENDU MUET par
// le bouton silencieux — le static (et les SFX) devenait un blanc à chaque
// switch. "playback" = même catégorie que les <audio> de la radio (iOS 17+).
try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
let audioCtx = null;
let staticGain = null;
const staticBuffers = [];
let staticIndex = 0;

// SFX d'interface (menu GTA) : deux variantes par action, tirage aléatoire
const UI_SOUNDS = {
  hover: ['sfx/ui/hover1.mp3', 'sfx/ui/hover2.mp3'],
  select: ['sfx/ui/select1.mp3', 'sfx/ui/select2.mp3'],
  cancel: ['sfx/ui/cancel1.mp3', 'sfx/ui/cancel2.mp3']
};
const uiBuffers = { hover: [], select: [], cancel: [] };

// Décodage de tous les SFX dès le chargement via un OfflineAudioContext
// (autorisé sans geste, contrairement au contexte principal) : les buffers
// sont prêts avant le premier clic — sans ça, le "select" du tout premier
// choix tombait pendant le décodage et restait muet.
const DecodeCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
const decodeCtx = DecodeCtx ? new DecodeCtx(1, 1, 44100) : null;

const loadBuffer = (url, out) => {
  if (!decodeCtx) return;
  fetch(url)
    .then(r => r.arrayBuffer())
    .then(data => decodeCtx.decodeAudioData(data))
    .then(buffer => { if (buffer) out.push(buffer); })
    .catch(() => {});
};

STATIC_SOUNDS.forEach(url => loadBuffer(url, staticBuffers));
Object.entries(UI_SOUNDS).forEach(([kind, urls]) =>
  urls.forEach(url => loadBuffer(url, uiBuffers[kind]))
);

const initAudioCtx = () => {
  if (audioCtx || !AudioCtx) return;
  audioCtx = new AudioCtx();
  staticGain = audioCtx.createGain();
  staticGain.gain.value = globalVolume;
  staticGain.connect(audioCtx.destination);
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

// Static de changement de station : UN passage complet de l'échantillon
// (~1 s), jamais tronqué. La station démarre dessous (play() immédiat) et
// monte en fondu dès qu'elle est accrochée (voir checkTuned / runFade).
let staticVoice = null;

// Coupure (pause, nouveau switch) : court fondu, tout de suite
const stopStatic = () => {
  const voice = staticVoice;
  staticVoice = null;
  if (!voice || !audioCtx) return;
  const t = audioCtx.currentTime;
  voice.gain.gain.setValueAtTime(voice.gain.gain.value, t);
  voice.gain.gain.linearRampToValueAtTime(0, t + 0.06);
  try { voice.source.stop(t + 0.07); } catch (e) {}
};

const playStatic = () => {
  stopStatic();
  if (!audioCtx || staticBuffers.length === 0) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  staticIndex = (staticIndex + 1) % staticBuffers.length;
  const buffer = staticBuffers[staticIndex];
  if (!buffer) return;
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  const gain = audioCtx.createGain();
  source.connect(gain);
  gain.connect(staticGain);
  source.start();
  const voice = { source, gain };
  staticVoice = voice;
  source.onended = () => { if (staticVoice === voice) staticVoice = null; };
};

// --- Fondu d'entrée de la station ------------------------------------------
// Via el.volume : impossible sur iOS (volume en lecture seule, toujours 1),
// où la station arrive donc à plein volume sous le static.
const CAN_FADE = (() => {
  try { const a = new Audio(); a.volume = 0.5; return Math.abs(a.volume - 0.5) < 0.01; }
  catch (e) { return false; }
})();
const FADE_IN_MS = 800;
let fade = null;       // { index, start } : start = null tant que pas accordée
let fadeTimer = null;  // setInterval, pas rAF : continue onglet masqué

// Annule le fondu et rend son volume normal à l'élément concerné
const cancelFade = () => {
  if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
  if (fade) { players[fade.index].volume = globalVolume; fade = null; }
};

// Station muette jusqu'à l'accord (posé AVANT le play())
const armFade = (index) => {
  cancelFade();
  if (!CAN_FADE) return;
  fade = { index, start: null };
  players[index].volume = 0;
};

const runFade = (index) => {
  if (!fade || fade.index !== index || fade.start !== null) return;
  fade.start = performance.now();
  fadeTimer = setInterval(() => {
    const k = Math.min(1, (performance.now() - fade.start) / FADE_IN_MS);
    // courbe en k² : montée perçue régulière (l'oreille est logarithmique)
    players[fade.index].volume = globalVolume * k * k;
    if (k >= 1) { clearInterval(fadeTimer); fadeTimer = null; fade = null; }
  }, 20);
};

// "Accord" de la station visée : elle n'est considérée accrochée que quand
// sa lecture AVANCE réellement près de la position live — pas au simple
// 'playing'. Sur iOS, 'playing' arrive avant le son audible, et souvent à la
// mauvaise position (seek posé en pause ignoré, recalage qui rebufferise).
// C'est l'accord qui déclenche le fondu d'entrée.
let tuning = null;      // { index, from } : from = 1re position vue en lecture
let tuningTimer = null;
let tunedAt = 0;        // instant de l'accord (rattrapage d'un décrochage)
const TUNE_STEP_S = 0.05;
const TUNE_MAX_MS = 8000; // réseau mort : on rend le volume, on arrête le poll

const endTuning = () => {
  tuning = null;
  if (tuningTimer) { clearInterval(tuningTimer); tuningTimer = null; }
};

const liveDrift = (index) => {
  const el = players[index];
  const delta = Math.abs(el.currentTime - livePosition(index));
  return Math.min(delta, stations[index].duration - delta);
};

const checkTuned = () => {
  if (!tuning) return;
  const { index } = tuning;
  const el = players[index];
  if (index !== currentStation) { endTuning(); return; }
  if (performance.now() - tuning.since > TUNE_MAX_MS) { endTuning(); cancelFade(); return; }
  if (el.paused || el.seeking || el.readyState < 3 || liveDrift(index) > 2.5) {
    tuning.from = null;
    return;
  }
  if (tuning.from === null) { tuning.from = el.currentTime; return; }
  if (el.currentTime - tuning.from >= TUNE_STEP_S) {
    endTuning();
    tunedAt = performance.now();
    runFade(index);
  }
};

// currentTime est lu en direct (timeupdate, ~250 ms sur Safari, serait
// trop lent) — le poll ne tourne que pendant un switch
const startTuning = (index) => {
  endTuning();
  tuning = { index, from: null, since: performance.now() };
  tuningTimer = setInterval(checkTuned, 30);
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
  // l'élément en fondu suit globalVolume à chaque pas du fondu
  players.forEach((el, i) => { if (!fade || fade.index !== i) el.volume = globalVolume; });
  if (staticGain) staticGain.gain.value = globalVolume;
};

// Icônes SVG roses avec ombre noire (via CSS drop-shadow), assorties au thème
const SPEAKER_PATH = '<path fill="#FF98E1" d="M3.5 9v6h3.8l4.9 4.2V4.8L7.3 9Z"/>';
const VOLUME_ICONS = {
  high: `<svg viewBox="0 0 24 24" aria-hidden="true">${SPEAKER_PATH}<path fill="none" stroke="#FF98E1" stroke-width="2" stroke-linecap="round" d="M15 9.6a3.4 3.4 0 0 1 0 4.8"/><path fill="none" stroke="#FF98E1" stroke-width="2" stroke-linecap="round" d="M17.8 7.2a6.8 6.8 0 0 1 0 9.6"/></svg>`,
  low: `<svg viewBox="0 0 24 24" aria-hidden="true">${SPEAKER_PATH}<path fill="none" stroke="#FF98E1" stroke-width="2" stroke-linecap="round" d="M15 9.6a3.4 3.4 0 0 1 0 4.8"/></svg>`,
  muted: `<svg viewBox="0 0 24 24" aria-hidden="true">${SPEAKER_PATH}<path fill="none" stroke="#FF98E1" stroke-width="2" stroke-linecap="round" d="M15 9.5 20.5 15M20.5 9.5 15 15"/></svg>`
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
  const label = Math.round(globalVolume * 100) + '%';
  volumeValue.textContent = label;
  volumeValue.dataset.text = label; // ombre du texte texturé (::before)
  volumeSlider.value = Math.round(globalVolume * 100);
};

volumeToggle.addEventListener('click', () => {
  const opening = volumeMenu.style.display === 'none';
  volumeMenu.style.display = opening ? 'flex' : 'none';
  // nouveau quadrilatère à chaque ouverture, comme le reste de l'interface
  if (opening) volumeMenu.style.clipPath = randomTilePoly();
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
  // le panneau hors ligne bloque les pointeurs (scrim) mais pas le clavier
  if (!started || pickerOpen() || returningToMenu
      || (window.vcrOffline && window.vcrOffline.panelOpen())) return;
  goTo(Math.round(carouselTarget) + direction);
};

// --- Masque polygonal ------------------------------------------------------
// Quadrilatère irrégulier : un point aléatoire par quart d'écran (ni trop
// près du bord, ni trop près du centre), en coordonnées viewBox 0-100.
// Le chemin evenodd = rectangle plein écran noir percé du quadrilatère.
// À chaque changement de station, nouveaux points et interpolation.
const maskPath = document.getElementById('maskPath');
const stationTitle = document.getElementById('stationTitle');
const trackInfo = document.getElementById('trackInfo');

const rand = (a, b) => a + Math.random() * (b - a);

const randomMaskPoints = () => [
  { x: rand(8, 24), y: rand(12, 28) }, // haut gauche
  { x: rand(76, 92), y: rand(12, 28) }, // haut droit
  { x: rand(76, 92), y: rand(72, 88) }, // bas droit
  { x: rand(8, 24), y: rand(72, 88) }  // bas gauche
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
  stationTitle.style.display = '';
  stationTitle.textContent = stations[currentStation].name;
  updateTrackInfo();
};

// Morceau en cours = dernière entrée de la tracklist dont le début est passé.
// Avant le premier titre (intro/jingle DJ) ou sur une station parlée : null.
const currentTrack = () => {
  const list = STATION_TRACKS[stations[currentStation].file];
  if (!list) return null;
  const pos = livePosition(currentStation);
  let current = null;
  for (const track of list) {
    if (track[0] <= pos) current = track; else break;
  }
  return current;
};

// Clé de l'artwork de notif (radio/EMOTION.mp3 -> EMOTION)
const stationArtKey = (index) => stations[index].file.slice(6, -4);

// N'écrit dans le DOM que si le texte change (appelé toutes les 2 s)
const setTrackText = (text) => {
  if (trackInfo.textContent !== text) trackInfo.textContent = text;
};

const updateTrackInfo = () => {
  if (players[currentStation].paused) { setTrackText(''); return; }
  const track = currentTrack();
  setTrackText(track ? `${track[1]} — ${track[2]}` : '');
  // rafraîchit la notif quand le morceau change en cours de lecture
  const key = currentStation + '|' + (track ? track[1] : '');
  if (key !== lastMediaKey) updateMediaSessionMetadata();
};

// --- Drag unifié tactile + souris (Pointer Events) -------------------------
let dragStartX = 0;
let dragStartPos = 0;
let dragLastX = 0;
let dragLastT = 0;
let dragVelocity = 0; // px/ms lissée
let dragWidth = 1;    // largeur mise en cache au pointerdown (pas de lecture de layout par move)
let dragMoved = false;
let dragRenderPending = false;
const DRAG_SLOP = 6;           // px : en dessous, c'est un tap
const FLICK_STALE_MS = 100;    // doigt immobile avant relâcher = pas de flick

container.addEventListener('pointerdown', e => {
  if (!started || pickerOpen() || returningToMenu) return;
  dragging = true;
  dragMoved = false;
  container.setPointerCapture(e.pointerId);
  container.classList.add('dragging');
  dragWidth = container.clientWidth || 1;
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
  if (Math.abs(e.clientX - dragStartX) > DRAG_SLOP) dragMoved = true;
  if (!dragMoved) return;
  carouselPos = dragStartPos + (dragStartX - e.clientX) / dragWidth;
  // les pointermove peuvent arriver plusieurs fois par frame (écrans/souris
  // 120 Hz+) : un seul rendu par frame
  if (!dragRenderPending) {
    dragRenderPending = true;
    requestAnimationFrame(() => {
      dragRenderPending = false;
      if (dragging) renderCarousel();
    });
  }
});

const endDrag = () => {
  if (!dragging) return;
  dragging = false;
  container.classList.remove('dragging');
  // simple tap (y compris pendant l'easing d'un switch) : on garde la cible
  // en cours au lieu d'arrondir la position intermédiaire, qui pouvait
  // ramener à la station précédente
  if (!dragMoved) {
    carouselPos = dragStartPos;
    goTo(carouselTarget);
    return;
  }
  // doigt resté immobile avant le relâcher : la vitesse lissée est périmée
  if (performance.now() - dragLastT > FLICK_STALE_MS) dragVelocity = 0;
  // vélocité en stations/s, positive vers la station suivante
  const flick = -dragVelocity * 1000 / dragWidth;
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

// --- Media Session (écran de verrouillage / notification) ------------------
// Affiche le morceau en cours (titre + artiste) et la station, avec le logo
// standardisé en PNG. Titre de station en repli pendant les intros DJ ou sur
// les stations parlées (K-Chat, VCPR).
let lastMediaKey = '';
const updateMediaSessionMetadata = () => {
  if (!('mediaSession' in navigator)) return;
  const station = stations[currentStation];
  const track = currentTrack();
  lastMediaKey = currentStation + '|' + (track ? track[1] : '');
  const art = `logos/notif/${stationArtKey(currentStation)}.png`;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track ? track[1] : station.name,
    artist: track ? track[2] : 'Vice City Radio',
    album: station.name,
    artwork: [
      { src: art, sizes: '192x192', type: 'image/png' },
      { src: art, sizes: '512x512', type: 'image/png' }
    ]
  });
};

const setupMediaSession = () => {
  if (!('mediaSession' in navigator)) return;
  // "play" resynchronise sur la position live : une radio n'est jamais en pause
  navigator.mediaSession.setActionHandler('play', () => playStation(currentStation));
  navigator.mediaSession.setActionHandler('pause', () => pauseRadio());
  navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
  navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
};

// --- Lecture ---------------------------------------------------------------
// Prépare les stations adjacentes : le navigateur bufferise autour de leur
// position live, le prochain switch part donc d'une zone déjà chargée.
// Différé de 3 s après chaque lecture pour laisser toute la bande passante
// au démarrage de la station courante.
// Mode économie de données (Android "Économiseur de données", Chrome
// "Lite") : pas de préchargement des voisines, qui triple sinon le débit
// consommé (station écoutée + 2 voisines tenues à jour).
const saveData = () => !!(navigator.connection && navigator.connection.saveData);

const neighborsOf = (index) => [
  mod(index + 1, stations.length),
  mod(index - 1, stations.length)
];

// Chrome : un <audio> en pause qui a commencé à charger GARDE sa connexion
// HTTP ouverte (lecture différée). Passé 6 connexions par hôte, la requête de
// seek de la station visée reste en file d'attente : switch "froid" bloqué
// indéfiniment sur le static (constaté en test). On libère donc tout lecteur
// en pause hors station courante + voisines : réassigner src relance
// l'algorithme de chargement (abandon de la requête) et preload="none"
// n'en rouvre aucune. Le flag de bénédiction iOS est porté par l'élément,
// pas par la source : il survit.
const releasePlayer = (index) => {
  const el = players[index];
  if (!el.paused || el.src === SILENT_WAV) return;
  const holdsNetwork = el.readyState > 0 || el.networkState === HTMLMediaElement.NETWORK_LOADING;
  el.preload = 'none';
  if (!holdsNetwork) return;
  el.src = el.src;
  seekIntents[index] = null;
};

const releaseIdle = (center) => {
  const keep = [center, ...neighborsOf(center)];
  players.forEach((_, index) => { if (!keep.includes(index)) releasePlayer(index); });
};

const warmNeighbors = () => {
  releaseIdle(currentStation);
  if (saveData()) return;
  neighborsOf(currentStation).forEach(index => {
    const el = players[index];
    if (!el.paused) return;
    el.preload = 'auto';
    syncToLive(index);
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

// Jeton d'intention de lecture : incrémenté à chaque demande de lecture ET à
// chaque pause explicite. Les relances différées (retry au geste, auto-
// guérison réseau, play post-static) vérifient qu'aucune pause n'a eu lieu
// depuis — sinon une pause depuis l'écran verrouillé pouvait être annulée
// par le prochain tap dans l'app.
let playToken = 0;
let gestureRetry = null;

const clearGestureRetry = () => {
  if (!gestureRetry) return;
  document.removeEventListener('pointerup', gestureRetry, true);
  document.removeEventListener('keydown', gestureRetry, true);
  gestureRetry = null;
};

const playStation = (index) => {
  const el = players[index];
  const token = ++playToken;
  clearGestureRetry();
  el.preload = 'auto';
  syncToLive(index);
  el.play().catch(() => {
    if (token !== playToken) return;
    endTuning();
    stopStatic();
    cancelFade();
    // play() refusé (ex : switch déclenché par un pointercancel, donc hors
    // activation utilisateur) : retente au prochain geste — un seul retry
    // en attente à la fois
    clearGestureRetry();
    gestureRetry = () => {
      clearGestureRetry();
      if (token === playToken && index === currentStation) playStation(index);
    };
    document.addEventListener('pointerup', gestureRetry, true);
    document.addEventListener('keydown', gestureRetry, true);
  });
  scheduleWarm();
};

const stopAll = () => {
  players.forEach(el => { if (!el.paused) el.pause(); });
};

// Pause explicite (bouton pause du menu, Media Session) : annule aussi
// toute relance différée en attente
const pauseRadio = () => {
  playToken++;
  clearGestureRetry();
  endTuning();
  stopStatic();
  cancelFade();
  stopAll();
};

const setStation = (index) => {
  currentStation = index;
  try { localStorage.setItem('vcr-station', String(index)); } catch (e) {}

  updateMediaSessionMetadata();
  updateStationTitle();
  retargetMask();

  // Coupure immédiate + static, et play() de la nouvelle station TOUT DE
  // SUITE, dans le geste : sur iOS, preload est ignoré — la requête ne part
  // qu'au play(), qui était différé de ~300 ms (fin du static minimal).
  // La station démarre muette sous le static (un passage complet), puis
  // monte en fondu dès qu'elle est réellement accrochée (voir checkTuned) —
  // hors iOS, où le volume d'un <audio> n'est pas réglable.
  // PAS de play()+pause() de "bénédiction" ici : la course play→pause→play
  // peut laisser l'élément en pause sur iOS.
  stopAll();
  // libère tout de suite les connexions des stations quittées (switchs en
  // rafale compris) pour que la requête de la station visée parte sans attendre
  releaseIdle(index);
  playStatic();
  armFade(index);
  startTuning(index);
  playStation(index);
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
      // preload="none" : restaurer la vraie source ne relance aucun
      // téléchargement (avant : 8 requêtes de 2 Mo en plein démarrage)
      el.preload = 'none';
      el.src = realSrc;
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

// Quadrilatère irrégulier pour un élément d'interface : chaque coin est tiré
// dans son propre angle, jusqu'à 14 % vers l'intérieur — même famille de
// formes que le masque plein écran
const randomTilePoly = () => {
  const r = () => (Math.random() * 14).toFixed(1);
  return `polygon(${r()}% ${r()}%, ${100 - r()}% ${r()}%, ${100 - r()}% ${100 - r()}%, ${r()}% ${100 - r()}%)`;
};

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
  stationPicker.classList.remove('appear');
  backButton.style.display = 'flex';
  pauseButton.style.display = 'none';
  if (!started) {
    startRadio(index); // crée l'AudioContext dans le geste, avant le sfx
    playUiSfx('select');
    return;
  }
  playUiSfx('select');
  if (index !== currentStation) {
    carouselPos = index;
    carouselTarget = index;
    renderCarousel();
    setStation(index); // static + switch + masque + titre
  } else {
    // même station : rouvrir la fenêtre, et relancer la lecture si elle
    // avait été coupée par le bouton pause
    retargetMask();
    updateStationTitle();
    if (players[currentStation].paused) playStation(currentStation);
  }
};

let returningToMenu = false;

backButton.addEventListener('click', () => {
  if (returningToMenu) return;
  returningToMenu = true;
  playUiSfx('cancel');
  backButton.style.display = 'none';
  closeMask();
  // attendre que l'interface se soit repliée (lerp du masque) avant de
  // faire apparaître la grille en fondu
  setTimeout(() => {
    returningToMenu = false;
    stationPicker.style.display = 'flex';
    stationPicker.classList.add('appear');
    updatePauseButton();
  }, MASK_DURATION + 100);
});

// Sons de survol (souris uniquement : au tactile, pointerenter accompagne le
// tap et doublonnerait avec select)
const hoverSfx = (e) => {
  if (e.pointerType === 'mouse') playUiSfx('hover');
};

// Boutons retour et volume : même DA polygonale que les tuiles, avec morph
// et son au survol
backButton.style.clipPath = randomTilePoly();
volumeToggle.style.clipPath = randomTilePoly();

const morphControl = (e) => {
  e.currentTarget.style.clipPath = randomTilePoly();
  hoverSfx(e);
};
backButton.addEventListener('pointerenter', morphControl);
volumeToggle.addEventListener('pointerenter', morphControl);

// Bouton pause du menu de sélection : coupe la station en cours, affiché
// uniquement quand la grille est ouverte et qu'une station joue
const pauseButton = document.getElementById('pauseButton');
pauseButton.style.clipPath = randomTilePoly();
pauseButton.addEventListener('pointerenter', morphControl);

const updatePauseButton = () => {
  const anyPlaying = players.some(el => !el.paused);
  pauseButton.style.display = pickerOpen() && anyPlaying ? 'flex' : 'none';
};

pauseButton.addEventListener('click', () => {
  playUiSfx('select');
  pauseRadio();
  updatePauseButton();
  // plus rien ne joue : le titre de station et le morceau n'ont plus lieu d'être
  stationTitle.style.display = 'none';
  trackInfo.textContent = '';
});

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

// Contexte audio créé au tout premier geste, où qu'il soit : les sons
// d'interface (hover notamment) fonctionnent dès la première interaction,
// avant même le choix d'une station
const primeAudio = () => {
  initAudioCtx();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
};
document.addEventListener('pointerdown', primeAudio, { capture: true, once: true });
document.addEventListener('keydown', primeAudio, { capture: true, once: true });

initCarousel();
initPicker();
setupMediaSession();
updateMediaSessionMetadata();

// Resynchronise les stations voisines en pause pour que le prochain switch
// tombe dans une zone déjà bufferisée
// (inutile écran éteint / onglet caché : le prochain switch passera de toute
// façon par un seek, et ça évite de télécharger pour rien en arrière-plan)
setInterval(() => {
  if (document.hidden || !started || saveData()) return;
  neighborsOf(currentStation).forEach(index => {
    if (players[index].paused && players[index].preload === 'auto') syncToLive(index);
  });
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
    // élément jamais demandé (preload none, pas de lecture) : rien à réparer
    if (el.preload === 'none' && el.paused) return;
    retryDelays[index] = Math.min(15000, retryDelays[index] ? retryDelays[index] * 2 : 1500);
    // ne relancer la lecture que si elle était en cours au moment de l'erreur
    // et qu'aucune pause explicite n'est intervenue depuis
    const wasPlaying = !el.paused;
    const token = playToken;
    setTimeout(() => {
      el.load();
      if (index === currentStation && started && wasPlaying && token === playToken) {
        syncToLive(index);
        el.play().catch(() => {});
      } else {
        syncToLive(index);
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

  // Décrochage juste après l'accord (iOS lit souvent un premier fragment
  // puis rebufferise) : le static reprend au lieu d'un blanc
  el.addEventListener('waiting', () => {
    if (index !== currentStation || el.paused || tuning) return;
    if (performance.now() - tunedAt > 3000) return;
    playStatic();
    startTuning(index);
  });

  el.addEventListener('playing', () => {
    if (index !== currentStation) return;
    // le static, lui, s'arrête à l'accord réel (checkTuned), pas ici
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

// Rafraîchit le morceau affiché au fil de la lecture (les titres changent
// toutes les quelques minutes, une vérif toutes les 2 s suffit)
setInterval(updateTrackInfo, 2000);

// --- Clavier ---------------------------------------------------------------
// Ignoré quand un champ a le focus (le slider de volume consomme déjà les
// flèches : sinon volume ET station changeaient ensemble) et en auto-repeat
// (touche maintenue = rafale de switchs, chacun lançant seek + requêtes)
document.addEventListener('keydown', e => {
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'ArrowLeft') step(-1);
});
