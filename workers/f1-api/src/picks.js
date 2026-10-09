// F1 Race Picks lane inside the EXISTING */10 cron (no new cron, no new Durable Object, no new bucket).
// Bounded per tick: at most one lock and two settlement revisions. Every ledger write is create-only (src/picks/lane.mjs).
import { canonicalFromFragment, entrantsFor, stateBefore, buildLock, marketSnapshot, dueVersion, lockKey, baseStateKey, putOnce, sha256Hex, gradeLock, appendSettlement, groupReady, groupsFor, settleKey, recordSummary, LEDGER_PREFIX, FAMILY_LABELS, PUBLISHED, WINNER_NOTE, verifyLock, VERIFY_CONTRACT } from '../../../src/picks/lane.mjs';
import { MODEL_VERSION, PARAMS } from '../../../src/picks/model.mjs';
import { doc } from './projection.js';

// docs/picks/locks.json: the frozen base state every lock replays from (sha-checked before use)
export const BASE_STATE_SEASON = 2025;
export const BASE_STATE_SHA256 = '3bb2d4de12785bcac8f920d547485926843bc4748bab743e20193debdb6af822';
const MARKETS_DESK = 'https://propsports-markets.sales-fd3.workers.dev/v1/market-desk?sport=f1';
const SETTLE_LOOKBACK_MS = 10 * 86400e3;
// Lane status + verification live under the picks prefix (never in the recorder's state/ keys).
export const LANE_STATUS_KEY = `${LEDGER_PREFIX}/state/lane.json`;
export const VERIFY_STATUS_KEY = `${LEDGER_PREFIX}/state/verify.json`;
// Locks written before the Worker lane existed (manual create-only put, no object metadata): hash from docs/picks/locks.json.
export const KNOWN_LOCK_SHA256 = Object.freeze({
  'picks/v1/locks/2026-singapore-grand-prix/pre_qualifying.json': 'f8c054aae8f09af196a505dee305f99b57398af17f1a056778dde20051f5cd16',
});
const VERIFY_RECENT_MS = 21 * 86400e3;

let baseMemo = null;
async function baseState(env, sha = BASE_STATE_SHA256) {
  if (baseMemo && baseMemo.sha === sha) return baseMemo.state;
  const o = await env.DATA.get(baseStateKey(BASE_STATE_SEASON));
  if (!o) throw new Error('picks base state missing');
  const text = await o.text();
  if ((await sha256Hex(text)) !== sha) throw new Error('picks base state sha mismatch');
  baseMemo = { sha, state: JSON.parse(text) };
  return baseMemo.state;
}

async function seasonEvents(env, year) {
  const o = await env.DATA.get(`fragments/season-${year}.json`);
  if (!o) return { frag: null, evs: [] };
  const frag = await o.json();
  return { frag, evs: canonicalFromFragment(frag) };
}
const whoFrom = (internal) => (id) => internal?.driver_by_upstream?.[String(id).replace(/^espn-/, '')] || null;

async function readLock(env, key) {
  const o = await env.DATA.get(key);
  if (!o) return null;
  const text = await o.text();
  const lock = JSON.parse(text);
  lock._sha256 = await sha256Hex(text);
  lock._uploaded = o.uploaded?.toISOString?.() || null;
  return lock;
}

/** One cron step. Returns a small status object (also written to LANE_STATUS_KEY as the firing evidence). */
export async function picksTick(env, { now = Date.now(), fetchImpl = fetch, baseSha = BASE_STATE_SHA256, internalDoc = null } = {}) {
  const t0 = Date.now();
  const getInternal = async () => internalDoc || (await doc(env, 'internal'));
  const status = { at: new Date(now).toISOString(), model_version: MODEL_VERSION, actions: [] };
  const year = new Date(now).getUTCFullYear();
  const { evs } = await seasonEvents(env, year);
  // ---------- lock (at most one per tick) ----------
  for (let i = 0; i < evs.length; i++) {
    const ev = evs[i];
    const version = dueVersion(ev, now);
    if (!version) continue;
    const key = lockKey(ev.slug, version);
    if (await env.DATA.head(key)) { status.actions.push({ lock: key, result: 'exists' }); break; }
    const internal = await getInternal();
    const who = whoFrom(internal);
    const prev = evs.slice(0, i).filter((e) => e.race.length).at(-1);
    const ent = entrantsFor(ev, prev);
    if (ent.entrants.length < 10 || ent.entrants.some((e) => !who(e.driver))) { status.actions.push({ lock: key, result: 'held_field_incomplete', entrants: ent.entrants.length }); break; }
    const st = stateBefore(await baseState(env, baseSha), evs, ev.start_utc, PARAMS);
    let market = null;
    try {
      const r = await fetchImpl(MARKETS_DESK, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
      if (r.ok) market = marketSnapshot(await r.json(), ev.slug, new Date(now).toISOString());
    } catch { market = null; }
    const nowIso = new Date(now + (Date.now() - t0)).toISOString(); // real elapsed compute time on top of the tick clock
    const lock = buildLock({ ev, version, state: st, entrants: ent.entrants, entrantSource: ent.source, who, nowIso, market, baseStateSha: baseSha });
    if (!(Date.parse(nowIso) < Date.parse(lock.deadline) - 60e3)) { status.actions.push({ lock: key, result: 'deadline_passed' }); break; }
    const put = await putOnce(env.DATA, key, lock, { lock_id: lock.lock_id, deadline: String(lock.deadline) });
    status.actions.push({ lock: key, result: put.created ? 'created' : 'exists', sha256: put.sha256 || null, uploaded: put.uploaded || null });
    break;
  }
  // ---------- settlement (append-only revisions, at most two writes per tick) ----------
  let writes = 0;
  const listed = await env.DATA.list({ prefix: `${LEDGER_PREFIX}/locks/${year}-` });
  const bySlug = Object.fromEntries(evs.map((e) => [e.slug, e]));
  for (const o of listed.objects || []) {
    if (writes >= 2) break;
    const m = o.key.match(/locks\/([a-z0-9-]+)\/(pre_qualifying|post_qualifying)\.json$/);
    const ev = m && bySlug[m[1]];
    if (!ev || now - Date.parse(ev.race_start || 0) > SETTLE_LOOKBACK_MS) continue;
    const groups = groupsFor(m[2]).filter((g) => groupReady(ev, g));
    if (!groups.length) continue;
    const lock = await readLock(env, o.key);
    const internal = await getInternal();
    const slugOf = (id) => whoFrom(internal)(id)?.id || null;
    for (const g of groups) {
      if (writes >= 2) break;
      const r = await appendSettlement(env.DATA, lock, m[2], g, gradeLock(lock, ev, g, slugOf), new Date(now).toISOString());
      if (r.appended) { writes++; status.actions.push({ settle: o.key, group: g, revision: r.rev }); }
    }
  }
  // ---------- read-only verification of every lock (sha256 from stored bytes, pre-session, graded, appended) ----------
  try {
    const v = await picksVerify(env, { now, evs });
    status.verify = { ok: v.ok, checked: v.checked, failures: v.failures.length };
  } catch (e) {
    status.verify = { ok: false, error: String(e?.message || e).slice(0, 200) };
    console.error('PICKS VERIFY ERROR', status.verify.error);
  }
  await env.DATA.put(LANE_STATUS_KEY, JSON.stringify(status), { httpMetadata: { contentType: 'application/json' } });
  return status;
}

async function settlementsOf(env, slug, version, group) {
  const out = [];
  for (let rev = 1; rev < 100; rev++) { const o = await env.DATA.get(settleKey(slug, version, group, rev)); if (!o) break; out.push(await o.json()); }
  return out;
}

/**
 * Verify every lock of the season: recompute sha256 from the stored bytes and compare with the object metadata, the
 * known-hash registry or the first-seen anchor (create-only); locked_at and the R2 upload precede the session (as
 * scheduled at lock time AND as currently published); graded only after the session started; revisions contiguous and
 * tied to this lock's hash; overdue grading = FAIL. Writes VERIFY_STATUS_KEY; on FAIL logs PICKS VERIFY FAIL (Workers
 * Logs — f1-api has no alerting binding) and appends a create-only failure record.
 */
export async function picksVerify(env, { now = Date.now(), evs = null } = {}) {
  const year = new Date(now).getUTCFullYear();
  const events = evs || (await seasonEvents(env, year)).evs;
  const bySlug = Object.fromEntries(events.map((e) => [e.slug, e]));
  const listed = await env.DATA.list({ prefix: `${LEDGER_PREFIX}/locks/${year}-` });
  const hourly = new Date(now).getUTCMinutes() < 10;
  const rows = [];
  for (const o of listed.objects || []) {
    const m = o.key.match(/locks\/([a-z0-9-]+)\/(pre_qualifying|post_qualifying)\.json$/);
    if (!m) continue;
    const ev = bySlug[m[1]] || null;
    if (!hourly && ev && now - Date.parse(ev.race_start || 0) > VERIFY_RECENT_MS) continue; // older locks: hourly
    const obj = await env.DATA.get(o.key);
    if (!obj) continue;
    const text = await obj.text();
    const computedSha = await sha256Hex(text);
    let lock;
    try { lock = JSON.parse(text); } catch { rows.push({ key: o.key, ok: false, checks: { parse: 'fail' } }); continue; }
    let refSha = obj.customMetadata?.sha256 || KNOWN_LOCK_SHA256[o.key] || null;
    let anchor = null;
    if (!refSha) {
      const ak = `${LEDGER_PREFIX}/verify/anchors/${m[1]}/${m[2]}.json`;
      const a = await env.DATA.get(ak);
      if (a) refSha = (await a.json()).sha256;
      else { await putOnce(env.DATA, ak, { sha256: computedSha, first_seen_at: new Date(now).toISOString(), key: o.key }); anchor = 'first_seen'; }
    }
    const settlements = {};
    for (const g of groupsFor(m[2])) settlements[g] = await settlementsOf(env, m[1], m[2], g);
    const r = verifyLock({ lock, computedSha, refSha, uploaded: obj.uploaded?.toISOString?.() || null, ev, settlements, nowMs: now });
    rows.push({ key: o.key, lock_id: lock.lock_id, sha256: computedSha, anchor, uploaded: obj.uploaded?.toISOString?.() || null, locked_at: lock.locked_at, deadline: lock.deadline, revisions: Object.fromEntries(Object.entries(settlements).map(([g, x]) => [g, x.length])), ...r });
  }
  const failures = rows.filter((r) => !r.ok);
  const out = { contract: VERIFY_CONTRACT, at: new Date(now).toISOString(), ok: !failures.length, checked: rows.length, failures: failures.map((f) => ({ key: f.key, checks: f.checks })), locks: rows };
  await env.DATA.put(VERIFY_STATUS_KEY, JSON.stringify(out), { httpMetadata: { contentType: 'application/json' } });
  if (failures.length) {
    console.error('PICKS VERIFY FAIL', JSON.stringify(out.failures));
    await putOnce(env.DATA, `${LEDGER_PREFIX}/verify/fail/${out.at.replace(/[:.]/g, '-')}.json`, out);
  }
  return out;
}

/** Admin status: last lane step + last verification. */
export async function picksStatus(env) {
  const [l, v] = await Promise.all([env.DATA.get(LANE_STATUS_KEY), env.DATA.get(VERIFY_STATUS_KEY)]);
  return { lane: l ? await l.json() : null, verify: v ? await v.json() : null };
}

/** Concurrent duplicate create-only proof: two simultaneous writers on one fresh key → exactly one wins. */
export async function createOnlyProof(env) {
  const key = `${LEDGER_PREFIX}/_proof/${Date.now()}-${crypto.randomUUID()}.json`;
  const [a, b, c] = await Promise.all([putOnce(env.DATA, key, { w: 'a' }), putOnce(env.DATA, key, { w: 'b' }), putOnce(env.DATA, key, { w: 'c' })]);
  const stored = await (await env.DATA.get(key)).json();
  return { key, created: [a.created, b.created, c.created], stored_writer: stored.w, pass: [a, b, c].filter((x) => x.created).length === 1 };
}

// Published entries (every season — the track record is permanent): ONLY the published families of published versions,
// with each group's latest settlement revision. Pre-qualifying locks are never read here.
async function publishedEntries(env) {
  const listed = await env.DATA.list({ prefix: `${LEDGER_PREFIX}/locks/` });
  const entries = [];
  for (const o of listed.objects || []) {
    const v = o.key.match(/locks\/[a-z0-9-]+\/(pre_qualifying|post_qualifying)\.json$/)?.[1];
    if (!PUBLISHED[v]) continue; // never read, never served
    const lock = await readLock(env, o.key);
    if (!lock) continue;
    const keep = PUBLISHED[v];
    lock.families = Object.fromEntries(Object.entries(lock.families || {}).filter(([f]) => keep.includes(f)));
    lock.labels = Object.fromEntries(keep.map((f) => [f, 'RESEARCH']));
    lock.contracts = Object.fromEntries(Object.entries(lock.contracts || {}).filter(([f]) => keep.includes(f)));
    const grades = {};
    const revisions = {};
    for (const g of groupsFor(lock.version)) {
      let rev = 0, last = null;
      for (;;) { const s = await env.DATA.get(settleKey(lock.event.id, lock.version, g, rev + 1)); if (!s) break; last = await s.json(); rev++; }
      revisions[g] = rev;
      if (last) grades[g] = { ...last, families: Object.fromEntries(Object.entries(last.families || {}).filter(([f]) => keep.includes(f))) };
    }
    entries.push({ lock, grades, revisions });
  }
  entries.sort((a, b) => String(b.lock.event.race_start).localeCompare(String(a.lock.event.race_start)) || (a.lock.version < b.lock.version ? 1 : -1));
  return entries;
}

// Lock evidence for the public record: identifiers, times and hashes only — never a family, selection or probability.
const evidenceOf = ({ lock, grades, revisions }) => ({
  lock_id: lock.lock_id, event: { id: lock.event.id, name: lock.event.name, season: lock.event.season, round: lock.event.round, race_start: lock.event.race_start },
  version: lock.version, model_version: lock.model?.version || null, status: lock.status || 'SHADOW', locked_at: lock.locked_at, deadline: lock.deadline,
  sha256: lock._sha256, r2_uploaded: lock._uploaded, settlement: grades.race ? 'graded' : 'pending', revisions: revisions.race || 0, settled_at: grades.race?.settled_at || null,
});

/**
 * Public weekend status for the current or next Grand Prix (no values): the post-qualifying publication state from the
 * real session schedule, the published ledger and the last lane step. Only Grand Prix qualifying opens the window;
 * sprint qualifying never does (canonicalFromFragment reads session type 'qualifying' only).
 */
export function weekendStatus({ evs, entries, lane, now }) {
  const ev = evs.find((e) => e.race_start && Date.parse(e.race_start) + 6 * 3600e3 > now) || null;
  if (!ev) return { event: null, state: 'season_complete' };
  const q = Date.parse(ev.quali_start || ''), r = Date.parse(ev.race_start);
  const key = lockKey(ev.slug, 'post_qualifying');
  const locked = entries.find((e) => e.lock.event.id === ev.slug && e.lock.version === 'post_qualifying');
  const laneAct = (lane?.actions || []).find((a) => a.lock === key);
  let state;
  if (locked) state = locked.grades.race ? 'graded' : 'locked';
  else if (now >= r - LOCK_GUARD) state = 'window_closed';
  else if (groupReady(ev, 'quali')) state = laneAct?.result === 'held_field_incomplete' ? 'held_field_incomplete' : 'lock_due';
  else if (!Number.isFinite(q) || now < q) state = 'awaiting_qualifying';
  else state = 'awaiting_classification';
  const sess = (ev.weekend || []).map((s) => ({ type: s.type, start_utc: s.start_utc, state: s.state }));
  return {
    event: { id: ev.slug, name: ev.name, season: ev.season, round: ev.round, quali_start: ev.quali_start, race_start: ev.race_start, quali_state: ev.quali_state, race_state: ev.race_state },
    sessions: sess,
    state,
    lock_window: { opens_after: 'grand_prix_qualifying_classified', earliest: ev.quali_start, closes: Number.isFinite(r) ? new Date(r - LOCK_GUARD).toISOString() : null },
    locked_at: locked?.lock.locked_at || null,
    lane: lane ? { checked_at: lane.at, next_check_by: new Date(Date.parse(lane.at) + 10 * 60e3).toISOString(), ...(laneAct ? { last_action: laneAct.result } : {}) } : null,
  };
}
const LOCK_GUARD = 10 * 60e3;

async function laneAndVerify(env) {
  const [l, v] = await Promise.all([env.DATA.get(LANE_STATUS_KEY), env.DATA.get(VERIFY_STATUS_KEY)]);
  const lane = l ? await l.json().catch(() => null) : null;
  const ver = v ? await v.json().catch(() => null) : null;
  return { lane, verify: ver ? { ok: ver.ok, at: ver.at } : null }; // no lock count: it would reveal internal locks
}

/** Member payload: ONLY the published families of published versions (PUBLISHED), with grades and their record. */
export async function picksPayload(env, { now = Date.now() } = {}) {
  const entries = await publishedEntries(env);
  const { evs } = await seasonEvents(env, new Date(now).getUTCFullYear());
  const { lane, verify } = await laneAndVerify(env);
  const strip = ({ _sha256, _uploaded, model, ...l }) => ({ ...l, model: { id: model.id, version: model.version, sims: model.sims }, evidence: { sha256: _sha256, r2_uploaded: _uploaded } });
  return { tier: 'all_access', status: 'SHADOW', label: 'RESEARCH', model_version: MODEL_VERSION, published: PUBLISHED, winner_note: WINNER_NOTE, weekend: weekendStatus({ evs, entries, lane, now }), verify, record: recordSummary(entries), evidence: entries.map(evidenceOf), locks: entries.map((e) => ({ ...strip(e.lock), grades: e.grades })) };
}

/**
 * Free teaser: what is locked and when, the weekend publication status and the permanent record (aggregate W/L/VOID/
 * PENDING and scores of settled locks) — never a selection, probability or per-pick grade; the internal pre-qualifying
 * lock is never mentioned.
 */
export async function picksTeaser(env, { now = Date.now() } = {}) {
  const year = new Date(now).getUTCFullYear();
  const entries = await publishedEntries(env);
  const { evs } = await seasonEvents(env, year);
  const { lane, verify } = await laneAndVerify(env);
  const season = entries.filter((e) => String(e.lock.event.id).startsWith(`${year}-`));
  const latest = [...season].sort((a, b) => String(b.lock._uploaded || '').localeCompare(String(a.lock._uploaded || '')))[0]?.lock.event.id || null;
  return {
    tier: 'free', model_version: MODEL_VERSION, families: PUBLISHED.post_qualifying,
    latest_event: latest, versions: season.filter((e) => e.lock.event.id === latest).map((e) => e.lock.version), locks_this_season: season.length,
    weekend: weekendStatus({ evs, entries, lane, now }), verify, record: recordSummary(entries), evidence: entries.map(evidenceOf),
  };
}

// Guest teaser is identical for every visitor: a 60 s per-isolate memo keeps public page views off the ledger.
let teaserMemo = null;
export async function picksTeaserCached(env) {
  if (teaserMemo && Date.now() - teaserMemo.at < 60e3) return teaserMemo.body;
  const body = await picksTeaser(env);
  teaserMemo = { at: Date.now(), body };
  return body;
}
