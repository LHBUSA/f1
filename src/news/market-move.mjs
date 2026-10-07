// MARKET MOVE packet: a material move in the Kalshi main-race winner market for the NEXT Grand Prix, as stored by the
// PropSports markets lane (market-tape/1: first observation, latest observation, both timestamped). The story reports the
// prices and when we observed them, then sets the moving driver against our own data (form, championship, circuit
// archive). It never explains WHY a price moved (no rumour, no attribution), never calls anyone a favourite and never
// predicts. The packet is built ONCE, at first publication, and carried forward unchanged from the published record.
import { Packet, pts } from './packet.mjs';
import { addStakes, addArchive, addForm, addPages } from './context.mjs';
import { temporalFrame, venueDay } from './temporal.mjs';

export const MARKET_MOVE_VERSION = 'f1-market-move@1.0.0';
// materiality: an absolute move of at least 8¢ on a $1 contract, measured over at least 24h of our own observations,
// on an open two-sided market read within the last hour
export const MARKET_RULES = { min_move_bp: 800, min_window_ms: 24 * 3600e3, max_age_ms: 3600e3, top_n: 5 };
const cents = (bp) => `${(bp / 100).toFixed(bp % 100 ? 1 : 0)}¢`;
const stamp = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }) + ' UTC';

/** The tape entry for an event's main-race winner market, or null. */
export const tapeEntryFor = (tape, eventId) => Object.values(tape?.classes || {}).flat().find((e) => e?.sport === 'f1' && e.canonical_event_id === `${eventId}-race`) || null;

/** The single most material outcome move in a tape entry, or { reason } when nothing qualifies. Pure. */
export function materialMove(entry, now, rules = MARKET_RULES) {
  if (!entry) return { reason: 'no_market' };
  if (entry.venue !== 'kalshi' || entry.lifecycle !== 'UPCOMING' || entry.event_state !== 'pre') return { reason: `market_not_upcoming:${entry.lifecycle || '?'}` };
  if (entry.freshness !== 'live' || !entry.observed_at || Date.parse(now) - Date.parse(entry.observed_at) > rules.max_age_ms) return { reason: 'market_read_not_fresh' };
  // the field = every open contract with a current price; a move needs a first price too
  const priced = (entry.outcomes || []).filter((o) => o.state === 'open' && /^p:[a-z0-9-]+$/.test(o.role || '') && Number.isFinite(o.price_bp));
  const outs = priced.filter((o) => Number.isFinite(o.first_bp) && o.first_observed_at);
  const moves = outs.filter((o) => Date.parse(entry.observed_at) - Date.parse(o.first_observed_at) >= rules.min_window_ms && Math.abs(o.price_bp - o.first_bp) >= rules.min_move_bp)
    .sort((a, b) => Math.abs(b.price_bp - b.first_bp) - Math.abs(a.price_bp - a.first_bp) || a.role.localeCompare(b.role));
  if (!moves.length) return { reason: outs.some((o) => Math.abs(o.price_bp - o.first_bp) >= rules.min_move_bp) ? 'window_under_24h' : 'below_threshold' };
  return { move: moves[0], field: priced.slice().sort((a, b) => b.price_bp - a.price_bp || a.role.localeCompare(b.role)) };
}

export function marketMovePacket(X, eventId, entry, { asOf = new Date().toISOString(), publishedAt = asOf } = {}) {
  const ev = X.event[eventId];
  if (!ev || ev.status === 'canceled') return { ok: false, reason: 'unknown_or_canceled' };
  const race = X.session(eventId, 'race'), q = X.session(eventId, 'qualifying');
  if (!race?.start_utc || !q?.start_utc) return { ok: false, reason: 'no_sessions' };
  // a pre-weekend story: never first-published once qualifying has started
  if (Date.parse(q.start_utc) <= Date.parse(asOf)) return { ok: false, reason: 'qualifying_started' };
  const m = materialMove(entry, asOf);
  if (!m.move) return { ok: false, reason: m.reason };
  const id = m.move.role.slice(2), d = X.driver[id];
  if (!d) return { ok: false, reason: 'unmapped_driver' };
  const D = (x) => X.driver[x], C = (x) => X.con[x];
  const P = new Packet('market_move', `market_move:${eventId}`, { event_id: eventId, as_of: asOf });
  P.context.version = MARKET_MOVE_VERSION;
  P.context.valid_until = q.start_utc;
  const title = `${ev.season} ${ev.name}`;
  P.fact('event', title, title, 'Event', 'projection: events');
  P.entity('race', 'race', ev.id, title);
  P.fact('round', ev.round, `round ${ev.round}`, 'Championship round', 'projection: events');
  P.fact('race_date', race.start_utc, venueDay(race.start_utc, ev.circuit_id), 'Race date (venue-local calendar day)', 'projection: sessions');
  P.fact('quali_date', q.start_utc, venueDay(q.start_utc, ev.circuit_id), 'Qualifying date (venue-local calendar day)', 'projection: sessions');
  const circ = X.circuit[ev.circuit_id];
  if (circ) P.entity('circuit', 'circuit', circ.id, circ.name);
  P.entity('venue', 'source', 'kalshi', 'Kalshi');

  // ---- the move (stored observations only) ----
  const src = `market-tape/1: Kalshi ${entry.source_event_id || 'race winner'} (PropSports markets lane)`;
  const up = m.move.price_bp > m.move.first_bp;
  P.entity('mover', 'driver', id, d.name);
  if (C(d.team_id)) P.entity('mover_team', 'team', d.team_id, C(d.team_id).name);
  P.fact('mv_first', m.move.first_bp, cents(m.move.first_bp), `${d.name} contract price at first observation (mid-market)`, src);
  P.fact('mv_first_at', m.move.first_observed_at, stamp(m.move.first_observed_at), 'First observation of this contract', src);
  P.fact('mv_now', m.move.price_bp, cents(m.move.price_bp), `${d.name} contract price at the latest observation (mid-market)`, src);
  P.fact('mv_now_at', entry.observed_at, stamp(entry.observed_at), 'Latest observation used in this story', src);
  P.derive('mv_delta', Math.abs(m.move.price_bp - m.move.first_bp), cents(Math.abs(m.move.price_bp - m.move.first_bp)), `Move since first observation (${up ? 'up' : 'down'})`, { from: ['mv_first', 'mv_now'], rule: 'latest minus first' });
  P.signal(up ? 'price_up' : 'price_down');
  P.fact('mv_threshold', MARKET_RULES.min_move_bp, cents(MARKET_RULES.min_move_bp), 'Materiality threshold for a market story (absolute move)', 'PropBetEdge newsroom rule');
  P.fact('mv_window', MARKET_RULES.min_window_ms, `${MARKET_RULES.min_window_ms / 3600e3} hours`, 'Minimum span of our own observations behind a market story', 'PropBetEdge newsroom rule');
  const rank = m.field.findIndex((o) => o.role === m.move.role) + 1;
  P.fact('mv_rank', rank, rank === 1 ? 'the highest price in the field' : `the ${['', '', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'][rank] || `number ${rank}`}-highest price in the field`, 'Rank of the contract by latest price', src);
  // the top of the field at the latest observation (names + prices; never called favourites)
  m.field.slice(0, MARKET_RULES.top_n).forEach((o, i) => {
    const oid = o.role.slice(2);
    if (!D(oid) || oid === id) return;
    P.entity(`mk${i + 1}`, 'driver', oid, D(oid).name);
    P.fact(`mk${i + 1}_now`, o.price_bp, cents(o.price_bp), `${D(oid).name} contract price at the latest observation`, src);
  });
  P.context.market = { source_event_id: entry.source_event_id || null, canonical_event_id: entry.canonical_event_id, observed_at: entry.observed_at, rules: MARKET_RULES };

  // ---- our own data on the moving driver ----
  const st = addStakes(P, X, ev, { after: false });
  if (st) {
    const row = st.table.find((x) => x.id === id);
    if (row && st.table[0].id !== id) { P.fact('mover_champ_pos', row.pos, ['', '1st', '2nd', '3rd'][row.pos] || `${row.pos}th`, `${d.name} championship position going into the round`, 'projection: standings progression'); P.fact('mover_champ_pts', row.p, pts(row.p), `${d.name} championship points going into the round`, 'projection: standings progression'); }
    if (st.table[0].id === id) P.signal('mover_leads_championship');
  }
  P.entity('mover_driver', 'driver', id, d.name);
  addForm(P, X, ev.season, race.start_utc, ['mover']);
  const arch = addArchive(P, X, ev.circuit_id, race.start_utc);
  if (arch) {
    const wonHere = arch.dW[id] || 0;
    P.fact('mover_here_wins', wonHere, wonHere === 0 ? 'no wins' : wonHere === 1 ? 'one win' : `${wonHere} wins`, `${d.name} wins at this circuit before this race (our archive)`, 'derived: our race archive');
  }
  P.context.temporal = temporalFrame(X, eventId, 'market_move', publishedAt);
  addPages(P, ev.season, ev.id);
  P.limit('Prices are Kalshi mid-market quotes for a contract that pays $1 if the driver wins the main race, as observed and stored by the PropSports markets lane. First observation is when our lane first read the contract, not when the market opened.');
  P.limit('This story reports how the price moved; it does not say why. Prediction-market prices are not PropBetEdge picks or forecasts.');
  return { ok: true, packet: P.freeze() };
}
