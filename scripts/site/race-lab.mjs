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

// Static shell for the picks component: complete without JS (rule + where to look), replaced by the real ledger status.
const RULE = 'Post-qualifying research picks publish only after Grand Prix qualifying is officially classified, and lock at least 10 minutes before the race. Sprint qualifying is not Grand Prix qualifying and never opens the window.';
const picksShell = (mode) => `<div class="rp-mount" data-race-picks="${mode}" aria-live="polite"><div class="rp-desk"><section class="rp-status"><span class="eyebrow">RESEARCH — not official · F1 Race Picks</span><h2>Checking the picks ledger…</h2><p class="fine">${esc(RULE)}</p><noscript><p>Race Picks status and the track record need JavaScript.</p></noscript></section></div></div>`;

const picksMethod = `<section class="section"><div class="wrap"><div class="card rp-method"><span class="eyebrow">How Race Picks work</span><h2>Locked before the race, graded after it</h2>
  <ul class="rp-teaser-list"><li><b>When:</b> one post-qualifying lock per Grand Prix, written after the official Grand Prix qualifying classification and at least 10 minutes before lights out. Sprint qualifying never opens the window.</li>
  <li><b>What:</b> top-10 and podium outlooks, teammate race head-to-heads, and race-winner model probabilities shown beside the market. Every family is labelled RESEARCH; nothing here is an official pick.</li>
  <li><b>Evidence:</b> each lock is written once to a create-only ledger, hashed (sha256) and re-verified every 10 minutes. Grades are appended as revisions after the official classification.</li>
  <li><b>Record:</b> only prospective published locks count. Historical backtests and internal shadow research never enter the record.</li>
  <li><b>Access:</b> selections and probabilities are All Access only, checked on the server. Everyone sees the status, the lock evidence and the record.</li></ul>
  <div class="rl-actions"><a class="more" href="/race-lab">Race Lab ◆</a><a class="more" href="/all-access">What All Access includes</a></div></div></div></section>`;

export function racePicksPage() {
  const body = `${crumbs([['/', 'Home'], ['/picks', 'Race Picks']])}
<section class="hero rl-hero"><div class="wrap">
  <div class="rl-hero-kicker"><span class="eyebrow">◆ PropBetEdge F1 · Race Research</span><span class="rl-platinum">RESEARCH — NOT OFFICIAL</span></div>
  <h1>Race Picks</h1>
  <p class="sub">Post-qualifying research predictions for every Grand Prix: locked after qualifying, hashed, and graded against the official classification. This weekend's status is always shown, locked or not.</p>
  <div class="rl-actions rp-entry"><a class="more" href="/track-record">Track Record</a></div>
</div></section>
<section class="section rl-shell"><div class="wrap">${picksShell('picks')}</div></section>
${picksMethod}`;
  return {
    path: '/picks',
    title: 'F1 Race Picks — Post-Qualifying Research Predictions',
    description: 'PropBetEdge F1 Race Picks: post-qualifying research predictions locked before each Grand Prix and graded after it, with live lock status and a permanent track record.',
    body,
    section: '/picks',
    bg: 'data',
    racePicks: true,
    jsonLd: [jsonLdBreadcrumb([['/', 'Home'], ['/picks', 'Race Picks']])],
  };
}

export function trackRecordPage() {
  const body = `${crumbs([['/', 'Home'], ['/track-record', 'Track Record']])}
<section class="hero rl-hero"><div class="wrap">
  <div class="rl-hero-kicker"><span class="eyebrow">◆ PropBetEdge F1 · Race Research</span><span class="rl-platinum">PROSPECTIVE ONLY</span></div>
  <h1>Track Record</h1>
  <p class="sub">Every published F1 research lock — wins, losses, voids and pending — with its model version, lock time and sha256. Backtests never count.</p>
  <div class="rl-actions rp-entry"><a class="more" href="/picks">Race Picks</a></div>
</div></section>
<section class="section rl-shell"><div class="wrap">${picksShell('record')}</div></section>
${picksMethod}`;
  return {
    path: '/track-record',
    title: 'F1 Race Picks Track Record — Wins, Losses, Voids & Lock Evidence',
    description: 'The permanent prospective track record of PropBetEdge F1 research picks: W/L/VOID/PENDING by family and version, scores, and sha256 lock evidence.',
    body,
    section: '/track-record',
    bg: 'data',
    racePicks: true,
    jsonLd: [jsonLdBreadcrumb([['/', 'Home'], ['/track-record', 'Track Record']])],
  };
}

export function raceLabPage(ctx = {}) {
  const media = esc(JSON.stringify(mediaFor(ctx)));
  const body = `${crumbs([['/', 'Home'], ['/race-lab', 'Race Lab']])}
<section class="hero rl-hero"><div class="wrap">
  <div class="rl-hero-kicker"><span class="eyebrow">◆ PropBetEdge All Access · F1</span><span class="rl-platinum">PLATINUM DESK</span></div>
  <h1>Race Lab</h1>
  <p class="sub">The proprietary F1 layer — next-race Circuit Fit, complete Driver DNA, recent form, same-car battles and championship movement, wrapped in the cars and people behind the numbers.</p>
  <div class="rl-badges"><span>ALL ACCESS</span><span>SERVER VERIFIED</span><span>NO MARKET INPUT</span><span>RIGHTS-CLEARED MEDIA</span></div>
  <div class="rl-actions rp-entry"><a class="pc-cta" href="/picks">Race Picks</a><a class="more" href="/track-record">Track Record</a></div>
</div></section>
<section class="section rl-shell"><div class="wrap">
  <div class="rl-mount" data-race-lab data-media="${media}" aria-live="polite">
    <div class="rl-check">
      <div class="rl-skeleton-line rl-sk-lg"></div><div class="rl-skeleton-line rl-sk-sm"></div>
      <div class="rl-skeleton-grid"><span></span><span></span><span></span></div>
      <span class="eyebrow">Verified access</span><h2>Opening your Race Lab…</h2><p class="muted">Checking your PropBetEdge All Access membership.</p>
    </div>
  </div>
  ${picksShell('picks')}
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
