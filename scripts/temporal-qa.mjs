// Temporal QA over the BUILT site (dist/) and the news records (data/news/articles.json): impossible chronology fails.
//   node scripts/temporal-qa.mjs [--now ISO] [--dist dir]        (default: the build's own clock, F1_SITE_NOW, or the wall clock)
// Checks: countdown / "Next session" targets in the past; "Upcoming" on a weekend that has ended; SportsEvent JSON-LD
// claiming EventScheduled after the event, or start > end; articles: published in the future, modified < published,
// frame != publication, future-race copy in a story first published after its race, live copy in archives, archive
// stories in the Google News sitemap; sitemap lastmod stamped with the build date on non-article pages.
import fs from 'node:fs';
import path from 'node:path';

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const DIST = arg('--dist') || 'dist';
const NOW = Date.parse(arg('--now') || process.env.F1_SITE_NOW || new Date().toISOString());
const fails = [];
const fail = (where, msg) => fails.push(`${where}: ${msg}`);
let pages = 0;

const walk = (d, out = []) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p, out); else if (f.name.endsWith('.html')) out.push(p); } return out; };
const route = (f) => '/' + path.relative(DIST, f).replace(/\\/g, '/').replace(/(index)?\.html$/, '');
const ld = (h) => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => { try { const j = JSON.parse(m[1]); return Array.isArray(j) ? j : [j]; } catch { return []; } });

for (const f of walk(DIST)) {
  const h = fs.readFileSync(f, 'utf8');
  const r = route(f);
  pages++;
  // countdown target must be in the future (the client advances/hides between builds; the build must not ship a past one)
  for (const m of h.matchAll(/data-countdown="([^"]+)"/g)) if (Date.parse(m[1]) <= NOW) fail(r, `countdown to the past (${m[1]})`);
  // Upcoming pill on a weekend that has ended
  for (const m of h.matchAll(/<span class="pill"(?: data-until="([^"]*)")?>Upcoming<\/span>/g)) if (!m[1] || Date.parse(m[1]) <= NOW) fail(r, `Upcoming on an ended weekend (${m[1] || 'no end time'})`);
  for (const j of ld(h)) {
    if (j['@type'] === 'SportsEvent') {
      if (j.startDate && j.endDate && Date.parse(j.startDate) > Date.parse(j.endDate)) fail(r, `SportsEvent start ${j.startDate} after end ${j.endDate}`);
      if (j.eventStatus === 'https://schema.org/EventScheduled' && Date.parse(j.endDate || j.startDate) <= NOW) fail(r, `EventScheduled after the event ended (${j.endDate})`);
    }
    if (j['@type'] === 'NewsArticle') {
      if (Date.parse(j.datePublished) > NOW + 60e3) fail(r, `datePublished in the future (${j.datePublished})`);
      if (j.dateModified && Date.parse(j.dateModified) < Date.parse(j.datePublished)) fail(r, `dateModified ${j.dateModified} before datePublished ${j.datePublished}`);
      const vis = /<time datetime="([^"]+)">/.exec(h)?.[1];
      if (vis && vis !== j.datePublished) fail(r, `visible dateline ${vis} != JSON-LD datePublished ${j.datePublished}`);
    }
  }
}

// ---- news records ----
const FUTURE = /race starts on|follows the session live|follows it live|follows the race live|moves on to|is underway/i;
const LIVE = /follows the session live|follows it live|follows the race live|is underway/i;
let stories = 0;
if (fs.existsSync('data/news/articles.json')) {
  const { render } = await import('../src/news/validate.mjs');
  for (const a of JSON.parse(fs.readFileSync('data/news/articles.json', 'utf8')).filter((x) => x.status === 'published')) {
    stories++;
    const tf = a.packet.context.temporal;
    const where = `/news/${a.slug}`;
    if (!tf) { fail(where, 'no temporal frame'); continue; }
    if (tf.as_of !== a.published_at) fail(where, `frame ${tf.as_of} != published_at ${a.published_at}`);
    if (Date.parse(a.published_at) > NOW + 60e3) fail(where, 'published in the future');
    if (Date.parse(a.modified_at) < Date.parse(a.published_at)) fail(where, 'modified before published');
    if (tf.qualifying_start && tf.race_start && Date.parse(tf.qualifying_start) >= Date.parse(tf.race_start)) fail(where, 'qualifying dated at/after the race');
    const text = a.draft.sections.flatMap((s) => [s.heading, ...(s.paragraphs || [])]).map((p) => render(p, a.packet)).join(' ');
    // copy written at publication: a race already run (or running) at publication must not be described as coming
    if (tf.race_state === 'completed') {
      // a race final may say the season "moves on to" the NEXT round (and when its race starts) only if that race was
      // still ahead at publication; nothing may describe THIS race as coming or live
      const own = a.class === 'race_final' && tf.next_race_state === 'upcoming' ? text.replace(/The season moves on to the [^.]*\./, '') : text;
      const hit = own.match(FUTURE);
      if (hit) fail(where, `future/live race language in a story published after its race: "${hit[0]}"`);
    }
    if (a.archive && LIVE.test(text)) fail(where, 'live language in an archive story');
    if (a.class === 'race_final' && tf.next_race_state === 'started' && /moves on to/.test(text)) fail(where, 'says the season moves on to a round already raced at publication');
    if (a.archive && fs.existsSync(path.join(DIST, "news", a.slug + ".html")) && !fs.readFileSync(path.join(DIST, "news", a.slug + ".html"), 'utf8').includes('Archive · ')) fail(where, 'archive story without an Archive label');
  }
  if (fs.existsSync(path.join(DIST, "news-sitemap.xml"))) {
    const ns = fs.readFileSync(path.join(DIST, "news-sitemap.xml"), 'utf8');
    for (const a of JSON.parse(fs.readFileSync('data/news/articles.json', 'utf8')).filter((x) => x.archive)) if (ns.includes(`/news/${a.slug}<`)) fail('news-sitemap', `archive story ${a.slug} in Google News sitemap`);
  }
}

// ---- sitemap lastmod: never the build date for a page without a content modification time ----
if (fs.existsSync(path.join(DIST, "sitemap.xml"))) {
  const sm = fs.readFileSync(path.join(DIST, "sitemap.xml"), 'utf8');
  const today = new Date().toISOString().slice(0, 10);
  const stamped = [...sm.matchAll(/<loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)].filter(([, loc, d]) => d === today && !loc.includes('/news/'));
  if (stamped.length) fail('sitemap', `${stamped.length} non-article URLs stamped with the build date (e.g. ${stamped[0][1]})`);
}

console.log(`temporal QA at ${new Date(NOW).toISOString()}: ${pages} pages, ${stories} published stories`);
if (fails.length) {
  const kinds = {};
  for (const x of fails) { const k = x.split(': ').slice(1).join(': ').replace(/\([^)]*\)|"[^"]*"|\d{4}-\d\d-\d\dT[\d:.]+Z/g, '').replace(/\s+/g, ' ').trim(); kinds[k] = (kinds[k] || 0) + 1; }
  console.log(Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${n} x ${k}`).join('\n'));
  console.log(fails.slice(0, 40).join('\n'));
  console.log(`TEMPORAL QA FAIL (${fails.length})`);
  process.exit(1);
}
console.log('TEMPORAL QA PASS');
