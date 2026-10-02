// PBEcast visual QA with a SYNTHETIC local fixture (never published): the real recorded frame's drivers, with
// fabricated-for-testing lap crossings (a bunched pack, a slow car, a recording gap) routed into the local page.
// Checks markers, bunching, focus card, tower, replay controls at 390/768/1024/1440. Entitlement is mocked LOCALLY
// to render the All Access layout; real entitlement is proven separately against production.
//   node scripts/pbecast-visual-qa.mjs <base> <out dir>      (Git Bash: MSYS_NO_PATHCONV=1)
import fs from 'node:fs';
import { chromium } from 'playwright';
import { normalizeFrames } from '../workers/f1-api/src/frames.js';

const [base, out] = process.argv.slice(2);
const TOKEN = fs.readFileSync('D:/Workers/secrets/f1-admin-token', 'utf8').trim();
const API = 'https://f1-api.propbetedge.ai/v1/f1/admin/observations';
const get = async (q) => (await fetch(API + q, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
const internal = JSON.parse(fs.readFileSync('data/projection/internal.json', 'utf8'));
const raw = (await get('?session=401901647&chunk=1')).frames;
const seed = normalizeFrames(raw, internal, { full: true })[0];
const ids = seed.cars.map((c) => c.id);

// synthetic: 8 laps, lap ~96 s, cars 0-3 bunched within 0.8 s, car 7 slow, recording gap 90 s on lap 5
const t0 = Date.parse('2026-10-03T07:00:00Z'), LAP = 96000, frames = [];
const offs = ids.map((_, i) => (i < 4 ? i * 250 : 1500 + i * 900 + (i === 7 ? 0 : 0)));
for (let t = t0; t <= t0 + 8.2 * LAP; t += 10000) {
  if (t > t0 + 4.3 * LAP && t < t0 + 4.3 * LAP + 90000) continue; // recording gap
  const cars = ids.map((id, i) => { const lapLen = LAP + (i === 7 ? 2500 : i * 40); const done = Math.max(0, Math.floor((t - t0 - offs[i]) / lapLen)); return { id, laps: done, status: 'running', gap_ms: offs[i] + done * (lapLen - LAP), pits: 0, best_ms: lapLen - 300 }; });
  cars.sort((a, b) => b.laps - a.laps || a.gap_ms - b.gap_ms).forEach((c, k) => { c.pos = k + 1; });
  frames.push({ t: new Date(t).toISOString(), lap: Math.max(...cars.map((c) => c.laps)) + 1, flag: 'GREEN', cars });
}
const SID = '2026-bahrain-grand-prix-in-malaysia-qa-fixture';
const payload = { session_id: SID, meta: { type: 'race', laps_total: 56 }, coverage: { frames: frames.length, longest_silence_s: 100, silences_over_60s: 1 }, frames, events: [] };

const b = await chromium.launch();
const report = [];
for (const [w, h] of [[390, 844], [768, 1000], [1024, 900], [1440, 900]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  await ctx.route('**/pbe/f1/membership', (r) => r.fulfill({ json: { membership: { state: 'all_access', entitled: true, sport: 'f1' }, signed_in: true, verification: 'local_visual_qa' } }));
  await ctx.route('**/v1/f1/replay', (r) => r.fulfill({ json: { sessions: [{ id: SID, event_id: '2026-bahrain-grand-prix-in-malaysia', type: 'race', frames: frames.length }] } }));
  await ctx.route(`**/pbe/f1/replay/${SID}`, (r) => r.fulfill({ json: payload }));
  await ctx.route('**/v1/f1/live', (r) => r.fulfill({ json: { state: 'idle' } }));
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => m.type() === 'error' && !/favicon|ERR_/.test(m.text()) && errs.push(m.text()));
  const sel = (await import('node:fs')).existsSync ? 'VER' : '';
  const at = new Date(t0 + 2.6 * LAP).toISOString();
  await pg.goto(`${base}/pbecast/2026-bahrain-grand-prix-in-malaysia?session=${SID}&t=${encodeURIComponent(at)}&driver=${encodeURIComponent(internal ? '' : '')}`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1500);
  // select the leader by clicking its tower row
  await pg.click('.pc-row >> nth=0');
  await pg.waitForTimeout(1200);
  const r = await pg.evaluate(() => ({ cars: window.__pbecast?.cars?.length, focus: !document.querySelector('[data-pc-driver]').hidden && document.querySelectorAll('.pc-fs').length, rows: document.querySelectorAll('.pc-row').length, mv: document.querySelectorAll('.pc-mv.up,.pc-mv.down').length, selectedRow: document.querySelector('.pc-row[aria-pressed=true]')?.dataset.code, overflow: document.documentElement.scrollWidth > innerWidth, lapnav: !!document.querySelector('[data-pc-lapnext]') }));
  // replay controls: next lap moves time forward
  const before = await pg.evaluate(() => window.__pbecast?.T);
  await pg.click('[data-pc-lapnext]'); await pg.waitForTimeout(400);
  r.lapNextAdvances = (await pg.evaluate(() => window.__pbecast?.T)) > before;
  r.errors = errs;
  report.push({ w, ...r });
  await pg.screenshot({ path: `${out}/pbecast-${w}.png`, fullPage: false });
  const trk = await pg.$('.pc-track'); if (trk) await trk.screenshot({ path: `${out}/pbecast-track-${w}.png` });
  await ctx.close();
}
await b.close();
for (const r of report) console.log(JSON.stringify(r));
const bad = report.filter((r) => !r.cars || !r.focus || r.overflow || r.errors.length || !r.lapNextAdvances || !r.selectedRow);
console.log(bad.length ? `PBECAST VISUAL QA FAIL (${bad.map((r) => r.w)})` : 'PBECAST VISUAL QA PASS');
