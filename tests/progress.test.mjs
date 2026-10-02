// PBEcast progress model. Synthetic frames here are TEST INPUT ONLY (never published, never shown as data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, progressAt, frameAt, positionHistory, MAX_FRACTION } from '../src/core/progress.mjs';
import { deriveIncidents } from '../src/core/incidents.mjs';

const T0 = Date.parse('2026-01-01T12:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
// two cars, 90 s laps, polled every 10 s; B is 30 s behind
function frames({ until = 400, drop = null, retireB = null, flags = {} } = {}) {
  const out = [];
  for (let s = 0; s <= until; s += 10) {
    if (drop && s > drop[0] && s < drop[1]) continue;
    const lapsA = Math.floor(s / 90), lapsB = Math.floor(Math.max(0, s - 30) / 90);
    out.push({ t: at(s), lap: lapsA + 1, state: 'live', flag: flags[s] || 'GREEN', cars: [{ id: 'a', pos: 1, status: 'running', laps: lapsA }, { id: 'b', pos: 2, status: retireB && s >= retireB ? 'retired' : 'running', laps: lapsB }] });
  }
  return out;
}

test('a car is placed only after an observed crossing, and proportionally between crossings in replay', () => {
  const m = buildModel(frames());
  assert.equal(progressAt(m, 'a', T0 + 50e3).state, 'unplaced');
  const p = progressAt(m, 'a', T0 + 135e3); // between crossings at 90 s and 180 s
  assert.equal(p.state, 'derived');
  assert.ok(Math.abs(p.laps - 1.5) < 1e-9, String(p.laps));
});

test('live extrapolation never crosses the line before a crossing is observed', () => {
  const m = buildModel(frames({ until: 300 }));
  const p = progressAt(m, 'a', T0 + 340e3, { live: true }); // shortly after the last frame
  assert.equal(p.state, 'derived');
  assert.ok(p.laps <= 3 + MAX_FRACTION + 1e-9);
  assert.equal(progressAt(m, 'a', T0 + 1000e3, { live: true }).state, 'unplaced', 'long overdue = pit/garage, not still circulating');
});

test('a recording gap holds cars instead of moving them on a guess', () => {
  const m = buildModel(frames({ drop: [100, 260] }));
  assert.equal(m.gaps.length, 1);
  assert.equal(progressAt(m, 'a', T0 + 200e3).state, 'held');
});

test('retired cars leave the track and the retirement is an observed event, not a cause', () => {
  const f = frames({ retireB: 200 });
  const m = buildModel(f);
  assert.equal(progressAt(m, 'b', T0 + 250e3).state, 'out');
  const ev = deriveIncidents(f, { sessionId: 's' });
  const ret = ev.filter((e) => e.type === 'retirement');
  assert.equal(ret.length, 1);
  assert.deepEqual(ret[0].driver_ids, ['b']);
  assert.equal(ret[0].location, null);
  assert.ok(!/crash|collision|failure|damage/i.test(JSON.stringify(ret[0])));
});

test('safety-car state appears and clears from the session flag; unknown flags are not guessed', () => {
  const ev = deriveIncidents(frames({ flags: { 100: 'SAFETY_CAR', 110: 'SAFETY_CAR', 120: 'GREEN', 150: 'MYSTERY' } }), { sessionId: 's' });
  assert.deepEqual(ev.map((e) => `${e.type}:${e.status}`), ['safety_car:active', 'safety_car:cleared']);
});

test('deterministic: the same frames give the same positions and history', () => {
  const a = buildModel(frames()), b = buildModel(frames());
  for (const T of [95e3, 133e3, 270e3]) assert.deepEqual(progressAt(a, 'b', T0 + T), progressAt(b, 'b', T0 + T));
  assert.deepEqual(positionHistory(a), positionHistory(b));
  assert.equal(frameAt(a, T0 - 1), null);
});

test('practice/qualifying: a long stay between crossings is not crawled around the lap', () => {
  // car a laps at 90 s, then sits 600 s in the garage, then laps again
  const f = [];
  const lapsAt = (s) => (s < 270 ? Math.floor(s / 90) : s < 870 ? 3 : 3 + Math.floor((s - 870) / 90));
  for (let s = 0; s <= 1100; s += 10) f.push({ t: at(s), lap: null, state: 'live', flag: 'GREEN', cars: [{ id: 'a', pos: 1, status: 'running', laps: lapsAt(s) }] });
  const m = buildModel(f);
  assert.equal(progressAt(m, 'a', T0 + 500e3).state, 'unplaced');
  assert.equal(progressAt(m, 'a', T0 + 1000e3).state, 'derived');
});
