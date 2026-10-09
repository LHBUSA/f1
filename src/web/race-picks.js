// F1 Race Picks client (Race Lab). Values arrive only from the server-verified /pbe/f1/picks route (All Access);
// free visitors get the server teaser (what is locked, never a probability or pick). Nothing renders when there is
// nothing to show (no empty-state modules). CSP style-src 'self': widths are classes, never inline styles.
(() => {
  const API = '/pbe/f1/picks';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pct = (p, d = 1) => (p == null ? '—' : `${(p * 100).toFixed(d)}%`);
  const w = (p) => `rp-w-${Math.max(0, Math.min(100, Math.round((p || 0) * 100)))}`;
  const host = () => document.querySelector('[data-race-picks]');
  const nameOf = (lock, id) => lock.drivers?.find((d) => d.driver_id === id)?.name || id;
  const label = (l) => `<span class="rp-label rp-label-${esc(String(l || 'RESEARCH').toLowerCase())}">${esc(l || 'RESEARCH')}</span>`;
  const VERSION = { pre_qualifying: 'Pre-qualifying lock', post_qualifying: 'Post-qualifying lock' };
  const FAMILY = { teammate_quali_h2h: 'Teammate qualifying H2H', teammate_race_h2h: 'Teammate race H2H', driver_outlook: 'Top 10 / podium outlook', race_winner: 'Race winner' };
  const when = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—'; };
  const res = (r) => `<b class="rp-res rp-res-${esc(String(r).toLowerCase())}">${esc(r)}</b>`;

  function teaser(root, b) {
    const t = b?.teaser;
    if (!t?.latest_event || !t.versions?.length) { root.remove(); return; }
    root.innerHTML = `<section class="rp-teaser premium-gate"><span class="eyebrow">◆ All Access · Race Research</span><h2>Post-qualifying research predictions</h2>
      <p>${esc(t.versions.map((v) => VERSION[v] || v).join(' and '))} published for this weekend — top-10 and podium outlooks, teammate race head-to-heads and race-winner model probabilities beside the market, locked before the race and graded after the official classification.</p>
      <ul class="rp-teaser-list">${t.families.map((f) => `<li>${esc(FAMILY[f] || f)}</li>`).join('')}</ul>
      <div class="rl-actions"><a class="pc-cta" href="/all-access">View All Access</a></div></section>`;
  }

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

  function record(d) {
    const rows = Object.entries(d.record || {}).sort().map(([k, r]) => {
      const [fam, ver] = k.split('|');
      return `<tr><th scope="row">${esc(FAMILY[fam] || fam)}<small>${esc(VERSION[ver] || ver)}</small></th><td>${r.win}–${r.loss}</td><td>${r.void}</td><td>${r.pending}</td><td>${r.mean_log_loss ?? (r.top10_brier != null ? `Brier ${r.top10_brier}` : '—')}</td></tr>`;
    }).join('');
    return rows ? `<article class="rp-card rp-wide"><header><h3>Track record · prospective locks only</h3><span class="rp-label rp-label-shadow">SHADOW</span></header>
      <div class="table-wrap"><table class="rp-table"><thead><tr><th scope="col">Family</th><th scope="col">W–L</th><th scope="col">Void</th><th scope="col">Pending</th><th scope="col">Mean log loss</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="fine">Every lock is graded, wins and losses alike. Backtests never enter this record. Race-winner W–L only records whether the model's most likely driver won; the probability score (log loss) is what is measured, and no winner-prediction advantage has been established.</p></article>` : '';
  }

  function render(root, d) {
    const locks = d.locks || [];
    if (!locks.length) { root.remove(); return; }
    const ev = locks[0].event;
    const forEvent = locks.filter((l) => l.event.id === ev.id).sort((a, b) => (a.version === 'post_qualifying' ? -1 : 1));
    const sections = forEvent.map((l) => `<section class="rp-lock"><div class="rp-lock-head"><h3>${esc(VERSION[l.version] || l.version)}</h3><small>Locked ${esc(when(l.locked_at))} · before ${esc(when(l.deadline))} · sha256 ${esc(String(l.evidence?.sha256 || '').slice(0, 12))}</small></div>
      <div class="rp-grid">${l.families.driver_outlook ? outlook(l, l.grades?.race) : ''}${l.families.teammate_race_h2h ? pairs(l, 'teammate_race_h2h', l.grades?.race) : ''}${l.families.race_winner ? winner(l, l.grades?.race?.families?.race_winner, d.winner_note || '') : ''}</div></section>`).join('');
    root.innerHTML = `<section class="rp-desk"><div class="rp-head"><div><span class="eyebrow">◆ All Access · Race Research · ${esc(ev.name)}</span><h2>Race research predictions</h2><p class="muted">Model ${esc(d.model_version)} · RESEARCH · locked after qualifying and before the race, immutable, graded after the official classification. Research probabilities, not an official pick service.</p></div></div>
      ${sections}<div class="rp-grid">${record(d)}</div></section>`;
  }

  async function mount() {
    const root = host();
    if (!root) return;
    try {
      const r = await fetch(API, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      const b = await r.json().catch(() => null);
      if (r.status === 200 && b?.tier === 'all_access') render(root, b);
      else if (r.status === 403) teaser(root, b);
      else root.remove();
    } catch { root.remove(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})();
