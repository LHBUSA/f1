// All Access-only F1 Race Lab shell. Premium values are never baked into this static page.
import { crumbs, jsonLdBreadcrumb, SITE } from './lib.mjs';

export function raceLabPage() {
  const body = `${crumbs([['/', 'Home'], ['/race-lab', 'Race Lab']])}
<section class="hero rl-hero"><div class="wrap">
  <span class="eyebrow">◆ PropBetEdge All Access · F1</span>
  <h1>Race Lab</h1>
  <p class="sub">The proprietary layer: next-race Circuit Fit, complete Driver DNA, form deltas, teammate gaps and championship movement in one desk.</p>
  <div class="rl-badges"><span>ALL ACCESS</span><span>SERVER VERIFIED</span><span>NO MARKET INPUT</span></div>
</div></section>
<section class="section"><div class="wrap">
  <div class="rl-mount" data-race-lab aria-live="polite">
    <div class="rl-check"><span class="eyebrow">Verified access</span><h2>Opening your Race Lab…</h2><p class="muted">Checking your PropBetEdge All Access membership.</p></div>
  </div>
</div></section>`;
  return { path:'/race-lab', title:'F1 Race Lab — Circuit Fit, Driver DNA, Form & Teammate Intelligence', description:'PropBetEdge F1 Race Lab for All Access members.', body, section:'/race-lab', bg:'data', raceLab:true, noindex:true, jsonLd:[jsonLdBreadcrumb([['/','Home'],['/race-lab','Race Lab']]),{'@context':'https://schema.org','@type':'WebPage',name:'PropBetEdge F1 Race Lab',url:`${SITE}/race-lab`}] };
}
