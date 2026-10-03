// PBEcast track label layout (presentation only; never touches f1-progress@1 positions).
// Cars stay pinned to their timing-derived point on the track centreline. Labels are a separate layer: each label may
// move away from its car (with a leader line when displaced) so that no label overlaps another label, a car, a blocked
// overlay region or the canvas edge. Dense packs (FAN_MIN+ cars chained within CLUSTER_PX) fan their labels outward
// around the pack, ordered along the pack so leader lines do not cross. Pure + deterministic for the same input.
export const LABELS_VERSION = 'pbecast-labels@1';
export const FAN_MIN = 6;

const hit = (a, b, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
function rectCircle(r, cx, cy, rad) {
  const nx = Math.max(r.x, Math.min(cx, r.x + r.w)), ny = Math.max(r.y, Math.min(cy, r.y + r.h));
  return Math.hypot(nx - cx, ny - cy) < rad;
}
const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

// single-linkage clusters of anchor points (chain distance <= d)
export function clusters(points, d) {
  const parent = points.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) <= d) parent[find(i)] = find(j);
  }
  const groups = new Map();
  points.forEach((_, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  return [...groups.values()];
}

// cars: [{ id, x, y, r, w, h, prio, prev? {dx,dy} }]  (r = the car's no-cover radius; w/h = label size)
// opts: { bounds {x0,y0,x1,y1}, blocks [{x,y,w,h}], center {x,y}, cluster px, gap px, maxR px }
// returns Map id -> { x, y, w, h, cx, cy, leader, fan, forced }
export function layoutLabels(cars, { bounds, blocks = [], center, cluster = 22, gap = 3, maxR = 170 } = {}) {
  const out = new Map(), placed = [];
  const groups = clusters(cars, cluster);
  const fanOf = new Map();
  for (const g of groups) {
    if (g.length < FAN_MIN) continue;
    const mem = g.map((i) => cars[i]);
    const c = { x: mem.reduce((s, m) => s + m.x, 0) / mem.length, y: mem.reduce((s, m) => s + m.y, 0) / mem.length };
    let ux = c.x - (center?.x ?? c.x), uy = c.y - (center?.y ?? c.y - 1); const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const spread = Math.max(...mem.map((m) => Math.hypot(m.x - c.x, m.y - c.y) + m.r));
    // order members across the fan by their offset perpendicular to the outward direction (keeps leader lines apart)
    const order = [...mem].sort((a, b) => ((a.x - c.x) * -uy + (a.y - c.y) * ux) - ((b.x - c.x) * -uy + (b.y - c.y) * ux));
    const R0 = spread + 20, step = Math.max(...mem.map((m) => m.h)) + 9;
    const span = Math.min(Math.PI * 1.9, (order.length * step) / R0), base = Math.atan2(uy, ux);
    order.forEach((m, k) => fanOf.set(m.id, { c, ang: base - span / 2 + (order.length === 1 ? span / 2 : (span * k) / (order.length - 1)), R0, n: order.length }));
  }
  const ok = (r) => {
    if (r.x < bounds.x0 || r.y < bounds.y0 || r.x + r.w > bounds.x1 || r.y + r.h > bounds.y1) return false;
    for (const p of placed) if (hit(r, p, gap)) return false;
    for (const b of blocks) if (hit(r, b, gap)) return false;
    for (const c of cars) if (rectCircle(r, c.x, c.y, c.r + 1)) return false;
    return true;
  };
  const cost = (r) => {
    let s = 0;
    if (r.x < bounds.x0 || r.y < bounds.y0 || r.x + r.w > bounds.x1 || r.y + r.h > bounds.y1) s += 1e6;
    for (const p of placed) s += overlapArea(r, p) * 10;
    for (const b of blocks) s += overlapArea(r, b) * 10;
    for (const c of cars) if (rectCircle(r, c.x, c.y, c.r)) s += 200;
    return s;
  };
  const order = [...cars].sort((a, b) => a.prio - b.prio);
  for (const car of order) {
    const at = (cx, cy) => ({ x: cx - car.w / 2, y: cy - car.h / 2, w: car.w, h: car.h, cx, cy });
    const cands = [];
    if (car.prev) cands.push(at(car.x + car.prev.dx, car.y + car.prev.dy));
    const fan = fanOf.get(car.id);
    if (fan) for (let R = fan.R0; R <= fan.R0 + maxR; R += 6) cands.push(at(fan.c.x + Math.cos(fan.ang) * R, fan.c.y + Math.sin(fan.ang) * R));
    // generic ring search around the car: nearest first, outward (away from the track centre) preferred
    const out0 = center ? Math.atan2(car.y - center.y, car.x - center.x) : -Math.PI / 2;
    const ring = [];
    for (let k = 0; k < 16; k++) {
      const a = out0 + (k * Math.PI) / 8, ex = Math.abs(Math.cos(a)) * (car.w / 2) + Math.abs(Math.sin(a)) * (car.h / 2);
      for (let d = car.r + ex + 3; d <= car.r + ex + maxR; d += 7) {
        const inward = Math.cos(a - out0) < -0.2 ? 14 : 0;
        ring.push({ c: d + inward + (k ? 1 : 0), x: car.x + Math.cos(a) * d, y: car.y + Math.sin(a) * d });
      }
    }
    ring.sort((a, b) => a.c - b.c);
    for (const p of ring) cands.push(at(p.x, p.y));
    let best = cands.find(ok), forced = false;
    if (!best) { forced = true; best = cands.reduce((m, r) => (cost(r) < cost(m) ? r : m), cands[0]); }
    const dist = Math.hypot(best.cx - car.x, best.cy - car.y);
    const lab = { ...best, leader: dist > car.r + Math.max(car.w, car.h) / 2 + 6, fan: !!fan, forced };
    placed.push(lab); out.set(car.id, lab);
  }
  return out;
}
