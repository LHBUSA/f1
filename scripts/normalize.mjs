// Raw ESPN cache → canonical normalized tables in data/normalized/ (+ coverage report).
// Source truth only. Derived intelligence lives in scripts/derive.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR, cached, get, CORE, pool } from './lib/espn.mjs';
import { normalizeEvent, normalizeDriver, normalizeVenue, slugify } from '../src/core/normalize.mjs';
import { resolveConstructor, CONSTRUCTORS, unresolved } from '../src/core/constructors.mjs';

const OUT = path.resolve('data/normalized');
fs.mkdirSync(OUT, { recursive: true });
const ingestedAt = new Date().toISOString();
const eventsDir = path.join(CACHE_DIR, 'sports.core.api.espn.com/v2/sports/racing/leagues/f1/events');

const files = fs.readdirSync(eventsDir).filter((f) => /^\d+\.json$/.test(f));
const events = [];
const sessions = [];
const results = [];
const entries = [];
const venueRefs = new Set();
for (const f of files) {
  const ev = JSON.parse(fs.readFileSync(path.join(eventsDir, f), 'utf8'));
  const n = normalizeEvent(ev, cached, resolveConstructor, ingestedAt);
  events.push(n.event);
  sessions.push(...n.sessions);
  results.push(...n.results);
  entries.push(...n.entries);
  if (n.venueRef) venueRefs.add(n.venueRef);
}

// ESPN publishes race-row championship points as the WEEKEND total (sprint included); label it.
const sprintEvents = new Set(sessions.filter((s) => s.type === 'sprint').map((s) => s.event_id));
for (const r of results) if (r.session_type === 'race') r.points_scope = sprintEvents.has(r.event_id) ? 'weekend_incl_sprint' : 'race';

// Rounds: chronological per season, canceled events get no round.
const bySeason = new Map();
for (const e of events) {
  if (!bySeason.has(e.season)) bySeason.set(e.season, []);
  bySeason.get(e.season).push(e);
}
const usedSlugs = new Set();
for (const [, list] of bySeason) {
  list.sort((a, b) => a.start_utc.localeCompare(b.start_utc));
  let r = 0;
  for (const e of list) {
    if (e.status !== 'canceled') e.round = ++r;
    let slug = `${e.season}-${slugify(e.name)}`;
    if (usedSlugs.has(slug)) slug = `${slug}-${e.round || 'x'}`;
    usedSlugs.add(slug);
    e.slug = slug;
  }
}
events.sort((a, b) => a.start_utc.localeCompare(b.start_utc));

// Drivers: every athlete referenced by a classification or entry.
const athleteDir = path.join(CACHE_DIR, 'sports.core.api.espn.com/v2/sports/racing/athletes');
const driverIds = new Set([...results, ...entries].map((r) => r.driver_id));
const drivers = [];
const missingAthletes = [];
for (const id of driverIds) {
  const file = path.join(athleteDir, id.replace('espn-', '') + '.json');
  if (!fs.existsSync(file)) {
    missingAthletes.push(id);
    continue;
  }
  drivers.push(normalizeDriver(JSON.parse(fs.readFileSync(file, 'utf8')), ingestedAt));
}
// Slug uniqueness: never merge people by name — disambiguate by birth year, then id.
const slugCount = {};
for (const d of drivers) slugCount[d.slug] = (slugCount[d.slug] || 0) + 1;
const seen = new Set();
for (const d of drivers.sort((a, b) => (a.date_of_birth || '').localeCompare(b.date_of_birth || ''))) {
  if (slugCount[d.slug] > 1) d.slug = `${d.slug}-${(d.date_of_birth || '').slice(0, 4) || d.espn_id}`;
  if (seen.has(d.slug)) d.slug = `${d.slug}-${d.espn_id}`;
  seen.add(d.slug);
}
// Possible duplicate identities (same name + DOB under two ESPN ids) go to review, never auto-merged.
const identityReview = [];
const byKey = {};
for (const d of drivers) {
  const k = `${slugify(d.full_name)}|${d.date_of_birth}`;
  (byKey[k] ||= []).push(d.id);
}
for (const [k, ids] of Object.entries(byKey)) if (ids.length > 1) identityReview.push({ key: k, ids });

// Circuits.
const circuits = [];
for (const ref of venueRefs) {
  const doc = cached(ref);
  if (doc) circuits.push(normalizeVenue(doc, ingestedAt));
}

// Driver × constructor × season (from race + sprint classifications and entries).
const dcs = new Map();
for (const r of [...results, ...entries]) {
  if (!r.constructor_id) continue;
  const k = `${r.season}|${r.driver_id}|${r.constructor_id}`;
  if (!dcs.has(k)) dcs.set(k, { season: r.season, driver_id: r.driver_id, constructor_id: r.constructor_id, car_numbers: new Set(), race_starts: 0, entries: 0, first_event_id: r.event_id, source: 'espn', derived_from: 'session_classification' });
  const x = dcs.get(k);
  x.entries++;
  if (r.car_number) x.car_numbers.add(r.car_number);
  if (r.session_type === 'race' && r.status && !['did_not_start', 'did_not_qualify', 'did_not_prequalify', 'withdrawn'].includes(r.status)) x.race_starts++;
}
const driverConstructorSeasons = [...dcs.values()].map((x) => ({ ...x, car_numbers: [...x.car_numbers] }));

// Official season standings (ESPN). Constructor rows reference ESPN manufacturer docs.
const standings = [];
const seasons = [...bySeason.keys()].sort();
for (const y of seasons) {
  for (const g of [0, 1]) {
    const doc = cached(`${CORE}/seasons/${y}/types/2/standings/${g}`);
    if (!doc) continue;
    for (const s of doc.data.standings || []) {
      const rec = s.records?.[0];
      const stat = Object.fromEntries((rec?.stats || []).map((x) => [x.name, x.value]));
      let subject = null;
      let name = null;
      if (g === 0) {
        const aid = s.athlete?.$ref?.match(/athletes\/(\d+)/)?.[1];
        subject = aid ? `espn-${aid}` : null;
      } else if (s.manufacturer?.$ref) {
        const m = await get(s.manufacturer.$ref).catch(() => null);
        name = m?.data?.displayName || m?.data?.name || null;
        subject = name ? resolveConstructor(name, y) : null;
      }
      standings.push({
        season: y,
        kind: g === 0 ? 'driver' : 'constructor',
        subject_id: subject,
        name_raw: name,
        position: stat.rank ?? null,
        points: stat.championshipPts ?? stat.points ?? null,
        wins: stat.wins ?? null,
        poles: stat.poles ?? null,
        starts: stat.starts ?? null,
        source: 'espn',
        source_id: `${y}/${g}/${s.athlete?.$ref?.match(/athletes\/(\d+)/)?.[1] || s.manufacturer?.$ref?.match(/manufacturers\/(\d+)/)?.[1]}`,
        source_url: doc.url,
        source_updated_at: null,
        ingested_at: ingestedAt,
        captured_at: doc.capturedAt,
      });
    }
  }
}

const seasonRows = seasons.map((y) => {
  const evs = bySeason.get(y);
  return {
    year: y,
    rounds: evs.filter((e) => e.round).length,
    canceled: evs.filter((e) => e.status === 'canceled').length,
    completed: evs.filter((e) => e.status === 'completed').length,
    regulations_era: eraOf(y),
    source: 'espn',
    source_id: String(y),
    source_url: `${CORE}/seasons/${y}`,
    source_updated_at: null,
    ingested_at: ingestedAt,
  };
});

function eraOf(y) {
  if (y >= 2026) return '2026 hybrid (active aero, 50/50 power)';
  if (y >= 2022) return 'Ground-effect (2022–2025)';
  if (y >= 2017) return 'Wide-car hybrid (2017–2021)';
  if (y >= 2014) return 'V6 turbo-hybrid (2014–2016)';
  if (y >= 2009) return 'KERS / slick tyres (2009–2013)';
  if (y >= 2006) return 'V8 (2006–2008)';
  if (y >= 1995) return '3.0L V10 era (1995–2005)';
  if (y >= 1989) return '3.5L normally aspirated (1989–1994)';
  if (y >= 1977) return 'Ground effect & turbo (1977–1988)';
  if (y >= 1966) return '3.0L formula (1966–1976)';
  if (y >= 1961) return '1.5L formula (1961–1965)';
  return 'Early championship (1950–1960)';
}

const constructors = Object.values(CONSTRUCTORS);
const write = (name, rows) => fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(rows));
write('seasons', seasonRows);
write('events', events);
write('sessions', sessions);
write('classifications', results);
write('entries', entries);
write('drivers', drivers);
write('constructors', constructors);
write('driver_constructor_seasons', driverConstructorSeasons);
write('circuits', circuits);
write('standings', standings);

const coverage = {
  generated_at: ingestedAt,
  seasons: seasonRows.length,
  earliest_season: seasons[0],
  latest_season: seasons.at(-1),
  events: events.length,
  events_completed: events.filter((e) => e.status === 'completed').length,
  sessions: sessions.length,
  sessions_by_type: count(sessions, (s) => s.type),
  classifications: results.length,
  classifications_by_type: count(results, (r) => r.session_type),
  entries_upcoming: entries.length,
  drivers: drivers.length,
  constructors: constructors.length,
  circuits: circuits.length,
  standings_rows: standings.length,
  first_season_with_sessions: Math.min(...sessions.filter((s) => s.type !== 'race').map((s) => s.season)),
  first_season_with_pit_counts: Math.min(...results.filter((r) => r.pit_stops != null && r.pit_stops > 0).map((r) => r.season)),
  first_season_with_q123: Math.min(...results.filter((r) => r.q1_ms).map((r) => r.season)),
  missing_athletes: missingAthletes.length,
  unresolved_constructor_names: unresolved(),
  identity_review: identityReview,
  unsupported_tables: {
    lap: 'no licensed lap-by-lap source (ESPN exposes no per-lap timing)',
    stint: 'no source', tyre_stint: 'no source', pit_stop: 'only per-driver pit COUNT (ESPN pitsTaken); no per-stop timing',
    telemetry_reference: 'no source', penalty: 'only disqualification status', incident: 'no source',
    weather: 'forecast only (MET Norway) for upcoming events; no historical observations',
  },
};
write('coverage', coverage);
console.log(JSON.stringify(coverage, null, 1));

function count(arr, fn) {
  const o = {};
  for (const x of arr) o[fn(x)] = (o[fn(x)] || 0) + 1;
  return o;
}
