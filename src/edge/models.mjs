// PBE F1 EDGE research models. Deterministic regularized logistic models on top of the as-of BT strengths.
//
// Pair models (qualifying H2H, race H2H pre/post qualifying) have NO intercept and use only antisymmetric
// (a - b) features, so p(a beats b) = 1 - p(b beats a) exactly. Top-10 models are per-driver with an intercept.
// Sportsbook odds are never model inputs: any feature name that looks like a market field throws.
import { fitLogistic, predictLogistic } from './util.mjs';
import { PAIR_FEATURES } from './features.mjs';

export const MODEL_VERSIONS = Object.freeze({
  quali_h2h: 'f1-edge-quali-h2h@0.1.0-research',
  race_h2h_pre: 'f1-edge-race-h2h-pre@0.1.0-research',
  race_h2h_post: 'f1-edge-race-h2h-post@0.1.0-research',
  top10_pre: 'f1-edge-top10-pre@0.1.0-research',
  top10_post: 'f1-edge-top10-post@0.1.0-research',
});

const TM_INTERACT = ['tm_gap_season', 'tm_gap_recent', 'tm_gap_decay', 'tm_q_h2h', 'tm_r_h2h'];
const PAIR_CANDIDATES = [...Object.keys(PAIR_FEATURES), ...TM_INTERACT.map((k) => 'tmx_' + k)];
const TOP10_CANDIDATES = ['q_bt', 'r_bt', 'q_bt_driver', 'r_bt_driver', 'q_bt_car', 'r_bt_car', 'con_gap_pole', 'tm_gap_decay', 'drv_reliability', 'con_reliability', 'race_gains', 'points_before', 'champ_pos_before', 'log_starts', 'rookie', 'circ_pctl'];

export const MODEL_SPECS = Object.freeze({
  quali_h2h: { target: 'quali_h2h', kind: 'pair', core: ['q_bt'], candidates: PAIR_CANDIDATES, cutoff: 'event_start' },
  race_h2h_pre: { target: 'race_h2h', kind: 'pair', core: ['r_bt'], candidates: PAIR_CANDIDATES, cutoff: 'event_start' },
  race_h2h_post: { target: 'race_h2h', kind: 'pair', core: ['r_bt', 'grid_logratio'], candidates: [...PAIR_CANDIDATES, 'grid_diff'], cutoff: 'race_start (grid published)' },
  top10_pre: { target: 'top10', kind: 'single', core: ['r_bt'], candidates: TOP10_CANDIDATES, cutoff: 'event_start' },
  top10_post: { target: 'top10', kind: 'single', core: ['r_bt', 'grid_log', 'grid_top10'], candidates: TOP10_CANDIDATES, cutoff: 'race_start (grid published)' },
});

// Never model inputs: the published 0-100 Circuit Fit score (baseline only) and anything market-derived.
export const FORBIDDEN_MODEL_FEATURES = Object.freeze(['cf_score']);
const MARKET_PATTERN = /odds|price|implied|devig|market|book|quote|line_/i;

export function assertAllowed(names, spec) {
  for (const n of names) {
    if (FORBIDDEN_MODEL_FEATURES.includes(n)) throw new Error(`forbidden model feature: ${n}`);
    if (MARKET_PATTERN.test(n)) throw new Error(`market data is never a model feature: ${n}`);
    if (/^grid/.test(n) && !/post/.test(spec?.cutoff || '') && !/race_start/.test(spec?.cutoff || '')) throw new Error(`grid feature ${n} not allowed before qualifying`);
  }
}

/** Feature value for a dataset row (derived grid/interaction features computed here). */
export function featureValue(row, name) {
  const f = row.features;
  if (name === 'grid_diff') return row.post_qualifying.grid_a - row.post_qualifying.grid_b;
  if (name === 'grid_logratio') return Math.log(row.post_qualifying.grid_a / row.post_qualifying.grid_b);
  if (name === 'grid_log') return Math.log(row.post_qualifying.grid_a);
  if (name === 'grid_top10') return row.post_qualifying.grid_a <= 10 ? 1 : 0;
  if (name.startsWith('tmx_')) return row.teammate ? f[name.slice(4)] : 0;
  const v = f[name];
  if (v === undefined) throw new Error(`unknown feature ${name}`);
  return v;
}

export function matrix(rows, names) {
  return rows.map((r) => names.map((n) => featureValue(r, n)));
}

/** Fit: scale (no centering for pair models, to keep antisymmetry) then L2 logistic. */
export function fitModel(rows, names, spec, { l2 = 1 } = {}) {
  assertAllowed(names, spec);
  const X = matrix(rows, names);
  const intercept = spec.kind === 'single';
  const scale = names.map((_, k) => {
    const v = X.map((x) => x[k]);
    const m = intercept ? v.reduce((s, x) => s + x, 0) / v.length : 0;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, v.length - 1));
    return sd > 1e-9 ? sd : 1;
  });
  const Xs = X.map((x) => x.map((v, k) => v / scale[k]));
  const beta = fitLogistic(Xs, rows.map((r) => r.y), { l2, intercept, iters: 30 });
  return { features: names, scale, beta, intercept };
}

export function predict(model, row) {
  const x = model.features.map((n, k) => featureValue(row, n) / model.scale[k]);
  return predictLogistic(model.beta, x, model.intercept);
}
