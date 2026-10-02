// Soft-navigation QA: Home -> Team -> Driver -> Race -> Standings -> Intelligence -> PBEcast -> Home, then Back through
// the whole sequence. Checks URL, title, canonical, aria-current, soft (no document reload) vs hard (PBEcast) hops,
// no duplicate scripts/modules/polling, Car Explorer after soft entry, PBEcast after entry, Ctrl/Cmd-click, JS-off,
// direct reload of every route.   node scripts/nav-qa.mjs <base>      (Git Bash: MSYS_NO_PATHCONV=1)
import { chromium } from 'playwright';

const base = process.argv[2];
const b = await chromium.launch();
let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('  FAIL', msg); } };

const STEPS = [
  { name: 'team', sel: 'a[href="/teams/mercedes"]', path: '/teams/mercedes', title: /Mercedes/, nav: '/teams', soft: true },
  { name: 'driver', sel: '#main a[href^="/drivers/"]', path: /^\/drivers\//, title: /./, nav: '/drivers', soft: true },
  { name: 'races', sel: '#primary-nav a[href="/races"]', path: '/races', title: /Races|Calendar|Schedule/i, nav: '/races', soft: true },
  { name: 'race', sel: '#main a[href^="/races/2026-"]', path: /^\/races\/2026-/, title: /./, nav: '/races', soft: true },
  { name: 'standings', sel: '#primary-nav a[href="/standings"]', path: '/standings', title: /Standings/i, nav: '/standings', soft: true },
  { name: 'intelligence', sel: '#primary-nav a[href="/intelligence"]', path: '/intelligence', title: /Intelligence/i, nav: '/intelligence', soft: true },
  { name: 'pbecast-hub', sel: '#primary-nav a[href="/pbecast"]', path: '/pbecast', title: /PBEcast/i, nav: '/pbecast', soft: false },
  { name: 'pbecast', sel: '#main a[href="/pbecast/2026-bahrain-grand-prix-in-malaysia"]', path: '/pbecast/2026-bahrain-grand-prix-in-malaysia', title: /PBEcast/i, nav: '/pbecast', soft: false },
  { name: 'home', sel: 'header a.brand', path: '/', title: /F1|PropBetEdge/i, nav: '/', soft: false },
];

for (const w of [390, 768, 1024, 1440]) {
  console.log(`== ${w}`);
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
  let liveReqs = 0, docLoads = 0;
  pg.on('request', (r) => { if (/\/v1\/f1\/live$/.test(r.url())) liveReqs++; if (r.resourceType() === 'document') docLoads++; });
  await pg.goto(base + '/', { waitUntil: 'networkidle' });
  const visited = ['/'];
  for (const s of STEPS) {
    if (s.name === 'pbecast-hub') { check(liveReqs === 1, `soft hops started extra live polling (${liveReqs} /live requests across 1 document + 6 soft navigations)`); console.log(`  /live requests during soft hops: ${liveReqs}`); }
    await pg.evaluate(() => { window.__marker ??= Math.random(); });
    const marker = await pg.evaluate(() => window.__marker);
    const href = await pg.evaluate((sel) => document.querySelector(sel)?.getAttribute('href'), s.sel);
    if (!href) { check(false, `${s.name}: link not found (${s.sel})`); continue; }
    await pg.evaluate((sel) => document.querySelector(sel).click(), s.sel);
    await pg.waitForFunction((p) => location.pathname === p, href.split('#')[0], { timeout: 15000 }).catch(() => {});
    await pg.waitForLoadState('networkidle');
    await pg.waitForTimeout(300);
    const st = await pg.evaluate(() => ({ path: location.pathname, title: document.title, canonical: document.querySelector('link[rel=canonical]')?.href, current: document.querySelector('#primary-nav [aria-current="page"]')?.getAttribute('href') || null, marker: window.__marker, mounted: Object.keys(window.F1?.mounted || {}), scripts: [...document.querySelectorAll('script[src]')].map((x) => x.getAttribute('src')), h1: document.querySelector('#main h1')?.textContent?.trim().slice(0, 40) }));
    const okPath = typeof s.path === 'string' ? st.path === s.path : s.path.test(st.path);
    check(okPath, `${s.name}: path ${st.path}`);
    check(s.title.test(st.title), `${s.name}: title "${st.title}"`);
    check(st.canonical?.endsWith(st.path === '/' ? '/' : st.path), `${s.name}: canonical ${st.canonical}`);
    check(st.current === s.nav || (s.nav === '/' && st.current === null), `${s.name}: aria-current ${st.current}`);
    check((st.marker === marker) === s.soft, `${s.name}: ${s.soft ? 'expected soft swap but document reloaded' : 'expected full navigation'}`);
    const dup = st.scripts.filter((x, i, a) => a.indexOf(x) !== i);
    check(!dup.length, `${s.name}: duplicate scripts ${dup}`);
    if (s.name === 'team') {
      check(st.mounted.includes('explorer'), 'team: explorer module not mounted after soft entry');
      await pg.evaluate(() => document.querySelector('.xp-chip[data-c="power-unit"]')?.click());
      check(await pg.evaluate(() => !document.querySelector('#xp-power-unit')?.hidden), 'team: Car Explorer panel did not open after soft entry');
    }
    if (s.name === 'driver') check(!st.mounted.includes('explorer') && !st.mounted.includes('rail'), `driver: stale modules mounted ${st.mounted}`);
    if (s.name === 'pbecast') check(await pg.evaluate(() => !!document.querySelector('[data-pc-canvas]') && document.body.dataset.pcTier != null), 'pbecast: client did not boot');
    visited.push(st.path);
    console.log(`  ${s.soft ? 'soft' : 'hard'} ${st.path} · "${st.title.slice(0, 50)}" · nav=${st.current} · modules=${st.mounted.join(',')}`);
  }
  // back through the whole sequence
  for (let i = visited.length - 2; i >= 0; i--) {
    await pg.goBack({ waitUntil: 'networkidle' }).catch(() => {});
    await pg.waitForTimeout(400);
    const p = await pg.evaluate(() => ({ path: location.pathname, title: document.title, h1: !!document.querySelector('#main h1') }));
    check(p.path === visited[i] && p.h1, `back #${visited.length - 1 - i}: at ${p.path}, expected ${visited[i]}`);
  }
  console.log(`  back ok to ${await pg.evaluate(() => location.pathname)} · document loads ${docLoads} · /live requests ${liveReqs}`);
  check(!errs.length, `page errors ${errs.slice(0, 2)}`);
  await ctx.close();
}

// Ctrl/Cmd-click opens a new tab and leaves the current page alone
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await ctx.newPage();
  await pg.goto(base + '/', { waitUntil: 'networkidle' });
  const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null), pg.click('#primary-nav a[href="/standings"]', { modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })]);
  check(!!popup && pg.url().endsWith('/'), 'ctrl-click did not open a new tab / changed current page');
  console.log(`ctrl-click: new tab ${popup ? 'opened' : 'NOT opened'}, current ${new URL(pg.url()).pathname}`);
  await ctx.close();
}
// JavaScript disabled: plain anchors work
{
  const ctx = await b.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const pg = await ctx.newPage();
  await pg.goto(base + '/', { waitUntil: 'load' });
  await Promise.all([pg.waitForNavigation(), pg.click('#primary-nav a[href="/drivers"]')]);
  check(new URL(pg.url()).pathname === '/drivers', 'JS-off navigation failed');
  console.log(`js-off: ${new URL(pg.url()).pathname}`);
  await ctx.close();
}
// direct load of every route
{
  const ctx = await b.newContext(); const pg = await ctx.newPage();
  for (const p of ['/', '/teams/mercedes', '/drivers/lando-norris', '/races', '/races/2026-azerbaijan-grand-prix', '/standings', '/intelligence', '/pbecast', '/news', '/circuits', '/matchups']) {
    const r = await pg.goto(base + p, { waitUntil: 'domcontentloaded' });
    check(r.status() === 200, `direct ${p} -> ${r.status()}`);
  }
  console.log('direct loads checked');
  await ctx.close();
}
await b.close();
console.log(fail ? `NAV QA FAIL (${fail})` : 'NAV QA PASS');
process.exit(fail ? 1 : 0);
