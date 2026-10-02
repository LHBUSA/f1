// Merges a deep personnel research pass into src/identity/personnel.json WITHOUT replacing existing team records:
// new roles are appended (deduped by person+role+driver+season), explicit corrections are applied, display policy
// stays conservative (current + high|medium + sourced). Identity merges (same person, two ids) are applied first.
//   node scripts/personnel-merge.mjs <deep.json>
import fs from 'node:fs';
import crypto from 'node:crypto';

const D = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const P = JSON.parse(fs.readFileSync('src/identity/personnel.json', 'utf8'));
const BAD = /wikipedia\.org|fandom\.com|wikiwand|scuderiafans|reddit\.com|f1salaries/;
const sid = (s) => { const id = 's-' + crypto.createHash('sha1').update(s.url).digest('hex').slice(0, 10); P.sources[id] ??= { url: s.url, publisher: s.publisher || null, type: s.type || 'media', date: s.date || null }; return id; };
const IDENTITY_MERGE = { 'matt-caller': 'matthew-caller' }; // former Red Bull No.1 mechanic = Audi Chief Mechanic
const key = (r) => `${r.personId}|${r.constructorId}|${r.season}|${r.role}|${r.driverId || ''}`;
const show = (r) => r.current === true && !r.effectiveTo && ['high', 'medium'].includes(r.confidence) && r.sources.length > 0;

let added = 0;
const have = new Set(P.roles.map(key));
for (const [cid, t] of Object.entries(D.teams)) for (const x of t.people) {
  const personId = IDENTITY_MERGE[x.personId] || x.personId;
  const sources = (x.sources || []).filter((s) => s.url && !BAD.test(s.url)).map(sid);
  if (!sources.length) continue;
  P.people[personId] ??= { name: x.name };
  const ended = x.effectiveTo && x.effectiveTo < `${D.season || 2026}-01-01`;
  const r = { personId, role: x.role.replace(/\s*-\s*departed$/i, ''), roleGroup: x.roleGroup, rank: 50 + added, constructorId: cid, driverId: x.driverId || null, season: ended ? Number(x.effectiveTo.slice(0, 4)) : x.season, effectiveFrom: x.effectiveFrom || null, effectiveTo: x.effectiveTo || null, current: x.current, sources, confidence: x.confidence, ...(x.conflicts?.length ? { conflicts: x.conflicts } : {}), ...(x.notes ? { notes: x.notes } : {}) };
  r.display = show(r);
  if (!r.display) r.held = r.current !== true ? 'stale / not current' : 'low confidence';
  if (have.has(key(r))) continue;
  have.add(key(r));
  P.roles.push(r);
  added++;
}

// explicit corrections from the research flags (each carries its first-party evidence)
const FP = (url, publisher, date = null) => sid({ url, publisher, type: 'first_party', date });
const find = (pid, cid, pred = () => true) => P.roles.filter((r) => r.personId === pid && r.constructorId === cid && r.season === 2026 && pred(r));
const upgrade = (pid, cid, src, pred) => { for (const r of find(pid, cid, pred)) { r.confidence = 'high'; if (!r.sources.includes(src)) r.sources.push(src); r.display = show(r); delete r.held; } };
const mcl = FP('https://www.mclaren.com/racing/formula-1/2026/who-sits-on-mclarens-pit-wall/', 'McLaren Racing');
for (const r of find('randeep-singh', 'mclaren')) r.role = 'Senior Racing Director';
upgrade('randeep-singh', 'mclaren', mcl);
upgrade('will-courtenay', 'mclaren', mcl);
upgrade('will-joseph', 'mclaren', mcl, (r) => r.driverId);
upgrade('tom-stallard', 'mclaren', FP('https://www.mclaren.com/racing/formula-1/2026/how-the-mclaren-mastercard-formula-1-team-prepares-for-race-day/', 'McLaren Racing'), (r) => r.driverId);
const merc = FP('https://www.mercedesamgf1.com/news/history-made-as-kimi-takes-first-win-in-1-2', 'Mercedes-AMG PETRONAS F1 Team');
upgrade('peter-bonnington', 'mercedes', merc, (r) => r.driverId);
if (!find('peter-bonnington', 'mercedes', (r) => r.role === 'Head of Race Engineering').length) P.roles.push({ personId: 'peter-bonnington', role: 'Head of Race Engineering', roleGroup: 'race_engineering', rank: 1, constructorId: 'mercedes', driverId: null, season: 2026, effectiveFrom: null, effectiveTo: null, current: true, sources: [merc], confidence: 'high', display: true });
for (const r of find('tom-hart', 'red-bull', (r) => !r.driverId)) { r.display = false; r.held = 'superseded by driver-specific record (performance engineer, Max Verstappen)'; }
for (const r of find('paul-williams', 'williams')) { r.role = 'Chief Trackside Engineer'; const pw = (FP('https://www.williamsf1.com/articles/eeb5dea9-eaa9-4d5f-9818-ce09624c752f/report-belgium-friday-2026', 'Williams Racing', '2026-07-17')); if (!r.sources.includes(pw)) r.sources.push(pw); }
upgrade('davide-paganelli', 'haas', FP('https://www.haasf1team.com/news/tgr-haas-f1-team-visits-city-ferrara-ahead-italian-grand-prix', 'TGR Haas F1 Team', '2026-08-31'));
for (const r of find('davide-paganelli', 'haas')) { r.current = true; r.display = show(r); delete r.held; }
upgrade('mark-lowe', 'haas', FP('https://www.haasf1team.com/news/creating-unforgettable-moments-miami-grand-prix-starlight-childrens-foundation', 'TGR Haas F1 Team', '2026-05-02'));
upgrade('laura-mueller', 'haas', FP('https://www.haasf1team.com/news/australian-grand-prix-her-corner-initiative-see-albert-park-circuit-recognize-women-stem', 'TGR Haas F1 Team', '2026-02-24'), (r) => r.driverId);
for (const r of find('marco-adurno', 'ferrari')) { r.display = false; r.held = 'possibly stale: no 2026 source; overlapping 2026 hire (Head of Performance Operations)'; }
// sporting / trackside operations group
for (const r of P.roles) if (!r.driverId && /sporting director|head of sporting|team manager|racing director|director, racing/i.test(r.role)) r.roleGroup = 'sporting';
// identity merge on existing rows too
for (const r of P.roles) if (IDENTITY_MERGE[r.personId]) r.personId = IDENTITY_MERGE[r.personId];
for (const id of Object.keys(IDENTITY_MERGE)) delete P.people[id];

// dedupe (same person, team, season, role, driver): keep one row, union sources, best confidence, recompute display
const RANK = { high: 3, medium: 2, low: 1 };
const byKey = new Map();
for (const r of P.roles) {
  const k = key(r);
  const prev = byKey.get(k);
  if (!prev) { byKey.set(k, r); continue; }
  prev.sources = [...new Set([...prev.sources, ...r.sources])];
  if ((RANK[r.confidence] || 0) > (RANK[prev.confidence] || 0)) prev.confidence = r.confidence;
  if (r.current === true) prev.current = true;
  prev.display = show(prev);
  if (prev.display) delete prev.held;
}
P.roles = [...byKey.values()];

fs.writeFileSync('src/identity/personnel.json', JSON.stringify(P, null, 2) + '\n');
const shown = P.roles.filter((r) => r.display);
console.log({ added, roles: P.roles.length, shown: shown.length, people: Object.keys(P.people).length, displayedPeople: new Set(shown.map((r) => r.personId)).size });
