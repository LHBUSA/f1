// PBE F1 EDGE — time-safe as-of dataset builder + automated leakage audit.
//
//   node scripts/edge/build-dataset.mjs
//
// Writes data/edge/dataset.jsonl (gitignored; never commit data/), reports/edge/dataset-manifest.json and
// reports/edge/leakage-audit.json. Every feature is reconstructed from source sessions that started strictly before
// the event start (first session of the weekend). Exits non-zero if any audit check fails.
import fs from 'node:fs';
import path from 'node:path';
import { loadRaw, buildIndex, truncateRaw, ALLOWED_INPUTS, FORBIDDEN_INPUTS } from '../../src/edge/data.mjs';
import { eventFeatures, pairFeatures, FEATURE_VERSION, PAIR_FEATURES } from '../../src/edge/features.mjs';
import { BT_QUALI, BT_RACE } from '../../src/edge/bt.mjs';
import { sha256, stableStringify, rd } from '../../src/edge/util.mjs';

export const DATASET_VERSION = 'f1-edge-dataset@0.1.0';
const FIRST_SEASON = 2009; // first season with session-level qualifying classifications in the source
const ELIGIBLE_FROM = 2011; // two seasons of burn-in so as-of histories exist
const OUT_DATA = path.resolve('data/edge');
const OUT_REP = path.resolve('reports/edge');
fs.mkdirSync(OUT_DATA, { recursive: true });
fs.mkdirSync(OUT_REP, { recursive: true });

const iso = (t) => (t == null ? null : new Date(t).toISOString());
const roundObj = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? rd(v) : v]));
const DRIVER_KEYS = ['q_bt', 'r_bt', 'q_bt_driver', 'r_bt_driver', 'q_bt_car', 'r_bt_car', 'con_gap_pole', 'tm_gap_decay', 'drv_reliability', 'con_reliability', 'race_gains', 'points_before', 'champ_pos_before', 'log_starts', 'rookie', 'circ_pctl', 'cf_score'];

export function entrantsFor(idx, ev) {
  const qs = ev.quali_session_id ? idx.sessionById.get(ev.quali_session_id) : null;
  const rs = ev.race_session_id ? idx.sessionById.get(ev.race_session_id) : null;
  const m = new Map();
  for (const r of qs?.rows || []) if (r.pos != null) m.set(r.d, { d: r.d, c: r.c, L: r.L });
  for (const r of rs?.rows || []) if (r.participant) m.set(r.d, { d: r.d, c: r.c, L: r.L });
  return [...m.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
}

export function buildEventRows(idx, ev, F) {
  const rows = [];
  const qs = ev.quali_session_id ? idx.sessionById.get(ev.quali_session_id) : null;
  const rs = ev.race_session_id ? idx.sessionById.get(ev.race_session_id) : null;
  const base = {
    event_id: ev.id, season: ev.season, round: ev.round, circuit_id: ev.circuit_id,
    feature_as_of: iso(F.max_source_t), event_start: ev.start_iso,
  };
  const coverage = (extra) => ({ q123_stage_times: ev.season >= 2024, quali_session_level: true, ...extra });
  const ctx = (a, b) => ({ street: F.circuit.street, speed_class: F.circuit.speed_class, rookie_a: F.drivers[a].rookie, rookie_b: F.drivers[b].rookie, champ_basis: F.circuit.champ_basis });
  const eligible = ev.season >= ELIGIBLE_FROM;
  if (qs) {
    const q = qs.rows.filter((r) => r.pos != null && F.drivers[r.d]);
    for (let i = 0; i < q.length; i++) for (let j = i + 1; j < q.length; j++) {
      const A = q[i];
      const B = q[j];
      if (A.pos === B.pos) continue;
      rows.push({ ...base, target: 'quali_h2h', a: A.d, b: B.d, y: A.pos < B.pos ? 1 : 0, teammate: !!A.c && A.c === B.c, features: roundObj(pairFeatures(F, A.d, B.d)), context: ctx(A.d, B.d), source_coverage: coverage({ outcome_session: qs.id }), eligible });
    }
  }
  if (rs) {
    const r = rs.rows.filter((x) => x.started && F.drivers[x.d]);
    const n = r.length;
    const gridOf = (x) => (x.grid && x.grid > 0 ? x.grid : n + 1); // grid 0/null = pit-lane start = back of the grid
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      const A = r[i];
      const B = r[j];
      if (A.key === B.key) continue; // equal finishing key = void
      rows.push({
        ...base, target: 'race_h2h', a: A.d, b: B.d, y: A.key < B.key ? 1 : 0, teammate: !!A.c && A.c === B.c,
        features: roundObj(pairFeatures(F, A.d, B.d)), context: ctx(A.d, B.d),
        post_qualifying: { grid_a: gridOf(A), grid_b: gridOf(B), available_before: iso(ev.race_start_ms), source: 'race classification starting grid (published before the race start)' },
        source_coverage: coverage({ outcome_session: rs.id }), eligible,
      });
    }
    const fieldMean = Object.fromEntries(DRIVER_KEYS.map((k) => [k, r.reduce((s, x) => s + F.drivers[x.d][k], 0) / Math.max(1, n)]));
    for (const x of r) {
      const v = F.drivers[x.d];
      rows.push({
        ...base, target: 'top10', a: x.d, b: null, y: x.pos != null && x.pos <= 10 && x.status !== 'disqualified' ? 1 : 0, teammate: null,
        features: roundObj(Object.fromEntries(DRIVER_KEYS.map((k) => [k, v[k] - fieldMean[k]]))),
        context: { street: F.circuit.street, speed_class: F.circuit.speed_class, rookie_a: v.rookie, field_size: n },
        post_qualifying: { grid_a: gridOf(x), field_size: n, available_before: iso(ev.race_start_ms) },
        source_coverage: coverage({ outcome_session: rs.id }), eligible,
      });
    }
  }
  return rows;
}

export function eventsToBuild(idx) {
  return [...idx.events.values()]
    .filter((e) => e.status === 'completed' && e.round && e.season >= FIRST_SEASON && (idx.sessionById.has(e.quali_session_id) || idx.sessionById.has(e.race_session_id)))
    .sort((a, b) => a.start_ms - b.start_ms);
}

const snapshot = (F) => stableStringify({ max: F.max_source_t, circuit: F.circuit, drivers: Object.fromEntries(Object.entries(F.drivers).map(([d, v]) => [d, roundObj(v)])) });

function main() {
  const t0 = Date.now();
  const raw = loadRaw();
  const idx = buildIndex(raw);
  const evs = eventsToBuild(idx);
  const lines = [];
  const audit = { generated_by: 'scripts/edge/build-dataset.mjs', dataset_version: DATASET_VERSION, checks: {} };
  let leakRows = 0;
  let rowsChecked = 0;
  const snapshots = new Map();
  for (const ev of evs) {
    const entrants = entrantsFor(idx, ev);
    const F = eventFeatures(idx, ev, entrants);
    snapshots.set(ev.id, { F, entrants });
    if (F.max_source_t != null && !(F.max_source_t < ev.start_ms)) throw new Error(`leak: ${ev.id} max_source_t >= event_start`);
    if (Number.isFinite(F.bt_max_t) && !(F.bt_max_t < ev.start_ms)) throw new Error(`leak: ${ev.id} bt source >= event_start`);
    for (const row of buildEventRows(idx, ev, F)) {
      rowsChecked++;
      if (row.feature_as_of && !(Date.parse(row.feature_as_of) < Date.parse(row.event_start))) leakRows++;
      if (row.post_qualifying && ev.race_start_ms && !(ev.start_ms <= ev.race_start_ms)) leakRows++;
      lines.push(stableStringify(row));
    }
  }
  const body = lines.join('\n') + '\n';
  fs.writeFileSync(path.join(OUT_DATA, 'dataset.jsonl'), body);
  const datasetSha = sha256(body);
  audit.checks.feature_as_of_before_event_start = { rows_checked: rowsChecked, violations: leakRows, pass: leakRows === 0 };

  // Truncation recompute: rebuild features for sampled events from a copy of the source with every session at or
  // after the event start deleted. Identical output proves no feature can see the future.
  const sample = evs.filter((_, i) => i % 25 === 0 || i === evs.length - 1);
  const trunc = [];
  for (const ev of sample) {
    const { F, entrants } = snapshots.get(ev.id);
    const idxT = buildIndex(truncateRaw(raw, ev.start_ms));
    const FT = eventFeatures(idxT, ev, entrants);
    const FR = eventFeatures(idx, ev, entrants); // second full recompute (determinism)
    trunc.push({ event_id: ev.id, season: ev.season, round: ev.round, identical_truncated: snapshot(F) === snapshot(FT), identical_recompute: snapshot(F) === snapshot(FR) });
  }
  audit.checks.truncated_recompute = { events: trunc.length, identical: trunc.filter((x) => x.identical_truncated && x.identical_recompute).length, pass: trunc.every((x) => x.identical_truncated && x.identical_recompute), sample: trunc.map((x) => `${x.season}-R${x.round}`) };

  // Negative control: shift the cutoff one week PAST the event start (target results enter history). The truncation
  // comparison must now FAIL, proving the audit detects leakage rather than passing vacuously.
  const neg = sample.slice(1, 4).map((ev) => {
    const { entrants } = snapshots.get(ev.id);
    const leaky = { ...ev, id: ev.id + '#negative-control', start_ms: ev.start_ms + 7 * 86400000 };
    const FL = eventFeatures(idx, leaky, entrants);
    const FT = eventFeatures(buildIndex(truncateRaw(raw, ev.start_ms)), leaky, entrants);
    return { event_id: ev.id, detected: snapshot(FL) !== snapshot(FT) };
  });
  audit.checks.negative_control_detects_leak = { cases: neg.length, detected: neg.filter((x) => x.detected).length, pass: neg.every((x) => x.detected) };

  // Static input check: the loader reads only allow-listed source tables, never end-of-season standings or derived
  // aggregates built with today's data; edge feature/model code never touches the filesystem.
  const loaded = Object.keys(raw).sort();
  const allowed = [...ALLOWED_INPUTS.normalized, ...ALLOWED_INPUTS.derived.map((n) => 'derived_' + n)].sort();
  const srcFiles = ['features.mjs', 'bt.mjs', 'models.mjs', 'util.mjs'].map((f) => path.resolve('src/edge', f)).filter((f) => fs.existsSync(f));
  const fsUse = srcFiles.filter((f) => /readFileSync|node:fs/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.basename(f));
  const forbiddenLoaded = loaded.filter((k) => FORBIDDEN_INPUTS.some((x) => k === x || k === 'derived_' + x));
  audit.checks.static_inputs = { loaded, allowed, forbidden_loaded: forbiddenLoaded, edge_modules_reading_fs: fsUse, pass: stableStringify(loaded) === stableStringify(allowed) && !forbiddenLoaded.length && !fsUse.length };
  audit.pass = Object.values(audit.checks).every((c) => c.pass);

  const count = {};
  for (const l of lines) {
    const r = JSON.parse(l);
    const k = `${r.target}`;
    const c = (count[k] ||= { rows: 0, eligible: 0, teammate: 0, by_season: {} });
    c.rows++;
    if (r.eligible) c.eligible++;
    if (r.teammate) c.teammate++;
    c.by_season[r.season] = (c.by_season[r.season] || 0) + 1;
  }
  const manifest = {
    dataset_version: DATASET_VERSION, feature_version: FEATURE_VERSION, dataset_sha256: datasetSha,
    file: 'data/edge/dataset.jsonl (gitignored, rebuilt from data/normalized)', bytes: Buffer.byteLength(body),
    first_season: FIRST_SEASON, eligible_from: ELIGIBLE_FROM, events: evs.length,
    last_event: { id: evs.at(-1).id, season: evs.at(-1).season, round: evs.at(-1).round, start: evs.at(-1).start_iso },
    bt_config: { quali: BT_QUALI, race: BT_RACE, selected_by: 'scripts/edge/tune-bt.mjs on 2014-2021 events (reports/edge/bt-tuning.json)' }, pair_features: PAIR_FEATURES, targets: count,
    target_definitions: {
      quali_h2h: 'a ahead of b in the qualifying classification (all driver pairs; teammate flag marks the teammate subset)',
      race_h2h: 'a ahead of b in race finishing order among starters: classified position; unpositioned cars by laps completed; DSQ last; equal = void (excluded)',
      top10: 'started driver finishes in positions 1-10 (not disqualified)',
    },
    source_sha256: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, sha256(JSON.stringify(v))])),
    leakage_audit_pass: audit.pass, build_seconds: Math.round((Date.now() - t0) / 1000),
  };
  fs.writeFileSync(path.join(OUT_REP, 'dataset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT_REP, 'leakage-audit.json'), JSON.stringify(audit, null, 2) + '\n');
  console.log(JSON.stringify({ dataset_sha256: datasetSha, rows: lines.length, events: evs.length, audit_pass: audit.pass, seconds: manifest.build_seconds }));
  if (!audit.pass) process.exit(1);
}

if (process.argv[1]?.endsWith('build-dataset.mjs')) main();
