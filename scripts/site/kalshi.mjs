// Kalshi Market Intelligence mount points (owner approved 2026-10-03; market history 2026-10-03). The static build only decides WHERE a market may
// appear; prices are never baked into the page. src/web/kalshi.js fetches them client-side from the PropSports markets
// API and renders nothing when there is no market.
//
// The only F1 market attached anywhere is proposition `driver_wins_race`: the driver finishing first in the MAIN race.
// Its canonical id is `<event slug>-race`. It is never attached to a sprint, sprint qualifying or championship view.
import { esc } from './lib.mjs';

const RACE_MARKET_ID = /^\d{4}-[a-z0-9-]+-race$/;
export const isRaceMarketId = (id) => typeof id === 'string' && RACE_MARKET_ID.test(id) && !/-sprint(?:-[a-z]+)?-race$/.test(id) && !/championship/.test(id);

/** Canonical main-race market id for an event, or null when the event has no main race to price. */
export function raceMarketId(eventSlug, raceSession) {
  if (!eventSlug || !raceSession || raceSession.type !== 'race') return null;
  const id = `${eventSlug}-race`;
  return isRaceMarketId(id) ? id : null;
}

// The PropSports F1 market lane first recorded Kalshi markets in October 2026; no earlier race ever had an observed
// market, so completed races before this keep no mount (one pointless request avoided per historical page).
export const MARKET_SINCE = Date.parse('2026-09-01T00:00:00Z');
const CANCELED = ['canceled', 'cancelled'];
const DONE = (s) => s?.state === 'completed';
// Mount while the main race is upcoming/running AND after it completes (market history: "How the market closed").
const MOUNTABLE = (s) => {
  if (!s || s.type !== 'race' || CANCELED.includes(s.state)) return false;
  if (!DONE(s)) return true;
  const t = Date.parse(s.start_utc || '');
  return Number.isFinite(t) && t >= MARKET_SINCE;
};
const attrs = (s) => `${s.start_utc ? ` data-kalshi-start="${esc(s.start_utc)}"` : ''}${DONE(s) ? ' data-kalshi-done="1"' : ''}`;

/** Race page mount: upcoming, live AND completed main races (history once the market closes). An empty element
 *  (no box, no reserved space); prices are fetched client-side, never baked. */
export function kalshiRaceMount(eventSlug, raceSession) {
  if (!MOUNTABLE(raceSession)) return '';
  const id = raceMarketId(eventSlug, raceSession);
  if (!id) return '';
  return `<div class="kx-mount" data-kalshi-race="${esc(id)}"${attrs(raceSession)}></div>`;
}

/** PBEcast mount (leaders strip while trading; market history card with the replay once closed), same main-race market. */
export function kalshiStripMount(eventSlug, raceSession) {
  if (!MOUNTABLE(raceSession)) return '';
  const id = raceMarketId(eventSlug, raceSession);
  if (!id) return '';
  return `<div class="kx-mount pc-kalshi wrap" data-kalshi-strip="${esc(id)}"${attrs(raceSession)}></div>`;
}

/** Result card line (completed main race): compact "MARKET first → before start · settled" from the board. */
export function kalshiCloseMount(eventSlug, raceSession) {
  if (!MOUNTABLE(raceSession) || !DONE(raceSession)) return '';
  const id = raceMarketId(eventSlug, raceSession);
  if (!id) return '';
  return `<p class="kx-mount kx-closeline" data-kalshi-close="${esc(id)}"></p>`;
}
