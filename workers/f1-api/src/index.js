// F1 data plane (isolated service). Public contract: propsports.proptechusa.ai/v1/f1/* (mounted by the
// PropSports site; this Worker is the origin). Owns collection, raw archive, normalization, live state,
// weather and the published F1 projection. Public payloads carry public ids only — no upstream names/ids.
import { LiveHub } from './live.js';
import { ingestCurrent } from './ingest.js';
import { forecast } from './weather.js';
import { doc, putFile, activate, currentVersion } from './projection.js';
import { f1Access } from './access.js';
import { normalizeFrames, sessionPublicId, coverage, SESSION_TYPE } from './frames.js';
import { deriveIncidents, INCIDENT_TAXONOMY_VERSION } from '../../../src/core/incidents.mjs';
import { noTransform } from './transport.js';
import { newsroomHeartbeat, healthPayload } from './newsroom.js';
import { picksTick, picksPayload, picksTeaserCached, createOnlyProof, picksStatus } from './picks.js';

export { LiveHub };

const ALLOWED_ORIGINS = new Set(['https://f1.propbetedge.ai', 'https://propsports.proptechusa.ai', 'http://127.0.0.1:4173', 'http://localhost:4173']);

// PropSports data contract: every JSON object response names PropSports as its data source (network standard).
const contract = (data) => (data && typeof data === 'object' && !Array.isArray(data) && !('data_source' in data) ? { data_source: 'PropSports', ...data } : data);
function respond(req, data, { status = 200, cache = 'public, max-age=300' } = {}) {
  const origin = req.headers.get('origin');
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, vary: 'Origin', 'x-propsports-service': 'f1' };
  if (origin && ALLOWED_ORIGINS.has(origin)) h['access-control-allow-origin'] = origin;
  return new Response(JSON.stringify(contract(data)), { status, headers: h });
}
// premium/session-bound responses: never shared caches, credentials allowed only for the F1 site origin
function respondPrivate(req, data, status = 200) {
  const origin = req.headers.get('origin');
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', vary: 'Origin, Cookie', 'x-propsports-service': 'f1', 'x-robots-tag': 'noindex' };
  if (origin && ALLOWED_ORIGINS.has(origin)) { h['access-control-allow-origin'] = origin; h['access-control-allow-credentials'] = 'true'; }
  return new Response(JSON.stringify(contract(data)), { status, headers: h });
}
const FREE_WINDOW_MS = 8 * 60e3;
const sessionsMemo = { at: 0, list: null };
// recorded sessions (R2 observations/espn-<competition>/index.json) -> public ids + coverage
async function recordedSessions(env, internal) {
  if (sessionsMemo.list && Date.now() - sessionsMemo.at < 60e3) return sessionsMemo.list;
  const l = await env.DATA.list({ prefix: 'observations/', delimiter: '/' });
  const out = [];
  for (const pre of l.delimitedPrefixes || []) {
    const o = await env.DATA.get(`${pre}index.json`);
    if (!o) continue;
    const idx = await o.json();
    const id = sessionPublicId(idx.meta, internal);
    if (!id) continue;
    const pr = await env.DATA.get(`${pre}proof.json`);
    const proof = pr ? await pr.json() : null;
    out.push({ proof: proof ? { pass: proof.pass, frames: proof.frames, gaps: proof.gaps.length, generated_at: proof.generated_at } : null, id, upstream: String(idx.session), type: SESSION_TYPE[idx.meta?.type] || null, event_id: internal.event_by_upstream?.[String(idx.meta?.event_id)] || null, event_name: idx.meta?.event_name?.replace(/^.*?(?=(?:[A-Z][a-z]+ )*Grand Prix)/, '') || null, frames: idx.frames, chunks: idx.chunks, first_t: idx.first_t, last_t: idx.last_t, last_state: idx.last_state, recorder: idx.recorder });
  }
  sessionsMemo.at = Date.now();
  sessionsMemo.list = out.sort((a, b) => String(b.first_t).localeCompare(String(a.first_t)));
  return sessionsMemo.list;
}
// all frames of a recorded session: R2 chunks in order + the DO's unflushed tail
async function sessionFrames(env, upstream, buffer) {
  const dir = `observations/espn-${upstream}`;
  const idxObj = await env.DATA.get(`${dir}/index.json`);
  const idx = idxObj ? await idxObj.json() : { chunks: 0, meta: buffer?.meta || null };
  const frames = [];
  for (let i = 1; i <= (idx.chunks || 0); i++) { const c = await env.DATA.get(`${dir}/chunk-${String(i).padStart(5, '0')}.json`); if (c) frames.push(...(await c.json()).frames); }
  if (buffer?.session === upstream) for (const f of buffer.frames || []) if (!frames.length || f.t > frames.at(-1).t) frames.push(f);
  return { frames, meta: idx.meta || buffer?.meta || null, recorder: idx.recorder || null };
}

const rlMean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const rlDriver = (map, id) => map[id] ? { id, name: map[id].name, team_id: map[id].team_id } : { id, name: id, team_id: null };
async function raceLabPayload(env) {
  const meta = await doc(env, 'meta');
  if (!meta?.current_season) return null;
  const season = meta.current_season;
  const [events, drivers, constructors, circuits, standings, dnaDriver, dnaCircuit, fit, matchups] = await Promise.all([
    doc(env, `events-${season}`), doc(env, 'drivers'), doc(env, 'constructors'), doc(env, 'circuits'),
    doc(env, `standings-${season}`), doc(env, 'dna-driver'), doc(env, 'dna-circuit'), doc(env, 'fit'), doc(env, 'matchups')
  ]);
  const D = Object.fromEntries((drivers || []).map((d) => [d.id, d]));
  const C = Object.fromEntries((constructors || []).map((x) => [x.id, x]));
  const grid = (drivers || []).filter((d) => d.team_id && d.career?.last_season >= season);
  const raceOf = (e) => (e.sessions || []).find((s) => s.type === 'race');
  const qualiOf = (e) => (e.sessions || []).find((s) => s.type === 'qualifying');
  const next = (events || []).find((e) => e.status !== 'completed' && e.status !== 'canceled' && Date.parse(raceOf(e)?.start_utc || e.start_utc || 0) > Date.now() - 6 * 3600e3) || null;
  const completed = (events || []).filter((e) => raceOf(e)?.results?.length).sort((a,b)=>String(raceOf(a)?.start_utc||a.start_utc).localeCompare(String(raceOf(b)?.start_utc||b.start_utc)));
  const recent = completed.slice(-5), prior = completed.slice(-10,-5);
  const stat=(id,evs)=>{const rr=evs.map(e=>raceOf(e)?.results?.find(r=>r.driver_id===id)).filter(Boolean);const qq=evs.map(e=>qualiOf(e)?.results?.find(r=>r.driver_id===id)?.position).filter(Boolean);const pts=rr.reduce((s,r)=>s+(r.points||0),0);return {races:rr.length,points:pts,ppr:rr.length?pts/rr.length:null,avg_quali:rlMean(qq)};};
  const fr=grid.map(d=>{const a=stat(d.id,recent),b=stat(d.id,prior);return {driver:{id:d.id,name:d.name,team_id:d.team_id},recent:a,prior:b,delta_ppr:a.races>=3&&b.races>=3?a.ppr-b.ppr:null};});
  const improvers=fr.filter(x=>x.delta_ppr!=null).sort((a,b)=>b.delta_ppr-a.delta_ppr).slice(0,8).map(x=>({driver:x.driver,delta_ppr:x.delta_ppr}));
  const points=[...fr].sort((a,b)=>b.recent.points-a.recent.points).slice(0,8).map(x=>({driver:x.driver,points:x.recent.points,races:x.recent.races}));
  const dims=[['qualifying','Qualifying pace'],['race_result','Race results vs teammate'],['positions_gained','Positions gained'],['finishing','Finishing'],['consistency','Consistency'],['street','Street circuits'],['high_speed','High-speed circuits'],['low_speed','Low-speed circuits']];
  const dna_leaders=dims.map(([key,label])=>({key,label,rows:grid.map(d=>({driver:{id:d.id,name:d.name,team_id:d.team_id},dim:dnaDriver?.[d.id]?.current?.dimensions?.[key]})).filter(x=>x.dim?.percentile!=null&&!['low','insufficient'].includes(x.dim.confidence)).sort((a,b)=>b.dim.percentile-a.dim.percentile).slice(0,6).map(x=>({driver:x.driver,percentile:x.dim.percentile,sample_size:x.dim.sample_size,confidence:x.dim.confidence}))}));
  const byTeam={}; for(const d of grid)(byTeam[d.team_id]??=[]).push(d);
  const teammates=Object.entries(byTeam).filter(([,ds])=>ds.length>=2).map(([teamId,ds])=>{const key=ds.slice(0,2).map(d=>d.id).sort().join('|');const t=matchups?.[key]?.teammates;const s=t?.by_season?.[season]||t?.last5;if(!t||!s)return null;return {team:C[teamId]?{id:teamId,name:C[teamId].name}:{id:teamId,name:teamId},a:rlDriver(D,t.a),b:rlDriver(D,t.b),quali:s.quali_h2h||null,race:s.race_h2h||null,race_comparable:s.race_comparable??null,median_gap_pct:s.quali_gap_pct_median??null};}).filter(Boolean);
  const prog=standings?.progression||[],last=prog.at(-1),then=prog.at(-6)||prog[0];
  const championship=last?Object.entries(last.drivers||{}).sort((a,b)=>a[1].pos-b[1].pos).slice(0,12).map(([id,v])=>({driver:rlDriver(D,id),position:v.pos,points:v.p,movement:then?.drivers?.[id]?.pos!=null?then.drivers[id].pos-v.pos:null})):[];
  const f=next?fit?.[next.id]:null;
  const circuit_fit=next&&f?{drivers:(f.drivers||[]).slice().sort((a,b)=>b.fit_score-a.fit_score).map((x,i)=>({rank:i+1,driver:rlDriver(D,x.driver_id),fit_score:x.fit_score,strongest:(x.strongest||[]).slice(0,1).map(k=>x.components?.find(c=>c.key===k)?.label).filter(Boolean).join('')})),constructors:(f.constructors||[]).slice().sort((a,b)=>b.fit_score-a.fit_score).map((x,i)=>({rank:i+1,constructor:C[x.constructor_id]?{id:x.constructor_id,name:C[x.constructor_id].name}:{id:x.constructor_id,name:x.constructor_id},fit_score:x.fit_score}))}:{drivers:[],constructors:[]};
  const circuit=next?(circuits||[]).find(x=>x.id===next.circuit_id):null;
  return {tier:'all_access',season,next_event:next?{id:next.id,name:next.name,round:next.round,circuit:circuit?{id:circuit.id,name:circuit.name}:null}:null,circuit_fit,circuit_dna:next?dnaCircuit?.[next.circuit_id]||null:null,dna_window:Object.values(dnaDriver||{}).find(x=>x?.current?.window)?.current?.window||null,dna_leaders,form:{improvers,points},teammates,championship};
}

const authorized = (req, token) => !!token && (req.headers.get('authorization') || '') === `Bearer ${token}`;
const err = (req, status, error) => respond(req, { error }, { status, cache: 'no-store' });

async function route(req, env, ctx) {
    const url = new URL(req.url);
    let p = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return respond(req, {}, { status: 204, cache: 'max-age=86400' });
    if (!p.startsWith('/v1/f1')) return err(req, 404, 'not found');
    p = p.slice('/v1/f1'.length) || '/';
    const q = url.searchParams;
    try {
      // ---------- operational ----------
      if (p === '/health') {
        const v = await currentVersion(env);
        const last = await env.DATA.get('state/last-ingest.json');
        const li = last ? await last.json() : null;
        return respond(req, { ok: !!v, service: 'propsports-f1', projection_version: v, last_refresh: li?.at || null, dataset_version: li?.dataset_version || null, time: new Date().toISOString() }, { cache: 'no-store' });
      }
      // ---------- PBEcast: free tier (public, cacheable) ----------
      if (p === '/live') {
        const r = await env.LIVE.get(env.LIVE.idFromName('global')).fetch('https://live/state');
        return respond(req, await publicLive(env, await r.json(), { full: false }), { cache: 'public, max-age=5' });
      }
      if (p === '/live/frames') {
        // the live tail only (FREE_WINDOW_MS): enough to move cars, never a replay
        const internal = await doc(env, 'internal');
        const b = await (await env.LIVE.get(env.LIVE.idFromName('global')).fetch('https://live/buffer')).json();
        const snap = await (await env.LIVE.get(env.LIVE.idFromName('global')).fetch('https://live/state')).json();
        const sid = b.session || snap?._frame?.session || null;
        if (!sid || snap.state !== 'live') return respond(req, { state: snap.state || 'idle', session_id: null, frames: [] }, { cache: 'public, max-age=5' });
        const all = await sessionFrames(env, sid, b);
        const since = Math.max(Date.now() - FREE_WINDOW_MS, Date.parse(q.get('since') || 0) || 0);
        const frames = normalizeFrames(all.frames.filter((f) => Date.parse(f.t) > since), internal, { full: false });
        return respond(req, { state: 'live', session_id: sessionPublicId(all.meta, internal), window_s: FREE_WINDOW_MS / 1000, frames }, { cache: 'public, max-age=5' });
      }
      if (p === '/replay') {
        const internal = await doc(env, 'internal');
        // the upstream session key stays internal (frame lookup); public rows carry the public id only
        return respond(req, { sessions: (await recordedSessions(env, internal)).map(({ upstream, ...s }) => s) }, { cache: 'public, max-age=60' });
      }
      if (p === '/membership') {
        const a = await f1Access(req, env);
        return respondPrivate(req, { membership: a.membership, signed_in: a.signed_in === true, verification: a.reason });
      }
      if (p === '/race-lab') {
        const a = await f1Access(req, env);
        if (!a.granted) return respondPrivate(req, { error: 'all_access_required', feature: 'race_lab', membership: a.membership, signed_in: a.signed_in === true }, 403);
        const payload = await raceLabPayload(env);
        return payload ? respondPrivate(req, payload) : respondPrivate(req, { error: 'projection_not_published' }, 503);
      }
      // ---------- Race Picks: All Access (server-enforced); free gets a teaser with no values ----------
      if (p === '/picks') {
        const a = await f1Access(req, env);
        if (!a.granted) return respondPrivate(req, { error: 'all_access_required', feature: 'race_picks', membership: a.membership, signed_in: a.signed_in === true, teaser: await picksTeaserCached(env).catch(() => null) }, 403);
        return respondPrivate(req, await picksPayload(env));
      }
      // ---------- PBEcast: All Access (server-enforced; private, never cached) ----------
      if (p === '/live/full' || p.startsWith('/replay/') || p.startsWith('/incidents/')) {
        const a = await f1Access(req, env);
        if (!a.granted && !p.startsWith('/incidents/')) return respondPrivate(req, { error: 'all_access_required', feature: p === '/live/full' ? 'pbecast_advanced' : 'pbecast_replay', membership: a.membership }, 403);
        const internal = await doc(env, 'internal');
        if (p === '/live/full') {
          const r = await env.LIVE.get(env.LIVE.idFromName('global')).fetch('https://live/state');
          return respondPrivate(req, await publicLive(env, await r.json(), { full: true }));
        }
        const pub = p.split('/')[2];
        if (!/^\d{4}-[a-z0-9-]+$/.test(pub || '')) return err(req, 400, 'bad session id');
        const idx = (await recordedSessions(env, internal)).find((s) => s.id === pub);
        if (!idx) return respondPrivate(req, { error: 'not_recorded', session_id: pub }, 404);
        const b = await (await env.LIVE.get(env.LIVE.idFromName('global')).fetch('https://live/buffer')).json();
        const all = await sessionFrames(env, idx.upstream, b.session === idx.upstream ? b : null);
        const full = normalizeFrames(all.frames, internal, { full: true });
        const teamOf = (id) => internal.team_by_driver?.[id] || null;
        const events = deriveIncidents(full, { sessionId: pub, teamOf });
        if (p.startsWith('/incidents/')) {
          // major live safety/status events are free; the full timeline is All Access
          return a.granted ? respondPrivate(req, { session_id: pub, taxonomy: INCIDENT_TAXONOMY_VERSION, events, tier: 'all_access' }) : respond(req, { session_id: pub, taxonomy: INCIDENT_TAXONOMY_VERSION, events: events.filter((e) => e.free), tier: 'free' }, { cache: 'public, max-age=10' });
        }
        return respondPrivate(req, { session_id: pub, meta: { type: idx.type, event_id: idx.event_id, event_name: idx.event_name, laps_total: all.meta?.laps_total ?? null }, coverage: coverage(all.frames), frames: full, events, recorder: all.recorder || null });
      }
      if (p === '/weather') {
        const slug = q.get('circuit') || '';
        const internal = await doc(env, 'internal');
        const geo = internal?.circuits_geo?.[slug];
        if (!geo) return respond(req, { circuit: slug, days: [], note: 'no coordinates for this circuit' });
        const w = await forecast(geo, (q.get('from') || '').slice(0, 10), (q.get('to') || '').slice(0, 10), ctx);
        return respond(req, { circuit: slug, ...w }, { cache: 'public, max-age=1800' });
      }
      const media = p.match(/^\/media\/(headshot|flag)\/([a-z0-9-]+)$/);
      if (media) return mediaProxy(req, env, ctx, media[1], media[2]);

      // ---------- protected ----------
      if (p === '/dataset' || p.startsWith('/dataset/')) {
        if (!authorized(req, env.DATASET_TOKEN)) return err(req, 401, 'unauthorized');
        if (p === '/dataset' || p === '/dataset/manifest') {
          const list = await env.DATA.list({ prefix: 'fragments/' });
          return respond(req, { objects: list.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded })) }, { cache: 'no-store' });
        }
        const key = decodeURIComponent(p.slice('/dataset/'.length));
        if (!/^fragments\/[a-z0-9._-]+$/.test(key)) return err(req, 400, 'bad key');
        const obj = await env.DATA.get(key);
        if (!obj) return err(req, 404, 'not found');
        return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'application/json', 'cache-control': 'no-store', ...(obj.httpMetadata?.contentEncoding ? { 'content-encoding': obj.httpMetadata.contentEncoding } : {}) } });
      }
      const pf = p.match(/^\/admin\/projection\/([a-f0-9]{16})\/([a-z0-9-]+)$/);
      if (pf && req.method === 'PUT') {
        if (!authorized(req, env.PUBLISH_TOKEN)) return err(req, 401, 'unauthorized');
        await putFile(env, pf[1], pf[2], await req.arrayBuffer());
        return respond(req, { ok: true }, { cache: 'no-store' });
      }
      const pa = p.match(/^\/admin\/projection\/([a-f0-9]{16})\/activate$/);
      if (pa && req.method === 'POST') {
        if (!authorized(req, env.PUBLISH_TOKEN)) return err(req, 401, 'unauthorized');
        return respond(req, await activate(env, pa[1], await req.json()), { cache: 'no-store' });
      }
      if (p === '/admin/ingest' && req.method === 'POST') {
        if (!authorized(req, env.ADMIN_TOKEN)) return err(req, 401, 'unauthorized');
        return respond(req, await ingestCurrent(env, { force: q.get('force') === '1', trigger: q.get('deploy') === '1' }), { cache: 'no-store' });
      }
      if (p === '/admin/observations') {
        if (!authorized(req, env.ADMIN_TOKEN)) return err(req, 401, 'unauthorized');
        const sid = q.get('session');
        if (!sid) {
          const l = await env.DATA.list({ prefix: 'observations/', delimiter: '/' });
          return respond(req, { sessions: l.delimitedPrefixes }, { cache: 'no-store' });
        }
        if (!/^\d+$/.test(sid)) return err(req, 400, 'bad session');
        const o = await env.DATA.get(`observations/espn-${sid}/${q.get('chunk') ? `chunk-${String(Number(q.get('chunk'))).padStart(5, '0')}` : 'index'}.json`);
        return o ? respond(req, await o.json(), { cache: 'no-store' }) : err(req, 404, 'not found');
      }
      if (p === '/admin/proof' && req.method === 'POST') {
        if (!authorized(req, env.ADMIN_TOKEN)) return err(req, 401, 'unauthorized');
        const sid = q.get('session');
        if (!/^\d+$/.test(sid || '')) return err(req, 400, 'bad session');
        return env.LIVE.get(env.LIVE.idFromName('global')).fetch(`https://live/proof?session=${sid}`);
      }
      if (p.startsWith('/admin/picks/')) {
        if (!authorized(req, env.ADMIN_TOKEN)) return err(req, 401, 'unauthorized');
        if (p === '/admin/picks/tick' && req.method === 'POST') return respond(req, await picksTick(env), { cache: 'no-store' });
        if (p === '/admin/picks/proof' && req.method === 'POST') return respond(req, await createOnlyProof(env), { cache: 'no-store' });
        if (p === '/admin/picks/status') return respond(req, await picksStatus(env), { cache: 'no-store' });
        return err(req, 404, 'not found');
      }
      if (p === '/admin/deploy-ledger') {
        if (!authorized(req, env.ADMIN_TOKEN)) return err(req, 401, 'unauthorized');
        const o = await env.DATA.get('state/deploy-ledger.json');
        return respond(req, o ? await o.json() : {}, { cache: 'no-store' });
      }

      // ---------- public projection routes ----------
      const meta = await doc(env, 'meta');
      if (!meta) return err(req, 503, 'projection not published');
      const season = (s) => (s && /^\d{4}$/.test(s) ? Number(s) : meta.current_season);
      if (p === '/season') {
        const y = season(q.get('season'));
        const [evs, st] = await Promise.all([doc(env, `events-${y}`), doc(env, `standings-${y}`)]);
        if (!evs) return err(req, 404, 'season not found');
        return respond(req, { season: y, events: evs.map(({ sessions, ...e }) => ({ ...e, sessions: sessions.map(({ results, ...s }) => s) })), standings: st ? { drivers: st.drivers.slice(0, 10), constructors: st.constructors } : null });
      }
      if (p === '/seasons') return respond(req, await doc(env, 'seasons'));
      if (p === '/drivers') {
        let list = await doc(env, 'drivers');
        if (q.get('season')) {
          const y = Number(q.get('season'));
          list = list.filter((d) => d.career.first_season <= y && d.career.last_season >= y);
        }
        if (q.get('active') === '1') list = list.filter((d) => d.career.last_season >= meta.current_season);
        return respond(req, list);
      }
      let m;
      if ((m = p.match(/^\/drivers\/([a-z0-9-]+)$/))) {
        const d = (await doc(env, 'drivers')).find((x) => x.id === m[1]);
        if (!d) return err(req, 404, 'driver not found');
        return respond(req, d);
      }
      if (p === '/constructors') return respond(req, await doc(env, 'constructors'));
      if ((m = p.match(/^\/constructors\/([a-z0-9-]+)$/))) {
        const c = (await doc(env, 'constructors')).find((x) => x.id === m[1]);
        if (!c) return err(req, 404, 'constructor not found');
        return respond(req, c);
      }
      if (p === '/events') {
        const evs = await doc(env, `events-${season(q.get('season'))}`);
        if (!evs) return err(req, 404, 'season not found');
        return respond(req, evs.map(({ sessions, ...e }) => ({ ...e, sessions: sessions.map(({ results, ...s }) => s) })));
      }
      if ((m = p.match(/^\/events\/((\d{4})-[a-z0-9-]+)$/))) {
        const ev = (await doc(env, `events-${m[2]}`))?.find((e) => e.id === m[1]);
        return ev ? respond(req, ev) : err(req, 404, 'event not found');
      }
      if (p === '/sessions') {
        const ev = q.get('event');
        const y = ev ? Number(ev.slice(0, 4)) : season(q.get('season'));
        const evs = (await doc(env, `events-${y}`)) || [];
        const list = evs.filter((e) => !ev || e.id === ev).flatMap((e) => e.sessions.map(({ results, ...s }) => s));
        return respond(req, list);
      }
      if ((m = p.match(/^\/sessions\/((\d{4})-[a-z0-9-]+)$/))) {
        const evs = (await doc(env, `events-${m[2]}`)) || [];
        for (const e of evs) for (const s of e.sessions) if (s.id === m[1]) return respond(req, s);
        return err(req, 404, 'session not found');
      }
      if (p === '/standings/drivers' || p === '/standings/constructors') {
        const y = season(q.get('season'));
        const st = await doc(env, `standings-${y}`);
        if (!st) return err(req, 404, 'season not found');
        const kind = p.endsWith('drivers') ? 'drivers' : 'constructors';
        return respond(req, { season: y, standings: st[kind], progression: q.get('progression') === '1' ? (st.progression || []).map((r) => ({ event_id: r.event_id, round: r.round, totals: r[kind] })) : undefined, note: st.progression_note || null });
      }
      if (p === '/results') {
        const y = season(q.get('season'));
        const evs = (await doc(env, `events-${y}`)) || [];
        const type = q.get('session_type') || 'race';
        const ev = q.get('event');
        const out = evs.filter((e) => !ev || e.id === ev).map((e) => ({ event_id: e.id, round: e.round, name: e.name, session: e.sessions.find((s) => s.type === type) || null })).filter((x) => x.session?.results?.length);
        return respond(req, out);
      }
      // newsroom health: last run, last evaluation, last publication, next expected evaluation; 503 when stale/failing
      if (p === '/news/health') {
        const lo = await env.DATA.get('state/deploy-ledger.json'), li = await env.DATA.get('state/last-ingest.json');
        const h = healthPayload({ now: new Date().toISOString(), health: await doc(env, 'news-health'), ledger: lo ? await lo.json() : null, liveNow: li ? !!(await li.json()).live_now : false });
        return respond(req, h, { status: h.stale ? 503 : 200, cache: 'no-store' });
      }
      // newsroom: published stories only (frozen packets + validated drafts)
      if (p === '/news') {
        const idx = (await doc(env, 'news-index')) || { articles: [] };
        const cls = q.get('class');
        const lim = Math.min(Number(q.get('limit')) || 200, 200);
        return respond(req, { ...idx, articles: idx.articles.filter((a) => !cls || a.class === cls).slice(0, lim) }, { cache: 'public, max-age=120' });
      }
      if ((m = p.match(/^\/news\/([a-z0-9-]+)$/))) {
        const a = await doc(env, `news-${m[1]}`);
        return a ? respond(req, a, { cache: 'public, max-age=300' }) : err(req, 404, 'story not found');
      }
      if (p === '/circuits') return respond(req, await doc(env, 'circuits'));
      if ((m = p.match(/^\/circuits\/([a-z0-9-]+)$/))) {
        const c = (await doc(env, 'circuits')).find((x) => x.id === m[1]);
        return c ? respond(req, c) : err(req, 404, 'circuit not found');
      }
      if ((m = p.match(/^\/dna\/driver\/([a-z0-9-]+)$/))) {
        const a = await f1Access(req, env);
        if (!a.granted) return respondPrivate(req, { error:'all_access_required', feature:'driver_dna', membership:a.membership }, 403);
        const d=(await doc(env,'dna-driver'))[m[1]];
        return d ? respondPrivate(req,{ driver_id:m[1], ...d }) : respondPrivate(req,{error:'no DNA for this driver'},404);
      }
      if ((m = p.match(/^\/dna\/constructor\/([a-z0-9-]+)$/))) {
        const a=await f1Access(req,env); if(!a.granted) return respondPrivate(req,{error:'all_access_required',feature:'constructor_dna',membership:a.membership},403);
        const d=(await doc(env,'dna-constructor'))[m[1]]; if(!d) return respondPrivate(req,{error:'no DNA for this constructor'},404);
        const y=q.get('season'); return respondPrivate(req,{constructor_id:m[1],seasons:y?{[y]:d[y]||null}:d});
      }
      if ((m = p.match(/^\/dna\/circuit\/([a-z0-9-]+)$/))) {
        const a=await f1Access(req,env); if(!a.granted) return respondPrivate(req,{error:'all_access_required',feature:'circuit_dna',membership:a.membership},403);
        const d=(await doc(env,'dna-circuit'))[m[1]]; return d?respondPrivate(req,d):respondPrivate(req,{error:'no DNA for this circuit'},404);
      }
      if ((m = p.match(/^\/fit\/((\d{4})-[a-z0-9-]+)$/))) {
        const a=await f1Access(req,env); if(!a.granted) return respondPrivate(req,{error:'all_access_required',feature:'circuit_fit',membership:a.membership},403);
        const f=(await doc(env,'fit'))[m[1]]; return f?respondPrivate(req,f):respondPrivate(req,{error:'no Circuit Fit for this event'},404);
      }
      if ((m = p.match(/^\/matchup\/([a-z0-9-]+)\/([a-z0-9-]+)$/))) {
        const a=await f1Access(req,env); if(!a.granted) return respondPrivate(req,{error:'all_access_required',feature:'matchup_lab',membership:a.membership},403);
        const [aId,bId]=[m[1],m[2]].sort(); const x=(await doc(env,'matchups'))[`${aId}|${bId}`];
        return x?respondPrivate(req,x):respondPrivate(req,{error:'no shared races for this pair'},404);
      }
      return err(req, 404, 'not found');
    } catch (e) {
      console.error('f1 route error', p, e?.stack || e);
      return err(req, 500, 'internal error');
    }
}

export default {
  // Every response leaves with no-transform: see transport.js (Vercel cache vs Accept-Encoding).
  async fetch(req, env, ctx) {
    return noTransform(await route(req, env, ctx));
  },
  async scheduled(event, env, ctx) {
    // ingest (may trigger a rebuild for a completed session), then the newsroom heartbeat/build check — which runs even
    // when the ingest fails, so an upstream outage can never leave the newsroom unevaluated
    ctx.waitUntil(ingestCurrent(env, { trigger: true }).catch((e) => console.error('ingest failed', e?.message || e))
      .then(async () => { const r = await newsroomHeartbeat(env, { health: await doc(env, 'news-health') }); if (r.fired || r.status !== 'ok') console.log('newsroom', JSON.stringify(r)); })
      .catch((e) => console.error('newsroom heartbeat failed', e?.message || e))
      // race picks lane: bounded lock/settle step on the SAME proven */10 cron (never a new cron); isolated failure
      .then(() => picksTick(env)).then((r) => { if (r.actions.length) console.log('picks', JSON.stringify(r)); })
      .catch((e) => console.error('picks lane failed', e?.message || e)));
    ctx.waitUntil(env.LIVE.get(env.LIVE.idFromName('global')).fetch('https://live/state').catch(() => {}));
  },
};

// Live snapshot → public payload (public driver/event/session ids, no upstream ids or error text).
async function publicLive(env, s, { full = false } = {}) {
  const internal = (await doc(env, 'internal')) || { driver_by_upstream: {}, event_by_upstream: {} };
  const evSlug = s.event ? internal.event_by_upstream[String(s.event.id)] || null : null;
  const TYPE = { FP1: 'fp1', FP2: 'fp2', FP3: 'fp3', Qual: 'qualifying', SS: 'sprint-qualifying', SR: 'sprint', Race: 'race' };
  return {
    state: s.state === 'unavailable' ? 'unavailable' : s.state,
    event: s.event ? { id: evSlug, name: s.event.name } : null,
    session: s.session ? { id: evSlug && TYPE[s.session.type] ? `${evSlug}-${TYPE[s.session.type]}` : null, type: TYPE[s.session.type] || null, label: s.session.label, start_utc: s.session.start, state: s.session.state, lap: s.session.lap, laps_total: s.session.laps_total, flag: s.session.flag, status: s.session.status } : null,
    tower: (s.tower || []).map((r) => {
      const d = internal.driver_by_upstream[r.id];
      const row = { pos: r.pos, driver_id: d?.id || null, name: d?.name || r.name, code: d?.code || null, number: r.num, team: r.team, color: r.color, laps: r.laps, status: r.status };
      // gaps, pit counts and lap times are All Access fields: they are not in the free payload at all
      return full ? { ...row, gap: r.gap, pits: r.pits, best: r.best, fastest: !!r.fastest } : row;
    }),
    // free feed: major race-state and status events only; the full feed (pits, position changes, laps) is All Access
    feed: (s.feed || []).filter((f) => full || ['flag', 'ret'].includes(f.kind)).map((f) => ({ t: f.t, lap: f.lap, kind: f.kind, kind_label: f.kind_label, text: f.text })),
    tier: full ? 'all_access' : 'free',
    next: s.next ? { event: s.next.event, label: s.next.label, start_utc: s.next.start } : null,
    updated_at: s.updated_at || s.checked_at || null,
    checked_at: s.checked_at || null,
  };
}

// Headshot/flag proxy: the site never loads images from an upstream host. Cached in R2 after first fetch.
async function mediaProxy(req, env, ctx, kind, slug) {
  const key = `media/${kind}/${slug}`;
  let obj = await env.DATA.get(key);
  if (!obj) {
    const internal = await doc(env, 'internal');
    const src = internal?.media?.[slug]?.[kind];
    if (!src) return new Response('not found', { status: 404 });
    const r = await fetch(src, { headers: { 'User-Agent': 'PropBetEdge-F1/1.0 (+https://f1.propbetedge.ai)' } });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) return new Response('not found', { status: 404 });
    const buf = await r.arrayBuffer();
    ctx.waitUntil(env.DATA.put(key, buf, { httpMetadata: { contentType: type } }));
    return new Response(buf, { headers: { 'content-type': type, 'cache-control': 'public, max-age=604800', 'access-control-allow-origin': '*' } });
  }
  return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'image/png', 'cache-control': 'public, max-age=604800', 'access-control-allow-origin': '*' } });
}
