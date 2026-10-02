// Championship trend regression: proves movement is detected (not only a zero-change round), ties use FIA countback,
// and "unchanged" is never rendered like "no history".
import test from 'node:test';
import assert from 'node:assert/strict';
import { rankWithCountback, trendFor } from '../src/core/standings.mjs';
import { trendCell } from '../scripts/site/components.mjs';

const pos = (ranked) => Object.fromEntries(ranked.map(([id, v]) => [id, v.pos]));

test('countback: equal points split by most wins, then most second places', () => {
  const r = pos(rankWithCountback({ a: 10, b: 10, c: 10, d: 25 }, { a: [2, 5], b: [1, 9], c: [2, 3], d: [1] }));
  assert.deepEqual(r, { d: 1, b: 2, c: 3, a: 4 }); // b has a win; c and a tie on 2nds, c has the better 3rd
});

test('countback applies to constructors (both cars count)', () => {
  const r = pos(rankWithCountback({ x: 7, y: 7 }, { x: [11, 12, 9], y: [10, 14] }));
  assert.deepEqual(r, { x: 1, y: 2 }); // x has a 9th, y's best is 10th
});

// fixture: round 1 -> round 2 with one riser, two fallers, one unchanged, one newcomer
const ROUND1 = { drivers: { ana: { pos: 1 }, ben: { pos: 2 }, cal: { pos: 3 }, dev: { pos: 4 } } };
const ROUND2 = { drivers: { cal: { pos: 1 }, ana: { pos: 2 }, ben: { pos: 3 }, dev: { pos: 4 }, eve: { pos: 5 } } };
const PROG = { rounds: [ROUND1, ROUND2] };

test('trend detects a riser and fallers, not only zero-change rounds', () => {
  assert.deepEqual(trendFor(PROG, 'driver', 'cal', 1), { state: 'up', delta: 2 });
  assert.deepEqual(trendFor(PROG, 'driver', 'ana', 2), { state: 'down', delta: -1 });
  assert.deepEqual(trendFor(PROG, 'driver', 'ben', 3), { state: 'down', delta: -1 });
  assert.deepEqual(trendFor(PROG, 'driver', 'dev', 4), { state: 'same', delta: 0 });
});

test('missing history is "na", never "same"', () => {
  assert.equal(trendFor(PROG, 'driver', 'eve', 5).state, 'na'); // no position after the previous round
  assert.equal(trendFor({ rounds: [ROUND2] }, 'driver', 'cal', 1).state, 'na'); // first round of the season
  assert.equal(trendFor(null, 'driver', 'cal', 1).state, 'na');
  assert.equal(trendFor(PROG, 'driver', 'cal', 2).state, 'na'); // computed position disagrees with the official table
});

test('rendered symbols: ↑ / ↓ / — (unchanged, labelled) / n/a (unavailable) are all distinct', () => {
  const up = trendCell({ state: 'up', delta: 2 });
  const down = trendCell({ state: 'down', delta: -1 });
  const same = trendCell({ state: 'same', delta: 0 });
  const na = trendCell({ state: 'na', reason: 'No previous completed round this season' });
  assert.match(up, /↑ 2/);
  assert.match(down, /↓ 1/);
  assert.match(same, /—/);
  assert.match(same, /aria-label="No position change since previous round"/);
  assert.match(na, />n\/a</);
  assert.doesNotMatch(na, /—/);
  assert.notEqual(same, na);
});
