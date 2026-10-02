// Layout character measured from our OSM-derived circuit path (10 m spacing). Measurements, not claims about how a car
// behaves: straight lengths, the share of the lap spent on straights, and the left/right split of detected corners.
import fs from 'node:fs';
import path from 'node:path';

export function loadGeometry(slug, dir = 'geometry') {
  const f = path.resolve(dir, `${slug}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

export function layoutMetrics(g) {
  if (!g?.path?.length) return null;
  const P = g.path, n = P.length, step = g.length_m / n;
  const head = (i) => { const a = P[(i - 2 + n) % n], b = P[(i + 2) % n]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
  const straight = [];
  for (let i = 0; i < n; i++) { let d = head((i + 3) % n) - head((i - 3 + n) % n); d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d))); straight.push(d < (6 * Math.PI) / 180); }
  // runs of straight points (wrapping), kept when at least 200 m long
  const runs = [];
  let start = straight.findIndex((s) => !s);
  if (start < 0) start = 0;
  let len = 0;
  for (let k = 1; k <= n; k++) { const i = (start + k) % n; if (straight[i]) len++; else { if (len * step >= 200) runs.push(len * step); len = 0; } }
  if (len * step >= 200) runs.push(len * step);
  runs.sort((a, b) => b - a);
  const left = g.corners.filter((c) => c.dir === 'left').length, right = g.corners.filter((c) => c.dir === 'right').length;
  return {
    lap_m: g.length_m,
    straights: runs.length,
    longest_straight_m: runs[0] ? Math.round(runs[0] / 10) * 10 : null,
    second_straight_m: runs[1] ? Math.round(runs[1] / 10) * 10 : null,
    straight_share: runs.reduce((a, b) => a + b, 0) / g.length_m,
    corners_detected: g.corners.length,
    left, right,
    source: `OpenStreetMap geometry (ODbL), ${g.osm_way_ids.length} ways, built ${g.built_at.slice(0, 10)}`,
  };
}
