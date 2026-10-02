import { chromium } from 'playwright';
const b = await chromium.launch();
for (const w of [390, 1440]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  await p.addInitScript(() => { window.__s = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__s.push({ v: e.value, src: (e.sources || []).map((s) => (s.node ? (s.node.nodeName + '.' + (s.node.className || '') + ' ' + (s.node.textContent || '').slice(0, 40)) : '?') + ` ${JSON.stringify(s.previousRect)}->${JSON.stringify(s.currentRect)}`) }); }).observe({ type: 'layout-shift', buffered: true }); });
  await p.goto('http://127.0.0.1:4173' + (process.argv[2] || '/pbecast'), { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  console.log(w, JSON.stringify(await p.evaluate(() => window.__s), null, 1).slice(0, 2500));
}
await b.close();
