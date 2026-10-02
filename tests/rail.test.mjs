// Homepage car rail: every current constructor must have an approved current-season car (explicit failure, never a
// silent omission), and the rail follows the constructors' championship with a deterministic fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCarPhotos, carPhotoFor } from '../src/identity/car-photos.mjs';
import { railOrder } from '../scripts/site/pages.mjs';

const teams = Object.keys(JSON.parse(fs.readFileSync('src/identity/teams-2026.json', 'utf8')).teams);
const reg = loadCarPhotos();

test('all 11 current constructors have an approved 2026 car photo with rail-sized derivatives', () => {
  assert.equal(teams.length, 11);
  for (const cid of teams) {
    const p = carPhotoFor(reg, cid, 2026);
    assert.ok(p, `${cid}: no approved 2026 car photo (rail would omit this constructor)`);
    for (const w of ['640', '960', '1280']) for (const ext of ['webp', 'avif']) assert.ok(fs.existsSync(p.derivatives.files[w][ext]), `${cid} ${w}.${ext} missing`);
    assert.ok(p.derivatives.aspect?.[0] > p.derivatives.aspect?.[1], `${cid} aspect`);
  }
});

test('rail order = constructors championship, unknowns appended, deterministic fallback', () => {
  const ctx = { standingsBy: { '2026|constructor': [{ subject_id: 'b', position: 2 }, { subject_id: 'c', position: 1 }, { subject_id: 'zz', position: 3 }] } };
  assert.deepEqual(railOrder(ctx, 2026, ['a', 'b', 'c']), ['c', 'b', 'a']);
  assert.deepEqual(railOrder({ standingsBy: {} }, 2026, ['a', 'b', 'c']), ['a', 'b', 'c']);
});
