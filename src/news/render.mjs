// Article page rendering (static HTML in the site's design system). Charts are SVG data visualisations built from the
// packet's chart data; text comes from validated token drafts. Nothing here adds a fact.
import { segments, render as renderPlain, resolveHref } from './validate.mjs';
import { venueDay } from './temporal.mjs';
import { articleMarketEvent } from './market.mjs';
import { articleMarketModule } from '../vendor/kalshi/article-market-ui.js';

// Archive frame shown under the dateline: a story first published after its session (backfill), or a preview whose
// race has since started. States the publication moment against the event moment; never backdates.
export function archiveNote(a) {
  const tf = a.packet.context.temporal;
  if (!a.archive || !tf) return '';
  const circ = a.packet.entities.find((x) => x.key === 'circuit')?.ref;
  const day = (iso) => venueDay(iso, circ);
  const pub = new Date(a.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (a.archive === 'expired_preview') return `Archived preview: written before the race, which was held on ${day(tf.race_start)}. The result is on the race page.`;
  if (a.class === 'qualifying') return `Archive report, published ${pub} after the race of ${day(tf.race_start)}. It describes the picture at the end of qualifying on ${day(tf.qualifying_start)}.`;
  return `Archive report, published ${pub}. It describes the race of ${day(tf.race_start)} and the championship as it stood after it.`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const CLASS_LABEL = { race_final: 'Race final', qualifying: 'Qualifying', preview: 'Race preview', sprint_final: 'Sprint final', circuit_intel: 'Circuit intelligence', driver_intel: 'Driver intelligence', teammate_battle: 'Teammate battle', championship: 'Championship update', market_move: 'Market move' };

// token text -> HTML with entity links (only to pages that exist; see linkOk)
export function html(text, packet, linkOk = () => true) {
  return segments(text, packet, (x) => { const h = resolveHref(x); return h && linkOk(h) ? h : null; })
    .map((s) => (s.t === 'link' ? `<a href="${esc(s.href)}">${esc(s.v)}</a>` : s.t === 'fact' ? `<span class="fv">${esc(s.v)}</span>` : esc(s.v)))
    .join('');
}

function bars(rows, { valueOf, label, fmt, max }) {
  const m = max ?? Math.max(...rows.map(valueOf), 1);
  return `<figure class="nchart nbars"><ol>${rows.map((r) => { const v = valueOf(r); const w = Math.max(2, Math.round((100 * v) / m)); return `<li><span class="nb-l">${esc(r.code || r.name || '')}</span><span class="nb-t"><i class="w-${w} ${teamCls(r.color)}"></i></span><span class="nb-v">${esc(fmt(v, r))}</span></li>`; }).join('')}</ol><figcaption>${esc(label)}</figcaption></figure>`;
}
const teamCls = (c) => (c ? `tc-${String(c).toLowerCase().replace(/[^0-9a-f]/g, '')}` : 'tc-none');

function slope(rows, label) {
  const n = Math.max(...rows.flatMap((r) => [r.grid, r.finish]), 10);
  const W = 640, H = 22 * n + 30, x0 = 120, x1 = 520, y = (p) => 18 + (p - 1) * 22;
  return `<figure class="nchart"><svg viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false" width="100%" height="${H}" preserveAspectRatio="xMinYMin meet"><text x="${x0}" y="12" text-anchor="middle" class="nc-h">GRID</text><text x="${x1}" y="12" text-anchor="middle" class="nc-h">FINISH</text>${rows.map((r) => `<line x1="${x0}" y1="${y(r.grid)}" x2="${x1}" y2="${y(r.finish)}" stroke="#${esc(r.color || '8a90a0')}" stroke-width="2.5" opacity=".9"/><circle cx="${x0}" cy="${y(r.grid)}" r="4" fill="#${esc(r.color || '8a90a0')}"/><circle cx="${x1}" cy="${y(r.finish)}" r="4" fill="#${esc(r.color || '8a90a0')}"/><text x="${x0 - 12}" y="${y(r.grid) + 4}" text-anchor="end" class="nc-l">P${r.grid} ${esc(r.code || '')}</text><text x="${x1 + 12}" y="${y(r.finish) + 4}" class="nc-l">P${r.finish} ${esc(r.code || '')}</text>`).join('')}</svg><figcaption>${esc(label)}</figcaption></figure>`;
}

function line(chart) {
  const W = 480, H = 260, L = 40, R = 104, T = 12, B = 28;
  const xs = chart.x, all = chart.series.flatMap((s) => s.values).filter((v) => v != null);
  const maxY = Math.max(...all, 1);
  const px = (i) => L + ((W - L - R) * i) / Math.max(1, xs.length - 1), py = (v) => T + (H - T - B) * (1 - v / maxY);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${py(maxY * f).toFixed(1)}" y2="${py(maxY * f).toFixed(1)}" class="nc-g"/><text x="${L - 6}" y="${(py(maxY * f) + 4).toFixed(1)}" text-anchor="end" class="nc-a">${Math.round(maxY * f)}</text>`).join('');
  // end labels: sorted by value and pushed apart so close finishes never overprint
  const labels = chart.series.map((s) => ({ s, v: s.values.at(-1) })).filter((x) => x.v != null).map((x) => ({ ...x, y: py(x.v) + 4 })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
  const paths = chart.series.map((s) => {
    const pts = s.values.map((v, i) => (v == null ? null : `${px(i).toFixed(1)},${py(v).toFixed(1)}`)).filter(Boolean);
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="#${esc(s.color || 'c6ccd9')}" stroke-width="2.5" stroke-linejoin="round"/>`;
  }).join('') + labels.map((l) => `<text x="${W - R + 8}" y="${l.y.toFixed(1)}" class="nc-l" fill="#${esc(l.s.color || 'c6ccd9')}">${esc(l.s.name?.split(' ').slice(-1)[0] || '')} ${l.v}</text>`).join('');
  const ticks = xs.map((r, i) => (i % Math.ceil(xs.length / 8) === 0 || i === xs.length - 1 ? `<text x="${px(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="nc-a">R${r}</text>` : '')).join('');
  return `<figure class="nchart"><svg viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false" width="100%" height="${H}" preserveAspectRatio="xMinYMin meet">${grid}${paths}${ticks}</svg><figcaption>${esc(chart.title)} (points by round)</figcaption></figure>`;
}

function table(chart, kind, link) {
  if (kind === 'classification') {
    return `<div class="table-wrap"><table class="ntable"><thead><tr><th class="pos">Pos</th><th>Driver</th><th>Team</th><th class="num">Grid</th><th class="num">Time / gap</th><th class="num">Pts</th></tr></thead><tbody>${chart.rows.map((r) => `<tr${r.pos ? '' : ' class="dim"'}><td class="pos">${r.pos ?? (r.status === 'retired' ? 'DNF' : esc(r.status || '—').toUpperCase().slice(0, 3))}</td><td>${link(`/drivers/${r.driver_id}`, r.name)}</td><td>${link(`/teams/${r.team_id}`, r.team)}</td><td class="num">${r.grid ?? '—'}</td><td class="num">${r.status === 'retired' ? `Out, lap ${r.laps ?? '—'}` : esc(r.time || '—')}</td><td class="num">${r.points || ''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  return `<div class="table-wrap"><table class="ntable"><thead><tr><th class="pos">Pos</th><th>Driver</th><th>Team</th><th class="num">Q1</th><th class="num">Q2</th><th class="num">Q3</th></tr></thead><tbody>${chart.rows.map((r) => `<tr><td class="pos">${r.pos}</td><td>${link(`/drivers/${r.driver_id}`, r.name)}</td><td>${link(`/teams/${r.team_id}`, r.team)}</td><td class="num">${esc(r.q1 || '—')}</td><td class="num">${esc(r.q2 || '—')}</td><td class="num">${esc(r.q3 || '—')}</td></tr>`).join('')}</tbody></table></div>`;
}

export function moduleHtml(id, packet, link) {
  const c = packet.chart_data[id];
  if (id === 'pbecast') return `<a class="ncard-cast" href="/pbecast/${esc(packet.context.replay)}"><span class="kicker">PBEcast</span><b>Replay the race</b><span>Car progress from recorded timing observations</span></a>`;
  if (!c) return '';
  if (c.kind === 'line') return line(c);
  if (c.kind === 'slope') return slope(c.rows, c.title);
  if (c.kind === 'table') return table(c, id === 'classification' ? 'classification' : 'quali', link);
  if (c.kind === 'bars' && id === 'quali_gaps') return bars(c.rows, { valueOf: (r) => r.value_ms / 1000, label: c.title, fmt: (v) => (v === 0 ? 'POLE' : `+${v.toFixed(3)}s`) });
  if (c.kind === 'bars') return bars(c.rows, { valueOf: (r) => r.value, label: c.title, fmt: (v) => String(v), max: 100 });
  return '';
}

// MARKET (article-market/1): one module with a lifecycle (LIVE MARKET WATCH -> THE MARKET RESULT) after the first
// editorial section, only on a story first published at/after the activation time and linked to its main race market.
// The slot is an empty element (no box, no reserved space); src/web/article-market.js fills it client-side from the
// same-origin markets rewrite. Live prices are never baked into the page; nothing observed -> nothing rendered.
// Once the packet is FINAL and stored on the story (market.frozen, EMBED_THIS_PACKET) the page renders THE MARKET
// RESULT from that stored copy at build time (first paint, no request, never re-read).
export function articleMarketSlot(a) {
  const id = articleMarketEvent(a);
  if (!id) return '';
  const focus = a.market.focus?.length ? a.market.focus : null;
  const fz = a.market.frozen;
  const inner = fz?.payload ? articleMarketModule(fz.payload, { placement: 'f1-article', focus }) : '';
  return `<div class="nmarket" data-art-market="${esc(id)}" data-published="${esc(a.published_at)}"${focus ? ` data-focus="${esc(focus.join(','))}"` : ''}${inner ? ` data-am-frozen="${esc(fz.sha256)}"` : ''}>${inner}</div>`;
}

// article -> page object for layout()
export function articlePage(a, { linkOk, related = [], site }) {
  const P = a.packet, d = a.draft;
  const link = (href, text) => (linkOk(href) ? `<a href="${esc(href)}">${esc(text)}</a>` : esc(text));
  // chips: the story's core subjects only (comparison circuits and archive races stay in the prose)
  const CORE = /^(race|circuit|orig_race|p1|p2|p3|p1_team|q1|q2|q1_team|leader|c2|leader_team|fit1|mover|mover_team|con1)$/;
  const ents = P.entities.filter((x) => CORE.test(x.key) && ['driver', 'team', 'circuit', 'race'].includes(x.type)).filter((x, i, arr) => arr.findIndex((y) => y.ref === x.ref && y.type === x.type) === i);
  const chips = ents.slice(0, 8).map((x) => { const h = resolveHref(x); return linkOk(h) ? `<a class="chip" href="${esc(h)}">${esc(x.name)}</a>` : ''; }).join('');
  const hl = renderPlain(d.headline, P), dk = renderPlain(d.dek, P);
  const slot = articleMarketSlot(a);
  const sections = d.sections.map((s, i) => `<section class="nsec">${s.heading ? `<h2>${esc(s.heading)}</h2>` : ''}${(s.paragraphs || []).map((p) => `<p>${html(p, P, linkOk)}</p>`).join('')}${s.module ? moduleHtml(s.module, P, link) : ''}</section>${i === 0 ? slot : ''}`).join('');
  const used = new Set(a.validation.facts_used);
  const evidence = P.facts.filter((f) => used.has(f.id)).map((f) => `<li><b>${esc(f.label)}</b>: ${esc(f.display)} <span class="muted">(${esc(f.source)})</span></li>`).join('');
  const relatedLinks = [
    ...P.entities.filter((x) => x.type === 'driver' && /^(p1|p2|p3|q1|q2|leader|c2|fit1|mover)$/.test(x.key)).map((x) => [resolveHref(x), `${x.name}: Driver DNA & career`]),
    ...P.entities.filter((x) => x.type === 'team' && /^(p1_team|q1_team)$/.test(x.key)).map((x) => [resolveHref(x), `${x.name}: Constructor DNA`]),
    ...P.entities.filter((x) => x.type === 'circuit' && x.key === 'circuit').map((x) => [resolveHref(x), `${x.name}: Circuit DNA & history`]),
    ...P.entities.filter((x) => x.type === 'race' && x.key === 'race').map((x) => [resolveHref(x), `${x.name}: sessions & results`]),
    ...P.entities.filter((x) => x.type === 'matchup').slice(0, 2).map((x) => [resolveHref(x), `${x.name}: teammate matchup`]),
    ['/standings', 'Championship standings'],
    [P.context.replay ? `/pbecast/${P.context.replay}` : '/pbecast', P.context.replay ? 'PBEcast replay' : 'PBEcast live timing'],
    ['/intelligence', 'F1 Intelligence hub'],
  ].filter(([h], i, arr) => h && linkOk(h) && arr.findIndex(([x]) => x === h) === i);
  const body = `<nav class="crumbs ncrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span class="sep">/</span><a href="/news">News</a><span class="sep">/</span><span aria-current="page">${esc(CLASS_LABEL[a.class] || 'Story')}</span></nav>
<article class="narticle">
  <header class="nhero wrap">
    <span class="eyebrow">${a.archive ? 'Archive · ' : ''}${esc(CLASS_LABEL[a.class] || 'Story')}${a.status !== 'published' ? ` · ${esc(a.status.toUpperCase())}` : ''}</span>
    <h1>${html(d.headline, P, () => false)}</h1>
    <p class="ndek">${html(d.dek, P, linkOk)}</p>
    <p class="nmeta"><span>By the PropBetEdge F1 Desk</span> · <time datetime="${esc(a.published_at)}">${esc(new Date(a.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }))}</time>${a.modified_at && a.modified_at !== a.published_at ? ` · updated <time datetime="${esc(a.modified_at)}">${esc(new Date(a.modified_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }))}</time>` : ''}</p>${archiveNote(a) ? `
    <p class="note narchive">${esc(archiveNote(a))}</p>` : ''}
    <div class="nchips">${chips}</div>
    <img class="ncard" src="/news/cards/${esc(a.slug)}.webp" width="1200" height="630" alt="${esc(hl)}" decoding="async" fetchpriority="low">
  </header>
  <div class="nbody wrap">${sections}
    <aside class="nrelated"><h2>Go deeper</h2><ul>${relatedLinks.map(([h, t]) => `<li><a href="${esc(h)}">${esc(t)}</a></li>`).join('')}</ul></aside>
    ${related.length ? `<aside class="nrelated"><h2>Related stories</h2><ul>${related.map((r) => `<li><a href="/news/${esc(r.slug)}">${esc(r.headline)}</a></li>`).join('')}</ul></aside>` : ''}
    <details class="nevidence"><summary>Evidence &amp; methodology</summary><div class="nev-body"><p>Every number and name in this story comes from a frozen fact packet built from the PropSports F1 data plane. The draft passed the factual gate (no unsupported numbers, names, causes or outcomes) and the editorial gate before publication.</p><dl class="nev-meta"><div><dt>Packet</dt><dd><code>${esc(P.hash)}</code></dd></div><div><dt>Factual gate</dt><dd>${esc(a.validation.gate)}</dd></div>${a.editorial ? `<div><dt>Editorial gate</dt><dd>${esc(a.editorial.version)}</dd></div>` : ''}${a.composer ? `<div><dt>Composer</dt><dd>${esc(a.composer)}</dd></div>` : ''}</dl>${P.limits.length ? `<h3>Limits</h3><ul>${P.limits.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}<h3>Facts used (${used.size})</h3><ul class="nev-rows">${evidence}</ul></div></details>
  </div>
</article>`;
  const mentions = P.entities.filter((x) => x.type === 'driver').slice(0, 8).map((x) => ({ '@type': 'Person', name: x.name, url: `${site}/drivers/${x.ref}` }));
  const race = P.entities.find((x) => x.key === 'race');
  const jsonLd = [
    { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: hl.slice(0, 110), description: dk, datePublished: a.published_at, dateModified: a.modified_at || a.published_at, image: [`${site}/news/cards/${a.slug}.jpg`], author: { '@type': 'Organization', name: 'PropBetEdge F1 Desk', url: `${site}/news` }, publisher: { '@type': 'Organization', name: 'PropBetEdge', logo: { '@type': 'ImageObject', url: `${site}/favicon.svg` } }, mainEntityOfPage: `${site}/news/${a.slug}`, articleSection: CLASS_LABEL[a.class], about: race ? { '@type': 'SportsEvent', name: race.name, url: `${site}/races/${race.ref}`, sport: 'Formula 1' } : undefined, mentions },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [['/', 'Home'], ['/news', 'News'], [`/news/${a.slug}`, hl]].map(([p, n], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: site + p })) },
  ];
  return { path: `/news/${a.slug}`, title: renderPlain(d.seo_title, P), description: renderPlain(d.seo_description, P), body, jsonLd, ogType: 'article', ogImage: `${site}/news/cards/${a.slug}.jpg`, ogImageAlt: hl, article: { published: a.published_at, modified: a.modified_at || a.published_at, section: CLASS_LABEL[a.class] }, section: '/news', noindex: a.status !== 'published', bg: 'data', articleMarket: !!slot && !slot.includes('data-am-frozen') };
}
