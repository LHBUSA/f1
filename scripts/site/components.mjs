import { esc, fmtPts, fmtMs, ordinal, teamClass, headshot, flag, pctBar, confBadge, dnaRadar, fmtNum, pct, timeTag, fmtDate, teamMark } from './lib.mjs';
import { trendFor } from '../../src/core/standings.mjs';
import { SESSION_LABEL } from '../../src/core/normalize.mjs';

export function driverCell(ctx, did, cid, season, opts = {}) {
  const d = ctx.driverById[did];
  const color = ctx.colorOf(cid, season);
  const name = d ? d.full_name : did;
  const url = ctx.driverUrl(did);
  return `<div class="drv ${teamClass(color)}"><span class="tbar"></span>${opts.avatar ? headshot(d, 'sm', ctx.mediaOk, color) : ''}<span>${url ? `<a href="${url}">${esc(name)}</a>` : esc(name)}${opts.code !== false && d?.code ? ` <span class="code">${esc(d.code)}</span>` : ''}</span></div>`;
}
export const teamLink = (ctx, cid, season) => (cid && ctx.conById[cid] ? `<a class="tlink" href="${ctx.teamUrl(cid)}">${season === ctx.currentSeason ? teamMark(ctx.logoFor?.(cid), 16) : ''}${esc(ctx.conById[cid].name)}</a>` : esc(cid || '—'));

export function statusText(r) {
  if (!r.status) return '—';
  if (r.status === 'classified') return r.behind_laps ? `+${r.behind_laps} lap${r.behind_laps > 1 ? 's' : ''}` : r.gap_text || r.time_text || 'Classified';
  if (r.status === 'retired') return `<span class="st-ret">DNF${r.laps != null ? ` · L${r.laps}` : ''}</span>`;
  if (r.status === 'disqualified') return '<span class="st-dsq">DSQ</span>';
  if (r.status === 'did_not_start') return '<span class="st-ret">DNS</span>';
  if (r.status === 'not_classified') return `<span class="st-ret">NC${r.laps != null ? ` · L${r.laps}` : ''}</span>`;
  if (r.status === 'did_not_appear' || r.status === 'withdrawn') return '<span class="muted">WD</span>';
  if (r.status === 'did_not_qualify') return '<span class="muted">DNQ</span>';
  if (r.status === 'did_not_prequalify') return '<span class="muted">DNPQ</span>';
  return esc(r.status_text || r.status);
}

export function sessionTable(ctx, ev, type) {
  const rows = ctx.rows(ev.id, type);
  if (!rows.length) return `<div class="empty">No classification published for this session.</div>`;
  const isRace = type === 'race' || type === 'sprint';
  const isQ = type === 'qualifying' || type === 'sprint_qualifying';
  const fastest = Math.min(...rows.map((r) => r.fastest_lap_ms || Infinity));
  const bestQ = {};
  for (const k of ['q1_ms', 'q2_ms', 'q3_ms']) bestQ[k] = Math.min(...rows.map((r) => r[k] || Infinity));
  const head = isRace
    ? '<th class="pos">Pos</th><th>Driver</th><th>Team</th><th class="num">Grid</th><th class="num">+/−</th><th class="num">Laps</th><th>Time / Status</th><th class="num">Pits</th><th class="num">Pts</th>'
    : isQ
      ? '<th class="pos">Pos</th><th>Driver</th><th>Team</th><th class="num">Q1</th><th class="num">Q2</th><th class="num">Q3</th><th class="num">Laps</th>'
      : '<th class="pos">Pos</th><th>Driver</th><th>Team</th><th class="num">Best lap</th><th class="num">Gap</th><th class="num">Laps</th>';
  const body = rows
    .map((r) => {
      const posCls = r.position && r.position <= 3 && (r.status === 'classified' || !isRace) ? `p${r.position}` : '';
      const pos = isRace && r.status !== 'classified' ? '—' : r.position ?? '—';
      if (isRace) {
        const delta = r.status === 'classified' && r.grid && r.position ? r.grid - r.position : null;
        return `<tr class="${posCls}"><td class="pos">${pos}</td><td>${driverCell(ctx, r.driver_id, r.constructor_id, ev.season)}</td><td class="team-cell">${teamLink(ctx, r.constructor_id, ev.season)}</td><td class="num">${r.grid || (r.grid === 0 ? 'PL' : '—')}</td><td class="num ${delta > 0 ? 'gain' : delta < 0 ? 'loss' : ''}">${delta == null ? '' : delta > 0 ? '+' + delta : delta}</td><td class="num">${r.laps ?? '—'}</td><td>${statusText(r)}${Number.isFinite(fastest) && r.fastest_lap_ms === fastest ? ` <span class="fl" title="Fastest lap ${esc(r.fastest_lap_text)}">FL</span>` : ''}</td><td class="num">${r.pit_stops ?? '—'}</td><td class="num">${r.points ? fmtPts(r.points) : ''}</td></tr>`;
      }
      if (isQ) {
        const q = (k) => (r[k] ? `<span class="${r[k] === bestQ[k] ? 'purple' : ''}">${fmtMs(r[k])}</span>` : '—');
        return `<tr class="${posCls}"><td class="pos">${pos}</td><td>${driverCell(ctx, r.driver_id, r.constructor_id, ev.season)}</td><td class="team-cell">${teamLink(ctx, r.constructor_id, ev.season)}</td><td class="num">${q('q1_ms')}</td><td class="num">${q('q2_ms')}</td><td class="num">${q('q3_ms')}</td><td class="num">${r.laps ?? '—'}</td></tr>`;
      }
      return `<tr class="${posCls}"><td class="pos">${pos}</td><td>${driverCell(ctx, r.driver_id, r.constructor_id, ev.season)}</td><td class="team-cell">${teamLink(ctx, r.constructor_id, ev.season)}</td><td class="num ${r.position === 1 ? 'purple' : ''}">${fmtMs(r.best_lap_ms)}</td><td class="num">${r.position === 1 ? '' : esc(r.gap_text || '')}</td><td class="num">${r.laps ?? '—'}</td></tr>`;
    })
    .join('');
  const note = type === 'race' && rows.some((r) => r.points_scope === 'weekend_incl_sprint') ? '<p class="fine">Points shown are weekend totals (sprint points included).</p>' : '';
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${note}`;
}

export function standingsTable(ctx, season, kind, limit = 99, opts = {}) {
  const rows = (ctx.standingsBy[`${season}|${kind}`] || []).filter((s) => s.subject_id).sort((a, b) => a.position - b.position).slice(0, limit);
  if (!rows.length) return '<div class="empty">Standings not published for this season.</div>';
  const prog = ctx.progression[season];
  // Trend = change since the previous completed Grand Prix (current season only; src/core/standings.mjs)
  const showTrend = season === ctx.currentSeason;
  const trendTh = showTrend ? '<th class="num trend-h"><span title="Change since previous completed Grand Prix" aria-label="Change since previous completed Grand Prix">Trend</span></th>' : '';
  const head = kind === 'driver' ? `<th class="pos">Pos</th><th>Driver</th><th>Team</th><th class="num">Wins</th><th class="num">Pts</th>${trendTh}` : `<th class="pos">Pos</th><th>Constructor</th><th class="num">Wins</th><th class="num">Pts</th>${trendTh}`;
  const body = rows
    .map((s) => {
      const tr = showTrend ? `<td class="num trend">${trendCell(trendFor(prog?.matches_official === false ? null : prog, kind, s.subject_id, s.position))}</td>` : '';
      if (kind === 'driver') {
        const team = ctx.dcsByDriver[s.subject_id]?.filter((x) => x.season === season).sort((a, b) => b.entries - a.entries)[0]?.constructor_id;
        return `<tr class="p${s.position}"><td class="pos">${s.position}</td><td>${driverCell(ctx, s.subject_id, team, season, { avatar: opts.avatar })}</td><td class="team-cell">${teamLink(ctx, team, season)}</td><td class="num">${s.wins ?? '—'}</td><td class="num"><b>${fmtPts(s.points)}</b></td>${tr}</tr>`;
      }
      const color = ctx.colorOf(s.subject_id, season);
      return `<tr class="p${s.position}"><td class="pos">${s.position}</td><td><div class="drv ${teamClass(color)}"><span class="tbar"></span>${teamLink(ctx, s.subject_id, season)}</div></td><td class="num">${s.wins ?? '—'}</td><td class="num"><b>${fmtPts(s.points)}</b></td>${tr}</tr>`;
    })
    .join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const SHORT = { qualifying: 'Quali', race_result: 'Race', positions_gained: 'Gains', finishing: 'Finish', consistency: 'Consist.', scoring: 'Points', street: 'Street', high_speed: 'Hi-spd', low_speed: 'Lo-spd', qualifying_speed: 'Quali', race_results: 'Results', reliability: 'Reliab.', driver_balance: 'Balance', track_position: 'Track pos', overtaking: 'Overtake', high_speed_demand: 'Hi-spd', low_speed_demand: 'Lo-spd', attrition: 'Attrition', pit_load: 'Stops' };

export function dnaPanel(dna, { color = 'ff4d2e', title = 'Driver DNA', note = '' } = {}) {
  if (!dna) return '<div class="empty">No DNA profile for this window.</div>';
  const dims = Object.fromEntries(Object.entries(dna.dimensions).map(([k, v]) => [k, { ...v, short: SHORT[k] }]));
  const populated = Object.fromEntries(Object.entries(dims).filter(([, v]) => v.percentile != null));
  const rows = Object.entries(dims)
    .map(([, d]) => {
      const raw = Object.entries(d.raw || {})
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `<dt>${esc(k.replace(/_/g, ' '))}</dt><dd>${esc(typeof v === 'number' ? (Math.abs(v) < 1 && /rate|share/.test(k) ? pct(v, 1) : String(v)) : v)}</dd>`)
        .join('');
      return `<div class="dna-row"><div class="dna-top"><h4>${esc(d.label)}</h4>${confBadge(d.confidence)}</div>${pctBar(d.percentile)}<details class="dna-detail"><summary>n=${d.sample_size}${d.population ? ` · vs ${esc(d.population)}` : ''}</summary><p>${esc(d.basis)}</p><dl>${raw}</dl></details></div>`;
    })
    .join('');
  // Unmeasured dimensions are not listed on the page (owner 2026-10-02); they stay in the DNA payload for methodology.
  const unavailable = '';
  return `<div class="split even"><div>${Object.keys(populated).length >= 3 ? dnaRadar(populated, color) : '<div class="empty">Fewer than three dimensions meet the minimum sample.</div>'}<p class="fine">${esc(title)} · ${esc(dna.window || dna.season || '')} · ${esc(dna.version)} · as of ${esc(fmtDate(dna.as_of))}${note ? ' · ' + esc(note) : ''}</p>${unavailable}</div><div class="dna">${rows}</div></div>`;
}

export function battleCard(ctx, t, season, { link = true } = {}) {
  const s = season && t.by_season[season] ? t.by_season[season] : t.career;
  const [a, b] = [ctx.driverById[t.a], ctx.driverById[t.b]];
  const cid = t.constructors.at(-1);
  const color = ctx.colorOf(cid, season || t.seasons.at(-1));
  const row = (lbl, x, y) => {
    const tot = x + y || 1;
    return `<div class="h2h-row"><span class="lbl">${lbl}</span><span>${x}</span><div class="split-bar"><i class="sa ${wcls((x / tot) * 100)}"></i><i class="sb ${wcls((y / tot) * 100)}"></i></div><span class="r">${y}</span></div>`;
  };
  const url = link ? ctx.matchupUrl(t.a, t.b) : null;
  return `<div class="card battle ${teamClass(color)}">
    <div class="side">${headshot(a, 'md', ctx.mediaOk, color)}<span class="nm">${esc(a?.last_name || a?.full_name)}</span></div>
    <span class="vs">VS</span>
    <div class="side">${headshot(b, 'md', ctx.mediaOk, color)}<span class="nm">${esc(b?.last_name || b?.full_name)}</span></div>
    <div class="h2h">
      ${row('Qualifying', s.quali_h2h[0], s.quali_h2h[1])}
      ${row('Race', s.race_h2h[0], s.race_h2h[1])}
      ${row('Points', Math.round(s.a.points), Math.round(s.b.points))}
      <p class="fine">${s.quali_gap_pct_median != null ? `Median qualifying gap ${s.quali_gap_pct_median > 0 ? '+' : ''}${s.quali_gap_pct_median.toFixed(3)}% (${esc(a?.code || a?.last_name)} vs ${esc(b?.code || b?.last_name)}, n=${s.quali_gap_samples})` : 'No comparable qualifying times'} · ${s.events} events${season ? ` in ${season}` : ' together'} · ${teamLink(ctx, cid)}</p>
      ${url ? `<a class="more" href="${url}">Full battle</a>` : ''}
    </div></div>`;
}
const wcls = (p) => `w-${Math.max(0, Math.min(100, Math.round(p)))}`;

export function fitList(ctx, fit, limit = 10) {
  if (!fit?.drivers?.length) return '<div class="empty">Circuit Fit unavailable for this event.</div>';
  const ev = ctx.eventById[fit.event_id];
  return `<div>${fit.drivers
    .slice(0, limit)
    .map((f, i) => {
      const d = ctx.driverById[f.driver_id];
      const strong = f.components.filter((c) => f.strongest.includes(c.key)).map((c) => `${c.label} ${c.percentile}`).join(' · ');
      const weak = f.components.filter((c) => f.weakest.includes(c.key) && !f.strongest.includes(c.key)).map((c) => `${c.label} ${c.percentile}`).join(' · ');
      return `<div class="fitrow"><span class="pos">${i + 1}</span><div>${driverCell(ctx, f.driver_id, f.constructor_id, ev.season)}<div class="why">▲ ${esc(strong)}${weak ? ` &nbsp; ▼ ${esc(weak)}` : ''} · ${confBadge(f.confidence)}</div></div><span class="fs">${f.fit_score}</span></div>`;
    })
    .join('')}<p class="fine">${esc(fit.disclaimer)} ${esc(fit.version)}.</p></div>`;
}

export function sessionList(ctx, ev) {
  const ss = [...(ctx.sessionsByEvent[ev.id] || [])].sort((a, b) => (a.start_utc || '').localeCompare(b.start_utc || ''));
  return ss
    .map((s) => {
      const st = s.state === 'completed' ? '<span class="pill pill-done">Final</span>' : s.state === 'live' ? '<span class="pill pill-live">Live</span>' : s.state === 'canceled' ? '<span class="pill pill-cancel">Cancelled</span>' : '';
      return `<div class="sess"><span class="n">${esc(SESSION_LABEL[s.type] || s.label)}</span><span>${st}</span><span class="st">${s.time_valid ? timeTag(s.start_utc) : `${esc(fmtDate(s.start_utc))} · time TBC`}</span></div>`;
    })
    .join('');
}

// 'Upcoming' only while the weekend is still ahead: never for an event whose end has passed (a source state that did
// not advance), and the client drops it once its end passes between builds (data-until, app.js).
export function statusPill(ev, now = Date.now()) {
  if (ev.status === 'completed') return '<span class="pill pill-done">Final</span>';
  if (ev.status === 'live' || ev.status === 'in_progress') return '<span class="pill pill-live">Race weekend</span>';
  if (ev.status === 'canceled') return '<span class="pill pill-cancel">Cancelled</span>';
  const end = ev.end_utc || ev.start_utc;
  if (end && Date.parse(end) <= now) return '';
  return `<span class="pill"${end ? ` data-until="${esc(end)}"` : ''}>Upcoming</span>`;
}

export { fmtNum, ordinal };

// ↑ n gained / ↓ n lost / — unchanged / "n/a" no comparable history (never the same symbol as unchanged)
export function trendCell(t) {
  if (t.state === 'up') return `<span class="gain" title="Gained ${t.delta} championship position${t.delta > 1 ? 's' : ''} since previous round" aria-label="Up ${t.delta}">↑ ${t.delta}</span>`;
  if (t.state === 'down') return `<span class="loss" title="Lost ${-t.delta} championship position${t.delta < -1 ? 's' : ''} since previous round" aria-label="Down ${-t.delta}">↓ ${-t.delta}</span>`;
  if (t.state === 'same') return '<span class="same" title="No position change since previous round" aria-label="No position change since previous round">—</span>';
  return `<span class="na" title="${esc(t.reason || 'Trend unavailable')}" aria-label="Trend unavailable">n/a</span>`;
}

// Sessions of a weekend still AHEAD at `now`: not completed/cancelled and starting in the future. A session whose
// source state never advanced past 'scheduled' after its start is not ahead (never labelled Next).
export function sessionsAhead(sessions, now) {
  return [...(sessions || [])].filter((s) => s.start_utc && s.state !== 'completed' && s.state !== 'canceled' && Date.parse(s.start_utc) > now).sort((a, b) => Date.parse(a.start_utc) - Date.parse(b.start_utc));
}
