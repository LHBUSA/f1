import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as AA from '../src/core/all-access.mjs';
import { raceLabPage } from '../scripts/site/race-lab.mjs';
import { layout } from '../scripts/site/lib.mjs';

test('F1 All Access includes Race Lab and deep analysis', () => {
  const keys = AA.F1_ALL_ACCESS.map((x) => x.key);
  assert.ok(keys.includes('race_lab'));
  assert.ok(keys.includes('deep_analysis'));
  assert.ok(keys.includes('replay'));
  assert.ok(AA.F1_FREE.some((x) => /preview/i.test(x)));
});

test('Race Lab is a noindex static shell with no premium values baked into HTML', () => {
  const p = raceLabPage();
  const html = layout({ ...p, assets: { css:'/a.css', js:'/a.js', account:'/account.js', nav:'/nav.js', raceLab:'/race-lab.js' } });
  assert.equal(p.path, '/race-lab');
  assert.equal(p.noindex, true);
  assert.match(html, /data-race-lab/);
  assert.match(html, /race-lab\.js/);
  assert.doesNotMatch(html, /fit_score|median_gap_pct|dna_leaders|quali_h2h/);
});

test('f1-api requires All Access for Race Lab and raw proprietary routes', () => {
  const src = fs.readFileSync('workers/f1-api/src/index.js', 'utf8');
  assert.match(src, /if \(p === '\/race-lab'\)[\s\S]*?f1Access\(req, env\)[\s\S]*?all_access_required[\s\S]*?respondPrivate/);
  for (const feature of ['driver_dna','constructor_dna','circuit_dna','circuit_fit','matchup_lab']) assert.ok(src.includes(`feature:'${feature}'`) || src.includes(`feature: '${feature}'`), feature);
  assert.doesNotMatch(src, /return respond\(req, \{ \.\.\.d, dna \}\)/);
});

test('primary nav makes Race Lab the premium F1 destination', () => {
  const lib = fs.readFileSync('scripts/site/lib.mjs','utf8');
  assert.match(lib, /\['\/race-lab', 'Race Lab ◆'\]/);
  assert.doesNotMatch(lib, /\['\/intelligence', 'Intelligence'\]/);
});

test('public detail templates do not render full DNA or full Circuit Fit boards', () => {
  const pages = fs.readFileSync('scripts/site/pages.mjs','utf8');
  assert.match(pages, /fitList\(ctx, fit, 3\)/);
  assert.doesNotMatch(pages, /fitList\(ctx, fit, 22\)/);
  assert.doesNotMatch(pages, /dnaPanel\(dnaC/);
  assert.match(pages, /Unlock the complete weekend analysis/);
});


test('Race Lab premium UI uses approved F1 identity media without inline handlers', () => {
  const page = fs.readFileSync('scripts/site/race-lab.mjs','utf8');
  const client = fs.readFileSync('src/web/race-lab.js','utf8');
  const build = fs.readFileSync('scripts/build-site.mjs','utf8');
  assert.match(page, /ctx\.logoFor/);
  assert.match(page, /ctx\.carPhotoFor/);
  assert.match(page, /\/media\/cars\//);
  assert.match(client, /\/pbe\/f1\/media\/headshot\//);
  assert.match(client, /class="rl-team-card"/);
  assert.match(client, /class="rl-battle"/);
  assert.match(client, /class="rl-hero-cars"/);
  assert.doesNotMatch(client, /\sonerror=/);
  assert.match(build, /emit\(raceLabPage\(ctx\)\)/);
});

test('all current constructors have approved 2026 cars available to the premium desk', async () => {
  const { loadCarPhotos, carPhotoFor } = await import('../src/identity/car-photos.mjs');
  const teams = Object.keys(JSON.parse(fs.readFileSync('src/identity/teams-2026.json','utf8')).teams);
  const reg = loadCarPhotos();
  assert.equal(teams.length, 11);
  for (const cid of teams) {
    const p = carPhotoFor(reg, cid, 2026);
    assert.ok(p, `${cid}: missing approved 2026 car`);
    assert.ok(p.derivatives?.files?.['640']?.webp, `${cid}: missing Race Lab car derivative`);
  }
});
