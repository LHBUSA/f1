// /intelligence hub and its analytical detail pages. Data: the published projection via src/intel/metrics.mjs.
import { esc, lineChart, pctBar, confBadge, PROPSPORTS_F1, jsonLdBreadcrumb, crumbs, teamClass } from './lib.mjs';
import * as M from '../../src/intel/metrics.mjs';
import { storyCard, order } from '../../src/news/pages.mjs';

const f1 = (x, d = 1) => (x == null ? '—' : Number(x).toFixed(d));
const sgn = (x, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${Number(x).toFixed(d)}`);

function who(X, id, { team = true } = {}) {
  const d = X.driver[id];
  if (!d) return esc(id);
  const c = X.con[d.team_id];
  return `<span class="iwho ${teamClass(c?.color)}"><span class="avatar avatar-sm ${teamClass(c?.color)}"><img src="${PROPSPORTS_F1}/media/headshot/${esc(id)}" alt="" width="48" height="48" loading="lazy" decoding="async" data-fallback="${esc((d.first_name?.[0] || '') + (d.last_name?.[0] || ''))}"></span><span><a href="/drivers/${esc(id)}">${esc(d.name)}</a>${team && c ? `<small>${esc(c.name)}</small>` : ''}</span></span>`;
}
const teamLink = (X, id) => (X.con[id] ? `<a class="${teamClass(X.con[id].color)} iteam" href="/teams/${esc(id)}">${esc(X.con[id].name)}</a>` : esc(id));
const lastN = (xs) => `<span class="iform">${xs.map((p) => `<i class="${p === 'DNF' ? 'dnf' : p === 1 ? 'win' : p != null && p <= 3 ? 'pod' : p != null && p <= 10 ? 'pts' : ''}">${p == null ? '·' : p === 'DNF' ? 'R' : p}</i>`).join('')}</span>`;
const head = (eyebrow, title, more) => `<div class="section-head"><div><span class="eyebrow">${esc(eyebrow)}</span><h2>${esc(title)}</h2></div>${more ? `<a class="more" href="${more[0]}">${esc(more[1])}</a>` : ''}</div>`;

// circuit record in our archive: races held, last edition and its winner, current-grid winners here
function history(X, ev, circuit) {
  if (!circuit) return '';
  const prior = X.eventsAtCircuit(circuit.id).filter((e) => e.start_utc < ev.start_utc && X.rows(e.id, 'race').some((r) => r.position === 1));
  if (!prior.length) return '<p class="fine">First World Championship race at this circuit in our archive.</p>';
  const last = prior.at(-1), lw = X.rows(last.id, 'race').find((r) => r.position === 1);
  const wins = {};
  for (const e of prior) { const w = X.rows(e.id, 'race').find((r) => r.position === 1 && r.status === 'classified'); if (w && X.currentGrid.includes(w.driver_id)) wins[w.driver_id] = (wins[w.driver_id] || 0) + 1; }
  const wl = Object.entries(wins).sort((a, b) => b[1] - a[1]);
  return `<span class="kicker">Circuit record</span><dl class="istats"><div><dt>Races held</dt><dd>${prior.length}</dd></div><div><dt>Last held</dt><dd>${last.season}</dd></div></dl><p class="fine">Last winner: ${lw ? who(X, lw.driver_id, { team: false }) : '—'}</p>${wl.length ? `<span class="kicker">Current-grid winners here</span><ol class="irank">${wl.map(([id, n]) => `<li>${who(X, id)}<b>${n}</b></li>`).join('')}</ol>` : '<p class="fine">No driver on the current grid has won here.</p>'}`;
}

// ---------- modules ----------
function nextRaceModule(X, nr, { full = false } = {}) {
  if (!nr) return '';
  const { ev, circuit, cdna, fit } = nr;
  const thin = cdna?.recent_races != null && cdna.recent_races < 5;
  const prof = cdna ? (thin ? `<p class="muted">Circuit DNA rests on ${cdna.recent_races} recent race${cdna.recent_races === 1 ? '' : 's'} here, too few for rates.</p>` : `<dl class="istats"><div><dt>Pole → win</dt><dd>${Math.round((cdna.pole_win_rate ?? 0) * 100)}%</dd></div><div><dt>Grid↔finish ρ</dt><dd>${f1(cdna.grid_finish_rho, 2)}</dd></div><div><dt>Avg places moved</dt><dd>${f1(cdna.mean_abs_position_change)}</dd></div><div><dt>Attrition</dt><dd>${Math.round((cdna.attrition_rate ?? 0) * 100)}%</dd></div><div><dt>Stops / car</dt><dd>${f1(cdna.stops_per_car)}</dd></div></dl><p class="fine">Last ${cdna.recent_races} races here (Circuit DNA ${esc(cdna.version || '')}).</p>`) : '<p class="muted">No Circuit DNA for this circuit.</p>';
  const rows = (fit?.drivers || []).slice(0, full ? 22 : 6);
  const crows = (fit?.constructors || []).slice(0, full ? 11 : 5);
  return `<div class="ipanel"><div class="ipanel-h"><span class="eyebrow">Next race intelligence</span><h3><a href="/races/${esc(ev.id)}">${esc(ev.name)}</a></h3><p class="fine">${esc(circuit?.name || '')}${circuit?.latest_layout?.length_km ? ` · ${circuit.latest_layout.length_km} km · ${circuit.latest_layout.turns || '—'} turns` : ''}</p></div>
  <div class="isplit"><div><span class="kicker">Circuit DNA</span>${prof}${history(X, ev, circuit)}</div>
  <div><span class="kicker">Circuit Fit · drivers</span>${rows.length ? `<ol class="ifit">${rows.map((r) => `<li>${who(X, r.driver_id)}<span class="ifit-s">${r.fit_score}</span><span class="ifit-c">${(r.strongest || []).slice(0, 1).map((k) => esc(r.components.find((c) => c.key === k)?.label || '')).join('')}</span></li>`).join('')}</ol>` : '<p class="muted">No fit yet.</p>'}
  ${crows.length ? `<span class="kicker">Constructors</span><ol class="ifit">${crows.map((c) => `<li>${teamLink(X, c.constructor_id)}<span class="ifit-s">${c.fit_score}</span></li>`).join('')}</ol>` : ''}
  <p class="fine">${esc(fit?.disclaimer || 'Circuit Fit is descriptive, not a prediction.')}${fit?.drivers?.[0]?.confidence ? ` Confidence: ${esc(fit.drivers[0].confidence)}.` : ''}</p></div></div></div>`;
}

function formModule(X, F, { full = false } = {}) {
  const df = M.driverForm(X, F);
  const imp = df.filter((x) => x.delta_ppr != null).sort((a, b) => b.delta_ppr - a.delta_ppr).slice(0, full ? 10 : 5);
  const pts = [...df].sort((a, b) => b.recent.points - a.recent.points).slice(0, full ? 10 : 5);
  const q = df.filter((x) => x.recent.quali_n >= 3).sort((a, b) => a.recent.avg_quali - b.recent.avg_quali).slice(0, full ? 10 : 5);
  const r = df.filter((x) => x.recent.avg_finish != null).sort((a, b) => a.recent.avg_finish - b.recent.avg_finish).slice(0, full ? 10 : 5);
  const block = (title, list, val, note) => `<div class="card"><span class="kicker">${esc(title)}</span><ol class="irank">${list.map((x) => `<li>${who(X, x.driver_id)}<b>${val(x)}</b>${lastN(x.last)}</li>`).join('')}</ol><p class="fine">${esc(note)}</p></div>`;
  return `<div class="grid g2">${block('Biggest recent improvers', imp, (x) => sgn(x.delta_ppr), `Points per race, last ${M.FORM_WINDOW} vs previous ${M.FORM_WINDOW} races.`)}${block('Points, last five races', pts, (x) => x.recent.points, 'Race points incl. sprint (weekend totals).')}${block('Qualifying form', q, (x) => f1(x.recent.avg_quali), `Average qualifying position, last ${M.FORM_WINDOW} (min 3).`)}${block('Race-result form', r, (x) => f1(x.recent.avg_finish), `Average classified finish, last ${M.FORM_WINDOW}; retirements shown as R.`)}</div>`;
}

function battlesModule(X, F, { full = false } = {}) {
  const tb = M.teammateBattles(X, F).slice(0, full ? 11 : 6);
  const bar = (a, b) => { const t = a + b || 1; return `<span class="ih2h"><i class="w-${Math.round((a / t) * 100)}"></i></span>`; };
  return `<div class="grid g2 ibattles">${tb.map((t) => `<div class="card ibattle ${teamClass(X.con[t.team_id]?.color)}"><div class="ibattle-h">${teamLink(X, t.team_id)}<a class="more" href="/matchup/${[t.a, t.b].sort().map(esc).join('/')}">Matchup</a></div>
    <div class="ibattle-p">${who(X, t.a, { team: false })}${who(X, t.b, { team: false })}</div>
    <table class="itable"><tbody>
      <tr><th>Qualifying H2H</th><td>${t.quali[0]}</td><td>${bar(t.quali[0], t.quali[1])}</td><td>${t.quali[1]}</td></tr>
      <tr><th>Race H2H (both classified)</th><td>${t.race[0]}</td><td>${bar(t.race[0], t.race[1])}</td><td>${t.race[1]}</td></tr>
      <tr><th>Points</th><td>${t.points[0]}</td><td>${bar(t.points[0], t.points[1])}</td><td>${t.points[1]}</td></tr>
      <tr><th>DNA Qualifying (career window)</th><td>${t.dna.a.q ?? '—'}</td><td></td><td>${t.dna.b.q ?? '—'}</td></tr>
    </tbody></table>
    <p class="fine">${t.median_gap_pct == null ? 'No shared qualifying segment times.' : `Median qualifying gap ${Math.abs(t.median_gap_pct).toFixed(2)}% in favour of ${esc(X.driver[t.median_gap_pct <= 0 ? t.b : t.a]?.last_name)} (${t.gap_samples} sessions, deepest shared segment).`} ${t.races} races together this season.</p></div>`).join('')}</div>`;
}

function constructorModule(X, F) {
  const cf = M.constructorForm(X, F);
  return `<div class="table-wrap"><table class="itable itable--wide"><thead><tr><th>Team</th><th class="num">Points (last ${M.FORM_WINDOW})</th><th class="num">Best quali avg</th><th class="num">Classified</th><th class="num">Retirements</th><th class="num">Champ. pos</th><th class="num">Movement</th></tr></thead><tbody>${cf.map((c) => `<tr><td>${teamLink(X, c.team_id)}</td><td class="num">${c.points}</td><td class="num">${f1(c.best_quali_avg)}</td><td class="num">${c.classified_rate == null ? '—' : Math.round(c.classified_rate * 100) + '%'}</td><td class="num">${c.dnf}</td><td class="num">${c.pos_now ?? '—'}</td><td class="num">${c.movement == null ? '—' : c.movement > 0 ? `▲${c.movement}` : c.movement < 0 ? `▼${-c.movement}` : '='}</td></tr>`).join('')}</tbody></table></div><p class="fine">Window: last ${M.FORM_WINDOW} races. Movement = constructors' championship position change over the window.</p>`;
}

function dnaModule(X, F, n = 5) {
  return `<div class="grid g4 idna">${M.dnaLeaders(X, F, n).map((d) => `<div class="card"><span class="kicker">${esc(d.label)}</span>${d.rows.length ? `<ol class="irank">${d.rows.map((r) => `<li>${who(X, r.driver_id)}<b>${r.dim.percentile}</b></li>`).join('')}</ol><p class="fine">${esc(d.rows[0].dim.population || '')} · ${esc(d.rows[0].dim.basis || '')}</p>` : '<p class="muted">Not enough sample this window.</p>'}</div>`).join('')}</div><p class="fine">Driver DNA current window ${esc(Object.values(X.dnaDriver).find((d) => d.current?.window)?.current?.window || '')}. Percentiles within drivers meeting each dimension's minimum sample; low-confidence rows omitted. Start performance and wet-race results are not sourced and are not shown.</p>`;
}

function champModule(X, F, { full = false } = {}) {
  const ch = M.championship(X, F, full ? 10 : 6);
  if (ch.note) return `<p class="muted">${esc(ch.note)}</p>`;
  const lab = ch.rounds.map((r) => `R${r}`);
  const color = (id) => X.con[X.driver[id]?.team_id]?.color;
  const pts = lineChart({ labels: lab, series: ch.top.map((id) => ({ name: X.driver[id]?.last_name, color: color(id), points: ch.prog.map((r) => r.drivers[id]?.p ?? null) })), yLabel: 'Points' });
  const pos = lineChart({ labels: lab, series: ch.top.map((id) => ({ name: X.driver[id]?.last_name, color: color(id), points: ch.prog.map((r) => r.drivers[id]?.pos ?? null) })), yLabel: 'Position', invert: true, maxY: Math.max(10, ...ch.top.flatMap((id) => ch.prog.map((r) => r.drivers[id]?.pos || 0))) });
  const con = full ? lineChart({ labels: lab, series: ch.topC.slice(0, 6).map((id) => ({ name: X.con[id]?.name, color: X.con[id]?.color, points: ch.prog.map((r) => r.constructors?.[id]?.pos ?? null) })), yLabel: 'Constructor position', invert: true, maxY: 11 }) : '';
  const tg = full ? lineChart({ labels: lab, series: M.teammateBattles(X, F).slice(0, 6).map((t) => ({ name: X.con[t.team_id]?.name, color: X.con[t.team_id]?.color, points: ch.prog.map((r) => (r.drivers[t.a] && r.drivers[t.b] ? r.drivers[t.a].p - r.drivers[t.b].p : null)) })), yLabel: 'Teammate points gap' }) : '';
  return `<div class="grid"><div class="card"><span class="kicker">Drivers' points by round</span>${pts}</div><div class="card"><span class="kicker">Championship position by round</span>${pos}</div>${full ? `<div class="card"><span class="kicker">Constructors' position by round</span>${con}</div><div class="card"><span class="kicker">Teammate points gap by round (first-named driver minus teammate)</span>${tg}</div>` : ''}</div>`;
}

// ---------- pages ----------
export function intelligencePages(ctx, X, newsPub = []) {
  const F = M.seasonFrame(X);
  const nr = M.nextRace(X);
  const stories = order(newsPub, X).slice(0, 4);
  const sub = [['/intelligence/drivers', 'Drivers'], ['/intelligence/constructors', 'Constructors'], ['/intelligence/circuits', 'Circuits'], ['/intelligence/teammates', 'Teammates'], ['/intelligence/form', 'Form'], ['/intelligence/championship', 'Championship']];
  const tabs = (active) => `<nav class="itabs wrap" aria-label="Intelligence sections"><a href="/intelligence"${active === '/intelligence' ? ' aria-current="page"' : ''}>Overview</a>${sub.map(([h, t]) => `<a href="${h}"${active === h ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`;
  const page = (p, title, h1, lede, body, description) => ({
    path: p, title, description, section: '/intelligence', bg: 'data',
    body: `${crumbs([['/', 'Home'], ['/intelligence', 'Intelligence'], ...(p === '/intelligence' ? [] : [[p, h1]])])}<section class="hero"><div class="wrap"><span class="eyebrow">F1 Intelligence · ${F.season} · after round ${F.races.length}</span><h1>${esc(h1)}</h1><p class="sub">${esc(lede)}</p></div></section>${tabs(p)}${body}`,
    jsonLd: [jsonLdBreadcrumb([['/', 'Home'], ['/intelligence', 'Intelligence'], ...(p === '/intelligence' ? [] : [[p, h1]])])],
  });
  const S = (inner) => `<section class="section"><div class="wrap">${inner}</div></section>`;
  const hub = page('/intelligence', `F1 Intelligence ${F.season}: Form, Teammates, Circuit Fit & DNA`, 'F1 intelligence',
    'Who is fast, who is improving, where the teammate gaps are, which cars fit the next circuit and what changed — computed from every classified session.',
    S(nextRaceModule(X, nr)) +
    S(head('Driver form', 'Who is improving', ['/intelligence/form', 'All form']) + formModule(X, F)) +
    S(head('Teammate battles', 'Same car, measured', ['/intelligence/teammates', 'All teams']) + battlesModule(X, F)) +
    S(head('Constructor form', 'Who is moving', ['/intelligence/constructors', 'Constructors']) + constructorModule(X, F)) +
    S(head('Driver DNA leaders', 'Profiles at the top', ['/intelligence/drivers', 'All DNA']) + dnaModule(X, F, 3)) +
    S(head('Championship movement', 'How the table got here', ['/intelligence/championship', 'Full movement']) + champModule(X, F)) +
    (stories.length ? S(head('Recent intelligence', 'From the newsroom', ['/news', 'All stories']) + `<div class="ngrid">${stories.map((a) => storyCard(a)).join('')}</div>`) : ''),
    `F1 ${F.season} intelligence hub: next-race Circuit DNA and Circuit Fit, driver and constructor form, teammate head-to-heads, Driver DNA leaders and championship movement after round ${F.races.length}.`);
  const circuitsBody = S(nextRaceModule(X, nr, { full: true })) + S(head('Circuit DNA', `${F.season} calendar`) + `<div class="table-wrap"><table class="itable itable--wide"><thead><tr><th>Round</th><th>Circuit</th><th class="num">Recent races</th><th class="num">Pole → win</th><th class="num">ρ grid↔finish</th><th class="num">Places moved</th><th class="num">Attrition</th></tr></thead><tbody>${X.raceEvents(F.season).map((e) => { const c = X.dnaCircuit[e.circuit_id]; const ok = c && c.recent_races >= 5; return `<tr><td>${e.round}</td><td><a href="/circuits/${esc(e.circuit_id)}">${esc(X.circuit[e.circuit_id]?.name || e.circuit_id)}</a></td><td class="num">${c?.recent_races ?? '—'}</td><td class="num">${ok ? Math.round(c.pole_win_rate * 100) + '%' : '—'}</td><td class="num">${ok ? f1(c.grid_finish_rho, 2) : '—'}</td><td class="num">${ok ? f1(c.mean_abs_position_change) : '—'}</td><td class="num">${ok ? Math.round(c.attrition_rate * 100) + '%' : '—'}</td></tr>`; }).join('')}</tbody></table></div><p class="fine">Rates are shown only where Circuit DNA has at least five recent races.</p>`);
  return [
    hub,
    page('/intelligence/drivers', `Driver DNA Leaders ${F.season}`, 'Driver DNA leaders', 'The strongest current-window profiles in every Driver DNA dimension, with the population and basis for each.', S(dnaModule(X, F, 8)), `Formula 1 Driver DNA leaders ${F.season}: qualifying pace, race results vs teammate, positions gained, finishing, consistency and circuit-type profiles.`),
    page('/intelligence/constructors', `Constructor Form ${F.season}`, 'Constructor form', 'Points, qualifying, finishing and reliability over the last five races, and how each team moved in the championship.', S(constructorModule(X, F)) + S(head('Championship', "Constructors' position by round") + champModule(X, F, { full: true })), `Formula 1 constructor form ${F.season}: recent points, qualifying, reliability and championship movement.`),
    page('/intelligence/circuits', `Circuit Intelligence ${F.season}`, 'Circuit intelligence', 'Circuit DNA for every round and the full Circuit Fit for the next race.', circuitsBody, `Formula 1 ${F.season} circuit intelligence: Circuit DNA for each round and Circuit Fit for the next Grand Prix.`),
    page('/intelligence/teammates', `Teammate Battles ${F.season}`, 'Teammate battles', 'Every current pairing: qualifying and race head-to-heads, points, median qualifying gap and Driver DNA.', S(battlesModule(X, F, { full: true })), `Formula 1 ${F.season} teammate battles: qualifying and race head-to-head, points and qualifying gap for every team.`),
    page('/intelligence/form', `F1 Form Guide ${F.season}`, 'Form guide', `Driver form over the last ${M.FORM_WINDOW} races against the ${M.FORM_WINDOW} before.`, S(formModule(X, F, { full: true })), `Formula 1 form guide ${F.season}: biggest improvers, recent points, qualifying and race-result form.`),
    page('/intelligence/championship', `Championship Movement ${F.season}`, 'Championship movement', 'Drivers and constructors by round, and the points gap inside each team.', S(champModule(X, F, { full: true })), `Formula 1 ${F.season} championship movement: points and positions by round for drivers and constructors, and teammate gaps.`),
  ];
}
