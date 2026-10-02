// Car Explorer QA: hotspot alignment, hover preview, click lock, touch tap, keyboard, deep link, overflow, CLS.
//   node scripts/explorer-qa.mjs <base> /teams/<id> [screenshot dir]      (Git Bash: MSYS_NO_PATHCONV=1)
import { chromium, devices } from 'playwright';

const [base, path, out] = process.argv.slice(2);
const b = await chromium.launch();
const results = [];
for (const [w, touch] of [[390, true], [768, true], [1024, false], [1440, false]]) {
  const ctx = await b.newContext(touch ? { ...devices['iPhone 13'], viewport: { width: w, height: 900 }, hasTouch: true, isMobile: w < 700 } : { viewport: { width: w, height: 900 } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  pg.on('pageerror', (e) => errs.push(String(e)));
  await pg.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  await pg.goto(base + path, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(500);
  const r = { w };
  // alignment: every hotspot centre must sit at (x,y) of the rendered image box (+-1.5px)
  r.align = await pg.evaluate(() => {
    const img = document.querySelector('.car-stage img').getBoundingClientRect();
    return [...document.querySelectorAll('.hs')].map((h) => { const b = h.getBoundingClientRect(); const dx = b.left + b.width / 2 - (img.left + img.width * h.dataset.x), dy = b.top + b.height / 2 - (img.top + img.height * h.dataset.y); return Math.max(Math.abs(dx), Math.abs(dy)); });
  });
  r.alignMaxPx = +Math.max(...r.align).toFixed(2);
  r.hotspots = r.align.length;
  delete r.align;
  r.visiblePanelsInitially = await pg.$$eval('.xp-panel', (ps) => ps.filter((p) => !p.hidden).length);
  const first = await pg.$('.hs[data-c="power-unit"]');
  if (!touch) {
    await first.hover();
    await pg.waitForTimeout(250);
    r.hoverPreview = await pg.$eval('.hs[data-c="power-unit"] span', (s) => getComputedStyle(s).opacity === '1' && s.innerText.length > 3);
    r.hoverNoLayoutChange = await pg.$$eval('.xp-panel', (ps) => ps.every((p) => p.hidden));
    await pg.mouse.move(5, 5);
    await pg.waitForTimeout(250);
    r.hoverRestores = await pg.$eval('.hs[data-c="power-unit"] span', (s) => getComputedStyle(s).opacity === '0');
    await first.click();
    await pg.mouse.move(5, 5);
    r.clickLocks = await pg.$eval('#xp-power-unit', (p) => !p.hidden) && (await first.getAttribute('aria-pressed')) === 'true';
    // keyboard: Tab focus -> preview, Enter -> lock, Esc -> clear
    await pg.keyboard.press('Escape');
    await pg.focus('.hs[data-c="cockpit"]');
    await pg.keyboard.press('Enter');
    r.keyboardLocks = await pg.$eval('#xp-cockpit', (p) => !p.hidden);
    await pg.keyboard.press('Escape');
    r.escClears = await pg.$$eval('.xp-panel', (ps) => ps.every((p) => p.hidden));
  } else {
    await pg.tap('.hs[data-c="power-unit"]');
    r.tapLocks = await pg.$eval('#xp-power-unit', (p) => !p.hidden);
    await pg.tap('.xp-chip[data-c="cockpit"]');
    r.chipTap = await pg.$eval('#xp-cockpit', (p) => !p.hidden) && await pg.$eval('#xp-power-unit', (p) => p.hidden);
  }
  r.cls = +(await pg.evaluate(() => window.__cls)).toFixed(4);
  await pg.goto(base + path + '#part-rear-wing', { waitUntil: 'networkidle' });
  await pg.reload({ waitUntil: 'networkidle' });
  r.deepLink = await pg.$eval('#xp-rear-wing', (p) => !p.hidden);
  r.overflow = await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  r.errors = errs.length;
  if (out) {
    await pg.goto(base + path + '#part-power-unit', { waitUntil: 'networkidle' });
    await pg.waitForTimeout(300);
    await pg.screenshot({ path: `${out}/${w}_${path.split('/').pop()}_explorer.png`, fullPage: false, clip: w < 700 ? undefined : undefined });
  }
  results.push(r);
  await ctx.close();
}
await b.close();
for (const r of results) console.log(JSON.stringify(r));
const bad = results.filter((r) => r.alignMaxPx > 1.5 || r.overflow || r.errors || r.cls > 0.01 || r.visiblePanelsInitially !== 0 || r.deepLink !== true || [r.hoverPreview, r.hoverNoLayoutChange, r.hoverRestores, r.clickLocks, r.keyboardLocks, r.escClears, r.tapLocks, r.chipTap].some((v) => v === false));
console.log(bad.length ? `EXPLORER QA FAIL (${bad.map((r) => r.w).join(',')})` : 'EXPLORER QA PASS');
process.exit(bad.length ? 1 : 0);
