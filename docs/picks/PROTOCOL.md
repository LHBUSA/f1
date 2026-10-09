# F1 Race Picks V1 — pre-registered evaluation protocol

Status: **RESEARCH / SHADOW**. Written and committed before the out-of-time holdout was computed (git history is the
timestamp). Model: `src/picks/model.mjs` (`f1-picks-1.0.0`). Evaluation: `scripts/picks/evaluate.mjs`.

## Data (time-safe, rights-clean)
- Only the existing captured ESPN-core-derived history in `data/normalized` (events, sessions, classifications).
  No Formula1.com / FIA / OpenF1 / Jolpica / live-timing data. No odds. Missing means missing.
- Inputs: official qualifying classification positions, race classification positions and statuses, constructor
  identity (lineage), circuit id. Practice, sprint, weather, tyres and lap data are NOT used in V1.
- Every prediction for event E is computed from the state built from events strictly before E (start-time order).
  The post-qualifying version additionally sees E's official qualifying classification (never the race grid,
  which includes penalties applied later).
- Circuit Fit (`scripts/derive.mjs`) is DESCRIPTIVE and computed from full-history DNA percentiles, so it is not
  time-safe and is NOT a model input. Instead a time-safe circuit residual (driver race residual at this circuit,
  shrunk) is tested as a hyperparameter (`wC ∈ {0, 0.5}`); if tuning selects 0, circuit history is not used.

## Folds
- Warm-up (state only, never scored): 2006–2013.
- Tuning (hyperparameters + all PL scales, model AND baselines): 2014–2019.
- Validation (reported, not used for selection): 2020–2022.
- Holdout (reported ONCE, after this file is committed): 2023 → 2026 round 16 (Malaysia).
- Walk-forward everywhere: ratings update after each event; no parameter is refit inside validation/holdout.

## Families and outcome contracts
1. **Teammate qualifying H2H** — graded on the official qualifying classification (position), where both
   teammates have one. Grid penalties never change it. Missing classification / DNS / time deleted with no
   position → VOID.
2. **Teammate race H2H** — matches the repo's matchup semantics: graded only when BOTH teammates are classified
   with distinct positions. A retirement never hands the other driver a win → VOID.
3. **Driver outperformance** — per driver P(top 10) and P(podium) on the race classification; DNS → VOID;
   DNF/DSQ/not classified → NO. Projected position = expected classified rank (MAE vs actual, classified only).
4. **Full-field race winner** — probabilities over the locked field plus an explicit `other` mass (0.002) for a
   winner outside it; sums to 1.
- Race families have two separately locked versions: **pre-qualifying** and **post-qualifying**. A post-qualifying
  lock never replaces a pre-qualifying lock.

## Baselines (same DNF layer and Plackett-Luce machinery, own scale fitted on the tuning folds)
- Field-equal (uniform), constructor standing to date (previous season's final order at round 1),
  driver standing to date, previous-race order; post-qualifying adds **qualifying classification order (grid)**.
- Teammate H2H: coin (0.5), pair season-to-date record (Laplace), post-qualifying race H2H adds
  "qualified ahead" with a fitted constant probability.
- Favorite: top-1 of the driver-standing baseline (reported as top-1 accuracy only).
- Market: no historical market data exists in this repo → no backtest market comparison. Prospectively, the
  race-winner contract (COMPARABLE_EXCEPT_EXCEPTIONS) snapshot at lock is recorded as a benchmark only.

## Metrics
Log loss, Brier, ECE (10 equal-width bins) with reliability bins, top-1 / top-3 (winner), accuracy (H2H),
MAE (projected position), every one with its denominator n and VOID count.

## Pre-registered gate (per family and version, on the holdout only)
A family/version is **BACKTEST-PASS** only if its holdout log loss is lower than EVERY baseline's, AND the paired
event-level bootstrap (2,000 resamples, seed 7) 95% interval of (model − best baseline) log loss lies entirely
below 0. Otherwise it is **RESEARCH**. Neither label is "validated/official": prospective locks stay SHADOW and
the public record starts at the first real lock (`locked_at < session start` proven). Promotion to an official,
member-facing pick label is an owner decision after a prospective sample; nothing auto-promotes.
