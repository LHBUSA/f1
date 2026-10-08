// Kalshi PERPETUALS partner offer (kalshi-partner/2) on F1: vendored client unchanged, one footer mount (not PBEcast),
// same-origin fixed rewrites (CSP unchanged), fail closed, and no offer economics / referral id in F1 source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { partnerOffer, normalizeConfig, PARTNER_DISABLED } from '../src/vendor/kalshi/kalshi-partner.js';
import { layout } from '../scripts/site/lib.mjs';

const VENDORED = 'src/vendor/kalshi/kalshi-partner.js';
const MOUNT = 'src/web/kalshi-partner-footer.js';
const CANONICAL = 'D:/Workers/propbetedge-workers/workers/propsports-markets/client/kalshi-partner.js';
// SHA-256 (LF) of the canonical client at propbetedge-workers 4c3972a.
const PINNED = '063e631feadb8011fd6e1a3e7cc92908dd7f402f69fd3f5cb0153b5db4b09b7f';
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const ASSETS = { partner: '/assets/kalshi-partner-footer.x.js', account: '/assets/account.x.js', css: '/assets/app.x.css', js: '/assets/app.x.js', nav: '/assets/nav.x.js', pbecast: '/assets/pbecast.x.js' };

test('kalshi-partner.js is vendored byte-identical', () => {
  assert.equal(sha(VENDORED), PINNED, 'vendored kalshi-partner.js was edited; re-vendor it from the canonical source');
});

test('vendored kalshi-partner.js matches the canonical file when it is present', { skip: !fs.existsSync(CANONICAL) && 'canonical checkout absent' }, () => {
  assert.equal(sha(VENDORED), sha(CANONICAL), 'canonical kalshi-partner.js changed; re-vendor it and update PINNED');
});

test('same-origin rewrites are fixed paths to propsports-markets only; CSP gains nothing', () => {
  const vc = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const kx = vc.rewrites.filter((r) => r.source.startsWith('/go/kalshi'));
  assert.deepEqual(kx, [
    { source: '/go/kalshi-perps/config', destination: 'https://propsports-markets.sales-fd3.workers.dev/v1/partner/kalshi' },
    { source: '/go/kalshi-perps', destination: 'https://propsports-markets.sales-fd3.workers.dev/go/kalshi-perps' },
  ]);
  for (const r of kx) assert.doesNotMatch(r.source + r.destination, /\/:|\(|\*|\$/);
  const csp = vc.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
  assert.doesNotMatch(csp, /kalshi\.com/i);
  assert.match(csp, /script-src 'self' https:\/\/www\.googletagmanager\.com;/);
  assert.match(csp, /style-src 'self';/);
});

test('exactly one mount: the network footer slot, footer variant, f1 attribution; never on PBEcast', () => {
  const comp = fs.readFileSync(MOUNT, 'utf8');
  assert.match(comp, /placement: 'sport_footer', product: 'f1', sport: 'f1'/);
  assert.match(comp, /variant: 'footer'/);
  assert.match(comp, /loadPartnerConfig\(PARTNER_CONFIG_URL\)/);
  assert.match(comp, /'\/go\/kalshi-perps\/config'/);
  assert.doesNotMatch(comp, /https?:\/\//);

  const page = layout({ path: '/races', title: 'Races', description: 'd', body: '<p>x</p>', assets: ASSETS });
  assert.equal((page.match(/id="f1-kxo"/g) || []).length, 1);
  const foot = page.indexOf('<footer class="site-footer">');
  assert.ok(foot > 0 && page.indexOf('id="f1-kxo"') > foot && page.indexOf('id="f1-kxo"') < page.indexOf('</footer>'), 'slot sits in the footer');
  assert.equal((page.match(/kalshi-partner-footer\.x\.js/g) || []).length, 1);
  assert.match(page, /<div class="kxo-slot" id="f1-kxo" hidden><\/div>/, 'reserved nothing: hidden until a config renders');
  assert.doesNotMatch(page, /style="/, 'prod CSP style-src self: no inline style');

  const cast = layout({ path: '/pbecast', title: 'PBEcast', description: 'd', body: '<p>x</p>', assets: ASSETS, pbecast: true });
  assert.doesNotMatch(cast, /f1-kxo|kalshi-partner/);

  // Only the footer mount imports the partner client; no race/PBEcast/Race Lab/market file does.
  const files = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|mjs)$/.test(e.name)) files.push(p.replace(/\\/g, '/')); } };
  walk('src');
  const importers = files.filter((f) => f !== VENDORED && /from ['"][^'"]*kalshi-partner\.js['"]|import\(['"][^'"]*kalshi-partner\.js/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(importers, [MOUNT]);
});

test('no referral id, referral URL or offer economics hardcoded in F1 source', () => {
  const files = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else files.push(p.replace(/\\/g, '/')); } };
  walk('src/web');
  for (const f of [...files, 'scripts/site/lib.mjs', 'scripts/build-site.mjs', 'vercel.json']) {
    const s = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /kalshi\.com\/p\/|referral=|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, `${f} carries a referral URL`);
  }
  const own = fs.readFileSync(MOUNT, 'utf8') + fs.readFileSync('src/web/styles.css', 'utf8').slice(fs.readFileSync('src/web/styles.css', 'utf8').indexOf('Kalshi PERPETUALS partner offer'));
  assert.doesNotMatch(own, /\$\d|\d+\s?% off|\d+ (months?|years?)\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, 'economics and the referral id live only in the propsports-markets Worker');
});

test('fail closed: disabled or malformed config renders nothing', () => {
  const ctx = { placement: 'sport_footer', product: 'f1', sport: 'f1' };
  assert.equal(partnerOffer(PARTNER_DISABLED, ctx, { variant: 'footer' }), '');
  assert.equal(partnerOffer(normalizeConfig(null), ctx, { variant: 'footer' }), '');
  assert.equal(partnerOffer(normalizeConfig({ contract: 'kalshi-partner/2', enabled: true, path: 'https://evil.example/', program: 'perpetuals' }), ctx, { variant: 'footer' }), '');
  const html = partnerOffer(normalizeConfig({ contract: 'kalshi-partner/2', enabled: true, path: '/go/kalshi-perps', program: 'perpetuals' }), ctx, { variant: 'footer' });
  assert.match(html, /class="kxo kxo--footer kxo--generic"/);
  assert.match(html, /href="\/go\/kalshi-perps\?placement=sport_footer&amp;product=f1&amp;sport=f1"/);
  assert.match(html, /rel="sponsored noopener noreferrer"/);
});
