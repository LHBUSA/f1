// F1 Race Picks lane: canonical events from a season fragment, lock payloads, grading and the immutable R2 ledger.
// Pure except the functions taking `bucket` (an R2 bucket binding or a compatible mock).
//
// Ledger (private R2 bucket f1-data, never a public/static asset):
//   picks/v1/model/base-state-<season>.json            frozen model state after every event before <season>+1
//   picks/v1/locks/<event-slug>/<version>.json         ONE create-only object per (event, version)
//   picks/v1/settlements/<event-slug>/<version>/<group>-r<n>.json   append-only grading revisions
// A lock is written with onlyIf etagDoesNotMatch '*' (create-only): a second writer — a duplicate cron, a retry, a
// manual put — can never replace it. Settlement and corrections are new revisions; a lock is never rewritten.
import { MODEL_ID, MODEL_VERSION, PARAMS, predictEvent, observeEvent, newState, carKey, raceClassified, raceStarted } from './model.mjs';
import { resolveConstructor } from '../core/constructors.mjs';
import { slugify } from '../core/normalize.mjs';

export const LEDGER_PREFIX = 'picks/v1';
export const LOCK_CONTRACT = 'f1-picks-lock/1';
export const SETTLE_CONTRACT = 'f1-picks-settlement/1';
export const VERSIONS = ['pre_qualifying', 'post_qualifying'];
// Every family is labelled RESEARCH (never VALIDATED/OFFICIAL); every lock is SHADOW.
export const FAMILY_LABELS = Object.freeze({
  pre_qualifying: { teammate_quali_h2h: 'RESEARCH', race_winner: 'RESEARCH', driver_outlook: 'RESEARCH', teammate_race_h2h: 'RESEARCH' },
  post_qualifying: { race_winner: 'RESEARCH', driver_outlook: 'RESEARCH', teammate_race_h2h: 'RESEARCH' },
});
// Pre-registered holdout gate result (docs/picks/metrics-v1-holdout.json); internal, not a display label.
export const HOLDOUT_GATE = Object.freeze({
  pre_qualifying: { teammate_quali_h2h: 'fail', race_winner: 'fail', driver_outlook: 'fail', teammate_race_h2h: 'fail' },
  post_qualifying: { race_winner: 'fail', driver_outlook: 'pass', teammate_race_h2h: 'pass' },
});
// Owner publication policy (10-09): members see ONLY post-qualifying top 10 / podium and teammate race H2H (the
// families that passed the gate) as research predictions, plus race-winner MODEL probabilities shown beside the market
// benchmark with no claimed advantage. Pre-qualifying families and teammate qualifying H2H are locked and graded
// internally as SHADOW research and never served to members.
export const PUBLISHED = Object.freeze({ post_qualifying: ['driver_outlook', 'teammate_race_h2h', 'race_winner'] });
export const WINNER_NOTE = 'Model probabilities shown beside the market benchmark. No winner-prediction advantage over the market or the favourite has been established.';
// Lock windows (relative to the deciding session's scheduled start). Nothing is locked inside the guard.
export const PRE_LOCK_OPENS_MS = 6 * 3600e3;
export const LOCK_GUARD_MS = 10 * 60e3;
export const SIMS = 20000;

export const eventSlug = (e) => `${e.season}-${slugify(e.name)}`;
export const lockKey = (slug, version) => `${LEDGER_PREFIX}/locks/${slug}/${version}.json`;
export const settleKey = (slug, version, group, rev) => `${LEDGER_PREFIX}/settlements/${slug}/${version}/${group}-r${rev}.json`;
export const baseStateKey = (season) => `${LEDGER_PREFIX}/model/base-state-${season}.json`;

export async function sha256Hex(text) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Season fragment (fragments/season-<y>.json, as the f1-api cron writes it) → canonical events with session timing. */
export function canonicalFromFragment(frag) {
  const sessBy = {};
  for (const s of frag.sessions || []) (sessBy[s.event_id] ||= []).push(s);
  const resBy = {};
  for (const r of frag.results || []) (resBy[r.session_id] ||= []).push(r);
  // constructor per (season, driver) seen on a labelled row: fills rows the source left unlabelled
  const seen = {};
  const cid = (r) => {
    const id = r.constructor_name_raw ? resolveConstructor(r.constructor_name_raw, r.season, r.team_color) : null;
    if (id) seen[r.driver_id] = id;
    return id || seen[r.driver_id] || null;
  };
  const rowsOf = (s) => (s ? resBy[s.id] || [] : []);
  const out = (frag.events || []).filter((e) => e.status !== 'canceled').map((e) => {
    const ss = (sessBy[e.id] || []).slice().sort((a, b) => String(a.start_utc).localeCompare(String(b.start_utc)));
    const qs = ss.find((s) => s.type === 'qualifying');
    const rs = ss.find((s) => s.type === 'race');
    const quali = rowsOf(qs).map((r) => { const c = cid(r); return { driver: r.driver_id, car: carKey(c), constructor_id: c, pos: Number.isInteger(r.position) ? r.position : null, status: r.status }; });
    const race = rowsOf(rs).filter((r) => r.race_participant !== false && r.status !== 'practice_only').map((r) => { const c = cid(r); return { driver: r.driver_id, car: carKey(c), constructor_id: c, pos: Number.isInteger(r.position) ? r.position : null, grid: r.grid, status: r.status, laps: r.laps, points: r.points || 0 }; });
    const weekend = ss.map((s) => ({ id: s.id, type: s.type, start_utc: s.start_utc, state: s.state, rows: rowsOf(s).map((r) => { const c = cid(r); return { driver: r.driver_id, car: carKey(c), constructor_id: c, status: r.status, pos: r.position }; }) }));
    return { id: e.id, slug: eventSlug(e), season: e.season, round: e.round, name: e.name, circuit_id: e.circuit_id, start_utc: e.start_utc, status: e.status, quali_start: qs?.start_utc || null, race_start: rs?.start_utc || null, quali_state: qs?.state || null, race_state: rs?.state || null, quali, race, weekend };
  });
  return out.sort((a, b) => String(a.race_start || a.start_utc).localeCompare(String(b.race_start || b.start_utc)));
}

/** Locked field: the two drivers per car seen in the latest completed session of THIS weekend (practice stand-ins
 *  excluded when a later session exists). Falls back to the previous race's classified field. */
export function entrantsFor(ev, prevEv) {
  const done = (ev.weekend || []).filter((s) => s.state === 'completed' && s.rows.length >= 10 && ['fp1', 'fp2', 'fp3', 'sprint_qualifying', 'sprint'].includes(s.type));
  const src = done.at(-1);
  if (src) {
    const rows = src.rows.filter((r) => r.car && r.status !== 'practice_only');
    return { source: `session:${src.type}`, source_session: src.id, entrants: rows.map((r) => ({ driver: r.driver, car: r.car, constructor_id: r.constructor_id })) };
  }
  if (prevEv) return { source: 'previous_race', source_session: null, entrants: prevEv.race.filter((r) => r.car).map((r) => ({ driver: r.driver, car: r.car, constructor_id: r.constructor_id })) };
  return { source: null, entrants: [] };
}

/** Replay every completed event of `events` that starts before `beforeIso` into a copy of base state. */
export function stateBefore(baseState, events, beforeIso, P = PARAMS) {
  const st = structuredClone(baseState);
  for (const ev of events) {
    if (!ev.race_start || ev.race_start >= beforeIso) continue;
    if (ev.status !== 'completed' && ev.race_state !== 'completed') continue;
    if (!ev.race.some(raceClassified)) continue;
    observeEvent(st, ev, P);
  }
  return st;
}

/** Which lock (if any) is due now for this event. */
export function dueVersion(ev, nowMs) {
  const q = Date.parse(ev.quali_start || ''), r = Date.parse(ev.race_start || '');
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  if (nowMs >= q - PRE_LOCK_OPENS_MS && nowMs < q - LOCK_GUARD_MS) return 'pre_qualifying';
  const qualiDone = ev.quali_state === 'completed' && ev.quali.filter((x) => Number.isInteger(x.pos)).length >= 10;
  if (qualiDone && nowMs > q && nowMs < r - LOCK_GUARD_MS) return 'post_qualifying';
  return null;
}

/** Build the immutable lock payload (no I/O). `who(id)` → { id: public slug, name, code } for an upstream driver id. */
export function buildLock({ ev, version, state, entrants, entrantSource, who, nowIso, market = null, baseStateSha = null, dataAsOf = null }) {
  const qualiPos = version === 'post_qualifying' ? Object.fromEntries(ev.quali.filter((r) => Number.isInteger(r.pos)).map((r) => [r.driver, r.pos])) : null;
  const pred = predictEvent(state, { event_id: ev.id, circuit_id: ev.circuit_id, entrants, qualiPos }, PARAMS, { sims: SIMS });
  const pub = (id) => who(id)?.id || null;
  const deadline = version === 'pre_qualifying' ? ev.quali_start : ev.race_start;
  const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);
  const drivers = pred.drivers.map((d) => ({ driver_id: pub(d.driver), name: who(d.driver)?.name || null, car: d.car, p_win: r4(d.p_win), p_podium: r4(d.p_podium), p_top10: r4(d.p_top10), exp_rank: r4(d.exp_rank), p_dnf: r4(d.p_dnf), quali_pos: qualiPos?.[d.driver] ?? null }));
  const winProbs = Object.fromEntries(pred.drivers.map((d) => [pub(d.driver), Math.round(d.p_win * 1e6) / 1e6]));
  const families = {
    race_winner: { probs: winProbs, other: Math.round((1 - Object.values(winProbs).reduce((a, b) => a + b, 0)) * 1e6) / 1e6, favorite: [...drivers].sort((a, b) => b.p_win - a.p_win)[0]?.driver_id || null },
    driver_outlook: drivers.map((d) => ({ driver_id: d.driver_id, p_top10: d.p_top10, p_podium: d.p_podium, exp_rank: d.exp_rank })),
    teammate_race_h2h: pred.pairs.map((p) => ({ car: p.car, a: pub(p.a), b: pub(p.b), p_a: r4(p.p_a_race), pick: p.p_a_race >= 0.5 ? pub(p.a) : pub(p.b) })),
  };
  if (version === 'pre_qualifying') families.teammate_quali_h2h = pred.pairs.map((p) => ({ car: p.car, a: pub(p.a), b: pub(p.b), p_a: r4(p.p_a_quali), pick: p.p_a_quali >= 0.5 ? pub(p.a) : pub(p.b) }));
  return {
    contract: LOCK_CONTRACT,
    lock_id: `${MODEL_ID}:${ev.slug}:${version}`,
    model: { id: MODEL_ID, version: MODEL_VERSION, params: PARAMS, sims: SIMS, beta: pred.beta, base_state_sha256: baseStateSha },
    status: 'SHADOW',
    labels: FAMILY_LABELS[version],
    event: { id: ev.slug, name: ev.name, season: ev.season, round: ev.round, quali_start: ev.quali_start, race_start: ev.race_start },
    version,
    locked_at: nowIso,
    deadline,
    data: { last_completed_event: state.last_event, events_in_state: state.events, entrant_source: entrantSource, as_of: dataAsOf },
    entrants: drivers.map((d) => ({ driver_id: d.driver_id, name: d.name, car: d.car })),
    drivers,
    families,
    market_benchmark: market, // native venue quotes at lock, benchmark only; never pooled or compared across RULE_MISMATCH
    contracts: {
      teammate_quali_h2h: 'Official qualifying classification; both teammates need a position, else VOID. Grid penalties never change it.',
      teammate_race_h2h: 'Both teammates classified with distinct positions, else VOID (a retirement is never a win for the other).',
      driver_outlook: 'Top 10 / podium on the race classification: DNS = VOID; DNF, DSQ, not classified = NO.',
      race_winner: 'Classified winner; a winner outside the locked field scores the explicit other mass.',
    },
  };
}

/** Market benchmark from a propsports-markets market-desk/1 payload for `<event-slug>-race` (native quotes only). */
export function marketSnapshot(desk, slug, nowIso) {
  const ev = (desk?.events || []).find((e) => e.canonical_event_id === `${slug}-race`);
  if (!ev) return null;
  const rows = (ev.contracts || []).filter((c) => /^p:[a-z0-9-]+$/.test(c.role || '')).map((c) => ({
    driver_id: c.role.slice(2),
    venues: Object.fromEntries((c.venues || []).filter((v) => ['EXACT_MATCH', 'COMPARABLE_EXCEPT_EXCEPTIONS'].includes(v.match)).map((v) => [v.venue, { match: v.match, mid_bp: v.mid_bp ?? null, bid_bp: v.bid_bp ?? null, ask_bp: v.ask_bp ?? null, observed_at: v.observed_at || null, freshness: v.freshness || null, market_id: v.venue_market_id || null }])),
  }));
  return { source: 'propsports-markets market-desk/1', canonical_event_id: `${slug}-race`, contract: 'race_winner', captured_at: nowIso, desk_generated_at: desk.generated_at || null, rows };
}

// ---------- grading ----------
const result = (y) => (y == null ? 'VOID' : y ? 'WIN' : 'LOSS');
/** Grade a lock against a completed canonical event. group 'quali' needs the qualifying classification; 'race' the race. */
export function gradeLock(lock, ev, group, slugOf) {
  const bySlug = (rows) => Object.fromEntries(rows.map((r) => [slugOf(r.driver), r]));
  const out = { group, families: {} };
  if (group === 'quali') {
    const q = bySlug(ev.quali);
    out.families.teammate_quali_h2h = (lock.families.teammate_quali_h2h || []).map((p) => {
      const a = q[p.a]?.pos, b = q[p.b]?.pos;
      const y = Number.isInteger(a) && Number.isInteger(b) && a !== b ? (a < b ? 1 : 0) : null;
      return { a: p.a, b: p.b, pick: p.pick, p_a: p.p_a, a_pos: a ?? null, b_pos: b ?? null, result: y == null ? 'VOID' : result((p.pick === p.a ? 1 : 0) === y), outcome_a_ahead: y };
    });
    return out;
  }
  const r = bySlug(ev.race);
  const winner = ev.race.find((x) => raceClassified(x) && x.pos === 1);
  const wSlug = winner ? slugOf(winner.driver) : null;
  const pw = wSlug && wSlug in lock.families.race_winner.probs ? lock.families.race_winner.probs[wSlug] : lock.families.race_winner.other;
  out.families.race_winner = { winner: wSlug, p_winner: pw, log_loss: Math.round(-Math.log(Math.max(pw, 1e-6)) * 10000) / 10000, favorite: lock.families.race_winner.favorite, favorite_result: result(lock.families.race_winner.favorite === wSlug) };
  out.families.driver_outlook = lock.families.driver_outlook.map((d) => {
    const x = r[d.driver_id];
    if (!x || !raceStarted(x)) return { driver_id: d.driver_id, top10: null, podium: null, status: x?.status || 'missing', void: true };
    const cls = raceClassified(x);
    return { driver_id: d.driver_id, p_top10: d.p_top10, p_podium: d.p_podium, exp_rank: d.exp_rank, finish: cls ? x.pos : null, status: x.status, top10: cls && x.pos <= 10 ? 1 : 0, podium: cls && x.pos <= 3 ? 1 : 0 };
  });
  out.families.teammate_race_h2h = lock.families.teammate_race_h2h.map((p) => {
    const a = r[p.a], b = r[p.b];
    const y = raceClassified(a) && raceClassified(b) && a.pos !== b.pos ? (a.pos < b.pos ? 1 : 0) : null;
    return { a: p.a, b: p.b, pick: p.pick, p_a: p.p_a, a_finish: raceClassified(a) ? a.pos : null, b_finish: raceClassified(b) ? b.pos : null, a_status: a?.status || null, b_status: b?.status || null, result: y == null ? 'VOID' : result((p.pick === p.a ? 1 : 0) === y), outcome_a_ahead: y };
  });
  return out;
}

export const groupReady = (ev, group) => (group === 'quali'
  ? ev.quali_state === 'completed' && ev.quali.filter((x) => Number.isInteger(x.pos)).length >= 10
  : ev.race_state === 'completed' && ev.race.filter(raceClassified).length >= 10);
export const groupsFor = (version) => (version === 'pre_qualifying' ? ['quali', 'race'] : ['race']);

// ---------- R2 ledger I/O ----------
/** Create-only put. Returns { created: true, sha256 } or { created: false } when the key already exists. */
export async function putOnce(bucket, key, obj, meta = {}) {
  const body = JSON.stringify(obj);
  const sha = await sha256Hex(body);
  const res = await bucket.put(key, body, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' }, customMetadata: { sha256: sha, ...meta } });
  return res ? { created: true, sha256: sha, uploaded: res.uploaded?.toISOString?.() || null, etag: res.etag || null } : { created: false };
}

/** Append a settlement revision when the grade differs from the latest one (stewards' changes = new revision). */
export async function appendSettlement(bucket, lock, version, group, grade, nowIso) {
  const slug = lock.event.id;
  let rev = 0, last = null;
  for (;;) {
    const o = await bucket.get(settleKey(slug, version, group, rev + 1));
    if (!o) break;
    last = await o.json();
    rev++;
  }
  const digest = await sha256Hex(JSON.stringify(grade.families));
  if (last?.grade_sha256 === digest) return { appended: false, rev };
  const rec = { contract: SETTLE_CONTRACT, lock_id: lock.lock_id, lock_sha256: lock._sha256 || null, version, group, revision: rev + 1, supersedes: rev || null, settled_at: nowIso, grade_sha256: digest, families: grade.families };
  const put = await putOnce(bucket, settleKey(slug, version, group, rev + 1), rec);
  return { appended: put.created, rev: rev + 1 };
}

/** Score summary for the record screen: per family/version W/L/VOID/PENDING + log loss, from locks + latest grades. */
export function recordSummary(entries) {
  const fam = {};
  const add = (k, field, v = 1) => { (fam[k] ||= { win: 0, loss: 0, void: 0, pending: 0, n_scored: 0, log_loss_sum: 0, brier_sum: 0 })[field] += v; };
  for (const { lock, grades } of entries) {
    const v = lock.version;
    for (const f of Object.keys(lock.families)) {
      const k = `${f}|${v}`;
      const g = f === 'teammate_quali_h2h' ? grades.quali : grades.race;
      if (!g) { add(k, 'pending', f === 'race_winner' ? 1 : (lock.families[f] || []).length); continue; }
      const rows = g.families[f];
      if (f === 'race_winner') { add(k, 'n_scored'); add(k, 'log_loss_sum', rows.log_loss); add(k, rows.favorite_result === 'WIN' ? 'win' : 'loss'); continue; }
      for (const x of rows) {
        if (f === 'driver_outlook') {
          if (x.void) { add(k, 'void'); continue; }
          add(k, 'n_scored');
          add(k, 'brier_sum', (x.p_top10 - x.top10) ** 2);
          add(k, x.top10 === (x.p_top10 >= 0.5 ? 1 : 0) ? 'win' : 'loss');
          continue;
        }
        if (x.result === 'VOID') { add(k, 'void'); continue; }
        add(k, 'n_scored');
        const p = x.pick === x.a ? x.p_a : 1 - x.p_a;
        add(k, 'log_loss_sum', -Math.log(Math.max(x.result === 'WIN' ? p : 1 - p, 1e-6)));
        add(k, x.result === 'WIN' ? 'win' : 'loss');
      }
    }
  }
  return Object.fromEntries(Object.entries(fam).map(([k, x]) => [k, { win: x.win, loss: x.loss, void: x.void, pending: x.pending, n_scored: x.n_scored, mean_log_loss: x.n_scored && x.log_loss_sum ? Math.round((x.log_loss_sum / x.n_scored) * 10000) / 10000 : null, top10_brier: x.brier_sum ? Math.round((x.brier_sum / x.n_scored) * 10000) / 10000 : null }]));
}

export { newState };
