// Live session state. Collection runs here (upstream core API, honest User-Agent, no evasion);
// the router translates upstream ids to public ids before anything leaves the data plane.
const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/racing/leagues/f1';
const UA = 'PropBetEdge-F1/1.0 (+https://f1.propbetedge.ai)';
const SESSION_LABEL = { FP1: 'Practice 1', FP2: 'Practice 2', FP3: 'Practice 3', Qual: 'Qualifying', SS: 'Sprint Qualifying', SR: 'Sprint', Race: 'Grand Prix' };
import { buildModel, progressAt } from '../../../src/core/progress.mjs';
const RECORD_MS = 10_000;
const RECORDER_VERSION = 'f1-recorder@1';
// numeric timing values kept per car per frame (as the source reports them; parsed, never estimated)
const FRAME_STATS = ['lapsCompleted', 'behindTime', 'behindLaps', 'pitsTaken', 'fastestLap', 'fastestLapNum', 'totalTime', 'lapsLead', 'place', 'qual1TimeMS', 'qual2TimeMS', 'qual3TimeMS'];
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export class LiveHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.snapshot = null;
    this.inflight = null;
  }
  async fetch(req) {
    // unflushed recorder frames (the live tail R2 does not have yet)
    if (req && new URL(req.url).pathname === '/proof') { const sid = new URL(req.url).searchParams.get('session'); await this.proof(sid); const o = await this.env.DATA.get(`observations/espn-${sid}/proof.json`); return json(o ? await o.json() : { error: 'no recording' }); }
    if (req && new URL(req.url).pathname === '/buffer') {
      const b = (await this.state.storage.get('obs-buf')) || null;
      return json(b ? { session: b.session, meta: b.meta, frames: b.frames } : { session: null, frames: [] });
    }
    if (!this.snapshot) this.snapshot = (await this.state.storage.get('snapshot')) || null;
    // the recorder runs on its own alarm; any request (the */10 cron included) re-arms it if it ever lapsed
    if (!(await this.state.storage.getAlarm())) await this.state.storage.setAlarm(Date.now() + 1000);
    const age = this.snapshot ? Date.now() - Date.parse(this.snapshot.checked_at) : Infinity;
    const ttl = this.snapshot?.state === 'live' ? 8000 : 60000;
    if (age > ttl) {
      this.inflight ||= this.refresh().finally(() => (this.inflight = null));
      try { await this.inflight; } catch (e) { if (!this.snapshot) return json({ state: 'unavailable', error: String(e?.message || e).slice(0, 120), tower: [], feed: [] }); }
    }
    return json(this.snapshot);
  }
  // Observation recorder. While a session is live the hub polls every RECORD_MS and archives each CHANGED source state
  // as a frame (observation time, lap, flag, clock, every car's order/laps/gap/pits/best/status). Frames are the only
  // input PBEcast replay and derived race progress may use; nothing is interpolated or invented here.
  async alarm() {
    let next = 15 * 60e3;
    try {
      await this.refresh();
      const snap = this.snapshot;
      if (snap?.state === 'live' || snap?.state === 'post') await this.record(snap);
      if (snap?.state === 'live') next = RECORD_MS;
      else if (snap?.next?.start && Date.parse(snap.next.start) - Date.now() < 45 * 60e3) next = 60e3;
      else if (snap?.state === 'post') next = 5 * 60e3;
    } catch (e) {
      console.error('recorder', e?.message || e);
      next = 60e3;
    } finally {
      await this.flush(false);
      await this.state.storage.setAlarm(Date.now() + next);
    }
  }
  async record(snap) {
    const f = snap._frame;
    if (!f) return;
    const sig = JSON.stringify([f.state, f.lap, f.flag, f.status, f.cars]);
    const buf = (await this.state.storage.get('obs-buf')) || null;
    if (buf && buf.session !== f.session) {
      await this.flush(true);
      await this.state.storage.delete('obs-buf'); // the next session starts its own archive
    }
    const cur = (await this.state.storage.get('obs-buf')) || { session: f.session, meta: f.meta, frames: [], last_sig: null, seq: (await this.state.storage.get(`obs-seq-${f.session}`)) || 0, opened: Date.now() };
    if (cur.last_sig === sig) return; // unchanged source state: no frame
    cur.frames.push({ t: f.t, state: f.state, lap: f.lap, flag: f.flag, status: f.status, clock: f.clock, cars: f.cars });
    cur.last_sig = sig;
    await this.state.storage.put('obs-buf', cur);
    if (f.state === 'post') { await this.flush(true); await this.proof(f.session).catch((e) => console.error('proof', e?.message || e)); }
  }
  // Automatic replay proof when a session ends (runs in the Worker; does not depend on any operator session).
  // Same deterministic checks as scripts/replay-proof.mjs, written next to the recording as proof.json.
  async proof(session) {
    const dir = `observations/espn-${session}`;
    const idx = await (await this.env.DATA.get(`${dir}/index.json`))?.json();
    if (!idx) return;
    const raw = [];
    for (let i = 1; i <= idx.chunks; i++) { const c = await this.env.DATA.get(`${dir}/chunk-${String(i).padStart(5, '0')}.json`); if (c) raw.push(...(await c.json()).frames); }
    const frames = raw.map((f) => ({ t: f.t, lap: f.lap, flag: f.flag, cars: (f.cars || []).map(([id, pos, status, v]) => ({ id, pos, status: /RETIRED|DISQUALIFIED/.test(status || '') ? 'retired' : 'running', laps: v?.lapsCompleted != null ? Number(v.lapsCompleted) : null })) }));
    const ts = frames.map((f) => Date.parse(f.t));
    const m1 = buildModel(frames), m2 = buildModel([...frames].reverse());
    const ids = [...m1.cars.keys()], samples = Array.from({ length: 40 }, (_, i) => m1.start + ((m1.end - m1.start) * i) / 39);
    const snap = (m, T) => JSON.stringify(ids.map((id) => progressAt(m, id, T)));
    const gaps = []; for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > 60000) gaps.push({ from: frames[i - 1].t, to: frames[i].t, s: Math.round((ts[i] - ts[i - 1]) / 1000) });
    const checks = { multiple_frames: frames.length >= 2, monotonic: ts.every((t, i) => !i || t > ts[i - 1]), deterministic: samples.every((T) => snap(m1, T) === snap(m2, T)), crossings: [...m1.cars.values()].reduce((a, c) => a + c.crossings.length, 0) };
    await this.env.DATA.put(`${dir}/proof.json`, JSON.stringify({ session, model: m1.version, generated_at: new Date().toISOString(), frames: frames.length, first_t: frames[0]?.t, last_t: frames.at(-1)?.t, gaps, checks, pass: checks.multiple_frames && checks.monotonic && checks.deterministic }), { httpMetadata: { contentType: 'application/json' } });
  }
  async flush(force) {
    const cur = await this.state.storage.get('obs-buf');
    if (!cur || !cur.frames.length) return;
    if (!force && cur.frames.length < 30 && Date.now() - cur.opened < 60e3) return;
    const seq = cur.seq + 1;
    const dir = `observations/espn-${cur.session}`;
    await this.env.DATA.put(`${dir}/chunk-${String(seq).padStart(5, '0')}.json`, JSON.stringify({ session: cur.session, meta: cur.meta, recorder: RECORDER_VERSION, frames: cur.frames }), { httpMetadata: { contentType: 'application/json' } });
    const idxObj = await this.env.DATA.get(`${dir}/index.json`);
    const idx = idxObj ? await idxObj.json() : { session: cur.session, meta: cur.meta, recorder: RECORDER_VERSION, chunks: 0, frames: 0, first_t: cur.frames[0].t };
    idx.chunks = seq;
    idx.frames += cur.frames.length;
    idx.last_t = cur.frames.at(-1).t;
    idx.last_state = cur.frames.at(-1).state;
    await this.env.DATA.put(`${dir}/index.json`, JSON.stringify(idx), { httpMetadata: { contentType: 'application/json' } });
    await this.state.storage.put(`obs-seq-${cur.session}`, seq);
    await this.state.storage.put('obs-buf', { ...cur, seq, frames: [], opened: Date.now() });
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
    const frame = {
      t: new Date().toISOString(), session: String(c.id), state, lap, flag: session.flag, status: statusDoc?.type?.name || null, clock: statusDoc?.displayClock ?? null,
      meta: { event_id: String(ev.id), event_name: ev.name, type: c.type?.abbreviation || null, start: c.date, laps_total: session.laps_total },
      cars: items.map((it, i) => {
        const st = sm(stats[i]);
        const v = {};
        for (const k of FRAME_STATS) if (st[k] && st[k].displayValue != null) v[k] = st[k].displayValue;
        return [String(it.id), it.order ?? null, statuses[i]?.type?.name || null, v];
      }).sort((a, b) => (a[1] ?? 999) - (b[1] ?? 999)),
    };
    return { state, event: { id: ev.id, name: ev.name }, session, tower, feed: feed.slice(-150), updated_at: new Date().toISOString(), _frame: frame };
  }
}
