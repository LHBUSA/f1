// Newsroom canary grader. Run after a QA build that renders shadow stories too:
//   F1_NEWS_SHADOW=1 node scripts/build-site.mjs && node scripts/news-canary.mjs [--out report.json]
// Grades every generated story (published and shadow) on the canary criteria and prints a per-class verdict.
import fs from 'node:fs';
import path from 'node:path';
import { loadProjection } from '../src/news/data.mjs';
import { consistency, render } from '../src/news/validate.mjs';

const DIST = path.resolve('dist');
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const articles = JSON.parse(fs.readFileSync('data/news/articles.json', 'utf8')).filter((a) => a.status === 'published' || a.status === 'shadow');
const X = loadProjection();
const exists = (href) => { const p = href.split(/[?#]/)[0]; return p === '/' || fs.existsSync(path.join(DIST, `${p.replace(/^\//, '')}.html`)) || fs.existsSync(path.join(DIST, p.replace(/^\//, ''))); };
const sentences = (t) => t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 6);
const INTEL = /dna|circuit_|champ|leader|h2h|season_|career|pole_gap|fit|form|grid_winners|races_held/;

// rendered prose per story (module intro lines are boilerplate by design and excluded from duplicate scoring)
const prose = new Map(articles.map((a) => [a.slug, a.draft.sections.filter((s) => !s.module || (s.paragraphs || []).join(' ').split(/\s+/).length > 25).flatMap((s) => s.paragraphs || []).map((p) => render(p, a.packet)).join(' ')]));
const sentenceOwners = new Map();
for (const [slug, t] of prose) for (const s of new Set(sentences(t))) sentenceOwners.set(s, (sentenceOwners.get(s) || 0) + 1);
const titles = new Map(), descs = new Map();

const rows = [];
for (const a of articles) {
  const file = path.join(DIST, 'news', `${a.slug}.html`);
  const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const g = {};
  const fail = (k, why) => { g[k] = why; };
  g.gates = a.validation.ok ? 'pass' : `fail: ${a.validation.reasons.join('; ')}`;
  if (!html) { rows.push({ slug: a.slug, class: a.class, status: a.status, grades: { rendered: 'fail: not rendered (run with F1_NEWS_SHADOW=1)' } }); continue; }
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  const hrefs = [...main.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]);
  const broken = [...new Set(hrefs.filter((h) => !exists(h)))];
  g.links = broken.length ? `fail: ${broken.join(', ')}` : `pass (${new Set(hrefs).size} internal links)`;
  const entityLinks = { driver: 0, team: 0, circuit: 0, race: 0, pbecast: 0, standings: 0 };
  for (const h of hrefs) { const k = h.split('/')[1]; if (k === 'drivers') entityLinks.driver++; else if (k === 'teams') entityLinks.team++; else if (k === 'circuits') entityLinks.circuit++; else if (k === 'races') entityLinks.race++; else if (k === 'pbecast') entityLinks.pbecast++; else if (k === 'standings') entityLinks.standings++; }
  g.internal_linking = Object.values(entityLinks).filter(Boolean).length >= 5 ? `pass ${JSON.stringify(entityLinks)}` : `fail ${JSON.stringify(entityLinks)}`;
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] || '';
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1] || '';
  const seo = [];
  if (!/<link rel="canonical" href="https:\/\/f1\.propbetedge\.ai\/news\//.test(html)) seo.push('canonical');
  if (!/"@type":"NewsArticle"/.test(html)) seo.push('NewsArticle JSON-LD');
  if (!/"@type":"BreadcrumbList"/.test(html)) seo.push('Breadcrumb JSON-LD');
  if (!new RegExp(`og:image" content="https://f1\\.propbetedge\\.ai/news/cards/${a.slug}\\.jpg`).test(html) || !fs.existsSync(path.join(DIST, 'news/cards', `${a.slug}.jpg`))) seo.push('og:image');
  if (!/twitter:card" content="summary_large_image/.test(html)) seo.push('twitter card');
  if (!/article:published_time/.test(html)) seo.push('article:published_time');
  if ((main.match(/<h1[\s>]/g) || []).length !== 1) seo.push('h1 count');
  if (title.replace(/ \| PropBetEdge F1$/, '').length > 70) seo.push(`title length ${title.length}`);
  if (desc.length < 70 || desc.length > 170) seo.push(`description length ${desc.length}`);
  g.seo = seo.length ? `fail: ${seo.join(', ')}` : 'pass';
  titles.set(title, [...(titles.get(title) || []), a.slug]);
  descs.set(desc, [...(descs.get(desc) || []), a.slug]);
  const own = sentences(prose.get(a.slug));
  const shared = own.filter((s) => sentenceOwners.get(s) > 1);
  const dupPct = own.length ? shared.length / own.length : 0;
  g.duplicate_copy = dupPct <= 0.25 ? `pass (${Math.round(dupPct * 100)}% shared sentences)` : `fail (${Math.round(dupPct * 100)}%: ${shared.slice(0, 2).join(' | ')})`;
  const allS = prose.get(a.slug).split(/(?<=[.!?])\s+/).filter(Boolean);
  const lens = allS.map((s) => s.split(/\s+/).length);
  const avg = lens.reduce((x, y) => x + y, 0) / Math.max(1, lens.length);
  g.readability = avg <= 24 && Math.max(...lens) <= 50 ? `pass (avg ${avg.toFixed(1)} words/sentence, max ${Math.max(...lens)})` : `fail (avg ${avg.toFixed(1)}, max ${Math.max(...lens)})`;
  const intel = a.validation.facts_used.filter((id) => INTEL.test(id));
  g.analytical_value = intel.length >= (a.class === 'race_final' ? 4 : 3) ? `pass (${intel.length} intelligence facts: ${intel.join(', ')})` : `fail (${intel.length}: ${intel.join(', ')})`;
  const badEnt = a.packet.entities.filter((x) => (x.type === 'driver' && !X.driver[x.ref]) || (x.type === 'team' && !X.con[x.ref]) || (x.type === 'circuit' && !X.circuit[x.ref]) || (x.type === 'race' && !X.event[x.ref]));
  g.entity_accuracy = badEnt.length ? `fail: ${badEnt.map((x) => x.key).join(', ')}` : `pass (${a.packet.entities.length} entities resolve)`;
  const c = consistency(a.packet);
  g.championship_math = c.length ? `fail: ${c.join('; ')}` : a.packet.context.champ_check ? `pass (${a.packet.context.champ_check.before} + ${a.packet.context.champ_check.scored} = ${a.packet.context.champ_check.after})` : 'pass (no points change in this class)';
  const dna = a.validation.facts_used.filter((id) => /dna/.test(id));
  g.dna_context = a.class === 'preview' ? (a.validation.facts_used.some((id) => /fit/.test(id)) ? 'pass (Circuit Fit)' : 'fail') : dna.length ? `pass (${dna.join(', ')})` : 'fail: no DNA fact used';
  const proj = JSON.parse(fs.readFileSync('data/projection/meta.json', 'utf8'));
  const fresh = a.class === 'preview' ? a.packet.as_of < (a.packet.context.valid_until || '9999') : true;
  g.source_freshness = fresh ? `pass (packet ${a.packet.hash}, projection as_of ${proj.as_of})` : 'fail: preview packet after race start';
  g.words = a.validation.words;
  rows.push({ slug: a.slug, class: a.class, status: a.status, headline: a.headline, grades: g });
}
for (const [t, s] of titles) if (s.length > 1) for (const r of rows.filter((x) => s.includes(x.slug))) r.grades.duplicate_metadata = `fail: title shared with ${s.join(', ')}`;
for (const [d, s] of descs) if (s.length > 1) for (const r of rows.filter((x) => s.includes(x.slug))) r.grades.duplicate_metadata = `fail: description shared with ${s.join(', ')}`;
for (const r of rows) r.grades.duplicate_metadata ??= 'pass';
for (const r of rows) r.pass = Object.entries(r.grades).every(([k, v]) => k === 'words' || String(v).startsWith('pass'));

const byClass = {};
for (const r of rows) { const b = (byClass[r.class] ||= { stories: 0, pass: 0, published: 0, words: [] }); b.stories++; if (r.pass) b.pass++; if (r.status === 'published') b.published++; b.words.push(r.grades.words); }
console.log('CANARY REPORT');
for (const [k, b] of Object.entries(byClass)) console.log(`  ${k.padEnd(11)} ${b.pass}/${b.stories} pass · published ${b.published} · words ${Math.min(...b.words)}–${Math.max(...b.words)} · ${b.pass === b.stories && b.stories >= 3 ? 'CLEAN' : b.pass === b.stories ? `CLEAN (only ${b.stories} legitimate packet${b.stories === 1 ? '' : 's'})` : 'NOT CLEAN'}`);
for (const r of rows.filter((x) => !x.pass)) console.log(`  FAIL ${r.slug}: ${Object.entries(r.grades).filter(([k, v]) => k !== 'words' && !String(v).startsWith('pass')).map(([k, v]) => `${k} ${v}`).join(' | ')}`);
if (out) fs.writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), classes: byClass, stories: rows }, null, 2));
