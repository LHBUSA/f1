// Backdrop direction comparison: same real pages, same widths, all candidates.
// usage: node art/compare.mjs <outdir> A B C D   (expects art/out/<D>/ assets and a local server on :4173 serving ./dist)
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
const dirs = process.argv.slice(3);
const PAGES = ['/', '/drivers/max-verstappen', '/races/2026-azerbaijan-grand-prix', '/standings', '/pbecast'];
const VIEWPORTS = { 390: 844, 768: 1024, 1440: 900 };
fs.mkdirSync(out, { recursive: true });
const metrics = {};
const browser = await chromium.launch();
for (const d of dirs) {
  execSync('node scripts/build-site.mjs', { env: { ...process.env, F1_BACKDROP: d }, stdio: 'ignore' });
  metrics[d] = {};
  for (const [w, h] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ viewport: { width: Number(w), height: h } });
    for (const p of PAGES) {
      const page = await ctx.newPage();
      await page.addInitScript(() => {
        window.__cls = 0; window.__lcp = 0;
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
        new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      });
      let bytes = 0;
      page.on('response', async (r) => { if (r.url().includes('/media/backdrop/')) { try { bytes += (await r.body()).length; } catch {} } });
      await page.goto('http://127.0.0.1:4173' + p, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const m = await page.evaluate(() => ({ cls: window.__cls, lcp: window.__lcp }));
      metrics[d][`${w}${p}`] = { ...m, backdrop_bytes: bytes };
      const name = `${d}_${w}${p.replace(/\//g, '_') || '_home'}.png`;
      await page.screenshot({ path: path.join(out, name) });
      if (p !== '/' && p !== '/pbecast') {
        await page.evaluate(() => window.scrollTo(0, Math.min(document.body.scrollHeight, window.innerHeight * 1.2)));
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(out, name.replace('.png', '_scrolled.png')) });
      }
      await page.close();
    }
    await ctx.close();
  }
  console.log(d, 'captured');
}
await browser.close();
fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify(metrics, null, 1));
console.log('done');
