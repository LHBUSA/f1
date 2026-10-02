// PBE F1 EDGE value/ledger scaffolding: de-vig, consensus, fair price conversion, ledger immutability, UNPRICED.
import test from 'node:test';
import assert from 'node:assert/strict';
import { americanToDecimal, decimalToAmerican, fairPrice, normalizeQuote, devigTwoWay, consensus, propositionKey } from '../src/edge/market.mjs';
import { valuate } from '../src/edge/value.mjs';
import { evaluatePick, NO_OFFICIAL_PICK } from '../src/edge/policy.mjs';
import { createLedger } from '../src/edge/ledger.mjs';
import { assertAllowed, MODEL_SPECS } from '../src/edge/models.mjs';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);
const Q = (o) => normalizeQuote({ provider: 'fixture', sportsbook: 'bookA', provider_event_id: 'p1', canonical_event_id: 'espn-1', market: 'race_h2h', line: null, provider_updated_at: '2026-10-01T10:00:00Z', captured_at: '2026-10-01T10:00:05Z', source_id: 's1', ...o });

test('american <-> decimal conversion and fair prices', () => {
  near(americanToDecimal(150), 2.5);
  near(americanToDecimal(-200), 1.5);
  near(decimalToAmerican(2.5), 150);
  near(decimalToAmerican(1.5), -200);
  near(americanToDecimal(100), 2);
  const f = fairPrice(0.6);
  near(f.decimal, 1 / 0.6);
  near(f.american, -150);
  near(fairPrice(0.4).american, 150);
  assert.throws(() => americanToDecimal(50));
  assert.throws(() => fairPrice(1));
});

test('normalizeQuote fills the missing price and rejects inconsistent ones', () => {
  const q = Q({ selection: 'A', opponent: 'B', american_odds: -110 });
  near(q.decimal_odds, 1 + 100 / 110);
  assert.ok(Object.isFrozen(q));
  assert.throws(() => Q({ selection: 'A', opponent: 'B', american_odds: -110, decimal_odds: 2.2 }));
  assert.throws(() => Q({ selection: 'A', opponent: 'B' }));
  assert.throws(() => normalizeQuote({ provider: 'x' }));
});

test('two-way de-vig: raw implied, overround, no-vig sums to 1', () => {
  const a = Q({ selection: 'A', opponent: 'B', american_odds: -110 });
  const b = Q({ selection: 'B', opponent: 'A', american_odds: -110, source_id: 's2' });
  const d = devigTwoWay(a, b);
  near(d.raw_implied_a, 110 / 210);
  near(d.overround, 2 * (110 / 210) - 1);
  near(d.novig_a, 0.5);
  near(d.novig_a + d.novig_b, 1);
  const c = Q({ selection: 'A', opponent: 'B', decimal_odds: 1.5 });
  const e = Q({ selection: 'B', opponent: 'A', decimal_odds: 2.5, source_id: 's3' });
  const d2 = devigTwoWay(c, e);
  near(d2.novig_a, (1 / 1.5) / (1 / 1.5 + 1 / 2.5));
  assert.throws(() => devigTwoWay(a, Q({ selection: 'B', opponent: 'A', american_odds: -110, sportsbook: 'bookB' })));
  assert.throws(() => devigTwoWay(a, Q({ selection: 'B', opponent: 'A', american_odds: -110, line: 1.5 })));
});

test('consensus only uses books quoting both sides of the identical proposition', () => {
  const quotes = [
    Q({ sportsbook: 'bookA', selection: 'A', opponent: 'B', decimal_odds: 1.8, source_id: 'a1' }),
    Q({ sportsbook: 'bookA', selection: 'B', opponent: 'A', decimal_odds: 2.0, source_id: 'a2' }),
    Q({ sportsbook: 'bookB', selection: 'A', opponent: 'B', decimal_odds: 1.7, source_id: 'b1' }),
    Q({ sportsbook: 'bookB', selection: 'B', opponent: 'A', decimal_odds: 2.2, source_id: 'b2' }),
    Q({ sportsbook: 'bookC', selection: 'A', opponent: 'B', decimal_odds: 1.2, source_id: 'c1' }), // one side only
    Q({ sportsbook: 'bookD', selection: 'A', opponent: 'B', decimal_odds: 1.9, line: 0.5, source_id: 'd1' }), // different line
    Q({ sportsbook: 'bookD', selection: 'B', opponent: 'A', decimal_odds: 1.9, line: 0.5, source_id: 'd2' }),
    // stale bookA quote superseded by the later capture above
    Q({ sportsbook: 'bookA', selection: 'A', opponent: 'B', decimal_odds: 3.0, captured_at: '2026-09-30T00:00:00Z', source_id: 'a0' }),
  ];
  const c = consensus(quotes, { canonical_event_id: 'espn-1', market: 'race_h2h', selection: 'A', opponent: 'B' });
  assert.deepEqual(c.books_used.map((b) => b.sportsbook), ['bookA', 'bookB']);
  assert.deepEqual(c.books_excluded.map((b) => b.sportsbook), ['bookC']);
  const nvA = (1 / 1.8) / (1 / 1.8 + 1 / 2.0);
  const nvB = (1 / 1.7) / (1 / 1.7 + 1 / 2.2);
  near(c.consensus_novig, (nvA + nvB) / 2);
  assert.equal(propositionKey(quotes[0]), propositionKey(quotes[1]));
  const none = consensus(quotes.slice(4, 5), { canonical_event_id: 'espn-1', market: 'race_h2h', selection: 'A', opponent: 'B' });
  assert.equal(none.consensus_novig, null);
});

test('value engine: edge, EV and fair price; unpriced has no edge', () => {
  const q = Q({ selection: 'A', opponent: 'B', decimal_odds: 2.1 });
  const v = valuate({ pbe_probability: 0.55, quote: q, market_novig: 0.5 });
  near(v.edge_pp, 5);
  near(v.ev_per_unit, 0.55 * 2.1 - 1);
  near(v.fair_decimal, 1 / 0.55);
  const u = valuate({ pbe_probability: 0.55 });
  assert.equal(u.priced, false);
  assert.equal(u.edge_pp, null);
  assert.equal(u.ev_per_unit, null);
});

test('pick policy defaults to NO OFFICIAL PICK', () => {
  const q = Q({ selection: 'A', opponent: 'B', decimal_odds: 2.5 });
  const v = valuate({ pbe_probability: 0.6, quote: q, market_novig: 0.4 });
  assert.equal(evaluatePick({ valuation: v }).decision, NO_OFFICIAL_PICK);
  assert.equal(evaluatePick({ valuation: v }).reason, 'thresholds_not_preregistered');
  const thresholds = { registered_at: '2026-09-01T00:00:00Z', artifact_sha256: 'abc', min_edge_pp: 3, min_ev_per_unit: 0.02, min_probability: 0.5, max_overround: 0.08, min_books: 2 };
  const r = evaluatePick({ valuation: v, thresholds, model: { artifact_sha256: 'abc', status: 'research' }, consensusBooks: 3, overround: 0.05, lockTime: '2026-10-01T00:00:00Z' });
  assert.notEqual(r.decision, 'OFFICIAL_PICK');
  assert.equal(evaluatePick({ valuation: valuate({ pbe_probability: 0.6 }), thresholds, model: { artifact_sha256: 'abc' } }).reason, 'unpriced');
  assert.equal(evaluatePick({ valuation: v, thresholds, model: { artifact_sha256: 'zzz' } }).reason, 'thresholds_bound_to_different_artifact');
});

const PICK = { pick_id: 'p1', canonical_event_id: 'espn-1', market: 'race_h2h', selection: 'A', opponent: 'B', model_version: 'f1-edge-race-h2h-pre@0.1.0-research', artifact_sha256: 'art', dataset_sha256: 'ds', feature_snapshot_sha256: 'fs', pbe_probability: 0.6, lock_time: '2026-10-01T12:00:00Z' };

test('ledger is append-only, hash-chained and frozen', () => {
  const L = createLedger();
  const q = Q({ selection: 'A', opponent: 'B', decimal_odds: 2.0, captured_at: '2026-10-01T11:00:00Z' });
  const e = L.recordPick({ ...PICK, quote: q, captured_at: q.captured_at, market_novig: 0.5, edge_pp: 10, ev_per_unit: 0.2 });
  assert.ok(Object.isFrozen(e) && Object.isFrozen(e.payload) && Object.isFrozen(e.payload.quote));
  assert.throws(() => { e.payload.pbe_probability = 0.9; });
  assert.throws(() => L.recordPick({ ...PICK }), /duplicate/);
  assert.equal(L.pick('p1').status, 'OPEN');
  L.settle('p1', 'WIN', 'classified ahead of opponent', '2026-10-01T16:00:00Z');
  assert.throws(() => L.settle('p1', 'LOSS', 'again'), /already settled/);
  assert.equal(L.pick('p1').status, 'SETTLED');
  assert.ok(L.verify());
  near(L.summary().units, 1);
  // tamper detection: rebuild from events with an altered payload breaks the chain
  const evs = L.events();
  const forged = [{ ...evs[0], payload: { ...evs[0].payload, pbe_probability: 0.99 } }, evs[1]];
  const L2 = createLedger();
  for (const f of forged) L2.append(f.type, f.payload);
  assert.notEqual(L2.events()[0].entry_hash, evs[0].entry_hash);
});

test('UNPRICED picks: no quote or a post-lock quote; never priced later; excluded from ROI', () => {
  const L = createLedger();
  L.recordPick({ ...PICK, pick_id: 'u1' });
  const late = Q({ selection: 'A', opponent: 'B', decimal_odds: 2.0, captured_at: '2026-10-01T12:00:01Z' });
  L.recordPick({ ...PICK, pick_id: 'u2', quote: late, captured_at: late.captured_at, edge_pp: 10 });
  assert.equal(L.pick('u1').status, 'UNPRICED');
  assert.equal(L.pick('u1').unpriced_reason, 'no_quote_at_lock');
  assert.equal(L.pick('u2').status, 'UNPRICED');
  assert.equal(L.pick('u2').unpriced_reason, 'quote_captured_after_lock');
  assert.equal(L.pick('u2').edge_pp, null);
  assert.throws(() => L.attachQuote('u1'), /append-only/);
  L.settle('u1', 'WIN', 'fixture');
  assert.equal(L.pick('u1').status, 'SETTLED_UNPRICED');
  const s = L.summary();
  assert.equal(s.wins, 1);
  assert.equal(s.unpriced, 2);
  assert.equal(s.roi, null);
});

test('sportsbook odds and the Circuit Fit score are never model features', () => {
  assert.throws(() => assertAllowed(['q_bt', 'market_novig'], MODEL_SPECS.quali_h2h), /market/);
  assert.throws(() => assertAllowed(['decimal_odds'], MODEL_SPECS.quali_h2h), /market/);
  assert.throws(() => assertAllowed(['cf_score'], MODEL_SPECS.quali_h2h), /forbidden/);
  assert.throws(() => assertAllowed(['grid_diff'], MODEL_SPECS.race_h2h_pre), /grid/);
  assert.doesNotThrow(() => assertAllowed(['r_bt', 'grid_logratio'], MODEL_SPECS.race_h2h_post));
});
