// Intelligence metrics over the published projection (public ids). Every value is computed from classifications,
// standings progression and DNA documents; windows and samples are returned with each metric so pages can show them.
export const FORM_WINDOW = 5;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function seasonFrame(X, season = X.currentSeason) {
  const races = X.completedRaces(season);
  const grid = X.currentGrid.filter((id) => races.some((e) => X.rows(e.id, 'race').some((r) => r.driver_id === id)));
  const teamOf = (id, e) => X.rows(e.id, 'race').find((r) => r.driver_id === id)?.constructor_id;
  return { season, races, grid, teamOf };
}

// driver form: last FORM_WINDOW races vs the FORM_WINDOW before them (points per race, average finish, average quali)
export function driverForm(X, F) {
  const recent = F.races.slice(-FORM_WINDOW), prior = F.races.slice(-2 * FORM_WINDOW, -FORM_WINDOW);
  const stat = (id, evs) => {
    const rows = evs.map((e) => X.rows(e.id, 'race').find((r) => r.driver_id === id)).filter(Boolean);
    const q = evs.map((e) => X.rows(e.id, 'qualifying').find((r) => r.driver_id === id)?.position).filter(Boolean);
    const fin = rows.filter((r) => r.status === 'classified').map((r) => r.position);
    return { races: rows.length, points: rows.reduce((s, r) => s + (r.points || 0), 0), ppr: rows.length ? rows.reduce((s, r) => s + (r.points || 0), 0) / rows.length : null, avg_finish: mean(fin), dnf: rows.filter((r) => r.status !== 'classified').length, avg_quali: mean(q), quali_n: q.length };
  };
  return F.grid.map((id) => {
    const r = stat(id, recent), p = stat(id, prior);
    return { driver_id: id, team_id: X.driver[id]?.team_id, recent: r, prior: p, delta_ppr: r.ppr != null && p.ppr != null && p.races >= 3 && r.races >= 3 ? r.ppr - p.ppr : null, last: recent.map((e) => { const x = X.rows(e.id, 'race').find((y) => y.driver_id === id); return x ? (x.status === 'classified' ? x.position : 'DNF') : null; }) };
  });
}

// constructor form over the same window
export function constructorForm(X, F) {
  const recent = F.races.slice(-FORM_WINDOW);
  const teams = [...new Set(F.grid.map((id) => X.driver[id]?.team_id).filter(Boolean))];
  const prog = X.standingsBy[F.season]?.progression || [];
  const now = prog.at(-1), then = prog.at(-1 - FORM_WINDOW) || prog[0];
  return teams.map((t) => {
    const rows = recent.flatMap((e) => X.rows(e.id, 'race').filter((r) => r.constructor_id === t));
    const q = recent.map((e) => Math.min(...X.rows(e.id, 'qualifying').filter((r) => r.constructor_id === t && r.position).map((r) => r.position))).filter(Number.isFinite);
    return {
      team_id: t,
      points: rows.reduce((s, r) => s + (r.points || 0), 0),
      best_quali_avg: mean(q),
      classified_rate: rows.length ? rows.filter((r) => r.status === 'classified').length / rows.length : null,
      dnf: rows.filter((r) => r.status === 'retired').length,
      starts: rows.length,
      pos_now: now?.constructors?.[t]?.pos ?? null,
      pos_then: then?.constructors?.[t]?.pos ?? null,
      movement: now?.constructors?.[t] && then?.constructors?.[t] ? then.constructors[t].pos - now.constructors[t].pos : null,
    };
  }).sort((a, b) => b.points - a.points);
}

// teammate battle for each current team pairing this season (qualifying from the deepest shared segment)
export function teammateBattles(X, F) {
  const teams = [...new Set(F.grid.map((id) => X.driver[id]?.team_id).filter(Boolean))];
  const out = [];
  for (const t of teams) {
    const pairCount = {};
    for (const e of F.races) {
      const ids = X.rows(e.id, 'race').filter((r) => r.constructor_id === t).map((r) => r.driver_id).sort();
      if (ids.length === 2) pairCount[ids.join('|')] = (pairCount[ids.join('|')] || 0) + 1;
    }
    const pair = Object.entries(pairCount).sort((a, b) => b[1] - a[1])[0];
    if (!pair) continue;
    const [a, b] = pair[0].split('|');
    let qa = 0, qb = 0, ra = 0, rb = 0, pa = 0, pb = 0;
    const gaps = [];
    for (const e of F.races) {
      const rr = X.rows(e.id, 'race'), qq = X.rows(e.id, 'qualifying');
      const A = rr.find((r) => r.driver_id === a && r.constructor_id === t), B = rr.find((r) => r.driver_id === b && r.constructor_id === t);
      if (!A || !B) continue;
      pa += A.points || 0; pb += B.points || 0;
      // both classified decides the race head-to-head (the matchup page uses the same rule)
      if (A.status === 'classified' && B.status === 'classified') (A.position < B.position ? ra++ : rb++);
      const QA = qq.find((r) => r.driver_id === a), QB = qq.find((r) => r.driver_id === b);
      if (QA?.position && QB?.position) (QA.position < QB.position ? qa++ : qb++);
      const k = ['q3_ms', 'q2_ms', 'q1_ms'].find((x) => QA?.[x] && QB?.[x]);
      if (k) { const g = ((QB[k] - QA[k]) / QA[k]) * 100; if (Math.abs(g) <= 5) gaps.push(g); }
    }
    const dna = (id) => X.dnaDriver[id]?.current?.dimensions || {};
    out.push({ team_id: t, a, b, races: pair[1], quali: [qa, qb], race: [ra, rb], points: [pa, pb], median_gap_pct: median(gaps), gap_samples: gaps.length, dna: { a: { q: dna(a).qualifying?.percentile ?? null, r: dna(a).race_result?.percentile ?? null }, b: { q: dna(b).qualifying?.percentile ?? null, r: dna(b).race_result?.percentile ?? null } } });
  }
  const order = constructorForm(X, F).map((c) => c.team_id);
  return out.sort((x, y) => order.indexOf(x.team_id) - order.indexOf(y.team_id));
}

export const DNA_LEADER_DIMS = [['qualifying', 'Qualifying pace'], ['race_result', 'Race results vs teammate'], ['positions_gained', 'Positions gained'], ['finishing', 'Finishing'], ['consistency', 'Consistency'], ['street', 'Street circuits'], ['high_speed', 'High-speed circuits'], ['low_speed', 'Low-speed circuits']];
export function dnaLeaders(X, F, n = 5) {
  return DNA_LEADER_DIMS.map(([key, label]) => ({
    key, label,
    rows: F.grid.map((id) => ({ driver_id: id, dim: X.dnaDriver[id]?.current?.dimensions?.[key] })).filter((x) => x.dim?.percentile != null && x.dim.confidence !== 'low' && x.dim.confidence !== 'insufficient').sort((a, b) => b.dim.percentile - a.dim.percentile).slice(0, n),
  }));
}

export function championship(X, F, n = 8) {
  const prog = X.standingsBy[F.season]?.progression || [];
  const last = prog.at(-1);
  const top = last ? Object.entries(last.drivers).sort((a, b) => a[1].pos - b[1].pos).slice(0, n).map(([id]) => id) : [];
  const topC = last ? Object.entries(last.constructors || {}).sort((a, b) => a[1].pos - b[1].pos).map(([id]) => id) : [];
  return { rounds: prog.map((r) => r.round), top, topC, prog, note: X.standingsBy[F.season]?.progression_note || null };
}

export function nextRace(X, nowIso = new Date().toISOString()) {
  const ev = X.raceEvents(X.currentSeason).find((e) => e.status !== 'completed' && (X.session(e.id, 'race')?.start_utc || e.start_utc) > new Date(Date.parse(nowIso) - 6 * 3600e3).toISOString());
  if (!ev) return null;
  return { ev, circuit: X.circuit[ev.circuit_id], cdna: X.dnaCircuit[ev.circuit_id] || null, fit: X.fit[ev.id] || null };
}
