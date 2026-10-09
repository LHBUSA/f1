# F1 Race Picks V1 (`f1-picks-1.0.0`) — status: SHADOW

- Protocol (committed before the holdout): `PROTOCOL.md`. Tuning: `tuning-v1.json`. Metrics: `metrics-v1-validation.json`,
  `metrics-v1-holdout.json` (holdout run once). Lock evidence (hashes/ids only): `locks.json`.
- Model `src/picks/model.mjs`; lane/ledger `src/picks/lane.mjs`; Worker step `workers/f1-api/src/picks.js` (inside the
  existing `*/10` cron); member route `GET /v1/f1/picks` (All Access; free = teaser without values); UI `src/web/race-picks.js`
  on `/race-lab`.

## Holdout 2023 → 2026 R16 (86 races; lower log loss is better)

| Family / version | n | Model LL | Best baseline (LL) | Gate |
|---|---|---|---|---|
| Race winner, pre-qualifying | 86 | 1.816 | driver standing 1.791 | RESEARCH |
| Race winner, post-qualifying | 86 | 1.401 | grid 1.429 (CI crosses 0) | RESEARCH |
| Top 10, pre-qualifying | 1745 | 0.509 | driver standing 0.525 (CI crosses 0) | RESEARCH |
| Top 10, post-qualifying | 1745 | 0.459 | grid 0.483 | BACKTEST-PASS |
| Podium, pre-qualifying | 1745 | 0.272 | driver standing 0.281 (CI crosses 0) | RESEARCH |
| Podium, post-qualifying | 1745 | 0.229 | grid 0.241 | BACKTEST-PASS |
| Teammate quali H2H | 872 | 0.602 | season record 0.600 | RESEARCH |
| Teammate race H2H, pre-qualifying | 648 (224 VOID) | 0.636 | season record 0.632 | RESEARCH |
| Teammate race H2H, post-qualifying | 648 | 0.530 | qualified-ahead 0.590 | BACKTEST-PASS |

Winner top-1: model pre 43.0% / post 62.8%; favorite (standings leader) 45.3%; grid 62.8%. Outside the chalk (model
favorite ≠ standings leader, 41 races) the model's pick won 10, the leader 12 — no evidence of a winner edge.
BACKTEST-PASS is not "validated": prospective locks stay SHADOW; promotion is an owner decision after a prospective sample.

## Operations
- Locks: `picks/v1/locks/<event>/<pre_qualifying|post_qualifying>.json` in private R2 `f1-data`, create-only
  (`onlyIf etagDoesNotMatch '*'`). Pre-qualifying window: 6 h → 10 min before qualifying; post-qualifying: after the
  qualifying classification is ingested → 10 min before the race. Settlements are append-only revisions.
- Manual lock (same code): `node scripts/picks/lock.mjs --event <slug> --version <v> [--put]`.
- Proofs: `POST /v1/f1/admin/picks/proof` (concurrent create-only), `GET /v1/f1/admin/picks/status` (last cron step).
