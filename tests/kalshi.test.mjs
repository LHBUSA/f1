import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { kalshiCard, kalshiStrip, __resetKalshiFlashes } from '../src/vendor/kalshi/kalshi-market-ui.js';
import { createKalshiClient } from '../src/vendor/kalshi/kalshi-market-client.js';
import { kalshiRaceMount, kalshiStripMount, raceMarketId, isRaceMarketId } from '../scripts/site/kalshi.mjs';

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

// sha256 of the canonical shared files (propbetedge-workers/workers/propsports-markets/client), LF-normalised
const VENDOR_SHA = {
  'kalshi-market-ui.js': '6f1c1244403f078da96182c7658e0f3da3e3777ccffa80b834257245a2aa2d81',
  'kalshi-market-ui.css': '43cbdcc9313a82618c38bd3998e020943e0db2031b95ed34ef566e91883901fd',
  'kalshi-market-client.js': '653cb0fc2673f909552453052560bfd6194e0e4d045c51b1eb73483957d4c049',
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
  // the F1 loader talks only to the shared client (which reads the PropSports markets API)
  assert.doesNotMatch(fs.readFileSync('src/web/kalshi.js', 'utf8'), /\bfetch\(/);
});

test('kalshi: the race mount only ever targets the MAIN race session, never a sprint', () => {
  const ev = '2026-bahrain-grand-prix-in-malaysia';
  const race = { type: 'race', state: 'scheduled', start_utc: '2026-10-04T07:00Z' };
  assert.equal(raceMarketId(ev, race), `${ev}-race`);
  assert.match(kalshiRaceMount(ev, race), /data-kalshi-race="2026-bahrain-grand-prix-in-malaysia-race"/);
  assert.match(kalshiStripMount(ev, race), /data-kalshi-strip="2026-bahrain-grand-prix-in-malaysia-race"/);
  for (const type of ['sprint', 'sprint-qualifying', 'qualifying', 'fp1']) {
    assert.equal(raceMarketId(ev, { type, state: 'scheduled' }), null, type);
    assert.equal(kalshiRaceMount(ev, { type, state: 'scheduled' }), '', type);
    assert.equal(kalshiStripMount(ev, { type, state: 'scheduled' }), '', type);
  }
  assert.equal(kalshiRaceMount(ev, null), '');
  assert.equal(kalshiRaceMount(ev, { ...race, state: 'completed' }), '', 'completed race: no mount');
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
  assert.equal(K.phase({ event: { state: 'in' } }), 'live');
  assert.equal(K.phase({ event: { state: 'pre' } }, '2999-01-01T00:00Z'), 'pregame');
  assert.match(K.NOTE, /finishes first in the main race/);
});

test('kalshi: pages wire the mount only on race + PBEcast templates; static build bakes no prices', () => {
  const pages = fs.readFileSync('scripts/site/pages.mjs', 'utf8');
  assert.match(pages, /kalshiRaceMount\(ev\.slug, ctx\.session\(ev\.id, 'race'\)\)/);
  assert.doesNotMatch(pages, /kalshiRaceMount\([^)]*sprint/);
  const pc = fs.readFileSync('scripts/site/pbecast-v2.mjs', 'utf8');
  assert.match(pc, /kalshiStripMount\(ev\.id, race\)/);
  for (const f of ['scripts/site/pages.mjs', 'scripts/site/pbecast-v2.mjs', 'scripts/site/kalshi.mjs', 'scripts/build-site.mjs']) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /market-intelligence\/(?:sport|event)/, f);
});
