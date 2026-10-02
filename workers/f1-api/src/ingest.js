// Current-season collection into the R2 raw doc store → season fragment → (maybe) one site rebuild.
import { extractSeason, extractDrivers, extractVenues } from '../../../src/core/extract.mjs';

const UA = 'PropBetEdge-F1/1.0 (+https://f1.propbetedge.ai)';

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** Content version of a season fragment: results/states/standings only, never capture timestamps. */
export async function datasetVersion(frag) {
  const core = {
    s: frag.sessions.map((s) => [s.id, s.state]).sort(),
    r: frag.results.map((r) => [r.id, r.position, r.grid, r.status_raw, r.laps, r.time_text, r.points, r.pit_stops, r.q1_ms, r.q2_ms, r.q3_ms, r.best_lap_ms]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    st: frag.standings.map((s) => [s.kind, s.subject_id, s.name_raw, s.position, s.points]).sort((a, b) => (String(a) < String(b) ? -1 : 1)),
  };
  return sha(JSON.stringify(core));
}

export async function ingestCurrent(env, { force = false, trigger = false, reasonOverride = null } = {}) {
  const year = new Date().getUTCFullYear();
  const storeKey = `raw/season-${year}.json`;
  const storeObj = await env.DATA.get(storeKey);
  const store = storeObj ? await storeObj.json() : {};
  let fetched = 0;
  const budget = 700;
  const norm = (u) => {
    const x = new URL(u.replace(/^http:/, 'https:'));
    x.searchParams.delete('lang');
    x.searchParams.delete('region');
    return x.toString();
  };
  const get = async (u, { maxAgeMs = Infinity } = {}) => {
    const k = norm(u);
    const hit = store[k];
    if (hit && (Date.now() - Date.parse(hit.capturedAt) < (force ? 0 : maxAgeMs) || fetched >= budget)) return hit.notFound ? null : hit;
    if (fetched >= budget) return null;
    fetched++;
    const r = await fetch(k, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (r.status === 401 || r.status === 403) throw new Error(`collection access barrier ${r.status}`);
    if (r.status === 404) {
      store[k] = { url: k, capturedAt: new Date().toISOString(), notFound: true };
      return null;
    }
    if (!r.ok) return hit || null;
    const data = await r.json();
    const env2 = { url: k, capturedAt: new Date().toISOString(), data };
    store[k] = env2;
    return env2;
  };
  const ingestedAt = new Date().toISOString();
  const frag = await extractSeason(year, get, { ingestedAt, concurrency: 6 });
  const prevObj = await env.DATA.get(`fragments/season-${year}.json`);
  const prev = prevObj ? await prevObj.json() : null;
  const completed = (f) => new Map((f?.sessions || []).filter((s) => s.state === 'completed').map((s) => [s.id, s]));
  const before = completed(prev);
  const newlySessions = [...completed(frag).values()].filter((s) => !before.has(s.id));
  const drivers = await extractDrivers(frag.athlete_ids, get, { ingestedAt, maxAgeMs: 7 * 86400e3, concurrency: 6 });
  const venues = await extractVenues(frag.venue_refs, get, { ingestedAt, maxAgeMs: 30 * 86400e3 });
  await env.DATA.put(storeKey, JSON.stringify(store), { httpMetadata: { contentType: 'application/json' } });
  const put = (k, v) => env.DATA.put(k, JSON.stringify(v), { httpMetadata: { contentType: 'application/json' } });
  const complete = frag.events.length && fetched < budget; // never publish a partial fragment
  const version = complete ? await datasetVersion(frag) : null;
  if (complete) {
    await put(`fragments/season-${year}.json`, frag);
    await put('fragments/drivers-current.json', drivers);
    await put('fragments/venues-current.json', venues);
  }
  const deploy = complete && trigger ? await maybeDeploy(env, { version, newlySessions, reasonOverride }) : null;
  const summary = { at: ingestedAt, season: year, fetched, budget_hit: fetched >= budget, dataset_version: version, events: frag.events.length, sessions: frag.sessions.length, results: frag.results.length, newly_completed: newlySessions.map((s) => s.id), deploy };
  await put('state/last-ingest.json', summary);
  return summary;
}

/**
 * One rebuild per dataset version. Ledger: state/deploy-ledger.json
 *  { last_dataset_version, last_triggered_version, last_trigger: {at, version, reason, event_ids, session_ids, status, ok, attempt}, history[] }
 * A version is triggered once; a failed trigger is retried on later runs (max 3 attempts, ≥10 min apart).
 */
async function maybeDeploy(env, { version, newlySessions, reasonOverride }) {
  const ledgerObj = await env.DATA.get('state/deploy-ledger.json');
  const ledger = ledgerObj ? await ledgerObj.json() : { history: [] };
  const changed = version && version !== ledger.last_dataset_version;
  const pendingRetry = ledger.last_trigger && !ledger.last_trigger.ok && ledger.last_trigger.version === version && (ledger.last_trigger.attempt || 1) < 3 && Date.now() - Date.parse(ledger.last_trigger.at) > 10 * 60 * 1000;
  ledger.last_dataset_version = version;
  let outcome = { action: 'none', version };
  const reason = reasonOverride || (newlySessions.length ? `session_completed:${newlySessions.map((s) => s.type).join(',')}` : 'dataset_changed');
  if (!env.DEPLOY_HOOK_URL) outcome = { action: 'no_hook_configured', version };
  else if (version === ledger.last_triggered_version && ledger.last_trigger?.ok) outcome = { action: 'already_triggered', version };
  else if ((changed && (newlySessions.length || reasonOverride)) || pendingRetry || (changed && ledger.last_triggered_version && version !== ledger.last_triggered_version && !newlySessions.length && reason === 'dataset_changed')) {
    const attempt = pendingRetry ? (ledger.last_trigger.attempt || 1) + 1 : 1;
    let status = 0;
    try {
      const r = await fetch(env.DEPLOY_HOOK_URL, { method: 'POST' });
      status = r.status;
    } catch {
      status = 0;
    }
    const ok = status >= 200 && status < 300;
    ledger.last_trigger = { at: new Date().toISOString(), version, reason: pendingRetry ? ledger.last_trigger.reason : reason, event_ids: [...new Set(newlySessions.map((s) => s.event_id))], session_ids: newlySessions.map((s) => s.id), status, ok, attempt };
    if (ok) ledger.last_triggered_version = version;
    ledger.history = [ledger.last_trigger, ...(ledger.history || [])].slice(0, 50);
    outcome = { action: ok ? 'triggered' : 'trigger_failed', ...ledger.last_trigger };
  }
  await env.DATA.put('state/deploy-ledger.json', JSON.stringify(ledger), { httpMetadata: { contentType: 'application/json' } });
  return outcome;
}
