// Manual (pre-Worker-deploy) prospective lock for one event/version, using the SAME lane code the f1-api cron uses.
//   node scripts/picks/lock.mjs --event 2026-singapore-grand-prix --version pre_qualifying            (dry run)
//   node scripts/picks/lock.mjs --event 2026-singapore-grand-prix --version pre_qualifying --put      (create-only R2)
//   node scripts/picks/lock.mjs --base-state --put                                                    (upload base state)
// Payloads go to the private f1-data bucket and a local scratch dir OUTSIDE the repo (public repo: never commit them).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PARAMS, newState, observeEvent, canonicalFromNormalized, isCompleted } from '../../src/picks/model.mjs';
import { canonicalFromFragment, entrantsFor, stateBefore, buildLock, marketSnapshot, lockKey, baseStateKey, sha256Hex, LOCK_GUARD_MS } from '../../src/picks/lane.mjs';

const args = process.argv.slice(2);
const arg = (k, d = null) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const PUT = args.includes('--put');
const OUT = arg('--out', 'C:/Users/goodl/AppData/Local/Temp/f1picks');
const SEASON = 2026;
const API = 'https://propsports.proptechusa.ai/v1/f1';
const MARKETS = 'https://propsports-markets.sales-fd3.workers.dev';
fs.mkdirSync(OUT, { recursive: true });
const load = (n) => JSON.parse(fs.readFileSync(path.resolve('data/normalized', n + '.json'), 'utf8'));
const wrangler = (a) => execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', ...a], { cwd: path.resolve('workers/f1-api'), encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
const exists = (key) => { try { wrangler(['r2', 'object', 'get', `f1-data/${key}`, '--remote', '--file', path.join(OUT, '_exists.tmp')]); return true; } catch (e) { if (/not found|does not exist|404|10007/i.test(String(e.stderr || e.stdout || e.message))) return false; throw new Error('existence check failed: ' + String(e.stderr || e.message).slice(0, 300)); } };
const put = (key, file) => wrangler(['r2', 'object', 'put', `f1-data/${key}`, '--remote', '--file', file, '--content-type', 'application/json']);

// base state = every completed event 2006 → end of SEASON-1 (the walk-forward evaluation's warm start)
const events = load('events'), drivers = load('drivers');
const hist = canonicalFromNormalized({ events, sessions: load('sessions'), results: load('classifications') }).filter((e) => e.season >= 2006 && e.season < SEASON && isCompleted(e));
const base = newState();
for (const ev of hist) observeEvent(base, ev, PARAMS);
const baseBody = JSON.stringify(base);
const baseSha = await sha256Hex(baseBody);
fs.writeFileSync(path.join(OUT, `base-state-${SEASON - 1}.json`), baseBody);
console.log(`base state: ${base.events} events, last ${base.last_event}, sha256 ${baseSha}`);

if (args.includes('--base-state')) {
  const key = baseStateKey(SEASON - 1);
  if (PUT) {
    if (exists(key)) console.log(`${key} already exists — not replaced`);
    else { put(key, path.join(OUT, `base-state-${SEASON - 1}.json`)); console.log(`PUT ${key}`); }
  }
  process.exit(0);
}

const slug = arg('--event');
const version = arg('--version', 'pre_qualifying');
const token = fs.readFileSync('D:/Workers/secrets/f1-dataset-token', 'utf8').trim();
const fr = await fetch(`${API}/dataset/fragments/season-${SEASON}.json`, { headers: { authorization: `Bearer ${token}` } });
if (!fr.ok) throw new Error(`fragment ${fr.status}`);
const fragText = await fr.text();
fs.writeFileSync(path.join(OUT, `season-${SEASON}.fragment.json`), fragText);
const frag = JSON.parse(fragText);
const evs = canonicalFromFragment(frag);
const i = evs.findIndex((e) => e.slug === slug);
if (i < 0) throw new Error(`event ${slug} not in fragment`);
const ev = evs[i];
const prev = evs.slice(0, i).filter((e) => e.race.length).at(-1);
const now = new Date();
const deadline = version === 'pre_qualifying' ? ev.quali_start : ev.race_start;
console.log(`event ${ev.slug} quali ${ev.quali_start} (${ev.quali_state}) race ${ev.race_start} (${ev.race_state}); now ${now.toISOString()}`);
console.log('weekend sessions:', ev.weekend.map((s) => `${s.type}@${s.start_utc}:${s.state}:${s.rows.length}`).join(' '));
if (!(now.getTime() < Date.parse(deadline) - LOCK_GUARD_MS)) throw new Error(`too late: ${version} deadline ${deadline}`);
if (version === 'pre_qualifying' && ev.quali_state === 'completed') throw new Error('qualifying already completed');
if (version === 'post_qualifying' && !(ev.quali_state === 'completed')) throw new Error('qualifying not completed');
const st = stateBefore(base, evs, ev.start_utc, PARAMS);
const ent = entrantsFor(ev, prev);
const dById = Object.fromEntries(drivers.map((d) => [d.id, d]));
for (const d of frag.drivers || []) if (!dById[d.id]) dById[d.id] = d;
const who = (id) => (dById[id] ? { id: dById[id].slug, name: dById[id].full_name || dById[id].display_name, code: dById[id].code } : null);
const missing = ent.entrants.filter((e) => !who(e.driver));
if (missing.length) throw new Error(`no public id for ${missing.map((m) => m.driver).join(',')}`);
const deskRes = await fetch(`${MARKETS}/v1/market-desk?sport=f1`, { headers: { accept: 'application/json' } });
const desk = deskRes.ok ? await deskRes.json() : null;
const nowIso = new Date().toISOString();
const lock = buildLock({ ev, version, state: st, entrants: ent.entrants, entrantSource: ent.source, who, nowIso, market: marketSnapshot(desk, ev.slug, nowIso), baseStateSha: baseSha, dataAsOf: frag.events.find((e) => e.id === ev.id)?.captured_at || null });
const body = JSON.stringify(lock);
const sha = await sha256Hex(body);
const file = path.join(OUT, `${ev.slug}.${version}.json`);
fs.writeFileSync(file, body);
console.log(`state: ${st.events} events, last ${st.last_event}; entrants ${ent.entrants.length} from ${ent.source}`);
console.log(`lock ${lock.lock_id} locked_at ${lock.locked_at} deadline ${lock.deadline} sha256 ${sha} bytes ${body.length}`);
console.log('winner top 6:', Object.entries(lock.families.race_winner.probs).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([d, p]) => `${d} ${(p * 100).toFixed(1)}%`).join(', '));
console.log('sum p_win + other =', (Object.values(lock.families.race_winner.probs).reduce((a, b) => a + b, 0) + lock.families.race_winner.other).toFixed(4));
if (PUT) {
  const key = lockKey(ev.slug, version);
  if (exists(key)) { console.log(`${key} already exists — NOT replaced (immutable)`); process.exit(0); }
  if (!(Date.now() < Date.parse(deadline) - LOCK_GUARD_MS)) throw new Error('deadline passed during build');
  console.log(put(key, file).trim().split('\n').slice(-2).join(' | '));
  console.log(`PUT ${key} at ${new Date().toISOString()}`);
  fs.appendFileSync(path.join(OUT, 'lock-evidence.jsonl'), JSON.stringify({ key, lock_id: lock.lock_id, sha256: sha, locked_at: lock.locked_at, put_done_at: new Date().toISOString(), deadline }) + '\n');
}
