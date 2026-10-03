// Kalshi Market Intelligence on F1 (owner approved 2026-10-03). Classic script: it lazily imports the vendored shared
// component (src/vendor/kalshi, unchanged; the build writes them content-hashed and rewrites the two paths below).
// Data comes only from the PropSports markets API (the browser never calls Kalshi); prices are fetched live, never baked
// into the static page. No market / any failure -> the mount stays empty (no box, no reserved space).
// The only market attached is the MAIN race winner (`<event>-race`); never a sprint or championship view.
(() => {
  const F1 = (window.F1 ||= {});
  if (F1.kalshi) return;
  const UI_SRC = '/assets/kalshi-market-ui.js';
  const CLIENT_SRC = '/assets/kalshi-market-client.js';
  const NOTE = 'Kalshi race-winner contracts: a YES pays $1 if that driver finishes first in the main race.';

  const isRaceMarketId = (id) => typeof id === 'string' && /^\d{4}-[a-z0-9-]+-race$/.test(id) && !/-sprint(?:-[a-z]+)?-race$/.test(id) && !/championship/.test(id);

  // 'live' while the race is running, 'pregame' before it; anything else polls at the idle rate
  const phase = (entry, startIso, now = Date.now()) => {
    const st = entry?.event?.state;
    if (st === 'in' || st === 'live') return 'live';
    if (st === 'post') return 'post';
    const start = Date.parse(startIso || entry?.event?.start_at || '');
    if (Number.isFinite(start) && now >= start) return 'live';
    return 'pregame';
  };
  // usable = an open main-race-winner market; settled / post-race markets are not shown (the page rebuild removes the mount)
  const usable = (entry) => entry?.kalshi?.state === 'open' && entry.kalshi.proposition === 'driver_wins_race' && entry.event?.state !== 'post';

  let libs = null;
  const load = () => (libs ||= Promise.all([import(UI_SRC), import(CLIENT_SRC)])
    .then(([ui, cl]) => ({ ui, client: cl.createKalshiClient({ sport: 'f1' }) }))
    .catch(() => { libs = null; return null; }));

  function poller(el, id, render) {
    let timer = 0, dead = false;
    const tick = async () => {
      if (dead) return;
      const L = await load();
      if (!L || dead) return;
      let entry = null;
      try { entry = await L.client.loadEvent(id); } catch { entry = null; }
      if (dead) return;
      const ok = usable(entry);
      try { render(L.ui, ok ? entry : null); } catch { el.replaceChildren(); }
      const ph = phase(entry, el.dataset.kalshiStart);
      if (ph === 'post') return;
      const ms = L.client.pollMsFor(ok ? ph : 'idle'); // no market yet: idle cadence
      timer = setTimeout(() => { if (document.hidden) { timer = setTimeout(tick, 5000); } else tick(); }, ms);
    };
    tick();
    return () => { dead = true; clearTimeout(timer); };
  }

  // Race page: full card (ranked field list) + the race-winner note
  function mountRace(root) {
    const el = root.querySelector('[data-kalshi-race]');
    if (!el) return null;
    const id = el.dataset.kalshiRace;
    if (!isRaceMarketId(id)) return null;
    return poller(el, id, (ui, entry) => {
      const card = entry ? ui.kalshiCard(entry, { placement: 'race-page' }) : '';
      if (!card) { el.replaceChildren(); return; }
      el.innerHTML = `<section class="section kx-sec" aria-label="Prediction market"><div class="wrap">${card}<p class="fine kx-f1note">${NOTE}</p></div></section>`;
      ui.wireKalshi(el);
    });
  }

  // PBEcast: one-line leaders strip; expands to the compact card. Loaded independently of the cast client.
  function mountStrip(root) {
    const el = root.querySelector('[data-kalshi-strip]');
    if (!el) return null;
    const id = el.dataset.kalshiStrip;
    if (!isRaceMarketId(id)) return null;
    return poller(el, id, (ui, entry) => {
      const open = !!el.querySelector('details[open]');
      const strip = entry ? ui.kalshiStrip(entry, { placement: 'pbecast-strip' }) : '';
      if (!strip) { el.replaceChildren(); return; }
      el.innerHTML = `${strip}<p class="fine kx-f1note">${NOTE}</p>`;
      if (open) el.querySelector('details')?.setAttribute('open', '');
      ui.wireKalshi(el);
    });
  }

  F1.kalshi = { isRaceMarketId, phase, usable, NOTE };
  const mods = { 'kalshi-race': { selector: '[data-kalshi-race]', mount: mountRace }, 'kalshi-strip': { selector: '[data-kalshi-strip]', mount: mountStrip } };
  for (const [name, mod] of Object.entries(mods)) {
    if (typeof F1.register === 'function') F1.register(name, mod);
    else {
      const go = () => mod.mount(document);
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
      else go();
    }
  }
})();
