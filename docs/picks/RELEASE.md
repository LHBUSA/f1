# F1 Race Picks V1: release runbook (research-only, Singapore post-qualifying window)

Owner decision 10-09: conditional approval for a RESEARCH-only release in the post-qualifying window. HOLD rather
than force the deadline if anything risks live coverage.

## Window
- Singapore: qualifying 2026-10-10 13:00Z, race 2026-10-11 12:00Z (repo season fragment; sprint 10-10 09:00Z).
- **Earliest:** qualifying finished (`/v1/f1/live` session `qualifying` state `post`), not before **10-10 14:00Z**.
- **Latest:** **10-11 10:00Z** (2 h before the race). Target 14:30–16:00Z on 10-10, so a failed step still leaves
  time for the manual fallback below.
- Never deploy while any session is live or within 2 h before one.

## Rollback snapshot (re-check right before deploying; if either changed, stop and rebase onto that source)
- f1-api Worker: `7434fe50-d9cc-475e-b550-60b15cbf54d8` (main 3f1a876, deployed 2026-10-07T19:17Z).
- Vercel production (project f1): `dpl_8s83zFAG4vHTWfYdcAHZhPFghy7T` (main c0c1357, READY).
- origin/main: `c0c1357`. Branch `f1-race-picks-v1` = c0c1357 + picks commits only (fast-forward).

## Unchanged-surface evidence (prepared 10-09)
- Bundle sections (wrangler dry-run, 3f1a876 vs branch): IDENTICAL `live.js` (LiveHub recorder), `access.js`
  (All Access), `ingest.js` (ingest + deploy hook), `newsroom.js` (heartbeat), `frames.js`, `incidents.mjs`,
  `progress.mjs`, `projection.js`, `transport.js`, `weather.js`, `extract.mjs`, `normalize.mjs`.
  CHANGED `index.js` only (+`/picks` route, `/admin/picks/*`, one `.then(picksTick)` appended to the existing
  `*/10` chain after the newsroom step, with its own catch). ADDED `picks.js`, `src/picks/*`, `constructors.mjs`.
- Site: `src/web/pbecast.js`, `src/core/progress.mjs` (progress.ba267c7216), `src/web/race-lab.js`, nav, account,
  `vercel.json`, `scripts/derive.mjs`: no diff vs c0c1357. Styles: append-only `.rp-*`.
- `npm test` 172/172 pass (the 3 matchup failures were stale fixtures, fixed test-only in afc9add).

## Steps
1. `cd D:/Workers/f1 && git fetch && git status` (clean, on `f1-race-picks-v1`, HEAD == origin) and
   `git log origin/main -1` == c0c1357.
2. `cd workers/f1-api && npx wrangler deployments list` → latest is still 7434fe50 (else STOP).
3. `curl -s https://propsports.proptechusa.ai/v1/f1/live` → no session `live`; qualifying `post`.
4. Upload then promote:
   `npx wrangler versions upload --message "race picks v1 research lane (branch <sha>); rb 7434fe50"`
   `npx wrangler versions deploy <new-version-id>@100% --message "race picks v1; rb 7434fe50" -y`
5. Smoke (no prod-site polling): `GET https://f1-api.propbetedge.ai/v1/f1/health` 200;
   `/v1/f1/live` 200; `/v1/f1/picks` without a cookie → 403 with `teaser` (no values).
6. Real R2 duplicate-lock proof:
   `curl -s -X POST -H "authorization: Bearer $(cat D:/Workers/secrets/f1-admin-token)" https://f1-api.propbetedge.ai/v1/f1/admin/picks/proof`
   → `pass: true`, exactly one `created: true` of three concurrent writers.
7. After the next real cron tick (≤10 min):
   `GET /v1/f1/admin/picks/status` (admin bearer) → `at` within the last 10 min, and either
   `{lock: ".../post_qualifying.json", result: "created", sha256, uploaded}` or `held_field_incomplete` (fragment
   not ingested yet; check again next tick). Cross-check with the Cloudflare R2 object listing
   (`picks/v1/locks/2026-singapore-grand-prix/`) for `last_modified`.
8. Post-qualifying lock verification: download the object, `sha256sum` == status sha256, `locked_at` <
   `event.race_start` (2026-10-11T12:00Z), `version` = `post_qualifying`, `data.last_completed_event` =
   espn-600060990 (Malaysia), entrants 22. Record hash + ids (never the payload) in `docs/picks/locks.json`.
9. UI (Vercel production): `git checkout main && git merge --ff-only f1-race-picks-v1 && git push origin main`
   only after steps 5–7 pass. Verify via the Vercel API (deployment READY, commit = branch head), then ONE real
   Chrome pass of /race-lab (free teaser; member view if the owner is signed in). Do not script-poll the site.
10. Rollback: Worker `npx wrangler versions deploy 7434fe50-d9cc-475e-b550-60b15cbf54d8@100% -y`; site
    promote/rollback to `dpl_8s83zFAG4vHTWfYdcAHZhPFghy7T`. Locks already written stay (immutable, private).

## Fallback if the Worker is not deployed in time
`node scripts/picks/lock.mjs --event 2026-singapore-grand-prix --version post_qualifying --put` (same lane code,
create-only check, private R2), after qualifying is classified in the fragment and ≥10 min before the race.
