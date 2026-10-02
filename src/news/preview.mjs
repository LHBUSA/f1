// RACE PREVIEW packet: what is known before the weekend. The schedule, the circuit's profile and history in our
// archive, the championship going in, recent form and descriptive Circuit Fit. Nothing from the weekend's own
// sessions is used, and nothing is predicted. A preview is stale once the race starts and is never first-published then.
import { Packet, posText, pts, fmtDay, countWord, ordinal } from './packet.mjs';

export function previewPacket(X, eventId, { asOf = new Date().toISOString() } = {}) {
  const ev = X.event[eventId];
  if (!ev || ev.status === 'canceled') return { ok: false, reason: 'unknown_or_canceled' };
  const race = X.session(eventId, 'race');
  if (!race?.start_utc) return { ok: false, reason: 'no_race_session' };
  const P = new Packet('preview', `preview:${eventId}`, { event_id: eventId, as_of: asOf });
  P.context.valid_until = race.start_utc;
  const D = (id) => X.driver[id], C = (id) => X.con[id];
  const title = `${ev.season} ${ev.name}`;
  P.fact('event', title, title, 'Event', 'projection: events');
  P.entity('race', 'race', ev.id, title);
  P.fact('round', ev.round, `round ${ev.round}`, 'Championship round', 'projection: events');
  P.fact('race_date', race.start_utc, fmtDay(race.start_utc), 'Race start', 'projection: sessions');
  const q = X.session(eventId, 'qualifying');
  if (q?.start_utc) P.fact('quali_date', q.start_utc, fmtDay(q.start_utc), 'Qualifying', 'projection: sessions');
  if (ev.sprint) P.signal('sprint_weekend');
  if (race.laps_scheduled) P.fact('laps', race.laps_scheduled, `${race.laps_scheduled} laps`, 'Scheduled race distance', 'projection: sessions');
  const circ = X.circuit[ev.circuit_id];
  if (!circ) return { ok: false, reason: 'no_circuit' };
  P.entity('circuit', 'circuit', circ.id, circ.name);
  if (circ.latest_layout?.length_km) P.fact('lap_km', circ.latest_layout.length_km, `${circ.latest_layout.length_km} km`, 'Lap length (latest layout)', 'projection: circuits');
  if (circ.latest_layout?.turns) P.fact('turns', circ.latest_layout.turns, `${circ.latest_layout.turns} turns`, 'Turns (latest layout)', 'projection: circuits');

  // circuit history in our archive
  const prior = X.eventsAtCircuit(circ.id).filter((e) => e.start_utc < ev.start_utc && X.rows(e.id, 'race').some((r) => r.position === 1));
  P.fact('races_held', prior.length, prior.length === 0 ? 'no previous Grands Prix' : prior.length === 1 ? 'one previous Grand Prix' : `${prior.length} previous Grands Prix`, 'World Championship races at this circuit before this one (our archive)', 'derived: our race archive');
  if (prior.length) {
    const last = prior.at(-1);
    P.fact('last_held', last.season, String(last.season), 'Most recent previous race at this circuit', 'derived: our race archive');
    if (ev.season - last.season >= 3) P.signal('return_after_gap', { years: ev.season - last.season });
    const lw = X.rows(last.id, 'race').find((r) => r.position === 1 && r.status === 'classified');
    if (lw) { P.entity('last_winner', 'driver', lw.driver_id, D(lw.driver_id)?.name); if (C(lw.constructor_id)) P.entity('last_winner_team', 'team', lw.constructor_id, C(lw.constructor_id).name); P.entity('last_race', 'race', last.id, `${last.season} ${last.name}`); }
    // current-grid drivers who have won here
    const grid = new Set(X.currentGrid);
    const winners = {};
    for (const e of prior) { const w = X.rows(e.id, 'race').find((r) => r.position === 1 && r.status === 'classified'); if (w && grid.has(w.driver_id)) winners[w.driver_id] = (winners[w.driver_id] || 0) + 1; }
    const wl = Object.entries(winners).sort((a, b) => b[1] - a[1]);
    P.fact('grid_winners_count', wl.length, countWord(wl.length), 'Current-grid drivers with a win at this circuit', 'derived: our race archive');
    wl.slice(0, 3).forEach(([id, n], i) => { P.entity(`gw${i + 1}`, 'driver', id, D(id)?.name); P.fact(`gw${i + 1}_wins`, n, n === 1 ? 'one win' : `${countWord(n)} wins`, `${D(id)?.name} wins at this circuit`, 'derived: our race archive'); });
  }
  const cd = X.dnaCircuit[circ.id];
  if (cd && cd.recent_races != null && cd.recent_races < 5) {
    // a rate over fewer than five recent races is not a profile; say so instead of printing it
    P.fact('recent_races', cd.recent_races, cd.recent_races === 1 ? 'one recent race' : `${countWord(cd.recent_races)} recent races`, 'Recent races in the Circuit DNA window', 'projection: dna-circuit');
    P.signal('thin_circuit_sample');
  } else if (cd) {
    if (cd.pole_win_rate != null && cd.sample?.pole_races >= 2) P.fact('pole_win', Math.round(cd.pole_win_rate * 100), `${Math.round(cd.pole_win_rate * 100)}%`, `Pole-to-win rate (last ${cd.sample.pole_races} races here)`, 'projection: dna-circuit');
    if (cd.attrition_rate != null && cd.sample?.attrition_races >= 2) P.fact('attrition', Math.round(cd.attrition_rate * 100), `${Math.round(cd.attrition_rate * 100)}%`, `Share of starters not classified (last ${cd.sample.attrition_races} races here)`, 'projection: dna-circuit');
    if (cd.stops_per_car != null && cd.sample?.stop_races >= 2) P.fact('stops', cd.stops_per_car, cd.stops_per_car.toFixed(1), `Pit stops per car (last ${cd.sample.stop_races} races here)`, 'projection: dna-circuit');
    if (cd.mean_abs_position_change != null) P.fact('pos_change', cd.mean_abs_position_change, cd.mean_abs_position_change.toFixed(1), 'Mean grid-to-finish position change per classified car (Circuit DNA)', 'projection: dna-circuit');
    if (cd.recent_races != null && cd.recent_races < 5) P.limit(`The circuit profile rests on ${cd.recent_races} recent race${cd.recent_races === 1 ? '' : 's'} here, so it is a thin sample.`);
  }

  // championship going in (last completed round before this event)
  const prog = X.standingsBy[ev.season]?.progression || [];
  const before = prog.filter((r) => X.event[r.event_id]?.start_utc < ev.start_utc).at(-1);
  if (before) {
    const t = Object.entries(before.drivers).map(([id, v]) => ({ id, ...v })).sort((a, b) => a.pos - b.pos);
    P.entity('leader', 'driver', t[0].id, D(t[0].id)?.name);
    P.fact('leader_points', t[0].p, pts(t[0].p), 'Championship leader points going in', 'projection: standings progression');
    if (t[1]) { P.entity('second', 'driver', t[1].id, D(t[1].id)?.name); P.derive('leader_margin', t[0].p - t[1].p, pts(t[0].p - t[1].p), 'Championship lead going in', { from: ['standings progression'], rule: 'leader minus second' }); }
    const done = X.completedRaces(ev.season).filter((e) => e.start_utc < ev.start_utc).length;
    const left = X.raceEvents(ev.season).filter((e) => e.start_utc >= ev.start_utc).length;
    P.fact('rounds_done', done, `${done} rounds`, 'Rounds completed this season', 'projection: events');
    P.fact('rounds_left', left, left === 1 ? 'one round' : `${left} rounds`, 'Rounds remaining including this one', 'projection: events');
    // recent form: last three race finishes for the top three
    const last3 = X.completedRaces(ev.season).filter((e) => e.start_utc < ev.start_utc).slice(-3);
    P.fact('form_window', last3.length, last3.length === 1 ? 'the last race' : `the last ${countWord(last3.length)} races`, 'Recent-form window', 'projection: events');
    t.slice(0, 3).forEach((x, i) => {
      if (i > 0) P.entity(`c${i + 1}`, 'driver', x.id, D(x.id)?.name);
      const fin = last3.map((e) => X.rows(e.id, 'race').find((r) => r.driver_id === x.id)).map((r) => (r ? (r.status === 'classified' ? `P${r.position}` : 'DNF') : '—'));
      P.fact(`form${i + 1}`, fin.join(','), fin.join(', '), `${D(x.id)?.name} last three race finishes`, 'projection: race classification');
    });
    if (t[2]) P.fact('c3_points', t[2].p, pts(t[2].p), 'Third in the championship, points', 'projection: standings progression');
  }

  // descriptive Circuit Fit (not a prediction)
  const fit = X.fit[eventId];
  if (fit?.drivers?.length) {
    const top = fit.drivers.slice(0, 3);
    top.forEach((r, i) => { P.entity(`fit${i + 1}`, 'driver', r.driver_id, D(r.driver_id)?.name); P.fact(`fit${i + 1}_score`, r.fit_score, String(r.fit_score), `${D(r.driver_id)?.name} Circuit Fit score`, 'projection: fit'); });
    const comp = top[0].components.slice().sort((a, b) => b.percentile * b.weight - a.percentile * a.weight)[0];
    if (comp) P.fact('fit1_driver_component', comp.label, comp.label, 'Strongest weighted fit component for the top fit', 'projection: fit');
    if (fit.drivers[0].confidence === 'low') P.limit('Circuit Fit confidence is low here because the circuit profile rests on few recent races.');
    P.chart('fit', { title: 'Circuit Fit, top eight drivers', kind: 'bars', rows: fit.drivers.slice(0, 8).map((r) => ({ driver_id: r.driver_id, code: D(r.driver_id)?.code, color: C(r.constructor_id)?.color || null, value: r.fit_score })) });
    if (fit.constructors?.length) { P.entity('fitc1', 'team', fit.constructors[0].constructor_id, C(fit.constructors[0].constructor_id)?.name); P.fact('fitc1_score', fit.constructors[0].fit_score, String(fit.constructors[0].fit_score), 'Top constructor Circuit Fit score', 'projection: fit'); }
  }
  P.limit('Circuit Fit is a descriptive match between current DNA and this circuit\'s profile. It is not a prediction, a probability or a betting signal.');
  return { ok: true, packet: P.freeze() };
}

export function writePreview(P) {
  const has = (...ids) => ids.every((id) => P.facts.some((f) => f.id === id) || P.entities.some((x) => x.key === id));
  const sig = (n) => P.context.signals.find((s) => s.name === n);
  const val = (id) => P.facts.find((f) => f.id === id)?.value;
  const S = [];
  const back = sig('return_after_gap');
  const headline = back && has('last_held') ? '{f:event} preview: the championship returns to {e:circuit}' : '{f:event} preview: the championship arrives at {e:circuit}';
  const dek = `${has('leader', 'leader_margin') ? '{e:leader} leads by {f:leader_margin} with {f:rounds_left} to go. ' : ''}${back ? '{e:circuit} last hosted a Grand Prix in {f:last_held}.' : 'What the circuit and the data say before the weekend.'}`;
  S.push({ heading: '', paragraphs: [
    `The {f:event} is {f:round} of the season, with the race on {f:race_date}${has('quali_date') ? ' and qualifying on {f:quali_date}' : ''}.${back ? ' {e:circuit} returns to the calendar for the first time since {f:last_held}.' : ''}`,
    has('leader', 'leader_points') ? `{e:leader} arrives leading the championship on {f:leader_points}${has('leader_margin', 'second') ? ', {f:leader_margin} ahead of {e:second}' : ''}, after {f:rounds_done} and with {f:rounds_left} remaining.` : null,
  ].filter(Boolean) });
  const circ = [];
  if (has('lap_km', 'turns')) circ.push(`The current layout of {e:circuit} is {f:lap_km} with {f:turns}${has('laps') ? ', and the race is scheduled over {f:laps}' : ''}.`);
  if (has('races_held')) circ.push(val('races_held') ? 'Our archive holds {f:races_held} here.' : 'This is the first World Championship race at the circuit in our archive.');
  if (has('last_winner', 'last_race')) circ.push('The most recent, the {e:last_race}, was won by {e:last_winner}.');
  if (has('grid_winners_count')) circ.push(!val('grid_winners_count') ? 'No driver on the current grid has won here.' : val('grid_winners_count') === 1 ? `On the current grid, {f:grid_winners_count} driver has won here${has('gw1', 'gw1_wins') ? ': {e:gw1}, with {f:gw1_wins}' : ''}.` : `On the current grid, {f:grid_winners_count} drivers have won here${has('gw1', 'gw1_wins') ? ', led by {e:gw1} with {f:gw1_wins}' : ''}.`);
  if (circ.length) S.push({ heading: 'The circuit', paragraphs: [circ.join(' ')] });
  const prof = [];
  if (has('pole_win')) prof.push('Pole has converted {f:pole_win} of the time in the recent sample.');
  if (has('pos_change')) prof.push('Classified cars have moved {f:pos_change} places on average between grid and flag.');
  if (has('attrition')) prof.push('{f:attrition} of starters have not been classified.');
  if (has('stops')) prof.push('Cars have averaged {f:stops} pit stops.');
  if (sig('thin_circuit_sample')) prof.push('Circuit DNA rests on {f:recent_races} here in its window, too few to describe the circuit with rates, so none are quoted.');
  if (prof.length) S.push({ heading: 'Circuit DNA', paragraphs: [prof.join(' ') + (sig('thin_circuit_sample') ? '' : ' These describe past races here; they do not forecast this one.')] });
  const form = [];
  if (has('form1', 'leader')) form.push('{s:leader} finished {f:form1} in {f:form_window}.');
  if (has('form2', 'c2')) form.push('{e:c2}: {f:form2}.');
  if (has('form3', 'c3')) form.push('{e:c3}, on {f:c3_points}: {f:form3}.');
  if (form.length) S.push({ heading: 'Form going in', paragraphs: [form.join(' ')] });
  if (has('fit1', 'fit1_score')) S.push({ heading: 'Circuit Fit', paragraphs: [`Matching current Driver and Constructor DNA to this circuit's profile, {e:fit1} has the highest Circuit Fit score at {f:fit1_score}${has('fit1_driver_component') ? ', driven mostly by the {f:fit1_driver_component} component' : ''}${has('fit2', 'fit2_score') ? ', ahead of {e:fit2} at {f:fit2_score}' : ''}${has('fit3', 'fit3_score') ? ' and {e:fit3} at {f:fit3_score}' : ''}.${has('fitc1', 'fitc1_score') ? ' Among teams, {e:fitc1} fit best at {f:fitc1_score}.' : ''} Circuit Fit describes a profile match; it does not forecast the result.`], module: P.charts.includes('fit') ? 'fit' : null });
  S.push({ heading: 'Follow the weekend', paragraphs: ['Every session is on the {e:race} page, with live timing in PBEcast.'] });
  return {
    headline, dek, sections: S,
    seo_title: '{f:event} preview',
    seo_description: `{f:event} preview: {e:circuit} history, Circuit DNA, the championship going in and descriptive Circuit Fit before the weekend.`,
    social_headline: headline,
    link_intents: P.entities.map((x) => x.key),
  };
}
