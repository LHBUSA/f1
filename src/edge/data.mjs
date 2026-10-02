// PBE F1 EDGE data layer: loads the normalized ESPN graph (source rows) and builds a time-indexed view.
//
// Time safety: every source session carries `t` (session start, ms). Feature code may only read sessions through
// `prefixBefore(idx, cutoff)`, which returns sessions with t < cutoff. Nothing here reads end-of-season standings,
// derived DNA, Circuit Fit or any other aggregate that was built with today's data.
import fs from 'node:fs';
import path from 'node:path';

// Static reference metadata only (circuit identity, layout type, lap length). Outcome-derived files are forbidden.
export const ALLOWED_INPUTS = Object.freeze({
  normalized: ['events', 'sessions', 'classifications', 'constructors'],
  derived: ['circuits', 'event_circuits'],
});
export const FORBIDDEN_INPUTS = Object.freeze([
  'standings', 'progression', 'driver_dna_current', 'driver_dna_career', 'constructor_dna', 'circuit_dna',
  'circuit_fit', 'teammates', 'matchups', 'careers', 'driver_log', 'dna_report',
]);

const STARTED_STATUSES = new Set(['classified', 'retired', 'disqualified', 'not_classified', 'in_pit']);

export function loadRaw(root = 'data') {
  const rd = (dir, n) => JSON.parse(fs.readFileSync(path.resolve(root, dir, n + '.json'), 'utf8'));
  const raw = {};
  for (const n of ALLOWED_INPUTS.normalized) raw[n] = rd('normalized', n);
  for (const n of ALLOWED_INPUTS.derived) raw['derived_' + n] = rd('derived', n);
  return raw;
}

const ms = (iso) => Date.parse(iso && iso.length === 17 ? iso.replace('Z', ':00Z') : iso);

/** Race finishing order key: lower is better. Positioned cars by position; unpositioned by laps; DSQ last. */
export function raceOrderKey(r) {
  if (r.status === 'disqualified') return 9000;
  if (r.position != null) return r.position;
  return 5000 - (r.laps || 0);
}

export function buildIndex(raw, { minSeason = 2000 } = {}) {
  const lineage = Object.fromEntries(raw.constructors.map((c) => [c.id, c.lineage_id || c.id]));
  const circuitMeta = Object.fromEntries(raw.derived_circuits.map((c) => [c.id, { street: /street/i.test(c.layout_type || ''), length_km: c.length_km || null, name: c.name }]));
  const evCircuit = raw.derived_event_circuits;
  const sessionsByEvent = new Map();
  for (const s of raw.sessions) {
    if (!sessionsByEvent.has(s.event_id)) sessionsByEvent.set(s.event_id, []);
    sessionsByEvent.get(s.event_id).push(s);
  }
  const rowsBySession = new Map();
  for (const r of raw.classifications) {
    if (r.session_type !== 'qualifying' && r.session_type !== 'race') continue;
    if (r.season < minSeason) continue;
    if (!rowsBySession.has(r.session_id)) rowsBySession.set(r.session_id, []);
    rowsBySession.get(r.session_id).push(r);
  }
  const events = new Map();
  for (const e of raw.events) {
    if (e.season < minSeason) continue;
    const ss = sessionsByEvent.get(e.id) || [];
    const starts = [ms(e.start_utc), ...ss.map((s) => ms(s.start_utc))].filter(Number.isFinite);
    const start = Math.min(...starts);
    const byType = {};
    for (const s of ss) byType[s.type] = s;
    events.set(e.id, {
      id: e.id, season: e.season, round: e.round, name: e.name, status: e.status,
      circuit_id: evCircuit[e.id]?.circuit_id || null,
      start_ms: start, start_iso: new Date(start).toISOString(),
      quali_session_id: byType.qualifying?.id || null, race_session_id: byType.race?.id || null,
      race_start_ms: byType.race ? ms(byType.race.start_utc) : null,
    });
  }
  const sessions = [];
  for (const s of raw.sessions) {
    if (s.type !== 'qualifying' && s.type !== 'race') continue;
    const ev = events.get(s.event_id);
    if (!ev || ev.status !== 'completed' || !ev.round) continue;
    const rows = (rowsBySession.get(s.id) || []).filter((r) => r.driver_id);
    if (!rows.length) continue;
    const norm = rows.map((r) => {
      const base = { d: r.driver_id, c: r.constructor_id || null, L: r.constructor_id ? lineage[r.constructor_id] || r.constructor_id : null };
      if (s.type === 'qualifying') return { ...base, pos: r.position ?? null, q1: r.q1_ms || null, q2: r.q2_ms || null, q3: r.q3_ms || null, best: r.best_lap_ms || null };
      const participant = r.race_participant !== false && r.status !== 'practice_only';
      const started = participant && (STARTED_STATUSES.has(r.status) || (r.status == null && (r.laps || 0) > 0));
      return { ...base, pos: r.position ?? null, grid: r.grid ?? null, status: r.status, laps: r.laps || 0, points: r.points || 0, participant, started, classified: r.status === 'classified', key: raceOrderKey(r) };
    }).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    sessions.push({ id: s.id, event_id: s.event_id, season: s.season, type: s.type, t: ms(s.start_utc), circuit_id: ev.circuit_id, rows: norm });
  }
  sessions.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  for (const s of sessions) s.facts = sessionFacts(s);
  return { events, sessions, lineage, circuitMeta, sessionById: new Map(sessions.map((s) => [s.id, s])) };
}

/** Deepest knockout session both drivers set a time in (same rule as scripts/derive.mjs qualiPairDelta). */
export function qualiPairDelta(a, b) {
  for (const k of ['q3', 'q2', 'q1', 'best']) if (a[k] && b[k]) return { pct: ((a[k] - b[k]) / b[k]) * 100, stage: k };
  return null;
}
const bestQuali = (r) => Math.min(...['q1', 'q2', 'q3', 'best'].map((k) => r[k] || Infinity));

/**
 * Per-session facts that depend only on that session's own rows (so they are time-safe whenever the session is).
 * quali: teammate gaps (deepest common knockout stage, |gap|<5%), teammate head-to-head, team-best gap to pole,
 * field percentile; race: teammate race head-to-head (derive.mjs rule), classification, gains, points, positions.
 */
function sessionFacts(s) {
  const f = { tmGap: new Map(), tmAhead: new Map(), teamPole: new Map(), pctl: new Map(), poleMs: null };
  const byTeam = new Map();
  for (const r of s.rows) if (r.c) (byTeam.get(r.c) || byTeam.set(r.c, []).get(r.c)).push(r);
  if (s.type === 'qualifying') {
    const ranked = s.rows.filter((r) => r.pos != null);
    const n = ranked.length;
    for (const r of ranked) f.pctl.set(r.d, n > 1 ? 1 - (r.pos - 1) / (n - 1) : 0.5);
    const best = Math.min(...s.rows.map(bestQuali));
    f.poleMs = Number.isFinite(best) ? best : null;
    for (const [c, rows] of byTeam) {
      const tb = Math.min(...rows.map(bestQuali));
      if (Number.isFinite(tb) && f.poleMs) {
        const g = ((tb - f.poleMs) / f.poleMs) * 100;
        if (g < 7) f.teamPole.set(rows[0].L, g);
      }
      if (rows.length !== 2) continue;
      const [a, b] = rows;
      const d = qualiPairDelta(a, b);
      if (d && Math.abs(d.pct) < 5) {
        f.tmGap.set(a.d, { g: d.pct, mate: b.d, stage: d.stage });
        f.tmGap.set(b.d, { g: -d.pct, mate: a.d, stage: d.stage });
      }
      if (a.pos != null && b.pos != null) {
        f.tmAhead.set(a.d, a.pos < b.pos ? 1 : -1);
        f.tmAhead.set(b.d, b.pos < a.pos ? 1 : -1);
      }
    }
  } else {
    const st = s.rows.filter((r) => r.started);
    for (const [, rows] of byTeam) {
      if (rows.length !== 2) continue;
      const [a, b] = rows;
      const ahead = (r, m) => (r.classified && m.classified ? r.pos < m.pos : r.classified && !m.classified && m.started ? true : !r.classified && m.classified && r.started ? false : null);
      const x = ahead(a, b);
      if (x != null) {
        f.tmAhead.set(a.d, x ? 1 : -1);
        f.tmAhead.set(b.d, x ? -1 : 1);
      }
    }
    f.started = st.map((r) => ({ d: r.d, L: r.L, classified: r.classified, grid: r.grid, pos: r.pos, points: r.points, gain: r.classified && r.grid && r.pos ? r.grid - r.pos : null }));
    f.points = s.rows.filter((r) => r.participant).map((r) => ({ d: r.d, points: r.points, pos: r.classified ? r.pos : null }));
  }
  return f;
}

/** Sessions strictly before `cutoff` (ms). This is the ONLY accessor feature code uses. */
export function prefixBefore(idx, cutoff) {
  let lo = 0;
  let hi = idx.sessions.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (idx.sessions[m].t < cutoff) lo = m + 1;
    else hi = m;
  }
  return idx.sessions.slice(0, lo);
}

/** Truncated raw copy: drop every session/classification at or after `cutoff` (used by the leakage audit). */
export function truncateRaw(raw, cutoff) {
  const keepSess = new Set(raw.sessions.filter((s) => ms(s.start_utc) < cutoff).map((s) => s.id));
  return {
    ...raw,
    sessions: raw.sessions.filter((s) => keepSess.has(s.id)),
    classifications: raw.classifications.filter((r) => keepSess.has(r.session_id)),
  };
}
