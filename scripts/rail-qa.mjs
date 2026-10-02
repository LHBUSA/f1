// Homepage car rail QA at 390/768/1024/1280/1440/1920: 11 real cars load (incl. lazy ones), correct /teams/:id links
// in championship order, no distortion, no visible scrollbar, scroll/keyboard/buttons work, snap centres a card,
// no page overflow, CLS ~0, hero stays LCP.   node scripts/rail-qa.mjs <base> <expected-order-csv> [shot dir]
import { chromium } from 'playwright';

const [base, expectCsv, out] = process.argv.slice(2);
const expected = expectCsv.split(',');
const b = await chromium.launch();
let fail = 0;
for (const w of [390, 768, 1024, 1280, 1440, 1920]) {
  const pg = await b.newPage({ viewport: { width: w, height: w < 700 ? 844 : 1000 } });
  await pg.addInitScript(() => { window.__cls = 0; window.__lcp = null; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = { t: Math.round(e.startTime), el: (e.element?.closest('.rail') ? 'RAIL:' : '') + (e.element?.tagName || '') + '.' + (e.element?.className || '').toString().slice(0, 30), url: (e.url || '').split('/').pop() }; }).observe({ type: 'largest-contentful-paint', buffered: true }); });
  const imgReq = new Set();
  pg.on('request', (r) => { if (r.url().includes('/media/cars/')) imgReq.add(r.url().split('/').pop()); });
  await pg.goto(base + '/', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(400);
  const lcp = await pg.evaluate(() => window.__lcp);
  const initialCarRequests = imgReq.size;
  const r0 = await pg.evaluate(() => {
    const rail = document.querySelector('[data-rail]');
    const items = [...rail.querySelectorAll('.rail-item')];
    const bar = rail.offsetHeight - rail.clientHeight > 0.5;
    const vis = items.filter((el) => { const b = el.getBoundingClientRect(); return b.right > 0 && b.left < innerWidth; }).length;
    return { n: items.length, links: items.map((el) => el.querySelector('a').getAttribute('href')), bar, vis, scrollable: rail.scrollWidth > rail.clientWidth, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  // keyboard + buttons + snap
  await pg.focus('[data-rail]');
  await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(900);
  const afterKey = await pg.evaluate(() => [...document.querySelectorAll('.rail-item')].findIndex((e) => e.classList.contains('is-active')));
  await pg.click('[data-rail-next]'); await pg.waitForTimeout(900);
  const afterBtn = await pg.evaluate(() => [...document.querySelectorAll('.rail-item')].findIndex((e) => e.classList.contains('is-active')));
  const snapOff = await pg.evaluate(() => { const rail = document.querySelector('[data-rail]'); const a = rail.querySelector('.rail-item.is-active').getBoundingClientRect(); const rb = rail.getBoundingClientRect(); const lead = rail.querySelector('.rail-item').offsetLeft; return Math.round(Math.abs(a.left - (rb.left + lead))); });
  // native horizontal scroll (touch/trackpad path) then load every lazy car by visiting the end
  await pg.evaluate(() => { const r = document.querySelector('[data-rail]'); r.scrollLeft = r.scrollWidth; });
  await pg.waitForTimeout(400);
  for (let i = 0; i < 11; i++) { await pg.evaluate((k) => { const r = document.querySelector('[data-rail]'); const it = r.querySelectorAll('.rail-item')[k]; r.scrollLeft = it.offsetLeft - r.querySelector('.rail-item').offsetLeft; }, i); await pg.waitForTimeout(150); }
  await pg.waitForTimeout(800);
  const imgs = await pg.evaluate(() => [...document.querySelectorAll('.rail-car img')].map((i) => { const b = i.getBoundingClientRect(); return { ok: i.complete && i.naturalWidth > 0, ratioErr: Math.abs(i.naturalWidth / i.naturalHeight - b.width / b.height) / (i.naturalWidth / i.naturalHeight) }; }));
  const cls = await pg.evaluate(() => window.__cls);
  const r = { w, n: r0.n, visible: r0.vis, linksOk: JSON.stringify(r0.links) === JSON.stringify(expected.map((c) => `/teams/${c}`)), loaded: imgs.filter((i) => i.ok).length, maxRatioErr: +Math.max(...imgs.map((i) => i.ratioErr)).toFixed(4), scrollbarVisible: r0.bar, scrollable: r0.scrollable, keyMoves: afterKey === 1, btnMoves: afterBtn === 2, snapOffPx: snapOff, pageOverflow: r0.overflow, cls: +cls.toFixed(4), initialCarRequests, lcp };
  const bad = r.n !== 11 || !r.linksOk || r.loaded !== 11 || r.maxRatioErr > 0.015 || r.scrollbarVisible || !r.keyMoves || !r.btnMoves || r.snapOffPx > 3 || r.pageOverflow || r.cls > 0.01 || /^RAIL/.test(lcp?.el || '');
  if (bad) fail++;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${JSON.stringify(r)}`);
  if (out && [390, 1440, 1920].includes(w)) {
    await pg.evaluate(() => { const r = document.querySelector('[data-rail]'); r.scrollLeft = 0; window.scrollTo(0, 0); });
    await pg.waitForTimeout(700);
    const sec = await pg.$('.grid-rail'); const bx = await sec.boundingBox();
    await pg.screenshot({ path: `${out}/rail-${w}.png`, clip: { x: 0, y: Math.max(0, bx.y - (w < 700 ? 320 : 420)), width: w, height: Math.min(bx.height + (w < 700 ? 320 : 420), 2000) } });
  }
  await pg.close();
}
await b.close();
console.log(fail ? `RAIL QA FAIL (${fail})` : 'RAIL QA PASS');
process.exit(fail ? 1 : 0);
