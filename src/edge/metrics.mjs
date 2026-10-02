// Probability scoring for PBE F1 EDGE research. Pure functions over arrays of {p, y}.
import { clampP, logit, fitLogistic } from './util.mjs';

export function logLoss(rows) {
  let s = 0;
  for (const { p, y } of rows) { const q = clampP(p); s += -(y * Math.log(q) + (1 - y) * Math.log(1 - q)); }
  return rows.length ? s / rows.length : null;
}
export function brier(rows) {
  return rows.length ? rows.reduce((s, { p, y }) => s + (p - y) ** 2, 0) / rows.length : null;
}
export function accuracy(rows) {
  return rows.length ? rows.reduce((s, { p, y }) => s + (p === 0.5 ? 0.5 : (p > 0.5) === (y === 1) ? 1 : 0), 0) / rows.length : null;
}
/** Logistic recalibration y ~ a + b*logit(p). Perfect calibration: a = 0, b = 1. */
export function calibration(rows) {
  if (rows.length < 20) return { intercept: null, slope: null };
  const X = rows.map(({ p }) => [logit(clampP(p))]);
  const [b, a] = fitLogistic(X, rows.map((r) => r.y), { intercept: true, l2: 1e-6, iters: 50 });
  return { intercept: a, slope: b };
}
/** Expected calibration error, 10 equal-width bins. */
export function ece(rows, bins = 10) {
  const B = Array.from({ length: bins }, () => [0, 0, 0]);
  for (const { p, y } of rows) { const k = Math.min(bins - 1, Math.floor(p * bins)); B[k][0]++; B[k][1] += p; B[k][2] += y; }
  return rows.length ? B.reduce((s, [n, sp, sy]) => s + (n ? (n / rows.length) * Math.abs(sp / n - sy / n) : 0), 0) : null;
}
/** Reliability table from the favourite's side (pair models): predicted favourite probability vs observed hit rate. */
export function favouriteBuckets(rows, edges = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0001]) {
  const out = edges.slice(0, -1).map((lo, i) => ({ bucket: `${lo.toFixed(2)}-${Math.min(1, edges[i + 1]).toFixed(2)}`, n: 0, mean_pred: 0, observed: 0 }));
  for (const { p, y } of rows) {
    const q = p >= 0.5 ? p : 1 - p;
    const hit = p >= 0.5 ? y : 1 - y;
    const k = edges.findIndex((e, i) => q >= e && q < edges[i + 1]);
    if (k < 0) continue;
    out[k].n++; out[k].mean_pred += q; out[k].observed += hit;
  }
  return out.filter((b) => b.n).map((b) => ({ ...b, mean_pred: r4(b.mean_pred / b.n), observed: r4(b.observed / b.n) }));
}
/** Plain probability buckets (single-outcome models such as Top-10). */
export function probBuckets(rows, bins = 10) {
  const out = Array.from({ length: bins }, (_, i) => ({ bucket: `${(i / bins).toFixed(1)}-${((i + 1) / bins).toFixed(1)}`, n: 0, mean_pred: 0, observed: 0 }));
  for (const { p, y } of rows) { const k = Math.min(bins - 1, Math.floor(p * bins)); out[k].n++; out[k].mean_pred += p; out[k].observed += y; }
  return out.filter((b) => b.n).map((b) => ({ ...b, mean_pred: r4(b.mean_pred / b.n), observed: r4(b.observed / b.n) }));
}
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);

export function summarize(rows) {
  const cal = calibration(rows);
  return { n: rows.length, log_loss: r4(logLoss(rows)), brier: r4(brier(rows)), accuracy: r4(accuracy(rows)), cal_intercept: r4(cal.intercept), cal_slope: r4(cal.slope), ece: r4(ece(rows)) };
}

/** Event-clustered paired comparison of per-row log loss (model minus baseline); negative = model better. */
export function pairedLogLossDiff(rowsA, rowsB, eventOf) {
  const by = new Map();
  for (let i = 0; i < rowsA.length; i++) {
    const qa = clampP(rowsA[i].p);
    const qb = clampP(rowsB[i].p);
    const y = rowsA[i].y;
    const d = -(y * Math.log(qa) + (1 - y) * Math.log(1 - qa)) + (y * Math.log(qb) + (1 - y) * Math.log(1 - qb));
    const e = eventOf(i);
    const m = by.get(e) || by.set(e, [0, 0]).get(e);
    m[0] += d; m[1]++;
  }
  const per = [...by.values()].map(([s, n]) => s / n);
  const mu = per.reduce((s, x) => s + x, 0) / per.length;
  const sd = Math.sqrt(per.reduce((s, x) => s + (x - mu) ** 2, 0) / Math.max(1, per.length - 1));
  return { mean_diff: r4(mu), se: r4(sd / Math.sqrt(per.length)), events: per.length };
}
