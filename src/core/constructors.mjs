// Constructor identity. ESPN reports a per-entry team name ("vehicle.manufacturer"), but it back-labels
// historical entries with a franchise's LATER name ("AlphaTauri" for 2006–19 Toro Rosso, "Alpine" for
// 2005–10 Renault, "Alfa Romeo Racing" for 2011–18 Sauber…). So a raw name only identifies the franchise;
// the season picks the entity. A raw name that is itself period-correct wins (e.g. 2018 Racing Point).
//
// constructor = one competing entity under one name in a season range.
// lineage     = the franchise (same entrant/factory) across renames. PBE editorial ('pbe_editorial').
// Names reused by unrelated entities (Lotus, Renault, Alfa Romeo, Mercedes, Aston Martin, Honda…) are split
// by season range so history is never attributed to the wrong team.

import { slugify } from './normalize.mjs';

// Distinct historical entities sharing a name with a modern franchise — matched first, by name AND season.
const HISTORIC = [
  [/^(lotus|team lotus)/i, 1950, 1994, 'team-lotus'],
  [/^mercedes/i, 1950, 1955, 'mercedes-1954'],
  [/^alfa romeo$/i, 1950, 1951, 'alfa-romeo-1950'],
  [/^alfa romeo$/i, 1963, 1985, 'alfa-romeo-1979'],
  [/^aston martin/i, 1959, 1960, 'aston-martin-1959'],
  [/^honda/i, 1964, 1968, 'honda-1964'],
  [/^renault/i, 1977, 1985, 'renault-1977'],
  [/^brabham/i, 1962, 1992, 'brabham'],
  [/^march/i, 1970, 1992, 'march'],
];

// Franchise lineages: [entity id, from, to, raw-name pattern that is period-correct for it].
export const LINEAGES = {
  'red-bull': { name: 'Red Bull Racing', members: [['stewart', 1997, 1999, /^stewart/i], ['jaguar', 2000, 2004, /^jaguar/i], ['red-bull', 2005, 2100, /^red bull/i]] },
  'racing-bulls': { name: 'Racing Bulls', members: [['minardi', 1985, 2005, /^minardi/i], ['toro-rosso', 2006, 2019, /^(scuderia )?toro rosso|^str$/i], ['alphatauri', 2020, 2023, /^(scuderia )?alpha ?tauri/i], ['racing-bulls', 2024, 2100, /^(racing bulls|visa cash app rb|rb|vcarb)/i]] },
  audi: { name: 'Audi', members: [['sauber', 1993, 2005, /^sauber/i], ['bmw-sauber', 2006, 2009, /^bmw/i], ['sauber', 2010, 2018, /^sauber/i], ['alfa-romeo-sauber', 2019, 2023, /^alfa romeo/i], ['kick-sauber', 2024, 2025, /^(kick|stake|sauber)/i], ['audi', 2026, 2100, /^audi/i]] },
  'aston-martin': { name: 'Aston Martin', members: [['jordan', 1991, 2005, /^jordan/i], ['midland', 2006, 2006, /^(midland|mf1)/i], ['spyker', 2007, 2007, /^spyker/i], ['force-india', 2008, 2018, /^force india/i], ['racing-point', 2018, 2020, /^racing point/i], ['aston-martin', 2021, 2100, /^aston martin/i]] },
  alpine: { name: 'Alpine', members: [['toleman', 1981, 1985, /^toleman/i], ['benetton', 1986, 2001, /^benetton/i], ['renault-2002', 2002, 2010, /^renault/i], ['lotus-renault-gp', 2011, 2011, /^lotus renault/i], ['lotus-f1', 2012, 2015, /^lotus/i], ['renault-2016', 2016, 2020, /^renault/i], ['alpine', 2021, 2100, /^alpine/i]] },
  mercedes: { name: 'Mercedes', members: [['tyrrell', 1968, 1998, /^tyrrell/i], ['bar', 1999, 2005, /^(bar|british american)/i], ['honda-2006', 2006, 2008, /^honda/i], ['brawn', 2009, 2009, /^brawn/i], ['mercedes', 2010, 2100, /^mercedes/i]] },
  caterham: { name: 'Caterham', members: [['lotus-racing-2010', 2010, 2011, /^(lotus|team lotus|lotus racing)$/i], ['caterham', 2012, 2014, /^caterham/i]] },
  manor: { name: 'Manor', members: [['manor', 2010, 2016, /^(virgin|marussia|manor)/i]] },
};
// Raw-name → lineage.
const LINEAGE_OF = [
  [/^(red bull|jaguar|stewart)/i, 'red-bull'],
  [/^(alpha ?tauri|scuderia alphatauri|toro rosso|scuderia toro rosso|minardi|racing bulls|visa cash app rb|rb|vcarb)$/i, 'racing-bulls'],
  [/^(alfa romeo racing|sauber|bmw sauber|kick sauber|stake|audi)/i, 'audi'],
  [/^alfa romeo$/i, 'audi'],
  [/^(aston martin|racing point|force india|spyker|midland|mf1|jordan)/i, 'aston-martin'],
  [/^(alpine|renault|lotus renault|benetton|toleman)/i, 'alpine'],
  [/^(mercedes|brawn|bar|british american|tyrrell)/i, 'mercedes'],
  [/^honda/i, 'mercedes'],
  [/^caterham/i, 'caterham'],
  [/^(virgin|marussia|manor)/i, 'manor'],
];
const SINGLE = { haas: [2016, 2100], mclaren: [1966, 2100], williams: [1977, 2100], ferrari: [1950, 2100], cadillac: [2026, 2100] };
export const LINEAGE_MEMBER_IDS = new Set(Object.values(LINEAGES).flatMap((l) => l.members.map((m) => m[0])));

const DISPLAY = {
  'red-bull': 'Red Bull Racing', 'racing-bulls': 'Racing Bulls', alphatauri: 'AlphaTauri', 'toro-rosso': 'Toro Rosso', minardi: 'Minardi',
  'kick-sauber': 'Kick Sauber', audi: 'Audi', 'alfa-romeo-sauber': 'Alfa Romeo', 'alfa-romeo-1950': 'Alfa Romeo (1950–51)',
  'alfa-romeo-1979': 'Alfa Romeo (1979–85)', 'bmw-sauber': 'BMW Sauber', sauber: 'Sauber', cadillac: 'Cadillac',
  'aston-martin': 'Aston Martin', 'aston-martin-1959': 'Aston Martin (1959–60)', 'racing-point': 'Racing Point', 'force-india': 'Force India',
  spyker: 'Spyker', midland: 'Midland', jordan: 'Jordan', alpine: 'Alpine', 'renault-2016': 'Renault (2016–20)', 'lotus-f1': 'Lotus F1',
  'lotus-renault-gp': 'Lotus Renault GP', 'renault-2002': 'Renault (2002–10)', 'renault-1977': 'Renault (1977–85)', benetton: 'Benetton',
  toleman: 'Toleman', 'lotus-racing-2010': 'Lotus Racing (2010–11)', caterham: 'Caterham', 'team-lotus': 'Team Lotus',
  mercedes: 'Mercedes', 'mercedes-1954': 'Mercedes (1954–55)', brawn: 'Brawn GP', 'honda-2006': 'Honda (2006–08)', 'honda-1964': 'Honda (1964–68)',
  bar: 'BAR', tyrrell: 'Tyrrell', jaguar: 'Jaguar', stewart: 'Stewart', manor: 'Manor / Marussia / Virgin', hrt: 'HRT', brabham: 'Brabham',
  march: 'March', haas: 'Haas', mclaren: 'McLaren', williams: 'Williams', ferrari: 'Ferrari', toyota: 'Toyota', 'super-aguri': 'Super Aguri',
};

function resolveId(name, season) {
  for (const [re, from, to, id] of HISTORIC) if (season >= from && season <= to && re.test(name)) return { id, how: 'historic' };
  if (/^(lotus|team lotus|lotus racing)$/i.test(name)) {
    if (season >= 2012 && season <= 2015) return { id: 'lotus-f1', how: 'lineage_season' };
    if (season >= 2010 && season <= 2011) return { id: 'lotus-racing-2010', how: 'lineage_season' };
  }
  const lin = LINEAGE_OF.find(([re]) => re.test(name))?.[1];
  if (lin) {
    const members = LINEAGES[lin].members;
    const direct = members.find(([, from, to, re]) => re.test(name) && season >= from && season <= to);
    if (direct) return { id: direct[0], how: 'lineage_name' };
    const bySeason = members.find(([, from, to]) => season >= from && season <= to);
    if (bySeason) return { id: bySeason[0], how: 'lineage_season' };
  }
  const slug = slugify(name);
  if (SINGLE[slug] && season >= SINGLE[slug][0] && season <= SINGLE[slug][1]) return { id: slug, how: 'single' };
  // Never let a fallback id collide with a curated entity outside its seasons.
  if (SINGLE[slug] || LINEAGE_MEMBER_IDS.has(slug) || HISTORIC.some((h) => h[3] === slug)) return { id: `${slug}-${Math.floor(season / 10) * 10}s`, how: 'unresolved' };
  return { id: slug, how: 'name' };
}

export const CONSTRUCTORS = {};
const unresolvedNames = new Map();
const relabels = new Map();

function ensure(id, rawName, season, color, how) {
  let c = CONSTRUCTORS[id];
  if (!c) {
    const lineage = Object.entries(LINEAGES).find(([, l]) => l.members.some((m) => m[0] === id))?.[0] || id;
    c = CONSTRUCTORS[id] = {
      id,
      slug: id,
      name: DISPLAY[id] || rawName,
      lineage_id: lineage,
      source_names: [],
      first_season: season,
      last_season: season,
      colors: {},
      source: 'espn',
      source_id: rawName,
      source_url: null,
      source_updated_at: null,
      identity_source: DISPLAY[id] ? 'pbe_editorial' : 'espn_name',
    };
  }
  if (!c.source_names.includes(rawName)) c.source_names.push(rawName);
  c.first_season = Math.min(c.first_season, season);
  c.last_season = Math.max(c.last_season, season);
  if (color) c.colors[season] = color;
  if (how === 'lineage_season') {
    const k = `${rawName} → ${id}`;
    if (!relabels.has(k)) relabels.set(k, new Set());
    relabels.get(k).add(season);
  }
  return id;
}

export function resolveConstructor(rawName, season, color) {
  const name = String(rawName).trim();
  const { id, how } = resolveId(name, season);
  if (how === 'unresolved' || how === 'name') {
    if (!unresolvedNames.has(name)) unresolvedNames.set(name, new Set());
    unresolvedNames.get(name).add(season);
  }
  return ensure(id, name, season, color, how);
}

const span = (s) => `${Math.min(...s)}–${Math.max(...s)}`;
export function unresolved() {
  return [...unresolvedNames.entries()].map(([n, s]) => `${n} (${span(s)})`).sort();
}
/** Raw names the source back-labelled, re-attributed by season (audit trail). */
export function seasonRelabels() {
  return [...relabels.entries()].map(([k, s]) => `${k} (${span(s)})`).sort();
}
export function lineageChain(lineageId) {
  const l = LINEAGES[lineageId];
  if (!l) return null;
  return [...new Set(l.members.map((m) => m[0]))];
}
