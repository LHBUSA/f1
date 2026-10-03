// PBEcast V4 canary over REAL recorded sessions (FP3 + Qualifying), against any base (local build or production).
// The page receives the real recorded frames; entitlement is mocked in the browser only so the All Access replay
// renders (real entitlement is server-side and unchanged). One navigation per session x viewport; instants are
// reached with the replay scrubber. Stops at the first HTTP 403 (Vercel checkpoint) instead of retrying.
//   node scripts/pbecast-v4-real-qa.mjs [base] [out]
// Proves: replay context (REPLAY · <session> · RECORDED TIMING, never "No session live"), session switch has no stale
// time, cars equal the f1-progress@1 model (ids, fractions, held), after lap 1 unplaceable cars are counted in the HUD
// and never queued at the line, recording gaps hold cars (no movement inside a gap), on_track rows render as running,
// label layout clean (incl. START/FINISH + PIT text), map <-> tower selection, CLS, console errors.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { normalizeFrames, sessionPublicId, coverage } from '../workers/f1-api/src/frames.js';
import { buildModel, progressAt, frameAt, inGap } from '../src/core/progress.mjs';

const base = process.argv[2] || 'http://127.0.0.1:4173';
const out = process.argv[3] || `reports/pbecast-v4/real-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.mkdirSync(out, { recursive: true });
const EV = '2026-bahrain-grand-prix-in-malaysia';
const TOKEN = fs.readFileSync('D:/Workers/secrets/f1-admin-token', 'utf8').trim();
const API = 'https://f1-api.propbetedge.ai/v1/f1/admin/observations';
const admin = async (q) => { const r = await fetch(API + q, { headers: { authorization: `Bearer ${TOKEN}` } }); if (!r.ok) throw new Error(`admin ${q} ${r.status}`); return r.json(); };
const internal = JSON.parse(fs.readFileSync('data/projection/internal.json', 'utf8'));
const WANT = { [`${EV}-fp3`]: 'Practice 3', [`${EV}-qualifying`]: 'Qualifying' };
const S = {};
for (const u of (await admin('')).sessions.map((p) => p.match(/espn-(\d+)\//)?.[1]).filter(Boolean)) {
  const idx = await admin(`?session=${u}`), id = sessionPublicId(idx.meta, internal);
  if (!WANT[id]) continue;
  const raw = []; for (let i = 1; i <= idx.chunks; i++) raw.push(...(await admin(`?session=${u}&chunk=${i}`)).frames);
  const frames = normalizeFrames(raw, internal, { full: true });
  S[id] = { frames, cov: coverage(raw), model: buildModel(frames), type: id.split('-').pop() };
}
if (Object.keys(S).length !== 2) throw new Error(`expected FP3 + Qualifying recordings, got ${Object.keys(S)}`);

const hit = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
function audit(L) {
  const e = [];
  const rc = (r, c) => Math.hypot(Math.max(r.x, Math.min(c.x, r.x + r.w)) - c.x, Math.max(r.y, Math.min(c.y, r.y + r.h)) - c.y) < c.r - 1;
  const ids = new Set(L.labels.map((l) => l.id));
  for (const c of L.cars) if (!ids.has(c.id)) e.push(`no label ${c.code}`);
  for (const l of L.labels) {
    if (l.forced) e.push(`forced ${l.id}`);
    if (l.x < 0 || l.y < 0 || l.x + l.w > L.w || l.y + l.h > L.h) e.push(`off-canvas ${l.id}`);
    for (const b of L.blocks) if (hit(l, b)) e.push(`over overlay/map text ${l.id}`);
    for (const c of L.cars) if (rc(l, c)) e.push(`covers car ${l.id}/${c.code}`);
  }
  for (let i = 0; i < L.labels.length; i++) for (let j = i + 1; j < L.labels.length; j++) if (hit(L.labels[i], L.labels[j])) e.push('labels overlap');
  const seg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], k = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p.x - a[0] - k * dx, p.y - a[1] - k * dy); };
  for (const c of L.cars) { let d = Infinity; for (let i = 0; i < L.track.length; i++) d = Math.min(d, seg(c, L.track[i], L.track[(i + 1) % L.track.length])); if (d > 1.5) e.push(`off centreline ${c.code}`); }
  return e;
}
// what the page must draw at T, computed independently from the model
function expected(m, T) {
  const f = frameAt(m, T), opening = f.lap <= 1 || !f.lap, cars = [], off = [];
  for (const c of f.cars) {
    if (!c.id) continue;
    const p = progressAt(m, c.id, T);
    if (!p || p.state === 'out') continue;
    if (p.state === 'unplaced') { (opening ? cars : off).push(opening ? { id: c.id, grid: true } : c.id); continue; }
    cars.push({ id: c.id, frac: Math.round(p.laps * 1e6) / 1e6, held: p.state === 'held' });
  }
  return { opening, cars, off, gap: inGap(m, T), onTrack: f.cars.filter((c) => c.status === 'on_track').length };
}

const b = await chromium.launch();
const rep = []; let fail = 0, blocked = false;
const mk = async (w, h) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  await ctx.route('**/pbe/f1/membership', (r) => r.fulfill({ json: { membership: { state: 'all_access', entitled: true, sport: 'f1' }, signed_in: true, verification: 'canary_render_check' } }));
  await ctx.route('**/v1/f1/replay', (r) => r.fulfill({ json: { sessions: Object.entries(S).map(([id, s]) => ({ id, event_id: EV, type: s.type, frames: s.frames.length })) } }));
  for (const [id, s] of Object.entries(S)) await ctx.route(`**/pbe/f1/replay/${id}`, (r) => r.fulfill({ json: { session_id: id, meta: { type: s.type }, coverage: s.cov, frames: s.frames, events: [] } }));
  await ctx.route('**/v1/f1/live', (r) => r.fulfill({ json: { state: 'idle' } }));
  return ctx;
};
outer:
for (const [w, h] of [[390, 844], [768, 1000], [1024, 900], [1440, 900], [1920, 1080]]) {
  for (const [id, s] of Object.entries(S)) {
    const ctx = await mk(w, h), pg = await ctx.newPage(), errors = [];
    pg.on('pageerror', (e) => errors.push(String(e))); pg.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
    const resp = await pg.goto(`${base}/pbecast/${EV}?session=${id}&t=${encodeURIComponent(new Date(s.model.start).toISOString())}`, { waitUntil: 'networkidle' });
    if (resp.status() === 403) { blocked = true; console.log(`BLOCKED 403 at ${w} ${id} — stopping (no retries)`); await ctx.close(); break outer; }
    await pg.waitForFunction(() => window.__pbecast?.mode === 'replay' && window.__pbecast.layout, null, { timeout: 20000 });
    const m = s.model, r = { w, session: id, errors, instants: [] };
    // instants: 8 evenly spaced scrub positions + the middle of every recording gap
    const pos = [20, 140, 260, 380, 500, 620, 740, 900];
    for (const g of m.gaps) pos.push(Math.round((1000 * ((g.from + g.to) / 2 - m.start)) / (m.end - m.start)));
    for (const v of pos) {
      await pg.$eval('[data-pc-scrub]', (e, val) => { e.value = String(val); e.dispatchEvent(new Event('input', { bubbles: true })); }, v);
      await pg.waitForTimeout(350);
      const st = await pg.evaluate(() => ({ P: window.__pbecast, note: document.querySelector('[data-pc-towernote]').textContent, hud: document.querySelector('[data-pc-hud]').textContent, hudOn: !document.querySelector('[data-pc-hud]').hidden, rows: [...document.querySelectorAll('.pc-row')].map((x) => ({ code: x.dataset.code, out: x.classList.contains('is-out'), status: x.querySelector('.pc-status')?.textContent })), body: document.body.innerText }));
      const T = st.P.T, x = expected(m, T), e = [];
      const got = st.P.cars.map((c) => (c.grid ? { id: c.id, grid: true } : { id: c.id, frac: c.frac, held: c.held }));
      const want = [...x.cars].sort((a, b2) => a.id.localeCompare(b2.id));
      if (JSON.stringify(got) !== JSON.stringify(want)) e.push('cars differ from f1-progress@1');
      if (!x.opening && got.some((c) => c.grid)) e.push('queued car at the line after lap 1');
      if (JSON.stringify([...st.P.offTrack].sort()) !== JSON.stringify([...x.off].sort())) e.push('HUD off-track set differs');
      if (x.off.length && !new RegExp(`${x.off.length} not on track`, 'i').test(st.hud)) e.push('HUD missing off-track count');
      if (!new RegExp(`^Replay · ${WANT[id]} · Recorded timing`, 'i').test(st.note)) e.push(`tower context "${st.note}"`);
      if (/No session live/i.test(st.body)) e.push('"No session live" on page');
      if (!st.hudOn || !new RegExp(`^REPLAY · ${WANT[id]}`, 'i').test(st.hud.trim())) e.push(`HUD "${st.hud}"`);
      if (x.gap && !/Recording gap/i.test(st.hud)) e.push('gap not shown');
      if (st.rows.some((rw) => /ON_TRACK/i.test(rw.status || ''))) e.push('ON_TRACK shown as status');
      const otIds = new Set(frameAt(m, T).cars.filter((c) => c.status === 'on_track').map((c) => c.id));
      const otCodes = new Set(st.P.layout.cars.filter((c) => otIds.has(c.id)).map((c) => c.code));
      if (st.rows.some((rw) => otCodes.has(rw.code) && rw.out)) e.push('on_track row dimmed as out');
      e.push(...audit(st.P.layout));
      // inside a gap, nothing moves: re-sample 1 scrub step later in the same gap
      if (x.gap) {
        const g = m.gaps.find((gg) => T > gg.from && T < gg.to), T2 = Math.min(g.to - 1000, T + (m.end - m.start) / 1000);
        if (T2 > T) { const x2 = expected(m, T2); if (JSON.stringify(x2.cars) !== JSON.stringify(x.cars)) e.push('model moved inside a gap'); }
      }
      r.instants.push({ v, T: new Date(T).toISOString(), lap: frameAt(m, T).lap, cars: got.length, off: x.off.length, gap: x.gap, onTrack: x.onTrack, blocks: st.P.layout.blocks.length, errors: [...new Set(e)] });
    }
    await pg.$eval('[data-pc-scrub]', (e) => { e.value = '500'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await pg.waitForTimeout(400);
    // selection: tower row -> map, map car -> tower row
    const rc = await pg.locator('.pc-row').nth(1).getAttribute('data-code');
    await pg.locator('.pc-row').nth(1).click(); await pg.waitForTimeout(300);
    r.towerToMap = await pg.evaluate((c) => window.__pbecast.selected === c && (window.__pbecast.layout.cars.some((x) => x.code === c && x.sel) || !window.__pbecast.layout.cars.some((x) => x.code === c)), rc);
    await pg.locator('.pc-track').scrollIntoViewIfNeeded();
    const tgt = await pg.evaluate((c) => window.__pbecast.layout.cars.find((x) => x.code !== c && !x.compact), rc);
    if (tgt) { const bx = await pg.locator('[data-pc-canvas]').boundingBox(); await pg.mouse.click(bx.x + tgt.x, bx.y + tgt.y); await pg.waitForTimeout(300); r.mapToTower = await pg.evaluate((c) => document.querySelector(`.pc-row[data-code="${c}"]`)?.getAttribute('aria-pressed') === 'true', tgt.code); }
    await pg.screenshot({ path: path.join(out, `${id.split('-').pop()}-${w}.png`) });
    // session switch: no stale time carried across sessions
    const other = Object.keys(S).find((k) => k !== id);
    await pg.selectOption('[data-pc-sessions]', other); await pg.waitForTimeout(1500);
    const sw = await pg.evaluate(() => ({ T: window.__pbecast.T, s: window.__pbecast.session, note: document.querySelector('[data-pc-towernote]').textContent }));
    r.switchOk = sw.s === other && sw.T === S[other].model.start && new RegExp(`^Replay · ${WANT[other]}`, 'i').test(sw.note);
    r.cls = Math.round((await pg.evaluate(() => window.__cls)) * 1000) / 1000;
    const bad = r.instants.some((i) => i.errors.length) || errors.length || !r.towerToMap || r.mapToTower === false || !r.switchOk || r.cls >= 0.1;
    r.pass = !bad; if (bad) fail++;
    rep.push(r);
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${w} ${id.split('-').pop()} instants=${r.instants.length} gaps=${r.instants.filter((i) => i.gap).length} maxOff=${Math.max(...r.instants.map((i) => i.off))} onTrackRows=${Math.max(...r.instants.map((i) => i.onTrack))} switch=${r.switchOk} sel=${r.towerToMap}/${r.mapToTower} cls=${r.cls}${r.instants.filter((i) => i.errors.length).map((i) => ` [${i.v}: ${i.errors.slice(0, 3).join('; ')}]`).join('')}${errors.length ? ` errors=${JSON.stringify(errors.slice(0, 3))}` : ''}`);
    await ctx.close();
  }
}
// mobile selected-driver card opening (CLS)
if (!blocked) {
  const ctx = await mk(390, 844), pg = await ctx.newPage(), id = Object.keys(S)[1];
  await pg.goto(`${base}/pbecast/${EV}?session=${id}&driver=${S[id].frames[0].cars[0] ? 'VER' : ''}`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(2000);
  const cls = Math.round((await pg.evaluate(() => window.__cls)) * 1000) / 1000;
  console.log(`${cls < 0.1 ? 'PASS' : 'FAIL'} 390 selected-driver card open cls=${cls}`); if (cls >= 0.1) fail++;
  await ctx.close();
}
await b.close();
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ generated_at: new Date().toISOString(), base, blocked, results: rep, pass: !fail && !blocked }, null, 2));
console.log(`${blocked ? 'REAL QA BLOCKED' : fail ? 'REAL QA FAIL' : 'REAL QA PASS'} (${rep.length - fail}/${rep.length}) -> ${out}`);
process.exit(fail || blocked ? 1 : 0);
