// Article Market module on F1 news stories (shared contract article-market/1; propbetedge-workers
// docs/POST_EVENT_MARKET_RESULT.md). ONE module with a lifecycle: LIVE MARKET WATCH while the race-winner market
// trades -> THE MARKET RESULT once the race is over. Classic script: it lazily imports the vendored shared component
// (src/vendor/kalshi/article-market-ui.js, unchanged; the build writes it content-hashed and rewrites the path below).
//
// - The slot (src/news/render.mjs articleMarketSlot) exists only on a story first published at/after the activation
//   time and linked to its main race market `<event>-race`; the API stays the authority on eligibility.
// - published_at = the story's ORIGINAL publication time (data-published); focus = the story's drivers (f1-api ids).
// - Read through the same-origin exact rewrite /api/markets/v1/article-market/f1/:id (vercel.json). Never a venue.
// - Prices are never baked into the page. Nothing eligible / nothing observed / a failed read -> nothing rendered.
// - No visible layout shift: the answer is inserted only while the slot is below the viewport; otherwise it waits
//   until the slot is below the viewport again. Then the shared client refreshes ~30 s while visible (never hidden).
(() => {
  const F1 = (window.F1 ||= {});
  if (F1.articleMarket) return;
  const UI_SRC = '/assets/article-market-ui.js';
  const BASE = '/api/markets';
  const SPORT = 'f1';
  const REFRESH_MS = 30_000;
  const ID = /^\d{4}-[a-z0-9-]+-race$/;

  let ui = null;
  const load = () => (ui ||= import(UI_SRC).catch(() => { ui = null; return null; }));

  async function read(id, publishedAt, focus) {
    try {
      const q = `published_at=${encodeURIComponent(publishedAt)}${focus ? `&focus=${encodeURIComponent(focus)}` : ''}`;
      const r = await fetch(`${BASE}/v1/article-market/${SPORT}/${encodeURIComponent(id)}?${q}`, { credentials: 'omit' });
      if (!r.ok) return null;
      const body = await r.json();
      return body?.eligible ? body : null;
    } catch { return null; }
  }

  const below = (el) => el.getBoundingClientRect().top >= window.innerHeight;

  function mount(root) {
    const slot = root.querySelector('[data-art-market]');
    if (!slot) return null;
    const id = slot.dataset.artMarket, publishedAt = slot.dataset.published, focus = slot.dataset.focus || '';
    if (!ID.test(id || '') || !publishedAt) return null;
    let dead = false, stop = () => {}, io = null;
    (async () => {
      const [mod, first] = await Promise.all([load(), read(id, publishedAt, focus)]);
      if (dead || !mod || !first || !slot.isConnected) return;
      if (!mod.articleMarketModule(first, { focus: focus || null })) return; // nothing observed: nothing rendered
      const start = () => { if (!dead) stop = mod.mountArticleMarket(slot, { base: BASE, sport: SPORT, eventId: id, publishedAt, initial: first, refreshMs: REFRESH_MS, focus: focus || null }); };
      if (below(slot) || typeof IntersectionObserver === 'undefined') { start(); return; }
      // the reader is already at (or past) the slot: inserting now would move what they see; wait until it is below
      io = new IntersectionObserver((es) => { if (es.some((e) => !e.isIntersecting) && below(slot)) { io.disconnect(); io = null; start(); } });
      io.observe(slot);
    })();
    return () => { dead = true; io?.disconnect(); stop(); };
  }

  F1.articleMarket = { mount };
  const mod = { selector: '[data-art-market]', mount };
  if (typeof F1.register === 'function') F1.register('article-market', mod);
  else {
    const go = () => mod.mount(document);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
    else go();
  }
})();
