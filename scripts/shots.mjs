import { chromium } from 'playwright';
const [base, outDir, ...specs] = process.argv.slice(2);
const b = await chromium.launch();
for (const s of specs) {
  const [w, p] = s.split('@');
  const ctx = await b.newContext({ viewport: { width: +w, height: +w < 800 ? 844 : 900 } });
  const pg = await ctx.newPage();
  await pg.goto(base + p, { waitUntil: 'networkidle' }).catch(() => {});
  await pg.waitForTimeout(500);
  const h = await pg.evaluate(() => { const hb = document.querySelector('.site-header').getBoundingClientRect().bottom; const h1 = document.querySelector('main h1'); return h1 ? { hb: Math.round(hb), h1: Math.round(h1.getBoundingClientRect().top), cls: h1.parentElement.className } : null; });
  console.log(w, p, JSON.stringify(h));
  await pg.screenshot({ path: `${outDir}/${w}${p.replace(/\//g, '_') || '_home'}.png` });
  await ctx.close();
}
await b.close();
