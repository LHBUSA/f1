// All Access-only F1 Race Lab shell. Premium metrics never enter this static HTML.
// Public, rights-cleared media metadata is embedded so the verified client can render a rich desk without a second media registry.
import { crumbs, esc, jsonLdBreadcrumb, SITE } from './lib.mjs';

const mediaFor = (ctx) => ({
  season: ctx.currentSeason,
  headshotBase: '/pbe/f1/media/headshot/',
  teams: Object.fromEntries((ctx.currentTeamIds || []).map((cid) => {
    const logo = ctx.logoFor?.(cid) || null;
    const car = ctx.carPhotoFor?.(cid, ctx.currentSeason) || null;
    const files = car?.derivatives?.files || {};
    return [cid, {
      id: cid,
      name: ctx.conById?.[cid]?.name || cid,
      color: ctx.colorOf?.(cid, ctx.currentSeason) || null,
      logo: logo?.publicPath || null,
      logoBg: logo?.bg || null,
      fallback: logo?.fallback ? logo.short : null,
      car: car ? {
        id: car.id,
        model: car.carModel || null,
        attribution: car.attribution || null,
        aspect: car.derivatives?.aspect || null,
        avif640: files['640']?.avif ? `/media/cars/${car.id}-640.avif` : null,
        avif960: files['960']?.avif ? `/media/cars/${car.id}-960.avif` : null,
        avif1280: files['1280']?.avif ? `/media/cars/${car.id}-1280.avif` : null,
        webp640: files['640']?.webp ? `/media/cars/${car.id}-640.webp` : null,
        webp960: files['960']?.webp ? `/media/cars/${car.id}-960.webp` : null,
        webp1280: files['1280']?.webp ? `/media/cars/${car.id}-1280.webp` : null,
      } : null,
    }];
  })),
});

export function raceLabPage(ctx = {}) {
  const media = esc(JSON.stringify(mediaFor(ctx)));
  const body = `${crumbs([['/', 'Home'], ['/race-lab', 'Race Lab']])}
<section class="hero rl-hero"><div class="wrap">
  <div class="rl-hero-kicker"><span class="eyebrow">◆ PropBetEdge All Access · F1</span><span class="rl-platinum">PLATINUM DESK</span></div>
  <h1>Race Lab</h1>
  <p class="sub">The proprietary F1 layer — next-race Circuit Fit, complete Driver DNA, recent form, same-car battles and championship movement, wrapped in the cars and people behind the numbers.</p>
  <div class="rl-badges"><span>ALL ACCESS</span><span>SERVER VERIFIED</span><span>NO MARKET INPUT</span><span>RIGHTS-CLEARED MEDIA</span></div>
</div></section>
<section class="section rl-shell"><div class="wrap">
  <div class="rl-mount" data-race-lab data-media="${media}" aria-live="polite">
    <div class="rl-check">
      <div class="rl-skeleton-line rl-sk-lg"></div><div class="rl-skeleton-line rl-sk-sm"></div>
      <div class="rl-skeleton-grid"><span></span><span></span><span></span></div>
      <span class="eyebrow">Verified access</span><h2>Opening your Race Lab…</h2><p class="muted">Checking your PropBetEdge All Access membership.</p>
    </div>
  </div>
  <div class="rp-mount" data-race-picks aria-live="polite"></div>
</div></section>`;
  return {
    path: '/race-lab',
    title: 'F1 Race Lab — Circuit Fit, Driver DNA, Form & Teammate Intelligence',
    description: 'PropBetEdge F1 Race Lab for All Access members: full Circuit Fit, Driver DNA, form, teammate and championship intelligence.',
    body,
    section: '/race-lab',
    bg: 'data',
    raceLab: true,
    noindex: true,
    jsonLd: [jsonLdBreadcrumb([['/', 'Home'], ['/race-lab', 'Race Lab']]), { '@context': 'https://schema.org', '@type': 'WebPage', name: 'PropBetEdge F1 Race Lab', url: `${SITE}/race-lab` }],
  };
}
