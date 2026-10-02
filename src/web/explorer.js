// Car Explorer: the car photo's hotspots + component chips switch server-rendered panels. Without JS every panel is
// visible as a plain list. Hover/focus shows a floating preview card, click/tap/Enter locks, Esc clears, #part-<id> deep-links.
(() => {
  const root = document.querySelector('[data-explorer]');
  const stage = document.querySelector('.car-stage');
  if (!root) return;
  const panels = [...root.querySelectorAll('.xp-panel')];
  const hint = root.querySelector('.xp-hint');
  const triggers = [...document.querySelectorAll('.hs[data-c], .xp-chip[data-c]')];
  for (const b of document.querySelectorAll('.hs[data-x]')) {
    b.style.left = `${(+b.dataset.x * 100).toFixed(2)}%`;
    b.style.top = `${(+b.dataset.y * 100).toFixed(2)}%`;
  }
  root.classList.add('xp-on');
  stage?.classList.add('xp-on');
  let locked = null;
  const render = (id, mode) => {
    for (const p of panels) p.hidden = p.dataset.c !== id;
    for (const t of triggers) {
      t.setAttribute('aria-pressed', String(t.dataset.c === locked));
      t.classList.toggle('peek', mode === 'preview' && t.dataset.c === id && id !== locked);
    }
    root.dataset.state = id ? mode : '';
    stage?.setAttribute('data-active', id || '');
    if (hint) hint.hidden = !!id;
  };
  const lock = (id, opts = {}) => {
    locked = locked === id && !opts.force ? null : id;
    render(locked, 'locked');
    try { history.replaceState(null, '', locked ? `#part-${locked}` : location.pathname + location.search); } catch {}
    if (locked && opts.reveal) {
      const p = root.querySelector(`#xp-${locked}`);
      const r = p?.getBoundingClientRect();
      if (r && (r.top > innerHeight - 80 || r.bottom < 0)) p.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };
  // hover/focus only reveal the hotspot's floating preview card (CSS, no layout change); click/tap/Enter locks a panel
  for (const t of triggers) t.addEventListener('click', () => lock(t.dataset.c, { reveal: true }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && locked) lock(locked); });
  const fromHash = () => {
    const m = location.hash.match(/^#part-([a-z-]+)$/);
    if (m && panels.some((p) => p.dataset.c === m[1])) lock(m[1], { force: true });
  };
  render(null, 'locked');
  fromHash();
  addEventListener('hashchange', fromHash);
})();
