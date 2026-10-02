// F1 data plane (isolated service). Public contract: propsports.proptechusa.ai/v1/f1/* (mounted by the
// PropSports site; this Worker is the origin). Owns collection, raw archive, normalization, live state,
// weather and the published F1 projection. Public payloads carry public ids only — no upstream names/ids.
import { LiveHub } from './live.js';
import { ingestCurrent } from './ingest.js';
import { forecast } from './weather.js';
import { doc, putFile, activate, currentVersion } from './projection.js';

export { LiveHub };

const ALLOWED_ORIGINS = new Set(['https://f1.propbetedge.ai', 'https://propsports.proptechusa.ai', 'http://127.0.0.1:4173', 'http://localhost:4173']);

function respond(req, data, { status = 200, cache = 'public, max-age=300' } = {}) {
  const origin = req.headers.get('origin');
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, vary: 'Origin', 'x-propsports-service': 'f1' };
  if (origin && ALLOWED_ORIGINS.has(origin)) h['access-control-allow-origin'] = origin;
  return new Response(JSON.stringify(data), { status, headers: h });
}
const authorized = (req, token) => !!token && (req.headers.get('authorization') || '') === `Bearer ${token}`;
const err = (req, status, error) => respond(req, { error }, { status, cache: 'no-store' });

export default {
  async fetch(req, env, ctx) {
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
      if (p === '/live') {
        const r = await env.LIVE.get(env.LIVE.idFromName('global')).fetch('https://live/state');
        return respond(req, await publicLive(env, await r.json()), { cache: 'public, max-age=5' });
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
        const dna = (await doc(env, 'dna-driver'))[d.id] || null;
        return respond(req, { ...d, dna });
      }
      if (p === '/constructors') return respond(req, await doc(env, 'constructors'));
      if ((m = p.match(/^\/constructors\/([a-z0-9-]+)$/))) {
        const c = (await doc(env, 'constructors')).find((x) => x.id === m[1]);
        if (!c) return err(req, 404, 'constructor not found');
        return respond(req, { ...c, dna: (await doc(env, 'dna-constructor'))[c.id] || null });
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
      if (p === '/circuits') return respond(req, await doc(env, 'circuits'));
      if ((m = p.match(/^\/circuits\/([a-z0-9-]+)$/))) {
        const c = (await doc(env, 'circuits')).find((x) => x.id === m[1]);
        return c ? respond(req, { ...c, dna: (await doc(env, 'dna-circuit'))[c.id] || null }) : err(req, 404, 'circuit not found');
      }
      if ((m = p.match(/^\/dna\/driver\/([a-z0-9-]+)$/))) {
        const d = (await doc(env, 'dna-driver'))[m[1]];
        return d ? respond(req, { driver_id: m[1], ...d }) : err(req, 404, 'no DNA for this driver');
      }
      if ((m = p.match(/^\/dna\/constructor\/([a-z0-9-]+)$/))) {
        const d = (await doc(env, 'dna-constructor'))[m[1]];
        if (!d) return err(req, 404, 'no DNA for this constructor');
        const y = q.get('season');
        return respond(req, { constructor_id: m[1], seasons: y ? { [y]: d[y] || null } : d });
      }
      if ((m = p.match(/^\/dna\/circuit\/([a-z0-9-]+)$/))) {
        const d = (await doc(env, 'dna-circuit'))[m[1]];
        return d ? respond(req, d) : err(req, 404, 'no DNA for this circuit');
      }
      if ((m = p.match(/^\/fit\/((\d{4})-[a-z0-9-]+)$/))) {
        const f = (await doc(env, 'fit'))[m[1]];
        return f ? respond(req, f) : err(req, 404, 'no Circuit Fit for this event');
      }
      if ((m = p.match(/^\/matchup\/([a-z0-9-]+)\/([a-z0-9-]+)$/))) {
        const [a, b] = [m[1], m[2]].sort();
        const x = (await doc(env, 'matchups'))[`${a}|${b}`];
        return x ? respond(req, x) : err(req, 404, 'no shared races for this pair');
      }
      return err(req, 404, 'not found');
    } catch (e) {
      console.error('f1 route error', p, e?.stack || e);
      return err(req, 500, 'internal error');
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(ingestCurrent(env, { trigger: true }).catch((e) => console.error('ingest failed', e?.message || e)));
    ctx.waitUntil(env.LIVE.get(env.LIVE.idFromName('global')).fetch('https://live/state').catch(() => {}));
  },
};

// Live snapshot → public payload (public driver/event/session ids, no upstream ids or error text).
async function publicLive(env, s) {
  const internal = (await doc(env, 'internal')) || { driver_by_upstream: {}, event_by_upstream: {} };
  const evSlug = s.event ? internal.event_by_upstream[String(s.event.id)] || null : null;
  const TYPE = { FP1: 'fp1', FP2: 'fp2', FP3: 'fp3', Qual: 'qualifying', SS: 'sprint-qualifying', SR: 'sprint', Race: 'race' };
  return {
    state: s.state === 'unavailable' ? 'unavailable' : s.state,
    event: s.event ? { id: evSlug, name: s.event.name } : null,
    session: s.session ? { id: evSlug && TYPE[s.session.type] ? `${evSlug}-${TYPE[s.session.type]}` : null, type: TYPE[s.session.type] || null, label: s.session.label, start_utc: s.session.start, state: s.session.state, lap: s.session.lap, laps_total: s.session.laps_total, flag: s.session.flag, status: s.session.status } : null,
    tower: (s.tower || []).map((r) => {
      const d = internal.driver_by_upstream[r.id];
      return { pos: r.pos, driver_id: d?.id || null, name: d?.name || r.name, code: d?.code || null, number: r.num, team: r.team, color: r.color, gap: r.gap, laps: r.laps, pits: r.pits, best: r.best, fastest: !!r.fastest, status: r.status };
    }),
    feed: (s.feed || []).map((f) => ({ t: f.t, lap: f.lap, kind: f.kind, kind_label: f.kind_label, text: f.text })),
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
