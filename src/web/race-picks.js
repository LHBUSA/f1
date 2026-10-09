// F1 Race Picks client (/picks, /track-record, Race Lab). Values arrive only from the server-verified /pbe/f1/picks
// route (All Access); free visitors get the server teaser: weekend publication status, lock evidence (ids, times,
// hashes) and the aggregate prospective record — never a selection, probability or per-pick grade. The component never
// disappears: every state (awaiting qualifying, held, locked, graded, unavailable) renders real status from the ledger.
// CSP style-src 'self': widths are classes, never inline styles.
(() => {
  const API = '/pbe/f1/picks';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pct = (p, d = 1) => (p == null ? '—' : `${(p * 100).toFixed(d)}%`);
  const w = (p) => `rp-w-${Math.max(0, Math.min(100, Math.round((p || 0) * 100)))}`;
  const nameOf = (lock, id) => lock.drivers?.find((d) => d.driver_id === id)?.name || id;
  const label = (l) => `<span class="rp-label rp-label-${esc(String(l || 'RESEARCH').toLowerCase())}">${esc(l || 'RESEARCH')}</span>`;
  const VERSION = { pre_qualifying: 'Pre-qualifying lock', post_qualifying: 'Post-qualifying lock' };
  const FAMILY = { teammate_quali_h2h: 'Teammate qualifying H2H', teammate_race_h2h: 'Teammate race H2H', driver_outlook: 'Top 10 / podium outlook', race_winner: 'Race winner' };
  const FAMS = ['driver_outlook', 'teammate_race_h2h', 'race_winner'];
  const when = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—'; };
  const res = (r) => `<b class="rp-res rp-res-${esc(String(r).toLowerCase())}">${esc(r)}</b>`;
  const short = (h) => esc(String(h || '').slice(0, 12));
  const RULE = 'Post-qualifying research picks publish only after Grand Prix qualifying is officially classified, and lock at least 10 minutes before the race. Sprint qualifying is not Grand Prix qualifying and never opens the window.';
  const STATE = {
    awaiting_qualifying: (s) => ['Awaiting Grand Prix qualifying', `Qualifying starts ${when(s.event.quali_start)}. Nothing is locked or published before the official classification.`],
    awaiting_classification: () => ['Awaiting the official qualifying classification', 'Qualifying has started. The lock is written on the first 10-minute ledger check after the classification is published.'],
    lock_due: (s) => ['Qualifying classified — lock due', `The post-qualifying lock is written on the next 10-minute ledger check${s.lane?.next_check_by ? ` (by ${when(s.lane.next_check_by)})` : ''}.`],
    held_field_incomplete: (s) => ['Lock held — entry field incomplete', `The classification feed does not yet carry a complete, identified field, so nothing is locked. Rechecked every 10 minutes until ${when(s.lock_window?.closes)}.`],
    locked: (s) => ['Locked', `Post-qualifying lock written ${when(s.locked_at)}, before the race. Graded after the official race classification.`],
    graded: (s) => ['Graded', `The post-qualifying lock written ${when(s.locked_at)} is graded against the official race classification. Results are in the track record below.`],
    window_closed: () => ['No lock for this race', 'The lock window closed without an eligible post-qualifying lock, so nothing is published or graded for this race.'],
    season_complete: () => ['Season complete', 'No Grand Prix remains on the published calendar.'],
  };

  function winner(lock, grade, note) {
    const rw = lock.families.race_winner;
    const rows = Object.entries(rw.probs).sort((a, b) => b[1] - a[1]);
    const mk = Object.fromEntries((lock.market_benchmark?.rows || []).map((r) => [r.driver_id, r.venues]));
    const q = (v) => (v?.mid_bp == null ? '—' : `${(v.mid_bp / 100).toFixed(1)}%`);
    const anyMarket = rows.some(([id]) => mk[id]?.kalshi?.mid_bp != null || mk[id]?.polymarket?.mid_bp != null);
    const top = rows.slice(0, 10).map(([id, p]) => `<li class="${grade?.winner === id ? 'is-winner' : ''}"><span class="rp-name">${esc(nameOf(lock, id))}</span><span class="rp-bar"><i class="${w(p / Math.max(rows[0][1], 1e-9))}"></i></span><b>${pct(p)}</b>${anyMarket ? `<small class="rp-mkt">${q(mk[id]?.kalshi)} · ${q(mk[id]?.polymarket)}</small>` : ''}</li>`).join('');
    const rest = rows.slice(10).reduce((s, [, p]) => s + p, 0) + rw.other;
    return `<article class="rp-card rp-wide"><header><h3>Race winner · model probabilities</h3>${label(lock.labels?.race_winner)}</header>
      <ol class="rp-winner">${top}<li class="rp-rest"><span class="rp-name">Rest of field + unlisted entrant</span><span class="rp-bar"><i class="${w(rest / Math.max(rows[0][1], 1e-9))}"></i></span><b>${pct(rest)}</b></li></ol>
      <p class="fine rp-note">${esc(note)}${anyMarket ? ' Market columns: Kalshi · Polymarket mid at lock, native venue prices (Polymarket rules: comparable except postponement/cancellation). Never an input to the model.' : ''}</p>
      ${grade ? `<p class="rp-grade">Winner: <b>${esc(nameOf(lock, grade.winner))}</b> · model probability ${pct(grade.p_winner)} · log loss ${esc(grade.log_loss)} · model favourite ${res(grade.favorite_result)}</p>` : ''}</article>`;
  }

  function pairs(lock, fam, grades) {
    const g = Object.fromEntries((grades?.families?.[fam] || []).map((x) => [`${x.a}|${x.b}`, x]));
    const rows = (lock.families[fam] || []).map((p) => {
      const x = g[`${p.a}|${p.b}`];
      const pp = p.pick === p.a ? p.p_a : 1 - p.p_a;
      return `<li><span class="rp-pick">${esc(nameOf(lock, p.pick))}</span><small>over ${esc(nameOf(lock, p.pick === p.a ? p.b : p.a))}</small><b>${pct(pp, 0)}</b>${x ? res(x.result) : '<b class="rp-res rp-res-pending">PENDING</b>'}</li>`;
    }).join('');
    return rows ? `<article class="rp-card rp-wide"><header><h3>${FAMILY[fam]}</h3>${label(lock.labels?.[fam])}</header><ol class="rp-pairs">${rows}</ol></article>` : '';
  }

  function outlook(lock, grade) {
    const g = Object.fromEntries((grade?.families?.driver_outlook || []).map((x) => [x.driver_id, x]));
    const rows = [...lock.families.driver_outlook].sort((a, b) => a.exp_rank - b.exp_rank).map((d) => {
      const x = g[d.driver_id];
      const fin = x ? (x.void ? 'VOID' : x.finish ? `P${x.finish}` : 'DNF') : '';
      return `<tr><th scope="row">${esc(nameOf(lock, d.driver_id))}</th><td>${d.exp_rank == null ? '—' : d.exp_rank.toFixed(1)}</td><td>${pct(d.p_top10, 0)}</td><td>${pct(d.p_podium, 0)}</td>${grade ? `<td>${esc(fin)}</td>` : ''}</tr>`;
    }).join('');
    return `<article class="rp-card rp-wide"><header><h3>${FAMILY.driver_outlook}</h3>${label(lock.labels?.driver_outlook)}</header>
      <div class="table-wrap"><table class="rp-table"><thead><tr><th scope="col">Driver</th><th scope="col">Projected</th><th scope="col">Top 10</th><th scope="col">Podium</th>${grade ? '<th scope="col">Result</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div></article>`;
  }

  function status(d, mode) {
    const s = d.weekend || {};
    const [title, copy] = (STATE[s.state] || (() => ['Status unavailable', 'The weekend status could not be read.']))(s);
    const sched = s.event ? `<dl class="rp-sched"><div><dt>Grand Prix qualifying</dt><dd>${esc(when(s.event.quali_start))}</dd></div><div><dt>Lock window closes</dt><dd>${esc(when(s.lock_window?.closes))}</dd></div><div><dt>Race</dt><dd>${esc(when(s.event.race_start))}</dd></div></dl>` : '';
    const sq = (s.sessions || []).find((x) => x.type === 'sprint_qualifying');
    const lane = s.lane ? `Ledger checked ${esc(when(s.lane.checked_at))}` : 'Ledger check time unavailable';
    const ver = d.verify ? ` · ledger verification ${d.verify.ok ? 'pass' : 'FAIL'} (${esc(when(d.verify.at))})` : '';
    const links = mode === 'record' ? '<a class="more" href="/picks">Race Picks</a>' : '<a class="more" href="/track-record">Full track record</a>';
    return `<section class="rp-status rp-state-${esc(s.state || 'unknown')}" aria-label="Race Picks status"><div class="rp-status-head"><div><span class="eyebrow">RESEARCH — not official · ${esc(s.event?.name || 'F1 Race Picks')}</span><h2>${esc(title)}</h2></div>${label('RESEARCH')}</div>
      <p>${esc(copy)}</p>${sched}<p class="fine">${esc(RULE)}${sq ? ` This weekend's sprint qualifying (${esc(when(sq.start_utc))}) does not trigger a lock.` : ''}</p>
      <p class="fine rp-lane">${lane}${ver} · model ${esc(d.model_version || '—')}</p><div class="rl-actions">${links}</div></section>`;
  }

  function guestCta(d) {
    const what = d.weekend?.state === 'locked' ? 'This weekend’s post-qualifying lock is written. All Access members see its selections now.' : 'When the post-qualifying lock is written, All Access members see its selections.';
    return `<section class="rp-teaser premium-gate"><span class="eyebrow">◆ All Access · Race Research</span><h2>Post-qualifying research picks</h2>
      <p>${esc(what)} Families: ${esc(FAMS.map((f) => FAMILY[f]).join(', '))} (model probabilities beside the market). Public visitors see status, lock evidence and the graded record only.</p>
      <div class="rl-actions"><a class="pc-cta" href="/all-access">View All Access</a></div></section>`;
  }

  function record(d) {
    const rec = d.record || {};
    const rows = FAMS.map((f) => {
      const r = rec[`${f}|post_qualifying`] || { win: 0, loss: 0, void: 0, pending: 0 };
      const score = r.mean_log_loss != null ? `Log loss ${r.mean_log_loss}` : r.top10_brier != null ? `Brier ${r.top10_brier}` : '—';
      return `<tr><th scope="row">${esc(FAMILY[f])}<small>${esc(VERSION.post_qualifying)}</small></th><td>${r.win}</td><td>${r.loss}</td><td>${r.void}</td><td>${r.pending}</td><td>${esc(score)}</td></tr>`;
    }).join('');
    const empty = !Object.keys(rec).length;
    return `<article class="rp-card rp-wide" id="record"><header><h3>Track record · prospective locks only</h3><span class="rp-label rp-label-shadow">SHADOW</span></header>
      <div class="table-wrap"><table class="rp-table"><thead><tr><th scope="col">Family</th><th scope="col">W</th><th scope="col">L</th><th scope="col">Void</th><th scope="col">Pending</th><th scope="col">Score</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="fine">${empty ? 'No published lock has been written yet, so every count is zero. The first one is written after the next eligible Grand Prix qualifying. ' : ''}Every published lock is graded, wins and losses alike. Historical backtests and internal shadow research never enter this record. Race-winner W–L only records whether the model's most likely driver won; the probability score (log loss, lower is better) is what is measured, and no winner-prediction advantage has been established.</p></article>`;
  }

  function evidence(d, member) {
    const ev = d.evidence || [];
    const rows = ev.map((e) => `<tr><th scope="row">${member ? `<a href="/picks#${esc(e.event.id)}">${esc(e.event.name)}</a>` : esc(e.event.name)}<small>${esc(VERSION[e.version] || e.version)} · ${esc(e.model_version || '')}</small></th><td>${esc(when(e.locked_at))}</td><td><code title="${esc(e.sha256)}">${short(e.sha256)}</code></td><td>${e.settlement === 'graded' ? `<b class="rp-res rp-res-win">GRADED</b><small>rev ${esc(e.revisions)}</small>` : '<b class="rp-res rp-res-pending">PENDING</b>'}</td></tr>`).join('');
    return `<article class="rp-card rp-wide" id="evidence"><header><h3>Lock evidence</h3><span class="rp-label">${ev.length} lock${ev.length === 1 ? '' : 's'}</span></header>
      ${rows ? `<div class="table-wrap"><table class="rp-table rp-evidence"><thead><tr><th scope="col">Event · version</th><th scope="col">Locked</th><th scope="col">sha256</th><th scope="col">Status</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">No published lock yet.</p>'}
      <p class="fine">Each lock is written once (create-only) to the ledger before its race and never edited; the sha256 is computed from the stored bytes and re-verified on every 10-minute check. Grades are appended as new revisions.</p></article>`;
  }

  function lockSection(l, d) {
    return `<section class="rp-lock" id="${esc(l.event.id)}"><div class="rp-lock-head"><h3>${esc(l.event.name)} · ${esc(VERSION[l.version] || l.version)}</h3><small>Locked ${esc(when(l.locked_at))} · before ${esc(when(l.deadline))} · sha256 ${short(l.evidence?.sha256)}</small></div>
      <div class="rp-grid">${l.families.driver_outlook ? outlook(l, l.grades?.race) : ''}${l.families.teammate_race_h2h ? pairs(l, 'teammate_race_h2h', l.grades?.race) : ''}${l.families.race_winner ? winner(l, l.grades?.race?.families?.race_winner, d.winner_note || '') : ''}</div></section>`;
  }

  function render(root, d, member) {
    const mode = root.dataset.racePicks || 'picks';
    const locks = member ? d.locks || [] : [];
    const cur = d.weekend?.event?.id;
    const current = locks.filter((l) => l.event.id === cur);
    const past = locks.filter((l) => l.event.id !== cur);
    let picks = '';
    if (member && mode !== 'record') picks = current.map((l) => lockSection(l, d)).join('') + (past.length ? `<details class="rp-past"><summary>Earlier locks (${past.length})</summary>${past.map((l) => lockSection(l, d)).join('')}</details>` : '');
    if (member && mode === 'record' && locks.length) picks = `<details class="rp-past"><summary>Event drilldown (${locks.length})</summary>${locks.map((l) => lockSection(l, d)).join('')}</details>`;
    root.innerHTML = `<div class="rp-desk">${status(d, mode)}${member ? '' : guestCta(d)}${picks}<div class="rp-grid">${record(d)}${evidence(d, member)}</div></div>`;
    if (location.hash) { const t = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (t) { t.closest('details')?.setAttribute('open', ''); t.scrollIntoView(); } }
  }

  function unavailable(root) {
    root.innerHTML = `<div class="rp-desk"><section class="rp-status rp-state-unavailable"><span class="eyebrow">RESEARCH — not official · F1 Race Picks</span><h2>Race Picks temporarily unavailable</h2><p>The picks ledger could not be reached. Locks and grades are unaffected; this page only reads them.</p><p class="fine">${esc(RULE)}</p><div class="rl-actions"><button type="button" class="more rp-retry" data-rp-retry>Try again</button></div></section></div>`;
  }

  function mount(doc = document) {
    const root = doc.querySelector('[data-race-picks]');
    if (!root) return () => {};
    const ctl = new AbortController();
    const load = async () => {
      try {
        const signal = AbortSignal.any ? AbortSignal.any([ctl.signal, AbortSignal.timeout(10000)]) : ctl.signal;
        const r = await fetch(API, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' }, signal });
        const b = await r.json().catch(() => null);
        if (ctl.signal.aborted) return;
        if (r.status === 200 && b?.tier === 'all_access') render(root, b, true);
        else if (r.status === 403 && b?.teaser?.weekend) render(root, b.teaser, false);
        else unavailable(root);
      } catch { if (!ctl.signal.aborted) unavailable(root); }
    };
    const onClick = (e) => { if (e.target.closest('[data-rp-retry]')) { const h = root.querySelector('.rp-status h2'); if (h) h.textContent = 'Checking the picks ledger…'; load(); } };
    root.addEventListener('click', onClick);
    load();
    return () => { ctl.abort(); root.removeEventListener('click', onClick); };
  }
  if (window.F1?.register) window.F1.register('race-picks', { selector: '[data-race-picks]', mount });
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount(), { once: true });
  else mount();
})();
