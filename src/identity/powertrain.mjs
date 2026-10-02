// Powertrain intelligence: structured power-unit facts for a team, extracted ONLY from strings we already hold with
// sources, each tagged with its class:
//   team  = published by this team for this car (machine-<season>.json specs)
//   maker = published by the power-unit manufacturer (f1-tech-<season>.json powerUnits)
//   fia   = 2026 FIA regulation (f1-tech-<season>.json general statements) - a LIMIT/rule, not this car's measured value
// Precedence per metric: team > maker > fia. Nothing is estimated; a metric with no source is "Not publicly disclosed".
// A manufacturer's published output is never shown for another manufacturer's engine.

const METRICS = [
  // [key, group, label, regex, format]
  ['displacement', 'combustion', 'Displacement', /\b1[.,]6\s*l\b|\b1600\s*cc\b|\b1\.6\s*litre/i, () => '1.6 L'],
  ['layout', 'combustion', 'Layout', /90\s*(deg|°)/i, () => 'V6 · 90°'],
  ['valves', 'combustion', 'Valves', /\b24 valves\b|four valves per cylinder|4 valves\/cyl/i, () => '24 (4 per cylinder)'],
  ['rpm', 'combustion', 'ICE speed limit', /15,?000\s*rpm/i, () => '15,000 rpm max'],
  ['injection', 'combustion', 'Direct injection', /350\s*bar/i, () => '350 bar max'],
  ['fuelflow', 'combustion', 'Fuel energy flow', /3000\s*MJ\s*\/\s*h/i, () => '3,000 MJ/h max'],
  ['turbo', 'turbo', 'Turbocharger', /single turbo|single[- ]stage compressor|single turbine/i, () => 'Single turbocharger'],
  ['mguh', 'turbo', 'MGU-H', /no MGU-H|MGU-H (is )?(gone|removed|not used)|removal of the MGU-H|MGU-H removed/i, () => 'Removed for 2026'],
  ['mguk', 'electric', 'MGU-K power', /350\s*kW/i, () => '350 kW max'],
  ['mgukrpm', 'electric', 'MGU-K speed', /60,?000\s*rpm/i, () => '60,000 rpm max'],
  ['es', 'electric', 'Energy store', /\b4(\.0)?\s*MJ\b/i, () => '4 MJ usable window'],
  ['recharge', 'electric', 'Recovery limit', /8\.5\s*MJ/i, () => '8.5 MJ per lap'],
  ['gears', 'transmission', 'Gears', /\b(8|eight) forward/i, () => '8 forward ratios'],
  ['puweight', 'mass', 'PU minimum mass', /\b185\s*kg\b/i, () => '185 kg'],
  ['allocation', 'mass', 'Season allocation', /4 ICE|four ICE/i, () => '4 ICE/TC/EXH · 3 MGU-K/ES/CE per driver'],
];
export const GROUPS = [['combustion', 'Combustion'], ['turbo', 'Turbo'], ['electric', 'Electric'], ['transmission', 'Transmission'], ['fluids', 'Fuel & fluids'], ['mass', 'Mass & allocation']];
const SPEC_GROUP = (label) => (/gear|transmission|clutch|differential/i.test(label) ? 'transmission' : /fuel|lubric|oil|fluid/i.test(label) ? 'fluids' : /weight|mass|allocation/i.test(label) ? 'mass' : /mgu|ers|energy|battery/i.test(label) ? 'electric' : /turbo|pressure charging|compressor/i.test(label) ? 'turbo' : 'combustion');

export function powertrainFor({ machine, tech, teamName }) {
  const pu = machine?.powerUnit;
  if (!pu) return null;
  const mf = tech?.powerUnits?.[pu.makerKey] || null;
  const teamSpecs = (machine.specs || []).filter((s) => ['power-unit', 'power_unit', 'transmission', 'gearbox', 'fuel-system', 'fuel_system'].includes(s.component));
  const fiaTexts = (tech?.general?.['power-unit'] || []).concat(tech?.general?.dimensions || []);
  const sources = [
    ...teamSpecs.map((s) => ({ cls: s.scope === 'regulation' ? 'team-rule' : 'team', text: `${s.label} ${s.value}`, by: teamName })),
    ...(mf ? (mf.architecture || []).map((a) => ({ cls: 'maker', text: a, by: pu.manufacturer })) : []),
    ...fiaTexts.map((g) => ({ cls: 'fia', text: g.text, by: 'FIA' })),
  ];
  const metrics = {};
  for (const [key, group, label, re, fmt] of METRICS) {
    const hit = sources.find((s) => re.test(s.text));
    if (hit) metrics[key] = { key, group, label, value: fmt(), cls: hit.cls, by: hit.by };
  }
  // published output: only this engine's manufacturer/team claim; otherwise explicitly not published
  // a TOTAL output claim only (an MGU-K hp figure is not total output)
  const outSpec = teamSpecs.find((s) => s.officialOutput && /output/i.test(s.label));
  const makerOut = mf?.outputPublished?.value && !/not published|only/i.test(mf.outputPublished.value) ? mf.outputPublished.value : null;
  const clean = (v) => v.replace(/\s*\((combined, )?team-published( figure)?\)/i, '').replace(/1000/, '1,000');
  const output = outSpec ? { value: clean(outSpec.value), cls: 'team', by: teamName } : makerOut ? { value: clean(makerOut), cls: 'maker', by: mf.outputPublished.sources?.[0]?.publisher || pu.manufacturer, engine: pu.designation } : null;
  const fiaSplit = fiaTexts.find((g) => /400\s*kW/i.test(g.text)) ? { ice: 'about 400 kW', mguk: '350 kW', note: 'FIA description of the 2026 architecture (roughly 50/50 ICE / electric); not a measured or published figure for this engine' } : null;
  const groups = GROUPS.map(([id, title]) => ({ id, title, items: Object.values(metrics).filter((m) => m.group === id), team: teamSpecs.filter((s) => s.scope !== 'regulation' && SPEC_GROUP(s.label) === id && !/^power unit$/i.test(s.label)).map((s) => ({ label: s.label, value: s.value })) }));
  const fluids = groups.find((g) => g.id === 'fluids');
  if (mf?.fuelPartner && !fluids.team.some((t) => /fuel/i.test(t.label))) fluids.items.push({ key: 'fuel', label: 'Fuel', value: mf.fuelPartner, cls: 'maker', by: pu.manufacturer });
  if (mf?.lubricantPartner && !fluids.team.some((t) => /lubric|oil/i.test(t.label))) fluids.items.push({ key: 'lube', label: 'Lubricants', value: mf.lubricantPartner, cls: 'maker', by: pu.manufacturer });
  const teamFluid = (re) => teamSpecs.find((t) => re.test(t.label) || re.test(t.value))?.value || null;
  const fuel = mf?.fuelPartner || teamFluid(/fuel(?! (cell|system|energy))/i);
  const lube = mf?.lubricantPartner || teamFluid(/lubric|oil/i);
  return {
    fuel, lube,
    designation: pu.designation || null, manufacturer: pu.manufacturer, relationship: pu.relationship, makerKey: pu.makerKey,
    metrics, groups, output, fiaSplit, leadership: mf?.leadership || [], customers: mf?.customers || [],
  };
}
