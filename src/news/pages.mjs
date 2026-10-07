// Newsroom index, homepage module, RSS feed and news sitemap.
import { CLASS_LABEL } from './render.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
// stories ordered by the session they describe (newest first), not by build time: a backfill keeps race order
export const order = (list, X) => [...list].sort((a, b) => (sessionTime(b, X)).localeCompare(sessionTime(a, X)) || b.slug.localeCompare(a.slug));
function sessionTime(a, X) {
  const type = a.class === 'qualifying' ? 'qualifying' : 'race';
  const s = X.session(a.event_id, type);
  // a preview or a pre-weekend market story sorts at its own publication, ahead of the race it is about; a championship
  // update sorts just after its round's race final
  if (a.class === 'preview' || a.class === 'market_move') return a.published_at;
  if (a.class === 'championship') return s?.start_utc ? new Date(Date.parse(s.start_utc) + 1000).toISOString() : a.published_at;
  return s?.start_utc || a.published_at;
}

export function storyCard(a, { lead = false } = {}) {
  return `<a class="nstory${lead ? ' nstory--lead' : ''}" href="/news/${esc(a.slug)}"><img src="/news/cards/${esc(a.slug)}.webp" width="960" height="504" alt="" loading="${lead ? 'eager' : 'lazy'}" decoding="async"><span class="kicker">${a.archive ? 'Archive · ' : ''}${esc(CLASS_LABEL[a.class] || 'Story')} · ${esc(day(a.published_at))}</span><h3>${esc(a.headline)}</h3>${lead ? `<p>${esc(a.dek)}</p>` : ''}</a>`;
}

export function newsIndexPage(pub, X) {
  const list = order(pub, X);
  // the lead strip never features an archived (expired) preview; it stays in its class section with an Archive label
  const [lead, ...rest] = list.filter((a) => a.archive !== 'expired_preview');
  const byClass = (c) => list.filter((a) => a.class === c);
  const body = `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span class="sep">/</span><span aria-current="page">News</span></nav>
<section class="hero"><div class="wrap"><span class="eyebrow">PropBetEdge F1 Desk</span><h1>F1 news &amp; intelligence</h1><p class="sub">Race finals, qualifying, previews, championship updates and market moves written from frozen fact packets: every number and name traces to the data, and every story links into Driver DNA, Circuit DNA, the race and PBEcast.</p></div></section>
<section class="section"><div class="wrap">${lead ? `<div class="nlead">${storyCard(lead, { lead: true })}<div class="ngrid ngrid--side">${rest.slice(0, 3).map((a) => storyCard(a)).join('')}</div></div>` : '<p class="muted">The first stories publish after the next session.</p>'}</div></section>
${['race_final', 'qualifying', 'preview', 'championship', 'market_move'].map((c) => byClass(c).length ? `<section class="section"><div class="wrap"><div class="section-head"><h2>${esc({ race_final: 'Race finals', qualifying: 'Qualifying', preview: 'Previews', championship: 'Championship', market_move: 'Market moves' }[c])}</h2></div><div class="ngrid">${byClass(c).map((a) => storyCard(a)).join('')}</div></div></section>` : '').join('')}`;
  return { path: '/news', title: 'F1 News: Race Finals, Qualifying & Previews', description: 'Data-led Formula 1 news from PropBetEdge: race finals, qualifying recaps and race previews built from verified results, Driver DNA, Circuit DNA and championship data.', body, section: '/news', jsonLd: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'PropBetEdge F1 News', url: 'https://f1.propbetedge.ai/news' }] };
}

export function homeModule(pub, X) {
  const list = order(pub.filter((a) => a.archive !== 'expired_preview'), X).slice(0, 5);
  if (!list.length) return '';
  const [lead, ...rest] = list;
  return `<section class="section"><div class="wrap"><div class="section-head"><h2>Latest F1 intelligence</h2><a class="more" href="/news">All stories →</a></div><div class="nlead">${storyCard(lead, { lead: true })}<div class="ngrid ngrid--side">${rest.map((a) => storyCard(a)).join('')}</div></div></div></section>`;
}

export function feedXml(pub, X, site) {
  const list = order(pub, X).slice(0, 40);
  const item = (a) => `<item><title>${esc(a.headline)}</title><link>${site}/news/${a.slug}</link><guid isPermaLink="true">${site}/news/${a.slug}</guid><pubDate>${new Date(a.published_at).toUTCString()}</pubDate><category>${esc(CLASS_LABEL[a.class])}</category><description>${esc(a.dek)}</description><enclosure url="${site}/news/cards/${a.slug}.jpg" type="image/jpeg" length="0"/></item>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>PropBetEdge F1 News</title><link>${site}/news</link><atom:link href="${site}/feed.xml" rel="self" type="application/rss+xml"/><description>Data-led Formula 1 race finals, qualifying and previews.</description><language>en</language>${list.map(item).join('')}</channel></rss>\n`;
}

// Google News sitemap: only stories published in the last 48 hours about a session that ended within 72 hours of
// publication. Archive backfills (older events, a.archive) and archived previews are in the regular sitemap only.
export function newsSitemapXml(pub, X, site, now = new Date().toISOString()) {
  const fresh = pub.filter((a) => {
    if (Date.parse(now) - Date.parse(a.published_at) > 48 * 3600e3) return false;
    if (a.archive || a.packet?.context?.temporal?.archive_backfill) return false;
    if (a.class === 'preview') return true;
    const s = X.session(a.event_id, a.class === 'qualifying' ? 'qualifying' : 'race');
    return s?.start_utc && Date.parse(a.published_at) - Date.parse(s.start_utc) <= 72 * 3600e3;
  });
  return { count: fresh.length, xml: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${fresh.map((a) => `<url><loc>${site}/news/${a.slug}</loc><news:news><news:publication><news:name>PropBetEdge F1</news:name><news:language>en</news:language></news:publication><news:publication_date>${a.published_at}</news:publication_date><news:title>${esc(a.headline)}</news:title></news:news></url>`).join('\n')}\n</urlset>\n` };
}
