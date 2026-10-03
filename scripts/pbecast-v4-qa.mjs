// PBEcast Track V4 visual regression with SYNTHETIC local fixtures (never published). Drivers come from the built page's
// own identity registry; lap crossings are fabricated-for-testing at the real 10 s recording cadence. Entitlement is
// mocked LOCALLY to render the All Access replay; real entitlement is proven separately against production.
//   node scripts/pbecast-v4-qa.mjs [base=http://127.0.0.1:4173] [out=reports/pbecast-v4/<stamp>]
// Fixtures: 22 cars on the timing line, 10-car mid-lap pack, selected driver inside the pack, held cars in a recording
// gap, replay scrub jump; at 390 / 768 / 1024 / 1440. Fails on: overlapping labels, labels off-canvas or over overlays,
// a label covering a car, a car without a label, a car off the track centreline (lateral offset), CLS >= 0.1, wrong
// replay tower context, broken track <-> tower selection/hover sync, horizontal page overflow, page errors.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:4173';
const out = process.argv[3] || `reports/pbecast-v4/${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.mkdirSync(out, { recursive: true });
const EV = '2026-bahrain-grand-prix-in-malaysia';
const html = fs.readFileSync(`dist/pbecast/${EV}.html`, 'utf8');
const D = JSON.parse(html.match(/<script type="application\/json" id="pbecast-data">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<'));
const ids = Object.keys(D.identity.drivers).filter((id) => D.identity.drivers[id].team).slice(0, 22);
if (ids.length < 20) throw new Error(`need 20+ drivers in the identity registry, got ${ids.length}`);
const code = (id) => D.identity.drivers[id].code;

const t0 = Date.parse('2026-10-03T07:00:00Z'), LAP = 92000;
function session(offs, { gapFrom, gapMs = 90000, laps = 6 } = {}) {
  const frames = [];
  for (let t = t0; t <= t0 + (laps + 0.3) * LAP; t += 10000) {
    if (gapFrom && t > gapFrom && t < gapFrom + gapMs) continue;
    const cars = ids.map((id, i) => { const lapLen = LAP + i * 25; const done = Math.max(0, Math.floor((t - t0 - offs[i]) / lapLen)); return { id, laps: done, status: 'running', gap_ms: offs[i] + done * (lapLen - LAP), pits: 0, best_ms: lapLen - 400 }; });
    cars.sort((a, b) => b.laps - a.laps || a.gap_ms - b.gap_ms).forEach((c, k) => { c.pos = k + 1; });
    frames.push({ t: new Date(t).toISOString(), lap: Math.max(...cars.map((c) => c.laps)) + 1, flag: 'GREEN', cars });
  }
  return frames;
}
const SESS = {
  [`${EV}-qa-line`]: session(ids.map((_, i) => i * 180)),                                              // 22 cars within 4 s
  [`${EV}-qa-pack`]: session(ids.map((_, i) => (i < 10 ? i * 150 : 6000 + (i - 10) * 5200)), { gapFrom: t0 + 3.4 * LAP }), // 10-car pack + spread field + 90 s gap
};
const iso = (ms) => new Date(ms).toISOString();
const CASES = [
  { name: 'line-22', sid: `${EV}-qa-line`, T: t0 + 2 * LAP + 5000 },
  { name: 'pack-10-midlap', sid: `${EV}-qa-pack`, T: t0 + 2.5 * LAP },
  { name: 'selected-in-pack', sid: `${EV}-qa-pack`, T: t0 + 2.5 * LAP, driver: code(ids[5]) },
  { name: 'held-recording-gap', sid: `${EV}-qa-pack`, T: t0 + 3.4 * LAP + 45000 },
  { name: 'opening-lap-queue', sid: `${EV}-qa-line`, T: t0 + 20000 },
];

function audit(L) {
  const errs = [];
  if (!L) return ['no layout hook'];
  const hit = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
  const rc = (r, c) => Math.hypot(Math.max(r.x, Math.min(c.x, r.x + r.w)) - c.x, Math.max(r.y, Math.min(c.y, r.y + r.h)) - c.y) < c.r - 1;
  const byId = new Map(L.labels.map((l) => [l.id, l]));
  for (const c of L.cars) if (!byId.has(c.id)) errs.push(`car without label ${c.code}`);
  for (const l of L.labels) {
    if (l.forced) errs.push(`forced label ${l.id}`);
    if (l.x < 0 || l.y < 0 || l.x + l.w > L.w || l.y + l.h > L.h) errs.push(`label off-canvas ${l.id}`);
    for (const b of L.blocks) if (hit(l, b)) errs.push(`label over overlay ${l.id}`);
    for (const c of L.cars) if (rc(l, c)) errs.push(`label ${l.id} covers car ${c.code}`);
  }
  for (let i = 0; i < L.labels.length; i++) for (let j = i + 1; j < L.labels.length; j++) if (hit(L.labels[i], L.labels[j])) errs.push(`labels overlap ${L.labels[i].id}/${L.labels[j].id}`);
  // no lateral offset: every car sits on the projected track centreline
  const seg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], k = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p.x - a[0] - k * dx, p.y - a[1] - k * dy); };
  for (const c of L.cars) { let d = Infinity; for (let i = 0; i < L.track.length; i++) d = Math.min(d, seg(c, L.track[i], L.track[(i + 1) % L.track.length])); if (d > 1.5) errs.push(`car ${c.code} ${d.toFixed(1)}px off the centreline`); }
  return errs;
}

const b = await chromium.launch();
const results = [];
let fail = 0;
for (const [w, h] of [[390, 844], [768, 1000], [1024, 900], [1440, 900]]) {
  for (const cs of CASES) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
    await ctx.route('**/pbe/f1/membership', (r) => r.fulfill({ json: { membership: { state: 'all_access', entitled: true, sport: 'f1' }, signed_in: true, verification: 'local_visual_qa' } }));
    await ctx.route('**/v1/f1/replay', (r) => r.fulfill({ json: { sessions: Object.keys(SESS).map((id) => ({ id, event_id: EV, type: 'race', frames: SESS[id].length })) } }));
    for (const [sid, frames] of Object.entries(SESS)) await ctx.route(`**/pbe/f1/replay/${sid}`, (r) => r.fulfill({ json: { session_id: sid, meta: { type: 'race', laps_total: 56 }, coverage: { frames: frames.length, longest_silence_s: 100, silences_over_60s: 1 }, frames, events: [] } }));
    await ctx.route('**/v1/f1/live', (r) => r.fulfill({ json: { state: 'idle' } }));
    await ctx.route('**/v1/f1/incidents/**', (r) => r.fulfill({ json: { events: [] } }));
    const pg = await ctx.newPage();
    const errors = []; pg.on('pageerror', (e) => errors.push(String(e))); pg.on('console', (m) => m.type() === 'error' && !/favicon|ERR_|Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await pg.goto(`${base}/pbecast/${EV}?session=${cs.sid}&t=${encodeURIComponent(iso(cs.T))}${cs.driver ? `&driver=${cs.driver}` : ''}`, { waitUntil: 'networkidle' });
    await pg.waitForFunction(() => window.__pbecast?.mode === 'replay' && window.__pbecast.layout, null, { timeout: 15000 });
    await pg.waitForTimeout(1300);
    const r = { w, case: cs.name, errors };
    const st = await pg.evaluate(() => ({ L: window.__pbecast.layout, gap: window.__pbecast.gap, held: window.__pbecast.cars.filter((c) => c.held).length, sel: window.__pbecast.selected, note: document.querySelector('[data-pc-towernote]').textContent, hud: document.querySelector('[data-pc-hud]').hidden ? '' : document.querySelector('[data-pc-hud]').textContent, overflow: document.documentElement.scrollWidth > innerWidth, body: document.body.innerText }));
    r.cars = st.L.cars.length; r.labels = st.L.labels.length; r.compact = st.L.cars.filter((c) => c.compact).length; r.leaderLines = st.L.labels.filter((l) => l.leader).length;
    r.layoutErrors = audit(st.L);
    r.contextOk = /^REPLAY · Grand Prix · Recorded timing/i.test(st.note) && !/No session live/i.test(st.body);
    r.hudOk = /^REPLAY · Grand Prix · Lap \d+ · \d\d:\d\d/i.test(st.hud.trim());
    r.overflow = st.overflow;
    if (cs.name === 'held-recording-gap') r.gapShown = st.gap && st.held > 0 && /Recording gap/i.test(st.hud);
    if (cs.driver) { r.selectedInPack = st.sel === cs.driver && st.L.cars.find((c) => c.code === cs.driver)?.sel === true; }
    await pg.screenshot({ path: path.join(out, `${cs.name}-${w}.png`) });
    if (cs.name === 'pack-10-midlap') {
      // tower -> map: click the 3rd row
      const row = pg.locator('.pc-row').nth(2), rc = await row.getAttribute('data-code');
      await row.click(); await pg.waitForTimeout(250);
      r.towerToMap = await pg.evaluate((c) => window.__pbecast.selected === c && window.__pbecast.layout.cars.some((x) => x.code === c && x.sel), rc);
      // map -> tower: click a spread-field car (not in the pack, not selected)
      await pg.locator('.pc-track').scrollIntoViewIfNeeded();
      const target = await pg.evaluate((c) => { const L = window.__pbecast.layout; const t = L.cars.find((x) => !x.compact && !x.sel && x.code !== c); return t && { code: t.code, x: t.x, y: t.y }; }, rc);
      const box = await pg.locator('[data-pc-canvas]').boundingBox();
      if (target) {
        await pg.mouse.move(box.x + target.x, box.y + target.y); await pg.waitForTimeout(150);
        r.mapHoverToTower = await pg.evaluate((c) => document.querySelector(`.pc-row[data-code="${c}"]`)?.classList.contains('is-hover'), target.code);
        await pg.mouse.click(box.x + target.x, box.y + target.y); await pg.waitForTimeout(250);
        r.mapToTower = await pg.evaluate((c) => document.querySelector(`.pc-row[data-code="${c}"]`)?.getAttribute('aria-pressed') === 'true', target.code);
      }
      // tower hover -> map
      const hv = pg.locator('.pc-row').nth(6), hc = await hv.getAttribute('data-code');
      await hv.hover(); await pg.waitForTimeout(150);
      r.towerHoverToMap = await pg.evaluate((c) => window.__pbecast.hover === c && window.__pbecast.layout.cars.some((x) => x.code === c && x.hov), hc);
      await pg.mouse.move(1, 1);
      // scrub jump: selection persists and layout stays clean after the jump
      const selBefore = await pg.evaluate(() => window.__pbecast.selected);
      await pg.$eval('[data-pc-scrub]', (e) => { e.value = '820'; e.dispatchEvent(new Event('input', { bubbles: true })); });
      await pg.waitForTimeout(600);
      const after = await pg.evaluate(() => ({ L: window.__pbecast.layout, sel: window.__pbecast.selected }));
      r.scrubSelectionPersists = after.sel === selBefore && after.L.cars.some((c) => c.sel) === after.L.cars.some((c) => c.code === selBefore);
      r.scrubLayoutErrors = audit(after.L);
      await pg.screenshot({ path: path.join(out, `scrub-jump-${w}.png`) });
    }
    r.cls = Math.round((await pg.evaluate(() => window.__cls)) * 1000) / 1000;
    const bad = r.layoutErrors.length || (r.scrubLayoutErrors?.length) || !r.contextOk || !r.hudOk || r.overflow || r.cls >= 0.1 || errors.length || r.gapShown === false || r.selectedInPack === false || r.towerToMap === false || r.mapToTower === false || r.mapHoverToTower === false || r.towerHoverToMap === false || r.scrubSelectionPersists === false;
    r.pass = !bad; if (bad) fail++;
    results.push(r);
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${w} ${cs.name} cars=${r.cars} labels=${r.labels} compact=${r.compact} leaders=${r.leaderLines} cls=${r.cls}${r.layoutErrors.length ? ` layout=${JSON.stringify(r.layoutErrors.slice(0, 4))}` : ''}${r.scrubLayoutErrors?.length ? ` scrub=${JSON.stringify(r.scrubLayoutErrors.slice(0, 4))}` : ''}${!r.contextOk ? ' CONTEXT' : ''}${!r.hudOk ? ` HUD="${st.hud}"` : ''}${errors.length ? ` errors=${JSON.stringify(errors)}` : ''}${['towerToMap', 'mapToTower', 'mapHoverToTower', 'towerHoverToMap', 'scrubSelectionPersists', 'selectedInPack', 'gapShown'].filter((k) => r[k] === false).map((k) => ` ${k}=false`).join('')}`);
    await ctx.close();
  }
}
await b.close();
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ generated_at: new Date().toISOString(), base, results, pass: !fail }, null, 2));
console.log(`${fail ? 'V4 QA FAIL' : 'V4 QA PASS'} (${results.length - fail}/${results.length}) -> ${out}`);
process.exit(fail ? 1 : 0);
