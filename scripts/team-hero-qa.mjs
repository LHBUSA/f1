// Team-page hero QA at 390/768/1024/1440: LCP, CLS, overflow, image, label, caption, stats, JSON-LD, console errors.
//   node scripts/team-hero-qa.mjs <base> </teams/id> [screenshot dir] [tag]   (Git Bash: MSYS_NO_PATHCONV=1)
import { chromium } from 'playwright';
const [base, path, out, tag] = process.argv.slice(2);
const b = await chromium.launch();
for (const w of [390, 768, 1024, 1440]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } }); const pg = await ctx.newPage();
  const errs = []; pg.on('console', (m) => m.type() === 'error' && errs.push(m.text())); pg.on('pageerror', (e) => errs.push(String(e)));
  await pg.addInitScript(() => { window.__cls = 0; window.__lcp = 0; window.__el = ''; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__lcp = e.startTime; window.__el = e.element?.tagName || ''; } }).observe({ type: 'largest-contentful-paint', buffered: true }); });
  await pg.goto(base + path, { waitUntil: 'networkidle' }); await pg.waitForTimeout(800);
  const r = await pg.evaluate(() => { const img = document.querySelector('.team-car img'); const box = img?.getBoundingClientRect(); const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { return JSON.parse(s.textContent)['@type']; } catch { return 'PARSE_ERROR'; } }); return { cls: window.__cls, lcp: window.__lcp, el: window.__el, overflow: document.documentElement.scrollWidth > innerWidth, img: img ? { src: img.currentSrc.split('/').pop(), shown: Math.round(box.width) + 'x' + Math.round(box.height), complete: img.complete && img.naturalWidth > 0 } : null, label: document.querySelector('.car-id')?.innerText.replace(/\s+/g, ' '), caption: document.querySelector('.team-car figcaption')?.innerText, stats: [...document.querySelectorAll('.stat-box')].map((s) => s.innerText.replace(/\s+/g, ' ')).join(' | '), machine: !!document.querySelector('.machine-strip'), people: document.querySelectorAll('.people-sec .person, .people-sec .pairs li').length, ld }; });
  console.log(w, JSON.stringify({ ...r, lcp: Math.round(r.lcp), cls: +r.cls.toFixed(4), errors: errs }));
  if (out) await pg.screenshot({ path: `${out}/${w}_${tag}.png`, fullPage: w === 390 || w === 1440 });
  await ctx.close();
}
await b.close();
