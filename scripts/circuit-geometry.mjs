// Circuit geometry from OpenStreetMap raceway ways (ODbL: © OpenStreetMap contributors; attribution is a licence
// requirement and is shown on the track view, like the MET Norway forecast credit).
//
// For each circuit: fetch highway=raceway ways around the circuit's coordinates, split them at shared nodes into a graph,
// and pick the closed loop whose length best matches the circuit's published lap length (±6%). That rejects karting,
// handling and short/long layouts. The loop is oriented in the race direction from oneway tags. A way named "pit lane"
// is attached as the pit lane. Nothing is drawn by hand; a circuit with no matching loop gets no geometry.
//
// Output (data/geometry/<slug>.json, gitignored; published through the projection):
//   { slug, source, osm_way_ids, length_m, target_m, length_delta_pct, direction_basis, path: [[x,y]...] (metres, local
//     equirectangular, y up), pit: [[x,y]...]|null, timing_line: { s, basis }, corners: [{ s, x, y, n|null }], built_at }
//   s = distance along the loop from the timing line, in metres.
//
// Usage: node scripts/circuit-geometry.mjs [--season 2026] [--only slug,slug] [--endpoint url]

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const SEASON = Number(opt('season', new Date().getUTCFullYear()));
const ONLY = (opt('only', '') || '').split(',').filter(Boolean);
const ENDPOINT = opt('endpoint', 'https://overpass.private.coffee/api/interpreter');
const UA = 'PropSports-F1/1.0 (+https://propsports.proptechusa.ai)';
const OUT = path.resolve('data/geometry');
fs.mkdirSync(OUT, { recursive: true });

const circuits = JSON.parse(fs.readFileSync('data/derived/circuits.json', 'utf8'));
// the projection's per-edition circuit attribution (Wikidata P276, ESPN venue only as fallback) picks the season's circuits
const events = JSON.parse(fs.readFileSync(`data/projection/events-${SEASON}.json`, 'utf8'));
const want = new Set(events.map((e) => e.circuit_id));
const todo = circuits.filter((c) => c.lat != null && (ONLY.length ? ONLY.includes(c.slug) : want.has(c.slug)));

const R = 6371008.8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ENDPOINTS = [ENDPOINT, 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
// Primary: the OSM editing API map call for a small bbox (light use, ODbL, same data as Overpass). It returns XML with
// every node/way in the box; we keep highway=raceway ways in Overpass's "out body geom" shape.
async function osmMap(lat, lon, radius) {
  const dLat = radius / 111320, dLon = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  return osmBox([lon - dLon, lat - dLat, lon + dLon, lat + dLat], 0);
}
// a dense city box exceeds the API's node limit (400): split into quadrants and merge (a map call returns every node of
// each way it lists, so ways crossing tile edges stay complete)
async function osmBox(b, depth) {
  try { return await osmBoxOnce(b); }
  catch (e) {
    if (!/osm api 400/.test(e.message) || depth >= 3) throw e;
    const [w, s, e2, n] = b, mx = (w + e2) / 2, my = (s + n) / 2;
    const parts = [];
    for (const q of [[w, s, mx, my], [mx, s, e2, my], [w, my, mx, n], [mx, my, e2, n]]) { await sleep(6000); parts.push(...(await osmBox(q, depth + 1))); }
    const seen = new Map();
    for (const x of parts) seen.set(x.id, x);
    return [...seen.values()];
  }
}
async function osmBoxOnce(b) {
  const bbox = b.map((x) => x.toFixed(6)).join(',');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90000);
  try {
    const r = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`, { headers: { 'user-agent': UA }, signal: ctl.signal });
    if (!r.ok) throw new Error(`osm api ${r.status}`);
    const xml = await r.text();
    const nodes = new Map();
    for (const m of xml.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)" lon="([-\d.]+)"/g)) nodes.set(m[1], { lat: +m[2], lon: +m[3] });
    const ways = [];
    for (const m of xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
      const tags = Object.fromEntries([...m[2].matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)].map((t) => [t[1], t[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"')]));
      if (tags.highway !== 'raceway') continue;
      const refs = [...m[2].matchAll(/<nd ref="(\d+)"/g)].map((x) => x[1]);
      if (refs.some((x) => !nodes.has(x))) continue; // way leaves the box: incomplete geometry
      ways.push({ id: Number(m[1]), tags, nodes: refs.map(Number), geometry: refs.map((x) => nodes.get(x)) });
    }
    return ways;
  } finally { clearTimeout(timer); }
}

// hard deadline per request (body included); endpoints rotate on failure
async function overpass(lat, lon, radius) {
  const q = `[out:json][timeout:90];way(around:${radius},${lat},${lon})[highway=raceway];out body geom;`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const ep = ENDPOINTS[attempt % ENDPOINTS.length];
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 120000);
    try {
      const r = await fetch(ep, { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: ctl.signal });
      const text = await r.text();
      if (r.ok && text.startsWith('{')) return JSON.parse(text).elements;
      console.error(`  overpass ${ep} -> ${r.status}`);
    } catch (e) { console.error(`  overpass ${ep} -> ${e.name}`); }
    finally { clearTimeout(timer); }
    await sleep(15000);
  }
  throw new Error('overpass unavailable');
}

export function buildLoop(ways, targetM, origin) {
  const [lat0, lon0] = origin;
  const proj = (la, lo) => [((lo - lon0) * Math.PI / 180) * R * Math.cos(lat0 * Math.PI / 180), ((la - lat0) * Math.PI / 180) * R];
  const isPit = (w) => /pit/i.test(`${w.tags?.name || ''} ${w.tags?.['name:en'] || ''} ${w.tags?.raceway || ''} ${w.tags?.service || ''}`);
  const excluded = (w) => w.tags?.sport === 'karting' || /kart|drift|handling|skid|test track|paddock|go-?kart/i.test(`${w.tags?.name || ''} ${w.tags?.['name:en'] || ''}`) || w.tags?.area === 'yes';
  const coord = new Map();
  const use = new Map(); // node -> number of track ways touching it
  const track = ways.filter((w) => !excluded(w) && !isPit(w) && w.nodes?.length >= 2);
  for (const w of track) w.nodes.forEach((n, i) => { coord.set(n, proj(w.geometry[i].lat, w.geometry[i].lon)); use.set(n, (use.get(n) || 0) + 1); });
  // split each way at nodes shared with another way (or its own ends) -> edges
  const edges = [];
  for (const w of track) {
    let cur = [w.nodes[0]];
    for (let i = 1; i < w.nodes.length; i++) {
      cur.push(w.nodes[i]);
      const n = w.nodes[i];
      if (i === w.nodes.length - 1 || use.get(n) > 1 || w.nodes.indexOf(n) !== i) { edges.push({ way: w.id, oneway: w.tags?.oneway === 'yes', nodes: cur }); cur = [n]; }
    }
  }
  // street circuits: raceway ways sometimes stop a few metres short of each other where they meet ordinary roads.
  // Dead-end endpoints closer than BRIDGE_M are joined by a straight connector, recorded as a bridge (the length check
  // still has to pass, so a bridge can never invent a lap).
  const BRIDGE_M = 20;
  const deg = new Map();
  for (const e of edges) for (const n of [e.nodes[0], e.nodes.at(-1)]) deg.set(n, (deg.get(n) || 0) + 1);
  const ends = [...deg].filter(([, d]) => d === 1).map(([n]) => n);
  const bridges = [];
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    const a = coord.get(ends[i]), b = coord.get(ends[j]);
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (d > 0 && d <= BRIDGE_M) { edges.push({ way: 'bridge', oneway: false, nodes: [ends[i], ends[j]] }); bridges.push(Math.round(d)); }
  }
  const len = (nodes) => { let s = 0; for (let i = 1; i < nodes.length; i++) { const a = coord.get(nodes[i - 1]), b = coord.get(nodes[i]); s += Math.hypot(b[0] - a[0], b[1] - a[1]); } return s; };
  for (const e of edges) e.len = len(e.nodes);
  const adj = new Map();
  edges.forEach((e, i) => { for (const [a, dir] of [[e.nodes[0], 1], [e.nodes.at(-1), -1]]) { if (!adj.has(a)) adj.set(a, []); adj.get(a).push([i, dir]); } });
  // enumerate simple cycles (graphs here are a few dozen edges); keep the one closest to the published lap length
  let best = null;
  const lo = targetM * 0.94, hi = targetM * 1.06;
  let budget = 400000;
  for (let start = 0; start < edges.length && budget > 0; start++) {
    const startNode = edges[start].nodes[0];
    const used = new Set([start]);
    const seenNodes = new Set([startNode]);
    const stack = [];
    const dfs = (node, total) => {
      if (--budget <= 0 || total > hi) return;
      for (const [ei, dir] of adj.get(node) || []) {
        if (used.has(ei) || ei < start) continue;
        const e = edges[ei];
        if (e.oneway && dir === -1) continue; // against a oneway in this traversal
        const next = dir === 1 ? e.nodes.at(-1) : e.nodes[0];
        const t = total + e.len;
        if (next === startNode) {
          if (t >= lo && t <= hi && (!best || Math.abs(t - targetM) < Math.abs(best.total - targetM))) best = { total: t, chain: [[start, 1], ...stack, [ei, dir]] };
          continue;
        }
        if (seenNodes.has(next)) continue;
        used.add(ei); seenNodes.add(next); stack.push([ei, dir]);
        dfs(next, t);
        used.delete(ei); seenNodes.delete(next); stack.pop();
      }
    };
    const s0 = edges[start];
    if (s0.oneway || true) { used.add(start); seenNodes.add(s0.nodes.at(-1)); dfs(s0.nodes.at(-1), s0.len); }
  }
  if (!best) return null;
  const nodes = [];
  for (const [ei, dir] of best.chain) { const ns = dir === 1 ? edges[ei].nodes : [...edges[ei].nodes].reverse(); nodes.push(...(nodes.length ? ns.slice(1) : ns)); }
  const onewayHits = best.chain.filter(([ei]) => edges[ei].oneway).length;
  let pts = nodes.map((n) => coord.get(n));
  const pit = ways.filter((w) => isPit(w) && w.geometry?.length >= 2).sort((a, b) => b.geometry.length - a.geometry.length)[0];
  return {
    path: pts,
    osm_way_ids: [...new Set(best.chain.map(([ei]) => edges[ei].way).filter((x) => x !== 'bridge'))],
    bridges_m: best.chain.filter(([ei]) => edges[ei].way === 'bridge').map(([ei]) => Math.round(edges[ei].len)),
    length_m: best.total,
    direction_basis: onewayHits ? `oneway tags on ${onewayHits}/${best.chain.length} segments` : 'unknown (no oneway tags)',
    pit: pit ? pit.geometry.map((g) => proj(g.lat, g.lon)) : null,
    pit_way: pit?.id ?? null,
  };
}

// resample to ~even spacing, so s (metres along the loop) maps to a point by index
export function resample(pts, step = 10) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const d = Math.hypot(bx - ax, by - ay);
    let t = step - carry;
    while (t <= d) { out.push([ax + ((bx - ax) * t) / d, ay + ((by - ay) * t) / d]); t += step; }
    carry = (carry + d) % step;
  }
  return out;
}

// timing line: OSM rarely maps it. Basis = the point on the loop nearest the middle of the pit lane (the pit straight),
// declared as an estimate. Corners: curvature peaks (turning > 25° within 60 m), numbered only when our count equals the
// circuit's official turn count.
export function annotate(loop, turns) {
  const P = resample(loop.path, 10);
  let s0 = 0, basis = 'estimate: path start (no pit lane mapped)';
  if (loop.pit) {
    const mid = loop.pit[Math.floor(loop.pit.length / 2)];
    let bi = 0, bd = Infinity;
    P.forEach((p, i) => { const d = Math.hypot(p[0] - mid[0], p[1] - mid[1]); if (d < bd) { bd = d; bi = i; } });
    s0 = bi; basis = `estimate: loop point nearest the pit-lane midpoint (${Math.round(bd)} m away)`;
  }
  const path = [...P.slice(s0), ...P.slice(0, s0)];
  const n = path.length;
  const heading = (i) => { const a = path[(i - 3 + n) % n], b = path[(i + 3) % n]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
  const turn = [];
  for (let i = 0; i < n; i++) { let d = heading((i + 1) % n) - heading(i); d = Math.atan2(Math.sin(d), Math.cos(d)); turn.push(d); }
  const W = 6; // 60 m window
  const win = turn.map((_, i) => { let s = 0; for (let k = -W; k <= W; k++) s += turn[(i + k + n) % n]; return s; });
  const corners = [];
  for (let i = 0; i < n; i++) {
    const v = Math.abs(win[i]);
    if (v < (25 * Math.PI) / 180) continue;
    let peak = true;
    for (let k = -W; k <= W; k++) if (k && Math.abs(win[(i + k + n) % n]) > v) { peak = false; break; }
    if (peak && !corners.some((c) => Math.abs(c.i - i) < W * 2)) corners.push({ i, dir: Math.sign(win[i]) });
  }
  const numbered = Number.isInteger(turns) && corners.length === turns;
  // y up: flip so north is up on screen is the renderer's job; store metres
  return {
    path: path.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]),
    timing_line: { s: 0, basis },
    corners: corners.map((c, k) => ({ s: c.i * 10, x: Math.round(path[c.i][0]), y: Math.round(path[c.i][1]), dir: c.dir > 0 ? 'left' : 'right', n: numbered ? k + 1 : null })),
    corner_numbering: numbered ? `matches the official ${turns} turns` : `not numbered: detected ${corners.length} vs official ${turns ?? 'unknown'}`,
  };
}

async function main() {
  const report = [];
  for (const c of todo) {
    console.error(`[${new Date().toISOString().slice(11, 19)}] ${c.slug}`);
    const target = c.length_km ? c.length_km * 1000 : null;
    if (!target) { report.push({ slug: c.slug, ok: false, reason: 'no published lap length' }); continue; }
    let loop = null, ways = [];
    for (const radius of [2500, 4000]) {
      ways = await osmMap(c.lat, c.lon, radius).catch((e) => { console.error(`  ${e.message}; falling back to Overpass`); return overpass(c.lat, c.lon, radius); }).catch((e) => { report.push({ slug: c.slug, ok: false, reason: e.message }); return null; });
      if (!ways) break;
      loop = buildLoop(ways, target, [c.lat, c.lon]);
      if (loop) break;
      await sleep(10000);
    }
    if (!ways) continue;
    if (!loop) { report.push({ slug: c.slug, ok: false, reason: `no closed raceway loop within ±6% of ${target} m (${ways.length} ways)` }); await sleep(10000); continue; }
    const a = annotate(loop, c.turns);
    const doc = {
      slug: c.slug, name: c.name, source: 'openstreetmap', licence: 'ODbL 1.0', attribution: '© OpenStreetMap contributors',
      osm_way_ids: loop.osm_way_ids, bridges_m: loop.bridges_m, pit_way_id: loop.pit_way, length_m: Math.round(loop.length_m), target_m: target,
      length_delta_pct: Math.round(((loop.length_m - target) / target) * 1000) / 10, direction_basis: loop.direction_basis,
      ...a, pit: loop.pit ? loop.pit.map(([x, y]) => [Math.round(x), Math.round(y)]) : null, built_at: new Date().toISOString(), builder: 'f1-circuit-geometry@1',
    };
    fs.writeFileSync(path.join(OUT, `${c.slug}.json`), JSON.stringify(doc));
    report.push({ slug: c.slug, ok: true, length_m: doc.length_m, target_m: target, delta_pct: doc.length_delta_pct, corners: doc.corners.length, turns: c.turns, numbering: doc.corner_numbering, pit: !!doc.pit, direction: doc.direction_basis });
    console.log(JSON.stringify(report.at(-1)));
    await sleep(10000);
  }
  fs.writeFileSync(path.join(OUT, '_report.json'), JSON.stringify(report, null, 2));
  console.log(`geometry: ${report.filter((r) => r.ok).length}/${report.length} circuits`);
  for (const r of report.filter((x) => !x.ok)) console.log('MISSING', r.slug, r.reason);
}
import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
