// Loads normalized + derived data and builds lookups for page rendering.
import fs from 'node:fs';
import path from 'node:path';

const N = (n) => JSON.parse(fs.readFileSync(path.resolve('data/normalized', n + '.json'), 'utf8'));
const Dv = (n) => JSON.parse(fs.readFileSync(path.resolve('data/derived', n + '.json'), 'utf8'));

export function loadContext() {
  const ctx = {
    events: N('events'),
    sessions: N('sessions'),
    results: N('classifications'),
    entries: N('entries'),
    drivers: N('drivers'),
    constructors: N('constructors'),
    standings: N('standings'),
    seasons: N('seasons'),
    coverage: N('coverage'),
    dcs: N('driver_constructor_seasons'),
    circuits: Dv('circuits'),
    careers: Dv('careers'),
    dnaCur: Dv('driver_dna_current'),
    dnaCareer: Dv('driver_dna_career'),
    conDna: Dv('constructor_dna'),
    circuitDna: Dv('circuit_dna'),
    fit: Dv('circuit_fit'),
    teammates: Dv('teammates'),
    matchups: Dv('matchups'),
    progression: Dv('progression'),
    driverLog: Dv('driver_log'),
    meta: Dv('meta'),
    dnaReport: Dv('dna_report'),
  };
  let media = {};
  try { media = JSON.parse(fs.readFileSync(path.resolve('data/derived/media.json'), 'utf8')); } catch {}
  ctx.mediaOk = (url) => media[url] !== false; // unverified URLs are treated as ok only if not proven broken
  ctx.media = media;
  // Drop media proven unavailable so nothing renders as a broken image.
  for (const d of ctx.drivers) {
    if (d.headshot_url && media[d.headshot_url] === false) d.headshot_url = null;
    if (d.flag_url && media[d.flag_url] === false) d.flag_url = null;
  }

  // circuit_id on events is canonicalized in derive (wd-*); apply the same mapping to normalized events.
  // Per-event circuit attribution is decided in derive (Wikidata per-edition link, ESPN venue fallback ≥2000).
  const evc = Dv('event_circuits');
  for (const e of ctx.events) {
    e.circuit_id = evc[e.id]?.circuit_id ?? null;
    e.circuit_source = evc[e.id]?.source ?? null;
  }

  ctx.currentSeason = ctx.meta.current_season;
  ctx.eventById = Object.fromEntries(ctx.events.map((e) => [e.id, e]));
  ctx.driverById = Object.fromEntries(ctx.drivers.map((d) => [d.id, d]));
  ctx.conById = Object.fromEntries(ctx.constructors.map((c) => [c.id, c]));
  ctx.circuitById = Object.fromEntries(ctx.circuits.map((c) => [c.id, c]));
  ctx.sessionsByEvent = group(ctx.sessions, (s) => s.event_id);
  ctx.resultsBySession = group(ctx.results, (r) => r.session_id);
  ctx.eventsBySeason = group(ctx.events, (e) => e.season);
  for (const list of Object.values(ctx.eventsBySeason)) list.sort((a, b) => a.start_utc.localeCompare(b.start_utc));
  ctx.eventsByCircuit = group(ctx.events, (e) => e.circuit_id);
  ctx.standingsBy = group(ctx.standings, (s) => `${s.season}|${s.kind}`);
  ctx.teammatesByDriver = {};
  for (const t of ctx.teammates) {
    (ctx.teammatesByDriver[t.a] ||= []).push(t);
    (ctx.teammatesByDriver[t.b] ||= []).push(t);
  }
  ctx.dcsByDriver = group(ctx.dcs, (x) => x.driver_id);
  ctx.dcsByCon = group(ctx.dcs, (x) => x.constructor_id);
  ctx.session = (eid, type) => (ctx.sessionsByEvent[eid] || []).find((s) => s.type === type);
  ctx.rows = (eid, type) => {
    const s = ctx.session(eid, type);
    // Practice-only drivers ESPN lists on race entries are not race entrants.
    return s ? [...(ctx.resultsBySession[s.id] || [])].filter((r) => r.status !== 'practice_only').sort((a, b) => (a.position ?? 999) - (b.position ?? 999)) : [];
  };
  // Team colour per (constructor, season) from ESPN; fall back to latest known.
  ctx.colorOf = (cid, season) => {
    const c = ctx.conById[cid];
    if (!c) return null;
    if (c.colors?.[season]) return c.colors[season];
    const ys = Object.keys(c.colors || {}).map(Number).sort((a, b) => b - a);
    return ys.length ? c.colors[ys[0]] : null;
  };
  const cur = ctx.eventsBySeason[ctx.currentSeason] || [];
  // build clock (F1_SITE_NOW pins it for deterministic QA); every 'next'/'upcoming' decision uses this one value
  const now = process.env.F1_SITE_NOW ? Date.parse(process.env.F1_SITE_NOW) : Date.now();
  ctx.now = now;
  // source states that did not advance: a session still 'scheduled' after its start time. Never shown as next/upcoming.
  ctx.staleSessions = ctx.events.filter((e) => e.season === ctx.currentSeason).flatMap((e) => (ctx.sessionsByEvent[e.id] || []).filter((s) => s.start_utc && !['completed', 'canceled', 'live'].includes(s.state) && Date.parse(s.start_utc) + 4 * 3600e3 < now).map((s) => `${e.id}:${s.type}`));
  ctx.nextEvent = cur.find((e) => e.status !== 'canceled' && e.status !== 'completed' && Date.parse(e.end_utc || e.start_utc) + 6 * 3600e3 > now) || null;
  ctx.lastCompleted = [...ctx.events].filter((e) => e.status === 'completed').sort((a, b) => b.start_utc.localeCompare(a.start_utc))[0] || null;
  ctx.currentGrid = ctx.meta.current_grid;
  ctx.currentTeams = [...new Set(ctx.currentGrid.map((g) => g.constructor_id))];
  // Latest team for each driver
  ctx.latestTeam = {};
  for (const x of [...ctx.dcs].sort((a, b) => a.season - b.season)) ctx.latestTeam[x.driver_id] = { constructor_id: x.constructor_id, season: x.season };
  ctx.driverUrl = (id) => (ctx.driverById[id] ? `/drivers/${ctx.driverById[id].slug}` : null);
  ctx.teamUrl = (id) => (ctx.conById[id] ? `/teams/${id}` : null);
  ctx.raceUrl = (id) => (ctx.eventById[id] ? `/races/${ctx.eventById[id].slug}` : null);
  ctx.circuitUrl = (id) => (ctx.circuitById[id] ? `/circuits/${ctx.circuitById[id].slug}` : null);
  ctx.matchupUrl = (a, b) => {
    const [x, y] = [a, b].sort();
    if (!ctx.matchups[`${x}|${y}`]) return null;
    return `/matchup/${ctx.driverById[x].slug}/${ctx.driverById[y].slug}`;
  };
  // ESPN's venue name where the circuit is an ESPN venue, else the Wikidata label.
  ctx.circuitName = (id) => (ctx.circuitById[id]?.espn_venue_ids?.length ? ctx.circuitById[id].name : ctx.circuitById[id]?.wikidata_name || ctx.circuitById[id]?.name) || '—';
  return ctx;
}

function group(arr, fn) {
  const m = {};
  for (const x of arr) (m[fn(x)] ||= []).push(x);
  return m;
}
