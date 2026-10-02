// People V2 visual QA: canary profiles, /people and canary driver pages at 390/768/1024/1440/1920.
// Reports CLS, horizontal overflow (page + elements wider than the viewport), console errors, Person JSON-LD and the
// /people filter behaviour (JS on); saves full-page screenshots.
//   node scripts/people-qa.mjs <base> <out dir> [path ...]     (Git Bash: MSYS_NO_PATHCONV=1)
import fs from 'node:fs';
import { chromium } from 'playwright';

const [base, out, ...rest] = process.argv.slice(2);
const paths = rest.length ? rest : ['/people', '/people/peter-bonnington', '/people/gianpiero-lambiase', '/people/james-allison', '/people/adrian-newey', '/people/toto-wolff', '/people/frederic-vasseur', '/people/james-vowles', '/people/gene-haas', '/drivers/kimi-antonelli', '/drivers/arvid-lindblad', '/teams/haas'];
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const summary = [];
for (const p of paths) for (const w of [390, 768, 1024, 1440, 1920]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  pg.on('pageerror', (e) => errs.push(String(e)));
  await pg.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  await pg.goto(base + p, { waitUntil: 'networkidle' });
  await pg.addStyleTag({ content: '*{transition:none!important;animation:none!important;scroll-behavior:auto!important}' });
  await pg.waitForTimeout(500);
  const r = await pg.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll('main *')].filter((el) => { const b = el.getBoundingClientRect(); if (!b.width) return false; let a = el.parentElement; while (a && a !== document.body) { const s = getComputedStyle(a); if (/(auto|scroll|hidden)/.test(s.overflowX)) return false; a = a.parentElement; } return b.right > vw + 1 || b.left < -1; }).slice(0, 4).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { return JSON.parse(s.textContent)['@type']; } catch { return 'PARSE_ERROR'; } });
    return { cls: window.__cls, overflow: document.documentElement.scrollWidth > vw, wide, ld, h1: document.querySelector('h1')?.innerText };
  });
  let filter = null;
  if (p === '/people' && w === 390) {
    const all = await pg.locator('.pdir-item:not([hidden])').count();
    await pg.click('[data-g="race_engineering"]');
    const re = await pg.locator('.pdir-item:not([hidden])').count();
    await pg.selectOption('[data-pdir-team]', 'mercedes');
    const reM = await pg.locator('.pdir-item:not([hidden])').count();
    await pg.click('[data-g=""]');
    await pg.selectOption('[data-pdir-team]', '');
    await pg.fill('[data-pdir-q]', 'bonnington');
    const q = await pg.locator('.pdir-item:not([hidden])').count();
    await pg.fill('[data-pdir-q]', '');
    filter = { all, raceEngineers: re, raceEngineersMercedes: reM, searchBonnington: q };
  }
  const name = `${p.replace(/\//g, '_').replace(/^_/, '') || 'home'}_${w}.png`;
  await pg.screenshot({ path: `${out}/${name}`, fullPage: true });
  const errors = errs.filter((e) => !/propsports\.proptechusa\.ai|CORS|Failed to load resource/i.test(e));
  const row = { path: p, w, cls: +r.cls.toFixed(4), overflow: r.overflow, wide: r.wide, ld: r.ld, errors, corsArtefacts: errs.length - errors.length, ...(filter ? { filter } : {}) };
  summary.push(row);
  console.log(JSON.stringify(row));
  await ctx.close();
}
// no-JS: the directory must be the full list
const nj = await b.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 900 } });
const pg = await nj.newPage();
await pg.goto(base + '/people', { waitUntil: 'load' });
const noJs = { visible: await pg.locator('.pdir-item:visible').count(), total: await pg.locator('.pdir-item').count(), controlsHidden: await pg.locator('[data-pdir-ctl]').isHidden() };
console.log('no-js /people', JSON.stringify(noJs));
await pg.screenshot({ path: `${out}/people_nojs_390.png`, fullPage: false });
await b.close();
const bad = summary.filter((s) => s.overflow || s.wide.length || s.errors.length || s.cls > 0.05);
fs.writeFileSync(`${out}/qa-summary.json`, JSON.stringify({ summary, noJs, bad }, null, 2));
console.log(bad.length ? `ISSUES ${bad.length}` : 'QA PASS', noJs.visible === noJs.total ? '' : 'NO-JS LIST INCOMPLETE');
