// PBEcast V2 client. Free: live track (moving cars from recorded timing), basic tower, major race state.
// All Access (server-enforced): full tower, replay, scrubber, position graph, full feed. The browser never decides
// entitlement: premium data only arrives from endpoints that verified the network session.
import { buildModel, progressAt, frameAt, positionHistory, inGap, lapAt } from './progress.js';
import { layoutLabels, clusters, FAN_MIN } from './track-labels.js';
import { accountView, ACCOUNT_LABEL } from './account-view.js';

const D = JSON.parse(document.getElementById('pbecast-data').textContent);
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const ID = D.identity, TEAM = (id) => ID.teams[ID.drivers[id]?.team] || null;
const track = D.geometry;
const S = { mode: 'idle', frames: [], model: null, T: 0, playing: false, speed: 1, selected: new URLSearchParams(location.search).get('driver'), hover: null, focusAt: 0, sessionType: null, offTrack: [], entitled: false, signedIn: false, session: null, tower: [], events: [], lastOk: 0, failures: 0, polls: 0, live: 'unknown', polling: false, recorded: null };
const ga = (name, params) => { try { window.gtag?.('event', name, { sport: 'f1', ...params }); } catch {} };

// ---------- network ----------
async function getJSON(url, { priv = false } = {}) {
  const r = await fetch(url, { credentials: priv ? 'same-origin' : 'omit', cache: 'no-store', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const PUB = D.api_public, PRIV = D.api_private;

// ---------- track geometry ----------
let pts = [], cum = [], L = 1;
if (track) {
  pts = track.path; cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  L = cum.at(-1) + Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]);
}
function along(frac) {
  let s = (((frac % 1) + 1) % 1) * L, i = 0;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= s) lo = m; else hi = m - 1; }
  i = lo;
  const a = pts[i], b = pts[(i + 1) % pts.length], seg = (i + 1 < cum.length ? cum[i + 1] : L) - cum[i] || 1, k = (s - cum[i]) / seg;
  const x = a[0] + (b[0] - a[0]) * k, y = a[1] + (b[1] - a[1]) * k, len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { x, y, nx: -(b[1] - a[1]) / len, ny: (b[0] - a[0]) / len };
}

// ---------- canvas ----------
// Presentation only. Every car is drawn exactly at its timing-derived point on the track centreline (no lateral
// offsets: we do not know a car's lateral position). Labels live in their own layer (track-labels.mjs) and may move
// away from the car with a leader line; dense packs fan their labels outward and draw compact markers on track.
const cv = $('[data-pc-canvas]'), ctx = cv?.getContext('2d');
let view = null, layer = null, blocks = [], staticBlocks = [], blocksDirty = true, center = null, trackPx = [];
const FONT = '"Barlow Condensed", sans-serif';
function fit() {
  if (!cv || !track) return;
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const xs = pts.map((p) => p[0]).concat((track.pit || []).map((p) => p[0])), ys = pts.map((p) => p[1]).concat((track.pit || []).map((p) => p[1]));
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  // room for the HUD (top) and the method badge (bottom); the circuit fills the rest of the panel
  const narrow = r.width < 560, padX = (narrow ? 26 : 40) * dpr, padT = (narrow ? 40 : 46) * dpr, padB = (narrow ? 34 : 38) * dpr;
  const k = Math.min((cv.width - 2 * padX) / (maxx - minx), (cv.height - padT - padB) / (maxy - miny));
  const ox = (cv.width - (maxx - minx) * k) / 2, oy = padT + (cv.height - padT - padB - (maxy - miny) * k) / 2;
  view = { dpr, k, P: (x, y) => [ox + (x - minx) * k, oy + (maxy - y) * k], narrow };
  center = { x: ox + ((maxx - minx) * k) / 2, y: oy + ((maxy - miny) * k) / 2 };
  trackPx = Array.from({ length: 600 }, (_, i) => { const a = along(i / 600); const [x, y] = view.P(a.x, a.y); return [x / dpr, y / dpr]; });
  layer = document.createElement('canvas'); layer.width = cv.width; layer.height = cv.height; staticBlocks = [];
  const g = layer.getContext('2d');
  const line = (arr, close) => { g.beginPath(); arr.forEach((p, i) => { const [x, y] = view.P(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); if (close) g.closePath(); };
  const tw = Math.max(9, Math.min(15, Math.min(cv.width, cv.height) / dpr / 34)) * dpr; // track width scales with the panel
  g.lineJoin = 'round'; g.lineCap = 'round';
  // pit lane: its own colour, dashed, labelled — distinct from the racing line
  if (track.pit?.length > 1) {
    g.strokeStyle = '#0d1017'; g.lineWidth = tw * 0.62; line(track.pit); g.stroke();
    g.setLineDash([5 * dpr, 4 * dpr]); g.strokeStyle = 'rgba(122,190,255,.55)'; g.lineWidth = 2 * dpr; line(track.pit); g.stroke(); g.setLineDash([]);
    const mid = track.pit[Math.floor(track.pit.length / 2)], [px, py] = view.P(mid[0], mid[1]);
    halo(g, 'PIT', px, py - 10 * dpr, `700 ${9 * dpr}px ${FONT}`, 'rgba(122,190,255,.85)', dpr);
    staticBlocks.push(textBox(g, 'PIT', px, py - 10 * dpr, 'center', dpr));
  }
  // circuit: one restrained glow, dark kerb edge, asphalt, thin centre accent
  g.shadowColor = 'rgba(255,77,46,.16)'; g.shadowBlur = 8 * dpr; g.strokeStyle = '#0d1017'; g.lineWidth = tw + 6 * dpr; line(pts, true); g.stroke(); g.shadowBlur = 0;
  g.strokeStyle = '#2c3343'; g.lineWidth = tw; line(pts, true); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1 * dpr; line(pts, true); g.stroke();
  // start/finish: chequered band across the track at the (estimated) timing line
  const t0 = along(0), [tx, ty] = view.P(t0.x, t0.y), nx = t0.nx, ny = -t0.ny, txd = -ny, tyd = nx; // screen normal + tangent
  const half = tw / 2 + 2 * dpr, cells = 6, cs = (2 * half) / cells;
  for (let row = 0; row < 2; row++) for (let i = 0; i < cells; i++) {
    g.fillStyle = (i + row) % 2 ? '#0b0d12' : '#f2f4f8';
    const cx0 = tx + nx * (-half + i * cs) + txd * (row - 1) * cs, cy0 = ty + ny * (-half + i * cs) + tyd * (row - 1) * cs;
    g.beginPath(); g.moveTo(cx0, cy0); g.lineTo(cx0 + nx * cs, cy0 + ny * cs); g.lineTo(cx0 + nx * cs + txd * cs, cy0 + ny * cs + tyd * cs); g.lineTo(cx0 + txd * cs, cy0 + tyd * cs); g.closePath(); g.fill();
  }
  const side = (tx - center.x) * nx + (ty - center.y) * ny >= 0 ? 1 : -1;
  g.textAlign = side * nx >= 0 ? 'left' : 'right';
  const sfx = tx + nx * side * (half + 8 * dpr), sfy = ty + ny * side * (half + 8 * dpr);
  halo(g, 'START / FINISH (EST.)', sfx, sfy, `700 ${9.5 * dpr}px ${FONT}`, 'rgba(242,244,248,.85)', dpr);
  staticBlocks.push(textBox(g, 'START / FINISH (EST.)', sfx, sfy, g.textAlign, dpr));
  g.textAlign = 'center';
  // corners: numbers only, quiet
  for (const c of track.corners || []) { if (!c.n) continue; const [x, y] = view.P(c.x, c.y); halo(g, String(c.n), x + 7 * dpr, y - 7 * dpr, `600 ${8.5 * dpr}px ${FONT}`, 'rgba(198,204,217,.38)', dpr); }
  g.textAlign = 'start';
  blocksDirty = true;
}
// painted map text is a no-go zone for driver labels
function textBox(g, txt, x, y, align, dpr) { const w = g.measureText(txt).width, h = 11 * dpr; return { x: align === 'center' ? x - w / 2 : align === 'right' ? x - w : x, y: y - h / 2, w, h }; }
function halo(g, txt, x, y, font, color, dpr, w = 3) {
  g.font = font; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.strokeStyle = 'rgba(7,8,12,.92)'; g.lineWidth = w * dpr; g.strokeText(txt, x, y);
  g.fillStyle = color; g.fillText(txt, x, y);
}
// DOM overlays on the canvas (HUD, method badge) are no-go zones for labels
function measureBlocks() {
  if (!cv || !view) return;
  const cr = cv.getBoundingClientRect(), d = view.dpr;
  blocks = [...cv.parentElement.querySelectorAll('.pc-hud>span:not([hidden]), .pc-basis')].filter((n) => !n.closest('[hidden]'))
    .map((n) => n.getBoundingClientRect()).filter((b) => b.width && b.height).map((b) => ({ x: (b.left - cr.left) * d, y: (b.top - cr.top) * d, w: b.width * d, h: b.height * d })).concat(staticBlocks);
  blocksDirty = false;
}

// Car glyph (top-down, facing +x in local space): team-colour body, black tyres, wings, dark cockpit.
function carGlyph(g, x, y, ang, color, sc, { held }) {
  g.save(); g.translate(x, y); g.rotate(ang); g.scale(sc, sc);
  g.fillStyle = '#0b0d12';
  for (const [tx, ty] of [[6.5, 4.6], [6.5, -4.6], [-6.5, 4.8], [-6.5, -4.8]]) g.fillRect(tx - 2.2, ty - 1.4, 4.4, 2.8);
  const body = () => { g.beginPath(); g.moveTo(11, 0); g.lineTo(5, 1.6); g.lineTo(1, 3.6); g.lineTo(-7, 3.4); g.lineTo(-9, 1.8); g.lineTo(-9, -1.8); g.lineTo(-7, -3.4); g.lineTo(1, -3.6); g.lineTo(5, -1.6); g.closePath(); };
  g.fillStyle = color; body(); g.fill();
  g.fillRect(9.4, -5.2, 1.6, 10.4);            // front wing
  g.fillRect(-11, -4.6, 2, 9.2);               // rear wing
  g.fillStyle = 'rgba(8,10,14,.85)'; g.beginPath(); g.ellipse(-0.6, 0, 2.3, 1.4, 0, 0, 7); g.fill();
  g.lineWidth = 0.8; g.strokeStyle = held ? 'rgba(255,207,92,.95)' : 'rgba(0,0,0,.65)';
  if (held) g.setLineDash([2, 1.5]);
  body(); g.stroke(); g.setLineDash([]);
  g.restore();
}
// compact pack marker: team dot with a heading tick (cars in a dense pack)
function packMarker(g, x, y, ang, color, dpr, { held }) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.fillStyle = color; g.strokeStyle = held ? 'rgba(255,207,92,.95)' : 'rgba(7,8,12,.95)'; g.lineWidth = 1.4 * dpr;
  if (held) g.setLineDash([2 * dpr, 1.5 * dpr]);
  g.beginPath(); g.moveTo(6 * dpr, 0); g.lineTo(-3.5 * dpr, 3.6 * dpr); g.lineTo(-3.5 * dpr, -3.6 * dpr); g.closePath(); g.fill(); g.stroke();
  g.restore();
}

// Display easing (visual only): cars glide to the timing-derived target instead of jumping when live timing corrects.
// The model position (progressAt) is untouched and is what the QA hook reports; scrubs/lap jumps snap.
const disp = new Map(), labelPrev = new Map();
let lastDrawT = null, lastDrawAt = 0;
function eased(id, target, T) {
  const now = performance.now(), dt = Math.min(250, now - lastDrawAt || 16);
  const jumped = lastDrawT != null && Math.abs(T - lastDrawT) > 5000 * (S.speed || 1) + 2000;
  const cur = disp.get(id);
  if (cur == null || jumped || Math.abs(target - cur) > 0.25) { disp.set(id, target); return target; }
  const tau = S.mode === 'live' ? 600 : 90;
  const v = cur + (target - cur) * (1 - Math.exp(-dt / tau));
  disp.set(id, v); return v;
}
const isSel = (id) => !!S.selected && (ID.drivers[id]?.code === S.selected || id === S.selected);
const isHov = (id) => !!S.hover && ID.drivers[id]?.code === S.hover;
const surname = (id) => (ID.drivers[id]?.name || '').split(' ').slice(-1)[0].toUpperCase();

function drawCars(T) {
  if (!ctx || !layer) return;
  if (blocksDirty) measureBlocks();
  ctx.clearRect(0, 0, cv.width, cv.height);
  const f = S.model ? frameAt(S.model, T) : null;
  const gap = !!(S.model && inGap(S.model, T));
  ctx.globalAlpha = gap ? 0.55 : 1; ctx.drawImage(layer, 0, 0); ctx.globalAlpha = 1;
  const flag = f?.flag ? String(f.flag).toUpperCase() : '';
  cv.dataset.flag = /RED/.test(flag) ? 'red' : /SAFETY|SC|VSC|YELLOW/.test(flag) ? 'caution' : '';
  if (!f) { lastDrawT = T; lastDrawAt = performance.now(); window.__pbecast = { T, mode: S.mode, session: S.session, cars: [], unplaced: 0, selected: S.selected, hover: S.hover, layout: null }; return; }
  const dpr = view.dpr, placed = [];
  const order = [...f.cars].filter((c) => ID.drivers[c.id]).sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99));
  const unplaced = [];
  for (const c of order) {
    const p = progressAt(S.model, c.id, T, { live: S.mode === 'live' });
    if (!p || p.state === 'out') continue;
    if (p.state === 'unplaced') { unplaced.push(c); continue; }
    const m = S.model.cars.get(c.id), lastX = m && [...m.crossings].reverse().find((x) => x.ms <= T);
    placed.push({ c, frac: p.laps, held: p.state === 'held', crossedAgo: lastX ? T - lastX.ms : null });
  }
  // opening lap: running order at the line, spaced back, until each car's first observed crossing
  // after that, a car with no placement (pit / garage / overdue) is not drawn on track: the HUD counts it instead
  const opening = f.lap <= 1 || !f.lap;
  if (opening) unplaced.forEach((c, i) => placed.push({ c, frac: -((i + 1) * 14) / L, held: true, grid: true }));
  S.offTrack = opening ? [] : unplaced.map((c) => c.id);
  // exact screen point on the centreline for each car (eased fraction; no lateral offset)
  const cars = placed.map((it) => {
    const id = it.c.id, fr = it.grid ? it.frac : eased(id, it.frac, T);
    const a = along(fr), a2 = along(fr + 0.0015);
    const [x, y] = view.P(a.x, a.y), [x2, y2] = view.P(a2.x, a2.y);
    const t = TEAM(id);
    return { it, id, x, y, ang: Math.atan2(y2 - y, x2 - x), color: `#${t?.color || '888'}`, sel: isSel(id), hov: isHov(id), leader: it.c.pos === 1, code: ID.drivers[id]?.code || '' };
  });
  // dense packs draw compact markers; the selected car always keeps its full glyph
  const packs = clusters(cars, 22 * dpr);
  for (const g of packs) if (g.length >= FAN_MIN) for (const i of g) cars[i].compact = true;
  const anySel = cars.some((c) => c.sel);
  for (const c of cars) {
    c.sc = (c.sel ? 2.05 : 1.28) * dpr;                     // selected 1.6x
    c.r = c.sel ? 17 * dpr : c.compact ? 6 * dpr : 10 * dpr; // no-cover radius for labels
    ctx.font = `${c.sel ? 800 : 700} ${(c.sel ? 12.5 : 10.5) * dpr}px ${FONT}`;
    c.text = c.sel ? `${c.leader ? 'P1 ' : ''}${c.code}` : `${c.leader ? 'P1 ' : ''}${c.code}`;
    c.sub = c.sel ? surname(c.id) : '';
    const w1 = ctx.measureText(c.text).width;
    let w2 = 0; if (c.sub) { ctx.font = `600 ${10.5 * dpr}px ${FONT}`; w2 = ctx.measureText(c.sub).width + 5 * dpr; }
    c.lw = w1 + w2 + (c.sel || c.hov ? 14 : 8) * dpr; c.lh = (c.sel ? 20 : 14) * dpr;
  }
  const lab = layoutLabels(cars.map((c) => ({ id: c.id, x: c.x, y: c.y, r: c.r, w: c.lw, h: c.lh, prio: c.sel ? -2 : c.hov ? -1 : c.it.c.pos ?? 99, prev: labelPrev.get(c.id) })),
    { bounds: { x0: 3 * dpr, y0: 3 * dpr, x1: cv.width - 3 * dpr, y1: cv.height - 3 * dpr }, blocks, center, cluster: 22 * dpr });
  labelPrev.clear();
  for (const [id, l] of lab) { const c = cars.find((x) => x.id === id); labelPrev.set(id, { dx: l.cx - c.x, dy: l.cy - c.y }); }
  // short trail behind moving cars (derived state only)
  for (const c of cars) {
    if (c.it.grid || c.it.held || c.compact) continue;
    ctx.strokeStyle = `${c.color}38`; ctx.lineWidth = 3 * dpr; ctx.lineCap = 'round'; ctx.beginPath();
    const fr = disp.get(c.id) ?? c.it.frac;
    for (let k = 0; k <= 6; k++) { const bb = along(fr - (k * 0.004)); const [bx, by] = view.P(bb.x, bb.y); k ? ctx.lineTo(bx, by) : ctx.moveTo(bx, by); }
    ctx.stroke();
  }
  // leader lines (label displaced from its car)
  for (const c of cars) {
    const l = lab.get(c.id); if (!l?.leader) continue;
    const ex = Math.max(l.x, Math.min(c.x, l.x + l.w)), ey = Math.max(l.y, Math.min(c.y, l.y + l.h));
    const d = Math.hypot(ex - c.x, ey - c.y) || 1, sx = c.x + ((ex - c.x) / d) * c.r * 0.7, sy = c.y + ((ey - c.y) / d) * c.r * 0.7;
    ctx.globalAlpha = c.it.held ? 0.45 : anySel && !c.sel && !c.hov ? 0.55 : 0.9;
    ctx.strokeStyle = c.sel ? 'rgba(255,255,255,.85)' : c.hov ? 'rgba(255,255,255,.75)' : 'rgba(198,204,217,.5)'; ctx.lineWidth = (c.sel ? 1.4 : 1) * dpr;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.fillStyle = c.color; ctx.beginPath(); ctx.arc(sx, sy, 1.6 * dpr, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // cars: back-markers first; leader, hovered and selected on top
  const z = (c) => (c.sel ? 3 : c.hov ? 2 : c.leader ? 1 : 0);
  const drawOrder = [...cars].sort((a, b) => z(a) - z(b) || (b.it.c.pos ?? 99) - (a.it.c.pos ?? 99));
  const now = performance.now();
  for (const c of drawOrder) {
    ctx.globalAlpha = c.it.held ? 0.5 : anySel && !c.sel && !c.hov ? 0.78 : 1;
    if (c.sel) { // halo + ring: the star of the map
      const gr = ctx.createRadialGradient(c.x, c.y, 2 * dpr, c.x, c.y, 30 * dpr); gr.addColorStop(0, `${c.color}66`); gr.addColorStop(1, `${c.color}00`);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(c.x, c.y, 30 * dpr, 0, 7); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6 * dpr; ctx.beginPath(); ctx.arc(c.x, c.y, 19 * dpr, 0, 7); ctx.stroke();
      if (S.focusAt && now - S.focusAt < 1100) { const k = (now - S.focusAt) / 1100; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.arc(c.x, c.y, (19 + 34 * k) * dpr, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
    } else if (c.hov) { ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1.2 * dpr; ctx.beginPath(); ctx.arc(c.x, c.y, (c.compact ? 8 : 13) * dpr, 0, 7); ctx.stroke(); }
    if (c.compact && !c.sel) packMarker(ctx, c.x, c.y, c.ang, c.color, dpr, { held: c.it.held });
    else carGlyph(ctx, c.x, c.y, c.ang, c.color, c.sc, { held: c.it.held });
    if (c.leader && !c.sel) { ctx.strokeStyle = 'rgba(255,207,92,.9)'; ctx.lineWidth = 1.2 * dpr; ctx.beginPath(); ctx.arc(c.x, c.y, (c.compact ? 7.5 : 12) * dpr, 0, 7); ctx.stroke(); }
    // an OBSERVED crossing (real recorded event) within the last 2 s gets a brief ring
    if (c.it.crossedAgo != null && c.it.crossedAgo < 2000) { ctx.globalAlpha = 0.7 * (1 - c.it.crossedAgo / 2000); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1 * dpr; ctx.beginPath(); ctx.arc(c.x, c.y, 14 * dpr, 0, 7); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  // labels: plain code with a dark halo; hovered = light plate; selected = plate with team stripe + surname
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  for (const c of drawOrder) {
    const l = lab.get(c.id); if (!l) continue;
    ctx.globalAlpha = c.it.held ? 0.55 : anySel && !c.sel && !c.hov ? 0.7 : 1;
    const my = l.y + l.h / 2;
    if (c.sel || c.hov) {
      ctx.fillStyle = c.sel ? 'rgba(8,10,14,.94)' : 'rgba(8,10,14,.85)'; ctx.beginPath(); ctx.roundRect(l.x, l.y, l.w, l.h, 3 * dpr); ctx.fill();
      ctx.strokeStyle = c.sel ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.3)'; ctx.lineWidth = 1 * dpr; ctx.stroke();
      ctx.fillStyle = c.color; ctx.fillRect(l.x, l.y, 3 * dpr, l.h);
    } else { ctx.fillStyle = c.color; ctx.fillRect(l.x + 1 * dpr, my - 4 * dpr, 2 * dpr, 8 * dpr); }
    let x = l.x + (c.sel || c.hov ? 7 : 5) * dpr;
    ctx.font = `${c.sel ? 800 : 700} ${(c.sel ? 12.5 : 10.5) * dpr}px ${FONT}`;
    const parts = c.leader ? [['P1 ', '#ffcf5c'], [c.code, c.sel ? '#ffffff' : '#eef0f4']] : [[c.code, c.sel ? '#ffffff' : '#eef0f4']];
    for (const [txt, col] of parts) {
      if (!(c.sel || c.hov)) { ctx.strokeStyle = 'rgba(7,8,12,.92)'; ctx.lineWidth = 3 * dpr; ctx.lineJoin = 'round'; ctx.strokeText(txt, x, my + 0.5 * dpr); }
      ctx.fillStyle = col; ctx.fillText(txt, x, my + 0.5 * dpr); x += ctx.measureText(txt).width;
    }
    if (c.sub) { ctx.font = `600 ${10.5 * dpr}px ${FONT}`; ctx.fillStyle = 'rgba(230,233,239,.8)'; ctx.fillText(c.sub, x + 5 * dpr, my + 0.5 * dpr); }
  }
  ctx.globalAlpha = 1; ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  lastDrawT = T; lastDrawAt = now;
  S.hit = cars.map((c) => { const l = lab.get(c.id); return { id: c.id, x: c.x / dpr, y: c.y / dpr, r: Math.max(12, c.r / dpr), label: l && { x: l.x / dpr, y: l.y / dpr, w: l.w / dpr, h: l.h / dpr } }; });
  // QA hook: the exact race state on screen (MODEL track fraction + state per car), comparable across widths,
  // plus the presentation layout (CSS px) so visual QA can prove no overlaps / no off-canvas / no lateral offsets
  window.__pbecast = {
    T, mode: S.mode, session: S.session, selected: S.selected, hover: S.hover, gap,
    cars: cars.map((c) => ({ id: c.id, frac: Math.round(c.it.frac * 1e6) / 1e6, held: !!c.it.held, grid: !!c.it.grid })).sort((a, b) => a.id.localeCompare(b.id)),
    unplaced: S.offTrack.length, offTrack: S.offTrack,
    layout: { w: cv.width / dpr, h: cv.height / dpr, track: trackPx, blocks: blocks.map((b) => ({ x: b.x / dpr, y: b.y / dpr, w: b.w / dpr, h: b.h / dpr })),
      cars: cars.map((c) => ({ id: c.id, code: c.code, x: c.x / dpr, y: c.y / dpr, r: c.r / dpr, compact: !!c.compact, sel: c.sel, hov: c.hov })),
      labels: [...lab].map(([id, l]) => ({ id, x: l.x / dpr, y: l.y / dpr, w: l.w / dpr, h: l.h / dpr, leader: l.leader, fan: l.fan, forced: l.forced })) },
  };
}
function pick(clientX, clientY) {
  if (!S.hit || !cv) return null;
  const r = cv.getBoundingClientRect(), x = clientX - r.left, y = clientY - r.top;
  const lab = S.hit.find((h) => h.label && x >= h.label.x && x <= h.label.x + h.label.w && y >= h.label.y && y <= h.label.y + h.label.h);
  if (lab) return lab.id;
  const near = S.hit.map((h) => ({ ...h, d: Math.hypot(h.x - x, h.y - y) })).sort((a, b) => a.d - b.d)[0];
  return near && near.d < Math.max(14, near.r) ? near.id : null;
}

// ---------- off-session weekend context ----------
const fmtSessionTime = (iso) => {
  if (!iso) return 'Time TBC';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'Time TBC';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);
};
// The page's single source of state: S.mode (live | replay | idle) plus S.live, what the live status endpoint last said
// (unknown | live | none | unavailable). Every banner derives from these, so the circuit panel can never say "no
// session live" beside live frames, and an unreachable source is never presented as "no session".
function applyState() {
  const title = $('[data-pc-weekend-title]');
  const head = S.mode === 'live' ? `${sessionLabel() || 'Session'} is live` : S.live === 'unavailable' ? 'Live status unavailable · retrying' : S.live === 'unknown' ? 'Checking live timing…' : 'No session live right now';
  if (title && title.textContent !== head) title.textContent = head;
  const rec = $('[data-pc-recorded]');
  if (rec) {
    const txt = S.mode === 'live' ? `Recording live · ${S.frames.length} timing frame${S.frames.length === 1 ? '' : 's'} received${S.frames.at(-1)?.t ? ` · latest frame ${new Date(S.frames.at(-1).t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : ''}`
      : S.recorded === 'unavailable' ? 'Recording status unavailable right now · retrying'
      : S.recorded == null ? 'Checking recordings…'
      : S.recorded ? `${S.recorded} recorded session${S.recorded > 1 ? 's' : ''} this weekend` : 'No verified recording for this weekend yet.';
    if (rec.textContent !== txt) rec.textContent = txt;
  }
  renderWeekendContext();
}
function renderWeekendContext() {
  const box = $('[data-pc-weekend]');
  if (!box) return;
  const now = Date.now();
  const sessions = (D.sessions || []).map((x) => ({ ...x, t: Date.parse(x.start_utc || '') })).filter((x) => Number.isFinite(x.t));
  const next = sessions.find((x) => x.t > now && x.state !== 'completed');
  const nextEl = $('[data-pc-next-session]');
  const liveRow = S.mode === 'live' ? sessions.find((x) => S.sessionType && (x.type === S.sessionType || x.type === S.sessionType.replace('-', '_'))) : null;
  document.querySelectorAll('[data-pc-session-row]').forEach((row) => row.classList.toggle('is-live', !!liveRow && Date.parse(row.dataset.start || '') === liveRow.t));
  if (nextEl && liveRow) { nextEl.textContent = `Live now: ${liveRow.label}${next ? ` · next: ${next.label} · ${fmtSessionTime(next.start_utc)}` : ''}`; }
  else if (nextEl) nextEl.textContent = next ? `Next: ${next.label} · ${fmtSessionTime(next.start_utc)}` : (D.fallback ? 'Weekend sessions complete · latest classification shown in the timing tower.' : 'Session schedule is not available yet.');
  document.querySelectorAll('[data-pc-session-row]').forEach((row) => {
    const t = Date.parse(row.dataset.start || '');
    row.classList.toggle('is-next', !!next && Number.isFinite(t) && t === next.t);
    const tm = row.querySelector('[data-pc-session-time]'); if (tm) tm.textContent = Number.isFinite(t) ? fmtSessionTime(row.dataset.start) : 'Time TBC';
  });
}

// ---------- tower ----------
// statuses that mean the car is circulating (on_track = upstream STATUS_ON_TRACK, not mapped by the recorder)
const RUNNING = new Set(['running', 'classified', 'on_track']);
// position at the first recorded frame of the session (for "gained / lost since the start"; only from our frames)
function startPos(id) { const f0 = S.model?.frames?.[0]; return f0 ? f0.cars?.find((c) => c.id === id)?.pos ?? null : null; }
const fmtGap = (ms) => (ms == null ? '' : ms >= 60000 ? `+${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}` : `+${(ms / 1000).toFixed(3)}`);
const fmtLap = (ms) => (ms ? `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}` : '');
// what the tower is showing, always stated: replay / live / latest published classification (never "no session live"
// above replay-derived rows)
const sessionLabel = () => (S.sessionType ? D.session_labels[S.sessionType] || S.sessionType : '');
function renderContext(T) {
  const n = $('[data-pc-towernote]');
  if (!n) return;
  const lap = S.model ? lapAt(S.model, T) : null;
  let state = 'idle', head = '', rest = '';
  if (S.mode === 'replay' && S.model) { state = 'replay'; head = 'Replay'; rest = [sessionLabel(), 'Recorded timing', lap ? `Lap ${lap}` : ''].filter(Boolean).join(' · '); }
  else if (S.mode === 'live') { state = 'live'; head = 'Live'; rest = [sessionLabel(), 'Timing as recorded', lap ? `Lap ${lap}` : ''].filter(Boolean).join(' · '); }
  else if (S.ended && S.model) rest = `${S.ended} ended · final recorded timing (classification follows once published)`;
  else { const why = S.live === 'unavailable' ? 'Live status unavailable · retrying' : S.live === 'unknown' ? 'Checking live timing' : 'No session live'; rest = D.fallback ? `${why} · latest published classification: ${D.fallback.label}` : why; }
  const key = `${state}|${head}|${rest}`;
  if (n.dataset.key === key) return;
  n.dataset.key = key; n.dataset.state = state;
  n.replaceChildren(...(head ? [el('b', null, head), document.createTextNode(` · ${rest}`)] : [document.createTextNode(rest)]));
}
function markHover() { document.querySelectorAll('.pc-row').forEach((r) => r.classList.toggle('is-hover', !!S.hover && r.dataset.code === S.hover)); }
// rows are kept as stable elements keyed by driver code and only rewritten when their content changes, so a click
// is never lost to the once-a-second refresh
const rowEls = new Map();
function renderTower(T) {
  renderContext(T);
  const body = $('[data-pc-tower]');
  if (!body) return;
  const f = S.model ? frameAt(S.model, T) : null;
  const rows = f ? [...f.cars].filter((c) => ID.drivers[c.id]).sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99)) : S.tower;
  body.classList.toggle('pc-rows--idle', !rows.length);
  if (!rows.length) {
    const msg = S.mode === 'idle' ? 'No live timing yet. The tower activates when a session starts.' : 'Waiting for timing…';
    if (body.children.length !== 1 || !body.firstElementChild?.classList.contains('pc-empty') || body.firstElementChild.textContent !== msg) body.replaceChildren(el('p', 'pc-empty', msg));
    return;
  }
  const want = rows.map((c, i) => {
    const d = ID.drivers[c.id || c.driver_id], t = TEAM(c.id || c.driver_id);
    const out = c.status && !RUNNING.has(c.status);
    const b = el('button', `pc-row tc-${(t?.color || '').toLowerCase()}${c.pos === 1 ? ' is-leader' : ''}${out ? ' is-out' : ''}`); b.type = 'button';
    b.setAttribute('aria-pressed', String(d?.code === S.selected)); b.dataset.code = d?.code || '';
    const start = startPos(c.id || c.driver_id), mv = start != null && c.pos != null ? start - c.pos : null;
    b.append(el('span', 'pc-pos', String(c.pos ?? '–')), el('span', 'pc-stripe'), Object.assign(el('span', 'pc-team', t?.short || ''), { title: t?.name || '' }), el('span', 'pc-code', d?.code || '?'),
      Object.assign(el('span', `pc-mv ${mv > 0 ? 'up' : mv < 0 ? 'down' : ''}`, mv ? `${mv > 0 ? '↑' : '↓'}${Math.abs(mv)}` : ''), { title: mv ? `${mv > 0 ? 'Gained' : 'Lost'} ${Math.abs(mv)} since the start of this session` : '' }));
    const status = c.status && !RUNNING.has(c.status) ? { retired: 'OUT', disqualified: 'DSQ', dns: 'DNS', not_classified: 'NC' }[c.status] || c.status.toUpperCase() : '';
    if (S.entitled) {
      const prev = rows[i - 1];
      const iv = c.gap_ms != null && prev?.gap_ms != null ? c.gap_ms - prev.gap_ms : null;
      b.append(el('span', 'pc-num', i === 0 ? `L${c.laps ?? ''}` : c.gap_laps ? `+${c.gap_laps}L` : fmtGap(c.gap_ms)), el('span', 'pc-num pc-iv', i === 0 ? '' : fmtGap(iv)), el('span', 'pc-num', c.pits != null ? String(c.pits) : ''), el('span', 'pc-num', fmtLap(c.best_ms)));
    } else b.append(el('span', 'pc-num', c.laps != null ? `L${c.laps}` : ''));
    b.append(el('span', 'pc-status', status));
    const key = `${b.className}|${b.getAttribute('aria-pressed')}|${b.innerHTML}`, code = b.dataset.code || `#${i}`;
    let cur = rowEls.get(code);
    if (!cur) { cur = b; rowEls.set(code, cur); }
    else if (cur._k !== key) { cur.className = b.className; cur.setAttribute('aria-pressed', b.getAttribute('aria-pressed')); cur.dataset.code = b.dataset.code; cur.replaceChildren(...b.childNodes); }
    cur._k = key; cur.classList.toggle('is-hover', !!S.hover && cur.dataset.code === S.hover);
    return cur;
  });
  const kids = [...body.children];
  if (kids.length !== want.length || want.some((n, i) => kids[i] !== n)) body.replaceChildren(...want);
}

// ---------- feed ----------
function renderFeed(T) {
  const ul = $('[data-pc-feed]');
  if (!ul) return;
  const items = S.events.filter((e) => !T || Date.parse(e.t) <= T).slice().reverse().slice(0, 40);
  if (!items.length) { ul.replaceChildren(el('li', 'pc-empty', S.mode === 'idle' ? 'Race-state and status events appear here during a session.' : 'No race-state or status events recorded yet.')); return; }
  ul.replaceChildren(...items.map((e) => {
    const li = el('li', `pc-ev sev-${e.severity}`);
    li.append(el('span', 'pc-ev-k', `${e.type.replace(/_/g, ' ').toUpperCase()}${e.status === 'cleared' ? ' · CLEARED' : ''}`), el('span', 'pc-ev-l', e.lap ? `LAP ${e.lap}` : ''));
    const who = (e.driver_ids || []).map((id) => ID.drivers[id]?.code).filter(Boolean).join(' · ');
    li.append(el('span', 'pc-ev-t', [who, e.summary, e.consequence].filter(Boolean).join(' — ')));
    li.append(el('span', 'pc-ev-src', 'PBE timing record'));
    return li;
  }));
}

// ---------- position graph (All Access) ----------
function renderGraph(T) {
  const c = $('[data-pc-graph]');
  if (!c || !S.entitled || !S.model) return;
  const g = c.getContext('2d'), r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
  g.clearRect(0, 0, c.width, c.height);
  const H = positionHistory(S.model), maxLap = Math.max(1, ...Object.values(H).flatMap((a) => a.map((p) => p.lap))), n = Math.max(10, ...Object.values(H).flatMap((a) => a.map((p) => p.pos)));
  const L0 = 34 * dpr, R0 = 40 * dpr, T0 = 10 * dpr, B0 = 22 * dpr;
  const X = (lap) => L0 + ((c.width - L0 - R0) * (lap - 1)) / Math.max(1, maxLap - 1), Y = (p) => T0 + ((c.height - T0 - B0) * (p - 1)) / (n - 1);
  g.strokeStyle = 'rgba(255,255,255,.06)'; g.fillStyle = 'rgba(198,204,217,.55)'; g.font = `${10 * dpr}px Barlow, sans-serif`;
  for (let p = 1; p <= n; p += p < 5 ? 2 : 5) { g.beginPath(); g.moveTo(L0, Y(p)); g.lineTo(c.width - R0, Y(p)); g.stroke(); g.fillText(`P${p}`, 4 * dpr, Y(p) + 3 * dpr); }
  const sel = Object.keys(H).find((id) => ID.drivers[id]?.code === S.selected);
  for (const [id, arr] of Object.entries(H)) {
    if (!arr.length) continue;
    const t = TEAM(id), mine = id === sel;
    g.strokeStyle = `#${t?.color || '888'}${sel && !mine ? '55' : ''}`; g.lineWidth = (mine ? 3 : 1.6) * dpr; g.beginPath();
    arr.forEach((p, i) => (i ? g.lineTo(X(p.lap), Y(p.pos)) : g.moveTo(X(p.lap), Y(p.pos)))); g.stroke();
    const last = arr.at(-1); g.fillStyle = `#${t?.color || '888'}`; g.font = `700 ${10 * dpr}px "Barlow Condensed", sans-serif`; g.fillText(ID.drivers[id]?.code || '', X(last.lap) + 4 * dpr, Y(last.pos) + 3 * dpr);
  }
  const lap = lapAt(S.model, T);
  if (lap) { g.strokeStyle = 'rgba(255,255,255,.5)'; g.setLineDash([3 * dpr, 3 * dpr]); g.beginPath(); g.moveTo(X(lap), T0); g.lineTo(X(lap), c.height - B0); g.stroke(); g.setLineDash([]); }
}

// ---------- header state ----------
function renderHeader(T) {
  const f = S.model ? frameAt(S.model, T) : null;
  const flag = f?.flag ? String(f.flag).toUpperCase().replace(/_/g, ' ') : '';
  const stale = S.mode === 'live' && S.lastOk && Date.now() - S.lastOk > 45000;
  const mode = S.mode === 'live' ? (stale ? 'LIVE · TIMING DELAYED' : 'LIVE') : S.mode === 'replay' ? `REPLAY · ${S.speed}×` : S.live === 'unavailable' ? 'LIVE STATUS UNAVAILABLE' : S.live === 'unknown' ? 'CONNECTING…' : 'NO SESSION LIVE';
  const mp = $('[data-pc-mode]'); if (mp.textContent !== mode) mp.textContent = mode; mp.dataset.state = stale ? 'stale' : S.mode;
  renderHud(T, f, flag);
}
// broadcast HUD over the map: REPLAY · <SESSION> · LAP N · <elapsed>, recorded flag, recording gap, cars not on track.
// Built only from the recorded session; absolutely positioned (no layout shift); DOM touched only when text changes.
const fmtElapsed = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
function renderHud(T, f, flag) {
  const hud = $('[data-pc-hud]');
  if (!hud) return;
  const on = (S.mode === 'replay' || S.mode === 'live') && !!S.model;
  const gap = on && inGap(S.model, T);
  const main = on ? [sessionLabel(), f?.lap ? `Lap ${f.lap}${S.mode === 'live' && D.laps_total && S.sessionType === 'race' ? `/${D.laps_total}` : ''}` : '', S.model.start != null ? fmtElapsed(T - S.model.start) : ''].filter(Boolean).join(' · ') : '';
  const fl = on && flag ? flag : '';
  const off = on && S.offTrack.length ? `${S.offTrack.length} not on track · pit / garage` : '';
  const key = `${on}|${S.mode}|${main}|${fl}|${gap}|${off}`;
  if (hud.dataset.key === key) return;
  hud.dataset.key = key; hud.hidden = !on; hud.dataset.mode = S.mode;
  if (!on) return;
  $('[data-pc-hudmain]').replaceChildren(el('b', null, S.mode === 'live' ? 'LIVE' : 'REPLAY'), document.createTextNode(` · ${main}`));
  const fc = $('[data-pc-hudflag]'); fc.hidden = !fl; fc.textContent = fl; fc.dataset.flag = /RED/.test(fl) ? 'red' : /GREEN/.test(fl) ? 'green' : 'caution';
  $('[data-pc-gap]').hidden = !gap;
  const o = $('[data-pc-hudoff]'); o.hidden = !off; o.textContent = off;
  blocksDirty = true;
}

// ---------- loop ----------
let lastFrame = performance.now();
function tick(now) {
  const dt = now - lastFrame; lastFrame = now;
  if (S.mode === 'replay' && S.playing && S.model) { S.T = Math.min(S.model.end, S.T + dt * S.speed); if (S.T >= S.model.end) S.playing = false; syncScrubber(); }
  const T = S.mode === 'live' ? Date.now() : S.T;
  drawCars(T); renderHeader(T); renderClock(T);
  if (!tick.n || now - tick.n > 1000) { tick.n = now; renderTower(T); renderFeed(S.mode === 'replay' ? T : 0); renderGraph(T); renderFocus(T); }
  requestAnimationFrame(tick);
}

// ---------- replay controls (All Access) ----------
function syncScrubber() { const r = $('[data-pc-scrub]'); if (r && S.model) r.value = String(Math.round((1000 * (S.T - S.model.start)) / Math.max(1, S.model.end - S.model.start))); }
function bindReplay() {
  $('[data-pc-play]')?.addEventListener('click', () => { S.playing = !S.playing; if (S.T >= S.model.end) S.T = S.model.start; $('[data-pc-play]').textContent = S.playing ? 'Pause' : 'Play'; });
  document.querySelectorAll('[data-pc-speed]').forEach((b) => b.addEventListener('click', () => { S.speed = Number(b.dataset.pcSpeed); document.querySelectorAll('[data-pc-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
  $('[data-pc-scrub]')?.addEventListener('input', (e) => { S.T = S.model.start + (Number(e.target.value) / 1000) * (S.model.end - S.model.start); persistT(); });
  $('[data-pc-scrub]')?.addEventListener('change', persistT);
  $('[data-pc-lapjump]')?.addEventListener('change', (e) => { const lap = Number(e.target.value); const f = S.model.frames.find((x) => x.lap >= lap); if (f) { S.T = f.ms; syncScrubber(); } });
  const jumpLap = (dir) => { if (!S.model) return; const cur = lapAt(S.model, S.T) || 0; const target = Math.max(1, cur + dir); const f = S.model.frames.find((x) => x.lap >= target); if (f) { S.T = f.ms; syncScrubber(); persistT(); const sel = $('[data-pc-lapjump]'); if (sel) sel.value = String(f.lap); } };
  $('[data-pc-reset]')?.addEventListener('click', () => { if (!S.model) return; S.playing = false; S.T = S.model.start; $('[data-pc-play]').textContent = 'Play'; syncScrubber(); persistT(); });
  $('[data-pc-jumpto]')?.addEventListener('change', (e) => { const t = Number(e.target.value); if (S.model && Number.isFinite(t)) { S.T = Math.min(S.model.end, Math.max(S.model.start, t)); syncScrubber(); persistT(); } e.target.selectedIndex = 0; });
  $('[data-pc-lapprev]')?.addEventListener('click', () => jumpLap(-1));
  $('[data-pc-lapnext]')?.addEventListener('click', () => jumpLap(1));
  document.addEventListener('keydown', (e) => {
    if (S.mode !== 'replay' || !S.model || /input|select|textarea/i.test(e.target.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); $('[data-pc-play]')?.click(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); S.T = Math.min(S.model.end, Math.max(S.model.start, S.T + (e.key === 'ArrowRight' ? 10000 : -10000))); syncScrubber(); persistT(); }
    else if (e.key === ']' || e.key === '[') jumpLap(e.key === ']' ? 1 : -1);
  });
}

// graph -> replay: clicking a lap column moves replay to the first frame of that lap
document.addEventListener('click', (e) => {
  const c = e.target.closest?.('[data-pc-graph]');
  if (!c || !S.model || S.mode !== 'replay') return;
  const H = positionHistory(S.model), maxLap = Math.max(1, ...Object.values(H).flatMap((a) => a.map((p) => p.lap)));
  const r = c.getBoundingClientRect(), L0 = 34, R0 = 40;
  const lap = Math.round(1 + ((e.clientX - r.left - L0) / Math.max(1, r.width - L0 - R0)) * (maxLap - 1));
  const f = S.model.frames.find((x) => x.lap >= Math.max(1, Math.min(maxLap, lap)));
  if (f) { S.T = f.ms; syncScrubber(); persistT(); }
});

// ---------- selection ----------
document.addEventListener('click', (e) => {
  const row = e.target.closest?.('.pc-row');
  if (row) {
    S.selected = S.selected === row.dataset.code ? null : row.dataset.code; S.focusAt = S.selected ? performance.now() : 0; persistSel();
    // focus the driver on the map: on narrow layouts the tower sits below the track, so bring the track back into view
    const trk = $('.pc-track'), tr = trk?.getBoundingClientRect();
    if (S.selected && tr && (tr.bottom < 0 || tr.top > innerHeight)) trk.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    return;
  }
  if (e.target === cv) {
    const id = pick(e.clientX, e.clientY);
    if (id) { const code = ID.drivers[id]?.code || null; S.selected = S.selected === code ? null : code; S.focusAt = S.selected ? performance.now() : 0; persistSel(); }
  }
});
// hover either side highlights both (pointer or keyboard focus on a tower row)
const setHover = (code) => { if (S.hover === code) return; S.hover = code; markHover(); };
cv?.addEventListener('pointermove', (e) => { const id = pick(e.clientX, e.clientY); cv.style.cursor = id ? 'pointer' : 'default'; setHover(id ? ID.drivers[id]?.code || null : null); });
cv?.addEventListener('pointerleave', () => setHover(null));
const towerEl = $('[data-pc-tower]');
towerEl?.addEventListener('pointerover', (e) => setHover(e.target.closest?.('.pc-row')?.dataset.code || null));
towerEl?.addEventListener('pointerleave', () => setHover(null));
towerEl?.addEventListener('focusin', (e) => setHover(e.target.closest?.('.pc-row')?.dataset.code || null));
towerEl?.addEventListener('focusout', () => setHover(null));
function persistT() { if (S.mode !== 'replay' || !S.model) return; const u = new URL(location.href); u.searchParams.set('session', S.session); u.searchParams.set('t', new Date(Math.round(S.T)).toISOString()); history.replaceState(null, '', u); }
function persistSel() {
  const u = new URL(location.href); if (S.selected) u.searchParams.set('driver', S.selected); else u.searchParams.delete('driver'); history.replaceState(null, '', u);
  const d = Object.values(ID.drivers).find((x) => x.code === S.selected), t = d && ID.teams[d.team], card = $('[data-pc-driver]');
  if (card) card.hidden = !d;
  renderFocus(S.mode === 'live' ? Date.now() : S.T);
  renderTower(S.mode === 'live' ? Date.now() : S.T);
}

// driver focus card: sourced/derived fields only (gaps, intervals and best lap only arrive with All Access)
function renderFocus(T) {
  const card = $('[data-pc-driver]');
  const d = Object.values(ID.drivers).find((x) => x.code === S.selected), t = d && ID.teams[d.team];
  if (!card) return;
  card.hidden = !d;
  if (!d) return;
  const f = S.model ? frameAt(S.model, T) : null;
  const rows = f ? [...f.cars].filter((c) => ID.drivers[c.id]).sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99)) : S.tower.map((r) => ({ ...r, id: r.driver_id }));
  const i = rows.findIndex((c) => (c.id || c.driver_id) === d.id), c = rows[i];
  const p = S.model && c ? progressAt(S.model, d.id, T, { live: S.mode === 'live' }) : null;
  const m = S.model?.cars.get(d.id), lastX = m && [...m.crossings].reverse().find((x) => x.ms <= T);
  const observedNow = lastX && T - lastX.ms < 2500;
  const status = c?.status && !RUNNING.has(c.status) ? ({ retired: 'Retired', disqualified: 'Disqualified', dns: 'Did not start', not_classified: 'Not classified' }[c.status] || c.status) : !p ? '—' : p.state === 'held' ? 'Held · timing gap' : p.state === 'unplaced' ? (f?.lap ? 'Not placed · pit / garage' : 'Awaiting first crossing') : p.state === 'out' ? 'Out' : observedNow ? 'Observed line crossing' : 'Interpolated between crossings';
  const start = startPos(d.id), mv = start != null && c?.pos != null ? start - c.pos : null;
  const stat = (k, v, cls = '') => { const s = el('div', `pc-fs ${cls}`); s.append(el('span', null, k), el('b', null, v)); return s; };
  const ahead = rows[i - 1], behind = rows[i + 1];
  const lockTxt = 'All Access';
  const stats = [
    stat('Position', c?.pos ? `P${c.pos}` : '—'),
    stat('Laps', c?.laps != null ? String(c.laps) : '—'),
    stat('Gap to leader', S.entitled ? (i === 0 ? 'Leader' : c?.gap_laps ? `+${c.gap_laps} lap${c.gap_laps > 1 ? 's' : ''}` : fmtGap(c?.gap_ms) || '—') : lockTxt, S.entitled ? '' : 'locked'),
    stat('Interval ahead', S.entitled ? (i > 0 && c?.gap_ms != null && ahead?.gap_ms != null ? fmtGap(c.gap_ms - ahead.gap_ms) : '—') : lockTxt, S.entitled ? '' : 'locked'),
    stat('Interval behind', S.entitled ? (behind?.gap_ms != null && c?.gap_ms != null ? fmtGap(behind.gap_ms - c.gap_ms) : '—') : lockTxt, S.entitled ? '' : 'locked'),
    stat('Best lap', S.entitled ? fmtLap(c?.best_ms) || '—' : lockTxt, S.entitled ? '' : 'locked'),
    stat('Pit stops', S.entitled ? (c?.pits != null ? String(c.pits) : '—') : lockTxt, S.entitled ? '' : 'locked'),
    stat('Since start', mv ? `${mv > 0 ? '↑' : '↓'} ${Math.abs(mv)}` : mv === 0 ? 'No change' : '—', mv > 0 ? 'up' : mv < 0 ? 'down' : ''),
    stat('Status', status),
  ];
  const head = el('div', 'pc-fhead');
  head.append(el('span', `pc-dbadge tc-${(t?.color || '').toLowerCase()}`, t?.short || ''), el('b', null, d.name), el('span', 'muted', ` #${d.number || '–'} · ${t?.name || ''}`), Object.assign(el('a', 'more', 'Driver DNA'), { href: `/drivers/${d.id}` }));
  const grid = el('div', 'pc-fgrid'); grid.append(...stats);
  card.replaceChildren(head, grid);
}

// ---------- data loading ----------
async function membership() {
  const r = await getJSON(`${PRIV}/membership`, { priv: true }).catch(() => null);
  S.entitled = r?.status === 200 && r.body?.membership?.entitled === true;
  S.signedIn = r?.body?.signed_in === true;
  // Presentation of the same verdict (account view): an unanswered/failed/auth-unavailable check shows the access
  // check in the locks (no sale), members get their designation; never "Free". Data gating stays S.entitled.
  const view = accountView(r);
  document.body.dataset.pcTier = S.entitled ? 'all_access' : 'free';
  document.body.dataset.pcView = view;
  document.querySelectorAll('[data-pc-locked]').forEach((n) => { n.hidden = S.entitled || (n.dataset.pcLocked === 'pbecast_signin' && view !== 'signed_out'); if (!S.entitled) ga('premium_teaser_view', { feature: n.dataset.pcLocked }); });
  document.querySelectorAll('[data-pc-premium]').forEach((n) => { n.hidden = !S.entitled; });
  const st = $('[data-pc-account]'); if (st) st.textContent = (ACCOUNT_LABEL[view] || ACCOUNT_LABEL.checking)[0];
}
async function loadLive() {
  try {
    const live = await getJSON(`${PUB}/live`);
    if (live.status !== 200 || !live.body) { S.live = 'unavailable'; applyState(); return false; }
    const sameEvent = live.body?.event?.id === D.event.id;
    if (live.body?.state !== 'live' || !sameEvent) { S.live = 'none'; applyState(); return false; }
    S.live = 'live'; S.ended = null; S.playing = false; disp.clear(); labelPrev.clear();
    S.mode = 'live'; S.session = live.body.session?.id; S.sessionType = live.body.session?.type || null;
    let frames;
    if (S.entitled) { const rep = await getJSON(`${PRIV}/replay/${S.session}`, { priv: true }); frames = rep.status === 200 ? rep.body.frames : null; }
    if (!frames) frames = (await getJSON(`${PUB}/live/frames`)).body?.frames || [];
    S.frames = frames; S.model = buildModel(frames); S.lastOk = Date.now(); S.failures = 0;
    applyState();
    await loadEvents(); poll();
    return true;
  } catch { S.live = 'unavailable'; applyState(); return false; }
}
async function poll() {
  if (S.polling) return;
  S.polling = true;
  setTimeout(async () => {
    S.polling = false;
    if (S.mode !== 'live') return;
    try {
      const since = S.frames.at(-1)?.t || '';
      const r = await getJSON(`${PUB}/live/frames?since=${encodeURIComponent(since)}`);
      if (r.status === 200 && r.body?.state === 'live') {
        if (S.entitled) { const full = await getJSON(`${PRIV}/replay/${S.session}`, { priv: true }); if (full.status === 200) S.frames = full.body.frames; }
        else for (const f of r.body.frames || []) if (!S.frames.length || f.t > S.frames.at(-1).t) S.frames.push(f);
        S.model = buildModel(S.frames); S.lastOk = Date.now(); S.failures = 0;
        applyState();
        if (++S.polls % 3 === 0) await loadEvents();
      } else if (r.status === 200 && r.body?.state && r.body.state !== 'live') { S.ended = sessionLabel() || 'Session'; S.mode = 'idle'; S.live = 'none'; applyState(); return loadRecorded(); }
      else S.failures++;
    } catch { S.failures++; }
    poll();
  }, Math.min(30000, 10000 * (1 + S.failures)));
}
async function loadEvents() {
  if (!S.session) return;
  const r = await getJSON(S.entitled ? `${PRIV}/incidents/${S.session}` : `${PUB}/incidents/${S.session}`, { priv: S.entitled }).catch(() => null);
  if (r?.status === 200) S.events = r.body.events || [];
}
function showFallback() {
  if (!D.fallback) return;
  S.tower = D.fallback.rows;
  renderContext(0);
}
async function loadRecorded() {
  if (!S.model) showFallback();
  let r = null;
  try { r = await getJSON(`${PUB}/replay`); } catch { r = null; }
  if (r?.status !== 200 || !Array.isArray(r.body?.sessions)) { S.recorded = 'unavailable'; applyState(); return; }
  const idx = r.body.sessions.filter((s) => s.event_id === D.event.id);
  const sel = $('[data-pc-sessions]');
  if (sel) sel.replaceChildren(...idx.map((s) => Object.assign(el('option', null, `${D.session_labels[s.type] || s.type} · ${s.frames} frames`), { value: s.id })));
  S.recorded = idx.length; applyState();
  S.sessionTypes = Object.fromEntries(idx.map((s) => [s.id, s.type]));
  if (!idx.length) return;
  const asked = new URLSearchParams(location.search).get('session');
  S.session = idx.find((s) => s.id === asked)?.id || idx[0].id;
  if (sel) sel.value = S.session;
  if (!S.entitled) { await loadEvents(); return; }
  await openReplay(S.session);
  if (sel && !sel.dataset.bound) { sel.dataset.bound = '1'; sel.addEventListener('change', () => openReplay(sel.value)); }
}
async function openReplay(id) {
  const r = await getJSON(`${PRIV}/replay/${id}`, { priv: true });
  if (r.status !== 200) { ga('premium_feature_attempted', { feature: 'pbecast_replay', status: r.status }); return; }
  const q = new URLSearchParams(location.search);
  S.mode = 'replay'; S.session = id; S.sessionType = r.body.meta?.type || S.sessionTypes?.[id] || null;
  S.frames = r.body.frames; S.model = buildModel(S.frames); S.events = r.body.events || [];
  disp.clear(); labelPrev.clear();
  // the replay owns the tower from here: replace the fallback note with the replay context immediately
  renderContext(S.model.start);
  const want = q.get('session') === id ? Date.parse(q.get('t') || '') : NaN;
  S.T = Number.isFinite(want) ? Math.min(S.model.end, Math.max(S.model.start, want)) : S.model.start;
  const cov = r.body.coverage || {};
  $('[data-pc-coverage]').textContent = `${cov.frames || 0} frames · longest recording silence ${cov.longest_silence_s ?? 0}s${cov.silences_over_60s ? ` · ${cov.silences_over_60s} gap${cov.silences_over_60s > 1 ? 's' : ''} over 60s (cars held, not interpolated)` : ''}`;
  buildJumps();
  const laps = [...new Set(S.model.frames.map((f) => f.lap).filter(Boolean))];
  $('[data-pc-lapjump]').replaceChildren(...laps.map((l) => Object.assign(el('option', null, `Lap ${l}`), { value: l })));
  syncScrubber();
}

// replay jump points: ONLY events we hold (recording start/end, flag changes and retirements from our timing record)
function buildJumps() {
  const sel = $('[data-pc-jumpto]');
  if (!sel || !S.model) return;
  const opts = [['Session start (first recorded frame)', S.model.start]];
  for (const e of S.events || []) {
    const t = Date.parse(e.t);
    if (!Number.isFinite(t)) continue;
    if (/flag|safety|red/i.test(e.type) && e.status !== 'cleared') opts.push([`${e.type.replace(/_/g, ' ')}${e.lap ? ` · lap ${e.lap}` : ''}`, t]);
    else if (/retire|dnf|dsq/i.test(e.type)) opts.push([`Retirement${(e.driver_ids || []).length ? ` · ${(e.driver_ids || []).map((id) => ID.drivers[id]?.code).filter(Boolean).join(' ')}` : ''}${e.lap ? ` · lap ${e.lap}` : ''}`, t]);
  }
  opts.push(['End of recording', S.model.end]);
  sel.replaceChildren(el('option', null, 'Jump to…'), ...opts.sort((a, b) => a[1] - b[1]).map(([l, t]) => Object.assign(el('option', null, l), { value: String(t) })));
}

// session clock: elapsed recorded time + lap state
function renderClock(T) {
  const c = $('[data-pc-clock]');
  if (!c || S.mode !== 'replay' || !S.model) return;
  const s = Math.max(0, Math.round((T - S.model.start) / 1000)), lap = lapAt(S.model, T);
  c.textContent = `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}${lap ? ` · lap ${lap}` : ''}`;
}

// ---------- sign-in + CTAs ----------
document.querySelectorAll('[data-pc-cta]').forEach((a) => a.addEventListener('click', () => ga('all_access_cta_click', { feature: a.dataset.pcCta })));
$('[data-pc-signin]')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = e.target.email.value.trim(), out = $('[data-pc-signin-msg]');
  try {
    const here = new URL(location.href); here.hash = '';
    const r = await fetch('https://auth.propbetedge.ai/magic/request', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, return_to: here.toString() }) });
    const b = await r.json().catch(() => ({}));
    out.textContent = r.ok ? b.message || 'If that email has an account, a sign-in link is on its way.' : b.error || 'Sign-in is unavailable right now.';
  } catch { out.textContent = 'Sign-in is unavailable right now.'; }
});

// ---------- boot ----------
(async () => {
  renderWeekendContext();
  fit(); new ResizeObserver(() => fit()).observe(cv || document.body);
  persistSel();
  await membership();
  bindReplay();
  requestAnimationFrame(tick); // banners render from state at once, never wait on the network
  if (!(await loadLive())) await loadRecorded();
  setInterval(async () => {
    if (document.hidden || S.mode === 'live' || S.playing || watch.busy) return;
    watch.busy = true;
    try { if (!(await loadLive()) && S.recorded === 'unavailable') await loadRecorded(); } finally { watch.busy = false; }
  }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderWeekendContext(); });
})();
const watch = { busy: false };
