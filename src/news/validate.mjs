// Publication gates (ported from the Golf desk, F1 vocabulary). A draft passes only when every value resolves to a
// packet fact, every link to a packet entity, and the prose carries no number, URL, name or claim of its own.
export const QUALITY_VERSION = 'f1-gates/1.0.0';
const TOKEN = /\{(f|e|s):([a-z0-9_]+)\}/g;
const BANNED = [
  [/\b(odds|betting|bet|wager|parlay|lock|guarantee[ds]?|sure thing|can'?t miss|value play)\b/i, 'betting_language'],
  [/\b(favou?rite|underdog|will win|is going to win|predict(ed|ion)?|expected to win|should win)\b/i, 'prediction_language'],
  [/\b(injur(y|ed|ies)|hurt|illness|sick|surgery)\b/i, 'injury_claim'],
  [/\b(motivated|revenge|wants to|hungry for|feels|believes|said|told|according to|admitted|insisted)\b/i, 'unsupported_attribution'],
  [/["“”]/, 'quotation'],
  [/\bhttps?:\/\/|www\.|\.com\b/i, 'url_in_prose'],
  [/\b(tyres?|tires?|compound|softs?|mediums?|hards?|undercut|overcut|strategy|stint)\b/i, 'unsourced_strategy_or_tyres'],
  [/\b(safety car|virtual safety car|vsc|red flag|yellow flag|crash(ed)?|collision|contact|spun|spin|puncture|engine failure|gearbox|mechanical)\b/i, 'unsourced_incident'],
  [/\b(rain|wet|dry|weather|temperature|hot|humid)\b/i, 'unsourced_conditions'],
  [/\b(historic|unprecedented|record-breaking|greatest|best ever|all-time|stunning|incredible|legendary|shocking|sensational|remarkable|astonishing|epic|magical|masterclass|brilliant|dominant drive|perfect)\b/i, 'unsupported_superlative'],
  [/\b(because|caused|thanks to|won it with|the reason|due to|as a result of|allowed (him|her|them)|enabled)\b/i, 'unsupported_causation'],
  [/\b(in control|cruising|runaway|all but|locked up|commanding|edge over|guaranteed|title is|clinch(ed)?)\b/i, 'outcome_claim'],
  [/\b(fans|crowds?|grandstands?|roars?|atmosphere|electric|paddock|garage)\b/i, 'invented_atmosphere'],
  [/\b(overtak(e|es|ing|en)|passed|pass for|move on)\b/i, 'unsourced_overtake'],
];
export const KNOWN_NAMES = ['PropBetEdge', 'PropBetEdge F1', 'PropSports', 'Driver DNA', 'Constructor DNA', 'Circuit DNA', 'Circuit Fit', 'PBEcast', 'Grand Prix', 'Formula 1', 'Qualifying Pace', 'Qualifying Speed', 'All Access'];
export const FIELDS = ['headline', 'dek', 'seo_title', 'seo_description', 'social_headline'];
export const tokensIn = (text) => [...String(text || '').matchAll(TOKEN)].map((m) => ({ kind: m[1], id: m[2] }));
const surname = (x) => (x.type === 'driver' ? x.name.split(' ').slice(-1)[0] : x.name);

// token string -> segments: plain text, fact values and entity links (hrefs come from resolve())
export function segments(text, packet, resolve, { links = true } = {}) {
  const facts = new Map(packet.facts.map((f) => [f.id, f]));
  const ents = new Map(packet.entities.map((x) => [x.key, x]));
  const out = [];
  let last = 0;
  for (const m of String(text || '').matchAll(TOKEN)) {
    if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    if (m[1] === 'f') { const f = facts.get(m[2]); out.push({ t: 'fact', v: f ? f.display : '', fact: m[2] }); }
    else {
      const x = ents.get(m[2]);
      const v = x ? (m[1] === 's' ? surname(x) : x.name) : '';
      const href = links && x && m[1] === 'e' ? resolve(x) : null;
      out.push(href ? { t: 'link', v, href, entity: x.key, entity_type: x.type } : { t: 'text', v });
    }
    last = m.index + m[0].length;
  }
  if (last < String(text || '').length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}
export const plain = (segs) => segs.map((s) => s.v).join('').replace(/\s+/g, ' ').trim();
export const render = (text, packet) => plain(segments(text, packet, () => null, { links: false }));

// source consistency: facts that must agree with each other before anything is written
export function consistency(packet) {
  const reasons = [];
  const c = packet.context?.champ_check;
  if (c && c.before + (c.scored || 0) !== c.after) reasons.push(`championship_math: ${c.before} + ${c.scored} != ${c.after}`);
  const g = (id) => packet.facts.find((f) => f.id === id)?.value;
  if (packet.type === 'race_final') {
    if (g('p1_finish') !== 1) reasons.push('winner_not_p1');
    if (g('p2_finish') != null && g('p2_finish') !== 2) reasons.push('p2_mismatch');
    const cg = g('climber_gain');
    if (cg != null && g('climber_grid') - g('climber_finish') !== cg) reasons.push('climber_math');
  }
  return reasons;
}

export function validateDraft(packet, draft, { resolve = () => '/', ledger = null, minWords = 120 } = {}) {
  const reasons = [];
  const facts = new Set(packet.facts.map((f) => f.id));
  const ents = new Set(packet.entities.map((x) => x.key));
  if (!draft) return { ok: false, reasons: ['no_draft'] };
  reasons.push(...consistency(packet));
  const prose = [...FIELDS.map((k) => draft[k] || ''), ...(draft.sections || []).flatMap((s) => [s.heading || '', ...(s.paragraphs || [])])];
  if (!draft.headline || !draft.dek) reasons.push('missing_headline_or_dek');
  if (!(draft.sections || []).length) reasons.push('no_sections');
  for (const s of draft.sections || []) if (!(s.paragraphs || []).length && !s.module) reasons.push('empty_section');
  const used = new Set();
  const known = new Set([...packet.entities.flatMap((x) => [x.name, surname(x)]), ...packet.facts.flatMap((f) => [f.display, ...(typeof f.value === 'string' ? [f.value] : [])]), ...KNOWN_NAMES].filter(Boolean).map((x) => String(x).toLowerCase()));
  for (const text of prose) {
    for (const t of tokensIn(text)) {
      if (t.kind === 'f') { if (!facts.has(t.id)) reasons.push('unknown_fact:' + t.id); else used.add(t.id); }
      else if (!ents.has(t.id)) reasons.push('unknown_entity:' + t.id);
    }
    const bare = String(text).replace(TOKEN, '');
    if (/\d/.test(bare)) reasons.push(`unsupported_number: "${bare.match(/[^.]*\d[^.]*/)?.[0]?.trim().slice(0, 80)}"`);
    // motorsport idiom, not a count
    const counted = bare.replace(/\bone-two\b/gi, '');
    const nw = counted.match(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred|dozen)\b/i);
    if (nw) reasons.push('number_word: "' + nw[0] + '"');
    const ow = bare.match(/\b(second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/i);
    if (ow) reasons.push('ordinal_word: "' + ow[0] + '"');
    for (const [re, why] of BANNED) if (re.test(bare)) reasons.push(why + ': "' + (bare.match(re)?.[0] || '') + '"');
    // a proper name the packet does not contain (driver, team, circuit, event typed as plain text) is unsupported
    for (const m of bare.matchAll(/(?:^|[^.!?]\s)((?:[A-Z][A-Za-zà-ÿ'’-]+)(?:\s+(?:[A-Z][A-Za-zà-ÿ'’-]+|of|de|la|da|di|van|der)){1,4})/g)) {
      const n = m[1].trim().replace(/\s+(of|de|la|da|di|van|der)$/, '').replace(/^(The|A|An|At|In|On|For|With|Across|After|Before|From)\s+/, '');
      if (n.split(/\s+/).length >= 2 && !known.has(n.toLowerCase()) && ![...known].some((k) => k.includes(n.toLowerCase()))) reasons.push('unsupported_name: "' + n + '"');
    }
    // single capitalised words that look like driver/team/circuit names but are not in the packet
    for (const m of bare.matchAll(/(?<=[a-z,;]\s)([A-Z][a-zà-ÿ'’-]{2,})\b/g)) if (!known.has(m[1].toLowerCase()) && ![...known].some((k) => k.split(/\s+/).includes(m[1].toLowerCase()))) reasons.push('unsupported_name: "' + m[1] + '"');
  }
  for (const text of prose) for (const m of String(text).replace(TOKEN, '').matchAll(/\b(he|him|his|himself|she|her|hers|herself)\b/gi)) { reasons.push('pronoun_not_supported: "' + m[1] + '"'); break; }
  for (const s of draft.sections || []) if (s.module && s.module !== 'none' && !(packet.charts.includes(s.module) || (s.module === 'pbecast' && packet.context?.replay))) reasons.push('unknown_module:' + s.module);
  if (used.size < 4) reasons.push('too_few_facts');
  for (const k of draft.link_intents || []) if (!ents.has(k)) reasons.push('unknown_link_intent:' + k);
  const hl = render(draft.headline, packet), dk = render(draft.dek, packet);
  if (hl.length < 20 || hl.length > 110) reasons.push('headline_length:' + hl.length);
  if (dk.length < 40 || dk.length > 300) reasons.push('dek_length:' + dk.length);
  const st = render(draft.seo_title || '', packet);
  if (!st || st.length > 70) reasons.push('seo_title_length:' + st.length);
  const sd = render(draft.seo_description || '', packet);
  if (sd.length < 70 || sd.length > 170) reasons.push('seo_description_length:' + sd.length);
  const words = (draft.sections || []).flatMap((s) => s.paragraphs || []).map((p) => render(p, packet)).join(' ').split(/\s+/).filter(Boolean).length;
  if (words < minWords) reasons.push('too_short:' + words);
  if (words > 1400) reasons.push('too_long:' + words);
  // duplicate story: another published article already holds this topic, headline or slug
  if (ledger) {
    for (const [slug, row] of Object.entries(ledger)) {
      if (row.topic === packet.topic) continue; // the same story, re-rendered
      if (slug === draft.slug) reasons.push('duplicate_slug:' + slug);
      if (row.headline && row.headline.toLowerCase() === hl.toLowerCase()) reasons.push('duplicate_headline:' + slug);
    }
  }
  return { ok: !reasons.length, reasons: [...new Set(reasons)], facts_used: [...used], words };
}

export function resolveHref(x) {
  switch (x.type) {
    case 'driver': return `/drivers/${x.ref}`;
    case 'team': return `/teams/${x.ref}`;
    case 'circuit': return `/circuits/${x.ref}`;
    case 'race': return `/races/${x.ref}`;
    case 'matchup': { const [a, b] = x.ref.split('|').sort(); return `/matchup/${a}/${b}`; }
    case 'pbecast': return `/pbecast/${x.ref}`;
    case 'news': return `/news/${x.ref}`;
    default: return null;
  }
}
