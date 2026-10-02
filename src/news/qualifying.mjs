// QUALIFYING packet: the qualifying classification as of the end of the session (never the race that followed), the
// knockout cut lines, teammate gaps, and what pole has meant at this circuit in our archive.
import { Packet, posText, pts, fmtLap, secs, fmtDay, countWord, ordinal } from './packet.mjs';
import { addStakes, addArchive, addDna, addPages, addBattle } from './context.mjs';

export function qualifyingPacket(X, eventId, { asOf = new Date().toISOString() } = {}) {
  const ev = X.event[eventId];
  const qs = X.session(eventId, 'qualifying');
  const rows = X.rows(eventId, 'qualifying').filter((r) => r.position);
  const pole = rows.find((r) => r.position === 1);
  if (!ev || qs?.state !== 'completed' || !pole || !pole.best_lap_ms) return { ok: false, reason: 'qualifying_not_complete' };
  const P = new Packet('qualifying', `qualifying:${eventId}`, { event_id: eventId, as_of: asOf });
  const D = (id) => X.driver[id], C = (id) => X.con[id];
  const title = `${ev.season} ${ev.name}`;
  P.fact('event', title, title, 'Event', 'projection: events');
  P.entity('race', 'race', ev.id, title);
  P.fact('round', ev.round, `round ${ev.round}`, 'Championship round', 'projection: events');
  P.fact('quali_date', qs.start_utc, fmtDay(qs.start_utc), 'Qualifying date', 'projection: sessions');
  const circ = X.circuit[ev.circuit_id];
  if (circ) P.entity('circuit', 'circuit', circ.id, circ.name);

  const put = (k, r) => {
    P.entity(k, 'driver', r.driver_id, D(r.driver_id)?.name);
    if (C(r.constructor_id)) P.entity(`${k}_team`, 'team', r.constructor_id, C(r.constructor_id).name);
    P.fact(`${k}_pos`, r.position, posText(r.position), `${D(r.driver_id)?.name} qualifying position`, 'projection: qualifying classification');
    if (r.best_lap_ms) P.fact(`${k}_lap`, r.best_lap_ms, fmtLap(r.best_lap_ms), `${D(r.driver_id)?.name} best qualifying lap`, 'projection: qualifying classification');
  };
  put('q1', pole);
  const second = rows.find((r) => r.position === 2), third = rows.find((r) => r.position === 3);
  if (second) put('q2', second);
  if (third) put('q3', third);
  if (second?.best_lap_ms) P.derive('pole_gap', second.best_lap_ms - pole.best_lap_ms, secs(second.best_lap_ms - pole.best_lap_ms), 'Pole margin over second', { from: ['q1_lap', 'q2_lap'], rule: 'difference' });
  if (third?.best_lap_ms) P.derive('p3_gap', third.best_lap_ms - pole.best_lap_ms, secs(third.best_lap_ms - pole.best_lap_ms), 'Third place gap to pole', { from: ['q1_lap', 'q3_lap'], rule: 'difference' });
  if (second && second.constructor_id === pole.constructor_id) P.signal('front_row_lockout', { team: pole.constructor_id });
  if (second?.best_lap_ms && second.best_lap_ms - pole.best_lap_ms < 100) P.signal('tight_pole', { ms: second.best_lap_ms - pole.best_lap_ms });
  if (second?.best_lap_ms && second.best_lap_ms - pole.best_lap_ms >= 300) P.signal('clear_pole', { ms: second.best_lap_ms - pole.best_lap_ms });

  // pole sitter vs teammate (same session, same car)
  const mate = rows.find((r) => r.constructor_id === pole.constructor_id && r.driver_id !== pole.driver_id);
  if (mate) {
    P.entity('mate', 'driver', mate.driver_id, D(mate.driver_id)?.name);
    P.fact('mate_pos', mate.position, posText(mate.position), 'Pole sitter teammate qualifying position', 'projection: qualifying classification');
    const depth = ['q3_ms', 'q2_ms', 'q1_ms'].find((k) => pole[k] && mate[k]);
    if (depth) P.derive('mate_gap', mate[depth] - pole[depth], secs(mate[depth] - pole[depth]), `Teammate gap in ${depth.slice(0, 2).toUpperCase()} (deepest segment both set a time)`, { from: ['qualifying classification'], rule: `${depth} difference` });
  }

  // knockout: who did not reach Q3 / Q2, from the published segment times
  const outQ1 = rows.filter((r) => r.q1_ms && !r.q2_ms), outQ2 = rows.filter((r) => r.q2_ms && !r.q3_ms);
  const hasKnockout = rows.some((r) => r.q3_ms);
  if (hasKnockout) {
    P.fact('q3_count', rows.filter((r) => r.q3_ms).length, `${rows.filter((r) => r.q3_ms).length} drivers`, 'Drivers who set a Q3 time', 'projection: qualifying classification (segment times)');
    // a top-five championship driver eliminated before Q3 is the notable cut
    const ch = X.standingsBy[ev.season]?.progression || [];
    const prevRound = ch.filter((r) => X.event[r.event_id]?.start_utc < ev.start_utc).at(-1);
    const top5 = prevRound ? Object.entries(prevRound.drivers).sort((a, b) => a[1].pos - b[1].pos).slice(0, 5).map(([id]) => id) : [];
    const cut = [...outQ2, ...outQ1].filter((r) => top5.includes(r.driver_id)).sort((a, b) => a.position - b.position)[0];
    if (cut) {
      P.entity('cut', 'driver', cut.driver_id, D(cut.driver_id)?.name);
      P.fact('cut_pos', cut.position, posText(cut.position), `${D(cut.driver_id)?.name} qualifying position`, 'projection: qualifying classification');
      P.fact('cut_segment', outQ1.includes(cut) ? 'Q1' : 'Q2', outQ1.includes(cut) ? 'Q1' : 'Q2', 'Segment of elimination', 'projection: qualifying classification (segment times)');
      const cp = Object.entries(prevRound.drivers).find(([id]) => id === cut.driver_id)?.[1];
      if (cp) P.fact('cut_champ_pos', cp.pos, ordinal(cp.pos), 'Championship position before this event', 'projection: standings progression');
    }
  }

  // championship leader before the weekend
  const prog = X.standingsBy[ev.season]?.progression || [];
  const before = prog.filter((r) => X.event[r.event_id]?.start_utc < ev.start_utc).at(-1);
  if (before) {
    const [leadId] = Object.entries(before.drivers).sort((a, b) => a[1].pos - b[1].pos)[0];
    if (leadId !== pole.driver_id) {
      const lr = rows.find((r) => r.driver_id === leadId);
      P.entity('leader', 'driver', leadId, D(leadId)?.name);
      if (lr) P.fact('leader_pos', lr.position, posText(lr.position), 'Championship leader qualifying position', 'projection: qualifying classification');
    } else P.signal('leader_on_pole');
  }

  // pole count this season (as of this session) and career poles in our archive
  const seasonPoles = X.raceEvents(ev.season).filter((e) => e.start_utc <= ev.start_utc).filter((e) => X.rows(e.id, 'qualifying').some((r) => r.position === 1 && r.driver_id === pole.driver_id)).length;
  P.fact('season_poles', seasonPoles, seasonPoles === 1 ? 'first pole of the season' : `${ordinal(seasonPoles)} pole of the season`, 'Poles this season including this one', 'derived: our qualifying archive');

  // Driver DNA qualifying dimension, Circuit DNA pole conversion
  const qd = X.dnaDriver[pole.driver_id]?.current?.dimensions?.qualifying;
  if (qd?.percentile != null) P.fact('pole_dna_q', qd.percentile, `${ordinal(qd.percentile)} percentile`, `Driver DNA Qualifying Pace (${X.dnaDriver[pole.driver_id].current.window})`, 'projection: dna-driver');
  const cd = X.dnaCircuit[ev.circuit_id];
  if (cd?.pole_win_rate != null && cd.sample?.pole_races >= 5) P.fact('circuit_pole_win', Math.round(cd.pole_win_rate * 100), `${Math.round(cd.pole_win_rate * 100)}%`, `Pole-to-win rate at this circuit (last ${cd.sample.pole_races} races, Circuit DNA)`, 'projection: dna-circuit');
  if (cd?.grid_finish_rho != null && cd.sample?.rho_races >= 5) P.fact('circuit_rho', Math.round(cd.grid_finish_rho * 100) / 100, cd.grid_finish_rho.toFixed(2), 'Grid-to-finish rank correlation at this circuit (Circuit DNA)', 'projection: dna-circuit');

  // ---- v2 depth: stakes going in, the circuit's pole record, team by team, cut lines, spread ----
  addStakes(P, X, ev, { after: false });
  const c2 = P.entities.find((x) => x.key === 'c2')?.ref, c2r = c2 && rows.find((r) => r.driver_id === c2);
  if (c2r && c2 !== pole.driver_id) P.fact('c2_pos', c2r.position, posText(c2r.position), 'Second in the championship: qualifying position', 'projection: qualifying classification');
  addArchive(P, X, ev.circuit_id, ev.start_utc);
  const p10 = rows.find((r) => r.position === 10);
  if (p10?.best_lap_ms) P.fact('p10', 10, 'P10', 'Tenth place', 'projection: qualifying classification');
  if (p10?.best_lap_ms) P.derive('spread10', p10.best_lap_ms - pole.best_lap_ms, secs(p10.best_lap_ms - pole.best_lap_ms), 'Gap from pole to tenth', { from: ['q1_lap', 'qualifying classification'], rule: 'difference' });
  const margins = X.raceEvents(ev.season).filter((e) => e.start_utc <= ev.start_utc).map((e) => { const q = X.rows(e.id, 'qualifying'); const a = q.find((r) => r.position === 1), b = q.find((r) => r.position === 2); return a?.best_lap_ms && b?.best_lap_ms ? b.best_lap_ms - a.best_lap_ms : null; }).filter((x) => x != null);
  if (margins.length >= 5 && second?.best_lap_ms) {
    const avg = margins.reduce((a, b) => a + b, 0) / margins.length;
    P.fact('season_pole_margin', Math.round(avg), secs(Math.round(avg)), 'Average pole margin this season (to date)', 'derived: qualifying classification');
    const mine = second.best_lap_ms - pole.best_lap_ms;
    if (mine === Math.max(...margins)) P.signal('largest_pole_margin_season');
    if (mine === Math.min(...margins)) P.signal('smallest_pole_margin_season');
  }
  // team by team: the five teams with the best lead car
  const teamBest = {};
  for (const r of rows) if (!teamBest[r.constructor_id] || r.position < teamBest[r.constructor_id]) teamBest[r.constructor_id] = r.position;
  Object.entries(teamBest).sort((a, b) => a[1] - b[1]).slice(0, 5).forEach(([t], i) => {
    const cars = rows.filter((r) => r.constructor_id === t).sort((a, b) => a.position - b.position);
    if (cars.length !== 2 || !C(t)) return;
    const k = `qt${i + 1}`;
    P.entity(k, 'team', t, C(t).name);
    cars.forEach((r, j) => { P.entity(`${k}${'ab'[j]}`, 'driver', r.driver_id, D(r.driver_id)?.name); P.fact(`${k}${'ab'[j]}_pos`, r.position, posText(r.position), `${D(r.driver_id)?.name} qualifying position`, 'projection: qualifying classification'); });
    const seg = ['q3_ms', 'q2_ms', 'q1_ms'].find((s) => cars[0][s] && cars[1][s]);
    if (seg) P.derive(`${k}_gap`, cars[1][seg] - cars[0][seg], secs(cars[1][seg] - cars[0][seg]), `${C(t).name} intra-team gap in ${seg.slice(0, 2).toUpperCase()}`, { from: ['qualifying classification'], rule: `${seg} difference` });
  });
  if (hasKnockout) {
    const named = (list, k) => [...list].sort((a, b) => a.position - b.position).slice(0, 8).forEach((r, i) => P.entity(`${k}${i + 1}`, 'driver', r.driver_id, D(r.driver_id)?.name));
    named(outQ1, 'outq1_'); named(outQ2, 'outq2_');
    // (named() lists up to five; widen so the list always matches the count)
    P.fact('outq1_n', outQ1.length, countWord(outQ1.length), 'Drivers eliminated in Q1', 'projection: qualifying classification');
    P.fact('outq2_n', outQ2.length, countWord(outQ2.length), 'Drivers eliminated in Q2', 'projection: qualifying classification');
    const teamOut = Object.keys(teamBest).find((t) => { const c = rows.filter((r) => r.constructor_id === t); return c.length === 2 && c.every((r) => !r.q2_ms); });
    if (teamOut && C(teamOut)) { P.entity('team_out_q1', 'team', teamOut, C(teamOut).name); P.signal('team_both_out_q1'); }
  }
  addBattle(P, X, ev.season, ev.start_utc, pole.constructor_id, 'tb1');
  const leaderTeam = X.driver[P.entities.find((x) => x.key === 'leader')?.ref]?.team_id;
  if (leaderTeam && leaderTeam !== pole.constructor_id) addBattle(P, X, ev.season, ev.start_utc, leaderTeam, 'tb2');
  // last edition here: who had pole and what became of it
  const prevEv = X.eventsAtCircuit(ev.circuit_id).filter((e) => e.start_utc < ev.start_utc && X.rows(e.id, 'race').some((r) => r.position === 1)).at(-1);
  const prevPole = prevEv && (X.rows(prevEv.id, 'qualifying').find((r) => r.position === 1) || X.rows(prevEv.id, 'race').find((r) => r.grid === 1));
  if (prevPole) { const pr = X.rows(prevEv.id, 'race').find((r) => r.driver_id === prevPole.driver_id); P.entity('prev_pole', 'driver', prevPole.driver_id, D(prevPole.driver_id)?.name); if (pr) P.fact('prev_pole_result', pr.status === 'classified' ? pr.position : pr.status, pr.status === 'classified' ? posText(pr.position) : 'a retirement', `${prevEv.season} pole-sitter race result here`, 'derived: our race archive'); }
  addDna(P, X, 'q1');
  addDna(P, X, 'q2');
  addPages(P, ev.season, ev.id);

  const race = X.session(eventId, 'race');
  if (race?.start_utc) P.fact('race_date', race.start_utc, fmtDay(race.start_utc), 'Race start', 'projection: sessions');
  P.chart('quali_table', { title: 'Qualifying classification', kind: 'table', rows: rows.map((r) => ({ pos: r.position, driver_id: r.driver_id, name: D(r.driver_id)?.name, team_id: r.constructor_id, team: C(r.constructor_id)?.name, q1: fmtLap(r.q1_ms), q2: fmtLap(r.q2_ms), q3: fmtLap(r.q3_ms), best: fmtLap(r.best_lap_ms) })) });
  P.chart('quali_gaps', { title: 'Gap to pole, top ten', kind: 'bars', rows: rows.filter((r) => r.best_lap_ms && r.position <= 10).map((r) => ({ driver_id: r.driver_id, code: D(r.driver_id)?.code, color: C(r.constructor_id)?.color || null, value_ms: r.best_lap_ms - pole.best_lap_ms })) });
  P.limit('Sector times, tyre choices and track conditions are not sourced. The starting grid can differ from qualifying when penalties apply; this story describes qualifying only.');
  return { ok: true, packet: P.freeze() };
}

const pick = (P, key, variants) => { let h = 0; for (const c of P.hash + key) h = (h * 31 + c.charCodeAt(0)) >>> 0; return variants[h % variants.length]; };

export function writeQualifying(P) {
  const has = (...ids) => ids.every((id) => P.facts.some((f) => f.id === id) || P.entities.some((x) => x.key === id));
  const sig = (n) => P.context.signals.find((s) => s.name === n);
  const val = (id) => P.facts.find((f) => f.id === id)?.value;
  const S = [];
  const lock = sig('front_row_lockout');
  const headline = lock ? '{e:q1} leads a {e:q1_team} front-row lockout at the {f:event}' : '{e:q1} takes pole for the {f:event}';
  const dek = `{s:q1} set {f:q1_lap}${has('pole_gap', 'q2') ? ', {f:pole_gap} clear of {e:q2}' : ''}.${has('leader', 'leader_pos') ? ' Championship leader {e:leader} qualified {f:leader_pos}.' : ''}`;
  S.push({ heading: '', paragraphs: [
    `{e:q1} took pole position for the {f:event} with {f:q1_lap} for {e:q1_team}. It is {s:q1}'s {f:season_poles}.`,
    has('q2') ? `{e:q2} qualified {f:q2_pos}${has('pole_gap') ? ', {f:pole_gap} behind' : ''}${lock ? ' to complete the front row for the same team' : ''}${has('q3') ? ', with {e:q3} {f:q3_pos}' + (has('p3_gap') ? ' at {f:p3_gap}' : '') : ''}.` : null,
  ].filter(Boolean) });
  const shape = [];
  if (sig('tight_pole')) shape.push('The margin at the front was {f:pole_gap}.');
  else if (sig('clear_pole')) shape.push('A pole margin of {f:pole_gap} is a clear gap by qualifying standards in our archive.');
  if (has('mate', 'mate_pos')) shape.push(`Teammate {e:mate} qualified {f:mate_pos}${has('mate_gap') ? ', {f:mate_gap} slower in the deepest segment both completed' : ''}.`);
  if (has('cut', 'cut_segment', 'cut_pos')) shape.push(`{e:cut}, {f:cut_champ_pos} in the championship before the weekend, was eliminated in {f:cut_segment} at {e:circuit} and qualified {f:cut_pos}.`);
  if (has('leader', 'leader_pos') && !has('cut')) shape.push('Championship leader {e:leader} qualified {f:leader_pos} for the {f:event}.');
  else if (sig('leader_on_pole')) shape.push('{s:q1} arrived at {e:circuit} leading the championship and leaves qualifying on pole for {f:round}.');
  if (shape.length) S.push({ heading: 'How qualifying shaped up', paragraphs: [shape.join(' ')] });
  const data = [];
  if (has('pole_dna_q')) data.push(pick(P, 'qdna', ['Pole at {e:circuit} comes from a driver at the {f:pole_dna_q} for Qualifying Pace in the {f:dna_window} Driver DNA window, which measures each driver against a teammate.', 'In Driver DNA ({f:dna_window} window), {s:q1} sits at the {f:pole_dna_q} for Qualifying Pace; this {e:circuit} lap adds to that teammate-relative record.', "{s:q1}'s Qualifying Pace percentile in Driver DNA is {f:pole_dna_q} over the {f:dna_window} window; the {f:event} pole is one more sample in it."]));
  if (has('circuit_pole_win')) data.push(`At {e:circuit}, pole has converted {f:circuit_pole_win} of the time in the Circuit DNA sample${has('circuit_rho') ? ', and the grid-to-finish rank correlation is {f:circuit_rho}' : ''}. That is history, not a forecast for this race.`);
  if (data.length) S.push({ heading: 'What the data says', paragraphs: [data.join(' ')], module: P.charts.includes('quali_gaps') ? 'quali_gaps' : null });
  S.push({ heading: 'Qualifying classification', paragraphs: ['The full order with each segment time, as published.'], module: 'quali_table' });
  if (has('race_date')) S.push({ heading: "What's next", paragraphs: ['The race starts on {f:race_date}; follow it live on the {e:race} page and in PBEcast.'] });
  return {
    headline, dek, sections: S,
    seo_title: '{s:q1} on pole for the {f:event}',
    seo_description: `{e:q1} took pole for the {f:event} with {f:q1_lap}. Full qualifying order, gaps and what pole means at {e:circuit}.`,
    social_headline: headline,
    link_intents: P.entities.map((x) => x.key),
  };
}
