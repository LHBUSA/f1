// PBE F1 EDGE research utilities: deterministic hashing, numerics, small linear algebra, regularized logistic fit.
// Everything here is pure and deterministic (no randomness, no clocks) so artifacts hash identically across runs.
import crypto from 'node:crypto';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** JSON.stringify with sorted object keys (arrays keep order) so equal objects hash equally. */
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

export const sigmoid = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
export const logit = (p) => Math.log(p / (1 - p));
export const clampP = (p, e = 1e-6) => Math.min(1 - e, Math.max(e, p));
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** Round for storage so float noise never changes a hash. */
export const rd = (x, d = 6) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Solve A x = b for symmetric positive-definite A (Cholesky). A is an array of Float64Array rows; not modified. */
export function cholSolve(A, b) {
  const n = b.length;
  const L = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) L[i][i] = Math.sqrt(Math.max(s, 1e-12));
      else L[i][j] = s / L[j][j];
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

/**
 * L2-regularized logistic regression by Newton/IRLS, fixed iteration count from a zero start (deterministic).
 * X: array of number arrays, y: 0/1, w: optional row weights. intercept=false fits an antisymmetric paired-comparison
 * model (p(a beats b) = sigmoid(beta . (x_a - x_b))), so swapping a and b exactly flips the probability.
 * The intercept (if any) is not penalized.
 */
export function fitLogistic(X, y, { l2 = 1, intercept = false, iters = 25, w = null } = {}) {
  const p0 = X[0]?.length || 0;
  const p = p0 + (intercept ? 1 : 0);
  const beta = new Float64Array(p);
  for (let it = 0; it < iters; it++) {
    const H = Array.from({ length: p }, () => new Float64Array(p));
    const g = new Float64Array(p);
    for (let i = 0; i < X.length; i++) {
      const xi = intercept ? [...X[i], 1] : X[i];
      let z = 0;
      for (let k = 0; k < p; k++) z += beta[k] * xi[k];
      const mu = sigmoid(z);
      const wi = w ? w[i] : 1;
      const r = (y[i] - mu) * wi;
      const v = Math.max(mu * (1 - mu), 1e-9) * wi;
      for (let k = 0; k < p; k++) {
        if (!xi[k]) continue;
        g[k] += r * xi[k];
        for (let l = 0; l <= k; l++) H[k][l] += v * xi[k] * xi[l];
      }
    }
    for (let k = 0; k < p; k++) {
      const pen = intercept && k === p - 1 ? 1e-8 : l2;
      g[k] -= pen * beta[k];
      H[k][k] += pen;
      for (let l = 0; l < k; l++) H[l][k] = H[k][l];
    }
    const step = cholSolve(H, g);
    let mx = 0;
    for (let k = 0; k < p; k++) {
      beta[k] += step[k];
      mx = Math.max(mx, Math.abs(step[k]));
    }
    if (mx < 1e-10) break;
  }
  return Array.from(beta);
}

export function predictLogistic(beta, x, intercept = false) {
  let z = intercept ? beta[beta.length - 1] : 0;
  for (let k = 0; k < x.length; k++) z += beta[k] * x[k];
  return sigmoid(z);
}

export function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

/** Index of the first element with key >= t in an array sorted ascending by key (binary search). */
export function lowerBound(arr, t, key = (x) => x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(arr[mid]) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
