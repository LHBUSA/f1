# PBE F1 EDGE — research core (v0.1.0-research)

Branch `f1-edge` only. Not deployed and not wired into the site. **No official picks:** the pick policy returns
`NO_OFFICIAL_PICK` by default, and no odds data exists anywhere in this repo.

Reproduce (the data comes from `data/normalized`, which is gitignored):

```
node scripts/edge/build-dataset.mjs   # dataset + leakage audit (~40 s)
node scripts/edge/tune-bt.mjs         # BT hyper-parameters, 2014-2021 events only (~5 min)
node scripts/edge/train-eval.mjs      # feature selection, walk-forward, baselines, freeze (~30 s)
npm test                              # includes tests/edge-*.test.mjs
```

Two full rebuilds produced byte-identical `FREEZE.json` (same dataset hash and same artifact hashes).

## 1. Dataset depth

| | |
|---|---|
| Source | ESPN-derived normalized graph. Only `events`, `sessions`, `classifications` and `constructors` are read, plus static circuit metadata (`derived/circuits`, `derived/event_circuits`) |
| Session-level qualifying | **2009–2026** (371 sessions). Q1/Q2/Q3 split times only from **2024**. Before that the source has only `best_lap_ms` |
| Events built | 361 completed Grands Prix, 2009 R1 → 2026 R15 (2026-09-24) |
| Eligible rows | from 2011 (2009–2010 are burn-in for the as-of histories) |
| `quali_h2h` | 75,851 pairs (67,757 eligible; 3,768 teammate pairs) — every driver pair in each session |
| `race_h2h` | 75,450 pairs (67,383 eligible; 3,745 teammate). Starters only. Order is classified position, then cars without a position ranked by laps completed, then DSQ last. A tie is void |
| `top10` | 7,538 driver-races (6,770 eligible) |
| Dataset sha256 | `c1d7369aa60d0e5e09c249d9f8fa70f594421a9c084e8d0608119a8f6c84e3cf` (`data/edge/dataset.jsonl`, 205 MB, not committed) |

Each row carries `event_id, season, round, circuit_id, target, a, b, y, teammate, feature_as_of, event_start,
features{}, context{}, source_coverage{}, eligible`. Race rows also carry `post_qualifying{grid_a, grid_b,
available_before = race start}`. The grid is the only information from the same weekend, and only the
post-qualifying models may use it (enforced by `assertAllowed`).

## 2. Time safety and leakage audit — PASS (`leakage-audit.json`)

- **Cutoff:** `event_start` is the first session of the weekend. Features read sessions only through `prefixBefore`,
  which applies a strict `t < cutoff`.
- **Check 1:** `feature_as_of < event_start` held on all 158,839 rows (0 violations). The BT sources were checked the
  same way.
- **Check 2 (truncated recompute):** for 16 sampled events (2009 R1 … 2026 R15), features were rebuilt from a copy of
  the source with every session at or after the event start deleted. All 16 were identical, and identical again on a
  second full recompute.
- **Check 3 (negative control):** moving the cutoff one week past the event start must make check 2 fail. It failed in
  3 of 3 cases, so the audit does detect leakage.
- **Check 4 (static inputs):** the loader reads only allow-listed tables. No end-of-season standings, DNA, Circuit Fit,
  teammates, matchups or progression files are read. No edge model or feature module touches the filesystem.
- **Rebuilt as-of instead of reused from leaky globals:**
  - championship points and position, computed from race rows before the event (round 1 uses last season's final
    order, computed the same way);
  - the grid-gain expectation table;
  - circuit speed classes (pole-lap speed over the 5 prior seasons);
  - circuit track-position and overtaking percentiles.

## 3. Models

**Strength model (`src/edge/bt.mjs`).** A time-decayed, regularized Bradley–Terry model:

- strength = θ_driver + φ_(constructor lineage, season);
- shrinkage: θ ~ N(0, 1/λ_d), so drivers with few comparisons (rookies) and unseen drivers stay at the field mean;
- φ follows a random walk across seasons of the same lineage, giving partial pooling of the car toward last year;
- fitted with Newton's method from a zero start, so it is deterministic.

Hyper-parameters were chosen on 2014–2021 events only (`bt-tuning.json`):

| | τ (days) | λ_d | λ_rw |
|---|---|---|---|
| Qualifying | 120 | 0.5 | 1 |
| Race | 365 | 2 | 4 |

The race optimum sits on the grid edge, but the top 3 configurations differ by less than 0.001 log loss.

**Stacked models (`src/edge/models.mjs`).** L2 logistic regression on as-of features. Pair models have no intercept and
use only (a − b) features, so p(a, b) = 1 − p(b, a) exactly. Feature selection:

- train 2011–2017, validate 2018–2021;
- each candidate is first tested alone on top of the core BT feature;
- greedy forward selection then keeps a feature only if it improves validation log loss by at least 0.0005;
- test seasons were never seen during selection.

**Walk-forward:** train on 2011..Y−1 and test on Y, for Y = 2022–2025. The 2026 shadow trains on 2011–2025.

## 4. Walk-forward results (pooled 2022–2025, 92 events)

The difference column is model minus baseline log loss, averaged per event, ± 1 standard error. Negative means the
model is better. A verdict of "beats" requires the difference to be below −2 SE.

### Qualifying H2H — `f1-edge-quali-h2h@0.1.0-research`

| | n | log loss | Brier | acc | Δ vs model |
|---|---|---|---|---|---|
| **Stacked model** | 17,460 | **0.4792** | 0.1566 | 0.772 | |
| 50/50 | | 0.6931 | 0.2500 | 0.500 | −0.214 ± 0.012 |
| Championship position before event | | 0.5250 | 0.1740 | 0.749 | −0.046 ± 0.008 |
| Points before event | | 0.5835 | 0.1819 | 0.737 | −0.105 ± 0.014 |
| Circuit Fit ranking (as-of rebuild) | | 0.5531 | 0.1859 | 0.720 | −0.074 ± 0.008 |
| Teammate H2H record | | 0.6676 | 0.2375 | 0.598 | −0.189 ± 0.012 |
| Raw BT, uncalibrated | | **0.4764** | 0.1560 | 0.773 | **+0.003 ± 0.003** |

**Honest result:** the stacked qualifying model does not beat its own core BT strength; the gap is not
distinguishable from zero. The five extra features chosen by 2018–2021 validation did not carry over to 2022–2025.
Recommendation: shadow-track the raw BT strength (`q_bt`) as the qualifying champion.

- Teammate pairs (n = 919): model 0.570, raw BT 0.579, teammate H2H record 0.610, championship position 0.674.
- Per season, model vs raw BT: 2022 0.445/0.449, 2023 0.536/0.531, 2024 0.467/0.460, 2025 0.471/0.468.
- Calibration: intercept 0.02, slope 0.90 (slightly overconfident), ECE 0.017.
- 2026 shadow (15 events, n = 3,465): log loss 0.339, accuracy 0.851 (raw BT 0.344, championship position 0.410).
  Calibration intercept −0.25 and slope 1.29: the model is under-confident in the new regulations era.

### Race H2H, pre-qualifying — `f1-edge-race-h2h-pre@0.1.0-research`

Beats every baseline.

| | log loss | Brier | acc | Δ |
|---|---|---|---|---|
| **Model** (r_bt + pair_q_h2h + con_gap_pole + cf_car_speed + rookie) | **0.5354** | 0.1784 | 0.737 | |
| Raw race BT | 0.5403 | 0.1802 | 0.731 | −0.005 ± 0.0025 |
| Championship position | 0.5632 | 0.1898 | 0.723 | −0.028 ± 0.005 |
| Points before | 0.5768 | 0.1931 | 0.716 | −0.042 ± 0.009 |
| Circuit Fit ranking | 0.5847 | 0.2000 | 0.694 | −0.049 ± 0.005 |
| Teammate H2H record | 0.6786 | 0.2428 | 0.572 | −0.143 ± 0.011 |

- Calibration: intercept −0.04, slope 1.07, ECE 0.015.
- Teammate pairs: 0.625 vs 0.650 for the teammate record.
- 2026 shadow: 0.552 (championship position 0.555). Calibration intercept −0.33: drifting.

### Race H2H, post-qualifying (grid known) — `f1-edge-race-h2h-post@0.1.0-research`

Beats every baseline, including the grid.

| | log loss | Brier | acc | Δ |
|---|---|---|---|---|
| **Model** (r_bt + grid_logratio + pair_q_h2h + grid_diff) | **0.4989** | 0.1630 | 0.767 | |
| Qualifying grid only | 0.5294 | 0.1749 | 0.750 | −0.030 ± 0.006 |
| Raw race BT | 0.5403 | | | −0.042 ± 0.006 |
| Championship position | 0.5632 | | | −0.065 ± 0.008 |

- Calibration: slope 1.11 (under-confident around 0.70–0.80: predicted 0.725–0.775, observed 0.79–0.84). ECE 0.031.
- 2026 shadow: 0.523 vs 0.542 for the grid alone.

### Top-10 (research)

Both variants beat all baselines.

| | log loss | Brier | acc | Δ vs best baseline |
|---|---|---|---|---|
| Pre-qualifying (r_bt, q_bt, champ_pos, race_gains) | 0.5091 | 0.1668 | 0.766 | −0.026 ± 0.007 vs championship position (0.535) |
| Post-qualifying (+ grid) | 0.4681 | 0.1503 | 0.786 | −0.038 ± 0.008 vs grid (0.507) |

Calibration intercept is about +0.2: the model under-predicts mid-probability drivers (predicted 0.4–0.5, observed
0.55).

**Breakdowns.** Every breakdown (street/permanent, speed class, rookie/veteran, teammate/cross-team, probability
buckets) is in `walk-forward.json`. Street circuits score worse than permanent ones (race pre-qualifying 0.573 vs
0.527). For rookie-involved pairs, qualifying is 0.498 vs 0.477 for veteran-only pairs.

## 5. Features

- **Kept** (forward-selected; frozen in the artifacts):
  - Qualifying H2H: q_bt, race_gains, r_bt_car, teammate × tm_gap_decay, con_gap_pole, cf_car_speed. These did not
    generalize; see §4.
  - Race pre-qualifying: r_bt, pair_q_h2h, con_gap_pole, cf_car_speed, rookie.
  - Race post-qualifying: r_bt, grid_logratio, pair_q_h2h, grid_diff.
  - Top-10 pre-qualifying: r_bt, q_bt, champ_pos_before, race_gains.
  - Top-10 post-qualifying: r_bt, grid_log, grid_top10, champ_pos_before, rookie, race_gains, con_gap_pole,
    q_bt_driver.

- **Circuit Fit components, tested one at a time** (change in validation log loss on top of the core; negative helps):

  | Component | Quali | Race pre | Race post |
  |---|---|---|---|
  | cf_car_speed | −0.0006 | −0.0006 | −0.0003 |
  | cf_gains_x_overtaking | −0.0020 | +0.0002 | +0.0001 |
  | cf_q_x_track_position | ≈0 | −0.0005 | ≈0 |
  | cf_car_qualifying | −0.0001 | −0.0002 | +0.0003 |
  | cf_street | +0.0001 | ≈0 | ≈0 |
  | cf_driver_speed | +0.0001 | +0.0006 | +0.0003 |

  Only cf_car_speed survived selection. The 0-100 `cf_score` is used only as a baseline and the model guard rejects
  it.

- **Rejected for no incremental value:** a change in validation log loss of at least 0, or not picked by forward
  selection. Full table in `walk-forward.json` → `selection.single_feature_tests`.
  - Street and speed-class interactions (street_driver, street_con, speed_driver).
  - Circuit history (circ_tm_gap, circ_r_h2h; circ_pctl is marginal).
  - Teammate gap season/recent as global features. They only help as teammate-only interactions.
  - log_starts, and the driver/car BT sub-components where the total is already present.

- **Rejected as leaky (never built):**
  - `standings.json` (end-of-season standings).
  - Published DNA: driver/constructor DNA is built from the current window and circuit DNA from current-10 seasons.
  - Published `circuit_fit.json` (today's DNA applied to past events).
  - derive.mjs speed classes and expected-gain tables (they include future seasons).
  - teammates/matchups/progression aggregates.
  - The target event's own qualifying or finish (pre-qualifying models).
  - Practice and sprint sessions of the same weekend (after `event_start`; candidate for a later post-practice
    variant).
  - Sportsbook odds: never model features, enforced by `assertAllowed` and covered by tests.

- **Data caveats:**
  - Before 2024 the only qualifying time is `best_lap_ms`, so a "deepest common session" before 2024 means best lap
    vs best lap (same rule as `derive.mjs`).
  - Career starts are counted from 2000, so the rookie flag is approximate for 2009 veterans.
  - Classifications are final, post-stewards versions; as features they are always from earlier events.

## 6. Frozen artifacts (`reports/edge/artifacts/`, `FREEZE.json`)

All five artifacts were trained on 2011–2025.

| Item | Version | sha256 |
|---|---|---|
| Dataset | f1-edge-dataset@0.1.0 | `c1d7369aa60d0e5e09c249d9f8fa70f594421a9c084e8d0608119a8f6c84e3cf` |
| Feature snapshot | f1-edge-features@0.1.0 | `998e9820e4370505859bfa954780a124bbcec78139f0ff676dab00b3151177cf` |
| Qualifying H2H params | f1-edge-quali-h2h@0.1.0-research | `c33e83a7c157581c4dbf27e9868be48b9433fee26e8efc991c53c4d28eb36862` |
| Race H2H pre-qualifying params | f1-edge-race-h2h-pre@0.1.0-research | `f886e70be74a93eff94efa9985ad4ca5cec126448039d13063e50af2bdacffe2` |
| Race H2H post-qualifying params | f1-edge-race-h2h-post@0.1.0-research | `3f6d3b54716b250778c3d4ce1a3c4a4f2b161b4d45b00d89496bb75da654cd18` |
| Top-10 pre-qualifying params | f1-edge-top10-pre@0.1.0-research | `4f665bc2d063ab21b10103a05d617b409336c0244134c73777f29c6e6f8478a1` |
| Top-10 post-qualifying params | f1-edge-top10-post@0.1.0-research | `c92d9341f168c497823bf7164d764fb36101fdc8983e61fffd48098f0d47c807` |

## 7. Value and ledger scaffolding (no odds data)

- **`market.mjs`**
  - Canonical quote schema with these fields: provider, sportsbook, provider_event_id, canonical_event_id, market,
    selection, opponent, line, american_odds, decimal_odds, provider_updated_at, captured_at, source_id.
  - American/decimal conversion.
  - Two-way multiplicative de-vig: raw implied probability, overround and no-vig probability.
  - Consensus: a plain mean of each book's no-vig probability, using only books that quote both sides of the identical
    proposition (same line). Excluded books are listed with the reason.
- **`value.mjs`:** pbe_probability, fair decimal and American odds, raw and no-vig market probability, edge_pp,
  EV per unit.
- **`policy.mjs`:**
  - The default result is `NO_OFFICIAL_PICK`.
  - A pick needs thresholds preregistered before lock and bound to the artifact sha, a priced quote captured before
    lock, and a promoted model.
  - `OFFICIAL_PICKS_ENABLED = false`, so the best possible outcome now is `SHADOW_CANDIDATE`.
- **`ledger.mjs`:**
  - An append-only, hash-chained ledger of frozen events: PICK at lock, SETTLE separately.
  - A pick without a quote, or with a quote captured after lock, is `UNPRICED` forever. It counts in W/L, never gets a
    price later, and is excluded from ROI.
  - The record carries the model version plus artifact, dataset and feature-snapshot SHAs.
- **Tests:** `tests/edge-market.test.mjs` (9) and `tests/edge-core.test.mjs` (6). The full suite passes, 49/49.

## 8. Open blockers (owner)

1. **Odds provider.** The Odds API does not support F1 (UNSUPPORTED, verified 2026-10-02). There is no compliant
   source of F1 H2H or Top-10 prices, so value cannot be measured. Per the global data policy, no paid feeds without
   approval.
2. **Lock timing probes.** We need to measure when H2H markets open and close relative to FP1, qualifying and the race,
   to set the lock for each variant. The post-qualifying variant needs grid publication time after penalties.
3. **Settlement rules.** Per-book H2H rules differ: both DNF (laps vs void), DSQ after the race, DNS (void), and grid
   penalties. Our target definition is one choice and must match the chosen book's rules before any ledger use.
4. **Qualifying champion.** The stacked qualifying model failed to beat raw BT, so raw `q_bt` should be the shadowed
   qualifying model. A v0.2 should use a stricter selection margin or a longer validation window.
5. **2026 drift.** The new regulations era shows calibration intercepts of −0.25 to −0.33 on race models in the shadow.
   Monitor it, and consider in-season recalibration (time-safe) before any promotion.
6. **Shadow phase.** Preregister thresholds (edge, EV, overround, minimum books) bound to the artifact SHAs, then run
   at least one full shadow window with frozen artifacts before any official pick.
7. **Owner sign-off** is needed on the protocol, the target definitions and any promotion. Nothing is deployed.
