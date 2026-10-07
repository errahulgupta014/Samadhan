// Preview the one-page marketing site (site/) locally: node scripts/serve-site.mjs  → http://localhost:5180
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('site');
const types = {'.html': 'text/html; charset=utf-8', '.png': 'image/png', '.txt': 'text/plain', '.css': 'text/css', '.svg': 'image/svg+xml'};
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, '.' + rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end('Not found');
    return;
  }
  res.writeHead(200, {'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache'});
  fs.createReadStream(file).pipe(res);
}).listen(5180, () => console.log('Site preview: http://localhost:5180'));
