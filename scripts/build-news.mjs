// Newsroom build: projection -> frozen fact packets -> desk drafts -> publication gates -> article records, cards and
// projection documents (news-index + news-<slug>). Runs after build-projection, before build-site.
//
// Publication dates are frozen: an article already in the live news index keeps its published_at; modified_at moves only
// when the packet content (hash) changes. A preview is never first-published after its race has started (stale).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { loadProjection } from '../src/news/data.mjs';
import { raceFinalPacket } from '../src/news/race-final.mjs';
import { composeRaceFinal, RACE_COMPOSER_VERSION } from '../src/news/compose-race.mjs';
import { qualifyingPacket } from '../src/news/qualifying.mjs';
import { composeQualifying, QUALI_COMPOSER_VERSION } from '../src/news/compose-quali.mjs';
import { previewPacket } from '../src/news/preview.mjs';
import { composePreview, COMPOSER_VERSION as PREVIEW_COMPOSER_VERSION } from '../src/news/compose-preview.mjs';
import { editorialGate, EDITORIAL_VERSION } from '../src/news/quality.mjs';
import { validateDraft, render, QUALITY_VERSION } from '../src/news/validate.mjs';
import { cardSvg, renderCard, headshotData } from '../src/news/card.mjs';
import { CLASS_LABEL } from '../src/news/render.mjs';

const BASE = process.env.PROPSPORTS_F1_BASE || 'https://propsports.proptechusa.ai/v1/f1';
const NOW = process.env.F1_NEWS_NOW || new Date().toISOString();
const OUT = path.resolve('data/news');
const PROJ = path.resolve('data/projection');
fs.mkdirSync(path.join(OUT, 'cards'), { recursive: true });
const classes = JSON.parse(fs.readFileSync('src/news/classes.json', 'utf8'));
const X = loadProjection();

// live index (frozen publication dates). A missing index means a first publication, never an error that blocks a build.
let live = {};
try {
  const r = await fetch(`${BASE}/news`, { signal: AbortSignal.timeout(20000) });
  if (r.ok) for (const a of (await r.json()).articles || []) live[a.slug] = a;
} catch { /* first publication or offline: dates start now */ }

const SLUG = {
  race_final: (P) => `${P.entities.find((x) => x.key === 'p1').ref}-wins-${P.event_id}`,
  qualifying: (P) => `${P.event_id}-qualifying-results`,
  preview: (P) => `${P.event_id}-preview`,
};
const MIN_WORDS = { race_final: 400, qualifying: 300, preview: 400 };

const candidates = [];
for (const [cls, cfg] of Object.entries(classes)) {
  if (cls.startsWith('_') || cfg.mode === 'off') continue;
  for (const season of cfg.seasons) {
    for (const ev of X.raceEvents(season)) {
      let r;
      if (cls === 'race_final') r = raceFinalPacket(X, ev.id, { asOf: NOW });
      else if (cls === 'qualifying') r = qualifyingPacket(X, ev.id, { asOf: NOW });
      else if (cls === 'preview') {
        // a preview exists only for the next event that has not started (or one already published before its start)
        const race = X.session(ev.id, 'race');
        const already = live[`${ev.id}-preview`];
        if (!already && (!race?.start_utc || race.start_utc <= NOW || ev.status === 'completed')) continue;
        const next = X.raceEvents(season).find((e) => X.session(e.id, 'race')?.start_utc > NOW && e.status !== 'completed');
        if (!already && next?.id !== ev.id) continue;
        r = previewPacket(X, ev.id, { asOf: NOW });
      }
      if (!r?.ok) continue;
      const P = r.packet;
      const draft = cls === 'race_final' ? composeRaceFinal(P) : cls === 'qualifying' ? composeQualifying(P) : composePreview(P);
      draft.slug = SLUG[cls](P);
      candidates.push({ cls, cfg, ev, P, draft, sortKey: X.session(ev.id, cls === 'qualifying' ? 'qualifying' : 'race')?.start_utc || ev.start_utc });
    }
  }
}

// ledger for duplicate detection: everything live plus everything in this build
const ledger = Object.fromEntries(Object.values(live).map((a) => [a.slug, { topic: a.topic, headline: a.headline }]));
const articles = [];
const report = { gate: QUALITY_VERSION, generated_at: NOW, classes: {}, stories: [] };
for (const cls of Object.keys(classes).filter((k) => !k.startsWith('_'))) {
  const list = candidates.filter((c) => c.cls === cls).sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  const cfg = classes[cls];
  list.forEach((c, i) => {
    const v = validateDraft(c.P, c.draft, { ledger, minWords: MIN_WORDS[cls] });
    // editorial gate runs only on a factually clean draft and never relaxes it
    const ed = v.ok ? editorialGate(c.P, c.draft, { X }) : { ok: false, reasons: ['factual_gate_failed'], warnings: [], words: v.words, links: 0 };
    const prev = live[c.draft.slug];
    const stale = cls === 'preview' && !prev && c.P.context.valid_until && c.P.context.valid_until <= NOW;
    let status = !v.ok || !ed.ok ? 'held' : stale ? 'stale' : cfg.mode === 'published' ? 'published' : cfg.mode === 'canary' ? (i < cfg.canary || prev?.status === 'published' ? 'published' : 'shadow') : 'shadow';
    const published_at = prev?.published_at || NOW;
    const modified_at = prev && prev.packet_hash !== c.P.hash ? NOW : prev?.modified_at || published_at;
    const headline = render(c.draft.headline, c.P);
    ledger[c.draft.slug] = { topic: c.P.topic, headline };
    const a = { slug: c.draft.slug, class: cls, topic: c.P.topic, event_id: c.P.event_id, status, published_at, modified_at, headline, dek: render(c.draft.dek, c.P), packet_hash: c.P.hash, packet: c.P, draft: c.draft, validation: { ok: v.ok, reasons: v.reasons, facts_used: v.facts_used, words: v.words, gate: QUALITY_VERSION }, editorial: { ok: ed.ok, reasons: ed.reasons, warnings: ed.warnings, words: ed.words, links: ed.links, version: EDITORIAL_VERSION }, composer: c.draft.composer || null };
    articles.push(a);
    report.stories.push({ slug: a.slug, class: cls, status, words: v.words, facts_used: v.facts_used.length, reasons: [...v.reasons, ...ed.reasons], warnings: ed.warnings, links: ed.links });
  });
  report.classes[cls] = { mode: cfg.mode, candidates: list.length, published: articles.filter((a) => a.class === cls && a.status === 'published').length, held: articles.filter((a) => a.class === cls && a.status === 'held').length };
}

// cards (published + shadow, so a widened class has its images ready); cached by packet hash
const cache = path.join(OUT, 'media');
for (const a of articles.filter((x) => x.status === 'published' || x.status === 'shadow')) {
  const key = crypto.createHash('sha256').update(`${a.packet_hash}|${a.headline}|card@2`).digest('hex').slice(0, 12);
  const jpg = path.join(OUT, 'cards', `${a.slug}.jpg`), webp = path.join(OUT, 'cards', `${a.slug}.webp`), stamp = path.join(OUT, 'cards', `${a.slug}.key`);
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === key && fs.existsSync(jpg)) continue;
  const lead = a.packet.entities.find((x) => ['p1', 'q1', 'leader'].includes(x.key));
  const teamKey = { p1: 'p1_team', q1: 'q1_team' }[lead?.key];
  const color = X.con[a.packet.entities.find((x) => x.key === teamKey)?.ref]?.color || X.con[X.driver[lead?.ref]?.team_id]?.color || 'ff4d2e';
  const hs = lead ? await headshotData(lead.ref, { base: BASE, cacheDir: cache }) : null;
  const race = a.packet.entities.find((x) => x.key === 'race'), circ = a.packet.entities.find((x) => x.key === 'circuit');
  const date = a.packet.facts.find((f) => ['race_date', 'quali_date'].includes(f.id))?.display;
  const png = renderCard(cardSvg({ label: CLASS_LABEL[a.class], headline: a.headline, sub: [race?.name, circ?.name, date].filter(Boolean).join(' · '), color, headshot: hs }));
  fs.writeFileSync(jpg, await sharp(png).jpeg({ quality: 82, mozjpeg: true }).toBuffer());
  fs.writeFileSync(webp, await sharp(png).resize(960).webp({ quality: 78 }).toBuffer());
  fs.writeFileSync(stamp, key);
}

// outputs: full records for the site build; public index + per-article documents for the PropSports contract
fs.writeFileSync(path.join(OUT, 'articles.json'), JSON.stringify(articles));
fs.writeFileSync(path.join(OUT, 'canary-report.json'), JSON.stringify(report, null, 2));
const pub = articles.filter((a) => a.status === 'published');
const index = { generated_at: NOW, gate: QUALITY_VERSION, articles: pub.map((a) => ({ slug: a.slug, class: a.class, topic: a.topic, event_id: a.event_id, status: a.status, headline: a.headline, dek: a.dek, published_at: a.published_at, modified_at: a.modified_at, packet_hash: a.packet_hash, image: `/news/cards/${a.slug}.jpg`, entities: a.packet.entities.filter((x) => ['driver', 'team', 'circuit', 'race'].includes(x.type)).map((x) => ({ type: x.type, id: x.ref, name: x.name })) })).sort((a, b) => b.published_at.localeCompare(a.published_at) || b.slug.localeCompare(a.slug)) };
const docs = { 'news-index': index };
for (const a of pub) docs[`news-${a.slug}`] = { slug: a.slug, class: a.class, status: a.status, published_at: a.published_at, modified_at: a.modified_at, headline: a.headline, dek: a.dek, packet: a.packet, draft: a.draft, validation: a.validation };
for (const [n, d] of Object.entries(docs)) fs.writeFileSync(path.join(PROJ, `${n}.json`), JSON.stringify(d));
// register in the projection manifest; the version covers the news content too
const mf = JSON.parse(fs.readFileSync(path.join(PROJ, 'manifest.json'), 'utf8'));
mf.files = [...new Set([...mf.files.filter((f) => !f.startsWith('news-')), ...Object.keys(docs)])].sort();
mf.version = crypto.createHash('sha256').update(mf.version + JSON.stringify(docs)).digest('hex').slice(0, 16);
fs.writeFileSync(path.join(PROJ, 'manifest.json'), JSON.stringify(mf));
const by = (s) => articles.filter((a) => a.status === s).length;
console.log(`news: ${articles.length} stories (${by('published')} published, ${by('shadow')} shadow, ${by('held')} held, ${by('stale')} stale); projection ${mf.version}`);
for (const [k, v] of Object.entries(report.classes)) console.log(`  ${k}: ${JSON.stringify(v)}`);
for (const s of report.stories.filter((x) => x.status === 'held')) console.log(`  HELD ${s.slug}: ${s.reasons.join('; ')}`);
for (const s of report.stories.filter((x) => x.status === 'published')) console.log(`  PUBLISHED ${s.slug}: ${s.words} words, ${s.links} links${s.warnings?.length ? ` (${s.warnings.join('; ')})` : ''}`);
