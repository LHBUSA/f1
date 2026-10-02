// Publish data/projection to the F1 data plane via the PropSports contract (two-phase: files, then activate).
// Runs in the PRODUCTION Vercel build only (VERCEL_ENV=production) or explicitly with --force.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BASE = process.env.PROPSPORTS_F1_BASE || 'https://propsports.proptechusa.ai/v1/f1';
const TOKEN = process.env.F1_PUBLISH_TOKEN;
const force = process.argv.includes('--force');
if (!force && process.env.VERCEL_ENV !== 'production') {
  console.log(`publish-projection: skipped (VERCEL_ENV=${process.env.VERCEL_ENV || 'local'})`);
  process.exit(0);
}
if (!TOKEN) {
  console.error('publish-projection: F1_PUBLISH_TOKEN missing');
  process.exit(1);
}
const DIR = path.resolve('data/projection');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const names = [...manifest.files, 'internal'];
let i = 0;
const failures = [];
await Promise.all(Array.from({ length: 6 }, async () => {
  while (i < names.length) {
    const n = names[i++];
    const body = zlib.gzipSync(fs.readFileSync(path.join(DIR, `${n}.json`)), { level: 9 });
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await fetch(`${BASE}/admin/projection/${manifest.version}/${n}`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/octet-stream' }, body }).catch((e) => ({ ok: false, status: String(e) }));
      if (r.ok) break;
      if (attempt === 3) failures.push(`${n}: ${r.status}`);
    }
  }
}));
if (failures.length) {
  console.error('publish-projection FAILED:\n' + failures.join('\n'));
  process.exit(1);
}
const act = await (await fetch(`${BASE}/admin/projection/${manifest.version}/activate`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(manifest) })).json();
if (!act.ok) {
  console.error('publish-projection: activation refused', JSON.stringify(act));
  process.exit(1);
}
console.log(`publish-projection: ${names.length} documents, active version ${act.version}`);
