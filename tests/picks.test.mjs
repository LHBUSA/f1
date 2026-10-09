// F1 Race Picks V1: model coherence, time safety, outcome contracts, create-only ledger, cron lane and gating.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PARAMS, MODEL_VERSION, newState, observeEvent, predictEvent, pairProb, postStrength, rankScore } from '../src/picks/model.mjs';
import { canonicalFromFragment, entrantsFor, stateBefore, buildLock, gradeLock, dueVersion, putOnce, appendSettlement, settleKey, lockKey, recordSummary, sha256Hex, FAMILY_LABELS, HOLDOUT_GATE, PUBLISHED, WINNER_NOTE, verifyLock } from '../src/picks/lane.mjs';
import { picksTick, picksTeaser, picksPayload, createOnlyProof, picksVerify, picksStatus, LANE_STATUS_KEY, VERIFY_STATUS_KEY, KNOWN_LOCK_SHA256 } from '../workers/f1-api/src/picks.js';

// ---------- fixtures ----------
const TEAMS = ['Mercedes', 'Ferrari', 'McLaren', 'Red Bull', 'Williams', 'Alpine', 'Haas', 'Aston Martin', 'Audi', 'Racing Bulls'];
const DRIVERS = TEAMS.flatMap((t, i) => [{ id: `espn-${100 + 2 * i}`, team: t }, { id: `espn-${101 + 2 * i}`, team: t }]);
const who = (id) => ({ id: `drv-${id.replace('espn-', '')}`, name: `Driver ${id}`, code: 'XXX' });
const slugOf = (id) => who(id).id;
function fragEvent(n, startIso, { quali = true, race = true, raceOverrides = {}, qualiOverrides = {}, states = {} } = {}) {
  const eid = `espn-ev${n}`;
  const t = Date.parse(startIso);
  const iso = (h) => new Date(t + h * 3600e3).toISOString().replace(/:\d\d\.\d{3}Z$/, 'Z');
  const sessions = [
    { id: `${eid}-fp1`, event_id: eid, type: 'fp1', start_utc: iso(0), state: states.fp1 || 'completed' },
    { id: `${eid}-q`, event_id: eid, type: 'qualifying', start_utc: iso(24), state: states.q || (quali ? 'completed' : 'scheduled') },
    { id: `${eid}-r`, event_id: eid, type: 'race', start_utc: iso(48), state: states.r || (race ? 'completed' : 'scheduled') },
  ];
  const results = [];
  const row = (sid, type, d, pos, extra = {}) => ({ id: `${sid}-${d.id}`, session_id: sid, event_id: eid, season: 2026, session_type: type, driver_id: d.id, constructor_name_raw: d.team, team_color: null, position: pos, status: 'classified', laps: 50, points: 0, race_participant: type === 'race' ? true : null, ...extra });
  DRIVERS.forEach((d, i) => results.push(row(`${eid}-fp1`, 'fp1', d, i + 1)));
  if (quali) DRIVERS.forEach((d, i) => results.push(row(`${eid}-q`, 'qualifying', d, i + 1, qualiOverrides[d.id] || {})));
  if (race) DRIVERS.forEach((d, i) => results.push(row(`${eid}-r`, 'race', d, i + 1, { points: Math.max(0, 10 - i), grid: i + 1, ...(raceOverrides[d.id] || {}) })));
  return { event: { id: eid, season: 2026, round: n, name: `Test ${n} Grand Prix`, circuit_id: `c${n}`, start_utc: iso(0), status: race ? 'completed' : 'scheduled' }, sessions, results };
}
function fragment(parts) {
  return { season: 2026, events: parts.map((p) => p.event), sessions: parts.flatMap((p) => p.sessions), results: parts.flatMap((p) => p.results), entries: [], standings: [] };
}
let CLOCK = null; // test clock for R2 upload times (null = real time)
function mockBucket() {
  const m = new Map();
  let n = 0;
  const obj = (k, v) => ({ key: k, uploaded: v.uploaded, customMetadata: v.meta, text: async () => v.body, json: async () => JSON.parse(v.body), etag: v.etag });
  return {
    m,
    async put(key, body, opts = {}) {
      await new Promise((r) => setTimeout(r, Math.random() * 3)); // interleave concurrent writers
      if (opts.onlyIf?.etagDoesNotMatch === '*' && m.has(key)) return null;
      const v = { body: typeof body === 'string' ? body : JSON.stringify(body), uploaded: new Date((CLOCK ?? Date.now()) + ++n), meta: opts.customMetadata || {}, etag: `e${n}` };
      m.set(key, v);
      return { etag: v.etag, uploaded: v.uploaded };
    },
    async get(key) { return m.has(key) ? obj(key, m.get(key)) : null; },
    async head(key) { return m.has(key) ? obj(key, m.get(key)) : null; },
    async list({ prefix }) { return { objects: [...m.keys()].filter((k) => k.startsWith(prefix)).map((k) => obj(k, m.get(k))) }; },
  };
}

// ---------- model ----------
test('race winner probabilities over the field plus explicit other mass sum to exactly 1, deterministic per lock', () => {
  const evs = canonicalFromFragment(fragment([fragEvent(1, '2026-03-01T00:00Z'), fragEvent(2, '2026-03-08T00:00Z')]));
  const st = newState();
  observeEvent(st, evs[0]);
  const entrants = evs[1].race.map((r) => ({ driver: r.driver, car: r.car }));
  const a = predictEvent(st, { event_id: 'x', entrants }, PARAMS, { sims: 4000 });
  const b = predictEvent(st, { event_id: 'x', entrants }, PARAMS, { sims: 4000 });
  assert.deepEqual(a, b);
  const s = a.drivers.reduce((t, d) => t + d.p_win, 0) + a.other_mass;
  assert.ok(Math.abs(s - 1) < 1e-9, `sum ${s}`);
  assert.ok(a.drivers.every((d) => d.p_top10 >= d.p_podium && d.p_podium >= d.p_win - 1e-9), 'top10 >= podium >= win');
  assert.equal(a.pairs.length, 10);
  assert.ok(a.drivers[0].p_win > a.drivers.at(-1).p_win, 'faster car ranks higher');
});

test('pair probabilities are complementary; post-qualifying strength rises with a better qualifying position', () => {
  assert.equal(pairProb(0.3, -0.2, 1.5) + pairProb(-0.2, 0.3, 1.5), 1);
  assert.ok(postStrength(0, 1, 20, 20) > postStrength(0, 2, 20, 20));
  assert.ok(postStrength(0, 20, 20, 20) > postStrength(0, undefined, 20, 20), 'no classification ranks behind the last car');
  assert.ok(Number.isFinite(rankScore(25, 20)) && Number.isFinite(rankScore(0, 20)), 'out-of-range positions clamp');
});

test('time safety: the state for an event never contains that event or anything after it', () => {
  const parts = [fragEvent(1, '2026-03-01T00:00Z'), fragEvent(2, '2026-03-08T00:00Z'), fragEvent(3, '2026-03-15T00:00Z', { quali: false, race: false, states: { fp1: 'completed' } })];
  const evs = canonicalFromFragment(fragment(parts));
  const st2 = stateBefore(newState(), evs, evs[1].start_utc);
  assert.equal(st2.events, 1);
  assert.equal(st2.last_event, 'espn-ev1');
  // appending the future (event 2 results) cannot change event 2's state
  const stWithout = stateBefore(newState(), evs.slice(0, 1), evs[1].start_utc);
  assert.deepEqual(st2, stWithout);
});

test('lock windows: pre-qualifying closes before qualifying; post-qualifying only after a completed classification and before the race', () => {
  const ev = canonicalFromFragment(fragment([fragEvent(1, '2026-03-01T00:00Z', { quali: false, race: false })]))[0];
  const q = Date.parse(ev.quali_start);
  assert.equal(dueVersion(ev, q - 7 * 3600e3), null);
  assert.equal(dueVersion(ev, q - 3600e3), 'pre_qualifying');
  assert.equal(dueVersion(ev, q - 5 * 60e3), null, 'inside the guard');
  assert.equal(dueVersion(ev, q + 3600e3), null, 'qualifying not classified yet');
  const done = canonicalFromFragment(fragment([fragEvent(1, '2026-03-01T00:00Z', { race: false })]))[0];
  assert.equal(dueVersion(done, q + 3600e3), 'post_qualifying');
  assert.equal(dueVersion(done, Date.parse(done.race_start) - 5 * 60e3), null);
});

// ---------- contracts ----------
test('grading follows the pre-registered contracts (quali classification, both-classified race H2H, DNS void)', () => {
  const pre = fragEvent(1, '2026-03-01T00:00Z');
  const ev = canonicalFromFragment(fragment([pre]))[0];
  const ent = entrantsFor(ev, null);
  const lock = buildLock({ ev, version: 'pre_qualifying', state: newState(), entrants: ent.entrants, entrantSource: ent.source, who, nowIso: '2026-03-01T01:00:00Z' });
  // settle against: Mercedes #2 retires, Ferrari #1 DNS, McLaren grid penalty irrelevant to quali H2H
  const after = fragEvent(1, '2026-03-01T00:00Z', {
    raceOverrides: { 'espn-101': { status: 'retired', position: 19 }, 'espn-102': { status: 'did_not_start', position: 20, laps: 0 }, 'espn-104': { grid: 20 } },
  });
  const done = canonicalFromFragment(fragment([after]))[0];
  const gq = gradeLock(lock, done, 'quali', slugOf);
  const mcl = gq.families.teammate_quali_h2h.find((p) => p.a === 'drv-104');
  assert.equal(mcl.outcome_a_ahead, 1, 'quali H2H uses the classification, not the grid');
  const gr = gradeLock(lock, done, 'race', slugOf);
  assert.equal(gr.families.teammate_race_h2h.find((p) => p.a === 'drv-100').result, 'VOID', 'a retirement is never an H2H win');
  assert.equal(gr.families.teammate_race_h2h.find((p) => p.a === 'drv-102').result, 'VOID', 'DNS voids the H2H');
  const dns = gr.families.driver_outlook.find((d) => d.driver_id === 'drv-102');
  assert.equal(dns.void, true, 'DNS voids top-10/podium');
  const dnf = gr.families.driver_outlook.find((d) => d.driver_id === 'drv-101');
  assert.equal(dnf.top10, 0, 'DNF is NO');
  assert.equal(gr.families.race_winner.winner, 'drv-100');
  const sum = recordSummary([{ lock, grades: { quali: gq, race: gr } }]);
  assert.equal(sum['teammate_race_h2h|pre_qualifying'].void, 2);
  assert.ok(sum['race_winner|pre_qualifying'].mean_log_loss > 0);
});

// ---------- ledger ----------
test('create-only ledger: concurrent duplicate writers produce exactly one lock; settlement appends revisions and never rewrites a lock', async () => {
  const b = mockBucket();
  const key = lockKey('2026-test', 'pre_qualifying');
  const res = await Promise.all(Array.from({ length: 8 }, (_, i) => putOnce(b, key, { writer: i })));
  assert.equal(res.filter((r) => r.created).length, 1);
  const stored = JSON.parse(b.m.get(key).body);
  assert.equal(res.find((r) => r.created).sha256, await sha256Hex(JSON.stringify(stored)));
  const lock = { lock_id: 'l', event: { id: '2026-test' }, _sha256: 'abc' };
  const g1 = { families: { x: [1] } }, g2 = { families: { x: [2] } };
  assert.deepEqual(await appendSettlement(b, lock, 'pre_qualifying', 'race', g1, 't1'), { appended: true, rev: 1 });
  assert.deepEqual(await appendSettlement(b, lock, 'pre_qualifying', 'race', g1, 't2'), { appended: false, rev: 1 }, 'same grade: no new revision');
  assert.deepEqual(await appendSettlement(b, lock, 'pre_qualifying', 'race', g2, 't3'), { appended: true, rev: 2 }, 'changed classification: appended revision');
  assert.equal(JSON.parse(b.m.get(settleKey('2026-test', 'pre_qualifying', 'race', 2)).body).supersedes, 1);
  assert.equal(JSON.parse(b.m.get(key).body).writer, stored.writer, 'lock untouched');
  const proof = await createOnlyProof({ DATA: b });
  assert.equal(proof.pass, true);
});

// ---------- cron lane ----------
test('cron lane: locks pre-qualifying once inside the window, post-qualifying after the classification, settles after the race', async () => {
  const b = mockBucket();
  const base = newState();
  const baseBody = JSON.stringify(base);
  await b.put('picks/v1/model/base-state-2025.json', baseBody);
  const baseSha = await sha256Hex(baseBody);
  const internalDoc = { driver_by_upstream: Object.fromEntries(DRIVERS.map((d) => [d.id.replace('espn-', ''), who(d.id)])) };
  const env = { DATA: b };
  const fetchImpl = async () => ({ ok: false });
  const setFrag = (parts) => b.m.set('fragments/season-2026.json', { body: JSON.stringify(fragment(parts)), uploaded: new Date(), meta: {} });
  const e1 = fragEvent(1, '2026-03-01T00:00Z');
  setFrag([e1, fragEvent(2, '2026-03-08T00:00Z', { quali: false, race: false })]);
  const q2 = Date.parse('2026-03-09T00:00Z');
  const opts = { fetchImpl, baseSha, internalDoc };
  CLOCK = q2 - 3 * 3600e3;
  const t1 = await picksTick(env, { ...opts, now: q2 - 3 * 3600e3 });
  assert.equal(t1.actions[0].result, 'created');
  const preKey = lockKey('2026-test-2-grand-prix', 'pre_qualifying');
  const preBody = b.m.get(preKey).body;
  const lock = JSON.parse(preBody);
  assert.equal(lock.status, 'SHADOW');
  assert.ok(Date.parse(lock.locked_at) < Date.parse(lock.deadline));
  assert.equal(lock.data.last_completed_event, 'espn-ev1');
  CLOCK = q2 - 2 * 3600e3;
  const t2 = await picksTick(env, { ...opts, now: q2 - 2 * 3600e3 });
  assert.equal(t2.actions[0].result, 'exists');
  assert.equal(b.m.get(preKey).body, preBody, 'never replaced');
  // qualifying classified → post-qualifying lock; the pre-qualifying lock stays as it was
  setFrag([e1, fragEvent(2, '2026-03-08T00:00Z', { race: false })]);
  CLOCK = q2 + 3 * 3600e3;
  const t3 = await picksTick(env, { ...opts, now: q2 + 3 * 3600e3 });
  assert.equal(t3.actions.find((a) => a.lock)?.result, 'created');
  assert.ok(t3.actions.some((a) => a.settle === preKey && a.group === 'quali'), 'quali family settled after qualifying');
  const post = JSON.parse(b.m.get(lockKey('2026-test-2-grand-prix', 'post_qualifying')).body);
  assert.equal(post.version, 'post_qualifying');
  assert.ok(!('teammate_quali_h2h' in post.families));
  assert.equal(b.m.get(preKey).body, preBody);
  // race done → race settlements (bounded: two writes per tick)
  setFrag([e1, fragEvent(2, '2026-03-08T00:00Z')]);
  CLOCK = q2 + 30 * 3600e3;
  const t4 = await picksTick(env, { ...opts, now: q2 + 30 * 3600e3 });
  assert.equal(t4.actions.filter((a) => a.settle).length, 2);
  const payload = await picksPayload(env, { now: q2 + 30 * 3600e3 });
  // publication policy: only the post-qualifying lock, only its gate-passing families + winner model probabilities
  assert.equal(payload.locks.length, 1);
  const pl = payload.locks[0];
  assert.equal(pl.version, 'post_qualifying');
  assert.deepEqual(Object.keys(pl.families).sort(), ['driver_outlook', 'race_winner', 'teammate_race_h2h']);
  assert.ok(pl.evidence.sha256 && pl.grades.race);
  assert.ok(Object.values(pl.labels).every((l) => l === 'RESEARCH'));
  assert.equal(payload.winner_note, WINNER_NOTE);
  const ser = JSON.stringify(payload);
  assert.ok(!ser.includes('pre_qualifying') && !ser.includes('teammate_quali_h2h'), 'pre-qualifying research never served');
  assert.ok(!/OFFICIAL|VALIDATED|BACKTEST-PASS|\bedge\b/i.test(ser));
  assert.ok(Object.keys(payload.record).every((k) => k.endsWith('|post_qualifying')));
  assert.ok(payload.record['race_winner|post_qualifying'].n_scored === 1);
  // the internal pre-qualifying lock still exists and was graded (SHADOW research)
  assert.ok(b.m.has(settleKey('2026-test-2-grand-prix', 'pre_qualifying', 'race', 1)));
  // every tick verified the ledger read-only; all checks pass and the status sits under the picks prefix
  assert.deepEqual(t4.verify, { ok: true, checked: 2, failures: 0 });
  const st = await picksStatus(env);
  assert.equal(st.lane.at, new Date(q2 + 30 * 3600e3).toISOString());
  assert.ok(st.verify.locks.every((l) => l.checks.sha256 === 'pass' && l.checks.locked_before_session === 'pass' && l.checks.settled_race === 'pass'));
  assert.equal(st.verify.locks.find((l) => l.key.endsWith('pre_qualifying.json')).checks.settled_quali, 'pass');
  assert.ok(LANE_STATUS_KEY.startsWith('picks/v1/') && VERIFY_STATUS_KEY.startsWith('picks/v1/'));
  assert.ok(![...b.m.keys()].some((k) => k.startsWith('state/')), 'nothing written to the recorder/newsroom state/ keys');
  // tamper with the stored bytes of the post lock (bypassing create-only, as an operator mistake would) → FAIL
  const postKey = lockKey('2026-test-2-grand-prix', 'post_qualifying');
  const v0 = b.m.get(postKey);
  b.m.set(postKey, { ...v0, body: v0.body.replace('"post_qualifying"', '"post_qualifying" ') });
  const bad = await picksVerify(env, { now: q2 + 30 * 3600e3 });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.failures.map((x) => [x.key, x.checks.sha256]), [[postKey, 'fail']]);
  assert.ok([...b.m.keys()].some((k) => k.startsWith('picks/v1/verify/fail/')), 'failure record appended');
  CLOCK = null;
});

test('verification: pre-session, overdue grading and unanchored locks (first-seen anchor, then compared)', async () => {
  const lock = { lock_id: 'L', version: 'post_qualifying', locked_at: '2026-03-09T03:00:00Z', deadline: '2026-03-10T00:00Z' };
  const ev = canonicalFromFragment(fragment([fragEvent(2, '2026-03-08T00:00Z')]))[0];
  const base = { lock, computedSha: 'x', refSha: 'x', uploaded: '2026-03-09T03:00:01Z', ev, nowMs: Date.parse('2026-03-10T03:00:00Z') };
  assert.equal(verifyLock({ ...base, settlements: { race: [{ revision: 1, lock_id: 'L', lock_sha256: 'x', settled_at: '2026-03-10T02:00:00Z' }] } }).ok, true);
  assert.equal(verifyLock({ ...base, settlements: { race: [] }, nowMs: Date.parse('2026-03-10T05:00:00Z') }).checks.settled_race, 'fail', 'classified race not graded within the grace window');
  assert.equal(verifyLock({ ...base, settlements: { race: [] } }).checks.settled_race, 'pending');
  assert.equal(verifyLock({ ...base, uploaded: '2026-03-10T00:00:05Z', settlements: {} }).checks.locked_before_session, 'fail', 'R2 upload after the session start');
  assert.equal(verifyLock({ ...base, lock: { ...lock, locked_at: '2026-03-10T00:01:00Z' }, settlements: {} }).checks.locked_before_session, 'fail');
  assert.equal(verifyLock({ ...base, settlements: { race: [{ revision: 1, lock_id: 'L', settled_at: '2026-03-09T23:00:00Z' }] } }).checks.settled_race, 'fail', 'graded before the race started');
  assert.equal(verifyLock({ ...base, settlements: { race: [{ revision: 2, lock_id: 'L', settled_at: '2026-03-10T02:00:00Z' }] } }).checks.settled_race, 'fail', 'revisions must be contiguous');
  // a lock without metadata or registry hash: anchored on first sight, compared afterwards
  const b = mockBucket();
  CLOCK = Date.parse('2026-03-09T03:00:00Z');
  b.m.set('fragments/season-2026.json', { body: JSON.stringify(fragment([fragEvent(2, '2026-03-08T00:00Z', { race: false })])), uploaded: new Date(), meta: {} });
  const key = lockKey('2026-test-2-grand-prix', 'post_qualifying');
  await b.put(key, JSON.stringify(lock)); // no customMetadata (like a manual wrangler put)
  const r1 = await picksVerify({ DATA: b }, { now: Date.parse('2026-03-09T04:00:00Z') });
  assert.equal(r1.locks[0].anchor, 'first_seen');
  assert.equal(r1.locks[0].checks.sha256, 'unanchored');
  const r2 = await picksVerify({ DATA: b }, { now: Date.parse('2026-03-09T04:10:00Z') });
  assert.equal(r2.locks[0].checks.sha256, 'pass');
  assert.equal(r2.ok, true);
  CLOCK = null;
  assert.equal(KNOWN_LOCK_SHA256['picks/v1/locks/2026-singapore-grand-prix/pre_qualifying.json'], 'f8c054aae8f09af196a505dee305f99b57398af17f1a056778dde20051f5cd16');
});

test('free teaser: weekend status + permanent record through the whole weekend, never a selection, probability or the internal pre-qualifying lock', async () => {
  const b = mockBucket();
  const base = newState();
  const baseBody = JSON.stringify(base);
  await b.put('picks/v1/model/base-state-2025.json', baseBody);
  const opts = { fetchImpl: async () => ({ ok: false }), baseSha: await sha256Hex(baseBody), internalDoc: { driver_by_upstream: Object.fromEntries(DRIVERS.map((d) => [d.id.replace('espn-', ''), who(d.id)])) } };
  const env = { DATA: b };
  const setFrag = (parts) => b.m.set('fragments/season-2026.json', { body: JSON.stringify(fragment(parts)), uploaded: new Date(), meta: {} });
  const e1 = fragEvent(1, '2026-03-01T00:00Z');
  // a sprint weekend: sprint qualifying classified is NOT Grand Prix qualifying
  const sprintWeekend = (o) => { const e = fragEvent(2, '2026-03-08T00:00Z', o); e.sessions.splice(1, 0, { id: 'espn-ev2-sq', event_id: 'espn-ev2', type: 'sprint_qualifying', start_utc: '2026-03-08T12:00Z', state: 'completed' }); return e; };
  const q2 = Date.parse('2026-03-09T00:00Z'), r2 = Date.parse('2026-03-10T00:00Z');
  const leak = (t) => { const s = JSON.stringify(t); assert.ok(!/p_|prob|"pick|teammate_quali|pre_qualifying|"families":\{"|drivers"|exp_rank/.test(s.replace('"families":["driver_outlook","teammate_race_h2h","race_winner"]', '')), s); };
  setFrag([e1, sprintWeekend({ quali: false, race: false })]);
  CLOCK = q2 - 3 * 3600e3;
  await picksTick(env, { ...opts, now: q2 - 3 * 3600e3 }); // internal pre-qualifying lock only
  let t = await picksTeaser(env, { now: q2 - 3 * 3600e3 });
  assert.equal(t.tier, 'free');
  assert.equal(t.latest_event, null, 'pre-qualifying alone publishes nothing');
  assert.equal(t.locks_this_season, 0);
  assert.equal(t.weekend.state, 'awaiting_qualifying', 'sprint qualifying never opens the post-qualifying window');
  assert.equal(t.weekend.event.id, '2026-test-2-grand-prix');
  assert.equal(t.weekend.lock_window.opens_after, 'grand_prix_qualifying_classified');
  assert.equal(t.weekend.lock_window.closes, new Date(r2 - 10 * 60e3).toISOString());
  assert.ok(t.weekend.sessions.some((s) => s.type === 'sprint_qualifying'));
  assert.deepEqual(t.record, {});
  assert.deepEqual(t.evidence, []);
  leak(t);
  // qualifying started, not yet classified
  t = await picksTeaser(env, { now: q2 + 3600e3 });
  assert.equal(t.weekend.state, 'awaiting_classification');
  // classified, lane not yet run → lock due on the next tick; a held field is reported from the lane step
  setFrag([e1, sprintWeekend({ race: false })]);
  t = await picksTeaser(env, { now: q2 + 2 * 3600e3 });
  assert.equal(t.weekend.state, 'lock_due');
  b.m.set('picks/v1/state/lane.json', { body: JSON.stringify({ at: new Date(q2 + 2 * 3600e3).toISOString(), actions: [{ lock: lockKey('2026-test-2-grand-prix', 'post_qualifying'), result: 'held_field_incomplete', entrants: 8 }] }), uploaded: new Date(), meta: {} });
  t = await picksTeaser(env, { now: q2 + 2 * 3600e3 });
  assert.equal(t.weekend.state, 'held_field_incomplete');
  assert.equal(t.weekend.lane.next_check_by, new Date(q2 + 2 * 3600e3 + 10 * 60e3).toISOString());
  // locked: evidence (ids, times, hash) is public; the selections are not
  CLOCK = q2 + 3 * 3600e3;
  await picksTick(env, { ...opts, now: q2 + 3 * 3600e3 });
  t = await picksTeaser(env, { now: q2 + 3 * 3600e3 });
  assert.equal(t.weekend.state, 'locked');
  assert.deepEqual(Object.keys(t.verify || {}).sort(), ['at', 'ok'], 'no lock count (it would reveal the internal pre-qualifying lock)');
  assert.equal(t.latest_event, '2026-test-2-grand-prix');
  assert.deepEqual(t.versions, ['post_qualifying']);
  assert.equal(t.evidence.length, 1);
  const ev0 = t.evidence[0];
  assert.equal(ev0.version, 'post_qualifying');
  assert.equal(ev0.settlement, 'pending');
  assert.match(ev0.sha256, /^[0-9a-f]{64}$/);
  assert.equal(ev0.sha256, await sha256Hex(b.m.get(lockKey('2026-test-2-grand-prix', 'post_qualifying')).body));
  assert.ok(Object.values(t.record).every((r) => r.win === 0 && r.loss === 0 && r.pending > 0));
  leak(t);
  // race graded → the record counts settle; still no per-pick values
  setFrag([e1, sprintWeekend({})]);
  CLOCK = q2 + 26 * 3600e3;
  await picksTick(env, { ...opts, now: q2 + 26 * 3600e3 });
  t = await picksTeaser(env, { now: q2 + 26 * 3600e3 });
  assert.equal(t.evidence[0].settlement, 'graded');
  assert.equal(t.weekend.state, 'graded');
  assert.ok(Object.keys(t.record).every((k) => k.endsWith('|post_qualifying')));
  assert.equal(t.record['race_winner|post_qualifying'].n_scored, 1);
  assert.ok(Object.values(t.record).every((r) => r.pending === 0 && r.win + r.loss + r.void > 0));
  leak(t);
  // the member payload carries the same status, record and evidence
  const m = await picksPayload(env, { now: q2 + 26 * 3600e3 });
  assert.deepEqual(m.record, t.record);
  assert.deepEqual(m.evidence, t.evidence);
  assert.equal(m.weekend.state, t.weekend.state);
  // next weekend: no event left → season complete
  t = await picksTeaser(env, { now: r2 + 7 * 86400e3 });
  assert.equal(t.weekend.state, 'season_complete');
  assert.equal(t.evidence.length, 1, 'the record is permanent');
  CLOCK = null;
});

test('labels and publication: every label is RESEARCH; members see only the gate-passing post-qualifying families plus winner model probabilities', () => {
  assert.equal(MODEL_VERSION, 'f1-picks-1.0.0');
  for (const v of Object.values(FAMILY_LABELS)) assert.ok(Object.values(v).every((x) => x === 'RESEARCH'));
  assert.equal(HOLDOUT_GATE.post_qualifying.driver_outlook, 'pass');
  assert.equal(HOLDOUT_GATE.post_qualifying.teammate_race_h2h, 'pass');
  assert.equal(HOLDOUT_GATE.post_qualifying.race_winner, 'fail');
  assert.deepEqual(Object.keys(PUBLISHED), ['post_qualifying']);
  for (const f of PUBLISHED.post_qualifying) assert.ok(f === 'race_winner' || HOLDOUT_GATE.post_qualifying[f] === 'pass', f);
  assert.match(WINNER_NOTE, /No winner-prediction advantage/);
  assert.ok(!JSON.stringify(FAMILY_LABELS).includes('VALIDATED') && !JSON.stringify(FAMILY_LABELS).includes('OFFICIAL'));
});
