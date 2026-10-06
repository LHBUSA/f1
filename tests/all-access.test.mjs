// PropBetEdge All Access gate on F1 Intelligence (owner 2026-10-05): presentation of the server verdict, the native
// /all-access page, the canonical offer, the link policy and the one approved CSP change. f1-api keeps gating premium
// data server-side; nothing here decides access.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as AA from '../src/core/all-access.mjs';
import { accountView, ACCOUNT_LABEL } from '../src/core/account-view.mjs';
import { accountPanels, accountSheet, accountButton, allAccessPage } from '../scripts/site/account.mjs';
import { layout } from '../scripts/site/lib.mjs';

const STRIPE = 'https://buy.stripe.com/8x2eVdgmOaqy4pv8Ez7wA0N';
const panel = (html, key) => { const i = html.indexOf(`data-acct-panel="${key}"`); assert.ok(i > 0, key); const j = html.indexOf('data-acct-panel=', i + 20); return html.slice(i, j > 0 ? j : undefined); };

test('family registry v2: 10 sports, All Access products never sports', () => {
  assert.equal(AA.FAMILY.version, '2.0.0');
  assert.deepEqual(AA.SPORTS.map((s) => s.key), ['mlb', 'nfl', 'nba', 'wnba', 'nhl', 'ufc', 'tennis', 'soccer', 'golf', 'f1']);
  assert.deepEqual(AA.FAMILY.products.map((p) => p.key), ['members', 'compare', 'predictions']);
  assert.equal(AA.PREDICTIONS.key, 'predictions');
  for (const p of AA.FAMILY.products) assert.ok(!AA.SPORTS.some((s) => s.key === p.key));
  assert.equal(AA.FAMILY.all_access.find((p) => p.key === 'compare').url, 'https://compare.propbetedge.ai/');
  assert.equal(AA.sportName(AA.SPORTS.find((s) => s.key === 'f1')), 'F1 Intelligence');
});

test('commercial facts are the canonical contract values (pbe-membership 1.4.0); three separate link constants', () => {
  assert.equal(AA.ALL_ACCESS_CHECKOUT_URL, STRIPE);
  assert.equal(AA.NETWORK_ALL_ACCESS_URL, 'https://propbetedge.ai/pro');
  assert.equal(AA.LOCAL_ALL_ACCESS_PATH, '/all-access');
  assert.equal(AA.MANAGE_URL, 'https://billing.stripe.com/p/login/cNi3cv2vY7em3lr4oj7wA00');
  assert.equal(AA.PRICE, '$29/month');
  assert.equal(AA.PROMO_LINE, '25% off while active with code THEEDGE25');
  assert.equal(AA.OFFER_LINE, '10 sports + PropBetEdge Predictions');
});

test('account view from the verdict: outage/failure is the access check, never signed out or a sale', () => {
  const ok = (body) => ({ status: 200, body });
  assert.equal(accountView(null), 'check');
  assert.equal(accountView({ status: 502, body: null }), 'check');
  assert.equal(accountView(ok(null)), 'check');
  assert.equal(accountView(ok({ verification: 'auth_unavailable', signed_in: false, membership: { state: 'free', entitled: false } })), 'check');
  assert.equal(accountView(ok({ verification: 'no_session', signed_in: false, membership: { state: 'free', entitled: false } })), 'signed_out');
  assert.equal(accountView(ok({ verification: 'invalid_session', signed_in: false, membership: { state: 'free', entitled: false } })), 'signed_out');
  assert.equal(accountView(ok({ verification: 'no_network_entitlement', signed_in: true, membership: { state: 'free', entitled: false } })), 'signed_in');
  assert.equal(accountView(ok({ verification: 'network', signed_in: true, membership: { state: 'all_access', entitled: true } })), 'all_access');
  assert.equal(accountView(ok({ verification: 'network', signed_in: true, membership: { state: 'owner', entitled: true } })), 'owner');
  assert.equal(accountView(ok({ signed_in: true, membership: { state: 'all_access', entitled: false } })), 'signed_in', 'state without entitlement is never Platinum');
  for (const [k, [full, short]] of Object.entries(ACCOUNT_LABEL)) assert.doesNotMatch(`${full} ${short}`, /free/i, k);
  assert.equal(ACCOUNT_LABEL.all_access[0], '◆ Platinum');
  assert.equal(ACCOUNT_LABEL.owner[0], 'Verified owner');
});

test('panels: Platinum / owner / access check carry no purchase link; only signed-out and non-member offer the canonical Stripe checkout', () => {
  for (const where of ['sheet', 'page']) {
    const html = accountPanels(where);
    assert.doesNotMatch(html, /style=|\bFREE\b|propbetedge\.ai\/pro/);
    for (const k of ['all_access', 'owner', 'check']) assert.doesNotMatch(panel(html, k), /buy\.stripe|Get All Access/, `${where}:${k}`);
    for (const k of ['signed_out', 'signed_in']) assert.equal((panel(html, k).match(new RegExp(STRIPE.replace(/[.]/g, '\\.'), 'g')) || []).length, 1, `${where}:${k}`);
    assert.match(panel(html, 'all_access'), /◆ PLATINUM/);
    assert.match(panel(html, 'all_access'), /PLATINUM ACCESS ACTIVE/);
    assert.match(panel(html, 'all_access'), /PropBetEdge All Access · 10 sports \+ Predictions/);
    assert.match(panel(html, 'owner'), /VERIFIED OWNER/);
    assert.doesNotMatch(panel(html, 'owner'), /billing\.stripe/, 'owner has nothing to manage');
    assert.match(panel(html, 'check'), /data-acct-retry/);
    assert.match(panel(html, 'signed_out'), /data-acct-signin/);
    assert.doesNotMatch(panel(html, 'signed_out') + panel(html, 'signed_in'), /odds|picks|F1 EDGE/i, 'never advertise odds, picks or F1 EDGE');
  }
  assert.match(accountButton(), /data-acct-open/);
  assert.match(accountSheet(), /<dialog id="acct-sheet"/);
});

test('/all-access is a real local page: content in HTML, self canonical, F1 marked, Predictions separate, no redirect constructs', () => {
  const p = allAccessPage();
  assert.equal(p.path, '/all-access');
  assert.ok(!p.noindex);
  const html = layout({ ...p, assets: { css: '/a.css', js: '/a.js', account: '/assets/account.x.js' } });
  assert.match(html, /<link rel="canonical" href="https:\/\/f1\.propbetedge\.ai\/all-access">/);
  assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
  assert.match(html, /You are here/);
  assert.match(html, /Intelligence product · not a sport/);
  assert.match(html, /Ten sport desks/);
  assert.doesNotMatch(html, /http-equiv="refresh"|window\.location|<iframe|style=|11 sports/i);
  for (const s of AA.SPORTS.filter((x) => x.key !== 'f1')) assert.ok(html.includes(`href="${s.url}"`), s.key);
});

test('every page carries the account control + sheet; footer All Access is local; no propbetedge.ai/pro anywhere', () => {
  const html = layout({ path: '/races', title: 'Races', description: 'x', body: '<p>x</p>', assets: { css: '/a.css', js: '/a.js', account: '/assets/account.x.js' } });
  assert.match(html, /<script type="module" src="\/assets\/account\.x\.js"><\/script>/);
  assert.match(html, /data-acct-open/);
  assert.match(html, /<dialog id="acct-sheet"/);
  assert.match(html, /<a href="\/all-access">All Access<\/a>/);
  assert.doesNotMatch(html, /propbetedge\.ai\/pro/);
});

test('PBEcast: locks sell via the canonical Stripe link, informational links go to /all-access, data gating unchanged', () => {
  const tpl = fs.readFileSync('scripts/site/pbecast-v2.mjs', 'utf8');
  assert.match(tpl, /href="\$\{AA\.checkout\}" rel="noopener" data-pbe-placement="all_access_checkout"/);
  assert.match(tpl, /class="pc-learn" href="\$\{AA\.learn\}"/);
  assert.doesNotMatch(tpl, /propbetedge\.ai\/pro|>Free</);
  const js = fs.readFileSync('src/web/pbecast.js', 'utf8');
  assert.match(js, /S\.entitled = r\?\.status === 200 && r\.body\?\.membership\?\.entitled === true;/, 'entitlement gating line unchanged');
  assert.doesNotMatch(js, /'Free'|Signed in · Free/);
});

test('CSP: exactly one approved change — auth.propbetedge.ai added to connect-src; everything else identical', () => {
  const v = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const csp = v.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
  assert.equal(csp, "default-src 'self'; img-src 'self' data: https://propsports.proptechusa.ai https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com; style-src 'self'; font-src 'self'; script-src 'self' https://www.googletagmanager.com; connect-src 'self' https://auth.propbetedge.ai https://propsports.proptechusa.ai https://propsports-markets.sales-fd3.workers.dev https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
});

test('client: one delegated listener set, 8 s timeout, never writes inline styles', () => {
  const js = fs.readFileSync('src/web/account.js', 'utf8');
  assert.match(js, /AbortSignal\.timeout\(8000\)/);
  assert.doesNotMatch(js, /\.style\b|setAttribute\('style'|innerHTML/);
  assert.equal((js.match(/document\.addEventListener\('click'/g) || []).length, 1);
});
