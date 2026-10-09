// F1 Race Picks model (pure; runs in Node scripts AND in the f1-api Worker).
//
// Rating-based Plackett-Luce finishing-order model with a per-car reliability (DNF) layer and a Monte Carlo
// race simulation, so winner, podium, top-10 and teammate probabilities all come from ONE coherent order model.
//
//   car (lineage) ratings  : exponentially weighted qualifying and race pace, in normal-score units
//   driver deltas          : exponentially weighted pace vs the teammate in the same car, shrunk toward 0
//   reliability            : exponentially weighted car retirement rate, shrunk to the field rate
//   circuit residual       : (tested, see docs/picks/PROTOCOL.md) driver race residual at this circuit
//   post-qualifying version: adds the official qualifying classification as a feature
//
// Time safety: predictEvent() reads the state BEFORE observeEvent() adds that event. The walk-forward evaluation
// and the Worker lock path both replay events strictly in start-time order and lock before the session.
import { LINEAGES } from '../core/constructors.mjs';

export const MODEL_ID = 'f1-picks';
export const MODEL_VERSION = 'f1-picks-1.0.0';

// Frozen after tuning on 2014-2019 (docs/picks/PROTOCOL.md). Changing any value = a new MODEL_VERSION.
export const PARAMS = Object.freeze({
  aCar: 0.25, // car rating learning rate per event
  carry: 0.85, // car rating carried across a season boundary (rest shrinks to the field mean)
  newCar: -0.7, // prior for a car (lineage) never seen before
  lD: 0.97, // driver delta decay per observation
  kD: 2, // driver delta shrinkage (pseudo-observations at 0)
  mixR: 0.7, // race pace = mixR * race rating + (1 - mixR) * qualifying rating
  wDq: 1, // driver delta weight (qualifying)
  wDr: 0.6, // driver delta weight (race)
  wC: 0.5, // circuit residual weight (0 = circuit history not used)
  kC: 10, // circuit residual shrinkage
  lR: 0.99, // reliability decay per car-start
  kR: 10, // reliability shrinkage to the field rate
  betaQ: 1.5, // Plackett-Luce scale, qualifying
  betaR: 2, // Plackett-Luce scale, race (pre-qualifying)
  betaRP: 1.2, // Plackett-Luce scale, race (post-qualifying)
  wGrid: 0.8, // post-qualifying: weight of the qualifying-classification normal score
  otherMass: 0.002, // winner mass reserved for an entrant outside the locked field
});

// ---------- numerics ----------
// Acklam inverse normal CDF (|rel err| < 1.2e-9)
export function qnorm(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
/** Normal score of finishing position pos (1 = best) in a field of n: higher = better. */
export const rankScore = (pos, n) => qnorm((n - Math.min(Math.max(pos, 1), n) + 0.5) / n);
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));

export function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
export function seedOf(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// ---------- identity ----------
const LINEAGE_BY_MEMBER = Object.fromEntries(Object.entries(LINEAGES).flatMap(([lin, l]) => l.members.map((m) => [m[0], lin])));
/** Car identity used for ratings: the franchise lineage (Toro Rosso → Racing Bulls, Sauber → Audi …). */
export const carKey = (constructorId) => (constructorId ? LINEAGE_BY_MEMBER[constructorId] || constructorId : null);

// ---------- contract helpers ----------
const STARTED_STATUSES = new Set(['classified', 'retired', 'disqualified', 'not_classified', 'in_pit']);
/** A race entrant who actually took the start. DNS / practice-only / withdrawn never started. */
export const raceStarted = (r) => !!r && r.status !== 'did_not_start' && r.status !== 'practice_only' && (STARTED_STATUSES.has(r.status) || (r.status == null && (r.laps || 0) > 0));
export const raceClassified = (r) => !!r && r.status === 'classified' && Number.isInteger(r.pos);

// ---------- state ----------
export function newState() {
  return { season: null, car: {}, drv: {}, rel: {}, relG: { n: 0, d: 0 }, circ: {}, events: 0, last_event: null };
}
const carOf = (st, k, P) => (st.car[k] ||= { q: P.newCar, r: P.newCar, sq: false, sr: false });
const drvOf = (st, d) => (st.drv[d] ||= { qn: 0, qd: 0, rn: 0, rd: 0 });

function rollSeason(st, season, P) {
  if (st.season != null && season !== st.season) for (const c of Object.values(st.car)) { c.q *= P.carry; c.r *= P.carry; }
  st.season = season;
}

const groupBy = (rows, fn) => rows.reduce((m, r) => ((m[fn(r)] ||= []).push(r), m), {});

/** Strength terms for one entrant from the current (pre-event) state. */
export function strengths(st, e, P = PARAMS, circuitId = null) {
  const c = st.car[e.car] || { q: P.newCar, r: P.newCar };
  const d = st.drv[e.driver] || { qn: 0, qd: 0, rn: 0, rd: 0 };
  const dq = d.qn / (d.qd + P.kD);
  const dr = d.rn / (d.rd + P.kD);
  const ci = circuitId ? st.circ[`${e.driver}|${circuitId}`] : null;
  const circ = ci ? ci.n / (ci.d + P.kC) : 0;
  const quali = c.q + P.wDq * dq;
  const race = P.mixR * c.r + (1 - P.mixR) * c.q + P.wDr * dr + P.wC * circ;
  return { quali, race, car_q: c.q, car_r: c.r, drv_q: dq, drv_r: dr, circ };
}
export function dnfProb(st, car, P = PARAMS) {
  const g = st.relG.d > 0 ? st.relG.n / st.relG.d : 0.15;
  const r = st.rel[car] || { n: 0, d: 0 };
  return (r.n + P.kR * g) / (r.d + P.kR);
}

/** Add one completed event to the state (call AFTER predicting it). ev = canonical event (see toCanonical*). */
export function observeEvent(st, ev, P = PARAMS) {
  rollSeason(st, ev.season, P);
  // pre-update race strengths for the circuit residual
  const pre = Object.fromEntries((ev.race || []).filter((r) => r.car).map((r) => [r.driver, strengths(st, r, P, null).race]));
  // qualifying classification
  const q = (ev.quali || []).filter((r) => Number.isInteger(r.pos) && r.car);
  if (q.length >= 4) {
    const n = q.length;
    [...q].sort((a, b) => a.pos - b.pos).forEach((r, i) => { r._u = rankScore(i + 1, n); });
    for (const [k, rows] of Object.entries(groupBy(q, (r) => r.car))) {
      const m = rows.reduce((s, r) => s + r._u, 0) / rows.length;
      const c = carOf(st, k, P);
      if (!c.sq) { c.q = m; c.sq = true; } else c.q += P.aCar * (m - c.q);
      if (rows.length >= 2) for (const r of rows) { const d = drvOf(st, r.driver); d.qn = P.lD * d.qn + (r._u - m); d.qd = P.lD * d.qd + 1; }
    }
  }
  // race: pace from classified finishers, reliability from starters
  const race = (ev.race || []).filter((r) => r.car);
  const cls = race.filter(raceClassified);
  if (cls.length >= 4) {
    const order = [...cls].sort((a, b) => a.pos - b.pos);
    const n = order.length;
    order.forEach((r, i) => { r._u = rankScore(i + 1, n); });
    for (const [k, rows] of Object.entries(groupBy(order, (r) => r.car))) {
      const m = rows.reduce((s, r) => s + r._u, 0) / rows.length;
      const c = carOf(st, k, P);
      if (!c.sr) { c.r = m; c.sr = true; } else c.r += P.aCar * (m - c.r);
      if (rows.length >= 2) for (const r of rows) { const d = drvOf(st, r.driver); d.rn = P.lD * d.rn + (r._u - m); d.rd = P.lD * d.rd + 1; }
    }
    if (ev.circuit_id) for (const r of order) {
      if (pre[r.driver] == null) continue;
      const key = `${r.driver}|${ev.circuit_id}`;
      const ci = (st.circ[key] ||= { n: 0, d: 0 });
      ci.n += r._u - pre[r.driver]; ci.d += 1;
    }
  }
  for (const r of race) {
    if (!raceStarted(r)) continue;
    const x = raceClassified(r) ? 0 : 1;
    const rr = (st.rel[r.car] ||= { n: 0, d: 0 });
    rr.n = P.lR * rr.n + x; rr.d = P.lR * rr.d + 1;
    st.relG.n = 0.995 * st.relG.n + x; st.relG.d = 0.995 * st.relG.d + 1;
  }
  st.events++;
  st.last_event = ev.id;
  return st;
}

// ---------- Plackett-Luce helpers (analytic; used for tuning and teammate pairs) ----------
/** log-likelihood of an observed order (best first) under PL with log-weights beta*s. */
export function plLogLik(scores, beta) {
  let ll = 0;
  const w = scores.map((s) => beta * s);
  for (let k = 0; k < w.length; k++) {
    let mx = -Infinity;
    for (let j = k; j < w.length; j++) mx = Math.max(mx, w[j]);
    let z = 0;
    for (let j = k; j < w.length; j++) z += Math.exp(w[j] - mx);
    ll += w[k] - mx - Math.log(z);
  }
  return ll;
}
/** PL pairwise: P(a ahead of b) = sigmoid(beta * (sa - sb)). Same family as the simulation (Gumbel noise). */
export const pairProb = (sa, sb, beta) => sigmoid(beta * (sa - sb));

/** Post-qualifying race strength: pre-qualifying strength + wGrid x normal score of the official qualifying
 *  classification position (no classification = one place behind the last classified car). */
export function postStrength(sRace, qp, nQ, nEntrants, P = PARAMS) {
  const n = Math.max(nQ, nEntrants);
  return sRace + P.wGrid * (Number.isInteger(qp) ? rankScore(qp, n + 1) : rankScore(n + 1, n + 1));
}

// ---------- simulation ----------
/**
 * Monte Carlo race: each starter survives with 1 - p_dnf; survivors are ordered by beta*s + Gumbel noise
 * (= Plackett-Luce). Returns per-entrant win/podium/top-10 and expected classified rank.
 */
export function simulateRace(field, { beta, sims = 20000, seed = 1 }) {
  const rnd = mulberry32(seed);
  const n = field.length;
  const win = new Float64Array(n), pod = new Float64Array(n), t10 = new Float64Array(n), rankSum = new Float64Array(n), cls = new Float64Array(n);
  const key = new Float64Array(n);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let s = 0; s < sims; s++) {
    let m = 0;
    for (let i = 0; i < n; i++) {
      if (rnd() < field[i].p_dnf) { key[i] = -Infinity; continue; }
      const u = Math.max(rnd(), 1e-300);
      key[i] = beta * field[i].s - Math.log(-Math.log(u));
      m++;
    }
    idx.sort((a, b) => key[b] - key[a]);
    for (let r = 0; r < m; r++) {
      const i = idx[r];
      if (r === 0) win[i]++;
      if (r < 3) pod[i]++;
      if (r < 10) t10[i]++;
      rankSum[i] += r + 1;
      cls[i]++;
    }
  }
  return field.map((f, i) => ({ p_win: win[i] / sims, p_podium: pod[i] / sims, p_top10: t10[i] / sims, p_classified: cls[i] / sims, exp_rank: cls[i] ? rankSum[i] / cls[i] : null }));
}

/** Winner distribution that sums to exactly 1: Laplace-smoothed MC frequencies + explicit "other" mass. */
export function winnerDistribution(rows, sims, otherMass) {
  const raw = rows.map((r) => r.p_win * sims + 0.5);
  const z = raw.reduce((a, b) => a + b, 0);
  const p = raw.map((x) => (x / z) * (1 - otherMass));
  return { probs: p, other: otherMass };
}

/**
 * Predict one event from the pre-event state.
 *   entrants: [{ driver, car }] — the locked field (drivers expected to take part)
 *   qualiPos: optional { driver: official qualifying classification position } → post-qualifying version
 */
export function predictEvent(st, { event_id, circuit_id = null, entrants, qualiPos = null }, P = PARAMS, { sims = 20000, seed = null } = {}) {
  const post = !!qualiPos;
  const nQ = post ? Object.keys(qualiPos).length : 0;
  const field = entrants.map((e) => {
    const s = strengths(st, e, P, circuit_id);
    const rs = post ? postStrength(s.race, qualiPos[e.driver], nQ, entrants.length, P) : s.race;
    return { ...e, sq: s.quali, s: rs, p_dnf: dnfProb(st, e.car, P), terms: s };
  });
  const beta = post ? P.betaRP : P.betaR;
  const sim = simulateRace(field, { beta, sims, seed: seed ?? seedOf(`${event_id}|${post ? 'post' : 'pre'}`) });
  const wd = winnerDistribution(sim, sims, P.otherMass);
  const drivers = field.map((f, i) => ({ driver: f.driver, car: f.car, p_win: wd.probs[i], p_podium: sim[i].p_podium, p_top10: sim[i].p_top10, p_classified: sim[i].p_classified, exp_rank: sim[i].exp_rank, strength_race: f.s, strength_quali: f.sq, p_dnf: f.p_dnf }));
  const teams = groupBy(field, (f) => f.car);
  const pairs = [];
  for (const rows of Object.values(teams)) {
    if (rows.length !== 2) continue;
    const [a, b] = [...rows].sort((x, y) => (x.driver < y.driver ? -1 : 1));
    pairs.push({ car: a.car, a: a.driver, b: b.driver, p_a_quali: pairProb(a.sq, b.sq, P.betaQ), p_a_race: pairProb(a.s, b.s, beta) });
  }
  return { version: post ? 'post_qualifying' : 'pre_qualifying', sims, beta, drivers, other_mass: wd.other, pairs };
}

// ---------- canonical event adapters ----------
/** From normalized tables (data/normalized): events, sessions, classifications grouped. */
export function canonicalFromNormalized({ events, sessions, results }) {
  const sessBy = groupBy(sessions, (s) => s.event_id);
  const resBy = groupBy(results, (r) => r.session_id);
  return events
    .filter((e) => e.status !== 'canceled')
    .map((e) => {
      const ss = sessBy[e.id] || [];
      const qs = ss.find((s) => s.type === 'qualifying');
      const rs = ss.find((s) => s.type === 'race');
      const quali = (qs ? resBy[qs.id] || [] : []).map((r) => ({ driver: r.driver_id, car: carKey(r.constructor_id), constructor_id: r.constructor_id, pos: Number.isInteger(r.position) ? r.position : null, status: r.status }));
      const race = (rs ? resBy[rs.id] || [] : []).filter((r) => r.race_participant !== false && r.status !== 'practice_only').map((r) => ({ driver: r.driver_id, car: carKey(r.constructor_id), constructor_id: r.constructor_id, pos: Number.isInteger(r.position) ? r.position : null, grid: r.grid, status: r.status, laps: r.laps, points: r.points || 0 }));
      return { id: e.id, season: e.season, round: e.round, name: e.name, circuit_id: e.circuit_id, start_utc: e.start_utc, status: e.status, quali_start: qs?.start_utc || null, race_start: rs?.start_utc || null, quali_state: qs?.state || null, race_state: rs?.state || null, quali, race };
    })
    .sort((a, b) => String(a.race_start || a.start_utc).localeCompare(String(b.race_start || b.start_utc)));
}

/** Completed-only filter used for replay: an event contributes only after its race classification exists. */
export const isCompleted = (ev) => ev.status === 'completed' && ev.race.some(raceClassified);
