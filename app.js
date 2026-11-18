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
  { name: "Emotion 98.3", file: "radio/EMOTION.mp3", src: "radio/v2/EMOTION.mp3", logo: "logos/Emotion98.3-GTAVC-Logo.webp", duration: 3546.828 },
  { name: "Radio Espantoso", file: "radio/ESPANT.mp3", src: "radio/v2/ESPANT.mp3", logo: "logos/RadioEspantoso-GTAVC-Logo.webp", duration: 3698.233 },
  { name: "Fever 105", file: "radio/FEVER.mp3", src: "radio/v2/FEVER.mp3", logo: "logos/Fever_105.webp", duration: 3793.189 },
  { name: "Flash FM", file: "radio/FLASH.mp3", src: "radio/v2/FLASH.mp3", logo: "logos/FlashFM.webp", duration: 3587.840 },
  { name: "K-Chat", file: "radio/KCHAT.mp3", logo: "logos/KChat-GTAVC-Logo.webp", duration: 6235.668 },
  { name: "VCPR", file: "radio/VCPR.mp3", logo: "logos/ViceCityPublicRadio-GTAVC-Logo.svg", duration: 5184.252 },
  { name: "V-Rock", file: "radio/VROCK.mp3", src: "radio/v2/VROCK.mp3", logo: "logos/V-Rock-GTAVC-Logo.svg", duration: 4644.232 },
  { name: "Wave 103", file: "radio/WAVE.mp3", src: "radio/v2/WAVE.mp3", logo: "logos/Wave103-GTAVC-Logo.svg", duration: 3966.772 },
  { name: "Wildstyle", file: "radio/WILD.mp3", src: "radio/v2/WILD.mp3", logo: "logos/WildstylePirateRadio.webp", duration: 4107.207 }
];

const STATIC_SOUNDS = [
  "sfx/static1.mp3", "sfx/static2.mp3", "sfx/static3.mp3", "sfx/static4.mp3",
  "sfx/static5.mp3", "sfx/static6.mp3", "sfx/static7.mp3", "sfx/static8.mp3",
  "sfx/static9.mp3", "sfx/static10.mp3", "sfx/static11.mp3", "sfx/static12.mp3"
];

const mod = (n, m) => ((n % m) + m) % m;

// `file` = identité de la station (décalage live, tracklist, clés hors ligne) ;
// `src` = fichier réellement servi quand il diffère. radio/v2/ : MP3 du jeu
// dont les trames que le décodeur de Chrome rejette (« part2_3_length is not
// valid », erreur de lecture au démarrage) ont été réencodées et raccordées
// sur place — même taille, mêmes trames, même timing.
const stationPath = (station) => station.src || station.file;
const stationUrl = (station) => `${AUDIO_BASE_URL}/${stationPath(station)}`;

// --- Mode "vraie web radio" -------------------------------------------------
// Par défaut, une station en réseau est lue comme un FLUX EN DIRECT : le
// Worker sert le fichier à partir de la position live (/live/…?t=secondes),
// sans longueur ni Range. Le navigateur n'a donc ni durée ni barre de
// progression à montrer : iOS (écran verrouillé, autoradio) affiche
// l'interface "direct", ce que setPositionState(Infinity) n'obtenait pas (iOS
// prend la durée de l'élément audio). La position est alors côté SERVEUR :
// currentTime compte depuis le début du flux (voir filePosition), et se
// recaler = rouvrir un flux, jamais un seek.
// `?legacy` garde l'ancien mode (fichier /radio/ + seek côté client), pour
// comparer et comme solution de repli.
// Les stations téléchargées (offline.js) restent lues en fichier local avec
// seek, dans les deux modes.
const LIVE_MODE = !/[?&]legacy\b/.test(location.search);
const liveUrl = (station) => `${AUDIO_BASE_URL}/live/${stationPath(station)}`;

// Source d'un lecteur SANS sa query "?t=…" (flux en direct, voir startLive)
// ni son fragment "#t=…" (voir armStartFragment) : toute comparaison de
// el.src avec stationUrl() / liveUrl() / offlineUrl() passe par là.
const srcBase = (el) => el.src.split(/[?#]/)[0];

const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// iOS : la station n'est PAS lancée muette sous le static (voir "Entrée de
// la station") mais par un play() différé. `?deferplay` force ce chemin sur
// n'importe quel navigateur, pour le tester sans iPhone.
const DEFER_PLAY = IS_IOS || /[?&]deferplay\b/.test(location.search);

// --- Journal de débug embarqué ---------------------------------------------
// iOS ne s'inspecte pas sans Mac : on garde en mémoire les derniers
// événements de lecture (anneau de DBG_MAX lignes horodatées), affichables
// sur l'appareil par un triple tap sur le libellé de build (bas gauche).
// Ne coûte rien tant que l'overlay est fermé (un push), et ne lève jamais.
// Heure murale (hh:mm:ss) et non performance.now() : ce dernier peut se
// figer quand iOS suspend la page écran verrouillé, alors qu'on veut
// justement dater ce qui s'y passe. Affiché du plus récent au plus ancien :
// une capture d'écran montre d'abord la fin de l'histoire.
const DBG_MAX = 80;
const dbgLines = [];
let dbgOverlay = null;

// nom court de station : "radio/EMOTION.mp3" → "EMOTION"
const dbgName = (index) => {
  try { return stations[index].file.replace(/^.*\/|\.mp3$/g, ''); } catch (e) { return '#' + index; }
};

// ligne d'état de la station courante, en tête de l'overlay
const dbgState = () => {
  const el = players[currentStation];
  return `${DEFER_PLAY ? 'defer' : 'muted'}${IS_IOS ? ' ios' : ''}${LIVE_MODE ? '' : ' legacy'} · ${dbgName(currentStation)}`
    + ` ${el.paused ? 'PAUSED' : 'playing'}${el.muted ? ' MUTED' : ''}`
    + ` ${isLive(currentStation) ? 'live' : 'file'} @${filePosition(currentStation).toFixed(1)}`
    + ` rs${el.readyState} ns${el.networkState} drift ${liveDrift(currentStation).toFixed(1)}s`
    + ` · tok ${playToken}${tuning ? ' tuning' : ''}${entry ? ' entry' : ''}`
    + ` · ctx ${audioCtx ? audioCtx.state : '-'}`
    + ` · ms ${'mediaSession' in navigator ? navigator.mediaSession.playbackState : '-'}`
    + `${document.hidden ? ' · hidden' : ''}`;
};

const dbgRender = () => {
  try {
    if (!dbgOverlay || dbgOverlay.hidden) return;
    dbgOverlay.textContent = `${dbgStamp()} ${dbgState()}\n\n${dbgLines.slice().reverse().join('\n')}`;
  } catch (e) {}
};

const dbgStamp = () => {
  const d = new Date();
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${Math.floor(d.getMilliseconds() / 100)}`;
};

const dbg = (msg) => {
  try {
    dbgLines.push(`${dbgStamp()} ${msg}`);
    if (dbgLines.length > DBG_MAX) dbgLines.shift();
    dbgRender();
  } catch (e) {}
};

const dbgToggle = () => {
  try {
    if (!dbgOverlay) {
      dbgOverlay = document.createElement('pre');
      dbgOverlay.id = 'debugLog';
      dbgOverlay.hidden = true;
      // un tap sur l'overlay le referme
      dbgOverlay.addEventListener('click', () => { dbgOverlay.hidden = true; });
      document.body.appendChild(dbgOverlay);
    }
    dbgOverlay.hidden = !dbgOverlay.hidden;
    dbgRender();
  } catch (e) {}
};

// Triple tap sur le libellé de build : 3 pointerup en moins de 700 ms
// (pointerup plutôt que click : pas de délai ni d'heuristique de clic iOS
// sur un élément non interactif)
(() => {
  const label = document.getElementById('buildVersion');
  if (!label) return;
  let taps = [];
  label.addEventListener('pointerup', () => {
    const t = performance.now();
    taps = taps.filter(x => t - x < 700);
    taps.push(t);
    if (taps.length >= 3) { taps = []; dbgToggle(); }
  });
})();

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

// --- Horloge commune -------------------------------------------------------
// La position live dépend de l'heure : une horloge d'appareil mal réglée
// décalait l'écoute. On se cale donc sur l'heure du Worker (même référence
// pour tous les auditeurs, à quelques dizaines de ms près), mesurée façon
// NTP : plusieurs allers-retours, on garde le plus court (le moins
// asymétrique), et l'heure serveur est rapportée au milieu de l'aller-retour.
// Sans réseau (hors ligne, Worker injoignable) : heure de l'appareil.
const TIME_URL = `${AUDIO_BASE_URL}/time`;
const CLOCK_SAMPLES = 4;
const CLOCK_TIMEOUT_MS = 3000;
const CLOCK_RESYNC_MS = 30 * 60 * 1000; // re-mesure au retour sur l'app
let clockOffset = 0;      // ms à ajouter à Date.now()
let clockError = null;    // incertitude (demi aller-retour), null = appareil
let clockSyncedAt = 0;
let clockSyncing = false;

const now = () => Date.now() + clockOffset;

const clockLabel = () => clockError === null
  ? 'device clock'
  : `clock ${clockOffset >= 0 ? '+' : ''}${Math.round(clockOffset)} ±${Math.round(clockError)} ms`;

// Libellé de débug discret (bas gauche), complété par version.js
const renderBuildLabel = () => {
  const el = document.getElementById('buildVersion');
  if (!el || typeof BUILD_VERSION === 'undefined') return;
  el.textContent = `build ${BUILD_VERSION} · ${clockLabel()}`;
};

const sampleClock = async () => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CLOCK_TIMEOUT_MS);
  try {
    const d0 = Date.now();
    const t0 = performance.now();
    const res = await fetch(TIME_URL, { cache: 'no-store', signal: ctrl.signal });
    const t1 = performance.now();
    if (!res.ok) return null;
    const server = (await res.json()).now;
    if (!Number.isFinite(server)) return null;
    const rtt = t1 - t0;
    // heure serveur ≈ heure de l'appareil au milieu de l'aller-retour
    return { rtt, offset: server - (d0 + rtt / 2) };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const syncClock = async () => {
  if (clockSyncing || navigator.onLine === false) return;
  clockSyncing = true;
  try {
    let best = null;
    for (let i = 0; i < CLOCK_SAMPLES; i++) {
      const s = await sampleClock();
      if (s && (!best || s.rtt < best.rtt)) best = s;
      if (!s && i === 0) break; // Worker injoignable : pas d'acharnement
    }
    if (!best) return; // on garde l'horloge actuelle (appareil par défaut)
    const delta = best.offset - clockOffset;
    clockOffset = best.offset;
    clockError = best.rtt / 2;
    clockSyncedAt = Date.now();
    renderBuildLabel();
    // correction notable alors que la radio joue déjà : recalage immédiat
    if (Math.abs(delta) > 1000 && started) applyClockChange();
  } finally {
    clockSyncing = false;
  }
};

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
  // Mode direct : AUCUNE source au repos — le flux est ouvert au moment de
  // la lecture (startLive), et un flux ne boucle pas (fin de fichier →
  // 'ended' → nouveau flux à la position live, qui a rebouclé).
  el.loop = !LIVE_MODE;
  if (!LIVE_MODE) el.src = stationUrl(station);
  audioPool.appendChild(el);
  return el;
});

// Journal de débug : chaque play() (d'où qu'il vienne : app.js, offline.js)
// et son éventuel rejet, plus les événements de lecture. `muted` n'a pas
// d'événement propre : 'volumechange' le couvre, on ne note que ses bascules.
players.forEach((el, index) => {
  const name = dbgName(index);
  const nativePlay = el.play.bind(el);
  el.play = () => {
    const p = nativePlay();
    try {
      // les play() de bénédiction iOS (silence) sont résumés en une ligne
      if (!el.src.startsWith('data:')) {
        dbg(`${name} play()${el.muted ? ' muted' : ''}`);
        if (p && p.catch) p.catch(e => dbg(`${name} play REJECTED ${e && e.name}`));
      }
    } catch (e) {}
    return p;
  };
  ['playing', 'pause', 'waiting', 'stalled'].forEach(type => {
    el.addEventListener(type, () => dbg(type === 'playing'
      ? `${name} playing @${filePosition(index).toFixed(1)} (live ${livePosition(index).toFixed(1)})`
      : `${name} ${type}`));
  });
  el.addEventListener('error', () => dbg(`${name} error ${el.error ? el.error.code : '?'}`));
  let wasMuted = el.muted;
  el.addEventListener('volumechange', () => {
    if (el.muted === wasMuted) return;
    wasMuted = el.muted;
    dbg(`${name} ${wasMuted ? 'muted' : 'unmuted'}${el.paused ? ' (paused)' : ''}`);
  });
});

const livePosition = (index) => {
  const elapsed = (now() - EPOCH) / 1000 + offsets[index];
  return mod(elapsed, stations[index].duration);
};

// --- Flux en direct : état par lecteur ---------------------------------------
// Un lecteur est "live" quand sa source est un flux /live/ : la position
// dans le fichier n'est plus currentTime (qui compte depuis le début du
// flux) mais liveStart + currentTime. Déduit de el.src : toujours juste,
// même quand offline.js change la source de son côté.
const liveStart = stations.map(() => 0);        // position fichier du début du flux
const liveStartedAt = stations.map(() => 0);    // performance.now() à l'ouverture
const liveAwaitingPlay = stations.map(() => false); // 1er 'playing' pas encore vu

const isLive = (index) => srcBase(players[index]) === liveUrl(stations[index]);

// source locale = station téléchargée (offline/KEY.mp3, servie par le SW)
const isLocalSrc = (el) => el.src.startsWith(location.origin + '/');

// Cette station doit-elle être lue en flux direct ? Oui en mode direct, sauf
// si elle est posée sur sa copie hors ligne.
const usesLive = (index) => LIVE_MODE && !isLocalSrc(players[index]);

// POSITION DANS LE FICHIER de ce qu'un lecteur joue : toutes les mesures de
// dérive et de position passent par là, jamais par currentTime directement.
const filePosition = (index) => {
  const el = players[index];
  return isLive(index)
    ? mod(liveStart[index] + el.currentTime, stations[index].duration)
    : el.currentTime;
};

// Vide un lecteur : sans source, la requête en cours (flux en direct =
// requête longue) est abandonnée tout de suite, et il n'a plus rien à jouer.
// removeAttribute + load() : pas d'événement 'error', contrairement à src="".
const clearSrc = (el) => {
  el.removeAttribute('src');
  try { el.load(); } catch (e) {}
};

// Source réseau d'un lecteur au repos (utilisé aussi par offline.js) : le
// fichier en mode legacy, rien en mode direct.
const onNetworkSrc = (index) => LIVE_MODE
  ? !isLocalSrc(players[index])
  : srcBase(players[index]) === stationUrl(stations[index]);

const setNetworkSrc = (index) => {
  if (LIVE_MODE) clearSrc(players[index]);
  else players[index].src = stationUrl(stations[index]);
};

// Avance prise sur la position live à l'ouverture d'un flux : vise l'instant
// probable du premier son. Ajustée à chaque démarrage sur le délai réellement
// mesuré (ouverture → 'playing'), bornée : un réseau lent démarre ainsi près
// du direct au lieu d'accumuler son temps de chargement en retard.
const LIVE_LEAD_MIN_S = 0.3;
const LIVE_LEAD_MAX_S = 3;
let liveLead = 0.5;
// Retard au-delà duquel un flux est rouvert à la position live (après un
// décrochage réseau, une pause subie...) ; en dessous, on laisse jouer :
// rouvrir un flux coûte un blanc.
const LIVE_RESYNC_S = 3;
// pas de réouverture automatique dans les 10 s qui suivent une ouverture :
// sur un réseau très lent, chaque réouverture serait elle-même en retard
const LIVE_RESTART_MIN_MS = 10000;

// flux de la station courante sans donnée jouable depuis... (voir le poll 4 s)
const LIVE_STALL_MS = 12000;
let liveStallSince = 0;

// Ouvre un flux en direct sur la position live (nouvelle source = nouvelle
// requête ; l'ancienne est abandonnée). L'appelant enchaîne sur play().
const startLive = (index, why = '') => {
  const el = players[index];
  const pos = Math.round(mod(livePosition(index) + liveLead, stations[index].duration) * 100) / 100;
  liveStart[index] = pos;
  liveStartedAt[index] = performance.now();
  liveAwaitingPlay[index] = true;
  seekIntents[index] = null;
  el.loop = false;
  el.preload = 'auto';
  el.src = `${liveUrl(stations[index])}?t=${pos.toFixed(2)}`;
  dbg(`${dbgName(index)} live start t=${pos.toFixed(1)}${why ? ` (${why})` : ''}`);
};

// Rouvre le flux d'un lecteur qui joue (recalage, fin de fichier)
const restartLive = (index, why) => {
  startLive(index, why);
  players[index].play().catch(() => {});
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
// Flux en direct : pas de seek possible — au-delà de LIVE_RESYNC_S de retard
// le flux est rouvert (`tolerance` ne concerne que les fichiers). Un flux en
// pause n'est pas touché : sa reprise passe par playStation ou par
// l'événement 'play' (`resumed`), qui le rouvrent.
const syncToLive = (index, tolerance = 1.5, resumed = false) => {
  const el = players[index];
  if (isLive(index)) {
    if (el.paused) return;
    const lag = liveDrift(index);
    if (lag <= LIVE_RESYNC_S) return;
    if (!resumed && performance.now() - liveStartedAt[index] < LIVE_RESTART_MIN_MS) return;
    restartLive(index, `resync ${lag.toFixed(1)}s`);
    return;
  }
  const pos = livePosition(index);
  const delta = Math.abs(el.currentTime - pos);
  const drift = Math.min(delta, stations[index].duration - delta);
  if (drift > tolerance) {
    // posé même avant les métadonnées : devient la "default playback start
    // position", appliquée par le navigateur dès que les données arrivent
    el.currentTime = pos;
    seekIntents[index] = pos;
    // seuls les recalages d'un lecteur qui joue intéressent le journal
    if (!el.paused) dbg(`${dbgName(index)} resync ${drift.toFixed(1)}s`);
  }
};

// iOS (DEFER_PLAY) : position de départ portée par l'URL ("media fragment"
// #t=secondes), posée juste avant chaque play(). Un seek JS, même posé au
// 'loadedmetadata', arrive trop tard sur iOS : le moteur a déjà sorti
// quelques ms depuis 0 (entendu sur station froide). Le fragment, lui, est
// appliqué PAR LE MOTEUR pendant le chargement, sans attendre un handler.
// Réassigner src relance le chargement : l'élément repart toujours à froid,
// donc par le même chemin (station froide, préchargée, reprise après pause).
// La position vise l'instant probable du premier son : live + START_LEAD_S
// (délai play() → son mesuré à 0,1–0,3 s ; un écart résiduel < 1,5 s est
// dans la tolérance des recalages).
// Filets conservés : currentTime posé ici (position de départ par défaut),
// seek au 'loadedmetadata', recalage au 'playing'.
// `force` : même si l'élément n'est pas en pause (relance après erreur).
const START_LEAD_S = 0.3;
const startArmedAt = stations.map(() => 0);

const armStartFragment = (index, force = false) => {
  const el = players[index];
  if (!DEFER_PLAY || (!el.paused && !force)) return false;
  const base = srcBase(el);
  // bénédiction iOS en vol, ou lecteur sans source
  if (!base || el.src.startsWith('data:')) return false;
  const pos = mod(livePosition(index) + START_LEAD_S, stations[index].duration);
  el.src = `${base}#t=${pos.toFixed(2)}`;
  el.currentTime = pos;
  seekIntents[index] = pos;
  startArmedAt[index] = performance.now();
  dbg(`${dbgName(index)} start #t=${pos.toFixed(1)}`);
  return true;
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
  audioCtx.onstatechange = () => dbg(`ctx ${audioCtx.state}`);
};

// Le contexte ne tourne QUE pendant un son (static, SFX). Laissé "running"
// en permanence, il garde une session audio Web Audio ouverte à côté de la
// station : sur iOS, piste sérieuse pour le lecteur de l'écran verrouillé
// qui disparaissait après ~10 min alors que la musique continuait. On le
// suspend donc peu après le dernier son, et tout de suite quand la page
// passe en arrière-plan.
// Aucun son n'est perdu à la reprise : l'horloge d'un contexte suspendu est
// figée, une source start()ée pendant que resume() est en cours part donc
// de son début dès que le contexte tourne. Le seul coût est le délai de
// resume() — masqué en réveillant le contexte dès le pointerdown, avant le
// geste qui déclenchera le son (wakeAudioCtx).
const CTX_IDLE_MS = 1500;
let ctxVoices = 0;       // sources en cours de lecture
let ctxIdleTimer = null;

const wakeAudioCtx = () => {
  if (!audioCtx) return;
  if (ctxIdleTimer) { clearTimeout(ctxIdleTimer); ctxIdleTimer = null; }
  // 'interrupted' (iOS : appel, Siri, autre app) se reprend de la même façon
  if (audioCtx.state !== 'running' && audioCtx.state !== 'closed') {
    try { const p = audioCtx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }
  if (ctxVoices === 0) scheduleCtxSuspend();
};

const suspendAudioCtx = () => {
  if (ctxIdleTimer) { clearTimeout(ctxIdleTimer); ctxIdleTimer = null; }
  if (!audioCtx || ctxVoices > 0 || audioCtx.state !== 'running') return;
  try { const p = audioCtx.suspend(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
};

const scheduleCtxSuspend = () => {
  if (ctxIdleTimer) clearTimeout(ctxIdleTimer);
  ctxIdleTimer = setTimeout(suspendAudioCtx, CTX_IDLE_MS);
};

// Démarre une source en tenant le compte des sons en cours
const startSource = (source) => {
  wakeAudioCtx();
  if (ctxIdleTimer) { clearTimeout(ctxIdleTimer); ctxIdleTimer = null; }
  ctxVoices++;
  source.addEventListener('ended', () => {
    ctxVoices = Math.max(0, ctxVoices - 1);
    if (ctxVoices > 0) return;
    if (document.hidden) suspendAudioCtx(); else scheduleCtxSuspend();
  });
  source.start();
};

const playUiSfx = (kind) => {
  if (!audioCtx) return;
  const list = uiBuffers[kind];
  if (list.length === 0) return;
  const source = audioCtx.createBufferSource();
  source.buffer = list[Math.floor(Math.random() * list.length)];
  source.connect(staticGain);
  startSource(source);
};

// Static de changement de station : UN passage complet de l'échantillon
// (~1 s), jamais tronqué. La station entre après un court moment de static
// seul (voir "Entrée de la station" : muette sous le static, ou play()
// différé sur iOS).
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
  staticIndex = (staticIndex + 1) % staticBuffers.length;
  const buffer = staticBuffers[staticIndex];
  if (!buffer) return;
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  const gain = audioCtx.createGain();
  source.connect(gain);
  gain.connect(staticGain);
  startSource(source);
  const voice = { source, gain };
  staticVoice = voice;
  source.addEventListener('ended', () => { if (staticVoice === voice) staticVoice = null; });
};

// --- Entrée de la station après le static ----------------------------------
// La station est lancée tout de suite (sous le static, pour gagner le temps
// de chargement) mais MUETTE, puis entre d'un coup quand elle est accrochée
// ET que le static a joué au moins STATION_ENTRY_S : le static s'entend
// d'abord seul, comme en jeu.
//
// PAS sur iOS (DEFER_PLAY) : depuis l'introduction de cette entrée muette,
// tout switch y restait silencieux après le static (seule la 1re station,
// lancée sans `muted`, jouait). WebKit n'aime pas qu'on démute hors geste un
// élément lancé muet. Sur iOS on ne touche donc JAMAIS à `muted` : le static
// part, et le play() de la station est simplement différé de STATION_ENTRY_S
// (deferPlay) — les lecteurs étant bénis au premier tap, un play() hors
// geste y est permis. Même rendu : static seul, puis entrée franche.
const STATION_ENTRY_S = 0.45;
let entry = null;      // { index, notBefore }
let entryTimer = null;

// Rend le son à la station en attente, sans rien relancer : sert tel quel
// aux annulations (pause, play() refusé, nouveau switch)
const releaseEntry = () => {
  if (entryTimer) { clearTimeout(entryTimer); entryTimer = null; }
  if (entry) {
    dbg(`entry released ${dbgName(entry.index)}`);
    players[entry.index].muted = false;
    entry = null;
  }
};

// Fin NORMALE de l'entrée (accord, ou délai d'accord dépassé) : rend le son,
// puis vérifie que la station joue toujours. Filet : si le démute a mis
// l'élément en pause (politique d'autoplay), on relance — tout de suite et
// 150 ms après, la pause pouvant être asynchrone. Jamais après une pause
// explicite ni un autre switch (jeton, station courante).
const finishEntry = (index, token) => {
  releaseEntry();
  const check = () => {
    if (!players[index].paused || token !== playToken || index !== currentStation) return;
    dbg(`entry: ${dbgName(index)} paused after unmute, replay`);
    playStation(index);
  };
  check();
  setTimeout(check, 150);
};

// iOS : play() différé derrière le static, à la place de l'entrée muette.
// Annulé par une pause ou un switch plus récent (timer effacé + jeton).
let deferTimer = null;

const cancelDeferredPlay = () => {
  if (deferTimer) { clearTimeout(deferTimer); deferTimer = null; }
};

const deferPlay = (index) => {
  cancelDeferredPlay();
  // un switch est une nouvelle intention de lecture : périme les relances
  // en attente de la station quittée
  const token = ++playToken;
  clearGestureRetry();
  deferTimer = setTimeout(() => {
    deferTimer = null;
    if (token !== playToken || index !== currentStation) return;
    dbg(`deferred play ${dbgName(index)}`);
    playStation(index);
  }, STATION_ENTRY_S * 1000);
};

// Posé AVANT le play()
const armEntry = (index) => {
  releaseEntry();
  entry = { index, notBefore: performance.now() + STATION_ENTRY_S * 1000 };
  players[index].muted = true;
};

// Appelé à l'accord
const openEntry = (index) => {
  if (!entry || entry.index !== index || entryTimer) return;
  const token = playToken;
  entryTimer = setTimeout(() => {
    entryTimer = null;
    dbg(`entry open ${dbgName(index)}`);
    finishEntry(index, token);
  }, Math.max(0, entry.notBefore - performance.now()));
};

// "Accord" de la station visée : elle n'est considérée accrochée que quand
// sa lecture AVANCE réellement près de la position live — pas au simple
// 'playing'. Sur iOS, 'playing' arrive avant le son audible, et souvent à la
// mauvaise position (seek posé en pause ignoré, recalage qui rebufferise).
// C'est l'accord qui déclenche l'entrée de la station.
let tuning = null;      // { index, from } : from = 1re position vue en lecture
let tuningTimer = null;
let tunedAt = -Infinity;        // instant de l'accord (rattrapage d'un décrochage)
const TUNE_STEP_S = 0.05;
const TUNE_MAX_MS = 8000; // réseau mort : on rend le volume, on arrête le poll

const endTuning = () => {
  tuning = null;
  if (tuningTimer) { clearInterval(tuningTimer); tuningTimer = null; }
};

const liveDrift = (index) => {
  const el = players[index];
  const delta = Math.abs(filePosition(index) - livePosition(index));
  return Math.min(delta, stations[index].duration - delta);
};

// Écart maximal à la position live pour considérer la station accrochée.
// Fichier : 2,5 s (au-delà, le seek n'a pas été appliqué). Flux en direct :
// le serveur a forcément servi la bonne position, l'écart n'est que du
// retard de chargement — on laisse entrer la station (le recalage rouvrira
// le flux si besoin) plutôt que de la garder muette ; seul un vieux flux
// repris depuis son tampon est écarté.
const TUNE_DRIFT_FILE_S = 2.5;
const TUNE_DRIFT_LIVE_S = 6;

const checkTuned = () => {
  if (!tuning) return;
  const { index } = tuning;
  const el = players[index];
  if (index !== currentStation) { endTuning(); return; }
  if (performance.now() - tuning.since > TUNE_MAX_MS) {
    dbg(`tune timeout ${dbgName(index)}`);
    endTuning();
    // une pause ou un refus de play() auraient déjà arrêté le poll : le
    // jeton courant est bien celui de cette lecture
    finishEntry(index, playToken);
    return;
  }
  if (el.paused || el.seeking || el.readyState < 3
      || liveDrift(index) > (isLive(index) ? TUNE_DRIFT_LIVE_S : TUNE_DRIFT_FILE_S)) {
    tuning.from = null;
    return;
  }
  if (tuning.from === null) { tuning.from = el.currentTime; return; }
  if (el.currentTime - tuning.from >= TUNE_STEP_S) {
    const since = tuning.since;
    endTuning();
    tunedAt = performance.now();
    dbg(`tuned ${dbgName(index)} +${Math.round(tunedAt - since)}ms`);
    openEntry(index);
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
  players.forEach(el => { el.volume = globalVolume; });
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

// Haut de la fenêtre jamais au-dessus du nom de la station et du morceau :
// sur téléphone en portrait, ils sont empilés sous le logo (style.css) et
// la fenêtre passait dessus.
const maskTopMin = () => {
  // la ligne du morceau compte même vide (titre affiché plus tard)
  const t = trackInfo.getBoundingClientRect();
  const lineH = parseFloat(getComputedStyle(trackInfo).fontSize) * 1.4 || 0;
  const bottom = Math.max(stationTitle.getBoundingClientRect().bottom, t.top + lineH);
  // 10 px sous la ligne du morceau, pas plus (l'écart paraissait trop grand)
  const pct = (bottom + 10) / (window.innerHeight || 1) * 100;
  return Math.max(12, Math.min(pct, 40));
};

const randomMaskPoints = () => {
  const top = maskTopMin();
  // irrégularité : 16 points sur desktop (12-28 %), 3 sous le titre sur
  // téléphone, pour ne pas recreuser l'écart
  const topSpan = top > 12 ? 3 : 16;
  return [
    { x: rand(8, 24), y: rand(top, top + topSpan) }, // haut gauche
    { x: rand(76, 92), y: rand(top, top + topSpan) }, // haut droit
    { x: rand(76, 92), y: rand(72, 88) }, // bas droit
    { x: rand(8, 24), y: rand(72, 88) }  // bas gauche
  ];
};

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

// Titre / artiste affichés pour une entrée de tracklist (tracks.js). Coupure
// pub [début, ADS] ou passage parlé [début, TALK] (interview, sketch, long
// DJ) : aucun titre (null) — la ligne du morceau se vide et l'écran
// verrouillé affiche le nom de la station, jamais le morceau d'avant ou
// d'après. Marqueurs comparés en littéraux : app.js ne dépend pas de la
// version de tracks.js.
const NON_MUSIC = ['ads', 'talk'];
const trackLabel = (track) => {
  if (!track || NON_MUSIC.includes(track[1])) return null;
  return { title: track[1], artist: track[2] };
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
  const label = trackLabel(track);
  setTrackText(label ? `${label.title} — ${label.artist}` : '');
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
  // réveille l'AudioContext (suspendu au repos) dès le début du geste : il
  // tourne déjà quand le relâcher déclenche le static
  wakeAudioCtx();
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
let mediaMetaStation = -1; // station de l'objet MediaMetadata en place
const updateMediaSessionMetadata = () => {
  if (!('mediaSession' in navigator)) return;
  const station = stations[currentStation];
  const track = currentTrack();
  lastMediaKey = currentStation + '|' + (track ? track[1] : '');
  const label = trackLabel(track);
  const title = label ? label.title : station.name;
  const artist = label ? label.artist : 'Vice City Radio';
  // Même station, seul le morceau change (toutes les ~4-5 min, souvent écran
  // verrouillé) : on retouche titre et artiste sur l'objet EXISTANT au lieu
  // de le remplacer. Un nouvel objet fait recharger la pochette et
  // reconstruire la fiche Now Playing en arrière-plan — suspect pour le
  // lecteur de l'écran verrouillé qui disparaissait sur iOS. (Différer la
  // mise à jour tant que la page est cachée aurait figé le titre là où on le
  // lit justement : sur l'écran verrouillé.)
  const meta = navigator.mediaSession.metadata;
  if (meta && mediaMetaStation === currentStation) {
    try {
      if (meta.title !== title) meta.title = title;
      if (meta.artist !== artist) meta.artist = artist;
      dbg(`meta title "${title}"`);
      return;
    } catch (e) {} // objet non modifiable (vieux moteur) : on le recrée
  }
  mediaMetaStation = currentStation;
  dbg(`meta new ${dbgName(currentStation)} "${title}"`);
  // fond blanc OPAQUE : sur l'autoradio (iPod / CarPlay / Bluetooth) la
  // transparence s'affichait en noir ou en artefacts
  const art = `logos/artwork/${stationArtKey(currentStation)}.png`;
  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist,
    album: station.name,
    artwork: [
      { src: art, sizes: '192x192', type: 'image/png' },
      { src: art, sizes: '512x512', type: 'image/png' }
    ]
  });
};

// État de lecture déclaré explicitement, sur les événements réels de la
// station COURANTE : sans ça le système le devine, et peut conclure à tort
// que plus rien ne joue. La pause de la station quittée pendant un switch
// n'est pas "courante" (currentStation a déjà changé) : pas de passage par
// 'paused' entre deux stations.
// État recalculé depuis la réalité (station courante en lecture, ou lecture
// différée en attente) plutôt que copié d'un seul événement : un événement
// manqué ou arrivé dans le désordre laissait l'écran verrouillé sur "pause"
// alors que la radio jouait. Recalé aussi périodiquement (intervalle 4 s).
const syncPlaybackState = () => {
  if (!('mediaSession' in navigator)) return;
  const playing = started && (!players[currentStation].paused || deferTimer !== null);
  const state = playing ? 'playing' : 'paused';
  if (playing) applyLivePositionState();
  if (navigator.mediaSession.playbackState === state) return;
  try { navigator.mediaSession.playbackState = state; } catch (e) {}
  dbg(`ms state ${state}`);
};
players.forEach(el => {
  ['play', 'playing', 'pause'].forEach(type => el.addEventListener(type, syncPlaybackState));
});

const setupMediaSession = () => {
  if (!('mediaSession' in navigator)) return;
  // "play" resynchronise sur la position live : une radio n'est jamais en pause
  navigator.mediaSession.setActionHandler('play', () => { dbg('ms action play'); playStation(currentStation); });
  navigator.mediaSession.setActionHandler('pause', () => { dbg('ms action pause'); pauseRadio(); });
  navigator.mediaSession.setActionHandler('previoustrack', () => { dbg('ms action prev'); step(-1); });
  navigator.mediaSession.setActionHandler('nexttrack', () => { dbg('ms action next'); step(1); });
  // Interface "direct" : ni avance/recul ni déplacement dans le fichier (une
  // radio ne se rembobine pas) — seulement lecture/pause et précédent/suivant
  ['seekto', 'seekbackward', 'seekforward'].forEach(action => {
    try { navigator.mediaSession.setActionHandler(action, null); } catch (e) {}
  });
  applyLivePositionState();
};

// Durée INFINIE annoncée au système, comme un vrai flux en direct : l'écran
// verrouillé / l'autoradio n'affichent plus la durée du fichier (~1 h) ni une
// barre de progression qui ne correspond à rien. Réappliqué à chaque
// démarrage (le système peut repartir de la durée de l'élément audio).
let livePositionStateOk = null; // null = pas encore essayé
const applyLivePositionState = () => {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  try {
    navigator.mediaSession.setPositionState({ duration: Infinity, playbackRate: 1, position: 0 });
    if (livePositionStateOk !== true) dbg('ms position: live (durée infinie)');
    livePositionStateOk = true;
  } catch (e) {
    // moteur qui refuse Infinity : on n'annonce rien plutôt qu'une durée fausse
    try { navigator.mediaSession.setPositionState(); } catch (e2) {}
    if (livePositionStateOk !== false) dbg(`ms position: Infinity refusé (${e && e.name})`);
    livePositionStateOk = false;
  }
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
// Flux en direct : la requête est longue (jusqu'à la fin du fichier) et ne
// sert plus à rien une fois la station quittée — le lecteur est vidé.
const releasePlayer = (index) => {
  const el = players[index];
  if (!el.paused || el.src === SILENT_WAV) return;
  if (isLive(index)) {
    el.preload = 'none';
    clearSrc(el);
    return;
  }
  const holdsNetwork = el.readyState > 0 || el.networkState === HTMLMediaElement.NETWORK_LOADING;
  el.preload = 'none';
  if (!holdsNetwork) return;
  el.src = srcBase(el);
  seekIntents[index] = null;
};

// Une voisine en flux direct n'est jamais gardée : précharger un direct n'a
// pas de sens (le tampon serait périmé au moment du switch).
const releaseIdle = (center) => {
  const keep = [center, ...neighborsOf(center)];
  players.forEach((_, index) => {
    if (index === center) return;
    if (!keep.includes(index) || isLive(index)) releasePlayer(index);
  });
};

// Écran verrouillé / app en arrière-plan : UNE seule <audio> active, celle
// qu'on écoute. Les voisines préchargées continuaient de charger (stalled
// à répétition dans le journal iOS) ; iOS rattache le lecteur de l'écran
// verrouillé à un élément audio et peut le céder à un élément en pause qui
// s'active → contrôles disparus alors que la musique continue.
const releaseAllButCurrent = () => {
  players.forEach((_, index) => { if (index !== currentStation) releasePlayer(index); });
};

const warmNeighbors = () => {
  if (document.hidden) { releaseAllButCurrent(); return; }
  releaseIdle(currentStation);
  // iOS : chaque démarrage réassigne src (#t=), le tampon préchargé serait jeté
  if (saveData() || DEFER_PLAY) return;
  neighborsOf(currentStation).forEach(index => {
    const el = players[index];
    // flux en direct : rien à précharger (seules les voisines lues en
    // fichier — legacy, copies hors ligne — sont préparées)
    if (!el.paused || usesLive(index)) return;
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
let explicitPauseToken = -1; // jeton au moment de la dernière pause voulue par l'utilisateur
let externalPauseAt = 0;     // horodatage d'une pause imposée de l'extérieur
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
  if (usesLive(index)) {
    // Flux en direct : toute (re)prise ouvre un NOUVEAU flux à la position
    // live — rien n'est repris d'un flux en pause, périmé. Seul un flux qui
    // joue déjà près du direct est laissé tel quel.
    if (el.paused || !isLive(index) || el.error || liveDrift(index) > LIVE_RESYNC_S) {
      startLive(index);
    }
  } else {
    el.loop = true;
    // iOS : position de départ dans l'URL (armStartFragment) ; ailleurs, ou
    // si l'élément joue déjà, simple recalage
    if (!armStartFragment(index)) syncToLive(index);
  }
  el.play().catch(() => {
    if (token !== playToken) return;
    endTuning();
    stopStatic();
    releaseEntry();
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

// INVARIANT : seule `currentStation` a le droit de jouer. Au déverrouillage,
// iOS peut relancer de lui-même des lecteurs qu'on avait lancés puis mis en
// pause page cachée (stations survolées avec piste suivante/précédente de
// l'écran verrouillé) : plusieurs stations jouaient en même temps. Tout
// lecteur non courant qui joue est donc remis en pause, d'où que vienne son
// play() — et libéré, pour qu'il n'ait plus rien à jouer.
// Ne gêne pas un switch : setStation() change currentStation AVANT le play().
// Les play() de bénédiction iOS (silence en data-URI) ne sont pas concernés.
const enforceSingle = (index, why) => {
  const el = players[index];
  if (index === currentStation || el.paused || el.src.startsWith('data:')) return false;
  dbg(`GUARD ${dbgName(index)} playing (${why}), not current → pause`);
  el.pause();
  releasePlayer(index);
  return true;
};

const enforceSingleAll = (why) => {
  players.forEach((_, index) => enforceSingle(index, why));
};

players.forEach((el, index) => {
  ['play', 'playing'].forEach(type => {
    el.addEventListener(type, () => enforceSingle(index, type));
  });
});

// Pause explicite (bouton pause du menu, Media Session) : annule aussi
// toute relance différée en attente
const pauseRadio = () => {
  dbg('pauseRadio');
  playToken++;
  explicitPauseToken = playToken;
  externalPauseAt = 0;
  clearGestureRetry();
  cancelDeferredPlay();
  endTuning();
  stopStatic();
  releaseEntry();
  stopAll();
  // pause en plein switch : aucun lecteur ne jouait, donc aucun événement
  // 'pause' ne viendra mettre à jour l'état Media Session ni le bouton
  try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; } catch (e) {}
  updatePauseButton();
};

const setStation = (index) => {
  currentStation = index;
  try { localStorage.setItem('vcr-station', String(index)); } catch (e) {}

  updateMediaSessionMetadata();
  updateStationTitle();
  retargetMask();

  dbg(`setStation ${dbgName(index)}`);

  // Coupure immédiate + static. Ensuite, hors iOS : play() de la nouvelle
  // station TOUT DE SUITE, muette sous le static, qui entre quand elle est
  // réellement accrochée et que le static a joué seul un moment (armEntry).
  // Sur iOS (DEFER_PLAY) : aucun `muted`, play() différé de STATION_ENTRY_S
  // (deferPlay) — voir "Entrée de la station".
  // PAS de play()+pause() de "bénédiction" ici : la course play→pause→play
  // peut laisser l'élément en pause sur iOS.
  cancelDeferredPlay();
  stopAll();
  // libère tout de suite les connexions des stations quittées (switchs en
  // rafale compris) pour que la requête de la station visée parte sans attendre
  // page cachée : TOUT sauf la station visée (voisines comprises) — un
  // lecteur libéré n'a plus rien à jouer si iOS le relance au déverrouillage
  if (document.hidden) releaseAllButCurrent(); else releaseIdle(index);
  playStatic();
  // gardé dans les deux cas : sert aussi à la reprise du static ('waiting')
  startTuning(index);
  if (DEFER_PLAY) {
    releaseEntry(); // par sécurité : aucune station ne reste muette sur ce chemin
    // Page cachée (piste suivante/précédente depuis l'écran verrouillé) :
    // play() IMMÉDIAT. Plus aucun son ne tourne après stopAll(), iOS peut
    // geler le timer du play différé — la station ne repartirait jamais.
    if (document.hidden) playStation(index);
    else deferPlay(index);
  } else {
    armEntry(index);
    playStation(index);
  }
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

const blessAllPlayers = () => {
  dbg('bless players');
  players.forEach((el, index) => {
    if (index === currentStation) return; // la station courante joue dans le geste
    // mode direct : pas de source au repos (ni flux à restaurer)
    const realSrc = el.getAttribute('src') && !isLive(index) ? srcBase(el) : null;
    el.src = SILENT_WAV;
    const p = el.play();
    if (p && p.catch) p.catch(() => {});
    setTimeout(() => {
      // lecteur déjà repris entre-temps (switch immédiat) : on n'y touche plus
      if (el.src !== SILENT_WAV) return;
      el.pause();
      // preload="none" : restaurer la vraie source ne relance aucun
      // téléchargement (avant : 8 requêtes de 2 Mo en plein démarrage)
      el.preload = 'none';
      if (realSrc) {
        el.src = realSrc;
        syncToLive(index);
      } else {
        clearSrc(el);
      }
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
  wakeAudioCtx();

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

// Un play différé en attente (iOS, entre deux stations) compte comme une
// lecture : le bouton ne clignote pas pendant un switch
const updatePauseButton = () => {
  const anyPlaying = deferTimer !== null || players.some(el => !el.paused);
  pauseButton.style.display = pickerOpen() && anyPlaying ? 'flex' : 'none';
};

// Suit l'état réel des lecteurs : une pause ou une reprise depuis l'écran
// verrouillé (Media Session) ne passe par aucun bouton de l'app
players.forEach(el => ['play', 'pause'].forEach(type => el.addEventListener(type, updatePauseButton)));

pauseButton.addEventListener('click', () => {
  playUiSfx('select');
  pauseRadio();
  updatePauseButton();
  // plus rien ne joue : le titre de station et le morceau n'ont plus lieu d'être
  stationTitle.style.display = 'none';
  trackInfo.textContent = '';
});

// Hors ligne, seules les stations téléchargées sont jouables : les autres
// sont grisées (grille et carrousel). offline.js rappelle cette fonction
// quand un téléchargement se termine ou est purgé.
const stationAvailable = (index) => navigator.onLine !== false
  || !!(window.vcrOffline && window.vcrOffline.isDownloaded
        && window.vcrOffline.isDownloaded(index));

const updateAvailability = () => {
  const tiles = stationPicker.querySelectorAll('.picker-tile');
  stations.forEach((_, index) => {
    const off = !stationAvailable(index);
    if (tiles[index]) tiles[index].classList.toggle('off-air', off);
    if (pages[index]) pages[index].classList.toggle('off-air', off);
  });
};
window.addEventListener('online', updateAvailability);
window.addEventListener('offline', updateAvailability);

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
  wakeAudioCtx();
};
document.addEventListener('pointerdown', primeAudio, { capture: true, once: true });
document.addEventListener('keydown', primeAudio, { capture: true, once: true });

initCarousel();
initPicker();
updateAvailability();
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
  dbg(`visibility ${document.visibilityState}`);
  // arrière-plan : pas d'AudioContext actif à côté de la station (voir
  // wakeAudioCtx) — un static en cours finit d'abord son passage
  if (document.hidden) {
    suspendAudioCtx();
    releaseAllButCurrent();
    return;
  }
  // retour au premier plan : aucune autre station que la courante ne joue
  // (iOS relance parfois les lecteurs lancés page cachée, voir enforceSingle)
  enforceSingleAll('visible');
  const el = players[currentStation];
  if (!el.paused) syncToLive(currentStation, 10);
  // retour au premier plan : on re-prépare les voisines pour des switchs rapides
  if (started && !el.paused) scheduleWarm();
  if (Date.now() - clockSyncedAt > CLOCK_RESYNC_MS) syncClock();
});

// Horloge commune : recalage de la station en cours (et des voisines déjà
// préparées) quand la correction d'heure arrive après le début de l'écoute
const applyClockChange = () => {
  if (!players[currentStation].paused) syncToLive(currentStation);
  neighborsOf(currentStation).forEach(index => {
    if (players[index].paused && players[index].preload === 'auto') syncToLive(index);
  });
};
syncClock();
window.addEventListener('online', syncClock);

// Fin de lecture : fin de fichier d'un flux en direct (cas normal, une fois
// par tour de station), ou filet de sécurité si loop déraille (vieux iOS) :
// repart sur la position live
players.forEach((el, index) => {
  el.addEventListener('ended', () => {
    if (index !== currentStation) return; // seule la station courante repart
    // flux en direct : fin du fichier atteinte (ou flux coupé proprement) →
    // nouveau flux à la position live, qui a rebouclé au début
    if (isLive(index)) { restartLive(index, 'ended'); return; }
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
    // ne relancer la lecture que si elle était en cours au moment de l'erreur
    // et qu'aucune pause explicite n'est intervenue depuis
    // le moteur peut avoir déjà mis l'élément en pause au moment de l'erreur
    // (Chrome sur erreur de décodage) : la station courante "devait jouer" tant
    // que l'utilisateur n'a pas mis en pause lui-même
    let wasPlaying = !el.paused
      || (index === currentStation && started && playToken !== explicitPauseToken);
    // Flux en direct en pause SUBIE depuis un moment (AirPods retirés...) :
    // sa requête, longue et inactive, finit coupée par le réseau. Ce n'est
    // pas une lecture à relancer — la reprise ouvrira un nouveau flux.
    if (isLive(index) && el.paused && externalPauseAt
        && Date.now() - externalPauseAt > 2000) wasPlaying = false;
    // station téléchargée qui jouait en streaming : bascule tout de suite sur
    // la copie locale (offline.js) plutôt que de réessayer le réseau
    if (window.vcrOffline && window.vcrOffline.takeOver
        && window.vcrOffline.takeOver(index, wasPlaying)) return;
    retryDelays[index] = Math.min(15000, retryDelays[index] ? retryDelays[index] * 2 : 1500);
    const token = playToken;
    // hors ligne, une source réseau ne peut que rééchouer : on attend le
    // retour de la connexion au lieu de réessayer toutes les 15 s
    const schedule = (fn) => {
      if (navigator.onLine === false && !el.src.startsWith(location.origin)) {
        window.addEventListener('online', () => setTimeout(fn, 500), { once: true });
      } else {
        setTimeout(fn, retryDelays[index]);
      }
    };
    schedule(() => {
      // Élément déjà réparé entre-temps (nouvelle source posée par
      // offline.js, autre retry) : surtout pas de load(), qui mettrait en
      // pause une lecture repartie — ex. copie hors ligne évincée → 404 du
      // SW → offline.js repasse au réseau et relance ; ce load() coupait le
      // flux 1,5 s plus tard.
      if (!el.error) return;
      // à décider AVANT load(), qui remet l'élément en pause : on relance si
      // la station joue encore (lecture demandée depuis l'erreur), ou si elle
      // jouait à l'erreur sans pause explicite ni autre demande depuis
      const resume = index === currentStation && started
        && (!el.paused || (wasPlaying && token === playToken));
      dbg(`${dbgName(index)} error retry${resume ? ' + play' : ''}`);
      if (usesLive(index)) {
        // flux en direct : un nouveau flux à la position live si la station
        // doit jouer ; sinon rien à rouvrir (la prochaine lecture le fera),
        // et un lecteur qui n'est plus la station courante est vidé
        if (resume) startLive(index, 'error retry');
        else if (index !== currentStation) releasePlayer(index);
      } else if (!armStartFragment(index, true)) {
        // iOS : nouvelle source à fragment frais (= rechargement), sinon
        // load() repartirait sur le #t= périmé du dernier démarrage
        el.load();
        syncToLive(index);
      }
      if (resume) el.play().catch(() => {});
    });
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
  // Départ à froid (rien de chargé au play()) : iOS jette le seek posé avant
  // les métadonnées et démarrait à 0 — quelques ms audibles avant le
  // recalage du 'canplay', qui arrive alors que le son est déjà parti.
  // 'loadedmetadata' est le premier instant où un seek est un VRAI seek, et
  // aucun son ne peut encore sortir (pas de données décodées) : on y repose
  // la position live. Sur iOS sans condition : le getter currentTime y
  // renvoie la valeur demandée même quand le moteur l'a ignorée.
  el.addEventListener('loadedmetadata', () => {
    const intended = seekIntents[index];
    // station courante ou non : un lecteur quitté pendant son chargement
    // puis repris aussitôt ne repasse pas par ici
    if (intended === null || isLive(index)) return; // un flux ne se seeke pas
    if (!DEFER_PLAY && Math.abs(el.currentTime - intended) <= 2.5) return;
    // même cible que le fragment : le reste de l'avance START_LEAD_S
    const lead = Math.max(0, START_LEAD_S - (performance.now() - startArmedAt[index]) / 1000);
    const pos = mod(livePosition(index) + (DEFER_PLAY ? lead : 0), stations[index].duration);
    // journal : station courante seulement (les voisines préchargées
    // passent ici toutes les 15 s)
    if (index === currentStation) dbg(`${dbgName(index)} metadata @${el.currentTime.toFixed(1)} → seek ${pos.toFixed(1)}`);
    el.currentTime = pos;
    seekIntents[index] = pos;
  });

  // iOS peut jeter un seek posé avant les métadonnées : on le ré-asserte dès
  // que l'élément est prêt, AVANT le démarrage audible
  el.addEventListener('canplay', () => {
    const intended = seekIntents[index];
    if (index === currentStation && intended !== null && !isLive(index)
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

  // REPRISE, quelle que soit la façon dont la lecture a été coupée puis
  // relancée (AirPod retiré/remis, écran verrouillé, centre de contrôle,
  // casque Bluetooth, iOS qui relance l'élément lui-même...) : on repart à
  // la position live, jamais là où la pause avait figé la lecture.
  el.addEventListener('play', () => {
    if (index !== currentStation || !started) return;
    externalPauseAt = 0;
    // flux en direct repris hors de l'app (son tampon date de la pause) :
    // rouvert s'il a plus de LIVE_RESYNC_S de retard
    syncToLive(index, 1.5, true);
  });

  // Pause qui ne vient pas de l'app (AirPod retiré, sortie audio coupée,
  // appel...) : notée pour une reprise automatique au retour de la sortie
  // audio (voir 'devicechange'). Les pauses de switch visent l'ancienne
  // station (currentStation a déjà changé) et sont ignorées.
  el.addEventListener('pause', () => {
    if (index !== currentStation || !started || playToken === explicitPauseToken) return;
    externalPauseAt = Date.now();
    dbg(`${dbgName(index)} pause externe`);
  });

  el.addEventListener('playing', () => {
    if (index !== currentStation) return;
    if (isLive(index)) {
      if (!liveAwaitingPlay[index]) {
        // reprise après un décrochage : flux rouvert s'il a pris trop de retard
        syncToLive(index);
        return;
      }
      // premier 'playing' du flux : délai réel ouverture → lecture, qui sert
      // d'avance au prochain démarrage (moyenne glissante, bornée)
      liveAwaitingPlay[index] = false;
      const delay = (performance.now() - liveStartedAt[index]) / 1000 - el.currentTime;
      liveLead = Math.max(LIVE_LEAD_MIN_S, Math.min(LIVE_LEAD_MAX_S, (liveLead + delay) / 2));
      const lag = liveDrift(index);
      dbg(`${dbgName(index)} live playing +${Math.round(delay * 1000)}ms drift ${lag.toFixed(1)}s lead→${liveLead.toFixed(2)}`);
      if (lag > 2.5) {
        // station entendue hors position (chargement plus long que l'avance)
        dbg(`${dbgName(index)} STARTED OFF @${filePosition(index).toFixed(1)} wanted ${livePosition(index).toFixed(1)}`);
      }
      return;
    }
    // le static, lui, s'arrête à l'accord réel (checkTuned), pas ici
    const intended = seekIntents[index];
    seekIntents[index] = null;
    if (intended !== null && Math.abs(el.currentTime - intended) > 2.5) {
      // ne devrait plus arriver (seek posé au 'loadedmetadata') : si cette
      // ligne apparaît, la station a été entendue hors position
      dbg(`${dbgName(index)} STARTED OFF @${el.currentTime.toFixed(1)} wanted ${intended.toFixed(1)}`);
      syncToLive(index);
    } else {
      // pas de seek en attente : simple garde-fou contre les grosses dérives
      syncToLive(index, 10);
    }
  });
});

// journal : une ligne par minute en arrière-plan, pour dater la disparition
// des contrôles de l'écran verrouillé par rapport au reste
let lastBgBeat = 0;
setInterval(() => {
  const el = players[currentStation];
  if (document.hidden && Date.now() - lastBgBeat > 60000) {
    lastBgBeat = Date.now();
    const active = players.filter(p => !p.paused || p.networkState === HTMLMediaElement.NETWORK_LOADING).length;
    dbg(`bg ${dbgName(currentStation)} ${el.paused ? 'PAUSED' : 'playing'} rs${el.readyState} actifs ${active}`);
  }
  syncPlaybackState();
  enforceSingleAll('poll'); // filet : un événement 'play' manqué
  // jamais pendant un seek/buffering en cours : on relancerait la roue
  if (!el.paused && !el.seeking && el.readyState >= 3) {
    syncToLive(currentStation, 10);
  }
  // Flux en direct figé (connexion morte sans erreur ni fin de flux : le
  // navigateur ne peut pas reprendre un flux sans Range) : rouvert après
  // LIVE_STALL_MS sans donnée jouable. Hors ligne, on attend le réseau.
  const stuck = isLive(currentStation) && !el.paused && !el.error && el.readyState < 3;
  if (!stuck) {
    liveStallSince = 0;
  } else if (!liveStallSince) {
    liveStallSince = performance.now();
  } else if (performance.now() - liveStallSince > LIVE_STALL_MS && navigator.onLine !== false
      && performance.now() - liveStartedAt[currentStation] > LIVE_RESTART_MIN_MS) {
    liveStallSince = 0;
    restartLive(currentStation, 'stall');
  }
}, 4000);

// Rafraîchit le morceau affiché au fil de la lecture (les titres changent
// toutes les quelques minutes, une vérif toutes les 2 s suffit)
setInterval(updateTrackInfo, 2000);

// Retour de la sortie audio (AirPods remis, casque rebranché) après une
// pause qui ne venait pas de l'app : reprise automatique, à la position
// live. iOS renvoie normalement lui-même un "play" (handler Media Session) ;
// ceci est un filet quand il ne le fait pas. Fenêtre de 10 min : au-delà,
// relancer tout seul surprendrait.
const EXTERNAL_RESUME_MS = 10 * 60 * 1000;
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    dbg('devicechange');
    const el = players[currentStation];
    if (!started || !el.paused || !externalPauseAt) return;
    if (Date.now() - externalPauseAt > EXTERNAL_RESUME_MS) return;
    externalPauseAt = 0;
    dbg('reprise auto (sortie audio revenue)');
    playStation(currentStation);
  });
}

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
