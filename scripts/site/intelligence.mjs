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
  const rows = (fit?.drivers || []).slice(0, full ? 22 : 3);
  const crows = (fit?.constructors || []).slice(0, full ? 11 : 2);
  return `<div class="ipanel"><div class="ipanel-h"><span class="eyebrow">Next race intelligence</span><h3><a href="/races/${esc(ev.id)}">${esc(ev.name)}</a></h3><p class="fine">${esc(circuit?.name || '')}${circuit?.latest_layout?.length_km ? ` · ${circuit.latest_layout.length_km} km · ${circuit.latest_layout.turns || '—'} turns` : ''}</p></div>
  <div class="isplit"><div><span class="kicker">Circuit DNA</span>${prof}${history(X, ev, circuit)}</div>
  <div><span class="kicker">Circuit Fit · drivers</span>${rows.length ? `<ol class="ifit">${rows.map((r) => `<li>${who(X, r.driver_id)}<span class="ifit-s">${r.fit_score}</span><span class="ifit-c">${(r.strongest || []).slice(0, 1).map((k) => esc(r.components.find((c) => c.key === k)?.label || '')).join('')}</span></li>`).join('')}</ol>` : '<p class="muted">No fit yet.</p>'}
  ${crows.length ? `<span class="kicker">Constructors</span><ol class="ifit">${crows.map((c) => `<li>${teamLink(X, c.constructor_id)}<span class="ifit-s">${c.fit_score}</span></li>`).join('')}</ol>` : ''}
  <p class="fine">${esc(fit?.disclaimer || 'Circuit Fit is descriptive, not a prediction.')}${fit?.drivers?.[0]?.confidence ? ` Confidence: ${esc(fit.drivers[0].confidence)}.` : ''}</p></div></div></div>`;
}

function formModule(X, F, { full = false } = {}) {
  const df = M.driverForm(X, F);
  const imp = df.filter((x) => x.delta_ppr != null).sort((a, b) => b.delta_ppr - a.delta_ppr).slice(0, full ? 10 : 2);
  const pts = [...df].sort((a, b) => b.recent.points - a.recent.points).slice(0, full ? 10 : 2);
  const q = df.filter((x) => x.recent.quali_n >= 3).sort((a, b) => a.recent.avg_quali - b.recent.avg_quali).slice(0, full ? 10 : 2);
  const r = df.filter((x) => x.recent.avg_finish != null).sort((a, b) => a.recent.avg_finish - b.recent.avg_finish).slice(0, full ? 10 : 2);
  const block = (title, list, val, note) => `<div class="card"><span class="kicker">${esc(title)}</span><ol class="irank">${list.map((x) => `<li>${who(X, x.driver_id)}<b>${val(x)}</b>${lastN(x.last)}</li>`).join('')}</ol><p class="fine">${esc(note)}</p></div>`;
  return `<div class="grid g2">${block('Biggest recent improvers', imp, (x) => sgn(x.delta_ppr), `Points per race, last ${M.FORM_WINDOW} vs previous ${M.FORM_WINDOW} races.`)}${block('Points, last five races', pts, (x) => x.recent.points, 'Race points incl. sprint (weekend totals).')}${block('Qualifying form', q, (x) => f1(x.recent.avg_quali), `Average qualifying position, last ${M.FORM_WINDOW} (min 3).`)}${block('Race-result form', r, (x) => f1(x.recent.avg_finish), `Average classified finish, last ${M.FORM_WINDOW}; retirements shown as R.`)}</div>`;
}

function battlesModule(X, F, { full = false } = {}) {
  const tb = M.teammateBattles(X, F).slice(0, full ? 11 : 2);
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
  return `<div class="grid g4 idna">${M.dnaLeaders(X, F, n).map((d) => `<div class="card"><span class="kicker">${esc(d.label)}</span>${d.rows.length ? `<ol class="irank">${d.rows.map((r) => `<li>${who(X, r.driver_id)}<b>${r.dim.percentile}</b></li>`).join('')}</ol><p class="fine">${esc(d.rows[0].dim.population || '')} · ${esc(d.rows[0].dim.basis || '')}</p>` : '<p class="muted">Not enough sample this window.</p>'}</div>`).join('')}</div><p class="fine">Driver DNA current window ${esc(Object.values(X.dnaDriver).find((d) => d.current?.window)?.current?.window || '')}. Percentiles within drivers meeting each dimension's minimum sample; low-confidence rows omitted.</p>`;
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
const labGate=(title,copy)=>`<div class="premium-gate"><span class="eyebrow">◆ All Access · Race Lab</span><h2>${esc(title)}</h2><p>${esc(copy)}</p><div class="rl-actions"><a class="pc-cta" href="/race-lab">Open Race Lab ◆</a><a class="more" href="/all-access">What All Access includes</a></div></div>`;
export function intelligencePages(ctx,X,newsPub=[]){
  const F=M.seasonFrame(X),nr=M.nextRace(X),stories=order(newsPub,X).slice(0,4),S=(x)=>`<section class="section"><div class="wrap">${x}</div></section>`;
  const page=(p,t,h,l,b,d)=>({path:p,title:t,description:d,section:'/intelligence',bg:'data',body:`${crumbs([['/','Home'],['/intelligence','Intelligence'],...(p==='/intelligence'?[]:[[p,h]])])}<section class="hero"><div class="wrap"><span class="eyebrow">F1 Intelligence · ${F.season}</span><h1>${esc(h)}</h1><p class="sub">${esc(l)}</p></div></section>${b}`,jsonLd:[jsonLdBreadcrumb([['/','Home'],['/intelligence','Intelligence'],...(p==='/intelligence'?[]:[[p,h]])]) ]});
  const hub=page('/intelligence',`F1 Intelligence ${F.season}: Free Preview + Race Lab`,'F1 intelligence','A public preview of the proprietary layer. All Access opens the full F1 desk in Race Lab.',S(nextRaceModule(X,nr))+S(head('Driver form preview','Who is improving')+formModule(X,F))+S(head('Teammate preview','Same car, measured')+battlesModule(X,F))+S(head('Driver DNA preview','One leader per dimension')+dnaModule(X,F,1))+S(labGate('Open the complete F1 intelligence desk','Full rankings, DNA, form deltas, teammate gaps and championship movement live in Race Lab.'))+(stories.length?S(head('Recent intelligence','From the newsroom',['/news','All stories'])+`<div class="ngrid">${stories.map(a=>storyCard(a)).join('')}</div>`):''),`F1 ${F.season} intelligence preview; full proprietary analysis is in All Access Race Lab.`);
  const locked=(p,t,h,l,copy)=>page(p,t,h,l,S(labGate(h,copy)),`${h} preview; full detail is in All Access Race Lab.`);
  return [hub,locked('/intelligence/drivers',`Driver DNA Leaders ${F.season}`,'Driver DNA leaders','Complete dimensions and ranked populations are an All Access surface.','Open every Driver DNA dimension, percentile and sample in Race Lab.'),locked('/intelligence/constructors',`Constructor Form ${F.season}`,'Constructor form','Recent form is previewed publicly.','Open recent points, qualifying, reliability and movement for every team.'),locked('/intelligence/circuits',`Circuit Intelligence ${F.season}`,'Circuit intelligence','Circuit facts stay public; full DNA and Fit are All Access.','Open complete Circuit DNA and driver/constructor Circuit Fit rankings.'),locked('/intelligence/teammates',`Teammate Battles ${F.season}`,'Teammate battles','Same-car comparison is a core proprietary surface.','Open every pairing, H2H and median qualifying gap.'),locked('/intelligence/form',`F1 Form Guide ${F.season}`,'Form guide','The public view is only a small preview.','Open the full recent-vs-prior form board.'),locked('/intelligence/championship',`Championship Movement ${F.season}`,'Championship movement','Standings stay free; derived trajectory is All Access.','Open five-round movement and teammate gap context.')];
}
