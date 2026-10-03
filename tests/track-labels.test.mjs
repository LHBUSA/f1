// PBEcast label layout: labels never overlap each other, a car, a blocked overlay or the canvas edge; dense packs fan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutLabels, clusters, FAN_MIN } from '../src/core/track-labels.mjs';

const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const rc = (r, c) => Math.hypot(Math.max(r.x, Math.min(c.x, r.x + r.w)) - c.x, Math.max(r.y, Math.min(c.y, r.y + r.h)) - c.y) < c.r;
function check(cars, opts) {
  const L = layoutLabels(cars, opts), labs = [...L.values()];
  assert.equal(L.size, cars.length, 'every car has a label');
  for (const l of labs) {
    assert.ok(!l.forced, 'no forced placement');
    assert.ok(l.x >= opts.bounds.x0 && l.y >= opts.bounds.y0 && l.x + l.w <= opts.bounds.x1 && l.y + l.h <= opts.bounds.y1, 'inside canvas');
    for (const c of cars) assert.ok(!rc(l, c), 'label does not cover a car');
    for (const b of opts.blocks || []) assert.ok(!hit(l, b), 'label avoids overlays');
  }
  for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) assert.ok(!hit(labs[i], labs[j]), 'labels do not overlap');
  return L;
}
const car = (id, x, y, prio = 0) => ({ id, x, y, r: 6, w: 26, h: 14, prio });

test('22 cars on one spot near the timing line (390px canvas): all labelled, no overlaps', () => {
  const cars = Array.from({ length: 22 }, (_, i) => car(`d${i}`, 120 + i * 1.5, 200 - i * 0.8, i));
  const L = check(cars, { bounds: { x0: 3, y0: 3, x1: 355, y1: 265 }, blocks: [{ x: 8, y: 8, w: 300, h: 22 }], center: { x: 178, y: 140 } });
  assert.ok([...L.values()].filter((l) => l.leader).length > 10, 'displaced labels draw leader lines');
  assert.ok([...L.values()].every((l) => l.fan), 'a 22-car pack is fanned');
});

test('10-car mid-lap pack + spread field; selected car first in priority', () => {
  const cars = [...Array.from({ length: 10 }, (_, i) => car(`p${i}`, 400 + i * 4, 300 + i * 2, i + 1)), ...Array.from({ length: 10 }, (_, i) => car(`s${i}`, 100 + i * 70, 120, 20 + i))];
  cars[4] = { ...cars[4], prio: -2, r: 17, w: 80, h: 20 };
  check(cars, { bounds: { x0: 3, y0: 3, x1: 1000, y1: 620 }, center: { x: 500, y: 310 } });
});

test('stability: a still-valid previous offset is kept', () => {
  const cars = [car('a', 100, 100), car('b', 300, 100)];
  const L = layoutLabels([{ ...cars[0], prev: { dx: 0, dy: -30 } }, cars[1]], { bounds: { x0: 0, y0: 0, x1: 400, y1: 300 } });
  assert.equal(Math.round(L.get('a').cy), 70);
});

test('clusters chain within distance; FAN_MIN is 6', () => {
  assert.equal(FAN_MIN, 6);
  const g = clusters([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 100, y: 0 }], 12);
  assert.deepEqual(g.map((x) => x.length).sort(), [1, 3]);
});
