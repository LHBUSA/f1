// Homepage "Meet the cars" rail. Native horizontal scroll + CSS snap (works without JS); this adds one controller:
// prev/next (looping), arrow keys, mouse drag, segment jumps, active-car tracking from the real snapped position, and a
// slow showroom auto-advance (one car every 6 s) that ONLY runs while the rail is visible and idle.
// Pause reasons: hover, focus inside, pointer down/drag, tab hidden, rail off-screen, 10 s cooldown after any manual
// interaction. prefers-reduced-motion: no autoplay, no smooth scrolling, no fill animation.
// One timer maximum; registered as an F1 module so soft navigation unmounts everything.
(() => {
  const ADVANCE_MS = 6000, MANUAL_MS = 10000;
  const mount = () => {
    const rail = document.querySelector('[data-rail]');
    if (!rail) return () => {};
    const section = rail.closest('.grid-rail') || rail;
    const items = [...rail.querySelectorAll('.rail-item')];
    const prog = section.querySelector('[data-rail-progress]');
    const segs = [...section.querySelectorAll('[data-rail-go]')];
    const idxEl = section.querySelector('[data-rail-idx]'), nameEl = section.querySelector('[data-rail-name]');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = reduce ? 'auto' : 'smooth';
    const pause = new Set();
    let active = -1, timer = 0, manualTimer = 0, programmatic = false, raf = 0, endT = 0, settles = 0, settledAt = 0;
    const off = [];
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); off.push(() => t.removeEventListener(ev, fn, o)); };

    const lead = () => items[0]?.offsetLeft || 0; // resolved leading padding (computed scroll-padding may stay an unresolved max())
    const posOf = (k) => items[k].offsetLeft - lead();
    const setActive = (best) => {
      if (best === active) return;
      active = best;
      items.forEach((el, i) => el.classList.toggle('is-active', i === best));
      segs.forEach((b, i) => (i === best ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
      if (idxEl) idxEl.textContent = String(best + 1).padStart(2, '0');
      if (nameEl) nameEl.textContent = items[best].querySelector('.rail-head b')?.textContent || '';
      section.style.setProperty('--rail-accent', getComputedStyle(items[best]).getPropertyValue('--tc') || 'transparent');
    };
    const measure = () => {
      const at = rail.scrollLeft + lead();
      let best = 0, bd = Infinity;
      items.forEach((el, i) => { const d = Math.abs(el.offsetLeft - at); if (d < bd) { bd = d; best = i; } });
      setActive(best);
    };

    // ---- autoplay (single timer) ----
    const canAuto = () => !reduce && pause.size === 0;
    const clear = () => { clearTimeout(timer); timer = 0; };
    const restartFill = () => { if (!prog) return; prog.classList.remove('timing'); void prog.offsetWidth; if (canAuto()) prog.classList.add('timing'); };
    const syncPausedClass = () => prog?.classList.toggle('paused', !canAuto());
    const schedule = () => {
      clear(); syncPausedClass();
      if (!canAuto()) return;
      restartFill();
      timer = setTimeout(() => { timer = 0; if (canAuto()) go(active + 1, { auto: true }); }, ADVANCE_MS);
    };
    const setPause = (reason, yes) => {
      const had = pause.has(reason);
      if (yes) pause.add(reason); else pause.delete(reason);
      if (had !== yes) { if (yes) { clear(); syncPausedClass(); } else schedule(); }
    };
    const manual = () => {
      setPause('manual', true);
      clearTimeout(manualTimer);
      manualTimer = setTimeout(() => setPause('manual', false), MANUAL_MS);
    };

    // ---- navigation (loops; the wrap is a short fade + instant snap, never a fast rewind across the rail) ----
    function go(i, { auto = false } = {}) {
      const n = items.length;
      const wrap = i >= n || i < 0;
      const k = ((i % n) + n) % n;
      clear();
      programmatic = true;
      if (wrap && !reduce) {
        rail.classList.add('wrapping');
        setTimeout(() => { rail.scrollTo({ left: posOf(k), behavior: 'auto' }); setActive(k); requestAnimationFrame(() => rail.classList.remove('wrapping')); settle(); }, 230);
      } else {
        rail.scrollTo({ left: posOf(k), behavior: wrap ? 'auto' : behavior });
        if (wrap) settle();
      }
      if (!auto) manual();
    }
    // scroll end: re-measure the snapped car, then (if idle) schedule the next advance
    function settle() {
      clearTimeout(endT);
      endT = setTimeout(() => { programmatic = false; measure(); settles++; settledAt = performance.now(); schedule(); }, 120);
    }
    on(rail, 'scroll', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
      if (!programmatic) manual(); // user swipe / trackpad / wheel: their carousel now
      if (!('onscrollend' in window)) settle();
    }, { passive: true });
    if ('onscrollend' in window) on(rail, 'scrollend', settle);

    on(section.querySelector('[data-rail-prev]') || rail, 'click', (e) => { if (e.currentTarget !== rail) go(active - 1); });
    on(section.querySelector('[data-rail-next]') || rail, 'click', (e) => { if (e.currentTarget !== rail) go(active + 1); });
    for (const b of segs) on(b, 'click', () => go(Number(b.dataset.railGo)));
    on(rail, 'keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); go(active + (e.key === 'ArrowRight' ? 1 : -1)); }
    });

    // pause: hover (fine pointers), focus within, pointer down / drag, tab hidden, off-screen
    on(section, 'pointerenter', (e) => { if (e.pointerType === 'mouse') setPause('hover', true); });
    on(section, 'pointerleave', (e) => { if (e.pointerType === 'mouse') setPause('hover', false); });
    on(section, 'focusin', () => setPause('focus', true));
    on(section, 'focusout', (e) => { if (!section.contains(e.relatedTarget)) setPause('focus', false); });
    on(document, 'visibilitychange', () => setPause('hidden', document.hidden));
    if (document.hidden) pause.add('hidden');
    let io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(([en]) => setPause('offscreen', !en || en.intersectionRatio < 0.5), { threshold: [0, 0.5, 1] });
      io.observe(rail);
      pause.add('offscreen'); // until the observer reports
    }

    // mouse drag (touch and trackpads already scroll natively); a drag never activates the card link
    let down = null, moved = false;
    on(rail, 'pointerdown', (e) => {
      setPause('pointer', true);
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      down = { x: e.clientX, left: rail.scrollLeft }; moved = false;
    });
    on(window, 'pointermove', (e) => { if (!down) return; const dx = e.clientX - down.x; if (Math.abs(dx) > 4) { moved = true; rail.classList.add('dragging'); rail.scrollLeft = down.left - dx; } });
    const up = () => { setPause('pointer', false); if (!down) return; down = null; rail.classList.remove('dragging'); if (moved) { manual(); go(Math.max(0, active)); } };
    on(window, 'pointerup', up);
    on(window, 'pointercancel', up);
    on(rail, 'click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);

    if (prog) prog.style.setProperty('--rail-ms', `${ADVANCE_MS}ms`);
    measure();
    schedule();
    window.__rail = { get active() { return active; }, get timer() { return !!timer; }, get paused() { return [...pause]; }, get settles() { return settles; }, get settledAt() { return settledAt; } }; // QA hook
    return () => { clear(); clearTimeout(manualTimer); clearTimeout(endT); cancelAnimationFrame(raf); io?.disconnect(); off.forEach((f) => f()); delete window.__rail; };
  };
  if (window.F1?.register) window.F1.register('rail', { selector: '[data-rail]', mount });
  else mount();
})();
