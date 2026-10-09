// F1 Race Picks V1 — walk-forward tuning + evaluation (docs/picks/PROTOCOL.md).
//   node scripts/picks/evaluate.mjs --stage tune            hyperparameters + PL scales on 2014-2019 only
//   node scripts/picks/evaluate.mjs --stage eval            validation 2020-2022 (frozen PARAMS)
//   node scripts/picks/evaluate.mjs --stage eval --holdout  + holdout 2023 → 2026 (run ONCE)
// Reads data/normalized (local, never committed). Writes metrics JSON to --out (default docs/picks/).
import fs from 'node:fs';
import path from 'node:path';
import { PARAMS, MODEL_VERSION, newState, observeEvent, strengths, dnfProb, plLogLik, pairProb, predictEvent, simulateRace, winnerDistribution, rankScore, postStrength, raceClassified, raceStarted, canonicalFromNormalized, isCompleted, seedOf, mulberry32 } from '../../src/picks/model.mjs';

const args = process.argv.slice(2);
const arg = (k, d = null) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const STAGE = arg('--stage', 'eval');
const HOLDOUT = args.includes('--holdout');
const OUT = arg('--out', 'docs/picks');
const SIMS = Number(arg('--sims', 20000));
const IN = path.resolve('data/normalized');
const load = (n) => JSON.parse(fs.readFileSync(path.join(IN, n + '.json'), 'utf8'));

const FOLD = (y) => (y < 2014 ? 'warmup' : y <= 2019 ? 'tune' : y <= 2022 ? 'validation' : 'holdout');
const all = canonicalFromNormalized({ events: load('events'), sessions: load('sessions'), results: load('classifications') })
  .filter((e) => e.season >= 2006 && isCompleted(e));
console.error(`events 2006+: ${all.length} (tune ${all.filter((e) => FOLD(e.season) === 'tune').length}, validation ${all.filter((e) => FOLD(e.season) === 'validation').length}, holdout ${all.filter((e) => FOLD(e.season) === 'holdout').length})`);

// ---------- baseline features (parameter-free, pre-event) ----------
function baselineFeatures(events) {
  const feats = {};
  let season = null, carPts = {}, drvPts = {}, prevCarFinal = {}, prevDrvFinal = {}, prevRace = null, pairSeason = {};
  const rankMap = (pts) => { const ids = Object.keys(pts).sort((a, b) => pts[b] - pts[a]); return Object.fromEntries(ids.map((id, i) => [id, { rank: i + 1, n: ids.length }])); };
  for (const ev of events) {
    if (ev.season !== season) { prevCarFinal = carPts; prevDrvFinal = drvPts; carPts = {}; drvPts = {}; pairSeason = {}; season = ev.season; }
    const carRank = rankMap(Object.keys(carPts).length ? carPts : prevCarFinal);
    const drvRank = rankMap(Object.keys(drvPts).length ? drvPts : prevDrvFinal);
    const prevPos = {};
    if (prevRace) { const rows = prevRace.race.filter((r) => Number.isInteger(r.pos)); for (const r of rows) prevPos[r.driver] = { pos: r.pos, n: rows.length }; }
    feats[ev.id] = { carRank, drvRank, prevPos, pairSeason: JSON.parse(JSON.stringify(pairSeason)) };
    // update after the event
    for (const r of ev.race) { if (r.car) carPts[r.car] = (carPts[r.car] || 0) + (r.points || 0); drvPts[r.driver] = (drvPts[r.driver] || 0) + (r.points || 0); }
    for (const p of teammatePairs(ev)) {
      const k = `${p.a}|${p.b}`;
      const ps = (pairSeason[k] ||= { qa: 0, qn: 0, ra: 0, rn: 0 });
      if (p.quali != null) { ps.qn++; if (p.quali === 1) ps.qa++; }
      if (p.race != null) { ps.rn++; if (p.race === 1) ps.ra++; }
    }
    prevRace = ev;
  }
  return feats;
}
const bottom = (n) => rankScore(n + 1, n + 1);
const BASELINES = {
  uniform: () => 0,
  constructor_standing: (f, e) => { const r = f.carRank[e.car]; const n = Object.keys(f.carRank).length || 10; return r ? rankScore(r.rank, n + 1) : bottom(n); },
  driver_standing: (f, e) => { const r = f.drvRank[e.driver]; const n = Object.keys(f.drvRank).length || 20; return r ? rankScore(r.rank, n + 1) : bottom(n); },
  previous_race: (f, e) => { const r = f.prevPos[e.driver]; const n = Object.values(f.prevPos)[0]?.n || 20; return r ? rankScore(r.pos, n + 1) : bottom(n); },
};

// ---------- outcome contracts ----------
/** Teammate pairs (exactly two race entrants of one car), a < b by id. quali/race = 1 (a ahead), 0 (b ahead), null (VOID). */
function teammatePairs(ev) {
  const byCar = {};
  for (const r of ev.race) if (r.car) (byCar[r.car] ||= []).push(r);
  const qBy = Object.fromEntries(ev.quali.map((r) => [r.driver, r]));
  const out = [];
  for (const [car, rows] of Object.entries(byCar)) {
    if (rows.length !== 2) continue;
    const [a, b] = [...rows].sort((x, y) => (x.driver < y.driver ? -1 : 1));
    const qa = qBy[a.driver]?.pos, qb = qBy[b.driver]?.pos;
    const quali = Number.isInteger(qa) && Number.isInteger(qb) && qa !== qb ? (qa < qb ? 1 : 0) : null;
    const race = raceClassified(a) && raceClassified(b) && a.pos !== b.pos ? (a.pos < b.pos ? 1 : 0) : null;
    out.push({ car, a: a.driver, b: b.driver, quali, race, qa, qb });
  }
  return out;
}
const entrantsOf = (ev) => ev.race.filter((r) => r.car).map((r) => ({ driver: r.driver, car: r.car }));
const qualiPosOf = (ev) => Object.fromEntries(ev.quali.filter((r) => Number.isInteger(r.pos)).map((r) => [r.driver, r.pos]));
const winnerOf = (ev) => ev.race.find((r) => raceClassified(r) && r.pos === 1)?.driver || null;

// ---------- metrics ----------
const clip = (p) => Math.min(1 - 1e-6, Math.max(1e-6, p));
const binLoss = (p, y) => -(y ? Math.log(clip(p)) : Math.log(clip(1 - p)));
function binary(rows) { // rows: {p, y, ev}
  const n = rows.length;
  if (!n) return { n: 0 };
  const ll = rows.reduce((s, r) => s + binLoss(r.p, r.y), 0) / n;
  const brier = rows.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / n;
  const acc = rows.filter((r) => (r.p >= 0.5 ? 1 : 0) === r.y).length / n;
  const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0, p: 0, y: 0 }));
  for (const r of rows) { const b = bins[Math.min(9, Math.floor(r.p * 10))]; b.n++; b.p += r.p; b.y += r.y; }
  const ece = bins.reduce((s, b) => s + (b.n ? (b.n / n) * Math.abs(b.p / b.n - b.y / b.n) : 0), 0);
  return { n, log_loss: r4(ll), brier: r4(brier), accuracy: r4(acc), ece: r4(ece), reliability: bins.filter((b) => b.n).map((b) => ({ bin: `${b.lo.toFixed(1)}-${b.hi.toFixed(1)}`, n: b.n, mean_p: r4(b.p / b.n), observed: r4(b.y / b.n) })) };
}
const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000);
function winner(rows) { // rows: {probs: {driver:p}, other, winner, ev}
  const n = rows.length;
  if (!n) return { n: 0 };
  let ll = 0, brier = 0, top1 = 0, top3 = 0;
  const cal = [];
  for (const r of rows) {
    const p = r.probs[r.winner] ?? r.other;
    ll += -Math.log(clip(p));
    let b = 0;
    for (const [d, q] of Object.entries(r.probs)) { const y = d === r.winner ? 1 : 0; b += (q - y) ** 2; cal.push({ p: q, y }); }
    brier += b + (r.probs[r.winner] == null ? (r.other - 1) ** 2 : r.other ** 2);
    const order = Object.entries(r.probs).sort((a, b2) => b2[1] - a[1]).map((x) => x[0]);
    if (order[0] === r.winner) top1++;
    if (order.slice(0, 3).includes(r.winner)) top3++;
  }
  const c = binary(cal);
  return { n, log_loss: r4(ll / n), brier: r4(brier / n), top1: r4(top1 / n), top1_hits: top1, top3: r4(top3 / n), top3_hits: top3, ece: c.ece, reliability: c.reliability };
}
function bootstrapDiff(perEventA, perEventB, reps = 2000, seed = 7) { // per-event mean loss arrays (aligned)
  const rnd = mulberry32(seed);
  const n = perEventA.length;
  const d = perEventA.map((a, i) => a - perEventB[i]);
  const mean = d.reduce((s, x) => s + x, 0) / n;
  const ms = [];
  for (let k = 0; k < reps; k++) { let s = 0; for (let i = 0; i < n; i++) s += d[Math.floor(rnd() * n)]; ms.push(s / n); }
  ms.sort((a, b) => a - b);
  return { mean_diff: r4(mean), ci95: [r4(ms[Math.floor(0.025 * reps)]), r4(ms[Math.floor(0.975 * reps)])], n_events: n };
}

// ---------- TUNE ----------
const BETAS = Array.from({ length: 31 }, (_, i) => Math.round((0.3 + i * 0.1) * 10) / 10);
function tune() {
  const grid = [];
  // round 1 (2014-2019): aCar 0.25 / carry 0.85 / wC 0.5 hit grid edges → grid extended once (still tuning folds only)
  for (const aCar of [0.1, 0.15, 0.25, 0.4]) for (const carry of [0.6, 0.85, 0.95, 1]) for (const lD of [0.9, 0.97]) for (const kD of [2, 6]) for (const mixR of [0.4, 0.7, 1]) for (const wDr of [0.6, 1]) for (const wC of [0, 0.5, 1]) for (const kC of [4, 10]) grid.push({ aCar, carry, lD, kD, mixR, wDr, wC, kC });
  let best = null;
  const t0 = Date.now();
  for (const g of grid) {
    const P = { ...PARAMS, ...g };
    const st = newState();
    const llq = new Float64Array(BETAS.length), llr = new Float64Array(BETAS.length);
    for (const ev of all) {
      if (FOLD(ev.season) === 'tune') {
        const q = ev.quali.filter((r) => Number.isInteger(r.pos) && r.car).sort((a, b) => a.pos - b.pos);
        const sq = q.map((r) => strengths(st, r, P).quali);
        const cl = ev.race.filter((r) => raceClassified(r) && r.car).sort((a, b) => a.pos - b.pos);
        const sr = cl.map((r) => strengths(st, r, P, ev.circuit_id).race);
        BETAS.forEach((b, i) => { if (sq.length >= 4) llq[i] += plLogLik(sq, b); if (sr.length >= 4) llr[i] += plLogLik(sr, b); });
      }
      observeEvent(st, ev, P);
    }
    const iq = llq.indexOf(Math.max(...llq)), ir = llr.indexOf(Math.max(...llr));
    const score = llq[iq] + llr[ir];
    if (!best || score > best.score) best = { score, g, betaQ: BETAS[iq], betaR: BETAS[ir], llq: llq[iq], llr: llr[ir] };
  }
  console.error(`grid ${grid.length} configs in ${((Date.now() - t0) / 1000).toFixed(1)}s; best`, JSON.stringify(best));
  const P1 = { ...PARAMS, ...best.g, betaQ: best.betaQ, betaR: best.betaR };
  // post-qualifying: wGrid x betaRP on race PL with the official qualifying classification
  let bestPost = null;
  for (const wGrid of [0, 0.3, 0.5, 0.8, 1, 1.3, 1.6, 2, 2.5]) {
    const P = { ...P1, wGrid };
    const st = newState();
    const ll = new Float64Array(BETAS.length);
    for (const ev of all) {
      if (FOLD(ev.season) === 'tune') {
        const qp = qualiPosOf(ev), nQ = Object.keys(qp).length, nE = entrantsOf(ev).length;
        const cl = ev.race.filter((r) => raceClassified(r) && r.car).sort((a, b) => a.pos - b.pos);
        const s = cl.map((r) => postStrength(strengths(st, r, P, ev.circuit_id).race, qp[r.driver], nQ, nE, P));
        if (s.length >= 4) BETAS.forEach((b, i) => { ll[i] += plLogLik(s, b); });
      }
      observeEvent(st, ev, P);
    }
    const i = ll.indexOf(Math.max(...ll));
    if (!bestPost || ll[i] > bestPost.ll) bestPost = { ll: ll[i], wGrid, betaRP: BETAS[i] };
  }
  console.error('post', JSON.stringify(bestPost));
  // reliability: Bernoulli log-likelihood of retirement among starters
  let bestRel = null;
  for (const lR of [0.9, 0.95, 0.97, 0.99]) for (const kR of [5, 10, 20, 50]) {
    const P = { ...P1, lR, kR };
    const st = newState();
    let ll = 0;
    for (const ev of all) {
      if (FOLD(ev.season) === 'tune') for (const r of ev.race) if (r.car && raceStarted(r)) ll -= binLoss(dnfProb(st, r.car, P), raceClassified(r) ? 0 : 1);
      observeEvent(st, ev, P);
    }
    if (!bestRel || ll > bestRel.ll) bestRel = { ll, lR, kR };
  }
  console.error('reliability', JSON.stringify(bestRel));
  // baselines: PL scale per baseline (pre) and the grid baseline (post), race classified order, tuning folds
  const feats = baselineFeatures(all);
  const baseBeta = {};
  for (const [name, fn] of Object.entries({ ...BASELINES, grid: null })) {
    if (name === 'uniform') { baseBeta[name] = 1; continue; }
    const ll = new Float64Array(BETAS.length);
    for (const ev of all) {
      if (FOLD(ev.season) !== 'tune') continue;
      const cl = ev.race.filter((r) => raceClassified(r) && r.car).sort((a, b) => a.pos - b.pos);
      const qp = qualiPosOf(ev), nQ = Object.keys(qp).length, nE = entrantsOf(ev).length;
      const s = cl.map((r) => (fn ? fn(feats[ev.id], r) : postStrength(0, qp[r.driver], nQ, nE, { wGrid: 1 })));
      if (s.length >= 4) BETAS.forEach((b, i) => { ll[i] += plLogLik(s, b); });
    }
    baseBeta[name] = BETAS[ll.indexOf(Math.max(...ll))];
  }
  // qualified-ahead constant for the post-qualifying teammate race baseline
  let qaN = 0, qaW = 0;
  for (const ev of all) if (FOLD(ev.season) === 'tune') for (const p of teammatePairs(ev)) if (p.race != null && p.quali != null) { qaN++; if (p.race === p.quali) qaW++; }
  const out = { stage: 'tune', model_version: MODEL_VERSION, folds: 'tune=2014-2019', grid_size: grid.length, params: { ...P1, wGrid: bestPost.wGrid, betaRP: bestPost.betaRP, lR: bestRel.lR, kR: bestRel.kR }, baseline_beta: baseBeta, qualified_ahead_race_p: r4(qaW / qaN), qualified_ahead_n: qaN, generated_at: new Date().toISOString() };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'tuning-v1.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
}

// ---------- EVAL ----------
function evaluate() {
  const tuning = JSON.parse(fs.readFileSync(path.join(OUT, 'tuning-v1.json'), 'utf8'));
  for (const k of Object.keys(tuning.params)) if (k in PARAMS && PARAMS[k] !== tuning.params[k]) throw new Error(`PARAMS.${k}=${PARAMS[k]} differs from tuning ${tuning.params[k]}: freeze the tuned values in src/picks/model.mjs first`);
  const P = PARAMS;
  const BB = tuning.baseline_beta;
  const feats = baselineFeatures(all);
  const folds = HOLDOUT ? ['validation', 'holdout'] : ['validation'];
  const R = Object.fromEntries(folds.map((f) => [f, { events: 0, win: {}, top10: {}, podium: {}, mae: {}, h2hq: {}, h2hr: {}, perEvent: {}, nonchalk: { win: { n: 0, model: 0, favorite: 0 }, h2hq: { n: 0, model: 0, record: 0 }, h2hr: { n: 0, model: 0, record: 0 } }, voids: { h2hq: 0, h2hr: 0, top10: 0 } }]));
  const push = (o, k, v) => (o[k] ||= []).push(v);
  const st = newState();
  const t0 = Date.now();
  for (const ev of all) {
    const fold = FOLD(ev.season);
    if (R[fold]) {
      const A = R[fold];
      A.events++;
      const f = feats[ev.id];
      const ents = entrantsOf(ev);
      const qp = qualiPosOf(ev);
      const w = winnerOf(ev);
      const preds = {
        'model:pre': predictEvent(st, { event_id: ev.id, circuit_id: ev.circuit_id, entrants: ents }, P, { sims: SIMS }),
        'model:post': predictEvent(st, { event_id: ev.id, circuit_id: ev.circuit_id, entrants: ents, qualiPos: qp }, P, { sims: SIMS }),
      };
      const nQ = Object.keys(qp).length;
      for (const [name, fn] of Object.entries({ ...BASELINES, grid: null })) {
        const field = ents.map((e) => ({ ...e, s: fn ? fn(f, e) : postStrength(0, qp[e.driver], nQ, ents.length, { wGrid: 1 }), p_dnf: dnfProb(st, e.car, P) }));
        const sim = simulateRace(field, { beta: BB[name], sims: SIMS, seed: seedOf(`${ev.id}|${name}`) });
        const wd = winnerDistribution(sim, SIMS, P.otherMass);
        preds[`${name}:${name === 'grid' ? 'post' : 'pre'}`] = { drivers: field.map((x, i) => ({ driver: x.driver, p_win: wd.probs[i], p_top10: sim[i].p_top10, p_podium: sim[i].p_podium, exp_rank: sim[i].exp_rank })), other_mass: wd.other };
      }
      const byDrv = Object.fromEntries(ev.race.map((r) => [r.driver, r]));
      for (const [key, pr] of Object.entries(preds)) {
        const ll = [];
        if (w) {
          push(A.win, key, { probs: Object.fromEntries(pr.drivers.map((d) => [d.driver, d.p_win])), other: pr.other_mass, winner: w });
          ll.push(-Math.log(clip(pr.drivers.find((d) => d.driver === w)?.p_win ?? pr.other_mass)));
        }
        let mae = 0, mn = 0;
        for (const d of pr.drivers) {
          const r = byDrv[d.driver];
          if (!raceStarted(r)) { if (key === 'model:pre') A.voids.top10++; continue; }
          const y10 = raceClassified(r) && r.pos <= 10 ? 1 : 0, y3 = raceClassified(r) && r.pos <= 3 ? 1 : 0;
          push(A.top10, key, { p: d.p_top10, y: y10, ev: ev.id });
          push(A.podium, key, { p: d.p_podium, y: y3, ev: ev.id });
          if (raceClassified(r) && d.exp_rank != null) { mae += Math.abs(d.exp_rank - r.pos); mn++; }
        }
        if (mn) push(A.mae, key, { sum: mae, n: mn });
        (A.perEvent[`win|${key}`] ||= []).push(ll[0] ?? null);
      }
      // favorite / non-chalk winner
      const fav = Object.entries(f.drvRank).sort((a, b) => a[1].rank - b[1].rank).map((x) => x[0]).find((d) => ents.some((e) => e.driver === d));
      const mTop = [...preds['model:pre'].drivers].sort((a, b) => b.p_win - a.p_win)[0].driver;
      push(A.win, 'favorite:pre', { top1only: true, hit: fav === w });
      if (fav && mTop !== fav) { A.nonchalk.win.n++; if (mTop === w) A.nonchalk.win.model++; if (fav === w) A.nonchalk.win.favorite++; }
      // teammate H2H
      const pairs = teammatePairs(ev);
      const mp = Object.fromEntries(preds['model:pre'].pairs.map((p) => [`${p.a}|${p.b}`, p]));
      const mpp = Object.fromEntries(preds['model:post'].pairs.map((p) => [`${p.a}|${p.b}`, p]));
      for (const p of pairs) {
        const k = `${p.a}|${p.b}`, rec = f.pairSeason[k] || { qa: 0, qn: 0, ra: 0, rn: 0 };
        const recQ = (rec.qa + 1) / (rec.qn + 2), recR = (rec.ra + 1) / (rec.rn + 2);
        if (p.quali == null) A.voids.h2hq++;
        else if (mp[k]) {
          push(A.h2hq, 'model:pre', { p: mp[k].p_a_quali, y: p.quali, ev: ev.id });
          push(A.h2hq, 'coin:pre', { p: 0.5, y: p.quali, ev: ev.id });
          push(A.h2hq, 'record:pre', { p: recQ, y: p.quali, ev: ev.id });
          if (recQ !== 0.5 && (mp[k].p_a_quali >= 0.5) !== (recQ > 0.5)) { A.nonchalk.h2hq.n++; if ((mp[k].p_a_quali >= 0.5 ? 1 : 0) === p.quali) A.nonchalk.h2hq.model++; if ((recQ > 0.5 ? 1 : 0) === p.quali) A.nonchalk.h2hq.record++; }
        }
        if (p.race == null) A.voids.h2hr++;
        else if (mp[k]) {
          push(A.h2hr, 'model:pre', { p: mp[k].p_a_race, y: p.race, ev: ev.id });
          push(A.h2hr, 'model:post', { p: mpp[k].p_a_race, y: p.race, ev: ev.id });
          push(A.h2hr, 'coin:pre', { p: 0.5, y: p.race, ev: ev.id });
          push(A.h2hr, 'record:pre', { p: recR, y: p.race, ev: ev.id });
          const qa = tuning.qualified_ahead_race_p;
          push(A.h2hr, 'qualified_ahead:post', { p: p.quali == null ? 0.5 : p.quali === 1 ? qa : 1 - qa, y: p.race, ev: ev.id });
          if (recR !== 0.5 && (mp[k].p_a_race >= 0.5) !== (recR > 0.5)) { A.nonchalk.h2hr.n++; if ((mp[k].p_a_race >= 0.5 ? 1 : 0) === p.race) A.nonchalk.h2hr.model++; if ((recR > 0.5 ? 1 : 0) === p.race) A.nonchalk.h2hr.record++; }
        }
      }
    }
    observeEvent(st, ev, P);
  }
  console.error(`eval ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  // ---------- summarize + gate ----------
  const report = { model_version: MODEL_VERSION, generated_at: new Date().toISOString(), sims: SIMS, params: P, baseline_beta: BB, folds: {} };
  const perEventBinary = (rows) => { const m = {}; for (const r of rows) (m[r.ev] ||= []).push(binLoss(r.p, r.y)); return m; };
  const gateBinary = (fam, rows, version) => {
    const keys = Object.keys(rows).filter((k) => k.endsWith(':' + version) || (version === 'post' && k.endsWith(':pre') && !k.startsWith('model')));
    const model = `model:${version}`;
    if (!rows[model]) return null;
    const mets = Object.fromEntries(keys.map((k) => [k, binary(rows[k]).log_loss]));
    const bases = keys.filter((k) => k !== model && !k.startsWith('model'));
    const best = bases.sort((a, b) => mets[a] - mets[b])[0];
    const pm = perEventBinary(rows[model]), pb = perEventBinary(rows[best]);
    const evs = Object.keys(pm);
    const bs = bootstrapDiff(evs.map((e) => mean(pm[e])), evs.map((e) => mean(pb[e])));
    return { family: fam, version, best_baseline: best, model_log_loss: mets[model], best_baseline_log_loss: mets[best], beats_all: bases.every((b) => mets[model] < mets[b]), bootstrap: bs, pass: bases.every((b) => mets[model] < mets[b]) && bs.ci95[1] < 0 };
  };
  for (const [fold, A] of Object.entries(R)) {
    const win = Object.fromEntries(Object.entries(A.win).map(([k, rows]) => [k, k.startsWith('favorite') ? { n: rows.length, top1: r4(rows.filter((r) => r.hit).length / rows.length), top1_hits: rows.filter((r) => r.hit).length } : winner(rows)]));
    const fam = {
      race_winner: win,
      top10: Object.fromEntries(Object.entries(A.top10).map(([k, v]) => [k, binary(v)])),
      podium: Object.fromEntries(Object.entries(A.podium).map(([k, v]) => [k, binary(v)])),
      projected_position_mae: Object.fromEntries(Object.entries(A.mae).map(([k, v]) => { const s = v.reduce((a, b) => a + b.sum, 0), n = v.reduce((a, b) => a + b.n, 0); return [k, { mae: r4(s / n), n }]; })),
      teammate_quali_h2h: Object.fromEntries(Object.entries(A.h2hq).map(([k, v]) => [k, binary(v)])),
      teammate_race_h2h: Object.fromEntries(Object.entries(A.h2hr).map(([k, v]) => [k, binary(v)])),
    };
    // event-level winner gate
    const winGate = (version) => {
      const model = `model:${version}`;
      const bases = Object.keys(win).filter((k) => !k.startsWith('model') && !k.startsWith('favorite') && (version === 'post' || k.endsWith(':pre')));
      const best = bases.sort((a, b) => win[a].log_loss - win[b].log_loss)[0];
      const a = A.perEvent[`win|${model}`], b = A.perEvent[`win|${best}`];
      const bs = bootstrapDiff(a, b);
      return { family: 'race_winner', version, best_baseline: best, model_log_loss: win[model].log_loss, best_baseline_log_loss: win[best].log_loss, beats_all: bases.every((x) => win[model].log_loss < win[x].log_loss), bootstrap: bs, pass: bases.every((x) => win[model].log_loss < win[x].log_loss) && bs.ci95[1] < 0 };
    };
    const binGate = (famName, rowsObj, version) => {
      const model = `model:${version}`;
      const bases = Object.keys(rowsObj).filter((k) => !k.startsWith('model') && (version === 'post' || k.endsWith(':pre')));
      const mets = Object.fromEntries([model, ...bases].map((k) => [k, binary(rowsObj[k]).log_loss]));
      const best = bases.sort((x, y) => mets[x] - mets[y])[0];
      // per-event mean loss: top10/podium rows carry no ev → aggregate by position in arrays of equal order
      const evKeyed = rowsObj[model][0]?.ev != null;
      let bs;
      if (evKeyed) { const pm = perEventBinary(rowsObj[model]), pb = perEventBinary(rowsObj[best]); const evs = Object.keys(pm); bs = bootstrapDiff(evs.map((e) => mean(pm[e])), evs.map((e) => mean(pb[e]))); }
      else bs = bootstrapDiff(rowsObj[model].map((r) => binLoss(r.p, r.y)), rowsObj[best].map((r) => binLoss(r.p, r.y)));
      return { family: famName, version, best_baseline: best, model_log_loss: mets[model], best_baseline_log_loss: mets[best], beats_all: bases.every((x) => mets[model] < mets[x]), bootstrap: bs, pass: bases.every((x) => mets[model] < mets[x]) && bs.ci95[1] < 0 };
    };
    const gates = [winGate('pre'), winGate('post'), binGate('top10', A.top10, 'pre'), binGate('top10', A.top10, 'post'), binGate('podium', A.podium, 'pre'), binGate('podium', A.podium, 'post'), binGate('teammate_quali_h2h', A.h2hq, 'pre'), binGate('teammate_race_h2h', A.h2hr, 'pre'), binGate('teammate_race_h2h', A.h2hr, 'post')];
    report.folds[fold] = { events: A.events, seasons: [...new Set(all.filter((e) => FOLD(e.season) === fold).map((e) => e.season))], voids: A.voids, families: fam, non_chalk: A.nonchalk, gates };
  }
  const name = HOLDOUT ? 'metrics-v1-holdout.json' : 'metrics-v1-validation.json';
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(report, null, 2) + '\n');
  // compact console table
  for (const [fold, F] of Object.entries(report.folds)) {
    console.log(`\n== ${fold} (${F.events} races, seasons ${F.seasons.join(',')}) ==`);
    for (const [k, v] of Object.entries(F.families.race_winner)) console.log(`winner ${k.padEnd(26)} n=${v.n} ll=${v.log_loss ?? '-'} brier=${v.brier ?? '-'} top1=${v.top1} top3=${v.top3 ?? '-'} ece=${v.ece ?? '-'}`);
    for (const fam of ['top10', 'podium', 'teammate_quali_h2h', 'teammate_race_h2h']) for (const [k, v] of Object.entries(F.families[fam])) console.log(`${fam} ${k.padEnd(24)} n=${v.n} ll=${v.log_loss} brier=${v.brier} acc=${v.accuracy} ece=${v.ece}`);
    for (const [k, v] of Object.entries(F.families.projected_position_mae)) console.log(`mae ${k.padEnd(24)} ${v.mae} n=${v.n}`);
    console.log('non-chalk', JSON.stringify(F.non_chalk), 'voids', JSON.stringify(F.voids));
    for (const g of F.gates) console.log(`GATE ${g.family}/${g.version}: ${g.pass ? 'PASS' : 'fail'} model ${g.model_log_loss} vs ${g.best_baseline} ${g.best_baseline_log_loss} diff ${g.bootstrap.mean_diff} ci ${g.bootstrap.ci95}`);
  }
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

if (STAGE === 'tune') tune();
else evaluate();
