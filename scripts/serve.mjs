// Local static server mirroring Vercel cleanUrls + /api proxy (to F1_API, default production Worker).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(process.argv[2] || 'dist');
const PORT = Number(process.env.PORT || 4173);
const API = process.env.F1_API || 'https://f1-api.propbetedge.ai';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // same-origin premium proxy (mirrors the Vercel rewrite /pbe/f1/* -> PropSports /v1/f1/*), cookie forwarded
  if (url.pathname.startsWith('/pbe/f1/')) {
    try {
      const r = await fetch((process.env.F1_PRIV || 'https://propsports.proptechusa.ai') + url.pathname.replace(/^\/pbe\/f1/, '/v1/f1') + url.search, { headers: { cookie: req.headers.cookie || '' } });
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(502); res.end('{}'); }
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    try {
      const r = await fetch(API + url.pathname.replace(/^\/api/, '') + url.search);
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(502); res.end('{}'); }
    return;
  }
  let p = decodeURIComponent(url.pathname);
  const cands = p === '/' ? ['index.html'] : [p, p + '.html', path.join(p, 'index.html')];
  for (const c of cands) {
    const f = path.join(ROOT, c);
    if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404, { 'content-type': 'text/html' });
  fs.createReadStream(path.join(ROOT, '404.html')).pipe(res);
}).listen(PORT, () => console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}`));
