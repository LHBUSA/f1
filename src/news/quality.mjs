// Editorial quality gate. Runs AFTER the factual gate passes and never relaxes it. A full article that fails is HELD:
// thin stories are not padded, they are not published as features.
import { render, segments, resolveHref } from './validate.mjs';

export const EDITORIAL_VERSION = 'f1-editorial@1.0.0';
export const TARGETS = { preview: [700, 1200], race_final: [800, 1400], qualifying: [600, 1000], championship: [600, 1100], market_move: [450, 900] };
const MIN_FULL = { preview: 500, race_final: 500, qualifying: 400, championship: 500, market_move: 400 };
const STRUCTURAL = new Set(['', 'Follow the weekend', 'Follow the race', 'The result', 'Qualifying classification', 'Grid to finish']);
const CONTEXT_FACTS = /^(leader|c2_|c3_|c4_|max_left|alive|lead_|con1|con_gap|p1_champ|leader_points|leader_margin|rounds_left)/;
const EVENT_FACTS = /^(arch_|held|longest_straight|straight_|corner_split|recent_|gw\d|fit\d|fit_|pole_|margin|climber|p1_grid|p2_grid|q1_lap|q2_|cut_|circuit_|track_pos|deep_|most_wins|years_away|retirements|mate_)/;
// a championship update's event-specific analysis is what THIS round changed in the table (class-scoped; other classes unchanged)
const EVENT_FACTS_BY_CLASS = { championship: /^(swing_|leader_result|c2_result|mate_|mate2_)/ };

export function editorialGate(packet, draft, { X = null, linkOk = () => true } = {}) {
  const reasons = [], warnings = [];
  const body = (draft.sections || []).flatMap((s) => s.paragraphs || []);
  const words = body.map((p) => render(p, packet)).join(' ').split(/\s+/).filter(Boolean).length;
  const [lo, hi] = TARGETS[packet.type] || [500, 1500];
  if (words < (MIN_FULL[packet.type] ?? 500)) reasons.push(`too_thin_for_full_article:${words}`);
  else if (words < lo) warnings.push(`below_target:${words}<${lo}`);
  if (words > hi) warnings.push(`above_target:${words}>${hi}`);
  // hollow sections: substantive sections with almost no prose
  const hollow = (draft.sections || []).filter((s) => !STRUCTURAL.has(s.heading) && (s.paragraphs || []).map((p) => render(p, packet)).join(' ').split(/\s+/).filter(Boolean).length < 30);
  if (hollow.length >= 2) reasons.push(`hollow_sections:${hollow.map((s) => s.heading).join('|')}`);
  // tables over prose: sections that exist mainly to carry a module
  const moduleOnly = (draft.sections || []).filter((s) => s.module && (s.paragraphs || []).join(' ').split(/\s+/).length < 25).length;
  if (moduleOnly > Math.max(2, (draft.sections || []).length / 3)) reasons.push(`tables_over_prose:${moduleOnly}`);
  // repetition: one fact carrying the story
  const uses = {};
  for (const p of body) for (const m of p.matchAll(/\{f:([a-z0-9_]+)\}/g)) uses[m[1]] = (uses[m[1]] || 0) + 1;
  const total = Object.values(uses).reduce((a, b) => a + b, 0);
  const worst = Object.entries(uses).sort((a, b) => b[1] - a[1])[0];
  if (worst && worst[1] > 4) reasons.push(`repeated_fact:${worst[0]}x${worst[1]}`);
  if (total && Object.keys(uses).length / total < 0.6) reasons.push(`repetitive_facts:${Object.keys(uses).length}/${total}`);
  // headings
  const heads = (draft.sections || []).map((s) => s.heading).filter(Boolean);
  if (new Set(heads).size !== heads.length) reasons.push('duplicate_headings');
  // links: distinct internal destinations the reader can follow
  const links = new Set();
  for (const p of [draft.dek, ...body]) for (const s of segments(p, packet, (x) => resolveHref(x))) if (s.t === 'link' && linkOk(s.href)) links.add(s.href);
  if (links.size < 8) reasons.push(`too_few_internal_links:${links.size}`);
  // context and specificity
  const used = Object.keys(uses);
  if (!used.some((id) => CONTEXT_FACTS.test(id))) reasons.push('no_current_season_context');
  const evRe = EVENT_FACTS_BY_CLASS[packet.type] || EVENT_FACTS;
  if (used.filter((id) => evRe.test(id)).length < 3) reasons.push('no_event_specific_analysis');
  // event identity: the packet's event and circuit must be the canonical event's
  if (X && packet.event_id) {
    const ev = X.event[packet.event_id];
    const evFact = packet.facts.find((f) => f.id === 'event')?.value;
    if (!ev || evFact !== `${ev.season} ${ev.name}`) reasons.push('event_identity_mismatch');
    const circ = packet.entities.find((x) => x.key === 'circuit');
    if (circ && circ.ref !== ev?.circuit_id) reasons.push('circuit_identity_mismatch');
    const hl = render(draft.headline, packet);
    const otherCircuit = packet.entities.filter((x) => x.type === 'circuit' && x.ref !== ev?.circuit_id).find((x) => hl.includes(x.name));
    if (otherCircuit) reasons.push(`headline_names_other_circuit:${otherCircuit.name}`);
    if (!hl.includes(String(ev?.season)) && !hl.includes(ev?.name?.replace(/ in .+$/, '') || '~') && !(circ && hl.includes(circ.name))) reasons.push('headline_missing_event');
  }
  return { ok: !reasons.length, reasons, warnings, words, links: links.size, version: EDITORIAL_VERSION };
}
