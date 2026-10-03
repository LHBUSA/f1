import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { kalshiCard, kalshiStrip, marketModule, marketHistoryCard, marketCloseLine, __resetKalshiFlashes } from '../src/vendor/kalshi/kalshi-market-ui.js';
import { createKalshiClient } from '../src/vendor/kalshi/kalshi-market-client.js';
import { kalshiRaceMount, kalshiCastMount, kalshiCloseMount, raceMarketId, isRaceMarketId } from '../scripts/site/kalshi.mjs';

const MARKET_URL = 'https://kalshi.com/markets/kxf1race/f1-race/kxf1race-bah26';
const DRIVERS = ['Max Verstappen', 'Kimi Antonelli', 'Lewis Hamilton', 'Charles Leclerc', 'George Russell', 'Lando Norris', 'Oscar Piastri', 'Fernando Alonso', 'Carlos Sainz', 'Pierre Gasly'];
const slug = (n) => n.toLowerCase().replace(/[^a-z]+/g, '-');
function fieldEntry(n = DRIVERS.length) {
  const outcomes = DRIVERS.slice(0, n).map((name, i) => {
    const mid = 6000 - i * 500;
    return { role: `p:${slug(name)}`, team_id: slug(name), abbr: name, kalshi_name: name, contract: `Main Race: ${name} wins`, market_ticker: `KXF1RACE-BAH26-${i}`, state: 'open', result: null, best_yes_bid_bp: mid - 50, best_yes_ask_bp: mid + 50, last_price_bp: mid, mid_bp: mid, volume: 1000 - i, open_interest: 500, spread_bp: 100, displayable: true };
  });
  return {
    event: { sport: 'f1', competition: 'f1', canonical_event_id: '2026-bahrain-grand-prix-in-malaysia-race', start_at: '2026-10-04T07:00:00+00:00', state: 'pre' },
    kalshi: { source: 'kalshi', label: 'Kalshi', market_url: MARKET_URL, event_ticker: 'KXF1RACE-BAH26', proposition: 'driver_wins_race', state: 'open', freshness: 'live', age_seconds: 40, outcomes },
  };
}

test('kalshi: no entry renders nothing (card, strip, client with no market)', async () => {
  assert.equal(kalshiCard(null, { placement: 'race-page' }), '');
  assert.equal(kalshiCard(undefined), '');
  assert.equal(kalshiStrip(null), '');
  assert.equal(kalshiCard({ event: {}, kalshi: null }), '');
  // the API answers but has no market for this race -> loadEvent resolves null -> nothing
  const client = createKalshiClient({ sport: 'f1', fetchImpl: async () => new Response(JSON.stringify({ contract: 'market-intel/1', enabled: true, event: null }), { status: 200 }) });
  assert.equal(await client.loadEvent('2026-some-grand-prix-race'), null);
  const failing = createKalshiClient({ sport: 'f1', fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(await failing.loadEvent('2026-some-grand-prix-race'), null);
});

test('kalshi: every link is rel sponsored, new tab, to the Kalshi market', () => {
  __resetKalshiFlashes();
  const html = kalshiCard(fieldEntry(), { placement: 'race-page' }) + kalshiStrip(fieldEntry(), { placement: 'pbecast-strip' });
  const links = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(links.length >= 9, 'prices and CTA are links');
  for (const a of links) {
    assert.match(a, /rel="noopener noreferrer sponsored"/);
    assert.match(a, /target="_blank"/);
    assert.ok(a.includes(`href="${MARKET_URL}"`), a);
  }
});

test('kalshi: field market renders a ranked driver list (top 8 by Mid-market)', () => {
  __resetKalshiFlashes();
  const html = kalshiCard(fieldEntry(), { placement: 'race-page' });
  assert.match(html, /<ol class="kx__field">/);
  const rows = [...html.matchAll(/<li class="kx__frow">[\s\S]*?<\/li>/g)].map((m) => m[0]);
  assert.equal(rows.length, 8);
  rows.forEach((r, i) => {
    assert.match(r, new RegExp(`<span class="kx__frank mono">${i + 1}</span>`));
    assert.ok(r.includes(`<b>${DRIVERS[i]}</b>`), `rank ${i + 1} is ${DRIVERS[i]}`);
  });
  assert.match(html, /2 more traded contracts on Kalshi/);
  assert.match(html, /not sportsbook odds and not a PropBetEdge model/);
  assert.match(html, /Market Pulse/);
  assert.match(html, /Live prediction-market pricing — no sportsbook line required/);
  // no inline style attribute on the field layout (the F1 CSP has no 'unsafe-inline' for styles)
  assert.doesNotMatch(html, /style="/);
  const strip = kalshiStrip(fieldEntry(), { placement: 'pbecast-strip' });
  const lead = [...strip.matchAll(/<span class="kx__si"><b>([^<]+)<\/b>/g)].map((m) => m[1]);
  assert.deepEqual(lead, DRIVERS.slice(0, 3));
});

test('kalshi: CSP connect-src allows the PropSports markets host', () => {
  const v = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const csp = v.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
  const connect = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src'));
  assert.ok(connect.split(/\s+/).includes('https://propsports-markets.sales-fd3.workers.dev'), connect);
  assert.ok(connect.split(/\s+/).includes('https://propsports.proptechusa.ai'));
  assert.doesNotMatch(csp, /kalshi\.com/, 'the browser never talks to Kalshi');
});

// sha256 of the canonical shared files (propbetedge-workers/workers/propsports-markets/client @ ad6187a), LF-normalised
const VENDOR_SHA = {
  'kalshi-market-ui.js': '03712a0eb48e5265523ec45b145fd2fa880c9435e1adf2c6ca988c78c3fa37a8',
  'kalshi-market-ui.css': 'fb046ada2b2e5450207e4301c0e41a193aa599e4661843fdcdb50d45ac7191ae',
  'kalshi-market-client.js': '68f9ed06de627654634e385acc79b1efdee858de4a59801e20b401b5c0bc43dc',
};
const lf = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
test('kalshi: vendored shared component is unchanged', () => {
  for (const [name, sha] of Object.entries(VENDOR_SHA)) {
    assert.equal(crypto.createHash('sha256').update(lf(path.join('src/vendor/kalshi', name))).digest('hex'), sha, name);
  }
  const canon = 'D:/Workers/propbetedge-workers/workers/propsports-markets/client';
  if (fs.existsSync(canon)) for (const name of Object.keys(VENDOR_SHA)) assert.equal(lf(path.join('src/vendor/kalshi', name)), lf(path.join(canon, name)), `${name} matches canonical`);
});

test('kalshi: browser code never calls a Kalshi API host', () => {
  const files = [...fs.readdirSync('src/web').map((f) => path.join('src/web', f)), ...fs.readdirSync('src/vendor/kalshi').filter((f) => f.endsWith('.js')).map((f) => path.join('src/vendor/kalshi', f))];
  if (fs.existsSync('dist/assets')) files.push(...fs.readdirSync('dist/assets').filter((f) => f.endsWith('.js')).map((f) => path.join('dist/assets', f)));
  const API = /(?:api\.elections\.kalshi\.com|trading-api\.kalshi\.com|api\.kalshi\.com|demo-api\.kalshi\.co|external-api\.kalshi|\/trade-api\/)/i;
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(t, API, f);
    assert.doesNotMatch(t, /fetch\([^)]*kalshi\.com/i, f);
  }
  // the F1 loader reads only through the vendored shared client (ad6187a keeps kalshi:null history entries): no host,
  // no fetch of its own (the 70d92e0 direct-read workaround is gone)
  const loader = fs.readFileSync('src/web/kalshi.js', 'utf8');
  assert.deepEqual([...loader.matchAll(/https:\/\/[a-z0-9.-]+/gi)].map((m) => m[0]), []);
  assert.doesNotMatch(loader, /fetch\(/);
  assert.match(loader, /createKalshiClient\(\{ sport: 'f1' \}\)/);
});

test('kalshi: the race mount only ever targets the MAIN race session, never a sprint', () => {
  const ev = '2026-bahrain-grand-prix-in-malaysia';
  const race = { type: 'race', state: 'scheduled', start_utc: '2026-10-04T07:00Z' };
  assert.equal(raceMarketId(ev, race), `${ev}-race`);
  assert.match(kalshiRaceMount(ev, race), /data-kalshi-race="2026-bahrain-grand-prix-in-malaysia-race"/);
  assert.match(kalshiCastMount(ev, race), /data-kalshi-cast="2026-bahrain-grand-prix-in-malaysia-race"/);
  for (const type of ['sprint', 'sprint-qualifying', 'qualifying', 'fp1']) {
    assert.equal(raceMarketId(ev, { type, state: 'scheduled' }), null, type);
    assert.equal(kalshiRaceMount(ev, { type, state: 'scheduled' }), '', type);
    assert.equal(kalshiCastMount(ev, { type, state: 'scheduled' }), '', type);
  }
  assert.equal(kalshiRaceMount(ev, null), '');
  // completed main race keeps its mount (market history), flagged done; races before the market lane never had one
  assert.match(kalshiRaceMount(ev, { ...race, state: 'completed' }), /data-kalshi-race="2026-bahrain-grand-prix-in-malaysia-race"[^>]*data-kalshi-done="1"/);
  assert.match(kalshiCastMount(ev, { ...race, state: 'completed' }), /data-kalshi-cast="2026-bahrain-grand-prix-in-malaysia-race"[^>]*data-kalshi-done="1"/);
  assert.equal(kalshiRaceMount('2024-italian-grand-prix', { type: 'race', state: 'completed', start_utc: '2024-09-01T13:00Z' }), '');
  assert.equal(kalshiRaceMount(ev, { ...race, state: 'canceled' }), '');
  for (const bad of [`${ev}-sprint`, `${ev}-sprint-race`, `${ev}-sprint-qualifying-race`, '2026-drivers-championship-race', `${ev}`, '']) assert.equal(isRaceMarketId(bad), false, bad);
  // the browser loader applies the same rule before it fetches anything
  const win = { document: { readyState: 'complete', addEventListener() {}, querySelector: () => null, hidden: false } };
  win.window = win;
  vm.runInNewContext(fs.readFileSync('src/web/kalshi.js', 'utf8'), { window: win, document: win.document, setTimeout, clearTimeout });
  const K = win.F1.kalshi;
  assert.equal(K.isRaceMarketId(`${ev}-race`), true);
  for (const bad of [`${ev}-sprint-race`, `${ev}-sprint`, '2026-drivers-championship-race']) assert.equal(K.isRaceMarketId(bad), false, bad);
  assert.equal(K.usable({ event: { state: 'pre' }, kalshi: { state: 'open', proposition: 'driver_wins_race' } }), true);
  assert.equal(K.usable({ event: { state: 'pre' }, kalshi: { state: 'open', proposition: 'driver_wins_championship' } }), false);
  assert.equal(K.usable(null), false);
  // market still trading after the chequered flag stays visible; closed / settled moves to history
  assert.equal(K.usable({ event: { state: 'post' }, kalshi: { state: 'open', proposition: 'driver_wins_race' }, market: { lifecycle: 'ACTIVE' } }), true);
  assert.equal(K.usable({ event: { state: 'post' }, kalshi: { state: 'open', proposition: 'driver_wins_race' }, market: { lifecycle: 'CLOSED' } }), false);
  assert.equal(K.phase({ event: { state: 'in' } }), 'live');
  assert.equal(K.phase({ event: { state: 'pre' } }, '2999-01-01T00:00Z'), 'pregame');
  assert.match(K.NOTE, /finishes first in the main race/);
});

test('kalshi: pages wire the mount only on race + PBEcast templates; static build bakes no prices', () => {
  const pages = fs.readFileSync('scripts/site/pages.mjs', 'utf8');
  assert.match(pages, /kalshiRaceMount\(ev\.slug, ctx\.session\(ev\.id, 'race'\)\)/);
  assert.doesNotMatch(pages, /isPast \? '' : kalshiRaceMount/, 'completed races keep the mount');
  assert.match(pages, /kalshiCloseMount\(last\.slug, ctx\.session\(last\.id, 'race'\)\)/);
  assert.doesNotMatch(pages, /kalshiRaceMount\([^)]*sprint/);
  const pc = fs.readFileSync('scripts/site/pbecast-v2.mjs', 'utf8');
  assert.match(pc, /kalshiCastMount\(ev\.id, race\)/);
  for (const f of ['scripts/site/pages.mjs', 'scripts/site/pbecast-v2.mjs', 'scripts/site/kalshi.mjs', 'scripts/build-site.mjs']) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /market-intelligence\/(?:sport|event)/, f);
});

// ---------- market history (How the market closed) ----------
// The REAL settled tennis event (Rybakina vs Charaeva) from the PropSports API, reshaped ONLY in sport / ids / names into
// the F1 main-race field shape for QA. Every price, timestamp and settlement value is the stored real one.
const REAL = JSON.parse(fs.readFileSync('tests/fixtures/market-history-tennis-settled.json', 'utf8')).event;
const F1_ID = '2026-bahrain-grand-prix-in-malaysia-race';
function f1History(lifecycle = 'SETTLED', { kalshiNull = true } = {}) {
  const e = structuredClone(REAL);
  const names = ['Max Verstappen', 'Kimi Antonelli'];
  e.event = { ...e.event, sport: 'f1', competition: 'f1', canonical_event_id: F1_ID, state: 'post' };
  const h = e.market_history;
  h.proposition = 'driver_wins_race';
  h.shape = 'field';
  h.lifecycle = lifecycle;
  h.status_label = lifecycle === 'SETTLED' ? 'Market settled' : 'Market closed';
  h.outcomes.forEach((o, i) => { o.abbr = o.kalshi_name = names[i]; o.contract = `Main Race: ${names[i]} wins`; o.role = `p:${slug(names[i])}`; if (lifecycle === 'CLOSED') o.settlement = null; });
  if (lifecycle === 'CLOSED') h.markers.settlement = null;
  e.market = { ...e.market, proposition: 'driver_wins_race', lifecycle, close: { ...e.market.close, lifecycle, shape: 'field', outcomes: e.market.close.outcomes.map((o, i) => ({ ...o, abbr: names[i], result: lifecycle === 'CLOSED' ? null : o.result })) } };
  if (kalshiNull) e.kalshi = null; else e.kalshi.proposition = 'driver_wins_race';
  return e;
}

test('market history: SETTLED field market renders "How the market closed" (real stored values, kalshi:null)', () => {
  const e = f1History('SETTLED');
  const html = marketModule(e, { placement: 'race-page-history' });
  assert.match(html, /How the market closed/);
  assert.match(html, /kx-h__rows kx-h__rows--field/);
  assert.match(html, /<span class="kx__frank mono">1<\/span>/);
  assert.match(html, /First observed/);
  assert.doesNotMatch(html, /<small>[^<]*open/i, 'first observed is never labelled an opening price');
  assert.match(html, /not the opening price/);
  assert.match(html, /Kalshi settlement: <b>Kimi Antonelli<\/b> — YES/);
  assert.match(html, /Settled YES/);
  assert.match(html, /Final trade/);
  assert.match(html, /Settlement is the market venue's, not our result/);
  assert.match(html, /<svg[^>]*aria-label="Observed market prices over time"/);
  assert.doesNotMatch(html, /style="/, 'no inline styles (F1 CSP style-src self)');
  assert.doesNotMatch(html, /Market Pulse/);
  assert.match(html, /5\.5¢/, 'first observed 5.5¢, the stored value');
  const line = marketCloseLine(e);
  assert.match(line, /MARKET/);
  assert.match(line, /Kimi Antonelli/);
  assert.match(line, /settled YES/);
});

test('market history: CLOSED shows "awaiting settlement", never a result', () => {
  const e = f1History('CLOSED');
  const html = marketModule(e, {});
  assert.match(html, /Market closed · awaiting settlement/);
  assert.match(html, /Awaiting settlement/);
  assert.doesNotMatch(html, /Settled YES|settlement: <b>/);
  assert.match(marketCloseLine(e), /awaiting settlement/);
});

test('market history: nothing for no entry / no history / no close', () => {
  assert.equal(marketModule(null), '');
  assert.equal(marketHistoryCard(null), '');
  assert.equal(marketHistoryCard({ market: { lifecycle: 'SETTLED' } }), '');
  assert.equal(marketCloseLine(null), '');
  assert.equal(marketCloseLine({ market: { lifecycle: 'SETTLED', close: null } }), '');
  assert.equal(kalshiCloseMount('2026-bahrain-grand-prix-in-malaysia', { type: 'race', state: 'scheduled', start_utc: '2026-10-04T07:00Z' }), '', 'result line only for a completed race');
  assert.match(kalshiCloseMount('2026-bahrain-grand-prix-in-malaysia', { type: 'race', state: 'completed', start_utc: '2026-10-04T07:00Z' }), /data-kalshi-close="2026-bahrain-grand-prix-in-malaysia-race"/);
  assert.equal(kalshiCloseMount('2026-bahrain-grand-prix-in-malaysia', { type: 'sprint', state: 'completed', start_utc: '2026-10-04T07:00Z' }), '');
});

test('market history: every link is rel sponsored to the venue market', () => {
  const html = marketModule(f1History('SETTLED'));
  const links = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(links.length >= 1);
  for (const a of links) {
    assert.match(a, /rel="noopener noreferrer sponsored"/);
    assert.ok(a.includes(`href="${REAL.market_history.market_url}"`), a);
  }
  assert.match(html, /Kalshi · Prediction market data/);
});

test('market history: loader picks history vs live card; polls live 20s / pregame 45s / CLOSED 5min / SETTLED never', () => {
  const win = { document: { readyState: 'complete', addEventListener() {}, querySelector: () => null, hidden: false } };
  win.window = win;
  vm.runInNewContext(fs.readFileSync('src/web/kalshi.js', 'utf8'), { window: win, document: win.document, setTimeout, clearTimeout });
  const K = win.F1.kalshi;
  const POLL = { live: 20_000, pregame: 45_000, idle: 120_000 };
  const settled = f1History('SETTLED');
  const closed = f1History('CLOSED');
  assert.equal(K.historic(settled), true, 'kalshi:null + market_history still renders');
  assert.equal(K.historic(closed), true);
  assert.equal(K.usable(settled), false);
  assert.equal(K.nextMs(settled, null, true, POLL), 0);
  assert.equal(K.nextMs(closed, null, true, POLL), 5 * 60_000);
  const live = fieldEntry();
  live.market = { lifecycle: 'ACTIVE', proposition: 'driver_wins_race' };
  assert.equal(K.nextMs(live, '2999-01-01T00:00Z', false, POLL), 45_000);
  assert.equal(K.nextMs({ ...live, event: { ...live.event, state: 'in' } }, null, false, POLL), 20_000);
  assert.equal(K.nextMs(null, null, true, POLL), 0, 'completed race with no market: one read, then stop');
  assert.equal(K.nextMs(null, '2999-01-01T00:00Z', false, POLL), 120_000);
  const champ = f1History('SETTLED');
  champ.market.proposition = champ.market_history.proposition = 'driver_wins_championship';
  assert.equal(K.historic(champ), false, 'never a championship market');
});

test('market history: built completed race pages carry the mount + loader, no baked prices', () => {
  const dir = 'dist/races';
  if (!fs.existsSync(dir)) return;
  const pages = fs.readdirSync(dir).filter((f) => f.startsWith('2026-')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const h of pages.filter((x) => /data-kalshi-race=/.test(x))) {
    assert.match(h, /<script src="\/assets\/kalshi\.[0-9a-f]{10}\.js" defer><\/script>/);
    assert.doesNotMatch(h, /How the market closed|kx-h__row|kx__frow/, 'no prices baked into the static page');
  }
});

test('MLB market standard: shared client keeps completed field entries (kalshi:null + market history)', async () => {
  const settled = f1History('SETTLED');
  const fetchImpl = async (url) => new Response(JSON.stringify(/\/event\//.test(url) ? { enabled: true, event: settled } : { enabled: true, events: [settled] }), { status: 200 });
  const c = createKalshiClient({ sport: 'f1', fetchImpl });
  assert.equal((await c.loadEvent(F1_ID))?.market_history?.lifecycle, 'SETTLED');
  assert.ok((await c.loadBoard()).get(F1_ID), 'board keeps the completed entry');
});

test('MLB market standard: lifecycle label for every phase; a non-fresh quote is never labelled live', () => {
  const win = { document: { readyState: 'complete', addEventListener() {}, querySelector: () => null, hidden: false } };
  win.window = win;
  vm.runInNewContext(fs.readFileSync('src/web/kalshi.js', 'utf8'), { window: win, document: win.document, setTimeout, clearTimeout });
  const K = win.F1.kalshi;
  const open = (state, freshness = 'live', lc = 'ACTIVE') => { const e = fieldEntry(); e.event = { ...e.event, state }; e.kalshi.freshness = freshness; e.market = { lifecycle: lc, proposition: 'driver_wins_race' }; return e; };
  assert.deepEqual([...K.marketPhase(open('pre'), '2999-01-01T00:00Z')], ['pre', 'MARKET OPEN · PRE-RACE']);
  assert.deepEqual([...K.marketPhase(open('in'))], ['live', 'LIVE MARKET']);
  assert.deepEqual([...K.marketPhase(open('in', 'stale'))], ['live-delayed', 'MARKET OPEN · RACE IN PROGRESS']);
  assert.deepEqual([...K.marketPhase(open('post'))], ['final-open', 'RACE FINAL · MARKET STILL TRADING']);
  assert.deepEqual([...K.marketPhase(f1History('CLOSED'))], ['closed', 'MARKET CLOSED · AWAITING SETTLEMENT']);
  assert.deepEqual([...K.marketPhase(f1History('SETTLED'))], ['settled', 'MARKET SETTLED']);
  assert.equal(K.marketPhase(null), null);
  assert.equal(K.marketPhase(open('post', 'live', 'CLOSED')), null, 'closed without stored history: nothing');
});

test('MLB market standard: PBEcast mounts Market Pulse inside the grid under the timing tower (not a collapsed strip)', () => {
  const pc = fs.readFileSync('scripts/site/pbecast-v2.mjs', 'utf8');
  assert.match(pc, /<\/aside>\s*\$\{kalshiMount\}\s*<\/section>/, 'mount is the pc-grid item right after the tower');
  const loader = fs.readFileSync('src/web/kalshi.js', 'utf8');
  assert.doesNotMatch(loader, /kalshiStrip\(/, 'no collapsed strip on PBEcast');
  assert.match(loader, /ui\.kalshiCard\(entry, \{ placement: 'pbecast', compact: true \}\)/);
  assert.match(loader, /ui\.marketHistoryCard\(entry, \{ placement: 'pbecast-history' \}\)/);
  const css = fs.readFileSync('src/web/styles.css', 'utf8');
  assert.match(css, /\.pc-grid>\.pc-tower\{grid-column:2;grid-row:1\/span 2\}/);
});

test('copy: owner line, never conditional availability wording', () => {
  const b = fs.readFileSync('scripts/build-site.mjs', 'utf8');
  assert.match(b, /Live prediction-market pricing is built into PropBetEdge race pages and PBEcast\./);
  assert.doesNotMatch(b, /part of every race page|if available|selected events|when a market exists/i);
});

// shared client ad6187a: a failed read is never cached as "no market"; the next poll retries at once
test('kalshi: a failed read is never cached as no market (ad6187a)', async () => {
  const live = fieldEntry();
  let n = 0;
  const flaky = async () => { n += 1; return n === 1 ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ contract: 'market-intel/1', enabled: true, event: live, events: [live] }), { status: 200 }); };
  const c = createKalshiClient({ sport: 'f1', fetchImpl: flaky });
  assert.equal(await c.loadEvent(live.event.canonical_event_id), null, 'first read failed');
  const got = await c.loadEvent(live.event.canonical_event_id);
  assert.ok(got?.kalshi, 'retried immediately, not served a cached null');
  assert.equal(n, 2);
  // a later failure keeps the last good entry (the card stays) and is not cached either
  let m = 0;
  const later = async () => { m += 1; return m === 2 ? new Response('{}', { status: 502 }) : new Response(JSON.stringify({ enabled: true, event: live }), { status: 200 }); };
  const d = createKalshiClient({ sport: 'f1', fetchImpl: later });
  assert.ok(await d.loadEvent('x-race'));
  assert.ok(await d.loadEvent('x-race', { force: true }), 'failed refresh keeps the last good entry');
  assert.ok(await d.loadEvent('x-race'), 'and retries on the next call');
  assert.equal(m, 3);
  // board: same rule
  let b = 0;
  const fb = async () => { b += 1; return b === 1 ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ enabled: true, events: [live] }), { status: 200 }); };
  const e = createKalshiClient({ sport: 'f1', fetchImpl: fb });
  assert.equal((await e.loadBoard()).size, 0);
  assert.equal((await e.loadBoard()).size, 1);
});

test('kalshi: card subtitle says Live only for a live-fresh quote; stale says quote not current (ad6187a)', () => {
  __resetKalshiFlashes();
  const at = (freshness) => { const e = fieldEntry(); e.kalshi.freshness = freshness; return kalshiCard(e, { placement: 'race-page' }); };
  assert.match(at('live'), /<span class="kx__sub">Live prediction market · Kalshi<\/span>/);
  assert.match(at('stale'), /<span class="kx__sub">Prediction market · quote not current · Kalshi<\/span>/);
  assert.doesNotMatch(at('stale'), /Live prediction market ·/);
  assert.match(at('delayed'), /<span class="kx__sub">Prediction market · Kalshi<\/span>/);
});
