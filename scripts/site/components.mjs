import { esc, fmtPts, fmtMs, ordinal, teamClass, headshot, flag, pctBar, confBadge, dnaRadar, fmtNum, pct, timeTag, fmtDate } from './lib.mjs';
import { SESSION_LABEL } from '../../src/core/normalize.mjs';

export function driverCell(ctx, did, cid, season, opts = {}) {
  const d = ctx.driverById[did];
  const color = ctx.colorOf(cid, season);
  const name = d ? d.full_name : did;
  const url = ctx.driverUrl(did);
  return `<div class="drv ${teamClass(color)}"><span class="tbar"></span>${opts.avatar ? headshot(d, 'sm', ctx.mediaOk, color) : ''}<span>${url ? `<a href="${url}">${esc(name)}</a>` : esc(name)}${opts.code !== false && d?.code ? ` <span class="code">${esc(d.code)}</span>` : ''}</span></div>`;
}
export const teamLink = (ctx, cid) => (cid && ctx.conById[cid] ? `<a href="${ctx.teamUrl(cid)}">${esc(ctx.conById[cid].name)}</a>` : esc(cid || '—'));

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
        return `<tr class="${posCls}"><td class="pos">${pos}</td><td>${driverCell(ctx, r.driver_id, r.constructor_id, ev.season)}</td><td class="team-cell">${teamLink(ctx, r.constructor_id)}</td><td class="num">${r.grid || (r.grid === 0 ? 'PL' : '—')}</td><td class="num ${delta > 0 ? 'gain' : delta < 0 ? 'loss' : ''}">${delta == null ? '' : delta > 0 ? '+' + delta : delta}</td><td class="num">${r.laps ?? '—'}</td><td>${statusText(r)}${Number.isFinite(fastest) && r.fastest_lap_ms === fastest ? ` <span class="fl" title="Fastest lap ${esc(r.fastest_lap_text)}">FL</span>` : ''}</td><td class="num">${r.pit_stops ?? '—'}</td><td class="num">${r.points ? fmtPts(r.points) : ''}</td></tr>`;
      }
      if (isQ) {
        const q = (k) => (r[k] ? `<span class="${r[k] === bestQ[k] ? 'purple' : ''}">${fmtMs(r[k])}</span>` : '—');
        return `<tr class="${posCls}"><td class="pos">${pos}</td><td>${driverCell(ctx, r.driver_id, r.constructor_id, ev.season)}</td><td class="team-cell">${teamLink(ctx, r.constructor_id)}</td><td class="num">${q('q1_ms')}</td><td class="num">${q('q2_ms')}</td><td class="num">${q('q3_ms')}</td><td class="num">${r.laps ?? '—'}</td></tr>`;
      }
      return `<tr class="${posCls}"><td class="pos">${pos}</td><td>${driverCell(ctx, r.driver_id, r.constructor_id, ev.season)}</td><td class="team-cell">${teamLink(ctx, r.constructor_id)}</td><td class="num ${r.position === 1 ? 'purple' : ''}">${fmtMs(r.best_lap_ms)}</td><td class="num">${r.position === 1 ? '' : esc(r.gap_text || '')}</td><td class="num">${r.laps ?? '—'}</td></tr>`;
    })
    .join('');
  const note = type === 'race' && rows.some((r) => r.points_scope === 'weekend_incl_sprint') ? '<p class="fine">Points shown are weekend totals (sprint points included).</p>' : '';
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${note}`;
}

export function standingsTable(ctx, season, kind, limit = 99, opts = {}) {
  const rows = (ctx.standingsBy[`${season}|${kind}`] || []).filter((s) => s.subject_id).sort((a, b) => a.position - b.position).slice(0, limit);
  if (!rows.length) return '<div class="empty">Standings not published for this season.</div>';
  const prog = ctx.progression[season];
  const rounds = prog?.rounds || [];
  const prev = rounds.length > 1 ? rounds[rounds.length - 2][kind === 'driver' ? 'drivers' : 'constructors'] : null;
  const head = kind === 'driver' ? '<th class="pos">Pos</th><th>Driver</th><th>Team</th><th class="num">Wins</th><th class="num">Pts</th><th class="num">Trend</th>' : '<th class="pos">Pos</th><th>Constructor</th><th class="num">Wins</th><th class="num">Pts</th><th class="num">Trend</th>';
  const body = rows
    .map((s) => {
      const trend = prev && prev[s.subject_id] && prog?.matches_official !== false ? prev[s.subject_id].pos - s.position : null;
      const tr = trend == null || season !== ctx.currentSeason ? '' : trend > 0 ? `<span class="gain">▲${trend}</span>` : trend < 0 ? `<span class="loss">▼${-trend}</span>` : '<span class="muted">–</span>';
      if (kind === 'driver') {
        const team = ctx.dcsByDriver[s.subject_id]?.filter((x) => x.season === season).sort((a, b) => b.entries - a.entries)[0]?.constructor_id;
        return `<tr class="p${s.position}"><td class="pos">${s.position}</td><td>${driverCell(ctx, s.subject_id, team, season, { avatar: opts.avatar })}</td><td class="team-cell">${teamLink(ctx, team)}</td><td class="num">${s.wins ?? '—'}</td><td class="num"><b>${fmtPts(s.points)}</b></td><td class="num">${tr}</td></tr>`;
      }
      const color = ctx.colorOf(s.subject_id, season);
      return `<tr class="p${s.position}"><td class="pos">${s.position}</td><td><div class="drv ${teamClass(color)}"><span class="tbar"></span>${teamLink(ctx, s.subject_id)}</div></td><td class="num">${s.wins ?? '—'}</td><td class="num"><b>${fmtPts(s.points)}</b></td><td class="num">${tr}</td></tr>`;
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
  const unavailable = dna.unavailable ? `<div class="unavail" aria-label="Unavailable dimensions">${Object.entries(dna.unavailable).map(([k, why]) => `<span title="${esc(why)}">${esc(k.replace(/_/g, ' '))}: not sourced</span>`).join('')}</div>` : '';
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

export function statusPill(ev) {
  if (ev.status === 'completed') return '<span class="pill pill-done">Final</span>';
  if (ev.status === 'live' || ev.status === 'in_progress') return '<span class="pill pill-live">Race weekend</span>';
  if (ev.status === 'canceled') return '<span class="pill pill-cancel">Cancelled</span>';
  return '<span class="pill">Upcoming</span>';
}

export { fmtNum, ordinal };
