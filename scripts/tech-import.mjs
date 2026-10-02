// Imports a researched tech manifest into machine-<season>.json (per-team specs, power-unit maker key) and
// f1-tech-<season>.json (general regulation statements per Explorer component, tyres, power-unit maker facts).
//   node scripts/tech-import.mjs <tech.json>
// Every fact keeps its sources; fan/aggregator hosts are dropped; teams without sourced specs keep what they had.
import fs from 'node:fs';
import crypto from 'node:crypto';

const T = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const season = T.season || 2026;
const MF = `src/identity/machine-${season}.json`;
const M = JSON.parse(fs.readFileSync(MF, 'utf8'));
const BAD = /wikipedia\.org|fandom\.com|wikiwand|scuderiafans|reddit\.com|f1salaries/;
const clean = (arr) => (arr || []).filter((s) => s?.url && !BAD.test(s.url)).map((s) => ({ url: s.url, publisher: s.publisher || null, type: s.type || 'media', date: s.date || null }));
const sid = (s) => { const id = 's-' + crypto.createHash('sha1').update(s.url).digest('hex').slice(0, 10); M.sources[id] ??= s; return id; };

const MAKER = [[/mercedes/i, 'mercedes'], [/ferrari/i, 'ferrari'], [/red bull|ford/i, 'red-bull-ford'], [/honda/i, 'honda'], [/audi/i, 'audi']];
let lines = 0;
for (const [cid, t] of Object.entries(T.teams || {})) {
  const specs = (t.specs || []).map((s) => ({ component: s.component, label: s.label, value: s.value, scope: s.scope, sources: clean(s.sources).map(sid) })).filter((s) => s.sources.length && ['car_specific', 'regulation'].includes(s.scope));
  M.teams[cid] ??= {};
  if (specs.length) { M.teams[cid].specs = specs; lines += specs.length; }
  const pu = M.teams[cid].powerUnit;
  if (pu) pu.makerKey = MAKER.find(([re]) => re.test(`${pu.manufacturer} ${pu.designation || ''}`))?.[1] || null;
}
fs.writeFileSync(MF, JSON.stringify(M, null, 2) + '\n');

const val = (o) => (o && typeof o === 'object' && 'value' in o ? o.value : o);
const tech = {
  _doc: 'General F1 tech (regulation level) per Car Explorer component, Pirelli tyre facts and power-unit maker facts. Statements are normalised in our own words; every one keeps its source. Rendered as GENERAL F1 TECH, never as a team-specific spec. Upstream data hosts are provenance-only (not linked on pages).',
  version: `f1-tech-${season}@1`,
  season,
  retrieved: T.retrieved || null,
  conflicts: T.conflicts || [],
  general: Object.fromEntries(Object.entries(T.general || {}).map(([k, arr]) => [k, arr.map((g) => ({ text: g.text, sources: clean(g.sources) })).filter((g) => g.sources.length)])),
  tyres: T.tyres ? {
    supplier: val(T.tyres.supplier), generation: val(T.tyres.generation), rimInches: val(T.tyres.rimInches), widthChange: val(T.tyres.widthChange),
    dryCompounds: val(T.tyres.dryCompounds), intermediate: val(T.tyres.intermediate), wet: val(T.tyres.wet),
    eventAllocation: T.tyres.malaysia2026Allocation ? { event: '2026 Bahrain Grand Prix in Malaysia', value: val(T.tyres.malaysia2026Allocation), sources: clean(T.tyres.malaysia2026Allocation.sources) } : null,
    sources: clean(Object.values(T.tyres).flatMap((v) => (v && typeof v === 'object' ? v.sources || [] : []))),
  } : null,
  powerUnits: Object.fromEntries(Object.entries(T.powerUnits || {}).map(([k, p]) => [k, {
    designation: p.designation || null, architecture: p.architecture || [], fuelPartner: p.fuelPartner || null, lubricantPartner: p.lubricantPartner || null,
    outputPublished: p.outputPublished && clean(p.outputPublished.sources || [p.outputPublished.source]).length ? { value: p.outputPublished.value, sources: clean(p.outputPublished.sources || [p.outputPublished.source]) } : null,
    outputNote: p.outputNote || null,
    leadership: (p.leadership || []).map((l) => ({ name: l.name, role: l.role, sources: clean(l.sources || [l.source]) })).filter((l) => l.sources.length),
    customers: p.customers || [], sources: clean(p.sources),
  }])),
};
fs.writeFileSync(`src/identity/f1-tech-${season}.json`, JSON.stringify(tech, null, 2) + '\n');
console.log({ specLines: lines, general: Object.values(tech.general).flat().length, powerUnits: Object.keys(tech.powerUnits), tyres: !!tech.tyres });
