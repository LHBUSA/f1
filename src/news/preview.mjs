// RACE PREVIEW packet (v2): everything legitimately known before the weekend. The event and its venue (including a
// relocated round), the championship with calculated stakes, the circuit's measured layout and its full archive,
// form and momentum, teammate battles, constructor form, and descriptive Circuit Fit with its components.
// Nothing from the weekend's own sessions is used and nothing is predicted. Stale once the race starts.
import { Packet, posText, pts, fmtDay, countWord, ordinal } from './packet.mjs';
import { loadGeometry, layoutMetrics } from './geometry.mjs';
import * as M from '../intel/metrics.mjs';

export const PREVIEW_VERSION = 'f1-preview@2.0.0';

// points scale observed in this season's own results (never assumed): race winner and sprint winner maxima
function pointsScale(X, season) {
  const races = X.completedRaces(season);
  const gp = races.filter((e) => !e.sprint).flatMap((e) => X.rows(e.id, 'race').map((r) => r.points || 0));
  const sp = races.filter((e) => e.sprint).flatMap((e) => X.rows(e.id, 'sprint').map((r) => r.points || 0));
  return { race_max: gp.length ? Math.max(...gp) : null, sprint_max: sp.length ? Math.max(...sp) : null };
}
const pct = (s) => s.replace(/(\d+)th pct/, (m, n) => `${ordinal(Number(n))} percentile`);

export function previewPacket(X, eventId, { asOf = new Date().toISOString() } = {}) {
  const ev = X.event[eventId];
  if (!ev || ev.status === 'canceled') return { ok: false, reason: 'unknown_or_canceled' };
  const race = X.session(eventId, 'race');
  if (!race?.start_utc) return { ok: false, reason: 'no_race_session' };
  const P = new Packet('preview', `preview:${eventId}`, { event_id: eventId, as_of: asOf });
  P.context.valid_until = race.start_utc;
  P.context.version = PREVIEW_VERSION;
  const D = (id) => X.driver[id], C = (id) => X.con[id];
  const title = `${ev.season} ${ev.name}`;
  const season = ev.season;
  const ent = (k) => P.entities.find((x) => x.key === k)?.ref;

  // ---------- event + venue ----------
  P.fact('event', title, title, 'Event', 'projection: events');
  P.entity('race', 'race', ev.id, title);
  P.fact('round', ev.round, `round ${ev.round}`, 'Championship round', 'projection: events');
  P.fact('race_date', race.start_utc, fmtDay(race.start_utc), 'Race start', 'projection: sessions');
  const q = X.session(eventId, 'qualifying');
  if (q?.start_utc) P.fact('quali_date', q.start_utc, fmtDay(q.start_utc), 'Qualifying', 'projection: sessions');
  if (race.laps_scheduled) P.fact('laps', race.laps_scheduled, `${race.laps_scheduled} laps`, 'Scheduled race distance', 'projection: sessions');
  if (ev.sprint) P.signal('sprint_weekend');
  const circ = X.circuit[ev.circuit_id];
  if (!circ) return { ok: false, reason: 'no_circuit' };
  P.entity('circuit', 'circuit', circ.id, circ.name);
  if (circ.country) P.fact('country', circ.country, circ.country, 'Circuit country', 'projection: circuits');
  if (ev.relocated_from) {
    const o = X.event[ev.relocated_from.event_id];
    P.entity('orig_race', 'race', ev.relocated_from.event_id, `${o?.season} ${o?.name}`.trim());
    if (X.circuit[ev.relocated_from.original_circuit_id]) P.entity('orig_circuit', 'circuit', ev.relocated_from.original_circuit_id, X.circuit[ev.relocated_from.original_circuit_id].name);
    if (o?.start_utc) P.fact('orig_date', o.start_utc, fmtDay(o.start_utc), 'Original date of the relocated round', 'projection: events');
    P.fact('gp_title', ev.name.replace(/ in .+$/, ''), ev.name.replace(/ in .+$/, ''), 'Grand Prix title of the relocated round', 'projection: events (relocation link)');
    P.signal('relocated', { from: ev.relocated_from.event_id });
  }
  if (circ.latest_layout?.length_km) P.fact('lap_km', circ.latest_layout.length_km, `${circ.latest_layout.length_km} km`, 'Lap length (published, latest layout)', 'projection: circuits');
  if (circ.latest_layout?.turns) P.fact('turns', circ.latest_layout.turns, `${circ.latest_layout.turns} turns`, 'Turns (published, latest layout)', 'projection: circuits');

  // measured layout character (OSM geometry), ranked against the other mapped circuits on this calendar
  const lm = layoutMetrics(loadGeometry(circ.id));
  if (lm) {
    P.fact('longest_straight', lm.longest_straight_m, `about ${lm.longest_straight_m} m`, 'Longest straight (measured from circuit geometry)', `derived: ${lm.source}`);
    if (lm.second_straight_m >= 500) { P.fact('second_straight', lm.second_straight_m, `about ${lm.second_straight_m} m`, 'Second-longest straight (measured)', `derived: ${lm.source}`); P.signal('two_long_straights'); }
    P.fact('straight_share', Math.round(lm.straight_share * 100), `${Math.round(lm.straight_share * 100)}%`, 'Share of the lap on straights of 200 m or more (measured)', `derived: ${lm.source}`);
    P.fact('corner_split', `${lm.right}/${lm.left}`, `${lm.right} right-handers and ${lm.left} left-handers`, 'Detected corners by direction (measured; detection can merge linked turns)', `derived: ${lm.source}`);
    if (lm.right >= lm.left * 1.5) P.signal('right_handed');
    const peers = X.raceEvents(season).map((e) => e.circuit_id).filter((c, i, a) => a.indexOf(c) === i).map((c) => ({ c, m: layoutMetrics(loadGeometry(c)) })).filter((x) => x.m);
    if (peers.length >= 6) {
      const byShare = [...peers].sort((a, b) => b.m.straight_share - a.m.straight_share);
      const rank = byShare.findIndex((x) => x.c === circ.id) + 1;
      P.fact('straight_rank', rank, `${ordinal(rank)} of the ${peers.length} calendar circuits we have mapped`, 'Rank by straight share among mapped calendar circuits', 'derived: circuit geometry (this calendar)');
      const most = byShare[0], least = byShare.at(-1);
      if (most.c !== circ.id && X.circuit[most.c]) { P.entity('peer_fast', 'circuit', most.c, X.circuit[most.c].name); P.fact('peer_fast_share', Math.round(most.m.straight_share * 100), `${Math.round(most.m.straight_share * 100)}%`, `${X.circuit[most.c].name} straight share`, 'derived: circuit geometry'); }
      if (least.c !== circ.id && X.circuit[least.c]) { P.entity('peer_slow', 'circuit', least.c, X.circuit[least.c].name); P.fact('peer_slow_share', Math.round(least.m.straight_share * 100), `${Math.round(least.m.straight_share * 100)}%`, `${X.circuit[least.c].name} straight share`, 'derived: circuit geometry'); }
    }
  }

  // ---------- circuit archive ----------
  const prior = X.eventsAtCircuit(circ.id).filter((e) => e.start_utc < ev.start_utc && e.status === 'completed' && X.session(e.id, 'race'));
  const winRow = (e) => X.rows(e.id, 'race').find((r) => r.position === 1 && r.status === 'classified');
  const classified = prior.filter((e) => winRow(e));
  P.fact('held', prior.length, prior.length === 1 ? 'one World Championship Grand Prix' : `${prior.length} World Championship Grands Prix`, 'Grands Prix held here before this one (our archive)', 'derived: our race archive');
  if (classified.length !== prior.length) {
    const missing = prior.filter((e) => !classified.includes(e)).map((e) => e.season);
    P.fact('unclassified', missing.join(', '), missing.join(' and '), 'Editions with no published classification in our archive', 'derived: our race archive');
    P.fact('classified_n', classified.length, `${classified.length}`, 'Editions with a published classification', 'derived: our race archive');
    P.limit(`Our archive holds no classification for the ${missing.join(', ')} race${missing.length > 1 ? 's' : ''} here, so archive figures use the ${classified.length} classified editions.`);
  }
  if (classified.length) {
    const first = prior[0], last = prior.at(-1);
    P.fact('first_held', first.season, String(first.season), 'First Grand Prix here (our archive)', 'derived: our race archive');
    P.fact('last_held', last.season, String(last.season), 'Most recent previous Grand Prix here', 'derived: our race archive');
    if (season - last.season >= 3) { P.derive('years_away', season - last.season, `${season - last.season} years`, 'Years since the last Grand Prix here', { from: ['last_held'], rule: 'season minus last held' }); P.signal('return_after_gap'); }
    const poleWins = classified.filter((e) => winRow(e).grid === 1).length;
    P.fact('arch_pole_wins', poleWins, `${poleWins} of the ${classified.length}`, 'Classified editions won from pole', 'derived: our race archive');
    const frontRow = classified.filter((e) => winRow(e).grid <= 2).length;
    P.fact('arch_front_row', frontRow, `${frontRow} of the ${classified.length}`, 'Classified editions won from the front row', 'derived: our race archive');
    const deepest = [...classified].sort((a, b) => winRow(b).grid - winRow(a).grid)[0];
    if (winRow(deepest).grid >= 5) { P.entity('deep_winner', 'driver', winRow(deepest).driver_id, D(winRow(deepest).driver_id)?.name); P.entity('deep_race', 'race', deepest.id, `${deepest.season} ${deepest.name}`); P.fact('deep_grid', winRow(deepest).grid, posText(winRow(deepest).grid), 'Deepest winning grid slot here', 'derived: our race archive'); }
    const rate = classified.reduce((s, e) => { const r = X.rows(e.id, 'race'); return s + r.filter((x) => x.status === 'classified').length / Math.max(1, r.length); }, 0) / classified.length;
    P.fact('arch_class_rate', Math.round(rate * 100), `${Math.round(rate * 100)}%`, 'Average share of starters classified here (classified editions)', 'derived: our race archive');
    const dW = {}, cW = {};
    for (const e of classified) { const w = winRow(e); dW[w.driver_id] = (dW[w.driver_id] || 0) + 1; const lin = C(w.constructor_id)?.lineage_id || w.constructor_id; cW[lin] = cW[lin] || { n: 0, id: w.constructor_id }; cW[lin].n++; cW[lin].id = w.constructor_id; }
    const topD = Object.entries(dW).sort((a, b) => b[1] - a[1])[0];
    if (topD && topD[1] >= 2) { P.entity('most_wins', 'driver', topD[0], D(topD[0])?.name); P.fact('most_wins_n', topD[1], `${countWord(topD[1])} wins`, 'Most wins here (driver)', 'derived: our race archive'); }
    const topC = Object.values(cW).sort((a, b) => b.n - a.n)[0];
    if (topC && topC.n >= 2 && C(topC.id)) { P.entity('most_wins_team', 'team', topC.id, C(topC.id).name); P.fact('most_wins_team_n', topC.n, `${countWord(topC.n)} wins`, 'Most wins here (constructor lineage)', 'derived: our race archive'); }
    classified.slice(-3).reverse().forEach((e, i) => { const w = winRow(e); P.entity(`recent_w${i + 1}`, 'driver', w.driver_id, D(w.driver_id)?.name); if (C(w.constructor_id)) P.entity(`recent_t${i + 1}`, 'team', w.constructor_id, C(w.constructor_id).name); P.fact(`recent_y${i + 1}`, e.season, String(e.season), `Winner here in ${e.season}`, 'derived: our race archive'); P.fact(`recent_g${i + 1}`, w.grid, posText(w.grid), `${e.season} winning grid slot`, 'derived: our race archive'); });
    const recentPole = classified.slice(-3).filter((e) => winRow(e).grid === 1).length;
    P.signal(recentPole === 0 ? 'recent_winners_no_pole' : 'recent_winners_some_pole', { n: recentPole });
    const gridW = Object.entries(dW).filter(([id]) => X.currentGrid.includes(id)).sort((a, b) => b[1] - a[1]);
    P.fact('grid_winners_count', gridW.length, countWord(gridW.length), 'Current-grid drivers with a win here', 'derived: our race archive');
    gridW.slice(0, 3).forEach(([id, n], i) => { P.entity(`gw${i + 1}`, 'driver', id, D(id)?.name); P.fact(`gw${i + 1}_wins`, n, n === 1 ? 'one win' : `${countWord(n)} wins`, `${D(id)?.name} wins here`, 'derived: our race archive'); const yrs = classified.filter((e) => winRow(e).driver_id === id).map((e) => e.season); P.fact(`gw${i + 1}_years`, yrs.join(','), yrs.length > 1 ? `${yrs.slice(0, -1).join(', ')} and ${yrs.at(-1)}` : String(yrs[0]), `${D(id)?.name} winning years here`, 'derived: our race archive'); });
  }
  const cd = X.dnaCircuit[circ.id];
  if (cd) { P.fact('dna_recent', cd.recent_races, cd.recent_races === 1 ? 'one race' : `${countWord(cd.recent_races)} races`, 'Races inside the Circuit DNA recency window', 'projection: dna-circuit'); if (cd.recent_races < 5) P.signal('thin_circuit_sample'); }

  // ---------- championship + calculated stakes ----------
  const prog = X.standingsBy[season]?.progression || [];
  const cut = prog.findIndex((r) => X.event[r.event_id]?.start_utc >= ev.start_utc);
  const progBefore = cut === -1 ? prog : prog.slice(0, cut);
  const before = progBefore.at(-1);
  if (before) {
    const t = Object.entries(before.drivers).map(([id, v]) => ({ id, ...v })).sort((a, b) => a.pos - b.pos);
    P.entity('leader', 'driver', t[0].id, D(t[0].id)?.name);
    if (C(D(t[0].id)?.team_id)) P.entity('leader_team', 'team', D(t[0].id).team_id, C(D(t[0].id).team_id).name);
    P.fact('leader_points', t[0].p, pts(t[0].p), 'Leader points going in', 'projection: standings progression');
    t.slice(1, 5).forEach((x, i) => { const k = `c${i + 2}`; P.entity(k, 'driver', x.id, D(x.id)?.name); P.fact(`${k}_points`, x.p, pts(x.p), `${D(x.id)?.name} points going in`, 'projection: standings progression'); P.derive(`${k}_gap`, t[0].p - x.p, pts(t[0].p - x.p), `${D(x.id)?.name} deficit to the leader`, { from: ['leader_points', `${k}_points`], rule: 'difference' }); });
    if (t[1] && D(t[1].id)?.team_id === D(t[0].id)?.team_id) P.signal('teammates_top_two');
    const done = X.completedRaces(season).filter((e) => e.start_utc < ev.start_utc).length;
    const left = X.raceEvents(season).filter((e) => e.start_utc >= ev.start_utc && e.status !== 'canceled');
    P.fact('rounds_done', done, `${done} rounds`, 'Rounds completed', 'projection: events');
    P.fact('rounds_left', left.length, left.length === 1 ? 'one round' : `${left.length} rounds`, 'Rounds remaining including this one', 'projection: events');
    const sprintsLeft = left.filter((e) => e.sprint).length;
    P.fact('sprints_left', sprintsLeft, sprintsLeft === 0 ? 'no sprints' : sprintsLeft === 1 ? 'one sprint' : `${countWord(sprintsLeft)} sprints`, 'Sprint weekends remaining', 'projection: events');
    const sc = pointsScale(X, season);
    if (sc.race_max) {
      P.fact('race_max', sc.race_max, pts(sc.race_max), 'Points for a race win this season', 'derived: this season\'s race classifications');
      if (sc.sprint_max) P.fact('sprint_max', sc.sprint_max, pts(sc.sprint_max), 'Points for a sprint win this season', 'derived: this season\'s sprint classifications');
      const maxLeft = left.length * sc.race_max + sprintsLeft * (sc.sprint_max || 0);
      P.derive('max_left', maxLeft, pts(maxLeft), 'Most points one driver can still score', { from: ['rounds_left', 'sprints_left', 'race_max', 'sprint_max'], rule: 'rounds × race maximum + sprints × sprint maximum' });
      const alive = t.filter((x) => x.p + maxLeft >= t[0].p).length;
      P.derive('alive', alive, countWord(alive), 'Drivers who can still mathematically reach the leader', { from: ['max_left', 'standings progression'], rule: 'points + max_left ≥ leader points' });
      const thisMax = sc.race_max + (ev.sprint ? sc.sprint_max || 0 : 0);
      const afterMax = maxLeft - thisMax;
      P.derive('max_after', afterMax, pts(afterMax), 'Points still available after this weekend', { from: ['max_left', 'race_max'], rule: 'minus this weekend' });
      P.signal(t[1] && t[0].p - t[1].p + thisMax > afterMax ? 'clinch_possible' : 'no_clinch');
      if (t[1]) P.derive('lead_share', Math.round(((t[0].p - t[1].p) / maxLeft) * 100), `${Math.round(((t[0].p - t[1].p) / maxLeft) * 100)}%`, 'Lead as a share of the points still available', { from: ['c2_gap', 'max_left'], rule: 'lead ÷ max_left' });
      const back = progBefore.at(-6);
      if (back && t[1]) {
        const bt = Object.entries(back.drivers).sort((a, b) => a[1].pos - b[1].pos);
        P.fact('lead_then', bt[0][1].p - bt[1][1].p, pts(bt[0][1].p - bt[1][1].p), `Championship lead after round ${back.round}`, 'projection: standings progression');
        P.fact('lead_then_round', back.round, `round ${back.round}`, 'Comparison round', 'projection: standings progression');
        if (bt[0][0] !== t[0].id) { P.entity('leader_then', 'driver', bt[0][0], D(bt[0][0])?.name); P.signal('leader_changed_recently'); }
        else P.signal((t[0].p - t[1].p) > (bt[0][1].p - bt[1][1].p) ? 'lead_growing' : (t[0].p - t[1].p) < (bt[0][1].p - bt[1][1].p) ? 'lead_shrinking' : 'lead_flat');
      }
    }
    const cons = Object.entries(before.constructors || {}).map(([id, v]) => ({ id, ...v })).sort((a, b) => a.pos - b.pos);
    if (cons[1]) { P.entity('con1', 'team', cons[0].id, C(cons[0].id)?.name); P.entity('con2', 'team', cons[1].id, C(cons[1].id)?.name); P.fact('con1_points', cons[0].p, pts(cons[0].p), "Constructors' leader points", 'projection: standings progression'); P.derive('con_gap', cons[0].p - cons[1].p, pts(cons[0].p - cons[1].p), "Constructors' lead", { from: ['standings progression'], rule: 'difference' }); }
    P.chart('championship', { title: "Drivers' championship going in", kind: 'line', x: progBefore.map((r) => r.round), series: t.slice(0, 5).map((x) => ({ id: x.id, name: D(x.id)?.name, color: C(D(x.id)?.team_id)?.color || null, values: progBefore.map((r) => r.drivers[x.id]?.p ?? null) })) });
  }

  // ---------- form, constructors and teammates (form window before this event) ----------
  const F = M.seasonFrame(X, season);
  F.races = F.races.filter((e) => e.start_utc < ev.start_utc);
  const fw = Math.min(M.FORM_WINDOW, F.races.length);
  P.fact('form_window', fw, `the last ${countWord(fw)} races`, 'Form window', 'projection: events');
  const df = M.driverForm(X, F);
  const formOf = (id) => df.find((x) => x.driver_id === id);
  for (const k of ['leader', 'c2', 'c3', 'c4']) {
    const id = ent(k), f = id && formOf(id);
    if (!f) continue;
    P.fact(`${k}_fpts`, f.recent.points, pts(f.recent.points), `${D(id)?.name} points in the form window`, 'derived: race classification');
    P.fact(`${k}_ffin`, f.last.join(','), f.last.map((x) => (x === 'DNF' ? 'a retirement' : `P${x}`)).join(', '), `${D(id)?.name} finishes in the form window, oldest first`, 'derived: race classification');
    const wins = f.last.filter((x) => x === 1).length, pods = f.last.filter((x) => x !== 'DNF' && x != null && x <= 3).length;
    P.fact(`${k}_fwins`, wins, wins === 0 ? 'no wins' : wins === 1 ? 'one win' : `${countWord(wins)} wins`, `${D(id)?.name} wins in the form window`, 'derived: race classification');
    P.fact(`${k}_fpods`, pods, pods === 0 ? 'no podiums' : pods === 1 ? 'one podium' : `${countWord(pods)} podiums`, `${D(id)?.name} podiums in the form window`, 'derived: race classification');
  }
  const hot = [...df].sort((a, b) => b.recent.points - a.recent.points)[0];
  if (hot) { P.entity('hot', 'driver', hot.driver_id, D(hot.driver_id)?.name); P.fact('hot_pts', hot.recent.points, pts(hot.recent.points), 'Most points in the form window', 'derived: race classification'); }
  const imp = df.filter((x) => x.delta_ppr != null).sort((a, b) => b.delta_ppr - a.delta_ppr)[0];
  if (imp && imp.delta_ppr >= 2) { P.entity('improver', 'driver', imp.driver_id, D(imp.driver_id)?.name); P.fact('improver_delta', Math.round(imp.delta_ppr * 10) / 10, `${(Math.round(imp.delta_ppr * 10) / 10).toFixed(1)} points per race`, 'Biggest rise in points per race, form window vs the five races before', 'derived: race classification'); }
  const cf = M.constructorForm(X, F);
  cf.slice(0, 4).forEach((c, i) => { const k = `cf${i + 1}`; P.entity(k, 'team', c.team_id, C(c.team_id)?.name); P.fact(`${k}_pts`, c.points, pts(c.points), `${C(c.team_id)?.name} points in the form window`, 'derived: race classification'); P.fact(`${k}_dnf`, c.dnf, c.dnf === 0 ? 'no retirements' : c.dnf === 1 ? 'one retirement' : `${countWord(c.dnf)} retirements`, `${C(c.team_id)?.name} retirements in the form window`, 'derived: race classification'); if (c.best_quali_avg != null) P.fact(`${k}_q`, Math.round(c.best_quali_avg * 10) / 10, (Math.round(c.best_quali_avg * 10) / 10).toFixed(1), `${C(c.team_id)?.name} average best qualifying position in the form window`, 'derived: qualifying classification'); });
  const FS = M.seasonFrame(X, season);
  FS.races = F.races;
  M.teammateBattles(X, FS).slice(0, 3).forEach((t, i) => {
    const k = `tb${i + 1}`;
    P.entity(`${k}_team`, 'team', t.team_id, C(t.team_id)?.name); P.entity(`${k}_a`, 'driver', t.a, D(t.a)?.name); P.entity(`${k}_b`, 'driver', t.b, D(t.b)?.name);
    P.entity(`${k}_match`, 'matchup', `${t.a}|${t.b}`, `${D(t.a)?.last_name} vs ${D(t.b)?.last_name}`);
    P.fact(`${k}_q`, `${t.quali[0]}-${t.quali[1]}`, `${Math.max(...t.quali)}–${Math.min(...t.quali)}`, `${C(t.team_id)?.name} qualifying head-to-head this season (leader first)`, 'derived: qualifying classification');
    P.fact(`${k}_r`, `${t.race[0]}-${t.race[1]}`, `${Math.max(...t.race)}–${Math.min(...t.race)}`, `${C(t.team_id)?.name} race head-to-head this season, both classified (leader first)`, 'derived: race classification');
    P.fact(`${k}_pts`, `${t.points[0]}-${t.points[1]}`, `${Math.max(...t.points)} to ${Math.min(...t.points)}`, `${C(t.team_id)?.name} points this season (leader first)`, 'derived: race classification');
    if (t.median_gap_pct != null) P.fact(`${k}_gap`, Math.round(Math.abs(t.median_gap_pct) * 100) / 100, `${Math.abs(t.median_gap_pct).toFixed(2)}%`, `${C(t.team_id)?.name} median qualifying gap (deepest shared segment)`, 'derived: qualifying classification');
    P.context[k] = { q: t.quali[0] === t.quali[1] ? 'level' : t.quali[0] > t.quali[1] ? 'a' : 'b', r: t.race[0] === t.race[1] ? 'level' : t.race[0] > t.race[1] ? 'a' : 'b', p: t.points[0] >= t.points[1] ? 'a' : 'b', faster: t.median_gap_pct == null ? null : t.median_gap_pct <= 0 ? 'b' : 'a' };
  });

  // ---------- Circuit Fit (descriptive) ----------
  const fit = X.fit[eventId];
  if (fit?.drivers?.length) {
    fit.drivers.slice(0, 3).forEach((r, i) => {
      const k = `fit${i + 1}`;
      P.entity(k, 'driver', r.driver_id, D(r.driver_id)?.name);
      if (C(r.constructor_id)) P.entity(`${k}_team`, 'team', r.constructor_id, C(r.constructor_id).name);
      P.fact(`${k}_score`, r.fit_score, String(r.fit_score), `${D(r.driver_id)?.name} Circuit Fit score`, 'projection: fit');
      const comps = [...r.components].sort((a, b) => b.percentile * b.weight - a.percentile * a.weight);
      comps.slice(0, 2).forEach((c, j) => { P.fact(`${k}_c${j + 1}`, c.label, c.label, `${D(r.driver_id)?.name} fit component`, 'projection: fit'); P.fact(`${k}_c${j + 1}_p`, c.percentile, `${ordinal(c.percentile)} percentile`, `${D(r.driver_id)?.name} ${c.label} percentile`, 'projection: fit'); });
      const weak = [...r.components].sort((a, b) => a.percentile - b.percentile)[0];
      if (weak && weak.percentile < 70) { P.fact(`${k}_weak`, weak.label, weak.label, `${D(r.driver_id)?.name} weakest fit component`, 'projection: fit'); P.fact(`${k}_weak_p`, weak.percentile, `${ordinal(weak.percentile)} percentile`, `${D(r.driver_id)?.name} weakest component percentile`, 'projection: fit'); }
    });
    const w = fit.drivers[0].components.map((c) => ({ label: c.label, why: c.why, weight: c.weight })).sort((a, b) => b.weight - a.weight);
    if (w[0]) { P.fact('fit_heavy', w[0].label, w[0].label, 'Most heavily weighted fit component here', 'projection: fit'); P.fact('fit_heavy_why', w[0].why, pct(w[0].why), 'Circuit profile behind the heaviest weight', 'projection: fit'); }
    if (w.length > 1) { P.fact('fit_light', w.at(-1).label, w.at(-1).label, 'Least weighted fit component here', 'projection: fit'); const n = /(\d+)th pct/.exec(w.at(-1).why)?.[1]; if (n && /track position/i.test(w.at(-1).why)) P.fact('track_pos_pct', Number(n), `${ordinal(Number(n))} percentile`, 'Circuit DNA track-position importance (low confidence)', 'projection: fit'); }
    P.fact('fit_confidence', fit.drivers[0].confidence, fit.drivers[0].confidence, 'Circuit Fit confidence', 'projection: fit');
    const li = fit.drivers.findIndex((r) => r.driver_id === ent('leader'));
    if (li >= 0) { P.fact('leader_fit_rank', li + 1, ordinal(li + 1), 'Championship leader Circuit Fit rank', 'projection: fit'); P.fact('leader_fit_score', fit.drivers[li].fit_score, String(fit.drivers[li].fit_score), 'Championship leader Circuit Fit score', 'projection: fit'); }
    (fit.constructors || []).slice(0, 2).forEach((c, i) => { P.entity(`fitc${i + 1}`, 'team', c.constructor_id, C(c.constructor_id)?.name); P.fact(`fitc${i + 1}_score`, c.fit_score, String(c.fit_score), `${C(c.constructor_id)?.name} constructor Circuit Fit`, 'projection: fit'); });
    P.chart('fit', { title: 'Circuit Fit, top eight drivers', kind: 'bars', rows: fit.drivers.slice(0, 8).map((r) => ({ driver_id: r.driver_id, code: D(r.driver_id)?.code, color: C(r.constructor_id)?.color || null, value: r.fit_score })) });
    if (fit.drivers[0].confidence === 'low') P.limit('Circuit Fit confidence is low here: the circuit profile rests on few recent races.');
  }
  // Driver DNA strongest dimension for the people the story discusses
  for (const k of ['leader', 'c2', 'fit1', 'gw1', 'hot']) {
    const id = ent(k), dna = id && X.dnaDriver[id]?.current;
    if (!dna) continue;
    if (!P.has('dna_window')) P.fact('dna_window', dna.window, dna.window, 'Driver DNA window', 'projection: dna-driver');
    const top = Object.entries(dna.dimensions).filter(([, v]) => v.percentile != null && v.confidence !== 'low').sort((a, b) => b[1].percentile - a[1].percentile)[0];
    if (top) { P.fact(`${k}_dna`, top[1].label, top[1].label, `${D(id)?.name} strongest Driver DNA dimension`, 'projection: dna-driver'); P.fact(`${k}_dna_p`, top[1].percentile, `${ordinal(top[1].percentile)} percentile`, `${D(id)?.name} ${top[1].label} percentile`, 'projection: dna-driver'); }
  }
  // site pages the story links to
  P.entity('page_standings', 'page', '/standings', `${season} championship standings`);
  P.entity('page_circuits', 'page', '/intelligence/circuits', 'Circuit Intelligence');
  P.entity('page_intel', 'page', '/intelligence', 'F1 Intelligence');
  P.entity('page_teammates', 'page', '/intelligence/teammates', 'every teammate battle');
  P.entity('page_form', 'page', '/intelligence/form', 'form guide');
  P.entity('page_pbecast', 'page', '/pbecast', 'PBEcast');
  P.limit("Circuit Fit is a descriptive match between current DNA and this circuit's profile. It is not a prediction, a probability or a betting signal.");
  if (lm) P.limit('Layout measurements come from OpenStreetMap geometry (ODbL) and describe the shape of the track only, not speeds, gears or tyres.');
  if (P.has('dna_window')) P.limit(`Driver DNA is quoted from the ${P.get('dna_window').value} window as of publication.`);
  return { ok: true, packet: P.freeze() };
}
