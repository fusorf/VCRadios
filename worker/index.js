// Worker proxy R2 pour les radios de VCRadios.
// Raison d'être : l'URL publique de dev (pub-*.r2.dev) est rate-limitée par
// Cloudflare et laisse tomber des requêtes de façon aléatoire ; ce Worker sert
// le bucket sans cette limite, avec support Range complet (seeks audio).
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

    // R2 parse lui-même l'en-tête Range transmis. Pas de onlyIf : inutile
    // avec un cache immutable, et source de réponses erratiques.
    const object = await env.BUCKET.get(key, { range: request.headers });

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

    if (object.range) {
      const offset = object.range.offset !== undefined ? object.range.offset : 0;
      const length = object.range.length !== undefined
        ? object.range.length
        : object.size - offset;
      headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set('Content-Length', String(length));
    } else {
      headers.set('Content-Length', String(object.size));
    }

    const status = object.range && request.headers.has('range') ? 206 : 200;
    return new Response(request.method === 'HEAD' ? null : object.body, { status, headers });
  }
};
