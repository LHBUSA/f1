// Constructor identity: ESPN reports a per-entry team name ("vehicle.manufacturer").
// A constructor here = one competing entity under one name in a season range.
// A lineage = the franchise (same entrant/factory) across renames, e.g. Sauber → Alfa Romeo → Kick Sauber → Audi.
// Names reused by unrelated entities (Lotus, Renault, Alfa Romeo, Mercedes, Aston Martin, Honda, Brabham…)
// are split by season range so history is never attributed to the wrong team.
// Lineage map is PBE editorial (well-documented team histories), marked source 'pbe_editorial'.

import { slugify } from './normalize.mjs';

// [rawNameRegex, fromSeason, toSeason, constructorId]
const RULES = [
  [/^red bull/i, 2005, 2100, 'red-bull'],
  [/^(racing bulls|visa cash app rb|rb|vcarb)$/i, 2024, 2100, 'racing-bulls'],
  [/^(alphatauri|alpha tauri|scuderia alphatauri)$/i, 2020, 2023, 'alphatauri'],
  [/^(toro rosso|scuderia toro rosso|str)$/i, 2006, 2019, 'toro-rosso'],
  [/^minardi/i, 1985, 2005, 'minardi'],
  [/^(kick sauber|stake|sauber|stake f1|kick)/i, 2024, 2025, 'kick-sauber'],
  [/^audi/i, 2026, 2100, 'audi'],
  [/^alfa romeo/i, 2019, 2023, 'alfa-romeo-sauber'],
  [/^alfa romeo/i, 1950, 1951, 'alfa-romeo-1950'],
  [/^alfa romeo/i, 1963, 1985, 'alfa-romeo-1979'],
  [/^bmw sauber|^bmw$/i, 2006, 2010, 'bmw-sauber'],
  [/^sauber/i, 1993, 2005, 'sauber'],
  [/^sauber/i, 2010, 2018, 'sauber'],
  [/^cadillac/i, 2026, 2100, 'cadillac'],
  [/^aston martin/i, 2021, 2100, 'aston-martin'],
  [/^aston martin/i, 1959, 1960, 'aston-martin-1959'],
  [/^racing point/i, 2019, 2020, 'racing-point'],
  [/^force india/i, 2008, 2018, 'force-india'],
  [/^spyker/i, 2007, 2007, 'spyker'],
  [/^(midland|mf1)/i, 2006, 2006, 'midland'],
  [/^jordan/i, 1991, 2005, 'jordan'],
  [/^alpine/i, 2021, 2100, 'alpine'],
  [/^renault/i, 2016, 2020, 'renault-2016'],
  [/^(lotus f1|lotus renault|lotus)/i, 2012, 2015, 'lotus-f1'],
  [/^(lotus renault gp|renault)/i, 2011, 2011, 'lotus-renault-gp'],
  [/^renault/i, 2002, 2010, 'renault-2002'],
  [/^renault/i, 1977, 1985, 'renault-1977'],
  [/^benetton/i, 1986, 2001, 'benetton'],
  [/^toleman/i, 1981, 1985, 'toleman'],
  [/^(lotus|team lotus|lotus racing)/i, 2010, 2011, 'lotus-racing-2010'],
  [/^caterham/i, 2012, 2014, 'caterham'],
  [/^(lotus|team lotus)/i, 1950, 1994, 'team-lotus'],
  [/^mercedes/i, 2010, 2100, 'mercedes'],
  [/^mercedes/i, 1954, 1955, 'mercedes-1954'],
  [/^brawn/i, 2009, 2009, 'brawn'],
  [/^honda/i, 2006, 2008, 'honda-2006'],
  [/^honda/i, 1964, 1968, 'honda-1964'],
  [/^(bar|british american racing)/i, 1999, 2005, 'bar'],
  [/^tyrrell/i, 1968, 1998, 'tyrrell'],
  [/^jaguar/i, 2000, 2004, 'jaguar'],
  [/^stewart/i, 1997, 1999, 'stewart'],
  [/^(virgin|marussia|manor)/i, 2010, 2016, 'manor'],
  [/^(hrt|hispania)/i, 2010, 2012, 'hrt'],
  [/^brabham/i, 1962, 1992, 'brabham'],
  [/^march/i, 1970, 1992, 'march'],
  [/^haas/i, 2016, 2100, 'haas'],
  [/^mclaren/i, 1966, 2100, 'mclaren'],
  [/^williams/i, 1977, 2100, 'williams'],
  [/^ferrari/i, 1950, 2100, 'ferrari'],
];

// Lineages (franchise chains), newest constructor last.
export const LINEAGES = {
  'red-bull': { name: 'Red Bull Racing', chain: ['stewart', 'jaguar', 'red-bull'] },
  'racing-bulls': { name: 'Racing Bulls', chain: ['minardi', 'toro-rosso', 'alphatauri', 'racing-bulls'] },
  audi: { name: 'Audi', chain: ['sauber', 'bmw-sauber', 'alfa-romeo-sauber', 'kick-sauber', 'audi'] },
  'aston-martin': { name: 'Aston Martin', chain: ['jordan', 'midland', 'spyker', 'force-india', 'racing-point', 'aston-martin'] },
  alpine: { name: 'Alpine', chain: ['toleman', 'benetton', 'renault-2002', 'lotus-renault-gp', 'lotus-f1', 'renault-2016', 'alpine'] },
  mercedes: { name: 'Mercedes', chain: ['tyrrell', 'bar', 'honda-2006', 'brawn', 'mercedes'] },
  'manor': { name: 'Manor', chain: ['manor'] },
  caterham: { name: 'Caterham', chain: ['lotus-racing-2010', 'caterham'] },
};

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
  march: 'March', haas: 'Haas', mclaren: 'McLaren', williams: 'Williams', ferrari: 'Ferrari',
};

export const CONSTRUCTORS = {};
const unresolvedNames = new Map();

function ensure(id, rawName, season, color) {
  let c = CONSTRUCTORS[id];
  if (!c) {
    const lineage = Object.entries(LINEAGES).find(([, l]) => l.chain.includes(id))?.[0] || id;
    c = CONSTRUCTORS[id] = {
      id,
      slug: id,
      name: DISPLAY[id] || rawName,
      lineage_id: lineage,
      aliases: [],
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
  if (!c.aliases.includes(rawName)) c.aliases.push(rawName);
  c.first_season = Math.min(c.first_season, season);
  c.last_season = Math.max(c.last_season, season);
  if (color) c.colors[season] = color;
  return id;
}

export function resolveConstructor(rawName, season, color) {
  const name = String(rawName).trim();
  for (const [re, from, to, id] of RULES) {
    if (season >= from && season <= to && re.test(name)) return ensure(id, name, season, color);
  }
  // Single-entity historical names (Brabham-era privateers, etc.) keep a name-derived id.
  const id = slugify(name);
  if (!unresolvedNames.has(name)) unresolvedNames.set(name, new Set());
  unresolvedNames.get(name).add(season);
  return ensure(id, name, season, color);
}

export function unresolved() {
  return [...unresolvedNames.entries()].map(([n, s]) => `${n} (${Math.min(...s)}–${Math.max(...s)})`).sort();
}
