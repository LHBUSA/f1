// PBEcast V2 client. Free: live track (moving cars from recorded timing), basic tower, major race state.
// All Access (server-enforced): full tower, replay, scrubber, position graph, full feed. The browser never decides
// entitlement: premium data only arrives from endpoints that verified the network session.
import { buildModel, progressAt, frameAt, positionHistory, inGap, lapAt } from './progress.js';

const D = JSON.parse(document.getElementById('pbecast-data').textContent);
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const ID = D.identity, TEAM = (id) => ID.teams[ID.drivers[id]?.team] || null;
const track = D.geometry;
const S = { mode: 'idle', frames: [], model: null, T: 0, playing: false, speed: 1, selected: new URLSearchParams(location.search).get('driver'), entitled: false, signedIn: false, session: null, tower: [], events: [], lastOk: 0, failures: 0, polls: 0 };
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
const cv = $('[data-pc-canvas]'), ctx = cv?.getContext('2d');
let view = null, layer = null;
function fit() {
  if (!cv || !track) return;
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const xs = pts.map((p) => p[0]).concat((track.pit || []).map((p) => p[0])), ys = pts.map((p) => p[1]).concat((track.pit || []).map((p) => p[1]));
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys), pad = 28 * dpr;
  const k = Math.min((cv.width - 2 * pad) / (maxx - minx), (cv.height - 2 * pad) / (maxy - miny));
  const ox = (cv.width - (maxx - minx) * k) / 2, oy = (cv.height - (maxy - miny) * k) / 2;
  view = { dpr, k, P: (x, y) => [ox + (x - minx) * k, cv.height - oy - (y - miny) * k] };
  layer = document.createElement('canvas'); layer.width = cv.width; layer.height = cv.height;
  const g = layer.getContext('2d');
  const line = (arr, close) => { g.beginPath(); arr.forEach((p, i) => { const [x, y] = view.P(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); if (close) g.closePath(); };
  g.lineJoin = 'round'; g.lineCap = 'round';
  if (track.pit) { g.setLineDash([4 * dpr, 4 * dpr]); g.strokeStyle = 'rgba(160,170,190,.35)'; g.lineWidth = 2 * dpr; line(track.pit); g.stroke(); g.setLineDash([]); }
  g.shadowColor = 'rgba(255,77,46,.35)'; g.shadowBlur = 18 * dpr; g.strokeStyle = '#11141c'; g.lineWidth = 16 * dpr; line(pts, true); g.stroke(); g.shadowBlur = 0;
  g.strokeStyle = '#2b3242'; g.lineWidth = 10 * dpr; line(pts, true); g.stroke();
  g.strokeStyle = 'rgba(255,77,46,.55)'; g.lineWidth = 1.2 * dpr; line(pts, true); g.stroke();
  // timing line (estimated position; labelled as such)
  const t0 = along(0), [tx, ty] = view.P(t0.x, t0.y);
  g.strokeStyle = '#f2f4f8'; g.lineWidth = 3 * dpr; g.beginPath(); g.moveTo(tx - t0.nx * 10 * dpr, ty + t0.ny * 10 * dpr); g.lineTo(tx + t0.nx * 10 * dpr, ty - t0.ny * 10 * dpr); g.stroke();
  g.fillStyle = 'rgba(198,204,217,.8)'; g.font = `600 ${10 * dpr}px "Barlow Condensed", sans-serif`; g.fillText('TIMING LINE (EST.)', tx + 12 * dpr, ty - 10 * dpr);
  for (const c of track.corners || []) { const [x, y] = view.P(c.x, c.y); g.fillStyle = 'rgba(198,204,217,.5)'; if (c.n) g.fillText(`T${c.n}`, x + 6 * dpr, y - 6 * dpr); else { g.beginPath(); g.arc(x, y, 1.6 * dpr, 0, 7); g.fill(); } }
}

// Car glyph (top-down, facing +x in local space): team-colour body, black tyres, wings, dark cockpit.
function carGlyph(g, x, y, ang, color, sc, { held, sel, leader }) {
  g.save(); g.translate(x, y); g.rotate(ang); g.scale(sc, sc);
  g.globalAlpha = held ? 0.45 : 1;
  if (sel) { g.shadowColor = color; g.shadowBlur = 10; }
  g.fillStyle = '#0b0d12';
  for (const [tx, ty] of [[6.5, 4.6], [6.5, -4.6], [-6.5, 4.8], [-6.5, -4.8]]) g.fillRect(tx - 2.2, ty - 1.4, 4.4, 2.8);
  g.fillStyle = color;
  g.beginPath(); g.moveTo(11, 0); g.lineTo(5, 1.6); g.lineTo(1, 3.6); g.lineTo(-7, 3.4); g.lineTo(-9, 1.8); g.lineTo(-9, -1.8); g.lineTo(-7, -3.4); g.lineTo(1, -3.6); g.lineTo(5, -1.6); g.closePath(); g.fill();
  g.shadowBlur = 0;
  g.fillRect(9.4, -5.2, 1.6, 10.4);            // front wing
  g.fillRect(-11, -4.6, 2, 9.2);               // rear wing
  g.fillStyle = 'rgba(8,10,14,.85)'; g.beginPath(); g.ellipse(-0.6, 0, 2.3, 1.4, 0, 0, 7); g.fill();
  g.lineWidth = (sel ? 1.4 : 0.8); g.strokeStyle = sel ? '#ffffff' : held ? 'rgba(255,207,92,.9)' : 'rgba(0,0,0,.6)';
  if (held) g.setLineDash([2, 1.5]);
  g.beginPath(); g.moveTo(11, 0); g.lineTo(5, 1.6); g.lineTo(1, 3.6); g.lineTo(-7, 3.4); g.lineTo(-9, 1.8); g.lineTo(-9, -1.8); g.lineTo(-7, -3.4); g.lineTo(1, -3.6); g.lineTo(5, -1.6); g.closePath(); g.stroke(); g.setLineDash([]);
  g.restore();
  if (sel) { g.save(); g.globalAlpha = 0.9; g.strokeStyle = '#ffffff'; g.lineWidth = 1.5 * view.dpr; g.beginPath(); g.arc(x, y, 15 * view.dpr, 0, 7); g.stroke(); g.restore(); }
}

// Display easing (visual only): cars glide to the timing-derived target instead of jumping when live timing corrects.
// The model position (progressAt) is untouched and is what the QA hook reports; scrubs/lap jumps snap.
const disp = new Map();
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

function drawCars(T) {
  if (!ctx || !layer) return;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(layer, 0, 0);
  const f = S.model ? frameAt(S.model, T) : null;
  const flag = f?.flag ? String(f.flag).toUpperCase() : '';
  cv.dataset.flag = /RED/.test(flag) ? 'red' : /SAFETY|SC|VSC|YELLOW/.test(flag) ? 'caution' : '';
  if (!f) { lastDrawT = T; lastDrawAt = performance.now(); return; }
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
  unplaced.forEach((c, i) => placed.push({ c, frac: -((i + 1) * 14) / L, held: true, grid: true }));
  // screen placement on the eased fraction; bunched cars spread into lanes, labels alternate sides
  const drawn = [];
  for (const it of placed) {
    const fr = it.grid ? it.frac : eased(it.c.id, it.frac, T);
    const a = along(fr), a2 = along(fr + 0.0015);
    let [x, y] = view.P(a.x, a.y);
    const [x2, y2] = view.P(a2.x, a2.y);
    const ang = Math.atan2(y2 - y, x2 - x);
    const near = drawn.filter((d) => Math.hypot(d.x - x, d.y - y) < 16 * dpr).length;
    let lane = 0;
    if (near) { lane = (near % 2 ? 1 : -1) * Math.ceil(near / 2); x += a.nx * lane * 9 * dpr; y -= a.ny * lane * 9 * dpr; }
    drawn.push({ x, y, ang, lane, nx: a.nx, ny: a.ny, it });
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const d of drawn) {
    const t = TEAM(d.it.c.id), sel = ID.drivers[d.it.c.id]?.code === S.selected || d.it.c.id === S.selected;
    const color = `#${t?.color || '888'}`;
    if (!d.it.grid && !d.it.held) { // short trail along the track behind the car
      ctx.strokeStyle = `${color}44`; ctx.lineWidth = 3 * dpr; ctx.beginPath();
      const fr = disp.get(d.it.c.id) ?? d.it.frac;
      for (let k = 0; k <= 6; k++) { const bb = along(fr - (k * 0.004)); const [bx, by] = view.P(bb.x, bb.y); k ? ctx.lineTo(bx, by) : ctx.moveTo(bx, by); }
      ctx.stroke();
    }
    carGlyph(ctx, d.x, d.y, d.ang, color, (sel ? 1.4 : 1.12) * dpr, { held: d.it.held, sel, leader: d.it.c.pos === 1 });
    // an OBSERVED crossing (real recorded event) within the last 2 s gets a brief ring
    if (d.it.crossedAgo != null && d.it.crossedAgo < 2000) { ctx.globalAlpha = 0.7 * (1 - d.it.crossedAgo / 2000); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1 * dpr; ctx.beginPath(); ctx.arc(d.x, d.y, 13 * dpr, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
    // driver code tag, offset off the racing line (side alternates with the lane so bunched tags do not stack)
    const side = d.lane < 0 ? -1 : 1, off = (14 + Math.abs(d.lane) * 4) * dpr;
    const lx = d.x + d.nx * off * side, ly = d.y - d.ny * off * side;
    const code = ID.drivers[d.it.c.id]?.code || '';
    ctx.font = `700 ${(sel ? 11 : 9.5) * dpr}px "Barlow Condensed", sans-serif`;
    const tw = ctx.measureText(code).width + 8 * dpr, th = (sel ? 15 : 13) * dpr;
    ctx.globalAlpha = d.it.held ? 0.6 : 1;
    ctx.fillStyle = 'rgba(8,10,14,.82)'; ctx.beginPath(); ctx.roundRect(lx - tw / 2, ly - th / 2, tw, th, 3 * dpr); ctx.fill();
    ctx.fillStyle = color; ctx.fillRect(lx - tw / 2, ly - th / 2, 2 * dpr, th);
    ctx.fillStyle = sel ? '#ffffff' : '#e6e9ef'; ctx.fillText(code, lx + 1 * dpr, ly + 0.5 * dpr);
    if (d.it.c.pos === 1) { ctx.fillStyle = '#ffcf5c'; ctx.font = `800 ${8.5 * dpr}px "Barlow Condensed", sans-serif`; ctx.fillText('P1', lx, ly - th * 0.95); }
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  lastDrawT = T; lastDrawAt = performance.now();
  S.hit = drawn.map((d) => ({ x: d.x / dpr, y: d.y / dpr, id: d.it.c.id }));
  // QA hook: the exact race state on screen (MODEL track fraction + state per car), comparable across widths
  window.__pbecast = { T, mode: S.mode, session: S.session, cars: drawn.map((d) => ({ id: d.it.c.id, frac: Math.round(d.it.frac * 1e6) / 1e6, held: !!d.it.held, grid: !!d.it.grid })).sort((a, b) => a.id.localeCompare(b.id)), unplaced: placed.length - drawn.length };
}

// ---------- tower ----------
// position at the first recorded frame of the session (for "gained / lost since the start"; only from our frames)
function startPos(id) { const f0 = S.model?.frames?.[0]; return f0 ? f0.cars?.find((c) => c.id === id)?.pos ?? null : null; }
const fmtGap = (ms) => (ms == null ? '' : ms >= 60000 ? `+${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}` : `+${(ms / 1000).toFixed(3)}`);
const fmtLap = (ms) => (ms ? `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}` : '');
function renderTower(T) {
  const body = $('[data-pc-tower]');
  if (!body) return;
  const f = S.model ? frameAt(S.model, T) : null;
  const rows = f ? [...f.cars].filter((c) => ID.drivers[c.id]).sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99)) : S.tower;
  body.replaceChildren(...rows.map((c, i) => {
    const d = ID.drivers[c.id || c.driver_id], t = TEAM(c.id || c.driver_id);
    const b = el('button', `pc-row tc-${(t?.color || '').toLowerCase()}`); b.type = 'button';
    b.setAttribute('aria-pressed', String(d?.code === S.selected)); b.dataset.code = d?.code || '';
    const start = startPos(c.id || c.driver_id), mv = start != null && c.pos != null ? start - c.pos : null;
    b.append(el('span', 'pc-pos', String(c.pos ?? '–')), el('span', 'pc-stripe'), Object.assign(el('span', 'pc-team', t?.short || ''), { title: t?.name || '' }), el('span', 'pc-code', d?.code || '?'),
      Object.assign(el('span', `pc-mv ${mv > 0 ? 'up' : mv < 0 ? 'down' : ''}`, mv ? `${mv > 0 ? '↑' : '↓'}${Math.abs(mv)}` : ''), { title: mv ? `${mv > 0 ? 'Gained' : 'Lost'} ${Math.abs(mv)} since the start of this session` : '' }));
    const status = c.status && c.status !== 'running' ? { retired: 'OUT', disqualified: 'DSQ', dns: 'DNS', not_classified: 'NC' }[c.status] || c.status.toUpperCase() : '';
    if (S.entitled) {
      const prev = rows[i - 1];
      const iv = c.gap_ms != null && prev?.gap_ms != null ? c.gap_ms - prev.gap_ms : null;
      b.append(el('span', 'pc-num', i === 0 ? `L${c.laps ?? ''}` : c.gap_laps ? `+${c.gap_laps}L` : fmtGap(c.gap_ms)), el('span', 'pc-num pc-iv', i === 0 ? '' : fmtGap(iv)), el('span', 'pc-num', c.pits != null ? String(c.pits) : ''), el('span', 'pc-num', fmtLap(c.best_ms)));
    } else b.append(el('span', 'pc-num', c.laps != null ? `L${c.laps}` : ''));
    b.append(el('span', 'pc-status', status));
    return b;
  }));
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
  $('[data-pc-lap]').textContent = f?.lap ? `LAP ${f.lap}${D.laps_total ? ` / ${D.laps_total}` : ''}` : '';
  const flag = f?.flag ? String(f.flag).toUpperCase().replace(/_/g, ' ') : '';
  const fc = $('[data-pc-flag]'); fc.textContent = flag; fc.hidden = !flag || flag === 'GREEN';
  const stale = S.mode === 'live' && S.lastOk && Date.now() - S.lastOk > 45000;
  $('[data-pc-mode]').textContent = S.mode === 'live' ? (stale ? 'LIVE · TIMING DELAYED' : 'LIVE') : S.mode === 'replay' ? `REPLAY · ${S.speed}×` : 'NO SESSION LIVE';
  $('[data-pc-mode]').dataset.state = stale ? 'stale' : S.mode;
  const gapNote = $('[data-pc-gap]');
  if (gapNote) gapNote.hidden = !(S.model && inGap(S.model, T));
}

// ---------- loop ----------
let lastFrame = performance.now();
function tick(now) {
  const dt = now - lastFrame; lastFrame = now;
  if (S.mode === 'replay' && S.playing && S.model) { S.T = Math.min(S.model.end, S.T + dt * S.speed); if (S.T >= S.model.end) S.playing = false; syncScrubber(); }
  const T = S.mode === 'live' ? Date.now() : S.T;
  drawCars(T); renderHeader(T);
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
  $('[data-pc-lapprev]')?.addEventListener('click', () => jumpLap(-1));
  $('[data-pc-lapnext]')?.addEventListener('click', () => jumpLap(1));
  document.addEventListener('keydown', (e) => {
    if (S.mode !== 'replay' || !S.model || /input|select|textarea/i.test(e.target.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); $('[data-pc-play]')?.click(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); S.T = Math.min(S.model.end, Math.max(S.model.start, S.T + (e.key === 'ArrowRight' ? 10000 : -10000))); syncScrubber(); persistT(); }
    else if (e.key === ']' || e.key === '[') jumpLap(e.key === ']' ? 1 : -1);
  });
}

// ---------- selection ----------
document.addEventListener('click', (e) => {
  const row = e.target.closest?.('.pc-row');
  if (row) { S.selected = S.selected === row.dataset.code ? null : row.dataset.code; persistSel(); return; }
  if (e.target === cv && S.hit) {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = S.hit.map((h) => ({ ...h, d: Math.hypot(h.x - x, h.y - y) })).sort((a, b) => a.d - b.d)[0];
    if (hit && hit.d < 18) { S.selected = ID.drivers[hit.id]?.code || null; persistSel(); }
  }
});
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
  const status = c?.status && c.status !== 'running' ? ({ retired: 'Retired', disqualified: 'Disqualified', dns: 'Did not start', not_classified: 'Not classified' }[c.status] || c.status) : !p ? '—' : p.state === 'held' ? 'Held · timing gap' : p.state === 'unplaced' ? (f?.lap ? 'In pit / garage' : 'Awaiting first crossing') : p.state === 'out' ? 'Out' : S.mode === 'live' ? 'Running · live' : 'Running';
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
  document.body.dataset.pcTier = S.entitled ? 'all_access' : 'free';
  document.querySelectorAll('[data-pc-locked]').forEach((n) => { n.hidden = S.entitled; if (!S.entitled) ga('premium_teaser_view', { feature: n.dataset.pcLocked }); });
  document.querySelectorAll('[data-pc-premium]').forEach((n) => { n.hidden = !S.entitled; });
  const st = $('[data-pc-account]'); if (st) st.textContent = S.entitled ? 'All Access' : S.signedIn ? 'Signed in · Free' : 'Free';
}
async function loadLive() {
  try {
    const live = await getJSON(`${PUB}/live`);
    const sameEvent = live.body?.event?.id === D.event.id;
    if (live.body?.state !== 'live' || !sameEvent) return false;
    S.mode = 'live'; S.session = live.body.session?.id;
    let frames;
    if (S.entitled) { const rep = await getJSON(`${PRIV}/replay/${S.session}`, { priv: true }); frames = rep.status === 200 ? rep.body.frames : null; }
    if (!frames) frames = (await getJSON(`${PUB}/live/frames`)).body?.frames || [];
    S.frames = frames; S.model = buildModel(frames); S.lastOk = Date.now();
    await loadEvents(); poll();
    return true;
  } catch { return false; }
}
async function poll() {
  setTimeout(async () => {
    try {
      const since = S.frames.at(-1)?.t || '';
      const r = await getJSON(`${PUB}/live/frames?since=${encodeURIComponent(since)}`);
      if (r.status === 200 && r.body?.state === 'live') {
        if (S.entitled) { const full = await getJSON(`${PRIV}/replay/${S.session}`, { priv: true }); if (full.status === 200) S.frames = full.body.frames; }
        else for (const f of r.body.frames || []) if (!S.frames.length || f.t > S.frames.at(-1).t) S.frames.push(f);
        S.model = buildModel(S.frames); S.lastOk = Date.now(); S.failures = 0;
        if (++S.polls % 3 === 0) await loadEvents();
      } else if (r.body?.state && r.body.state !== 'live') { S.mode = 'idle'; return loadRecorded(); }
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
  const n = $('[data-pc-towernote]'); if (n) { n.hidden = false; n.textContent = `No session live · latest published classification: ${D.fallback.label}`; }
}
async function loadRecorded() {
  if (!S.model) showFallback();
  const idx = (await getJSON(`${PUB}/replay`)).body?.sessions?.filter((s) => s.event_id === D.event.id) || [];
  const sel = $('[data-pc-sessions]');
  if (sel) sel.replaceChildren(...idx.map((s) => Object.assign(el('option', null, `${D.session_labels[s.type] || s.type} · ${s.frames} frames`), { value: s.id })));
  $('[data-pc-recorded]').textContent = idx.length ? `${idx.length} recorded session${idx.length > 1 ? 's' : ''} this weekend` : 'No session recorded for this weekend yet.';
  if (!idx.length) return;
  const asked = new URLSearchParams(location.search).get('session');
  S.session = idx.find((s) => s.id === asked)?.id || idx[0].id;
  if (sel) sel.value = S.session;
  if (!S.entitled) { await loadEvents(); return; }
  await openReplay(S.session);
  sel?.addEventListener('change', () => openReplay(sel.value));
}
async function openReplay(id) {
  const r = await getJSON(`${PRIV}/replay/${id}`, { priv: true });
  if (r.status !== 200) { ga('premium_feature_attempted', { feature: 'pbecast_replay', status: r.status }); return; }
  S.mode = 'replay'; S.session = id; S.frames = r.body.frames; S.model = buildModel(S.frames); S.events = r.body.events || [];
  const want = Date.parse(new URLSearchParams(location.search).get('t') || '');
  S.T = Number.isFinite(want) ? Math.min(S.model.end, Math.max(S.model.start, want)) : S.model.start;
  const cov = r.body.coverage || {};
  $('[data-pc-coverage]').textContent = `${cov.frames || 0} frames · longest recording silence ${cov.longest_silence_s ?? 0}s${cov.silences_over_60s ? ` · ${cov.silences_over_60s} gap${cov.silences_over_60s > 1 ? 's' : ''} over 60s (cars held, not interpolated)` : ''}`;
  const laps = [...new Set(S.model.frames.map((f) => f.lap).filter(Boolean))];
  $('[data-pc-lapjump]').replaceChildren(...laps.map((l) => Object.assign(el('option', null, `Lap ${l}`), { value: l })));
  syncScrubber();
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
  fit(); new ResizeObserver(() => fit()).observe(cv || document.body);
  persistSel();
  await membership();
  bindReplay();
  if (!(await loadLive())) await loadRecorded();
  requestAnimationFrame(tick);
})();
