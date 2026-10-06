// PropBetEdge All Access on F1 Intelligence: the commercial facts and the account view, in one place.
//
// The commercial facts are the canonical shared membership contract's (LHBUSA/propbetedge-workers
// shared/membership/pbe-membership.js, CONTRACT 1.4.0 ALL_ACCESS_OFFER / MANAGE_URL), pinned by tests/all-access.test.mjs.
// The network list is the vendored canonical family registry (src/core/family.json, byte-identical copy of
// propbetedge-workers shared/network/family.json). Nothing here decides access: the view is derived from the server's
// verdict (GET /pbe/f1/membership → f1-api → auth-magic /membership?sport=f1).
//
// Three link jobs, three constants (owner decisions 2026-10-05):
//   LOCAL_ALL_ACCESS_PATH    the native /all-access page on this site (informational links)
//   NETWORK_ALL_ACCESS_URL   propbetedge.ai/pro, reference only
//   ALL_ACCESS_CHECKOUT_URL  the canonical All Access Stripe Payment Link (explicit purchase buttons only)
import family from './family.json' with { type: 'json' };

export const LOCAL_ALL_ACCESS_PATH = '/all-access';
export const NETWORK_ALL_ACCESS_URL = 'https://propbetedge.ai/pro';
export const ALL_ACCESS_CHECKOUT_URL = 'https://buy.stripe.com/8x2eVdgmOaqy4pv8Ez7wA0N';
export const MANAGE_URL = 'https://billing.stripe.com/p/login/cNi3cv2vY7em3lr4oj7wA00';
export const PRICE = '$29/month';
export const PROMO_LINE = '25% off while active with code THEEDGE25';
export const PRODUCT = 'PropBetEdge All Access';
export const OFFER_LINE = '10 sports + PropBetEdge Predictions';
export const PLATINUM_TRUTH = 'PropBetEdge All Access · 10 sports + Predictions';
export const SIGNIN_ENDPOINT = 'https://auth.propbetedge.ai/magic/request';

export const FAMILY = family;
export const SPORTS = family.sports;
export const PREDICTIONS = family.products.find((p) => p.key === 'predictions');
/** Display name: F1 is "F1 Intelligence" (no Formula 1 affiliation implied); every other sport uses its label. */
export const sportName = (s) => (s.key === 'f1' ? s.name : s.label);

/** What All Access adds on F1 today: exactly what f1-api gates server-side. Everything else on the site is free. */
export const F1_ALL_ACCESS = Object.freeze([
  { key: 'tower', label: 'Full timing tower', sub: 'Gaps, intervals, pit stops, best laps' },
  { key: 'feed', label: 'Full live feed', sub: 'Every recorded update in a session' },
  { key: 'replay', label: 'Session replay', sub: 'Scrubber, 0.5×–4×, lap jumps' },
  { key: 'graph', label: 'Position graph', sub: 'Every driver, lap by lap' },
]);
export const F1_FREE = Object.freeze(['Live track map + timing order', 'Race state & incidents', 'Races, standings, drivers, teams', 'Circuits, matchups, Driver DNA', 'Intelligence & news']);

export { accountView, ACCOUNT_LABEL } from './account-view.mjs';
