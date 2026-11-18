// Worker proxy R2 pour les radios de VCRadios.
// - l'URL publique de dev (pub-*.r2.dev) est rate-limitée par Cloudflare et
//   laisse tomber des requêtes de façon aléatoire → ce Worker sert le bucket
//   sans cette limite ;
// - les plages ouvertes (Range: bytes=X-) sont BORNÉES à 2 Mo : Firefox et
//   Safari ne les interrompent pas d'eux-mêmes et téléchargeraient sinon le
//   fichier entier (60 Mo) dès un preload="metadata", saturant la connexion.
//   Le Content-Range total permet au navigateur de connaître taille et durée
//   et d'enchaîner les chunks au fil de la lecture, comme sur un vrai CDN.
const CHUNK = 2 * 1024 * 1024;

// Plage ouverte depuis l'octet 0 = sonde d'en-tête du navigateur avant le
// seek vers la position live : la lecture d'une radio "en direct" ne part
// quasiment jamais du début, 2 Mo y étaient presque toujours jetés. 256 Ko
// suffisent à l'analyse du MP3 ; si la lecture part vraiment de 0 (bouclage),
// le navigateur enchaîne simplement la plage suivante.
const HEAD_CHUNK = 256 * 1024;

// Les fichiers ne changent jamais : taille mémorisée par isolat, ce qui
// économise un aller-retour R2 (head) sur chaque chunk après le premier.
const sizes = new Map();

const sizeOf = async (env, key) => {
  if (sizes.has(key)) return sizes.get(key);
  const head = await env.BUCKET.head(key);
  if (!head) return null;
  sizes.set(key, head.size);
  return head.size;
};

// --- Flux "en direct" (/live/radio/KEY.mp3?t=secondes) ----------------------
// iOS n'affiche une interface "direct" (ni barre de progression ni durée) sur
// l'écran verrouillé / l'autoradio que pour un média SANS longueur connue,
// comme un flux Icecast. Cette route sert donc le fichier à partir de la
// position t, d'une traite jusqu'à la fin, sans Content-Length ni Range :
// pour le navigateur c'est un flux, pas un fichier. La position "live" est
// calculée par l'app (horloge commune /time) et passée dans t.
// Les fichiers sont des MP3 CBR (MPEG-1/2 Layer III) : octet = t × débit / 8,
// recalé sur un vrai début de trame.
const PROBE = 4096; // fenêtre de recherche de trame (trame max ≈ 1,4 Ko)

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES = [44100, 48000, 32000];

// En-tête de trame MPEG audio Layer III à l'index i, ou null.
// sig = version + couche + fréquence : identique sur toutes les trames d'un
// même fichier, sert à écarter les fausses synchros dans les données audio.
const parseFrame = (b, i) => {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[i + 1] >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layer = (b[i + 1] >> 1) & 3;   // 1 = Layer III
  const bitrateIdx = b[i + 2] >> 4;
  const rateIdx = (b[i + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) return null;
  const v1 = version === 3;
  const bitrate = (v1 ? BITRATES_V1 : BITRATES_V2)[bitrateIdx] * 1000;
  const sampleRate = SAMPLE_RATES[rateIdx] >> (v1 ? 0 : version === 2 ? 1 : 2);
  const padding = (b[i + 2] >> 1) & 1;
  return {
    bitrate,
    length: Math.floor((v1 ? 144 : 72) * bitrate / sampleRate) + padding,
    sig: (version << 4) | (layer << 2) | rateIdx
  };
};

// Premier index d'une trame dont les deux suivantes (dans la fenêtre) sont
// aussi valides, même format et même débit (CBR). -1 si aucune.
const findFrame = (b, ref) => {
  for (let i = 0; i + 4 <= b.length; i++) {
    const f = parseFrame(b, i);
    if (!f || (ref && (f.sig !== ref.sig || f.bitrate !== ref.bitrate))) continue;
    let j = i + f.length;
    let ok = 0;
    for (; ok < 2; ok++) {
      const n = parseFrame(b, j);
      if (!n || n.sig !== f.sig || n.bitrate !== f.bitrate) break;
      j += n.length;
    }
    if (ok === 2) return i;
  }
  return -1;
};

const readBytes = async (env, key, offset, length) => {
  const object = await env.BUCKET.get(key, { range: { offset, length } });
  if (!object) return null;
  return { size: object.size, bytes: new Uint8Array(await object.arrayBuffer()) };
};

// Format du fichier, lu une fois par isolat (les fichiers ne changent
// jamais) : taille, début des données audio (après un éventuel tag ID3v2),
// débit et signature de la première trame.
const metas = new Map();

const metaOf = async (env, key) => {
  if (metas.has(key)) return metas.get(key);
  let head = await readBytes(env, key, 0, PROBE);
  if (!head) return null;
  const size = head.size;
  let base = 0;
  const b = head.bytes;
  if (b.length >= 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) { // "ID3"
    base = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
    if (base >= size) return null;
    head = await readBytes(env, key, base, PROBE);
    if (!head) return null;
  }
  const at = findFrame(head.bytes, null);
  if (at < 0) return null;
  const frame = parseFrame(head.bytes, at);
  const meta = { size, dataStart: base + at, bitrate: frame.bitrate, sig: frame.sig };
  metas.set(key, meta);
  sizes.set(key, size);
  return meta;
};

const liveHeaders = () => new Headers({
  'Content-Type': 'audio/mpeg',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*'
});

const serveLive = async (request, env, key, url) => {
  const meta = await metaOf(env, key);
  if (!meta) {
    return new Response('Not Found', { status: 404 });
  }
  const audioBytes = meta.size - meta.dataStart;
  const duration = audioBytes * 8 / meta.bitrate;
  let t = Number(url.searchParams.get('t'));
  if (!Number.isFinite(t)) t = 0;
  t = ((t % duration) + duration) % duration;

  // octet visé, puis recalage sur le premier vrai début de trame qui suit
  // (au plus une trame plus loin, soit ~26 à 36 ms)
  let start = meta.dataStart + Math.min(audioBytes - 1, Math.floor(t * meta.bitrate / 8));
  const probe = await readBytes(env, key, start, Math.min(PROBE, meta.size - start));
  const at = probe ? findFrame(probe.bytes, meta) : -1;
  // aucune trame complète avant la fin du fichier : le flux repart du début
  start = at < 0 ? meta.dataStart : start + at;

  const headers = liveHeaders();
  // débug (curl) : octet et seconde réels du début du flux
  headers.set('X-Live-Offset', String(start));
  headers.set('X-Live-Start', ((start - meta.dataStart) * 8 / meta.bitrate).toFixed(3));
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }

  const object = await env.BUCKET.get(key, { range: { offset: start } });
  if (!object) {
    metas.delete(key);
    sizes.delete(key);
    return new Response('Not Found', { status: 404 });
  }
  // Le corps R2 a une longueur connue : renvoyé tel quel, le runtime
  // poserait un Content-Length. Passé par un flux identité, il part en
  // "chunked", sans longueur. IdentityTransformStream est le flux identité
  // NATIF du runtime : les octets vont de R2 au client sans repasser par le
  // JS (aucun CPU facturé par chunk — limite de 10 ms du plan gratuit).
  const Identity = typeof IdentityTransformStream === 'function'
    ? IdentityTransformStream : TransformStream;
  // Auditeur parti en cours de flux (le cas normal : chaque changement de
  // station) : l'abandon se propage au flux R2, la requête s'arrête là.
  return new Response(object.body.pipeThrough(new Identity()), { status: 200, headers });
};

export default {
  async fetch(request, env) {
    // Préflight CORS : le téléchargement hors ligne de l'app lit les stations
    // par chunks (fetch() avec un header Range, qui n'est pas "simple")
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD',
          'Access-Control-Allow-Headers': 'Range',
          'Access-Control-Max-Age': '86400'
        }
      });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);

    // Horloge de référence de l'app : tous les auditeurs calent la position
    // "live" des stations sur cette heure plutôt que sur celle de leur
    // appareil (qui peut être mal réglée). Millisecondes, contrairement à
    // l'en-tête Date (à la seconde). Dans un Worker, Date.now() vaut l'heure
    // d'arrivée de la requête : exactement ce qu'il faut ici.
    if (url.pathname === '/time') {
      return new Response(JSON.stringify({ now: Date.now() }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    let key;
    try {
      key = decodeURIComponent(url.pathname.slice(1));
    } catch (e) {
      // séquence %xx invalide : 400 plutôt qu'une exception (500)
      return new Response('Bad Request', { status: 400 });
    }

    // /live/radio/KEY.mp3 : même fichier, servi comme un flux en direct
    const live = key.startsWith('live/');
    if (live) key = key.slice(5);

    // Lecture seule, limitée aux fichiers radio
    if (!key.startsWith('radio/') || !key.endsWith('.mp3')) {
      return new Response('Not Found', { status: 404 });
    }

    // tout en-tête Range est ignoré sur cette route (réponse 200, sans longueur)
    if (live) return serveLive(request, env, key, url);

    const size = await sizeOf(env, key);
    if (size === null) {
      return new Response('Not Found', { status: 404 });
    }

    let start = 0;
    let end = size - 1;
    let partial = false;

    const rangeHeader = request.headers.get('range');
    if (rangeHeader) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (!m || (m[1] === '' && m[2] === '')) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': 'bytes */' + size }
        });
      }
      partial = true;
      if (m[1] === '') {
        // suffixe : les N derniers octets
        start = Math.max(0, size - Number(m[2]));
      } else {
        start = Number(m[1]);
        const cap = start === 0 ? HEAD_CHUNK : CHUNK;
        end = m[2] === ''
          ? Math.min(size - 1, start + cap - 1) // plage ouverte : bornée
          : Math.min(Number(m[2]), size - 1);
      }
      if (start >= size || start > end) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': 'bytes */' + size }
        });
      }
    }

    const object = await env.BUCKET.get(key, partial
      ? { range: { offset: start, length: end - start + 1 } }
      : undefined);
    if (!object) {
      sizes.delete(key);
      return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Access-Control-Allow-Origin', '*');
    // lisibles par fetch() (téléchargement hors ligne par chunks)
    headers.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    // Les fichiers radio ne changent jamais : cache navigateur agressif
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('Content-Length', String(end - start + 1));
    if (partial) {
      headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }

    // HEAD : corps vide (le flux R2 est annulé)
    if (request.method === 'HEAD' && object.body) {
      try { object.body.cancel(); } catch (e) {}
    }
    return new Response(request.method === 'HEAD' ? null : object.body, {
      status: partial ? 206 : 200,
      headers
    });
  }
};
