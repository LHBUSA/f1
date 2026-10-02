// Imports a researched personnel/machine manifest into src/identity/personnel.json + machine-<season>.json.
//   node scripts/personnel-import.mjs <research.json>
// Display policy (conservative): a role is shown only when current, confidence high|medium and sourced; low-confidence
// and stale roles are kept for history but held. Car-model labels need a first-party/FIA source. A customer power-unit
// designation is kept only when not marked as filled by inference (designationNote). Existing teams not in the
// manifest (e.g. Mercedes) are left untouched.
import fs from 'node:fs';
import crypto from 'node:crypto';

const research = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const season = research.season || 2026;
const P = JSON.parse(fs.readFileSync('src/identity/personnel.json', 'utf8'));
const MF = `src/identity/machine-${season}.json`;
const M = JSON.parse(fs.readFileSync(MF, 'utf8'));
const OFFICIAL = new Set(['first_party', 'fia']);
const isWiki = (u) => /wikipedia\.org|fandom\.com|wikiwand/.test(u);

function srcId(table, s) {
  const id = 's-' + crypto.createHash('sha1').update(s.url).digest('hex').slice(0, 10);
  table[id] ??= { url: s.url, publisher: s.publisher || null, type: s.type || 'media', date: s.date || null };
  return id;
}

let roles = 0, shown = 0, held = 0;
for (const [cid, t] of Object.entries(research.teams)) {
  P.roles = P.roles.filter((r) => !(r.constructorId === cid && r.season === season));
  const rank = {};
  for (const x of t.people) {
    const sources = (x.sources || []).filter((s) => s.url && !isWiki(s.url));
    if (!sources.length) continue;
    P.people[x.personId] ??= { name: x.name };
    const conf = x.confidence;
    const display = x.current === true && !x.effectiveTo && (conf === 'high' || conf === 'medium');
    rank[x.roleGroup] = (rank[x.roleGroup] || 0) + 1;
    P.roles.push({
      personId: x.personId, role: x.role, roleGroup: x.roleGroup, rank: rank[x.roleGroup], constructorId: cid, driverId: x.driverId || null,
      season, effectiveFrom: x.effectiveFrom || null, effectiveTo: x.effectiveTo || null, current: x.current,
      sources: sources.map((s) => srcId(P.sources, s)), confidence: conf, display,
      ...(x.conflicts?.length ? { conflicts: x.conflicts } : {}), ...(x.notes ? { notes: x.notes } : {}),
      ...(!display ? { held: x.current !== true ? 'stale or not yet effective' : 'low confidence (single/old source)' } : {}),
    });
    roles++; display ? shown++ : held++;
  }
  P.garage ??= {};
  P.garage[cid] = { season, status: t.mechanics?.status === 'verified' ? 'partially_documented' : 'not_publicly_documented', note: t.mechanics?.status === 'verified' ? `Named garage roles shown where the team documents them; individual mechanic roster otherwise not publicly disclosed.` : 'Individual mechanic roster and chief mechanic not publicly documented; not verified by PropBetEdge.' };

  const m = t.machine || {};
  const src = (arr) => (arr || []).filter((s) => s.url && !isWiki(s.url)).map((s) => srcId(M.sources, s));
  const cm = m.carModel && OFFICIAL.has(m.carModel.sourceType) ? { value: m.carModel.value, sources: src([{ url: m.carModel.sourceUrl, publisher: null, type: m.carModel.sourceType, date: m.carModel.sourceDate }]) } : null;
  const pu = m.powerUnit ? { manufacturer: m.powerUnit.manufacturer, designation: m.powerUnit.designationNote ? null : m.powerUnit.designation || null, relationship: m.powerUnit.relationship || null, sources: src(m.powerUnit.sources) } : null;
  M.teams[cid] = {
    ...(M.teams[cid] || {}),
    carModel: cm,
    ...(m.carModel && !cm ? { carModelUnverified: { value: m.carModel.value, sourceType: m.carModel.sourceType, sourceUrl: m.carModel.sourceUrl } } : {}),
    powerUnit: pu && pu.sources.length ? pu : null,
    tyreSupplier: m.tyreSupplier ? { value: m.tyreSupplier.value, sources: src(m.tyreSupplier.sources) } : null,
    specs: M.teams[cid]?.specs || [],
  };
}
P.retrieved = research.retrieved || P.retrieved;
fs.writeFileSync('src/identity/personnel.json', JSON.stringify(P, null, 2) + '\n');
fs.writeFileSync(MF, JSON.stringify(M, null, 2) + '\n');
console.log({ teams: Object.keys(research.teams).length, roles, shown, held, people: Object.keys(P.people).length });
