import { esc, fmtPts, fmtMs, ordinal, teamClass, headshot, flag, crumbs, jsonLdBreadcrumb, lineChart, fmtDate, timeTag, pct, SITE, fmtNum } from './lib.mjs';
import { driverCell, teamLink, sessionTable, standingsTable, dnaPanel, battleCard, fitList, sessionList, statusPill } from './components.mjs';
import { SESSION_LABEL } from '../../src/core/normalize.mjs';

const age = (dob) => {
  if (!dob) return null;
  const d = new Date(dob);
  const n = new Date();
  let a = n.getUTCFullYear() - d.getUTCFullYear();
  if (n.getUTCMonth() < d.getUTCMonth() || (n.getUTCMonth() === d.getUTCMonth() && n.getUTCDate() < d.getUTCDate())) a--;
  return a;
};
const winnerOf = (ctx, eid) => ctx.rows(eid, 'race').find((r) => r.status === 'classified' && r.position === 1);
const poleOf = (ctx, eid) => ctx.rows(eid, 'qualifying').find((r) => r.position === 1) || ctx.rows(eid, 'race').find((r) => r.grid === 1);
const SESSION_ORDER = ['race', 'sprint', 'qualifying', 'sprint_qualifying', 'fp3', 'fp2', 'fp1'];

// ---------------- HOME ----------------
export function home(ctx) {
  const ev = ctx.nextEvent;
  const season = ctx.currentSeason;
  const last = ctx.lastCompleted;
  const circuit = ev ? ctx.circuitById[ev.circuit_id] : null;
  const nextSession = ev ? [...(ctx.sessionsByEvent[ev.id] || [])].filter((s) => s.state !== 'completed' && s.state !== 'canceled').sort((a, b) => a.start_utc.localeCompare(b.start_utc))[0] : null;
  const gp = ev
    ? `<section class="section"><div class="wrap"><div class="card gp" data-next-event="${esc(ev.id)}">
      <div class="gp-main"><span class="eyebrow">Round ${ev.round} · ${season} · Next Grand Prix</span>
        <h2>${esc(ev.name)}</h2>
        <div class="hero-meta"><span><b>Circuit</b><a href="${ctx.circuitUrl(ev.circuit_id)}">${esc(ctx.circuitName(ev.circuit_id))}</a></span><span><b>Where</b>${esc([circuit?.locality, circuit?.country].filter(Boolean).join(', '))}</span><span><b>Format</b>${ev.sprint ? 'Sprint weekend' : 'Conventional'}</span></div>
        ${nextSession ? `<p class="kicker">Next session: ${esc(SESSION_LABEL[nextSession.type])}</p><div class="countdown" data-countdown="${esc(nextSession.start_utc)}" aria-live="off"><div><b data-d>–</b><span>Days</span></div><div><b data-h>–</b><span>Hrs</span></div><div><b data-m>–</b><span>Min</span></div><div><b data-s>–</b><span>Sec</span></div></div>` : ''}
        <p class="fine" data-weather="${esc(circuit?.slug || '')}" data-weather-from="${esc(ev.start_utc)}" data-weather-to="${esc(ev.end_utc || ev.start_utc)}"></p>
        <p><a class="more" href="${ctx.raceUrl(ev.id)}">Race weekend hub</a></p>
      </div>
      <div class="gp-sessions"><span class="kicker">Session schedule · your local time</span>${sessionList(ctx, ev)}</div>
    </div></div></section>`
    : `<section class="section"><div class="wrap"><div class="card"><h2>${season} season complete</h2><p class="muted">The next calendar has not been published by the source yet.</p></div></div></section>`;

  // Standings
  const stand = `<section class="section"><div class="wrap"><div class="split even">
    <div><div class="section-head"><div><span class="eyebrow">${season} Championship</span><h2>Drivers</h2></div><a class="more" href="/standings">Full standings</a></div>${standingsTable(ctx, season, 'driver', 10, { avatar: true })}</div>
    <div><div class="section-head"><div><span class="eyebrow">${season} Championship</span><h2>Constructors</h2></div><a class="more" href="/standings#constructors">All teams</a></div>${standingsTable(ctx, season, 'constructor', 11)}</div>
  </div></div></section>`;

  // Latest result
  let latest = '';
  if (last) {
    const podium = ctx.rows(last.id, 'race').filter((r) => r.status === 'classified' && r.position <= 3);
    const order = [podium[1], podium[0], podium[2]].filter(Boolean);
    latest = `<div class="card"><span class="eyebrow">Latest result · Round ${last.round}</span><h3><a href="${ctx.raceUrl(last.id)}">${esc(last.name)}</a></h3><p class="fine">${esc(fmtDate(last.end_utc || last.start_utc))} · ${esc(ctx.circuitName(last.circuit_id))}</p>
      <div class="podium">${order.map((r) => `<div class="pp pp${r.position} ${teamClass(ctx.colorOf(r.constructor_id, last.season))}">${headshot(ctx.driverById[r.driver_id], 'md', ctx.mediaOk, ctx.colorOf(r.constructor_id, last.season))}<b>${r.position}</b><a class="nm" href="${ctx.driverUrl(r.driver_id)}">${esc(ctx.driverById[r.driver_id]?.last_name)}</a></div>`).join('')}</div>
      <p><a class="more" href="${ctx.raceUrl(last.id)}">Full classification</a></p></div>`;
  }

  // DNA spotlight: top current qualifier and racecraft
  const dnaTop = (key) =>
    Object.values(ctx.dnaCur)
      .filter((d) => d.dimensions[key]?.percentile != null && ctx.currentGrid.some((g) => g.driver_id === d.driver_id))
      .sort((a, b) => b.dimensions[key].percentile - a.dimensions[key].percentile)
      .slice(0, 3);
  const spot = (key, label) =>
    `<div class="card"><span class="eyebrow">Driver DNA · ${esc(label)}</span>${dnaTop(key)
      .map((d) => {
        const g = ctx.currentGrid.find((x) => x.driver_id === d.driver_id);
        return `<div class="fitrow"><span class="pos">${d.dimensions[key].percentile}</span><div>${driverCell(ctx, d.driver_id, g.constructor_id, season)}<div class="why">n=${d.dimensions[key].sample_size} · ${esc(d.window)}</div></div><span></span></div>`;
      })
      .join('')}<p class="fine">Percentile vs ${esc(Object.values(ctx.dnaCur)[0]?.dimensions[key]?.population || 'grid')}.</p></div>`;

  // Teammate battles current season
  const battles = currentBattles(ctx).slice(0, 6);

  const fit = ev ? ctx.fit[ev.id] : null;
  const recaps = ctx.recaps.slice(0, 4);
  const body = `
  <section class="hero"><div class="wrap"><span class="eyebrow">PropBetEdge Formula 1 Intelligence</span><h1>Every lap that matters,<br>measured.</h1><p class="sub">The ${season} FIA Formula One World Championship from sourced results only: live timing, Driver &amp; Constructor DNA, Circuit Fit, teammate battles and ${ctx.coverage.seasons} seasons of history.</p></div></section>
  ${gp}
  ${stand}
  <section class="section"><div class="wrap"><div class="split">${latest}<div class="grid">${spot('qualifying', 'Qualifying pace vs teammate')}</div></div></div></section>
  <section class="section"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Flagship</span><h2>Teammate Battles ${season}</h2></div><a class="more" href="/matchups">All battles</a></div><div class="grid g3">${battles.map((t) => battleCard(ctx, t, season)).join('')}</div></div></section>
  ${fit ? `<section class="section"><div class="wrap"><div class="split"><div class="card"><div class="section-head"><div><span class="eyebrow">Circuit Fit · ${esc(ctx.circuitName(ev.circuit_id))}</span><h2>Who suits ${esc(ev.name.replace(/ Grand Prix.*/, ''))}</h2></div><a class="more" href="${ctx.raceUrl(ev.id)}#fit">Full fit</a></div>${fitList(ctx, fit, 6)}</div><div class="grid">${spot('positions_gained', 'Race gains')}${spot('finishing', 'Finishing vs teammate')}</div></div></div></section>` : ''}
  <section class="section"><div class="wrap"><div class="section-head"><div><span class="eyebrow">${season} grid</span><h2>Constructors</h2></div><a class="more" href="/teams">All teams</a></div><div class="grid g4">${teamsByStanding(ctx).map((cid) => teamCard(ctx, cid, season)).join('')}</div></div></section>
  <section class="section"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Intelligence</span><h2>Latest race recaps</h2></div><a class="more" href="/news">All recaps</a></div><div class="grid g2">${recaps.map((r) => `<a class="card card-link" href="/news/${r.slug}"><span class="kicker">${esc(fmtDate(r.date))} · Data recap</span><h3>${esc(r.title)}</h3><p class="muted">${esc(r.dek)}</p></a>`).join('')}</div></div></section>`;
  return {
    path: '/',
    title: `F1 ${season} Live, Standings, Driver DNA & Teammate Battles | PropBetEdge F1`,
    description: `Formula 1 ${season} intelligence: next Grand Prix schedule, live timing, championship standings, Driver and Constructor DNA, Circuit Fit and teammate battles, built from sourced results.`,
    body,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: 'PropBetEdge F1', url: SITE + '/' }],
  };
}

// Current pairing per team = the teammate pair with the most shared events this season, ordered by team standing.
export function currentBattles(ctx) {
  const season = ctx.currentSeason;
  return teamsByStanding(ctx)
    .map((cid) => ctx.teammates.filter((t) => t.by_season[season] && t.constructors.includes(cid)).sort((a, b) => b.by_season[season].events - a.by_season[season].events)[0])
    .filter(Boolean);
}
export function teamsByStanding(ctx) {
  const st = ctx.standingsBy[`${ctx.currentSeason}|constructor`] || [];
  const pos = (cid) => st.find((s) => s.subject_id === cid)?.position ?? 99;
  return [...ctx.currentTeams].sort((a, b) => pos(a) - pos(b));
}

function teamCard(ctx, cid, season) {
  const c = ctx.conById[cid];
  const color = ctx.colorOf(cid, season);
  const st = (ctx.standingsBy[`${season}|constructor`] || []).find((s) => s.subject_id === cid);
  const ds = ctx.currentGrid.filter((g) => g.constructor_id === cid);
  const dna = ctx.conDna[season]?.[cid];
  return `<a class="card card-link dcard ${teamClass(color)}" href="/teams/${cid}"><span class="bignum">${st ? st.position : '–'}</span><div><span class="nm">${esc(c?.name)}<small>${st ? fmtPts(st.points) + ' pts' : ''}${dna?.dimensions.qualifying_speed?.raw?.median_gap_to_pole_pct != null ? ` · ${dna.dimensions.qualifying_speed.raw.median_gap_to_pole_pct.toFixed(2)}% to pole` : ''}</small></span><span class="stat">${ds.map((g) => esc(ctx.driverById[g.driver_id]?.last_name)).join(' · ')}</span></div></a>`;
}

// ---------------- RACES ----------------
export function racesIndex(ctx, season, isMain) {
  const evs = ctx.eventsBySeason[season] || [];
  const seasons = Object.keys(ctx.eventsBySeason).map(Number).sort((a, b) => b - a);
  const rows = evs
    .map((e) => {
      const w = winnerOf(ctx, e.id);
      const p = poleOf(ctx, e.id);
      return `<tr><td class="pos">${e.round ?? '—'}</td><td><a href="${ctx.raceUrl(e.id)}"><b>${esc(e.name)}</b></a><div class="fine">${esc(ctx.circuitName(e.circuit_id))}</div></td><td>${esc(fmtDate(e.end_utc || e.start_utc))}</td><td>${statusPill(e)}${e.sprint ? ' <span class="pill pill-sprint">Sprint</span>' : ''}</td><td>${w ? driverCell(ctx, w.driver_id, w.constructor_id, season) : '—'}</td><td>${p ? driverCell(ctx, p.driver_id, p.constructor_id, season) : '—'}</td></tr>`;
    })
    .join('');
  const path = isMain ? '/races' : `/seasons/${season}`;
  const body = `${crumbs([['/', 'Home'], ['/races', 'Races'], ...(isMain ? [] : [[path, String(season)]])])}
  <section class="hero"><div class="wrap"><span class="eyebrow">${season} FIA Formula One World Championship</span><h1>${season} Calendar</h1><p class="sub">${evs.filter((e) => e.round).length} rounds${evs.some((e) => e.status === 'canceled') ? `, ${evs.filter((e) => e.status === 'canceled').length} cancelled` : ''}. Winners, pole-sitters and every session classification.</p></div></section>
  <section class="section"><div class="wrap"><div class="table-wrap"><table><thead><tr><th class="pos">Rd</th><th>Grand Prix</th><th>Date</th><th>Status</th><th>Winner</th><th>Pole</th></tr></thead><tbody>${rows}</tbody></table></div></div></section>
  <section class="section"><div class="wrap"><div class="section-head"><h2>Season archive</h2></div><nav class="season-links" aria-label="Seasons">${seasons.map((y) => `<a href="${y === ctx.currentSeason ? '/races' : `/seasons/${y}`}"${y === season ? ' aria-current="page"' : ''}>${y}</a>`).join('')}</nav></div></section>`;
  return {
    path,
    title: `${season} F1 Calendar, Results & Winners`,
    description: `Every round of the ${season} Formula 1 season: dates, circuits, winners, pole-sitters and full session classifications.`,
    body,
    section: '/races',
    jsonLd: [jsonLdBreadcrumb([['/', 'Home'], ['/races', 'Races'], ...(isMain ? [] : [[path, String(season)]])])],
  };
}

export function racePage(ctx, ev) {
  const c = ctx.circuitById[ev.circuit_id];
  const types = SESSION_ORDER.filter((t) => ctx.rows(ev.id, t).length);
  const w = winnerOf(ctx, ev.id);
  const p = poleOf(ctx, ev.id);
  const race = ctx.rows(ev.id, 'race');
  const fl = race.filter((r) => r.fastest_lap_ms).sort((a, b) => a.fastest_lap_ms - b.fastest_lap_ms)[0];
  const ledMost = [...race].sort((a, b) => (b.laps_led || 0) - (a.laps_led || 0))[0];
  const gainer = race.filter((r) => r.status === 'classified' && r.grid && r.position).sort((a, b) => b.grid - b.position - (a.grid - a.position))[0];
  const dnfs = race.filter((r) => r.status === 'retired' || r.status === 'disqualified' || r.status === 'not_classified');
  const tabs = types.length
    ? `<div class="tabs" role="tablist">${types.map((t, i) => `<button class="tab" role="tab" type="button" aria-selected="${i === 0}" aria-controls="tp-${t}" id="tb-${t}">${esc(SESSION_LABEL[t])}</button>`).join('')}</div>${types.map((t, i) => `<div class="tabpanel" role="tabpanel" id="tp-${t}" aria-labelledby="tb-${t}"${i ? ' hidden' : ''}>${sessionTable(ctx, ev, t)}</div>`).join('')}`
    : '<div class="empty">No session classifications yet. Results appear here after each session is published.</div>';
  const facts = w
    ? `<div class="stats">
      <div class="stat-box"><span>Winner</span><b>${esc(ctx.driverById[w.driver_id]?.code || ctx.driverById[w.driver_id]?.last_name)}</b><span>${teamLink(ctx, w.constructor_id)} · from P${w.grid ?? '?'}</span></div>
      ${p ? `<div class="stat-box"><span>Pole</span><b>${esc(ctx.driverById[p.driver_id]?.code || ctx.driverById[p.driver_id]?.last_name)}</b><span>${p.q3_ms ? fmtMs(p.q3_ms) : ''}</span></div>` : ''}
      ${fl ? `<div class="stat-box"><span>Fastest lap</span><b class="purple">${esc(fl.fastest_lap_text)}</b><span>${esc(ctx.driverById[fl.driver_id]?.last_name)}${fl.fastest_lap_number ? ` · L${fl.fastest_lap_number}` : ''}</span></div>` : ''}
      ${ledMost?.laps_led ? `<div class="stat-box"><span>Most laps led</span><b>${ledMost.laps_led}</b><span>${esc(ctx.driverById[ledMost.driver_id]?.last_name)}</span></div>` : ''}
      ${gainer && gainer.grid - gainer.position > 0 ? `<div class="stat-box"><span>Biggest gain</span><b class="green">+${gainer.grid - gainer.position}</b><span>${esc(ctx.driverById[gainer.driver_id]?.last_name)} P${gainer.grid}→P${gainer.position}</span></div>` : ''}
      <div class="stat-box"><span>Retirements</span><b>${dnfs.length}</b><span>of ${race.filter((r) => ['classified', 'retired', 'disqualified', 'not_classified'].includes(r.status)).length} starters</span></div>
    </div>`
    : '';
  // Championship after this round
  const prog = ctx.progression[ev.season];
  const roundRow = prog?.rounds.find((r) => r.event_id === ev.id);
  const prevRow = prog?.rounds[prog.rounds.indexOf(roundRow) - 1];
  const champ = roundRow && prog.matches_official !== false
    ? `<div class="card"><span class="eyebrow">Championship after round ${ev.round}</span><div class="table-wrap"><table><thead><tr><th class="pos">Pos</th><th>Driver</th><th class="num">Pts</th><th class="num">Δ</th></tr></thead><tbody>${Object.entries(roundRow.drivers)
        .sort((a, b) => a[1].pos - b[1].pos)
        .slice(0, 8)
        .map(([id, v]) => {
          const pv = prevRow?.drivers[id];
          const mv = pv ? pv.pos - v.pos : null;
          const team = race.find((r) => r.driver_id === id)?.constructor_id;
          return `<tr><td class="pos">${v.pos}</td><td>${driverCell(ctx, id, team, ev.season)}</td><td class="num">${fmtPts(v.p)}</td><td class="num">${mv ? (mv > 0 ? `<span class="gain">▲${mv}</span>` : `<span class="loss">▼${-mv}</span>`) : ''}</td></tr>`;
        })
        .join('')}</tbody></table></div><p class="fine">Running totals from published race points.</p></div>`
    : '';
  // Teammate deltas this weekend
  const q = ctx.rows(ev.id, 'qualifying');
  const byTeam = {};
  for (const r of q) if (r.constructor_id) (byTeam[r.constructor_id] ||= []).push(r);
  const tm = Object.entries(byTeam)
    .filter(([, rs]) => rs.length === 2)
    .map(([cid, rs]) => {
      const [a, b] = rs.sort((x, y) => x.position - y.position);
      let d = null;
      for (const k of ['q3_ms', 'q2_ms', 'q1_ms']) if (a[k] && b[k]) { d = ((b[k] - a[k]) / a[k]) * 100; break; }
      return `<tr><td>${teamLink(ctx, cid)}</td><td>${driverCell(ctx, a.driver_id, cid, ev.season)}</td><td class="num">${d != null ? '+' + d.toFixed(3) + '%' : '—'}</td><td>${driverCell(ctx, b.driver_id, cid, ev.season)}</td></tr>`;
    })
    .join('');
  const fit = ctx.fit[ev.id];
  const history = (ctx.eventsByCircuit[ev.circuit_id] || []).filter((e) => e.season < ev.season && e.status === 'completed').slice(-8).reverse();
  const isPast = ev.status === 'completed';
  const breadcrumb = [['/', 'Home'], ['/races', 'Races'], [ev.season === ctx.currentSeason ? '/races' : `/seasons/${ev.season}`, String(ev.season)], [`/races/${ev.slug}`, ev.name]];
  const body = `${crumbs(breadcrumb)}
  <section class="hero"><div class="wrap"><span class="eyebrow">Round ${ev.round ?? '—'} · ${ev.season} ${ev.sprint ? '· Sprint weekend' : ''}</span><h1>${esc(ev.name)}</h1>
  <div class="hero-meta"><span><b>Circuit</b><a href="${ctx.circuitUrl(ev.circuit_id)}">${esc(ctx.circuitName(ev.circuit_id))}</a></span><span><b>Location</b>${esc([c?.locality, c?.country].filter(Boolean).join(', '))}</span><span><b>Dates</b>${esc(fmtDate(ev.start_utc, false))} – ${esc(fmtDate(ev.end_utc || ev.start_utc))}</span><span>${statusPill(ev)}</span></div>
  ${ev.official_name !== ev.name ? `<p class="fine">Official event name: ${esc(ev.official_name)}</p>` : ''}</div></section>
  ${facts ? `<section class="section"><div class="wrap">${facts}</div></section>` : ''}
  <section class="section"><div class="wrap"><div class="split"><div><div class="section-head"><h2>Classification</h2></div>${tabs}</div><div class="grid">
    <div class="card"><span class="kicker">Session schedule</span>${sessionList(ctx, ev)}${!isPast ? `<p class="fine" data-weather="${esc(c?.slug || '')}" data-weather-from="${esc(ev.start_utc)}" data-weather-to="${esc(ev.end_utc || ev.start_utc)}"></p>` : ''}</div>
    ${champ}
    ${tm ? `<div class="card"><span class="eyebrow">Teammate qualifying gaps</span><div class="table-wrap"><table><thead><tr><th>Team</th><th>Ahead</th><th class="num">Gap</th><th>Behind</th></tr></thead><tbody>${tm}</tbody></table></div><p class="fine">Deepest knockout session both drivers set a time in.</p></div>` : ''}
  </div></div></div></section>
  ${fit ? `<section class="section" id="fit"><div class="wrap"><div class="card"><div class="section-head"><div><span class="eyebrow">Circuit Fit</span><h2>Driver × circuit profile</h2></div></div>${fitList(ctx, fit, 22)}</div></div></section>` : ''}
  ${history.length ? `<section class="section"><div class="wrap"><div class="section-head"><h2>Recent winners at ${esc(ctx.circuitName(ev.circuit_id))}</h2><a class="more" href="${ctx.circuitUrl(ev.circuit_id)}">Circuit DNA</a></div><div class="table-wrap"><table><thead><tr><th>Season</th><th>Event</th><th>Winner</th><th>Team</th><th class="num">Grid</th></tr></thead><tbody>${history
    .map((h) => {
      const hw = winnerOf(ctx, h.id);
      return `<tr><td>${h.season}</td><td><a href="${ctx.raceUrl(h.id)}">${esc(h.name)}</a></td><td>${hw ? driverCell(ctx, hw.driver_id, hw.constructor_id, h.season) : '—'}</td><td>${hw ? teamLink(ctx, hw.constructor_id) : ''}</td><td class="num">${hw?.grid ?? '—'}</td></tr>`;
    })
    .join('')}</tbody></table></div></div></section>` : ''}`;
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'SportsEvent',
      name: `${ev.season} ${ev.name}`,
      startDate: ev.start_utc,
      endDate: ev.end_utc || ev.start_utc,
      eventStatus: ev.status === 'canceled' ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
      sport: 'Formula One',
      location: { '@type': 'Place', name: ctx.circuitName(ev.circuit_id), address: [c?.locality, c?.country].filter(Boolean).join(', '), ...(c?.lat != null ? { geo: { '@type': 'GeoCoordinates', latitude: c.lat, longitude: c.lon } } : {}) },
      url: SITE + `/races/${ev.slug}`,
    },
    jsonLdBreadcrumb(breadcrumb),
  ];
  const desc = w
    ? `${ev.season} ${ev.name} results: ${ctx.driverById[w.driver_id]?.full_name} won for ${ctx.conById[w.constructor_id]?.name}. Full race, qualifying, sprint and practice classifications, teammate gaps and championship impact.`
    : `${ev.season} ${ev.name} at ${ctx.circuitName(ev.circuit_id)}: session schedule, Circuit Fit, recent winners and live classification.`;
  return { path: `/races/${ev.slug}`, title: `${ev.season} ${ev.name} ${w ? 'Results' : 'Schedule & Preview'}`, description: desc, body, jsonLd, section: '/races', ogType: 'article' };
}

// ---------------- DRIVERS ----------------
export function driversIndex(ctx) {
  const season = ctx.currentSeason;
  const grid = ctx.currentGrid
    .map((g) => {
      const d = ctx.driverById[g.driver_id];
      const st = (ctx.standingsBy[`${season}|driver`] || []).find((s) => s.subject_id === g.driver_id);
      const color = ctx.colorOf(g.constructor_id, season);
      const num = (ctx.dcsByDriver[g.driver_id] || []).find((x) => x.season === season)?.car_numbers?.[0];
      return { st, html: `<a class="card card-link dcard ${teamClass(color)}" href="/drivers/${d.slug}">${headshot(d, 'md', ctx.mediaOk, color)}<div><span class="nm">${esc(d.full_name)}<small>${flag(d.flag_url, d.nationality)} ${esc(ctx.conById[g.constructor_id]?.name)}${num ? ' · #' + esc(num) : ''}</small></span><span class="stat">${st ? `P${st.position} · ${fmtPts(st.points)} pts · ${st.wins ?? 0} wins` : ''}</span></div></a>` };
    })
    .sort((a, b) => (a.st?.position ?? 99) - (b.st?.position ?? 99))
    .map((x) => x.html)
    .join('');
  const all = [...ctx.drivers].filter((d) => ctx.careers[d.id]?.entries).sort((a, b) => (a.last_name || a.full_name).localeCompare(b.last_name || b.full_name));
  const list = all.map((d) => `<a href="/drivers/${d.slug}" data-name="${esc((d.full_name || '').toLowerCase())}">${esc(d.full_name)}<span>${ctx.careers[d.id].first_season}–${ctx.careers[d.id].last_season}</span></a>`).join('');
  const body = `${crumbs([['/', 'Home'], ['/drivers', 'Drivers']])}
  <section class="hero"><div class="wrap"><span class="eyebrow">${season} grid</span><h1>Drivers</h1><p class="sub">${ctx.currentGrid.length} drivers on the ${season} grid and ${all.length.toLocaleString()} world championship drivers since ${ctx.coverage.earliest_season}.</p></div></section>
  <section class="section"><div class="wrap"><div class="grid g3">${grid}</div></div></section>
  <section class="section"><div class="wrap"><div class="section-head"><h2>All-time index</h2><input class="search" type="search" placeholder="Filter drivers" aria-label="Filter drivers" data-filter=".alpha a"></div><div class="alpha">${list}</div></div></section>`;
  return { path: '/drivers', title: `F1 Drivers ${season}: Grid, Profiles & Driver DNA`, description: `Every ${season} Formula 1 driver plus ${all.length.toLocaleString()} championship drivers since ${ctx.coverage.earliest_season}: career records, Driver DNA and teammate battles.`, body, jsonLd: [jsonLdBreadcrumb([['/', 'Home'], ['/drivers', 'Drivers']])] };
}

export function driverPage(ctx, d) {
  const car = ctx.careers[d.id];
  const lt = ctx.latestTeam[d.id];
  const color = ctx.colorOf(lt?.constructor_id, lt?.season);
  const onGrid = ctx.currentGrid.some((g) => g.driver_id === d.id);
  const dnaC = ctx.dnaCur[d.id];
  const dnaK = ctx.dnaCareer[d.id];
  const seasons = Object.values(groupBy(ctx.driverLog[d.id] || [], (x) => x.season))
    .map((rows) => {
      const y = rows[0].season;
      const st = (ctx.standingsBy[`${y}|driver`] || []).find((s) => s.subject_id === d.id);
      const teams = [...new Set(rows.map((r) => r.constructor_id))];
      const cls = rows.filter((r) => r.classified);
      return `<tr><td><a href="${y === ctx.currentSeason ? '/standings' : `/standings/${y}`}">${y}</a></td><td>${teams.map((t) => teamLink(ctx, t)).join(', ')}</td><td class="num">${rows.filter((r) => r.started).length}</td><td class="num">${cls.filter((r) => r.finish === 1).length}</td><td class="num">${cls.filter((r) => r.finish <= 3).length}</td><td class="num">${rows.filter((r) => r.pole).length}</td><td class="num">${fmtPts(st?.points ?? rows.reduce((s, r) => s + r.points, 0))}</td><td class="num">${st ? ordinal(st.position) : '—'}</td></tr>`;
    })
    .reverse()
    .join('');
  const recent = (ctx.driverLog[d.id] || []).slice(-12).reverse();
  const recentRows = recent
    .map((x) => {
      const ev = ctx.eventById[x.event_id];
      return `<tr><td>${ev.season}</td><td><a href="${ctx.raceUrl(ev.id)}">${esc(ev.name)}</a></td><td>${teamLink(ctx, x.constructor_id)}</td><td class="num">${x.quali_pos ?? '—'}</td><td class="num">${x.grid || '—'}</td><td class="num">${x.classified ? x.finish : `<span class="st-ret">${x.status === 'retired' ? 'DNF' : esc(x.status || '—')}</span>`}</td><td class="num">${x.points ? fmtPts(x.points) : ''}</td></tr>`;
    })
    .join('');
  const mates = (ctx.teammatesByDriver[d.id] || []).sort((a, b) => b.seasons.at(-1) - a.seasons.at(-1)).slice(0, 12);
  const mateRows = mates
    .map((t) => {
      const flip = t.b === d.id;
      const o = flip ? t.a : t.b;
      const s = t.career;
      const q = flip ? [s.quali_h2h[1], s.quali_h2h[0]] : s.quali_h2h;
      const r = flip ? [s.race_h2h[1], s.race_h2h[0]] : s.race_h2h;
      const url = ctx.matchupUrl(t.a, t.b);
      return `<tr><td>${driverCell(ctx, o, t.constructors.at(-1), t.seasons.at(-1))}</td><td>${t.constructors.map((c) => teamLink(ctx, c)).join(', ')}</td><td>${t.seasons[0]}${t.seasons.length > 1 ? '–' + t.seasons.at(-1) : ''}</td><td class="num">${q[0]}–${q[1]}</td><td class="num">${r[0]}–${r[1]}</td><td>${url ? `<a class="more" href="${url}">Battle</a>` : ''}</td></tr>`;
    })
    .join('');
  const num = (ctx.dcsByDriver[d.id] || []).sort((a, b) => b.season - a.season)[0]?.car_numbers?.[0];
  const thin = (car?.entries || 0) < 3;
  const bc = [['/', 'Home'], ['/drivers', 'Drivers'], [`/drivers/${d.slug}`, d.full_name]];
  const body = `${crumbs(bc)}
  <section class="hero ${teamClass(color)}"><div class="wrap hero-person">${headshot(d, 'lg', ctx.mediaOk, color)}<div>
    <span class="eyebrow">${onGrid ? `${ctx.currentSeason} · ${esc(ctx.conById[lt.constructor_id]?.name)}` : `Formula 1 driver · ${car?.first_season ?? ''}–${car?.last_season ?? ''}`}</span>
    <h1>${esc(d.full_name)}</h1>
    <div class="hero-meta">${d.nationality ? `<span><b>Nationality</b>${flag(d.flag_url, d.nationality)} ${esc(d.nationality)}</span>` : ''}${d.date_of_birth ? `<span><b>Born</b>${esc(fmtDate(d.date_of_birth))}${onGrid ? ` (${age(d.date_of_birth)})` : ''}</span>` : ''}${d.code ? `<span><b>Code</b>${esc(d.code)}</span>` : ''}${num ? `<span><b>Number</b>${esc(num)}</span>` : ''}${lt ? `<span><b>${onGrid ? 'Team' : 'Last team'}</b>${teamLink(ctx, lt.constructor_id)}</span>` : ''}</div>
    <div class="team-stripe"></div></div></div></section>
  <section class="section"><div class="wrap"><div class="stats">
    <div class="stat-box"><span>Starts</span><b>${car?.starts ?? 0}</b></div><div class="stat-box"><span>Wins</span><b>${car?.wins ?? 0}</b></div><div class="stat-box"><span>Podiums</span><b>${car?.podiums ?? 0}</b></div><div class="stat-box"><span>Poles</span><b>${car?.poles ?? 0}</b></div><div class="stat-box"><span>Points</span><b>${fmtPts(car?.points ?? 0)}</b></div><div class="stat-box"><span>Titles</span><b>${car?.championships.length ?? 0}</b>${car?.championships.length ? `<span>${car.championships.join(', ')}</span>` : ''}</div>
  </div><p class="fine">Career totals from published race classifications in the source (${ctx.coverage.earliest_season}–${ctx.currentSeason}). Poles use the qualifying classification where published, otherwise grid position 1. ${esc(car?.points_note || '')}</p></div></section>
  ${dnaC || dnaK ? `<section class="section"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Driver DNA</span><h2>Profile</h2></div><a class="more" href="/methodology#driver-dna">Methodology</a></div>
    <div class="tabs" role="tablist">${dnaC ? `<button class="tab" role="tab" type="button" aria-selected="true" aria-controls="dna-cur" id="dt-cur">${esc(dnaC.window)}</button>` : ''}${dnaK ? `<button class="tab" role="tab" type="button" aria-selected="${dnaC ? 'false' : 'true'}" aria-controls="dna-car" id="dt-car">Career</button>` : ''}</div>
    ${dnaC ? `<div class="tabpanel" role="tabpanel" id="dna-cur" aria-labelledby="dt-cur">${dnaPanel(dnaC, { color: color || 'ff4d2e' })}</div>` : ''}
    ${dnaK ? `<div class="tabpanel" role="tabpanel" id="dna-car" aria-labelledby="dt-car"${dnaC ? ' hidden' : ''}>${dnaPanel(dnaK, { color: color || 'ff4d2e', title: 'Career DNA' })}</div>` : ''}
  </div></section>` : ''}
  ${mateRows ? `<section class="section"><div class="wrap"><div class="section-head"><h2>Teammate record</h2></div><div class="table-wrap"><table><thead><tr><th>Teammate</th><th>Team</th><th>Seasons</th><th class="num">Quali H2H</th><th class="num">Race H2H</th><th></th></tr></thead><tbody>${mateRows}</tbody></table></div></div></section>` : ''}
  <section class="section"><div class="wrap"><div class="split"><div><div class="section-head"><h2>Recent races</h2></div><div class="table-wrap"><table><thead><tr><th>Season</th><th>Event</th><th>Team</th><th class="num">Quali</th><th class="num">Grid</th><th class="num">Finish</th><th class="num">Pts</th></tr></thead><tbody>${recentRows}</tbody></table></div></div>
  <div><div class="section-head"><h2>By season</h2></div><div class="table-wrap"><table><thead><tr><th>Year</th><th>Team</th><th class="num">Starts</th><th class="num">W</th><th class="num">Pod</th><th class="num">Poles</th><th class="num">Pts</th><th class="num">Pos</th></tr></thead><tbody>${seasons}</tbody></table></div></div></div></div></section>`;
  const jsonLd = [
    { '@context': 'https://schema.org', '@type': 'Person', name: d.full_name, ...(d.date_of_birth ? { birthDate: d.date_of_birth } : {}), ...(d.nationality ? { nationality: d.nationality } : {}), jobTitle: 'Racing driver', url: SITE + `/drivers/${d.slug}`, ...(lt ? { memberOf: { '@type': 'SportsTeam', name: ctx.conById[lt.constructor_id]?.name } } : {}) },
    jsonLdBreadcrumb(bc),
  ];
  const desc = `${d.full_name} F1 profile: ${car?.starts ?? 0} starts, ${car?.wins ?? 0} wins, ${car?.podiums ?? 0} podiums, ${car?.poles ?? 0} poles${car?.championships.length ? `, ${car.championships.length} world title${car.championships.length > 1 ? 's' : ''}` : ''}. Driver DNA, teammate head-to-heads and every result.`;
  return { path: `/drivers/${d.slug}`, title: `${d.full_name} – F1 Stats, Driver DNA & Results`, description: desc, body, jsonLd, noindex: thin, section: '/drivers', ogType: 'profile' };
}

// ---------------- TEAMS ----------------
export function teamsIndex(ctx) {
  const season = ctx.currentSeason;
  const all = [...ctx.constructors].sort((a, b) => b.last_season - a.last_season || a.name.localeCompare(b.name));
  const body = `${crumbs([['/', 'Home'], ['/teams', 'Teams']])}
  <section class="hero"><div class="wrap"><span class="eyebrow">${season} constructors</span><h1>Teams</h1><p class="sub">${ctx.currentTeams.length} constructors in ${season}, with franchise lineage and Constructor DNA. ${all.length} constructors in the record since ${ctx.coverage.earliest_season}.</p></div></section>
  <section class="section"><div class="wrap"><div class="grid g4">${teamsByStanding(ctx).map((cid) => teamCard(ctx, cid, season)).join('')}</div></div></section>
  <section class="section"><div class="wrap"><div class="section-head"><h2>All constructors</h2><input class="search" type="search" placeholder="Filter teams" aria-label="Filter teams" data-filter=".alpha a"></div><div class="alpha">${all.map((c) => `<a href="/teams/${c.id}" data-name="${esc(c.name.toLowerCase())}">${esc(c.name)}<span>${c.first_season}–${c.last_season}</span></a>`).join('')}</div></div></section>`;
  return { path: '/teams', title: `F1 Teams ${season}: Constructors, Lineage & Constructor DNA`, description: `All ${ctx.currentTeams.length} Formula 1 constructors in ${season} — Audi, Cadillac and the established teams — with lineage, drivers, standings and Constructor DNA.`, body, jsonLd: [jsonLdBreadcrumb([['/', 'Home'], ['/teams', 'Teams']])] };
}

export function teamPage(ctx, c, lineageChain) {
  const season = ctx.currentSeason;
  const lastSeason = c.last_season;
  const color = ctx.colorOf(c.id, lastSeason);
  const chain = (lineageChain(c.lineage_id) || [c.id]).filter((id) => ctx.conById[id]);
  const dcs = ctx.dcsByCon[c.id] || [];
  const bySeason = groupBy(dcs, (x) => x.season);
  const seasonRows = Object.keys(bySeason)
    .map(Number)
    .sort((a, b) => b - a)
    .map((y) => {
      const st = (ctx.standingsBy[`${y}|constructor`] || []).find((s) => s.subject_id === c.id);
      const ds = bySeason[y].sort((a, b) => b.race_starts - a.race_starts).filter((x) => x.race_starts > 0);
      return `<tr><td><a href="${y === season ? '/standings' : `/standings/${y}`}">${y}</a></td><td>${ds.map((x) => `<a href="${ctx.driverUrl(x.driver_id)}">${esc(ctx.driverById[x.driver_id]?.last_name || x.driver_id)}</a>`).join(', ')}</td><td class="num">${st ? ordinal(st.position) : '—'}</td><td class="num">${st ? fmtPts(st.points) : '—'}</td><td class="num">${st?.wins ?? '—'}</td></tr>`;
    })
    .join('');
  const dna = ctx.conDna[lastSeason]?.[c.id];
  const pair = ctx.teammates.filter((t) => t.constructors.includes(c.id) && t.by_season[lastSeason]).sort((a, b) => b.by_season[lastSeason].events - a.by_season[lastSeason].events)[0];
  const titles = ctx.standings.filter((s) => s.kind === 'constructor' && s.subject_id === c.id && s.position === 1 && s.season < season).map((s) => s.season);
  const wins = ctx.results.filter((r) => r.session_type === 'race' && r.constructor_id === c.id && r.status === 'classified' && r.position === 1).length;
  const podiums = ctx.results.filter((r) => r.session_type === 'race' && r.constructor_id === c.id && r.status === 'classified' && r.position <= 3).length;
  const races = new Set(ctx.results.filter((r) => r.session_type === 'race' && r.constructor_id === c.id).map((r) => r.event_id)).size;
  const bc = [['/', 'Home'], ['/teams', 'Teams'], [`/teams/${c.id}`, c.name]];
  const body = `${crumbs(bc)}
  <section class="hero ${teamClass(color)}"><div class="wrap"><span class="eyebrow">${c.first_season}–${c.last_season === season ? 'present' : c.last_season}</span><h1>${esc(c.name)}</h1>
  <div class="hero-meta">${c.source_names.length ? `<span><b>Source labels</b>${esc(c.source_names.join(', '))}</span>` : ''}${titles.length ? `<span><b>Constructors' titles</b>${titles.length} (${titles.join(', ')})</span>` : ''}</div><div class="team-stripe"></div>
  ${chain.length > 1 ? `<div class="section"><span class="kicker">Franchise lineage</span><div class="lineage">${chain.map((id, i) => `${i ? '<i>→</i>' : ''}${id === c.id ? `<span class="cur">${esc(ctx.conById[id].name)}</span>` : `<a href="/teams/${id}">${esc(ctx.conById[id].name)}</a>`}`).join('')}</div><p class="fine">Lineage is PropBetEdge editorial grouping of the same entrant across renames; each name keeps its own record.</p></div>` : ''}</div></section>
  <section class="section"><div class="wrap"><div class="stats"><div class="stat-box"><span>Grands Prix</span><b>${races}</b></div><div class="stat-box"><span>Wins</span><b>${wins}</b></div><div class="stat-box"><span>Podiums</span><b>${podiums}</b></div><div class="stat-box"><span>Titles</span><b>${titles.length}</b></div></div></div></section>
  ${dna ? `<section class="section"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Constructor DNA · ${lastSeason}</span><h2>Car profile</h2></div><a class="more" href="/methodology#constructor-dna">Methodology</a></div>${dnaPanel(dna, { color: color || 'ff4d2e', title: 'Constructor DNA', note: 'Driver Pairing Balance isolates the driver effect; the other dimensions describe the car/team.' })}</div></section>` : ''}
  ${pair ? `<section class="section"><div class="wrap"><div class="section-head"><h2>Teammate battle ${lastSeason}</h2></div><div class="grid g2">${battleCard(ctx, pair, lastSeason)}</div></div></section>` : ''}
  <section class="section"><div class="wrap"><div class="section-head"><h2>Season by season</h2></div><div class="table-wrap"><table><thead><tr><th>Season</th><th>Drivers</th><th class="num">Pos</th><th class="num">Pts</th><th class="num">Wins</th></tr></thead><tbody>${seasonRows}</tbody></table></div></div></section>`;
  return {
    path: `/teams/${c.id}`,
    title: `${c.name} F1 Team – Results, Drivers & Constructor DNA`,
    description: `${c.name} in Formula 1 (${c.first_season}–${c.last_season}): ${races} Grands Prix, ${wins} wins, ${podiums} podiums, drivers by season${dna ? ', Constructor DNA' : ''} and franchise lineage.`,
    body,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'SportsTeam', name: c.name, sport: 'Formula One', url: SITE + `/teams/${c.id}` }, jsonLdBreadcrumb(bc)],
    section: '/teams',
    noindex: races < 2,
  };
}

// ---------------- CIRCUITS ----------------
export function circuitsIndex(ctx) {
  const season = ctx.currentSeason;
  const curIds = new Set((ctx.eventsBySeason[season] || []).filter((e) => e.status !== 'canceled').map((e) => e.circuit_id));
  const cur = ctx.circuits.filter((c) => curIds.has(c.id));
  const rest = ctx.circuits.filter((c) => !curIds.has(c.id)).sort((a, b) => (ctx.circuitDna[b.id]?.races_held || 0) - (ctx.circuitDna[a.id]?.races_held || 0));
  const card = (c) => {
    const dna = ctx.circuitDna[c.id];
    return `<a class="card card-link" href="/circuits/${c.slug}"><span class="kicker">${flag(c.flag_url, c.country)} ${esc([c.locality, c.country].filter(Boolean).join(', '))}</span><h3>${esc(c.wikidata_name || c.name)}</h3><p class="fine">${c.length_km ? c.length_km.toFixed(3) + ' km' : ''}${c.turns ? ` · ${c.turns} turns` : ''}${dna?.races_held ? ` · ${dna.races_held} GPs` : ''}${dna?.speed_class ? ` · ${dna.speed_class}-speed` : ''}${c.layout_type ? ` · ${esc(c.layout_type)}` : ''}</p></a>`;
  };
  const body = `${crumbs([['/', 'Home'], ['/circuits', 'Circuits']])}
  <section class="hero"><div class="wrap"><span class="eyebrow">Circuit DNA</span><h1>Circuits</h1><p class="sub">${cur.length} venues on the ${season} calendar and ${ctx.circuits.length} championship circuits since ${ctx.coverage.earliest_season}.</p></div></section>
  <section class="section"><div class="wrap"><div class="section-head"><h2>${season} calendar venues</h2></div><div class="grid g3">${cur.map(card).join('')}</div></div></section>
  <section class="section"><div class="wrap"><div class="section-head"><h2>Historic circuits</h2></div><div class="grid g4">${rest.map(card).join('')}</div></div></section>`;
  return { path: '/circuits', title: `F1 Circuits: ${season} Calendar Venues & Circuit DNA`, description: `Every Formula 1 circuit: layout facts, Circuit DNA (track position, overtaking, attrition, lap speed), winners and history.`, body, jsonLd: [jsonLdBreadcrumb([['/', 'Home'], ['/circuits', 'Circuits']])] };
}

export function circuitPage(ctx, c, outline) {
  const dna = ctx.circuitDna[c.id];
  const evs = (ctx.eventsByCircuit[c.id] || []).sort((a, b) => b.start_utc.localeCompare(a.start_utc));
  const next = evs.find((e) => e.season === ctx.currentSeason && e.status !== 'completed' && e.status !== 'canceled');
  const dims = dna
    ? Object.values(dna.dimensions)
        .map((d) => `<div class="dna-row"><div class="dna-top"><h4>${esc(d.label)}</h4><span class="conf conf-${d.confidence}">${esc(d.confidence)}</span></div><div class="bar bar-${d.percentile >= 75 ? 'hi' : d.percentile >= 40 ? 'mid' : 'lo'}${d.percentile == null ? ' bar-empty' : ''}"><span class="w-${d.percentile ?? 0}"></span>${d.percentile != null ? `<b>${d.percentile}</b>` : ''}</div><p class="dna-detail">${esc(d.basis)} · value ${d.value ?? '—'} · n=${d.sample_size}</p></div>`)
        .join('')
    : '';
  const winRows = evs
    .filter((e) => e.status === 'completed')
    .slice(0, 25)
    .map((e) => {
      const w = winnerOf(ctx, e.id);
      const p = poleOf(ctx, e.id);
      return `<tr><td>${e.season}</td><td><a href="${ctx.raceUrl(e.id)}">${esc(e.name)}</a></td><td>${w ? driverCell(ctx, w.driver_id, w.constructor_id, e.season) : '—'}</td><td>${w ? teamLink(ctx, w.constructor_id) : ''}</td><td>${p ? esc(ctx.driverById[p.driver_id]?.last_name) : '—'}</td></tr>`;
    })
    .join('');
  const tops = (arr, kind) => arr.map((x) => `<li>${kind === 'd' ? `<a href="${ctx.driverUrl(x.id)}">${esc(ctx.driverById[x.id]?.full_name)}</a>` : teamLink(ctx, x.id)} — ${x.wins}</li>`).join('');
  const bc = [['/', 'Home'], ['/circuits', 'Circuits'], [`/circuits/${c.slug}`, c.wikidata_name || c.name]];
  const body = `${crumbs(bc)}
  <section class="hero"><div class="wrap"><span class="eyebrow">${flag(c.flag_url, c.country)} ${esc([c.locality, c.country].filter(Boolean).join(', '))}</span><h1>${esc(c.wikidata_name || c.name)}</h1>
  <div class="hero-meta">${c.length_km ? `<span><b>Length</b>${c.length_km.toFixed(3)} km</span>` : ''}${c.turns ? `<span><b>Turns</b>${c.turns}</span>` : ''}${dna?.race_laps ? `<span><b>Race laps</b>${dna.race_laps}</span>` : ''}${dna?.race_distance_km ? `<span><b>Distance</b>${dna.race_distance_km} km</span>` : ''}${c.layout_type ? `<span><b>Layout</b>${esc(c.layout_type)}</span>` : ''}${c.lat != null ? `<span><b>Coordinates</b>${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}</span>` : ''}${c.opened ? `<span><b>Opened</b>${c.opened}</span>` : ''}${dna?.races_held ? `<span><b>Grands Prix</b>${dna.races_held} (${dna.first_season}–${dna.last_season})</span>` : ''}</div>
  ${next ? `<p class="section"><a class="more" href="${ctx.raceUrl(next.id)}">${next.season} ${esc(next.name)} hub</a></p>` : ''}</div></section>
  <section class="section"><div class="wrap"><div class="split">
    <div class="card"><div class="section-head"><div><span class="eyebrow">Circuit DNA</span><h2>Profile</h2></div><a class="more" href="/methodology#circuit-dna">Methodology</a></div>${dims || '<div class="empty">Not enough recent races to profile.</div>'}${dna ? `<div class="unavail">${Object.keys(dna.unavailable).map((k) => `<span title="${esc(dna.unavailable[k])}">${esc(k.replace(/_/g, ' '))}: not sourced</span>`).join('')}</div>` : ''}</div>
    <div class="grid">
      ${outline || ''}
      ${dna ? `<div class="card"><span class="kicker">Last 10 seasons</span><div class="stats"><div class="stat-box"><span>Pole → win</span><b>${pct(dna.pole_win_rate)}</b></div><div class="stat-box"><span>Front-row wins</span><b>${pct(dna.front_row_win_rate)}</b></div><div class="stat-box"><span>Grid↔finish ρ</span><b>${dna.grid_finish_rho ?? '—'}</b></div><div class="stat-box"><span>Pole lap avg</span><b>${dna.pole_lap_speed_kmh ? Math.round(dna.pole_lap_speed_kmh) : '—'}</b><span>km/h</span></div><div class="stat-box"><span>Attrition</span><b>${pct(dna.attrition_rate)}</b></div><div class="stat-box"><span>Stops / car</span><b>${dna.stops_per_car ?? '—'}</b></div></div></div>` : ''}
      ${dna?.top_drivers?.length ? `<div class="card"><span class="kicker">Most wins here</span><div class="split even"><ol>${tops(dna.top_drivers, 'd')}</ol><ol>${tops(dna.top_constructors, 'c')}</ol></div></div>` : ''}
    </div></div></div></section>
  ${winRows ? `<section class="section"><div class="wrap"><div class="section-head"><h2>Winners</h2></div><div class="table-wrap"><table><thead><tr><th>Season</th><th>Event</th><th>Winner</th><th>Team</th><th>Pole</th></tr></thead><tbody>${winRows}</tbody></table></div></div></section>` : ''}`;
  return {
    path: `/circuits/${c.slug}`,
    title: `${c.wikidata_name || c.name} – F1 Circuit DNA, Winners & Facts`,
    description: `${c.wikidata_name || c.name} (${[c.locality, c.country].filter(Boolean).join(', ')}): ${c.length_km ? c.length_km.toFixed(3) + ' km, ' : ''}${c.turns ? c.turns + ' turns, ' : ''}Circuit DNA, pole conversion, overtaking, winners and Formula 1 history.`,
    body,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'SportsActivityLocation', name: c.wikidata_name || c.name, address: [c.locality, c.country].filter(Boolean).join(', '), ...(c.lat != null ? { geo: { '@type': 'GeoCoordinates', latitude: c.lat, longitude: c.lon } } : {}), url: SITE + `/circuits/${c.slug}` }, jsonLdBreadcrumb(bc)],
    section: '/circuits',
    noindex: (dna?.races_held || 0) < 1,
  };
}

// ---------------- STANDINGS ----------------
export function standingsPage(ctx, season) {
  const isCur = season === ctx.currentSeason;
  const path = isCur ? '/standings' : `/standings/${season}`;
  const prog = ctx.progression[season];
  const seasons = Object.keys(ctx.eventsBySeason).map(Number).filter((y) => ctx.standingsBy[`${y}|driver`]).sort((a, b) => b - a);
  let chart = '';
  let heat = '';
  if (prog && prog.matches_official !== false && prog.rounds.length > 1) {
    const top = (ctx.standingsBy[`${season}|driver`] || []).sort((a, b) => a.position - b.position).slice(0, 8);
    const colors = new Set();
    const series = top.map((s) => {
      const team = ctx.dcsByDriver[s.subject_id]?.filter((x) => x.season === season).sort((a, b) => b.entries - a.entries)[0]?.constructor_id;
      let col = ctx.colorOf(team, season) || '8b93a7';
      if (colors.has(col)) col = shade(col);
      colors.add(col);
      return { name: ctx.driverById[s.subject_id]?.code || ctx.driverById[s.subject_id]?.last_name, color: col, points: prog.rounds.map((r) => r.drivers[s.subject_id]?.p ?? null) };
    });
    chart = `<div class="section-head"><h2>Championship progression</h2></div>${lineChart({ series, labels: prog.rounds.map((r) => 'R' + r.round) })}`;
    const topC = (ctx.standingsBy[`${season}|constructor`] || []).sort((a, b) => a.position - b.position).slice(0, 6);
    heat = `<div class="section-head"><h2>Constructor points by round</h2></div>${lineChart({ series: topC.map((s) => ({ name: ctx.conById[s.subject_id]?.name, color: ctx.colorOf(s.subject_id, season) || '8b93a7', points: prog.rounds.map((r) => r.constructors[s.subject_id]?.p ?? null) })), labels: prog.rounds.map((r) => 'R' + r.round) })}`;
  }
  const teamDeltas = ctx.teammates
    .filter((t) => t.by_season[season] && t.by_season[season].events >= 3)
    .map((t) => ({ t, s: t.by_season[season] }))
    .sort((a, b) => Math.abs(b.s.a.points - b.s.b.points) - Math.abs(a.s.a.points - a.s.b.points))
    .slice(0, 12)
    .map(({ t, s }) => `<tr><td>${teamLink(ctx, t.constructors.at(-1))}</td><td>${driverCell(ctx, t.a, t.constructors.at(-1), season)}</td><td class="num">${fmtPts(s.a.points)}</td><td class="num">${fmtPts(s.b.points)}</td><td>${driverCell(ctx, t.b, t.constructors.at(-1), season)}</td><td class="num">${s.quali_h2h[0]}–${s.quali_h2h[1]}</td></tr>`)
    .join('');
  const bc = [['/', 'Home'], ['/standings', 'Standings'], ...(isCur ? [] : [[path, String(season)]])];
  const body = `${crumbs(bc)}
  <section class="hero"><div class="wrap"><span class="eyebrow">FIA Formula One World Championship</span><h1>${season} Standings</h1>${prog?.note ? `<p class="note warn">${esc(prog.note)}</p>` : ''}</div></section>
  <section class="section"><div class="wrap"><div class="split even"><div><div class="section-head"><h2>Drivers</h2></div>${standingsTable(ctx, season, 'driver', 99, { avatar: true })}</div><div id="constructors"><div class="section-head"><h2>Constructors</h2></div>${standingsTable(ctx, season, 'constructor')}</div></div></div></section>
  ${chart ? `<section class="section"><div class="wrap">${chart}</div></section>` : ''}
  ${heat ? `<section class="section"><div class="wrap">${heat}</div></section>` : ''}
  ${teamDeltas ? `<section class="section"><div class="wrap"><div class="section-head"><h2>Teammate points delta</h2></div><div class="table-wrap"><table><thead><tr><th>Team</th><th>Driver A</th><th class="num">Pts</th><th class="num">Pts</th><th>Driver B</th><th class="num">Quali H2H</th></tr></thead><tbody>${teamDeltas}</tbody></table></div></div></section>` : ''}
  <section class="section"><div class="wrap"><p class="note">Championship probabilities are intentionally not shown: no validated model exists yet.</p><div class="section-head"><h2>All seasons</h2></div><nav class="season-links">${seasons.map((y) => `<a href="${y === ctx.currentSeason ? '/standings' : `/standings/${y}`}"${y === season ? ' aria-current="page"' : ''}>${y}</a>`).join('')}</nav></div></section>`;
  return { path, title: `F1 ${season} Standings: Drivers' & Constructors' Championship`, description: `${season} Formula 1 drivers' and constructors' championship standings, points progression by round and teammate deltas.`, body, section: '/standings', jsonLd: [jsonLdBreadcrumb(bc)] };
}
function shade(hex) {
  const n = parseInt(hex, 16);
  const r = Math.min(255, ((n >> 16) & 255) * 0.6 + 90);
  const g = Math.min(255, ((n >> 8) & 255) * 0.6 + 90);
  const b = Math.min(255, (n & 255) * 0.6 + 90);
  return [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
}

// ---------------- MATCHUPS ----------------
export function matchupsIndex(ctx) {
  const season = ctx.currentSeason;
  const cur = currentBattles(ctx);
  const famous = ctx.teammates.filter((t) => t.career.events >= 20).sort((a, b) => b.seasons.at(-1) - a.seasons.at(-1)).slice(0, 60);
  const body = `${crumbs([['/', 'Home'], ['/matchups', 'Matchups']])}
  <section class="hero"><div class="wrap"><span class="eyebrow">Flagship</span><h1>Teammate Battles</h1><p class="sub">Same car, same weekend: the cleanest comparison in Formula 1. Qualifying and race head-to-heads, median qualifying gap, points and finishing record.</p></div></section>
  <section class="section"><div class="wrap"><div class="section-head"><h2>${season}</h2></div><div class="grid g3">${cur.map((t) => battleCard(ctx, t, season)).join('')}</div></div></section>
  <section class="section"><div class="wrap"><div class="section-head"><h2>Teammate pairings with 20+ shared races</h2></div><div class="table-wrap"><table><thead><tr><th>Driver A</th><th>Driver B</th><th>Team</th><th>Seasons</th><th class="num">Quali</th><th class="num">Race</th><th></th></tr></thead><tbody>${famous
    .map((t) => {
      const u = ctx.matchupUrl(t.a, t.b);
      return `<tr><td>${driverCell(ctx, t.a, t.constructors.at(-1), t.seasons.at(-1))}</td><td>${driverCell(ctx, t.b, t.constructors.at(-1), t.seasons.at(-1))}</td><td>${t.constructors.map((c) => teamLink(ctx, c)).join(', ')}</td><td>${t.seasons[0]}–${t.seasons.at(-1)}</td><td class="num">${t.career.quali_h2h.join('–')}</td><td class="num">${t.career.race_h2h.join('–')}</td><td>${u ? `<a class="more" href="${u}">Open</a>` : ''}</td></tr>`;
    })
    .join('')}</tbody></table></div></div></section>`;
  return { path: '/matchups', title: `F1 Teammate Battles ${season}: Qualifying & Race Head-to-Heads`, description: `Every ${season} Formula 1 teammate battle: qualifying and race head-to-heads, median qualifying gaps, points and DNFs, plus historic pairings.`, body, jsonLd: [jsonLdBreadcrumb([['/', 'Home'], ['/matchups', 'Matchups']])] };
}

export function matchupPage(ctx, key) {
  const m = ctx.matchups[key];
  const [a, b] = [ctx.driverById[m.a], ctx.driverById[m.b]];
  const t = ctx.teammates.find((x) => (x.a === m.a && x.b === m.b) || (x.a === m.b && x.b === m.a));
  const flip = t && t.a !== m.a;
  const ca = ctx.latestTeam[m.a];
  const cb = ctx.latestTeam[m.b];
  const colA = ctx.colorOf(ca?.constructor_id, ca?.season);
  const colB = ctx.colorOf(cb?.constructor_id, cb?.season);
  const row = (label, x, y, better = 'high') => {
    const win = x === y || x == null || y == null ? 0 : (better === 'high' ? x > y : x < y) ? 1 : -1;
    return `<tr><td class="num ${win === 1 ? 'green' : ''}"><b>${x ?? '—'}</b></td><th scope="row" class="num">${esc(label)}</th><td class="${win === -1 ? 'green' : ''}"><b>${y ?? '—'}</b></td></tr>`;
  };
  const tw = (s) => (flip ? { a: s.b, b: s.a, quali_h2h: [...s.quali_h2h].reverse(), race_h2h: [...s.race_h2h].reverse(), sprint_h2h: [...s.sprint_h2h].reverse(), quali_gap_pct_median: s.quali_gap_pct_median == null ? null : -s.quali_gap_pct_median, quali_gap_samples: s.quali_gap_samples, events: s.events } : s);
  const teamBlock = t
    ? (() => {
        const windows = [['career', 'Career together'], ['last10', 'Last 10'], ['last5', 'Last 5'], ...t.seasons.slice().reverse().map((y) => [y, String(y)])];
        return `<section class="section"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Teammates · ${t.constructors.map((c) => esc(ctx.conById[c]?.name)).join(', ')}</span><h2>Teammate battle</h2></div></div>
        <div class="tabs" role="tablist">${windows.map(([k, l], i) => `<button class="tab" role="tab" type="button" aria-selected="${i === 0}" aria-controls="tw-${k}" id="tbw-${k}">${esc(l)}</button>`).join('')}</div>
        ${windows
          .map(([k], i) => {
            const s0 = typeof k === 'number' ? t.by_season[k] : t[k];
            const s = tw(s0);
            return `<div class="tabpanel" role="tabpanel" id="tw-${k}" aria-labelledby="tbw-${k}"${i ? ' hidden' : ''}><div class="table-wrap"><table class="vs-table"><thead><tr><th class="num">${esc(a.last_name)}</th><th class="num">${s.events} events</th><th>${esc(b.last_name)}</th></tr></thead><tbody>
            ${row('Qualifying H2H', s.quali_h2h[0], s.quali_h2h[1])}${row('Race H2H', s.race_h2h[0], s.race_h2h[1])}${row('Sprint H2H', s.sprint_h2h[0], s.sprint_h2h[1])}${row('Points', s.a.points, s.b.points)}${row('Wins', s.a.wins, s.b.wins)}${row('Podiums', s.a.podiums, s.b.podiums)}${row('Poles', s.a.poles, s.b.poles)}${row('DNFs', s.a.dnfs, s.b.dnfs, 'low')}${row('Fastest laps', s.a.fastest_laps, s.b.fastest_laps)}${row('Avg finish', s.a.avg_finish, s.b.avg_finish, 'low')}${row('Avg grid', s.a.avg_grid, s.b.avg_grid, 'low')}${row('Avg positions gained', s.a.positions_gained, s.b.positions_gained)}${row('Q3 appearances', s.a.q3_appearances, s.b.q3_appearances)}
            </tbody></table></div><p class="fine">${s.quali_gap_pct_median != null ? `Median qualifying gap: ${esc(a.last_name)} ${s.quali_gap_pct_median > 0 ? '+' : ''}${s.quali_gap_pct_median.toFixed(3)}% vs ${esc(b.last_name)} (n=${s.quali_gap_samples}; negative = ${esc(a.last_name)} faster).` : 'No comparable qualifying lap times in this window.'}</p></div>`;
          })
          .join('')}</div></section>`;
      })()
    : '';
  const dA = ctx.dnaCur[m.a] || ctx.dnaCareer[m.a];
  const dB = ctx.dnaCur[m.b] || ctx.dnaCareer[m.b];
  const dnaCmp =
    dA && dB
      ? `<section class="section"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Driver DNA</span><h2>Profile comparison</h2></div></div><div class="table-wrap"><table><thead><tr><th class="num">${esc(a.last_name)} <span class="fine">${esc(dA.window)}</span></th><th class="num">Dimension</th><th>${esc(b.last_name)} <span class="fine">${esc(dB.window)}</span></th></tr></thead><tbody>${Object.keys(dA.dimensions)
          .map((k) => row(dA.dimensions[k].label, dA.dimensions[k].percentile, dB.dimensions[k]?.percentile))
          .join('')}</tbody></table></div><p class="fine">Percentiles; each driver vs their own window population. Teammate-relative dimensions compare each driver to their own teammates.</p></div></section>`
      : '';
  const recent = m.recent.map((r) => `<tr><td><a href="${ctx.raceUrl(r.event_id)}">${ctx.eventById[r.event_id].season} ${esc(ctx.eventById[r.event_id].name)}</a></td><td class="num">${esc(String(r.a))}</td><td class="num">${esc(String(r.b))}</td></tr>`).join('');
  const path = `/matchup/${a.slug}/${b.slug}`;
  const bc = [['/', 'Home'], ['/matchups', 'Matchups'], [path, `${a.last_name} vs ${b.last_name}`]];
  const body = `${crumbs(bc)}
  <section class="hero"><div class="wrap"><span class="eyebrow">Head to head · ${m.first_season}–${m.last_season}</span><h1>${esc(a.full_name)} <span class="muted">vs</span> ${esc(b.full_name)}</h1>
  <div class="grid g2 section"><div class="card battle ${teamClass(colA)}"><div class="side">${headshot(a, 'md', ctx.mediaOk, colA)}<a class="nm" href="/drivers/${a.slug}">${esc(a.full_name)}</a></div><span class="vs">${m.race_ahead[0]}</span><div class="side"><span class="kicker">Finished ahead</span><span class="nm">${m.shared_events} shared races</span></div></div>
  <div class="card battle ${teamClass(colB)}"><div class="side">${headshot(b, 'md', ctx.mediaOk, colB)}<a class="nm" href="/drivers/${b.slug}">${esc(b.full_name)}</a></div><span class="vs">${m.race_ahead[1]}</span><div class="side"><span class="kicker">Finished ahead</span><span class="nm">both classified</span></div></div></div></div></section>
  <section class="section"><div class="wrap"><div class="table-wrap"><table class="vs-table"><thead><tr><th class="num">${esc(a.last_name)}</th><th class="num">In shared races</th><th>${esc(b.last_name)}</th></tr></thead><tbody>${row('Finished ahead', m.race_ahead[0], m.race_ahead[1])}${row('Qualified ahead', m.quali_ahead[0], m.quali_ahead[1])}${row('Points', m.points[0], m.points[1])}${row('Wins', m.wins[0], m.wins[1])}${row('Podiums', m.podiums[0], m.podiums[1])}</tbody></table></div></div></section>
  ${teamBlock}${dnaCmp}
  <section class="section"><div class="wrap"><div class="section-head"><h2>Recent shared races</h2></div><div class="table-wrap"><table><thead><tr><th>Event</th><th class="num">${esc(a.last_name)}</th><th class="num">${esc(b.last_name)}</th></tr></thead><tbody>${recent}</tbody></table></div></div></section>`;
  return { path, title: `${a.full_name} vs ${b.full_name} – F1 Head-to-Head`, description: `${a.full_name} vs ${b.full_name}: ${m.shared_events} shared Formula 1 races, finished-ahead ${m.race_ahead[0]}–${m.race_ahead[1]}, qualifying ${m.quali_ahead[0]}–${m.quali_ahead[1]}${t ? ', full teammate battle' : ''} and Driver DNA comparison.`, body, section: '/matchups', jsonLd: [jsonLdBreadcrumb(bc)] };
}

// ---------------- PBECAST ----------------
export function pbecast(ctx, outlines) {
  const ev = ctx.nextEvent;
  const body = `${crumbs([['/', 'Home'], ['/pbecast', 'PBEcast']])}
  <section class="hero"><div class="wrap"><span class="eyebrow">PBEcast F1</span><h1>Live race intelligence</h1><p class="sub">Timing tower, session state and an event feed built from the live source. Car positions are never simulated: when the source publishes no coordinates, PBEcast shows order, gaps and lap progress instead.</p></div></section>
  <section class="section"><div class="wrap" data-pbecast data-next="${esc(ev ? ev.id : '')}">
    <div class="card"><div class="cast-status" data-cast-status><span class="pill" data-cast-state>Connecting…</span><span data-cast-title>${ev ? esc(ev.name) : ''}</span><span class="flagchip" data-cast-flag hidden></span><span class="muted" data-cast-lap></span></div><div class="lapbar" data-cast-lapbar hidden><span class="w-0"></span></div><p class="fine" data-cast-updated></p></div>
    <div class="cast section">
      <div class="grid">
        <div class="card"><span class="kicker">Track</span><div data-cast-track>${outlines || ''}</div><p class="fine">No licensed car-position feed: the track shows layout only. Order, gaps and laps come from the live classification.</p></div>
        <div class="card"><span class="kicker">Event feed</span><ul class="feed" data-cast-feed><li><span class="t">—</span><span class="muted">Events appear here during a live session: position changes, pit stops, retirements, fastest laps and flag changes detected from consecutive source updates.</span></li></ul></div>
      </div>
      <div class="card"><span class="kicker">Timing tower</span><div class="table-wrap"><table class="tower"><thead><tr><th class="pos">Pos</th><th>Driver</th><th class="num">Gap</th><th class="num">Laps</th><th class="num">Pits</th><th class="num">Best</th><th>Status</th></tr></thead><tbody data-cast-tower><tr><td colspan="7" class="muted">Loading live classification…</td></tr></tbody></table></div><p class="fine">Tyre compound, tyre age and per-stop timing are not published by the source and are never estimated.</p></div>
    </div>
  </div></section>`;
  return { path: '/pbecast', title: 'PBEcast F1: Live Timing Tower & Race Feed', description: 'PBEcast Formula 1: live session timing tower, gaps, pit counts, retirements, fastest laps and flag state from the live source — no simulated tracking.', body, jsonLd: [] };
}

// ---------------- NEWS (deterministic data recaps) ----------------
export function buildRecaps(ctx) {
  const out = [];
  const evs = ctx.events.filter((e) => e.status === 'completed' && e.season >= ctx.currentSeason - 1).sort((a, b) => b.start_utc.localeCompare(a.start_utc));
  for (const ev of evs) {
    const race = ctx.rows(ev.id, 'race');
    const w = race.find((r) => r.status === 'classified' && r.position === 1);
    if (!w) continue;
    const p2 = race.find((r) => r.status === 'classified' && r.position === 2);
    const p3 = race.find((r) => r.status === 'classified' && r.position === 3);
    const pole = poleOf(ctx, ev.id);
    const D = (r) => ctx.driverById[r.driver_id];
    const T = (r) => ctx.conById[r.constructor_id]?.name;
    const facts = [];
    facts.push(`${D(w).full_name} won the ${ev.season} ${ev.name} for ${T(w)}${w.grid ? `, starting from ${w.grid === 1 ? 'pole position' : 'P' + w.grid}` : ''}.`);
    if (p2) facts.push(`${D(p2).full_name} (${T(p2)}) finished second${p2.gap_text ? `, ${p2.gap_text.replace(/^\+/, '')}s behind` : ''}${p3 ? `, with ${D(p3).full_name} (${T(p3)}) completing the podium` : ''}.`);
    if (pole && pole.driver_id !== w.driver_id) facts.push(`Pole-sitter ${D(pole).full_name} finished ${(() => { const r = race.find((x) => x.driver_id === pole.driver_id); return r?.status === 'classified' ? ordinal(r.position) : 'as a non-classified retirement'; })()}.`);
    const fl = race.filter((r) => r.fastest_lap_ms).sort((a, b) => a.fastest_lap_ms - b.fastest_lap_ms)[0];
    if (fl) facts.push(`Fastest lap: ${D(fl).full_name}, ${fl.fastest_lap_text}${fl.fastest_lap_number ? ` on lap ${fl.fastest_lap_number}` : ''}.`);
    const g = race.filter((r) => r.status === 'classified' && r.grid && r.position).sort((a, b) => b.grid - b.position - (a.grid - a.position))[0];
    if (g && g.grid - g.position >= 4) facts.push(`Biggest climber: ${D(g).full_name}, P${g.grid} to P${g.position} (+${g.grid - g.position}).`);
    const dnf = race.filter((r) => r.status === 'retired');
    if (dnf.length) facts.push(`${dnf.length} retirement${dnf.length > 1 ? 's' : ''}: ${dnf.map((r) => `${D(r).last_name}${r.laps != null ? ` (lap ${r.laps})` : ''}`).join(', ')}.`);
    const dsq = race.filter((r) => r.status === 'disqualified');
    if (dsq.length) facts.push(`Disqualified: ${dsq.map((r) => D(r).full_name).join(', ')}.`);
    const prog = ctx.progression[ev.season];
    const ri = prog?.rounds.findIndex((r) => r.event_id === ev.id);
    if (prog && prog.matches_official !== false && ri >= 0) {
      const cur = Object.entries(prog.rounds[ri].drivers).sort((a, b) => a[1].pos - b[1].pos);
      const leader = ctx.driverById[cur[0][0]];
      const gap = cur[1] ? cur[0][1].p - cur[1][1].p : null;
      const prevLeader = ri > 0 ? Object.entries(prog.rounds[ri - 1].drivers).sort((a, b) => a[1].pos - b[1].pos)[0][0] : null;
      facts.push(`${prevLeader && prevLeader !== cur[0][0] ? 'New championship leader: ' : 'Championship leader: '}${leader.full_name} on ${fmtPts(cur[0][1].p)} points${gap != null ? `, ${fmtPts(gap)} ahead of ${ctx.driverById[cur[1][0]].full_name}` : ''} after round ${ev.round}.`);
    }
    out.push({
      slug: ev.slug,
      event_id: ev.id,
      date: ev.end_utc || ev.start_utc,
      title: `${D(w).last_name} wins the ${ev.season} ${ev.name}${w.grid && w.grid > 3 ? ` from P${w.grid}` : ''}`,
      dek: facts.slice(1, 3).join(' '),
      facts,
    });
  }
  return out;
}

export function newsIndex(ctx) {
  const body = `${crumbs([['/', 'Home'], ['/news', 'Intelligence']])}
  <section class="hero"><div class="wrap"><span class="eyebrow">Intelligence</span><h1>Race recaps</h1><p class="sub">Every recap here is generated only from the published classification: no quotes, no speculation. Each fact is checked against the source data.</p></div></section>
  <section class="section"><div class="wrap">${ctx.recaps.map((r) => `<a class="story" href="/news/${r.slug}"><span class="kicker">${esc(fmtDate(r.date))} · Data recap</span><h3>${esc(r.title)}</h3><p>${esc(r.dek)}</p></a>`).join('')}</div></section>`;
  return { path: '/news', title: 'F1 Race Recaps & Intelligence', description: 'Data-verified Formula 1 race recaps: winners, podiums, pole conversion, fastest laps, retirements and championship impact.', body, jsonLd: [jsonLdBreadcrumb([['/', 'Home'], ['/news', 'Intelligence']])] };
}

export function newsArticle(ctx, r) {
  const ev = ctx.eventById[r.event_id];
  const bc = [['/', 'Home'], ['/news', 'Intelligence'], [`/news/${r.slug}`, r.title]];
  const body = `${crumbs(bc)}
  <article class="section"><div class="wrap prose"><span class="eyebrow">Data recap · ${esc(fmtDate(r.date))}</span><h1>${esc(r.title)}</h1>${r.facts.map((f) => `<p>${esc(f)}</p>`).join('')}
  <p class="fine">Automated recap built from the published race classification. <a href="${ctx.raceUrl(ev.id)}">Full classification</a> · <a href="/standings">Standings</a></p></div></article>`;
  return {
    path: `/news/${r.slug}`,
    title: r.title,
    description: r.facts.slice(0, 2).join(' ').slice(0, 300),
    body,
    section: '/news',
    ogType: 'article',
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'NewsArticle', headline: r.title, datePublished: r.date, author: { '@type': 'Organization', name: 'PropBetEdge F1' }, publisher: { '@type': 'Organization', name: 'PropBetEdge' }, mainEntityOfPage: SITE + `/news/${r.slug}` }, jsonLdBreadcrumb(bc)],
  };
}

function groupBy(arr, fn) {
  const m = {};
  for (const x of arr) (m[fn(x)] ||= []).push(x);
  return m;
}
