// Shared rendering helpers for the static F1 site. Strict CSP: no inline styles or scripts.
export const SITE = 'https://f1.propbetedge.ai';
export const DISCORD = 'https://discord.gg/kb5zCTHbME';
export const GA_ID = 'G-BRS48R8PG9';
// Every data/media request from the site goes to the PropSports F1 contract.
export const PROPSPORTS_F1 = 'https://propsports.proptechusa.ai/v1/f1';

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const fmtNum = (n, d = 0) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fmtPts = (n) => (n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1));
export const pct = (x, d = 0) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);
export const ordinal = (n) => {
  if (n == null) return '—';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
export function fmtMs(ms) {
  if (ms == null) return '—';
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0');
  return m ? `${m}:${s}` : s;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(iso, withYear = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ' ' + d.getUTCFullYear() : ''}`;
}
/** UTC timestamp rendered server-side, re-rendered in the viewer's timezone by app.js. */
export const timeTag = (iso, fmt = 'datetime') =>
  iso ? `<time datetime="${esc(iso)}" data-local="${fmt}">${esc(fmtDate(iso))} ${esc(iso.slice(11, 16))} UTC</time>` : '—';

export const teamClass = (color) => (color ? `tc-${String(color).toLowerCase().replace(/[^0-9a-f]/g, '')}` : 'tc-none');
export const wClass = (p) => `w-${Math.max(0, Math.min(100, Math.round(p ?? 0)))}`;

/** Driver nationality flag via the PropSports media proxy (only for drivers with a verified flag image). */
export function flag(d) {
  return d?.flag_url && d?.slug ? `<img class="flag" src="${PROPSPORTS_F1}/media/flag/${esc(d.slug)}" alt="${esc(d.nationality || '')}" width="20" height="20" loading="lazy" decoding="async">` : '';
}

export function initials(name) {
  return esc(
    String(name || '?')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase(),
  );
}

export function headshot(d, size = 'md', ok = () => true, color) {
  const cls = `avatar avatar-${size} ${teamClass(color)}`;
  if (d?.headshot_url && ok(d.headshot_url)) {
    const px = size === 'lg' ? 240 : size === 'md' ? 96 : 48;
    return `<span class="${cls}"><img src="${PROPSPORTS_F1}/media/headshot/${esc(d.slug)}" alt="${esc(d.full_name)}" width="${px}" height="${px}" loading="lazy" decoding="async" data-fallback="${initials(d.full_name)}"></span>`;
  }
  return `<span class="${cls} avatar-initials" aria-hidden="true">${initials(d?.full_name)}</span>`;
}

export function confBadge(c) {
  const map = { high: 'High', medium: 'Medium', low: 'Low', insufficient: 'Insufficient sample' };
  return `<span class="conf conf-${esc(c)}">${esc(map[c] || c)}</span>`;
}

export function pctBar(p, opts = {}) {
  if (p == null) return `<div class="bar bar-empty" aria-label="No percentile"><span></span></div>`;
  const tone = p >= 75 ? 'hi' : p >= 40 ? 'mid' : 'lo';
  return `<div class="bar bar-${tone}" role="img" aria-label="${p}th percentile"><span class="${wClass(p)}"></span>${opts.label === false ? '' : `<b>${p}</b>`}</div>`;
}

export function crumbs(items) {
  return `<nav class="crumbs" aria-label="Breadcrumb">${items.map(([h, t], i) => (i === items.length - 1 ? `<span aria-current="page">${esc(t)}</span>` : `<a href="${h}">${esc(t)}</a>`)).join('<span class="sep">/</span>')}</nav>`;
}

export function jsonLdBreadcrumb(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([h, t], i) => ({ '@type': 'ListItem', position: i + 1, name: t, item: SITE + h })),
  };
}

const NAV = [
  ['/', 'Home'],
  ['/races', 'Races'],
  ['/standings', 'Standings'],
  ['/drivers', 'Drivers'],
  ['/teams', 'Teams'],
  ['/circuits', 'Circuits'],
  ['/matchups', 'Matchups'],
  ['/pbecast', 'PBEcast'],
  ['/news', 'Intelligence'],
];
const NETWORK = [
  ['https://propbetedge.ai', 'Sports News'],
  ['https://mlb.propbetedge.ai', 'MLB'],
  ['https://nfl.propbetedge.ai', 'NFL'],
  ['https://nba.propbetedge.ai', 'NBA'],
  ['https://nhl.propbetedge.ai', 'NHL'],
  ['https://ufc.propbetedge.ai', 'UFC'],
  ['https://wnba.propbetedge.ai', 'WNBA'],
  ['https://golf.propbetedge.ai', 'Golf'],
  ['https://tennis.propbetedge.ai', 'Tennis'],
  ['https://soccer.propbetedge.ai', 'Soccer'],
  ['https://boxing.propbetedge.ai', 'Boxing'],
];

export function layout({ path, title, description, body, jsonLd = [], noindex = false, ogType = 'website', section, assets, liveBadge = true }) {
  const canonical = SITE + (path === '/' ? '/' : path.replace(/\/$/, ''));
  const fullTitle = path === '/' ? title : `${title} | PropBetEdge F1`;
  const active = section || '/' + (path.split('/')[1] || '');
  const nav = NAV.map(([h, t]) => `<a href="${h}"${(h === '/' ? active === '/' : active === h) ? ' aria-current="page"' : ''}>${t}</a>`).join('');
  const ld = jsonLd.length ? jsonLd.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('') : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
${noindex ? '<meta name="robots" content="noindex,follow">' : '<meta name="robots" content="index,follow,max-image-preview:large">'}
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="PropBetEdge F1">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#06070a">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/barlow-condensed-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${assets.css}">
<script src="${assets.js}" defer></script>
${ld}
</head>
<body data-path="${esc(path)}">
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="masthead wrap">
    <a class="brand" href="/" aria-label="PropBetEdge F1 home"><span class="brand-mark" aria-hidden="true"></span><span class="brand-pbe">PROPBETEDGE</span><span class="brand-f1">F1</span></a>
    ${liveBadge ? '<a class="live-pill" href="/pbecast" data-live-pill hidden><span class="dot"></span><span data-live-text>LIVE</span></a>' : ''}
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="primary-nav" data-menu><span></span><span></span><span></span><span class="sr">Menu</span></button>
  </div>
  <nav class="primary-nav" id="primary-nav" aria-label="Primary"><div class="wrap nav-inner">${nav}</div></nav>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <a class="brand brand-sm" href="/"><span class="brand-mark" aria-hidden="true"></span><span class="brand-pbe">PROPBETEDGE</span><span class="brand-f1">F1</span></a>
      <p class="fine">Formula 1 intelligence built only from sourced data. DATA · <a href="https://propsports.proptechusa.ai" rel="noopener">PropSports</a>. DNA, Circuit Fit and matchups are PropBetEdge calculations — descriptive, not predictions. Not affiliated with Formula 1, the FIA or any team.</p>
      <p class="fine"><a href="/methodology">Methodology &amp; sources</a> · <a href="/data-coverage">Data coverage</a></p>
    </div>
    <nav aria-label="PropBetEdge network" class="network">${NETWORK.map(([h, t]) => `<a href="${h}">${t}</a>`).join('')}<a href="${DISCORD}" rel="noopener">Discord</a></nav>
  </div>
  <div class="wrap fine copy">© ${new Date().getUTCFullYear()} PropBetEdge. F1, FORMULA 1 and related marks are trademarks of Formula One Licensing B.V.</div>
</footer>
</body>
</html>`;
}

/** Simple multi-series SVG line chart (championship progression). series: [{name, color, points:[y...]}] */
export function lineChart({ series, labels, height = 300, yLabel = 'Points', invert = false, maxY }) {
  const W = 960;
  const H = height;
  const pad = { l: 44, r: 120, t: 14, b: 30 };
  const n = labels.length;
  if (!n || !series.length) return '';
  const ymax = maxY ?? Math.max(1, ...series.flatMap((s) => s.points.filter((v) => v != null)));
  const ymin = invert ? 1 : 0;
  const x = (i) => pad.l + (n === 1 ? 0 : (i * (W - pad.l - pad.r)) / (n - 1));
  const y = (v) => (invert ? pad.t + ((v - ymin) * (H - pad.t - pad.b)) / Math.max(1, ymax - ymin) : H - pad.b - (v * (H - pad.t - pad.b)) / ymax);
  const grid = [];
  const ticks = invert ? [1, 5, 10, 15, 20].filter((t) => t <= ymax) : [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * ymax));
  for (const t of ticks) grid.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${pad.l - 8}" y="${y(t) + 4}" class="tick" text-anchor="end">${t}</text>`);
  const step = Math.max(1, Math.ceil(n / 12));
  const xl = labels.map((l, i) => (i % step === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 8}" class="tick" text-anchor="middle">${esc(l)}</text>` : '')).join('');
  const lines = series
    .map((s) => {
      const pts = s.points.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
      const lastIdx = s.points.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).at(-1);
      if (!pts.length) return '';
      const lx = x(lastIdx);
      const ly = y(s.points[lastIdx]);
      return `<g class="series"><polyline points="${pts.join(' ')}" fill="none" stroke="#${s.color || '8b93a7'}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${lx}" cy="${ly}" r="3.5" fill="#${s.color || '8b93a7'}"/><text x="${lx + 8}" y="${ly + 4}" class="lbl" fill="#${s.color || '8b93a7'}">${esc(s.name)}</text></g>`;
    })
    .join('');
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yLabel)} by round" preserveAspectRatio="xMidYMid meet">${grid.join('')}${xl}${lines}</svg></figure>`;
}

export function dnaRadar(dims, color = 'ff4d2e', size = 220) {
  const keys = Object.keys(dims);
  const n = keys.length;
  if (n < 3) return '';
  const c = size / 2;
  const R = size / 2 - 28;
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [c + Math.cos(a) * R * v, c + Math.sin(a) * R * v];
  };
  const rings = [0.25, 0.5, 0.75, 1].map((r) => `<polygon points="${keys.map((_, i) => pt(i, r).join(',')).join(' ')}" class="ring"/>`).join('');
  const spokes = keys.map((_, i) => `<line x1="${c}" y1="${c}" x2="${pt(i, 1)[0]}" y2="${pt(i, 1)[1]}" class="spoke"/>`).join('');
  const vals = keys.map((k, i) => pt(i, (dims[k].percentile ?? 0) / 100).join(',')).join(' ');
  const labels = keys
    .map((k, i) => {
      const [lx, ly] = pt(i, 1.17);
      return `<text x="${lx}" y="${ly}" class="rlbl" text-anchor="middle" dominant-baseline="middle">${esc(dims[k].short || dims[k].label.split(' ')[0])}</text>`;
    })
    .join('');
  return `<svg class="radar" viewBox="0 0 ${size} ${size}" role="img" aria-label="DNA percentile profile">${rings}${spokes}<polygon points="${vals}" fill="#${color}" fill-opacity=".22" stroke="#${color}" stroke-width="2"/>${labels}</svg>`;
}
