// People Intelligence V2: merges researched HISTORICAL roles + identity facts into src/identity/personnel.json.
//   node scripts/people-history-merge.mjs <roles-history.json> [identity-wikidata.json]
// - Historical roles are appended with history=true and display=false (they never reach a team page; the profile
//   timeline shows them when sourced and high|medium confidence). Dedupe key: person+team/org+role+driver+from.
// - An ongoing researched role that matches an existing current-season record (same person, team, driver and title)
//   only lends its effectiveFrom to that record; it is not duplicated. Ended spells never touch current records.
// - Identity facts: every field keeps its source ids. Two sources that disagree on a date of birth or birthplace put
//   the field on hold (conflict) instead of overwriting. Private facts are never accepted (whitelist of fields).
// - Founder / owner job titles are moved to roleGroup "ownership" (ownership is not leadership).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { splitTitles } from '../src/identity/people-v2.mjs';

const [histFile, wdFile] = process.argv.slice(2);
const H = JSON.parse(fs.readFileSync(histFile, 'utf8'));
const W = wdFile && fs.existsSync(wdFile) ? JSON.parse(fs.readFileSync(wdFile, 'utf8')) : { identity: {} };
const P = JSON.parse(fs.readFileSync('src/identity/personnel.json', 'utf8'));
const BAD = /wikipedia\.org|fandom\.com|wikiwand|scuderiafans|reddit\.com|f1salaries|celebritynetworth/;
const TIER = { first_party: 'A', fia: 'A', media: 'B', wikidata: 'wikidata' };
const sid = (s) => {
  const id = 's-' + crypto.createHash('sha1').update(s.url).digest('hex').slice(0, 10);
  P.sources[id] ??= { url: s.url, publisher: s.publisher || null, type: s.type || 'media', date: s.date || null };
  P.sources[id].tier ??= s.tier || TIER[P.sources[id].type] || 'B';
  return id;
};
const srcs = (arr) => (arr || []).filter((s) => s?.url && !BAD.test(s.url)).map(sid);
const yr = (s) => (s ? Number(String(s).slice(0, 4)) : null);
const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();

let added = 0, lent = 0, skipped = 0;
const key = (r) => `${r.personId}|${r.constructorId || r.organisation || ''}|${norm(r.role)}|${r.driverId || ''}|${r.effectiveFrom || ''}`;
const have = new Set(P.roles.map(key));
for (const x of H.roles || []) {
  const sources = srcs(x.sources);
  if (!sources.length || !x.personId || !x.role) { skipped++; continue; }
  P.people[x.personId] ??= { name: x.name };
  const ongoing = x.current === true && !x.effectiveTo;
  if (ongoing && x.constructorId) {
    const titles = splitTitles({ role: x.role, driverId: x.driverId }).map((t) => norm(t.title));
    const host = P.roles.find((r) => !r.history && r.personId === x.personId && r.constructorId === x.constructorId && r.current === true && !r.effectiveTo && (r.driverId || null) === (x.driverId || null) && splitTitles(r).some((t) => titles.includes(norm(t.title))));
    if (host) {
      if (!host.effectiveFrom && x.effectiveFrom) { host.effectiveFrom = x.effectiveFrom; lent++; }
      host.sources = [...new Set([...host.sources, ...sources])];
      continue;
    }
  }
  const r = {
    personId: x.personId, role: x.role, roleGroup: x.roleGroup, constructorId: x.constructorId || null, ...(x.organisation ? { organisation: x.organisation } : {}),
    driverId: x.driverId || null, season: yr(x.effectiveFrom) || yr(x.effectiveTo), effectiveFrom: x.effectiveFrom || null, effectiveTo: x.effectiveTo || null,
    current: ongoing, history: true, sources, confidence: x.confidence, display: false,
    ...(x.conflicts?.length ? { conflicts: x.conflicts } : {}), ...(x.notes ? { notes: x.notes } : {}),
  };
  if (!['high', 'medium'].includes(r.confidence)) r.held = 'low confidence';
  if (have.has(key(r))) continue;
  have.add(key(r));
  P.roles.push(r);
  added++;
}

// ---- identity facts (whitelisted fields only) ----
const FIELDS = ['full_name', 'known_as', 'nationality', 'date_of_birth', 'birthplace'];
const LISTS = ['education', 'specialty', 'prior_racing'];
const STRICT = new Set(['date_of_birth', 'birthplace']);
let facts = 0, conflicts = 0;
function putField(pid, k, f) {
  if (!f?.value || !P.people[pid]) return;
  const sources = srcs(f.sources);
  if (!sources.length) return;
  const id = (P.people[pid].identity ??= {});
  const prev = id[k];
  if (!prev) { id[k] = { value: f.value, sources }; facts++; return; }
  if (norm(prev.value) === norm(f.value)) { prev.sources = [...new Set([...prev.sources, ...sources])]; return; }
  if (STRICT.has(k)) { prev.conflict = [...new Set([...(prev.conflict || [prev.value]), f.value])]; conflicts++; }
  // non-strict fields (e.g. nationality wording "British" vs "United Kingdom"): keep the first, record the variant
  else prev.variants = [...new Set([...(prev.variants || []), f.value])];
}
// Wikidata first (open identity data), then team/media research
for (const [pid, rec] of Object.entries(W.identity || {})) for (const k of FIELDS) if (k !== 'known_as') putField(pid, k, rec[k]);
for (const [pid, rec] of Object.entries(H.identity || {})) {
  if (!P.people[pid]) continue;
  for (const k of FIELDS) putField(pid, k, rec[k]);
  for (const k of LISTS) for (const f of rec[k] || []) {
    const sources = srcs(f.sources);
    if (!f?.value || !sources.length) continue;
    const id = (P.people[pid].identity ??= {});
    const list = (id[k] ??= []);
    if (!list.some((x) => norm(x.value) === norm(f.value))) { list.push({ value: f.value, sources }); facts++; }
  }
}

// ownership is not leadership: founder / owner titles move to their own group
for (const r of P.roles) if (/^(co-)?(founder|owner)\b|team owner/i.test(r.role)) r.roleGroup = 'ownership';

P.version = 'f1-personnel@2';
P._doc = P._doc.replace(/ People V2:.*$/, '') + ' People V2: history=true roles are dated earlier/other spells (profile timeline only, never a team page); people[id].identity holds sourced identity facts {value, sources[, conflict]} - a field with a recorded conflict is held. sources[id].tier = A (team/FIA/first party) | B (formula1.com + established reporting) | wikidata (open identity data only).';
fs.writeFileSync('src/identity/personnel.json', JSON.stringify(P, null, 2) + '\n');
console.log({ added, lent, skipped, facts, conflicts, roles: P.roles.length, people: Object.keys(P.people).length });
