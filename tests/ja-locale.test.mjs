// Japanese (ja-JP) pages: vendored pbe-locale drift check, routing/hreflang contract, and (after a build) every rendered
// Japanese page (f1#11 route cohort): lang, self-canonical, reciprocal hreflang only between indexable pairs, robots
// parity with the English counterpart, ja sitemap, JSON-LD inLanguage, links that stay in /ja and resolve, JST times,
// no betting/referral/partner content, no English UI chrome, and English pages left untouched apart from the switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { alternatesFor, jaPath, JA_PRO_URL, JA_TOKUSHOHO_URL, JA_PRICE, GP_JA, SESSION_JA, NAME_JA, TEAM_JA, langSwitch, jst, civilDate, JA_ADAPTER_VERSION } from '../scripts/site/ja.mjs';

const VENDOR = 'src/vendor/pbe-locale';
const SITE = 'https://f1.propbetedge.ai';
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

test('pbe-locale is vendored byte-identical to its manifest (LF-normalised sha256)', () => {
  const lines = fs.readFileSync(`${VENDOR}/MANIFEST.sha256`, 'utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, 2);
  for (const l of lines) {
    const [hash, name] = l.trim().split(/\s+/);
    assert.equal(sha(`${VENDOR}/${name}`), hash, `${name} drifted from pbe-locale MANIFEST; re-vendor from propbetedge-workers shared/pbe-locale`);
  }
  assert.match(fs.readFileSync(`${VENDOR}/pbe-locale.js`, 'utf8'), /PBE_LOCALE_VERSION = 'pbe-locale\/1\.0\.0'/);
  assert.match(JA_ADAPTER_VERSION, /^f1-ja\/\d+\.\d+\.\d+$/);
});

test('routing: ja lives under /ja (trailingSlash:false final URLs), reciprocal hreflang + x-default English', () => {
  assert.equal(jaPath('/'), '/ja');
  assert.equal(jaPath('/standings'), '/ja/standings');
  assert.equal(jaPath('/races/2026-singapore-grand-prix'), '/ja/races/2026-singapore-grand-prix');
  assert.deepEqual(alternatesFor('/'), [
    { hreflang: 'en', url: 'https://f1.propbetedge.ai/' },
    { hreflang: 'ja', url: 'https://f1.propbetedge.ai/ja' },
    { hreflang: 'x-default', url: 'https://f1.propbetedge.ai/' },
  ]);
  assert.deepEqual(alternatesFor('/standings').map((a) => a.url), ['https://f1.propbetedge.ai/standings', 'https://f1.propbetedge.ai/ja/standings', 'https://f1.propbetedge.ai/standings']);
});

test('commercial + legal constants are the approved ones', () => {
  assert.equal(JA_PRO_URL, 'https://propbetedge.ai/ja/pro?via=f1');
  assert.equal(JA_TOKUSHOHO_URL, 'https://propbetedge.ai/ja/legal/tokushoho');
  assert.equal(JA_PRICE, '月額 US$29');
});

test('racing vocabulary: precise Japanese session and championship terms', () => {
  assert.deepEqual(SESSION_JA, { fp1: 'フリー走行1回目', fp2: 'フリー走行2回目', fp3: 'フリー走行3回目', sprint_qualifying: 'スプリント予選', sprint: 'スプリント', qualifying: '予選', race: '決勝' });
  assert.equal(NAME_JA['espn-5652'], '角田裕毅');
  assert.equal(TEAM_JA['Red Bull Racing'], 'レッドブル・レーシング');
});

test('JST formatting: the Singapore GP (12:00Z) reads 21:00 in Japan; birth dates never shift', () => {
  assert.equal(jst.dateTime('2026-10-11T12:00:00Z'), '2026年10月11日(日) 21:00（日本時間）');
  assert.equal(jst.short('2026-10-11T16:30:00Z'), '10月12日');
  assert.equal(civilDate('1997-09-30'), '1997年9月30日');
});

test('language switch: hard navigation (never soft-nav), current language not a link', () => {
  const en = langSwitch('/', '/ja', 'en');
  assert.match(en, /<a href="\/ja" hreflang="ja" lang="ja" data-no-soft data-lang-switch>日本語<\/a>/);
  assert.match(en, /<span aria-current="true" lang="en">EN<\/span>/);
  const ja = langSwitch('/standings', '/ja/standings', 'ja');
  assert.match(ja, /<a href="\/standings" hreflang="en" lang="en" data-no-soft data-lang-switch>EN<\/a>/);
});

// ------------------------------------------------------------------------------------------------ built site
const BUILT = fs.existsSync('dist/ja.html') && fs.existsSync('dist/ja/standings.html') && fs.existsSync('dist/sitemap-ja.xml');
const FORBIDDEN = /href="[^"]*(kalshi|polymarket|stripe\.com|draftkings|fanduel|betmgm|bet365|sportsbook|odds|\/go\/|\/picks|track-record|race-lab|pbecast|\/news)[^"]*"/i;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.html') ? [path.join(d, e.name)] : []));
const jaFiles = BUILT ? ['dist/ja.html', ...walk('dist/ja')] : [];
const urlOf = (f) => '/' + f.replace(/\\/g, '/').replace(/^dist\//, '').replace(/\.html$/, '').replace(/^index$/, '');
const fileOf = (u) => { const p = u.split(/[?#]/)[0]; if (p === '/') return 'dist/index.html'; const c = [`dist${p}.html`, `dist${p}`]; return c.find((x) => fs.existsSync(x) && fs.statSync(x).isFile()) || null; };
const head = (h, re) => (h.match(re) || [])[1];
const read = (f) => fs.readFileSync(f, 'utf8');
const enOf = (u) => (u === '/ja' ? '/' : u.replace(/^\/ja/, ''));

test('every Japanese page: lang, self-canonical, robots parity, hreflang only for indexable pairs, inLanguage, no forbidden content', { skip: !BUILT && 'needs a build' }, () => {
  assert.ok(jaFiles.length > 2000, `full route cohort expected, got ${jaFiles.length}`);
  for (const f of jaFiles) {
    const h = read(f);
    const u = urlOf(f);
    assert.match(h, /<html lang="ja">/, f);
    assert.ok(h.includes(`<link rel="canonical" href="${SITE}${u}">`), `${f} self-canonical`);
    const enFile = fileOf(enOf(u));
    assert.ok(enFile, `${f} has an English counterpart`);
    const en = read(enFile);
    const jaIdx = /content="index,follow/.test(h), enIdx = /content="index,follow/.test(en);
    assert.equal(jaIdx, enIdx, `${f} robots match English`);
    if (jaIdx) {
      assert.ok(h.includes(`<link rel="alternate" hreflang="ja" href="${SITE}${u}">`), `${f} self hreflang`);
      assert.ok(en.includes(`<link rel="alternate" hreflang="ja" href="${SITE}${u}">`), `${enFile} reciprocal hreflang`);
      assert.ok(h.includes(`<link rel="alternate" hreflang="en" href="${SITE}${enOf(u) === '/' ? '/' : enOf(u)}">`), `${f} en hreflang`);
      assert.ok(h.includes('hreflang="x-default"'), `${f} x-default`);
    } else {
      assert.doesNotMatch(h, /rel="alternate" hreflang/, `${f} noindex page carries no hreflang`);
      assert.doesNotMatch(en, /rel="alternate" hreflang="ja"/, `${enFile} noindex page carries no hreflang`);
    }
    assert.match(h, /"inLanguage":"ja"/, `${f} JSON-LD inLanguage`);
    assert.doesNotMatch(h, FORBIDDEN, `${f} has a forbidden link`);
    assert.doesNotMatch(h, /1-800|GAMBLER|kxo|kalshi|polymarket|account\.[0-9a-f]+\.js|nav\.[0-9a-f]+\.js|data-local=|data-weather/i, `${f} loads an English-only module, re-renders time, or a helpline`);
    assert.doesNotMatch(h, /style="/, `${f}: prod CSP blocks inline styles`);
    assert.ok(h.includes(`href="${JA_TOKUSHOHO_URL}"`), `${f} 特定商取引法に基づく表記`);
  }
});

test('Japanese links stay in /ja and resolve; the only English links are the explicit language links', { skip: !BUILT && 'needs a build' }, () => {
  const ok = new Set();
  for (const f of jaFiles) {
    const h = read(f).replace(/<head>[\s\S]*?<\/head>/, '');
    for (const [, href, rest] of h.matchAll(/<a href="([^"]+)"([^>]*)>/g)) {
      if (/^https?:|^#|^mailto:/.test(href)) continue;
      if (/hreflang="en"/.test(rest)) continue; // language switch / 英語版
      assert.match(href, /^\/ja(\/|#|$)/, `${f} links outside /ja: ${href}`);
      const p = href.split('#')[0];
      if (ok.has(p)) continue;
      assert.ok(fileOf(p), `${f} dead link ${href}`);
      ok.add(p);
    }
  }
});

test('ja sitemap: exactly the indexable Japanese pages, with alternates; robots.txt lists it; English sitemap has no /ja', { skip: !BUILT && 'needs a build' }, () => {
  const sm = read('dist/sitemap-ja.xml');
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(SITE, ''));
  const idx = jaFiles.filter((f) => /content="index,follow/.test(read(f))).map(urlOf);
  assert.deepEqual([...locs].sort(), [...idx].sort());
  assert.ok(locs.includes('/ja') && locs.includes('/ja/standings') && locs.includes('/ja/races/2026-singapore-grand-prix'));
  assert.match(sm, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  assert.match(sm, /<xhtml:link rel="alternate" hreflang="ja" href="https:\/\/f1\.propbetedge\.ai\/ja\/standings"\/>/);
  assert.match(read('dist/robots.txt'), /Sitemap: https:\/\/f1\.propbetedge\.ai\/sitemap-ja\.xml/);
  assert.doesNotMatch(read('dist/sitemap.xml'), /\/ja[<\/]/);
});

test('Japanese UI chrome: headings, table headers and nav carry no English UI words', { skip: !BUILT && 'needs a build' }, () => {
  const ALLOW = /\b(Q[123]|PP|FL|km|GP|DNA|F1|FIA|All Access|Race Lab|PropBetEdge|PropSports|PBEcast|US\$29|EN|JA)\b/g;
  const sample = ['dist/ja.html', 'dist/ja/standings.html', 'dist/ja/races.html', 'dist/ja/races/2026-singapore-grand-prix.html', 'dist/ja/drivers.html', 'dist/ja/drivers/max-verstappen.html', 'dist/ja/teams.html', 'dist/ja/teams/ferrari.html', 'dist/ja/circuits.html', 'dist/ja/circuits/suzuka-circuit.html', 'dist/ja/methodology.html', 'dist/ja/data-coverage.html'].filter((f) => fs.existsSync(f));
  for (const f of sample) {
    const h = read(f).replace(/<span[^>]*translate="no"[^>]*>[\s\S]*?<\/span>/g, '').replace(/<b translate="no">[\s\S]*?<\/b>/g, '');
    for (const [, t] of h.matchAll(/<(?:h1|h2|h3|th|button)[^>]*>([\s\S]*?)<\/(?:h1|h2|h3|th|button)>/g)) {
      const txt = t.replace(/<[^>]+>/g, '').replace(ALLOW, '');
      assert.doesNotMatch(txt, /[A-Za-z]{3,}/, `${f}: English UI text "${t.replace(/<[^>]+>/g, '').slice(0, 60)}"`);
    }
    const nav = head(read(f), /<nav class="primary-nav"[^>]*>([\s\S]*?)<\/nav>/);
    assert.doesNotMatch(nav.replace(/<[^>]+>/g, '').replace(ALLOW, ''), /[A-Za-z]{3,}/, `${f} nav`);
  }
});

test('race pages: JST session schedule and Japanese terminology', { skip: !BUILT && 'needs a build' }, () => {
  const h = read('dist/ja/races/2026-singapore-grand-prix.html');
  assert.match(h, /セッションスケジュール（日本時間）/);
  assert.match(h, /決勝/);
  assert.match(h, /予選/);
  assert.match(h, /<time datetime="2026-10-11T12:00Z">2026年10月11日\(日\) 21:00（日本時間）<\/time>|<time datetime="2026-10-11T12:00:00Z">/);
  const s = read('dist/ja/standings.html');
  assert.match(s, /ドライバーズ/);
  assert.match(s, /コンストラクターズ/);
});

test('English pages: unchanged chrome; only pages with a Japanese counterpart get the switch; no ja stylesheet', { skip: !BUILT && 'needs a build' }, () => {
  for (const [file, ja] of [['dist/index.html', `${SITE}/ja`], ['dist/standings.html', `${SITE}/ja/standings`], ['dist/races.html', `${SITE}/ja/races`], ['dist/drivers/max-verstappen.html', `${SITE}/ja/drivers/max-verstappen`]]) {
    const h = read(file);
    assert.ok(h.includes(`<link rel="alternate" hreflang="ja" href="${ja}">`), file);
    assert.match(h, /<html lang="en">/);
    assert.match(h, /class="lang-switch"/);
    assert.doesNotMatch(h, /assets\/ja\.[0-9a-f]+\.css/, `${file} must not load the Japanese stylesheet`);
  }
  for (const f of ['dist/matchups.html', 'dist/pbecast.html', 'dist/news.html', 'dist/race-lab.html', 'dist/picks.html', 'dist/track-record.html', 'dist/all-access.html', 'dist/people.html', 'dist/power-units.html', 'dist/intelligence.html']) if (fs.existsSync(f)) {
    const h = read(f);
    assert.doesNotMatch(h, /hreflang="ja"/, `${f} has no Japanese counterpart`);
    assert.doesNotMatch(h, /class="lang-switch"/, f);
  }
  const appCss = fs.readdirSync('dist/assets').find((x) => /^app\.[0-9a-f]+\.css$/.test(x));
  const css = read(`dist/assets/${appCss}`);
  assert.doesNotMatch(css, /\.jp-|html:lang\(ja\)|:lang\(ko\)/, 'Japanese-only rules ship in ja.css, not the English bundle');
});

test('every current-season Grand Prix on the built site has a Japanese name', { skip: !fs.existsSync('data/derived/meta.json') && 'needs data' }, async () => {
  const meta = JSON.parse(fs.readFileSync('data/derived/meta.json', 'utf8'));
  const events = JSON.parse(fs.readFileSync('data/normalized/events.json', 'utf8')).filter((e) => e.season === meta.current_season);
  for (const e of events) assert.ok(GP_JA[e.slug.replace(/^\d{4}-/, '')], `GP_JA missing ${e.slug}`);
});
