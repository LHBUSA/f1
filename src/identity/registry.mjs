// Canonical team/car identity for a season (one registry; every PBEcast surface reads it).
// Colours: the PropSports constructors projection (sourced per season). Car numbers and codes: the latest session
// classification. Team marks: src/identity/logo-provenance.json; a mark renders only when approved_public is true,
// otherwise the PropBetEdge team badge (team code + colour) is used.
import fs from 'node:fs';

const luminance = (hex) => { const h = String(hex || '').replace('#', ''); if (h.length !== 6) return 0; const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

export function buildRegistry(X, season = X.currentSeason) {
  const curated = JSON.parse(fs.readFileSync('src/identity/teams-2026.json', 'utf8'));
  const prov = JSON.parse(fs.readFileSync('src/identity/logo-provenance.json', 'utf8'));
  // latest classified session of the season gives car numbers and the team each driver drove for
  const evs = X.raceEvents(season).filter((e) => e.sessions.some((s) => s.results?.length));
  const latest = evs.at(-1);
  const rows = latest ? latest.sessions.filter((s) => s.results?.length).at(-1).results : [];
  const teams = {}, drivers = {};
  for (const [id, t] of Object.entries(curated.teams)) {
    const c = X.con[id];
    const color = (c?.color || '8a93a8').toUpperCase();
    const mark = prov.assets[id];
    teams[id] = { id, name: c?.name || t.display, display: t.display, short: t.short, color, text: (luminance(color) + 0.05) / 0.0545 > 1.05 / (luminance(color) + 0.05) ? '0B0D12' : 'FFFFFF', mark: mark?.approved_public ? { status: 'approved' } : { status: 'held', fallback: 'team_badge' } };
  }
  for (const r of rows) {
    const d = X.driver[r.driver_id];
    if (!d || !teams[r.constructor_id]) continue;
    drivers[d.id] = { id: d.id, name: d.name, last: d.last_name, code: d.code || d.last_name.slice(0, 3).toUpperCase(), number: r.car_number || d.number || null, team: r.constructor_id };
  }
  return { season, version: 'f1-identity@1', source_session: latest ? `${latest.id}` : null, teams, drivers };
}
