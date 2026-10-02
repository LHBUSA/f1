// Live session state. Collection runs here (upstream core API, honest User-Agent, no evasion);
// the router translates upstream ids to public ids before anything leaves the data plane.
const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/racing/leagues/f1';
const UA = 'PropBetEdge-F1/1.0 (+https://f1.propbetedge.ai)';
const SESSION_LABEL = { FP1: 'Practice 1', FP2: 'Practice 2', FP3: 'Practice 3', Qual: 'Qualifying', SS: 'Sprint Qualifying', SR: 'Sprint', Race: 'Grand Prix' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

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
    if (!r.ok) throw new Error(`upstream ${r.status}`);
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
