// PBE F1 EDGE market layer (provider-agnostic, NO odds data in this repo).
//
// Canonical quote schema, price conversion, two-way de-vig and a transparent consensus. A consensus only uses books
// that quote BOTH sides of the IDENTICAL proposition (same canonical event, market, line, selection pair) — never a
// one-sided price, never mixed lines. Sportsbook prices are outputs for the value engine, never model features.

export const QUOTE_FIELDS = Object.freeze([
  'provider', 'sportsbook', 'provider_event_id', 'canonical_event_id', 'market', 'selection', 'opponent', 'line',
  'american_odds', 'decimal_odds', 'provider_updated_at', 'captured_at', 'source_id',
]);
const REQUIRED = ['provider', 'sportsbook', 'canonical_event_id', 'market', 'selection', 'captured_at', 'source_id'];

export function americanToDecimal(a) {
  if (!Number.isFinite(a) || (a > -100 && a < 100)) throw new Error(`invalid american odds: ${a}`);
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}
export function decimalToAmerican(d) {
  if (!Number.isFinite(d) || d <= 1) throw new Error(`invalid decimal odds: ${d}`);
  return d >= 2 ? (d - 1) * 100 : -100 / (d - 1);
}
export const impliedProbability = (decimal) => 1 / decimal;
export function fairPrice(p) {
  if (!(p > 0 && p < 1)) throw new Error(`probability out of range: ${p}`);
  const decimal = 1 / p;
  return { decimal, american: decimalToAmerican(decimal) };
}

const isIso = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s));

/** Validate + complete a quote. Exactly one of american/decimal may be given; if both, they must agree. */
export function normalizeQuote(q) {
  for (const k of REQUIRED) if (q[k] == null || q[k] === '') throw new Error(`quote missing ${k}`);
  if (!isIso(q.captured_at)) throw new Error('captured_at must be ISO-8601');
  if (q.provider_updated_at != null && !isIso(q.provider_updated_at)) throw new Error('provider_updated_at must be ISO-8601');
  let dec = q.decimal_odds ?? null;
  let am = q.american_odds ?? null;
  if (dec == null && am == null) throw new Error('quote has no price');
  if (dec == null) dec = americanToDecimal(am);
  if (am == null) am = decimalToAmerican(dec);
  if (Math.abs(americanToDecimal(am) - dec) > 0.005) throw new Error('american and decimal odds disagree');
  const out = {};
  for (const k of QUOTE_FIELDS) out[k] = q[k] ?? null;
  out.decimal_odds = dec;
  out.american_odds = am;
  return Object.freeze(out);
}

/** Identity of a two-way proposition, independent of which side a quote is for. */
export function propositionKey(q) {
  const sides = [q.selection, q.opponent].map(String).sort();
  return [q.canonical_event_id, q.market, q.line ?? '', ...sides].join('|');
}

/** Two-way de-vig (multiplicative / proportional). Both quotes must be the same book and identical proposition. */
export function devigTwoWay(qa, qb) {
  if (qa.sportsbook !== qb.sportsbook) throw new Error('de-vig needs both sides from the same sportsbook');
  if (propositionKey(qa) !== propositionKey(qb) || qa.selection !== qb.opponent || qa.opponent !== qb.selection) throw new Error('quotes are not the two sides of one proposition');
  const ra = impliedProbability(qa.decimal_odds);
  const rb = impliedProbability(qb.decimal_odds);
  const s = ra + rb;
  return { sportsbook: qa.sportsbook, raw_implied_a: ra, raw_implied_b: rb, overround: s - 1, novig_a: ra / s, novig_b: rb / s, method: 'multiplicative' };
}

/**
 * Transparent consensus for `selection` vs `opponent`: per book, take the latest quote for each side (by captured_at,
 * ties by source_id); books missing a side are listed as excluded. Consensus = simple mean of per-book no-vig
 * probabilities. Returns null probability if no book quotes both sides.
 */
export function consensus(quotes, { canonical_event_id, market, selection, opponent, line = null }) {
  const key = propositionKey({ canonical_event_id, market, line, selection, opponent });
  const books = new Map();
  for (const q of quotes) {
    if (propositionKey(q) !== key) continue;
    const side = q.selection === selection ? 'a' : q.selection === opponent ? 'b' : null;
    if (!side) continue;
    const b = books.get(q.sportsbook) || books.set(q.sportsbook, {}).get(q.sportsbook);
    const prev = b[side];
    if (!prev || q.captured_at > prev.captured_at || (q.captured_at === prev.captured_at && q.source_id > prev.source_id)) b[side] = q;
  }
  const used = [];
  const excluded = [];
  for (const name of [...books.keys()].sort()) {
    const b = books.get(name);
    if (!b.a || !b.b) { excluded.push({ sportsbook: name, reason: `missing ${!b.a ? selection : opponent} side` }); continue; }
    used.push({ ...devigTwoWay(b.a, b.b), quote_a: b.a.source_id, quote_b: b.b.source_id });
  }
  const p = used.length ? used.reduce((s, u) => s + u.novig_a, 0) / used.length : null;
  return { proposition: key, selection, opponent, consensus_novig: p, books_used: used, books_excluded: excluded, method: 'mean of per-book multiplicative no-vig probabilities' };
}
