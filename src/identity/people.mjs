// Personnel graph + machine registry access. PERSON <-> ROLE <-> TEAM <-> DRIVER <-> SEASON (+ CAR / POWER UNIT via
// machine-<season>.json). Only displayable, current, sourced roles reach a page; held/conflicting data stays in the
// registry for history and future /engineers/:slug profiles.
import fs from 'node:fs';

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

export function loadPeople() {
  const p = read('src/identity/personnel.json');
  const machines = {};
  for (const f of fs.readdirSync('src/identity').filter((x) => /^machine-\d{4}\.json$/.test(x))) { const m = read(`src/identity/${f}`); machines[m.season] = m; }
  return { ...p, machines };
}

const resolveSources = (ids, table) => (ids || []).map((id) => ({ id, ...table[id] })).filter((s) => s.url);

// roles for one constructor in one season, grouped; never another season's roles on the current page
export function teamPeople(reg, constructorId, season) {
  const roles = reg.roles
    .filter((r) => r.constructorId === constructorId && r.season === season && r.display && r.current === true && !r.effectiveTo && (r.sources || []).length)
    .map((r) => ({ ...r, name: reg.people[r.personId]?.name, slug: r.personId, sources: resolveSources(r.sources, reg.sources) }))
    .filter((r) => r.name && r.sources.length);
  const group = (g) => roles.filter((r) => r.roleGroup === g && !r.driverId).sort((a, b) => (a.rank || 9) - (b.rank || 9));
  return {
    leadership: group('leadership'),
    technical: group('technical'),
    raceEngineering: group('race_engineering'),
    driverEngineers: roles.filter((r) => r.driverId && r.roleGroup === 'race_engineering'),
    powerUnit: group('power_unit'),
    garageOps: group('garage_operations'),
    garage: reg.garage?.[constructorId]?.season === season ? reg.garage[constructorId] : null,
  };
}

export function teamMachine(reg, constructorId, season) {
  const m = reg.machines[season];
  const t = m?.teams?.[constructorId];
  if (!t) return null;
  const src = (o) => (o ? { ...o, sources: resolveSources(o.sources, m.sources) } : null);
  const keep = (o) => (o && o.sources.length ? o : null);
  return { carModel: keep(src(t.carModel)), powerUnit: keep(src(t.powerUnit)), tyreSupplier: keep(src(t.tyreSupplier)), specs: (t.specs || []).map(src).filter((s) => s.sources.length) };
}
