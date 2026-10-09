// Matchup semantics: shared grid history vs teammate battle; every H2H reconciles with its denominator; race H2H
// counts only both-classified races; qualifying H2H uses the qualifying classification only (grid is a separate,
// labelled fallback); sprint counts only sprints; windows are subsets of one canonical set; missing DNA stays missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const HAVE = fs.existsSync('data/derived/matchups.json') && fs.existsSync('data/derived/teammates.json');
const J = (f) => JSON.parse(fs.readFileSync(`data/derived/${f}.json`, 'utf8'));
const LEC = 'espn-5498', HAM = 'espn-868';

// Totals are recomputed from the per-driver event log (the archive grows every race weekend; the original test pinned
// the pre-Malaysia snapshot 65 + 85 = 150 of 189). The semantics asserted are unchanged.
const lecHamShared = () => {
  const log = J('driver_log');
  const hb = Object.fromEntries((log[HAM] || []).map((x) => [x.event_id, x]));
  return (log[LEC] || []).filter((x) => hb[x.event_id]).map((x) => ({ a: x, b: hb[x.event_id] }));
};
test('shared grid history reconciles: both-classified comparable races of all shared events (not all shared)', { skip: !HAVE && 'needs derived data' }, () => {
  const m = J('matchups')[[LEC, HAM].sort().join('|')];
  const shared = lecHamShared();
  const both = shared.filter((s) => s.a.classified && s.b.classified && s.a.finish !== s.b.finish);
  assert.ok(shared.length >= 189, 'never fewer than the 189 shared events of the 10-03 snapshot');
  assert.equal(m.shared_events, shared.length);
  assert.equal(m.race_comparable_events, both.length);
  assert.deepEqual(m.race_ahead, [both.filter((s) => s.a.finish < s.b.finish).length, both.filter((s) => s.a.finish > s.b.finish).length]);
  assert.ok(m.race_comparable_events < m.shared_events, 'retirements are excluded from the comparable set');
  assert.equal(m.race_excluded_events, shared.length - both.length);
  assert.equal(m.same_team_events, shared.filter((s) => s.a.constructor_id === s.b.constructor_id).length);
  assert.ok(m.same_team_events >= 39);
});

test('every matchup: H2H counts sum to their own denominators and the denominators partition the shared events', { skip: !HAVE && 'needs derived data' }, () => {
  for (const [k, m] of Object.entries(J('matchups'))) {
    assert.equal(m.race_ahead[0] + m.race_ahead[1], m.race_comparable_events, `${k} race`);
    assert.equal(m.race_comparable_events + m.race_excluded_events, m.shared_events, `${k} race partition`);
    assert.ok(m.quali_ahead[0] + m.quali_ahead[1] <= m.quali_comparable_events, `${k} quali (ties are possible only in malformed data)`);
    assert.equal(m.quali_comparable_events + m.grid_fallback_events + m.quali_unavailable_events, m.shared_events, `${k} quali partition`);
    assert.ok(m.same_team_events <= m.shared_events);
    const bs = Object.values(m.by_season || {});
    assert.equal(bs.reduce((t, s) => t + s.events, 0), m.shared_events, `${k} seasons sum`);
  }
});

test('teammate battles: race H2H only both-classified, sprint only sprints, quali only classification; windows are subsets', { skip: !HAVE && 'needs derived data' }, () => {
  const T = J('teammates');
  for (const t of T.teammates || T) {
    for (const [w, s] of [['career', t.career], ['last10', t.last10], ['last5', t.last5], ...Object.entries(t.by_season).map(([y, s]) => [y, s])]) {
      if (!s) continue;
      assert.equal(s.race_h2h[0] + s.race_h2h[1], s.race_comparable, `${t.a}/${t.b} ${w} race`);
      assert.equal(s.race_comparable + s.race_excluded, s.events, `${t.a}/${t.b} ${w} race partition`);
      assert.ok(s.sprint_h2h[0] + s.sprint_h2h[1] <= s.sprint_comparable && s.sprint_comparable <= s.events, `${t.a}/${t.b} ${w} sprint`);
      assert.ok(s.quali_h2h[0] + s.quali_h2h[1] <= s.quali_comparable, `${t.a}/${t.b} ${w} quali`);
      assert.ok(s.quali_comparable + s.grid_fallback_events <= s.events, `${t.a}/${t.b} ${w} quali partition`);
      assert.ok(s.events <= t.career.events, `${w} is a subset of career`);
      assert.ok(s.race_comparable <= t.career.race_comparable && s.quali_comparable <= t.career.quali_comparable);
    }
    assert.ok(t.last5.events <= 5 && t.last10.events <= 10);
    assert.equal(Object.values(t.by_season).reduce((n, s) => n + s.events, 0), t.career.events, 'seasons sum to career');
  }
});

test('Leclerc/Hamilton Ferrari battle: denominators are explicit', { skip: !HAVE && 'needs derived data' }, () => {
  const T = J('teammates');
  const t = (T.teammates || T).find((x) => [x.a, x.b].sort().join('|') === [LEC, HAM].sort().join('|'));
  assert.deepEqual(t.constructors, ['ferrari']);
  const c = t.a === LEC ? t.career : { ...t.career, quali_h2h: [...t.career.quali_h2h].reverse(), race_h2h: [...t.career.race_h2h].reverse(), sprint_h2h: [...t.career.sprint_h2h].reverse() };
  // recomputed from the event log (the 10-03 snapshot pinned 39 events, 27-12, 11 sprints; the archive keeps growing)
  const ferrari = lecHamShared().filter((s) => s.a.constructor_id === 'ferrari' && s.b.constructor_id === 'ferrari');
  const qc = ferrari.filter((s) => s.a.quali_pos && s.b.quali_pos);
  assert.ok(ferrari.length >= 39);
  assert.equal(c.events, ferrari.length);
  assert.deepEqual(c.quali_h2h, [qc.filter((s) => s.a.quali_pos < s.b.quali_pos).length, qc.filter((s) => s.a.quali_pos > s.b.quali_pos).length]);
  assert.equal(c.quali_comparable, qc.length);
  assert.equal(c.race_h2h[0] + c.race_h2h[1], c.race_comparable);
  assert.ok(c.race_comparable < c.events, 'retirements are excluded, not counted as wins');
  assert.equal(c.sprint_comparable, ferrari.filter((s) => s.a.sprint_pos && s.b.sprint_pos).length);
  assert.ok(c.sprint_comparable >= 11);
});

test('qualifying rule: a grid penalty never changes the qualifying comparison (row-level fixture)', { skip: !HAVE && 'needs derived data' }, () => {
  const log = J('driver_log');
  let checked = 0;
  for (const rows of Object.values(log)) for (const x of rows) for (const m of x.mates) {
    if (m.quali_cls_ahead == null) { if (m.grid_ahead != null) assert.ok(true); continue; }
    const mate = (log[m.driver_id] || []).find((y) => y.event_id === x.event_id);
    if (!mate?.quali_pos || !x.quali_pos) continue;
    assert.equal(m.quali_cls_ahead, x.quali_pos < mate.quali_pos, 'classification decides');
    assert.equal(m.grid_ahead, null, 'no grid comparison when a classification exists');
    if (x.grid && mate.grid && (x.grid < mate.grid) !== (x.quali_pos < mate.quali_pos)) checked++; // penalty-reordered grids
  }
  assert.ok(checked > 0, 'the archive contains penalty-reordered grids, and they did not alter the qualifying result');
});

test('built matchup pages expose only the basic relationship preview and sell Race Lab for deep analysis', { skip: !fs.existsSync('dist/matchup') && 'needs a build' }, () => {
  for (const file of ['max-verstappen/lando-norris.html', 'charles-leclerc/lewis-hamilton.html', 'george-russell/lewis-hamilton.html']) {
    // the static Definitions glossary (<details class="mu-gloss">, added with Race Lab in e2c76b0) names the gap metric
    // as copy; the test is about premium VALUES/sections, so the glossary is excluded before matching
    const h = fs.readFileSync('dist/matchup/' + file, 'utf8').replace(/<details class="mu-gloss">[\s\S]*?<\/details>/g, '');
    assert.match(h, /Shared F1 record/);
    assert.match(h, /All Access · Race Lab/);
    assert.match(h, /Open Race Lab/);
    assert.doesNotMatch(h, /Median qualifying gap|Profile comparison|Season by season/);
  }
});

test('DNA values are not baked into the public matchup HTML', { skip: !HAVE && 'needs derived data' }, async () => {
  const { matchupPage } = await import('../scripts/site/matchup.mjs');
  const drv = (id, last) => ({ id, slug: id, full_name: `X ${last}`, first_name: 'X', last_name: last });
  const dims = (p) => ({ window: 'w', dimensions: { qualifying: { label: 'Qualifying Pace', percentile: p, basis: 'b' } } });
  const ctx = {
    matchups: { 'a|b': { a: 'a', b: 'b', shared_events: 1, same_team_events: 0, race_comparable_events: 0, race_excluded_events: 1, race_ahead: [0, 0], quali_comparable_events: 0, quali_ahead: [0, 0], grid_fallback_events: 0, grid_ahead: [0, 0], quali_unavailable_events: 1, points: [0, 0], wins: [0, 0], podiums: [0, 0], dnfs: [0, 0], first_season: 2020, last_season: 2020, by_season: {}, recent: [] } },
    driverById: { a: drv('a', 'Alpha'), b: drv('b', 'Beta') }, currentSeason: 2026, teammates: [], currentGrid: [], latestTeam: {}, colorOf: () => null, conById: {},
    dnaCur: { a: dims(null), b: dims(42) }, dnaCareer: {}, driverLog: {}, standingsBy: {}, nextEvent: null, mediaOk: () => false, eventById: {}, sessionsByEvent: {},
  };
  const h = matchupPage(ctx, 'a|b').body;
  assert.match(h, /All Access · Race Lab/);
  assert.doesNotMatch(h, /dna-duel|42nd percentile|Qualifying Pace/);
});
