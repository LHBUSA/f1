// PBE F1 EDGE as-of feature reconstruction.
//
// eventFeatures(idx, ev, entrants) rebuilds every driver/constructor/circuit feature for one event using ONLY source
// sessions that started strictly before the event start (prefixBefore). It returns max_source_t, the start time of the
// latest source session read, which the dataset builder asserts is < event_start for every row.
//
// Same-event information is limited to the entry list (driver + car, known before the weekend) and, for the
// post-qualifying race variant only, the published starting grid (handled in the dataset builder, not here).
import { prefixBefore } from './data.mjs';
import { fitBT, BT_QUALI, BT_RACE } from './bt.mjs';
import { median, mean } from './util.mjs';
import { rankWithCountback } from '../core/standings.mjs';

export const FEATURE_VERSION = 'f1-edge-features@0.1.0';
const DAY = 86400000;
const YEAR = 365 * DAY;

// Driver-level pair features (row feature = value(a) - value(b)). Sign conventions noted; the model learns weights.
export const PAIR_FEATURES = Object.freeze({
  q_bt: 'qualifying Bradley-Terry strength (driver + car), as-of',
  q_bt_driver: 'qualifying BT driver component',
  q_bt_car: 'qualifying BT constructor-season component',
  r_bt: 'race-order Bradley-Terry strength (driver + car), as-of',
  r_bt_driver: 'race BT driver component',
  r_bt_car: 'race BT constructor-season component',
  tm_gap_season: 'teammate qualifying gap %, this season to date (shrunk; + = slower)',
  tm_gap_recent: 'teammate qualifying gap %, last 6 comparable sessions (shrunk)',
  tm_gap_decay: 'teammate qualifying gap %, 1-year decay over 3 seasons (shrunk)',
  tm_q_h2h: 'teammate qualifying head-to-head, decayed net rate (shrunk)',
  tm_r_h2h: 'teammate race head-to-head, decayed net rate (shrunk)',
  con_gap_pole: 'constructor best-qualifying gap to pole %, season to date pooled with previous season (+ = slower)',
  points_before: 'championship points this season before the event',
  champ_pos_before: 'championship position before the event (previous season final if no race yet)',
  log_starts: 'log(1 + career race starts before the event)',
  rookie: '1 if fewer than 10 career starts before the event',
  drv_reliability: 'driver classification rate of started races, decayed (shrunk)',
  con_reliability: 'constructor classification rate, season to date pooled with previous season',
  race_gains: 'expectation-adjusted grid-to-finish gain, decayed (shrunk; expectation table built as-of)',
  circ_tm_gap: 'teammate qualifying gap % at this circuit, prior visits (shrunk)',
  circ_pctl: 'qualifying field percentile at this circuit minus 0.5, prior visits (shrunk)',
  circ_r_h2h: 'teammate race head-to-head at this circuit (shrunk)',
  street_driver: 'street event x driver street-vs-overall teammate gap',
  street_con: 'street event x constructor street-vs-overall gap to pole',
  speed_driver: 'high/low speed-class event x driver class-vs-overall teammate gap (as-of speed classes)',
  speed_con: 'high/low speed-class event x constructor class-vs-overall gap to pole',
  pair_q_h2h: 'prior qualifying head-to-head between these two drivers (decayed, shrunk) [pair-level]',
  pair_r_h2h: 'prior race head-to-head between these two drivers (decayed, shrunk) [pair-level]',
  // Circuit Fit components, rebuilt as-of (percentile among entrants x production weight). Never the 0-100 score.
  cf_q_x_track_position: 'Circuit Fit component: driver qualifying pct x track-position importance',
  cf_gains_x_overtaking: 'Circuit Fit component: race-gains pct x overtaking',
  cf_street: 'Circuit Fit component: street form pct (street events)',
  cf_driver_speed: 'Circuit Fit component: driver high/low-speed pct',
  cf_car_speed: 'Circuit Fit component: car high/low-speed pct',
  cf_car_qualifying: 'Circuit Fit component: car qualifying speed pct',
});
/** Present in rows for the baseline only. Models are forbidden from consuming it (see models.mjs guard). */
export const BASELINE_ONLY = Object.freeze(['cf_score']);

const shr = (sum, n, k, prior = 0) => (sum + k * prior) / (n + k);

export function eventFeatures(idx, ev, entrants, { btQ = BT_QUALI, btR = BT_RACE } = {}) {
  const T = ev.start_ms;
  const prefix = prefixBefore(idx, T);
  for (const s of prefix) if (s.event_id === ev.id || s.t >= T) throw new Error(`leak: session ${s.id} not before ${ev.id}`);
  const maxT = prefix.length ? prefix[prefix.length - 1].t : null;
  const ent = new Map(entrants.map((e) => [e.d, e]));
  const wt = (t, tau = YEAR) => Math.exp(-(T - t) / tau);
  const meta = (cid) => idx.circuitMeta[cid] || {};

  // ---- as-of circuit speed classes (pole-lap speed, last 5 seasons before the event) ----
  const spd = new Map();
  for (const s of prefix) {
    if (s.type !== 'qualifying' || s.season < ev.season - 5 || !s.facts.poleMs) continue;
    const len = meta(s.circuit_id).length_km;
    if (!len) continue;
    (spd.get(s.circuit_id) || spd.set(s.circuit_id, []).get(s.circuit_id)).push(len / (s.facts.poleMs / 3600000));
  }
  const spdMed = new Map([...spd].map(([k, v]) => [k, median(v)]));
  const sv = [...spdMed.values()].sort((a, b) => a - b);
  const speedClass = (cid) => {
    const v = spdMed.get(cid);
    if (v == null || sv.length < 6) return null;
    const lo = sv[Math.floor(sv.length / 3)];
    const hi = sv[Math.floor((2 * sv.length) / 3)];
    return v >= hi ? 'high' : v <= lo ? 'low' : 'medium';
  };
  const evStreet = !!meta(ev.circuit_id).street;
  const evSpeed = speedClass(ev.circuit_id);

  // ---- as-of circuit profile (track position / overtaking), last 10 seasons, percentiles among circuits ----
  const circ = new Map();
  const expGainRaw = new Map();
  for (const s of prefix) {
    if (s.type !== 'race' || s.season < ev.season - 10) continue;
    const st = s.facts.started;
    if (s.season <= ev.season - 1) for (const r of st) if (r.classified && r.grid && r.pos) (expGainRaw.get(r.grid) || expGainRaw.set(r.grid, []).get(r.grid)).push(r.grid - r.pos);
    if (!s.circuit_id) continue;
    const c = circ.get(s.circuit_id) || circ.set(s.circuit_id, { rho: [], moves: [], pw: 0, pn: 0 }).get(s.circuit_id);
    const cl = st.filter((r) => r.classified && r.grid && r.pos);
    const win = st.find((r) => r.classified && r.pos === 1);
    const pole = st.find((r) => r.grid === 1);
    if (win && pole) { c.pn++; if (win.d === pole.d) c.pw++; }
    if (cl.length >= 5) { c.rho.push(spearman(cl.map((r) => r.grid), cl.map((r) => r.pos))); c.moves.push(mean(cl.map((r) => Math.abs(r.grid - r.pos)))); }
  }
  const expGain = new Map([...expGainRaw].map(([g, v]) => [g, mean(v)]));
  const tpOf = (c) => (c && c.rho.length && c.pn ? (median(c.rho) + c.pw / c.pn) / 2 : null);
  const ovOf = (c) => (c && c.moves.length ? median(c.moves) : null);
  const eligible = [...circ.values()].filter((c) => c.rho.length >= 2);
  const pctRank = (v, pop) => (v == null || !pop.length ? null : Math.round(((pop.filter((p) => p < v).length + pop.filter((p) => p === v).length / 2) / pop.length) * 100));
  const evC = circ.get(ev.circuit_id);
  const tp = evC && evC.rho.length >= 2 ? pctRank(tpOf(evC), eligible.map(tpOf).filter((x) => x != null)) : null;
  const ov = evC && evC.rho.length >= 2 ? pctRank(ovOf(evC), eligible.map(ovOf).filter((x) => x != null)) : null;

  // ---- per-driver accumulators ----
  const D = new Map();
  for (const d of ent.keys()) D.set(d, { gW: 0, gS: 0, gSeason: [], gList: [], qhW: 0, qhS: 0, rhW: 0, rhS: 0, relW: 0, relS: 0, gaW: 0, gaS: 0, cls: { street: [], high: [], low: [] }, cg: [], cgW: 0, cp: [], crW: 0, crS: 0, starts: 0, points: 0, fin: [] });
  const L = new Map();
  const conOf = (Lid) => L.get(Lid) || L.set(Lid, { gapSeason: [], gapPrev: [], clsGaps: { all: [], street: [], high: [], low: [] }, relSeason: [0, 0], relPrev: [0, 0] }).get(Lid);
  const prevPts = new Map();
  const prevFin = new Map();
  const seasonPts = new Map();
  const seasonFin = new Map();
  const pairQ = new Map();
  const pairR = new Map();
  const entList = [...ent.keys()].sort();

  for (const s of prefix) {
    const recent = s.t >= T - 3 * YEAR;
    const tenY = s.t >= T - 10 * YEAR;
    const atCirc = s.circuit_id && s.circuit_id === ev.circuit_id && tenY;
    const sClass = s.circuit_id ? speedClass(s.circuit_id) : null;
    const sStreet = !!meta(s.circuit_id).street;
    if (s.type === 'qualifying') {
      if (recent) {
        const w = wt(s.t);
        for (const [d, x] of s.facts.tmGap) {
          const a = D.get(d);
          if (!a) continue;
          a.gW += w; a.gS += w * x.g; a.gList.push(x.g);
          if (s.season === ev.season) a.gSeason.push(x.g);
          if (sStreet) a.cls.street.push(x.g);
          if (sClass === 'high') a.cls.high.push(x.g);
          if (sClass === 'low') a.cls.low.push(x.g);
        }
        for (const [d, v] of s.facts.tmAhead) { const a = D.get(d); if (a) { a.qhW += w; a.qhS += w * v; } }
        pairUpdate(pairQ, s.rows.filter((r) => r.pos != null && ent.has(r.d)), (r) => r.pos, w);
      }
      if (s.season === ev.season || s.season === ev.season - 1) {
        for (const [Lid, g] of s.facts.teamPole) {
          const c = conOf(Lid);
          (s.season === ev.season ? c.gapSeason : c.gapPrev).push(g);
          c.clsGaps.all.push(g);
          if (sStreet) c.clsGaps.street.push(g);
          if (sClass === 'high') c.clsGaps.high.push(g);
          if (sClass === 'low') c.clsGaps.low.push(g);
        }
      }
      if (atCirc) {
        const w = wt(s.t, 3 * YEAR);
        for (const [d, x] of s.facts.tmGap) { const a = D.get(d); if (a) { a.cg.push(w * x.g); a.cgW += w; } }
        for (const [d, p] of s.facts.pctl) { const a = D.get(d); if (a) a.cp.push(p - 0.5); }
      }
    } else {
      for (const r of s.facts.started) { const a = D.get(r.d); if (a) a.starts++; }
      if (recent) {
        const w = wt(s.t);
        for (const [d, v] of s.facts.tmAhead) { const a = D.get(d); if (a) { a.rhW += w; a.rhS += w * v; } }
        for (const r of s.facts.started) {
          const a = D.get(r.d);
          if (a) {
            a.relW += w; a.relS += w * (r.classified ? 1 : 0);
            if (r.gain != null && expGain.has(r.grid)) { a.gaW += w; a.gaS += w * (r.gain - expGain.get(r.grid)); }
          }
        }
        pairUpdate(pairR, s.rows.filter((r) => r.started && ent.has(r.d)), (r) => r.key, w);
      }
      if (s.season === ev.season || s.season === ev.season - 1) {
        for (const r of s.facts.started) {
          if (!r.L) continue;
          const c = conOf(r.L);
          const t = s.season === ev.season ? c.relSeason : c.relPrev;
          t[0]++; t[1] += r.classified ? 1 : 0;
        }
        const P = s.season === ev.season ? seasonPts : prevPts;
        const F = s.season === ev.season ? seasonFin : prevFin;
        for (const r of s.facts.points) {
          P.set(r.d, (P.get(r.d) || 0) + r.points);
          (F.get(r.d) || F.set(r.d, []).get(r.d)).push(r.pos);
        }
      }
      if (atCirc) for (const [d, v] of s.facts.tmAhead) { const a = D.get(d); if (a) { const w = wt(s.t, 3 * YEAR); a.crW += w; a.crS += w * v; } }
    }
  }

  // ---- championship position before the event ----
  const rankMap = (P, F) => new Map(rankWithCountback(Object.fromEntries(P), Object.fromEntries(F)).map(([id, v]) => [id, v.pos]));
  const useSeason = seasonPts.size > 0;
  const champ = useSeason ? rankMap(seasonPts, seasonFin) : rankMap(prevPts, prevFin);
  const champN = champ.size;

  // ---- BT strengths ----
  const btEnt = entrants.map((e) => ({ d: e.d, L: e.L }));
  const qbt = fitBT(prefix, { cutoff: T, season: ev.season, kind: 'qualifying', entrants: btEnt, cfg: btQ });
  const rbt = fitBT(prefix, { cutoff: T, season: ev.season, kind: 'race', entrants: btEnt, cfg: btR });

  // ---- assemble driver values ----
  const drivers = {};
  for (const d of entList) {
    const a = D.get(d);
    const e = ent.get(d);
    const c = conOf(e.L);
    const overall = shr(a.gS, a.gW, 1);
    const relCls = (arr) => (arr.length ? (arr.length / (arr.length + 3)) * (mean(arr) - (a.gList.length ? mean(a.gList) : 0)) : 0);
    const conAll = c.clsGaps.all.length ? mean(c.clsGaps.all) : 0;
    const conCls = (arr) => (arr.length ? (arr.length / (arr.length + 3)) * (mean(arr) - conAll) : 0);
    const prevGap = c.gapPrev.length ? mean(c.gapPrev) : 2.5;
    const prevRel = c.relPrev[0] ? c.relPrev[1] / c.relPrev[0] : 0.85;
    const last6 = a.gList.slice(-6);
    drivers[d] = {
      d, c: e.c, L: e.L,
      q_bt: qbt.strength(d, e.L), q_bt_driver: qbt.theta(d), q_bt_car: qbt.phi(e.L),
      r_bt: rbt.strength(d, e.L), r_bt_driver: rbt.theta(d), r_bt_car: rbt.phi(e.L),
      tm_gap_season: shr(a.gSeason.reduce((x, y) => x + y, 0), a.gSeason.length, 1),
      tm_gap_recent: shr(last6.reduce((x, y) => x + y, 0), last6.length, 1),
      tm_gap_decay: overall,
      tm_q_h2h: shr(a.qhS, a.qhW, 2),
      tm_r_h2h: shr(a.rhS, a.rhW, 2),
      con_gap_pole: shr(c.gapSeason.reduce((x, y) => x + y, 0), c.gapSeason.length, 2, prevGap),
      points_before: useSeason ? seasonPts.get(d) || 0 : 0,
      champ_pos_before: champ.get(d) ?? champN + 1,
      log_starts: Math.log1p(a.starts),
      rookie: a.starts < 10 ? 1 : 0,
      drv_reliability: shr(a.relS, a.relW, 3, 0.85),
      con_reliability: shr(c.relSeason[1], c.relSeason[0], 6, prevRel),
      race_gains: shr(a.gaS, a.gaW, 3),
      circ_tm_gap: shr(a.cg.reduce((x, y) => x + y, 0), a.cgW, 2),
      circ_pctl: shr(a.cp.reduce((x, y) => x + y, 0), a.cp.length, 2),
      circ_r_h2h: shr(a.crS, a.crW, 2),
      street_rel: relCls(a.cls.street), high_rel: relCls(a.cls.high), low_rel: relCls(a.cls.low),
      con_street_rel: conCls(c.clsGaps.street), con_high_rel: conCls(c.clsGaps.high), con_low_rel: conCls(c.clsGaps.low),
      circ_visits: a.cp.length,
    };
    const v = drivers[d];
    v.street_driver = evStreet ? v.street_rel : 0;
    v.street_con = evStreet ? v.con_street_rel : 0;
    v.speed_driver = evSpeed === 'high' ? v.high_rel : evSpeed === 'low' ? v.low_rel : 0;
    v.speed_con = evSpeed === 'high' ? v.con_high_rel : evSpeed === 'low' ? v.con_low_rel : 0;
  }

  // ---- Circuit Fit, rebuilt as-of (percentiles among this event's entrants; production component weights) ----
  const pctAmong = (key, higherBetter) => {
    const vals = entList.map((d) => drivers[d][key]);
    const out = {};
    for (const d of entList) { const p = pctRank(drivers[d][key], vals); out[d] = higherBetter ? p : 100 - p; }
    return out;
  };
  const P_q = pctAmong('tm_gap_decay', false);
  const P_g = pctAmong('race_gains', true);
  const P_st = pctAmong('street_rel', false);
  const P_hi = pctAmong('high_rel', false);
  const P_lo = pctAmong('low_rel', false);
  const P_chi = pctAmong('con_high_rel', false);
  const P_clo = pctAmong('con_low_rel', false);
  const P_cq = pctAmong('con_gap_pole', false);
  for (const d of entList) {
    const comps = [];
    if (tp != null) comps.push(['cf_q_x_track_position', P_q[d], 0.5 + tp / 100]);
    if (ov != null) comps.push(['cf_gains_x_overtaking', P_g[d], 0.3 + ov / 100]);
    if (evStreet) comps.push(['cf_street', P_st[d], 1]);
    if (evSpeed === 'high') { comps.push(['cf_driver_speed', P_hi[d], 0.8]); comps.push(['cf_car_speed', P_chi[d], 1]); }
    if (evSpeed === 'low') { comps.push(['cf_driver_speed', P_lo[d], 0.8]); comps.push(['cf_car_speed', P_clo[d], 1]); }
    comps.push(['cf_car_qualifying', P_cq[d], 1.2]);
    const v = drivers[d];
    for (const k of ['cf_q_x_track_position', 'cf_gains_x_overtaking', 'cf_street', 'cf_driver_speed', 'cf_car_speed', 'cf_car_qualifying']) v[k] = 0;
    for (const [k, p, w] of comps) v[k] = (p / 100) * w;
    const wsum = comps.reduce((s, x) => s + x[2], 0);
    v.cf_score = Math.round(comps.reduce((s, x) => s + x[1] * x[2], 0) / wsum);
  }

  return {
    event_id: ev.id, cutoff: T, max_source_t: maxT,
    bt_max_t: Math.max(qbt.max_t, rbt.max_t),
    circuit: { circuit_id: ev.circuit_id, street: evStreet, speed_class: evSpeed, track_position_pct: tp, overtaking_pct: ov, champ_basis: useSeason ? 'season_to_date' : 'previous_season_final' },
    drivers,
    pairQ: (a, b) => pairStat(pairQ, a, b),
    pairR: (a, b) => pairStat(pairR, a, b),
  };
}

function pairUpdate(map, rows, key, w) {
  const rs = [...rows].sort((a, b) => (a.d < b.d ? -1 : 1));
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const ka = key(rs[i]);
    const kb = key(rs[j]);
    if (ka === kb) continue;
    const k = rs[i].d + '|' + rs[j].d;
    const m = map.get(k) || map.set(k, [0, 0]).get(k);
    m[0] += w * (ka < kb ? 1 : -1);
    m[1] += w;
  }
}
function pairStat(map, a, b) {
  const flip = a > b;
  const m = map.get(flip ? b + '|' + a : a + '|' + b);
  if (!m) return 0;
  const v = m[0] / (m[1] + 2);
  return flip ? -v : v;
}

function spearman(xs, ys) {
  const n = xs.length;
  const rank = (a) => {
    const s = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const r = new Array(n);
    s.forEach(([, i], k) => (r[i] = k + 1));
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const d2 = rx.reduce((s, v, i) => s + (v - ry[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

/** Pair row features: driver-level differences (a - b) plus pair-level history. */
export function pairFeatures(F, a, b) {
  const A = F.drivers[a];
  const B = F.drivers[b];
  const out = {};
  for (const k of Object.keys(PAIR_FEATURES)) {
    if (k === 'pair_q_h2h') out[k] = F.pairQ(a, b);
    else if (k === 'pair_r_h2h') out[k] = F.pairR(a, b);
    else out[k] = A[k] - B[k];
  }
  out.cf_score = A.cf_score - B.cf_score;
  return out;
}
