// PBE F1 EDGE research core: time-safety primitives and model symmetry on synthetic fixtures (no data/ needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { qualiPairDelta, prefixBefore, raceOrderKey } from '../src/edge/data.mjs';
import { fitBT } from '../src/edge/bt.mjs';
import { fitModel, predict } from '../src/edge/models.mjs';
import { summarize, favouriteBuckets } from '../src/edge/metrics.mjs';

test('teammate gap uses the deepest knockout session both drivers set a time in', () => {
  assert.equal(qualiPairDelta({ q1: 80000, q2: 79500, q3: 79000 }, { q1: 80100, q2: 79400, q3: null }).stage, 'q2');
  assert.equal(qualiPairDelta({ q1: 80000, q2: null }, { q1: 80100, q2: 79400 }).stage, 'q1');
  assert.equal(qualiPairDelta({ best: 80000 }, { best: 80800 }).stage, 'best');
  assert.ok(Math.abs(qualiPairDelta({ best: 80800 }, { best: 80000 }).pct - 1) < 1e-9);
});

test('prefixBefore is strict: a session starting exactly at the cutoff is excluded', () => {
  const idx = { sessions: [{ t: 1 }, { t: 5 }, { t: 10 }, { t: 10 }, { t: 12 }] };
  assert.equal(prefixBefore(idx, 10).length, 2);
  assert.equal(prefixBefore(idx, 10.5).length, 4);
  assert.equal(prefixBefore(idx, 0).length, 0);
});

test('race order key: positioned < unpositioned by laps < disqualified', () => {
  assert.ok(raceOrderKey({ position: 18 }) < raceOrderKey({ position: null, laps: 50 }));
  assert.ok(raceOrderKey({ position: null, laps: 50 }) < raceOrderKey({ position: null, laps: 10 }));
  assert.ok(raceOrderKey({ position: null, laps: 1 }) < raceOrderKey({ status: 'disqualified', position: 3 }));
});

function synthSessions() {
  // Driver x always beats y; z (same car as y) beats y; teams P (x) and Q (y, z).
  const out = [];
  for (let k = 0; k < 12; k++) out.push({ type: 'qualifying', t: k * 86400000, season: 2025, rows: [
    { d: 'x', L: 'P', pos: 1 }, { d: 'z', L: 'Q', pos: 2 }, { d: 'y', L: 'Q', pos: 3 }, { d: 'w', L: 'P', pos: k % 2 ? 4 : 1.5 },
  ] });
  return out;
}

test('BT fit is deterministic, time-safe and orders strengths sensibly', () => {
  const s = synthSessions();
  const cut = 20 * 86400000;
  const args = { cutoff: cut, season: 2025, kind: 'qualifying', entrants: [{ d: 'x', L: 'P' }, { d: 'y', L: 'Q' }, { d: 'z', L: 'Q' }, { d: 'rookie', L: 'Q' }] };
  const a = fitBT(s, args);
  const b = fitBT(s, args);
  assert.equal(a.strength('x', 'P'), b.strength('x', 'P'));
  assert.ok(a.strength('x', 'P') > a.strength('z', 'Q'));
  assert.ok(a.theta('z') > a.theta('y'));
  assert.equal(a.theta('rookie'), 0); // unseen driver is fully shrunk to the field mean
  // sessions at/after the cutoff are ignored
  const late = fitBT([...s, { type: 'qualifying', t: cut, season: 2025, rows: [{ d: 'y', L: 'Q', pos: 1 }, { d: 'x', L: 'P', pos: 2 }] }], args);
  assert.equal(late.strength('x', 'P'), a.strength('x', 'P'));
  assert.ok(a.max_t < cut);
});

test('pair model is antisymmetric: swapping a and b flips the probability', () => {
  const rows = [];
  for (let i = 0; i < 200; i++) {
    const z = ((i * 37) % 101) / 50 - 1;
    rows.push({ y: (i * 13) % 7 < 3.5 + 3 * z ? 1 : 0, teammate: i % 3 === 0, features: { q_bt: z, tm_gap_decay: -z / 2 } });
  }
  const spec = { kind: 'pair', cutoff: 'event_start' };
  const m = fitModel(rows, ['q_bt', 'tm_gap_decay', 'tmx_tm_gap_decay'], spec);
  const r = { teammate: true, features: { q_bt: 0.4, tm_gap_decay: -0.3 } };
  const s = { teammate: true, features: { q_bt: -0.4, tm_gap_decay: 0.3 } };
  assert.ok(Math.abs(predict(m, r) + predict(m, s) - 1) < 1e-12);
});

test('metrics: perfect and coin-flip forecasts', () => {
  const coin = summarize([{ p: 0.5, y: 1 }, { p: 0.5, y: 0 }]);
  assert.ok(Math.abs(coin.log_loss - Math.log(2)) < 1e-4);
  assert.equal(coin.brier, 0.25);
  const b = favouriteBuckets([{ p: 0.8, y: 1 }, { p: 0.2, y: 0 }, { p: 0.3, y: 1 }]);
  assert.deepEqual(b.map((x) => [x.bucket, x.n, x.observed]), [['0.70-0.75', 1, 0], ['0.80-0.85', 2, 1]]);
});
