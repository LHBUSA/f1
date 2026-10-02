// PBE F1 EDGE — feature selection (development window only), walk-forward validation vs baselines, artifact freeze.
//
//   node scripts/edge/train-eval.mjs
//
// Protocol (deterministic, no random split):
//   1. Feature selection: train 2011-2017, validate 2018-2021. Each candidate is first tested alone on top of the core
//      BT strength (single-feature delta), then greedy forward selection keeps a feature only if it improves
//      validation log loss by >= MIN_GAIN. Test seasons are never seen during selection.
//   2. Walk-forward: for Y in 2022..2025 train on 2011..Y-1, predict Y. 2026 = shadow-to-date (train 2011-2025).
//   3. Baselines are refit on the same training rows (one-parameter logistic on the baseline signal) so probabilities
//      are comparable; 50/50 and raw BT need no fit.
//   4. Freeze: model trained on 2011-2025 -> reports/edge/artifacts/<model>.json with sha256.
import fs from 'node:fs';
import path from 'node:path';
import { fitModel, predict, MODEL_SPECS, MODEL_VERSIONS, FORBIDDEN_MODEL_FEATURES, featureValue } from '../../src/edge/models.mjs';
import { summarize, favouriteBuckets, probBuckets, pairedLogLossDiff, logLoss } from '../../src/edge/metrics.mjs';
import { fitLogistic, predictLogistic, sigmoid, sha256, stableStringify } from '../../src/edge/util.mjs';
import { FEATURE_VERSION, PAIR_FEATURES } from '../../src/edge/features.mjs';
import { BT_QUALI, BT_RACE } from '../../src/edge/bt.mjs';

const SEL_TRAIN = [2011, 2017];
const SEL_VAL = [2018, 2021];
const TEST_YEARS = [2022, 2023, 2024, 2025];
const SHADOW = 2026;
const MIN_GAIN = 0.0005;
const MAX_FEATURES = 8;
const REP = path.resolve('reports/edge');
fs.mkdirSync(path.join(REP, 'artifacts'), { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.join(REP, 'dataset-manifest.json'), 'utf8'));
const body = fs.readFileSync('data/edge/dataset.jsonl', 'utf8');
const datasetSha = sha256(body);
if (datasetSha !== manifest.dataset_sha256) throw new Error('dataset hash does not match manifest; rebuild the dataset');
const all = body.trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.eligible);
const byTarget = (t) => all.filter((r) => r.target === t);
const inSeasons = (rows, [a, b]) => rows.filter((r) => r.season >= a && r.season <= b);
const r5 = (x) => Math.round(x * 1e5) / 1e5;

function valLoss(train, val, names, spec) {
  const m = fitModel(train, names, spec);
  return logLoss(val.map((r) => ({ p: predict(m, r), y: r.y })));
}

function select(spec, rows) {
  const train = inSeasons(rows, SEL_TRAIN);
  const val = inSeasons(rows, SEL_VAL);
  const base = valLoss(train, val, spec.core, spec);
  const single = spec.candidates.filter((c) => !spec.core.includes(c)).map((c) => ({ feature: c, delta_vs_core: r5(valLoss(train, val, [...spec.core, c], spec) - base) }));
  single.sort((a, b) => a.delta_vs_core - b.delta_vs_core);
  let chosen = [...spec.core];
  let cur = base;
  const steps = [];
  const pool = single.filter((s) => s.delta_vs_core < 0).map((s) => s.feature);
  while (chosen.length < spec.core.length + MAX_FEATURES) {
    let best = null;
    for (const c of pool) {
      if (chosen.includes(c)) continue;
      const l = valLoss(train, val, [...chosen, c], spec);
      if (!best || l < best.l) best = { c, l };
    }
    if (!best || cur - best.l < MIN_GAIN) break;
    chosen.push(best.c);
    steps.push({ added: best.c, val_log_loss: r5(best.l), gain: r5(cur - best.l) });
    cur = best.l;
  }
  return { core: spec.core, core_val_log_loss: r5(base), single_feature_tests: single, forward_steps: steps, selected: chosen, final_val_log_loss: r5(cur) };
}

// ---- baselines ----
function baselineDefs(name) {
  const pair = MODEL_SPECS[name].kind === 'pair';
  const tmKey = name === 'quali_h2h' ? 'tm_q_h2h' : 'tm_r_h2h';
  const defs = [
    { id: 'coin_50_50', fixed: () => 0.5 },
    { id: 'championship_position_before', signal: ['champ_pos_before'] },
    { id: 'points_before', signal: ['points_before'] },
    { id: 'circuit_fit_ranking_asof', signal: ['cf_score'] },
  ];
  if (pair) defs.push({ id: 'teammate_h2h_record', signal: [tmKey] });
  if (pair) defs.push({ id: 'bt_raw_uncalibrated', fixed: (r) => sigmoid(r.features[name === 'quali_h2h' ? 'q_bt' : 'r_bt']) });
  if (!pair) defs[0] = { id: 'base_rate', signal: [] };
  if (name === 'race_h2h_post') defs.push({ id: 'qualifying_grid', signal: ['grid_logratio'] });
  if (name === 'top10_post') defs.push({ id: 'qualifying_grid', signal: ['grid_log', 'grid_top10'] });
  return defs.map((d) => ({ ...d, intercept: !pair }));
}
function fitBaseline(def, train) {
  if (def.fixed) return def.fixed;
  // Baseline fit bypasses the model guard on purpose: cf_score is allowed as a BASELINE only, never in a model.
  const X = train.map((r) => def.signal.map((s) => featureValue(r, s)));
  const sc = def.signal.map((_, k) => Math.sqrt(X.reduce((s, x) => s + x[k] ** 2, 0) / Math.max(1, X.length)) || 1);
  const beta = def.signal.length || def.intercept ? fitLogistic(X.map((x) => x.map((v, k) => v / sc[k])), train.map((r) => r.y), { intercept: def.intercept, l2: 1e-3 }) : [];
  return (r) => predictLogistic(beta, def.signal.map((s, k) => featureValue(r, s) / sc[k]), def.intercept);
}

function breakdowns(rows, preds, kind) {
  const pick = (pred) => rows.map((r, i) => ({ p: preds[i], y: r.y, r })).filter((x) => pred(x.r));
  const S = (pred) => { const z = pick(pred); return z.length ? summarize(z) : null; };
  const out = {
    street: S((r) => r.context.street), permanent: S((r) => !r.context.street),
    speed_high: S((r) => r.context.speed_class === 'high'), speed_medium: S((r) => r.context.speed_class === 'medium'), speed_low: S((r) => r.context.speed_class === 'low'),
  };
  if (kind === 'pair') {
    Object.assign(out, { teammate: S((r) => r.teammate), cross_team: S((r) => !r.teammate), rookie_involved: S((r) => r.context.rookie_a || r.context.rookie_b), veterans_only: S((r) => !r.context.rookie_a && !r.context.rookie_b) });
  } else Object.assign(out, { rookie: S((r) => r.context.rookie_a), veteran: S((r) => !r.context.rookie_a) });
  return out;
}

const results = { generated_by: 'scripts/edge/train-eval.mjs', dataset_sha256: datasetSha, feature_version: FEATURE_VERSION, protocol: { selection_train: SEL_TRAIN, selection_validate: SEL_VAL, test_years: TEST_YEARS, shadow: SHADOW, min_gain: MIN_GAIN }, models: {} };
const artifacts = {};
for (const name of Object.keys(MODEL_SPECS)) {
  const spec = MODEL_SPECS[name];
  const rows = byTarget(spec.target);
  const sel = select(spec, rows);
  const names = sel.selected;
  const defs = baselineDefs(name);
  const perSeason = {};
  const pooled = { model: [], rows: [] };
  const pooledBase = Object.fromEntries(defs.map((d) => [d.id, []]));
  const shadow = {};
  for (const Y of [...TEST_YEARS, SHADOW]) {
    const train = inSeasons(rows, [SEL_TRAIN[0], Y - 1]);
    const test = rows.filter((r) => r.season === Y);
    if (!test.length) continue;
    const m = fitModel(train, names, spec);
    const pm = test.map((r) => predict(m, r));
    const entry = { n_train: train.length, model: summarize(test.map((r, i) => ({ p: pm[i], y: r.y }))), baselines: {} };
    for (const d of defs) {
      const f = fitBaseline(d, train);
      const pb = test.map((r) => f(r));
      entry.baselines[d.id] = summarize(test.map((r, i) => ({ p: pb[i], y: r.y })));
      if (Y !== SHADOW) pooledBase[d.id].push(...pb);
    }
    if (Y === SHADOW) {
      Object.assign(shadow, entry, { teammate: spec.kind === 'pair' ? summarize(test.map((r, i) => ({ p: pm[i], y: r.y })).filter((_, i) => test[i].teammate)) : null });
      continue;
    }
    perSeason[Y] = entry;
    pooled.model.push(...pm);
    pooled.rows.push(...test);
  }
  const prs = pooled.rows;
  const pooledModel = summarize(prs.map((r, i) => ({ p: pooled.model[i], y: r.y })));
  const pooledBaselines = {};
  const vsBaseline = {};
  for (const d of defs) {
    pooledBaselines[d.id] = summarize(prs.map((r, i) => ({ p: pooledBase[d.id][i], y: r.y })));
    vsBaseline[d.id] = pairedLogLossDiff(prs.map((r, i) => ({ p: pooled.model[i], y: r.y })), prs.map((r, i) => ({ p: pooledBase[d.id][i], y: r.y })), (i) => prs[i].event_id);
  }
  // Verdict: the model must beat EVERY baseline by more than 2 event-clustered standard errors of log loss.
  const verdict = Object.fromEntries(Object.entries(vsBaseline).map(([b, v]) => [b, v.mean_diff + 2 * v.se < 0 ? 'beats' : v.mean_diff - 2 * v.se > 0 ? 'worse' : 'not_distinguishable']));
  const beatsAll = Object.values(verdict).every((v) => v === 'beats');
  const tmIdx = prs.map((r, i) => i).filter((i) => prs[i].teammate);
  const teammateSubset = spec.kind === 'pair' ? {
    model: summarize(tmIdx.map((i) => ({ p: pooled.model[i], y: prs[i].y }))),
    baselines: Object.fromEntries(defs.map((d) => [d.id, summarize(tmIdx.map((i) => ({ p: pooledBase[d.id][i], y: prs[i].y })))])),
  } : null;
  const buckets = spec.kind === 'pair' ? favouriteBuckets(prs.map((r, i) => ({ p: pooled.model[i], y: r.y }))) : probBuckets(prs.map((r, i) => ({ p: pooled.model[i], y: r.y })));
  results.models[name] = {
    version: MODEL_VERSIONS[name], target: spec.target, cutoff: spec.cutoff, selection: sel,
    per_season: perSeason, pooled_test: { seasons: TEST_YEARS, model: pooledModel, baselines: pooledBaselines, model_minus_baseline_logloss_event_clustered: vsBaseline, verdict, beats_all_baselines: beatsAll, teammate_subset: teammateSubset, buckets, breakdowns: breakdowns(prs, pooled.model, spec.kind) },
    shadow_2026_to_date: shadow,
  };

  // ---- freeze: trained on every eligible season through 2025 ----
  const final = fitModel(inSeasons(rows, [SEL_TRAIN[0], 2025]), names, spec);
  const art = {
    version: MODEL_VERSIONS[name], status: 'research (not an official pick model)', beats_all_baselines_walk_forward: beatsAll, verdict_vs_baselines: verdict, target: spec.target, kind: spec.kind, cutoff: spec.cutoff,
    features: final.features, scale: final.scale.map((x) => Number(x.toPrecision(12))), beta: final.beta.map((x) => Number(x.toPrecision(12))), intercept: final.intercept,
    train_seasons: [SEL_TRAIN[0], 2025], dataset_sha256: datasetSha, feature_version: FEATURE_VERSION,
    bt_config: { quali: BT_QUALI, race: BT_RACE }, forbidden_features: FORBIDDEN_MODEL_FEATURES, market_inputs: 'none (sportsbook odds are never model features)',
  };
  const artText = stableStringify(art);
  fs.writeFileSync(path.join(REP, 'artifacts', `${name}.json`), JSON.stringify(art, null, 2) + '\n');
  artifacts[name] = { version: art.version, file: `reports/edge/artifacts/${name}.json`, params_sha256: sha256(artText), features: art.features };
  console.log(name, 'selected', names.join(','), 'pooled', JSON.stringify(pooledModel));
}
const featureSnapshot = { feature_version: FEATURE_VERSION, pair_features: PAIR_FEATURES };
const freeze = { dataset_sha256: datasetSha, feature_snapshot_sha256: sha256(stableStringify(featureSnapshot)), feature_version: FEATURE_VERSION, artifacts };
fs.writeFileSync(path.join(REP, 'walk-forward.json'), JSON.stringify(results, null, 2) + '\n');
fs.writeFileSync(path.join(REP, 'artifacts', 'FREEZE.json'), JSON.stringify(freeze, null, 2) + '\n');
console.log(JSON.stringify(freeze, null, 2));
