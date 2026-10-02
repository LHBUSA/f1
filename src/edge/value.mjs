// PBE F1 EDGE value engine: compares a frozen model probability with a quoted price. Pure; no odds data here.
import { fairPrice, impliedProbability } from './market.mjs';

/**
 * pbe_probability: model probability for `selection`.
 * quote: normalized quote for `selection` (or null = unpriced).
 * market_novig: no-vig probability for `selection` (single book de-vig or consensus), or null.
 */
export function valuate({ pbe_probability, quote = null, market_novig = null }) {
  const fair = fairPrice(pbe_probability);
  const out = { pbe_probability, fair_decimal: fair.decimal, fair_american: fair.american, priced: !!quote };
  if (!quote) return { ...out, market_raw_implied: null, market_novig, edge_pp: null, edge_pp_vs_raw: null, ev_per_unit: null };
  const raw = impliedProbability(quote.decimal_odds);
  return {
    ...out,
    offered_decimal: quote.decimal_odds,
    offered_american: quote.american_odds,
    market_raw_implied: raw,
    market_novig,
    edge_pp: market_novig == null ? null : (pbe_probability - market_novig) * 100,
    edge_pp_vs_raw: (pbe_probability - raw) * 100,
    ev_per_unit: pbe_probability * quote.decimal_odds - 1,
  };
}
