// Backfill ESPN F1 raw captures: seasons → events → session competitors (+stats, +status) → athletes, venues.
// Usage: node scripts/backfill-espn.mjs [fromYear] [toYear]   (iterates newest first)
// Current season is always refetched with a short max-age; history is captured once.
import { CORE, CORE_ROOT, get, collection, pool, stats, SourceBlocked } from './lib/espn.mjs';

const now = new Date();
const currentYear = now.getUTCFullYear();
const from = Number(process.argv[2] || 1950);
const to = Number(process.argv[3] || currentYear);
const LIVE_AGE = 10 * 60 * 1000;

const athleteIds = new Set();
const venueRefs = new Set();

async function doEvent(ref, year) {
  const recent = year >= currentYear;
  const ev = await get(ref, { maxAgeMs: recent ? LIVE_AGE : Infinity });
  if (!ev) return;
  const e = ev.data;
  for (const v of e.venues || []) venueRefs.add(v.$ref);
  for (const c of e.competitions || []) {
    const done = c.status?.type?.completed;
    // Upcoming sessions: competitors are entry lists at best; nothing more to fetch.
    const sessionDate = Date.parse(c.date || e.date);
    for (const comp of c.competitors || []) if (comp.id) athleteIds.add(comp.id);
    if (sessionDate > Date.now()) continue;
    const age = recent && Date.now() - sessionDate < 3 * 86400e3 ? LIVE_AGE : Infinity;
    const refs = (c.competitors || []).flatMap((comp) => [comp.statistics?.$ref, comp.status?.$ref].filter(Boolean));
    await pool(refs, 10, (r) => get(r, { maxAgeMs: age }));
    if (c.status?.$ref && !done) await get(c.status.$ref, { maxAgeMs: LIVE_AGE });
  }
}

async function main() {
  const years = [];
  for (let y = to; y >= from; y--) years.push(y);
  for (const y of years) {
    const t0 = Date.now();
    const refs = await collection(`${CORE}/events?dates=${y}`, { maxAgeMs: y >= currentYear ? LIVE_AGE : Infinity });
    await pool(refs, 4, (r) => doEvent(r.$ref, y));
    for (const g of [0, 1]) await get(`${CORE}/seasons/${y}/types/2/standings/${g}`, { maxAgeMs: y >= currentYear ? LIVE_AGE : Infinity });
    console.log(`${y}: ${refs.length} events in ${((Date.now() - t0) / 1000).toFixed(0)}s`, JSON.stringify(stats));
  }
  const ids = [...athleteIds];
  await pool(ids, 6, (id) => get(`${CORE_ROOT}/athletes/${id}`, { maxAgeMs: 14 * 86400e3 }));
  await pool([...venueRefs], 4, (r) => get(r, { maxAgeMs: 30 * 86400e3 }));
  console.log('done', JSON.stringify(stats), 'athletes', ids.length, 'venues', venueRefs.size);
}

main().catch((e) => {
  console.error(e instanceof SourceBlocked ? `SOURCE BLOCKED: ${e.message}` : e);
  process.exit(1);
});
