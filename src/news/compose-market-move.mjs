// Narrative composer for MARKET MOVES. Built only from the frozen packet: two stored price observations, the field at
// the latest one, and our own data on the driver. It reports the move and never explains it; it never uses betting
// vocabulary, never names a favourite and never predicts. Tokens: {f:id} fact, {e:key} link, {s:key} surname.
export const MARKET_MOVE_COMPOSER_VERSION = 'f1-compose-market-move@1.0.0';

export function composeMarketMove(P) {
  const has = (...ids) => ids.every((id) => P.facts.some((f) => f.id === id) || P.entities.some((x) => x.key === id));
  const v = (id) => P.facts.find((f) => f.id === id)?.value;
  const sig = (n) => P.context.signals.some((s) => s.name === n);
  const join = (...xs) => xs.filter(Boolean).join(' ');
  const S = [];
  const section = (heading, paragraphs, extra = {}) => { const ps = paragraphs.filter(Boolean); if (ps.length || extra.module) S.push({ heading, paragraphs: ps, ...extra }); };
  const up = sig('price_up');

  // ---------- lede ----------
  section('', [
    join(
      `On {e:venue}, the contract on {e:mover} winning the {f:event} ${up ? 'rose' : 'fell'} from {f:mv_first} to {f:mv_now} between {f:mv_first_at} and {f:mv_now_at}, a move of {f:mv_delta}.`,
      'At the latest observation it was {f:mv_rank}.',
    ),
    join(
      'Both prices are mid-market quotes read and stored by the PropSports markets lane. The first is the earliest reading our lane holds for this contract, which is not necessarily the moment the market opened.',
      'Qualifying is on {f:quali_date} and the race on {f:race_date}.',
    ),
  ]);

  // ---------- the field ----------
  const field = P.entities.filter((x) => /^mk\d$/.test(x.key) && has(`${x.key}_now`)).map((x) => `{e:${x.key}} at {f:${x.key}_now}`);
  if (field.length >= 2) section('The rest of the field', [
    join(
      `At the same reading the other leading contracts were ${field.slice(0, -1).join(', ')} and ${field.at(-1)}.`,
      'Each price is what the market charged for a contract that pays out only if that driver wins the main race; it moves with trading on the venue.',
    ),
    'A market price is not a PropBetEdge pick and not a forecast from our models. The desk writes a market story only when a contract moves by at least {f:mv_threshold} across at least {f:mv_window} of our own readings; reporting the move carries no view on the result.',
  ]);

  // ---------- our data on the driver ----------
  const data = [];
  if (has('form_window', 'mover_fpts', 'mover_ffin')) data.push('In {f:form_window}, {s:mover} scored {f:mover_fpts} with {f:mover_fwins} and {f:mover_fpods}, finishing {f:mover_ffin}.');
  if (sig('mover_leads_championship') && has('leader_points', 'c2_gap', 'c2')) data.push("{s:mover} goes into the round leading the drivers' championship on {f:leader_points}, {f:c2_gap} clear of {e:c2}.");
  else if (has('mover_champ_pos', 'mover_champ_pts', 'leader', 'leader_points')) data.push("{s:mover} goes into the round {f:mover_champ_pos} in the drivers' championship on {f:mover_champ_pts}, with {e:leader} on top at {f:leader_points}.");
  if (has('rounds_left', 'max_left')) data.push('Including this one, {f:rounds_left} remain, worth up to {f:max_left} to any one driver.');
  if (has('mover_team')) data.push('The {e:mover} profile carries Driver DNA and career results, and the {e:mover_team} page the car and Constructor DNA.');
  section('What our data says', [data.join(' ')].filter(Boolean));

  // ---------- circuit ----------
  const rec = [];
  if (has('held', 'arch_pole_wins', 'arch_front_row')) rec.push(join(
    'In our archive {e:circuit} had hosted {f:held}. Of the classified editions, {f:arch_pole_wins} were won from pole and {f:arch_front_row} from the front row.',
    has('last_winner', 'last_race') ? 'The previous edition, the {e:last_race}, went to {e:last_winner} from {f:last_winner_grid}.' : null,
    has('mover_here_wins') ? (v('mover_here_wins') === 0 ? '{s:mover} has not won here in our archive.' : '{s:mover} has {f:mover_here_wins} here in our archive.') : null,
  ));
  section("The circuit's record", rec);

  // ---------- limits ----------
  section('What the move does not tell us', [
    'The price path records trading, not a reason. PropSports stores what the market showed and when; it does not attach a cause to a move, and neither does this story. No team, driver or official statement is reported here.',
    'The weekend itself starts to answer the question the market is trading on. Qualifying is the first classification of the weekend, and the {e:race} page and {e:page_pbecast} follow every session.',
  ]);

  section('Follow the weekend', [
    'The {e:page_standings} page has the full table, the {e:page_form} has recent results for every driver, and {e:page_intel} sets out the DNA view of the grid.',
  ]);

  const headline = `{e:mover}'s {f:event} price ${up ? 'rises' : 'falls'} from {f:mv_first} to {f:mv_now}`;
  return {
    headline,
    dek: 'The {e:venue} contract on {s:mover} winning the {f:event} moved {f:mv_delta} between {f:mv_first_at} and {f:mv_now_at}.',
    sections: S,
    seo_title: '{s:mover} {f:event} market: {f:mv_first} to {f:mv_now}',
    seo_description: 'The race-winner contract on {e:mover} for the {f:event} moved {f:mv_delta} on {e:venue}: the stored prices, the field and our data on the driver.',
    social_headline: headline,
    composer: MARKET_MOVE_COMPOSER_VERSION,
  };
}
