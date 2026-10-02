// Read access to the published F1 projection (the PropSports contract), with the lookups the desk needs.
// The desk never reads upstream data: everything it states comes from these documents.
import fs from 'node:fs';
import path from 'node:path';

export function loadProjection(dir = 'data/projection') {
  const J = (n) => JSON.parse(fs.readFileSync(path.resolve(dir, `${n}.json`), 'utf8'));
  const meta = J('meta');
  const seasons = J('seasons');
  const years = (Array.isArray(seasons) ? seasons : seasons.seasons || []).map((s) => (typeof s === 'number' ? s : s.year ?? s.season)).filter(Boolean);
  const eventsBy = {};
  const standingsBy = {};
  for (const y of years) {
    try { eventsBy[y] = J(`events-${y}`); } catch { /* season without events doc */ }
    try { standingsBy[y] = J(`standings-${y}`); } catch { /* no standings */ }
  }
  return makeData({ meta, eventsBy, standingsBy, drivers: J('drivers'), constructors: J('constructors'), circuits: J('circuits'), dnaDriver: J('dna-driver'), dnaCon: J('dna-constructor'), dnaCircuit: J('dna-circuit'), fit: J('fit'), matchups: J('matchups') });
}

export function makeData(d) {
  const allEvents = Object.values(d.eventsBy).flat().sort((a, b) => a.start_utc.localeCompare(b.start_utc));
  const X = {
    ...d,
    currentSeason: d.meta.current_season,
    allEvents,
    event: Object.fromEntries(allEvents.map((e) => [e.id, e])),
    driver: Object.fromEntries(d.drivers.map((x) => [x.id, x])),
    con: Object.fromEntries(d.constructors.map((x) => [x.id, x])),
    circuit: Object.fromEntries(d.circuits.map((x) => [x.id, x])),
  };
  // current grid: drivers whose latest team season is the current season
  X.currentGrid = d.drivers.filter((x) => x.team_season === d.meta.current_season).map((x) => x.id);
  X.session = (eid, type) => X.event[eid]?.sessions.find((s) => s.type === type) || null;
  X.rows = (eid, type) => (X.session(eid, type)?.results || []).filter((r) => r.status !== 'practice_only').slice().sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  X.raceEvents = (season) => (d.eventsBy[season] || []).filter((e) => e.status !== 'canceled').sort((a, b) => a.round - b.round);
  X.completedRaces = (season) => X.raceEvents(season).filter((e) => X.session(e.id, 'race')?.state === 'completed' && X.rows(e.id, 'race').length);
  X.nextEvent = (afterIso) => allEvents.find((e) => e.status !== 'canceled' && e.start_utc > afterIso && e.status !== 'completed') || null;
  X.eventsAtCircuit = (cid) => allEvents.filter((e) => e.circuit_id === cid);
  // Career race wins/podiums/poles up to (not including) an event, from our own archive
  X.careerBefore = (driverId, beforeIso) => {
    let starts = 0, wins = 0, podiums = 0;
    for (const e of allEvents) {
      if (e.start_utc >= beforeIso) break;
      const r = X.rows(e.id, 'race').find((x) => x.driver_id === driverId);
      if (!r) continue;
      starts++;
      if (r.status === 'classified' && r.position === 1) wins++;
      if (r.status === 'classified' && r.position <= 3) podiums++;
    }
    return { starts, wins, podiums };
  };
  // race head-to-head between two drivers in the SAME car, up to and including an event; as of that race, never using
  // later results
  X.h2hAsOf = (a, b, uptoIso) => {
    let wa = 0, wb = 0, shared = 0, first = null;
    for (const e of allEvents) {
      if (e.start_utc > uptoIso) break;
      const rows = X.rows(e.id, 'race');
      const ra = rows.find((r) => r.driver_id === a), rb = rows.find((r) => r.driver_id === b);
      if (!ra || !rb || ra.constructor_id !== rb.constructor_id) continue;
      shared++; first ??= e.season;
      // same rule as the matchup page: only races where both cars were classified decide the head-to-head
      if (ra.status === 'classified' && rb.status === 'classified') (ra.position < rb.position ? wa++ : wb++);
    }
    return { a: wa, b: wb, shared, first_season: first };
  };
  // championship table after a given round (from the standings progression)
  X.champAfter = (season, eventId, kind = 'drivers') => {
    const prog = d.standingsBy[season]?.progression || [];
    const i = prog.findIndex((r) => r.event_id === eventId);
    if (i < 0) return null;
    const table = (r) => Object.entries(r[kind] || {}).map(([id, v]) => ({ id, points: v.p, pos: v.pos })).sort((a, b) => a.pos - b.pos);
    return { after: table(prog[i]), before: i > 0 ? table(prog[i - 1]) : [], round_index: i, rounds: prog.slice(0, i + 1) };
  };
  return X;
}
