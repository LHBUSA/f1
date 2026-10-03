// Driver matchup page. Two different comparisons, never presented as interchangeable:
//   SHARED GRID HISTORY — every event both raced, in whatever cars (different machinery; context, not a driver H2H)
//   TEAMMATE BATTLE     — the same-constructor comparison (only when the teammate graph says they were teammates)
// Every count shows its denominator; nothing is predicted, scored or combined. Sources: data/derived matchups +
// teammates (scripts/derive.mjs), Driver DNA, standings, driver log.
import { esc, headshot, teamClass, wClass, crumbs, jsonLdBreadcrumb, fmtDate, fmtPts, ordinal, teamMark, flag, SITE } from './lib.mjs';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const num = (v, d = 2) => (v == null ? null : Number.isInteger(v) ? String(v) : v.toFixed(d));
const signed = (v, d = 2) => (v == null ? null : `${v > 0 ? '+' : ''}${v.toFixed(d)}`);

// teammate summaries are stored for (t.a, t.b); orient them to the page's (a, b)
function orient(s, flip) {
  if (!s || !flip) return s;
  const r = (v) => (Array.isArray(v) ? [...v].reverse() : v);
  return { ...s, a: s.b, b: s.a, quali_h2h: r(s.quali_h2h), race_h2h: r(s.race_h2h), sprint_h2h: r(s.sprint_h2h), grid_fallback_h2h: r(s.grid_fallback_h2h), quali_gap_pct_median: s.quali_gap_pct_median == null ? null : -s.quali_gap_pct_median };
}

// one mirrored comparison row: A value | label (+ denominator note) with bars from the centre | B value
function duel(label, x, y, { note = '', fmt = (v) => v, better = 'high', bars = true, def = null } = {}) {
  const has = x != null && y != null;
  const lead = !has || x === y ? 0 : (better === 'high' ? x > y : x < y) ? 1 : -1;
  const max = Math.max(Math.abs(Number(x) || 0), Math.abs(Number(y) || 0));
  const bar = bars && has && max > 0 ? `<div class="duel-bar" aria-hidden="true"><span class="ba"><i class="${wClass((Math.abs(x) / max) * 100)}"></i></span><span class="bb"><i class="${wClass((Math.abs(y) / max) * 100)}"></i></span></div>` : '';
  return `<div class="duel${lead === 1 ? ' lead-a' : lead === -1 ? ' lead-b' : ''}"><b class="dv dva">${x == null ? '—' : esc(fmt(x))}</b><div class="dl"><span class="dlab">${def ? `<a href="#def-${def}">${esc(label)}</a>` : esc(label)}</span>${bar}${note ? `<small>${note}</small>` : ''}</div><b class="dv dvb">${y == null ? '—' : esc(fmt(y))}</b></div>`;
}

// deterministic, neutral summary of a teammate window (facts from the numbers only)
function battleSays(s, A, B) {
  const out = [];
  const lead = (pair, what) => (pair[0] === pair[1] ? `${what} is level at ${pair[0]}–${pair[1]}` : `${pair[0] > pair[1] ? A : B} leads ${what} ${Math.max(...pair)}–${Math.min(...pair)}`);
  if (s.quali_comparable) out.push(`${lead(s.quali_h2h, 'qualifying')} (${plural(s.quali_comparable, 'comparable session')})`);
  if (s.race_comparable) out.push(`${lead(s.race_h2h, 'the classified-race comparison')} (${plural(s.race_comparable, 'race')} with both classified)`);
  let text = out.length ? `Across ${plural(s.events, 'event')} as teammates, ${out.join(', and ')}.` : '';
  const g = [s.a.positions_gained, s.b.positions_gained];
  if (s.a.n_gain >= 5 && s.b.n_gain >= 5 && g[0] != null && g[1] != null && Math.abs(g[0] - g[1]) >= 0.5) text += ` ${g[0] > g[1] ? A : B} has gained more positions on average in races (${signed(Math.max(...g))} vs ${signed(Math.min(...g))}).`;
  if (s.quali_gap_pct_median != null && s.quali_gap_samples >= 3) text += ` The median qualifying gap is ${Math.abs(s.quali_gap_pct_median).toFixed(3)}% in ${s.quali_gap_pct_median < 0 ? A : B}'s favour (${plural(s.quali_gap_samples, 'session')}).`;
  return text.trim();
}

// last-N qualifying gap, bars around zero (negative = A faster); SVG attributes only (CSP: no inline styles)
function gapChart(rows, A, B) {
  const xs = rows.filter((r) => r.gap != null);
  if (xs.length < 3) return '';
  const W = 640, H = 170, mid = H / 2 - 6, max = Math.max(0.2, ...xs.map((r) => Math.abs(r.gap)));
  const bw = Math.min(46, (W - 40) / xs.length - 8);
  const bars = xs.map((r, i) => {
    const x = 20 + i * ((W - 40) / xs.length) + 4, h = (Math.abs(r.gap) / max) * (mid - 18);
    return `<g><rect class="${r.gap < 0 ? 'ga' : 'gb'}" x="${x.toFixed(1)}" y="${(r.gap < 0 ? mid - h : mid).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="2"><title>${esc(r.label)}: ${Math.abs(r.gap).toFixed(3)}% (${r.gap < 0 ? A : B} faster)</title></rect><text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${esc(r.short)}</text></g>`;
  }).join('');
  return `<figure class="mu-chart"><figcaption><b>Qualifying gap, last ${xs.length} as teammates</b><span>Above the line: ${esc(A)} faster · below: ${esc(B)} faster · % of lap time, deepest segment both completed</span></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Qualifying gap per event">${bars}<line x1="16" x2="${W - 16}" y1="${mid}" y2="${mid}" class="gz"/></svg></figure>`;
}

const finChip = (fin, status, cls = '') => `<span class="fchip${fin === 1 ? ' p1' : fin && fin <= 3 ? ' pod' : !fin ? ' out' : ''}${cls ? ` ${cls}` : ''}">${fin ? `P${fin}` : esc(status === 'retired' || !status ? 'DNF' : String(status).toUpperCase().slice(0, 3))}</span>`;

export function matchupPage(ctx, key) {
  const m = ctx.matchups[key];
  const [a, b] = [ctx.driverById[m.a], ctx.driverById[m.b]];
  const A = a.last_name, B = b.last_name;
  const season = ctx.currentSeason;
  const t = ctx.teammates.find((x) => (x.a === m.a && x.b === m.b) || (x.a === m.b && x.b === m.a));
  const flip = t && t.a !== m.a;
  const grid = (id) => ctx.currentGrid.find((g) => g.driver_id === id);
  const teamOf = (id) => grid(id) || (ctx.latestTeam[id] ? { constructor_id: ctx.latestTeam[id].constructor_id, season: ctx.latestTeam[id].season } : null);
  const ta = teamOf(m.a), tb = teamOf(m.b);
  const colA = ctx.colorOf(ta?.constructor_id, ta?.season || season), colB = ctx.colorOf(tb?.constructor_id, tb?.season || season);
  const conName = (cid) => ctx.conById[cid]?.name || cid;
  // relationship from the teammate graph (never inferred from current teams alone)
  const nowMates = t && grid(m.a) && grid(m.b) && grid(m.a).constructor_id === grid(m.b).constructor_id && t.seasons.includes(season);
  const tSpan = t ? (t.seasons[0] === t.seasons.at(-1) ? `${t.seasons[0]}` : `${t.seasons[0]}–${t.seasons.at(-1)}`) : '';
  const tTeams = t ? t.constructors.map(conName).join(', ') : '';
  const rel = nowMates ? `Teammates at ${esc(conName(grid(m.a).constructor_id))}` : t ? `Former teammates · ${esc(tTeams)} · ${tSpan}` : 'Never teammates';
  const mateCol = t ? ctx.colorOf(t.constructors.at(-1), t.seasons.at(-1)) : null;

  // ---------- hero ----------
  const side = (d, tm, col, cls) => {
    const team = tm ? `${grid(d.id) ? '' : 'Last: '}${conName(tm.constructor_id)}${grid(d.id) ? '' : ` (${tm.season})`}` : '';
    return `<div class="mu-side ${cls} ${teamClass(col)}">${headshot(d, 'lg', ctx.mediaOk, col).replace('loading="lazy"', 'loading="eager" fetchpriority="high"')}<div class="mu-id"><a class="mu-name" href="/drivers/${d.slug}"><span>${esc(d.first_name || '')}</span> ${esc(d.last_name)}</a><span class="mu-team">${grid(d.id) ? teamMark(ctx.logoFor?.(tm.constructor_id), 16) : ''}${esc(team)}${d.espn_number ? ` · #${esc(String(d.espn_number))}` : ''}</span>${d.nationality ? `<span class="mu-nat">${flag(d)}${esc(d.nationality)}</span>` : ''}<a class="more" href="/drivers/${d.slug}">View ${esc(d.last_name)} profile</a></div></div>`;
  };
  const hero = `<section class="hero mu-hero"><div class="wrap"><h1 class="mu-h1">${esc(a.full_name)} <span>vs</span> ${esc(b.full_name)}</h1><div class="mu-vs">${side(a, ta, colA, 'mu-a')}<div class="mu-mid"><span class="mu-v" aria-hidden="true">VS</span><span class="mu-rel${t ? ` ${teamClass(mateCol)}` : ''}">${rel}</span><span class="mu-shared"><b>${m.shared_events}</b> shared ${m.shared_events === 1 ? 'event' : 'events'} · ${m.first_season}${m.last_season !== m.first_season ? `–${m.last_season}` : ''}</span></div>${side(b, tb, colB, 'mu-b')}</div></div></section>`;

  // ---------- teammate battle (the controlled, same-car comparison) ----------
  let battle = '';
  if (t) {
    const windows = [['career', 'Career together'], ['last10', 'Last 10'], ['last5', 'Last 5'], ...t.seasons.slice().reverse().map((y) => [y, String(y)])].filter(([k]) => (typeof k === 'number' ? t.by_season[k] : t[k])?.events);
    const panel = (s) => {
      const says = battleSays(s, A, B);
      const comp = [
        duel('Qualifying', s.quali_h2h[0], s.quali_h2h[1], { note: `${plural(s.quali_comparable, 'comparable qualifying session')}`, def: 'quali' }),
        duel('Race*', s.race_h2h[0], s.race_h2h[1], { note: `${plural(s.race_comparable, 'race')} where both were classified, of ${s.events}`, def: 'race' }),
        s.sprint_comparable ? duel('Sprint', s.sprint_h2h[0], s.sprint_h2h[1], { note: plural(s.sprint_comparable, 'comparable sprint'), def: 'sprint' }) : '',
        s.grid_fallback_events ? duel('Starting grid', s.grid_fallback_h2h[0], s.grid_fallback_h2h[1], { note: `${plural(s.grid_fallback_events, 'event')} with no qualifying classification; grid, not qualifying`, def: 'grid' }) : '',
      ].join('');
      const gap = s.quali_gap_pct_median != null ? `<div class="mu-gap"><span class="kicker"><a href="#def-gap">Median qualifying gap</a></span><b>${Math.abs(s.quali_gap_pct_median).toFixed(3)}%</b><span>${esc(s.quali_gap_pct_median < 0 ? A : s.quali_gap_pct_median > 0 ? B : 'Neither')} faster · n=${s.quali_gap_samples}</span></div>` : '';
      const together = `<div class="mu-ct"><span><b>${s.race_comparable}/${s.events}</b> classified together</span><span>${esc(A)} DNFs <b>${s.a.dnfs}</b></span><span>${esc(B)} DNFs <b>${s.b.dnfs}</b></span></div>`;
      const res = [duel('Points', s.a.points, s.b.points, { fmt: fmtPts }), duel('Wins', s.a.wins, s.b.wins), duel('Podiums', s.a.podiums, s.b.podiums), duel('Poles', s.a.poles, s.b.poles), duel('Fastest laps', s.a.fastest_laps, s.b.fastest_laps)].join('');
      const exe = [
        duel('Average grid', s.a.avg_grid, s.b.avg_grid, { fmt: (v) => num(v), better: 'low', bars: false, note: `n=${s.a.n_grid ?? '—'} / ${s.b.n_grid ?? '—'}` }),
        duel('Average finish', s.a.avg_finish, s.b.avg_finish, { fmt: (v) => num(v), better: 'low', bars: false, note: `classified finishes, n=${s.a.n_finish ?? '—'} / ${s.b.n_finish ?? '—'}` }),
        duel('Positions gained', s.a.positions_gained, s.b.positions_gained, { fmt: (v) => signed(v), bars: false, note: `mean per classified race, n=${s.a.n_gain ?? '—'} / ${s.b.n_gain ?? '—'}`, def: 'gain' }),
        duel('DNFs', s.a.dnfs, s.b.dnfs, { better: 'low', bars: false }),
        duel('Q3 appearances', s.a.q3_appearances, s.b.q3_appearances),
      ].join('');
      return `${says ? `<p class="mu-says">${esc(says)}</p>` : ''}<div class="duel-groups"><div class="duel-group"><h3>Competitive</h3>${comp}${gap}${together}</div><div class="duel-group"><h3>Results</h3>${res}</div><div class="duel-group"><h3>Execution</h3>${exe}</div></div><p class="fine">*Race comparison counts only races where both drivers were classified; a retirement never hands the other driver a win.</p>`;
    };
    const tabs = windows.length > 1 ? `<div class="tabs" role="tablist" aria-label="Battle window">${windows.map(([k, l], i) => `<button class="tab" role="tab" type="button" aria-selected="${i === 0}" aria-controls="tw-${k}" id="tbw-${k}"${i ? ' tabindex="-1"' : ''}>${esc(l)}</button>`).join('')}</div>` : '';
    const panels = windows.map(([k], i) => `<div class="tabpanel" role="tabpanel" id="tw-${k}" aria-labelledby="tbw-${k}"${i ? ' hidden' : ''}>${panel(orient(typeof k === 'number' ? t.by_season[k] : t[k], flip))}</div>`).join('');
    const seasons = t.seasons.slice().reverse().map((y) => {
      const s = orient(t.by_season[y], flip);
      return s?.events ? `<tr><td><a href="/standings/${y}">${y}</a></td><td class="num">${s.events}</td><td class="num">${s.quali_h2h.join('–')}</td><td class="num">${s.race_h2h.join('–')} <span class="fine">/${s.race_comparable}</span></td><td class="num">${s.sprint_comparable ? `${s.sprint_h2h.join('–')} <span class="fine">/${s.sprint_comparable}</span>` : '—'}</td><td class="num">${fmtPts(s.a.points)}–${fmtPts(s.b.points)}</td></tr>` : '';
    }).join('');
    const byCon = t.constructors.length > 1 ? `<p class="fine">${t.constructors.map((c) => { const s = orient(t.by_constructor?.[c], flip); return s ? `${esc(conName(c))}: ${plural(s.events, 'event')}, qualifying ${s.quali_h2h.join('–')}, race ${s.race_h2h.join('–')} of ${s.race_comparable}` : ''; }).filter(Boolean).join(' · ')}.</p>` : '';
    const log = (t.log || []).slice(-10).map((r) => {
      const ev = ctx.eventById[r.event_id];
      const gap = r.gap_pct == null ? null : flip ? -r.gap_pct : r.gap_pct;
      return { gap, label: ev ? `${ev.season} ${ev.name}` : r.event_id, short: ev ? `R${ev.round}` : '' };
    });
    battle = `<section class="section mu-battle ${teamClass(mateCol)}"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Same constructor · ${tSpan}</span><h2>${esc(tTeams)} teammate battle</h2></div>${t.constructors.length === 1 ? `<a class="more" href="/teams/${t.constructors[0]}">${esc(conName(t.constructors[0]))}</a>` : ''}</div>
    <p class="mu-caveat">The teammate battle compares the drivers while they shared the same constructor: the controlled comparison on this page.</p>
    ${tabs}${panels}
    ${gapChart(log, A, B)}
    ${seasons ? `<h3 class="mu-h3">Season by season</h3><div class="table-wrap"><table class="mu-seasons"><thead><tr><th>Season</th><th class="num">Events</th><th class="num">Quali H2H</th><th class="num">Race H2H*</th><th class="num">Sprint</th><th class="num">Points</th></tr></thead><tbody>${seasons}</tbody></table></div>${byCon}` : ''}</div></section>`;
  }

  // ---------- shared grid history (different machinery) ----------
  const sharedSeasons = Object.entries(m.by_season || {}).sort((x, y) => y[0] - x[0]).map(([y, s]) => `<tr><td><a href="/standings/${y}">${y}</a></td><td class="num">${s.events}${s.same_team ? ` <span class="fine">(${s.same_team} as teammates)</span>` : ''}</td><td class="num">${s.quali_ahead.join('–')} <span class="fine">/${s.quali_comparable}</span></td><td class="num">${s.race_ahead.join('–')} <span class="fine">/${s.race_comparable}</span></td><td class="num">${fmtPts(s.points[0])}–${fmtPts(s.points[1])}</td></tr>`).join('');
  const shared = `<section class="section mu-sharedsec"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Shared grid history · ${m.first_season}${m.last_season !== m.first_season ? `–${m.last_season}` : ''}</span><h2>Every race weekend they shared</h2></div></div>
  <p class="mu-caveat">Shared-grid results reflect different cars, teams and competitive circumstances; they are not a same-equipment comparison.${m.same_team_events ? ` ${m.same_team_events} of these ${m.shared_events} events were as teammates${t ? ' (see the teammate battle)' : ''}.` : ''}</p>
  <div class="duel-groups duel-groups--one"><div class="duel-group">
  ${duel('Race finish H2H*', m.race_ahead[0], m.race_ahead[1], { note: `${m.race_comparable_events} comparable classified finishes of ${plural(m.shared_events, 'shared event')}`, def: 'race' })}
  ${m.quali_comparable_events ? duel('Qualifying H2H', m.quali_ahead[0], m.quali_ahead[1], { note: `${plural(m.quali_comparable_events, 'event')} with both in the official qualifying classification`, def: 'quali' }) : ''}
  ${m.grid_fallback_events ? duel('Starting grid', m.grid_ahead[0], m.grid_ahead[1], { note: `${plural(m.grid_fallback_events, 'event')} with no qualifying classification; grid, not qualifying`, def: 'grid' }) : ''}
  ${duel('Shared-event points', m.points[0], m.points[1], { fmt: fmtPts })}
  ${duel('Wins', m.wins[0], m.wins[1])}${duel('Podiums', m.podiums[0], m.podiums[1])}${m.dnfs ? duel('DNFs', m.dnfs[0], m.dnfs[1], { better: 'low', bars: false }) : ''}
  </div></div>
  <p class="fine">*Race H2H includes only events where both drivers were classified; ${plural(m.race_excluded_events, 'shared event')} had at least one driver not classified.</p>
  ${sharedSeasons ? `<details class="mu-more"><summary>Season by season</summary><div class="table-wrap"><table class="mu-seasons"><thead><tr><th>Season</th><th class="num">Events</th><th class="num">Quali</th><th class="num">Race*</th><th class="num">Points</th></tr></thead><tbody>${sharedSeasons}</tbody></table></div></details>` : ''}</div></section>`;

  // ---------- current season right now ----------
  const cur = (id) => (ctx.driverLog[id] || []).filter((x) => x.season === season);
  const ca = cur(m.a), cb = cur(m.b);
  let now = '';
  if (ca.length && cb.length) {
    const st = (id) => (ctx.standingsBy[`${season}|driver`] || []).find((s) => s.subject_id === id);
    const card = (d, rows, col) => {
      const s = st(d.id), cls = rows.filter((x) => x.classified);
      const last5 = rows.slice(-5).map((x) => finChip(x.classified ? x.finish : null, x.status)).join('');
      return `<div class="mu-now-side ${teamClass(col)}"><span class="kicker">${esc(d.last_name)}</span><b class="mu-now-pos">${s ? ordinal(s.position) : '—'}</b><span>${s ? `${fmtPts(s.points)} pts` : ''}</span><dl><div><dt>Wins</dt><dd>${cls.filter((x) => x.finish === 1).length}</dd></div><div><dt>Podiums</dt><dd>${cls.filter((x) => x.finish <= 3).length}</dd></div><div><dt>Poles</dt><dd>${rows.filter((x) => x.pole).length}</dd></div><div><dt>Starts</dt><dd>${rows.filter((x) => x.started).length}</dd></div></dl><div class="mu-last5" aria-label="Last five races">${last5}</div></div>`;
    };
    const ts = nowMates ? orient(t.by_season[season], flip) : null;
    const ss = m.by_season?.[season];
    const mid = ts ? `<div class="mu-now-mid"><span class="kicker">${season} teammate H2H</span>${duel('Qualifying', ts.quali_h2h[0], ts.quali_h2h[1], { note: plural(ts.quali_comparable, 'session') })}${duel('Race*', ts.race_h2h[0], ts.race_h2h[1], { note: `${ts.race_comparable} both classified` })}${ts.quali_gap_pct_median != null ? `<p class="fine">Median qualifying gap ${Math.abs(ts.quali_gap_pct_median).toFixed(3)}%, ${esc(ts.quali_gap_pct_median < 0 ? A : B)} faster (n=${ts.quali_gap_samples}).</p>` : ''}</div>`
      : ss ? `<div class="mu-now-mid"><span class="kicker">${season} shared events</span>${duel('Qualifying', ss.quali_ahead[0], ss.quali_ahead[1], { note: plural(ss.quali_comparable, 'event') })}${duel('Race*', ss.race_ahead[0], ss.race_ahead[1], { note: `${ss.race_comparable} both classified` })}</div>` : '';
    now = `<section class="section"><div class="wrap"><div class="section-head"><div><span class="eyebrow">${season} season only</span><h2>${season} right now</h2></div><a class="more" href="/standings">Standings</a></div><div class="mu-now">${card(a, ca, colA)}${mid}${card(b, cb, colB)}</div><p class="fine">Championship position and points from the ${season} standings; last five race results, newest on the right.</p></div></section>`;
  }

  // ---------- next race (both on the current grid) ----------
  let next = '';
  const ev = ctx.nextEvent;
  if (ev && grid(m.a) && grid(m.b)) {
    const f = ctx.fit?.[ev.id]?.drivers || [];
    const fa = f.find((x) => x.driver_id === m.a), fb = f.find((x) => x.driver_id === m.b);
    const race = (ctx.sessionsByEvent[ev.id] || []).find((s) => s.type === 'race');
    const ts = nowMates ? orient(t.by_season[season], flip) : null;
    next = `<section class="section"><div class="wrap"><div class="card mu-next"><div><span class="eyebrow">Next · Round ${ev.round}</span><h2>${esc(ev.name)}</h2><p class="muted"><a href="${ctx.circuitUrl(ev.circuit_id)}">${esc(ctx.circuitName(ev.circuit_id))}</a>${race?.start_utc ? ` · race ${esc(fmtDate(race.start_utc))}` : ''}</p></div>
    ${fa && fb ? `<div class="mu-next-fit">${duel('Circuit Fit', fa.fit_score, fb.fit_score, { note: 'descriptive profile match, not a prediction', def: 'fit' })}</div>` : ''}
    ${ts ? `<p class="fine">${season} as teammates: qualifying ${ts.quali_h2h.join('–')}, race ${ts.race_h2h.join('–')} of ${ts.race_comparable} both classified.</p>` : ''}
    <p class="mu-links"><a class="more" href="${ctx.raceUrl(ev.id)}">Race weekend hub</a> <a class="more" href="/pbecast/${esc(ev.id)}">PBEcast</a></p></div></div></section>`;
  }

  // ---------- Driver DNA ----------
  const dA = ctx.dnaCur[m.a] || ctx.dnaCareer[m.a];
  const dB = ctx.dnaCur[m.b] || ctx.dnaCareer[m.b];
  let dna = '';
  if (dA && dB) {
    const keys = [...new Set([...Object.keys(dA.dimensions), ...Object.keys(dB.dimensions)])];
    const rawTxt = (x) => (x?.raw ? Object.entries(x.raw).filter(([, v]) => v != null && typeof v !== 'object').slice(0, 3).map(([k, v]) => `${k.replace(/_/g, ' ')} ${typeof v === 'number' ? num(v, 3) : v}`).join(', ') : '');
    const detail = (d, x) => (x ? `<li><b>${esc(d.last_name)}</b>: ${x.percentile == null ? 'unavailable' : `${ordinal(x.percentile)} percentile`}${x.sample_size != null ? `, sample ${x.sample_size}` : ''}${x.population ? `, population ${esc(x.population)}` : ''}${rawTxt(x) ? `, raw ${esc(rawTxt(x))}` : ''}${x.confidence ? `, confidence ${esc(x.confidence)}` : ''}</li>` : `<li><b>${esc(d.last_name)}</b>: unavailable</li>`);
    const rows = keys.map((k) => {
      const x = dA.dimensions[k], y = dB.dimensions[k];
      const p = (v) => v?.percentile ?? null;
      const label = x?.label || y?.label || k;
      return `<div class="dna-duel"><b class="dv dva">${p(x) == null ? '—' : p(x)}</b><div class="dl"><span class="dlab">${esc(label)}</span><div class="duel-bar" aria-hidden="true"><span class="ba"><i class="${wClass(p(x) ?? 0)}"></i></span><span class="bb"><i class="${wClass(p(y) ?? 0)}"></i></span></div><details><summary>Definition &amp; sample</summary><p>${esc(x?.basis || y?.basis || '')}</p><ul>${detail(a, x)}${detail(b, y)}</ul></details></div><b class="dv dvb">${p(y) == null ? '—' : p(y)}</b></div>`;
    }).join('');
    // profile differences on circuit types (descriptive; both available and not insufficient; gap >= 15 points)
    const diffs = ['street', 'high_speed', 'low_speed'].map((k) => [k, dA.dimensions[k], dB.dimensions[k]]).filter(([, x, y]) => x?.percentile != null && y?.percentile != null && x.confidence !== 'insufficient' && y.confidence !== 'insufficient' && Math.abs(x.percentile - y.percentile) >= 15);
    const diffHtml = diffs.length ? `<div class="mu-diff"><h3>Where their profiles differ</h3><ul>${diffs.map(([, x, y]) => `<li><b>${esc(x.label)}</b>: ${esc(A)} ${ordinal(x.percentile)} percentile, ${esc(B)} ${ordinal(y.percentile)} <span class="fine">(samples ${x.sample_size} / ${y.sample_size})</span></li>`).join('')}</ul><p class="fine">Profile differences within each driver's own population, not a ranking of the two drivers.</p></div>` : '';
    dna = `<section class="section"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Driver DNA · ${esc(A)} ${esc(dA.window)} · ${esc(B)} ${esc(dB.window)}</span><h2>Profile comparison</h2></div><a class="more" href="/methodology#driver-dna">Methodology</a></div>
    <p class="mu-caveat">Percentiles place each driver within their own window population; they are not a direct head-to-head. A 90th against a 10th percentile does not mean one driver beat the other nine times as often. Teammate-relative dimensions compare each driver with their own teammates.</p>
    <div class="dna-duels">${rows}</div>${diffHtml}</div></section>`;
  }

  // ---------- recent shared races ----------
  const sideRes = (r, d) => `<span class="mu-r-side"><span class="mu-r-who">${esc(d.last_name)}</span>${r.quali ? `<span>Q${r.quali}</span>` : ''}${r.grid ? `<span>G${r.grid}</span>` : ''}${finChip(r.finish, r.status)}<span>${fmtPts(r.points)} pts</span></span>`;
  const recent = (m.recent || []).map((r) => {
    const e = ctx.eventById[r.event_id];
    if (!e) return '';
    const race = (ctx.sessionsByEvent[e.id] || []).find((s) => s.type === 'race');
    return `<li class="mu-race${r.ahead ? ` ahead-${r.ahead}` : ''}"><div class="mu-r-ev"><a href="${ctx.raceUrl(e.id)}">${e.season} ${esc(e.name)}</a><span class="fine">${esc(fmtDate(race?.start_utc || e.end_utc || e.start_utc))} · ${esc(ctx.circuitName(e.circuit_id))}${r.same_team ? ` · teammates at ${esc(conName(r.a.constructor_id))}` : ''}</span></div><div class="mu-r-res">${sideRes(r.a, a)}${sideRes(r.b, b)}</div><span class="mu-r-ahead">${r.ahead ? `${esc(r.ahead === 'a' ? A : B)} ahead` : 'Not comparable'}</span></li>`;
  }).join('');

  const glossary = `<section class="section"><div class="wrap"><details class="mu-gloss"><summary>Definitions</summary><dl>
  <dt id="def-race">Race H2H</dt><dd>Events where both drivers were classified; the lower finishing position counts. A retirement is never a head-to-head win for the other driver.</dd>
  <dt id="def-quali">Qualifying H2H</dt><dd>The official qualifying classification, where both drivers have one. Grid penalties never change it.</dd>
  <dt id="def-grid">Starting grid</dt><dd>Shown separately, only for events with no published qualifying classification for the pair. Grid positions include penalties and pit-lane starts.</dd>
  <dt id="def-sprint">Sprint H2H</dt><dd>Sprint sessions where both drivers have a sprint classification; weekends without a sprint do not count.</dd>
  <dt id="def-gap">Median qualifying gap</dt><dd>Percentage lap-time difference from the deepest qualifying segment both drivers completed (teammates only).</dd>
  <dt id="def-gain">Positions gained</dt><dd>Finishing position relative to grid, in classified races.</dd>
  <dt id="def-fit">Circuit Fit</dt><dd>How each driver's current DNA matches this circuit's profile. Descriptive, not a prediction. <a href="/methodology">Methodology</a></dd>
  </dl></details></div></section>`;

  const path = `/matchup/${a.slug}/${b.slug}`;
  const bc = [['/', 'Home'], ['/matchups', 'Matchups'], [path, `${A} vs ${B}`]];
  const body = `${crumbs(bc)}
  ${hero}
  ${t ? battle : ''}
  ${now}
  ${shared}
  ${dna}
  ${next}
  ${recent ? `<section class="section"><div class="wrap"><div class="section-head"><h2>Recent shared races</h2></div><ol class="mu-races">${recent}</ol><p class="fine">Q qualifying classification · G starting grid · finishing position · points.</p></div></section>` : ''}
  ${glossary}`;
  const title = t ? `${a.full_name} vs ${b.full_name}: F1 Head-to-Head & ${nowMates ? `${conName(grid(m.a).constructor_id)} ` : ''}Teammate Battle` : `${a.full_name} vs ${b.full_name}: F1 Head-to-Head & Shared Grid History`;
  const description = `${a.full_name} vs ${b.full_name}: ${m.shared_events} shared Formula 1 events (classified-finish H2H ${m.race_ahead[0]}–${m.race_ahead[1]} of ${m.race_comparable_events})${t ? `, ${tTeams} teammate battle (qualifying ${orient(t.career, flip).quali_h2h.join('–')})` : ''}${ca.length && cb.length ? `, ${season} season snapshot` : ''} and Driver DNA comparison.`;
  // comparison bars take each driver's team colour (CSP: classes only, so the colour classes are stamped here)
  const painted = body.replaceAll('<span class="ba">', `<span class="ba ${teamClass(colA)}">`).replaceAll('<span class="bb">', `<span class="bb ${teamClass(colB)}">`);
  return { path, title, description, body: painted, section: '/matchups', jsonLd: [jsonLdBreadcrumb(bc)] };
}
