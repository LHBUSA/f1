// Soft navigation for the F1 site: progressive enhancement over the static pages (every URL stays a real, crawlable,
// directly loadable document). Plain same-origin left-clicks fetch the target page, swap <main> + head metadata +
// nav state, unmount/remount page modules (window.F1), push history and restore scroll on back/forward. Anything
// unusual - modified clicks, other targets, downloads, PBEcast, a different deploy, any error - is an ordinary
// full navigation. Never loaded on PBEcast pages (their client owns its own lifecycle).
(() => {
  if (!window.fetch || !window.DOMParser || !history.pushState) return;
  const F1 = (window.F1 ||= {});
  if (F1.router) return;
  F1.router = true;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const cache = new Map(); // url -> { at, promise }
  const TTL = 60000;
  const HARD = /^\/pbecast(\/|$)/; // PBEcast keeps full document navigation until its client exposes mount/unmount
  try { history.scrollRestoration = 'manual'; } catch {}
  const saveScroll = () => { try { history.replaceState({ ...(history.state || {}), f1: true, y: scrollY }, ''); } catch {} };

  const assetKey = (doc) => [...doc.querySelectorAll('link[rel=stylesheet][href^="/assets/"], script[src^="/assets/app."]')].map((n) => n.getAttribute('href') || n.getAttribute('src')).join('|');
  const myAssets = assetKey(document);

  function eligible(a, e) {
    if (!a || (e && (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey))) return null;
    if (a.target && a.target !== '_self') return null;
    if (a.hasAttribute('download') || a.dataset.noSoft != null || /\bexternal\b/.test(a.rel)) return null;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return null;
    let u;
    try { u = new URL(a.href, location.href); } catch { return null; }
    if (u.origin !== location.origin) return null;
    if (/\.[a-z0-9]{2,5}$/i.test(u.pathname) && !/\.html$/i.test(u.pathname)) return null; // files (xml, png, pdf...)
    if (HARD.test(u.pathname)) return null;
    if (u.pathname === location.pathname && u.search === location.search && u.hash) return null; // in-page anchor
    return u;
  }

  function fetchDoc(url) {
    const key = url.pathname + url.search;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.promise;
    const promise = fetch(key, { headers: { accept: 'text/html' }, credentials: 'same-origin' }).then((r) => {
      if (!r.ok || !/text\/html/.test(r.headers.get('content-type') || '')) throw new Error(`soft-nav ${r.status}`);
      return r.text();
    });
    cache.set(key, { at: Date.now(), promise });
    promise.catch(() => cache.delete(key));
    if (cache.size > 24) cache.delete(cache.keys().next().value);
    return promise;
  }

  // top progress bar only when the fetch is not instant
  let bar = null, barTimer = 0;
  const showBar = () => { barTimer = setTimeout(() => { bar ||= Object.assign(document.createElement('div'), { className: 'nav-progress' }); document.body.append(bar); bar.dataset.on = '1'; }, 160); };
  const hideBar = () => { clearTimeout(barTimer); if (bar) bar.dataset.on = ''; };

  const META = ['meta[name="description"]', 'meta[name="robots"]', 'link[rel="canonical"]', 'meta[property="og:type"]', 'meta[property="og:title"]', 'meta[property="og:description"]', 'meta[property="og:url"]', 'meta[property="og:image"]', 'meta[property="og:image:alt"]', 'meta[name="twitter:title"]', 'meta[name="twitter:description"]', 'meta[name="twitter:image"]', 'meta[property="article:published_time"]', 'meta[property="article:modified_time"]', 'meta[property="article:section"]'];

  function loadScripts(doc) {
    // page scripts the new page needs that this document has not loaded yet (e.g. explorer, rail)
    const have = new Set([...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')));
    const need = [...doc.querySelectorAll('head script[src^="/assets/"]')].map((s) => s.getAttribute('src')).filter((src) => !have.has(src));
    return Promise.all(need.map((src) => new Promise((res) => { const s = document.createElement('script'); s.src = src; s.onload = s.onerror = res; document.head.append(s); })));
  }

  function swap(doc, url) {
    const main = document.getElementById('main'), next = doc.getElementById('main');
    if (!main || !next) throw new Error('no main');
    F1.unmountAll?.();
    document.title = doc.title;
    for (const sel of META) {
      const cur = document.head.querySelector(sel), nw = doc.head.querySelector(sel);
      if (cur && nw) cur.replaceWith(document.importNode(nw, true));
      else if (cur && !nw) cur.remove();
      else if (!cur && nw) document.head.append(document.importNode(nw, true));
    }
    document.head.querySelectorAll('script[type="application/ld+json"]').forEach((n) => n.remove());
    doc.head.querySelectorAll('script[type="application/ld+json"]').forEach((n) => document.head.append(document.importNode(n, true)));
    document.body.className = doc.body.className;
    document.body.dataset.path = doc.body.dataset.path || url.pathname;
    const nav = document.querySelector('#primary-nav .nav-inner'), nnav = doc.querySelector('#primary-nav .nav-inner');
    if (nav && nnav) nav.replaceChildren(...[...nnav.childNodes].map((n) => document.importNode(n, true)));
    document.getElementById('primary-nav')?.classList.remove('open');
    document.querySelector('[data-menu]')?.setAttribute('aria-expanded', 'false');
    main.replaceWith(document.importNode(next, true));
    F1.mountAll?.(document);
  }

  async function go(url, { push, y = 0 }) {
    showBar();
    let html;
    try { html = await fetchDoc(url); } catch { hideBar(); location.href = url.href; return; }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // different deploy (asset hashes changed) or a page whose client owns its lifecycle -> full navigation
    if (assetKey(doc) !== myAssets || doc.querySelector('#pbecast-data')) { hideBar(); location.href = url.href; return; }
    if (push) { saveScroll(); history.pushState({ f1: true, y: 0 }, '', url.href); }
    const run = async () => {
      swap(doc, url);
      await loadScripts(doc);
      if (url.hash) { const t = document.getElementById(decodeURIComponent(url.hash.slice(1))); if (t) { t.scrollIntoView(); } else scrollTo(0, y); }
      else scrollTo(0, y);
      const h1 = document.querySelector('#main h1');
      if (h1 && push) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    };
    try {
      if (document.startViewTransition && !reduce.matches) await document.startViewTransition(run).updateCallbackDone;
      else await run();
    } catch { location.href = url.href; return; }
    hideBar();
    try { window.gtag?.('event', 'page_view', { page_location: location.href, page_title: document.title, nav_type: 'soft' }); } catch {}
    document.dispatchEvent(new CustomEvent('f1:navigated', { detail: { url: location.href } }));
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    const u = eligible(a, e);
    if (!u) return;
    e.preventDefault();
    go(u, { push: true });
  });
  addEventListener('popstate', (e) => {
    const u = new URL(location.href);
    if (HARD.test(u.pathname)) { location.reload(); return; }
    go(u, { push: false, y: e.state?.y || 0 });
  });
  // prefetch likely targets on hover/focus/touch
  const pre = (e) => { const u = eligible(e.target.closest?.('a[href]')); if (u && u.pathname !== location.pathname) fetchDoc(u).catch(() => {}); };
  document.addEventListener('mouseover', pre, { passive: true });
  document.addEventListener('focusin', pre);
  document.addEventListener('touchstart', pre, { passive: true });
  addEventListener('scroll', () => { clearTimeout(F1.scrollT); F1.scrollT = setTimeout(saveScroll, 150); }, { passive: true });
  saveScroll();
})();
