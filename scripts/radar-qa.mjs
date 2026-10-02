// DNA radar layout regression check: every label, ring and the value polygon must sit inside the SVG's visible
// viewBox, the radar must not overlap the copy below it, and the page must not overflow horizontally.
//   node scripts/radar-qa.mjs <base> <path> [<path> ...]      (Git Bash: MSYS_NO_PATHCONV=1)
import { chromium } from 'playwright';

const [base, ...paths] = process.argv.slice(2);
const b = await chromium.launch();
let fail = 0;
for (const path of paths) for (const w of [1440, 1280, 1024, 768, 390]) {
  const pg = await b.newPage({ viewport: { width: w, height: 900 } });
  await pg.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  await pg.goto(base + path, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(300);
  const r = await pg.evaluate(() => {
    const svg = document.querySelector('svg.radar');
    if (!svg) return { missing: true };
    const vb = svg.viewBox.baseVal;
    const out = [];
    for (const el of svg.querySelectorAll('text, polygon')) {
      const bb = el.getBBox();
      const clipped = bb.x < vb.x - 0.5 || bb.y < vb.y - 0.5 || bb.x + bb.width > vb.x + vb.width + 0.5 || bb.y + bb.height > vb.y + vb.height + 0.5;
      if (clipped) out.push(`${el.tagName}${el.textContent ? ':' + el.textContent : ''} [${bb.x.toFixed(1)},${bb.y.toFixed(1)} ${bb.width.toFixed(1)}x${bb.height.toFixed(1)}] vb ${vb.x},${vb.y},${vb.width},${vb.height}`);
    }
    // label <-> label overlap
    const t = [...svg.querySelectorAll('text')].map((e) => e.getBoundingClientRect());
    let overlap = 0;
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) if (t[i].left < t[j].right && t[j].left < t[i].right && t[i].top < t[j].bottom && t[j].top < t[i].bottom) overlap++;
    const sb = svg.getBoundingClientRect();
    const next = svg.nextElementSibling?.getBoundingClientRect();
    return { clipped: out, labelOverlap: overlap, overlapsNext: next ? next.top < sb.bottom - 0.5 : false, size: `${Math.round(sb.width)}x${Math.round(sb.height)}`, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  r.cls = +(await pg.evaluate(() => window.__cls)).toFixed(4);
  const bad = r.missing || r.clipped.length || r.labelOverlap || r.overlapsNext || r.overflow || r.cls > 0.01;
  if (bad) fail++;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${w} ${path} ${JSON.stringify(r)}`);
  await pg.close();
}
await b.close();
console.log(fail ? `RADAR QA FAIL (${fail})` : 'RADAR QA PASS');
process.exit(fail ? 1 : 0);
