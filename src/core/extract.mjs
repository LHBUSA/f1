// Phase A — extract: raw ESPN documents → one season "fragment" of normalized rows.
// Runtime-agnostic: `get(url, {maxAgeMs})` returns {url, capturedAt, data} | null. Node uses the disk cache,
// the f1-ingest Worker uses an R2-backed doc store. Constructor ids are (re)assigned in assemble.
import { normalizeEvent, normalizeDriver, normalizeVenue } from './normalize.mjs';

export const CORE = 'https://sports.core.api.espn.com/v2/sports/racing/leagues/f1';
export const CORE_ROOT = 'https://sports.core.api.espn.com/v2/sports/racing';
const norm = (u) => {
  const x = new URL(u.replace(/^http:/, 'https:'));
  x.searchParams.delete('lang');
  x.searchParams.delete('region');
  return x.toString();
};

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } }));
}

async function collection(get, u, opts) {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await get(`${u}${u.includes('?') ? '&' : '?'}limit=100&page=${page}`, opts);
    if (!r) break;
    out.push(...(r.data.items || []));
    if (!r.data.pageCount || page >= r.data.pageCount) break;
  }
  return out;
}

/**
 * @param {number} year
 * @param {Function} get
 * @param {{ingestedAt:string, now?:number, liveAgeMs?:number, recentDays?:number, concurrency?:number}} o
 */
export async function extractSeason(year, get, o = {}) {
  const now = o.now ?? Date.now();
  const isCurrent = year >= new Date(now).getUTCFullYear();
  const liveAge = o.liveAgeMs ?? 10 * 60 * 1000;
  const recentMs = (o.recentDays ?? 3) * 86400e3;
  const conc = o.concurrency ?? 6;
  const refs = await collection(get, `${CORE}/events?dates=${year}`, { maxAgeMs: isCurrent ? liveAge : Infinity });
  const docs = new Map();
  const lookup = (u) => docs.get(norm(u)) || null;
  const frag = { season: year, events: [], sessions: [], results: [], entries: [], venue_refs: [], athlete_ids: [], standings: [] };
  const athletes = new Set();
  await pool(refs, Math.min(conc, 4), async (ref) => {
    const ev = await get(ref.$ref, { maxAgeMs: isCurrent ? liveAge : Infinity });
    if (!ev) return;
    const subs = [];
    for (const c of ev.data.competitions || []) {
      const start = Date.parse(c.date || ev.data.date);
      const recent = isCurrent && now - start < recentMs;
      if (c.status?.$ref) subs.push([c.status.$ref, recent || start > now ? liveAge : Infinity]);
      if (c.statistics?.$ref && start <= now) subs.push([c.statistics.$ref, recent ? liveAge : Infinity]);
      for (const cp of c.competitors || []) {
        if (cp.id) athletes.add(String(cp.id));
        if (start > now) continue;
        if (cp.statistics?.$ref) subs.push([cp.statistics.$ref, recent ? liveAge : Infinity]);
        if (cp.status?.$ref) subs.push([cp.status.$ref, recent ? liveAge : Infinity]);
      }
    }
    await pool(subs, conc, async ([u, age]) => {
      const d = await get(u, { maxAgeMs: age }).catch(() => null);
      if (d) docs.set(norm(u), d);
    });
    const n = normalizeEvent(ev, lookup, () => null, o.ingestedAt);
    frag.events.push(n.event);
    frag.sessions.push(...n.sessions);
    frag.results.push(...n.results);
    frag.entries.push(...n.entries);
    if (n.venueRef) frag.venue_refs.push(n.venueRef);
  });
  // Official standings (constructor names resolved in assemble).
  for (const g of [0, 1]) {
    const doc = await get(`${CORE}/seasons/${year}/types/2/standings/${g}`, { maxAgeMs: isCurrent ? liveAge : Infinity }).catch(() => null);
    if (!doc) continue;
    for (const s of doc.data.standings || []) {
      const rec = s.records?.[0];
      const stat = Object.fromEntries((rec?.stats || []).map((x) => [x.name, x.value]));
      const aid = s.athlete?.$ref?.match(/athletes\/(\d+)/)?.[1];
      let name = null;
      if (g === 1 && s.manufacturer?.$ref) {
        const m = await get(s.manufacturer.$ref, { maxAgeMs: 30 * 86400e3 }).catch(() => null);
        name = m?.data?.displayName || m?.data?.name || null;
      }
      frag.standings.push({
        season: year,
        kind: g === 0 ? 'driver' : 'constructor',
        subject_id: g === 0 && aid ? `espn-${aid}` : null,
        name_raw: name,
        position: stat.rank ?? null,
        points: stat.championshipPts ?? stat.points ?? null,
        wins: stat.wins ?? null,
        poles: stat.poles ?? null,
        starts: stat.starts ?? null,
        source: 'espn',
        source_id: `${year}/${g}/${aid || s.manufacturer?.$ref?.match(/manufacturers\/(\d+)/)?.[1]}`,
        source_url: doc.url,
        source_updated_at: null,
        ingested_at: o.ingestedAt,
        captured_at: doc.capturedAt,
      });
    }
  }
  frag.venue_refs = [...new Set(frag.venue_refs)];
  frag.athlete_ids = [...athletes];
  return frag;
}

export async function extractDrivers(ids, get, o = {}) {
  const out = [];
  await pool([...ids], o.concurrency ?? 6, async (id) => {
    const doc = await get(`${CORE_ROOT}/athletes/${id}`, { maxAgeMs: o.maxAgeMs ?? Infinity }).catch(() => null);
    if (doc) out.push(normalizeDriver(doc, o.ingestedAt));
  });
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function extractVenues(refs, get, o = {}) {
  const out = [];
  await pool([...refs], 4, async (r) => {
    const doc = await get(r, { maxAgeMs: o.maxAgeMs ?? Infinity }).catch(() => null);
    if (doc) out.push(normalizeVenue(doc, o.ingestedAt));
  });
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
