// LCP / CLS / backdrop bytes for key pages at every QA width (local or production base URL).
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://127.0.0.1:4173';
const pages = process.env.PERF_PAGES ? process.env.PERF_PAGES.split(',') : ['/', '/drivers/max-verstappen', '/races/2026-azerbaijan-grand-prix', '/standings', '/pbecast', '/circuits/circuit-de-monaco', '/intelligence', '/news', '/news/george-russell-wins-2026-azerbaijan-grand-prix'];
const b = await chromium.launch();
let worst = { cls: 0, at: '' };
const rows = [];
for (const w of [320, 360, 390, 430, 768, 1024, 1440]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
  for (const p of pages) {
    const pg = await ctx.newPage();
    await pg.addInitScript(() => { window.__cls = 0; window.__lcp = 0; window.__lcpEl = ''; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__lcp = e.startTime; window.__lcpEl = e.element ? e.element.tagName + '.' + (e.element.className || '') : (e.url || ''); } }).observe({ type: 'largest-contentful-paint', buffered: true }); });
    let bd = 0;
    pg.on('response', async (r) => { if (r.url().includes('/media/backdrop/')) { try { bd += (await r.body()).length; } catch {} } });
    await pg.goto(base + p, { waitUntil: 'networkidle' });
    await pg.waitForTimeout(500);
    const m = await pg.evaluate(() => ({ cls: window.__cls, lcp: window.__lcp, el: window.__lcpEl }));
    rows.push(`${String(w).padStart(4)} ${p.padEnd(36)} LCP ${String(Math.round(m.lcp)).padStart(5)}ms (${m.el.slice(0, 28)}) CLS ${m.cls.toFixed(3)} backdrop ${Math.round(bd / 1024)}KB`);
    if (m.cls > worst.cls) worst = { cls: m.cls, at: `${w}${p}` };
    await pg.close();
  }
  await ctx.close();
}
await b.close();
console.log(rows.join('\n'));
console.log(`worst CLS ${worst.cls.toFixed(4)} at ${worst.at}`);
