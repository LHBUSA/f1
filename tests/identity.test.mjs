// Registry integrity: car photos (rights + provenance), personnel graph, machine facts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { loadPeople, teamPeople, teamMachine } from '../src/identity/people.mjs';
import { loadCarPhotos, imageObject } from '../src/identity/car-photos.mjs';

const photos = loadCarPhotos();
const people = loadPeople();

test('approved car photos carry full provenance, rights and existing files', () => {
  for (const p of photos.photos.filter((x) => x.approvedForPublicUse)) {
    for (const k of ['sourceUrl', 'imageUrl', 'photographer', 'license', 'licenseUrl', 'originalSha1', 'attribution', 'localAssetPath']) assert.ok(p[k], `${p.id} missing ${k}`);
    assert.match(p.licenseUrl, /^https:\/\/creativecommons\.org\/(licenses|publicdomain)\//, `${p.id} licence url`);
    assert.doesNotMatch(p.license, /NC|ND/, `${p.id} non-commercial/no-derivatives licence`);
    assert.match(p.attribution, new RegExp(p.photographer), `${p.id} attribution names photographer`);
    assert.match(p.attribution, /background removed/, `${p.id} attribution states the modification`);
    assert.equal(crypto.createHash('sha1').update(fs.readFileSync(p.localAssetPath)).digest('hex'), p.originalSha1, `${p.id} original hash`);
    for (const f of Object.values(p.derivatives.files || {})) for (const file of Object.values(f)) assert.ok(fs.existsSync(file), `${p.id} ${file}`);
    const io = imageObject(p, { site: 'https://x', publicPath: '/m.webp' });
    assert.equal(io.creator.name, p.photographer);
    assert.doesNotMatch(JSON.stringify(io), /PropBetEdge\s*©|©\s*PropBetEdge|"creator":\{[^}]*PropBetEdge/i, `${p.id} no PropBetEdge ownership claim`);
  }
});

test('one approved photo per constructor and season', () => {
  const seen = new Set();
  for (const p of photos.photos.filter((x) => x.approvedForPublicUse)) {
    const k = `${p.constructorId}|${p.season}`;
    assert.ok(!seen.has(k), `duplicate approved photo ${k}`);
    seen.add(k);
  }
});

test('displayed personnel roles are sourced, current, unique and point at real people', () => {
  const keys = new Set();
  for (const r of people.roles.filter((x) => x.display)) {
    assert.ok(people.people[r.personId], `unknown person ${r.personId}`);
    assert.ok(r.sources?.length, `${r.personId} ${r.role} has no source`);
    for (const s of r.sources) assert.ok(people.sources[s]?.url, `${r.personId} source ${s} unresolved`);
    assert.ok(['leadership', 'technical', 'race_engineering', 'garage_operations', 'power_unit'].includes(r.roleGroup), r.roleGroup);
    const k = `${r.personId}|${r.constructorId}|${r.season}|${r.role}|${r.driverId}`;
    assert.ok(!keys.has(k), `duplicate role ${k}`);
    keys.add(k);
  }
  const names = Object.values(people.people).map((p) => p.name.toLowerCase());
  assert.equal(new Set(names).size, names.length, 'duplicate person names');
});

test('race engineer links name a driver that exists, at most one engineer per driver per season', { skip: !fs.existsSync('data/normalized/drivers.json') && 'needs local data/' }, () => {
  const drivers = new Set(JSON.parse(fs.readFileSync('data/normalized/drivers.json', 'utf8')).map((d) => d.slug));
  const per = {};
  for (const r of people.roles.filter((x) => x.display && x.driverId)) {
    assert.ok(drivers.has(r.driverId), `unknown driver ${r.driverId}`);
    const k = `${r.driverId}|${r.season}|${r.role}`;
    assert.ok(!per[k], `two ${r.role}s for ${k}`);
    per[k] = r.personId;
  }
});

test('machine facts are sourced and regulation facts are labelled as such', () => {
  for (const [season, m] of Object.entries(people.machines)) for (const cid of Object.keys(m.teams)) {
    const t = teamMachine(people, cid, Number(season));
    for (const s of t.specs) assert.ok(['car_specific', 'regulation'].includes(s.scope), `${cid} ${s.label} scope`);
    assert.ok(!JSON.stringify(m.teams[cid]).match(/\b\d{3,4}\s*(hp|bhp|ps)\b/i), `${cid} horsepower claim`);
  }
  const p = teamPeople(people, 'mercedes', 2026);
  assert.ok(p.leadership.length && p.technical.length);
});
