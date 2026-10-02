// Deterministic desk draft for a RACE FINAL. Prose is written with tokens only: {f:id} renders a packet fact,
// {e:key} a linked name, {s:key} a driver's surname. Sentences are chosen by tested signals; a sentence whose facts are
// missing is simply not written. The editor layer (if enabled) may rewrite this draft but passes the same gates.
const has = (P, ...ids) => ids.every((id) => P.facts.some((f) => f.id === id) || P.entities.some((x) => x.key === id));
const sig = (P, n) => P.context.signals.find((s) => s.name === n);
const val = (P, id) => P.facts.find((f) => f.id === id)?.value;

export function writeRaceFinal(P) {
  const S = [];
  const para = (...xs) => xs.filter(Boolean).join(' ');
  const close = sig(P, 'close_finish'), dom = sig(P, 'dominant_finish'), fromGrid = sig(P, 'won_from_grid');
  const first = sig(P, 'first_career_win');

  // ---- headline / dek ----
  let headline;
  if (first) headline = '{e:p1} takes a first Grand Prix win at the {f:event}';
  else if (close && has(P, 'margin')) headline = '{e:p1} wins the {f:event} by {f:margin}';
  else if (fromGrid) headline = '{e:p1} wins the {f:event} from {f:p1_grid}';
  else headline = '{e:p1} wins the {f:event} for {e:p1_team}';
  const dek = para(
    has(P, 'p2') ? `{s:p1} finished ahead of {e:p2}${has(P, 'p3') ? ' and {e:p3}' : ''}${has(P, 'margin') ? ', with a winning margin of {f:margin}' : ''}.` : null,
    has(P, 'leader', 'leader_margin') ? (val(P, 'p1_champ_pos') === 1 ? '{s:p1} leads the championship by {f:leader_margin}.' : '{e:leader} still leads the championship by {f:leader_margin}.') : null,
  );

  // ---- lede ----
  S.push({ heading: '', paragraphs: [
    para(
      `{e:p1} won the {f:event} for {e:p1_team}${has(P, 'p1_grid') ? ' from {f:p1_grid}' : ''}.`,
      val(P, 'p1_career_wins') === val(P, 'p1_season_wins') && val(P, 'p1_career_wins') > 1 ? 'It is the {f:p1_career_wins} for {s:p1} in our archive, all of them this season.' : first ? null : 'It is the {f:p1_career_wins} for {s:p1} in our archive and the {f:p1_season_wins}.',
    ),
    has(P, 'p2') ? para(
      `{e:p2} finished {f:p2_finish}${has(P, 'margin') ? ', {f:margin} behind,' : ''}${has(P, 'p2_grid') ? ' after starting {f:p2_grid}' : ''}.`,
      has(P, 'p3') ? `{e:p3} completed the {f:event} podium${has(P, 'p3_grid') ? ' from {f:p3_grid}' : ''}.` : null,
      sig(P, 'team_one_two') ? pick(P, 'onetwo', ['{e:p1_team} left {e:circuit} with a one-two finish.', 'The one-two at {e:circuit} belonged to {e:p1_team}.']) : null,
    ) : null,
  ].filter(Boolean) });

  // ---- how the race turned (classification-level, never invented order changes) ----
  const turned = [];
  if (sig(P, 'pole_to_win')) turned.push(pick(P, 'pole', ['{s:p1} turned pole position at {e:circuit} into the win.', 'From pole, {s:p1} converted at {e:circuit}.', '{s:p1} started {f:round} from pole position and finished it in front.']));
  else if (fromGrid) turned.push(grid1q(P, 'p1') ? '{s:p1} qualified {f:p1_quali}, started {f:p1_grid} and finished {f:p1_finish}.' : '{s:p1} started {f:p1_grid} and finished {f:p1_finish}.');
  if (has(P, 'pole', 'pole_result')) turned.push(sig(P, 'pole_sitter_off_podium') ? 'Pole-sitter {e:pole} was classified {f:pole_result}.' : 'Pole-sitter {e:pole} finished {f:pole_result}.');
  if (has(P, 'p2_grid') && val(P, 'p2_grid') > val(P, 'p2_finish') + 2) turned.push(grid1q(P, 'p2') ? '{s:p2} qualified {f:p2_quali}, started {f:p2_grid} and finished {f:p2_finish}.' : '{s:p2} made up ground from {f:p2_grid} to {f:p2_finish}.');
  if (has(P, 'climber', 'climber_gain')) turned.push('The biggest gain in the field belonged to {e:climber}, up {f:climber_gain} from {f:climber_grid} to {f:climber_finish}.');
  if (has(P, 'p1_stops')) turned.push('{s:p1} made {f:p1_stops}.');
  if (has(P, 'retirements')) {
    const n = val(P, 'retirements');
    const names = P.entities.filter((x) => /^dnf\d+$/.test(x.key)).map((x) => `{e:${x.key}}`);
    if (n === 0) turned.push('Every starter was classified.');
    else if (names.length) turned.push(`The race had {f:retirements}: ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`}.`);
  }
  if (has(P, 'fl_driver', 'fl_time')) turned.push(P.entities.find((x) => x.key === 'fl_driver')?.ref === P.entities.find((x) => x.key === 'p1')?.ref ? `{s:p1} also set the fastest lap, {f:fl_time}${has(P, 'fl_lap') ? ' on {f:fl_lap}' : ''}.` : `{e:fl_driver} set the fastest lap, {f:fl_time}${has(P, 'fl_lap') ? ' on {f:fl_lap}' : ''}.`);
  S.push({ heading: 'How the race turned', paragraphs: chunk(turned, 3) });

  // ---- the decisive data ----
  const data = [];
  if (has(P, 'pole_time', 'pole_gap', 'q2')) data.push('In qualifying, {s:p1} took pole with {f:pole_time}, {f:pole_gap} clear of {e:q2}.');
  if (has(P, 'margin', 'p2')) data.push(close ? 'At the flag {s:p2} was only {f:margin} behind.' : 'At the flag {s:p2} was {f:margin} behind.');
  if (has(P, 'p1_time')) data.push('{s:p1} covered {f:p1_laps} in {f:p1_time}.');
  if (has(P, 'circuit_pole_win')) data.push(sig(P, 'consistent_with_circuit_pole') ? 'A win from pole fits {e:circuit}: pole has converted {f:circuit_pole_win} of the time in the Circuit DNA sample.' : sig(P, 'against_circuit_pole_trend') ? 'Winning from {f:p1_grid} runs against the profile of {e:circuit}, where pole has converted {f:circuit_pole_win} of the time in the Circuit DNA sample.' : 'At {e:circuit}, pole has converted {f:circuit_pole_win} of the time in the Circuit DNA sample.');
  if (data.length) S.push({ heading: 'The decisive data', paragraphs: chunk(data, 3) });

  // ---- the profile behind it ----
  const prof = [];
  if (has(P, 'p1_dna_top', 'p1_dna_top_label')) {
    const quali = /qualifying/i.test(String(val(P, 'p1_dna_top_label')));
    prof.push(quali && sig(P, 'pole_to_win') ? 'A pole-to-win weekend at {e:circuit} is consistent with the profile Driver DNA draws of {s:p1}: {f:p1_dna_top_label} is the strongest dimension, at the {f:p1_dna_top} in the {f:dna_window} window.' : pick(P, 'dna', ['Winning from {f:p1_grid} at {e:circuit} sits alongside a Driver DNA profile led by {f:p1_dna_top_label}, at the {f:p1_dna_top} in the {f:dna_window} window.', 'Driver DNA ({f:dna_window} window) rates {f:p1_dna_top_label} as the strongest dimension for {s:p1}, at the {f:p1_dna_top}; the {f:event} result came from {f:p1_grid}.']));
  }
  if (has(P, 'p1_team_quali_dna')) prof.push(pick(P, 'cdna', ['In Constructor DNA, {e:p1_team} sit at the {f:p1_team_quali_dna} for Qualifying Speed this season, the car side of the {f:event} result.', 'The car behind the {f:event} win ranks at the {f:p1_team_quali_dna} for Qualifying Speed in Constructor DNA this season.']));
  if (has(P, 'p1_mate', 'p1_mate_result')) {
    const h = String(val(P, 'mate_race_h2h') || '').split('-').map(Number);
    prof.push(`Teammate {e:p1_mate} finished {f:p1_mate_result}.${has(P, 'mate_race_h2h') ? ` In races where both were classified, their head-to-head as teammates reads {f:mate_race_h2h}${h[0] > h[1] ? ' in favour of {s:p1}' : h[0] < h[1] ? ' in favour of {s:p1_mate}' : ', level'}; the full comparison is on the {e:matchup} page.` : ''}`);
  }
  if (has(P, 'circuit_prior_wins')) prof.push(val(P, 'circuit_prior_wins') === 0 ? 'It is the first win for {s:p1} at {e:circuit} in our archive.' : 'Before this race, {s:p1} had {f:circuit_prior_wins} at {e:circuit}.');
  if (prof.length) S.push({ heading: 'The profile behind it', paragraphs: chunk(prof, 2) });

  // ---- championship effect ----
  if (has(P, 'leader', 'leader_points')) {
    const lead = P.entities.find((x) => x.key === 'leader')?.ref === P.entities.find((x) => x.key === 'p1')?.ref;
    const c = [];
    if (sig(P, 'lead_change')) c.push('{e:leader} takes over the championship lead from {e:prev_leader}, on {f:leader_points}.');
    else c.push(`{e:leader} leads the drivers' championship on {f:leader_points}${has(P, 'leader_margin', 'second') ? ', {f:leader_margin} clear of {e:second}' : ''}.`);
    if (!lead && has(P, 'p1_champ_points', 'p1_champ_pos')) c.push(val(P, 'p1_champ_pos') === val(P, 'p1_champ_pos_before') ? '{s:p1} stays {f:p1_champ_pos} with {f:p1_champ_points}.' : '{s:p1} moves to {f:p1_champ_pos} with {f:p1_champ_points}.');
    if (has(P, 'con_leader', 'con_leader_points')) c.push("{e:con_leader} lead the constructors' standings on {f:con_leader_points}.");
    S.push({ heading: 'Championship effect', paragraphs: [para(...c)], module: P.charts.includes('championship') ? 'championship' : null });
  }

  // ---- result + grid/finish ----
  S.push({ heading: 'The result', paragraphs: [`The full classification for the {f:event}, {f:round} of the season, is below and on the {e:race} page.`], module: 'classification' });
  if (P.charts.includes('grid_finish')) S.push({ heading: 'Grid to finish', paragraphs: ['Each line joins a points finisher\'s starting slot to the finishing position.'], module: 'grid_finish' });
  if (P.context.replay) S.push({ heading: 'Replay the race', paragraphs: ['PBEcast replays this race from the timing observations we recorded during the session.'], module: 'pbecast' });

  // ---- what's next ----
  if (has(P, 'next', 'next_date')) S.push({ heading: "What's next", paragraphs: ['The championship moves on to the {e:next}, which starts on {f:next_date}.'] });

  return {
    headline,
    dek,
    sections: S,
    seo_title: has(P, 'margin') && close ? '{s:p1} wins {f:event} by {f:margin}' : '{s:p1} wins the {f:event}',
    seo_description: `{e:p1} won the {f:event} for {e:p1_team}${has(P, 'p2') ? ' ahead of {e:p2}' : ''}. Result, championship effect and the data behind it.`,
    social_headline: headline,
    link_intents: P.entities.filter((x) => ['p1', 'p2', 'p3', 'p1_team', 'circuit', 'race', 'matchup', 'next', 'leader'].includes(x.key)).map((x) => x.key),
  };
}

const grid1q = (P, k) => P.context.signals.some((s) => s.name === 'grid_differs_from_quali' && s.who === k) && has(P, `${k}_quali`);

const pick = (P, key, variants) => { let h = 0; for (const c of P.hash + key) h = (h * 31 + c.charCodeAt(0)) >>> 0; return variants[h % variants.length]; };

function chunk(xs, n) {
  const out = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n).join(' '));
  return out;
}
