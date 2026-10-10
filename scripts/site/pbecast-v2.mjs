// PBEcast V2 pages: /pbecast (hub) and /pbecast/<event-id>. Free experience in the HTML; All Access surfaces are empty
// shells that fill only from server-verified endpoints (no premium values in the page).
import fs from 'node:fs';
import path from 'node:path';
import { esc, crumbs, jsonLdBreadcrumb, PROPSPORTS_F1 } from './lib.mjs';
import { buildRegistry } from '../../src/identity/registry.mjs';
import { kalshiCastMount } from './kalshi.mjs';
import { ALL_ACCESS_CHECKOUT_URL, LOCAL_ALL_ACCESS_PATH, PRICE } from '../../src/core/all-access.mjs';
import { SESSION_LABEL } from '../../src/core/normalize.mjs';

// one label table for both spellings: the projection's normalized enum (sprint_qualifying) and the f1-api live/replay
// session types (sprint-qualifying); a raw code never reaches the page
const LABEL = { ...SESSION_LABEL, 'sprint-qualifying': SESSION_LABEL.sprint_qualifying };
// GET ALL ACCESS is a purchase action: the canonical Stripe Payment Link. Informational links open /all-access.
const AA = { price: PRICE, checkout: ALL_ACCESS_CHECKOUT_URL, learn: LOCAL_ALL_ACCESS_PATH };

function geometryFor(circuitId) {
  const f = path.resolve('geometry', `${circuitId}.json`);
  if (!fs.existsSync(f)) return null;
  const g = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { slug: g.slug, length_m: g.length_m, path: g.path.filter((_, i) => i % 2 === 0), pit: g.pit, corners: g.corners, timing_line: g.timing_line, corner_numbering: g.corner_numbering, attribution: g.attribution, licence: g.licence };
}

const lock = (feature, title, copy) => `<div class="pc-lock" data-pc-locked="${feature}"><span class="kicker">All Access</span><b>${esc(title)}</b><p>${esc(copy)}</p><p class="pc-sell"><a class="pc-cta" href="${AA.checkout}" rel="noopener" data-pbe-placement="all_access_checkout" data-pc-cta="${feature}">Get All Access · ${AA.price}</a> <a class="pc-learn" href="${AA.learn}">What&#39;s included</a></p><p class="fine pc-sell">One membership: 10 sports + PropBetEdge Predictions.</p><p class="pc-checknote">Access check temporarily unavailable. Your membership is unchanged. <button type="button" data-acct-retry>Retry verified access</button></p></div>`;

export function pbecastEventPage(X, ev) {
  const circ = X.circuit[ev.circuit_id];
  const geo = geometryFor(ev.circuit_id);
  const race = ev.sessions.find((s) => s.type === 'race');
  // Kalshi main-race-winner Market Pulse under the timing tower: its own client (src/web/kalshi.js), never part of the
  // cast's data path. A grid item: under the tower on phones/tablets; under the track map beside the tower on desktop.
  const kalshiMount = kalshiCastMount(ev.id, race);
  // not live: the weekend's latest published classification (public results), labelled as such
  const lastS = [...ev.sessions].filter((s) => s.state === 'completed' && s.results?.length).at(-1);
  const fallback = lastS ? { label: LABEL[lastS.type] || lastS.type, rows: lastS.results.filter((r) => r.position).map((r) => ({ driver_id: r.driver_id, pos: r.position, status: r.status === 'classified' ? 'running' : r.status, laps: r.laps ?? null })) } : null;
  const weekendSessions = ev.sessions.map((s) => ({ id: s.id, type: s.type, label: LABEL[s.type] || s.type, state: s.state, start_utc: s.start_utc || null, time_valid: s.time_valid !== false }));
  const data = { event: { id: ev.id, name: `${ev.season} ${ev.name}`, round: ev.round, circuit_id: ev.circuit_id, circuit_name: circ?.name || null }, sessions: weekendSessions, fallback, laps_total: race?.laps_scheduled || null, session_labels: LABEL, geometry: geo, identity: buildRegistry(X, ev.season), api_public: PROPSPORTS_F1, api_private: '/pbe/f1' };
  const body = `${crumbs([['/', 'Home'], ['/pbecast', 'PBEcast'], [`/pbecast/${ev.id}`, ev.name]])}
<section class="pc-head wrap"><div><span class="eyebrow">PBEcast · Round ${ev.round} · ${esc(circ?.name || '')}</span><h1>${esc(ev.season)} ${esc(ev.name)}</h1></div>
<div class="pc-state"><span class="pc-mode" data-pc-mode>Connecting…</span><span class="pc-acct" data-pc-account>Account</span></div></section>
<section class="pc-grid wrap">
  <div class="pc-trackcol">
    <div class="pc-track">${geo ? '<canvas data-pc-canvas aria-label="Track map with each car placed by recorded timing" role="img"></canvas>' : `<section class="pc-weekend" data-pc-weekend aria-labelledby="pc-weekend-title"><div class="pc-weekend-top"><span class="kicker">Race weekend command center</span><h2 id="pc-weekend-title" data-pc-weekend-title>Checking live timing…</h2><p class="pc-weekend-next" data-pc-next-session>Loading the next session…</p></div><ol class="pc-weekend-sessions">${weekendSessions.map((s) => `<li data-pc-session-row data-state="${esc(s.state || 'scheduled')}" data-start="${esc(s.start_utc || '')}"><span>${esc(s.label)}</span><time datetime="${esc(s.start_utc || '')}" data-pc-session-time>${esc(s.start_utc || 'Time TBC')}</time></li>`).join('')}</ol><div class="pc-weekend-links"><a href="/races/${esc(ev.id)}">Race intelligence</a><a href="/circuits/${esc(ev.circuit_id)}">Circuit profile</a></div><p class="pc-weekend-mapnote">No track map for ${esc(circ?.name || 'this circuit')} yet: we have no validated track geometry, so cars are not placed on a map. Live timing still runs in the timing tower.</p></section>`}<div class="pc-hud" data-pc-hud hidden aria-live="off"><span class="pc-hud-main" data-pc-hudmain></span><span class="pc-hud-flag" data-pc-hudflag hidden></span><span class="pc-hud-gap" data-pc-gap hidden>Recording gap · cars held</span><span class="pc-hud-off" data-pc-hudoff hidden></span></div>${geo ? '<span class="pc-basis">Timing-derived track position · not GPS</span>' : ''}</div>
    <p class="fine pc-method">${geo ? `<b>Estimated position from recorded timing, not GPS.</b> Observed: each car's line crossings, recorded as they happen (a brief ring marks one). Between crossings the car is an interpolated visualization placed by elapsed time; a dimmed, dashed car is held at its last observed state (recording gap, pit or no lap-time estimate yet). Track ${esc(geo.attribution)} (${esc(geo.licence)}); timing line position estimated.` : '<b>Timing without a track map.</b> Positions, laps and status come from the timing we record; no car is placed on a map or simulated without validated track geometry.'}</p>
    <div class="pc-driver" data-pc-driver hidden></div>
  </div>
  <aside class="pc-tower" aria-label="Timing tower"><div class="pc-tower-h"><span>POS</span><span>DRIVER</span><span data-pc-premium hidden class="pc-tower-pro">GAP · INT · PITS · BEST</span><span data-pc-locked="pbecast_tower" class="pc-tower-lock"><a href="${AA.learn}" data-pc-cta="pbecast_tower">Gaps &amp; intervals · All Access</a></span></div><p class="pc-towernote" data-pc-towernote>Connecting to timing…</p><div data-pc-tower class="pc-rows${fallback ? '' : ' pc-rows--idle'}" data-rows="${Math.min(26, Math.max(18, fallback?.rows.length || 0, Object.keys(data.identity.drivers).length))}"><p class="pc-empty">${fallback ? 'Loading latest classification…' : 'No live timing yet. The tower activates when a session starts.'}</p></div></aside>
  ${kalshiMount}
</section>
<section class="wrap pc-lower">
  <div class="pc-feedcol"><h2>Race state &amp; incidents</h2><p class="fine">Flags and car status from our timing record. Causes are never inferred; a retirement is not an accident.</p><ul class="pc-feed" data-pc-feed></ul></div>
  <div class="pc-replaycol">
    <h2>Replay &amp; position history</h2><p class="fine" data-pc-recorded aria-live="polite">Checking recordings…</p>
    <div data-pc-premium hidden>
      <div class="pc-controls"><label class="sr" for="pc-sessions">Session</label><select id="pc-sessions" data-pc-sessions></select><button type="button" data-pc-play>Play</button><button type="button" data-pc-reset aria-label="Reset replay to the start">Reset</button><span class="pc-clock" data-pc-clock aria-live="off"></span><span class="pc-speeds">${[0.5, 1, 2, 4].map((s) => `<button type="button" data-pc-speed="${s}" aria-pressed="${s === 1}">${s}×</button>`).join('')}</span><span class="pc-lapnav"><button type="button" data-pc-lapprev aria-label="Previous lap">‹ Lap</button><label class="sr" for="pc-lap">Jump to lap</label><select id="pc-lap" data-pc-lapjump></select><button type="button" data-pc-lapnext aria-label="Next lap">Lap ›</button></span></div>
      <label class="sr" for="pc-jump">Jump to a recorded moment</label><select id="pc-jump" class="pc-jump" data-pc-jumpto><option>Jump to…</option></select>
      <p class="fine pc-keys">Keys: Space play/pause · ← → 10 s · [ ] lap</p>
      <label class="sr" for="pc-scrub">Replay position</label><input id="pc-scrub" type="range" min="0" max="1000" value="0" data-pc-scrub>
      <p class="fine" data-pc-coverage></p>
      <div class="pc-graphbox"><canvas data-pc-graph aria-label="Position by lap for every driver" role="img"></canvas></div>
    </div>
    ${lock('pbecast_replay', 'Replay this session and every driver’s position history', 'Scrub through the recorded session at 0.5× to 4×, jump to any lap, and follow every driver on the position graph.')}
    <form class="pc-signin" data-pc-signin data-pc-locked="pbecast_signin"><label for="pc-email">Already All Access? Sign in</label><span><input id="pc-email" name="email" type="email" required autocomplete="email" placeholder="you@example.com"><button type="submit">Email me a link</button></span><span class="fine" data-pc-signin-msg aria-live="polite"></span></form>
  </div>
</section>
<script type="application/json" id="pbecast-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
  return { path: `/pbecast/${ev.id}`, title: `${ev.season} ${ev.name} PBEcast: Live Track, Timing & Replay`, description: `PBEcast for the ${ev.season} ${ev.name}: cars placed on ${circ?.name || 'the circuit'} from recorded timing, the timing tower, race state, and All Access replay with position history.`, body, section: '/pbecast', bg: 'cast', pbecast: true, kalshi: !!kalshiMount, jsonLd: [jsonLdBreadcrumb([['/', 'Home'], ['/pbecast', 'PBEcast'], [`/pbecast/${ev.id}`, ev.name]])] };
}

export function pbecastHub(X, nextEv) {
  const evs = X.raceEvents(X.currentSeason);
  const body = `${crumbs([['/', 'Home'], ['/pbecast', 'PBEcast']])}
<section class="hero"><div class="wrap"><span class="eyebrow">PBEcast F1</span><h1>Live race intelligence</h1><p class="sub">Live timing we record ourselves: the timing tower, race state and, at circuits with a validated track map, every car placed on the circuit from that timing. All Access adds full gaps and intervals, session replay and every driver's position history.</p>${nextEv ? `<p><a class="pc-cta" href="/pbecast/${esc(nextEv.id)}">Open PBEcast: ${esc(nextEv.season)} ${esc(nextEv.name)}</a></p>` : ''}</div></section>
<section class="section"><div class="wrap"><h2>${X.currentSeason} weekends</h2><ul class="pc-hub">${evs.map((e) => `<li><a href="/pbecast/${esc(e.id)}"><span>R${e.round}</span>${esc(e.name)}</a>${fs.existsSync(path.resolve('geometry', `${e.circuit_id}.json`)) ? '<span class="pill">track map</span>' : ''}</li>`).join('')}</ul><p class="fine">Recorded timing starts with the ${X.currentSeason} Bahrain Grand Prix in Malaysia; earlier weekends show results without replay.</p></div></section>`;
  return { path: '/pbecast', title: 'PBEcast F1: Live Track Map, Timing Tower & Replay', description: 'PBEcast Formula 1: live circuit map with cars placed from recorded lap timing, timing tower, race state and All Access session replay with position history.', body, section: '/pbecast', bg: 'cast', jsonLd: [] };
}
