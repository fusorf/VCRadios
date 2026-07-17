// Serveur de dev avec support des requêtes Range, indispensable pour que les
// seeks dans les MP3 d'1h fonctionnent (python -m http.server et Live Server
// ne gèrent pas les Range : les seeks sont rognés et la lecture part
// n'importe où dans le fichier).
// Usage : node dev-server.js  →  http://localhost:8080
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 8080;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const size = stat.size;
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);

    if (range && (range[1] !== '' || range[2] !== '')) {
      const start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1]);
      const end = range[1] !== '' && range[2] !== ''
        ? Math.min(Number(range[2]), size - 1)
        : size - 1;

      if (start >= size || start > end) {
        res.writeHead(416, { 'Content-Range': 'bytes */' + size });
        res.end();
        return;
      }

      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
        'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes'
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': size,
        'Accept-Ranges': 'bytes'
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });
}).listen(PORT, () => {
  console.log('Vice City Radio → http://localhost:' + PORT);
});
