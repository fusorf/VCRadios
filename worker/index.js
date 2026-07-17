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

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.slice(1));

    // Lecture seule, limitée aux fichiers radio
    if (!key.startsWith('radio/') || !key.endsWith('.mp3')) {
      return new Response('Not Found', { status: 404 });
    }

    const head = await env.BUCKET.head(key);
    if (!head) {
      return new Response('Not Found', { status: 404 });
    }
    const size = head.size;

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
        end = m[2] === ''
          ? Math.min(size - 1, start + CHUNK - 1) // plage ouverte : bornée
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
      return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Access-Control-Allow-Origin', '*');
    // Les fichiers radio ne changent jamais : cache navigateur agressif
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('Content-Length', String(end - start + 1));
    if (partial) {
      headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }

    return new Response(request.method === 'HEAD' ? null : object.body, {
      status: partial ? 206 : 200,
      headers
    });
  }
};
