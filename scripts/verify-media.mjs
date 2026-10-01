// HEAD-check every headshot/flag URL the site would render; broken ones are dropped at render time.
import fs from 'node:fs';
const drivers = JSON.parse(fs.readFileSync('data/normalized/drivers.json', 'utf8'));
const careers = JSON.parse(fs.readFileSync('data/derived/careers.json', 'utf8'));
const urls = new Set();
for (const d of drivers) {
  if (!careers[d.id]?.entries) continue;
  if (d.headshot_url) urls.add(d.headshot_url);
  if (d.flag_url) urls.add(d.flag_url);
}
const out = {};
const list = [...urls];
let i = 0;
await Promise.all(Array.from({ length: 12 }, async () => {
  while (i < list.length) {
    const u = list[i++];
    try {
      const r = await fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
      out[u] = r.ok && (r.headers.get('content-type') || '').startsWith('image/');
    } catch { out[u] = false; }
  }
}));
fs.writeFileSync('data/derived/media.json', JSON.stringify(out));
const bad = Object.values(out).filter((v) => !v).length;
console.log(`verify-media: ${list.length} urls, ${bad} unavailable (rendered as initials / omitted)`);
