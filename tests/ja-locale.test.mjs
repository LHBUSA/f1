// Japanese (ja-JP) pages: vendored pbe-locale drift check, routing/hreflang contract, and (after a build) the rendered
// /ja + /ja/standings pages: lang, canonical, reciprocal hreflang, CTA + legal links, no betting/referral links.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { alternatesFor, jaPath, JA_PRO_URL, JA_TOKUSHOHO_URL, JA_PRICE, GP_JA, SESSION_JA, langSwitch } from '../scripts/site/ja.mjs';

const VENDOR = 'src/vendor/pbe-locale';
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

test('pbe-locale is vendored byte-identical to its manifest (LF-normalised sha256)', () => {
  const lines = fs.readFileSync(`${VENDOR}/MANIFEST.sha256`, 'utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, 2);
  for (const l of lines) {
    const [hash, name] = l.trim().split(/\s+/);
    assert.equal(sha(`${VENDOR}/${name}`), hash, `${name} drifted from pbe-locale MANIFEST; re-vendor from propbetedge-workers shared/pbe-locale`);
  }
  assert.match(fs.readFileSync(`${VENDOR}/pbe-locale.js`, 'utf8'), /PBE_LOCALE_VERSION = 'pbe-locale\/1\.0\.0'/);
});

test('routing: ja lives under /ja (trailingSlash:false final URLs), reciprocal hreflang + x-default English', () => {
  assert.equal(jaPath('/'), '/ja');
  assert.equal(jaPath('/standings'), '/ja/standings');
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
  for (const k of ['fp1', 'fp2', 'fp3', 'sprint_qualifying', 'sprint', 'qualifying', 'race']) assert.ok(SESSION_JA[k]);
});

test('language switch: hard navigation (never soft-nav), current language not a link', () => {
  const en = langSwitch('/', '/ja', 'en');
  assert.match(en, /<a href="\/ja" hreflang="ja" lang="ja" data-no-soft data-lang-switch>日本語<\/a>/);
  assert.match(en, /<span aria-current="true" lang="en">EN<\/span>/);
  const ja = langSwitch('/standings', '/ja/standings', 'ja');
  assert.match(ja, /<a href="\/standings" hreflang="en" lang="en" data-no-soft data-lang-switch>EN<\/a>/);
});

const BUILT = fs.existsSync('dist/ja.html') && fs.existsSync('dist/ja/standings.html');
const FORBIDDEN = /href="[^"]*(kalshi|polymarket|stripe\.com|draftkings|fanduel|betmgm|bet365|sportsbook|odds|\/go\/|\/picks|track-record|race-lab)[^"]*"/i;

test('built ja pages: lang, canonical, hreflang, CTA, legal, no betting/referral/helpline content', { skip: !BUILT && 'needs a build' }, () => {
  for (const [file, canon, en] of [['dist/ja.html', 'https://f1.propbetedge.ai/ja', 'https://f1.propbetedge.ai/'], ['dist/ja/standings.html', 'https://f1.propbetedge.ai/ja/standings', 'https://f1.propbetedge.ai/standings']]) {
    const h = fs.readFileSync(file, 'utf8');
    assert.match(h, /<html lang="ja">/);
    assert.ok(h.includes(`<link rel="canonical" href="${canon}">`), `${file} canonical`);
    assert.ok(h.includes(`<link rel="alternate" hreflang="ja" href="${canon}">`), `${file} self hreflang`);
    assert.ok(h.includes(`<link rel="alternate" hreflang="en" href="${en}">`), `${file} en hreflang`);
    assert.ok(h.includes(`<link rel="alternate" hreflang="x-default" href="${en}">`), `${file} x-default`);
    assert.match(h, /content="index,follow/);
    assert.doesNotMatch(h, FORBIDDEN, `${file} has a forbidden link`);
    assert.doesNotMatch(h, /1-800|GAMBLER|kxo|kalshi|account\.[0-9a-f]+\.js|nav\.[0-9a-f]+\.js/i, `${file} loads an English-only module or helpline`);
    assert.ok(h.includes(`href="${JA_PRO_URL.replace('&', '&amp;')}"`), `${file} CTA`);
    assert.ok(h.includes(`href="${JA_TOKUSHOHO_URL}"`), `${file} 特定商取引法に基づく表記`);
    assert.ok(h.includes(JA_PRICE), `${file} price`);
    assert.doesNotMatch(h, /style="/, 'prod CSP blocks inline styles');
  }
  const sm = fs.readFileSync('dist/sitemap.xml', 'utf8');
  assert.ok(sm.includes('<loc>https://f1.propbetedge.ai/ja</loc>') && sm.includes('<loc>https://f1.propbetedge.ai/ja/standings</loc>'));
});

test('built English counterparts carry reciprocal hreflang + switch; other English pages do not', { skip: !BUILT && 'needs a build' }, () => {
  for (const [file, ja] of [['dist/index.html', 'https://f1.propbetedge.ai/ja'], ['dist/standings.html', 'https://f1.propbetedge.ai/ja/standings']]) {
    const h = fs.readFileSync(file, 'utf8');
    assert.ok(h.includes(`<link rel="alternate" hreflang="ja" href="${ja}">`), file);
    assert.match(h, /<html lang="en">/);
    assert.match(h, /class="lang-switch"/);
  }
  for (const f of ['dist/races.html', 'dist/drivers.html', 'dist/standings/2025.html']) if (fs.existsSync(f)) {
    const h = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(h, /hreflang="ja"/, `${f} has no Japanese counterpart`);
    assert.doesNotMatch(h, /class="lang-switch"/, f);
  }
});

test('every current-season Grand Prix on the built site has a Japanese name', { skip: !fs.existsSync('data/derived/meta.json') && 'needs data' }, async () => {
  const meta = JSON.parse(fs.readFileSync('data/derived/meta.json', 'utf8'));
  const events = JSON.parse(fs.readFileSync('data/normalized/events.json', 'utf8')).filter((e) => e.season === meta.current_season);
  for (const e of events) assert.ok(GP_JA[e.slug.replace(/^\d{4}-/, '')], `GP_JA missing ${e.slug}`);
});
