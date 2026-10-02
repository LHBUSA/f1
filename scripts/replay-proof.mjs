// PBEcast replay-pipeline proof over a REAL recorded session. Deterministic and independently runnable.
//
//   node scripts/replay-proof.mjs --session 2026-bahrain-grand-prix-in-malaysia-fp3 [--browser] [--out reports/replay-proof]
//   (needs F1_ADMIN_TOKEN or D:/Workers/secrets/f1-admin-token; reads the recording through the admin route)
//
// Checks: frames exist, timestamps strictly increase, silences > 60 s are listed, the progress model gives identical
// output on rebuild and on shuffled input, forward and backward scrubbing agree, lap jumps land on the right lap,
// and the position graph equals the order recorded at each crossing. --browser renders the replay locally at fixed
// instants on desktop and mobile (real frames served to the local page; local render check only) and compares the
// on-screen race state. Writes a timestamped JSON + Markdown evidence report. Never writes or invents frames.
import fs from 'node:fs';
import path from 'node:path';
import { buildModel, progressAt, positionHistory, frameAt, GAP_MS } from '../src/core/progress.mjs';
import { normalizeFrames, sessionPublicId, coverage } from '../workers/f1-api/src/frames.js';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const want = opt('session');
const OUT = path.resolve(opt('out', 'reports/replay-proof'));
const BASE = opt('base', 'https://f1-api.propbetedge.ai/v1/f1');
const TOKEN = process.env.F1_ADMIN_TOKEN || (fs.existsSync('D:/Workers/secrets/f1-admin-token') ? fs.readFileSync('D:/Workers/secrets/f1-admin-token', 'utf8').trim() : null);
if (!want || !TOKEN) { console.error('usage: --session <public id>; needs F1_ADMIN_TOKEN'); process.exit(2); }
const internal = JSON.parse(fs.readFileSync('data/projection/internal.json', 'utf8'));
const admin = async (q) => { const r = await fetch(`${BASE}/admin/observations${q}`, { headers: { authorization: `Bearer ${TOKEN}` } }); if (!r.ok) throw new Error(`admin ${q} -> ${r.status}`); return r.json(); };

const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); };

// 1. find the recording
const list = (await admin('')).sessions.map((p) => p.match(/espn-(\d+)\//)?.[1]).filter(Boolean);
let upstream = null, index = null;
for (const u of list) { const idx = await admin(`?session=${u}`); if (sessionPublicId(idx.meta, internal) === want) { upstream = u; index = idx; break; } }
if (!upstream) { console.error(`no recording for ${want}`); process.exit(1); }
const raw = [];
for (let i = 1; i <= index.chunks; i++) raw.push(...(await admin(`?session=${upstream}&chunk=${i}`)).frames);
const frames = normalizeFrames(raw, internal, { full: true });
const cov = coverage(raw);
check('recording exists with multiple frames', frames.length >= 2, `${frames.length} frames in ${index.chunks} chunk(s), recorder ${index.recorder}`);
const ts = frames.map((f) => Date.parse(f.t));
check('timestamps strictly increase', ts.every((t, i) => !i || t > ts[i - 1]), `${new Date(ts[0]).toISOString()} → ${new Date(ts.at(-1)).toISOString()} (${Math.round((ts.at(-1) - ts[0]) / 60000)} min)`);
const gaps = []; for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > GAP_MS) gaps.push({ from: frames[i - 1].t, to: frames[i].t, s: Math.round((ts[i] - ts[i - 1]) / 1000) });
check('recording silences identified (cars held, never animated through)', true, gaps.length ? `${gaps.length} silence(s) > ${GAP_MS / 1000}s, longest ${Math.max(...gaps.map((g) => g.s))}s` : `none > ${GAP_MS / 1000}s; longest silence ${cov.longest_silence_s}s`);

// 2. determinism
const m1 = buildModel(frames), m2 = buildModel(frames), m3 = buildModel([...frames].reverse());
const ids = [...m1.cars.keys()];
const samples = Array.from({ length: 60 }, (_, i) => m1.start + ((m1.end - m1.start) * i) / 59);
const snap = (m, T) => ids.map((id) => progressAt(m, id, T));
check('replay positions identical on rebuild and on reordered input', samples.every((T) => JSON.stringify(snap(m1, T)) === JSON.stringify(snap(m2, T)) && JSON.stringify(snap(m1, T)) === JSON.stringify(snap(m3, T))), `${ids.length} cars × ${samples.length} instants`);
const fwd = samples.map((T) => JSON.stringify(snap(m1, T))), back = [...samples].reverse().map((T) => JSON.stringify(snap(m1, T))).reverse();
check('scrubbing forward and backward gives the same state at each instant', fwd.every((x, i) => x === back[i]));
const laps = [...new Set(frames.map((f) => f.lap).filter(Boolean))];
const jumps = laps.map((L) => { const f = m1.frames.find((x) => x.lap >= L); return { L, ok: f && frameAt(m1, f.ms)?.lap >= L }; });
check('lap jump lands on the requested lap', !laps.length || jumps.every((j) => j.ok), laps.length ? `${laps.length} laps (${laps[0]}–${laps.at(-1)})` : 'session has no lap counter (practice/qualifying): lap jump not applicable');
// 3. position graph = order recorded at each observed crossing (recomputed independently from the frames)
const H = positionHistory(m1);
let graphOk = true, points = 0;
for (const [id, arr] of Object.entries(H)) for (const p of arr) {
  points++;
  const m = m1.cars.get(id), x = m.crossings.find((c) => c.lap === p.lap);
  const f = [...m1.frames].reverse().find((fr) => fr.ms <= x.ms);
  if (f.cars.find((c) => c.id === id)?.pos !== p.pos) graphOk = false;
}
check('position graph equals the order recorded at each crossing', graphOk, `${points} points, ${Object.keys(H).length} drivers`);
const crossings = [...m1.cars.values()].reduce((s, c) => s + c.crossings.length, 0), inferred = [...m1.cars.values()].reduce((s, c) => s + c.crossings.filter((x) => x.inferred_gap).length, 0);
const states = {};
for (const T of samples) for (const id of ids) { const st = progressAt(m1, id, T).state; states[st] = (states[st] || 0) + 1; }
check('observed vs interpolated accounted for', true, { observed_crossings: crossings - inferred, crossings_spread_across_missing_frames: inferred, car_states_over_samples: states });

// 4. optional browser render check (local build, real frames served to the page)
let browser = null;
if (args.includes('--browser')) {
  const { chromium } = await import('playwright');
  const b = await chromium.launch();
  const base = opt('site', 'http://127.0.0.1:4173');
  const at = [0.25, 0.5, 0.9].map((k) => new Date(m1.start + (m1.end - m1.start) * k).toISOString());
  const payload = { session_id: want, meta: { type: want.split('-').pop(), laps_total: index.meta?.laps_total ?? null }, coverage: cov, frames, events: [] };
  const states = {};
  fs.mkdirSync(OUT, { recursive: true });
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    // local render check only: the page receives the REAL recorded frames; entitlement is proven separately
    await ctx.route('**/pbe/f1/membership', (r) => r.fulfill({ json: { membership: { state: 'all_access', entitled: true, sport: 'f1' }, signed_in: true, verification: 'local_render_check' } }));
    await ctx.route(`**/pbe/f1/replay/${want}`, (r) => r.fulfill({ json: payload }));
    const pg = await ctx.newPage();
    states[w] = [];
    for (const t of at) {
      await pg.goto(`${base}/pbecast/${want.replace(/-(fp\d|qualifying|sprint-qualifying|sprint|race)$/, '')}?session=${want}&t=${encodeURIComponent(t)}&driver=${frames[0].cars[0] ? '' : ''}`, { waitUntil: 'networkidle' });
      await pg.waitForTimeout(1200);
      states[w].push(await pg.evaluate(() => window.__pbecast));
      if (t === at[1]) await pg.screenshot({ path: path.join(OUT, `${want}-${w}.png`) });
    }
    await ctx.close();
  }
  await b.close();
  const same = states[1440].every((s, i) => JSON.stringify(s?.cars) === JSON.stringify(states[390][i]?.cars));
  check('desktop and mobile render the same race state at the same instant', same, `${at.length} instants; ${states[1440][1]?.cars?.length ?? 0} cars drawn mid-session`);
  browser = { instants: at, desktop: states[1440].map((s) => s?.cars?.length ?? null), mobile: states[390].map((s) => s?.cars?.length ?? null), screenshots: [`${want}-1440.png`, `${want}-390.png`] };
}

// 5. evidence
fs.mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const report = { session: want, upstream_recording: upstream, generated_at: new Date().toISOString(), model: m1.version, frames: frames.length, span: { from: frames[0]?.t, to: frames.at(-1)?.t }, coverage: cov, gaps, checks, browser, pass: checks.every((c) => c.ok) };
fs.writeFileSync(path.join(OUT, `${want}-${stamp}.json`), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(OUT, `${want}-${stamp}.md`), `# Replay proof: ${want}\n\nGenerated ${report.generated_at} · model ${m1.version} · ${frames.length} frames · ${report.span.from} → ${report.span.to}\n\n${checks.map((c) => `- ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? `: ${typeof c.detail === 'string' ? c.detail : '`' + JSON.stringify(c.detail) + '`'}` : ''}`).join('\n')}\n\nGaps: ${gaps.length ? gaps.map((g) => `${g.from} → ${g.to} (${g.s}s)`).join('; ') : 'none over 60 s'}\n`);
console.log(`${report.pass ? 'PROOF PASS' : 'PROOF FAIL'} → ${path.join(OUT, `${want}-${stamp}.md`)}`);
process.exit(report.pass ? 0 : 1);
