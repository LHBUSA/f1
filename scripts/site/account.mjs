// PropBetEdge All Access on F1 Intelligence: the header account control, the account sheet and the native
// /all-access page. Every panel is server-rendered once (static, indexable, no protected values); the browser
// (src/web/account.js) only chooses WHICH panel to show from the server's membership verdict. Nothing here decides
// access: f1-api keeps gating the premium endpoints on its own.
import { esc, SITE } from './lib.mjs';
import { ALL_ACCESS_CHECKOUT_URL, LOCAL_ALL_ACCESS_PATH, MANAGE_URL, OFFER_LINE, PLATINUM_TRUTH, PREDICTIONS, PRICE, PROMO_LINE, PRODUCT, SPORTS, F1_ALL_ACCESS, F1_FREE, sportName } from '../../src/core/all-access.mjs';

const PREDICTIONS_LINE = 'Independent, source-backed forecasts with model probability, market comparison and a scored record.';

export function accountButton() {
  return `<button class="acct-btn" type="button" data-acct-open aria-haspopup="dialog" aria-controls="acct-sheet" data-acct-view="checking"><span class="acct-dot" aria-hidden="true"></span><span class="acct-l" data-acct-label>Account</span><span class="acct-s" data-acct-short>Account</span></button>`;
}

const sportsChips = () => `<ul class="acct-chips" aria-label="${esc(SPORTS.map(sportName).join(' · '))}">${SPORTS.map((s) => `<li${s.key === 'f1' ? ' class="here"' : ''}>${esc(sportName(s))}</li>`).join('')}</ul>`;
const offerIncludes = () => `<div class="acct-incl"><div><span class="acct-k">Sports · ${SPORTS.length}</span>${sportsChips()}</div><div class="acct-intel"><span class="acct-k">Intelligence</span><b>◆ ${esc(PREDICTIONS.name)}</b><small>${esc(PREDICTIONS_LINE)}</small></div></div>`;
const capsGrid = (unlocked) => `<section class="acct-caps${unlocked ? ' on' : ''}" aria-label="${unlocked ? 'Unlocked on this account' : 'What All Access adds on F1'}"><h3>${unlocked ? 'Unlocked on this account' : 'What All Access adds on F1'}</h3><ul>${F1_ALL_ACCESS.map((c) => `<li><i aria-hidden="true"></i><b>${esc(c.label)}</b><span>${esc(c.sub)}</span></li>`).join('')}</ul></section>`;
const signinForm = (id) => `<form class="acct-signin" data-acct-signin novalidate><label for="${id}">Already All Access? Sign in</label><span><input id="${id}" name="email" type="email" required autocomplete="email" placeholder="you@example.com"><button type="submit">Email me a link</button></span><span class="fine" data-acct-signin-msg aria-live="polite"></span></form>`;
const retry = () => `<button type="button" class="acct-cta" data-acct-retry>Retry verified access</button>`;
const signout = () => `<button type="button" class="acct-btn2" data-acct-signout>Sign out</button>`;
const checkout = (label = 'Get All Access') => `<a class="acct-cta" href="${ALL_ACCESS_CHECKOUT_URL}" rel="noopener" data-pbe-placement="all_access_checkout">${esc(label)} · ${esc(PRICE)}</a>`;
const learn = () => `<a class="acct-btn2" href="${LOCAL_ALL_ACCESS_PATH}">What&#39;s included</a>`;
const verified = (tone, badge, lines) => `<section class="acct-verified ${tone}" aria-label="Verified account"><div class="acct-vtop"><span>Verified account</span><b class="acct-badge ${tone}">${esc(badge)}</b></div><p class="acct-vmeta">${lines.map((l) => `<span>${esc(l)}</span>`).join('')}</p></section>`;

/**
 * Every account state, server-rendered; the client shows exactly one (data-acct-panel).
 * `where`: 'sheet' (compact, links to /all-access) or 'page' (the /all-access page itself).
 */
export function accountPanels(where = 'sheet') {
  const inSheet = where === 'sheet';
  const idp = inSheet ? 'acct-email' : 'aap-email';
  return `<div class="acct-panels" data-acct-panels>
<div class="acct-panel" data-acct-panel="checking"><span class="acct-eyebrow">PropBetEdge F1 Intelligence</span><p class="acct-lede">Checking your PropBetEdge access…</p></div>
<div class="acct-panel" data-acct-panel="signed_out" hidden>
  <span class="acct-eyebrow">${esc(PRODUCT)}</span>
  <h2 class="acct-head">${esc(OFFER_LINE)}.<br>One membership.</h2>
  <p class="acct-price"><b>$29</b><span>/month</span><small>Launch offer: ${esc(PROMO_LINE)}</small></p>
  ${offerIncludes()}
  <div class="acct-actions">${checkout()}${inSheet ? learn() : ''}</div>
  ${signinForm(idp)}
  <p class="acct-secure">◆ Secure checkout by Stripe · Passwordless PropBetEdge sign-in</p>
</div>
<div class="acct-panel" data-acct-panel="signed_in" hidden>
  <p class="acct-identity"><i aria-hidden="true"></i>SIGNED IN · PropBetEdge account</p>
  <span class="acct-eyebrow">F1 · Account ready</span>
  <h2 class="acct-head">Your account doesn&#39;t include All Access.</h2>
  <p class="acct-lede">${esc(PRODUCT)} adds the full PBEcast timing tower, session replay and the position graph on F1, plus every other PropBetEdge sport and ${esc(PREDICTIONS.name)}.</p>
  <div class="acct-actions">${checkout()}${inSheet ? learn() : ''}${signout()}</div>
</div>
<div class="acct-panel" data-acct-panel="check" hidden>
  <p class="acct-identity check"><i aria-hidden="true"></i>PropBetEdge access</p>
  <span class="acct-eyebrow">F1 · Access check</span>
  <h2 class="acct-head">Access check temporarily unavailable.</h2>
  <p class="acct-lede">Membership verification did not answer. Nothing about your membership has changed, and every public F1 page keeps working.</p>
  <p class="acct-protect"><b>Your account is not being treated as unsubscribed.</b> Pricing and sign-up stay hidden until verification answers cleanly.</p>
  <div class="acct-actions">${retry()}</div>
</div>
<div class="acct-panel" data-acct-panel="all_access" hidden>
  <span class="acct-eyebrow on">F1 · Platinum member</span>
  <h2 class="acct-head">Your full F1 desk<br>is unlocked.</h2>
  ${verified('platinum', '◆ PLATINUM', ['PLATINUM ACCESS ACTIVE', PLATINUM_TRUTH])}
  ${capsGrid(true)}
  <div class="acct-actions"><a class="acct-cta" href="/pbecast">Open PBEcast →</a>${inSheet ? `<a class="acct-btn2" href="${LOCAL_ALL_ACCESS_PATH}">Your network</a>` : ''}<a class="acct-btn2" href="${MANAGE_URL}" target="_blank" rel="noopener noreferrer">Manage membership ↗</a><button type="button" class="acct-btn2" data-acct-retry>Refresh verified access</button>${signout()}</div>
</div>
<div class="acct-panel" data-acct-panel="owner" hidden>
  <span class="acct-eyebrow owner">F1 · Verified owner</span>
  <h2 class="acct-head">Owner access<br>is active.</h2>
  ${verified('owner', 'VERIFIED OWNER', ['Owner access · no subscription required', 'Verified by PropBetEdge'])}
  ${capsGrid(true)}
  <div class="acct-actions"><a class="acct-cta" href="/pbecast">Open PBEcast →</a>${inSheet ? `<a class="acct-btn2" href="${LOCAL_ALL_ACCESS_PATH}">The network</a>` : ''}<button type="button" class="acct-btn2" data-acct-retry>Refresh verified access</button>${signout()}</div>
</div>
</div>`;
}

const story = (h) => `<div class="acct-story"><span class="acct-eyebrow">PropBetEdge F1 Intelligence</span><${h} class="acct-title">Every lap<br><em>leaves a trace.</em></${h}><p>PBEcast places every car from the lap timing we record ourselves. All Access opens the full timing tower, session replay and every driver&#39;s position graph — and the rest of the PropBetEdge network.</p></div>`;

export function accountSheet() {
  return `<dialog id="acct-sheet" class="acct-sheet" aria-label="PropBetEdge F1 account" data-acct-sheet>
<button type="button" class="acct-close" data-acct-close aria-label="Close account">×</button>
<div class="acct-grid">${story('h2')}<div class="acct-side">${accountPanels('sheet')}</div></div>
</dialog>`;
}

export function allAccessPage() {
  const body = `<section class="aap wrap">
<div class="acct-grid aap-grid">${story('h1')}<div class="acct-side" data-acct-inline>${accountPanels('page')}</div></div>
</section>
<section class="section"><div class="wrap">
<span class="eyebrow">The PropBetEdge network</span>
<h2 class="aap-h2">Ten sport desks. One intelligence product.</h2>
<p class="sub">${esc(PRODUCT)} covers ${SPORTS.length} sports and ${esc(PREDICTIONS.name)} for ${esc(PRICE)}. Each desk is built for how its sport works; features vary by sport.</p>
<ul class="aap-net">${SPORTS.map((s) => s.key === 'f1'
    ? `<li class="here"><span aria-current="page"><b>${esc(sportName(s))}</b><em>You are here</em></span></li>`
    : `<li><a href="${esc(s.url)}" rel="noopener"><b>${esc(sportName(s))}</b><em>${esc(s.name)} →</em></a></li>`).join('')}</ul>
<a class="aap-intel" href="${esc(PREDICTIONS.url)}" rel="noopener"><span>Intelligence product · not a sport</span><b>◆ ${esc(PREDICTIONS.name)}</b><small>${esc(PREDICTIONS_LINE)}</small></a>
</div></section>
<section class="section"><div class="wrap">
<span class="eyebrow">F1 Intelligence inside All Access</span>
<h2 class="aap-h2">What All Access adds on F1</h2>
${capsGrid(false)}
<p class="fine aap-free"><b>Free on F1 for everyone:</b> ${F1_FREE.map(esc).join(' · ')}.</p>
<p class="fine">Premium F1 data is checked on our servers against your PropBetEdge membership, never in the browser. PropBetEdge is independent and not affiliated with Formula 1, the FIA or any team.</p>
</div></section>`;
  return {
    path: LOCAL_ALL_ACCESS_PATH,
    title: 'PropBetEdge All Access on F1 Intelligence — 10 sports + Predictions, $29/month',
    description: `F1 Intelligence is one desk in the PropBetEdge network. All Access adds the full PBEcast timing tower, session replay and position graph on F1, plus ${SPORTS.filter((s) => s.key !== 'f1').map(sportName).join(', ')} and ${PREDICTIONS.name}, for ${PRICE}.`,
    body,
    section: LOCAL_ALL_ACCESS_PATH,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: 'PropBetEdge All Access on F1 Intelligence', url: `${SITE}${LOCAL_ALL_ACCESS_PATH}` }],
  };
}
