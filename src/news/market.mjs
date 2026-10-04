// Article market link (shared contract article-market/1, propbetedge-workers docs/POST_EVENT_MARKET_RESULT.md).
// A newsroom story about a Grand Prix weekend is linked to exactly ONE canonical market event: the MAIN race-winner
// market `<event id>-race` (the id the PropSports markets lane / market_event_registry uses for F1, proposition
// driver_wins_race). Never a sprint, never the championship, never a title match. The link and the story's focus
// drivers (canonical f1-api driver ids from the packet's entities) are stored on the article record at first
// publication and carried forward unchanged.
//
// Eligibility is prospective only: a story first published before the network activation time never shows the module
// (no backfill, ever). The shared API is the authority; this constant only avoids a pointless request.
export const ARTICLE_MARKET_ACTIVATED_AT = '2026-10-04T14:31:40Z';
export const ARTICLE_MARKET_SPORT = 'f1';
const RACE_MARKET_ID = /^\d{4}-[a-z0-9-]+-race$/;
export const isRaceMarketId = (id) => typeof id === 'string' && RACE_MARKET_ID.test(id) && !/-sprint(?:-[a-z]+)?-race$/.test(id) && !/championship/.test(id);
// story subjects that are drivers (podium, pole/front row, championship leader/contender, form driver, circuit-fit leader)
const FOCUS_KEYS = ['p1', 'p2', 'p3', 'pole', 'q1', 'q2', 'q3', 'leader', 'c2', 'hot', 'fit1'];
const MAX_FOCUS = 8;

/** The market link for a story about `eventId`, or null when the weekend has no main race to price. */
export function marketLink(X, eventId, packet) {
  const race = X.session(eventId, 'race');
  if (!race || race.type !== 'race' || ['canceled', 'cancelled'].includes(race.state)) return null;
  const id = `${eventId}-race`;
  if (!isRaceMarketId(id)) return null;
  const focus = [];
  for (const k of FOCUS_KEYS) {
    const e = (packet?.entities || []).find((x) => x.key === k && x.type === 'driver' && /^[a-z0-9-]+$/.test(x.ref || ''));
    if (e && !focus.includes(e.ref)) focus.push(e.ref);
  }
  return { contract: 'article-market/1', sport: ARTICLE_MARKET_SPORT, canonical_event_id: id, proposition: 'driver_wins_race', focus: focus.slice(0, MAX_FOCUS) };
}

/** The canonical market event id of an article that may carry the module, else null (pre-activation / unlinked). */
export function articleMarketEvent(a) {
  const pub = Date.parse(a?.published_at || '');
  if (!Number.isFinite(pub) || pub < Date.parse(ARTICLE_MARKET_ACTIVATED_AT)) return null;
  const id = a?.market?.canonical_event_id;
  return a?.market?.sport === ARTICLE_MARKET_SPORT && isRaceMarketId(id) ? id : null;
}
