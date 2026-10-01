// Browser QA: widths × pages → overflow, console errors, broken images, screenshots.
// Usage: node scripts/qa-browser.mjs [baseUrl] [--shots dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:4173';
const shotDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1440];
const pages = (process.env.QA_PAGES || '').split(',').filter(Boolean);
const defaults = ['/', '/races', '/standings', '/drivers', '/teams', '/circuits', '/matchups', '/pbecast', '/news', '/methodology', '/data-coverage'];
async function discover() {
  // Pick representative entity pages from the built site.
  const pick = (dir, n = 1) => {
    const d = path.resolve('dist', dir);
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter((f) => f.endsWith('.html')).slice(0, n).map((f) => `/${dir}/${f.replace(/\.html$/, '')}`);
  };
  const extra = [];
  const mustHave = ['/drivers/kimi-antonelli', '/drivers/max-verstappen', '/drivers/lewis-hamilton', '/teams/audi', '/teams/cadillac', '/teams/red-bull', '/races/2026-azerbaijan-grand-prix', '/races/2026-singapore-grand-prix', '/circuits/circuit-de-monaco', '/standings/2021'];
  for (const p of mustHave) if (fs.existsSync(path.resolve('dist', p.slice(1) + '.html'))) extra.push(p);
  const mu = fs.existsSync('dist/matchup') ? fs.readdirSync('dist/matchup').slice(0, 1).flatMap((a) => fs.readdirSync(path.join('dist/matchup', a)).slice(0, 1).map((b) => `/matchup/${a}/${b.replace(/\.html$/, '')}`)) : [];
  return [...defaults, ...extra, ...mu, ...pick('news', 1), ...pick('seasons', 1)];
}

const list = pages.length ? pages : await discover();
const browser = await chromium.launch();
const failures = [];
let checks = 0;
for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
  for (const p of list) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    const res = await page.goto(base + p, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => ({ status: () => 0, err: e }));
    const status = res?.status?.() ?? 0;
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - doc.clientWidth;
      const offenders = overflow > 0 ? [...document.querySelectorAll('body *')].filter((el) => { const b = el.getBoundingClientRect(); return b.right > doc.clientWidth + 1 && !el.closest('.table-wrap') && getComputedStyle(el).position !== 'fixed'; }).slice(0, 5).map((el) => el.tagName + '.' + el.className) : [];
      const broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src);
      return { overflow, offenders, broken, h1: document.querySelectorAll('h1').length, canonical: document.querySelector('link[rel=canonical]')?.href };
    });
    checks++;
    // Until the API Worker is live, /api failures are tolerated unless QA_STRICT=1.
    const errs = process.env.QA_STRICT ? errors : errors.filter((e) => !/\/api\/|Failed to load resource/.test(e));
    const problems = [];
    if (status !== 200) problems.push(`status ${status}`);
    if (r.overflow > 0) problems.push(`overflow ${r.overflow}px ${r.offenders.join(' ')}`);
    if (r.broken.length) problems.push(`broken images ${r.broken.slice(0, 3).join(' ')}`);
    if (errs.length) problems.push(`console ${errs.slice(0, 3).join(' | ')}`);
    if (r.h1 !== 1) problems.push(`h1 count ${r.h1}`);
    if (!r.canonical) problems.push('no canonical');
    if (problems.length) failures.push(`${w}px ${p}: ${problems.join('; ')}`);
    if (shotDir && (w === 390 || w === 1440)) {
      fs.mkdirSync(shotDir, { recursive: true });
      await page.screenshot({ path: path.join(shotDir, `${w}${p.replace(/\//g, '_') || '_home'}.png`), fullPage: true });
    }
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log(`${checks} checks across ${list.length} pages × ${WIDTHS.length} widths`);
if (failures.length) {
  console.log(failures.join('\n'));
  process.exit(1);
}
console.log('PASS: no overflow, no console errors, no broken images');
