// Article Market module on F1 news (article-market/1): link, prospective eligibility, slot placement, vendored client pin.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { marketLink, articleMarketEvent, ARTICLE_MARKET_ACTIVATED_AT } from '../src/news/market.mjs';
import { articleMarketSlot } from '../src/news/render.mjs';
import { articleMarketModule } from '../src/vendor/kalshi/article-market-ui.js';

const X = { session: (id, type) => (id === '2026-bahrain-grand-prix-in-malaysia' && type === 'race' ? { type: 'race', state: 'completed' } : id === '2026-cancelled-grand-prix' && type === 'race' ? { type: 'race', state: 'canceled' } : null) };
const packet = { entities: [
  { key: 'race', type: 'race', ref: '2026-bahrain-grand-prix-in-malaysia' },
  { key: 'p1', type: 'driver', ref: 'max-verstappen' }, { key: 'p2', type: 'driver', ref: 'lewis-hamilton' }, { key: 'p3', type: 'driver', ref: 'isack-hadjar' },
  { key: 'p1_team', type: 'team', ref: 'red-bull' }, { key: 'pole', type: 'driver', ref: 'max-verstappen' }, { key: 'dnf1', type: 'driver', ref: 'someone' },
] };
const story = (published_at, extra = {}) => ({ slug: 's', published_at, market: marketLink(X, '2026-bahrain-grand-prix-in-malaysia', packet), ...extra });

test('link: exactly one canonical main-race market id, story drivers as focus (canonical ids, deduped)', () => {
  const m = marketLink(X, '2026-bahrain-grand-prix-in-malaysia', packet);
  assert.equal(m.canonical_event_id, '2026-bahrain-grand-prix-in-malaysia-race');
  assert.equal(m.sport, 'f1');
  assert.equal(m.proposition, 'driver_wins_race');
  assert.deepEqual(m.focus, ['max-verstappen', 'lewis-hamilton', 'isack-hadjar']);
  assert.equal(marketLink(X, '2026-cancelled-grand-prix', packet), null);
  assert.equal(marketLink(X, '2026-no-race', packet), null);
});

test('eligibility is prospective: before the activation time never, at/after it yes', () => {
  assert.equal(ARTICLE_MARKET_ACTIVATED_AT, '2026-10-04T14:31:40Z');
  assert.equal(articleMarketEvent(story('2026-10-04T14:31:39.999Z')), null);
  assert.equal(articleMarketEvent(story('2026-10-03T09:32:30.784Z')), null);
  assert.equal(articleMarketEvent(story('2026-10-04T14:31:40.000Z')), '2026-bahrain-grand-prix-in-malaysia-race');
  assert.equal(articleMarketEvent(story('2026-10-04T17:00:00Z', { market: null })), null);
  assert.equal(articleMarketEvent(story('2026-10-04T17:00:00Z', { market: { sport: 'f1', canonical_event_id: '2026-x-grand-prix-sprint-race' } })), null);
});

test('slot: empty element (no box) with the original publication time and focus; nothing on older stories', () => {
  const html = articleMarketSlot(story('2026-10-04T17:00:00.000Z'));
  assert.equal(html, '<div class="nmarket" data-art-market="2026-bahrain-grand-prix-in-malaysia-race" data-published="2026-10-04T17:00:00.000Z" data-focus="max-verstappen,lewis-hamilton,isack-hadjar"></div>');
  assert.equal(articleMarketSlot(story('2026-10-03T09:32:30.784Z')), '');
});

test('real payload (Kalshi KXF1RACE-BAH26, settled): THE MARKET RESULT, focus rows + winner, "+N more", no PBE call', () => {
  const p = JSON.parse(fs.readFileSync('tests/fixtures/article-market-f1-bah26.json', 'utf8'));
  const html = articleMarketModule(p, { focus: ['max-verstappen', 'lewis-hamilton'] });
  assert.match(html, /The market result/);
  assert.match(html, /Max Verstappen/);
  assert.match(html, /Lewis Hamilton/);
  assert.match(html, /\+\d+ more in the field on Kalshi/);
  assert.match(html, /No official call/);
  assert.doesNotMatch(html, /style="/); // prod CSP style-src 'self'
  assert.equal(articleMarketModule({ ...p, eligible: false }), '');
});

test('vendored Article Market client is byte-identical to propbetedge-workers 8d3b73f', () => {
  const lf = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  const pin = {
    'article-market-ui.js': '2149e2854142657a554ef119533680c77657f0d2b1ea8406fe4de711e4fbe635',
    'article-market-ui.css': '60c223f6afbe32059ea272aeaff648759c254f3494106c41822afaf328c7aa4e',
  };
  for (const [name, sha] of Object.entries(pin)) assert.equal(crypto.createHash('sha256').update(lf(`src/vendor/kalshi/${name}`)).digest('hex'), sha, name);
});

test('vercel.json: exact same-origin rewrite for the F1 article market route only', () => {
  const v = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const r = v.rewrites.find((x) => x.source.startsWith('/api/markets/'));
  assert.equal(r.source, '/api/markets/v1/article-market/f1/:id(\\d{4}-[a-z0-9-]+-race)');
  assert.equal(r.destination, 'https://propsports-markets.sales-fd3.workers.dev/v1/article-market/f1/:id');
});

test('freeze: a FINAL packet (EMBED_THIS_PACKET) for THIS story is stored and rendered from the stored copy, no live read', async () => {
  const { freezable, indexMarket } = await import('../src/news/market.mjs');
  const p = JSON.parse(fs.readFileSync('tests/fixtures/article-market-f1-bah26-final.json', 'utf8'));
  const a = { slug: 'max-verstappen-wins-2026-bahrain-grand-prix-in-malaysia', published_at: '2026-10-04T16:54:02.924Z', market: { contract: 'article-market/1', sport: 'f1', canonical_event_id: '2026-bahrain-grand-prix-in-malaysia-race', focus: ['max-verstappen', 'kimi-antonelli', 'lewis-hamilton', 'george-russell'] } };
  const fz = freezable(a, p);
  assert.ok(fz);
  assert.equal(fz.packet.sha256, p.packet.sha256);
  assert.equal(fz.packet.packet_state, 'FINAL');
  assert.deepEqual(fz.live.venues, []); // no time-varying live layer stored
  // another story / another publication time / not final -> never stored
  assert.equal(freezable({ ...a, published_at: '2026-10-04T16:55:00Z' }, p), null);
  assert.equal(freezable(a, { ...p, freeze: 'DO_NOT_FREEZE_YET' }), null);
  assert.equal(freezable(a, { ...p, packet: { ...p.packet, packet_state: 'PROVISIONAL' } }), null);
  assert.equal(freezable({ ...a, market: { ...a.market, canonical_event_id: '2026-singapore-grand-prix-race' } }, p), null);
  const stored = { ...a, market: { ...a.market, frozen: { sha256: p.packet.sha256, embedded_at: '2026-10-04T17:10:00Z', payload: fz } } };
  const html = articleMarketSlot(stored);
  assert.match(html, new RegExp(`data-am-frozen="${p.packet.sha256}"`));
  assert.match(html, /The market result/);
  assert.match(html, /Settled/);
  assert.match(html, /Max Verstappen/);
  assert.doesNotMatch(html, /style="/);
  assert.deepEqual(Object.keys(indexMarket(stored.market).frozen), ['sha256', 'embedded_at']);
});
