// Narrative composer for RACE PREVIEWS. The packet is source material; this decides structure, order and transitions.
// Every paragraph is assembled from beats: a beat writes only when all of its facts exist, comparisons are computed
// from fact values (never asserted), and phrasing varies deterministically by packet.
// Tokens: {f:id} fact, {e:key} link, {s:key} surname/short name.
export const COMPOSER_VERSION = 'f1-compose-preview@2.1.0';

export function composePreview(P) {
  const has = (...ids) => ids.every((id) => P.facts.some((f) => f.id === id) || P.entities.some((x) => x.key === id));
  const v = (id) => P.facts.find((f) => f.id === id)?.value;
  const ref = (k) => P.entities.find((x) => x.key === k)?.ref;
  const sig = (n) => P.context.signals.some((s) => s.name === n);
  const pick = (key, xs) => { let h = 0; for (const c of P.hash + key) h = (h * 31 + c.charCodeAt(0)) >>> 0; return xs[h % xs.length]; };
  const join = (...xs) => xs.filter(Boolean).join(' ');
  const same = (a, b) => ref(a) && ref(a) === ref(b);
  const S = [];
  const section = (heading, paragraphs, extra = {}) => { const ps = paragraphs.filter(Boolean); if (ps.length) S.push({ heading, paragraphs: ps, ...extra }); };

  // ---------- 1. the weekend in one view ----------
  const lede = [];
  if (sig('relocated') && has('orig_race', 'orig_circuit', 'gp_title')) lede.push(join(
    'The {f:gp_title} goes ahead this weekend, but not at {e:orig_circuit}.',
    has('orig_date') ? 'The round scheduled there for {f:orig_date} is listed as cancelled, and the race carrying that title now runs at {e:circuit} in {f:country} as {f:round} of the season,' : 'The race carrying that title now runs at {e:circuit} in {f:country} as {f:round} of the season,',
    'which is why the event appears on the calendar as the {f:event}.',
  ));
  else lede.push('The {f:event} is {f:round} of the season, at {e:circuit}.');
  if (sig('return_after_gap') && has('years_away', 'held')) lede.push(join('It is also a return.', '{e:circuit} hosted {f:held} between {f:first_held} and {f:last_held}, and the championship has been away for {f:years_away}.', has('lap_km', 'turns') ? 'The current layout runs {f:lap_km} with {f:turns}.' : null));
  if (has('leader', 'leader_points', 'c2', 'c2_gap')) lede.push(join(
    `{e:leader} arrives leading the championship on {f:leader_points}, {f:c2_gap} clear of ${sig('teammates_top_two') ? '{e:leader_team} teammate ' : ''}{e:c2}, with {f:rounds_left} still to run.`,
    sig('teammates_top_two') ? 'For now the title fight is an internal {e:leader_team} contest.' : null,
  ));
  section('', lede);

  // ---------- 2. championship stakes ----------
  const stakes = [];
  if (has('max_left', 'race_max', 'rounds_left')) stakes.push(join(
    `With {f:rounds_left} left${v('sprints_left') ? ', including {f:sprints_left},' : ''} and this season's results paying {f:race_max} for a race win${has('sprint_max') ? ' and {f:sprint_max} for a sprint win' : ''}, one driver can still score {f:max_left}.`,
    has('lead_share') ? "{s:leader}'s margin over {s:c2} is {f:lead_share} of that total." : null,
  ));
  if (has('alive')) stakes.push(join(
    'In all, {f:alive} drivers can still reach {s:leader} on points.',
    sig('no_clinch') && has('max_after') ? 'Nothing can be settled at {e:circuit}: even a maximum score here would leave {f:max_after} available afterwards, more than the lead.' : null,
    has('c3', 'c3_gap', 'c4', 'c4_gap') ? 'Behind the leading pair, {e:c3} trails by {f:c3_gap} and {e:c4} by {f:c4_gap}.' : null,
  ));
  if (has('lead_then', 'lead_then_round')) stakes.push(sig('lead_growing') ? 'The trend has run in one direction: after {f:lead_then_round} the lead was {f:lead_then}, and it has grown to {f:c2_gap} since.' : sig('lead_shrinking') ? 'The trend has run the other way: after {f:lead_then_round} the lead was {f:lead_then}, and it has come down to {f:c2_gap} since.' : sig('leader_changed_recently') ? 'The order at the top has changed recently: after {f:lead_then_round}, {e:leader_then} was leading.' : null);
  if (has('con1', 'con_gap', 'con1_points')) stakes.push("In the constructors' standings {e:con1} lead on {f:con1_points}, {f:con_gap} ahead of {e:con2}.");
  section('Championship stakes', stakes, { module: P.charts.includes('championship') ? 'championship' : null });

  // ---------- 3. why this circuit matters ----------
  const circ = [];
  if (has('longest_straight')) circ.push(join(
    `Measured from the track geometry, the longest straight at {e:circuit} runs {f:longest_straight}${has('second_straight') ? ', with another of {f:second_straight}' : ''}.`,
    has('straight_share', 'straight_rank') ? 'Long straights make up {f:straight_share} of the lap, which ranks {f:straight_rank} on that measure.' : null,
    has('peer_fast', 'peer_fast_share', 'peer_slow', 'peer_slow_share') ? 'For scale, {e:peer_fast} tops that list at {f:peer_fast_share} and {e:peer_slow} sits at the bottom with {f:peer_slow_share}.' : null,
    has('corner_split') ? 'The corners detected in the geometry split into {f:corner_split}.' : null,
  ));
  if (has('arch_front_row', 'arch_pole_wins')) circ.push(join(
    'The race record adds context.',
    'Across the classified Grands Prix here, {f:arch_pole_wins} were won from pole and {f:arch_front_row} from the front row,',
    has('deep_grid', 'deep_winner') ? 'while the deepest winning start in our archive is {f:deep_grid}, by {e:deep_winner} in the {e:deep_race}.' : 'with few wins from further back.',
    'Starting near the front has mattered here; starting first has not been enough on its own.',
    has('arch_class_rate') ? 'Across those races an average of {f:arch_class_rate} of starters were classified.' : null,
  ));
  section('Why this circuit matters', circ);

  // ---------- 4. history ----------
  const hist = [];
  if (has('held', 'first_held', 'last_held')) hist.push(join(
    has('unclassified', 'classified_n') ? 'Our archive has a published classification for {f:classified_n} of the races held here; the {f:unclassified} race has none, so every figure in this preview uses the classified editions.' : null,
    has('most_wins', 'most_wins_n') ? `{e:most_wins} has the most wins here with {f:most_wins_n}${has('most_wins_team', 'most_wins_team_n') ? ', and {e:most_wins_team} the most of any team lineage with {f:most_wins_team_n}' : ''}.` : null,
  ));
  if (has('recent_w1', 'recent_y1')) hist.push(join(
    'The last races before the break went to {e:recent_w1} in {f:recent_y1} from {f:recent_g1}' + (has('recent_w2') ? ', {e:recent_w2} in {f:recent_y2} from {f:recent_g2}' : '') + (has('recent_w3') ? ' and {e:recent_w3} in {f:recent_y3} from {f:recent_g3}' : '') + '.',
    sig('recent_winners_no_pole') ? 'None of them started from pole.' : null,
  ));
  if (has('grid_winners_count', 'gw1')) hist.push(join(
    `On the current grid, {f:grid_winners_count} ${v('grid_winners_count') === 1 ? 'driver has' : 'drivers have'} won here:`,
    '{e:gw1}, with {f:gw1_wins} in {f:gw1_years}' + (has('gw2') ? ', {e:gw2} in {f:gw2_years}' : '') + (has('gw3') ? ' and {e:gw3} in {f:gw3_years}' : '') + '.',
  ));
  section('The history here', hist);

  // ---------- 5. current form ----------
  const form = [];
  if (has('leader', 'leader_fpts', 'leader_fwins', 'leader_fpods')) form.push(join(
    `Over {f:form_window}, {s:leader} has {f:leader_fwins} and {f:leader_fpods} for {f:leader_fpts}${same('hot', 'leader') ? ', more than anyone else in that stretch' : ''}, finishing {f:leader_ffin}.`,
  ));
  if (has('c2', 'c2_fpts')) {
    const c4ahead = has('c4', 'c4_fpts') && v('c4_fpts') > v('c2_fpts');
    form.push(join(
      '{s:c2} has {f:c2_fpts} in the same stretch, with {f:c2_fwins} and {f:c2_fpods}.',
      c4ahead ? `{e:c4} has scored slightly more, {f:c4_fpts} including {f:c4_fwins}${same('improver', 'c4') && has('improver_delta') ? ', and has improved more than anyone, up {f:improver_delta} on the previous stretch' : ''}, yet still sits {f:c4_gap} from the lead.` : null,
    ));
  }
  if (has('improver', 'improver_delta') && !same('improver', 'c4')) form.push('The sharpest upturn belongs to {e:improver}, up {f:improver_delta} on the previous stretch.');
  if (has('c3', 'c3_fpts', 'c3_ffin') && v('c3_fpts') < v('c2_fpts')) form.push('{e:c3} has gone the other way, with {f:c3_fpts} from {f:c3_ffin}.');
  section('Current form', form);

  // ---------- 6. what the data can and cannot say ----------
  if (sig('thin_circuit_sample') && has('dna_recent')) section('What the data can and cannot say here', [join(
    'Circuit DNA builds its rates from the most recent decade at each circuit, and for {e:circuit} that window holds {f:dna_recent}.',
    'Rates over a sample that small would describe a couple of afternoons rather than a circuit, so none are quoted; the figures above are measured from the geometry or counted across every classified race here.',
  )]);

  // ---------- 7. Circuit Fit ----------
  const fit = [];
  if (has('fit_heavy', 'fit_light')) fit.push(join(
    `At {e:circuit} the heaviest weight goes to {f:fit_heavy} and the lightest to {f:fit_light}${has('track_pos_pct') ? ', since Circuit DNA places the importance of track position here at only the {f:track_pos_pct}' : ''}.`,
    has('track_pos_pct', 'arch_front_row') ? 'That reading comes from the thin recent window; the longer archive, with {f:arch_front_row} winners from the front row, points the other way, which is exactly why the confidence label reads {f:fit_confidence}.' : 'Its confidence here is {f:fit_confidence}.',
  ));
  if (has('fit1', 'fit1_score', 'fit1_c1', 'fit1_c1_p')) fit.push(join(
    '{e:fit1} leads the table on {f:fit1_score}, carried by {f:fit1_c1} at the {f:fit1_c1_p}' + (has('fit1_weak', 'fit1_weak_p') ? ', with {f:fit1_weak} the weaker side at the {f:fit1_weak_p}.' : '.'),
    has('fit2', 'fit2_score', 'fit2_c1_p', 'fit2_c2_p') ? '{e:fit2} follows on {f:fit2_score} with a more even profile: {f:fit2_c1} at the {f:fit2_c1_p} and {f:fit2_c2} at the {f:fit2_c2_p}.' : null,
    has('fit3', 'fit3_score', 'fit3_c1_p', 'fit3_c2_p') ? '{e:fit3} is next on {f:fit3_score}, the reverse shape of the leader: {f:fit3_c1} at the {f:fit3_c1_p}, {f:fit3_c2} only at the {f:fit3_c2_p}.' : null,
  ));
  if (has('leader_fit_rank', 'leader_fit_score')) fit.push(`Championship leader {e:leader} ranks {f:leader_fit_rank} on {f:leader_fit_score}, so the profile reading and the standings tell different stories this weekend; how much a profile match is worth at a venue this thinly sampled is one of the weekend's open questions.${has('fitc1', 'fitc1_score') ? ' Among teams, {e:fitc1} fit best on {f:fitc1_score}.' : ''} Circuit Fit describes a match between profiles; it does not forecast results.`);
  section('Circuit Fit', fit, { module: P.charts.includes('fit') ? 'fit' : null });

  // ---------- 8. the team picture ----------
  const team = [];
  if (has('cf1', 'cf1_pts', 'cf2', 'cf2_pts')) team.push(join(
    'Over {f:form_window}, {e:cf1} scored {f:cf1_pts} with {f:cf1_dnf} and an average best qualifying position of {f:cf1_q}.',
    has('cf3') && v('cf2_pts') === v('cf3_pts') ? '{e:cf2} and {e:cf3} are level behind on {f:cf2_pts} each, with {f:cf2_dnf} and {f:cf3_dnf} respectively.' : '{e:cf2} scored {f:cf2_pts}.',
    has('cf3_q', 'cf1_q') && v('cf3_q') < v('cf1_q') ? '{e:cf3} have qualified higher on average, at {f:cf3_q}, without turning it into the same points haul.' : null,
  ));
  const tbLine = (i) => {
    const k = `tb${i}`, c = P.context[k];
    if (!c || !has(`${k}_team`, `${k}_q`, `${k}_r`)) return null;
    const L = (side) => (side === 'a' ? `{s:${k}_a}` : `{s:${k}_b}`);
    const pointsPart = same(`${k}_team`, 'leader_team') && sig('teammates_top_two') ? '' : ` and on points, {f:${k}_pts}`;
    if (c.q === c.r && c.q !== 'level') return `At {e:${k}_team}, ${L(c.q)} leads ${L(c.q === 'a' ? 'b' : 'a')} {f:${k}_q} in qualifying and {f:${k}_r} in races where both finished${pointsPart}${has(`${k}_gap`) ? `, with a median qualifying gap of {f:${k}_gap}` : ''}.`;
    return `At {e:${k}_team} the picture is split: ${c.q === 'level' ? 'qualifying is level' : `${L(c.q)} leads qualifying {f:${k}_q}`}, while ${c.r === 'level' ? 'the race head-to-head is level' : `${L(c.r)} leads the race head-to-head {f:${k}_r}`}.${has(`${k}_gap`) ? ` The median qualifying gap is {f:${k}_gap}.` : ''}`;
  };
  team.push([1, 2, 3].map(tbLine).filter(Boolean).join(' '));
  section('The team picture', team);

  // ---------- 9. drivers to watch ----------
  const watch = [];
  if (has('leader', 'leader_dna', 'leader_dna_p', 'leader_fit_rank')) watch.push(`{e:leader}. The leader${same('hot', 'leader') ? ' and the highest scorer of {f:form_window}' : ''}, with a Driver DNA profile led by {f:leader_dna} at the {f:leader_dna_p}.`);
  if (has('c2', 'c2_dna', 'c2_dna_p')) watch.push(`{e:c2}. The nearest challenger, in the same car. {s:c2}'s strongest Driver DNA dimension is {f:c2_dna} at the {f:c2_dna_p}, at a circuit where {f:arch_front_row} winners started on the front row.`);
  if (has('fit1', 'fit1_dna', 'fit1_dna_p')) watch.push(`{e:fit1}. Top of the Circuit Fit table${same('fit1', 'recent_w1') ? ' and the most recent winner here, in {f:recent_y1}' : ''}, with Driver DNA at the {f:fit1_dna_p} for {f:fit1_dna}.`);
  if (has('gw1', 'gw1_wins', 'gw1_dna', 'gw1_dna_p') && !same('gw1', 'fit1')) watch.push(`{e:gw1}. The only driver on the grid with more than one win here, {f:gw1_wins} in {f:gw1_years}, and a Driver DNA profile led by {f:gw1_dna} at the {f:gw1_dna_p}.`);
  section('Drivers to watch', watch.slice(0, 5));

  // ---------- 10. what to watch ----------
  const ww = [];
  if (sig('teammates_top_two')) ww.push('The {e:leader_team} order in qualifying. The title contenders share a car, so the first measurable result of the weekend is which of them starts ahead.');
  if (has('arch_front_row', 'track_pos_pct')) ww.push('Front row versus profile. The archive says the front row has produced {f:arch_front_row} winners here; the thin recent window says track position matters little. The race will add one more data point to a question the numbers have not settled.');
  section('What to watch', ww);

  // ---------- 11. follow ----------
  section('Follow the weekend', [join(
    'Every session result lands on the {e:race} page as it is published, and {e:page_pbecast} follows the race live.',
    'The table is on the {e:page_standings} page, the circuit profile in {e:page_circuits}, and the whole grid in {e:page_intel} and {e:page_teammates}.',
  )]);

  const H = sig('relocated') ? '{f:gp_title} preview: the championship heads to {e:circuit}' : '{f:event} preview: the championship heads to {e:circuit}';
  return {
    headline: H,
    dek: join(has('leader', 'c2_gap') ? '{e:leader} leads by {f:c2_gap} with {f:rounds_left} left.' : null, sig('return_after_gap') ? 'The championship returns to {e:circuit} after {f:years_away}, on one of the straightest layouts of the season and with a race record that favours the front row.' : null),
    sections: S,
    seo_title: sig('relocated') ? '{f:gp_title} at {e:circuit}: preview' : '{f:event} preview',
    seo_description: "{f:event} preview: title stakes, the circuit's layout and history, form, team battles and Circuit Fit at {e:circuit}.",
    social_headline: H,
    composer: COMPOSER_VERSION,
  };
}
