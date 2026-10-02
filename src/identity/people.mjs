// Personnel graph + machine registry access. PERSON <-> ROLE <-> TEAM <-> DRIVER <-> SEASON (+ CAR / POWER UNIT via
// machine-<season>.json). Only displayable, current, sourced roles reach a page; held/conflicting data stays in the
// registry for history and future /engineers/:slug profiles.
import fs from 'node:fs';

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

export function loadPeople() {
  const p = read('src/identity/personnel.json');
  const machines = {};
  for (const f of fs.readdirSync('src/identity').filter((x) => /^machine-\d{4}\.json$/.test(x))) { const m = read(`src/identity/${f}`); machines[m.season] = m; }
  const photos = fs.existsSync('src/identity/people-photos.json') ? read('src/identity/people-photos.json').photos || {} : {};
  return { ...p, machines, photos };
}

// Customer pages credit data to PropSports; upstream data providers (same list as scripts/guard-source-brand.mjs) are
// cited in the registry but never linked on a page. public=false sources stay provenance-only.
const UPSTREAM = /\b(?:[a-z0-9-]+\.)*(?:espn\.com|espncdn\.com|espn\.go\.com|api\.met\.no|wikidata\.org|wikipedia\.org|openf1\.org|jolpi\.ca|ergast\.com|formula1\.com|fia\.com|workers\.dev)\b/i;
const resolveSources = (ids, table) => (ids || []).map((id) => ({ id, ...table[id] })).filter((s) => s.url).map((s) => ({ ...s, public: !UPSTREAM.test(s.url) }));

// roles for one constructor in one season, grouped; never another season's roles on the current page
export function teamPeople(reg, constructorId, season) {
  const roles = reg.roles
    .filter((r) => r.constructorId === constructorId && r.season === season && r.display && !r.history && r.current === true && !r.effectiveTo && (r.sources || []).length)
    .map((r) => ({ ...r, name: reg.people[r.personId]?.name, slug: r.personId, photo: photoFor(reg, r.personId), sources: resolveSources(r.sources, reg.sources) }))
    .filter((r) => r.name && r.sources.length);
  const group = (g) => roles.filter((r) => r.roleGroup === g && !r.driverId).sort((a, b) => (a.rank || 9) - (b.rank || 9));
  const byDriver = {};
  for (const r of roles.filter((x) => x.driverId)) {
    const d = (byDriver[r.driverId] ??= { raceEngineers: [], performanceEngineers: [], mechanics: [], other: [] });
    if (/performance engineer/i.test(r.role)) d.performanceEngineers.push(r);
    else if (/race engineer/i.test(r.role)) d.raceEngineers.push(r);
    else if (/mechanic|car chief|crew chief/i.test(r.role) || r.roleGroup === 'garage_operations') d.mechanics.push(r);
    else d.other.push(r);
  }
  // one entry per person per step (a person can carry two titles for the same car, e.g. Race Engineer + Senior Race
  // Engineer): keep the higher-confidence row
  const RANK = { high: 3, medium: 2, low: 1 };
  const uniq = (rs) => Object.values(rs.reduce((m, r) => { const p = m[r.personId]; if (!p || (RANK[r.confidence] || 0) > (RANK[p.confidence] || 0)) m[r.personId] = r; return m; }, {}));
  for (const d of Object.values(byDriver)) {
    for (const k of ['raceEngineers', 'performanceEngineers', 'mechanics', 'other']) d[k] = uniq(d[k]);
    d.raceEngineers.sort((a, b) => /^senior/i.test(a.role) - /^senior/i.test(b.role));
  }
  return {
    leadership: group('leadership'),
    technical: group('technical'),
    raceEngineering: group('race_engineering'),
    sporting: group('sporting'),
    driverEngineers: Object.entries(byDriver).flatMap(([, d]) => d.raceEngineers),
    driverChains: byDriver,
    powerUnit: group('power_unit'),
    garageOps: group('garage_operations'),
    garage: reg.garage?.[constructorId]?.season === season ? reg.garage[constructorId] : null,
    photoCredits: roles.filter((r) => r.photo).map((r) => ({ name: r.name, ...r.photo })).filter((x, i, a) => a.findIndex((y) => y.name === x.name) === i),
  };
}

// cleared personnel photographs only (src/identity/people-photos.json); anything else falls back to initials
export function photoFor(reg, personId) {
  const p = reg.photos?.[personId];
  return p && p.rightsStatus === 'cleared' && p.files ? p : null;
}

// every person with at least one displayable role -> profile page data (current roles first, then history)
export function personProfiles(reg) {
  const out = {};
  for (const r of reg.roles.filter((x) => x.display && (x.sources || []).length)) {
    const person = reg.people[r.personId];
    if (!person) continue;
    const prof = (out[r.personId] ??= { slug: r.personId, name: person.name, photo: photoFor(reg, r.personId), roles: [] });
    prof.roles.push({ ...r, sources: resolveSources(r.sources, reg.sources) });
  }
  for (const p of Object.values(out)) p.roles.sort((a, b) => (b.season - a.season) || ((b.current === true) - (a.current === true)));
  return out;
}

export function teamMachine(reg, constructorId, season) {
  const m = reg.machines[season];
  const t = m?.teams?.[constructorId];
  if (!t) return null;
  const src = (o) => (o ? { ...o, sources: resolveSources(o.sources, m.sources) } : null);
  const keep = (o) => (o && o.sources.length ? o : null);
  return { carModel: keep(src(t.carModel)), powerUnit: keep(src(t.powerUnit)), tyreSupplier: keep(src(t.tyreSupplier)), specs: (t.specs || []).map(src).filter((s) => s.sources.length) };
}
