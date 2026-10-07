// Newsroom engine regressions (2026-10-07 "three days without a story" P0). Every case passes an explicit instant; the
// projection cases run against data/projection (built by the pipeline), the scheduler cases are pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCandidates, decide, newsroomHealth, SLUG } from '../src/news/newsroom.mjs';
import { materialMove, marketMovePacket, MARKET_RULES } from '../src/news/market-move.mjs';
import { newsroomState, healthPayload, NEWSROOM } from '../workers/f1-api/src/newsroom.js';

const HAVE = fs.existsSync('data/projection/events-2026.json');
const skip = !HAVE && 'needs data/projection';
const load = async () => (await import('../src/news/data.mjs')).loadProjection();
const MAL = '2026-bahrain-grand-prix-in-malaysia'; // race 2026-10-04T07:00Z
const SIN = '2026-singapore-grand-prix'; // qualifying 2026-10-10T13:00Z, race 2026-10-11T12:00Z
const C = (cls, extra = {}) => ({ [cls]: { mode: 'canary', canary: 3, seasons: [2026], ...extra } });
const run = (X, classes, opts) => { const { candidates, evaluations } = buildCandidates(X, classes, opts); return { candidates, ...decide(X, classes, candidates, { ...opts, evaluations }) }; };
const asLive = (articles) => Object.fromEntries(articles.filter((a) => a.status === 'published').map((a) => [a.slug, { slug: a.slug, class: a.class, topic: a.topic, event_id: a.event_id, status: a.status, headline: a.headline, published_at: a.published_at, modified_at: a.modified_at, packet_hash: a.packet_hash, market: a.market }]));

// a market-tape entry shaped like propsports-markets market-tape/1
const tape = (outs, { observed = '2026-10-08T06:00:00.000Z', lifecycle = 'UPCOMING' } = {}) => ({ classes: { upcoming: [{ venue: 'kalshi', sport: 'f1', canonical_event_id: `${SIN}-race`, source_event_id: 'KXF1RACE-SIN26', lifecycle, event_state: 'pre', freshness: 'live', observed_at: observed, outcomes: outs.map(([id, first, now, firstAt = '2026-10-06T20:19:26.912Z']) => ({ role: `p:${id}`, state: 'open', first_bp: first, price_bp: now, first_observed_at: firstAt })) }] } });

// ---------- 1. an eligible new story publishes ----------
test('eligible: the championship update after the latest round publishes at first publication time, unlinked from markets', { skip }, async () => {
  const X = await load();
  const now = '2026-10-07T19:00:00.000Z';
  const { articles, report } = run(X, C('championship'), { now, live: {} });
  const a = articles.find((x) => x.slug === `${MAL}-championship-standings`);
  assert.ok(a, 'Malaysia championship update is a candidate');
  assert.equal(a.status, 'published', JSON.stringify(a.validation.reasons.concat(a.editorial.reasons)));
  assert.equal(a.published_at, now, 'first publication = this run, never backdated to the race');
  assert.equal(a.archive, null);
  assert.equal(a.market, null, 'championship stories carry no race-winner market link');
  assert.equal(report.classes.championship.candidates, 1, 'only the latest round is eligible');
});

test('eligible: a material, 24h-old Kalshi move on the next race publishes a market story', { skip }, async () => {
  const X = await load();
  const now = '2026-10-08T06:10:00.000Z';
  const t = tape([['max-verstappen', null, 3050], ['kimi-antonelli', 1500, 2350], ['lewis-hamilton', 1200, 1450], ['charles-leclerc', 1200, 1150], ['lando-norris', 1000, 1100]]);
  const { articles } = run(X, C('market_move'), { now, live: {}, tape: t });
  const a = articles.find((x) => x.class === 'market_move');
  assert.ok(a, 'candidate');
  assert.equal(a.status, 'published', JSON.stringify(a.validation.reasons.concat(a.editorial.reasons)));
  assert.equal(a.slug, `${SIN}-market-move`);
  assert.equal(a.market.canonical_event_id, `${SIN}-race`, 'linked to its own race-winner market');
  assert.equal(a.packet.get?.('mv_rank') ?? a.packet.facts.find((f) => f.id === 'mv_rank').display, 'the second-highest price in the field', 'the field includes contracts without a first price');
  assert.match(a.headline, /15¢ to 23\.5¢/);
});

// ---------- 2. an ineligible story stays held / is not a candidate ----------
test('ineligible: a thin draft is held, never published; sub-threshold and too-young market moves are not candidates', { skip }, async () => {
  const X = await load();
  const { articles } = run(X, C('qualifying', { canary: 99 }), { now: '2026-10-07T19:00:00.000Z', live: {} });
  const held = articles.find((x) => x.slug === '2026-australian-grand-prix-qualifying-results');
  assert.equal(held.status, 'held');
  assert.ok(held.validation.reasons.length + held.editorial.reasons.length > 0);
  const now = '2026-10-08T06:10:00.000Z';
  const below = run(X, C('market_move'), { now, live: {}, tape: tape([['kimi-antonelli', 1500, 2200]]) });
  assert.equal(below.candidates.length, 0);
  assert.equal(below.report.evaluations[0].result, 'below_threshold');
  const young = run(X, C('market_move'), { now, live: {}, tape: tape([['kimi-antonelli', 1500, 2350, '2026-10-07T22:00:00.000Z']]) });
  assert.equal(young.report.evaluations[0].result, 'window_under_24h');
  assert.equal(materialMove(tape([['kimi-antonelli', 1500, 2400]], { observed: '2026-10-08T03:00:00.000Z' }).classes.upcoming[0], now).reason, 'market_read_not_fresh');
  assert.equal(materialMove(tape([['kimi-antonelli', 1500, 2400]], { lifecycle: 'ACTIVE' }).classes.upcoming[0], now).reason, 'market_not_upcoming:ACTIVE');
  assert.equal(MARKET_RULES.min_move_bp, 800);
});

// ---------- 3. a stale time-boxed story never becomes newly published ----------
test('stale: a preview or championship update past its window is never first-published', { skip }, async () => {
  const X = await load();
  const { previewPacket } = await import('../src/news/preview.mjs');
  const { composePreview } = await import('../src/news/compose-preview.mjs');
  // built before the race, decided after it started, never published before -> stale
  const early = '2026-10-08T00:00:00.000Z', late = '2026-10-11T13:00:00.000Z';
  const P = previewPacket(X, SIN, { asOf: late, publishedAt: late }).packet;
  const draft = { ...composePreview(P), slug: `${SIN}-preview` };
  const classes = C('preview');
  const { articles } = decide(X, classes, [{ cls: 'preview', cfg: classes.preview, ev: X.event[SIN], P, draft, sortKey: early }], { now: late, live: {} });
  assert.ok(['stale', 'held'].includes(articles[0].status) && articles[0].status !== 'published');
  // and the selector does not even propose it after the race start
  assert.equal(run(X, classes, { now: late, live: {} }).candidates.filter((c) => c.ev.id === SIN).length, 0);
  // championship update for Malaysia once the Singapore weekend has started: not proposed
  assert.equal(run(X, C('championship'), { now: '2026-10-09T09:00:00.000Z', live: {} }).candidates.filter((c) => c.ev.id === MAL).length, 0);
  // market story: never first-published once qualifying has started
  const t = tape([['kimi-antonelli', 1500, 2350]], { observed: '2026-10-10T13:30:00.000Z' });
  assert.equal(marketMovePacket(X, SIN, t.classes.upcoming[0], { asOf: '2026-10-10T13:40:00.000Z' }).reason, 'qualifying_started');
});

// ---------- 4. a missed qualifying / race story follows archive semantics ----------
test('missed: a qualifying or race story first published late is an archive backfill at its real publication time', { skip }, async () => {
  const X = await load();
  const now = '2026-10-08T12:00:00.000Z'; // > 72h after the Malaysia race, after its race started
  const { articles } = run(X, { ...C('qualifying', { canary: 99 }), ...C('race_final', { canary: 99 }) }, { now, live: {} });
  for (const slug of [`${MAL}-qualifying-results`, `max-verstappen-wins-${MAL}`]) {
    const a = articles.find((x) => x.slug === slug);
    assert.equal(a.published_at, now, `${slug}: never backdated`);
    assert.equal(a.archive, 'backfill', `${slug}: labelled archive`);
    assert.equal(a.packet.context.temporal.archive_backfill, true);
  }
  const { newsSitemapXml } = await import('../src/news/pages.mjs');
  const pub = articles.filter((a) => a.status === 'published');
  assert.equal(newsSitemapXml(pub, X, 'https://x', now).xml.includes(`${MAL}-qualifying-results`), false, 'backfills stay out of Google News');
});

// ---------- frozen publication dates and frozen market stories ----------
test('rebuild: a published story keeps published_at, modified_at and packet hash; a frozen market story is carried forward', { skip }, async () => {
  const X = await load();
  const t0 = '2026-10-08T06:10:00.000Z';
  const t = tape([['max-verstappen', null, 3050], ['kimi-antonelli', 1500, 2350], ['lewis-hamilton', 1200, 1450], ['charles-leclerc', 1200, 1150], ['lando-norris', 1000, 1100]]);
  const first = run(X, { ...C('championship'), ...C('market_move') }, { now: '2026-10-07T19:00:00.000Z', live: {}, tape: null });
  const mm = run(X, C('market_move'), { now: t0, live: {}, tape: t });
  const live = { ...asLive(first.articles), ...asLive(mm.articles) };
  assert.ok(live[`${SIN}-market-move`], 'market story published in the first run');
  const docs = Object.fromEntries(mm.articles.filter((a) => a.status === 'published').map((a) => [a.slug, JSON.parse(JSON.stringify({ packet: a.packet, draft: a.draft }))]));
  // a day later prices have moved again: the published market story must not change
  const later = run(X, { ...C('championship'), ...C('market_move') }, { now: '2026-10-09T05:00:00.000Z', live, liveDocs: docs, tape: tape([['kimi-antonelli', 1500, 4000]], { observed: '2026-10-09T04:55:00.000Z' }) });
  for (const slug of Object.keys(live)) {
    const a = later.articles.find((x) => x.slug === slug);
    assert.equal(a.status, 'published', slug);
    assert.equal(a.published_at, live[slug].published_at, `${slug}: published_at frozen`);
    assert.equal(a.packet_hash, live[slug].packet_hash, `${slug}: packet unchanged`);
    assert.equal(a.modified_at, live[slug].modified_at, `${slug}: modified_at unchanged`);
  }
  assert.throws(() => buildCandidates(X, C('market_move'), { now: '2026-10-09T05:00:00.000Z', live, liveDocs: {}, tape: null }), /without its stored packet/);
});

// ---------- 5. no eligible news is a healthy, visible zero ----------
test('quiet run: zero eligible stories is reported as healthy with its evaluations, not as silence', { skip }, async () => {
  const X = await load();
  const now = '2026-10-08T06:10:00.000Z';
  const { articles, report } = run(X, C('market_move'), { now, live: {}, tape: null });
  const h = newsroomHealth({ now, articles, report, live: {} });
  assert.equal(h.healthy, true);
  assert.equal(h.outcome, 'no_new_eligible');
  assert.equal(h.candidates, 0);
  assert.deepEqual(h.evaluations, [{ class: 'market_move', event_id: SIN, result: 'market_tape_unavailable' }]);
  assert.equal(h.next_expected_evaluation, '2026-10-08T12:10:00.000Z');
  assert.equal(h.last_publication, null);
});

test('slugs are stable per class', () => {
  const P = { event_id: 'e', entities: [{ key: 'p1', ref: 'd' }] };
  assert.deepEqual(Object.fromEntries(Object.entries(SLUG).map(([k, f]) => [k, f(P)])), { race_final: 'd-wins-e', qualifying: 'e-qualifying-results', preview: 'e-preview', championship: 'e-championship-standings', market_move: 'e-market-move' });
});

// ---------- 6. scheduler + health expose a stale newsroom ----------
const H = (iso) => ({ run_at: iso, candidates: 0, outcome: 'no_new_eligible', last_publication: { slug: 's', class: 'race_final', published_at: '2026-10-04T16:54:02.924Z' } });
const L = (at, ok = true, extra = {}) => ({ last_trigger: { at, ok, reason: 'session_completed:race' }, ...extra });

test('scheduler: healthy run -> ok, next evaluation = last evaluation + 6h', () => {
  const s = newsroomState({ now: '2026-10-07T12:00:00.000Z', health: H('2026-10-07T10:00:00.000Z'), ledger: L('2026-10-04T10:50:00.000Z') });
  assert.equal(s.status, 'ok');
  assert.equal(s.action, 'none');
  assert.equal(s.next_expected_evaluation, '2026-10-07T16:00:00.000Z');
});

test('scheduler: nothing evaluated for 6h -> heartbeat rebuild; never while a session is live', () => {
  const now = '2026-10-07T16:30:00.000Z', health = H('2026-10-07T10:00:00.000Z'), ledger = L('2026-10-04T10:50:00.000Z');
  assert.equal(newsroomState({ now, health, ledger }).action, 'newsroom_evaluation');
  assert.equal(newsroomState({ now, health, ledger, liveNow: true }).action, 'none');
});

test('health: no run for 7h is STALE (503), with the last publication and next evaluation exposed', () => {
  const now = '2026-10-07T18:00:00.000Z';
  const p = healthPayload({ now, health: H('2026-10-07T10:00:00.000Z'), ledger: L('2026-10-04T10:50:00.000Z') });
  assert.equal(p.status, 'stale');
  assert.equal(p.stale, true);
  assert.equal(p.last_successful_run, '2026-10-07T10:00:00.000Z');
  assert.equal(p.last_publication.published_at, '2026-10-04T16:54:02.924Z');
  assert.ok(p.next_expected_evaluation);
  assert.equal(healthPayload({ now, health: null, ledger: null }).status, 'stale', 'no recorded run is stale, never ok');
});

test('health: a triggered rebuild that never produced a run is build_failing, retried once, then on the heartbeat (10-04 race-night case)', () => {
  const run0 = H('2026-10-04T05:00:00.000Z');
  const trig = '2026-10-04T10:50:24.591Z';
  assert.equal(newsroomState({ now: '2026-10-04T11:20:00.000Z', health: run0, ledger: L(trig) }).status, 'ok', 'inside the grace window: awaiting, not yet failing');
  assert.equal(newsroomState({ now: '2026-10-04T11:20:00.000Z', health: run0, ledger: L(trig) }).awaiting_build, true);
  const s = newsroomState({ now: '2026-10-04T11:40:00.000Z', health: run0, ledger: L(trig) });
  assert.equal(s.status, 'build_failing');
  assert.equal(s.action, 'build_retry');
  // after the retry fires (its own trigger), no fast re-retry; the heartbeat takes over 6h later
  const retried = { last_trigger: { at: '2026-10-04T11:40:00.000Z', ok: true, reason: 'build_retry' }, build_retry_for: '2026-10-04T11:40:00.000Z' };
  assert.equal(newsroomState({ now: '2026-10-04T12:40:00.000Z', health: run0, ledger: retried }).action, 'none');
  assert.equal(newsroomState({ now: '2026-10-04T12:40:00.000Z', health: run0, ledger: retried }).status, 'build_failing');
  assert.equal(newsroomState({ now: '2026-10-04T17:41:00.000Z', health: run0, ledger: retried }).action, 'newsroom_evaluation');
  assert.equal(NEWSROOM.EVAL_MS, 6 * 3600e3);
});
