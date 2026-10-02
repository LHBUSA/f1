// Nav -> hero perceived gap: distance from the sticky header's bottom edge to the first painted ink (text glyphs or an
// image/canvas) in <main>, at each width. Usage: node scripts/measure-nav-gap.mjs [base] [--out file.json]
import { chromium } from 'playwright';
import fs from 'node:fs';
const base = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'https://f1.propbetedge.ai';
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const PAGES = (process.env.GAP_PAGES || '/,/drivers/max-verstappen,/teams/red-bull,/races/2026-azerbaijan-grand-prix,/circuits/circuit-de-monaco,/standings,/intelligence,/news,/pbecast').split(',');
const WIDTHS = [320, 390, 768, 1024, 1440];
const browser = await chromium.launch();
const rows = [];
for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const p of PAGES) {
    const res = await page.goto(base + p, { waitUntil: 'domcontentloaded' }).catch(() => null);
    if (!res || res.status() >= 400) { rows.push({ w, p, status: res?.status() ?? 0 }); continue; }
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const hdr = document.querySelector('.site-header, header');
      const hb = hdr ? hdr.getBoundingClientRect().bottom : 0;
      const main = document.querySelector('main') || document.body;
      let first = Infinity, what = null;
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let n = walker.currentNode; n; n = walker.nextNode()) {
        let r = null;
        if (n.nodeType === 3) { if (!n.textContent.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(n); r = rg.getBoundingClientRect(); }
        else if (/^(IMG|CANVAS|VIDEO|svg)$/i.test(n.tagName)) r = n.getBoundingClientRect();
        else continue;
        const el = n.nodeType === 3 ? n.parentElement : n;
        const cs = getComputedStyle(el);
        if (!r || r.height < 1 || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
        if (r.top < first) { first = r.top; what = (n.nodeType === 3 ? n.textContent.trim().slice(0, 30) : n.tagName) + ' <' + el.className + '>'; }
      }
      return { header_bottom: Math.round(hb), first_ink: Math.round(first), gap: Math.round(first - hb), what };
    });
    rows.push({ w, p, ...m });
  }
  await ctx.close();
}
await browser.close();
for (const r of rows) console.log(String(r.w).padStart(5), r.p.padEnd(42), r.status ? `HTTP ${r.status}` : `gap ${String(r.gap).padStart(4)}px  (${r.what})`);
if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 2));
