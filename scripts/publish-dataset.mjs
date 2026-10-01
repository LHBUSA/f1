// Publish dataset objects to R2 (f1-data) for the f1-api Worker and the Vercel build:
//   fragments/history-v1.json.gz  seasons < current + drivers + venues + wikidata (immutable)
//   fragments/season-<cur>.json   current season fragment (the Worker cron keeps it fresh afterwards)
//   raw/season-<cur>.json         seed of the Worker's raw doc store (every ESPN doc the extract touches)
//   meta/circuits.json            slug → lat/lon for the weather endpoint
// Run after `node scripts/normalize.mjs && node scripts/enrich-wikidata.mjs && node scripts/derive.mjs`.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { get } from './lib/espn.mjs';
import { extractSeason, extractDrivers, extractVenues } from '../src/core/extract.mjs';

const FRAG = path.resolve('data/fragments');
const TMP = path.resolve('.cache/publish');
fs.mkdirSync(TMP, { recursive: true });
const cur = new Date().getUTCFullYear();
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const dry = process.argv.includes('--dry');

function put(key, file, { encoding, type = 'application/json' } = {}) {
  const args = ['wrangler', 'r2', 'object', 'put', `f1-data/${key}`, '--file', file, '--content-type', type, '--remote'];
  if (encoding) args.push('--content-encoding', encoding);
  if (dry) return console.log('DRY put', key, fs.statSync(file).size);
  execFileSync('npx', args, { stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
  console.log('put', key, fs.statSync(file).size);
}

// 1) History bundle
const seasons = fs.readdirSync(FRAG).filter((f) => /^season-\d+\.json$/.test(f)).map((f) => readJson(path.join(FRAG, f))).filter((f) => f.season < cur).sort((a, b) => a.season - b.season);
const bundle = { version: 'history-v1', built_at: new Date().toISOString(), seasons, drivers: readJson(path.join(FRAG, 'drivers.json')), venues: readJson(path.join(FRAG, 'venues.json')), wikidata: readJson(path.join(FRAG, 'wikidata.json')) };
const histFile = path.join(TMP, 'history-v1.json.gz');
fs.writeFileSync(histFile, zlib.gzipSync(JSON.stringify(bundle), { level: 9 }));
put('fragments/history-v1.json.gz', histFile, { type: 'application/gzip' });

// 2) Current season fragment + raw doc store seed (record every doc the extract reads)
const store = {};
const recGet = async (u, o) => {
  const r = await get(u, o);
  if (r) store[r.url] = { url: r.url, capturedAt: r.capturedAt, data: r.data };
  return r;
};
const ingestedAt = new Date().toISOString();
const frag = await extractSeason(cur, recGet, { ingestedAt });
const drivers = await extractDrivers(frag.athlete_ids, recGet, { ingestedAt, maxAgeMs: 7 * 86400e3 });
const venues = await extractVenues(frag.venue_refs, recGet, { ingestedAt, maxAgeMs: 30 * 86400e3 });
for (const [name, obj] of [[`season-${cur}.json`, frag], ['drivers-current.json', drivers], ['venues-current.json', venues]]) {
  const f = path.join(TMP, name);
  fs.writeFileSync(f, JSON.stringify(obj));
  put(`fragments/${name}`, f);
}
const storeFile = path.join(TMP, `raw-season-${cur}.json`);
fs.writeFileSync(storeFile, JSON.stringify(store));
put(`raw/season-${cur}.json`, storeFile);
console.log(`doc store seed: ${Object.keys(store).length} docs`);

// 3) Circuit index for weather
const circuits = readJson('data/derived/circuits.json');
const idx = Object.fromEntries(circuits.filter((c) => c.lat != null).map((c) => [c.slug, { lat: c.lat, lon: c.lon, name: c.wikidata_name || c.name }]));
const idxFile = path.join(TMP, 'circuits.json');
fs.writeFileSync(idxFile, JSON.stringify(idx));
put('meta/circuits.json', idxFile);
console.log(`published: ${seasons.length} history seasons (${(fs.statSync(histFile).size / 1e6).toFixed(1)} MB gz), current ${cur}: ${frag.events.length} events, ${Object.keys(idx).length} circuits with coordinates`);
