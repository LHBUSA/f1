// Phase B — assemble: season fragments + drivers + venues → canonical normalized tables.
// Pure and deterministic: constructor identity is re-resolved from (raw name, season), rounds and slugs are
// recomputed, so the same fragments always produce the same tables.
import { slugify, STARTED_STATUSES } from './normalize.mjs';
import { resolveConstructor, CONSTRUCTORS, unresolved, seasonRelabels } from './constructors.mjs';

export function eraOf(y) {
  if (y >= 2026) return '2026 regulations (active aero, 50/50 hybrid)';
  if (y >= 2022) return 'Ground-effect era (2022–2025)';
  if (y >= 2017) return 'Wide-car hybrid era (2017–2021)';
  if (y >= 2014) return 'V6 turbo-hybrid (2014–2016)';
  if (y >= 2009) return 'KERS / slick-tyre era (2009–2013)';
  if (y >= 2006) return 'V8 era (2006–2008)';
  if (y >= 1995) return '3.0L V10 era (1995–2005)';
  if (y >= 1989) return '3.5L normally aspirated (1989–1994)';
  if (y >= 1977) return 'Ground-effect & turbo era (1977–1988)';
  if (y >= 1966) return '3.0L formula (1966–1976)';
  if (y >= 1961) return '1.5L formula (1961–1965)';
  return 'Early championship (1950–1960)';
}

export function assemble({ fragments, drivers, venues, ingestedAt }) {
  const events = [];
  const sessions = [];
  const results = [];
  const entries = [];
  const standings = [];
  for (const f of fragments.sort((a, b) => a.season - b.season)) {
    events.push(...f.events);
    sessions.push(...f.sessions);
    results.push(...f.results);
    entries.push(...f.entries);
    standings.push(...f.standings);
  }
  // Constructor identity (season-aware, lineage-aware).
  for (const r of [...results, ...entries]) r.constructor_id = r.constructor_name_raw ? resolveConstructor(r.constructor_name_raw, r.season, r.team_color) : null;
  for (const s of standings) if (s.kind === 'constructor') s.subject_id = s.name_raw ? resolveConstructor(s.name_raw, s.season) : null;

  // ESPN race-row points are WEEKEND totals at sprint events (sprint included): label them.
  const sprintEvents = new Set(sessions.filter((s) => s.type === 'sprint').map((s) => s.event_id));
  for (const r of results) if (r.session_type === 'race') r.points_scope = sprintEvents.has(r.event_id) ? 'weekend_incl_sprint' : 'race';

  // Rounds + slugs.
  const bySeason = {};
  for (const e of events) (bySeason[e.season] ||= []).push(e);
  const used = new Set();
  for (const y of Object.keys(bySeason).sort()) {
    const list = bySeason[y].sort((a, b) => a.start_utc.localeCompare(b.start_utc));
    let r = 0;
    for (const e of list) {
      e.round = e.status !== 'canceled' ? ++r : null;
      let slug = `${e.season}-${slugify(e.name)}`;
      if (used.has(slug)) slug = `${slug}-${e.round || 'x'}`;
      used.add(slug);
      e.slug = slug;
    }
  }
  events.sort((a, b) => a.start_utc.localeCompare(b.start_utc));

  // Drivers: only those referenced; unique slugs; never merged by name.
  const referenced = new Set([...results, ...entries].map((r) => r.driver_id));
  const ds = drivers.filter((d) => referenced.has(d.id)).map((d) => ({ ...d }));
  const slugCount = {};
  for (const d of ds) slugCount[d.slug] = (slugCount[d.slug] || 0) + 1;
  const seen = new Set();
  for (const d of ds.sort((a, b) => (a.date_of_birth || '').localeCompare(b.date_of_birth || '') || a.id.localeCompare(b.id))) {
    if (slugCount[d.slug] > 1) d.slug = `${d.slug}-${(d.date_of_birth || '').slice(0, 4) || d.espn_id}`;
    if (seen.has(d.slug)) d.slug = `${d.slug}-${d.espn_id}`;
    seen.add(d.slug);
  }
  const identityReview = [];
  const byKey = {};
  for (const d of ds) (byKey[`${slugify(d.full_name)}|${d.date_of_birth}`] ||= []).push(d.id);
  for (const [k, ids] of Object.entries(byKey)) if (ids.length > 1) identityReview.push({ key: k, ids });
  const missingDrivers = [...referenced].filter((id) => !ds.some((d) => d.id === id));

  // Driver × constructor × season.
  const dcs = new Map();
  for (const r of [...results, ...entries]) {
    if (!r.constructor_id || r.status === 'practice_only') continue;
    const k = `${r.season}|${r.driver_id}|${r.constructor_id}`;
    if (!dcs.has(k)) dcs.set(k, { season: r.season, driver_id: r.driver_id, constructor_id: r.constructor_id, car_numbers: new Set(), race_starts: 0, entries: 0, source: 'espn', derived_from: 'session_classification' });
    const x = dcs.get(k);
    x.entries++;
    if (r.car_number) x.car_numbers.add(r.car_number);
    if (r.session_type === 'race' && STARTED_STATUSES.has(r.status)) x.race_starts++;
  }
  const driverConstructorSeasons = [...dcs.values()].map((x) => ({ ...x, car_numbers: [...x.car_numbers] }));

  const seasons = Object.keys(bySeason).map(Number).sort((a, b) => a - b).map((y) => ({
    year: y,
    rounds: bySeason[y].filter((e) => e.round).length,
    canceled: bySeason[y].filter((e) => e.status === 'canceled').length,
    completed: bySeason[y].filter((e) => e.status === 'completed').length,
    regulations_era: eraOf(y),
    source: 'espn',
    source_id: String(y),
    source_url: `https://sports.core.api.espn.com/v2/sports/racing/leagues/f1/seasons/${y}`,
    source_updated_at: null,
    ingested_at: ingestedAt,
  }));
  const constructors = Object.values(CONSTRUCTORS).sort((a, b) => a.id.localeCompare(b.id));
  const count = (arr, fn) => arr.reduce((o, x) => ((o[fn(x)] = (o[fn(x)] || 0) + 1), o), {});
  const minSeason = (arr) => (arr.length ? Math.min(...arr.map((r) => r.season)) : null);
  const coverage = {
    generated_at: ingestedAt,
    seasons: seasons.length,
    earliest_season: seasons[0]?.year ?? null,
    latest_season: seasons.at(-1)?.year ?? null,
    events: events.length,
    events_completed: events.filter((e) => e.status === 'completed').length,
    events_canceled: events.filter((e) => e.status === 'canceled').length,
    sessions: sessions.length,
    sessions_by_type: count(sessions, (s) => s.type),
    classifications: results.length,
    classifications_by_type: count(results, (r) => r.session_type),
    practice_only_race_entries: results.filter((r) => r.status === 'practice_only').length,
    entries_upcoming: entries.length,
    drivers: ds.length,
    constructors: constructors.length,
    venues: venues.length,
    standings_rows: standings.length,
    first_season_with_sessions: minSeason(sessions.filter((s) => s.type !== 'race')),
    first_season_with_pit_counts: minSeason(results.filter((r) => r.pit_stops > 0)),
    first_season_with_q123: minSeason(results.filter((r) => r.q1_ms)),
    first_season_with_fastest_lap: minSeason(results.filter((r) => r.fastest_lap_ms)),
    missing_drivers: missingDrivers.length,
    unresolved_constructor_names: unresolved(),
    constructor_relabels: seasonRelabels(),
    identity_review: identityReview,
    unsupported_tables: {
      lap: 'no licensed lap-by-lap source (the source exposes no per-lap timing)',
      stint: 'no source',
      tyre_stint: 'no source',
      pit_stop: 'only per-driver pit COUNT (pitsTaken); no per-stop timing',
      telemetry_reference: 'no source',
      penalty: 'only disqualification status and grid effects visible in classifications',
      incident: 'no source',
      weather: 'forecast only (MET Norway) for upcoming events; no historical observations',
    },
  };
  return { seasons, events, sessions, classifications: results, entries, drivers: ds.sort((a, b) => a.id.localeCompare(b.id)), constructors, driver_constructor_seasons: driverConstructorSeasons, circuits: venues, standings, coverage };
}
