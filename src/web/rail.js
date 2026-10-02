// Homepage "Meet the cars" rail: native horizontal scroll + CSS snap (cars snap to the content column); this only adds prev/next, arrow keys, mouse
// drag and the active-car accent. No autoplay. Reduced motion = instant scrolling.
(() => {
  const rail = document.querySelector('[data-rail]');
  if (!rail) return;
  const items = [...rail.querySelectorAll('.rail-item')];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const behavior = reduce ? 'auto' : 'smooth';
  let active = 0;
  const lead = () => items[0]?.offsetLeft || 0; // = resolved leading padding (computed scroll-padding can stay an unresolved max())
  const go = (i) => { const k = Math.max(0, Math.min(items.length - 1, i)); rail.scrollTo({ left: items[k].offsetLeft - lead(), behavior }); };
  const update = () => {
    const at = rail.scrollLeft + lead();
    let best = 0, bd = Infinity;
    items.forEach((el, i) => { const d = Math.abs(el.offsetLeft - at); if (d < bd) { bd = d; best = i; } });
    if (best === active && items[best].classList.contains('is-active')) return;
    active = best;
    items.forEach((el, i) => el.classList.toggle('is-active', i === best));
    rail.closest('.grid-rail')?.style.setProperty('--rail-accent', getComputedStyle(items[best]).getPropertyValue('--tc') || 'transparent');
  };
  let raf = 0;
  rail.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); }, { passive: true });
  document.querySelector('[data-rail-prev]')?.addEventListener('click', () => go(active - 1));
  document.querySelector('[data-rail-next]')?.addEventListener('click', () => go(active + 1));
  rail.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); go(active + (e.key === 'ArrowRight' ? 1 : -1)); }
  });
  // mouse drag (touch and trackpads already scroll natively); a drag never triggers the card link
  let down = null, moved = false;
  rail.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' || e.button !== 0) return; down = { x: e.clientX, left: rail.scrollLeft }; moved = false; });
  addEventListener('pointermove', (e) => { if (!down) return; const dx = e.clientX - down.x; if (Math.abs(dx) > 4) { moved = true; rail.classList.add('dragging'); rail.scrollLeft = down.left - dx; } });
  addEventListener('pointerup', () => { if (!down) return; down = null; rail.classList.remove('dragging'); if (moved) go(active); });
  rail.addEventListener('click', (e) => { if (moved) { e.preventDefault(); moved = false; } }, true);
  update();
})();
