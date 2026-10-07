// Narrative composer for CHAMPIONSHIP UPDATES. Built only from the frozen packet: the table after the round, what the
// round changed, the arithmetic still in play, form, teammates and DNA. It never predicts a champion, never assigns a
// cause and never calls the title decided unless the packet's arithmetic signal says so.
// Tokens: {f:id} fact, {e:key} link, {s:key} surname.
export const CHAMPIONSHIP_COMPOSER_VERSION = 'f1-compose-championship@1.0.0';

export function composeChampionship(P) {
  const has = (...ids) => ids.every((id) => P.facts.some((f) => f.id === id) || P.entities.some((x) => x.key === id));
  const v = (id) => P.facts.find((f) => f.id === id)?.value;
  const ref = (k) => P.entities.find((x) => x.key === k)?.ref;
  const sig = (n) => P.context.signals.some((s) => s.name === n);
  const join = (...xs) => xs.filter(Boolean).join(' ');
  const same = (a, b) => ref(a) && ref(a) === ref(b);
  const S = [];
  const section = (heading, paragraphs, extra = {}) => { const ps = paragraphs.filter(Boolean); if (ps.length || extra.module) S.push({ heading, paragraphs: ps, ...extra }); };
  const decided = sig('title_decided');

  // ---------- lede ----------
  const lede = [];
  lede.push(join(
    "{e:leader} leads the drivers' championship on {f:leader_points} after the {f:event}, {f:c2_gap} clear of {e:c2}.",
    sig('lead_change') ? '{s:leader} took over at the top from {e:prev_leader} at this round.'
      : sig('lead_closed') ? 'The margin at the top closed by {f:swing_lead_move} at this round, from {f:swing_lead_before}.'
      : sig('lead_grew') ? 'The margin at the top grew by {f:swing_lead_move} at this round, from {f:swing_lead_before}.'
      : sig('lead_unchanged') ? 'The margin at the top did not move at this round.' : null,
  ));
  if (has('max_left', 'alive', 'rounds_left')) lede.push(decided
    ? 'With {f:rounds_left} left, one driver can still score {f:max_left}, which is less than the lead: on the arithmetic of the table, nobody can now reach {s:leader}.'
    : join(
      `With {f:rounds_left} left${v('sprints_left') ? ', including {f:sprints_left}' : ''}, one driver can still score {f:max_left}.`,
      v('alive') === 1 ? 'No other driver can now reach the leader on points.' : 'On points, {f:alive} drivers, the leader included, can still reach the top of the table.',
    ));
  section('', lede);

  // ---------- what the round changed ----------
  const round = [];
  round.push(join(
    same('p1', 'leader') ? '{e:p1} won the {e:race} for {e:p1_team}, which is how the leader added to the tally.' : '{e:p1} won the {e:race} for {e:p1_team}.',
    has('swing_leader_pts', 'swing_c2_pts') ? (v('swing_c2_pts') === 0 ? '{s:leader} took {f:swing_leader_pts} from the weekend, while {s:c2} left without points.' : v('swing_leader_pts') === 0 ? '{s:leader} left the weekend without points, while {s:c2} took {f:swing_c2_pts}.' : '{s:leader} took {f:swing_leader_pts} from the weekend and {s:c2} {f:swing_c2_pts}.') : null,
    has('leader_result', 'c2_result') ? 'In the Grand Prix itself {s:leader} was classified {f:leader_result} and {s:c2} {f:c2_result}.' : null,
    has('swing_top', 'swing_top_pts') ? (same('swing_top', 'p1') ? 'The {f:swing_top_pts} for {s:p1} were the most any driver scored at the round.' : 'The biggest haul of the weekend went to {e:swing_top}, with {f:swing_top_pts}.') : null,
  ));
  if (has('swing_riser', 'swing_riser_from', 'swing_riser_to') || has('swing_faller', 'swing_faller_from', 'swing_faller_to')) round.push(join(
    has('swing_riser', 'swing_riser_from', 'swing_riser_to') ? 'In the table, {e:swing_riser} climbed from {f:swing_riser_from} to {f:swing_riser_to}.' : null,
    has('swing_faller', 'swing_faller_from', 'swing_faller_to') ? '{e:swing_faller} slipped from {f:swing_faller_from} to {f:swing_faller_to}.' : null,
    'The full classification and every session of the weekend are on the {e:race} page.',
  ));
  section('What the round changed', round, { module: P.charts.includes('championship') ? 'championship' : null });

  // ---------- the chasing pack ----------
  const pack = [];
  if (has('c3', 'c3_gap', 'c3_points')) pack.push(join(
    'Behind the leading pair, {e:c3} sits on {f:c3_points}, {f:c3_gap} off the lead.',
    has('c4', 'c4_gap') ? '{e:c4} is {f:c4_gap} back' + (has('c5', 'c5_gap') ? ', and {e:c5} {f:c5_gap} back.' : '.') : null,
  ));
  if (has('lead_share') && !decided) pack.push(join(
    'The lead is {f:lead_share} of the points still available.',
    has('lead_then', 'lead_then_round') ? (sig('leader_changed_recently') ? 'After {f:lead_then_round}, {e:leader_then} was the one at the top of the table, with a margin of {f:lead_then}.' : sig('lead_growing') ? 'After {f:lead_then_round} the margin was {f:lead_then}, so it has grown since.' : sig('lead_shrinking') ? 'After {f:lead_then_round} the margin was {f:lead_then}, so it has been closing since.' : 'After {f:lead_then_round} the margin was also {f:lead_then}.') : null,
  ));
  if (has('race_max')) pack.push(join(
    'A Grand Prix win has been worth {f:race_max} this season' + (has('sprint_max') ? ', and a sprint win {f:sprint_max}.' : '.'),
    'A deficit larger than {f:max_left} cannot be recovered on points, and every deficit smaller than that still can, whatever the order of the remaining results.',
  ));
  section('The chasing pack', pack);

  // ---------- season record ----------
  const rec = [];
  if (has('leader_swins', 'leader_spods', 'season_races')) rec.push(join(
    'Across {f:season_races} so far, {s:leader} has {f:leader_swins} and {f:leader_spods}' + (has('c2_swins', 'c2_spods') ? ', against {f:c2_swins} and {f:c2_spods} for {s:c2}.' : '.'),
    has('c3_swins', 'c3_spods') ? '{s:c3} has {f:c3_swins} and {f:c3_spods}.' : null,
    has('winners_n') ? 'In all, {f:winners_n} have won a Grand Prix this season.' : null,
  ));
  section('The season so far', rec);

  // ---------- form ----------
  const form = [];
  if (has('form_window', 'leader_fpts', 'leader_ffin')) form.push('Over {f:form_window}, {s:leader} scored {f:leader_fpts} with {f:leader_fwins} and {f:leader_fpods}, finishing {f:leader_ffin}.');
  if (has('c2_fpts', 'c2_ffin')) form.push('Across the same races {s:c2} scored {f:c2_fpts}, with {f:c2_fwins} and {f:c2_fpods}; the finishes read {f:c2_ffin}.');
  if (has('c3_fpts', 'c3_ffin')) form.push('{s:c3} took {f:c3_fpts} over that stretch, finishing {f:c3_ffin}.');
  if (form.length) form.push('The {e:page_form} ranks every driver over the same window.');
  section('Recent form', [form.join(' ')].filter(Boolean));

  // ---------- teammates ----------
  const tb = (k) => {
    const c = P.context[k];
    if (!c || !has(`${k}_team`, `${k}_q`, `${k}_r`)) return null;
    const L = (s) => (s === 'a' ? `{s:${k}_a}` : `{s:${k}_b}`), O = (s) => (s === 'a' ? `{s:${k}_b}` : `{s:${k}_a}`);
    if (c.q === c.r && c.q !== 'level') return `At {e:${k}_team}, ${L(c.q)} leads ${O(c.q)} {f:${k}_q} in qualifying and {f:${k}_r} in races where both were classified${has(`${k}_gap`) ? `, with a median qualifying gap of {f:${k}_gap}` : ''}; the full comparison is on the {e:${k}_match} page.`;
    return `At {e:${k}_team} the season picture is split: ${c.q === 'level' ? 'qualifying is level' : `${L(c.q)} leads qualifying {f:${k}_q}`}, while ${c.r === 'level' ? 'races are level' : `${L(c.r)} leads the race head-to-head {f:${k}_r}`}. The full comparison is on the {e:${k}_match} page.`;
  };
  const mates = [tb('mate'), tb('mate2')].filter(Boolean);
  if (mates.length) mates.push(sig('teammates_top_two') ? 'The leading pair drive for the same team, so the nearest rival in the standings is also the benchmark in the same car. The intelligence hub lists {e:page_teammates} on the grid.' : 'The intelligence hub lists {e:page_teammates} on the grid.');
  section('Inside the title teams', mates);

  // ---------- DNA ----------
  const dna = [];
  if (has('leader_dna', 'leader_dna_p')) dna.push("{s:leader}'s strongest Driver DNA dimension is {f:leader_dna}, at the {f:leader_dna_p} in the {f:dna_window} window.");
  if (has('c2_dna', 'c2_dna_p')) dna.push("For {s:c2} it is {f:c2_dna}, at the {f:c2_dna_p}.");
  if (dna.length) dna.push('Driver DNA describes how each driver has performed across many races; it is a profile, not a forecast, and the {e:page_intel} hub sets it beside form and teammate data.');
  section('The profiles behind the table', [dna.join(' ')].filter(Boolean));

  // ---------- constructors ----------
  const cons = [];
  if (has('con1', 'con1_points', 'con_gap', 'con2')) cons.push(join(
    "In the constructors' standings {e:con1} lead on {f:con1_points}, {f:con_gap} ahead of {e:con2}" + (has('con3', 'con3_gap') ? ', with {e:con3} {f:con3_gap} off the top.' : '.'),
    has('swing_con_move') ? (sig('con_closed') ? "The constructors' margin closed by {f:swing_con_move} at this round." : sig('con_grew') ? "The constructors' margin grew by {f:swing_con_move} at this round." : "The constructors' margin did not move at this round.") : null,
    'Team pages carry each car, its people and its Constructor DNA.',
  ));
  section("The constructors' table", cons);

  // ---------- follow ----------
  section('Follow the championship', [join(
    has('next', 'next_quali_date') ? (has('next_circuit') ? 'The next round is the {e:next} at {e:next_circuit}, with qualifying on {f:next_quali_date}.' : 'The next round is the {e:next}, with qualifying on {f:next_quali_date}.') : null,
    'The {e:page_standings} page has the full table round by round, and {e:page_pbecast} carries live timing from every session.',
  )]);

  const headline = decided ? 'Title picture after the {f:event}: {e:leader} cannot be caught on points'
    : sig('lead_change') ? 'Title picture after the {f:event}: {e:leader} takes over the lead'
    : 'Title picture after the {f:event}: {e:leader} leads by {f:c2_gap}';
  return {
    headline,
    dek: join("{s:leader} leads {e:c2} by {f:c2_gap} in the drivers' championship with {f:rounds_left} left.", has('con1', 'con_gap') ? '{e:con1} lead the constructors by {f:con_gap}.' : null),
    sections: S,
    seo_title: 'Title picture after {f:round}: {s:leader} leads by {f:c2_gap}',
    seo_description: "The drivers' and constructors' championship after the {f:event}: gaps, points still available, form and what the round changed.",
    social_headline: headline,
    composer: CHAMPIONSHIP_COMPOSER_VERSION,
  };
}
