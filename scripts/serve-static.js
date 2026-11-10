'use strict';
/** Minimal local server for the generated dist/ folder. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 8788;
const HOST = process.env.HOST || '127.0.0.1';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.gz': 'application/gzip',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('Chưa có dist/index.html. Chạy npm run build:static trước.');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Method not allowed');
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { pathname = '/'; }
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(`${ROOT}${path.sep}`) && filePath !== ROOT) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      const fallback = path.join(ROOT, 'index.html');
      fs.stat(fallback, (fallbackErr, fallbackStat) => {
        if (fallbackErr || !fallbackStat.isFile()) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          return res.end('Not found');
        }
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(fallback).pipe(res);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': ext === '.gz' ? 'public, max-age=3600' : 'no-cache',
      'x-content-type-options': 'nosniff'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Static build đang chạy tại http://${HOST}:${PORT}`);
});
