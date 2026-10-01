// f1-api: live state (LiveHub Durable Object), weather, dataset distribution for the site build,
// and the current-season ingest cron. Source: ESPN (live + results), MET Norway (forecasts).
import { extractSeason, extractDrivers, extractVenues } from '../../../src/core/extract.mjs';

const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/racing/leagues/f1';
const UA = 'PropBetEdge-F1/1.0 (+https://f1.propbetedge.ai)';
const SESSION_LABEL = { FP1: 'Practice 1', FP2: 'Practice 2', FP3: 'Practice 3', Qual: 'Qualifying', SS: 'Sprint Qualifying', SR: 'Sprint', Race: 'Grand Prix' };

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': 'https://f1.propbetedge.ai', ...headers } });

function authorized(req, token) {
  const h = req.headers.get('authorization') || '';
  return !!token && h === `Bearer ${token}`;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (p === '/v1/health') return json({ ok: true, service: 'f1-api', time: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
      if (p === '/v1/live') {
        const stub = env.LIVE.get(env.LIVE.idFromName('global'));
        const r = await stub.fetch('https://live/state');
        return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=5', 'access-control-allow-origin': 'https://f1.propbetedge.ai' } });
      }
      const wm = p.match(/^\/v1\/weather\/([a-z0-9-]+)$/);
      if (wm) return weather(wm[1], url, env, ctx);
      if (p === '/v1/dataset/manifest' || p.startsWith('/v1/dataset/')) {
        if (!authorized(req, env.DATASET_TOKEN)) return json({ error: 'unauthorized' }, 401);
        if (p === '/v1/dataset/manifest') {
          const list = await env.DATA.list({ prefix: 'fragments/' });
          return json({ objects: list.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded })) }, 200, { 'cache-control': 'no-store' });
        }
        const key = decodeURIComponent(p.slice('/v1/dataset/'.length));
        if (!/^fragments\/[a-z0-9._-]+$/.test(key)) return json({ error: 'bad key' }, 400);
        const obj = await env.DATA.get(key);
        if (!obj) return json({ error: 'not found' }, 404);
        return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'application/json', 'content-encoding': obj.httpMetadata?.contentEncoding || '', 'cache-control': 'no-store' } });
      }
      if (p === '/admin/ingest' && req.method === 'POST') {
        if (!authorized(req, env.ADMIN_TOKEN)) return json({ error: 'unauthorized' }, 401);
        const res = await ingestCurrent(env, { force: url.searchParams.get('force') === '1', trigger: url.searchParams.get('deploy') === '1' });
        return json(res, 200, { 'cache-control': 'no-store' });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: 'internal', message: String(e?.message || e).slice(0, 200) }, 500, { 'cache-control': 'no-store' });
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(ingestCurrent(env, { trigger: true }).catch((e) => console.error('ingest failed', e?.message || e)));
    // Keep the live hub warm during sessions so the feed is built even without viewers.
    ctx.waitUntil(env.LIVE.get(env.LIVE.idFromName('global')).fetch('https://live/state').catch(() => {}));
  },
};

// ---------------- Weather (MET Norway, CC BY 4.0) ----------------
async function weather(slug, url, env, ctx) {
  const meta = await env.DATA.get('meta/circuits.json');
  if (!meta) return json({ circuit: slug, days: [], note: 'no circuit index' });
  const circuits = await meta.json();
  const c = circuits[slug];
  if (!c || c.lat == null) return json({ circuit: slug, days: [], note: 'no coordinates for this circuit' });
  const lat = Number(c.lat).toFixed(3);
  const lon = Number(c.lon).toFixed(3);
  const cacheKey = new Request(`https://f1-api.propbetedge.ai/cache/weather/${lat},${lon}`);
  const cache = caches.default;
  let fc = await cache.match(cacheKey);
  if (!fc) {
    const r = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`, { headers: { 'User-Agent': UA } });
    if (!r.ok) return json({ circuit: slug, days: [], note: `forecast source unavailable (${r.status})` }, 200, { 'cache-control': 'no-store' });
    fc = new Response(await r.text(), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
    ctx.waitUntil(cache.put(cacheKey, fc.clone()));
  }
  const data = await fc.json();
  const from = (url.searchParams.get('from') || '').slice(0, 10);
  const to = (url.searchParams.get('to') || '').slice(0, 10);
  const days = {};
  for (const t of data.properties?.timeseries || []) {
    const d = t.time.slice(0, 10);
    if ((from && d < from) || (to && d > to)) continue;
    const det = t.data.instant.details;
    const x = (days[d] ||= { date: d, t_max: -99, t_min: 99, precip_mm: 0, wind_ms: 0, _h: new Set() });
    x.t_max = Math.max(x.t_max, det.air_temperature);
    x.t_min = Math.min(x.t_min, det.air_temperature);
    x.wind_ms = Math.max(x.wind_ms, det.wind_speed ?? 0);
    const p1 = t.data.next_1_hours?.details?.precipitation_amount;
    const p6 = t.data.next_6_hours?.details?.precipitation_amount;
    const hour = Number(t.time.slice(11, 13));
    if (p1 != null) { if (!x._h.has(hour)) { x.precip_mm += p1; x._h.add(hour); } }
    else if (p6 != null && hour % 6 === 0) { x.precip_mm += p6; for (let h = hour; h < hour + 6; h++) x._h.add(h); }
  }
  const out = Object.values(days).map(({ _h, ...d }) => ({ ...d, precip_mm: Math.round(d.precip_mm * 10) / 10 }));
  return json({ circuit: slug, source: 'MET Norway Locationforecast 2.0', licence: 'CC BY 4.0', updated_at: data.properties?.meta?.updated_at, days: out }, 200, { 'cache-control': 'public, max-age=1800' });
}

// ---------------- Current-season ingest (R2 doc store) ----------------
async function ingestCurrent(env, { force = false, trigger = false } = {}) {
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
    if (r.status === 401 || r.status === 403) throw new Error(`ESPN access barrier ${r.status}`);
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
  const completed = (f) => new Set((f?.sessions || []).filter((s) => s.state === 'completed').map((s) => s.id));
  const before = completed(prev);
  const newly = [...completed(frag)].filter((id) => !before.has(id));
  const standingsChanged = JSON.stringify((prev?.standings || []).map((s) => [s.subject_id, s.name_raw, s.points])) !== JSON.stringify(frag.standings.map((s) => [s.subject_id, s.name_raw, s.points]));
  // Drivers & venues for the current season (weekly refresh).
  const drivers = await extractDrivers(frag.athlete_ids, get, { ingestedAt, maxAgeMs: 7 * 86400e3, concurrency: 6 });
  const venues = await extractVenues(frag.venue_refs, get, { ingestedAt, maxAgeMs: 30 * 86400e3 });
  await env.DATA.put(storeKey, JSON.stringify(store), { httpMetadata: { contentType: 'application/json' } });
  const put = (k, v) => env.DATA.put(k, JSON.stringify(v), { httpMetadata: { contentType: 'application/json' } });
  // Never publish a partial fragment: if the per-run budget ran out, the doc store keeps filling next run.
  if (frag.events.length && fetched < budget) {
    await put(`fragments/season-${year}.json`, frag);
    await put(`fragments/drivers-current.json`, drivers);
    await put(`fragments/venues-current.json`, venues);
  }
  let deploy = null;
  if (trigger && (newly.length || standingsChanged) && env.DEPLOY_HOOK_URL) {
    const lastObj = await env.DATA.get('state/last-deploy.json');
    const last = lastObj ? await lastObj.json() : null;
    if (!last || Date.now() - Date.parse(last.at) > 20 * 60 * 1000) {
      const r = await fetch(env.DEPLOY_HOOK_URL, { method: 'POST' });
      deploy = { status: r.status, newly, standingsChanged };
      await put('state/last-deploy.json', { at: new Date().toISOString(), ...deploy });
    } else deploy = { skipped: 'throttled', newly };
  }
  const summary = { at: ingestedAt, season: year, fetched, budget_hit: fetched >= budget, events: frag.events.length, sessions: frag.sessions.length, results: frag.results.length, newly_completed: newly.length, standings_changed: standingsChanged, deploy };
  await put('state/last-ingest.json', summary);
  return summary;
}

// ---------------- Live hub ----------------
export class LiveHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.snapshot = null;
    this.inflight = null;
  }
  async fetch() {
    if (!this.snapshot) this.snapshot = (await this.state.storage.get('snapshot')) || null;
    const age = this.snapshot ? Date.now() - Date.parse(this.snapshot.checked_at) : Infinity;
    const ttl = this.snapshot?.state === 'live' ? 8000 : 60000;
    if (age > ttl) {
      this.inflight ||= this.refresh().finally(() => (this.inflight = null));
      try { await this.inflight; } catch (e) { if (!this.snapshot) return json({ state: 'unavailable', error: String(e?.message || e).slice(0, 120), tower: [], feed: [] }); }
    }
    return json(this.snapshot);
  }
  async get(u) {
    const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`ESPN ${r.status}`);
    return r.json();
  }
  // Core API only: site.api.espn.com rejects our honestly-identified User-Agent (403 = access barrier; not evaded).
  async cachedJson(key, url, ttlMs) {
    const hit = await this.state.storage.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.data;
    const data = await this.get(url);
    await this.state.storage.put(key, { at: Date.now(), data });
    return data;
  }
  async refresh() {
    const now = Date.now();
    const year = new Date(now).getUTCFullYear();
    const list = await this.cachedJson(`events-${year}`, `${ESPN_CORE}/events?dates=${year}&limit=100`, 3600e3);
    const ids = (list.items || []).map((i) => i.$ref.match(/events\/(\d+)/)?.[1]).filter(Boolean);
    // Event docs are small; cache 30 min, except the active weekend which is re-read every refresh.
    const evs = [];
    for (const id of ids) evs.push(await this.cachedJson(`event-${id}`, `${ESPN_CORE}/events/${id}`, 1800e3));
    const active = evs.filter((e) => now >= Date.parse(e.date) - 2 * 3600e3 && now <= Date.parse(e.endDate || e.date) + 8 * 3600e3);
    let liveEv = null;
    let liveComp = null;
    let recentPost = null;
    let next = null;
    for (const e0 of active) {
      const ev = await this.get(`${ESPN_CORE}/events/${e0.id}`);
      for (const c of ev.competitions || []) {
        const t = Date.parse(c.date);
        if (t > now + 3600e3) continue;
        const st = await this.get(c.status.$ref.replace('http:', 'https:')).catch(() => null);
        c._status = st;
        const state = st?.type?.state;
        if (state === 'in') { liveEv = ev; liveComp = c; }
        else if (state === 'post' && now - t < 8 * 3600e3 && (!recentPost || t > Date.parse(recentPost.c.date))) recentPost = { ev, c };
      }
    }
    for (const ev of evs) {
      for (const c of ev.competitions || []) {
        const t = Date.parse(c.date);
        if (t > now && (!next || t < Date.parse(next.start))) next = { event: ev.name, label: SESSION_LABEL[c.type?.abbreviation] || c.type?.abbreviation, start: c.date };
      }
    }
    const prev = this.snapshot;
    let snap;
    if (liveComp || recentPost) {
      const ev = liveEv || recentPost.ev;
      const c = liveComp || recentPost.c;
      snap = await this.session(ev, c, liveComp ? 'live' : 'post', prev);
    } else {
      snap = { state: 'idle', event: null, session: null, tower: [], feed: [] };
    }
    snap.next = next;
    snap.checked_at = new Date().toISOString();
    snap.source = 'PropSports';
    this.snapshot = snap;
    await this.state.storage.put('snapshot', snap);
  }
  async session(ev, c, state, prev) {
    const base = `${ESPN_CORE}/events/${ev.id}/competitions/${c.id}`;
    const [statusDoc, comps, compStats] = await Promise.all([c._status ? Promise.resolve(c._status) : this.get(`${base}/status`).catch(() => null), this.get(`${base}/competitors?limit=50`), this.get(`${base}/statistics`).catch(() => null)]);
    const lapsTotal = (compStats?.categories || []).flatMap((x) => x.stats || []).find((x) => x.name === 'laps')?.value || null;
    const items = comps.items || [];
    const names = {};
    await Promise.all(items.map(async (it) => {
      const a = await this.cachedJson(`athlete-${it.id}`, `https://sports.core.api.espn.com/v2/sports/racing/athletes/${it.id}`, 7 * 86400e3).catch(() => null);
      if (a) names[String(it.id)] = a.displayName || a.fullName;
    }));
    const stats = await Promise.all(items.map((it) => (it.statistics?.$ref ? this.get(it.statistics.$ref.replace('http:', 'https:')).catch(() => null) : null)));
    const statuses = await Promise.all(items.map((it) => (it.status?.$ref ? this.get(it.status.$ref.replace('http:', 'https:')).catch(() => null) : null)));
    const sm = (d) => Object.fromEntries((d?.splits?.categories || []).flatMap((cat) => cat.stats.map((s) => [s.name, s]))) || {};
    let tower = items.map((it, i) => {
      const s = sm(stats[i]);
      const st = statuses[i]?.type?.name?.replace('STATUS_', '').toLowerCase() || null;
      const d = (k) => (s[k]?.displayValue && !['0', '.000', '0.000'].includes(s[k].displayValue) ? s[k].displayValue : null);
      return {
        id: String(it.id),
        pos: it.order ?? (s.place?.value || null),
        name: names[String(it.id)] || `#${it.vehicle?.number || it.id}`,
        num: it.vehicle?.number || null,
        team: it.vehicle?.manufacturer || null,
        color: it.vehicle?.teamColor || null,
        gap: s.behindLaps?.value ? `+${s.behindLaps.value} lap${s.behindLaps.value > 1 ? 's' : ''}` : d('behindTime'),
        laps: s.lapsCompleted?.value ?? null,
        pits: s.pitsTaken?.value ?? null,
        best: d('fastestLap') || (['Race', 'SR'].includes(c.type?.abbreviation) ? null : d('totalTime')),
        best_ms: null,
        status: st,
      };
    });
    tower.sort((a, b) => (a.pos ?? 999) - (b.pos ?? 999));
    const toMs = (t) => { if (!t) return null; const p = t.split(':').map(Number); let v = 0; for (const x of p) v = v * 60 + x; return v * 1000; };
    for (const r of tower) r.best_ms = toMs(r.best);
    const best = Math.min(...tower.map((r) => r.best_ms || Infinity));
    for (const r of tower) r.fastest = Number.isFinite(best) && r.best_ms === best;
    const lap = statusDoc?.period || null;
    const session = { id: c.id, type: c.type?.abbreviation, label: SESSION_LABEL[c.type?.abbreviation] || c.type?.abbreviation, start: c.date, state, lap, laps_total: ['Race', 'SR'].includes(c.type?.abbreviation) ? lapsTotal : null, flag: statusDoc?.flag || null, status: statusDoc?.type?.description || null };
    // Event feed: differences between consecutive source snapshots of the SAME session.
    const sameSession = prev?.session?.id === c.id;
    const feed = sameSession ? [...(prev.feed || [])] : [];
    if (sameSession && state === 'live') {
      const pb = Object.fromEntries((prev.tower || []).map((r) => [r.id, r]));
      const t = new Date().toISOString();
      const add = (kind, kind_label, text) => feed.push({ t, lap, kind, kind_label, text });
      if (prev.session?.flag !== session.flag && session.flag) add('flag', 'Flag', `${session.flag}`);
      for (const r of tower) {
        const o = pb[r.id];
        if (!o) continue;
        if (r.pits != null && o.pits != null && r.pits > o.pits) add('pit', 'Pit', `${r.name} pit stop #${r.pits}`);
        if (r.status === 'retired' && o.status !== 'retired') add('ret', 'Out', `${r.name} retired`);
        if (r.pos && o.pos && r.pos < o.pos && r.pos <= 10) add('pos', 'Position', `${r.name} P${o.pos} → P${r.pos}`);
        if (r.fastest && !o.fastest && r.best) add('fl', 'Fastest', `${r.name} ${r.best}`);
      }
    }
    return { state, event: { id: ev.id, name: ev.name }, session, tower, feed: feed.slice(-150), updated_at: new Date().toISOString() };
  }
}
