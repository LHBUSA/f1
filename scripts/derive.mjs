// Derived intelligence from normalized source truth → data/derived/*.json
// Never writes back to normalized tables. Every metric carries sample size, population, confidence, version, as-of.
import { rankWithCountback } from '../src/core/standings.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { slugify } from '../src/core/normalize.mjs';

export const DNA_VERSION = 'f1-dna-1.0.0';
const IN = path.resolve('data/normalized');
const OUT = path.resolve('data/derived');
fs.mkdirSync(OUT, { recursive: true });
const load = (n) => JSON.parse(fs.readFileSync(path.join(IN, n + '.json'), 'utf8'));

const events = load('events');
const sessions = load('sessions');
const results = load('classifications');
const drivers = load('drivers');
const constructors = load('constructors');
const circuits = load('circuits');
const standings = load('standings');
let wikidata = null;
try { wikidata = load('wikidata'); } catch {}

// Canonical circuits: ESPN venue ids that crosswalk to the same Wikidata circuit are one circuit.
{
  const xw = wikidata?.venue_crosswalk || {};
  const canon = {};
  const merged = {};
  // When several ESPN venues merge into one Wikidata circuit, the venue most events use is the main layout and owns the
  // name/length/turns (2026-10-02: Bahrain's one-off 2020 "Outer Track" venue was captured last and had renamed the
  // whole circuit and replaced its layout figures). Ties fall back to the most recent capture.
  const venueUse = {};
  for (const e of events) if (e.circuit_id) venueUse[e.circuit_id] = (venueUse[e.circuit_id] || 0) + 1;
  const sorted = [...circuits].sort((a, b) => (venueUse[a.id] || 0) - (venueUse[b.id] || 0) || String(a.captured_at).localeCompare(String(b.captured_at)));
  const ownerOf = {};
  for (const c of sorted) { const wd = xw[c.id]?.wikidata_id; ownerOf[wd ? `wd-${wd}` : c.id] = c.id; }
  for (const c of circuits) {
    const wd = xw[c.id]?.wikidata_id;
    const cid = wd ? `wd-${wd}` : c.id;
    canon[c.id] = cid;
    const wdc = wd ? wikidata.circuits[wd] : null;
    const m = (merged[cid] ||= { ...c, id: cid, espn_venue_ids: [], name: c.name, wikidata_id: wd || null, wikidata_name: wdc?.name || null, lat: wdc?.lat ?? null, lon: wdc?.lon ?? null, opened: wdc?.opened ?? null, wikidata_country: wdc?.country || null });
    m.espn_venue_ids.push(c.espn_id);
    // The main-layout venue (most events) supplies the descriptive fields; others only fill gaps.
    if (ownerOf[cid] === c.id) Object.assign(m, { name: c.name, length_km: c.length_km || m.length_km, turns: c.turns || m.turns, layout_type: c.layout_type || m.layout_type, locality: c.locality || m.locality, captured_at: c.captured_at });
    else if (c.length_km && !m.length_km) Object.assign(m, { length_km: c.length_km, turns: c.turns || m.turns });
  }
  // Per-event circuit. ESPN venue ids are per GRAND PRIX and the venue document describes the GP's CURRENT
  // venue (e.g. every Spanish GP 1995–2024 points at today's Madring), so history comes from Wikidata's
  // per-edition race → circuit link. ESPN venue is a fallback only from 2000 on; older unknowns stay null.
  const evCircuit = Object.fromEntries((wikidata?.event_crosswalk || []).filter((x) => x.wikidata_circuit).map((x) => [x.event_id, x.wikidata_circuit]));
  const circuitAttribution = { wikidata_race: 0, espn_venue_fallback: 0, unknown: 0 };
  for (const e of events) {
    // A cancelled event keeps the venue it was scheduled at (Wikidata may describe a relocated edition).
    const wd = e.status === 'canceled' && e.circuit_id && canon[e.circuit_id] ? null : evCircuit[e.id];
    if (wd) {
      const cid = `wd-${wd}`;
      if (!merged[cid]) {
        const w = wikidata.circuits[wd] || {};
        merged[cid] = { id: cid, espn_venue_ids: [], espn_id: null, name: w.name || wd, slug: slugify(w.name || wd), wikidata_id: wd, wikidata_name: w.name || null, lat: w.lat ?? null, lon: w.lon ?? null, opened: w.opened ?? null, locality: w.locality || null, country: w.country || null, wikidata_country: w.country || null, flag_url: null, layout_type: null, length_km: null, turns: null, source: 'wikidata', source_id: wd, source_url: `https://www.wikidata.org/wiki/${wd}`, source_updated_at: null, ingested_at: new Date().toISOString() };
        // Wikidata lengths are layout-ambiguous for historic circuits; not displayed.
      }
      e.circuit_id = cid;
      e.circuit_source = 'wikidata_race';
      circuitAttribution.wikidata_race++;
    } else if (e.circuit_id && (e.season >= 2000 || e.status === 'canceled') && canon[e.circuit_id]) {
      e.circuit_id = canon[e.circuit_id];
      e.circuit_source = 'espn_venue';
      circuitAttribution.espn_venue_fallback++;
    } else {
      e.circuit_id = null;
      e.circuit_source = null;
      circuitAttribution.unknown++;
    }
  }
  // Keep only circuits that host at least one event.
  const usedIds = new Set(events.map((e) => e.circuit_id).filter(Boolean));
  for (const k of Object.keys(merged)) if (!usedIds.has(k)) delete merged[k];
  fs.writeFileSync(path.join(OUT, 'circuit_attribution.json'), JSON.stringify(circuitAttribution));
  fs.writeFileSync(path.join(OUT, 'event_circuits.json'), JSON.stringify(Object.fromEntries(events.map((e) => [e.id, { circuit_id: e.circuit_id, source: e.circuit_source }]))));
  circuits.length = 0;
  const used = new Set();
  for (const m of Object.values(merged)) {
    let slug = m.slug;
    if (used.has(slug)) slug = `${slug}-${m.espn_venue_ids[0]}`;
    used.add(slug);
    m.slug = slug;
    circuits.push(m);
  }
}
fs.writeFileSync(path.join(OUT, 'circuits.json'), JSON.stringify(circuits));

const asOf = new Date().toISOString();
const currentSeason = Math.max(...events.map((e) => e.season));
const eventById = Object.fromEntries(events.map((e) => [e.id, e]));
const driverById = Object.fromEntries(drivers.map((d) => [d.id, d]));
const circuitById = Object.fromEntries(circuits.map((c) => [c.id, c]));
const sessionsByEvent = groupBy(sessions, (s) => s.event_id);
const resultsBySession = groupBy(results, (r) => r.session_id);

// ---------- helpers ----------
function groupBy(arr, fn) {
  const m = {};
  for (const x of arr) (m[fn(x)] ||= []).push(x);
  return m;
}
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const confidenceOf = (n, lo = 8, hi = 20) => (n >= hi ? 'high' : n >= lo ? 'medium' : 'low');
const STARTED_STATUSES = new Set(['classified', 'retired', 'disqualified', 'not_classified']);
const STARTED = (r) => !!r && (STARTED_STATUSES.has(r.status) || (r.status == null && (r.laps || 0) > 0));
const CLASSIFIED = (r) => r && r.status === 'classified';

function percentileRank(value, population, higherIsBetter = true) {
  if (value == null || !population.length) return null;
  let below = 0;
  let equal = 0;
  for (const p of population) {
    if (p < value) below++;
    else if (p === value) equal++;
  }
  const pct = ((below + equal / 2) / population.length) * 100;
  return Math.round(higherIsBetter ? pct : 100 - pct);
}

// ---------- per-event structures ----------
const eventSession = (eid, type) => (sessionsByEvent[eid] || []).find((s) => s.type === type);
const completedEvents = events.filter((e) => e.status === 'completed' && e.round).sort((a, b) => a.start_utc.localeCompare(b.start_utc));

// Race entrants only: practice-only drivers listed on the race entry are excluded.
function raceRows(eid) {
  const s = eventSession(eid, 'race');
  return s ? (resultsBySession[s.id] || []).filter((r) => r.race_participant !== false && r.status !== 'practice_only') : [];
}
function qualiRows(eid) {
  const s = eventSession(eid, 'qualifying');
  return s ? resultsBySession[s.id] || [] : [];
}
/** Best comparable qualifying time pair for teammates: deepest knockout session both set a time in. */
function qualiPairDelta(a, b) {
  for (const k of ['q3_ms', 'q2_ms', 'q1_ms', 'best_lap_ms']) {
    if (a[k] && b[k]) return { pct: ((a[k] - b[k]) / b[k]) * 100, stage: k };
  }
  return null;
}
const bestQuali = (r) => Math.min(...['q1_ms', 'q2_ms', 'q3_ms', 'best_lap_ms'].map((k) => r[k] || Infinity));

// Circuit speed: pole-lap average speed (km/h) = official lap length / fastest qualifying lap.
const circuitSpeeds = {};
for (const e of completedEvents) {
  const c = circuitById[e.circuit_id];
  const q = qualiRows(e.id);
  if (!c?.length_km || !q.length || e.season < currentSeason - 5) continue;
  const best = Math.min(...q.map(bestQuali));
  if (!Number.isFinite(best)) continue;
  (circuitSpeeds[e.circuit_id] ||= []).push(c.length_km / (best / 3600000));
}
const speedByCircuit = Object.fromEntries(Object.entries(circuitSpeeds).map(([k, v]) => [k, median(v)]));
const speedVals = Object.values(speedByCircuit).sort((a, b) => a - b);
const tercile = (v) => {
  if (v == null || speedVals.length < 6) return null;
  const lo = speedVals[Math.floor(speedVals.length / 3)];
  const hi = speedVals[Math.floor((2 * speedVals.length) / 3)];
  return v >= hi ? 'high' : v <= lo ? 'low' : 'medium';
};
const speedClass = Object.fromEntries(Object.entries(speedByCircuit).map(([k, v]) => [k, tercile(v)]));
const isStreet = (cid) => /street/i.test(circuitById[cid]?.layout_type || '');

// Expected positions gained by grid slot (all classified finishes, per era bucket) for adjustment.
const expectedGain = {};
for (const r of results) {
  if (r.session_type !== 'race' || !CLASSIFIED(r) || !r.grid || !r.position) continue;
  const era = r.season >= 2010 ? 'modern' : 'classic';
  ((expectedGain[era] ||= {})[r.grid] ||= []).push(r.grid - r.position);
}
for (const era of Object.keys(expectedGain)) for (const g of Object.keys(expectedGain[era])) expectedGain[era][g] = mean(expectedGain[era][g]);

// ---------- per-driver event log ----------
// One row per (driver, event) with teammate context.
const driverLog = {};
for (const e of completedEvents) {
  const race = raceRows(e.id);
  const quali = qualiRows(e.id);
  const sprint = (() => {
    const s = eventSession(e.id, 'sprint');
    return s ? resultsBySession[s.id] || [] : [];
  })();
  const qBy = Object.fromEntries(quali.map((r) => [r.driver_id, r]));
  const sBy = Object.fromEntries(sprint.map((r) => [r.driver_id, r]));
  const fastest = Math.min(...race.map((r) => r.fastest_lap_ms || Infinity));
  const byTeam = groupBy(race.filter((r) => r.constructor_id), (r) => r.constructor_id);
  const teamPoints = Object.fromEntries(Object.entries(byTeam).map(([t, rows]) => [t, rows.reduce((s, r) => s + (r.points || 0), 0)]));
  for (const r of race) {
    const q = qBy[r.driver_id];
    const mates = (byTeam[r.constructor_id] || []).filter((x) => x.driver_id !== r.driver_id);
    const qualiPos = q?.position || null;
    const row = {
      event_id: e.id,
      season: e.season,
      round: e.round,
      circuit_id: e.circuit_id,
      constructor_id: r.constructor_id,
      grid: r.grid,
      finish: r.position,
      status: r.status,
      classified: CLASSIFIED(r),
      started: STARTED(r) && r.grid !== 0,
      points: r.points || 0, // ESPN race-row points are weekend totals (sprint included)
      race_points: r.points || 0,
      team_points: teamPoints[r.constructor_id] || 0,
      laps_led: r.laps_led || 0,
      pit_stops: r.pit_stops,
      fastest_lap: Number.isFinite(fastest) && r.fastest_lap_ms === fastest,
      quali_pos: qualiPos,
      q3: !!q?.q3_ms,
      has_q_times: !!(q && (q.q1_ms || q.best_lap_ms)),
      pole: qualiPos ? qualiPos === 1 : r.grid === 1,
      sprint_pos: sBy[r.driver_id]?.position || null,
      mates: mates.map((m) => {
        const mq = qBy[m.driver_id];
        const d = q && mq ? qualiPairDelta(q, mq) : null;
        return {
          driver_id: m.driver_id,
          // DNA input (unchanged, documented in the DNA basis): qualifying classification, else starting grid
          quali_ahead: qualiPos && mq?.position ? qualiPos < mq.position : r.grid && m.grid ? r.grid < m.grid : null,
          // matchup/battle semantics: qualifying classification ONLY; the grid comparison is a separate, labelled
          // fallback used only when no qualifying classification exists for the pair (grid penalties never alter it)
          quali_cls_ahead: qualiPos && mq?.position ? qualiPos < mq.position : null,
          grid_ahead: !(qualiPos && mq?.position) && r.grid > 0 && m.grid > 0 ? r.grid < m.grid : null,
          quali_delta_pct: d && Math.abs(d.pct) < 5 ? d.pct : null,
          quali_stage: d?.stage || null,
          race_ahead: CLASSIFIED(r) && CLASSIFIED(m) ? r.position < m.position : CLASSIFIED(r) && !CLASSIFIED(m) && STARTED(m) ? true : !CLASSIFIED(r) && CLASSIFIED(m) && STARTED(r) ? false : null,
          both_classified: CLASSIFIED(r) && CLASSIFIED(m),
          finish_delta: CLASSIFIED(r) && CLASSIFIED(m) ? m.position - r.position : null,
          mate_classified: CLASSIFIED(m),
          mate_started: STARTED(m),
        };
      }),
    };
    const era = e.season >= 2010 ? 'modern' : 'classic';
    if (row.classified && row.grid && row.finish) {
      row.gain = row.grid - row.finish;
      row.gain_adj = row.gain - (expectedGain[era]?.[row.grid] ?? 0);
    }
    (driverLog[r.driver_id] ||= []).push(row);
  }
}

// ---------- career records ----------
const championships = {};
const conChampionships = {};
for (const s of standings) {
  if (s.position !== 1 || s.season >= currentSeason) continue;
  if (s.kind === 'driver') (championships[s.subject_id] ||= []).push(s.season);
  else if (s.subject_id) (conChampionships[s.subject_id] ||= []).push(s.season);
}
const careers = {};
for (const d of drivers) {
  const log = driverLog[d.id] || [];
  const starts = log.filter((x) => x.started);
  const seasons = [...new Set(log.map((x) => x.season))];
  careers[d.id] = {
    driver_id: d.id,
    entries: log.length,
    starts: starts.length,
    wins: log.filter((x) => x.classified && x.finish === 1).length,
    podiums: log.filter((x) => x.classified && x.finish <= 3).length,
    poles: log.filter((x) => x.pole).length,
    fastest_laps: log.filter((x) => x.fastest_lap).length,
    points: r3(log.reduce((s, x) => s + x.points, 0)),
    laps_led: log.reduce((s, x) => s + x.laps_led, 0),
    championships: championships[d.id] || [],
    first_season: seasons.length ? Math.min(...seasons) : null,
    last_season: seasons.length ? Math.max(...seasons) : null,
    seasons: seasons.length,
    best_finish: log.filter((x) => x.classified).reduce((m, x) => Math.min(m, x.finish || 99), 99),
    teams: [...new Set(log.map((x) => x.constructor_id))],
    points_note: 'Sum of points scored per race and sprint as published; pre-1991 seasons with dropped scores differ from official championship totals.',
  };
  if (careers[d.id].best_finish === 99) careers[d.id].best_finish = null;
}

// ---------- DRIVER DNA ----------
const UNAVAILABLE_DRIVER = {
  starts: 'Needs lap-1 positions; no licensed lap-by-lap source.',
  defense: 'Needs lap-by-lap position changes; not available.',
  tyre_management: 'Needs stint and compound data; not available.',
  wet_weather: 'Needs session weather observations; not available historically.',
  late_race: 'Needs lap times or lap positions; not available.',
  race_pace: 'Needs lap times; race classification is used for Race Result vs Teammate instead.',
};
const DRIVER_DIMS = [
  { key: 'qualifying', label: 'Qualifying Pace', min: 6 },
  { key: 'race_result', label: 'Race Result vs Teammate', min: 6 },
  { key: 'positions_gained', label: 'Positions Gained', min: 6 },
  { key: 'finishing', label: 'Finishing', min: 8 },
  { key: 'consistency', label: 'Consistency', min: 8 },
  { key: 'scoring', label: 'Team Points Share', min: 6 },
  { key: 'street', label: 'Street Circuits', min: 3 },
  { key: 'high_speed', label: 'High-Speed Circuits', min: 3 },
  { key: 'low_speed', label: 'Low-Speed Circuits', min: 3 },
];

function driverMetrics(log) {
  const m = {};
  const qd = log.flatMap((x) => x.mates.map((t) => t.quali_delta_pct).filter((v) => v != null));
  const qh = log.flatMap((x) => x.mates.map((t) => t.quali_ahead).filter((v) => v != null));
  const withQ3 = log.filter((x) => x.has_q_times && x.season >= 2006);
  m.qualifying = {
    n: qd.length || qh.length,
    score: qd.length >= 4 ? -median(qd) : qh.length ? (qh.filter(Boolean).length / qh.length) * 2 - 1 : null,
    score_basis: qd.length >= 4 ? 'median teammate qualifying gap (%), sign inverted' : 'teammate qualifying head-to-head rate',
    raw: {
      teammate_gap_pct_median: r3(median(qd)),
      teammate_gap_samples: qd.length,
      teammate_h2h: `${qh.filter(Boolean).length}-${qh.filter((v) => v === false).length}`,
      q3_rate: withQ3.length ? r3(withQ3.filter((x) => x.q3).length / withQ3.length) : null,
      pole_rate: log.length ? r3(log.filter((x) => x.pole).length / log.length) : null,
      front_row_rate: log.length ? r3(log.filter((x) => (x.quali_pos || x.grid) && (x.quali_pos || x.grid) <= 2).length / log.length) : null,
    },
  };
  const rh = log.flatMap((x) => x.mates.map((t) => t.race_ahead).filter((v) => v != null));
  const fd = log.flatMap((x) => x.mates.map((t) => t.finish_delta).filter((v) => v != null));
  m.race_result = {
    n: rh.length,
    score: rh.length ? rh.filter(Boolean).length / rh.length : null,
    score_basis: 'share of races finishing ahead of teammate (one-car retirements count for the finisher)',
    raw: { teammate_race_h2h: `${rh.filter(Boolean).length}-${rh.filter((v) => v === false).length}`, avg_finish_delta_when_both_classified: r3(mean(fd)) },
  };
  const ga = log.filter((x) => x.gain_adj != null);
  m.positions_gained = {
    n: ga.length,
    score: ga.length ? mean(ga.map((x) => x.gain_adj)) : null,
    score_basis: 'mean grid-to-finish gain above the expectation for that grid slot (classified finishes)',
    raw: { mean_positions_gained: r3(mean(ga.map((x) => x.gain))), expectation_adjusted: r3(mean(ga.map((x) => x.gain_adj))) },
  };
  const st = log.filter((x) => x.started);
  const mateFin = log.flatMap((x) => x.mates.filter((t) => t.mate_started).map((t) => (t.mate_classified ? 1 : 0)));
  const fr = st.length ? st.filter((x) => x.classified).length / st.length : null;
  m.finishing = {
    n: st.length,
    score: fr != null && mateFin.length ? fr - mean(mateFin) : fr,
    score_basis: 'classification rate minus teammate classification rate (same car); any retirement cause counts',
    raw: { classification_rate: r3(fr), teammate_classification_rate: r3(mean(mateFin)), retirements: st.filter((x) => !x.classified).length },
  };
  const qdStd = std(qd);
  m.consistency = {
    n: qd.length,
    score: qd.length >= 8 ? -qdStd : null,
    score_basis: 'spread (std dev) of teammate qualifying gaps; lower spread ranks higher',
    raw: { teammate_gap_std_pct: r3(qdStd), finish_position_std: r3(std(log.filter((x) => x.classified).map((x) => x.finish))) },
  };
  const share = log.filter((x) => x.team_points > 0);
  const pts = share.reduce((s, x) => s + x.points, 0);
  const tpts = share.reduce((s, x) => s + x.team_points, 0);
  m.scoring = {
    n: share.length,
    score: tpts ? pts / tpts : null,
    score_basis: "share of the team's points in events where the team scored",
    raw: { points: r3(pts), team_points: r3(tpts), points_per_start: st.length ? r3(log.reduce((s, x) => s + x.points, 0) / st.length) : null },
  };
  const allMed = median(qd);
  const subset = (pred) => {
    const v = log.filter(pred).flatMap((x) => x.mates.map((t) => t.quali_delta_pct).filter((y) => y != null));
    return { v, n: v.length, rel: v.length && allMed != null ? -(median(v) - allMed) : null, med: median(v) };
  };
  for (const [key, pred, basis] of [
    ['street', (x) => isStreet(x.circuit_id), 'street layouts'],
    ['high_speed', (x) => speedClass[x.circuit_id] === 'high', 'high pole-lap-speed circuits'],
    ['low_speed', (x) => speedClass[x.circuit_id] === 'low', 'low pole-lap-speed circuits'],
  ]) {
    const s = subset(pred);
    m[key] = {
      n: s.n,
      score: s.rel,
      score_basis: `teammate qualifying gap on ${basis} relative to the driver's overall gap (positive = relatively stronger)`,
      raw: { teammate_gap_pct_median: r3(s.med), overall_gap_pct_median: r3(allMed) },
    };
  }
  return m;
}

function buildDna(windowLogs, label) {
  const metricsBy = {};
  for (const [id, log] of Object.entries(windowLogs)) metricsBy[id] = driverMetrics(log);
  const out = {};
  for (const dim of DRIVER_DIMS) {
    const pop = Object.entries(metricsBy).filter(([, m]) => m[dim.key].score != null && m[dim.key].n >= dim.min);
    const popVals = pop.map(([, m]) => m[dim.key].score);
    for (const [id, m] of Object.entries(metricsBy)) {
      const x = m[dim.key];
      const eligible = x.score != null && x.n >= dim.min;
      ((out[id] ||= { driver_id: id, window: label, dimensions: {} }).dimensions[dim.key] = {
        label: dim.label,
        percentile: eligible ? percentileRank(x.score, popVals) : null,
        sample_size: x.n,
        min_sample: dim.min,
        confidence: eligible ? confidenceOf(x.n) : 'insufficient',
        population: `${pop.length} drivers (${label})`,
        population_size: pop.length,
        basis: x.score_basis,
        raw: x.raw,
      });
    }
  }
  for (const v of Object.values(out)) {
    const pop = Object.values(v.dimensions).filter((d) => d.percentile != null);
    v.populated_dimensions = pop.length;
    v.qualifies = pop.length >= 4;
    v.unavailable = UNAVAILABLE_DRIVER;
    v.version = DNA_VERSION;
    v.as_of = asOf;
  }
  return out;
}

const currentWindowSeasons = [currentSeason - 1, currentSeason];
const currentLogs = {};
const careerLogs = {};
for (const [id, log] of Object.entries(driverLog)) {
  const cur = log.filter((x) => currentWindowSeasons.includes(x.season));
  if (cur.length) currentLogs[id] = cur;
  careerLogs[id] = log;
}
const dnaCurrent = buildDna(currentLogs, `${currentWindowSeasons[0]}–${currentSeason}`);
const dnaCareer = buildDna(careerLogs, 'career, all eras');

// ---------- CONSTRUCTOR DNA (per season) ----------
const UNAVAILABLE_CONSTRUCTOR = {
  race_pace: 'Needs lap times; Race Results dimension uses points instead.',
  tyre_management: 'Needs stint/compound data.',
  pit_crew: 'Only pit stop COUNTS are published by the source; no stop durations.',
  straight_line_speed: 'Needs speed-trap data.',
  corner_speed_classes: 'Needs corner-level telemetry; circuit pole-lap speed classes are used instead.',
  drs_overtaking: 'Needs DRS/overtake events.',
  wet: 'Needs session weather observations.',
  strategy_execution: 'Needs stint and pit timing data.',
};
const CON_DIMS = [
  { key: 'qualifying_speed', label: 'Qualifying Speed', min: 4 },
  { key: 'race_results', label: 'Race Results', min: 4 },
  { key: 'reliability', label: 'Finishing Reliability', min: 6 },
  { key: 'positions_gained', label: 'Race Gains', min: 6 },
  { key: 'high_speed', label: 'High-Speed Circuits', min: 2 },
  { key: 'low_speed', label: 'Low-Speed Circuits', min: 2 },
  { key: 'street', label: 'Street Circuits', min: 2 },
  { key: 'driver_balance', label: 'Driver Pairing Balance', min: 4 },
];
function constructorSeasonMetrics(season) {
  const evs = completedEvents.filter((e) => e.season === season);
  const by = {};
  for (const e of evs) {
    const q = qualiRows(e.id).filter((r) => r.constructor_id);
    const best = Math.min(...q.map(bestQuali));
    const qTeam = groupBy(q, (r) => r.constructor_id);
    for (const [t, rows] of Object.entries(qTeam)) {
      const tb = Math.min(...rows.map(bestQuali));
      if (Number.isFinite(tb) && Number.isFinite(best)) {
        const gap = ((tb - best) / best) * 100;
        if (gap < 7) {
          const x = (by[t] ||= { gaps: [], gapsBy: { high: [], low: [], medium: [], street: [] }, pts: [], starts: 0, fin: 0, gains: [], mateGaps: [] });
          x.gaps.push(gap);
          const sc = speedClass[e.circuit_id];
          if (sc) x.gapsBy[sc].push(gap);
          if (isStreet(e.circuit_id)) x.gapsBy.street.push(gap);
        }
      }
      if (rows.length === 2) {
        const d = qualiPairDelta(rows[0], rows[1]);
        if (d && Math.abs(d.pct) < 5) (by[t] ||= { gaps: [], gapsBy: { high: [], low: [], medium: [], street: [] }, pts: [], starts: 0, fin: 0, gains: [], mateGaps: [] }).mateGaps.push(Math.abs(d.pct));
      }
    }
    const race = raceRows(e.id).filter((r) => r.constructor_id);
    const sprintS = eventSession(e.id, 'sprint');
    const sprint = sprintS ? resultsBySession[sprintS.id] || [] : [];
    for (const [t, rows] of Object.entries(groupBy(race, (r) => r.constructor_id))) {
      const x = (by[t] ||= { gaps: [], gapsBy: { high: [], low: [], medium: [], street: [] }, pts: [], starts: 0, fin: 0, gains: [], mateGaps: [] });
      x.pts.push(rows.reduce((s, r) => s + (r.points || 0), 0));
      for (const r of rows) {
        if (!STARTED(r)) continue;
        x.starts++;
        if (CLASSIFIED(r)) x.fin++;
        if (CLASSIFIED(r) && r.grid && r.position) x.gains.push(r.grid - r.position - (expectedGain[season >= 2010 ? 'modern' : 'classic']?.[r.grid] ?? 0));
      }
    }
  }
  const metrics = {};
  for (const [t, x] of Object.entries(by)) {
    const overall = median(x.gaps);
    const rel = (arr) => (arr.length && overall != null ? -(median(arr) - overall) : null);
    metrics[t] = {
      qualifying_speed: { n: x.gaps.length, score: x.gaps.length ? -median(x.gaps) : null, raw: { median_gap_to_pole_pct: r3(overall) }, basis: "team's best qualifying lap vs session-best lap (median %)" },
      race_results: { n: x.pts.length, score: mean(x.pts), raw: { points_per_weekend: r3(mean(x.pts)), total_points: r3(x.pts.reduce((s, v) => s + v, 0)) }, basis: 'points per race weekend (race + sprint)' },
      reliability: { n: x.starts, score: x.starts ? x.fin / x.starts : null, raw: { classification_rate: r3(x.starts ? x.fin / x.starts : null), car_starts: x.starts, retirements: x.starts - x.fin }, basis: 'share of car starts classified (any retirement cause)' },
      positions_gained: { n: x.gains.length, score: mean(x.gains), raw: { expectation_adjusted_gain: r3(mean(x.gains)) }, basis: 'grid-to-finish gain above grid-slot expectation' },
      high_speed: { n: x.gapsBy.high.length, score: rel(x.gapsBy.high), raw: { median_gap_pct: r3(median(x.gapsBy.high)), overall_gap_pct: r3(overall) }, basis: 'qualifying gap at high pole-lap-speed circuits relative to the team’s overall gap' },
      low_speed: { n: x.gapsBy.low.length, score: rel(x.gapsBy.low), raw: { median_gap_pct: r3(median(x.gapsBy.low)), overall_gap_pct: r3(overall) }, basis: 'qualifying gap at low pole-lap-speed circuits relative to overall' },
      street: { n: x.gapsBy.street.length, score: rel(x.gapsBy.street), raw: { median_gap_pct: r3(median(x.gapsBy.street)), overall_gap_pct: r3(overall) }, basis: 'qualifying gap at street circuits relative to overall' },
      driver_balance: { n: x.mateGaps.length, score: x.mateGaps.length ? -median(x.mateGaps) : null, raw: { median_intra_team_gap_pct: r3(median(x.mateGaps)) }, basis: 'median absolute qualifying gap between the two drivers (driver effect; smaller = more balanced)' },
    };
  }
  const out = {};
  for (const dim of CON_DIMS) {
    const pop = Object.values(metrics).filter((m) => m[dim.key].score != null && m[dim.key].n >= dim.min).map((m) => m[dim.key].score);
    for (const [t, m] of Object.entries(metrics)) {
      const x = m[dim.key];
      const ok = x.score != null && x.n >= dim.min;
      ((out[t] ||= { constructor_id: t, season, dimensions: {}, version: DNA_VERSION, as_of: asOf, unavailable: UNAVAILABLE_CONSTRUCTOR }).dimensions[dim.key] = {
        label: dim.label,
        percentile: ok ? percentileRank(x.score, pop) : null,
        sample_size: x.n,
        min_sample: dim.min,
        confidence: ok ? confidenceOf(x.n, 6, 14) : 'insufficient',
        population: `${pop.length} constructors (${season})`,
        population_size: pop.length,
        basis: x.basis,
        raw: x.raw,
      });
    }
  }
  return out;
}
const constructorDna = {};
for (let y = Math.max(2010, currentSeason - 15); y <= currentSeason; y++) constructorDna[y] = constructorSeasonMetrics(y);

// ---------- CIRCUIT DNA ----------
function spearman(xs, ys) {
  const n = xs.length;
  if (n < 5) return null;
  const rank = (a) => {
    const s = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(n);
    s.forEach(([, i], k) => (r[i] = k + 1));
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const d2 = rx.reduce((s, v, i) => s + (v - ry[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}
const circuitRaces = groupBy(completedEvents.filter((e) => e.circuit_id), (e) => e.circuit_id);
const circuitDnaRaw = {};
for (const c of circuits) {
  const evs = circuitRaces[c.id] || [];
  const recent = evs.filter((e) => e.season >= currentSeason - 10);
  const winners = [];
  let poleWins = 0;
  let poleN = 0;
  let frontRowWins = 0;
  const rhos = [];
  const absMoves = [];
  const attr = [];
  const stops = [];
  const laps = [];
  const dist = [];
  for (const e of evs) {
    const race = raceRows(e.id);
    const w = race.find((r) => CLASSIFIED(r) && r.position === 1);
    if (w) winners.push({ season: e.season, event_id: e.id, driver_id: w.driver_id, constructor_id: w.constructor_id, grid: w.grid });
    const rs = eventSession(e.id, 'race');
    if (rs?.laps_scheduled) laps.push(rs.laps_scheduled);
    if (rs?.distance_km) dist.push(rs.distance_km);
    if (e.season < currentSeason - 10) continue;
    const q = qualiRows(e.id);
    const poleSitter = q.find((r) => r.position === 1)?.driver_id || race.find((r) => r.grid === 1)?.driver_id;
    if (w && poleSitter) {
      poleN++;
      if (poleSitter === w.driver_id) poleWins++;
      if (w.grid && w.grid <= 2) frontRowWins++;
    }
    const cl = race.filter((r) => CLASSIFIED(r) && r.grid && r.position);
    if (cl.length >= 5) {
      rhos.push(spearman(cl.map((r) => r.grid), cl.map((r) => r.position)));
      absMoves.push(mean(cl.map((r) => Math.abs(r.grid - r.position))));
    }
    const st = race.filter(STARTED);
    if (st.length) attr.push(st.filter((r) => !CLASSIFIED(r)).length / st.length);
    const ps = cl.map((r) => r.pit_stops).filter((x) => x != null && x > 0);
    if (ps.length >= 5 && e.season >= 2014) stops.push(mean(ps));
  }
  const winCount = (key) => {
    const m = {};
    for (const w of winners) m[w[key]] = (m[w[key]] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => ({ id, wins: n }));
  };
  const wd = wikidata?.venue_crosswalk?.[c.id];
  const wdc = wd ? wikidata.circuits[wd.wikidata_id] : null;
  circuitDnaRaw[c.id] = {
    circuit_id: c.id,
    races_held: evs.length,
    first_season: evs.length ? Math.min(...evs.map((e) => e.season)) : null,
    last_season: evs.length ? Math.max(...evs.map((e) => e.season)) : null,
    recent_races: recent.length,
    race_laps: laps.length ? laps.at(-1) : null,
    race_distance_km: dist.length ? dist.at(-1) : null,
    lat: wdc?.lat ?? null,
    lon: wdc?.lon ?? null,
    opened: wdc?.opened ?? null,
    wikidata_id: wd?.wikidata_id || null,
    pole_lap_speed_kmh: r3(speedByCircuit[c.id]),
    speed_class: speedClass[c.id] || null,
    pole_win_rate: poleN ? r3(poleWins / poleN) : null,
    front_row_win_rate: poleN ? r3(frontRowWins / poleN) : null,
    grid_finish_rho: r3(median(rhos.filter((x) => x != null))),
    mean_abs_position_change: r3(median(absMoves)),
    attrition_rate: r3(median(attr)),
    stops_per_car: r3(median(stops)),
    sample: { pole_races: poleN, rho_races: rhos.length, attrition_races: attr.length, stop_races: stops.length },
    winners: winners.slice(-10).reverse(),
    top_drivers: winCount('driver_id'),
    top_constructors: winCount('constructor_id'),
  };
}
// Percentiles among circuits with recent data.
const CIRCUIT_DIMS = [
  ['track_position', 'Track Position Importance', (x) => (x.grid_finish_rho != null && x.pole_win_rate != null ? (x.grid_finish_rho + x.pole_win_rate) / 2 : null), 'mean of grid→finish rank correlation and pole conversion (last 10 seasons)', (x) => x.sample.rho_races],
  ['overtaking', 'Overtaking / Position Change', (x) => x.mean_abs_position_change, 'median mean absolute grid-to-finish change of classified cars', (x) => x.sample.rho_races],
  ['high_speed_demand', 'High-Speed Demand', (x) => x.pole_lap_speed_kmh, 'pole-lap average speed (lap length ÷ fastest qualifying lap)', (x) => x.sample.pole_races],
  ['low_speed_demand', 'Low-Speed Demand', (x) => (x.pole_lap_speed_kmh ? -x.pole_lap_speed_kmh : null), 'inverse of pole-lap average speed', (x) => x.sample.pole_races],
  ['attrition', 'Attrition', (x) => x.attrition_rate, 'median share of starters not classified (any cause; safety-car data unavailable)', (x) => x.sample.attrition_races],
  ['pit_load', 'Observed Pit Stops', (x) => x.stops_per_car, 'median pit stops per classified car (2014+; observed counts, not a tyre model)', (x) => x.sample.stop_races],
];
const UNAVAILABLE_CIRCUIT = {
  straight_line_demand: 'Needs speed-trap or full-throttle data.',
  braking_demand: 'Needs braking telemetry.',
  medium_speed_demand: 'Needs corner-speed telemetry.',
  tyre_stress: 'Needs Pirelli/tyre data; observed pit stops shown instead.',
  safety_car_volatility: 'Needs race-control (safety car) events; attrition shown instead.',
  weather_volatility: 'Needs historical weather observations.',
  drs_zones: 'No licensed source for DRS zone definitions.',
  elevation_change: 'Not sourced.',
  direction: 'Not sourced.',
};
const circuitDna = {};
for (const [key, label, fn, basis, nfn] of CIRCUIT_DIMS) {
  const vals = Object.values(circuitDnaRaw).filter((x) => x.recent_races >= 2 && fn(x) != null).map(fn);
  for (const x of Object.values(circuitDnaRaw)) {
    const v = fn(x);
    const ok = x.recent_races >= 2 && v != null;
    ((circuitDna[x.circuit_id] ||= { ...x, dimensions: {}, unavailable: UNAVAILABLE_CIRCUIT, version: DNA_VERSION, as_of: asOf }).dimensions[key] = {
      label,
      percentile: ok ? percentileRank(v, vals) : null,
      value: r3(v),
      sample_size: nfn(x),
      confidence: ok ? confidenceOf(nfn(x), 3, 7) : 'insufficient',
      population: `${vals.length} circuits with ≥2 races in the last 10 seasons`,
      basis,
    });
  }
}
for (const c of Object.values(circuitDna)) c.street = isStreet(c.circuit_id);

// ---------- CIRCUIT FIT (upcoming + recent events of current season) ----------
const currentGrid = (() => {
  const last = completedEvents.filter((e) => e.season === currentSeason).at(-1);
  return last ? raceRows(last.id).map((r) => ({ driver_id: r.driver_id, constructor_id: r.constructor_id })) : [];
})();
const conCur = constructorDna[currentSeason] || {};
function fitFor(event) {
  const cd = circuitDna[event.circuit_id];
  if (!cd) return null;
  const out = [];
  for (const { driver_id, constructor_id } of currentGrid) {
    const dna = dnaCurrent[driver_id]?.dimensions || {};
    const con = conCur[constructor_id]?.dimensions || {};
    const comps = [];
    const add = (key, label, pct, weight, why, conf) => {
      if (pct == null || weight <= 0) return;
      comps.push({ key, label, percentile: pct, weight: r3(weight), why, confidence: conf });
    };
    const tp = cd.dimensions.track_position?.percentile;
    if (tp != null) add('qualifying_x_track_position', 'Qualifying × track position', dna.qualifying?.percentile, 0.5 + tp / 100, `Track position importance ${tp}th pct`, dna.qualifying?.confidence);
    const ov = cd.dimensions.overtaking?.percentile;
    if (ov != null) add('gains_x_overtaking', 'Race gains × overtaking', dna.positions_gained?.percentile, 0.3 + ov / 100, `Position-change circuit ${ov}th pct`, dna.positions_gained?.confidence);
    if (cd.street) add('street', 'Street-circuit form', dna.street?.percentile, 1, 'Street layout', dna.street?.confidence);
    if (cd.speed_class === 'high') {
      add('driver_high_speed', 'Driver at high-speed circuits', dna.high_speed?.percentile, 0.8, 'High pole-lap speed', dna.high_speed?.confidence);
      add('car_high_speed', 'Car at high-speed circuits', con.high_speed?.percentile, 1, 'High pole-lap speed', con.high_speed?.confidence);
    }
    if (cd.speed_class === 'low') {
      add('driver_low_speed', 'Driver at low-speed circuits', dna.low_speed?.percentile, 0.8, 'Low pole-lap speed', dna.low_speed?.confidence);
      add('car_low_speed', 'Car at low-speed circuits', con.low_speed?.percentile, 1, 'Low pole-lap speed', con.low_speed?.confidence);
    }
    add('car_qualifying', 'Car qualifying speed (season)', con.qualifying_speed?.percentile, 1.2, `${currentSeason} constructor form`, con.qualifying_speed?.confidence);
    const hist = (driverLog[driver_id] || []).filter((x) => x.circuit_id === event.circuit_id && x.start !== false);
    const histDeltas = hist.flatMap((x) => x.mates.map((t) => t.finish_delta).filter((v) => v != null));
    if (!comps.length) continue;
    const wsum = comps.reduce((s, c) => s + c.weight, 0);
    const score = Math.round(comps.reduce((s, c) => s + c.percentile * c.weight, 0) / wsum);
    const sorted = [...comps].sort((a, b) => b.percentile - a.percentile);
    const confs = comps.map((c) => c.confidence);
    out.push({
      driver_id,
      constructor_id,
      fit_score: score,
      components: comps,
      strongest: sorted.slice(0, 2).map((c) => c.key),
      weakest: sorted.slice(-2).reverse().map((c) => c.key),
      confidence: comps.length >= 4 && !confs.includes('insufficient') && confs.filter((c) => c === 'low').length <= 1 ? (confs.filter((c) => c === 'high').length >= 2 ? 'high' : 'medium') : 'low',
      circuit_history: { starts: hist.length, best_finish: hist.filter((x) => x.classified).reduce((m, x) => Math.min(m, x.finish), 99) === 99 ? null : hist.filter((x) => x.classified).reduce((m, x) => Math.min(m, x.finish), 99), avg_finish_vs_teammate: r3(mean(histDeltas)) },
    });
  }
  out.sort((a, b) => b.fit_score - a.fit_score);
  return { event_id: event.id, circuit_id: event.circuit_id, version: DNA_VERSION, as_of: asOf, disclaimer: 'Descriptive fit of current Driver/Constructor DNA to this circuit’s profile. Not a prediction or betting signal.', drivers: out };
}
const circuitFit = {};
for (const e of events.filter((x) => x.season === currentSeason && x.status !== 'canceled')) {
  const f = fitFor(e);
  if (f) circuitFit[e.id] = f;
}

// ---------- TEAMMATE BATTLES ----------
function battle(a, b, filterFn) {
  const la = (driverLog[a] || []).filter(filterFn);
  const rows = [];
  for (const x of la) {
    const m = x.mates.find((t) => t.driver_id === b);
    if (!m) continue;
    const y = (driverLog[b] || []).find((r) => r.event_id === x.event_id);
    rows.push({ event_id: x.event_id, season: x.season, round: x.round, a: x, b: y, m });
  }
  return rows;
}
function summarize(rows, a, b) {
  const s = (side) => {
    const xs = rows.map((r) => r[side]).filter(Boolean);
    const cls = xs.filter((x) => x.classified);
    return {
      points: r3(xs.reduce((t, x) => t + x.points, 0)),
      wins: cls.filter((x) => x.finish === 1).length,
      podiums: cls.filter((x) => x.finish <= 3).length,
      poles: xs.filter((x) => x.pole).length,
      dnfs: xs.filter((x) => x.started && !x.classified).length,
      fastest_laps: xs.filter((x) => x.fastest_lap).length,
      avg_finish: r3(mean(cls.map((x) => x.finish))),
      avg_grid: r3(mean(xs.filter((x) => x.grid).map((x) => x.grid))),
      positions_gained: r3(mean(xs.filter((x) => x.gain != null).map((x) => x.gain))),
      q3_appearances: xs.filter((x) => x.q3).length,
      // sample sizes behind the averages (the UI shows them beside every average)
      n_finish: cls.length,
      n_grid: xs.filter((x) => x.grid).length,
      n_gain: xs.filter((x) => x.gain != null).length,
    };
  };
  // H2H semantics (every count carries its denominator; the UI never recomputes them):
  //   qualifying = official qualifying classification where both have one; grid only as a separately labelled fallback
  //   race       = only races where BOTH were classified (a retirement never hands the other driver an H2H win)
  //   sprint     = only sprint sessions where both have a sprint classification
  const qa = rows.map((r) => r.m.quali_cls_ahead).filter((v) => v != null);
  const ga = rows.map((r) => r.m.grid_ahead).filter((v) => v != null);
  const rc = rows.filter((r) => r.m.both_classified && Number.isFinite(r.m.finish_delta) && r.m.finish_delta !== 0); // distinct classified positions decide
  const qd = rows.map((r) => r.m.quali_delta_pct).filter((v) => v != null);
  const sp = rows.filter((r) => r.a.sprint_pos && r.b?.sprint_pos);
  return {
    events: rows.length,
    quali_h2h: [qa.filter(Boolean).length, qa.filter((v) => v === false).length],
    quali_comparable: qa.length,
    grid_fallback_h2h: [ga.filter(Boolean).length, ga.filter((v) => v === false).length],
    grid_fallback_events: ga.length,
    race_h2h: [rc.filter((r) => r.m.finish_delta > 0).length, rc.filter((r) => r.m.finish_delta < 0).length],
    race_comparable: rc.length,
    race_excluded: rows.length - rc.length,
    sprint_h2h: [sp.filter((r) => r.a.sprint_pos < r.b.sprint_pos).length, sp.filter((r) => r.a.sprint_pos > r.b.sprint_pos).length],
    sprint_comparable: sp.length,
    quali_gap_pct_median: r3(median(qd)),
    quali_gap_samples: qd.length,
    a: s('a'),
    b: s('b'),
  };
}
const pairs = {};
for (const [a, log] of Object.entries(driverLog)) {
  for (const x of log) {
    for (const m of x.mates) {
      if (a > m.driver_id) continue;
      const k = `${a}|${m.driver_id}`;
      const p = (pairs[k] ||= { a, b: m.driver_id, seasons: new Set(), constructors: new Set() });
      p.seasons.add(x.season);
      p.constructors.add(x.constructor_id);
    }
  }
}
const teammates = [];
for (const p of Object.values(pairs)) {
  const all = battle(p.a, p.b, () => true);
  if (!all.length) continue;
  const bySeason = {};
  for (const y of p.seasons) bySeason[y] = summarize(all.filter((r) => r.season === y), p.a, p.b);
  teammates.push({
    a: p.a,
    b: p.b,
    constructors: [...p.constructors],
    seasons: [...p.seasons].sort(),
    career: summarize(all, p.a, p.b),
    last5: summarize(all.slice(-5), p.a, p.b),
    last10: summarize(all.slice(-10), p.a, p.b),
    by_season: bySeason,
    // same pair under more than one constructor: one summary per constructor
    by_constructor: Object.fromEntries([...p.constructors].map((c) => [c, summarize(all.filter((r) => r.a.constructor_id === c), p.a, p.b)])),
    log: all.slice(-30).map((r) => ({
      event_id: r.event_id,
      constructor_id: r.a.constructor_id,
      a_quali: r.a.quali_pos,
      b_quali: r.b?.quali_pos ?? null,
      a_grid: r.a.grid || null,
      b_grid: r.b?.grid || null,
      both_classified: r.m.both_classified,
      a_finish: r.a.classified ? r.a.finish : null,
      b_finish: r.b?.classified ? r.b.finish : null,
      a_status: r.a.status,
      b_status: r.b?.status ?? null,
      gap_pct: r3(r.m.quali_delta_pct),
      a_points: r.a.points,
      b_points: r.b?.points ?? 0,
    })),
  });
}

// ---------- GENERAL MATCHUPS (any two drivers who raced together) ----------
function matchup(a, b) {
  const lb = Object.fromEntries((driverLog[b] || []).map((x) => [x.event_id, x]));
  const shared = (driverLog[a] || []).filter((x) => lb[x.event_id]).map((x) => ({ a: x, b: lb[x.event_id] }));
  // SHARED GRID HISTORY: every event both started a race weekend in, whatever their cars. Different machinery, so it is
  // never presented as a same-car comparison; the same-team subset is counted separately (same_team_events).
  const both = shared.filter((s) => s.a.classified && s.b.classified && Number.isInteger(s.a.finish) && Number.isInteger(s.b.finish) && s.a.finish !== s.b.finish);
  const qCls = shared.filter((s) => s.a.quali_pos && s.b.quali_pos);
  const qGrid = shared.filter((s) => !(s.a.quali_pos && s.b.quali_pos) && s.a.grid > 0 && s.b.grid > 0);
  const side = (pick) => [pick(shared.map((s) => s.a)), pick(shared.map((s) => s.b))];
  const seasons = [...new Set(shared.map((s) => s.a.season))];
  const resOf = (x) => ({ constructor_id: x.constructor_id, quali: x.quali_pos || null, grid: x.grid || null, finish: x.classified ? x.finish : null, status: x.status, classified: x.classified, points: x.points });
  return {
    shared_events: shared.length,
    same_team_events: shared.filter((s) => s.a.constructor_id && s.a.constructor_id === s.b.constructor_id).length,
    race_comparable_events: both.length,
    race_excluded_events: shared.length - both.length,
    race_ahead: [both.filter((s) => s.a.finish < s.b.finish).length, both.filter((s) => s.a.finish > s.b.finish).length],
    quali_comparable_events: qCls.length,
    quali_ahead: [qCls.filter((s) => s.a.quali_pos < s.b.quali_pos).length, qCls.filter((s) => s.a.quali_pos > s.b.quali_pos).length],
    grid_fallback_events: qGrid.length,
    grid_ahead: [qGrid.filter((s) => s.a.grid < s.b.grid).length, qGrid.filter((s) => s.a.grid > s.b.grid).length],
    quali_unavailable_events: shared.length - qCls.length - qGrid.length,
    points: [r3(shared.reduce((t, s) => t + s.a.points, 0)), r3(shared.reduce((t, s) => t + s.b.points, 0))],
    wins: [shared.filter((s) => s.a.classified && s.a.finish === 1).length, shared.filter((s) => s.b.classified && s.b.finish === 1).length],
    podiums: [shared.filter((s) => s.a.classified && s.a.finish <= 3).length, shared.filter((s) => s.b.classified && s.b.finish <= 3).length],
    dnfs: side((xs) => xs.filter((x) => x.started && !x.classified).length),
    first_season: shared.length ? shared[0].a.season : null,
    last_season: shared.length ? shared.at(-1).a.season : null,
    by_season: Object.fromEntries(seasons.map((y) => {
      const ss = shared.filter((s) => s.a.season === y), bb = ss.filter((s) => s.a.classified && s.b.classified), qq = ss.filter((s) => s.a.quali_pos && s.b.quali_pos);
      return [y, { events: ss.length, same_team: ss.filter((s) => s.a.constructor_id === s.b.constructor_id).length, race_ahead: [bb.filter((s) => s.a.finish < s.b.finish).length, bb.filter((s) => s.a.finish > s.b.finish).length], race_comparable: bb.length, quali_ahead: [qq.filter((s) => s.a.quali_pos < s.b.quali_pos).length, qq.filter((s) => s.a.quali_pos > s.b.quali_pos).length], quali_comparable: qq.length, points: [r3(ss.reduce((t, s) => t + s.a.points, 0)), r3(ss.reduce((t, s) => t + s.b.points, 0))] }];
    })),
    recent: shared.slice(-10).reverse().map((s) => ({ event_id: s.a.event_id, a: resOf(s.a), b: resOf(s.b), same_team: s.a.constructor_id === s.b.constructor_id, ahead: s.a.classified && s.b.classified ? (s.a.finish < s.b.finish ? 'a' : 'b') : null })),
  };
}
const matchupPairs = new Set();
const gridIds = currentGrid.map((g) => g.driver_id);
for (let i = 0; i < gridIds.length; i++) for (let j = i + 1; j < gridIds.length; j++) matchupPairs.add([gridIds[i], gridIds[j]].sort().join('|'));
for (const t of teammates) if (t.seasons.at(-1) >= 2000) matchupPairs.add([t.a, t.b].sort().join('|'));
const matchups = {};
for (const k of matchupPairs) {
  const [a, b] = k.split('|');
  const m = matchup(a, b);
  if (m.shared_events) matchups[k] = { a, b, ...m };
}

// ---------- CHAMPIONSHIP PROGRESSION ----------
const progression = {};
const officialBy = groupBy(standings, (s) => `${s.season}|${s.kind}`);
for (const season of [...new Set(completedEvents.map((e) => e.season))]) {
  const evs = completedEvents.filter((e) => e.season === season);
  const dPts = {};
  const cPts = {};
  const dFin = {}; // Grand Prix finishing positions (countback)
  const cFin = {};
  const rounds = [];
  for (const e of evs) {
    const rows = raceRows(e.id); // race-row points already include sprint points
    for (const r of rows) {
      dPts[r.driver_id] = (dPts[r.driver_id] || 0) + (r.points || 0);
      if (r.constructor_id) cPts[r.constructor_id] = (cPts[r.constructor_id] || 0) + (r.points || 0);
      if (r.session_type === 'race' && CLASSIFIED(r) && Number.isInteger(r.position)) {
        (dFin[r.driver_id] ??= []).push(r.position);
        if (r.constructor_id) (cFin[r.constructor_id] ??= []).push(r.position);
      }
    }
    rounds.push({ event_id: e.id, round: e.round, drivers: Object.fromEntries(rankWithCountback(dPts, dFin)), constructors: Object.fromEntries(rankWithCountback(cPts, cFin)) });
  }
  const official = officialBy[`${season}|driver`] || [];
  const last = rounds.at(-1);
  const mismatches = official.filter((o) => o.subject_id && last?.drivers[o.subject_id] && Math.abs(last.drivers[o.subject_id].p - o.points) > 0.01).length;
  // position reconciliation (both tables): rows whose computed last-round position differs from the official one
  const posMismatch = ['driver', 'constructor'].flatMap((k) => (officialBy[`${season}|${k}`] || []).filter((o) => o.subject_id && last?.[k === 'driver' ? 'drivers' : 'constructors'][o.subject_id] && last[k === 'driver' ? 'drivers' : 'constructors'][o.subject_id].pos !== o.position).map((o) => `${k}:${o.subject_id}`));
  progression[season] = {
    season,
    rounds,
    matches_official: official.length ? mismatches === 0 : null,
    official_mismatches: mismatches,
    position_mismatches: posMismatch,
    note: mismatches ? 'Race-by-race sums differ from the official table (dropped scores or source corrections); official standings are authoritative.' : null,
  };
}

// ---------- write ----------
const w = (n, d) => fs.writeFileSync(path.join(OUT, n + '.json'), JSON.stringify(d));
w('careers', careers);
w('driver_dna_current', dnaCurrent);
w('driver_dna_career', dnaCareer);
w('constructor_dna', constructorDna);
w('circuit_dna', circuitDna);
w('circuit_fit', circuitFit);
w('teammates', teammates);
w('matchups', matchups);
w('progression', progression);
w('driver_log', driverLog);
w('meta', { version: DNA_VERSION, as_of: asOf, current_season: currentSeason, speed_by_circuit: speedByCircuit, speed_class: speedClass, expected_gain: expectedGain, current_grid: currentGrid });

const dq = Object.values(dnaCurrent).filter((d) => d.qualifies);
const dqc = Object.values(dnaCareer).filter((d) => d.qualifies);
const report = {
  version: DNA_VERSION,
  as_of: asOf,
  driver_dna_current_qualifying: dq.length,
  driver_dna_current_avg_populated: r3(mean(dq.map((d) => d.populated_dimensions))),
  driver_dna_career_qualifying: dqc.length,
  driver_dna_career_avg_populated: r3(mean(dqc.map((d) => d.populated_dimensions))),
  driver_dna_dimensions_defined: DRIVER_DIMS.length,
  driver_dna_dimensions_unavailable: Object.keys(UNAVAILABLE_DRIVER).length,
  constructor_dna_seasons: Object.keys(constructorDna).length,
  constructor_dna_current_teams: Object.keys(constructorDna[currentSeason] || {}).length,
  circuit_dna_circuits: Object.keys(circuitDna).length,
  circuit_dna_with_recent_profile: Object.values(circuitDna).filter((c) => c.recent_races >= 2).length,
  circuit_fit_events: Object.keys(circuitFit).length,
  circuit_fit_driver_rows: Object.values(circuitFit).reduce((s, f) => s + f.drivers.length, 0),
  teammate_pairs: teammates.length,
  matchups: Object.keys(matchups).length,
  progression_seasons: Object.keys(progression).length,
  progression_matching_official: Object.values(progression).filter((p) => p.matches_official).length,
};
w('dna_report', report);
console.log(JSON.stringify(report, null, 1));
