// F1 Race Picks V1: model coherence, time safety, outcome contracts, create-only ledger, cron lane and gating.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PARAMS, MODEL_VERSION, newState, observeEvent, predictEvent, pairProb, postStrength, rankScore } from '../src/picks/model.mjs';
import { canonicalFromFragment, entrantsFor, stateBefore, buildLock, gradeLock, dueVersion, putOnce, appendSettlement, settleKey, lockKey, recordSummary, sha256Hex, FAMILY_LABELS, HOLDOUT_GATE, PUBLISHED, WINNER_NOTE } from '../src/picks/lane.mjs';
import { picksTick, picksTeaser, picksPayload, createOnlyProof } from '../workers/f1-api/src/picks.js';

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
function mockBucket() {
  const m = new Map();
  let n = 0;
  const obj = (k, v) => ({ key: k, uploaded: v.uploaded, customMetadata: v.meta, text: async () => v.body, json: async () => JSON.parse(v.body), etag: v.etag });
  return {
    m,
    async put(key, body, opts = {}) {
      await new Promise((r) => setTimeout(r, Math.random() * 3)); // interleave concurrent writers
      if (opts.onlyIf?.etagDoesNotMatch === '*' && m.has(key)) return null;
      const v = { body: typeof body === 'string' ? body : JSON.stringify(body), uploaded: new Date(Date.UTC(2026, 9, 9) + ++n), meta: opts.customMetadata || {}, etag: `e${n}` };
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
  const t1 = await picksTick(env, { ...opts, now: q2 - 3 * 3600e3 });
  assert.equal(t1.actions[0].result, 'created');
  const preKey = lockKey('2026-test-2-grand-prix', 'pre_qualifying');
  const preBody = b.m.get(preKey).body;
  const lock = JSON.parse(preBody);
  assert.equal(lock.status, 'SHADOW');
  assert.ok(Date.parse(lock.locked_at) < Date.parse(lock.deadline));
  assert.equal(lock.data.last_completed_event, 'espn-ev1');
  const t2 = await picksTick(env, { ...opts, now: q2 - 2 * 3600e3 });
  assert.equal(t2.actions[0].result, 'exists');
  assert.equal(b.m.get(preKey).body, preBody, 'never replaced');
  // qualifying classified → post-qualifying lock; the pre-qualifying lock stays as it was
  setFrag([e1, fragEvent(2, '2026-03-08T00:00Z', { race: false })]);
  const t3 = await picksTick(env, { ...opts, now: q2 + 3 * 3600e3 });
  assert.equal(t3.actions.find((a) => a.lock)?.result, 'created');
  assert.ok(t3.actions.some((a) => a.settle === preKey && a.group === 'quali'), 'quali family settled after qualifying');
  const post = JSON.parse(b.m.get(lockKey('2026-test-2-grand-prix', 'post_qualifying')).body);
  assert.equal(post.version, 'post_qualifying');
  assert.ok(!('teammate_quali_h2h' in post.families));
  assert.equal(b.m.get(preKey).body, preBody);
  // race done → race settlements (bounded: two writes per tick)
  setFrag([e1, fragEvent(2, '2026-03-08T00:00Z')]);
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
});

test('free teaser never carries a probability, pick or grade, and never mentions the internal pre-qualifying lock', async () => {
  const b = mockBucket();
  await b.put(lockKey('2026-test-2-grand-prix', 'pre_qualifying'), JSON.stringify({ families: { race_winner: { probs: { a: 0.5 } } } }));
  const t0 = await picksTeaser({ DATA: b }, { now: Date.parse('2026-03-09T00:00Z') });
  assert.equal(t0.latest_event, null, 'pre-qualifying alone publishes nothing');
  assert.equal(t0.locks_this_season, 0);
  await b.put(lockKey('2026-test-2-grand-prix', 'post_qualifying'), JSON.stringify({ families: { race_winner: { probs: { a: 0.5 } } } }));
  const t = await picksTeaser({ DATA: b }, { now: Date.parse('2026-03-09T00:00Z') });
  const s = JSON.stringify(t);
  assert.equal(t.tier, 'free');
  assert.equal(t.latest_event, '2026-test-2-grand-prix');
  assert.deepEqual(t.versions, ['post_qualifying']);
  assert.ok(!/p_|prob|pick"|result|0\.5|teammate_quali|pre_qualifying/.test(s), s);
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
