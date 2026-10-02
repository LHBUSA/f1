// Powertrain intelligence: every value is labelled by source class, customer engines map to their maker, a published
// output never crosses manufacturers, an MGU-K hp figure is never "total output", missing values stay missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPeople, teamMachine } from '../src/identity/people.mjs';
import { loadExplorer } from '../src/identity/explorer.mjs';
import { powertrainFor } from '../src/identity/powertrain.mjs';

const reg = loadPeople(), X = loadExplorer();
const pt = (cid) => powertrainFor({ machine: teamMachine(reg, cid, 2026), tech: X.tech, teamName: cid });
const TEAMS = ['mercedes', 'ferrari', 'mclaren', 'red-bull', 'racing-bulls', 'aston-martin', 'williams', 'audi', 'cadillac', 'alpine', 'haas'];

test('every powertrain value carries a source class', () => {
  for (const cid of TEAMS) {
    const p = pt(cid);
    assert.ok(p, `${cid} powertrain`);
    for (const m of Object.values(p.metrics)) assert.ok(['team', 'team-rule', 'maker', 'fia'].includes(m.cls), `${cid} ${m.key} class ${m.cls}`);
  }
});

test('regulation-scope team lines are labelled as rule limits, never as team-specific measurements', () => {
  const m = pt('mercedes').metrics;
  for (const k of ['rpm', 'mguk', 'mgukrpm', 'es', 'injection', 'fuelflow']) assert.equal(m[k]?.cls, 'team-rule', `mercedes ${k}`);
  assert.equal(m.recharge.cls, 'fia');
});

test('customer power units map to their manufacturer', () => {
  for (const [cid, maker] of [['mclaren', 'mercedes'], ['williams', 'mercedes'], ['alpine', 'mercedes'], ['haas', 'ferrari'], ['cadillac', 'ferrari'], ['racing-bulls', 'red-bull-ford']]) {
    const p = pt(cid);
    assert.equal(p.makerKey, maker, `${cid} maker`);
    assert.equal(p.relationship, 'customer', `${cid} relationship`);
  }
  for (const [cid, maker] of [['mercedes', 'mercedes'], ['ferrari', 'ferrari'], ['red-bull', 'red-bull-ford'], ['aston-martin', 'honda'], ['audi', 'audi']]) assert.equal(pt(cid).makerKey, maker);
});

test('published output never crosses manufacturers; MGU-K hp is not total output; unpublished stays unpublished', () => {
  for (const cid of TEAMS) {
    const p = pt(cid);
    if (p.makerKey !== 'red-bull-ford') assert.equal(p.output, null, `${cid} must show "Not officially published"`);
  }
  assert.match(pt('red-bull').output.value, /1,000 bhp/);
  assert.equal(pt('racing-bulls').output.cls, 'maker'); // same DM01 engine, attributed to its publisher
  assert.equal(pt('audi').output, null);
});

test('missing values stay missing (no estimates)', () => {
  const f = pt('ferrari').metrics;
  assert.equal(f.rpm, undefined);
  assert.equal(f.mgukrpm, undefined);
  for (const cid of TEAMS) for (const m of Object.values(pt(cid).metrics)) assert.doesNotMatch(m.value, /torque|Nm|boost|efficiency/i);
});

test('team-spec fuel/lubricant fallback: real word boundaries, fuel cell/system/energy never count as a fuel partner', () => {
  const run = (specs) => powertrainFor({ machine: { powerUnit: { makerKey: 'none', manufacturer: 'Test', relationship: 'works' }, specs: specs.map(([label, value]) => ({ component: 'power-unit', label, value })) }, tech: { powerUnits: {} }, teamName: 'Test' });
  assert.equal(run([['Fuel', 'Shell V-Power']]).fuel, 'Shell V-Power');
  assert.equal(run([['Engine oil', 'Shell Helix Ultra']]).lube, 'Shell Helix Ultra');
  assert.equal(run([['Lubricants', 'Mobil 1']]).lube, 'Mobil 1');
  for (const label of ['Fuel cell', 'Fuel system', 'Fuel energy']) assert.equal(run([[label, 'FIA-specified']]).fuel, null, `${label} must not become the fuel partner`);
  assert.equal(run([['Rear spoiler', 'Carbon']]).lube, null); // "oil" inside a word is not oil
  assert.equal(run([['Biofuel blend', 'Advanced sustainable']]).fuel, null); // nor is "fuel" inside a word
});
