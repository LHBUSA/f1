// RACE FINAL packet: what the classification, qualifying, standings progression and our own DNA/archive say about one
// Grand Prix. Signals are tested rules over packet facts; a signal is never used without its rule.
import { Packet, gridText, posText, pts, fmtLap, secs, countWord, ordinal, gapMs } from './packet.mjs';
import { addStakes, addArchive, addForm, addBattle, addDna, addPages } from './context.mjs';
import { temporalFrame, nextEventAfter, venueDay } from './temporal.mjs';

export const RACE_RULES = {
  close_finish_ms: 2000, // winner's margin under two seconds
  dominant_finish_ms: 10000, // ten seconds or more
  climber_min: 4, // positions gained to be named the biggest climber
  high_attrition_min: 4, // retirements
  dna_strength_pct: 80, // a DNA dimension is a strength at the 80th percentile or above
};

// publishedAt = the story's frozen first-publication time (this build's time for a first publication): the copy's frame.
export function raceFinalPacket(X, eventId, { asOf = new Date().toISOString(), publishedAt = asOf, replay = null } = {}) {
  const ev = X.event[eventId];
  if (!ev) return { ok: false, reason: 'unknown_event' };
  const race = X.session(eventId, 'race');
  const rows = X.rows(eventId, 'race');
  const classified = rows.filter((r) => r.status === 'classified' && r.position);
  const w = classified.find((r) => r.position === 1);
  if (race?.state !== 'completed' || !w) return { ok: false, reason: 'race_not_complete' };
  const P = new Packet('race_final', `race_final:${eventId}`, { event_id: eventId, as_of: asOf });
  const D = (id) => X.driver[id];
  const C = (id) => X.con[id];
  const title = `${ev.season} ${ev.name}`;
  const quali = X.rows(eventId, 'qualifying');

  // ---- event ----
  P.fact('event', title, title, 'Event', 'projection: events');
  P.entity('race', 'race', ev.id, title);
  P.fact('round', ev.round, `round ${ev.round}`, 'Championship round', 'projection: events');
  P.fact('race_date', race.start_utc, venueDay(race.start_utc, ev.circuit_id), 'Race date (venue-local calendar day)', 'projection: sessions');
  const circ = X.circuit[ev.circuit_id];
  if (circ) P.entity('circuit', 'circuit', circ.id, circ.name);
  if (race.laps_scheduled) P.fact('laps_scheduled', race.laps_scheduled, `${race.laps_scheduled} laps`, 'Scheduled race distance', 'projection: sessions');

  // ---- podium ----
  const qpos = (id) => quali.find((r) => r.driver_id === id)?.position ?? null;
  const put = (k, r) => {
    const d = D(r.driver_id), c = C(r.constructor_id);
    P.entity(k, 'driver', d.id, d.name);
    if (c) P.entity(`${k}_team`, 'team', c.id, c.name);
    if (r.grid) P.fact(`${k}_grid`, r.grid, gridText(r.grid), `${d.name} starting position`, 'projection: race classification (grid)');
    const q = qpos(r.driver_id);
    // qualified in one place, started in another: both are published; the reason is not, so it is never stated
    if (q && r.grid && q !== r.grid) { P.fact(`${k}_quali`, q, posText(q), `${d.name} qualifying position`, 'projection: qualifying classification'); P.signal('grid_differs_from_quali', { who: k, quali: q, grid: r.grid }); }
    P.fact(`${k}_finish`, r.position, posText(r.position), `${d.name} finishing position`, 'projection: race classification');
    if (r.points != null) P.fact(`${k}_points`, r.points, pts(r.points), `${d.name} points scored this weekend`, 'projection: race classification (points incl. sprint)');
  };
  put('p1', w);
  const p2 = classified.find((r) => r.position === 2), p3 = classified.find((r) => r.position === 3);
  if (p2) put('p2', p2);
  if (p3) put('p3', p3);
  if (w.time) P.fact('p1_time', w.time_ms, w.time, 'Winning race time', 'projection: race classification');
  if (w.laps) P.fact('p1_laps', w.laps, `${w.laps} laps`, 'Laps completed by the winner', 'projection: race classification');
  if (w.pit_stops != null) P.fact('p1_stops', w.pit_stops, w.pit_stops === 1 ? 'one pit stop' : `${countWord(w.pit_stops)} pit stops`, 'Winner pit stops', 'projection: race classification (pit stops)');
  const margin = p2 ? gapMs(p2.gap) : null;
  if (margin != null) P.fact('margin', margin, secs(margin), 'Winning margin over second place', 'projection: race classification (gap)');
  else if (p2?.behind_laps) P.fact('margin_laps', p2.behind_laps, p2.behind_laps === 1 ? 'a lap' : `${p2.behind_laps} laps`, 'Second place was lapped by', 'projection: race classification');

  // ---- pole sitter (qualifying classification, else grid 1) ----
  const poleRow = quali.find((r) => r.position === 1) || rows.find((r) => r.grid === 1);
  if (poleRow) {
    const pd = D(poleRow.driver_id);
    const pr = rows.find((r) => r.driver_id === poleRow.driver_id);
    if (pd && pr && pd.id !== w.driver_id) {
      P.entity('pole', 'driver', pd.id, pd.name);
      P.fact('pole_result', pr.status === 'classified' ? pr.position : pr.status, pr.status === 'classified' ? posText(pr.position) : pr.status === 'retired' ? 'a retirement' : pr.status, `Pole-sitter ${pd.name} race result`, 'projection: race classification');
      P.signal(pr.status === 'classified' && pr.position <= 3 ? 'pole_sitter_on_podium' : 'pole_sitter_off_podium', { driver: pd.id });
    }
  }

  // laps led is not used: the source field does not measure laps led (see normalize.mjs)
  // ---- qualifying margin at the front ----
  const q1 = quali.find((r) => r.position === 1), q2 = quali.find((r) => r.position === 2);
  if (q1?.best_lap_ms && q2?.best_lap_ms && q1.driver_id === w.driver_id) {
    P.fact('pole_time', q1.best_lap_ms, fmtLap(q1.best_lap_ms), 'Pole lap', 'projection: qualifying classification');
    P.entity('q2', 'driver', q2.driver_id, D(q2.driver_id)?.name);
    P.derive('pole_gap', q2.best_lap_ms - q1.best_lap_ms, secs(q2.best_lap_ms - q1.best_lap_ms), 'Pole margin over second in qualifying', { from: ['pole_time', 'qualifying classification'], rule: 'second best lap minus pole lap' });
  }

  // ---- fastest lap ----
  const fl = rows.filter((r) => r.fastest_lap_ms).sort((a, b) => a.fastest_lap_ms - b.fastest_lap_ms)[0];
  if (fl) {
    P.entity('fl_driver', 'driver', fl.driver_id, D(fl.driver_id)?.name);
    P.fact('fl_time', fl.fastest_lap_ms, fl.fastest_lap || fmtLap(fl.fastest_lap_ms), 'Fastest lap of the race', 'projection: race classification (fastest lap)');
    if (fl.fastest_lap_number) P.fact('fl_lap', fl.fastest_lap_number, `lap ${fl.fastest_lap_number}`, 'Lap the fastest lap was set on', 'projection: race classification');
  }

  // ---- movement ----
  const movers = classified.filter((r) => r.grid && r.grid > r.position).map((r) => ({ r, g: r.grid - r.position })).sort((a, b) => b.g - a.g || a.r.position - b.r.position);
  const climb = movers[0];
  if (climb && climb.g >= RACE_RULES.climber_min && climb.r.driver_id !== w.driver_id) {
    P.entity('climber', 'driver', climb.r.driver_id, D(climb.r.driver_id).name);
    if (C(climb.r.constructor_id)) P.entity('climber_team', 'team', climb.r.constructor_id, C(climb.r.constructor_id).name);
    P.fact('climber_grid', climb.r.grid, posText(climb.r.grid), 'Biggest climber starting position', 'projection: race classification (grid)');
    P.fact('climber_finish', climb.r.position, posText(climb.r.position), 'Biggest climber finishing position', 'projection: race classification');
    P.derive('climber_gain', climb.g, climb.g === 1 ? 'one place' : `${countWord(climb.g)} places`, 'Positions gained by the biggest climber', { from: ['climber_grid', 'climber_finish'], rule: 'grid minus finish' });
  }
  const dnf = rows.filter((r) => r.status === 'retired');
  P.fact('retirements', dnf.length, dnf.length === 0 ? 'no retirements' : dnf.length === 1 ? 'one retirement' : `${countWord(dnf.length)} retirements`, 'Cars that retired', 'projection: race classification (status)');
  dnf.forEach((r, i) => { const d = D(r.driver_id); if (d) P.entity(`dnf${i + 1}`, 'driver', d.id, d.name); });
  P.fact('starters', rows.length, `${rows.length} starters`, 'Cars classified or retired', 'projection: race classification');
  // retirements in context: this season's races up to and including this one
  const seasonDnf = X.completedRaces(ev.season).filter((e) => e.start_utc <= ev.start_utc).map((e) => X.rows(e.id, 'race').filter((r) => r.status === 'retired').length);
  if (seasonDnf.length >= 5) {
    const avg = seasonDnf.reduce((a, b) => a + b, 0) / seasonDnf.length;
    P.fact('season_dnf_avg', Math.round(avg * 10) / 10, (Math.round(avg * 10) / 10).toFixed(1), 'Average retirements per race this season (to date)', 'derived: race classification');
    if (dnf.length === Math.max(...seasonDnf)) P.signal(seasonDnf.filter((n) => n === dnf.length).length === 1 ? 'most_dnf_season' : 'joint_most_dnf_season');
  }

  // ---- team result ----
  const mate = rows.find((r) => r.constructor_id === w.constructor_id && r.driver_id !== w.driver_id);
  if (mate) {
    P.entity('p1_mate', 'driver', mate.driver_id, D(mate.driver_id)?.name);
    P.fact('p1_mate_result', mate.status === 'classified' ? mate.position : mate.status, mate.status === 'classified' ? posText(mate.position) : 'a retirement', 'Winner teammate result', 'projection: race classification');
  }
  // season teammate battles (as of this race) for the winner's team and, if different, the runner-up's
  addBattle(P, X, ev.season, ev.start_utc, w.constructor_id, 'tb1');
  if (p2 && p2.constructor_id !== w.constructor_id) addBattle(P, X, ev.season, ev.start_utc, p2.constructor_id, 'tb2');
  // points by team this weekend
  const teamPts = {};
  for (const r of rows) teamPts[r.constructor_id] = (teamPts[r.constructor_id] || 0) + (r.points || 0);
  Object.entries(teamPts).sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([t, n], i) => { if (!C(t)) return; P.entity(`haul${i + 1}`, 'team', t, C(t).name); P.fact(`haul${i + 1}_pts`, n, pts(n), `${C(t).name} points this weekend`, 'derived: race classification'); });
  // team by team: both cars of the five best-scoring teams this weekend (grid, result, points)
  Object.entries(teamPts).sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([t], i) => {
    if (!C(t)) return;
    const cars = rows.filter((r) => r.constructor_id === t).slice(0, 2);
    if (cars.length !== 2) return;
    const k = `tw${i + 1}`;
    P.entity(k, 'team', t, C(t).name);
    cars.forEach((r, j) => {
      const c = `${k}${'ab'[j]}`;
      P.entity(c, 'driver', r.driver_id, D(r.driver_id)?.name);
      if (r.grid) P.fact(`${c}_grid`, r.grid, posText(r.grid), `${D(r.driver_id)?.name} grid`, 'projection: race classification');
      P.fact(`${c}_fin`, r.status === 'classified' ? r.position : r.status, r.status === 'classified' ? posText(r.position) : r.laps != null ? `out on lap ${r.laps}` : 'a retirement', `${D(r.driver_id)?.name} result`, 'projection: race classification');
    });
    P.fact(`${k}_pts`, teamPts[t], pts(teamPts[t]), `${C(t).name} points this weekend`, 'derived: race classification');
  });
  // biggest drop among classified cars
  const drops = classified.filter((r) => r.grid && r.position > r.grid).map((r) => ({ r, d: r.position - r.grid })).sort((a, b) => b.d - a.d);
  if (drops[0] && drops[0].d >= 4) { P.entity('dropper', 'driver', drops[0].r.driver_id, D(drops[0].r.driver_id)?.name); P.fact('dropper_grid', drops[0].r.grid, posText(drops[0].r.grid), 'Largest drop: starting position', 'projection: race classification'); P.fact('dropper_finish', drops[0].r.position, posText(drops[0].r.position), 'Largest drop: finishing position', 'projection: race classification'); }
  const gained = classified.filter((r) => r.grid && r.position < r.grid).length;
  P.fact('gainers', gained, countWord(gained), 'Classified cars that finished ahead of their grid slot', 'derived: race classification');
  const oneTwo = p2 && p2.constructor_id === w.constructor_id;
  if (oneTwo) P.signal('team_one_two', { team: w.constructor_id });

  // ---- championship ----
  const ch = X.champAfter(ev.season, eventId, 'drivers');
  const st = ch && X.standingsBy[ev.season]?.progression_note == null ? addStakes(P, X, ev, { after: true }) : null;
  if (st) {
    const prevLead = ch.before[0];
    const lead = ch.after[0];
    // how the gap at the top moved in THIS round, and who changed places in the top ten
    const b1 = ch.before[0], b2 = ch.before[1];
    if (b1 && b2 && ch.after[1]) {
      P.fact('lead_before', b1.points - b2.points, pts(b1.points - b2.points), 'Championship lead before this round', 'projection: standings progression');
      const dLead = (ch.after[0].points - ch.after[1].points) - (b1.points - b2.points);
      P.derive('lead_move', Math.abs(dLead), pts(Math.abs(dLead)), `Change in the championship lead this round (${dLead < 0 ? 'closed' : dLead > 0 ? 'grew' : 'unchanged'})`, { from: ['lead_before', 'c2_gap'], rule: 'after minus before' });
      P.signal(dLead < 0 ? 'lead_closed' : dLead > 0 ? 'lead_grew' : 'lead_unchanged');
      const lr = rows.find((r) => r.driver_id === ch.after[0].id);
      if (lr && lr.driver_id !== w.driver_id) { P.fact('leader_result', lr.status === 'classified' ? lr.position : lr.status, lr.status === 'classified' ? posText(lr.position) : 'a retirement', 'Championship leader race result', 'projection: race classification'); P.fact('leader_scored', lr.points || 0, pts(lr.points || 0), 'Championship leader points this weekend', 'projection: race classification'); }
    }
    const movers = ch.after.slice(0, 10).map((a) => ({ a, b: ch.before.find((x) => x.id === a.id) })).filter((x) => x.b && x.b.pos !== x.a.pos).sort((x, y) => (x.b.pos - x.a.pos) - (y.b.pos - y.a.pos)).reverse();
    if (movers[0] && movers[0].b.pos > movers[0].a.pos) { P.entity('riser', 'driver', movers[0].a.id, D(movers[0].a.id)?.name); P.fact('riser_from', movers[0].b.pos, ordinal(movers[0].b.pos), 'Championship position before this round', 'projection: standings progression'); P.fact('riser_to', movers[0].a.pos, ordinal(movers[0].a.pos), 'Championship position after this round', 'projection: standings progression'); }
    if (prevLead && prevLead.id !== lead.id) { P.entity('prev_leader', 'driver', prevLead.id, D(prevLead.id)?.name); P.signal('lead_change', { from: prevLead.id, to: lead.id }); }
    const wb = ch.before.find((x) => x.id === w.driver_id), wa = ch.after.find((x) => x.id === w.driver_id);
    if (wa) {
      P.fact('p1_champ_pos', wa.pos, ordinal(wa.pos), 'Winner championship position after this round', 'projection: standings progression');
      P.fact('p1_champ_points', wa.points, pts(wa.points), 'Winner championship points after this round', 'projection: standings progression');
      if (wb) {
        P.fact('p1_champ_pos_before', wb.pos, ordinal(wb.pos), 'Winner championship position before this round', 'projection: standings progression');
        // championship math: points after minus before must equal the points scored this weekend
        P.context.champ_check = { driver: w.driver_id, before: wb.points, after: wa.points, scored: w.points };
      }
    }
    const top = ch.after.slice(0, 5).map((x) => x.id);
    P.chart('championship', { title: `Drivers' championship after round ${ev.round}`, kind: 'line', x: ch.rounds.map((r) => r.round), series: top.map((id) => ({ id, name: D(id)?.name, color: C(D(id)?.team_id)?.color || null, values: ch.rounds.map((r) => r.drivers[id]?.p ?? null) })) });
  } else P.limit('Championship progression is not shown for this season because race-by-race sums do not match the official totals.');

  // ---- season and career record (our archive) ----
  const seasonWins = X.completedRaces(ev.season).filter((e) => e.start_utc <= ev.start_utc && X.rows(e.id, 'race').some((r) => r.position === 1 && r.status === 'classified' && r.driver_id === w.driver_id)).length;
  P.fact('p1_season_wins', seasonWins, seasonWins === 1 ? 'first win of the season' : `${ordinal(seasonWins)} win of the season`, 'Winner race wins this season including this one', 'derived: our race archive');
  const career = X.careerBefore(w.driver_id, ev.start_utc);
  const cw = career.wins + 1;
  P.fact('p1_career_wins', cw, cw === 1 ? 'first Grand Prix win' : `${ordinal(cw)} Grand Prix win`, 'Winner career race wins including this one (our archive)', 'derived: our race archive 1950–present');
  if (cw === 1) P.signal('first_career_win');
  else if (seasonWins === 1) P.signal('first_win_of_season');

  // ---- circuit history ----
  const prior = X.eventsAtCircuit(ev.circuit_id).filter((e) => e.start_utc < ev.start_utc);
  const priorWins = prior.filter((e) => X.rows(e.id, 'race').some((r) => r.position === 1 && r.status === 'classified' && r.driver_id === w.driver_id)).length;
  if (prior.length) P.fact('circuit_prior_wins', priorWins, priorWins === 0 ? 'no previous wins' : priorWins === 1 ? 'one previous win' : `${countWord(priorWins)} previous wins`, `Winner wins at this circuit before this race`, 'derived: our race archive');
  const arch = addArchive(P, X, ev.circuit_id, ev.start_utc);
  if (arch) {
    if (w.grid === 1) P.signal(P.get('arch_pole_wins').value * 2 >= arch.classified.length ? 'pole_win_fits_archive' : 'pole_win_rare_here');
    if (w.grid && w.grid > 2) P.signal('won_off_front_row_here');
  }
  // form going into the race, Driver DNA for the podium
  addForm(P, X, ev.season, ev.start_utc, ['p1', 'p2']);
  addDna(P, X, 'p1');
  addDna(P, X, 'p2');
  addPages(P, ev.season, ev.id);
  const conDna = X.dnaCon[w.constructor_id]?.[ev.season];
  if (conDna?.dimensions?.qualifying_speed?.percentile != null) P.fact('p1_team_quali_dna', conDna.dimensions.qualifying_speed.percentile, `${ordinal(conDna.dimensions.qualifying_speed.percentile)} percentile`, `${C(w.constructor_id)?.name} Constructor DNA, Qualifying Speed (${ev.season})`, 'projection: dna-constructor');

  // ---- signals from margins ----
  if (w.grid === 1) P.signal('pole_to_win');
  else if (w.grid && w.grid >= 4) P.signal('won_from_grid', { grid: w.grid });
  if (margin != null && margin < RACE_RULES.close_finish_ms) P.signal('close_finish', { margin });
  if (margin != null && margin >= RACE_RULES.dominant_finish_ms) P.signal('dominant_finish', { margin });
  if (dnf.length >= RACE_RULES.high_attrition_min) P.signal('high_attrition', { n: dnf.length });

  // ---- next race ----
  // the next round in CALENDAR order after this race (never filtered by today's status, or a late build skips rounds);
  // its RACE start, not the weekend's first session
  const nx = nextEventAfter(X, race.start_utc);
  const nxRace = nx && X.session(nx.id, 'race');
  if (nx && nxRace?.start_utc) { P.entity('next', 'race', nx.id, `${nx.season} ${nx.name}`); P.fact('next_race_start', nxRace.start_utc, venueDay(nxRace.start_utc, nx.circuit_id), 'Next race start (venue-local calendar day)', 'projection: sessions'); }
  P.context.temporal = temporalFrame(X, eventId, 'race_final', publishedAt);
  if (nxRace?.start_utc) P.context.temporal.next_race_state = Date.parse(nxRace.start_utc) > Date.parse(publishedAt) ? 'upcoming' : 'started';

  // ---- result table + grid/finish chart ----
  P.chart('classification', { title: 'Race classification', kind: 'table', rows: rows.map((r) => ({ pos: r.status === 'classified' ? r.position : null, driver_id: r.driver_id, name: D(r.driver_id)?.name, team_id: r.constructor_id, team: C(r.constructor_id)?.name, grid: r.grid, status: r.status, time: r.position === 1 ? r.time : r.gap || (r.behind_laps ? `+${r.behind_laps} lap${r.behind_laps > 1 ? 's' : ''}` : null), points: r.points, laps: r.laps })) });
  P.chart('grid_finish', { title: 'Grid to finish, points finishers', kind: 'slope', rows: classified.filter((r) => r.grid && r.position <= 10).map((r) => ({ driver_id: r.driver_id, code: D(r.driver_id)?.code, name: D(r.driver_id)?.name, color: C(r.constructor_id)?.color || null, grid: r.grid, finish: r.position })) });
  if (replay) { P.entity('pbecast', 'pbecast', replay, `PBEcast replay`); P.context.replay = replay; }
  else P.limit('Lap-by-lap order is not available for this race, so how the race turned is described from the classification: grid, finish, laps led, pit stops and fastest lap.');
  P.limit('Pit-stop counts are as published in the classification; stop timing and tyre choices are not sourced.');
  return { ok: true, packet: P.freeze() };
}
