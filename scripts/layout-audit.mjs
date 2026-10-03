// Site-wide responsive/visual audit. Every built route × viewport matrix → page overflow, clipped content,
// table inventory (hidden horizontal scroll), image health, nav/footer cutoff, module overlap, console errors, CLS.
//
//   node scripts/layout-audit.mjs [--base http://127.0.0.1:4173] [--all | --per-family N] [--families drivers,teams]
//        [--viewports 390x844,1440x900] [--shots dir] [--out reports/layout-audit] [--concurrency 6]
//
// Rules (why a horizontally scrollable box fails):
//   desktop (>=1024 wide): any scroll container whose content is wider than its box FAILS unless the box (or an
//     ancestor) carries data-wide="<reason>" — an intentionally wide component with a documented reason.
//   any width: a scroll container that needs scrolling must show an affordance (data-scroll set by app.js →
//     edge fade) or a visible scrollbar; hidden-scrollbar + no cue = "invisible access only" = FAIL.
//   any width: an element painted past the viewport (or clipped by an overflow:hidden ancestor that is not a
//     scroll container) is a layout failure; decorative layers (aria-hidden / pointer-events:none) are ignored.
// Checked tables are listed in <out>/tables.json so every table has a record (route, columns, widths, verdict).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const BASE = arg('--base', 'http://127.0.0.1:4173');
const OUT = arg('--out', 'reports/layout-audit');
const SHOTS = arg('--shots', null);
const CONC = Number(arg('--concurrency', 6));
const PER = process.argv.includes('--all') ? Infinity : Number(arg('--per-family', 6));
const FAMS = arg('--families', '').split(',').filter(Boolean);
const VIEWPORTS = arg('--viewports', '360x800,390x844,430x932,768x1024,1024x768,1280x720,1366x768,1440x900,1600x900,1920x1080,1366x600,1024x600')
  .split(',').map((s) => s.split('x').map(Number));
const ONLY = (process.env.AUDIT_PAGES || '').split(',').filter(Boolean);

// ---- route discovery: every html file in dist, grouped by family -----------------------------------------
function routes() {
  const out = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.html')) out.push(p); } };
  walk('dist');
  return out.map((f) => {
    const rel = f.slice(5).replace(/\\/g, '/').replace(/\.html$/, '');
    const route = rel === 'index' ? '/' : `/${rel}`;
    const fam = route === '/' ? 'home' : route.split('/').length === 2 ? `index${route}` : route.split('/')[1];
    return { route, fam };
  });
}
// worst-case-first ordering inside a family: longest html first (longest careers / tables / names), then the rest
function pick(all) {
  const by = {};
  for (const r of all) (by[r.fam] ||= []).push(r);
  const res = [];
  for (const [fam, rs] of Object.entries(by)) {
    if (FAMS.length && !FAMS.includes(fam)) continue;
    rs.forEach((r) => { r.size = fs.statSync(`dist${r.route === '/' ? '/index' : r.route}.html`).size; });
    rs.sort((a, b) => b.size - a.size);
    if (PER >= rs.length) { res.push(...rs); continue; }
    // half largest, half evenly spread across the rest of the family (always including the smallest = "very little data")
    const half = Math.ceil(PER / 2);
    const rest = rs.slice(half);
    const k = PER - half;
    res.push(...rs.slice(0, half), ...Array.from({ length: k }, (_, i) => rest[Math.round((i * (rest.length - 1)) / Math.max(1, k - 1))]));
  }
  return res;
}

// ---- in-page probe ------------------------------------------------------------------------------------------
function probe() {
  const vw = document.documentElement.clientWidth;
  const desktop = innerWidth >= 1024;
  const fails = [];
  const notes = [];
  const label = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    const h = el.closest('section')?.querySelector('h2,h1')?.textContent?.trim().slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls}${h ? ` [${h}]` : ''}`;
  };
  const decorative = (el) => el.closest('[aria-hidden="true"]') || getComputedStyle(el).pointerEvents === 'none';
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const scroller = (el) => { const s = getComputedStyle(el); return /(auto|scroll)/.test(s.overflowX); };

  // 1. page-level horizontal overflow (body overflow-x:hidden would mask it → measure real content edge)
  const pageOverflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw;
  // 2. elements painted past the viewport / clipped by a non-scrolling overflow ancestor
  const all = [...document.querySelectorAll('main *, header *, footer *')];
  const past = [];
  const clipped = [];
  const oxMemo = new Map(), clipMemo = new Map(), rectMemo = new Map();
  const ox = (el) => { let v = oxMemo.get(el); if (v === undefined) { v = getComputedStyle(el).overflowX; oxMemo.set(el, v); } return v; };
  const rectOf = (el) => { let v = rectMemo.get(el); if (!v) { v = el.getBoundingClientRect(); rectMemo.set(el, v); } return v; };
  // nearest ancestor that clips horizontally (memoised up the chain: siblings share the walk)
  const clipperOf = (el) => {
    const p = el.parentElement;
    if (!p || p === document.body) return null;
    if (clipMemo.has(p)) return clipMemo.get(p);
    const c = ox(p) !== 'visible' ? p : clipperOf(p);
    clipMemo.set(p, c);
    return c;
  };
  for (const el of all) {
    const r = rectOf(el);
    if (r.width === 0 || r.height === 0) continue;
    const out = r.right > vw + 1 || r.left < -1;
    const leafText = el.children.length === 0 && !/^(img|svg|picture|video|canvas|path|g|i)$/i.test(el.tagName) && el.textContent.trim();
    if (!out && !leafText) continue;
    const clipper = clipperOf(el);
    if (clipper && /(auto|scroll)/.test(ox(clipper))) continue; // handled by the scroll-container inventory
    let hit = false;
    if (out) { const c = clipper && rectOf(clipper); if (!c || c.right > vw + 1 || c.left < -1) { past.push(el); hit = true; } }
    if (!hit && clipper && leafText) { const c = rectOf(clipper); if (r.right > c.right + 2 || r.left < c.left - 2) clipped.push(el); }
  }
  const real = (el) => getComputedStyle(el).position !== 'fixed' && !decorative(el);
  past.splice(0, past.length, ...past.filter(real));
  clipped.splice(0, clipped.length, ...clipped.filter(real));
  const top = (list) => list.filter((el) => !list.some((o) => o !== el && o.contains(el))); // outermost offenders only
  for (const el of top(past).slice(0, 6)) fails.push({ kind: 'past-viewport', el: label(el), right: Math.round(el.getBoundingClientRect().right), vw });
  for (const el of top(clipped).slice(0, 6)) fails.push({ kind: 'clipped-text', el: label(el), text: el.textContent.trim().slice(0, 40) });

  // 3. scroll containers + tables inventory
  const tables = [];
  const boxes = [...document.querySelectorAll('main *')].filter((el) => scroller(el) && visible(el));
  for (const el of boxes) {
    const needs = el.scrollWidth > el.clientWidth + 1;
    const t = el.querySelector('table');
    const wide = el.closest('[data-wide]')?.getAttribute('data-wide') || null;
    // scroll by a full box width (snap containers snap a 40px nudge back to 0), then restore
    const before = el.scrollLeft; el.scrollTo({ left: before + el.clientWidth, behavior: 'instant' }); const canScroll = el.scrollLeft > before; el.scrollTo({ left: before, behavior: 'instant' });
    const barH = el.offsetHeight - el.clientHeight - (parseFloat(getComputedStyle(el).borderTopWidth) + parseFloat(getComputedStyle(el).borderBottomWidth));
    const affordance = !!el.dataset.scroll && el.dataset.scroll !== 'none' || barH > 0.5 || el.matches('.rail,.itabs,.xp-chips,[data-affordance]');
    const rec = { el: label(el), cw: el.clientWidth, sw: el.scrollWidth, needs, canScroll, affordance, wide };
    if (t) {
      const cells = t.rows[0] ? [...t.rows[0].cells] : [];
      const box = el.getBoundingClientRect();
      const first = cells[0]?.getBoundingClientRect(), last = cells[cells.length - 1]?.getBoundingClientRect();
      const grid = el.parentElement?.closest('.split,.grid,.cast,.g2,.g3,.g4');
      Object.assign(rec, {
        cols: cells.reduce((n, c) => n + (c.colSpan || 1), 0),
        firstVisible: first ? first.left >= box.left - 1 && first.right <= box.right + 1 : null,
        lastVisible: last ? last.right <= box.right + 1 : null,
        inGrid: grid ? (typeof grid.className === 'string' ? grid.className : 'grid') : null,
        parentWidth: Math.round(el.parentElement.getBoundingClientRect().width),
      });
      tables.push(rec);
    }
    if (!needs) continue;
    if (needs && !canScroll) fails.push({ kind: 'unreachable-overflow', ...rec });
    else if (desktop && !wide && !el.matches('.rail,.itabs,.xp-chips')) fails.push({ kind: 'desktop-hidden-scroll', ...rec });
    else if (!affordance) fails.push({ kind: 'no-scroll-affordance', ...rec });
    else if (needs) notes.push({ kind: 'scrolls', ...rec });
  }
  // tables not inside any scroll container but wider than their parent
  for (const t of document.querySelectorAll('main table')) {
    if (t.closest('.table-wrap') || !visible(t)) continue;
    const p = t.parentElement.getBoundingClientRect(), r = t.getBoundingClientRect();
    if (r.right > p.right + 1) fails.push({ kind: 'table-wider-than-parent', el: label(t), over: Math.round(r.right - p.right) });
  }

  // 4. text truncation (ellipsis) — reported, fails only for headings
  for (const el of document.querySelectorAll('main *')) {
    if (el.children.length || !(el.scrollWidth > el.clientWidth + 1) || !el.textContent.trim()) continue;
    if (getComputedStyle(el).textOverflow === 'ellipsis') {
      const rec = { kind: 'truncated', el: label(el), text: el.textContent.trim().slice(0, 50) };
      if (/^H[1-3]$/.test(el.tagName)) fails.push(rec); else notes.push(rec);
    }
  }
  for (const h of document.querySelectorAll('h1,h2,h3')) if (visible(h) && h.scrollWidth > h.clientWidth + 2 && getComputedStyle(h).overflowX !== 'visible') fails.push({ kind: 'heading-overflow', el: label(h) });

  // 5. images: broken, distorted, tiny-for-slot
  for (const img of document.images) {
    if (!visible(img) || decorative(img) && !img.alt) continue;
    if (img.complete && img.naturalWidth === 0 && img.loading !== 'lazy') { fails.push({ kind: 'broken-image', src: img.currentSrc || img.src }); continue; }
    if (!img.naturalWidth) continue;
    const r = img.getBoundingClientRect(), s = getComputedStyle(img);
    const ratioN = img.naturalWidth / img.naturalHeight, ratioR = r.width / r.height;
    if (s.objectFit === 'fill' && Math.abs(ratioN - ratioR) / ratioN > 0.04 && r.width > 24) fails.push({ kind: 'distorted-image', src: (img.currentSrc || img.src).split('/').pop(), natural: ratioN.toFixed(2), rendered: ratioR.toFixed(2) });
    if (img.naturalWidth * (s.objectFit === 'cover' ? 1 : 1) < r.width * 0.75 && r.width > 120) notes.push({ kind: 'upscaled-image', src: (img.currentSrc || img.src).split('/').pop(), natural: img.naturalWidth, rendered: Math.round(r.width) });
  }

  // 6. nav + footer cutoff
  for (const sel of ['.primary-nav a', '.site-footer a', '.masthead > *']) {
    for (const a of document.querySelectorAll(sel)) {
      if (!visible(a)) continue;
      const r = a.getBoundingClientRect();
      let p = a.parentElement, clip = null;
      while (p && p !== document.body) { if (getComputedStyle(p).overflowX !== 'visible') { clip = p; break; } p = p.parentElement; }
      const c = clip ? clip.getBoundingClientRect() : { left: 0, right: vw };
      if (clip && scroller(clip)) continue;
      if (r.right > Math.min(vw, c.right) + 1 || r.left < Math.max(0, c.left) - 1) fails.push({ kind: sel.includes('footer') ? 'footer-cutoff' : 'nav-cutoff', el: label(a), text: a.textContent.trim().slice(0, 30) });
    }
  }

  // 7. overlapping top-level modules (siblings inside main whose boxes intersect vertically)
  const mods = [...document.querySelectorAll('main > *')].filter((e) => visible(e) && getComputedStyle(e).position !== 'absolute' && getComputedStyle(e).position !== 'fixed');
  for (let i = 1; i < mods.length; i++) {
    const a = mods[i - 1].getBoundingClientRect(), b = mods[i].getBoundingClientRect();
    if (b.top < a.bottom - 2 && a.height > 0 && b.height > 0) fails.push({ kind: 'module-overlap', el: `${label(mods[i - 1])} / ${label(mods[i])}`, px: Math.round(a.bottom - b.top) });
  }
  return { pageOverflow, fails, notes, tables, h1: document.querySelectorAll('h1').length };
}

// ---- runner -------------------------------------------------------------------------------------------------
const all = routes();
const list = ONLY.length ? all.filter((r) => ONLY.includes(r.route)) : pick(all);
const famCount = {};
for (const r of all) famCount[r.fam] = (famCount[r.fam] || 0) + 1;
console.log(`routes: ${all.length} built, auditing ${list.length} × ${VIEWPORTS.length} viewports`);
fs.mkdirSync(OUT, { recursive: true });
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const results = [];
const jobs = VIEWPORTS.flatMap(([w, h]) => list.map((r) => ({ ...r, w, h })));
let done = 0;
async function worker() {
  const ctxs = {};
  while (jobs.length) {
    const j = jobs.shift();
    const key = `${j.w}x${j.h}`;
    ctxs[key] ||= await browser.newContext({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: 1, hasTouch: j.w < 1024, isMobile: false });
    const ctx = ctxs[key];
    // third-party calls (live/weather/analytics) are not layout: answer them with a 503 (a realistic upstream outage
    // the page must survive quietly) instead of hammering production for every audited page
    if (!ctx.__routed) { await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"audit_offline"}' })); ctx.__routed = true; }
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push(m.text().slice(0, 160)); });
    await page.addInitScript(() => { window.__cls = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {} });
    let res = null, r = null;
    try {
      res = await page.goto(BASE + j.route, { waitUntil: 'load', timeout: 45000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(120);
      r = await page.evaluate(probe);
      r.cls = +(await page.evaluate(() => window.__cls)).toFixed(4);
    } catch (e) { r = { fails: [{ kind: 'load-error', msg: String(e).slice(0, 160) }], notes: [], tables: [], pageOverflow: 0, cls: 0, h1: 1 }; }
    const status = res?.status?.() ?? 0;
    if (status !== 200 && !(j.route === '/404' && status === 404)) r.fails.push({ kind: 'status', status });
    if (r.pageOverflow > 0) r.fails.push({ kind: 'page-overflow', px: r.pageOverflow });
    if (r.cls > 0.1) r.fails.push({ kind: 'cls', value: r.cls });
    if (errors.length) r.fails.push({ kind: 'console', errors: errors.slice(0, 3) });
    if (r.h1 !== 1) r.fails.push({ kind: 'h1-count', n: r.h1 });
    results.push({ route: j.route, fam: j.fam, vp: key, ...r });
    if (SHOTS && (r.fails.length || process.env.AUDIT_SHOT_ALL)) await page.screenshot({ path: path.join(SHOTS, `${key}${j.route.replace(/\//g, '_') || '_home'}.png`), fullPage: !!process.env.AUDIT_FULLPAGE }).catch(() => {});
    await page.close();
    if (++done % 200 === 0) console.log(`  ${done} done`);
  }
  for (const c of Object.values(ctxs)) await c.close();
}
await Promise.all(Array.from({ length: CONC }, worker));
await browser.close();

// ---- report -------------------------------------------------------------------------------------------------
const failing = results.filter((r) => r.fails.length);
const byKind = {};
for (const r of failing) for (const f of r.fails) { (byKind[f.kind] ||= new Set()).add(`${r.vp} ${r.route}`); }
const tables = results.flatMap((r) => r.tables.map((t) => ({ route: r.route, vp: r.vp, ...t })));
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results.filter((r) => r.fails.length || r.notes.length).map(({ tables: _t, ...x }) => x), null, 1));
fs.writeFileSync(path.join(OUT, 'tables.json'), JSON.stringify(tables, null, 1));
const fams = [...new Set(list.map((r) => r.fam))].sort();
const md = [
  `# Layout audit — ${new Date().toISOString()}`,
  '',
  `Base ${BASE}. ${list.length} routes × ${VIEWPORTS.length} viewports = ${results.length} page loads. Viewports: ${VIEWPORTS.map((v) => v.join('×')).join(', ')}.`,
  '',
  '| family | built | audited |', '|---|---:|---:|',
  ...fams.map((f) => `| ${f} | ${famCount[f]} | ${list.filter((r) => r.fam === f).length} |`),
  '',
  `## Failures: ${failing.length} page loads`,
  ...Object.entries(byKind).map(([k, s]) => `- **${k}**: ${s.size} (${[...s].slice(0, 6).join('; ')}${s.size > 6 ? ' …' : ''})`),
  '',
  `## Tables: ${tables.length} table instances, ${tables.filter((t) => t.needs).length} need horizontal scroll`,
  ...Object.entries(tables.filter((t) => t.needs).reduce((m, t) => { const k = `${t.el} @ ${t.vp.split('x')[0]}`; (m[k] ||= []).push(t.route); return m; }, {})).slice(0, 80).map(([k, rs]) => `- ${k}: ${rs.length} routes (${rs.slice(0, 3).join(', ')})`),
];
fs.writeFileSync(path.join(OUT, 'REPORT.md'), md.join('\n') + '\n');
console.log(md.slice(0, 40 + Object.keys(byKind).length).join('\n'));
process.exit(failing.length ? 1 : 0);
