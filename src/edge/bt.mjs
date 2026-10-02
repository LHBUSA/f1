// Time-decayed, regularized Bradley-Terry paired-comparison model with driver + constructor-season strengths.
//
// strength(driver d in a car of lineage L in season s) = theta_d + phi_{L,s}
// p(i ahead of j) = sigmoid(strength_i - strength_j)
// Observations: every ordered pair in a session (qualifying order or race finishing order) inside the look-back window,
// weighted exp(-age/tau) * 2/(n-1) (so each car contributes about one unit per session).
// Partial pooling / shrinkage:
//   theta_d ~ N(0, 1/lambda_driver)              (drivers with few comparisons — rookies — stay near the field mean)
//   phi_{L,s} - phi_{L,s-1} ~ N(0, 1/lambda_rw)   (a car is pulled toward the same lineage's previous season)
//   phi_{L,first} ~ N(0, 1/lambda_car0)
// Fit: Newton's method from a zero start, fixed iteration cap, deterministic parameter order. No randomness.
import { cholSolve } from './util.mjs';

export const BT_DEFAULTS = Object.freeze({ tau_days: 365, window_days: 3 * 365, lambda_driver: 1, lambda_rw: 2, lambda_car0: 0.5, iters: 12 });
// Selected by scripts/edge/tune-bt.mjs on 2014-2021 events only (36-config grid; reports/edge/bt-tuning.json).
// Race optimum sits on the grid edge (strongest pooling tried); the surface is flat (<0.001 log loss across the top 3).
export const BT_QUALI = Object.freeze({ ...BT_DEFAULTS, tau_days: 120, lambda_driver: 0.5, lambda_rw: 1 });
export const BT_RACE = Object.freeze({ ...BT_DEFAULTS, tau_days: 365, lambda_driver: 2, lambda_rw: 4 });

/**
 * sessions: time-safe prefix (already t < cutoff). kind: 'qualifying' | 'race'. entrants: [{d, L}] for the target event.
 * Returns { strength(d, L), theta, phi, n_pairs, max_t } where max_t is the latest source session actually used.
 */
export function fitBT(sessions, { cutoff, season, kind, entrants, cfg = BT_DEFAULTS }) {
  const DAY = 86400000;
  const from = cutoff - cfg.window_days * DAY;
  const pairs = [];
  let maxT = -Infinity;
  for (const s of sessions) {
    if (s.type !== kind || s.t < from || s.t >= cutoff) continue;
    const rows = kind === 'qualifying' ? s.rows.filter((r) => r.pos != null && r.L) : s.rows.filter((r) => r.started && r.L);
    const n = rows.length;
    if (n < 2) continue;
    const key = kind === 'qualifying' ? (r) => r.pos : (r) => r.key;
    const ord = [...rows].sort((a, b) => key(a) - key(b) || (a.d < b.d ? -1 : 1));
    const w = Math.exp(-(cutoff - s.t) / (cfg.tau_days * DAY)) * (2 / (n - 1));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (key(ord[i]) === key(ord[j])) continue; // tie: no information
      pairs.push([ord[i].d, `${ord[i].L}|${s.season}`, ord[j].d, `${ord[j].L}|${s.season}`, w]);
    }
    if (s.t > maxT) maxT = s.t;
  }
  // Parameter index: drivers then constructor-seasons, sorted for determinism. Entrants are always present.
  const dSet = new Set(entrants.map((e) => e.d));
  const cSet = new Set(entrants.filter((e) => e.L).map((e) => `${e.L}|${season}`));
  for (const p of pairs) { dSet.add(p[0]); dSet.add(p[2]); cSet.add(p[1]); cSet.add(p[3]); }
  const dList = [...dSet].sort();
  const cList = [...cSet].sort();
  const idx = new Map();
  dList.forEach((d, i) => idx.set('d:' + d, i));
  cList.forEach((c, i) => idx.set('c:' + c, dList.length + i));
  const P = dList.length + cList.length;
  // Random-walk links between consecutive seasons of a lineage.
  const byL = new Map();
  for (const c of cList) {
    const [L, s] = c.split('|');
    (byL.get(L) || byL.set(L, []).get(L)).push(Number(s));
  }
  const links = [];
  const firsts = [];
  for (const [L, ss] of byL) {
    ss.sort((a, b) => a - b);
    firsts.push(idx.get(`c:${L}|${ss[0]}`));
    for (let k = 1; k < ss.length; k++) links.push([idx.get(`c:${L}|${ss[k - 1]}`), idx.get(`c:${L}|${ss[k]}`)]);
  }
  const P4 = pairs.map(([di, ci, dj, cj, w]) => [idx.get('d:' + di), idx.get('c:' + ci), idx.get('d:' + dj), idx.get('c:' + cj), w]);
  const beta = new Float64Array(P);
  for (let it = 0; it < cfg.iters; it++) {
    const g = new Float64Array(P);
    const H = Array.from({ length: P }, () => new Float64Array(P));
    for (const [a, b, c, d, w] of P4) {
      const z = beta[a] + beta[b] - beta[c] - beta[d];
      const mu = 1 / (1 + Math.exp(-z));
      const r = w * (1 - mu); // gradient of log-likelihood wrt z (observed: first item ahead)
      const v = w * mu * (1 - mu);
      g[a] += r; g[b] += r; g[c] -= r; g[d] -= r;
      const ids = [a, b, c, d];
      const sg = [1, 1, -1, -1];
      for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) H[ids[x]][ids[y]] += v * sg[x] * sg[y];
    }
    for (let k = 0; k < dList.length; k++) { g[k] -= cfg.lambda_driver * beta[k]; H[k][k] += cfg.lambda_driver; }
    for (const k of firsts) { g[k] -= cfg.lambda_car0 * beta[k]; H[k][k] += cfg.lambda_car0; }
    for (const [p, q] of links) {
      const diff = beta[q] - beta[p];
      g[q] -= cfg.lambda_rw * diff; g[p] += cfg.lambda_rw * diff;
      H[p][p] += cfg.lambda_rw; H[q][q] += cfg.lambda_rw; H[p][q] -= cfg.lambda_rw; H[q][p] -= cfg.lambda_rw;
    }
    const step = cholSolve(H, g);
    let mx = 0;
    for (let k = 0; k < P; k++) { beta[k] += step[k]; mx = Math.max(mx, Math.abs(step[k])); }
    if (mx < 1e-9) break;
  }
  const theta = (d) => (idx.has('d:' + d) ? beta[idx.get('d:' + d)] : 0);
  const phi = (L) => (idx.has(`c:${L}|${season}`) ? beta[idx.get(`c:${L}|${season}`)] : 0);
  return { theta, phi, strength: (d, L) => theta(d) + phi(L), n_pairs: pairs.length, max_t: maxT };
}
