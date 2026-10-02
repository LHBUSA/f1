// Narrative composer for QUALIFYING recaps. Describes the session as classified (positions, segment times, cut
// lines) and what it means for the race and the standings, without predicting the race.
export const QUALI_COMPOSER_VERSION = 'f1-compose-quali@2.0.0';

export function composeQualifying(P) {
  const has = (...ids) => ids.every((id) => P.facts.some((f) => f.id === id) || P.entities.some((x) => x.key === id));
  const v = (id) => P.facts.find((f) => f.id === id)?.value;
  const ref = (k) => P.entities.find((x) => x.key === k)?.ref;
  const sig = (n) => P.context.signals.some((s) => s.name === n);
  const pick = (key, xs) => { let h = 0; for (const c of P.hash + key) h = (h * 31 + c.charCodeAt(0)) >>> 0; return xs[h % xs.length]; };
  const join = (...xs) => xs.filter(Boolean).join(' ');
  const same = (a, b) => ref(a) && ref(a) === ref(b);
  const S = [];
  const section = (heading, paragraphs, extra = {}) => { const ps = paragraphs.filter(Boolean); if (ps.length || extra.module) S.push({ heading, paragraphs: ps, ...extra }); };
  const lock = sig('front_row_lockout');
  const leaderCut = same('cut', 'leader');

  // ---------- lede ----------
  section('', [
    join(
      '{e:q1} took pole for the {f:event} with {f:q1_lap} for {e:q1_team}' + (has('pole_gap', 'q2') ? ', {f:pole_gap} clear of {e:q2}.' : '.'),
      sig('largest_pole_margin_season') && has('season_pole_margin') ? 'It is the largest pole margin of the season so far, against an average of {f:season_pole_margin}.' : sig('smallest_pole_margin_season') && has('season_pole_margin') ? 'It is the smallest pole margin of the season so far, against an average of {f:season_pole_margin}.' : null,
      "It is {s:q1}'s {f:season_poles}.",
    ),
    leaderCut && has('cut_segment', 'cut_pos') ? join('The bigger story sits further down the order.', 'Championship leader {e:cut} was eliminated in {f:cut_segment} and qualified {f:cut_pos}; the starting grid can still change if penalties apply.') : has('leader', 'leader_pos') ? pick('ldr', ['Championship leader {e:leader} qualified {f:leader_pos} at {e:circuit}.', 'At {e:circuit}, championship leader {e:leader} will line up from {f:leader_pos} on the qualifying order.']) : sig('leader_on_pole') ? '{s:q1} arrives at the {f:event} race as championship leader and pole-sitter.' : null,
    has('c2', 'c2_pos', 'c2_gap') ? `In the standings, {e:c2} trails by {f:c2_gap} going into the race and qualified {f:c2_pos}.` : null,
  ]);

  // ---------- the front of the grid ----------
  const front = [];
  if (has('q2', 'q3')) front.push(join(
    lock ? '{e:q2} completed a {e:q1_team} front-row lockout,' : '{e:q2} joins {s:q1} on the front row,',
    has('p3_gap') ? '{f:q2_lap} to {s:q1}\'s {f:q1_lap}, with {e:q3} {f:q3_pos} at {f:p3_gap}.' : 'with {e:q3} {f:q3_pos}.',
    sig('clear_pole') && has('p3_gap', 'pole_gap') && Math.abs(v('p3_gap') - v('pole_gap')) < 50 ? 'The cars behind pole were separated by almost nothing; pole was the outlier.' : null,
  ));
  if (has('spread10', 'p10')) front.push('The gap from pole to {f:p10} was {f:spread10}.');
  section('The front of the grid', front, { module: P.charts.includes('quali_gaps') ? 'quali_gaps' : null });

  // ---------- team by team ----------
  const teams = [];
  for (let i = 1; i <= 5; i++) {
    const k = `qt${i}`;
    if (!has(k, `${k}a`, `${k}b`, `${k}a_pos`, `${k}b_pos`)) continue;
    teams.push(pick(k, [
      `{e:${k}}: {s:${k}a} {f:${k}a_pos}, {s:${k}b} {f:${k}b_pos}${has(`${k}_gap`) ? `, {f:${k}_gap} apart in the deepest segment both completed` : ''}.`,
      `At {e:${k}}, {s:${k}a} qualified {f:${k}a_pos} and {s:${k}b} {f:${k}b_pos}${has(`${k}_gap`) ? `, a gap of {f:${k}_gap} where both set a time` : ''}.`,
    ]));
  }
  if (teams.length) section('Team by team', [teams.slice(0, 3).join(' '), teams.slice(3).join(' ')]);

  // ---------- the cut lines ----------
  const cut = [];
  if (has('outq1_n', 'outq2_n')) {
    const q1names = P.entities.filter((x) => /^outq1_\d$/.test(x.key)).map((x) => `{e:${x.key}}`);
    const q2names = P.entities.filter((x) => /^outq2_\d$/.test(x.key)).map((x) => `{e:${x.key}}`);
    const list = (xs) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
    cut.push(join(
      q2names.length ? `In Q2, {f:outq2_n} drivers went out: ${list(q2names)}.` : null,
      q1names.length ? `Q1 accounted for {f:outq1_n}: ${list(q1names)}.` : null,
      sig('team_both_out_q1') ? pick('tq1', ['{e:team_out_q1} lost both cars in Q1 at {e:circuit}.', 'Neither {e:team_out_q1} car made it out of Q1 at {e:circuit}.']) : null,
    ));
  }
  section('The cut lines', cut);

  // ---------- season qualifying battles ----------
  const tbs = [];
  for (const k of ['tb1', 'tb2']) {
    const c = P.context[k];
    if (!c || !has(`${k}_team`, `${k}_q`)) continue;
    const L = (s) => (s === 'a' ? `{s:${k}_a}` : `{s:${k}_b}`), O = (s) => (s === 'a' ? `{s:${k}_b}` : `{s:${k}_a}`);
    tbs.push(c.q === 'level' ? `At {e:${k}_team}, the season qualifying head-to-head now stands level, with a median gap of {f:${k}_gap}.` : `At {e:${k}_team}, ${L(c.q)} now leads ${O(c.q)} {f:${k}_q} in qualifying this season${has(`${k}_gap`) ? ', with a median gap of {f:' + k + '_gap}' : ''}; the race head-to-head with both classified is {f:${k}_r}.`);
  }
  if (tbs.length) section('The season picture inside the teams', [tbs.join(' ') + pick('tbl', [' The full comparisons, updated after the {f:event} session, are in {e:page_teammates}.', ' Every pairing, including these after {f:round}, is in {e:page_teammates}.'])]);

  // ---------- championship context ----------
  const ch = [];
  if (has('leader', 'leader_points', 'c2_gap')) ch.push(join(
    `{e:leader} leads the championship on {f:leader_points}, {f:c2_gap} ahead of ${sig('teammates_top_two') ? '{e:leader_team} teammate ' : ''}{e:c2}, with {f:rounds_left} to run including this one.`,
    has('max_left', 'alive') ? 'One driver can still score {f:max_left}, and {f:alive} drivers remain in mathematical reach.' : null,
    has('lead_then', 'lead_then_round') ? (sig('lead_growing') ? 'The lead has grown from {f:lead_then} after {f:lead_then_round}.' : sig('lead_shrinking') ? 'The lead has come down from {f:lead_then} after {f:lead_then_round}.' : null) : null,
  ));
  if (leaderCut && same('c2', 'q1')) ch.push('On paper, qualifying hands the title race a clear opening: the challenger starts from pole and the leader from deep in the field. The race decides what that is worth.');
  section('What it means for the championship', ch);

  // ---------- the circuit and the data ----------
  const data = [];
  if (has('arch_pole_wins', 'arch_front_row')) data.push(join(
    'History here offers a measure of what pole is worth.',
    'Of the classified races at {e:circuit} in our archive, {f:arch_pole_wins} were won from pole and {f:arch_front_row} from the front row.',
    has('last_winner', 'last_race') ? 'The most recent, the {e:last_race}, went to {e:last_winner} from {f:last_winner_grid}.' : null,
    has('prev_pole', 'prev_pole_result') ? 'Last time here, {e:prev_pole} started from pole and finished {f:prev_pole_result}.' : null,
    'That is a record of past races, not a forecast for this one.',
  ));
  if (has('pole_dna_q')) data.push(join("{s:q1}'s Qualifying Pace sits at the {f:pole_dna_q} in the {f:dna_window} Driver DNA window, which measures each driver against a teammate", has('q1_dna') && /qualifying/i.test(String(v('q1_dna'))) ? 'and is the strongest dimension of that profile.' : '.').replace(' .', '.'));
  if (has('q2_dna', 'q2_dna_p')) data.push("For {s:q2}, the strongest Driver DNA dimension is {f:q2_dna}, at the {f:q2_dna_p}.");
  section('The circuit and the data', data);

  section('Qualifying classification', ['The full order with every segment time, as published.'], { module: 'quali_table' });
  section("What's next", [join(
    has('race_date') ? 'The race starts on {f:race_date}.' : null,
    'Results land on the {e:race} page, {e:page_pbecast} follows the session live, and the standings, form and teammate views sit in {e:page_standings}, {e:page_form} and {e:page_teammates}.',
  )]);

  const headline = leaderCut ? '{e:q1} takes {f:event} pole as championship leader {s:cut} goes out in {f:cut_segment}' : lock ? '{e:q1} leads a {e:q1_team} front-row lockout at the {f:event}' : '{e:q1} takes pole for the {f:event}';
  return {
    headline,
    dek: join('{s:q1} set {f:q1_lap}' + (has('pole_gap', 'q2') ? ', {f:pole_gap} clear of {e:q2}.' : '.'), leaderCut ? '{s:cut} qualified {f:cut_pos}.' : has('leader', 'leader_pos') ? 'Championship leader {e:leader} qualified {f:leader_pos}.' : null),
    sections: S,
    seo_title: '{s:q1} on pole for the {f:event}',
    seo_description: '{e:q1} took pole for the {f:event} with {f:q1_lap}. Full order, team-by-team gaps, cut lines and what it means for the title.',
    social_headline: headline,
    composer: QUALI_COMPOSER_VERSION,
  };
}
