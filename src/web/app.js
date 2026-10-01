// PropBetEdge F1 client. Progressive enhancement only: every page is complete without it.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const API = '/api/v1';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // Menu
  const mb = $('[data-menu]');
  if (mb) mb.addEventListener('click', () => {
    const nav = $('#primary-nav');
    const open = nav.classList.toggle('open');
    mb.setAttribute('aria-expanded', String(open));
  });

  // Local time
  const fmtLocal = (d, mode) => {
    try {
      const opts = mode === 'date' ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
      return new Intl.DateTimeFormat(undefined, opts).format(d);
    } catch { return d.toUTCString(); }
  };
  for (const t of $$('time[data-local]')) {
    const d = new Date(t.getAttribute('datetime'));
    if (!Number.isNaN(+d)) t.textContent = fmtLocal(d, t.dataset.local);
  }

  // Countdown
  for (const el of $$('[data-countdown]')) {
    const target = Date.parse(el.dataset.countdown);
    const tick = () => {
      let s = Math.max(0, Math.floor((target - Date.now()) / 1000));
      const d = Math.floor(s / 86400); s -= d * 86400;
      const h = Math.floor(s / 3600); s -= h * 3600;
      const m = Math.floor(s / 60); s -= m * 60;
      $('[data-d]', el).textContent = d; $('[data-h]', el).textContent = String(h).padStart(2, '0');
      $('[data-m]', el).textContent = String(m).padStart(2, '0'); $('[data-s]', el).textContent = String(s).padStart(2, '0');
    };
    tick();
    setInterval(tick, 1000);
  }

  // Tabs
  for (const list of $$('[role="tablist"]')) {
    const tabs = $$('[role="tab"]', list);
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
          n.focus(); select(n);
        }
      });
    });
    function select(tab) {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        const p = document.getElementById(t.getAttribute('aria-controls'));
        if (p) p.hidden = !on;
      }
    }
  }

  // Headshot fallback: never show a broken image.
  for (const img of $$('img[data-fallback]')) {
    const swap = () => {
      const span = img.parentElement;
      span.classList.add('avatar-initials');
      span.textContent = img.dataset.fallback;
    };
    if (img.complete && img.naturalWidth === 0) swap();
    else img.addEventListener('error', swap, { once: true });
  }
  for (const img of $$('img.flag')) img.addEventListener('error', () => img.remove(), { once: true });

  // List filter
  for (const input of $$('[data-filter]')) {
    const items = $$(input.dataset.filter);
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      for (const a of items) a.hidden = q && !(a.dataset.name || a.textContent.toLowerCase()).includes(q);
    });
  }

  // Weather (MET Norway via f1-api; forecast range only)
  for (const el of $$('[data-weather]')) {
    const slug = el.dataset.weather;
    if (!slug) continue;
    const from = Date.parse(el.dataset.weatherFrom);
    if (from - Date.now() > 9 * 86400e3) continue;
    fetch(`${API}/weather/${encodeURIComponent(slug)}?from=${encodeURIComponent(el.dataset.weatherFrom)}&to=${encodeURIComponent(el.dataset.weatherTo)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((w) => {
        if (!w?.days?.length) return;
        el.innerHTML = `<span class="kicker">Forecast</span> ` + w.days.map((d) => `${esc(fmtLocal(new Date(d.date + 'T12:00:00Z'), 'date'))}: ${Math.round(d.t_max)}°C, ${d.precip_mm.toFixed(1)} mm${d.wind_ms != null ? `, wind ${Math.round(d.wind_ms)} m/s` : ''}`).join(' · ') + ` <span class="muted">· MET Norway (CC BY 4.0)</span>`;
      })
      .catch(() => {});
  }

  // Live pill (all pages)
  const pill = $('[data-live-pill]');
  const cast = $('[data-pbecast]');
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
    if (cast) renderCast(s);
    setTimeout(pillLoop, s?.state === 'live' ? 10000 : 60000);
  }
  if (pill || cast) pillLoop();

  // PBEcast renderer
  let lastOrder = {};
  let manifest = null;
  if (cast) fetch('/data/live-manifest.json').then((r) => (r.ok ? r.json() : null)).then((m) => (manifest = m)).catch(() => {});
  function renderCast(s) {
    const state = $('[data-cast-state]');
    const tower = $('[data-cast-tower]');
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
    $('[data-cast-updated]').textContent = s.updated_at ? `Source update ${fmtLocal(new Date(s.updated_at))}${s.next && s.state !== 'live' ? ` · Next: ${s.next.label} ${fmtLocal(new Date(s.next.start))}` : ''}` : '';
    if (!s.tower?.length) {
      tower.innerHTML = `<tr><td colspan="7" class="muted">${s.next ? `Next session: ${esc(s.next.event)} · ${esc(s.next.label)} — ${esc(fmtLocal(new Date(s.next.start)))}` : 'No classification yet.'}</td></tr>`;
    } else {
      tower.innerHTML = s.tower
        .map((r) => {
          const changed = lastOrder[r.id] && lastOrder[r.id] !== r.pos ? ' class="changed"' : '';
          const st = r.status === 'retired' ? '<span class="st-ret">OUT</span>' : r.status === 'disqualified' ? '<span class="st-dsq">DSQ</span>' : r.status && r.status !== 'classified' && r.status !== 'running' ? esc(r.status) : '';
          const m = manifest?.drivers?.[r.id];
          return `<tr${changed}><td class="pos">${r.pos ?? '—'}</td><td><div class="drv tc-${esc((r.color || '').toLowerCase())}"><span class="tbar"></span><span>${m ? `<a href="/drivers/${esc(m.s)}">${esc(m.n)}</a>` : esc(r.name)} <span class="code">${esc(m?.c || '')}</span><span class="fine"> ${esc(r.team || '')}</span></span></div></td><td class="num gap">${esc(r.gap || '')}</td><td class="num">${r.laps ?? ''}</td><td class="num">${r.pits ?? ''}</td><td class="num ${r.fastest ? 'purple' : ''}">${esc(r.best || '')}</td><td>${st}</td></tr>`;
        })
        .join('');
      lastOrder = Object.fromEntries(s.tower.map((r) => [r.id, r.pos]));
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

  // Analytics: single network GA4 property, production host only.
  if (location.hostname === 'f1.propbetedge.ai' && navigator.doNotTrack !== '1') {
    const GA = 'G-BRS48R8PG9';
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('set', { pbe_surface: 'f1' });
    window.gtag('config', GA, { cookie_domain: '.propbetedge.ai', cookie_flags: 'SameSite=Lax;Secure' });
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA;
    document.head.append(s);
  }
})();
