// Node pipeline: raw ESPN (disk cache) → season fragments (data/fragments) → canonical tables (data/normalized).
// Usage:
//   node scripts/normalize.mjs                  extract all seasons (cache-backed) + assemble
//   node scripts/normalize.mjs --assemble-only  assemble from existing data/fragments (Vercel build path)
//   node scripts/normalize.mjs --seasons 2026   re-extract only these seasons, then assemble
import fs from 'node:fs';
import path from 'node:path';
import { get } from './lib/espn.mjs';
import { extractSeason, extractDrivers, extractVenues } from '../src/core/extract.mjs';
import { assemble } from '../src/core/assemble.mjs';

const FRAG = path.resolve('data/fragments');
const OUT = path.resolve('data/normalized');
fs.mkdirSync(FRAG, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const ingestedAt = new Date().toISOString();
const args = process.argv.slice(2);
const assembleOnly = args.includes('--assemble-only');
const only = args.includes('--seasons') ? args[args.indexOf('--seasons') + 1].split(',').map(Number) : null;
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

if (!assembleOnly) {
  const years = only || Array.from({ length: new Date().getUTCFullYear() - 1949 }, (_, i) => 1950 + i);
  for (const y of years) {
    const frag = await extractSeason(y, get, { ingestedAt });
    if (!frag.events.length) continue;
    fs.writeFileSync(path.join(FRAG, `season-${y}.json`), JSON.stringify(frag));
    process.stdout.write(`${y}:${frag.events.length} `);
  }
  console.log();
  const athleteIds = new Set();
  const venueRefs = new Set();
  for (const f of fs.readdirSync(FRAG).filter((f) => f.startsWith('season-'))) {
    const frag = readJson(path.join(FRAG, f));
    frag.athlete_ids.forEach((a) => athleteIds.add(a));
    for (const r of frag.results) athleteIds.add(r.driver_id.replace('espn-', ''));
    frag.venue_refs.forEach((v) => venueRefs.add(v));
  }
  fs.writeFileSync(path.join(FRAG, 'drivers.json'), JSON.stringify(await extractDrivers(athleteIds, get, { ingestedAt, maxAgeMs: 14 * 86400e3 })));
  fs.writeFileSync(path.join(FRAG, 'venues.json'), JSON.stringify(await extractVenues(venueRefs, get, { ingestedAt, maxAgeMs: 30 * 86400e3 })));
}

const fragments = fs.readdirSync(FRAG).filter((f) => f.startsWith('season-')).map((f) => readJson(path.join(FRAG, f)));
const tables = assemble({ fragments, drivers: readJson(path.join(FRAG, 'drivers.json')), venues: readJson(path.join(FRAG, 'venues.json')), ingestedAt });
for (const [name, rows] of Object.entries(tables)) fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(rows));
// The Wikidata crosswalk travels with the fragments (static between enrich runs).
if (fs.existsSync(path.join(FRAG, 'wikidata.json'))) fs.copyFileSync(path.join(FRAG, 'wikidata.json'), path.join(OUT, 'wikidata.json'));
const c = tables.coverage;
console.log(JSON.stringify({ seasons: c.seasons, earliest: c.earliest_season, events: c.events, sessions: c.sessions, classifications: c.classifications, drivers: c.drivers, constructors: c.constructors, venues: c.venues, missing_drivers: c.missing_drivers, unresolved: c.unresolved_constructor_names.length, identity_review: c.identity_review.length }));
