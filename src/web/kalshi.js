// Kalshi Market Intelligence on F1 (owner approved 2026-10-03; market history 2026-10-03; MLB market standard 2026-10-03).
// Classic script: it lazily imports the vendored shared component + client (src/vendor/kalshi, unchanged, canonical
// ad6187a; the build writes them content-hashed and rewrites the two paths below). Data comes only from the PropSports
// markets API through the shared client (the browser never calls Kalshi); prices are fetched live, never baked into the
// static page. No market / any failure -> the mount stays empty (no box, no space).
// The only market attached is the MAIN race winner (`<event>-race`); never a sprint or championship view.
//
// The page evolves with the market, no release needed: Market Pulse (full ranked-field card) while the market trades,
// then "How the market closed" (shared marketHistoryCard) once it is CLOSED or SETTLED. The shared client (ad6187a)
// keeps completed entries that come back with `kalshi: null` + `market` / `market_history`, so this loader no longer
// reads the API itself.
(() => {
  const F1 = (window.F1 ||= {});
  if (F1.kalshi) return;
  const UI_SRC = '/assets/kalshi-market-ui.js';
  const CLIENT_SRC = '/assets/kalshi-market-client.js';
  const NOTE = 'Kalshi race-winner contracts: a YES pays $1 if that driver finishes first in the main race.';
  const CLOSED_MS = 5 * 60_000; // CLOSED -> re-read every 5 min until the venue settles; SETTLED -> never again

  const isRaceMarketId = (id) => typeof id === 'string' && /^\d{4}-[a-z0-9-]+-race$/.test(id) && !/-sprint(?:-[a-z]+)?-race$/.test(id) && !/championship/.test(id);
  const MAIN = 'driver_wins_race';
  const proposition = (e) => e?.market?.proposition || e?.market_history?.proposition || e?.kalshi?.proposition || null;
  const lifecycle = (e) => e?.market?.lifecycle || e?.market_history?.lifecycle || null;

  // 'live' while the race is running, 'pregame' before it, 'post' after
  const phase = (entry, startIso, now = Date.now()) => {
    const st = entry?.event?.state;
    if (st === 'in' || st === 'live') return 'live';
    if (st === 'post') return 'post';
    const start = Date.parse(startIso || entry?.event?.start_at || '');
    if (Number.isFinite(start) && now >= start) return 'live';
    return 'pregame';
  };
  // live card: an open main-race-winner market (kept after the chequered flag while the venue still trades it)
  const usable = (entry) => entry?.kalshi?.state === 'open' && entry.kalshi.proposition === MAIN && !['CLOSED', 'SETTLED'].includes(lifecycle(entry));
  // history card: the main-race market has closed or settled and the API returned its stored history
  const historic = (entry) => !!entry?.market_history && proposition(entry) === MAIN && ['CLOSED', 'SETTLED'].includes(lifecycle(entry));
  // next read in ms, or 0 = stop. SETTLED is final; CLOSED waits for settlement; no market on a finished race = stop.
  const nextMs = (entry, startIso, done, POLL) => {
    const lc = lifecycle(entry);
    if (lc === 'SETTLED') return 0;
    if (lc === 'CLOSED') return CLOSED_MS;
    const ph = phase(entry, startIso);
    if (usable(entry)) return ph === 'post' ? CLOSED_MS : ph === 'live' ? POLL.live : POLL.pregame;
    if (done || ph === 'post') return entry?.market ? CLOSED_MS : 0;
    return POLL.idle;
  };

  let libs = null;
  const load = () => (libs ||= Promise.all([import(UI_SRC), import(CLIENT_SRC)])
    .then(([ui, cl]) => ({ ui, POLL: cl.POLL_MS, client: cl.createKalshiClient({ sport: 'f1' }) }))
    .catch(() => { libs = null; return null; }));

  function poller(el, read, render) {
    let timer = 0, dead = false;
    const done = el.dataset.kalshiDone === '1';
    const tick = async () => {
      if (dead) return;
      const L = await load();
      if (!L || dead) return;
      let entry = null;
      try { entry = await read(L.client); } catch { entry = null; }
      if (dead) return;
      try { render(L.ui, entry); } catch { el.replaceChildren(); }
      const ms = nextMs(entry, el.dataset.kalshiStart, done, L.POLL);
      if (!ms) return;
      timer = setTimeout(() => { if (document.hidden) { timer = setTimeout(tick, 5000); } else tick(); }, ms);
    };
    tick();
    return () => { dead = true; clearTimeout(timer); };
  }

  // Race page: Market Pulse (ranked field) while trading; "How the market closed" once closed / settled
  function mountRace(root) {
    const el = root.querySelector('[data-kalshi-race]');
    if (!el) return null;
    const id = el.dataset.kalshiRace;
    if (!isRaceMarketId(id)) return null;
    return poller(el, (c) => c.loadEvent(id, { force: true }), (ui, entry) => {
      const ph = marketPhase(entry, el.dataset.kalshiStart);
      const card = !ph ? '' : historic(entry) ? ui.marketModule(entry, { placement: 'race-page-history' }) : ui.marketModule(entry, { placement: 'race-page' });
      if (!card) { el.replaceChildren(); return; }
      el.innerHTML = `<section class="section kx-sec" aria-label="Prediction market"><div class="wrap">${phaseHtml(ph, card)}<p class="fine kx-f1note">${NOTE}</p></div></section>`;
      ui.wireKalshi(el);
    });
  }

  // Lifecycle label shown above the market module (MLB market standard): [phase key, text], or null for nothing.
  // A quote that is not fresh is never labelled live.
  const marketPhase = (entry, startIso) => {
    if (historic(entry)) return lifecycle(entry) === 'SETTLED' ? ['settled', 'MARKET SETTLED'] : ['closed', 'MARKET CLOSED · AWAITING SETTLEMENT'];
    if (!usable(entry)) return null;
    const ph = phase(entry, startIso);
    if (ph === 'post') return ['final-open', 'RACE FINAL · MARKET STILL TRADING'];
    if (ph === 'live') return entry.kalshi.freshness === 'live' ? ['live', 'LIVE MARKET'] : ['live-delayed', 'MARKET OPEN · RACE IN PROGRESS'];
    return ['pre', 'MARKET OPEN · PRE-RACE'];
  };
  const phaseHtml = (ph, body) => `<div class="kx-phase-wrap" data-phase="${ph[0]}"><p class="kx-phase"><span class="kx-phase-dot" aria-hidden="true"></span>${ph[1]}</p>${body}</div>`;

  // PBEcast: Market Pulse directly under the timing tower (the race scoreboard) for the whole race lifecycle — the
  // full ranked-field card while it trades, "How the market closed" in the SAME place once closed / settled.
  // Loaded independently of the cast client; written in place only when the markup changes.
  function mountCast(root) {
    const el = root.querySelector('[data-kalshi-cast]');
    if (!el) return null;
    const id = el.dataset.kalshiCast;
    if (!isRaceMarketId(id)) return null;
    return poller(el, (c) => c.loadEvent(id, { force: true }), (ui, entry) => {
      const ph = marketPhase(entry, el.dataset.kalshiStart);
      const body = !ph ? '' : historic(entry) ? ui.marketHistoryCard(entry, { placement: 'pbecast-history' }) : ui.kalshiCard(entry, { placement: 'pbecast', compact: true });
      const html = body ? `${phaseHtml(ph, body)}<p class="fine kx-f1note">${NOTE}</p>` : '';
      if (el.dataset.kxHtml === html) return;
      el.dataset.kxHtml = html;
      if (!html) { el.replaceChildren(); return; }
      el.innerHTML = html;
      ui.wireKalshi(el);
    });
  }

  // Result card: a subtle market line from the board's close summary; nothing unless it returns content
  function mountClose(root) {
    const el = root.querySelector('[data-kalshi-close]');
    if (!el) return null;
    const id = el.dataset.kalshiClose;
    if (!isRaceMarketId(id)) return null;
    el.dataset.kalshiDone = '1';
    return poller(el, async (c) => (await c.loadBoard()).get(id) || null, (ui, entry) => {
      const line = entry && proposition(entry) === MAIN ? ui.marketCloseLine(entry) : '';
      if (!line) { el.replaceChildren(); return; }
      el.innerHTML = line;
    });
  }

  F1.kalshi = { isRaceMarketId, phase, usable, historic, nextMs, lifecycle, marketPhase, NOTE, CLOSED_MS };
  const mods = {
    'kalshi-race': { selector: '[data-kalshi-race]', mount: mountRace },
    'kalshi-cast': { selector: '[data-kalshi-cast]', mount: mountCast },
    'kalshi-close': { selector: '[data-kalshi-close]', mount: mountClose },
  };
  for (const [name, mod] of Object.entries(mods)) {
    if (typeof F1.register === 'function') F1.register(name, mod);
    else {
      const go = () => mod.mount(document);
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
      else go();
    }
  }
})();
