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
| Top 10, post-qualifying | 1745 | 0.459 | grid 0.483 | gate pass |
| Podium, pre-qualifying | 1745 | 0.272 | driver standing 0.281 (CI crosses 0) | RESEARCH |
| Podium, post-qualifying | 1745 | 0.229 | grid 0.241 | gate pass |
| Teammate quali H2H | 872 | 0.602 | season record 0.600 | RESEARCH |
| Teammate race H2H, pre-qualifying | 648 (224 VOID) | 0.636 | season record 0.632 | RESEARCH |
| Teammate race H2H, post-qualifying | 648 | 0.530 | qualified-ahead 0.590 | gate pass |

Winner top-1: model pre 43.0% / post 62.8%; favorite (standings leader) 45.3%; grid 62.8%. Outside the chalk (model
favorite ≠ standings leader, 41 races) the model's pick won 10, the leader 12 — no winner-prediction advantage has been established.
A gate pass is not "validated": every family is labelled RESEARCH and every lock is SHADOW; promotion is an owner decision after a prospective sample.

## Publication policy (owner, 10-09)
Members see ONLY post-qualifying top 10 / podium and teammate race H2H (the gate-passing families) as RESEARCH predictions, plus race-winner model probabilities beside the market benchmark with the note that no winner-prediction advantage has been established. Pre-qualifying families and teammate qualifying H2H are locked and graded internally as SHADOW research and are never served (`PUBLISHED` in `src/picks/lane.mjs`, enforced server-side in `picksPayload`).

## Product surfaces (issue #8, 10-09)
`/picks` and `/track-record` (desktop + mobile primary nav, Race Lab hero) mount `src/web/race-picks.js`, which never removes itself: it always shows the current/next Grand Prix status from `weekend` (`awaiting_qualifying`, `awaiting_classification`, `lock_due`, `held_field_incomplete`, `locked`, `graded`, `window_closed`, `season_complete`), the publication rule (Grand Prix qualifying only; sprint qualifying never opens the window), the permanent prospective record (W/L/VOID/PENDING + log loss / Brier, published locks of every season) and lock evidence (lock id, locked_at, sha256, settlement). Errors render "temporarily unavailable". Guests (403 teaser) get status, record aggregates and evidence only — never selections, probabilities, per-pick grades or a lock count that would reveal internal locks. Members additionally get the selections and an event drilldown.

## Operations
- Locks: `picks/v1/locks/<event>/<pre_qualifying|post_qualifying>.json` in private R2 `f1-data`, create-only
  (`onlyIf etagDoesNotMatch '*'`). Pre-qualifying window: 6 h → 10 min before qualifying; post-qualifying: after the
  qualifying classification is ingested → 10 min before the race. Settlements are append-only revisions.
- Manual lock (same code): `node scripts/picks/lock.mjs --event <slug> --version <v> [--put]`.
- Proofs: `POST /v1/f1/admin/picks/proof` (concurrent create-only), `GET /v1/f1/admin/picks/status` (last cron step).
