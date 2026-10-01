// ESPN F1 adapter: polite fetcher with an immutable on-disk raw cache.
// Every response is stored before parsing, keyed by its normalized URL path, with
// the capture time. Access barriers (401/403/challenge) stop the run: never evade.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const CORE = 'https://sports.core.api.espn.com/v2/sports/racing/leagues/f1';
export const CORE_ROOT = 'https://sports.core.api.espn.com/v2/sports/racing';
export const SITE = 'https://site.api.espn.com/apis/site/v2/sports/racing/f1';
const UA = 'PropBetEdge-F1-Ingest/1.0 (+https://f1.propbetedge.ai)';

export const CACHE_DIR = process.env.F1_CACHE_DIR || path.resolve('.cache/espn');

export class SourceBlocked extends Error {}

export function normalizeUrl(u) {
  const url = new URL(u.replace(/^http:/, 'https:'));
  url.searchParams.delete('lang');
  url.searchParams.delete('region');
  return url.toString();
}

export function cachePath(u) {
  const url = new URL(u);
  const key = (url.host + url.pathname + (url.search ? '_' + crypto.createHash('sha1').update(url.search).digest('hex').slice(0, 12) : ''))
    .replace(/[^a-zA-Z0-9/._-]/g, '_');
  return path.join(CACHE_DIR, key + '.json');
}

let inflight = 0;
const queue = [];
const MAX = Number(process.env.F1_CONCURRENCY || 6);
const MIN_GAP_MS = Number(process.env.F1_MIN_GAP_MS || 60);
let lastStart = 0;
export const stats = { network: 0, cached: 0, errors: 0, notFound: 0 };

async function slot() {
  if (inflight >= MAX) await new Promise((r) => queue.push(r));
  inflight++;
  const wait = lastStart + MIN_GAP_MS - Date.now();
  lastStart = Math.max(Date.now(), lastStart + MIN_GAP_MS);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
function release() {
  inflight--;
  const next = queue.shift();
  if (next) next();
}

/**
 * Fetch JSON with cache. opts.maxAgeMs: refetch if older (default: forever = history).
 * Returns { data, url, capturedAt, fromCache } or null for 404.
 */
export async function get(u, opts = {}) {
  const url = normalizeUrl(u);
  const file = cachePath(url);
  const maxAge = opts.maxAgeMs ?? Infinity;
  if (fs.existsSync(file)) {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < maxAge) {
      const env = JSON.parse(fs.readFileSync(file, 'utf8'));
      stats.cached++;
      return { ...env, fromCache: true };
    }
  }
  await slot();
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      let res;
      try {
        res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      } catch (e) {
        if (attempt === 3) throw e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      stats.network++;
      if (res.status === 401 || res.status === 403 || res.status === 407) {
        throw new SourceBlocked(`ESPN ${res.status} at ${url}`);
      }
      if (res.status === 404) {
        stats.notFound++;
        return null;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt === 3) throw new Error(`ESPN ${res.status} at ${url}`);
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      const text = await res.text();
      if (!text.trim().startsWith('{') && !text.trim().startsWith('[')) {
        throw new SourceBlocked(`ESPN non-JSON body (possible challenge) at ${url}`);
      }
      const data = JSON.parse(text);
      const env = { url, capturedAt: new Date().toISOString(), sha256: crypto.createHash('sha256').update(text).digest('hex'), data };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(env));
      return { ...env, fromCache: false };
    }
  } catch (e) {
    stats.errors++;
    throw e;
  } finally {
    release();
  }
}

/** Synchronous cache-only read (normalizer). Returns envelope or null. */
export function cached(u) {
  const file = cachePath(normalizeUrl(u));
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Follow a paginated core collection; returns all items (refs or inline objects). */
export async function collection(u, opts = {}) {
  const out = [];
  let page = 1;
  for (;;) {
    const sep = u.includes('?') ? '&' : '?';
    const r = await get(`${u}${sep}limit=100&page=${page}`, opts);
    if (!r) break;
    out.push(...(r.data.items || []));
    if (!r.data.pageCount || page >= r.data.pageCount) break;
    page++;
  }
  return out;
}

export async function pool(items, n, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        results[k] = await fn(items[k], k);
      }
    }),
  );
  return results;
}
