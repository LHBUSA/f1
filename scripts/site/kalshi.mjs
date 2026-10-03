// Kalshi Market Intelligence mount points (owner approved 2026-10-03). The static build only decides WHERE a market may
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

const OPEN = (s) => s && s.type === 'race' && !['completed', 'canceled', 'cancelled'].includes(s.state);

/** Race page mount: present only while the main race is not completed. An empty element (no box, no reserved space). */
export function kalshiRaceMount(eventSlug, raceSession) {
  if (!OPEN(raceSession)) return '';
  const id = raceMarketId(eventSlug, raceSession);
  if (!id) return '';
  return `<div class="kx-mount" data-kalshi-race="${esc(id)}"${raceSession.start_utc ? ` data-kalshi-start="${esc(raceSession.start_utc)}"` : ''}></div>`;
}

/** PBEcast strip mount (leaders), same main-race market. */
export function kalshiStripMount(eventSlug, raceSession) {
  if (!OPEN(raceSession)) return '';
  const id = raceMarketId(eventSlug, raceSession);
  if (!id) return '';
  return `<div class="kx-mount pc-kalshi wrap" data-kalshi-strip="${esc(id)}"${raceSession.start_utc ? ` data-kalshi-start="${esc(raceSession.start_utc)}"` : ''}></div>`;
}
