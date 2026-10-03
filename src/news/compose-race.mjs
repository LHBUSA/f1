// Narrative composer for RACE FINALS. Built only from the frozen packet; describes what the classification, the
// standings and our archive show. It never narrates lap-by-lap order it does not have, never assigns causes, and never
// predicts. Tokens: {f:id} fact, {e:key} link, {s:key} surname.
export const RACE_COMPOSER_VERSION = 'f1-compose-race@2.1.0';

export function composeRaceFinal(P) {
  const has = (...ids) => ids.every((id) => P.facts.some((f) => f.id === id) || P.entities.some((x) => x.key === id));
  const v = (id) => P.facts.find((f) => f.id === id)?.value;
  const ref = (k) => P.entities.find((x) => x.key === k)?.ref;
  const sig = (n) => P.context.signals.some((s) => s.name === n);
  const sigv = (n) => P.context.signals.find((s) => s.name === n);
  const pick = (key, xs) => { let h = 0; for (const c of P.hash + key) h = (h * 31 + c.charCodeAt(0)) >>> 0; return xs[h % xs.length]; };
  const join = (...xs) => xs.filter(Boolean).join(' ');
  const same = (a, b) => ref(a) && ref(a) === ref(b);
  const S = [];
  const section = (heading, paragraphs, extra = {}) => { const ps = paragraphs.filter(Boolean); if (ps.length || extra.module) S.push({ heading, paragraphs: ps, ...extra }); };
  const winnerLeads = same('p1', 'leader');
  const close = sig('close_finish'), first = sig('first_career_win');

  // ---------- lede ----------
  const lede = [];
  lede.push(join(
    `{e:p1} won the {f:event} for {e:p1_team}${has('p1_grid') ? ' from {f:p1_grid}' : ''}${has('margin', 'p2') ? ', {f:margin} ahead of {e:p2}' : ''}.`,
    first ? 'It is a first Grand Prix win.' : v('p1_career_wins') === v('p1_season_wins') && v('p1_career_wins') > 1 ? 'It is the {f:p1_career_wins} for {s:p1} in our archive, all of them this season.' : 'It is the {f:p1_career_wins} for {s:p1} in our archive and the {f:p1_season_wins}.',
  ));
  if (has('p2', 'p2_grid', 'p3', 'p3_grid')) lede.push(join(
    v('p2_grid') > v('p2_finish') + 2 ? '{s:p2} came from {f:p2_grid} to take the runner-up place, and {e:p3} completed the podium from {f:p3_grid}.' : '{s:p2} finished as runner-up from {f:p2_grid}, and {e:p3} completed the podium from {f:p3_grid}.',
    sig('team_one_two') ? '{e:p1_team} took a one-two.' : null,
  ));
  if (has('leader', 'c2_gap')) lede.push(winnerLeads ? 'The result extends a championship lead that now stands at {f:c2_gap}.' : join(
    sig('lead_closed') && same('c2', 'p1') && has('leader_result', 'lead_move') ? `It also moves the championship. {e:leader}, the leader, finished {f:leader_result}, so {s:p1} took {f:lead_move} out of the lead, which now stands at {f:c2_gap}.` : `In the championship, {e:leader} still leads, now by {f:c2_gap}.`,
    has('max_left') ? 'There are {f:max_left} still available.' : null,
  ));
  section('', lede);

  // ---------- how the race turned (classification level) ----------
  const turned = [];
  turned.push(join(
    sig('pole_to_win') ? '{s:p1} started from pole and finished first; the classification records the result rather than the order lap by lap.' : sig('grid_differs_from_quali') && has('p1_quali') ? '{s:p1} qualified {f:p1_quali} but started {f:p1_grid}, and finished first.' : '{s:p1} started {f:p1_grid} and finished first.',
    has('pole', 'pole_result') ? (sig('pole_sitter_off_podium') ? 'Pole-sitter {e:pole} was classified {f:pole_result}.' : 'Pole-sitter {e:pole} finished {f:pole_result}.') : null,
  ));
  if (has('climber', 'climber_gain')) turned.push(join(
    'The biggest gain in the field belonged to {e:climber}, up {f:climber_gain} from {f:climber_grid} to {f:climber_finish}' + (same('climber', 'p1_mate') ? ', in the sister car to the winner.' : '.'),
    has('dropper', 'dropper_grid', 'dropper_finish') ? 'At the other end, {e:dropper} started {f:dropper_grid} and finished {f:dropper_finish}.' : null,
    has('gainers') ? 'In all, {f:gainers} classified cars finished ahead of where they started.' : null,
  ));
  if (has('retirements')) {
    const names = P.entities.filter((x) => /^dnf\d+$/.test(x.key)).map((x) => `{e:${x.key}}`);
    if (v('retirements') === 0) turned.push('Every starter was classified.');
    else if (names.length) turned.push(join(`The race had {f:retirements} from {f:starters}: ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`}.`, sig('most_dnf_season') && has('season_dnf_avg') ? 'No race this season has had more, against an average of {f:season_dnf_avg} per race.' : sig('joint_most_dnf_season') && has('season_dnf_avg') ? 'That equals the most in any race this season, against an average of {f:season_dnf_avg} per race.' : has('season_dnf_avg') ? 'The season average is {f:season_dnf_avg} per race.' : null));
  }
  if (has('fl_driver', 'fl_time')) turned.push(same('fl_driver', 'p1') ? `{s:p1} also set the fastest lap, {f:fl_time}${has('fl_lap') ? ' on {f:fl_lap}' : ''}${has('p1_stops') ? ', having made {f:p1_stops}' : ''}.` : `{e:fl_driver} set the fastest lap, {f:fl_time}${has('fl_lap') ? ' on {f:fl_lap}' : ''}.${has('p1_stops') ? ' {s:p1} made {f:p1_stops}.' : ''}`);
  section('How the race turned', turned);

  // ---------- the decisive data ----------
  const data = [];
  if (has('pole_time', 'pole_gap', 'q2')) data.push('Qualifying set the frame: {s:p1} took pole with {f:pole_time}, {f:pole_gap} clear of {e:q2}.');
  if (has('margin', 'p2')) data.push(close && v('p2_grid') > 3 ? 'At the flag {s:p2} was only {f:margin} behind, having started from {f:p2_grid}; the classification cannot say when that gap formed or how it moved, only how small it was at the end.' : close ? 'At the flag {s:p2} was only {f:margin} behind.' : 'At the flag {s:p2} was {f:margin} behind.');
  if (has('p1_time', 'p1_laps')) data.push('{s:p1} covered {f:p1_laps} in {f:p1_time}.');
  if (has('haul1', 'haul1_pts')) data.push(`On points, {e:haul1} took {f:haul1_pts} from the weekend${has('haul2', 'haul2_pts') ? ', {e:haul2} {f:haul2_pts}' : ''}${has('haul3', 'haul3_pts') ? ' and {e:haul3} {f:haul3_pts}' : ''}.`);
  section('The decisive data', data.length ? [data.join(' ')] : []);

  // ---------- team by team ----------
  const teams = [];
  for (let i = 1; i <= 5; i++) {
    const k = `tw${i}`;
    if (!has(k, `${k}a`, `${k}b`, `${k}a_fin`, `${k}b_fin`, `${k}_pts`)) continue;
    const car = (c) => (has(`${c}_grid`) ? `{s:${c}} {f:${c}_fin} from {f:${c}_grid}` : `{s:${c}} {f:${c}_fin}`);
    teams.push(pick(`tw${i}`, [
      `{e:${k}} scored {f:${k}_pts}: ${car(`${k}a`)}, ${car(`${k}b`)}.`,
      `For {e:${k}}, ${car(`${k}a`)} and ${car(`${k}b`)}, worth {f:${k}_pts}.`,
    ]));
  }
  if (teams.length >= 3) section('Team by team', [teams.slice(0, 3).join(' '), teams.slice(3).join(' ')]);

  // ---------- the profile behind it ----------
  const prof = [];
  if (has('p1_dna', 'p1_dna_p')) prof.push(join(
    /qualifying/i.test(String(v('p1_dna'))) && sig('pole_to_win') ? 'A pole-to-win weekend fits the profile Driver DNA draws of {s:p1}: {f:p1_dna} is the strongest dimension, at the {f:p1_dna_p} in the {f:dna_window} window.' : "{s:p1}'s strongest Driver DNA dimension is {f:p1_dna}, at the {f:p1_dna_p} in the {f:dna_window} window.",
    has('p1_team_quali_dna') ? 'On the car side, {e:p1_team} rank at the {f:p1_team_quali_dna} for Qualifying Speed in Constructor DNA this season.' : null,
  ));
  if (has('p1_fpts', 'p1_ffin')) prof.push(join(
    'In {f:form_window}, {s:p1} had scored {f:p1_fpts} with {f:p1_fwins}, finishing {f:p1_ffin}.',
    has('p2_fpts') ? 'Over the same races {s:p2} had {f:p2_fpts} and {f:p2_fpods}.' : null,
  ));
  if (has('circuit_prior_wins')) prof.push(v('circuit_prior_wins') === 0 ? 'It is the first win for {s:p1} at {e:circuit} in our archive.' : 'Before this race, {s:p1} had {f:circuit_prior_wins} at {e:circuit}.');
  section('The profile behind it', prof);

  // ---------- teammates ----------
  const tb = (k) => {
    const c = P.context[k];
    if (!c || !has(`${k}_team`, `${k}_q`, `${k}_r`)) return null;
    const L = (s) => (s === 'a' ? `{s:${k}_a}` : `{s:${k}_b}`), O = (s) => (s === 'a' ? `{s:${k}_b}` : `{s:${k}_a}`);
    if (c.q === c.r && c.q !== 'level') return `At {e:${k}_team}, ${L(c.q)} now leads ${O(c.q)} {f:${k}_q} in qualifying and {f:${k}_r} in races where both were classified, with a median qualifying gap of {f:${k}_gap}; the full comparison is on the {e:${k}_match} page.`;
    return `At {e:${k}_team} the season picture is split: ${c.q === 'level' ? 'qualifying is level' : `${L(c.q)} leads qualifying {f:${k}_q}`}, while ${c.r === 'level' ? 'races are level' : `${L(c.r)} leads the race head-to-head {f:${k}_r}`}. The full comparison is on the {e:${k}_match} page.`;
  };
  const mates = [];
  if (has('p1_mate', 'p1_mate_result')) mates.push(join(`Teammate {e:p1_mate} finished {f:p1_mate_result}.`, tb('tb1')));
  if (tb('tb2')) mates.push(tb('tb2'));
  section('Inside the teams', mates);

  // ---------- championship effect ----------
  const ch = [];
  if (has('leader', 'leader_points')) ch.push(join(
    sig('lead_change') ? '{e:leader} takes over the championship lead from {e:prev_leader}, on {f:leader_points}.' : `{e:leader} leads the drivers' championship on {f:leader_points}${has('c2', 'c2_gap') ? ', {f:c2_gap} clear of {e:c2}' : ''}.`,
    !winnerLeads && has('p1_champ_points', 'p1_champ_pos') ? (v('p1_champ_pos') === v('p1_champ_pos_before') ? '{s:p1} stays {f:p1_champ_pos} on {f:p1_champ_points}.' : '{s:p1} moves to {f:p1_champ_pos} on {f:p1_champ_points}.') : null,
  ));
  if (has('max_left', 'alive')) ch.push(join(
    'With {f:rounds_left} left{SPR}, one driver can still score {f:max_left}, and {f:alive} drivers remain mathematically in reach of the lead.'.replace('{SPR}', v('sprints_left') ? ', including {f:sprints_left}' : ''),
    has('lead_share') ? 'The lead is {f:lead_share} of what remains.' : null,
    has('lead_then', 'lead_then_round') ? (sig('lead_growing') ? 'After {f:lead_then_round} it was {f:lead_then}, so the trend still runs toward the leader.' : sig('lead_shrinking') ? 'After {f:lead_then_round} it was {f:lead_then}, so the gap has been closing.' : null) : null,
  ));
  if (has('riser', 'riser_from', 'riser_to')) ch.push('The biggest climb among the leading drivers in the standings belongs to {e:riser}, from {f:riser_from} to {f:riser_to}.');
  if (has('con1', 'con_gap')) ch.push("In the constructors' standings {e:con1} lead on {f:con1_points}, {f:con_gap} ahead of {e:con2}.");
  section('Championship effect', ch, { module: P.charts.includes('championship') ? 'championship' : null });

  // ---------- the circuit's record ----------
  const rec = [];
  if (has('arch_pole_wins', 'arch_front_row', 'held')) rec.push(join(
    'In our archive, {e:circuit} had hosted {f:held}.',
    'Of the classified editions, {f:arch_pole_wins} were won from pole and {f:arch_front_row} from the front row,',
    sig('pole_to_win') ? (sig('pole_win_rare_here') ? 'so a win from pole has been less common here than a win from the front row.' : 'so a win from pole follows the most common pattern here.') : sig('won_off_front_row_here') ? 'which makes a win from {f:p1_grid} the exception here rather than the rule.' : 'which this result follows.',
    has('last_winner', 'last_race') ? 'The previous edition, the {e:last_race}, went to {e:last_winner} from {f:last_winner_grid}.' : null,
    has('most_wins', 'most_wins_n') ? '{e:most_wins} holds the most wins here, with {f:most_wins_n}.' : null,
  ));
  section("The circuit's record", rec);

  // ---------- result + grid/finish ----------
  section('The result', ['The full classification for the {f:event}, {f:round} of the season, with grid slots and points.'], { module: 'classification' });
  if (P.charts.includes('grid_finish')) section('Grid to finish', ["Each line joins a points finisher's starting slot to the finishing position."], { module: 'grid_finish' });
  if (P.context.replay) section('Replay the race', ['PBEcast replays this race from the timing observations we recorded during the session.'], { module: 'pbecast' });

  // ---------- next + follow ----------
  section('Follow the championship', [join(
    // next round in calendar order; tense follows whether its race had started when this story was first published
    has('next', 'next_race_start') ? (P.context.temporal?.next_race_state === 'upcoming' ? 'The season moves on to the {e:next}, where the race starts on {f:next_race_start}.' : 'The next round on the calendar was the {e:next}, raced on {f:next_race_start}.') : null,
    'The {e:race} page has every session, the {e:page_standings} page the updated table, and {e:page_intel} the form, team and DNA view of the grid, including {e:page_teammates}.',
  )]);

  let headline;
  if (first) headline = '{e:p1} takes a first Grand Prix win at the {f:event}';
  else if (close && has('margin')) headline = '{e:p1} wins the {f:event} by {f:margin}';
  else if (sigv('won_from_grid')) headline = '{e:p1} wins the {f:event} from {f:p1_grid}';
  else headline = '{e:p1} wins the {f:event} for {e:p1_team}';
  return {
    headline,
    dek: join(has('p2') ? `{s:p1} finished ahead of {e:p2}${has('p3') ? ' and {e:p3}' : ''}${has('margin') ? ' with a winning margin of {f:margin}' : ''}.` : null, has('leader', 'c2_gap') ? (winnerLeads ? '{s:p1} leads the championship by {f:c2_gap}.' : '{e:leader} still leads the championship by {f:c2_gap}.') : null),
    sections: S,
    seo_title: close && has('margin') ? '{s:p1} wins {f:event} by {f:margin}' : '{s:p1} wins the {f:event}',
    seo_description: '{e:p1} won the {f:event} for {e:p1_team}. Result, how the race turned, championship stakes and the data behind it.',
    social_headline: headline,
    composer: RACE_COMPOSER_VERSION,
  };
}
