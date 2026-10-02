// Car Explorer composition: hotspots (normalised master coordinates on the car photo) -> component panels that keep
// CAR-SPECIFIC facts (this team's sourced specs) apart from GENERAL F1 TECH (season regulations / how it works), plus
// MACHINE -> PEOPLE connections (cockpit -> drivers + race engineers, power unit -> supplier + PU leadership, tyres ->
// supplier + race engineering). Nothing is inferred from the photograph; missing = "not publicly disclosed".
import fs from 'node:fs';

const read = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);

const UPSTREAM = /\b(?:[a-z0-9-]+\.)*(?:espn\.com|espncdn\.com|espn\.go\.com|api\.met\.no|wikidata\.org|wikipedia\.org|openf1\.org|jolpi\.ca|ergast\.com|formula1\.com|fia\.com|workers\.dev)\b/i;
const pub = (arr) => (arr || []).map((s) => ({ ...s, public: !UPSTREAM.test(s.url || '') }));

export function loadExplorer() {
  return {
    components: read('src/identity/explorer-components.json', { components: {} }),
    tech: read('src/identity/f1-tech-2026.json', { general: {}, tyres: null, powerUnits: {}, sources: {} }),
  };
}

// machine spec component ids (machine-<season>.json) per explorer component
const SPEC_ALIASES = {
  'front-wing': ['front-wing', 'front_wing', 'bodywork'],
  'front-tyre': ['front-tyre', 'tyres', 'wheels'],
  'front-suspension': ['front-suspension', 'front_suspension', 'suspension'],
  brakes: ['brakes'],
  cockpit: ['cockpit', 'electronics', 'steering', 'safety'],
  sidepod: ['sidepod', 'cooling', 'bodywork', 'chassis'],
  floor: ['floor', 'chassis', 'dimensions'],
  'power-unit': ['power-unit', 'power_unit', 'gearbox', 'fuel_system', 'transmission'],
  'rear-suspension': ['rear-suspension', 'rear_suspension', 'suspension'],
  'rear-tyre': ['rear-tyre', 'tyres', 'wheels'],
  'rear-wing': ['rear-wing', 'rear_wing', 'bodywork'],
};
const BODY_LABEL = { 'front-wing': /wing|bodywork/i, 'rear-wing': /wing|bodywork/i, sidepod: /sidepod|bodywork|monocoque|cool/i, floor: /floor|monocoque|dimension|weight|width|height|length/i };

export function explorerFor(X, { photo, machine, people, lineup, season, carLabel }) {
  if (!photo?.explorer?.hotspots?.length) return null;
  const defs = X.components.components || {};
  const general = X.tech.general || {};
  const specs = machine?.specs || [];
  const comps = photo.explorer.hotspots.filter((h) => defs[h.component]).map((h) => {
    const id = h.component;
    const aliases = SPEC_ALIASES[id] || [id];
    let mine = specs.filter((s) => aliases.includes(s.component));
    if (BODY_LABEL[id]) mine = mine.filter((s) => !['bodywork', 'chassis', 'dimensions'].includes(s.component) || BODY_LABEL[id].test(`${s.label} ${s.value}`));
    const carFacts = mine.filter((s) => s.scope === 'car_specific');
    const ruleFacts = mine.filter((s) => s.scope === 'regulation');
    const gen = (general[id] || []).map((g) => ({ text: g.text, sources: pub(g.sources) }));
    // team-published regulation lines only when no general statement covers the component (no duplicate rules)
    return { id, label: defs[id].label, x: h.x, y: h.y, carFacts, ruleFacts: gen.length ? [] : ruleFacts, general: gen, links: links(id, { machine, people, lineup, tech: X.tech, season }) };
  });
  return { carLabel, season, comps };
}

function links(id, { machine, people, lineup, tech, season }) {
  const out = {};
  if (id === 'cockpit') out.drivers = lineup.map((d) => ({ ...d, engineers: (people?.driverEngineers || []).filter((r) => r.driverId === d.slug) }));
  if (id === 'power-unit') {
    const pu = machine?.powerUnit;
    if (pu) {
      const mf = tech.powerUnits?.[pu.makerKey] || null;
      // PU technical leadership: the team's own power_unit roles, else the maker's sourced leadership
      const lead = people?.powerUnit?.length ? people.powerUnit : (mf?.leadership || []).map((l) => ({ ...l, sources: pub(l.sources) }));
      out.powerUnit = { ...pu, season, makerFacts: mf, leadership: lead };
    }
  }
  if (id === 'front-tyre' || id === 'rear-tyre') out.tyres = { supplier: machine?.tyreSupplier || null, spec: tech.tyres || null, axle: id === 'front-tyre' ? 'front' : 'rear' };
  if (['front-wing', 'rear-wing', 'sidepod', 'floor', 'front-suspension', 'rear-suspension'].includes(id)) out.leadership = (people?.technical || []).slice(0, 2);
  return out;
}
