// Horizontal-scroll QA: no visible native scrollbar on table wrappers/tabs, wide tables still scroll sideways,
// no page-level horizontal overflow, no CLS; at >=1024 no ordinary table may need sideways scrolling, and any table
// that scrolls must carry the data-scroll affordance.  node scripts/scroll-qa.mjs <base> <path...>   (MSYS_NO_PATHCONV=1)
import { chromium } from 'playwright';

const [base, ...paths] = process.argv.slice(2);
const b = await chromium.launch();
let fail = 0;
for (const path of paths) for (const w of [390, 768, 1024, 1440]) {
  const pg = await b.newPage({ viewport: { width: w, height: 900 } });
  await pg.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  await pg.goto(base + path, { waitUntil: 'networkidle' });
  const r = await pg.evaluate(async () => {
    const wraps = [...document.querySelectorAll('.table-wrap, .itabs, .xp-chips')].filter((e) => e.offsetParent);
    const bars = wraps.filter((e) => e.offsetHeight - e.clientHeight - (parseFloat(getComputedStyle(e).borderTopWidth) + parseFloat(getComputedStyle(e).borderBottomWidth)) > 0.5).length;
    const wide = wraps.filter((e) => e.scrollWidth > e.clientWidth + 1);
    let scrolls = 0;
    for (const e of wide) { e.scrollLeft = 40; if (e.scrollLeft > 0) scrolls++; e.scrollLeft = 0; }
    const tablesOver = wide.filter((e) => e.matches('.table-wrap') && !e.closest('[data-wide]'));
    return { wraps: wraps.length, visibleBars: bars, wide: wide.length, scrollable: scrolls, deskTables: innerWidth >= 1024 ? tablesOver.length : 0, noCue: tablesOver.filter((e) => !e.dataset.scroll).length, pageOverflow: document.documentElement.scrollWidth > innerWidth };
  });
  r.cls = +(await pg.evaluate(() => window.__cls)).toFixed(4);
  const bad = r.visibleBars || r.scrollable !== r.wide || r.deskTables || r.noCue || r.pageOverflow || r.cls > 0.01;
  if (bad) fail++;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${w} ${path} ${JSON.stringify(r)}`);
  await pg.close();
}
await b.close();
console.log(fail ? `SCROLL QA FAIL (${fail})` : 'SCROLL QA PASS');
process.exit(fail ? 1 : 0);
