// Newsroom build: projection -> frozen fact packets -> desk drafts -> publication gates -> article records, cards and
// projection documents (news-index + news-<slug>). Runs after build-projection, before build-site.
//
// Publication dates are frozen: an article already in the live news index keeps its published_at; modified_at moves only
// when the packet content (hash) changes. A preview is never first-published after its race has started (stale).
//
// Time (see src/news/temporal.mjs): the copy is framed at the story's FIRST publication (frozen published_at, or now for
// a first publication). A qualifying story first published after its race started, or a race final first published
// >72h after the race, is an archive backfill: retrospective copy, an archive label, and no Google News entry. A
// published preview whose race has since started stays at its URL as an archived preview. Never backdated.
//
// Off-event lanes (src/news/newsroom.mjs): championship updates after each round and market moves from stored Kalshi
// observations, both time-boxed and never first-published late. Every run writes a health record (news-health doc,
// data/news/health.json): last run, candidates, evaluations, last publication, next expected evaluation.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { loadProjection } from '../src/news/data.mjs';
import { cardSvg, renderCard, headshotData } from '../src/news/card.mjs';
import { CLASS_LABEL } from '../src/news/render.mjs';
import { articleMarketEvent, freezable, indexMarket, MARKETS_BASE } from '../src/news/market.mjs';
import { buildCandidates, decide, newsroomHealth } from '../src/news/newsroom.mjs';
import { QUALITY_VERSION } from '../src/news/validate.mjs';

const BASE = process.env.PROPSPORTS_F1_BASE || 'https://propsports.proptechusa.ai/v1/f1';
const NOW = process.env.F1_NEWS_NOW || new Date().toISOString();
const OUT = path.resolve('data/news');
const PROJ = path.resolve('data/projection');
fs.mkdirSync(path.join(OUT, 'cards'), { recursive: true });
const classes = JSON.parse(fs.readFileSync('src/news/classes.json', 'utf8'));
const X = loadProjection();
const getJson = async (url, tries = 1) => {
  for (let i = 1; i <= tries; i++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (r.ok) return await r.json(); if (r.status === 404) return null; } catch { /* retry */ }
  }
  return undefined; // undefined = the read failed (vs null = not found)
};

// live index (frozen publication dates). A 404 (no index yet) means a first publication. A FAILED read stops the build:
// treating an outage as "nothing published" would re-stamp every story's published_at with this build's time.
let live = {};
const idx = await getJson(`${BASE}/news`, 3);
if (idx === undefined && !process.env.F1_NEWS_OFFLINE) { console.error('build-news: live news index unreadable; refusing to reset frozen publication dates (set F1_NEWS_OFFLINE=1 for a local run)'); process.exit(1); }
for (const a of idx?.articles || []) live[a.slug] = a;
// frozen classes are carried forward from their published record; a failed read must fail the build, never rebuild the
// story from today's data (buildCandidates throws when a published frozen story has no stored record)
const liveDocs = {};
for (const a of Object.values(live).filter((x) => x.class === 'market_move')) {
  const d = await getJson(`${BASE}/news/${a.slug}`, 3);
  if (d) liveDocs[a.slug] = d;
}
// stored Kalshi observations for the market lane (null on failure: the lane reports market_tape_unavailable, others run)
const tape = classes.market_move && classes.market_move.mode !== 'off' ? (await getJson(`${MARKETS_BASE}/v1/market-tape?sport=f1`, 2)) || null : null;

// one article-market read (the story's ORIGINAL publication time + its focus drivers); null on any failure
async function readArticleMarket(a) {
  try {
    const id = articleMarketEvent(a);
    const focus = a.market.focus?.length ? `&focus=${encodeURIComponent(a.market.focus.join(','))}` : '';
    const r = await fetch(`${MARKETS_BASE}/v1/article-market/f1/${encodeURIComponent(id)}?published_at=${encodeURIComponent(a.published_at)}${focus}`, { signal: AbortSignal.timeout(20000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

const { candidates, evaluations } = buildCandidates(X, classes, { now: NOW, live, liveDocs, tape });
const { articles, report } = decide(X, classes, candidates, { now: NOW, live, evaluations });
const health = newsroomHealth({ now: NOW, articles, report, live });

// cards (published + shadow, so a widened class has its images ready); cached by packet hash
const cache = path.join(OUT, 'media');
for (const a of articles.filter((x) => x.status === 'published' || x.status === 'shadow')) {
  const key = crypto.createHash('sha256').update(`${a.packet_hash}|${a.headline}|card@2`).digest('hex').slice(0, 12);
  const jpg = path.join(OUT, 'cards', `${a.slug}.jpg`), webp = path.join(OUT, 'cards', `${a.slug}.webp`), stamp = path.join(OUT, 'cards', `${a.slug}.key`);
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === key && fs.existsSync(jpg)) continue;
  const lead = ['mover', 'p1', 'q1', 'leader'].map((k) => a.packet.entities.find((x) => x.key === k)).find(Boolean);
  const teamKey = { p1: 'p1_team', q1: 'q1_team' }[lead?.key];
  const color = X.con[a.packet.entities.find((x) => x.key === teamKey)?.ref]?.color || X.con[X.driver[lead?.ref]?.team_id]?.color || 'ff4d2e';
  const hs = lead ? await headshotData(lead.ref, { base: BASE, cacheDir: cache }) : null;
  const race = a.packet.entities.find((x) => x.key === 'race'), circ = a.packet.entities.find((x) => x.key === 'circuit');
  const date = ['race_date', 'quali_date'].map((id) => a.packet.facts.find((f) => f.id === id)).find(Boolean)?.display;
  const png = renderCard(cardSvg({ label: CLASS_LABEL[a.class], headline: a.headline, sub: [race?.name, circ?.name, date].filter(Boolean).join(' · '), color, headshot: hs }));
  fs.writeFileSync(jpg, await sharp(png).jpeg({ quality: 82, mozjpeg: true }).toBuffer());
  fs.writeFileSync(webp, await sharp(png).resize(960).webp({ quality: 78 }).toBuffer());
  fs.writeFileSync(stamp, key);
}

// article-market/1 freeze: once the shared API answers freeze = EMBED_THIS_PACKET (packet FINAL), the packet + sha256 are
// stored in the story's record (news doc) and the page renders from that stored copy forever; a stored packet is carried
// forward unchanged from the published doc and never re-read. A failed read just leaves the story live-reading.
for (const a of articles.filter((x) => x.status === 'published' && articleMarketEvent(x))) {
  const prevFrozen = live[a.slug]?.market?.frozen;
  const { frozen: _indexOnly, ...link } = a.market; // the index carries only the sha; the payload lives in the news doc
  a.market = link;
  if (prevFrozen?.sha256) {
    try {
      const r = await fetch(`${BASE}/news/${a.slug}`, { signal: AbortSignal.timeout(20000) });
      const doc = r.ok ? await r.json() : null;
      if (doc?.market?.frozen?.sha256 === prevFrozen.sha256 && doc.market.frozen.payload) { a.market = { ...a.market, frozen: doc.market.frozen }; continue; }
    } catch { /* fall through: re-read the (immutable) FINAL packet below */ }
  }
  const payload = await readArticleMarket(a);
  const frozen = freezable(a, payload);
  if (frozen) a.market = { ...a.market, frozen: { sha256: payload.packet.sha256, embedded_at: NOW, payload: frozen } };
  if (prevFrozen?.sha256 && a.market.frozen?.sha256 !== prevFrozen.sha256) console.warn(`  MARKET ${a.slug}: stored packet ${prevFrozen.sha256.slice(0, 12)} not carried forward this build (read ${a.market.frozen?.sha256?.slice(0, 12) || 'failed'})`);
  if (a.market.frozen) console.log(`  MARKET FROZEN ${a.slug}: ${a.market.frozen.sha256}`);
}

// outputs: full records for the site build; public index + per-article documents for the PropSports contract
fs.writeFileSync(path.join(OUT, 'articles.json'), JSON.stringify(articles));
fs.writeFileSync(path.join(OUT, 'canary-report.json'), JSON.stringify(report, null, 2));
const pub = articles.filter((a) => a.status === 'published');
const index = { generated_at: NOW, gate: QUALITY_VERSION, articles: pub.map((a) => ({ slug: a.slug, class: a.class, topic: a.topic, event_id: a.event_id, status: a.status, archive: a.archive, headline: a.headline, dek: a.dek, published_at: a.published_at, modified_at: a.modified_at, market: indexMarket(a.market), packet_hash: a.packet_hash, image: `/news/cards/${a.slug}.jpg`, entities: a.packet.entities.filter((x) => ['driver', 'team', 'circuit', 'race'].includes(x.type)).map((x) => ({ type: x.type, id: x.ref, name: x.name })) })).sort((a, b) => b.published_at.localeCompare(a.published_at) || b.slug.localeCompare(a.slug)) };
const docs = { 'news-index': index, 'news-health': health };
for (const a of pub) docs[`news-${a.slug}`] = { slug: a.slug, class: a.class, status: a.status, archive: a.archive, published_at: a.published_at, modified_at: a.modified_at, market: a.market || null, headline: a.headline, dek: a.dek, packet: a.packet, draft: a.draft, validation: a.validation };
for (const [n, d] of Object.entries(docs)) fs.writeFileSync(path.join(PROJ, `${n}.json`), JSON.stringify(d));
// register in the projection manifest; the version covers the news content too
const mf = JSON.parse(fs.readFileSync(path.join(PROJ, 'manifest.json'), 'utf8'));
mf.files = [...new Set([...mf.files.filter((f) => !f.startsWith('news-')), ...Object.keys(docs)])].sort();
mf.version = crypto.createHash('sha256').update(mf.version + JSON.stringify(docs)).digest('hex').slice(0, 16);
fs.writeFileSync(path.join(PROJ, 'manifest.json'), JSON.stringify(mf));
const by = (s) => articles.filter((a) => a.status === s).length;
fs.writeFileSync(path.join(OUT, 'health.json'), JSON.stringify(health, null, 2));
console.log(`news: ${articles.length} stories (${by('published')} published, ${by('shadow')} shadow, ${by('held')} held, ${by('stale')} stale); projection ${mf.version}`);
for (const [k, v] of Object.entries(report.classes)) console.log(`  ${k}: ${JSON.stringify(v)}`);
for (const s of report.stories.filter((x) => x.status === 'held')) console.log(`  HELD ${s.slug}: ${s.reasons.join('; ')}`);
for (const e of report.evaluations) console.log(`  EVAL ${e.class} ${e.event_id}: ${e.result}`);
console.log(`  health: ${health.outcome}; ${health.candidates} candidates; last publication ${health.last_publication?.published_at || 'none'} (${health.last_publication?.slug || '-'}); next evaluation by ${health.next_expected_evaluation}`);
for (const s of report.stories.filter((x) => x.status === 'published')) console.log(`  PUBLISHED ${s.slug}: ${s.words} words, ${s.links} links${s.warnings?.length ? ` (${s.warnings.join('; ')})` : ''}`);
