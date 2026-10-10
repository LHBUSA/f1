import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildLoop, relationWays } from '../scripts/circuit-geometry.mjs';

const DIR = path.resolve('geometry');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const signedArea = (p) => { let a = 0; for (let i = 1; i < p.length; i++) a += p[i - 1][0] * p[i][1] - p[i][0] * p[i - 1][1]; return a / 2; };

for (const f of files) {
  test(`geometry/${f}: ODbL provenance, closed loop, length within ±6%`, () => {
    const g = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    assert.equal(g.slug + '.json', f);
    assert.equal(g.source, 'openstreetmap');
    assert.equal(g.licence, 'ODbL 1.0');
    assert.equal(g.attribution, '© OpenStreetMap contributors');
    assert.ok(Array.isArray(g.osm_way_ids) && g.osm_way_ids.length > 0 && g.osm_way_ids.every(Number.isInteger));
    assert.ok(Math.abs(g.length_m - g.target_m) / g.target_m <= 0.06);
    assert.ok(g.path.length > 50);
    const [a, b] = [g.path[0], g.path.at(-1)];
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) <= 20, 'loop closes');
    assert.equal(g.timing_line.s, 0);
    assert.ok(g.timing_line.basis && g.direction_basis && g.corner_numbering);
  });
}

test('marina-bay-circuit: current (2023+) layout from OSM circuit relation 421263, anticlockwise, finish node timing line', () => {
  const g = JSON.parse(fs.readFileSync(path.join(DIR, 'marina-bay-circuit.json'), 'utf8'));
  assert.equal(g.osm_relation_id, 421263);
  assert.equal(g.target_m, 4927); // not the 2018-2022 5.063 km lap
  assert.ok(Math.abs(g.length_delta_pct) <= 1.5, `length ${g.length_m} vs ${g.target_m}`);
  assert.ok(signedArea(g.path) > 0, 'Marina Bay runs anticlockwise');
  assert.match(g.direction_basis, /^oneway tags on \d+\/\d+ segments$/);
  assert.match(g.timing_line.basis, /finish node 13826310653/);
  assert.equal(g.pit_way_id, 100484287);
  assert.ok(g.pit?.length >= 2);
  assert.ok(g.corners.every((c) => c.n === null), 'corners are not numbered unless the count matches the official turns');
});

// synthetic relation: a 400 m square of public roads drawn clockwise with a road oneway tag pointing clockwise, plus one
// raceway segment whose oneway runs anticlockwise. The road oneway (traffic direction) must be dropped, the raceway one
// kept, and the loop found even though the first edge is drawn against the race direction.
test('relationWays + buildLoop: road oneway dropped, raceway oneway sets race direction', () => {
  const d = 0.0009; // ~100 m
  const pts = { 1: [0, 0], 2: [d, 0], 3: [d, d], 4: [0, d] }; // lat, lon
  const node = (id) => `<node id="${id}" lat="${pts[id][0]}" lon="${pts[id][1]}"/>`;
  const way = (id, refs, tags) => `<way id="${id}">${refs.map((r) => `<nd ref="${r}"/>`).join('')}${Object.entries(tags).map(([k, v]) => `<tag k="${k}" v="${v}"/>`).join('')}</way>`;
  const xml = `<osm>${[1, 2, 3, 4].map(node).join('')}
    ${way(10, [3, 4, 1], { highway: 'primary', oneway: 'yes', name: 'Road A' })}
    ${way(11, [2, 3], { highway: 'primary', oneway: 'yes', name: 'Road B' })}
    ${way(12, [2, 1], { highway: 'raceway', oneway: 'yes', name: 'Circuit' })}
    <relation id="99"><member type="way" ref="10" role="forward"/><member type="way" ref="11" role="forward"/><member type="way" ref="12" role="backward"/><member type="node" ref="1" role="finish"/><tag k="type" v="circuit"/></relation></osm>`;
  const rel = relationWays(xml, 99);
  assert.equal(rel.ways.length, 3);
  assert.equal(rel.ways.find((w) => w.id === 10).tags.oneway, undefined);
  assert.equal(rel.ways.find((w) => w.id === 12).tags.oneway, 'yes');
  assert.equal(rel.finish.id, 1);
  const loop = buildLoop(rel.ways, 400, [d / 2, d / 2]);
  assert.ok(loop, 'loop found');
  assert.ok(Math.abs(loop.length_m - 400) < 2);
  assert.equal(loop.direction_basis, 'oneway tags on 1/3 segments');
  assert.ok(signedArea(loop.path) > 0, 'race direction follows the raceway oneway (anticlockwise)');
});
