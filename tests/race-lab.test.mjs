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
