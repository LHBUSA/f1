// Homepage rail autoplay QA (real time). Per width: advance after ~6 s, manual next/prev/keys/swipe, 10 s manual
// cooldown, hover/focus/pointer/offscreen/hidden pauses, reduced motion = no autoplay, last->first wrap without a rewind
// sweep, progress sync, links, scrollbar, overflow, CLS, console errors.  --soak N : leave it running N full cycles.
//   node scripts/rail-auto-qa.mjs <base> [--widths 390,1440] [--soak 3]      (Git Bash: MSYS_NO_PATHCONV=1)
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const base = args[0];
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const widths = opt('widths', '390,768,1024,1280,1440,1920').split(',').map(Number);
const soak = Number(opt('soak', 0));
const EXPECT = ['mercedes', 'ferrari', 'mclaren', 'red-bull', 'racing-bulls', 'alpine', 'haas', 'audi', 'williams', 'aston-martin', 'cadillac'];
const b = await chromium.launch();
let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('   FAIL', msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(w, extra = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: w < 700 ? 844 : 1000 }, ...extra });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await pg.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  await pg.goto(base + '/', { waitUntil: 'networkidle' });
  await pg.evaluate(() => document.querySelector('.grid-rail').scrollIntoView({ block: 'center' }));
  await pg.mouse.move(2, 2); // pointer away from the rail
  await sleep(300);
  return { ctx, pg, errs };
}
const st = (pg) => pg.evaluate(() => ({ active: window.__rail?.active, timer: window.__rail?.timer, paused: window.__rail?.paused, idx: document.querySelector('[data-rail-idx]')?.textContent, seg: [...document.querySelectorAll('.rail-seg')].findIndex((s) => s.getAttribute('aria-current') === 'true'), snap: (() => { const r = document.querySelector('[data-rail]'); const a = r.querySelector('.rail-item.is-active'); return a ? Math.round(Math.abs(a.getBoundingClientRect().left - r.getBoundingClientRect().left - r.querySelector('.rail-item').offsetLeft)) : -1; })() }));
const synced = (s) => s.seg === s.active && Number(s.idx) === s.active + 1;

for (const w of widths) {
  console.log(`== ${w}`);
  const { ctx, pg, errs } = await open(w);
  let s = await st(pg);
  check(s.active === 0 && s.timer && !s.paused.length, `initial state ${JSON.stringify(s)}`);
  await sleep(6800); s = await st(pg);
  check(s.active === 1 && synced(s) && s.snap <= 2, `auto-advance after 6 s -> ${JSON.stringify(s)}`);
  // manual next: pauses ~10 s, no advance in that window, resumes afterwards
  await pg.evaluate(() => document.querySelector('[data-rail-next]').click()); await sleep(900);
  s = await st(pg); check(s.active === 2 && s.paused.includes('manual') && !s.timer, `manual next ${JSON.stringify(s)}`);
  await sleep(8000); s = await st(pg); check(s.active === 2, `advanced during manual cooldown ${JSON.stringify(s)}`);
  await sleep(8500); s = await st(pg); check(s.active === 3 && synced(s), `did not resume ~10 s after manual (then +6 s) ${JSON.stringify(s)}`);
  // manual prev + keyboard
  await pg.evaluate(() => document.querySelector('[data-rail-prev]').click()); await sleep(900);
  s = await st(pg); check(s.active === 2, `manual prev ${s.active}`);
  await pg.focus('[data-rail]'); await pg.keyboard.press('ArrowRight'); await sleep(900);
  s = await st(pg); check(s.active === 3 && s.paused.includes('focus'), `keyboard right / focus pause ${JSON.stringify(s)}`);
  await pg.evaluate(() => document.activeElement.blur()); await pg.mouse.move(2, 2);
  // swipe/trackpad (native scroll) counts as manual
  await pg.evaluate(() => { const r = document.querySelector('[data-rail]'); r.scrollBy({ left: r.querySelector('.rail-item').offsetWidth + 10 }); });
  await sleep(900); s = await st(pg); check(s.paused.includes('manual') && s.active === 4, `native scroll = manual ${JSON.stringify(s)}`);
  await sleep(10500); // let cooldown expire
  // hover pause (fine pointer only)
  if (w >= 768) {
    const box = await (await pg.$('[data-rail]')).boundingBox();
    await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await sleep(300);
    s = await st(pg); const before = s.active; check(s.paused.includes('hover') && !s.timer, `hover pause ${JSON.stringify(s)}`);
    await sleep(7000); s = await st(pg); check(s.active === before, 'advanced while hovered');
    await pg.mouse.move(2, 2); await sleep(300);
  }
  // pointer down pause
  await pg.dispatchEvent('[data-rail]', 'pointerdown', { pointerType: 'touch', button: 0 }); await sleep(200);
  s = await st(pg); check(s.paused.includes('pointer'), `pointer-down pause ${JSON.stringify(s.paused)}`);
  await pg.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch' }))); await sleep(200);
  // hidden tab pause
  await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  s = await st(pg); check(s.paused.includes('hidden') && !s.timer, `hidden-tab pause ${JSON.stringify(s.paused)}`);
  await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  // offscreen pause
  await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sleep(500);
  s = await st(pg); check(s.paused.includes('offscreen') && !s.timer, `offscreen pause ${JSON.stringify(s.paused)}`);
  await pg.evaluate(() => document.querySelector('.grid-rail').scrollIntoView({ block: 'center' })); await sleep(500);
  // wrap last -> first: jump to the last car via its segment, then let autoplay wrap; sample scrollLeft during the wrap
  await pg.evaluate(() => document.querySelectorAll('.rail-seg')[10].click()); await sleep(900);
  await pg.evaluate(() => document.activeElement.blur()); await pg.mouse.move(2, 2);
  s = await st(pg); check(s.active === 10, `segment jump to last ${s.active}`);
  await sleep(10200); // manual cooldown
  const samples = await pg.evaluate(async () => { const r = document.querySelector('[data-rail]'); const out = []; const t0 = performance.now(); while (performance.now() - t0 < 7500) { out.push(r.scrollLeft); await new Promise((x) => requestAnimationFrame(x)); } return { out, max: r.scrollWidth - r.clientWidth }; });
  s = await st(pg);
  const mids = samples.out.filter((v) => v > 30 && v < samples.max - 30).length;
  check(s.active === 0 && synced(s), `wrap to first ${JSON.stringify(s)}`);
  check(mids === 0, `wrap swept through ${mids} intermediate scroll positions (rewind)`);
  // links + scrollbar + overflow + cls + errors
  const misc = await pg.evaluate(() => { const r = document.querySelector('[data-rail]'); return { links: [...r.querySelectorAll('.rail-card')].map((a) => a.getAttribute('href')), bar: r.offsetHeight - r.clientHeight > 0.5, overflow: document.documentElement.scrollWidth > innerWidth, cls: window.__cls }; });
  check(JSON.stringify(misc.links) === JSON.stringify(EXPECT.map((c) => `/teams/${c}`)), 'links');
  check(!misc.bar && !misc.overflow && misc.cls < 0.01, `bar/overflow/cls ${JSON.stringify(misc)}`);
  check(!errs.length, `console errors ${errs.slice(0, 2)}`);
  console.log(`   done ${w}: wrap mid-samples ${mids}, cls ${misc.cls.toFixed(4)}`);
  await ctx.close();
  // reduced motion: no autoplay
  const rm = await open(w, { reducedMotion: 'reduce' });
  await sleep(7500); s = await st(rm.pg);
  check(s.active === 0 && !s.timer, `reduced motion advanced ${JSON.stringify(s)}`);
  await rm.pg.evaluate(() => document.querySelector('[data-rail-next]').click()); await sleep(400);
  s = await st(rm.pg); check(s.active === 1, 'reduced motion manual next');
  await rm.ctx.close();
}

if (soak) {
  console.log(`== soak ${soak} cycles @1440`);
  const { ctx, pg, errs } = await open(1440);
  // sample at each SETTLE (scroll finished), not when the active card flips mid-animation
  const changes = await pg.evaluate(async (n) => {
    const out = []; let seen = window.__rail.settles, lastA = window.__rail.active, lastT = window.__rail.settledAt || performance.now();
    const end = performance.now() + n * 11 * 6700 + 3000;
    while (performance.now() < end) {
      await new Promise((r) => setTimeout(r, 50));
      if (window.__rail.settles !== seen) {
        seen = window.__rail.settles;
        const r = document.querySelector('[data-rail]'); const it = r.querySelector('.rail-item.is-active');
        const a = window.__rail.active, t = window.__rail.settledAt;
        out.push({ from: lastA, to: a, dt: Math.round(t - lastT), snap: Math.round(Math.abs(it.getBoundingClientRect().left - r.getBoundingClientRect().left - r.querySelector('.rail-item').offsetLeft)) });
        lastA = a; lastT = t;
      }
    }
    return out;
  }, soak);
  const skips = changes.filter((c) => c.to !== (c.from + 1) % 11);
  const dts = changes.map((c) => c.dt);
  const snaps = Math.max(...changes.map((c) => c.snap));
  check(changes.length >= soak * 11 - 1, `soak: only ${changes.length} advances`);
  check(!skips.length, `soak: skipped/out-of-order ${JSON.stringify(skips.slice(0, 3))}`);
  check(Math.min(...dts) > 5000 && Math.max(...dts) < 7500, `soak: interval drift ${Math.min(...dts)}..${Math.max(...dts)} ms`);
  check(snaps <= 2, `soak: snap misalignment ${snaps}px`);
  check(!errs.length, 'soak console errors');
  console.log(`   soak: ${changes.length} advances, interval ${Math.min(...dts)}-${Math.max(...dts)} ms, max snap offset ${snaps}px, skips ${skips.length}`);
  await ctx.close();
}
await b.close();
console.log(fail ? `RAIL AUTOPLAY QA FAIL (${fail})` : 'RAIL AUTOPLAY QA PASS');
process.exit(fail ? 1 : 0);
