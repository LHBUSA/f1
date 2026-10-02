// PBE F1 EDGE — Bradley-Terry hyper-parameter selection on the DEVELOPMENT window only (2014-2021 events).
// Walk-forward test seasons (2022+) are never read here. Deterministic grid; writes reports/edge/bt-tuning.json.
import fs from 'node:fs';
import { loadRaw, buildIndex, prefixBefore } from '../../src/edge/data.mjs';
import { fitBT, BT_DEFAULTS } from '../../src/edge/bt.mjs';
import { eventsToBuild, entrantsFor } from './build-dataset.mjs';

const DEV = [2014, 2021];
const idx = buildIndex(loadRaw());
const evs = eventsToBuild(idx).filter((e) => e.season >= DEV[0] && e.season <= DEV[1]);
const grid = [];
for (const tau_days of [120, 180, 365, 730]) for (const lambda_driver of [0.25, 0.5, 2]) for (const lambda_rw of [0.5, 1, 4]) grid.push({ ...BT_DEFAULTS, tau_days, lambda_driver, lambda_rw });

function evalCfg(kind, cfg) {
  let ll = 0;
  let n = 0;
  for (const ev of evs) {
    const sid = kind === 'qualifying' ? ev.quali_session_id : ev.race_session_id;
    const s = idx.sessionById.get(sid);
    if (!s) continue;
    const ent = entrantsFor(idx, ev);
    const bt = fitBT(prefixBefore(idx, ev.start_ms), { cutoff: ev.start_ms, season: ev.season, kind, entrants: ent, cfg });
    const rows = kind === 'qualifying' ? s.rows.filter((r) => r.pos != null) : s.rows.filter((r) => r.started);
    const key = kind === 'qualifying' ? (r) => r.pos : (r) => r.key;
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      if (key(rows[i]) === key(rows[j])) continue;
      const z = bt.strength(rows[i].d, rows[i].L) - bt.strength(rows[j].d, rows[j].L);
      const p = Math.min(1 - 1e-9, Math.max(1e-9, 1 / (1 + Math.exp(-z))));
      ll += key(rows[i]) < key(rows[j]) ? -Math.log(p) : -Math.log(1 - p);
      n++;
    }
  }
  return { logloss: Math.round((ll / n) * 1e5) / 1e5, n };
}

const out = { window: `events ${DEV[0]}-${DEV[1]} (development only)`, results: {} };
for (const kind of ['qualifying', 'race']) {
  out.results[kind] = grid.map((cfg) => ({ tau_days: cfg.tau_days, lambda_driver: cfg.lambda_driver, lambda_rw: cfg.lambda_rw, ...evalCfg(kind, cfg) }));
  out.results[kind].sort((a, b) => a.logloss - b.logloss);
  console.log(kind, JSON.stringify(out.results[kind].slice(0, 3)));
}
fs.writeFileSync('reports/edge/bt-tuning.json', JSON.stringify(out, null, 2) + '\n');
