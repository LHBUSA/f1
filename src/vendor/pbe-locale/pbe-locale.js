// PropBetEdge locale contract (pbe-locale/1.0.0). Global Issue #67; extracted from PropBetEdge Soccer (LHBUSA/soccer
// src/i18n/*, production since 2026-10-09 for en/es). ONE dependency-free ES module, vendored byte-identical into each
// site (src/vendor/pbe-locale/pbe-locale.js, pinned by MANIFEST.sha256 + a drift test). Works in the browser, Vercel
// middleware / edge functions, Cloudflare Workers and Node tests.
//
//   const L = createLocale({ ready: ['en', 'es'], site: 'https://golf.propbetedge.ai', catalogs: { es } });
//   L.splitLocale('/es/players/x') -> { locale: 'es', path: '/players/x' }
//   L.translateText('All Access', 'es') ; L.observeLocale(document.body, 'es') ; L.format('es').dateLong(iso)
//
// Rules (unchanged from the Soccer contract):
//   - English is the source language at unprefixed URLs; every other locale lives under /<code>/.
//   - A locale is public ONLY when the site lists it in `ready` (selector, hreflang, sitemaps, redirects). An unready
//     prefix stays part of the path, so the router answers 404: no half-built language is ever reachable or indexed.
//   - Catalog translation is gettext-style: the msgid is the rendered English string; exact match, then patterns that
//     carry numbers and names through verbatim; anything unknown returns the source text unchanged.
//   - Protected content (articles, markets, prices, settlement rules, anything translate="no") is never touched.
//   - URL language and region tags are separate: /pt/ is served as hreflang "pt-BR" when the content is Brazilian.
export const PBE_LOCALE_VERSION = 'pbe-locale/1.0.0';
export const DEFAULT_LOCALE = 'en';
export const LANG_COOKIE = 'pbe_lang';

// The network registry. `hreflang` is the region-qualified tag search engines see; `intl` drives Intl formatting.
// `cjk` languages get the CJK typography rules (pbe-locale.css) and character-based text clipping.
export const LOCALE_REGISTRY = Object.freeze({
  en: { code: 'en', native: 'English', short: 'EN', htmlLang: 'en', intl: 'en-GB', og: 'en_US', hreflang: 'en', langLabel: 'Language' },
  es: { code: 'es', native: 'Español', short: 'ES', htmlLang: 'es', intl: 'es-ES', og: 'es_ES', hreflang: 'es', langLabel: 'Idioma' },
  pt: { code: 'pt', native: 'Português', short: 'PT', htmlLang: 'pt-BR', intl: 'pt-BR', og: 'pt_BR', hreflang: 'pt-BR', langLabel: 'Idioma' },
  fr: { code: 'fr', native: 'Français', short: 'FR', htmlLang: 'fr', intl: 'fr-FR', og: 'fr_FR', hreflang: 'fr', langLabel: 'Langue' },
  ja: { code: 'ja', native: '日本語', short: 'JA', htmlLang: 'ja', intl: 'ja-JP', og: 'ja_JP', hreflang: 'ja', langLabel: '言語', cjk: true },
  ko: { code: 'ko', native: '한국어', short: 'KO', htmlLang: 'ko', intl: 'ko-KR', og: 'ko_KR', hreflang: 'ko', langLabel: '언어', cjk: true },
});

// Paths that are files, APIs or generated assets never get a locale prefix.
const UNLOCALIZED = /^\/(api|og|assets|brand|share|src|@vite|node_modules|_next|vendor)(\/|$)|^\/(sitemap[^/]*|robots\.txt)$|\.[a-z0-9]{2,12}$/i;
export const isLocalizable = path => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !UNLOCALIZED.test(path.split(/[?#]/)[0]);

/** Clips text for meta descriptions: at a word boundary for spaced scripts, by characters for CJK (no spaces). */
export function clipText(s, n = 165, locale = DEFAULT_LOCALE) {
  const t = String(s ?? '');
  const chars = [...t];
  if (chars.length <= n) return t;
  const cut = chars.slice(0, n - 1).join('');
  if (LOCALE_REGISTRY[locale]?.cjk) return `${cut}…`;
  const word = cut.replace(/\s+\S*$/, '');
  return `${word.length >= n * 0.6 ? word : cut}…`;
}

// ---------------------------------------------------------------------------------------------------- catalogs
function compileCatalog(c) {
  if (!c) return null;
  const exact = new Map(Object.entries(c.exact || {}));
  // Upper-case fallback for strings the UI upper-cases in markup ("MATCHES") while the catalog holds the phrase once.
  const upper = new Map();
  for (const [k, v] of exact) if (k !== k.toUpperCase()) upper.set(k.toUpperCase(), v.toUpperCase());
  const patterns = c.patterns || [];
  // Patterns that spell out " · " run before the segment pass; the rest after it (a generic "(.+) suffix" can never
  // swallow a whole "a · b · c" label).
  const dotted = patterns.filter(([re]) => re.source.includes('·'));
  return { exact, upper, patterns, dotted, plain: patterns.filter(p => !dotted.includes(p)), html: new Map(Object.entries(c.html || {})) };
}

/**
 * The per-site locale object.
 * @param ready     public locale codes (must include 'en'); anything else in LOCALE_REGISTRY stays a 404 prefix
 * @param site      canonical origin, e.g. 'https://golf.propbetedge.ai'
 * @param catalogs  { es: { exact, patterns, html }, ja: {...} } (site catalog merged over a common catalog if given)
 * @param common    shared network catalog of the same shape (nav, footer, All Access, consent, errors)
 * @param hosts     alternate language hosts, e.g. { 'futbol.propbetedge.ai': 'es' }
 * @param skip      CSS selector of protected containers the DOM pass never translates
 */
export function createLocale({ ready = ['en'], site = '', catalogs = {}, common = {}, hosts = {}, skip = '' } = {}) {
  const READY = Object.freeze(['en', ...ready.filter(c => c !== 'en' && LOCALE_REGISTRY[c])]);
  const LOCALES = Object.freeze(Object.fromEntries(Object.entries(LOCALE_REGISTRY).map(([k, v]) => [k, Object.freeze({ ...v, ready: READY.includes(k) })])));
  const PREFIX = new RegExp(`^/(${Object.keys(LOCALES).filter(c => c !== DEFAULT_LOCALE).join('|')})(?=/|$)`);

  function splitLocale(pathname = '/') {
    const m = String(pathname || '/').match(PREFIX);
    if (!m || !LOCALES[m[1]].ready) return { locale: DEFAULT_LOCALE, path: pathname || '/' };
    return { locale: m[1], path: pathname.slice(m[0].length) || '/' };
  }
  function localizePath(href, locale = DEFAULT_LOCALE) {
    if (!isLocalizable(href)) return href;
    const i = href.search(/[?#]/);
    const pathname = i < 0 ? href : href.slice(0, i);
    const rest = i < 0 ? '' : href.slice(i);
    const { path } = splitLocale(pathname);
    if (locale === DEFAULT_LOCALE || !LOCALES[locale]?.ready) return path + rest;
    return `/${locale}${path === '/' ? '/' : path}${rest}`;
  }
  const readLangCookie = (cookieHeader = '') => {
    const m = String(cookieHeader).match(new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=([a-z]{2})`));
    return m && LOCALES[m[1]]?.ready ? m[1] : null;
  };
  /** hreflang alternates for an unprefixed path: every ready locale (or only `codes`) plus x-default (English). */
  const alternateLinks = (path, codes = READY) => [
    ...READY.filter(c => codes.includes(c)).map(c => ({ hreflang: LOCALES[c].hreflang, url: `${site}${localizePath(path, c)}` })),
    { hreflang: 'x-default', url: `${site}${localizePath(path, DEFAULT_LOCALE)}` },
  ];

  // catalogs: site entries win over the common network catalog
  const cache = new Map();
  const compiled = locale => {
    if (cache.has(locale)) return cache.get(locale);
    const s = catalogs[locale]; const c = common[locale];
    const merged = s || c ? { exact: { ...(c?.exact || {}), ...(s?.exact || {}) }, patterns: [...(s?.patterns || []), ...(c?.patterns || [])], html: { ...(c?.html || {}), ...(s?.html || {}) } } : null;
    const out = compileCatalog(merged); cache.set(locale, out); return out;
  };
  function translateText(input, locale) {
    if (!input || locale === DEFAULT_LOCALE) return input;
    const c = compiled(locale);
    if (!c) return input;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(input);
    const core = m[2];
    if (!core || !/[A-Za-z]/.test(core)) return input;
    const hit = c.exact.get(core) ?? c.upper.get(core);
    if (hit !== undefined) return m[1] + hit + m[3];
    const tr = s => translateText(s, locale);
    const run = list => { for (const [re, to] of list) { const p = re.exec(core); if (p) return to(...p.slice(1), tr); } return null; };
    const dotted = core.includes('·');
    if (dotted) {
      const hit2 = run(c.dotted);
      if (hit2 !== null) return m[1] + hit2 + m[3];
      const parts = core.split(/(\s*·\s*)/);
      const out = parts.map((x, i) => (i % 2 ? x : tr(x))).join('');
      if (out !== core) return m[1] + out + m[3];
    }
    const hit3 = run(dotted ? c.plain : c.patterns);
    return hit3 === null ? input : m[1] + hit3 + m[3];
  }
  const translateHtml = (html, locale) => (locale === DEFAULT_LOCALE ? null : compiled(locale)?.html.get(String(html).trim()) ?? null);

  // ------------------------------------------------------------------------------------------------ DOM pass
  const SKIP = ['script', 'style', 'noscript', 'code', 'pre', 'textarea', '[translate="no"]', '[data-i18n-skip]', skip].filter(Boolean).join(', ');
  const ATTRS = ['aria-label', 'title', 'placeholder', 'alt'];
  const written = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function textNode(n, locale) {
    const v = n.nodeValue;
    if (!v || written?.get(n) === v || !/[A-Za-z]/.test(v)) return;
    const p = n.parentElement;
    if (!p || p.closest(SKIP)) return;
    const t = translateText(v, locale);
    if (t !== v) { n.nodeValue = t; written?.set(n, t); }
  }
  function element(el, locale) {
    if (el.closest(SKIP)) return;
    if (/^H[1-3]$/.test(el.tagName) && el.childElementCount) { const h = translateHtml(el.innerHTML, locale); if (h !== null) { el.innerHTML = h; return; } }
    for (const a of ATTRS) { const v = el.getAttribute(a); if (v && /[A-Za-z]/.test(v)) { const t = translateText(v, locale); if (t !== v) el.setAttribute(a, t); } }
    if (el.tagName === 'A') { const h = el.getAttribute('href'); if (h && isLocalizable(h) && !el.hasAttribute('data-lang-switch')) { const l = localizePath(h, locale); if (l !== h) el.setAttribute('href', l); } }
  }
  function localizeTree(root, locale) {
    if (!root || locale === DEFAULT_LOCALE) return;
    if (root.nodeType === 3) { textNode(root, locale); return; }
    if (root.nodeType !== 1) return;
    element(root, locale);
    for (const el of root.querySelectorAll('*')) element(el, locale);
    const w = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */);
    for (let n = w.nextNode(); n; n = w.nextNode()) textNode(n, locale);
  }
  function observeLocale(root, locale) {
    if (locale === DEFAULT_LOCALE || typeof MutationObserver === 'undefined') return null;
    localizeTree(root, locale);
    const mo = new MutationObserver(records => {
      for (const r of records) {
        if (r.type === 'childList') for (const n of r.addedNodes) localizeTree(n, locale);
        else if (r.type === 'characterData') textNode(r.target, locale);
        else if (r.type === 'attributes') element(r.target, locale);
      }
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS, 'href'] });
    return mo;
  }

  return { version: PBE_LOCALE_VERSION, LOCALES, READY_LOCALES: READY, LANG_COOKIE, LOCALE_HOSTS: Object.freeze({ ...hosts }), splitLocale, localizePath, isLocalizable, readLangCookie, alternateLinks, translateText, translateHtml, localizeTree, observeLocale, format, clipText };
}

// ---------------------------------------------------------------------------------------------------- formatting
/**
 * Locale-aware dates in an EXPLICIT time zone (the reader's, or the event's). Numbers keep one format across languages
 * so data reads identically; only dates and times follow the language.
 */
export function format(locale = DEFAULT_LOCALE, { timeZone = 'UTC' } = {}) {
  const tag = LOCALE_REGISTRY[locale]?.intl || 'en-GB';
  const ok = iso => iso && Number.isFinite(Date.parse(iso));
  const tzLabel = timeZone === 'UTC' ? 'UTC' : (new Intl.DateTimeFormat(tag, { timeZone, timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || timeZone);
  return {
    tag, timeZone,
    dateLong: iso => (ok(iso) ? new Date(iso).toLocaleDateString(tag, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone }) : '—'),
    dateShort: iso => (ok(iso) ? new Date(iso).toLocaleDateString(tag, { day: 'numeric', month: 'short', timeZone }) : '—'),
    time: iso => (ok(iso) ? `${new Date(iso).toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit', timeZone })} ${tzLabel}` : ''),
    dateTime(iso) { return ok(iso) ? `${this.dateLong(iso)}, ${this.time(iso)}` : '—'; },
  };
}
