// Public PropSports F1 projection: normalized + derived tables → provider-neutral documents for /v1/f1/*.
// Public ids only (driver/event/circuit slugs, constructor ids, sessions as <event-slug>-<type>).
// No provenance fields, no upstream ids or URLs. Upstream-id translation maps go to internal.json, which
// the data plane uses (live tower, media proxy) but never serves.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const N = (n) => JSON.parse(fs.readFileSync(path.resolve('data/normalized', n + '.json'), 'utf8'));
const D = (n) => JSON.parse(fs.readFileSync(path.resolve('data/derived', n + '.json'), 'utf8'));
const OUT = path.resolve('data/projection');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const events = N('events');
const sessions = N('sessions');
const results = N('classifications');
const drivers = N('drivers');
const constructors = N('constructors');
const standings = N('standings');
const seasons = N('seasons');
const dcs = N('driver_constructor_seasons');
const circuits = D('circuits');
const evCirc = D('event_circuits');
const careers = D('careers');
const dnaCur = D('driver_dna_current');
const dnaCar = D('driver_dna_career');
const conDna = D('constructor_dna');
const circuitDna = D('circuit_dna');
const fit = D('circuit_fit');
const teammates = D('teammates');
const matchups = D('matchups');
const progression = D('progression');
const meta = D('meta');
let media = {};
try { media = D('media'); } catch {}

const MEDIA_BASE = '/v1/f1/media';
const drvSlug = Object.fromEntries(drivers.map((d) => [d.id, d.slug]));
const evById = Object.fromEntries(events.map((e) => [e.id, e]));
const circById = Object.fromEntries(circuits.map((c) => [c.id, c]));
const conById = Object.fromEntries(constructors.map((c) => [c.id, c]));
const sessionsByEvent = {};
for (const s of sessions) (sessionsByEvent[s.event_id] ||= []).push(s);
const resultsBySession = {};
for (const r of results) if (r.status !== 'practice_only') (resultsBySession[r.session_id] ||= []).push(r);
const circuitSlug = (cid) => circById[cid]?.slug || null;
const circuitName = (c) => (c?.espn_venue_ids?.length ? c.name : c?.wikidata_name || c?.name) || null;
const sessionPublicId = (s) => `${evById[s.event_id].slug}-${s.type.replace(/_/g, '-')}`;
const latestColor = (cid) => {
  const cols = conById[cid]?.colors || {};
  const y = Object.keys(cols).map(Number).sort((a, b) => b - a)[0];
  return y ? cols[y] : null;
};
const mediaOk = (u) => u && media[u] !== false;

// ---- public row shapers (allow-lists: anything not listed is dropped) ----
const pubDriver = (d) => {
  const c = careers[d.id] || {};
  const lt = [...dcs].filter((x) => x.driver_id === d.id).sort((a, b) => b.season - a.season || b.race_starts - a.race_starts)[0];
  return {
    id: d.slug,
    name: d.full_name,
    first_name: d.first_name,
    last_name: d.last_name,
    code: d.code,
    nationality: d.nationality,
    date_of_birth: d.date_of_birth,
    number: lt?.car_numbers?.[0] || null,
    team_id: lt?.constructor_id || null,
    team_season: lt?.season || null,
    headshot: mediaOk(d.headshot_url) ? `${MEDIA_BASE}/headshot/${d.slug}` : null,
    flag: mediaOk(d.flag_url) ? `${MEDIA_BASE}/flag/${d.slug}` : null,
    career: { starts: c.starts ?? 0, wins: c.wins ?? 0, podiums: c.podiums ?? 0, poles: c.poles ?? 0, fastest_laps: c.fastest_laps ?? 0, points: c.points ?? 0, championships: c.championships || [], first_season: c.first_season ?? null, last_season: c.last_season ?? null, best_finish: c.best_finish ?? null },
  };
};
const pubConstructor = (c) => ({ id: c.id, name: c.name, lineage_id: c.lineage_id, first_season: c.first_season, last_season: c.last_season, color: latestColor(c.id) });
const pubCircuit = (c) => ({ id: c.slug, name: circuitName(c), locality: c.locality, country: c.country, lat: c.lat, lon: c.lon, latest_layout: c.length_km ? { length_km: c.length_km, turns: c.turns || null, layout_type: c.layout_type || null } : null, opened: c.opened || null });
const pubResult = (r) => ({
  position: r.status === 'classified' || !['race', 'sprint'].includes(r.session_type) ? r.position : null,
  driver_id: drvSlug[r.driver_id] || null,
  constructor_id: r.constructor_id,
  constructor_inferred: !!r.constructor_inferred,
  car_number: r.car_number,
  grid: r.grid,
  status: r.status,
  laps: r.laps,
  time: r.time_text,
  time_ms: r.time_ms,
  gap: r.gap_text,
  behind_laps: r.behind_laps,
  points: r.points,
  points_scope: r.points_scope || null,
  laps_led: r.laps_led,
  pit_stops: r.pit_stops,
  fastest_lap: r.fastest_lap_text,
  fastest_lap_ms: r.fastest_lap_ms,
  fastest_lap_number: r.fastest_lap_number,
  best_lap_ms: r.best_lap_ms,
  q1_ms: r.q1_ms,
  q2_ms: r.q2_ms,
  q3_ms: r.q3_ms,
});
const pubSession = (s, withResults) => ({
  id: sessionPublicId(s),
  event_id: evById[s.event_id].slug,
  type: s.type,
  label: s.label,
  start_utc: s.start_utc,
  time_confirmed: s.time_valid,
  state: s.state,
  laps_scheduled: s.laps_scheduled,
  distance_km: s.distance_km,
  ...(withResults ? { results: (resultsBySession[s.id] || []).sort((a, b) => (a.position ?? 999) - (b.position ?? 999)).map(pubResult) } : {}),
});
// Relocated rounds: "<X> Grand Prix in <Country>" in a season whose own "<X> Grand Prix" was cancelled is that round held
// at another venue (2026: the Bahrain Grand Prix at Sepang; corroborated by Wikipedia "2026 Bahrain Grand Prix", which
// gives the official name "Formula 1 Gulf Air Bahrain Grand Prix in Malaysia 2026"). The event keeps its true name; the
// link lets every surface explain the venue instead of the name looking like an error.
function relocationOf(e) {
  const m = /^(.+ Grand Prix) in (.+)$/.exec(e.name || '');
  if (!m) return null;
  const orig = events.find((x) => x.season === e.season && x.id !== e.id && x.name === m[1] && x.status === 'canceled');
  return orig ? { event_id: orig.slug, original_circuit_id: circuitSlug(evCirc[orig.id]?.circuit_id), host_country: m[2], basis: 'same-season cancelled round of the same name' } : null;
}
const pubEvent = (e, withSessions) => ({
  id: e.slug,
  season: e.season,
  round: e.round,
  name: e.name,
  official_name: e.official_name,
  ...(relocationOf(e) ? { relocated_from: relocationOf(e) } : {}),
  circuit_id: circuitSlug(evCirc[e.id]?.circuit_id),
  start_utc: e.start_utc,
  end_utc: e.end_utc,
  status: e.status,
  format: e.format,
  sprint: e.sprint,
  sessions: (sessionsByEvent[e.id] || []).sort((a, b) => (a.start_utc || '').localeCompare(b.start_utc || '')).map((s) => (withSessions ? pubSession(s, true) : { id: sessionPublicId(s), type: s.type, start_utc: s.start_utc, state: s.state })),
});
// Derived documents: rewrite upstream-keyed ids to public ids recursively.
function publicize(x) {
  if (Array.isArray(x)) return x.map(publicize);
  if (x && typeof x === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(x)) {
      if (['source', 'source_id', 'source_url', 'source_updated_at', 'ingested_at', 'captured_at', 'wikidata_id', 'espn_venue_ids', 'espn_id'].includes(k)) continue;
      o[k] = publicize(v);
    }
    return o;
  }
  if (typeof x === 'string') {
    if (drvSlug[x]) return drvSlug[x];
    if (evById[x]) return evById[x].slug;
    if (circById[x]) return circById[x].slug;
  }
  return x;
}

const files = {};
const put = (name, data) => (files[name] = data);

const cur = meta.current_season;
put('seasons', seasons.map((s) => ({ year: s.year, rounds: s.rounds, canceled: s.canceled, completed: s.completed, regulations_era: s.regulations_era })));
put('drivers', drivers.filter((d) => careers[d.id]?.entries).map(pubDriver));
put('constructors', constructors.map(pubConstructor));
put('circuits', circuits.map(pubCircuit));
for (const y of [...new Set(events.map((e) => e.season))]) {
  put(`events-${y}`, events.filter((e) => e.season === y).map((e) => pubEvent(e, true)));
  const st = (kind) => standings.filter((s) => s.season === y && s.kind === kind && s.subject_id).sort((a, b) => a.position - b.position).map((s) => ({ position: s.position, [kind === 'driver' ? 'driver_id' : 'constructor_id']: kind === 'driver' ? drvSlug[s.subject_id] || null : s.subject_id, points: s.points, wins: s.wins, poles: s.poles ?? null }));
  const prog = progression[y];
  put(`standings-${y}`, {
    season: y,
    drivers: st('driver'),
    constructors: st('constructor'),
    progression: prog && prog.matches_official !== false ? prog.rounds.map((r) => ({ event_id: evById[r.event_id]?.slug, round: r.round, drivers: Object.fromEntries(Object.entries(r.drivers).map(([id, v]) => [drvSlug[id] || id, v])), constructors: r.constructors })) : null,
    progression_note: prog?.note || null,
  });
}
put('dna-driver', Object.fromEntries(drivers.filter((d) => dnaCur[d.id] || dnaCar[d.id]).map((d) => [d.slug, { current: publicize(dnaCur[d.id] || null), career: publicize(dnaCar[d.id] || null) }])));
put('dna-constructor', Object.fromEntries(constructors.map((c) => [c.id, Object.fromEntries(Object.entries(conDna).filter(([, m]) => m[c.id]).map(([y, m]) => [y, publicize(m[c.id])]))]).filter(([, v]) => Object.keys(v).length)));
put('dna-circuit', Object.fromEntries(circuits.filter((c) => circuitDna[c.id]).map((c) => [c.slug, publicize({ ...circuitDna[c.id], circuit_id: c.id })])));
put('fit', Object.fromEntries(Object.entries(fit).map(([eid, f]) => [evById[eid].slug, publicize(f)])));
put('matchups', Object.fromEntries(Object.values(matchups).map((m) => {
  const [a, b] = [drvSlug[m.a], drvSlug[m.b]].sort();
  const t = teammates.find((x) => (x.a === m.a && x.b === m.b) || (x.a === m.b && x.b === m.a));
  return [`${a}|${b}`, publicize({ ...m, teammates: t ? { constructors: t.constructors, seasons: t.seasons, a: t.a, b: t.b, career: t.career, last5: t.last5, last10: t.last10, by_season: t.by_season } : null })];
})));
put('meta', { current_season: cur, dna_version: meta.version, as_of: meta.as_of, counts: { seasons: seasons.length, events: events.length, drivers: drivers.length, constructors: constructors.length, circuits: circuits.length } });

// Internal translation index (never served).
const internal = {
  driver_by_upstream: Object.fromEntries(drivers.map((d) => [d.espn_id, { id: d.slug, name: d.full_name, code: d.code }])),
  event_by_upstream: Object.fromEntries(events.map((e) => [e.id.replace(/^espn-/, ''), e.slug])),
  media: Object.fromEntries(drivers.filter((d) => careers[d.id]?.entries).map((d) => [d.slug, { headshot: mediaOk(d.headshot_url) ? d.headshot_url : null, flag: mediaOk(d.flag_url) ? d.flag_url : null }])),
  circuits_geo: Object.fromEntries(circuits.filter((c) => c.lat != null).map((c) => [c.slug, { lat: c.lat, lon: c.lon }])),
};

// Leak check: no upstream names/hosts/ids in public documents.
const leaks = [];
for (const [name, data] of Object.entries(files)) {
  const s = JSON.stringify(data);
  for (const pat of [/espn/i, /wikidata/i, /met\.no/i, /"wd-Q/]) if (pat.test(s)) leaks.push(`${name}: ${pat}`);
}
if (leaks.length) {
  console.error('projection leak check FAILED:\n' + leaks.join('\n'));
  process.exit(1);
}
const version = crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 16);
for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(data));
fs.writeFileSync(path.join(OUT, 'internal.json'), JSON.stringify(internal));
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ version, generated_at: new Date().toISOString(), files: Object.keys(files).sort() }));
console.log(`projection ${version}: ${Object.keys(files).length} public documents, leak check PASS`);
