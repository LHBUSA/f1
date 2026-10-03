// Historical constructors: exact constructor + exact season + approved photo only; sourced car models; the lineage
// strip never borrows a car from another constructor or season; current-only modules stay off historical pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { loadCarModels, carModelFor, teamCarPhotos, lineageCars } from '../src/identity/history.mjs';
import { carPhotoFor, loadCarPhotos } from '../src/identity/car-photos.mjs';

const reg = loadCarPhotos();
const models = loadCarModels();
const DIST = fs.existsSync('dist/teams/jaguar.html');

test('every historical photo: sourced model for its exact constructor+season, full provenance, SHA-1 matches', () => {
  const hist = reg.photos.filter((p) => p.historical);
  assert.ok(hist.length >= 6);
  for (const p of hist) {
    const m = models.models.find((x) => x.constructorId === p.constructorId && x.season === p.season);
    assert.ok(m, `${p.id}: no sourced model`);
    assert.equal(p.carModel, m.model);
    assert.ok(m.sources.length >= 2 && m.sources.every((s) => models.sources[s]?.url), `${p.id}: model sources`);
    for (const k of ['photographer', 'sourceUrl', 'imageUrl', 'license', 'licenseUrl', 'acquisitionDate', 'originalSha1', 'rightsStatus', 'event']) assert.ok(p[k], `${p.id}: ${k}`);
    assert.match(p.sourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.match(p.license, /^CC (BY|BY-SA|0)|Public domain/);
    if (/SA/.test(p.license)) assert.match(p.derivativeLicense, /ShareAlike/);
    assert.equal(crypto.createHash('sha1').update(fs.readFileSync(p.localAssetPath)).digest('hex'), p.originalSha1);
  }
});

test('Jaguar R1-R5 map to 2000-2004 exactly; no other season is substituted', () => {
  const want = { 2000: 'Jaguar R1', 2001: 'Jaguar R2', 2002: 'Jaguar R3', 2003: 'Jaguar R4', 2004: 'Jaguar R5' };
  assert.deepEqual(teamCarPhotos(reg, 'jaguar').map((p) => [p.season, p.carModel]), Object.entries(want).map(([y, m]) => [Number(y), m]));
  for (const y of Object.keys(want)) assert.equal(carModelFor(models, 'jaguar', Number(y)), want[y]);
  assert.equal(carPhotoFor(reg, 'jaguar', 2005), null, 'no Jaguar photo for a season it did not race');
  assert.equal(carPhotoFor(reg, 'stewart', 1999), null, 'Stewart has no approved photo: nothing is borrowed');
});

test('lineage strip: predecessors close, the page constructor first+last, successors open; never borrowed', () => {
  const chain = ['stewart', 'jaguar', 'red-bull'];
  assert.deepEqual(lineageCars(reg, chain, 'jaguar').map((p) => p.id), ['2000-jaguar-r1-vauxford', '2004-jaguar-r5-dikeman', '2005-red-bull-rb1-raich']);
  for (const p of lineageCars(reg, chain, 'stewart')) assert.notEqual(p.constructorId, 'stewart');
  const rb = lineageCars(reg, chain, 'red-bull');
  assert.equal(rb[0].id, '2004-jaguar-r5-dikeman');
  assert.ok(rb.every((p) => chain.includes(p.constructorId)));
});

test('built Jaguar page: final-machine hero (R5, 2004), five cars, lineage links, no current-only modules', { skip: !DIST && 'needs a build' }, () => {
  const h = fs.readFileSync('dist/teams/jaguar.html', 'utf8');
  assert.match(h, /Final machine · 2004<\/span><b>Jaguar R5<\/b>/);
  assert.doesNotMatch(h, /Current machine|2026 car/i);
  assert.equal((h.match(/class="carcard"/g) || []).length, 5);
  assert.match(h, /href="\/teams\/stewart"/);
  assert.match(h, /href="\/teams\/red-bull"/);
  assert.match(h, /class="cur" aria-current="page"><span class="lin-yrs">2000–2004<\/span><b>Jaguar<\/b>/);
  assert.doesNotMatch(h, /car-stage|Car Explorer|The powertrain|People behind the machine/i);
  assert.match(h, /Rick Dikeman/);
  assert.match(h, /"@type":"ImageObject"/);
});

test('historical constructor without an approved photo stays honest (no hero car, no gallery)', { skip: !DIST && 'needs a build' }, () => {
  for (const t of ['minardi', 'stewart']) {
    const h = fs.readFileSync(`dist/teams/${t}.html`, 'utf8');
    assert.doesNotMatch(h, /hist-car|class="carcard"/, t);
  }
});
