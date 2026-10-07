// Newsroom scheduler + health. The F1 newsroom runs inside the production Vercel build (scripts/build-news.mjs), so it
// only evaluates when something rebuilds the site. Session completions trigger a rebuild (ingest.js maybeDeploy); this
// module adds the two things that were missing:
//   1. a heartbeat: a rebuild at least every EVAL_MS when nothing else has evaluated the newsroom (off-weeks, no
//      commits), never while a session is live;
//   2. a build check: a triggered rebuild that has not produced a newsroom run within BUILD_GRACE_MS is retried once
//      (then every EVAL_MS by the heartbeat) and reported as build_failing (the 2026-10-04 race-night rebuilds failed silently for ~6 hours).
// Evidence of a successful run = the `news-health` doc in the ACTIVE projection (written by build-news, published as the
// last build step, so it exists only when the whole build passed).
export const NEWSROOM = {
  EVAL_MS: 6 * 3600e3,
  STALE_AFTER_MS: 7 * 3600e3, // one missed heartbeat + build time
  BUILD_GRACE_MS: 45 * 60e3,
};

const T = (iso) => (iso ? Date.parse(iso) : 0);

/** Pure: what the scheduler should do now, and the newsroom's state. */
export function newsroomState({ now, health, ledger, liveNow = false }) {
  const n = T(now);
  const lastRun = T(health?.run_at);
  const trig = ledger?.last_trigger?.ok ? ledger.last_trigger : null;
  const trigAt = T(trig?.at);
  const awaiting = !!trig && trigAt > lastRun;
  const buildFailing = awaiting && n - trigAt > NEWSROOM.BUILD_GRACE_MS;
  const lastEval = Math.max(lastRun, trigAt);
  let action = 'none';
  if (buildFailing && ledger?.build_retry_for !== trig.at) action = 'build_retry';
  // heartbeat: nothing has evaluated (run or trigger) for EVAL_MS; also the slow retry for a build that keeps failing
  else if (!liveNow && n - lastEval >= NEWSROOM.EVAL_MS) action = 'newsroom_evaluation';
  const status = buildFailing ? 'build_failing' : !lastRun || n - lastRun > NEWSROOM.STALE_AFTER_MS ? 'stale' : 'ok';
  const next = liveNow ? null : new Date(Math.max(n, (lastEval || n) + NEWSROOM.EVAL_MS)).toISOString();
  return { action, status, awaiting_build: awaiting, last_run_at: health?.run_at || null, last_trigger: trig ? { at: trig.at, reason: trig.reason } : null, next_expected_evaluation: next, live_session: !!liveNow };
}

/** Public health payload (no upstream ids, no hook URL). */
export function healthPayload({ now, health, ledger, liveNow }) {
  const s = newsroomState({ now, health, ledger, liveNow });
  return {
    contract: 'f1-newsroom-health/1',
    checked_at: now,
    status: s.status,
    stale: s.status !== 'ok',
    last_successful_run: s.last_run_at,
    last_candidate_evaluation: health ? { at: health.run_at, candidates: health.candidates, outcome: health.outcome, evaluations: health.evaluations || [], classes: health.classes || {} } : null,
    last_publication: health?.last_publication || null,
    newly_published_last_run: health?.newly_published || [],
    held_last_run: health?.held || [],
    last_rebuild_trigger: s.last_trigger,
    awaiting_build: s.awaiting_build,
    next_expected_evaluation: s.next_expected_evaluation || 'after the live session completes',
    evaluation_interval_hours: NEWSROOM.EVAL_MS / 3600e3,
    stale_after_hours: NEWSROOM.STALE_AFTER_MS / 3600e3,
  };
}

/** Cron step: fire the deploy hook for a heartbeat or a build retry, recorded in the deploy ledger. */
export async function newsroomHeartbeat(env, { health, now = new Date().toISOString() } = {}) {
  const ledgerObj = await env.DATA.get('state/deploy-ledger.json');
  const ledger = ledgerObj ? await ledgerObj.json() : { history: [] };
  const lastIngest = await env.DATA.get('state/last-ingest.json');
  const liveNow = lastIngest ? !!(await lastIngest.json()).live_now : false;
  const s = newsroomState({ now, health, ledger, liveNow });
  if (s.action === 'none' || !env.DEPLOY_HOOK_URL) return { ...s, action: env.DEPLOY_HOOK_URL ? s.action : 'no_hook_configured' };
  let status = 0;
  try { status = (await fetch(env.DEPLOY_HOOK_URL, { method: 'POST' })).status; } catch { status = 0; }
  const ok = status >= 200 && status < 300;
  const entry = { at: now, version: ledger.last_dataset_version || null, reason: s.action, event_ids: [], session_ids: [], status, ok, attempt: 1 };
  // one fast retry per trigger: the retry itself is never retried fast (a persistent failure falls back to the heartbeat)
  if (s.action === 'build_retry') ledger.build_retry_for = now;
  // a failed heartbeat POST is not recorded as last_trigger (the next cron simply tries again)
  if (ok) ledger.last_trigger = entry;
  ledger.history = [entry, ...(ledger.history || [])].slice(0, 50);
  await env.DATA.put('state/deploy-ledger.json', JSON.stringify(ledger), { httpMetadata: { contentType: 'application/json' } });
  return { ...s, fired: entry };
}
