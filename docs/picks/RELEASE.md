# F1 releases prepared 10-09: Race Picks V1 (research) and the live-header fix

Two SEPARATE releases with separate rollbacks. Owner gate: never deploy while a session is live or within 2 h before
one; HOLD rather than force a deadline if live coverage could be affected. Labels are RESEARCH only; nothing from
the backtest is advertised. Browser QA with mocked membership is "simulated membership", not a verified production
access test.

## Singapore schedule (repo season fragment)
Sprint 10-10 09:00Z · qualifying 10-10 13:00Z · race 10-11 12:00Z.

---------------------------------------------------------------------------------------------------------------------
## A. Race Picks V1 — branch `f1-race-picks-v1` (f1-api Worker + site UI)

### Window
- **Earliest:** qualifying finished (`/v1/f1/live` → session `qualifying`, state `post`), not before **10-10 14:00Z**.
- **Latest:** **10-11 10:00Z** (2 h before the race). Target 14:30–16:00Z on 10-10.

### Rollback snapshot (re-check right before deploying; if either changed, STOP and rebase onto that source)
- f1-api Worker: `7434fe50-d9cc-475e-b550-60b15cbf54d8` (main 3f1a876, 2026-10-07T19:17Z).
- Vercel production (project f1): `dpl_8s83zFAG4vHTWfYdcAHZhPFghy7T` (main c0c1357, READY).
- origin/main `c0c1357`; the branch fast-forwards from it.

### Unchanged-surface evidence (re-verified 10-09 ~13:30Z)
- wrangler dry-run bundles, 3f1a876 vs branch, per module: IDENTICAL `live.js` (LiveHub recorder), `access.js`
  (All Access), `ingest.js` (ingest + deploy hook), `newsroom.js` (heartbeat), `frames.js`, `incidents.mjs`,
  `progress.mjs`, `projection.js`, `transport.js`, `weather.js`, `extract.mjs`, `normalize.mjs`.
  CHANGED `index.js` only (+`/picks`, `/admin/picks/{tick,proof,status}`, one `.then(picksTick)` after the
  newsroom step of the existing `*/10` chain, own catch). ADDED `picks.js`, `src/picks/{model,lane}.mjs`, and the
  existing pure identity module `src/core/constructors.mjs` (newly bundled, unchanged).
- Lane status and verification are written ONLY under `picks/v1/` (`picks/v1/state/lane.json`,
  `picks/v1/state/verify.json`, `picks/v1/verify/...`); nothing under `state/` (recorder/newsroom keys).
- Site: pbecast.js, progress.ba267c7216, race-lab.js, nav, account, vercel.json, derive.mjs unchanged vs c0c1357.
- `npm test` 173/173.

### Persistent verification (every */10 tick inside picksTick; no new cron or resource)
Per lock: sha256 recomputed from the stored R2 bytes vs object metadata / known-hash registry / first-seen anchor;
`locked_at` and the R2 upload precede the session (as locked AND as currently scheduled); once a classified session
is 4 h old a settlement must exist, written after the session start, contiguous revisions tied to this lock's hash.
Result: `picks/v1/state/verify.json`, exposed by `GET /v1/f1/admin/picks/status` (`{lane, verify}`).
FAIL → `console.error('PICKS VERIFY FAIL', …)` (Workers Logs; observability on) + create-only
`picks/v1/verify/fail/<ts>.json`. **f1-api has no alerting binding** (bindings LIVE, DATA, AUTH; secrets
ADMIN/DATASET/PUBLISH tokens, DEPLOY_HOOK_URL), so push/email alerting is an owner decision.

### Steps
1. `cd D:/Workers/f1 && git fetch && git checkout f1-race-picks-v1 && git status` → clean, HEAD == origin;
   `git log origin/main -1` == c0c1357 (if main moved: rebase, re-run the gate).
2. `cd workers/f1-api && npx wrangler deployments list` → latest still 7434fe50 (else STOP).
3. `curl -s https://propsports.proptechusa.ai/v1/f1/live` → no session `live`; qualifying `post`.
4. `npx wrangler versions upload --message "race picks v1 research lane (<sha>); rb 7434fe50"` then
   `npx wrangler versions deploy <new-version-id>@100% --message "race picks v1; rb 7434fe50" -y`.
5. Smoke: `GET https://f1-api.propbetedge.ai/v1/f1/health` 200, `/v1/f1/live` 200,
   `/v1/f1/picks` without cookie → 403 with `teaser` (no values; `latest_event` null until the post lock exists).
6. Real R2 duplicate-lock proof:
   `curl -s -X POST -H "authorization: Bearer $(cat D:/Workers/secrets/f1-admin-token)" https://f1-api.propbetedge.ai/v1/f1/admin/picks/proof`
   → `pass: true`, exactly one `created: true` of three concurrent writers.
7. After the next REAL cron tick (≤10 min): `GET /v1/f1/admin/picks/status` (admin bearer):
   - `lane.at` within 10 min (the existing cron fires the lane);
   - `lane.actions`: `{lock: ".../2026-singapore-grand-prix/post_qualifying.json", result: "created", sha256, uploaded}`
     (or `held_field_incomplete` → wait a tick) and `{settle: ".../pre_qualifying.json", group: "quali", revision: 1}`;
   - `verify.ok: true`; Singapore pre lock `sha256: pass` (registry f8c054aa…cd16), `locked_before_session: pass`,
     `settled_quali: pass`, `settled_race: pending`.
8. Post-qualifying lock: download, `sha256sum` == status sha256, `locked_at` < 2026-10-11T12:00Z, `version`
   post_qualifying, `data.last_completed_event` espn-600060990, 22 entrants. Record hash + ids only in `locks.json`.
9. UI (Vercel production) only after 5–7 pass and outside a session window:
   `git checkout main && git merge --ff-only f1-race-picks-v1 && git push origin main`. Verify via the Vercel API
   (READY, commit = branch head), then ONE real Chrome pass of /race-lab (free view; member view only with the
   owner signed in — anything else is simulated membership). No scripted prod polling.
10. After the race (≥10-11 14:00Z): `settled_race: pass` for both Singapore locks, `verify.ok: true`.
11. Rollback: `npx wrangler versions deploy 7434fe50-d9cc-475e-b550-60b15cbf54d8@100% -y`; site → promote
    `dpl_8s83zFAG4vHTWfYdcAHZhPFghy7T`. Written locks stay (immutable, private).

### Fallback if the Worker is not deployed in time
`node scripts/picks/lock.mjs --event 2026-singapore-grand-prix --version post_qualifying --put` (same lane code,
create-only check, private R2) once qualifying is classified in the fragment and ≥10 min before the race.

---------------------------------------------------------------------------------------------------------------------
## B. Live-header overflow fix — branch `f1-mobile-nav-fix` (site CSS only)

- Cause (pre-existing on c0c1357, only while a session is LIVE): the LIVE pill carries the session label and the
  menu button reserves 116 px for the absolutely positioned account button → overflow 146/106/76/36 px at
  320/360/390/430 and up to 163 px at 1024–1279; account button overlapped the menu button by 4 px at 768–1023.
- Fix: append-only CSS (no markup, no inline styles); idle layout unchanged. Commits e4477a9 (same test-only
  matchup fix as afc9add) + 967666c (CSS + tests/mobile-header.test.mjs).
- Proof: local QA 72 checks PASS (live + idle × 320/360/390/430/768/1024/1100/1280/1440 × 4 pages); before: 28
  failures. Only app.css changes; pbecast.41ec7c863b, progress.ba267c7216, race-lab.f446bb2d82, app.js, nav,
  account unchanged. `npm test` 165/165, source-brand guard PASS, temporal QA PASS.
- Window: own release, never during or within 2 h of a session. Safest **≥ 10-11 14:00Z** (after the race), or the
  post-qualifying window — never in the same push as A.
- Steps: re-check origin/main and the Vercel prod id (= rollback); if A already merged, rebase the branch on
  origin/main and re-run `npm test`; then `git checkout main && git merge --ff-only f1-mobile-nav-fix && git push`.
  Verify via the Vercel API and one real Chrome pass at phone width. Rollback: promote the previous prod deployment.
