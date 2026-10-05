// PropBetEdge F1 client. Progressive enhancement only: every page is complete without it.
// Page behaviour is organised as MODULES (window.F1.register): each mounts on a root and returns a cleanup, so the
// soft-navigation router (nav.js) can unmount before swapping <main> and remount after - no duplicate timers or
// listeners. Shell behaviour (menu, live pill, analytics) runs once per document.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const API = 'https://propsports.proptechusa.ai/v1/f1'; // the PropSports F1 contract; no other data host
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ---------- module registry ----------
  const F1 = (window.F1 ||= {});
  F1.modules ||= {};
  F1.mounted ||= {};
  F1.register = (name, mod) => {
    F1.modules[name] = mod;
    F1.mount(name, document);
  };
  F1.mount = (name, root) => {
    const mod = F1.modules[name];
    if (!mod || F1.mounted[name]) return;
    if (mod.selector && !root.querySelector(mod.selector)) return;
    try { F1.mounted[name] = mod.mount(root) || (() => {}); } catch (e) { console.warn('F1 module mount failed', name, e); }
  };
  F1.mountAll = (root = document) => { for (const name of Object.keys(F1.modules)) F1.mount(name, root); };
  F1.unmountAll = () => { for (const [name, cleanup] of Object.entries(F1.mounted)) { try { cleanup(); } catch {} delete F1.mounted[name]; } };

  const fmtLocal = (d, mode) => {
    try {
      const opts = mode === 'date' ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
      return new Intl.DateTimeFormat(undefined, opts).format(d);
    } catch { return d.toUTCString(); }
  };
  F1.fmtLocal = fmtLocal;

  // ---------- tables: scroll affordance + split safety net ----------
  // A table wider than its box gets data-scroll=start|middle|end (CSS fades the edge that has more columns).
  // A two-column .split whose tables still overflow with this page's content is stacked (.is-stacked) instead of
  // hiding columns behind an invisible scroll.
  F1.register('tables', {
    selector: '.table-wrap',
    mount(root) {
      const wraps = $$('.table-wrap', root);
      const mark = (w) => {
        const over = w.scrollWidth - w.clientWidth > 1;
        const s = !over ? '' : w.scrollLeft <= 1 ? 'start' : w.scrollLeft >= w.scrollWidth - w.clientWidth - 1 ? 'end' : 'middle';
        if (s) w.dataset.scroll = s; else delete w.dataset.scroll;
      };
      const fit = () => {
        for (const s of $$('.split', root)) {
          if (!s.querySelector('.table-wrap')) continue;
          s.classList.remove('is-stacked');
          if (getComputedStyle(s).gridTemplateColumns.split(' ').length > 1 && $$('.table-wrap', s).some((w) => w.scrollWidth - w.clientWidth > 1)) s.classList.add('is-stacked');
        }
        wraps.forEach(mark);
      };
      const onScroll = (e) => mark(e.currentTarget);
      wraps.forEach((w) => w.addEventListener('scroll', onScroll, { passive: true }));
      let raf = 0;
      const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); };
      addEventListener('resize', onResize);
      fit();
      document.fonts?.ready.then(fit);
      return () => { removeEventListener('resize', onResize); wraps.forEach((w) => w.removeEventListener('scroll', onScroll)); };
    },
  });

  // ---------- shell (once per document) ----------
  const mb = $('[data-menu]');
  if (mb) mb.addEventListener('click', () => {
    const nav = $('#primary-nav');
    const open = nav.classList.toggle('open');
    mb.setAttribute('aria-expanded', String(open));
  });

  // Live pill (header) + legacy cast block if the current page has one (looked up each tick: survives soft nav)
  const pill = $('[data-live-pill]');
  async function live() {
    try {
      const r = await fetch(`${API}/live`, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch { return null; }
  }
  async function pillLoop() {
    const s = await live();
    if (pill && s?.state === 'live') {
      pill.hidden = false;
      $('[data-live-text]', pill).textContent = `LIVE · ${s.session?.label || ''}`;
    } else if (pill) pill.hidden = true;
    if ($('[data-pbecast]')) renderCast(s);
    setTimeout(pillLoop, s?.state === 'live' ? 10000 : 60000);
  }
  if (!F1.pillStarted && (pill || $('[data-pbecast]'))) { F1.pillStarted = true; pillLoop(); }

  let lastOrder = {};
  function renderCast(s) {
    const state = $('[data-cast-state]');
    const tower = $('[data-cast-tower]');
    if (!state || !tower) return;
    if (!s) {
      state.textContent = 'Live source unavailable';
      tower.innerHTML = '<tr><td colspan="7" class="muted">The live source could not be reached. Nothing is shown rather than stale or simulated data.</td></tr>';
      return;
    }
    const ses = s.session;
    state.className = 'pill ' + (s.state === 'live' ? 'pill-live' : s.state === 'post' ? 'pill-done' : '');
    state.textContent = s.state === 'live' ? `Live · ${ses?.label || ''}` : s.state === 'post' ? `Final · ${ses?.label || ''}` : 'No session live';
    $('[data-cast-title]').textContent = s.event?.name || '';
    const flag = $('[data-cast-flag]');
    if (ses?.flag) { flag.hidden = false; flag.textContent = ses.flag; flag.className = 'flagchip flag-' + String(ses.flag).toLowerCase(); } else flag.hidden = true;
    const lapEl = $('[data-cast-lap]');
    lapEl.textContent = ses?.lap && ses?.laps_total ? `Lap ${ses.lap} / ${ses.laps_total}` : ses?.lap ? `Lap ${ses.lap}` : '';
    const lb = $('[data-cast-lapbar]');
    if (ses?.lap && ses?.laps_total) { lb.hidden = false; lb.firstElementChild.className = 'w-' + Math.min(100, Math.round((ses.lap / ses.laps_total) * 100)); } else lb.hidden = true;
    // 'Next' is only ever a future session: an upstream next that has already started is not shown as next
    const next = s.next && Date.parse(s.next.start_utc) > Date.now() ? s.next : null;
    $('[data-cast-updated]').textContent = s.updated_at ? `Updated ${fmtLocal(new Date(s.updated_at))}${next && s.state !== 'live' ? ` · Next: ${next.label} ${fmtLocal(new Date(next.start_utc))}` : ''}` : '';
    if (!s.tower?.length) {
      tower.innerHTML = `<tr><td colspan="7" class="muted">${next ? `Next session: ${esc(next.event)} · ${esc(next.label)} — ${esc(fmtLocal(new Date(next.start_utc)))}` : 'No classification yet.'}</td></tr>`;
    } else {
      tower.innerHTML = s.tower
        .map((r) => {
          const key = r.driver_id || r.name;
          const changed = lastOrder[key] && lastOrder[key] !== r.pos ? ' class="changed"' : '';
          const st = r.status === 'retired' ? '<span class="st-ret">OUT</span>' : r.status === 'disqualified' ? '<span class="st-dsq">DSQ</span>' : r.status && r.status !== 'classified' && r.status !== 'running' ? esc(r.status) : '';
          return `<tr${changed}><td class="pos">${r.pos ?? '—'}</td><td><div class="drv tc-${esc((r.color || '').toLowerCase())}"><span class="tbar"></span><span>${r.driver_id ? `<a href="/drivers/${esc(r.driver_id)}">${esc(r.name)}</a>` : esc(r.name)} <span class="code">${esc(r.code || '')}</span><span class="fine"> ${esc(r.team || '')}</span></span></div></td><td class="num gap">${esc(r.gap || '')}</td><td class="num">${r.laps ?? ''}</td><td class="num">${r.pits ?? ''}</td><td class="num ${r.fastest ? 'purple' : ''}">${esc(r.best || '')}</td><td>${st}</td></tr>`;
        })
        .join('');
      lastOrder = Object.fromEntries(s.tower.map((r) => [r.driver_id || r.name, r.pos]));
    }
    const feed = $('[data-cast-feed]');
    if (s.feed?.length) {
      feed.innerHTML = s.feed
        .slice()
        .reverse()
        .map((f) => `<li><span class="t">${f.lap ? 'L' + f.lap : esc(new Date(f.t).toISOString().slice(11, 16))}</span><span><span class="k k-${esc(f.kind)}">${esc(f.kind_label || f.kind)}</span>${esc(f.text)}</span></li>`)
        .join('');
    }
  }

  // Analytics: the shared PropBetEdge privacy runtime owns GA4 loading and consent.
  if (!F1.gaStarted && location.hostname === 'f1.propbetedge.ai') {
    F1.gaStarted = true;
    window.PBEPrivacy?.initAnalytics?.({ surface: 'f1', analytics: true, sendPageView: true });
  }

  // ---------- page module: core behaviour inside <main> ----------
  F1.register('core', {
    mount(root) {
      const timers = [];
      for (const t of $$('time[data-local]', root)) {
        const d = new Date(t.getAttribute('datetime'));
        if (!Number.isNaN(+d)) t.textContent = fmtLocal(d, t.dataset.local);
      }
      for (const p of $$('.pill[data-until]', root)) if (Date.parse(p.dataset.until) <= Date.now()) p.remove();
      for (const el of $$('[data-countdown]', root)) {
        // the build picked the next session; if it has started since, advance through the weekend's remaining sessions,
        // and when none is left remove the countdown (never a countdown to the past)
        let queue = [];
        try { queue = JSON.parse(el.dataset.countdownQueue || '[]'); } catch {}
        const label = el.previousElementSibling?.matches('[data-countdown-label]') ? el.previousElementSibling : null;
        let target = Date.parse(el.dataset.countdown);
        const advance = () => {
          const nx = queue.find(([, iso]) => Date.parse(iso) > Date.now());
          if (!nx) { el.hidden = true; if (label) label.hidden = true; return false; }
          target = Date.parse(nx[1]);
          if (label) label.textContent = `Next session: ${nx[0]}`;
          return true;
        };
        if (target <= Date.now() && !advance()) continue;
        const tick = () => {
          if (target <= Date.now() && !advance()) return;
          let s = Math.max(0, Math.floor((target - Date.now()) / 1000));
          const d = Math.floor(s / 86400); s -= d * 86400;
          const h = Math.floor(s / 3600); s -= h * 3600;
          const m = Math.floor(s / 60); s -= m * 60;
          $('[data-d]', el).textContent = d; $('[data-h]', el).textContent = String(h).padStart(2, '0');
          $('[data-m]', el).textContent = String(m).padStart(2, '0'); $('[data-s]', el).textContent = String(s).padStart(2, '0');
        };
        tick();
        timers.push(setInterval(tick, 1000));
      }
      for (const list of $$('[role="tablist"]', root)) {
        const tabs = $$('[role="tab"]', list);
        const select = (tab) => {
          for (const t of tabs) {
            const on = t === tab;
            t.setAttribute('aria-selected', String(on));
            t.tabIndex = on ? 0 : -1;
            const p = document.getElementById(t.getAttribute('aria-controls'));
            if (p) p.hidden = !on;
          }
        };
        tabs.forEach((tab, i) => {
          tab.addEventListener('click', () => select(tab));
          tab.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
              n.focus(); select(n);
            }
          });
        });
      }
      // Headshot fallback: never show a broken image.
      for (const img of $$('img[data-fallback]', root)) {
        const swap = () => { const span = img.parentElement; span.classList.add('avatar-initials'); span.textContent = img.dataset.fallback; };
        if (img.complete && img.naturalWidth === 0) swap();
        else img.addEventListener('error', swap, { once: true });
      }
      for (const img of $$('img.flag', root)) img.addEventListener('error', () => img.remove(), { once: true });
      for (const input of $$('[data-filter]', root)) {
        const items = $$(input.dataset.filter, root);
        input.addEventListener('input', () => {
          const q = input.value.trim().toLowerCase();
          for (const a of items) a.hidden = q && !(a.dataset.name || a.textContent.toLowerCase()).includes(q);
        });
      }
      // Weather (MET Norway via f1-api; forecast range only)
      const ctl = new AbortController();
      for (const el of $$('[data-weather]', root)) {
        const slug = el.dataset.weather;
        if (!slug) continue;
        const from = Date.parse(el.dataset.weatherFrom);
        if (from - Date.now() > 9 * 86400e3) continue;
        fetch(`${API}/weather?circuit=${encodeURIComponent(slug)}&from=${encodeURIComponent(el.dataset.weatherFrom)}&to=${encodeURIComponent(el.dataset.weatherTo)}`, { signal: ctl.signal })
          .then((r) => (r.ok ? r.json() : null))
          .then((w) => {
            if (!w?.days?.length) return;
            el.innerHTML = `<span class="kicker">Forecast</span> ` + w.days.map((d) => `${esc(fmtLocal(new Date(d.date + 'T12:00:00Z'), 'date'))}: ${Math.round(d.t_max)}°C, ${d.precip_mm.toFixed(1)} mm${d.wind_ms != null ? `, wind ${Math.round(d.wind_ms)} m/s` : ''}`).join(' · ') + (w.licence_credit ? ` <span class="muted">· ${esc(w.licence_credit)}</span>` : '');
          })
          .catch(() => {});
      }
      return () => { timers.forEach(clearInterval); ctl.abort(); };
    },
  });
  // ---------- page module: /people directory filters (the server-rendered list is complete without JS) ----------
  F1.register('people', {
    selector: '[data-pdir-ctl]',
    mount(root) {
      const ctl = $('[data-pdir-ctl]', root);
      const list = $('[data-pdir]', root);
      if (!ctl || !list) return null;
      const items = $$('.pdir-item', list);
      const chips = $$('[data-g]', ctl);
      const team = $('[data-pdir-team]', ctl);
      const q = $('[data-pdir-q]', ctl);
      const count = $('[data-pdir-count]', ctl);
      const empty = $('[data-pdir-empty]', root);
      const params = new URLSearchParams(location.search);
      let group = params.get('group') || '';
      if (params.get('team') && [...team.options].some((o) => o.value === params.get('team'))) team.value = params.get('team');
      if (params.get('q')) q.value = params.get('q');
      const apply = () => {
        const term = q.value.trim().toLowerCase();
        let n = 0;
        for (const li of items) {
          const show = (!group || li.dataset.groups.split(' ').includes(group)) && (!team.value || li.dataset.team === team.value) && (!term || li.dataset.name.includes(term));
          li.hidden = !show;
          if (show) n++;
        }
        for (const c of chips) c.setAttribute('aria-pressed', String(c.dataset.g === group));
        count.textContent = `${n} ${n === 1 ? 'person' : 'people'}`;
        if (empty) empty.hidden = n > 0;
        // keep the filter in the URL so Back/Forward and shared links restore it (history.state kept for nav.js)
        const u = new URL(location.href);
        for (const [k, v] of [['group', group], ['team', team.value], ['q', q.value.trim()]]) { if (v) u.searchParams.set(k, v); else u.searchParams.delete(k); }
        if (u.href !== location.href) try { history.replaceState(history.state, '', u.href); } catch {}
      };
      const onChip = (e) => { const b = e.target.closest('[data-g]'); if (!b) return; group = b.dataset.g; apply(); };
      ctl.addEventListener('click', onChip);
      team.addEventListener('change', apply);
      q.addEventListener('input', apply);
      ctl.addEventListener('submit', (e) => e.preventDefault());
      ctl.hidden = false;
      apply();
      return () => { ctl.removeEventListener('click', onChip); team.removeEventListener('change', apply); q.removeEventListener('input', apply); };
    },
  });
})();
