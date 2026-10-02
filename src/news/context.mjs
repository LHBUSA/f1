// Shared context builders for every story class. Each adds facts/entities under a prefix, so the same calculation
// (championship stakes, circuit archive, form, teammate battles) means the same thing in every story.
import { posText, pts, countWord, ordinal } from './packet.mjs';
import * as M from '../intel/metrics.mjs';

export function pointsScale(X, season) {
  const races = X.completedRaces(season);
  const gp = races.filter((e) => !e.sprint).flatMap((e) => X.rows(e.id, 'race').map((r) => r.points || 0));
  const sp = races.filter((e) => e.sprint).flatMap((e) => X.rows(e.id, 'sprint').map((r) => r.points || 0));
  return { race_max: gp.length ? Math.max(...gp) : null, sprint_max: sp.length ? Math.max(...sp) : null };
}

// championship table at a point in the season: after an event (inclusive) or before it; stakes + trend
export function addStakes(P, X, ev, { after }) {
  const D = (id) => X.driver[id], C = (id) => X.con[id];
  const prog = X.standingsBy[ev.season]?.progression || [];
  const idx = prog.findIndex((r) => r.event_id === ev.id);
  const upto = after ? (idx >= 0 ? prog.slice(0, idx + 1) : null) : prog.filter((r) => X.event[r.event_id]?.start_utc < ev.start_utc);
  if (!upto?.length || X.standingsBy[ev.season]?.progression_note) return null;
  const now = upto.at(-1);
  const t = Object.entries(now.drivers).map(([id, v]) => ({ id, ...v })).sort((a, b) => a.pos - b.pos);
  P.entity('leader', 'driver', t[0].id, D(t[0].id)?.name);
  if (C(D(t[0].id)?.team_id)) P.entity('leader_team', 'team', D(t[0].id).team_id, C(D(t[0].id).team_id).name);
  P.fact('leader_points', t[0].p, pts(t[0].p), `Leader points ${after ? 'after' : 'before'} this round`, 'projection: standings progression');
  t.slice(1, 5).forEach((x, i) => { const k = `c${i + 2}`; P.entity(k, 'driver', x.id, D(x.id)?.name); P.fact(`${k}_points`, x.p, pts(x.p), `${D(x.id)?.name} points`, 'projection: standings progression'); P.derive(`${k}_gap`, t[0].p - x.p, pts(t[0].p - x.p), `${D(x.id)?.name} deficit to the leader`, { from: ['leader_points', `${k}_points`], rule: 'difference' }); });
  if (t[1] && D(t[1].id)?.team_id === D(t[0].id)?.team_id) P.signal('teammates_top_two');
  const left = X.raceEvents(ev.season).filter((e) => (after ? e.start_utc > ev.start_utc : e.start_utc >= ev.start_utc) && e.status !== 'canceled');
  P.fact('rounds_left', left.length, left.length === 1 ? 'one round' : `${left.length} rounds`, `Rounds remaining${after ? ' after this one' : ' including this one'}`, 'projection: events');
  const sprintsLeft = left.filter((e) => e.sprint).length;
  P.fact('sprints_left', sprintsLeft, sprintsLeft === 0 ? 'no sprints' : sprintsLeft === 1 ? 'one sprint' : `${countWord(sprintsLeft)} sprints`, 'Sprint weekends remaining', 'projection: events');
  const sc = pointsScale(X, ev.season);
  if (sc.race_max) {
    P.fact('race_max', sc.race_max, pts(sc.race_max), 'Points for a race win this season', "derived: this season's race classifications");
    if (sc.sprint_max) P.fact('sprint_max', sc.sprint_max, pts(sc.sprint_max), 'Points for a sprint win this season', "derived: this season's sprint classifications");
    const maxLeft = left.length * sc.race_max + sprintsLeft * (sc.sprint_max || 0);
    P.derive('max_left', maxLeft, pts(maxLeft), 'Most points one driver can still score', { from: ['rounds_left', 'sprints_left', 'race_max'], rule: 'rounds × race maximum + sprints × sprint maximum' });
    P.derive('alive', t.filter((x) => x.p + maxLeft >= t[0].p).length, countWord(t.filter((x) => x.p + maxLeft >= t[0].p).length), 'Drivers who can still mathematically reach the leader', { from: ['max_left'], rule: 'points + max_left ≥ leader points' });
    if (t[1] && maxLeft) P.derive('lead_share', Math.round(((t[0].p - t[1].p) / maxLeft) * 100), `${Math.round(((t[0].p - t[1].p) / maxLeft) * 100)}%`, 'Lead as a share of the points still available', { from: ['c2_gap', 'max_left'], rule: 'lead ÷ max_left' });
    if (t[1] && t[0].p - t[1].p > maxLeft) P.signal('title_decided');
  }
  const back = upto.at(-6);
  if (back && t[1]) {
    const bt = Object.entries(back.drivers).sort((a, b) => a[1].pos - b[1].pos);
    P.fact('lead_then', bt[0][1].p - bt[1][1].p, pts(bt[0][1].p - bt[1][1].p), `Championship lead after round ${back.round}`, 'projection: standings progression');
    P.fact('lead_then_round', back.round, `round ${back.round}`, 'Comparison round', 'projection: standings progression');
    if (bt[0][0] !== t[0].id) { P.entity('leader_then', 'driver', bt[0][0], D(bt[0][0])?.name); P.signal('leader_changed_recently'); }
    else P.signal(t[0].p - t[1].p > bt[0][1].p - bt[1][1].p ? 'lead_growing' : t[0].p - t[1].p < bt[0][1].p - bt[1][1].p ? 'lead_shrinking' : 'lead_flat');
  }
  const cons = Object.entries(now.constructors || {}).map(([id, v]) => ({ id, ...v })).sort((a, b) => a.pos - b.pos);
  if (cons[1]) { P.entity('con1', 'team', cons[0].id, C(cons[0].id)?.name); P.entity('con2', 'team', cons[1].id, C(cons[1].id)?.name); P.fact('con1_points', cons[0].p, pts(cons[0].p), "Constructors' leader points", 'projection: standings progression'); P.derive('con_gap', cons[0].p - cons[1].p, pts(cons[0].p - cons[1].p), "Constructors' lead", { from: ['standings progression'], rule: 'difference' }); }
  return { table: t, upto, before: after && idx > 0 ? prog[idx - 1] : null };
}

// the circuit's archive before an event: editions, pole and front-row conversion, winners
export function addArchive(P, X, circuitId, beforeIso) {
  const D = (id) => X.driver[id], C = (id) => X.con[id];
  const prior = X.eventsAtCircuit(circuitId).filter((e) => e.start_utc < beforeIso && e.status === 'completed' && X.session(e.id, 'race'));
  const winRow = (e) => X.rows(e.id, 'race').find((r) => r.position === 1 && r.status === 'classified');
  const classified = prior.filter((e) => winRow(e));
  if (!classified.length) { P.signal('first_race_here'); return null; }
  P.fact('held', prior.length, prior.length === 1 ? 'one previous Grand Prix' : `${prior.length} previous Grands Prix`, 'Grands Prix held here before this one (our archive)', 'derived: our race archive');
  if (classified.length !== prior.length) P.limit(`Our archive has no classification for ${prior.length - classified.length} earlier race${prior.length - classified.length > 1 ? 's' : ''} here; archive figures use the ${classified.length} classified editions.`);
  P.fact('arch_n', classified.length, `${classified.length}`, 'Classified editions here before this race', 'derived: our race archive');
  const poleWins = classified.filter((e) => winRow(e).grid === 1).length, front = classified.filter((e) => winRow(e).grid <= 2).length;
  P.fact('arch_pole_wins', poleWins, `${poleWins} of ${classified.length}`, 'Earlier races here won from pole', 'derived: our race archive');
  P.fact('arch_front_row', front, `${front} of ${classified.length}`, 'Earlier races here won from the front row', 'derived: our race archive');
  const last = classified.at(-1), lw = winRow(last);
  P.entity('last_winner', 'driver', lw.driver_id, D(lw.driver_id)?.name);
  P.entity('last_race', 'race', last.id, `${last.season} ${last.name}`);
  P.fact('last_winner_grid', lw.grid, posText(lw.grid), `Winner's grid slot in ${last.season}`, 'derived: our race archive');
  const dW = {};
  for (const e of classified) dW[winRow(e).driver_id] = (dW[winRow(e).driver_id] || 0) + 1;
  const top = Object.entries(dW).sort((a, b) => b[1] - a[1])[0];
  if (top[1] >= 2) { P.entity('most_wins', 'driver', top[0], D(top[0])?.name); P.fact('most_wins_n', top[1], `${countWord(top[1])} wins`, 'Most wins here before this race', 'derived: our race archive'); }
  return { classified, winRow, dW };
}

// last FORM_WINDOW races before an instant, for the given driver keys
export function addForm(P, X, season, beforeIso, keys) {
  const D = (id) => X.driver[id];
  const F = M.seasonFrame(X, season);
  F.races = F.races.filter((e) => e.start_utc < beforeIso);
  if (F.races.length < 3) return null;
  const fw = Math.min(M.FORM_WINDOW, F.races.length);
  P.fact('form_window', fw, `the ${countWord(fw)} races before this one`, 'Form window', 'projection: events');
  const df = M.driverForm(X, F);
  for (const k of keys) {
    const id = P.entities.find((x) => x.key === k)?.ref, f = id && df.find((x) => x.driver_id === id);
    if (!f) continue;
    const wins = f.last.filter((x) => x === 1).length, pods = f.last.filter((x) => x !== 'DNF' && x != null && x <= 3).length;
    P.fact(`${k}_fpts`, f.recent.points, pts(f.recent.points), `${D(id)?.name} points in the form window`, 'derived: race classification');
    P.fact(`${k}_ffin`, f.last.join(','), f.last.map((x) => (x === 'DNF' ? 'a retirement' : x == null ? 'no start' : `P${x}`)).join(', '), `${D(id)?.name} form-window finishes, oldest first`, 'derived: race classification');
    P.fact(`${k}_fwins`, wins, wins === 0 ? 'no wins' : wins === 1 ? 'one win' : `${countWord(wins)} wins`, `${D(id)?.name} wins in the form window`, 'derived: race classification');
    P.fact(`${k}_fpods`, pods, pods === 0 ? 'no podiums' : pods === 1 ? 'one podium' : `${countWord(pods)} podiums`, `${D(id)?.name} podiums in the form window`, 'derived: race classification');
  }
  return F;
}

// season teammate battle for a team, up to an instant (inclusive), under a key
export function addBattle(P, X, season, uptoIso, teamId, k) {
  const D = (id) => X.driver[id], C = (id) => X.con[id];
  const F = M.seasonFrame(X, season);
  F.races = F.races.filter((e) => e.start_utc <= uptoIso);
  const t = M.teammateBattles(X, F).find((b) => b.team_id === teamId);
  if (!t || t.races < 3) return null;
  P.entity(`${k}_team`, 'team', t.team_id, C(t.team_id)?.name); P.entity(`${k}_a`, 'driver', t.a, D(t.a)?.name); P.entity(`${k}_b`, 'driver', t.b, D(t.b)?.name);
  P.entity(`${k}_match`, 'matchup', `${t.a}|${t.b}`, `${D(t.a)?.last_name} vs ${D(t.b)?.last_name}`);
  P.fact(`${k}_q`, `${t.quali[0]}-${t.quali[1]}`, `${Math.max(...t.quali)}–${Math.min(...t.quali)}`, `${C(t.team_id)?.name} qualifying head-to-head this season (leader first)`, 'derived: qualifying classification');
  P.fact(`${k}_r`, `${t.race[0]}-${t.race[1]}`, `${Math.max(...t.race)}–${Math.min(...t.race)}`, `${C(t.team_id)?.name} race head-to-head this season, both classified (leader first)`, 'derived: race classification');
  P.fact(`${k}_pts`, `${t.points[0]}-${t.points[1]}`, `${Math.max(...t.points)} to ${Math.min(...t.points)}`, `${C(t.team_id)?.name} points this season (leader first)`, 'derived: race classification');
  if (t.median_gap_pct != null) P.fact(`${k}_gap`, Math.round(Math.abs(t.median_gap_pct) * 100) / 100, `${Math.abs(t.median_gap_pct).toFixed(2)}%`, `${C(t.team_id)?.name} median qualifying gap this season`, 'derived: qualifying classification');
  P.context[k] = { q: t.quali[0] === t.quali[1] ? 'level' : t.quali[0] > t.quali[1] ? 'a' : 'b', r: t.race[0] === t.race[1] ? 'level' : t.race[0] > t.race[1] ? 'a' : 'b', p: t.points[0] >= t.points[1] ? 'a' : 'b', a: t.a, b: t.b };
  return t;
}

export function addDna(P, X, k) {
  const id = P.entities.find((x) => x.key === k)?.ref, dna = id && X.dnaDriver[id]?.current;
  if (!dna) return;
  if (!P.has('dna_window')) { P.fact('dna_window', dna.window, dna.window, 'Driver DNA window', 'projection: dna-driver'); P.limit(`Driver DNA is quoted from the ${dna.window} window as of publication, not as it stood before this event.`); }
  const top = Object.entries(dna.dimensions).filter(([, v]) => v.percentile != null && v.confidence !== 'low').sort((a, b) => b[1].percentile - a[1].percentile)[0];
  if (top) { P.fact(`${k}_dna`, top[1].label, top[1].label, `${X.driver[id]?.name} strongest Driver DNA dimension`, 'projection: dna-driver'); P.fact(`${k}_dna_p`, top[1].percentile, `${ordinal(top[1].percentile)} percentile`, `${X.driver[id]?.name} ${top[1].label} percentile`, 'projection: dna-driver'); }
}

export function addPages(P, season, eventId) {
  P.entity('page_standings', 'page', '/standings', `${season} championship standings`);
  P.entity('page_intel', 'page', '/intelligence', 'F1 Intelligence');
  P.entity('page_teammates', 'page', '/intelligence/teammates', 'every teammate battle');
  P.entity('page_form', 'page', '/intelligence/form', 'form guide');
  P.entity('page_circuits', 'page', '/intelligence/circuits', 'Circuit Intelligence');
  P.entity('page_pbecast', 'page', '/pbecast', 'PBEcast');
}
