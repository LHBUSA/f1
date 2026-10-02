// Static site build: data/normalized + data/derived → dist/
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadContext } from './site/context.mjs';
import { layout, esc, SITE, fmtDate } from './site/lib.mjs';
import * as P from './site/pages.mjs';
import { lineageChain } from '../src/core/constructors.mjs';
import { loadProjection } from '../src/news/data.mjs';
import { articlePage } from '../src/news/render.mjs';
import { newsIndexPage, homeModule, feedXml, newsSitemapXml, order } from '../src/news/pages.mjs';
import { pbecastHub, pbecastEventPage } from './site/pbecast-v2.mjs';
import { loadCarPhotos, carPhotoFor, imageObject } from '../src/identity/car-photos.mjs';
import { loadPeople, teamPeople, teamMachine } from '../src/identity/people.mjs';

const DIST = path.resolve('dist');
const t0 = Date.now();
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'assets/fonts'), { recursive: true });

const ctx = loadContext();
// newsroom records from build-news (published only; F1_NEWS_SHADOW=1 also renders shadow stories, noindex, for QA)
const X = loadProjection();
const newsAll = fs.existsSync('data/news/articles.json') ? JSON.parse(fs.readFileSync('data/news/articles.json', 'utf8')) : [];
const newsPub = newsAll.filter((a) => a.status === 'published');
const newsEmit = newsAll.filter((a) => a.status === 'published' || (process.env.F1_NEWS_SHADOW === '1' && a.status === 'shadow'));
ctx.newsModule = homeModule(newsPub, X);
// car photos: approved only; F1_CAR_CANDIDATES=1 / Vercel preview builds also render reviewed candidates, labelled
const carReg = loadCarPhotos();
const peopleReg = loadPeople();
ctx.peopleFor = (cid, season) => teamPeople(peopleReg, cid, season);
ctx.machineFor = (cid, season) => teamMachine(peopleReg, cid, season);
const carCandidates = process.env.F1_CAR_CANDIDATES === '1' || process.env.VERCEL_ENV === 'preview';
ctx.carPhotoFor = (cid, season) => carPhotoFor(carReg, cid, season, { includeCandidates: carCandidates });
fs.mkdirSync(path.join(DIST, 'media/cars'), { recursive: true });
for (const p of carReg.photos) if (p.approvedForPublicUse || carCandidates) for (const [w, f] of Object.entries(p.derivatives.files)) for (const [ext, src] of Object.entries(f)) fs.copyFileSync(src, path.join(DIST, 'media/cars', `${p.id}-${w}.${ext}`));
// relocated rounds (projection relocation link): one explanation, shown on the race page
ctx.relocations = {};
for (const e of X.allEvents) if (e.relocated_from) { const o = X.event[e.relocated_from.event_id]; const oc = X.circuit[e.relocated_from.original_circuit_id]; ctx.relocations[e.id] = { orig_id: e.relocated_from.event_id, text: `This is the ${e.season} ${e.name.replace(/ in .+$/, '')}, held at ${X.circuit[e.circuit_id]?.name || 'a different circuit'} in ${e.relocated_from.host_country}. The round originally scheduled at ${oc?.name || 'its usual venue'}${o?.start_utc ? ` for ${new Date(o.start_utc).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}` : ''} is listed as cancelled.` }; }

// ---------- assets ----------
const colors = new Set();
for (const c of ctx.constructors) for (const v of Object.values(c.colors || {})) colors.add(String(v).toLowerCase());
let css = fs.readFileSync('src/web/styles.css', 'utf8');
css += '\n' + [...colors].map((c) => `.tc-${c.replace(/[^0-9a-f]/g, '')}{--tc:#${c}}`).join('');
css += '\n' + Array.from({ length: 101 }, (_, i) => `.w-${i}{width:${i}%}`).join('');
const cssHash = crypto.createHash('sha256').update(css).digest('hex').slice(0, 10);
fs.writeFileSync(path.join(DIST, `assets/app.${cssHash}.css`), css);
const js = fs.readFileSync('src/web/app.js', 'utf8');
const jsHash = crypto.createHash('sha256').update(js).digest('hex').slice(0, 10);
fs.writeFileSync(path.join(DIST, `assets/app.${jsHash}.js`), js);
for (const f of ['barlow-condensed-latin-500-normal', 'barlow-condensed-latin-600-normal', 'barlow-condensed-latin-700-normal', 'barlow-condensed-latin-800-normal']) fs.copyFileSync(`node_modules/@fontsource/barlow-condensed/files/${f}.woff2`, path.join(DIST, `assets/fonts/${f}.woff2`));
for (const f of ['barlow-latin-400-normal', 'barlow-latin-500-normal', 'barlow-latin-600-normal']) fs.copyFileSync(`node_modules/@fontsource/barlow/files/${f}.woff2`, path.join(DIST, `assets/fonts/${f}.woff2`));
for (const f of fs.readdirSync('public')) fs.copyFileSync(path.join('public', f), path.join(DIST, f));
// Backdrop art: committed final set in assets-src/backdrop; F1_BACKDROP=A..D selects a candidate render (comparison builds).
const BD_SRC = process.env.F1_BACKDROP ? path.resolve('art/out', process.env.F1_BACKDROP) : path.resolve('assets-src/backdrop');
if (fs.existsSync(BD_SRC)) {
  fs.mkdirSync(path.join(DIST, 'media/backdrop'), { recursive: true });
  for (const f of fs.readdirSync(BD_SRC).filter((x) => /\.(avif|webp)$/.test(x))) fs.copyFileSync(path.join(BD_SRC, f), path.join(DIST, 'media/backdrop', f));
} else console.warn('build-site: no backdrop assets at', BD_SRC);
// PBEcast V2 bundle: the shared progress model + the client, content-hashed (loaded on PBEcast pages only)
const prog = fs.readFileSync('src/core/progress.mjs', 'utf8');
const progHash = crypto.createHash('sha256').update(prog).digest('hex').slice(0, 10);
fs.writeFileSync(path.join(DIST, `assets/progress.${progHash}.js`), prog);
const pc = fs.readFileSync('src/web/pbecast.js', 'utf8').replace("from './progress.js'", `from './progress.${progHash}.js'`);
const pcHash = crypto.createHash('sha256').update(pc).digest('hex').slice(0, 10);
fs.writeFileSync(path.join(DIST, `assets/pbecast.${pcHash}.js`), pc);
const assets = { css: `/assets/app.${cssHash}.css`, js: `/assets/app.${jsHash}.js`, pbecast: `/assets/pbecast.${pcHash}.js` };

// ---------- page writer ----------
const sitemap = [];
const allPaths = new Set();
let pages = 0;
function emit(p) {
  if (p.carImageObject) p.jsonLd = [...(p.jsonLd || []), imageObject(p.carImageObject.photo, { site: SITE, publicPath: p.carImageObject.publicPath })];
  const html = layout({ ...p, assets });
  const rel = p.path === '/' ? 'index.html' : p.path.replace(/^\//, '') + '.html';
  const file = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  pages++;
  allPaths.add(p.path);
  if (!p.noindex) sitemap.push({ path: p.path, lastmod: p.article?.modified?.slice(0, 10) });
}

emit(P.home(ctx));
const seasons = Object.keys(ctx.eventsBySeason).map(Number);
emit(P.racesIndex(ctx, ctx.currentSeason, true));
for (const y of seasons) if (y !== ctx.currentSeason) emit(P.racesIndex(ctx, y, false));
for (const ev of ctx.events) emit(P.racePage(ctx, ev));
emit(P.driversIndex(ctx));
for (const d of ctx.drivers) if (ctx.careers[d.id]?.entries) emit(P.driverPage(ctx, d));
emit(P.teamsIndex(ctx));
for (const c of ctx.constructors) emit(P.teamPage(ctx, c, lineageChain));
emit(P.circuitsIndex(ctx));
for (const c of ctx.circuits) emit(P.circuitPage(ctx, c, ''));
emit(P.standingsPage(ctx, ctx.currentSeason));
for (const y of seasons) if (y !== ctx.currentSeason && ctx.standingsBy[`${y}|driver`]) emit(P.standingsPage(ctx, y));
emit(P.matchupsIndex(ctx));
for (const k of Object.keys(ctx.matchups)) emit(P.matchupPage(ctx, k));
emit(pbecastHub(X, ctx.nextEvent ? X.event[ctx.nextEvent.slug] : null));
for (const ev of X.raceEvents(ctx.currentSeason)) emit(pbecastEventPage(X, ev));
emit(methodology(ctx));
emit(coveragePage(ctx));
for (const p of P.intelligencePages(ctx, X, newsPub)) emit(p);

// ---------- newsroom ----------
// links resolve only to pages this build emitted (articles are emitted last, so every target already exists)
const linkOk = (h) => allPaths.has(h) || newsEmit.some((a) => `/news/${a.slug}` === h);
emit(newsIndexPage(newsPub, X));
fs.mkdirSync(path.join(DIST, 'news/cards'), { recursive: true });
for (const a of newsEmit) {
  const related = order(newsPub.filter((b) => b.slug !== a.slug && (b.event_id === a.event_id || b.packet.entities.some((x) => x.type === 'driver' && a.packet.entities.some((y) => y.type === 'driver' && y.ref === x.ref && ['p1', 'q1'].includes(y.key))))), X).slice(0, 4);
  emit(articlePage(a, { linkOk, related, site: SITE }));
  for (const ext of ['jpg', 'webp']) fs.copyFileSync(path.join('data/news/cards', `${a.slug}.${ext}`), path.join(DIST, 'news/cards', `${a.slug}.${ext}`));
}
fs.writeFileSync(path.join(DIST, 'feed.xml'), feedXml(newsPub, X, SITE));
const ns = newsSitemapXml(newsPub, X, SITE);
fs.writeFileSync(path.join(DIST, 'news-sitemap.xml'), ns.xml);
console.log(`news: ${newsPub.length} published${newsEmit.length > newsPub.length ? ` + ${newsEmit.length - newsPub.length} shadow (noindex, QA build)` : ''}; news-sitemap ${ns.count}`);

// 404 (not in sitemap)
const nf = layout({ path: '/404', title: 'Page not found', description: 'Page not found.', noindex: true, assets, body: `<section class="hero"><div class="wrap"><span class="eyebrow">404</span><h1>Off the racing line</h1><p class="sub">That page doesn’t exist. Try the <a class="more" href="/races">calendar</a>, <a class="more" href="/drivers">drivers</a> or <a class="more" href="/standings">standings</a>.</p></div></section>` });
fs.writeFileSync(path.join(DIST, '404.html'), nf);

// sitemap + robots
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map((p) => `<url><loc>${SITE}${p.path === '/' ? '/' : p.path}</loc><lastmod>${p.lastmod || today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${SITE}/sitemap.xml\nSitemap: ${SITE}/news-sitemap.xml\n`);
console.log(`built ${pages} pages (${sitemap.length} indexable) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---------- static content pages ----------
function methodology(ctx) {
  const r = ctx.dnaReport;
  const body = `<section class="section"><div class="wrap prose">
  <span class="eyebrow">Methodology · ${esc(r.version)}</span><h1>How PropBetEdge F1 works</h1>
  <p>Source truth and derived intelligence are kept apart. Normalized tables hold only what a source published, each record with <code>source</code>, <code>source_id</code>, <code>source_url</code>, <code>source_updated_at</code> and <code>ingested_at</code>. DNA, Circuit Fit, matchups and progression are calculated from those tables and versioned separately.</p>
  <h2>Data</h2>
  <p>All results, sessions, standings, driver and circuit data come from <a href="https://propsports.proptechusa.ai" rel="noopener">PropSports</a>. Every record keeps its provenance internally and is archived before parsing. No paid timing feeds are used.</p>
  <h2>What is not available</h2>
  <p>The data feed carries no per-lap timing, sector times, tyre compounds, stints, pit-stop durations, car positions, telemetry, race-control messages or historical weather. Those tables exist in the model but are empty, and every feature that would need them is shown as “not sourced” rather than estimated. PBEcast never simulates car positions.</p>
  <h2 id="driver-dna">Driver DNA</h2>
  <p>Two windows: current (${esc(Object.values(ctx.dnaCur)[0]?.window || '')}) and career. Each dimension reports a percentile within the population of drivers meeting its minimum sample in the same window, the sample size, a confidence tier (low under 8, medium 8–19, high 20+) and the raw metrics.</p>
  <ul>
  <li><b>Qualifying Pace</b> — median teammate qualifying gap (%) from the deepest knockout session both set a time in; gaps over 5% excluded as non-representative. Falls back to qualifying head-to-head where times are unavailable.</li>
  <li><b>Race Result vs Teammate</b> — share of races finishing ahead of the teammate (a one-car retirement counts for the finisher).</li>
  <li><b>Positions Gained</b> — grid-to-finish gain above the historical expectation for that grid slot.</li>
  <li><b>Finishing</b> — classification rate minus the teammate’s (same machinery).</li>
  <li><b>Consistency</b> — spread of teammate qualifying gaps.</li>
  <li><b>Team Points Share</b> — share of team points in scoring weekends.</li>
  <li><b>Street / High-Speed / Low-Speed</b> — teammate qualifying gap on those circuit classes relative to the driver’s overall gap. Speed classes are terciles of pole-lap average speed (lap length ÷ fastest qualifying lap), not corner telemetry.</li></ul>
  <h2 id="constructor-dna">Constructor DNA</h2>
  <p>Per season: qualifying speed (team best lap vs session best), race results (points per weekend), finishing reliability, race gains, high/low-speed and street relative pace, and driver pairing balance. The driver effect (intra-team gap) is reported separately from the car effect (team best vs field).</p>
  <h2 id="circuit-dna">Circuit DNA</h2>
  <p>From the last 10 seasons at each circuit: track-position importance (grid↔finish rank correlation and pole conversion), position change, pole-lap speed, attrition and observed pit stops per car (2014+). Braking, tyre stress, DRS, safety-car and weather volatility are not sourced.</p>
  <h2>Circuit Fit</h2>
  <p>A weighted average of relevant Driver and Constructor DNA percentiles, with weights set by the circuit’s profile (e.g. qualifying is weighted up where track position matters). It is descriptive — not a prediction, probability or betting signal.</p>
  <h2>Points</h2>
  <p>Race-row points are published as the weekend total (sprint included). Pre-1991 seasons used dropped scores, so race-by-race sums can differ from official totals; official standings are always authoritative and progression charts are hidden where sums disagree.</p>
  <h2>Identity</h2>
  <p>Each car carries a team name, but historical entries are back-labelled with later names (e.g. “AlphaTauri” for 2006–19 Toro Rosso, “Alpine” for 2002–10 Renault), so the season decides the entity. Where a car’s team is missing entirely (every 2024–25 Kick Sauber entry), the car is assigned to the only constructor from that season’s official standings with no labelled car in the session, and the row is flagged as inferred.</p>
  <p>Circuits are attributed per race edition, so historic Grands Prix are linked to the circuit actually used that year. Layout length and turns describe the latest published layout and are not applied to historic layouts.</p>
  <p>Drivers are keyed by a stable ID and never merged by name. Constructors are split by name <i>and</i> season range (e.g. the 1958–94 Team Lotus, the 2010–11 Lotus Racing and the 2012–15 Lotus F1 are different entities) and grouped into franchise lineages for navigation only.</p>
  </div></section>`;
  return { path: '/methodology', title: 'Methodology & Sources', description: 'How PropBetEdge F1 sources, normalizes and models Formula 1 data: Driver DNA, Constructor DNA, Circuit DNA and Circuit Fit methods, sources and limitations.', body };
}

function coveragePage(ctx) {
  const c = ctx.coverage;
  const r = ctx.dnaReport;
  const rows = [
    ['Seasons', `${c.seasons} (${c.earliest_season}–${c.latest_season})`],
    ['Events', `${c.events} (${c.events_completed} completed)`],
    ['Sessions', c.sessions],
    ['Classifications', c.classifications],
    ['Drivers', c.drivers],
    ['Constructors', c.constructors],
    ['Circuits (canonical)', ctx.circuits.length],
    ['Practice/qualifying sessions from', c.first_season_with_sessions],
    ['Q1/Q2/Q3 times from', c.first_season_with_q123],
    ['Pit-stop counts from', c.first_season_with_pit_counts],
    ['Lap-level data', 'Not available (no licensed source)'],
    ['Telemetry', 'Not available'],
    ['Driver DNA (current window)', `${r.driver_dna_current_qualifying} drivers, avg ${r.driver_dna_current_avg_populated} of ${r.driver_dna_dimensions_defined} dimensions`],
    ['Driver DNA (career)', `${r.driver_dna_career_qualifying} drivers, avg ${r.driver_dna_career_avg_populated} dimensions`],
    ['Constructor DNA', `${r.constructor_dna_seasons} seasons, ${r.constructor_dna_current_teams} current teams`],
    ['Circuit DNA', `${r.circuit_dna_with_recent_profile} circuits profiled of ${r.circuit_dna_circuits}`],
    ['Circuit Fit', `${r.circuit_fit_events} events, ${r.circuit_fit_driver_rows} driver rows`],
    ['Teammate pairings', r.teammate_pairs],
  ];
  const body = `<section class="section"><div class="wrap prose"><span class="eyebrow">Generated ${esc(fmtDate(c.generated_at))}</span><h1>Data coverage</h1><div class="table-wrap"><table><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(String(v))}</td></tr>`).join('')}</tbody></table></div>
  ${c.unresolved_constructor_names?.length ? `<p class="fine">Constructors keyed by source name (no editorial lineage): ${c.unresolved_constructor_names.length}.</p>` : ''}</div></section>`;
  return { path: '/data-coverage', title: 'Data Coverage', description: 'PropBetEdge F1 data coverage: seasons, events, sessions, classifications, DNA coverage and known gaps.', body, noindex: false };
}
