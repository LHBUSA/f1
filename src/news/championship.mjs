// CHAMPIONSHIP UPDATE packet: the title picture after one completed round, from the standings progression, the race
// classification and our own form/DNA/teammate data. It describes what the table shows after the round and what the
// round changed; it never predicts, never assigns causes and never calls a title decided unless the arithmetic does.
// One story per completed round, first-published only between that race and the start of the next weekend.
import { Packet, posText, pts, countWord, ordinal } from './packet.mjs';
import { addStakes, addBattle, addDna, addPages } from './context.mjs';
import { temporalFrame, nextEventAfter, venueDay } from './temporal.mjs';
import * as M from '../intel/metrics.mjs';

export const CHAMPIONSHIP_VERSION = 'f1-championship@1.0.0';

/** First session start of the next weekend after `eventId` (calendar order), or null at the end of the season. */
export function nextWeekendStart(X, eventId) {
  const race = X.session(eventId, 'race');
  const nx = race?.start_utc ? nextEventAfter(X, race.start_utc) : null;
  if (!nx) return null;
  const starts = (nx.sessions || []).map((s) => s.start_utc).filter(Boolean).sort();
  return starts[0] || nx.start_utc || null;
}

export function championshipPacket(X, eventId, { asOf = new Date().toISOString(), publishedAt = asOf } = {}) {
  const ev = X.event[eventId];
  if (!ev) return { ok: false, reason: 'unknown_event' };
  const race = X.session(eventId, 'race');
  const w = X.rows(eventId, 'race').find((r) => r.position === 1 && r.status === 'classified');
  if (race?.state !== 'completed' || !w) return { ok: false, reason: 'race_not_complete' };
  if (X.standingsBy[ev.season]?.progression_note) return { ok: false, reason: 'progression_unreliable' };
  const ch = X.champAfter(ev.season, eventId, 'drivers');
  const cc = X.champAfter(ev.season, eventId, 'constructors');
  if (!ch?.after?.[1]) return { ok: false, reason: 'no_standings_after_round' };
  const P = new Packet('championship', `championship:${eventId}`, { event_id: eventId, as_of: asOf });
  P.context.version = CHAMPIONSHIP_VERSION;
  const D = (id) => X.driver[id], C = (id) => X.con[id];
  const title = `${ev.season} ${ev.name}`;

  // ---- the round ----
  P.fact('event', title, title, 'Event', 'projection: events');
  P.entity('race', 'race', ev.id, title);
  P.fact('round', ev.round, `round ${ev.round}`, 'Championship round', 'projection: events');
  P.fact('race_date', race.start_utc, venueDay(race.start_utc, ev.circuit_id), 'Race date (venue-local calendar day)', 'projection: sessions');
  const circ = X.circuit[ev.circuit_id];
  if (circ) P.entity('circuit', 'circuit', circ.id, circ.name);
  P.entity('p1', 'driver', w.driver_id, D(w.driver_id)?.name);
  if (C(w.constructor_id)) P.entity('p1_team', 'team', w.constructor_id, C(w.constructor_id).name);

  // ---- the table after the round (shared stakes builder: leader, c2..c5, rounds/points left, constructors) ----
  const st = addStakes(P, X, ev, { after: true });
  if (!st) return { ok: false, reason: 'no_stakes' };

  // ---- what this round changed ----
  const before = ch.before, after = ch.after;
  const scored = (id) => { const a = after.find((x) => x.id === id), b = before.find((x) => x.id === id); return a ? a.points - (b?.points || 0) : null; };
  if (before[1]) {
    const lb = before[0].points - before[1].points, la = after[0].points - after[1].points;
    P.fact('swing_lead_before', lb, pts(lb), 'Championship lead before this round', 'projection: standings progression');
    P.derive('swing_lead_move', Math.abs(la - lb), pts(Math.abs(la - lb)), `Change in the championship lead this round (${la < lb ? 'closed' : la > lb ? 'grew' : 'unchanged'})`, { from: ['swing_lead_before', 'c2_gap'], rule: 'after minus before' });
    if (before[0].id !== after[0].id) { P.entity('prev_leader', 'driver', before[0].id, D(before[0].id)?.name); P.signal('lead_change'); }
    else P.signal(la < lb ? 'lead_closed' : la > lb ? 'lead_grew' : 'lead_unchanged');
  } else P.signal('opening_round');
  const lp = scored(after[0].id), cp = scored(after[1].id);
  if (lp != null) P.derive('swing_leader_pts', lp, pts(lp), `${D(after[0].id)?.name} points scored this round`, { from: ['standings progression'], rule: 'after minus before' });
  const res = (id) => { const r = X.rows(eventId, 'race').find((x) => x.driver_id === id); return r ? (r.status === 'classified' ? [r.position, posText(r.position)] : ['retired', r.status === 'retired' ? 'as a retirement' : 'as a non-finisher']) : null; };
  for (const [k, id] of [['leader', after[0].id], ['c2', after[1].id]]) { const r = res(id); if (r) P.fact(`${k}_result`, r[0], r[1], `${D(id)?.name} Grand Prix result at this round`, 'projection: race classification'); }
  if (cp != null) P.derive('swing_c2_pts', cp, pts(cp), `${D(after[1].id)?.name} points scored this round`, { from: ['standings progression'], rule: 'after minus before' });
  // the round's biggest scorer (incl. sprint points), when it is not one of the top two
  const haul = after.map((x) => ({ id: x.id, n: scored(x.id) })).filter((x) => x.n != null).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id))[0];
  if (haul && haul.n > 0 && ![after[0].id, after[1].id].includes(haul.id)) { P.entity('swing_top', 'driver', haul.id, D(haul.id)?.name); P.derive('swing_top_pts', haul.n, pts(haul.n), `${D(haul.id)?.name} points scored this round (most of any driver)`, { from: ['standings progression'], rule: 'after minus before' }); }
  // biggest climb and drop inside the top ten
  const moves = after.slice(0, 10).map((a) => ({ a, b: before.find((x) => x.id === a.id) })).filter((x) => x.b && x.b.pos !== x.a.pos);
  const up = moves.filter((x) => x.b.pos > x.a.pos).sort((x, y) => (y.b.pos - y.a.pos) - (x.b.pos - x.a.pos) || x.a.pos - y.a.pos)[0];
  const down = moves.filter((x) => x.b.pos < x.a.pos).sort((x, y) => (y.a.pos - y.b.pos) - (x.a.pos - x.b.pos) || x.a.pos - y.a.pos)[0];
  if (up) { P.entity('swing_riser', 'driver', up.a.id, D(up.a.id)?.name); P.fact('swing_riser_from', up.b.pos, ordinal(up.b.pos), 'Championship position before this round', 'projection: standings progression'); P.fact('swing_riser_to', up.a.pos, ordinal(up.a.pos), 'Championship position after this round', 'projection: standings progression'); }
  if (down) { P.entity('swing_faller', 'driver', down.a.id, D(down.a.id)?.name); P.fact('swing_faller_from', down.b.pos, ordinal(down.b.pos), 'Championship position before this round', 'projection: standings progression'); P.fact('swing_faller_to', down.a.pos, ordinal(down.a.pos), 'Championship position after this round', 'projection: standings progression'); }
  // constructors: third place and how the constructors' lead moved
  if (cc?.after?.[2]) { P.entity('con3', 'team', cc.after[2].id, C(cc.after[2].id)?.name); P.derive('con3_gap', cc.after[0].points - cc.after[2].points, pts(cc.after[0].points - cc.after[2].points), `${C(cc.after[2].id)?.name} deficit to the constructors' leader`, { from: ['standings progression'], rule: 'difference' }); }
  if (cc?.before?.[1] && cc.before[0].id === cc.after[0].id) {
    const cb = cc.before[0].points - cc.before[1].points, ca = cc.after[0].points - cc.after[1].points;
    P.derive('swing_con_move', Math.abs(ca - cb), pts(Math.abs(ca - cb)), `Change in the constructors' lead this round (${ca < cb ? 'closed' : ca > cb ? 'grew' : 'unchanged'})`, { from: ['standings progression'], rule: 'after minus before' });
    P.signal(ca < cb ? 'con_closed' : ca > cb ? 'con_grew' : 'con_unchanged');
  }

  // ---- form up to and including this round (last FORM_WINDOW races) ----
  const F = M.seasonFrame(X, ev.season);
  F.races = F.races.filter((e) => e.start_utc <= race.start_utc);
  if (F.races.length >= 3) {
    const fw = Math.min(M.FORM_WINDOW, F.races.length);
    P.fact('form_window', fw, `the last ${countWord(fw)} races`, 'Form window (up to and including this round)', 'projection: events');
    const df = M.driverForm(X, F);
    for (const k of ['leader', 'c2', 'c3']) {
      const id = P.entities.find((x) => x.key === k)?.ref, f = id && df.find((x) => x.driver_id === id);
      if (!f) continue;
      const wins = f.last.filter((x) => x === 1).length, pods = f.last.filter((x) => x !== 'DNF' && x != null && x <= 3).length;
      P.fact(`${k}_fpts`, f.recent.points, pts(f.recent.points), `${D(id)?.name} points in the form window`, 'derived: race classification');
      P.fact(`${k}_ffin`, f.last.join(','), f.last.map((x) => (x === 'DNF' ? 'a retirement' : x == null ? 'no start' : posText(x))).join(', '), `${D(id)?.name} form-window finishes, oldest first`, 'derived: race classification');
      P.fact(`${k}_fwins`, wins, wins === 0 ? 'no wins' : wins === 1 ? 'one win' : `${countWord(wins)} wins`, `${D(id)?.name} wins in the form window`, 'derived: race classification');
      P.fact(`${k}_fpods`, pods, pods === 0 ? 'no podiums' : pods === 1 ? 'one podium' : `${countWord(pods)} podiums`, `${D(id)?.name} podiums in the form window`, 'derived: race classification');
    }
  }

  // ---- season record up to and including this round ----
  const done = X.completedRaces(ev.season).filter((e) => e.start_utc <= race.start_utc);
  P.fact('season_races', done.length, done.length === 1 ? 'one race' : `${done.length} races`, 'Grands Prix completed this season, including this one', 'projection: events');
  const fin = (id) => done.map((e) => X.rows(e.id, 'race').find((r) => r.driver_id === id)).filter((r) => r?.status === 'classified');
  for (const k of ['leader', 'c2', 'c3']) {
    const id = P.entities.find((x) => x.key === k)?.ref;
    if (!id) continue;
    const wins = fin(id).filter((r) => r.position === 1).length, pods = fin(id).filter((r) => r.position <= 3).length;
    P.fact(`${k}_swins`, wins, wins === 0 ? 'no wins' : wins === 1 ? 'one win' : `${countWord(wins)} wins`, `${D(id)?.name} Grand Prix wins this season`, 'derived: race classification');
    P.fact(`${k}_spods`, pods, pods === 0 ? 'no podiums' : pods === 1 ? 'one podium' : `${countWord(pods)} podiums`, `${D(id)?.name} Grand Prix podiums this season`, 'derived: race classification');
  }
  const winners = new Set(done.map((e) => X.rows(e.id, 'race').find((r) => r.position === 1 && r.status === 'classified')?.driver_id).filter(Boolean));
  P.fact('winners_n', winners.size, winners.size === 1 ? 'one driver' : `${countWord(winners.size)} different drivers`, 'Different Grand Prix winners this season', 'derived: race classification');

  // ---- inside the title teams, Driver DNA ----
  const lt = D(after[0].id)?.team_id, ct = D(after[1].id)?.team_id;
  if (lt) addBattle(P, X, ev.season, race.start_utc, lt, 'mate');
  if (ct && ct !== lt) addBattle(P, X, ev.season, race.start_utc, ct, 'mate2');
  if (ct && ct === lt) P.signal('teammates_top_two');
  addDna(P, X, 'leader');
  addDna(P, X, 'c2');

  // ---- next round (calendar order after this race; its qualifying day) ----
  const nx = nextEventAfter(X, race.start_utc);
  const nq = nx && X.session(nx.id, 'qualifying');
  if (nx && nq?.start_utc) {
    P.entity('next', 'race', nx.id, `${nx.season} ${nx.name}`);
    if (X.circuit[nx.circuit_id]) P.entity('next_circuit', 'circuit', nx.circuit_id, X.circuit[nx.circuit_id].name);
    P.fact('next_quali_date', nq.start_utc, venueDay(nq.start_utc, nx.circuit_id), 'Next qualifying session (venue-local calendar day)', 'projection: sessions');
  } else P.signal('season_finale');
  P.context.temporal = temporalFrame(X, eventId, 'championship', publishedAt);
  const nws = nextWeekendStart(X, eventId);
  P.context.temporal.next_weekend_start = nws;
  // time-boxed: a championship update is never first-published once the next weekend has started
  if (nws) P.context.valid_until = nws;
  P.context.temporal.next_weekend_state = nws ? (Date.parse(nws) > Date.parse(publishedAt) ? 'upcoming' : 'started') : null;
  addPages(P, ev.season, ev.id);

  const top = after.slice(0, 5).map((x) => x.id);
  P.chart('championship', { title: `Drivers' championship after round ${ev.round}`, kind: 'line', x: ch.rounds.map((r) => r.round), series: top.map((id) => ({ id, name: D(id)?.name, color: C(D(id)?.team_id)?.color || null, values: ch.rounds.map((r) => r.drivers[id]?.p ?? null) })) });
  P.limit('Standings are the sum of our race and sprint classifications; penalties applied after a classification is published appear once the source updates.');
  return { ok: true, packet: P.freeze() };
}
