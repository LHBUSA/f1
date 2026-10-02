// Team-mark QA: every current team page shows a loaded hero mark + car-label mark at 390/768/1024/1440, no broken
// images anywhere on the page, no fallback badges, no horizontal overflow; standings + teams index marks load too.
// Also records every logo network response status.  node scripts/logo-qa.mjs <base> [screenshot dir]
import { chromium } from 'playwright';
import fs from 'node:fs';

const [base, out] = process.argv.slice(2);
const teams = Object.keys(JSON.parse(fs.readFileSync('src/identity/teams-2026.json', 'utf8')).teams);
const order = ['ferrari', ...teams.filter((t) => t !== 'ferrari')];
const b = await chromium.launch();
let fail = 0;
const statuses = {};
for (const path of [...order.map((t) => `/teams/${t}`), '/standings', '/teams']) for (const w of [390, 768, 1024, 1440]) {
  const pg = await b.newPage({ viewport: { width: w, height: 900 } });
  pg.on('response', (r) => { if (r.url().includes('/media/logos/')) statuses[r.url().split('/').pop()] = r.status(); });
  await pg.goto(base + path, { waitUntil: 'networkidle' });
  const r = await pg.evaluate(() => {
    const marks = [...document.querySelectorAll('.tmark img')];
    const broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('loading') !== 'lazy').map((i) => i.src.split('/').pop());
    const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}`; };
    return { marks: marks.length, unloaded: marks.filter((i) => !(i.complete && i.naturalWidth > 0)).length, broken, fallbacks: document.querySelectorAll('.tmark-code').length, hero: box('.hero-mark img'), car: box('.car-mark img'), overflow: document.documentElement.scrollWidth > innerWidth };
  });
  const isTeam = path.startsWith('/teams/');
  const bad = r.unloaded || r.broken.length || r.fallbacks || r.overflow || !r.marks || (isTeam && (!r.hero || !r.car));
  if (bad) fail++;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${w} ${path} ${JSON.stringify(r)}`);
  if (out && isTeam && (w === 390 || w === 1440)) await pg.screenshot({ path: `${out}/${w}_${path.split('/').pop()}.png`, clip: { x: 0, y: 0, width: w, height: w < 700 ? 760 : 420 } });
  await pg.close();
}
await b.close();
console.log('logo responses', JSON.stringify(statuses));
const non200 = Object.entries(statuses).filter(([, s]) => s !== 200 && s !== 304);
console.log(fail || non200.length ? `LOGO QA FAIL (${fail} pages, ${non200.length} non-200)` : `LOGO QA PASS (${Object.keys(statuses).length} logo files, all 200)`);
process.exit(fail || non200.length ? 1 : 0);
